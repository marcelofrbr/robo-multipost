import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable, NotFoundException } from '@nestjs/common';
import { FlowStatus } from '@prisma/client';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import {
  getAuth,
  getProfileId,
} from '@gitroom/nestjs-libraries/chat/async.storage';

function requireOrgId(): string {
  const org = getAuth<{ id: string }>();
  if (!org?.id) {
    throw new Error('MCP: organizacao ausente no contexto');
  }
  return org.id;
}

/**
 * Lista as automacoes (Flows) do perfil ativo.
 */
@Injectable()
export class ListAutomationsTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'listAutomations';

  run() {
    return createTool({
      id: 'listAutomations',
      description:
        'Lista as automacoes (Flows de comentario->resposta/DM, story reply, ' +
        'follow-gate) do perfil ativo. Use para ver o que ja existe antes de ' +
        'criar uma nova ou para pegar o id de uma automacao a (des)ativar.',
      outputSchema: z.object({ output: z.any() }),
      execute: async () => {
        const orgId = requireOrgId();
        const flows = await this._flowsService.getFlows(orgId, getProfileId());
        return { output: flows };
      },
    });
  }
}

/**
 * Lista posts recentes do Instagram de uma integracao, para escolher o post
 * alvo (postIds) ao criar uma automacao de comentario.
 */
@Injectable()
export class ListInstagramPostsForAutomationTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'listInstagramPostsForAutomation';

  run() {
    return createTool({
      id: 'listInstagramPostsForAutomation',
      description:
        'Lista posts recentes do Instagram de uma integracao para escolher o ' +
        'post alvo (postIds) ao criar uma automacao de comentario. Requer o ' +
        'integrationId de uma conta Instagram (use integrationList para obter).',
      inputSchema: z.object({
        integrationId: z
          .string()
          .describe('Id da integracao Instagram (de integrationList)'),
        cursor: z
          .string()
          .optional()
          .describe('Cursor de paginacao (nextCursor da chamada anterior)'),
        limit: z
          .number()
          .optional()
          .describe('Quantidade de posts a retornar (padrao 25)'),
      }),
      outputSchema: z.object({ output: z.any() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const result = await this._flowsService.getInstagramPostsByIntegration(
          orgId,
          input.integrationId,
          input.cursor,
          input.limit ?? 25,
          getProfileId()
        );
        return { output: result };
      },
    });
  }
}

/**
 * Cria uma automacao de comentario (gatilho comment_on_post -> resposta no
 * comentario e/ou DM). Mapeia os campos para o QuickCreateFlowDto. Para a
 * automacao disparar de verdade e necessario configurar credenciais Meta +
 * webhook (ver _HANDOFF.md, Trilha B); a checagem de webhook roda dentro do
 * quickCreateFlow e lanca um erro com instrucoes se faltar configuracao.
 */
/**
 * Contrato completo de uma automacao — espelha QuickCreateFlowDto
 * (libraries/nestjs-libraries/src/dtos/flows/flow.dto.ts). Usado por
 * createCommentAutomation e updateAutomation; quickUpdateFlow REESCREVE o
 * flow a partir do corpo, entao o schema precisa cobrir todos os campos
 * (senao um update apagaria storyIds/follow-gate/etc.).
 */
