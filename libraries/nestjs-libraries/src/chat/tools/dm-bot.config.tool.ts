import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { Injectable } from '@nestjs/common';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import {
  getAuth,
  getProfileId,
} from '@gitroom/nestjs-libraries/chat/async.storage';

/**
 * Liga/desliga o bot de atendimento por DM (trigger 'direct_message') de uma
 * conta Instagram. Cria o Flow se ainda nao existir ou reativa/pausa um
 * existente, atualizando tambem a mensagem de fallback (enviada quando o bot
 * nao consegue responder).
 */
@Injectable()
export class DmBotConfigTool implements AgentToolInterface {
  constructor(private _flowsService: FlowsService) {}
  name = 'configureDmBot';

  run() {
    return createTool({
      id: 'configureDmBot',
      description:
        'Liga ou desliga o bot de atendimento por DM (mensagens diretas) de ' +
        'uma conta Instagram. Quando ligado, o bot responde automaticamente as ' +
        'DMs recebidas. Use integrationList para o integrationId. A ' +
        'fallbackMessage e enviada quando o bot nao consegue responder.',
      inputSchema: z.object({
        integrationId: z
          .string()
          .describe('Id da integracao Instagram (de integrationList)'),
        enabled: z
          .boolean()
          .describe('true liga o bot de DM, false desliga (pausa)'),
        fallbackMessage: z
          .string()
          .optional()
          .describe(
            'Mensagem enviada quando o bot nao consegue responder (opcional)'
          ),
      }),
      outputSchema: z.object({
        flowId: z.string(),
        status: z.string(),
      }),
      execute: async (input: any) => {
        const org = getAuth<{ id: string }>();
        if (!org?.id) {
          throw new Error('MCP: organizacao ausente no contexto');
        }
        const result =
          await this._flowsService.createOrUpdateDirectMessageBotFlow(
            org.id,
            input.integrationId,
            {
              enabled: input.enabled,
              fallbackMessage: input.fallbackMessage,
            },
            getProfileId()
          );
        return { flowId: result.flowId, status: result.status };
      },
    });
  }
}
