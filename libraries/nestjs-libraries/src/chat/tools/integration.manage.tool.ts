import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { pricing } from '@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing';

/**
 * Canais — paridade com POST /public/v1/integrations/:id/enable|disable|settings
 * e GET /social/:provider. Canal sem perfil e compartilhado (403 para outro
 * perfil, via IntegrationService.getIntegrationInScope).
 */
const requireOrg = () => {
  const org = getAuth<{ id: string; subscription?: { totalChannels?: number } }>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org;
};

@Injectable()
export class IntegrationEnableTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationEnable';

  run() {
    return createTool({
      id: 'integrationEnable',
      description: 'Reativa um canal desativado do perfil atual.',
      inputSchema: z.object({ integrationId: z.string() }),
      outputSchema: z.object({ id: z.string(), disabled: z.boolean() }),
      execute: async (input: any) => {
        const org = requireOrg();
        const profileId = getProfileId();
        await this._integrationService.getIntegrationInScope(org.id, input.integrationId, profileId);
        const r: any = await this._integrationService.enableChannel(
          org.id,
          org.subscription?.totalChannels || pricing.FREE.channel,
          input.integrationId,
          profileId
        );
        return { id: r.id, disabled: !!r.disabled };
      },
    });
  }
}

@Injectable()
export class IntegrationDisableTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationDisable';

  run() {
    return createTool({
      id: 'integrationDisable',
      description:
        'Desativa um canal do perfil atual (posts agendados nele deixam de sair ate reativar).',
      inputSchema: z.object({ integrationId: z.string() }),
      outputSchema: z.object({ id: z.string(), disabled: z.boolean() }),
      execute: async (input: any) => {
        const org = requireOrg();
        await this._integrationService.getIntegrationInScope(org.id, input.integrationId, getProfileId());
        const r: any = await this._integrationService.disableChannel(org.id, input.integrationId);
        return { id: r.id, disabled: !!r.disabled };
      },
    });
  }
}

@Injectable()
export class IntegrationSettingsTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationSettings';

  run() {
    return createTool({
      id: 'integrationSettings',
      description:
        'Le (sem `settings`) ou grava (com `settings`) as configuracoes do provedor ' +
        'de um canal, no formato da tela: array de { title, value }.',
      inputSchema: z.object({
        integrationId: z.string(),
        settings: z
          .array(z.object({ title: z.string(), value: z.any() }))
          .optional()
          .describe('Se informado, substitui as configuracoes atuais'),
      }),
      outputSchema: z.object({ settings: z.array(z.any()) }),
      execute: async (input: any) => {
        const org = requireOrg();
        const integration: any = await this._integrationService.getIntegrationInScope(
          org.id,
          input.integrationId,
          getProfileId()
        );
        if (!input.settings) {
          return { settings: JSON.parse(integration.additionalSettings || '[]') };
        }
        await this._integrationService.updateProviderSettings(
          org.id,
          input.integrationId,
          JSON.stringify(input.settings)
        );
        return { settings: input.settings };
      },
    });
  }
}

@Injectable()
export class IntegrationAuthUrlTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationAuthUrl';

  run() {
    return createTool({
      id: 'integrationAuthUrl',
      description:
        'Gera a URL de OAuth para conectar um canal novo (instagram, youtube, ' +
        'linkedin, ...). O usuario precisa abrir a URL no navegador e dar o ' +
        'consentimento; o canal nasce no perfil atual.',
      inputSchema: z.object({
        provider: z.string().describe('Identificador do provedor (ex.: instagram, youtube)'),
      }),
      outputSchema: z.object({ url: z.string() }),
      execute: async (input: any) => {
        const org = requireOrg();
        return this._integrationService.createAuthUrl(org.id, input.provider, {
          profileId: getProfileId(),
        });
      },
    });
  }
}
