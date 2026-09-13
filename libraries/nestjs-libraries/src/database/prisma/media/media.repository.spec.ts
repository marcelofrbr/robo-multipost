import { createPrismaRepositoryMock } from '@gitroom/nestjs-libraries/test';
import { MediaRepository } from './media.repository';
import { Prisma } from '@prisma/client';

describe('MediaRepository.getDeletableMedia', () => {
  it('deve buscar midia nao deletada criada antes do cutoff', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.findMany.mockResolvedValue([] as any);
    const repo = new MediaRepository(prisma as any);
    const cutoff = new Date('2026-05-01');

    await repo.getDeletableMedia(cutoff, 'org-1');

    expect(prisma.model.media.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        createdAt: { lt: cutoff },
        organizationId: 'org-1',
      },
      select: {
        id: true,
        organizationId: true,
        profileId: true,
        path: true,
        thumbnail: true,
      },
    });
  });

  it('deve omitir organizationId quando orgId nao for fornecido', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.findMany.mockResolvedValue([] as any);
    const repo = new MediaRepository(prisma as any);
    const cutoff = new Date('2026-05-01');

    await repo.getDeletableMedia(cutoff);

    expect(prisma.model.media.findMany).toHaveBeenCalledWith({
      where: {
        deletedAt: null,
        createdAt: { lt: cutoff },
      },
      select: {
        id: true,
        organizationId: true,
        profileId: true,
        path: true,
        thumbnail: true,
      },
    });
  });
});

describe('MediaRepository.getMediaStats', () => {
  it('deve retornar total e soma de bytes da midia ativa', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.count.mockResolvedValue(3);
    prisma.model.media.aggregate.mockResolvedValue({
      _sum: { fileSize: 4096 },
    } as any);
    const repo = new MediaRepository(prisma as any);

    const result = await repo.getMediaStats('org-1');

    expect(prisma.model.media.count).toHaveBeenCalledWith({
      where: { organizationId: 'org-1', deletedAt: null },
    });
    expect(result).toEqual({ total: 3, totalSizeBytes: 4096 });
  });

  it('deve usar 0 quando a soma de fileSize for nula', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.count.mockResolvedValue(0);
    prisma.model.media.aggregate.mockResolvedValue({
      _sum: { fileSize: null },
    } as any);
    const repo = new MediaRepository(prisma as any);

    const result = await repo.getMediaStats('org-1', 'profile-9');

    expect(prisma.model.media.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        OR: [{ profileId: 'profile-9' }, { profileId: null }],
      },
    });
    expect(result).toEqual({ total: 0, totalSizeBytes: 0 });
  });
});

describe('MediaRepository.getMedia', () => {
  const baseSelect = {
    id: true,
    name: true,
    originalName: true,
    path: true,
    thumbnail: true,
    alt: true,
    thumbnailTimestamp: true,
  };

  it('usa o mesmo where na contagem e na listagem, sempre com deletedAt null', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.count.mockResolvedValue(19);
    prisma.model.media.findMany.mockResolvedValue([] as any);
    const repo = new MediaRepository(prisma as any);

    const result = await repo.getMedia('org-1', 2, 'profile-9');

    const where: Prisma.MediaWhereInput = {
      organizationId: 'org-1',
      deletedAt: null,
      OR: [{ profileId: 'profile-9' }, { profileId: null }],
    };
    expect(prisma.model.media.count).toHaveBeenCalledWith({ where });
    expect(prisma.model.media.findMany).toHaveBeenCalledWith({
      where,
      orderBy: { createdAt: 'desc' },
      select: baseSelect,
      skip: 18,
      take: 18,
    });
    expect(result.pages).toBe(2);
  });

  it('filtra createdAt entre from e to quando o periodo e informado', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.count.mockResolvedValue(0);
    prisma.model.media.findMany.mockResolvedValue([] as any);
    const repo = new MediaRepository(prisma as any);

    await repo.getMedia('org-1', 1, undefined, {
      from: '2026-09-01T03:00:00.000Z',
      to: '2026-09-30T02:59:59.999Z',
    });

    const where: Prisma.MediaWhereInput = {
      organizationId: 'org-1',
      deletedAt: null,
      createdAt: {
        gte: new Date('2026-09-01T03:00:00.000Z'),
        lte: new Date('2026-09-30T02:59:59.999Z'),
      },
    };
    expect(prisma.model.media.count).toHaveBeenCalledWith({ where });
    expect(prisma.model.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where, skip: 0, take: 18 })
    );
  });

  it('aceita so from ou so to', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.count.mockResolvedValue(0);
    prisma.model.media.findMany.mockResolvedValue([] as any);
    const repo = new MediaRepository(prisma as any);

    await repo.getMedia('org-1', 1, undefined, { to: '2026-09-30T02:59:59.999Z' });

    expect(prisma.model.media.count).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        deletedAt: null,
        createdAt: { lte: new Date('2026-09-30T02:59:59.999Z') },
      },
    });
  });

  it('trata page ausente como pagina 1', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.count.mockResolvedValue(0);
    prisma.model.media.findMany.mockResolvedValue([] as any);
    const repo = new MediaRepository(prisma as any);

    await repo.getMedia('org-1', undefined as any);

    expect(prisma.model.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 18 })
    );
  });
});

describe('MediaRepository.getMediaForOrg', () => {
  it('busca por id + org, sem apagadas, e com OR perfil/null quando ha profileId', async () => {
    const prisma = createPrismaRepositoryMock('media');
    prisma.model.media.findFirst.mockResolvedValue(null as any);
    const repo = new MediaRepository(prisma as any);

    await repo.getMediaForOrg('org-1', 'm1');
    expect(prisma.model.media.findFirst).toHaveBeenCalledWith({
      where: { id: 'm1', organizationId: 'org-1', deletedAt: null },
    });

    await repo.getMediaForOrg('org-1', 'm1', 'prof-1');
    expect(prisma.model.media.findFirst).toHaveBeenLastCalledWith({
      where: {
        id: 'm1',
        organizationId: 'org-1',
        deletedAt: null,
        OR: [{ profileId: 'prof-1' }, { profileId: null }],
      },
    });
  });
});
