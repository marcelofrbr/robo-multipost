import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

/** Perfis e notificacoes — paridade com GET /public/v1/profiles e /notifications. */
const requireOrgId = () => {
  const org = getAuth<{ id: string }>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org.id;
};

@Injectable()
export class ListProfilesTool implements AgentToolInterface {
  constructor(private _profileService: ProfileService) {}
  name = 'listProfiles';

  run() {
    return createTool({
      id: 'listProfiles',
      description:
        'Perfis da organizacao. Com chave de perfil, devolve so o perfil atual.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        profiles: z.array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })),
      }),
      execute: async () => {
        const orgId = requireOrgId();
        const profileId = getProfileId();
        if (profileId) {
          const p = await this._profileService.getProfileById(orgId, profileId);
          return { profiles: p ? [{ id: p.id, name: p.name, isDefault: p.isDefault }] : [] };
        }
        const all = await this._profileService.getProfilesByOrgId(orgId);
        return { profiles: all.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault })) };
      },
    });
  }
}

@Injectable()
export class ListNotificationsTool implements AgentToolInterface {
  constructor(private _notificationService: NotificationService) {}
  name = 'listNotifications';

  run() {
    return createTool({
      id: 'listNotifications',
      description:
        'Notificacoes do app (falhas de publicacao, avisos), paginadas a partir de 0.',
      inputSchema: z.object({ page: z.string().optional() }),
      outputSchema: z.object({
        total: z.number(),
        hasMore: z.boolean(),
        notifications: z.array(z.object({ id: z.string(), content: z.string(), createdAt: z.string() })),
      }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const page = parseInt(input?.page ?? '0', 10) || 0;
        const r: any = await this._notificationService.getNotificationsPaginated(orgId, page);
        return {
          total: r.total ?? 0,
          hasMore: !!r.hasMore,
          notifications: (r.notifications ?? []).map((n: any) => ({
            id: n.id,
            content: n.content,
            createdAt: new Date(n.createdAt).toISOString(),
          })),
        };
      },
    });
  }
}
