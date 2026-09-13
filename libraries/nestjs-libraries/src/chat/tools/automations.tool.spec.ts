jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { FlowsService } from '@gitroom/nestjs-libraries/database/prisma/flows/flows.service';
import {
  ListInstagramPostsForAutomationTool,
  CreateCommentAutomationTool,
  GetAutomationTool,
  UpdateAutomationTool,
  DeleteAutomationTool,
  AutomationExecutionsTool,
  WebhookStatusTool,
} from './automations.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1' }, profileId: 'prof-1' };
const run = (tool: any, input: any) =>
  runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('automations tools (paridade com /public/v1/flows)', () => {
  it('listInstagramPostsForAutomation passa o perfil do contexto ao service (escopo do canal)', async () => {
    const flows = createMock<FlowsService>();
    flows.getInstagramPostsByIntegration.mockResolvedValue({ posts: [], nextCursor: undefined } as any);

    await run(new ListInstagramPostsForAutomationTool(flows), { integrationId: 'int-1' });

    expect(flows.getInstagramPostsByIntegration).toHaveBeenCalledWith('org-1', 'int-1', undefined, 25, 'prof-1');
  });

  it('createCommentAutomation aceita o contrato completo (story_reply, storyIds, follow-gate em 2 passos)', async () => {
    const flows = createMock<FlowsService>();
    flows.quickCreateFlow.mockResolvedValue({ id: 'flow-1' } as any);

    await run(new CreateCommentAutomationTool(flows), {
      name: 'Story',
      integrationId: 'int-1',
      triggerType: 'story_reply',
      postMode: 'specific',
      storyIds: ['s1'],
      matchMode: 'exact',
      matchReactions: true,
      openingDmMessage: 'Segue a gente',
      openingDmButtonText: 'Ja sigo',
      maxGateAttempts: 2,
    });

    expect(flows.quickCreateFlow).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({
        triggerType: 'story_reply',
        storyIds: ['s1'],
        matchMode: 'exact',
        matchReactions: true,
        openingDmMessage: 'Segue a gente',
        openingDmButtonText: 'Ja sigo',
        maxGateAttempts: 2,
      }),
      'prof-1'
    );
  });

  it('getAutomation devolve o flow do perfil ou 404', async () => {
    const flows = createMock<FlowsService>();
    flows.getFlow.mockResolvedValueOnce({ id: 'flow-1', name: 'x' } as any);
    expect(await run(new GetAutomationTool(flows), { flowId: 'flow-1' })).toEqual({ flow: { id: 'flow-1', name: 'x' } });
    expect(flows.getFlow).toHaveBeenCalledWith('org-1', 'flow-1', 'prof-1');

    flows.getFlow.mockResolvedValueOnce(null as any);
    await expect(run(new GetAutomationTool(flows), { flowId: 'x' })).rejects.toMatchObject({ status: 404 });
  });

  it('updateAutomation valida o escopo e reescreve o flow com o contrato completo', async () => {
    const flows = createMock<FlowsService>();
    flows.getFlow.mockResolvedValue({ id: 'flow-1' } as any);
    flows.quickUpdateFlow.mockResolvedValue({ id: 'flow-1', status: 'ACTIVE' } as any);

    const r = await run(new UpdateAutomationTool(flows), {
      flowId: 'flow-1',
      name: 'Novo',
      integrationId: 'int-1',
      postMode: 'all',
      dmMessage: 'oi',
      handoffToBot: true,
    });

    expect(flows.quickUpdateFlow).toHaveBeenCalledWith(
      'org-1',
      'flow-1',
      expect.objectContaining({ name: 'Novo', integrationId: 'int-1', postMode: 'all', dmMessage: 'oi', handoffToBot: true }),
      'prof-1'
    );
    expect(r).toEqual({ flow: { id: 'flow-1', status: 'ACTIVE' } });
  });

  it('deleteAutomation valida o escopo e exclui', async () => {
    const flows = createMock<FlowsService>();
    flows.getFlow.mockResolvedValue({ id: 'flow-1' } as any);
    flows.deleteFlow.mockResolvedValue({ id: 'flow-1' } as any);

    expect(await run(new DeleteAutomationTool(flows), { flowId: 'flow-1' })).toEqual({ deleted: true });
    expect(flows.deleteFlow).toHaveBeenCalledWith('org-1', 'flow-1', 'prof-1');
  });

  it('automationExecutions valida o escopo e limita page/limit', async () => {
    const flows = createMock<FlowsService>();
    flows.getFlow.mockResolvedValue({ id: 'flow-1' } as any);
    flows.getExecutions.mockResolvedValue({ items: [], total: 0 } as any);

    await run(new AutomationExecutionsTool(flows), { flowId: 'flow-1', page: 0, limit: 999 });

    expect(flows.getExecutions).toHaveBeenCalledWith('org-1', 'flow-1', 1, 100);
  });

  it('webhookStatus valida o escopo do canal e devolve o diagnostico', async () => {
    const flows = createMock<FlowsService>();
    flows.assertIntegrationAccess.mockResolvedValue({ id: 'int-1' } as any);
    flows.checkIntegrationWebhook.mockResolvedValue({ ok: true } as any);

    expect(await run(new WebhookStatusTool(flows), { integrationId: 'int-1' })).toEqual({ ok: true });
    expect(flows.assertIntegrationAccess).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
  });
});
