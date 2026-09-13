import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { toPublicPostPayload } from '@gitroom/nestjs-libraries/database/prisma/posts/public.post.mapper';

/**
 * Tools MCP de posts — paridade com /public/v1/posts*. Org e perfil vem
 * SEMPRE do AsyncLocalStorage (nunca do schema). Escopo: posts sao estritos
 * por perfil (PostsService.getPostInScope -> 404 fora do escopo).
 */
const requireOrgId = () => {
  const org = getAuth<{ id: string }>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org.id;
};

const iso = (d: unknown) => (d ? new Date(d as string).toISOString() : undefined);

@Injectable()
export class ListPostsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'listPosts';

  run() {
    return createTool({
      id: 'listPosts',
      description:
        'Lista os posts do calendario do perfil atual num periodo (agendados, ' +
        'publicados, rascunhos). Use antes de editar, apagar ou reagendar um ' +
        'post — os ids voltam aqui.',
      inputSchema: z.object({
        startDate: z.string().describe('Inicio do periodo (ISO 8601)'),
        endDate: z.string().describe('Fim do periodo (ISO 8601)'),
      }),
      outputSchema: z.object({
        posts: z.array(
          z.object({
            id: z.string(),
            group: z.string(),
            publishDate: z.string(),
            state: z.string(),
            content: z.string(),
            integrationId: z.string(),
            integrationName: z.string(),
            provider: z.string(),
          })
        ),
      }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const posts = await this._postsService.getPosts(
          orgId,
          { startDate: input.startDate, endDate: input.endDate } as any,
          getProfileId()
        );
        return {
          posts: (posts as any[]).map((p) => ({
            id: p.id,
            group: p.group,
            publishDate: iso(p.publishDate) ?? '',
            state: p.state,
            content: p.content ?? '',
            integrationId: p.integration?.id ?? '',
            integrationName: p.integration?.name ?? '',
            provider: p.integration?.providerIdentifier ?? '',
          })),
        };
      },
    });
  }
}

@Injectable()
export class GetPostTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'getPost';

  run() {
    return createTool({
      id: 'getPost',
      description:
        'Detalha um post do perfil atual: grupo, itens encadeados (thread/' +
        'carrossel), midias e canal (sem tokens).',
      inputSchema: z.object({ postId: z.string() }),
      outputSchema: z.object({
        group: z.string().optional(),
        posts: z.array(
          z.object({
            id: z.string(),
            content: z.string(),
            publishDate: z.string().optional(),
            image: z.array(z.any()).optional(),
            integration: z.any().optional(),
          })
        ),
      }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await this._postsService.getPostInScope(orgId, input.postId, getProfileId());
        const full = toPublicPostPayload(await this._postsService.getPost(orgId, input.postId));
        return {
          group: full.group,
          posts: (full.posts as any[]).map((p) => ({
            id: p.id,
            content: p.content ?? '',
            publishDate: iso(p.publishDate),
            image: p.image,
            integration: p.integration,
          })),
        };
      },
    });
  }
}

@Injectable()
export class DeletePostTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'deletePost';

  run() {
    return createTool({
      id: 'deletePost',
      description:
        'Apaga um post do perfil atual (e todo o grupo dele, se for publicacao ' +
        'multi-canal). Irreversivel — confirme com o usuario antes.',
      inputSchema: z.object({ postId: z.string() }),
      outputSchema: z.object({ deleted: z.boolean(), group: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const profileId = getProfileId();
        const post = await this._postsService.getPostInScope(orgId, input.postId, profileId);
        await this._postsService.deletePost(orgId, post.group, profileId);
        return { deleted: true, group: post.group };
      },
    });
  }
}

@Injectable()
export class ChangePostDateTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'changePostDate';

  run() {
    return createTool({
      id: 'changePostDate',
      description:
        'Muda a data de um post. action=schedule (padrao) reagenda e volta para ' +
        'a fila; update so troca a data sem mexer no status.',
      inputSchema: z.object({
        postId: z.string(),
        date: z.string().describe('Nova data/hora ISO 8601 (UTC)'),
        action: z.enum(['schedule', 'update']).optional(),
      }),
      outputSchema: z.object({ id: z.string(), publishDate: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const profileId = getProfileId();
        await this._postsService.getPostInScope(orgId, input.postId, profileId);
        const updated: any = await this._postsService.changeDate(
          orgId,
          input.postId,
          input.date,
          input.action ?? 'schedule',
          profileId
        );
        return { id: updated.id, publishDate: iso(updated.publishDate) ?? input.date };
      },
    });
  }
}

@Injectable()
export class FindFreeSlotTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _integrationService: IntegrationService
  ) {}
  name = 'findFreeSlot';

  run() {
    return createTool({
      id: 'findFreeSlot',
      description:
        'Proximo horario livre de um canal do perfil atual, seguindo os ' +
        'horarios de postagem configurados nele.',
      inputSchema: z.object({ integrationId: z.string() }),
      outputSchema: z.object({ date: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await this._integrationService.getIntegrationInScope(orgId, input.integrationId, getProfileId());
        const date = await this._postsService.findFreeDateTime(orgId, input.integrationId);
        return { date: String(date) };
      },
    });
  }
}

@Injectable()
export class PostStatisticsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postStatistics';

  run() {
    return createTool({
      id: 'postStatistics',
      description: 'Cliques nos links encurtados de um post do perfil atual.',
      inputSchema: z.object({ postId: z.string() }),
      outputSchema: z.object({ clicks: z.array(z.any()) }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await this._postsService.getPostInScope(orgId, input.postId, getProfileId());
        return this._postsService.getStatistics(orgId, input.postId);
      },
    });
  }
}

@Injectable()
export class CreatePostCommentTool implements AgentToolInterface {
  constructor(
    private _postsService: PostsService,
    private _organizationService: OrganizationService
  ) {}
  name = 'createPostComment';

  run() {
    return createTool({
      id: 'createPostComment',
      description:
        'Deixa um comentario interno da equipe num post (nao vai para a rede ' +
        'social; aparece na tela do post). Autor: dono da organizacao.',
      inputSchema: z.object({ postId: z.string(), comment: z.string().min(1).max(2000) }),
      outputSchema: z.object({ id: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        await this._postsService.getPostInScope(orgId, input.postId, getProfileId());
        const ownerId = await this._organizationService.getOwnerUserId(orgId);
        const c: any = await this._postsService.createComment(orgId, ownerId, input.postId, input.comment);
        return { id: c.id };
      },
    });
  }
}
