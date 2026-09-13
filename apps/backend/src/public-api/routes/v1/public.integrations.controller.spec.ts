import { HttpException, NotFoundException } from '@nestjs/common';

jest.mock('./public.integrations.controller', () => {
  const actual = jest.requireActual('./public.integrations.controller');
  return actual;
}, { virtual: false });

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: jest.fn(),
  socialIntegrationList: [],
}));

jest.mock('nostr-tools', () => ({}));

import { PublicIntegrationsController } from './public.integrations.controller';

// Mock do PublicApiScopeService com a mesma regra do service real (403 para
// chave de perfil divergente; 404 para chave de org com perfil desconhecido).
const makeScope = (profileKnown = true) => ({
  resolveProfileId: jest.fn(
    async (_orgId: string, pub?: string, req?: string) => {
      if (pub && req && req !== pub) {
        throw new HttpException(
          { msg: 'Profile key cannot access another profile' },
          403
        );
      }
      if (!pub && req && !profileKnown) {
        throw new NotFoundException('Profile not found');
      }
      return pub ?? req;
    }
  ),
});

const makeIntegrationService = () => ({
  getIntegrationsList: jest.fn().mockResolvedValue([]),
});

describe('PublicIntegrationsController - listIntegration', () => {
  let controller: PublicIntegrationsController;
  let integrationService: ReturnType<typeof makeIntegrationService>;

  beforeEach(() => {
    integrationService = makeIntegrationService();
    controller = new PublicIntegrationsController(
      integrationService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      makeScope() as any
    );
  });

  it('chave de perfil sem profileId: usa publicApiProfileId como filtro', async () => {
    await controller.listIntegration({ id: 'org-1' } as any, 'prof-1', undefined);

    expect(integrationService.getIntegrationsList).toHaveBeenCalledWith('org-1', 'prof-1');
  });

  it('chave de perfil com profileId igual: passa (200)', async () => {
    await controller.listIntegration({ id: 'org-1' } as any, 'prof-1', 'prof-1');

    expect(integrationService.getIntegrationsList).toHaveBeenCalledWith('org-1', 'prof-1');
  });

  it('chave de perfil com profileId diferente: lanca 403', async () => {
    await expect(
      controller.listIntegration({ id: 'org-1' } as any, 'prof-1', 'prof-OUTRO')
    ).rejects.toBeInstanceOf(HttpException);
    expect(integrationService.getIntegrationsList).not.toHaveBeenCalled();
  });

  it('chave de org sem profileId: retorna tudo (comportamento atual)', async () => {
    await controller.listIntegration({ id: 'org-1' } as any, undefined, undefined);

    expect(integrationService.getIntegrationsList).toHaveBeenCalledWith('org-1', undefined);
  });
});

describe('PublicIntegrationsController - uploadSimple', () => {
  let controller: PublicIntegrationsController;
  let mediaService: { saveFile: jest.Mock };

  beforeEach(() => {
    mediaService = {
      saveFile: jest
        .fn()
        .mockResolvedValue({ id: 'media-1', path: 'https://r2/slide.png' }),
    };
    controller = new PublicIntegrationsController(
      {} as any,
      {} as any,
      mediaService as any,
      {} as any,
      {} as any,
      {} as any,
      makeScope() as any
    );
    (controller as any).storage = {
      uploadFile: jest.fn().mockResolvedValue({
        originalname: 'slide.png',
        path: 'https://r2/slide.png',
      }),
    };
  });

  it('vincula a midia ao perfil e retorna id e path', async () => {
    const result = await controller.uploadSimple(
      { id: 'org-1' } as any,
      { originalname: 'slide.png' } as any,
      'profile-1'
    );

    expect(mediaService.saveFile).toHaveBeenCalledWith(
      'org-1',
      'slide.png',
      'https://r2/slide.png',
      undefined,
      'profile-1'
    );
    expect(result).toEqual({ id: 'media-1', path: 'https://r2/slide.png' });
  });
});

describe('PublicIntegrationsController - createPost', () => {
  let controller: PublicIntegrationsController;
  let postsService: {
    mapTypeToPost: jest.Mock;
    createPost: jest.Mock;
    assertPostBodyInScope: jest.Mock;
  };

  beforeEach(() => {
    postsService = {
      mapTypeToPost: jest.fn().mockImplementation(async (raw) => ({ ...raw })),
      createPost: jest.fn().mockResolvedValue([{ postId: 'p1' }]),
      assertPostBodyInScope: jest.fn().mockResolvedValue(undefined),
    };
    controller = new PublicIntegrationsController(
      {} as any,
      postsService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      makeScope() as any
    );
  });

  it('chave de perfil: carimba o post com o profileId (fica visivel no dashboard)', async () => {
    const raw = { type: 'schedule', date: '2026-06-06T12:00:00.000Z', posts: [] as any[] };

    await controller.createPost({ id: 'org-1' } as any, raw as any, 'profile-1');

    expect(postsService.createPost).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ type: 'schedule' }),
      'profile-1'
    );
  });

  it('chave de org (sem profileId): mantem comportamento, profileId undefined', async () => {
    const raw = { type: 'schedule', date: '2026-06-06T12:00:00.000Z', posts: [] as any[] };

    await controller.createPost({ id: 'org-1' } as any, raw as any, undefined);

    expect(postsService.createPost).toHaveBeenCalledWith(
      'org-1',
      expect.any(Object),
      undefined
    );
  });
});

