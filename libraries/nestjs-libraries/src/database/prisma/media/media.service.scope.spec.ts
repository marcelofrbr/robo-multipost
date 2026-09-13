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

describe('MediaService.getMediaInScope', () => {
  it('devolve a midia quando esta na org (e no perfil ou compartilhada)', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMediaForOrg.mockResolvedValue({ id: 'm1', profileId: null } as any);

    await expect(
      buildService(repo).getMediaInScope('org-1', 'm1', 'prof-1')
    ).resolves.toMatchObject({ id: 'm1' });
    expect(repo.getMediaForOrg).toHaveBeenCalledWith('org-1', 'm1');
  });

  it('lanca 404 quando nao existe na org', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMediaForOrg.mockResolvedValue(null as any);

    await expect(
      buildService(repo).getMediaInScope('org-1', 'm-x')
    ).rejects.toMatchObject({ status: 404 });
  });

  it('lanca 403 quando a midia e de outro perfil', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMediaForOrg.mockResolvedValue({ id: 'm1', profileId: 'prof-outro' } as any);

    await expect(
      buildService(repo).getMediaInScope('org-1', 'm1', 'prof-1')
    ).rejects.toMatchObject({ status: 403 });
  });
});

describe('MediaService.saveMediaInformation', () => {
  it('repassa o profileId ao repositorio', async () => {
    const repo = createMock<MediaRepository>();
    repo.saveMediaInformation.mockResolvedValue({ id: 'm1' } as any);
    const body = { id: 'm1', alt: 'x' } as any;

    await buildService(repo).saveMediaInformation('org-1', body, 'prof-1');

    expect(repo.saveMediaInformation).toHaveBeenCalledWith('org-1', body, 'prof-1');
  });
});
