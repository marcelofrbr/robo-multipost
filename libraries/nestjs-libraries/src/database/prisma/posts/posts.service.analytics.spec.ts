jest.mock(
  '@gitroom/nestjs-libraries/integrations/integration.manager',
  () => ({ IntegrationManager: class IntegrationManagerMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/integrations/refresh.integration.service',
  () => ({ RefreshIntegrationService: class RefreshIntegrationServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class MediaServiceMock {} })
);
jest.mock(
  '@gitroom/nestjs-libraries/short-linking/short.link.service',
  () => ({ ShortLinkService: class ShortLinkServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { set: jest.fn(), get: jest.fn() },
}));

import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { RefreshToken } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('PostsService.checkPostAnalytics', () => {
  const setup = (postAnalytics: jest.Mock, profileId: string | null = null) => {
    const repository = createMock<PostsRepository>();
    repository.getPostById.mockResolvedValue({
      id: 'post-1',
      releaseId: 'media-1',
      profileId,
      integration: {
        internalId: 'ig-1',
        token: 'TOK',
        providerIdentifier: 'instagram',
        tokenExpiration: new Date(Date.now() + 86400000),
      },
    } as any);
    const manager = { getSocialIntegration: () => ({ postAnalytics }) };
    const refresh = {
      refresh: jest.fn().mockResolvedValue({ accessToken: 'NEW' }),
    };
    const service = new PostsService(
      repository as any,
      manager as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      refresh as any,
      null as any
    );
    return { service, refresh };
  };

  beforeEach(() => {
    (ioRedis.set as jest.Mock).mockReset();
  });

  it('deve devolver as metricas e guardar em cache com chave versionada', async () => {
    const metrics = [{ label: 'Views', data: [] as any[], percentageChange: 0 }];
    const { service } = setup(jest.fn().mockResolvedValue(metrics));

    await expect(service.checkPostAnalytics('org-1', 'post-1', 7)).resolves.toEqual(metrics);
    expect((ioRedis.set as jest.Mock).mock.calls[0][0]).toBe(
      'integration:v2:org-1:post-1:7'
    );
  });

  it('nao deve guardar em cache resposta vazia', async () => {
    const { service } = setup(jest.fn().mockResolvedValue([]));

    await service.checkPostAnalytics('org-1', 'post-1', 7);

    expect(ioRedis.set).not.toHaveBeenCalled();
  });

  it('deve tentar o refresh de token uma unica vez, sem laco', async () => {
    const postAnalytics = jest
      .fn()
      .mockRejectedValue(new RefreshToken('x', '{}', {} as any));
    const { service, refresh } = setup(postAnalytics);

    await expect(service.checkPostAnalytics('org-1', 'post-1', 7)).resolves.toEqual([]);
    expect(postAnalytics).toHaveBeenCalledTimes(2);
    expect(refresh.refresh).toHaveBeenCalledTimes(1);
  });

  it('deve devolver vazio para post de outro perfil sem chamar a rede', async () => {
    const postAnalytics = jest.fn();
    const { service } = setup(postAnalytics, 'prof-outro');

    await expect(
      service.checkPostAnalytics('org-1', 'post-1', 7, false, 'prof-1')
    ).resolves.toEqual([]);
    expect(postAnalytics).not.toHaveBeenCalled();
  });
});
