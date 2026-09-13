jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationAnalyticsTool, PostAnalyticsTool } from './analytics.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1', name: 'Org' }, profileId: 'prof-1' };
const run = (tool: any, input: any) =>
  runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('analytics tools', () => {
  it('integrationAnalytics valida o escopo do canal e repassa a org inteira + dias', async () => {
    const integrations = createMock<IntegrationService>();
    integrations.getIntegrationInScope.mockResolvedValue({ id: 'int-1' } as any);
    integrations.checkAnalytics.mockResolvedValue([{ label: 'Seguidores', data: [] }] as any);

    const r = await run(new IntegrationAnalyticsTool(integrations), { integrationId: 'int-1', days: '7' });

    expect(integrations.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
    expect(integrations.checkAnalytics).toHaveBeenCalledWith(ctx.auth, 'int-1', '7');
    expect(r.metrics).toHaveLength(1);
  });

  it('postAnalytics valida o escopo do post', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.checkPostAnalytics.mockResolvedValue([{ label: 'Curtidas', data: [] }] as any);

    const r = await run(new PostAnalyticsTool(posts), { postId: 'p1', days: '30' });

    expect(posts.checkPostAnalytics).toHaveBeenCalledWith('org-1', 'p1', 30);
    expect(r.metrics).toHaveLength(1);
  });
});
