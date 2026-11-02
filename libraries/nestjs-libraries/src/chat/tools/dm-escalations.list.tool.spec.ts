jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { DmFlowService } from '@gitroom/nestjs-libraries/database/prisma/dm/dm-flow.service';
import { ResolveDmEscalationTool } from './dm-escalations.list.tool';

describe('ResolveDmEscalationTool', () => {
  it('resolve a conversa no escopo do perfil via DmFlowService', async () => {
    const dm = createMock<DmFlowService>();
    dm.resolveConversation.mockResolvedValue({ id: 'c1', status: 'CLOSED' } as any);

    const r = await runWithContext({ requestId: 'r', auth: { id: 'org-1' }, profileId: 'prof-1' }, () =>
      new ResolveDmEscalationTool(dm).run().execute({ conversationId: 'c1' } as any, {} as any)
    );

    expect(dm.resolveConversation).toHaveBeenCalledWith('org-1', 'c1', 'prof-1');
    expect(r).toEqual({ id: 'c1', status: 'CLOSED' });
  });
});
