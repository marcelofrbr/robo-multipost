jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({}));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import { HttpException, NotFoundException } from '@nestjs/common';
import { PublicMediaController } from './public.media.controller';

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

const makeMediaService = () => ({
  getMedia: jest.fn(),
  getMediaInScope: jest.fn(),
  deleteMedia: jest.fn(),
  saveMediaInformation: jest.fn(),
});
const org = { id: 'org-1' } as any;

describe('PublicMediaController', () => {
  let controller: PublicMediaController;
  let media: ReturnType<typeof makeMediaService>;

  beforeEach(() => {
    media = makeMediaService();
    controller = new PublicMediaController(media as any, makeScope() as any);
  });

  it('GET /media lista com pagina padrao 1, perfil da chave e periodo', async () => {
    media.getMedia.mockResolvedValue({ pages: 1, results: [] });

    const r = await controller.listMedia(org, 'prof-1', { from: '2026-09-01T03:00:00.000Z' } as any);

    expect(media.getMedia).toHaveBeenCalledWith('org-1', 1, 'prof-1', {
      from: '2026-09-01T03:00:00.000Z',
      to: undefined,
    });
    expect(r).toEqual({ pages: 1, results: [] });
  });

  it('GET /media: chave de org mira perfil por ?profileId; chave de perfil divergente -> 403', async () => {
    media.getMedia.mockResolvedValue({ pages: 0, results: [] });
    await controller.listMedia(org, undefined, { page: 2, profileId: 'prof-2' } as any);
    expect(media.getMedia).toHaveBeenCalledWith('org-1', 2, 'prof-2', { from: undefined, to: undefined });

    await expect(controller.listMedia(org, 'prof-1', { profileId: 'prof-9' } as any)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('DELETE /media/:id valida o escopo e apaga com o perfil efetivo', async () => {
    media.getMediaInScope.mockResolvedValue({ id: 'm1' });
    media.deleteMedia.mockResolvedValue({ id: 'm1' });

    await controller.deleteMedia(org, 'prof-1', 'm1', undefined);

    expect(media.getMediaInScope).toHaveBeenCalledWith('org-1', 'm1', 'prof-1');
    expect(media.deleteMedia).toHaveBeenCalledWith('org-1', 'm1', 'prof-1');
  });

  it('POST /media/information valida o escopo pelo id do corpo', async () => {
    media.getMediaInScope.mockResolvedValue({ id: 'm1' });
    media.saveMediaInformation.mockResolvedValue({ id: 'm1', alt: 'x' });

    const body = { id: 'm1', alt: 'x' } as any;
    const r = await controller.saveMediaInformation(org, 'prof-1', undefined, body);

    expect(media.getMediaInScope).toHaveBeenCalledWith('org-1', 'm1', 'prof-1');
    expect(media.saveMediaInformation).toHaveBeenCalledWith('org-1', body, 'prof-1');
    expect(r).toEqual({ id: 'm1', alt: 'x' });
  });
});