describe('PublicIntegrationsController - uploadsFromUrl', () => {
  let controller: PublicIntegrationsController;
  let mediaService: { uploadFromUrl: jest.Mock };

  beforeEach(() => {
    mediaService = {
      uploadFromUrl: jest
        .fn()
        .mockResolvedValue({ id: 'media-2', path: 'https://r2/x.jpg' }),
    };
    controller = new PublicIntegrationsController(
      {} as any,
      {} as any,
      mediaService as any,
      {} as any,
      {} as any,
      {} as any,
      makeScope() as any
    );
  });

  it('reusa MediaService.uploadFromUrl com profileId e retorna id e path', async () => {
    const result = await controller.uploadsFromUrl(
      { id: 'org-1' } as any,
      { url: 'https://ext/x.jpg' } as any,
      'profile-1'
    );

    expect(mediaService.uploadFromUrl).toHaveBeenCalledWith(
      'org-1',
      'https://ext/x.jpg',
      undefined,
      'profile-1'
    );
    expect(result).toEqual({ id: 'media-2', path: 'https://r2/x.jpg' });
  });
});

describe('PublicIntegrationsController - canais e escopo de perfil em posts (entrega 2)', () => {
  const org = { id: 'org-1' } as any;
  let controller: PublicIntegrationsController;
  let integrationService: {
    getIntegrationInScope: jest.Mock;
    enableChannel: jest.Mock;
    disableChannel: jest.Mock;
    updateProviderSettings: jest.Mock;
  };
  let postsService: {
    getPosts: jest.Mock;
    getPostInScope: jest.Mock;
    getGroupInScope: jest.Mock;
    deletePost: jest.Mock;
  };

  beforeEach(() => {
    integrationService = {
      getIntegrationInScope: jest.fn(),
      enableChannel: jest.fn(),
      disableChannel: jest.fn(),
      updateProviderSettings: jest.fn(),
    };
    postsService = {
      getPosts: jest.fn(),
      getPostInScope: jest.fn(),
      getGroupInScope: jest.fn(),
      deletePost: jest.fn(),
    };
    controller = new PublicIntegrationsController(
      integrationService as any,
      postsService as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      makeScope() as any
    );
  });

  it('POST /integrations/:id/enable valida o escopo e habilita com o limite do plano', async () => {
    integrationService.getIntegrationInScope.mockResolvedValue({ id: 'int-1' });
    integrationService.enableChannel.mockResolvedValue({ id: 'int-1', disabled: false });

    await controller.enableChannel(org, 'prof-1', 'int-1', undefined);

    expect(integrationService.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
    expect(integrationService.enableChannel).toHaveBeenCalledWith('org-1', expect.any(Number), 'int-1', 'prof-1');
  });

  it('POST /integrations/:id/disable valida o escopo e desabilita', async () => {
    integrationService.getIntegrationInScope.mockResolvedValue({ id: 'int-1' });
    integrationService.disableChannel.mockResolvedValue({ id: 'int-1', disabled: true });

    await controller.disableChannel(org, undefined, 'int-1', 'prof-2');

    expect(integrationService.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-2');
    expect(integrationService.disableChannel).toHaveBeenCalledWith('org-1', 'int-1');
  });

  it('POST /integrations/:id/settings grava a string JSON e chave de perfil divergente -> 403', async () => {
    integrationService.getIntegrationInScope.mockResolvedValue({ id: 'int-1' });
    integrationService.updateProviderSettings.mockResolvedValue(undefined);

    const r = await controller.updateProviderSettings(org, 'prof-1', 'int-1', undefined, {
      additionalSettings: '[{"title":"Verified","value":true}]',
    } as any);
    expect(integrationService.updateProviderSettings).toHaveBeenCalledWith(
      'org-1',
      'int-1',
      '[{"title":"Verified","value":true}]'
    );
    expect(r).toEqual({ ok: true });

    await expect(
      controller.updateProviderSettings(org, 'prof-1', 'int-1', 'prof-9', { additionalSettings: '[]' } as any)
    ).rejects.toMatchObject({ status: 403 });
    expect(integrationService.getIntegrationInScope).toHaveBeenCalledTimes(1);
  });

  it('rotas pre-existentes por id passam a validar o escopo (canal e post)', async () => {
    integrationService.getIntegrationInScope.mockResolvedValue({ id: 'int-1', additionalSettings: '[]' });
    (integrationService as any).getPostsForChannel = jest.fn().mockResolvedValue([]);
    (integrationService as any).deleteChannel = jest.fn().mockResolvedValue({ id: 'int-1' });
    (postsService as any).findFreeDateTime = jest.fn().mockResolvedValue('2026-09-22T12:00:00.000Z');
    postsService.getPostInScope.mockResolvedValue({ id: 'p1' });
    (postsService as any).getMissingContent = jest.fn().mockResolvedValue([]);
    (postsService as any).updateReleaseId = jest.fn().mockResolvedValue({ id: 'p1' });

    await controller.findSlotIntegration(org, 'prof-1', 'int-1');
    await controller.deleteChannel(org, 'prof-1', 'int-1');
    expect(integrationService.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
    expect(integrationService.getIntegrationInScope).toHaveBeenCalledTimes(2);

    await controller.getMissingContent(org, 'prof-1', 'p1');
    await controller.updateReleaseId(org, 'prof-1', 'p1', 'rel-1');
    expect(postsService.getPostInScope).toHaveBeenCalledWith('org-1', 'p1', 'prof-1');
    expect(postsService.getPostInScope).toHaveBeenCalledTimes(2);
  });

  it('POST /posts valida ids/grupos do corpo no escopo antes de criar (upsert)', async () => {
    (postsService as any).assertPostBodyInScope = jest.fn().mockResolvedValue(undefined);
    (postsService as any).mapTypeToPost = jest.fn().mockResolvedValue({ type: 'schedule', posts: [] });
    (postsService as any).createPost = jest.fn().mockResolvedValue([]);

    await controller.createPost(org, { type: 'schedule', posts: [] } as any, 'prof-1');

    expect((postsService as any).assertPostBodyInScope).toHaveBeenCalledWith(
      'org-1',
      expect.objectContaining({ type: 'schedule' }),
      'prof-1'
    );
    expect((postsService as any).createPost).toHaveBeenCalled();
  });

  it('GET /social/:provider delega a geracao da URL ao IntegrationService com o perfil resolvido', async () => {
    (integrationService as any).createAuthUrl = jest.fn().mockResolvedValue({ url: 'https://meta/oauth' });

    const r = await controller.getIntegrationUrl('instagram', undefined as any, org, 'prof-1', undefined);

    expect(r).toEqual({ url: 'https://meta/oauth' });
    expect((integrationService as any).createAuthUrl).toHaveBeenCalledWith('org-1', 'instagram', {
      profileId: 'prof-1',
      refresh: undefined,
    });

    await expect(
      controller.getIntegrationUrl('instagram', undefined as any, org, 'prof-1', 'prof-9')
    ).rejects.toMatchObject({ status: 403 });
  });

  it('GET /posts filtra pelo perfil da chave (ou ?profileId com chave de org)', async () => {
    postsService.getPosts.mockResolvedValue([]);

    await controller.getPosts(org, 'prof-1', { startDate: 'a', endDate: 'b' } as any);
    expect(postsService.getPosts).toHaveBeenCalledWith('org-1', expect.objectContaining({ startDate: 'a' }), 'prof-1');

    await controller.getPosts(org, undefined, { startDate: 'a', endDate: 'b', profileId: 'prof-2' } as any);
    expect(postsService.getPosts).toHaveBeenLastCalledWith('org-1', expect.anything(), 'prof-2');

    await expect(
      controller.getPosts(org, 'prof-1', { startDate: 'a', endDate: 'b', profileId: 'prof-9' } as any)
    ).rejects.toMatchObject({ status: 403 });
  });

  it('DELETE /posts/:id e /posts/group/:group apagam so no perfil da chave', async () => {
    postsService.getPostInScope.mockResolvedValue({ id: 'p1', group: 'g1' });
    postsService.deletePost.mockResolvedValue({ id: 'p1' });
    await controller.deletePost(org, 'prof-1', 'p1');
    expect(postsService.getPostInScope).toHaveBeenCalledWith('org-1', 'p1', 'prof-1');
    expect(postsService.deletePost).toHaveBeenCalledWith('org-1', 'g1', 'prof-1');

    postsService.getGroupInScope.mockResolvedValue([{ id: 'p1' }]);
    await controller.deletePostByGroup(org, 'prof-1', 'g1');
    expect(postsService.getGroupInScope).toHaveBeenCalledWith('org-1', 'g1', 'prof-1');
    expect(postsService.deletePost).toHaveBeenLastCalledWith('org-1', 'g1', 'prof-1');
  });
});
