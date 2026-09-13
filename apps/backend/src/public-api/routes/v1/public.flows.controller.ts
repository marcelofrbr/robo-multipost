import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiSecurity,
  ApiOperation,
  ApiBody,
  ApiParam,
  ApiQuery,
  ApiResponse,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import * as Sentry from '@sentry/nestjs';
import { Organization } from '@prisma/client';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { PublicApiScopeService } from '@gitroom/nestjs-libraries/services/public-api-scope.service';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import { DmFlowService } from '@gitroom/nestjs-libraries/database/prisma/dm/dm-flow.service';
import {
  DmBotConfigDto,
  QuickCreateFlowDto,
  UpdateFlowStatusDto,
} from '@gitroom/nestjs-libraries/dtos/flows/flow.dto';

// Exemplos prontos exibidos no Swagger ("Example Value" -> dropdown). O body e
// um $ref puro do QuickCreateFlowDto, e o Swagger UI nao compoe automaticamente
// um exemplo a partir dos `example` de cada campo — por isso fornecemos exemplos
// completos e copiaveis aqui.
const FLOW_BODY_EXAMPLES = {
  'comentario-dm': {
    summary: 'Comentário → resposta + DM com link (next_publication)',
    value: {
      name: 'Receita - link no DM',
      integrationId: 'SEU_INTEGRATION_ID',
      triggerType: 'comment_on_post',
      postMode: 'next_publication',
      keywords: ['EU QUERO'],
      matchMode: 'any',
      replyMessage: 'Te mandei no direct! 💬',
      dmMessage: 'Aqui está a receita 👇',
      dmButtonText: 'Ver receita',
      dmButtonUrl: 'https://seu-blog.com/bolo',
    },
  },
  'post-especifico': {
    summary: 'Post específico (postMode=specific + postIds)',
    value: {
      name: 'Promo do post X',
      integrationId: 'SEU_INTEGRATION_ID',
      triggerType: 'comment_on_post',
      postMode: 'specific',
      postIds: ['17999999999999999'],
      keywords: ['QUERO'],
      dmMessage: 'Segue o link 👇',
      dmButtonText: 'Acessar',
      dmButtonUrl: 'https://seu-blog.com/promo',
    },
  },
  'follow-gate': {
    summary: 'Com follow-gate (exige seguir antes da DM)',
    value: {
      name: 'Ebook - follow gate',
      integrationId: 'SEU_INTEGRATION_ID',
      postMode: 'next_publication',
      keywords: ['QUERO'],
      requireFollow: true,
      followGateMessage: 'Siga o perfil e comente de novo 😉',
      dmMessage: 'Valeu por seguir! Aqui 👇',
      dmButtonText: 'Baixar',
      dmButtonUrl: 'https://seu-blog.com/ebook',
    },
  },
};

/**
 * API publica de automacoes de comentario/story do Instagram (Flows).
 *
 * Autenticada por chave de API (org-level, OAuth `pos_*` ou chave por-perfil)
 * via `PublicAuthMiddleware`, que popula `req.org` e — para chaves por-perfil —
 * `req.publicApiProfileId`. O escopo por-perfil e enforced em duas camadas:
 *   1. aqui (rejeita `?profileId`/body.profileId divergente da chave -> 403);
 *   2. no `FlowsService.assertIntegrationAccess` (integracao de outro perfil ->
 *      403; so Instagram; nao desativada).
 *
 * ValidationPipe estrito (whitelist + forbidNonWhitelisted) protege contra
 * mass-assignment SEM alterar o pipe global (blast-radius minimo).
 */
@ApiTags('Automações (Flows)')
@ApiSecurity('api-key')
@Controller('/public/v1')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  })
)
export class PublicFlowsController {
  constructor(
    private _flowsService: FlowsService,
    private _dmFlowService: DmFlowService,
    private _scope: PublicApiScopeService
  ) {}


