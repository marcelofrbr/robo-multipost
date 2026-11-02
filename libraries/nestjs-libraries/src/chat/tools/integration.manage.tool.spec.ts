jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import {
  IntegrationEnableTool,
  IntegrationDisableTool,
  IntegrationSettingsTool,
  IntegrationAuthUrlTool,
} from './integration.manage.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1', subscription: { totalChannels: 5 } }, profileId: 'prof-1' };
const run = (tool: any, input: any, c: any = ctx) =>
  runWithContext(c, () => tool.run().execute(input, {} as any));

describe('integration manage tools', () => {
  it('integrationEnable/Disable validam o escopo', async () => {
    const s = createMock<IntegrationService>();
    s.getIntegrationInScope.mockResolvedValue({ id: 'int-1' } as any);
    s.enableChannel.mockResolvedValue({ id: 'int-1', disabled: false } as any);
    s.disableChannel.mockResolvedValue({ id: 'int-1', disabled: true } as any);

    expect(await run(new IntegrationEnableTool(s), { integrationId: 'int-1' })).toEqual({ id: 'int-1', disabled: false });
    expect(s.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
    expect(s.enableChannel).toHaveBeenCalledWith('org-1', 5, 'int-1', 'prof-1');

    expect(await run(new IntegrationDisableTool(s), { integrationId: 'int-1' })).toEqual({ id: 'int-1', disabled: true });
    expect(s.disableChannel).toHaveBeenCalledWith('org-1', 'int-1');
  });

  it('integrationSettings le e grava (array vira string JSON)', async () => {
    const s = createMock<IntegrationService>();
    s.getIntegrationInScope.mockResolvedValue({ id: 'int-1', additionalSettings: '[{"title":"Verified","value":true}]' } as any);
    s.updateProviderSettings.mockResolvedValue(undefined as any);

    expect(await run(new IntegrationSettingsTool(s), { integrationId: 'int-1' })).toEqual({
      settings: [{ title: 'Verified', value: true }],
    });

    const w = await run(new IntegrationSettingsTool(s), {
      integrationId: 'int-1',
      settings: [{ title: 'Verified', value: false }],
    });
    expect(s.updateProviderSettings).toHaveBeenCalledWith('org-1', 'int-1', '[{"title":"Verified","value":false}]');
    expect(w).toEqual({ settings: [{ title: 'Verified', value: false }] });
  });

  it('integrationAuthUrl delega ao service com o perfil do contexto (ou sem, com chave de org)', async () => {
    const s = createMock<IntegrationService>();
    s.createAuthUrl.mockResolvedValue({ url: 'https://meta/oauth' });

    expect(await run(new IntegrationAuthUrlTool(s), { provider: 'instagram' })).toEqual({ url: 'https://meta/oauth' });
    expect(s.createAuthUrl).toHaveBeenCalledWith('org-1', 'instagram', { profileId: 'prof-1' });

    await run(new IntegrationAuthUrlTool(s), { provider: 'youtube' }, { requestId: 'r', auth: { id: 'org-1' } });
    expect(s.createAuthUrl).toHaveBeenLastCalledWith('org-1', 'youtube', { profileId: undefined });
  });
});
