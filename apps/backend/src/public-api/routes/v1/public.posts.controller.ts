import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Post,
  Put,
  Query,
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
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { PublicApiScopeService } from '@gitroom/nestjs-libraries/services/public-api-scope.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { ChangePostDateDto } from '@gitroom/nestjs-libraries/dtos/posts/change.post.date.dto';
import { CreatePostCommentDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.comment.dto';
import { toPublicPostPayload } from '@gitroom/nestjs-libraries/database/prisma/posts/public.post.mapper';

/**
 * Posts na API publica: detalhe, grupo, estatisticas, data e comentario.
 * Listar/criar/apagar continuam em public.integrations.controller.ts.
 * Posts sao estritos por perfil: fora do escopo da chave e 404
 * (PostsService.getPostInScope/getGroupInScope).
 */
@ApiTags('Posts')
@ApiSecurity('api-key')
@Controller('/public/v1')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  })
)
export class PublicPostsController {
  constructor(
    private _postsService: PostsService,
    private _organizationService: OrganizationService,
    private _scope: PublicApiScopeService
  ) {}

  @Get('/posts/group/:group')
  @ApiOperation({ summary: 'Todos os posts de um grupo (publicação multi-canal)' })
  @ApiParam({ name: 'group', description: 'ID do grupo (campo `group` de POST /posts)' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Grupo fora do seu escopo' })
  async getPostsByGroup(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('group') group: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(org.id, publicApiProfileId, profileId);
    await this._postsService.getGroupInScope(org.id, group, effectiveProfileId);
    // Nunca devolver token/refreshToken do canal embutido no post.
    return toPublicPostPayload(
      await this._postsService.getPostsByGroup(org.id, group)
    );
  }

  @Get('/posts/:id/statistics')
  @ApiOperation({ summary: 'Cliques nos links encurtados do post' })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(org.id, publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    return this._postsService.getStatistics(org.id, id);
  }

  @Get('/posts/:id')
  @ApiOperation({ summary: 'Detalhar um post (com os comentários encadeados e mídias)' })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  async getPost(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(org.id, publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    // Nunca devolver token/refreshToken do canal embutido no post.
    return toPublicPostPayload(await this._postsService.getPost(org.id, id));
  }

  @Put('/posts/:id/date')
  @ApiOperation({
    summary: 'Mudar a data de um post',
    description:
      '`action=schedule` (padrão) reagenda e volta o post para a fila; `update` só troca a data.',
  })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: ChangePostDateDto })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async changeDate(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: ChangePostDateDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(org.id, publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    return this._postsService.changeDate(
      org.id,
      id,
      body.date,
      body.action ?? 'schedule',
      effectiveProfileId
    );
  }

  @Post('/posts/:id/comments')
  @ApiOperation({
    summary: 'Comentar internamente num post',
    description:
      'Comentário da equipe (aparece na tela do post, não vai para a rede). Autor: dono da organização.',
  })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: CreatePostCommentDto })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async createComment(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: CreatePostCommentDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = await this._scope.resolveProfileId(org.id, publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    const ownerId = await this._organizationService.getOwnerUserId(org.id);
    return this._postsService.createComment(org.id, ownerId, id, body.comment);
  }
}
