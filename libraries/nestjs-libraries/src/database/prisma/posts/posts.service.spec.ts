// Mocks topo-de-modulo necessarios porque PostsService importa
// IntegrationManager (que carrega nostr.provider — ESM only que quebra
// ts-jest) e MediaService (que importa o alias @gitroom/backend nao
// mapeado no jest.config das libraries). Nada disso e usado pelo
// getReferencedMediaPaths.
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

import { PostsService } from './posts.service';
import { PostsRepository } from './posts.repository';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('PostsService.getReferencedMediaPaths', () => {
  let repository: ReturnType<typeof createMock<PostsRepository>>;
  let service: PostsService;

  beforeEach(() => {
    repository = createMock<PostsRepository>();
    service = new PostsService(
      repository as any, // postsRepository
      null as any, // integrationManager
      null as any, // integrationService
      null as any, // mediaService
      null as any, // shortLinkService
      null as any, // openaiService (legacy)
      null as any, // temporalService
      null as any, // refreshIntegrationService
      null as any // aiTextService
    );
  });

  // Em producao o path da midia vive em Post.image (JSON do MediaDto, formato
  // [{ id, path }]). Post.content e o HTML da legenda (texto simples, sem path).
  // A guarda principal e a leitura de Post.image; o parse de content e apenas
  // um safety-net defensivo para formatos futuros.
  it('deve coletar os paths de imagem dos posts pendentes (QUEUE/DRAFT) a partir de Post.image', async () => {
    repository.getPendingPostsMedia.mockResolvedValue([
      {
        content: '<p>legenda do post</p>',
        image: JSON.stringify([{ id: 'x', path: 'https://r2/a.png' }]),
      },
      {
        content: '<p>outra legenda</p>',
        image: JSON.stringify([
          { id: 'y', path: 'https://r2/b.png' },
          { id: 'z', path: 'https://r2/c.png' },
        ]),
      },
    ] as any);

    const paths = await service.getReferencedMediaPaths('org-1');

    expect(paths.has('https://r2/a.png')).toBe(true);
    expect(paths.has('https://r2/b.png')).toBe(true);
    expect(paths.has('https://r2/c.png')).toBe(true);
  });

  it('deve ignorar conteudo nao-JSON sem lancar erro', async () => {
    repository.getPendingPostsMedia.mockResolvedValue([
      { content: 'texto simples nao-json', image: null },
    ] as any);

    const paths = await service.getReferencedMediaPaths('org-1');

    expect(paths.size).toBe(0);
  });
});

