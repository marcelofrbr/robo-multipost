import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { DmRepository } from '@gitroom/nestjs-libraries/database/prisma/dm/dm.repository';
import {
  getAuth,
  getProfileId,
} from '@gitroom/nestjs-libraries/chat/async.storage';

/**
 * Lista as conversas de DM que foram escaladas para atendimento humano
 * (status HUMAN_HANDOFF) do perfil ativo. Util para um humano ver quais
 * conversas o bot transferiu e precisam de resposta manual.
 */
@Injectable()
export class DmEscalationsListTool implements AgentToolInterface {
  constructor(private _dmRepository: DmRepository) {}
  name = 'listDmEscalations';

  run() {
    return createTool({
      id: 'listDmEscalations',
      description:
        'Lista as conversas de DM (mensagens diretas do Instagram) escaladas ' +
        'para atendimento humano pelo bot. Mostra quem enviou, o motivo da ' +
        'escalacao e quando ocorreu, para um humano assumir a conversa.',
      inputSchema: z.object({}),
      outputSchema: z.object({
        conversations: z.array(
          z.object({
            id: z.string(),
            igSenderId: z.string(),
            igSenderName: z.string().optional(),
            escalationReason: z.string().optional(),
            escalatedAt: z.string().optional(),
          })
        ),
      }),
      execute: async () => {
        const org = getAuth<{ id: string }>();
        if (!org?.id) {
          throw new Error('MCP: organizacao ausente no contexto');
        }
        const escalations = await this._dmRepository.listEscalations(
          org.id,
          getProfileId()
        );
        return {
          conversations: escalations.map((c) => ({
            id: c.id,
            igSenderId: c.igSenderId,
            igSenderName: c.igSenderName ?? undefined,
            escalationReason: c.escalationReason ?? undefined,
            escalatedAt: c.escalatedAt
              ? c.escalatedAt.toISOString()
              : undefined,
          })),
        };
      },
    });
  }
}
