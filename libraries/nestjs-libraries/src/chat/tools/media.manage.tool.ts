import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';

/**
 * Biblioteca de midia — paridade com DELETE /public/v1/media/:id e
 * POST /media/information. Midia sem perfil e compartilhada (403 para outro
 * perfil, via MediaService.getMediaInScope).
 */
const requireOrgId = () => {
  const org = getAuth<{ id: string }>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org.id;
};

@Injectable()
export class DeleteMediaTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'deleteMedia';

  run() {
    return createTool({
      id: 'deleteMedia',
      description:
        'Apaga uma midia da biblioteca do perfil atual (use listMedia para o id). ' +
        'Midia usada em post agendado continua protegida na limpeza automatica.',
      inputSchema: z.object({ mediaId: z.string() }),
      outputSchema: z.object({ deleted: z.boolean() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const profileId = getProfileId();
        await this._mediaService.getMediaInScope(orgId, input.mediaId, profileId);
        await this._mediaService.deleteMedia(orgId, input.mediaId, profileId);
        return { deleted: true };
      },
    });
  }
}

@Injectable()
export class SaveMediaInformationTool implements AgentToolInterface {
  constructor(private _mediaService: MediaService) {}
  name = 'saveMediaInformation';

  run() {
    return createTool({
      id: 'saveMediaInformation',
      description:
        'Edita o texto alternativo (alt) e a miniatura de uma midia da biblioteca.',
      inputSchema: z.object({
        mediaId: z.string(),
        alt: z.string().max(2000).describe('Texto alternativo (acessibilidade)'),
        thumbnail: z.string().optional().describe('URL da miniatura (videos)'),
        thumbnailTimestamp: z.number().optional().describe('Instante (s) do frame usado como miniatura'),
      }),
      outputSchema: z.object({ id: z.string(), alt: z.string().nullable().optional() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const profileId = getProfileId();
        await this._mediaService.getMediaInScope(orgId, input.mediaId, profileId);
        const r: any = await this._mediaService.saveMediaInformation(
          orgId,
          {
            id: input.mediaId,
            alt: input.alt,
            thumbnail: input.thumbnail,
            thumbnailTimestamp: input.thumbnailTimestamp,
          } as any,
          profileId
        );
        return { id: r.id, alt: r.alt };
      },
    });
  }
}