describe('PostsService escopo de perfil (API publica)', () => {
  let repository: ReturnType<typeof createMock<PostsRepository>>;
  let service: PostsService;

  beforeEach(() => {
    repository = createMock<PostsRepository>();
    service = new PostsService(
      repository as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any,
      null as any
    );
  });

  describe('getPostInScope', () => {
    it('devolve o post quando pertence a org e ao perfil', async () => {
      repository.getPostById.mockResolvedValue({ id: 'p1', profileId: 'prof-1', deletedAt: null } as any);

      const post = await service.getPostInScope('org-1', 'p1', 'prof-1');

      expect(repository.getPostById).toHaveBeenCalledWith('p1', 'org-1');
      expect(post).toMatchObject({ id: 'p1' });
    });

    it('lanca 404 quando o post nao existe na org ou esta apagado', async () => {
      repository.getPostById.mockResolvedValue(null);
      await expect(service.getPostInScope('org-1', 'p-x')).rejects.toMatchObject({ status: 404 });

      repository.getPostById.mockResolvedValue({ id: 'p1', deletedAt: new Date() } as any);
      await expect(service.getPostInScope('org-1', 'p1')).rejects.toMatchObject({ status: 404 });
    });

    it('lanca 404 quando o post e de outro perfil (posts sao estritos por perfil)', async () => {
      repository.getPostById.mockResolvedValue({ id: 'p1', profileId: 'prof-outro', deletedAt: null } as any);

      await expect(service.getPostInScope('org-1', 'p1', 'prof-1')).rejects.toMatchObject({ status: 404 });
    });

    it('sem profileId (chave de org) nao filtra por perfil', async () => {
      repository.getPostById.mockResolvedValue({ id: 'p1', profileId: 'prof-outro', deletedAt: null } as any);

      await expect(service.getPostInScope('org-1', 'p1')).resolves.toMatchObject({ id: 'p1' });
    });
  });

  describe('assertPostBodyInScope (upsert de POST /posts)', () => {
    const body = (posts: any[]) => ({ posts } as any);

    it('ids/grupos novos (inexistentes) passam sem consultar o perfil', async () => {
      repository.getPostById.mockResolvedValue(null);
      repository.getGroupOwner.mockResolvedValue(null);

      await expect(
        service.assertPostBodyInScope('org-1', body([{ group: 'g-novo', value: [{ id: 'p-novo' }] }]), 'prof-1')
      ).resolves.toBeUndefined();
    });

    it('value[].id de outra org -> 404 (nao pode sobrescrever post alheio)', async () => {
      repository.getPostById.mockResolvedValue({ id: 'p1', organizationId: 'org-OUTRA', profileId: null } as any);

      await expect(
        service.assertPostBodyInScope('org-1', body([{ value: [{ id: 'p1' }] }]))
      ).rejects.toMatchObject({ status: 404 });
    });

    it('value[].id de outro perfil (chave de perfil) -> 404; sem perfil no post passa', async () => {
      repository.getPostById.mockResolvedValue({ id: 'p1', organizationId: 'org-1', profileId: 'prof-outro' } as any);
      await expect(
        service.assertPostBodyInScope('org-1', body([{ value: [{ id: 'p1' }] }]), 'prof-1')
      ).rejects.toMatchObject({ status: 404 });

      repository.getPostById.mockResolvedValue({ id: 'p1', organizationId: 'org-1', profileId: null } as any);
      await expect(
        service.assertPostBodyInScope('org-1', body([{ value: [{ id: 'p1' }] }]), 'prof-1')
      ).resolves.toBeUndefined();
    });

    it('group de outra org ou de outro perfil -> 404 (o upsert apaga o resto do grupo)', async () => {
      repository.getPostById.mockResolvedValue(null);
      repository.getGroupOwner.mockResolvedValue({ organizationId: 'org-OUTRA', profileId: null } as any);
      await expect(
        service.assertPostBodyInScope('org-1', body([{ group: 'g1', value: [] }]))
      ).rejects.toMatchObject({ status: 404 });

      repository.getGroupOwner.mockResolvedValue({ organizationId: 'org-1', profileId: 'prof-outro' } as any);
      await expect(
        service.assertPostBodyInScope('org-1', body([{ group: 'g1', value: [] }]), 'prof-1')
      ).rejects.toMatchObject({ status: 404 });
      expect(repository.getGroupOwner).toHaveBeenCalledWith('g1');
    });
  });

  describe('getGroupInScope', () => {
    it('devolve os posts do grupo quando todos sao do perfil', async () => {
      repository.getPostsByGroup.mockResolvedValue([
        { id: 'p1', profileId: 'prof-1' },
        { id: 'p2', profileId: 'prof-1' },
      ] as any);

      const posts = await service.getGroupInScope('org-1', 'g1', 'prof-1');

      expect(repository.getPostsByGroup).toHaveBeenCalledWith('org-1', 'g1');
      expect(posts).toHaveLength(2);
    });

    it('lanca 404 quando o grupo esta vazio ou pertence a outro perfil', async () => {
      repository.getPostsByGroup.mockResolvedValue([] as any);
      await expect(service.getGroupInScope('org-1', 'g-x')).rejects.toMatchObject({ status: 404 });

      repository.getPostsByGroup.mockResolvedValue([{ id: 'p1', profileId: 'prof-outro' }] as any);
      await expect(service.getGroupInScope('org-1', 'g1', 'prof-1')).rejects.toMatchObject({ status: 404 });
    });
  });
});
