import { toPublicIntegration, toPublicPostPayload } from './public.post.mapper';

describe('public.post.mapper', () => {
  const integration = {
    id: 'int-1',
    name: 'IG',
    picture: 'p.png',
    providerIdentifier: 'instagram',
    disabled: false,
    profileId: 'prof-1',
    token: 'SEGREDO',
    refreshToken: 'SEGREDO2',
    internalId: 'ig-123',
    customInstanceDetails: 'x',
    additionalSettings: '[]',
    customer: { id: 'c1', name: 'Cliente', extra: 'nao' },
  };

  it('toPublicIntegration mantem so campos de exibicao', () => {
    const out = toPublicIntegration(integration as any) as any;
    expect(out).toEqual({
      id: 'int-1',
      name: 'IG',
      picture: 'p.png',
      providerIdentifier: 'instagram',
      disabled: false,
      profileId: 'prof-1',
      customer: { id: 'c1', name: 'Cliente' },
    });
    expect(out.token).toBeUndefined();
    expect(out.refreshToken).toBeUndefined();
    expect(toPublicIntegration(null)).toBeNull();
  });

  it('toPublicPostPayload sanitiza cada post e preserva o resto do payload', () => {
    const out = toPublicPostPayload({
      group: 'g',
      integrationPicture: 'p.png',
      posts: [{ id: 'p1', content: 'x', integration }, { id: 'p2', content: 'y', integration: null }],
    } as any) as any;
    expect(out.group).toBe('g');
    expect(out.posts[0].integration.token).toBeUndefined();
    expect(out.posts[0].integration.name).toBe('IG');
    expect(out.posts[1].integration).toBeNull();
  });
});
