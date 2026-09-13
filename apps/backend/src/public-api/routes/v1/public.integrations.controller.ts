import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';
import { UpdateIntegrationSettingsDto } from '@gitroom/nestjs-libraries/dtos/integrations/update.integration.settings.dto';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { Organization } from '@prisma/client';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { CheckPolicies } from '@gitroom/backend/services/auth/permissions/permissions.ability';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { GetPostsDto } from '@gitroom/nestjs-libraries/dtos/posts/get.posts.dto';
import {
  AuthorizationActions,
  Sections,
} from '@gitroom/backend/services/auth/permissions/permission.exception.class';
import { VideoDto } from '@gitroom/nestjs-libraries/dtos/videos/video.dto';
import { VideoFunctionDto } from '@gitroom/nestjs-libraries/dtos/videos/video.function.dto';
import { UploadDto } from '@gitroom/nestjs-libraries/dtos/media/upload.dto';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { GetNotificationsDto } from '@gitroom/nestjs-libraries/dtos/notifications/get.notifications.dto';
import * as Sentry from '@sentry/nestjs';
import { socialIntegrationList, IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { getValidationSchemas } from '@gitroom/nestjs-libraries/chat/validation.schemas.helper';
import { RefreshIntegrationService } from '@gitroom/nestjs-libraries/integrations/refresh.integration.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { timer } from '@gitroom/helpers/utils/timer';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

@ApiTags('Public API')
@ApiSecurity('api-key')
@Controller('/public/v1')
export class PublicIntegrationsController {
  private storage = UploadFactory.createStorage();

  constructor(
    private _integrationService: IntegrationService,
    private _postsService: PostsService,
    private _mediaService: MediaService,
    private _notificationService: NotificationService,
    private _integrationManager: IntegrationManager,
    private _refreshIntegrationService: RefreshIntegrationService
  ) {}

  /** Chave por-perfil so opera no proprio perfil (`?profileId` divergente -> 403). */
  private resolveProfileId(
    publicApiProfileId: string | undefined,
    requestedProfileId?: string
  ) {
    if (
      publicApiProfileId &&
      requestedProfileId &&
      requestedProfileId !== publicApiProfileId
    ) {
      throw new HttpException(
        { msg: 'Profile key cannot access another profile' },
        403
      );
    }
    return publicApiProfileId ?? requestedProfileId;
  }

  @Post('/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadSimple(
    @GetOrgFromRequest() org: Organization,
    @UploadedFile('file') file: Express.Multer.File,
    @GetPublicApiProfileId() publicApiProfileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (!file) {
      throw new HttpException({ msg: 'No file provided' }, 400);
    }

    const getFile = await this.storage.uploadFile(file);
    const media = await this._mediaService.saveFile(
      org.id,
      getFile.originalname,
      getFile.path,
      undefined,
      publicApiProfileId
    );
    return { id: media.id, path: media.path };
  }

  @Post('/upload-from-url')
  async uploadsFromUrl(
    @GetOrgFromRequest() org: Organization,
    @Body() body: UploadDto,
    @GetPublicApiProfileId() publicApiProfileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const media = await this._mediaService.uploadFromUrl(
      org.id,
      body.url,
      undefined,
      publicApiProfileId
    );
    return { id: media.id, path: media.path };
  }

  @Get('/find-slot/:id')
  async findSlotIntegration(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return { date: await this._postsService.findFreeDateTime(org.id, id) };
  }

  @Get('/posts')
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Perfil de outra chave' })
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query() query: GetPostsDto & { profileId?: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // Chave de perfil ve so os posts do perfil (mesma regra do dashboard).
    const effectiveProfileId = this.resolveProfileId(
      publicApiProfileId,
      query.profileId
    );
    const posts = await this._postsService.getPosts(
      org.id,
      query,
      effectiveProfileId
    );
    return {
      posts,
    };
  }

  @Post('/posts')
  @CheckPolicies([AuthorizationActions.Create, Sections.POSTS_PER_MONTH])
  async createPost(
    @GetOrgFromRequest() org: Organization,
    @Body() rawBody: any,
    @GetPublicApiProfileId() publicApiProfileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const body = await this._postsService.mapTypeToPost(
      rawBody,
      org.id,
      rawBody.type === 'draft'
    );
    body.type = rawBody.type;

    // Carimba o post com o perfil da chave de API (quando for chave de perfil),
    // para que ele apareca no dashboard filtrado por perfil. Sem isso o post
    // nasce com profileId null e fica invisivel na visao do perfil.
    return this._postsService.createPost(org.id, body, publicApiProfileId);
  }

  @Delete('/posts/:id')
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  async deletePost(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const post = await this._postsService.getPostInScope(
      org.id,
      id,
      publicApiProfileId
    );
    return this._postsService.deletePost(org.id, post.group, publicApiProfileId);
  }

  @Delete('/posts/group/:group')
  @ApiResponse({ status: 404, description: 'Grupo fora do seu escopo' })
  async deletePostByGroup(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('group') group: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    await this._postsService.getGroupInScope(org.id, group, publicApiProfileId);
    return this._postsService.deletePost(org.id, group, publicApiProfileId);
  }

  @Get('/is-connected')
  async getActiveIntegrations(@GetOrgFromRequest() org: Organization) {
    Sentry.metrics.count('public_api-request', 1);
    return { connected: true };
  }

  @Get('/integrations')
  async listIntegration(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(
      publicApiProfileId,
      profileId
    );
    return (await this._integrationService.getIntegrationsList(org.id, effectiveProfileId)).map(
      (org) => ({
        id: org.id,
        name: org.name,
        identifier: org.providerIdentifier,
        picture: org.picture,
        disabled: org.disabled,
        profile: org.profile,
        customer: org.customer
          ? {
              id: org.customer.id,
              name: org.customer.name,
            }
          : undefined,
      })
    );
  }

  @Get('/social/:integration')
  @ApiQuery({ name: 'profileId', required: false })
  @CheckPolicies([AuthorizationActions.Create, Sections.CHANNEL])
  async getIntegrationUrl(
    @Param('integration') integration: string,
    @Query('refresh') refresh: string,
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId?: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    // Fora do try: 403 nao pode virar o 500 generico do catch abaixo.
    const effectiveProfileId = this.resolveProfileId(
      publicApiProfileId,
      profileId
    );
    if (
      !this._integrationManager
        .getAllowedSocialsIntegrations()
        .includes(integration)
    ) {
      throw new HttpException({ msg: 'Integration not allowed' }, 400);
    }

    const integrationProvider =
      this._integrationManager.getSocialIntegration(integration);

    if (integrationProvider.externalUrl) {
      throw new HttpException(
        { msg: 'This integration requires an external URL and is not supported via the public API' },
        400
      );
    }

    try {
      const { codeVerifier, state, url } =
        await integrationProvider.generateAuthUrl();

      if (refresh) {
        await ioRedis.set(`refresh:${state}`, refresh, 'EX', 3600);
      }

      await ioRedis.set(`organization:${state}`, org.id, 'EX', 3600);
      await ioRedis.set(`login:${state}`, codeVerifier, 'EX', 3600);
      // Perfil da chave (ou ?profileId) viaja no state: o callback grava o
      // canal ja no perfil certo, em vez de deixa-lo sem perfil (compartilhado).
      if (effectiveProfileId) {
        await ioRedis.set(`profile:${state}`, effectiveProfileId, 'EX', 3600);
      }

      return { url };
    } catch (err) {
      throw new HttpException({ msg: 'Failed to generate auth URL' }, 500);
    }
  }

  @Get('/notifications')
  async getNotifications(
    @GetOrgFromRequest() org: Organization,
    @Query() query: GetNotificationsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._notificationService.getNotificationsPaginated(
      org.id,
      query.page ?? 0
    );
  }

  @Post('/generate-video')
  generateVideo(
    @GetOrgFromRequest() org: Organization,
    @Body() body: VideoDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.generateVideo(org, body);
  }

  @Post('/video/function')
  videoFunction(@Body() body: VideoFunctionDto) {
    Sentry.metrics.count('public_api-request', 1);
    return this._mediaService.videoFunction(
      body.identifier,
      body.functionName,
      body.params
    );
  }

  @Delete('/integrations/:id')
  async deleteChannel(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const isTherePosts = await this._integrationService.getPostsForChannel(
      org.id,
      id
    );
    if (isTherePosts.length) {
      for (const post of isTherePosts) {
        this._postsService.deletePost(org.id, post.group).catch(() => {});
      }
    }

    return this._integrationService.deleteChannel(org.id, id);
  }

  @Post('/integrations/:id/enable')
  @ApiOperation({ summary: 'Reativar um canal desativado' })
  @ApiParam({ name: 'id', description: 'ID do canal' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 404, description: 'Canal inexistente' })
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  async enableChannel(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(
      publicApiProfileId,
      profileId
    );
    await this._integrationService.getIntegrationInScope(
      org.id,
      id,
      effectiveProfileId
    );
    return this._integrationService.enableChannel(
      org.id,
      (org as any)?.subscription?.totalChannels || pricing.FREE.channel,
      id,
      effectiveProfileId
    );
  }

  @Post('/integrations/:id/disable')
  @ApiOperation({
    summary: 'Desativar um canal (posts agendados nele deixam de sair)',
  })
  @ApiParam({ name: 'id', description: 'ID do canal' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 404, description: 'Canal inexistente' })
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  async disableChannel(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(
      publicApiProfileId,
      profileId
    );
    await this._integrationService.getIntegrationInScope(
      org.id,
      id,
      effectiveProfileId
    );
    return this._integrationService.disableChannel(org.id, id);
  }

  @Post('/integrations/:id/settings')
  @ApiOperation({
    summary: 'Atualizar as configurações do provedor de um canal',
    description:
      'Mesmo formato de `GET /integration-settings/:id`: array de `{ title, value }`.',
  })
  @ApiParam({ name: 'id', description: 'ID do canal' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: UpdateIntegrationSettingsDto })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 404, description: 'Canal inexistente' })
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  @UsePipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    })
  )
  async updateProviderSettings(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: UpdateIntegrationSettingsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(
      publicApiProfileId,
      profileId
    );
    await this._integrationService.getIntegrationInScope(
      org.id,
      id,
      effectiveProfileId
    );
    await this._integrationService.updateProviderSettings(
      org.id,
      id,
      body.additionalSettings
    );
    return { ok: true };
  }

  @Get('/integration-settings/:id')
  async getIntegrationSettings(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const loadIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    const verified =
      JSON.parse(loadIntegration.additionalSettings || '[]')?.find(
        (p: any) => p?.title === 'Verified'
      )?.value || false;

    const integration = socialIntegrationList.find(
      (p) => p.identifier === loadIntegration.providerIdentifier
    )!;

    if (!integration) {
      return {
        output: { rules: '', maxLength: 0, settings: {}, tools: [] as any[] },
      };
    }

    const maxLength = integration.maxLength(verified);
    const schemas = !integration.dto
      ? false
      : getValidationSchemas()[integration.dto.name];
    const tools = this._integrationManager.getAllTools();
    const rules = this._integrationManager.getAllRulesDescription();

    return {
      output: {
        rules: rules[integration.identifier],
        maxLength,
        settings: !schemas ? 'No additional settings required' : schemas,
        tools: tools[integration.identifier],
      },
    };
  }

  @Get('/posts/:id/missing')
  async getMissingContent(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.getMissingContent(org.id, id);
  }

  @Put('/posts/:id/release-id')
  async updateReleaseId(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body('releaseId') releaseId: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.updateReleaseId(org.id, id, releaseId);
  }

  @Get('/analytics/:integration')
  async getAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('integration') integration: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._integrationService.checkAnalytics(org, integration, date);
  }

  @Get('/analytics/post/:postId')
  async getPostAnalytics(
    @GetOrgFromRequest() org: Organization,
    @Param('postId') postId: string,
    @Query('date') date: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    return this._postsService.checkPostAnalytics(org.id, postId, +date);
  }

  @Post('/integration-trigger/:id')
  async triggerIntegrationTool(
    @GetOrgFromRequest() org: Organization,
    @Param('id') id: string,
    @Body() body: { methodName: string; data: Record<string, string> }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const getIntegration = await this._integrationService.getIntegrationById(
      org.id,
      id
    );

    if (!getIntegration) {
      throw new HttpException({ msg: 'Integration not found' }, 404);
    }

    const integrationProvider = socialIntegrationList.find(
      (p) => p.identifier === getIntegration.providerIdentifier
    )!;

    if (!integrationProvider) {
      throw new HttpException({ msg: 'Integration provider not found' }, 404);
    }

    const tools = this._integrationManager.getAllTools();
    if (
      // @ts-ignore
      !tools[integrationProvider.identifier]?.some(
        (p: any) => p.methodName === body.methodName
      ) ||
      // @ts-ignore
      !integrationProvider[body.methodName]
    ) {
      throw new HttpException({ msg: 'Tool not found' }, 404);
    }

    while (true) {
      try {
        // @ts-ignore
        const result = await integrationProvider[body.methodName](
          getIntegration.token,
          body.data || {},
          getIntegration.internalId,
          getIntegration
        );

        return { output: result };
      } catch (err) {
        if (err instanceof RefreshToken) {
          const data = await this._refreshIntegrationService.refresh(
            getIntegration
          );

          if (!data) {
            await this._integrationService.disconnectChannel(
              org.id,
              getIntegration
            );
            throw new HttpException(
              { msg: 'Channel disconnected due to expired token' },
              401
            );
          }

          const { accessToken } = data;

          if (accessToken) {
            getIntegration.token = accessToken;

            if (integrationProvider.refreshWait) {
              await timer(10000);
            }

            continue;
          }
        }
        throw new HttpException({ msg: 'Unexpected error' }, 500);
      }
    }
  }
}
