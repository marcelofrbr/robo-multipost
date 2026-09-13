jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({}));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import { PublicPostsController } from './public.posts.controller';

const makePostsService = () => ({
  getPostInScope: jest.fn(),
  getGroupInScope: jest.fn(),
  getPost: jest.fn(),
  getPostsByGroup: jest.fn(),
  getStatistics: jest.fn(),
  changeDate: jest.fn(),
  createComment: jest.fn(),
});
const makeOrgService = () => ({ getOwnerUserId: jest.fn() });
const org = { id: 'org-1' } as any;

describe('PublicPostsController', () => {
  let controller: PublicPostsController;
  let posts: ReturnType<typeof makePostsService>;
  let orgs: ReturnType<typeof makeOrgService>;

  beforeEach(() => {
    posts = makePostsService();
    orgs = makeOrgService();
    controller = new PublicPostsController(posts as any, orgs as any);
  });

  it('chave por-perfil: lanca 403 ao pedir outro profileId', async () => {
    await expect(controller.getPost(org, 'prof-1', 'p1', 'prof-9')).rejects.toMatchObject({ status: 403 });
    expect(posts.getPostInScope).not.toHaveBeenCalled();
  });

  it('GET /posts/:id valida o escopo e devolve o post completo', async () => {
    posts.getPostInScope.mockResolvedValue({ id: 'p1' });
    posts.getPost.mockResolvedValue({ group: 'g1', posts: [{ id: 'p1' }] });

    const r = await controller.getPost(org, 'prof-1', 'p1', undefined);

    expect(posts.getPostInScope).toHaveBeenCalledWith('org-1', 'p1', 'prof-1');
    expect(posts.getPost).toHaveBeenCalledWith('org-1', 'p1');
    expect(r).toEqual({ group: 'g1', posts: [{ id: 'p1' }] });
  });

  it('GET /posts/:id propaga 404 do escopo sem chamar getPost', async () => {
    posts.getPostInScope.mockRejectedValue(Object.assign(new Error('nf'), { status: 404 }));
    await expect(controller.getPost(org, 'prof-1', 'p-x', undefined)).rejects.toMatchObject({ status: 404 });
    expect(posts.getPost).not.toHaveBeenCalled();
  });

  it('GET /posts/group/:group valida o grupo no escopo e devolve getPostsByGroup', async () => {
    posts.getGroupInScope.mockResolvedValue([{ id: 'p1' }]);
    posts.getPostsByGroup.mockResolvedValue({ group: 'g1', posts: [] });

    await controller.getPostsByGroup(org, undefined, 'g1', 'prof-2');

    expect(posts.getGroupInScope).toHaveBeenCalledWith('org-1', 'g1', 'prof-2');
    expect(posts.getPostsByGroup).toHaveBeenCalledWith('org-1', 'g1');
  });

  it('GET /posts/:id/statistics valida o escopo e devolve os cliques', async () => {
    posts.getPostInScope.mockResolvedValue({ id: 'p1' });
    posts.getStatistics.mockResolvedValue({ clicks: [] });

    expect(await controller.getStatistics(org, 'prof-1', 'p1', undefined)).toEqual({ clicks: [] });
    expect(posts.getStatistics).toHaveBeenCalledWith('org-1', 'p1');
  });

  it('PUT /posts/:id/date valida o escopo e reagenda com action padrao schedule', async () => {
    posts.getPostInScope.mockResolvedValue({ id: 'p1' });
    posts.changeDate.mockResolvedValue({ id: 'p1' });

    await controller.changeDate(org, 'prof-1', 'p1', undefined, { date: '2026-09-20T13:00:00.000Z' });
    expect(posts.changeDate).toHaveBeenCalledWith('org-1', 'p1', '2026-09-20T13:00:00.000Z', 'schedule', 'prof-1');

    await controller.changeDate(org, undefined, 'p1', 'prof-2', { date: '2026-09-20T13:00:00.000Z', action: 'update' });
    expect(posts.changeDate).toHaveBeenLastCalledWith('org-1', 'p1', '2026-09-20T13:00:00.000Z', 'update', 'prof-2');
  });

  it('POST /posts/:id/comments usa o dono da org como autor', async () => {
    posts.getPostInScope.mockResolvedValue({ id: 'p1' });
    orgs.getOwnerUserId.mockResolvedValue('u-owner');
    posts.createComment.mockResolvedValue({ id: 'c1' });

    const r = await controller.createComment(org, 'prof-1', 'p1', undefined, { comment: 'revisar CTA' });

    expect(orgs.getOwnerUserId).toHaveBeenCalledWith('org-1');
    expect(posts.createComment).toHaveBeenCalledWith('org-1', 'u-owner', 'p1', 'revisar CTA');
    expect(r).toEqual({ id: 'c1' });
  });
});
