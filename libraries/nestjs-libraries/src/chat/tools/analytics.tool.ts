import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

/** Metricas — paridade com GET /public/v1/analytics/:integration e /analytics/post/:postId. */
const requireOrg = () => {
  const org = getAuth<{ id: string }>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org;
};

@Injectable()
export class IntegrationAnalyticsTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationAnalytics';

  run() {
    return createTool({
      id: 'integrationAnalytics',
      description:
        'Metricas de um canal (seguidores, alcance, etc.) nos ultimos N dias, ' +
        'como na tela de Analytics.',
      inputSchema: z.object({
        integrationId: z.string(),
        days: z.string().optional().describe('7, 30 ou 90 (padrao 7)'),
      }),
      outputSchema: z.object({ metrics: z.array(z.any()) }),
      execute: async (input: any) => {
        const org = requireOrg();
        await this._integrationService.getIntegrationInScope(org.id, input.integrationId, getProfileId());
        // checkAnalytics precisa da org inteira (assinatura legada do controller).
        const metrics = await this._integrationService.checkAnalytics(
          org as any,
          input.integrationId,
          input.days ?? '7'
        );
        return { metrics: (metrics as any[]) ?? [] };
      },
    });
  }
}

@Injectable()
export class PostAnalyticsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postAnalytics';

  run() {
    return createTool({
      id: 'postAnalytics',
      description:
        'Metricas de um post publicado (curtidas, comentarios, alcance) nos ' +
        'ultimos N dias.',
      inputSchema: z.object({
        postId: z.string(),
        days: z.string().optional().describe('padrao 7'),
      }),
      outputSchema: z.object({ metrics: z.array(z.any()) }),
      execute: async (input: any) => {
        const org = requireOrg();
        await this._postsService.getPostInScope(org.id, input.postId, getProfileId());
        const metrics = await this._postsService.checkPostAnalytics(
          org.id,
          input.postId,
          Number(input.days ?? 7)
        );
        return { metrics: (metrics as any[]) ?? [] };
      },
    });
  }
}