  @Post('/flows')
  @ApiOperation({
    summary: 'Criar automação de comentário/story do Instagram',
    description:
      'Cria um Flow (automação). Com chave de organização sem `?profileId`, é atribuído ao perfil Default. ' +
      'Quando `postMode` é omitido, assume `next_publication` (vincula ao próximo post publicado no canal).',
  })
  @ApiQuery({
    name: 'profileId',
    required: false,
    description:
      'Escopa o flow a um perfil (apenas chave de organização). Omitido → perfil Default.',
  })
  @ApiBody({ type: QuickCreateFlowDto, examples: FLOW_BODY_EXAMPLES })
  @ApiResponse({ status: 201, description: 'Flow criado (geralmente já ACTIVE).' })
  @ApiResponse({
    status: 400,
    description:
      'Validação: dmButtonUrl não-https, postIds vazio em postMode=specific, matchMode inválido, profileId inexistente, canal que não é Instagram ou webhook da Meta não assinado (veja /webhook-status).',
  })
  @ApiResponse({ status: 401, description: 'Chave de API ausente ou inválida.' })
  @ApiResponse({
    status: 403,
    description: 'Chave de perfil tentando criar em outro profileId.',
  })
  @ApiResponse({
    status: 412,
    description: 'Canal inexistente, desativado ou com token expirado (reconecte na tela).',
  })
  // Cada criacao/ativacao dispara assinatura de webhook na Meta Graph API
  // (rate-limit ~10 req/s por app) — limite proprio mais apertado que o global.
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  async createFlow(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query('profileId') profileId: string | undefined,
    @Body() body: QuickCreateFlowDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    // Modo padrao para o cenario de encadeamento (gerar imagem -> publicar ->
    // criar automacao): next_publication faz a automacao se conectar sozinha ao
    // proximo post publicado, sem o cliente precisar do media id do Instagram.
    const payload: QuickCreateFlowDto = {
      ...body,
      postMode: body.postMode ?? 'next_publication',
    };
    this.assertSpecificTargets(payload);
    return this._flowsService.quickCreateFlow(
      org.id,
      payload,
      effectiveProfileId
    );
  }

  @Get('/flows')
  @ApiOperation({
    summary: 'Listar automações',
    description:
      'Lista os flows do escopo: chave de organização vê todos; chave de perfil vê apenas os do próprio perfil.',
  })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiQuery({
    name: 'integrationId',
    required: false,
    description: 'Filtra os flows por canal do Instagram.',
  })
  @ApiResponse({ status: 200, description: 'Lista de flows.' })
  async listFlows(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query('profileId') profileId?: string,
    @Query('integrationId') integrationId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    return this._flowsService.getFlows(
      org.id,
      effectiveProfileId,
      integrationId || undefined
    );
  }

