import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Post,
  Query,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiPropertyOptional,
  ApiQuery,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { GetMediaQueryDto } from '@gitroom/nestjs-libraries/dtos/media/get-media.query.dto';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';

export class PublicGetMediaQueryDto extends GetMediaQueryDto {
  @ApiPropertyOptional({
    description:
      'Chave de organização: perfil alvo. Chave de perfil: precisa ser o próprio.',
  })
  @IsOptional()
  @IsString()
  profileId?: string;
}

/**
 * Biblioteca de midia na API publica. Upload continua em
 * public.integrations.controller.ts (POST /upload e /upload-from-url).
 * Midia sem perfil e compartilhada (mesma regra da tela): outro perfil -> 403.
 */
@ApiTags('Mídia')
@ApiSecurity('api-key')
@Controller('/public/v1')
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  })
)
export class PublicMediaController {
  constructor(private _mediaService: MediaService) {}

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

  @Get('/media')
  @ApiOperation({
    summary: 'Listar a biblioteca de mídia',
    description:
      'Paginado (`page`). `from`/`to` (ISO 8601) filtram pela data de upload.',
  })
  @ApiResponse({
    status: 200,
    description:
      '`{ pages, results: [{ id, path, name, alt, thumbnail, createdAt, ... }] }`',
  })
  async listMedia(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query() query: PublicGetMediaQueryDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, query.profileId);
    return this._mediaService.getMedia(org.id, query.page ?? 1, effectiveProfileId, {
      from: query.from,
      to: query.to,
    });
  }

  @Delete('/media/:id')
  @ApiOperation({ summary: 'Apagar uma mídia da biblioteca' })
  @ApiParam({ name: 'id', description: 'ID da mídia' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Mídia de outro perfil' })
  @ApiResponse({ status: 404, description: 'Mídia inexistente' })
  async deleteMedia(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._mediaService.getMediaInScope(org.id, id, effectiveProfileId);
    return this._mediaService.deleteMedia(org.id, id, effectiveProfileId);
  }

  @Post('/media/information')
  @ApiOperation({ summary: 'Editar texto alternativo e miniatura de uma mídia' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: SaveMediaInformationDto })
  @ApiResponse({ status: 403, description: 'Mídia de outro perfil' })
  @ApiResponse({ status: 404, description: 'Mídia inexistente' })
  async saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query('profileId') profileId: string | undefined,
    @Body() body: SaveMediaInformationDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._mediaService.getMediaInScope(org.id, body.id, effectiveProfileId);
    return this._mediaService.saveMediaInformation(org.id, body);
  }
}
