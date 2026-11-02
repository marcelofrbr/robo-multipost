jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { DeleteMediaTool, SaveMediaInformationTool } from './media.manage.tool';
import { MediaListTool } from './media.list.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1' }, profileId: 'prof-1' };
const run = (tool: any, input: any) =>
  runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('media tools', () => {
  it('deleteMedia valida o escopo e apaga', async () => {
    const media = createMock<MediaService>();
    media.getMediaInScope.mockResolvedValue({ id: 'm1' } as any);
    media.deleteMedia.mockResolvedValue({ id: 'm1' } as any);

    expect(await run(new DeleteMediaTool(media), { mediaId: 'm1' })).toEqual({ deleted: true });
    expect(media.getMediaInScope).toHaveBeenCalledWith('org-1', 'm1', 'prof-1');
    expect(media.deleteMedia).toHaveBeenCalledWith('org-1', 'm1', 'prof-1');
  });

  it('saveMediaInformation valida o escopo e grava alt/thumbnail com o perfil', async () => {
    const media = createMock<MediaService>();
    media.getMediaInScope.mockResolvedValue({ id: 'm1' } as any);
    media.saveMediaInformation.mockResolvedValue({ id: 'm1', alt: 'x' } as any);

    const r = await run(new SaveMediaInformationTool(media), { mediaId: 'm1', alt: 'x' });

    expect(media.saveMediaInformation).toHaveBeenCalledWith(
      'org-1',
      { id: 'm1', alt: 'x', thumbnail: undefined, thumbnailTimestamp: undefined },
      'prof-1'
    );
    expect(r).toEqual({ id: 'm1', alt: 'x' });
  });

  it('listMedia repassa from/to ao service', async () => {
    const media = createMock<MediaService>();
    media.getMediaStats.mockResolvedValue({ total: 0, totalSizeBytes: 0 } as any);
    media.getMedia.mockResolvedValue({ pages: 0, results: [] } as any);

    await run(new MediaListTool(media), { page: '2', from: '2026-09-01T03:00:00.000Z' });

    expect(media.getMedia).toHaveBeenCalledWith('org-1', 2, 'prof-1', {
      from: '2026-09-01T03:00:00.000Z',
      to: undefined,
    });
  });
});
