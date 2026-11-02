import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';
import { PostsRepository } from './posts.repository';

const build = (post: ReturnType<typeof createPrismaRepositoryMock>) =>
  new PostsRepository(post as any, {} as any, {} as any, {} as any, {} as any, {} as any);

describe('PostsRepository escopo do upsert (POST /posts)', () => {
  it('getGroupOwner busca o dono do grupo sem filtro de org (para detectar grupo alheio)', async () => {
    const post = createPrismaRepositoryMock('post');
    post.model.post.findFirst.mockResolvedValue({ organizationId: 'org-1', profileId: 'prof-1' } as any);

    const r = await build(post).getGroupOwner('g1');

    expect(post.model.post.findFirst).toHaveBeenCalledWith({
      where: { group: 'g1', deletedAt: null },
      select: { organizationId: true, profileId: true },
    });
    expect(r).toEqual({ organizationId: 'org-1', profileId: 'prof-1' });
  });
});