export const automationInputSchema = z.object({
  name: z.string().max(200).describe('Nome da automacao'),
  integrationId: z
    .string()
    .describe('Id do canal Instagram (de integrationList)'),
  triggerType: z
    .enum(['comment_on_post', 'story_reply'])
    .optional()
    .describe("Gatilho: comentario em post (padrao) ou resposta a story"),
  postMode: z
    .enum(['all', 'specific', 'next_publication'])
    .optional()
    .describe(
      "'all' = qualquer post; 'specific' = os de postIds/storyIds; " +
        "'next_publication' = o proximo post publicado. Padrao 'specific'."
    ),
  postIds: z
    .array(z.string())
    .max(100)
    .optional()
    .describe("Ids dos posts alvo quando postMode='specific' (comment_on_post)"),
  storyIds: z
    .array(z.string())
    .max(100)
    .optional()
    .describe("Ids dos stories alvo quando postMode='specific' (story_reply)"),
  keywords: z
    .array(z.string())
    .max(50)
    .optional()
    .describe('Palavras-chave que disparam (vazio = qualquer comentario)'),
  matchMode: z
    .enum(['any', 'all', 'exact'])
    .optional()
    .describe("'any' = qualquer palavra; 'all' = todas; 'exact' = texto exato"),
  matchReactions: z
    .boolean()
    .optional()
    .describe('story_reply: reagir tambem a reacoes (emoji) no story'),
  replyMessage: z.string().max(2200).optional().describe('Resposta publica no comentario'),
  replyMessages: z
    .array(z.string().max(2200))
    .max(10)
    .optional()
    .describe('Varias respostas publicas (sorteadas)'),
  dmMessage: z.string().max(2000).optional().describe('Mensagem enviada no Direct'),
  dmButtonText: z.string().max(80).optional().describe('Texto do botao na DM'),
  dmButtonUrl: z
    .string()
    .max(2048)
    .optional()
    .describe('URL https publica do botao na DM'),
  requireFollow: z
    .boolean()
    .optional()
    .describe('Exigir que a pessoa siga o perfil antes de receber o DM (follow-gate)'),
  followGateMessage: z.string().max(2000).optional().describe('Mensagem do follow-gate'),
  openingDmMessage: z.string().max(2000).optional().describe('Follow-gate em 2 passos: DM de abertura'),
  openingDmButtonText: z.string().max(80).optional().describe('Follow-gate em 2 passos: botao "ja sigo"'),
  alreadyFollowedButtonText: z.string().max(80).optional(),
  gateExhaustedMessage: z.string().max(2000).optional().describe('Mensagem quando esgota as tentativas'),
  maxGateAttempts: z.number().int().min(1).max(10).optional(),
  handoffToBot: z
    .boolean()
    .optional()
    .describe('Depois do DM inicial, o bot de DM (IA) assume a conversa'),
});

const toQuickCreateBody = (input: any) => ({
  name: input.name,
  integrationId: input.integrationId,
  triggerType: input.triggerType ?? 'comment_on_post',
  postMode: input.postMode ?? 'specific',
  postIds: input.postIds,
  storyIds: input.storyIds,
  keywords: input.keywords,
  matchMode: input.matchMode,
  matchReactions: input.matchReactions,
  replyMessage: input.replyMessage,
  replyMessages: input.replyMessages,
  dmMessage: input.dmMessage,
  dmButtonText: input.dmButtonText,
  dmButtonUrl: input.dmButtonUrl,
  requireFollow: input.requireFollow,
  followGateMessage: input.followGateMessage,
  openingDmMessage: input.openingDmMessage,
  openingDmButtonText: input.openingDmButtonText,
  alreadyFollowedButtonText: input.alreadyFollowedButtonText,
  gateExhaustedMessage: input.gateExhaustedMessage,
  maxGateAttempts: input.maxGateAttempts,
  handoffToBot: input.handoffToBot,
});

/**
 * Cria uma automacao (comentario em post ou resposta a story -> resposta
 * publica e/ou DM, com follow-gate opcional). Mapeia para o
 * QuickCreateFlowDto; a checagem de webhook roda dentro do quickCreateFlow e
 * lanca um erro com instrucoes se faltar configuracao na Meta.
 */
@Injectable()
export class CreateCommentAutomationTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'createCommentAutomation';

  run() {
    return createTool({
      id: 'createCommentAutomation',
      description:
        'Cria uma automacao no Instagram: quando alguem comenta num post (ou ' +
        'responde a um story), o sistema responde publicamente e/ou envia uma DM, ' +
        'com follow-gate opcional. Use integrationList para o integrationId e ' +
        'listInstagramPostsForAutomation para os postIds.',
      inputSchema: automationInputSchema,
      outputSchema: z.object({ output: z.any() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const flow = await this._flowsService.quickCreateFlow(
          orgId,
          toQuickCreateBody(input) as any,
          getProfileId()
        );
        return { output: flow };
      },
    });
  }
}

/**
 * Liga/desliga (ou arquiva) uma automacao existente.
 */
@Injectable()
export class SetAutomationStatusTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'setAutomationStatus';

  run() {
    return createTool({
      id: 'setAutomationStatus',
      description:
        'Altera o status de uma automacao existente: ACTIVE (liga), PAUSED ' +
        '(desliga), DRAFT (rascunho) ou ARCHIVED (arquiva). Use listAutomations ' +
        'para obter o id.',
      inputSchema: z.object({
        flowId: z.string().describe('Id da automacao (de listAutomations)'),
        status: z
          .enum(['ACTIVE', 'PAUSED', 'DRAFT', 'ARCHIVED'])
          .describe('Novo status da automacao'),
      }),
      outputSchema: z.object({ output: z.any() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const updated = await this._flowsService.updateFlowStatus(
          orgId,
          input.flowId,
          input.status as FlowStatus,
          getProfileId()
        );
        return { output: updated };
      },
    });
  }
}