  @Get('/flows/:id')
  @ApiOperation({ summary: 'Detalhar uma automação (com nós e arestas)' })
  @ApiParam({ name: 'id', description: 'ID do flow' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Automação fora do seu escopo' })
  async getFlow(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    return this.assertFlowInScope(org.id, id, effectiveProfileId);
  }

  @Put('/flows/:id')
  @ApiOperation({
    summary: 'Editar uma automação',
    description:
      'Reescreve o flow a partir do mesmo contrato de criação (QuickCreateFlowDto). Promove DRAFT→ACTIVE.',
  })
  @ApiParam({ name: 'id', description: 'ID do flow' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: QuickCreateFlowDto, examples: FLOW_BODY_EXAMPLES })
  @ApiResponse({ status: 404, description: 'Automação fora do seu escopo' })
  // quickUpdateFlow promove DRAFT->ACTIVE, disparando assinatura de webhook na
  // Meta — mesmo rate limit do POST para evitar abuso da chamada outbound.
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  async updateFlow(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: QuickCreateFlowDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    await this.assertFlowInScope(org.id, id, effectiveProfileId);
    this.assertSpecificTargets(body);
    return this._flowsService.quickUpdateFlow(
      org.id,
      id,
      body,
      effectiveProfileId
    );
  }

  @Post('/flows/:id/status')
  @ApiOperation({
    summary: 'Ativar / pausar / arquivar uma automação',
    description: 'Altera o status: ACTIVE, PAUSED, ARCHIVED ou DRAFT.',
  })
  @ApiParam({ name: 'id', description: 'ID do flow' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: UpdateFlowStatusDto })
  @ApiResponse({ status: 404, description: 'Automação fora do seu escopo' })
  // Ativar (status ACTIVE) dispara assinatura de webhook na Meta — throttle.
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  async updateFlowStatus(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: UpdateFlowStatusDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    await this.assertFlowInScope(org.id, id, effectiveProfileId);
    return this._flowsService.updateFlowStatus(
      org.id,
      id,
      body.status,
      effectiveProfileId
    );
  }

  @Delete('/flows/:id')
  @ApiOperation({ summary: 'Excluir uma automação' })
  @ApiParam({ name: 'id', description: 'ID do flow' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Automação fora do seu escopo' })
  async deleteFlow(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    await this.assertFlowInScope(org.id, id, effectiveProfileId);
    return this._flowsService.deleteFlow(org.id, id, effectiveProfileId);
  }
  // --- Execucoes -----------------------------------------------------------

  /**
   * `postMode=specific` sem alvo viraria silenciosamente "qualquer post" no
   * service (comportamento que o wizard privado depende). Na API publica isso
   * e erro de contrato: 400 com a mensagem certa em vez de surpresa em prod.
   */
  private assertSpecificTargets(body: QuickCreateFlowDto) {
    if (body.postMode !== 'specific') {
      return;
    }
    const triggerType = body.triggerType ?? 'comment_on_post';
    const targets =
      triggerType === 'story_reply' ? body.storyIds : body.postIds;
    if (!targets?.length) {
      throw new BadRequestException(
        triggerType === 'story_reply'
          ? 'storyIds is required (non-empty) when postMode=specific and triggerType=story_reply'
          : 'postIds is required (non-empty) when postMode=specific'
      );
    }
  }

  /**
   * Toda rota por `:id` passa por aqui antes de ler/mutar: sem isso o
   * service devolve null (200 vazio) ou o Prisma estoura P2025 (500) quando
   * o flow e de outro perfil/org — o contrato publico e 404.
   */
  private async assertFlowInScope(
    orgId: string,
    flowId: string,
    profileId?: string
  ) {
    const flow = await this._flowsService.getFlow(orgId, flowId, profileId);
    if (!flow) {
      throw new NotFoundException('Flow not found');
    }
    return flow;
  }

  @Get('/flows/:id/executions')
  @ApiOperation({
    summary: 'Histórico de execuções de uma automação',
    description:
      'Lista o que a automação fez (comentários respondidos, DMs enviados, erros). Paginado por `page`/`limit`.',
  })
  @ApiParam({ name: 'id', description: 'ID do flow' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 20 })
  @ApiResponse({ status: 404, description: 'Automação fora do seu escopo' })
  async listExecutions(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    await this.assertFlowInScope(org.id, id, publicApiProfileId);
    const safePage = Math.max(1, Number(page) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number(limit) || 20));
    return this._flowsService.getExecutions(org.id, id, safePage, safeLimit);
  }

  @Get('/flows/:id/executions/:executionId')
  @ApiOperation({ summary: 'Detalhar uma execução (com log)' })
  @ApiParam({ name: 'id', description: 'ID do flow' })
  @ApiParam({ name: 'executionId', description: 'ID da execução' })
  @ApiResponse({ status: 404, description: 'Automação ou execução fora do seu escopo' })
  async getExecution(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Param('executionId') executionId: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    await this.assertFlowInScope(org.id, id, publicApiProfileId);
    // executionId amarrado ao flow da rota (evita ler execucoes de outro flow).
    const execution = await this._flowsService.getExecution(
      org.id,
      executionId,
      id
    );
    if (!execution) {
      throw new NotFoundException('Execution not found');
    }
    return execution;
  }

  // --- Alvos (posts/stories) e webhook ------------------------------------

  @Get('/flows/integrations/:integrationId/posts')
  @ApiOperation({
    summary: 'Posts do Instagram de um canal (para escolher o alvo da automação)',
  })
  @ApiParam({ name: 'integrationId', description: 'ID do canal Instagram' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor de paginação do Instagram' })
  @ApiQuery({ name: 'limit', required: false, example: 25 })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 412, description: 'Canal inexistente ou desativado' })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listIntegrationPosts(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('integrationId') integrationId: string,
    @Query('profileId') profileId?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    const safeLimit = limit
      ? Math.min(50, Math.max(1, Number(limit) || 25))
      : undefined;
    return this._flowsService.getInstagramPostsByIntegration(
      org.id,
      integrationId,
      cursor || undefined,
      safeLimit,
      effectiveProfileId
    );
  }

  @Get('/flows/integrations/:integrationId/stories')
  @ApiOperation({ summary: 'Stories ativos do Instagram de um canal' })
  @ApiParam({ name: 'integrationId', description: 'ID do canal Instagram' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 412, description: 'Canal inexistente ou desativado' })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async listIntegrationStories(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('integrationId') integrationId: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    return this._flowsService.getInstagramStoriesByIntegration(
      org.id,
      integrationId,
      effectiveProfileId
    );
  }

  @Get('/flows/integrations/:integrationId/webhook-status')
  @ApiOperation({
    summary: 'Diagnóstico do webhook da Meta para o canal',
    description:
      'Verifica se o app da Meta está assinado para comments/messages. `ok=false` explica o que falta.',
  })
  @ApiParam({ name: 'integrationId', description: 'ID do canal Instagram' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 412, description: 'Canal inexistente ou desativado' })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async webhookStatus(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('integrationId') integrationId: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    await this._flowsService.assertIntegrationAccess(
      org.id,
      integrationId,
      effectiveProfileId
    );
    return this._flowsService.checkIntegrationWebhook(org.id, integrationId);
  }

  // --- Bot de DM e escalações --------------------------------------------

  @Post('/flows/dm/bot')
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 412, description: 'Canal inexistente ou desativado' })
  @Throttle({ default: { limit: 20, ttl: 3600_000 } })
  @ApiOperation({
    summary: 'Ligar/desligar o bot de DM de um canal',
    description:
      'Cria ou atualiza o Flow do tipo direct_message. `enabled=true` liga (ACTIVE), `false` pausa.',
  })
  async configureDmBot(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Body() body: DmBotConfigDto,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    return this._flowsService.createOrUpdateDirectMessageBotFlow(
      org.id,
      body.integrationId,
      { enabled: body.enabled, fallbackMessage: body.fallbackMessage },
      effectiveProfileId
    );
  }

  @Get('/flows/dm/escalations')
  @ApiOperation({
    summary: 'Conversas de DM escaladas para atendimento humano',
  })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Perfil de outra chave' })
  async listDmEscalations(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    return this._dmFlowService.listEscalations(org.id, effectiveProfileId);
  }

  @Post('/flows/dm/escalations/:id/resolve')
  @ApiOperation({ summary: 'Marcar uma escalação de DM como resolvida' })
  @ApiParam({ name: 'id', description: 'ID da conversa' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Perfil de outra chave' })
  @ApiResponse({ status: 404, description: 'Conversa fora do seu escopo' })
  @Throttle({ default: { limit: 60, ttl: 3600_000 } })
  async resolveDmEscalation(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(
      org.id,
      publicApiProfileId,
      profileId
    );
    return this._dmFlowService.resolveConversation(
      org.id,
      id,
      effectiveProfileId
    );
  }
}
