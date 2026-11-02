jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  ListPostsTool,
  GetPostTool,
  DeletePostTool,
  ChangePostDateTool,
  FindFreeSlotTool,
  PostStatisticsTool,
  CreatePostCommentTool,
} from './posts.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1' }, profileId: 'prof-1' };
const run = (tool: any, input: any) =>
  runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('posts tools', () => {
  it('listPosts repassa periodo e perfil do contexto e resume cada post', async () => {
    const posts = createMock<PostsService>();
    posts.getPosts.mockResolvedValue([
      {
        id: 'p1', content: 'x', publishDate: new Date('2026-09-20T13:00:00Z'), group: 'g', state: 'QUEUE',
        integration: { id: 'i', name: 'IG', providerIdentifier: 'instagram' },
      },
    ] as any);

    const r = await run(new ListPostsTool(posts), {
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2026-09-30T00:00:00.000Z',
    });

    expect(posts.getPosts).toHaveBeenCalledWith(
      'org-1',
      { startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-30T00:00:00.000Z' },
      'prof-1'
    );
    expect(r.posts[0]).toMatchObject({ id: 'p1', group: 'g', integrationName: 'IG', provider: 'instagram' });
  });

  it('getPost valida o escopo e devolve o grupo sem tokens do canal', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.getPost.mockResolvedValue({
      group: 'g',
      posts: [{ id: 'p1', content: 'x', integration: { id: 'i', name: 'IG', token: 'SEGREDO' } }],
    } as any);

    const r = await run(new GetPostTool(posts), { postId: 'p1' });

    expect(posts.getPostInScope).toHaveBeenCalledWith('org-1', 'p1', 'prof-1');
    expect(r.group).toBe('g');
    expect(JSON.stringify(r)).not.toContain('SEGREDO');
  });

  it('deletePost apaga o grupo do post no escopo', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1', group: 'g1' } as any);
    posts.deletePost.mockResolvedValue({ id: 'p1' } as any);

    expect(await run(new DeletePostTool(posts), { postId: 'p1' })).toEqual({ deleted: true, group: 'g1' });
    expect(posts.deletePost).toHaveBeenCalledWith('org-1', 'g1', 'prof-1');
  });

  it('changePostDate valida o escopo e usa action schedule por padrao', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.changeDate.mockResolvedValue({ id: 'p1', publishDate: new Date('2026-09-21T13:00:00Z') } as any);

    const r = await run(new ChangePostDateTool(posts), { postId: 'p1', date: '2026-09-21T13:00:00.000Z' });

    expect(posts.changeDate).toHaveBeenCalledWith('org-1', 'p1', '2026-09-21T13:00:00.000Z', 'schedule', 'prof-1');
    expect(r).toEqual({ id: 'p1', publishDate: '2026-09-21T13:00:00.000Z' });
  });

  it('findFreeSlot valida o escopo do canal e devolve a data livre', async () => {
    const posts = createMock<PostsService>();
    const integrations = createMock<IntegrationService>();
    integrations.getIntegrationInScope.mockResolvedValue({ id: 'int-1' } as any);
    posts.findFreeDateTime.mockResolvedValue('2026-09-22T12:00:00.000Z' as any);

    expect(await run(new FindFreeSlotTool(posts, integrations), { integrationId: 'int-1' })).toEqual({
      date: '2026-09-22T12:00:00.000Z',
    });
    expect(integrations.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
    expect(posts.findFreeDateTime).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
  });

  it('postStatistics valida o escopo e devolve os cliques', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.getStatistics.mockResolvedValue({ clicks: [{ short: 'a', original: 'b', clicks: '3' }] } as any);

    const r = await run(new PostStatisticsTool(posts), { postId: 'p1' });
    expect(r.clicks).toHaveLength(1);
  });

  it('createPostComment usa o dono da org como autor', async () => {
    const posts = createMock<PostsService>();
    const orgs = createMock<OrganizationService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    orgs.getOwnerUserId.mockResolvedValue('u-owner');
    posts.createComment.mockResolvedValue({ id: 'c1' } as any);

    expect(await run(new CreatePostCommentTool(posts, orgs), { postId: 'p1', comment: 'ok' })).toEqual({ id: 'c1' });
    expect(posts.createComment).toHaveBeenCalledWith('org-1', 'u-owner', 'p1', 'ok');
  });

  it('sem organizacao no contexto, lanca erro claro', async () => {
    const posts = createMock<PostsService>();
    await expect(
      new PostStatisticsTool(posts).run().execute({ postId: 'p' } as any, {} as any)
    ).rejects.toThrow('organizacao ausente');
  });
});