async function requireFlowInScope(flowsService: FlowsService, orgId: string, flowId: string) {
  const flow = await flowsService.getFlow(orgId, flowId, getProfileId());
  if (!flow) {
    throw new NotFoundException('Flow not found');
  }
  return flow;
}

/** Detalha uma automacao do perfil (nos/arestas incluidos) — GET /flows/:id. */
@Injectable()
export class GetAutomationTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'getAutomation';

  run() {
    return createTool({
      id: 'getAutomation',
      description:
        'Detalha uma automacao do perfil atual (configuracao completa). Use ' +
        'antes de updateAutomation, que reescreve o flow inteiro.',
      inputSchema: z.object({ flowId: z.string() }),
      outputSchema: z.object({ flow: z.any() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const flow = await requireFlowInScope(this._flowsService, orgId, input.flowId);
        return { flow };
      },
    });
  }
}

/** Reescreve uma automacao — PUT /flows/:id (mesmo contrato da criacao). */
@Injectable()
export class UpdateAutomationTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'updateAutomation';

  run() {
    return createTool({
      id: 'updateAutomation',
      description:
        'Edita uma automacao REESCREVENDO a configuracao inteira a partir dos ' +
        'campos enviados (mesmo contrato de createCommentAutomation). Leia com ' +
        'getAutomation e reenvie todos os campos que devem permanecer. ' +
        'Promove DRAFT para ACTIVE.',
      inputSchema: automationInputSchema.extend({ flowId: z.string() }),
      outputSchema: z.object({ flow: z.any() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await requireFlowInScope(this._flowsService, orgId, input.flowId);
        const flow = await this._flowsService.quickUpdateFlow(
          orgId,
          input.flowId,
          toQuickCreateBody(input) as any,
          getProfileId()
        );
        return { flow };
      },
    });
  }
}

/** Exclui uma automacao — DELETE /flows/:id. */
@Injectable()
export class DeleteAutomationTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'deleteAutomation';

  run() {
    return createTool({
      id: 'deleteAutomation',
      description: 'Exclui uma automacao do perfil atual. Irreversivel — confirme antes.',
      inputSchema: z.object({ flowId: z.string() }),
      outputSchema: z.object({ deleted: z.boolean() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await requireFlowInScope(this._flowsService, orgId, input.flowId);
        await this._flowsService.deleteFlow(orgId, input.flowId, getProfileId());
        return { deleted: true };
      },
    });
  }
}

/** Historico de execucoes — GET /flows/:id/executions. */
@Injectable()
export class AutomationExecutionsTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'automationExecutions';

  run() {
    return createTool({
      id: 'automationExecutions',
      description:
        'Historico do que a automacao fez (comentarios respondidos, DMs ' +
        'enviados, erros), paginado.',
      inputSchema: z.object({
        flowId: z.string(),
        page: z.number().optional().describe('a partir de 1'),
        limit: z.number().optional().describe('ate 100 (padrao 20)'),
      }),
      outputSchema: z.object({ items: z.array(z.any()), total: z.number() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await requireFlowInScope(this._flowsService, orgId, input.flowId);
        // Mesmo clamp do controller publico: o service nao limita.
        const page = Math.max(1, Number(input.page) || 1);
        const limit = Math.min(100, Math.max(1, Number(input.limit) || 20));
        const r: any = await this._flowsService.getExecutions(orgId, input.flowId, page, limit);
        return { items: r?.items ?? [], total: r?.total ?? 0 };
      },
    });
  }
}

/** Diagnostico do webhook da Meta — GET /flows/integrations/:id/webhook-status. */
@Injectable()
export class WebhookStatusTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'webhookStatus';

  run() {
    return createTool({
      id: 'webhookStatus',
      description:
        'Verifica se o app da Meta esta assinado para comments/messages no ' +
        'canal. ok=false explica o que falta — rode antes de criar automacoes.',
      inputSchema: z.object({ integrationId: z.string() }),
      outputSchema: z.object({ ok: z.boolean(), error: z.string().optional() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await this._flowsService.assertIntegrationAccess(orgId, input.integrationId, getProfileId());
        const r: any = await this._flowsService.checkIntegrationWebhook(orgId, input.integrationId);
        return { ok: !!r?.ok, error: r?.error };
      },
    });
  }
}
