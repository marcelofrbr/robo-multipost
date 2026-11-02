// MediaService importa SubscriptionService que cascateia ate nostr-tools
// (ESM-only que quebra ts-jest). Mockamos topo-de-modulo as cadeias pesadas.
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class SubscriptionServiceMock {} })
);
jest.mock('@gitroom/nestjs-libraries/videos/video.manager', () => ({
  VideoManager: class VideoManagerMock {},
}));
jest.mock(
  '@gitroom/backend/services/auth/permissions/permission.exception.class',
  () => ({
    AuthorizationActions: { Create: 'Create', Delete: 'Delete', Update: 'Update' },
    Sections: { ADMIN: 'ADMIN', VIDEOS_PER_MONTH: 'VIDEOS_PER_MONTH' },
    SubscriptionException: class SubscriptionExceptionMock extends Error {
      constructor(public meta: any) {
        super('SubscriptionException');
      }
    },
  })
);

import { MediaService } from './media.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';

const buildService = (repo: ReturnType<typeof createMock<MediaRepository>>) =>
  new MediaService(
    repo,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any,
    null as any
  );

describe('MediaService.getMedia', () => {
  it('repassa org, pagina, perfil e periodo ao repositorio', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMedia.mockResolvedValue({ pages: 1, results: [] } as any);
    const service = buildService(repo);

    const result = await service.getMedia('org-1', 2, 'profile-9', {
      from: '2026-09-01T03:00:00.000Z',
      to: '2026-09-30T02:59:59.999Z',
    });

    expect(repo.getMedia).toHaveBeenCalledWith('org-1', 2, 'profile-9', {
      from: '2026-09-01T03:00:00.000Z',
      to: '2026-09-30T02:59:59.999Z',
    });
    expect(result).toEqual({ pages: 1, results: [] });
  });

  it('funciona sem periodo (compatibilidade)', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMedia.mockResolvedValue({ pages: 0, results: [] } as any);
    const service = buildService(repo);

    await service.getMedia('org-1', 1, undefined);

    expect(repo.getMedia).toHaveBeenCalledWith('org-1', 1, undefined, undefined);
  });

  it('rejeita com 400 quando from e posterior a to', async () => {
    const repo = createMock<MediaRepository>();
    const service = buildService(repo);

    await expect(
      service.getMedia('org-1', 1, undefined, {
        from: '2026-09-30T03:00:00.000Z',
        to: '2026-09-01T02:59:59.999Z',
      })
    ).rejects.toMatchObject({ status: 400 });
    expect(repo.getMedia).not.toHaveBeenCalled();
  });
});
