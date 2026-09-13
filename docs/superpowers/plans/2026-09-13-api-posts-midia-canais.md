# API pública — posts, mídia e canais (entrega 2) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o que falta de posts, mídia e canais na API pública (`/public/v1`): detalhe/grupo/estatísticas/data/comentário de post, biblioteca de mídia (listar/apagar/editar informação), ativar/desativar canal e configurações do provedor — tudo com escopo de perfil da chave e erros 404/403 em vez de 500.

**Architecture:** Dois controllers novos e focados (`public.posts.controller.ts`, `public.media.controller.ts`) + três rotas de canal no `public.integrations.controller.ts` existente (onde já vivem `GET /integrations`, `DELETE /integrations/:id`). Cada controller novo tem `ValidationPipe` estrito e `@ApiSecurity('api-key')` (padrão de `public.flows.controller.ts`). O escopo é resolvido nos services por métodos `get*InScope(orgId, id, profileId?)` que lançam `NotFoundException`/`ForbiddenException` — o controller só chama o helper e delega. Regras de escopo: **posts são estritos por perfil** (`PostsRepository.getPosts/deletePost` filtram `profileId` exato) → fora do escopo é **404**; **mídia e canais** tratam `profileId = null` como compartilhado (`OR: [{ profileId }, { profileId: null }]`) → outro perfil é **403**, inexistente é **404**.

**Tech Stack:** NestJS 11, class-validator/class-transformer, Swagger, Jest (`describe`/`it` em pt-BR sem acentos), `createMock<T>()` de `@gitroom/nestjs-libraries/test`.

Spec: `docs/superpowers/specs/2026-09-13-api-mcp-controle-total-design.md` (Entrega 2). Guia da entrega 1 (padrão de doc): `docs/api/automacoes-e-dm.md`.

Comandos deste worktree (Windows): `node node_modules/jest/bin/jest.js --selectProjects <backend|nestjs-libraries> --testMatch "**/src/**/*.spec.ts" --testPathPattern "<padrao>"`; `node node_modules/typescript/bin/tsc --noEmit -p apps/backend/tsconfig.build.json`. **Nunca** combinar `git commit` com `sed -n`/`grep -n` no mesmo comando (hook pré-bash lê `-n` como `--no-verify`); mensagens de commit via `git commit -F <arquivo>`.

---

## Mapa de arquivos

| Arquivo | Responsabilidade |
|---|---|
| `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts` | + `getPostInScope`, `getGroupInScope` (404 fora do escopo) |
| `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts` | + specs dos dois helpers |
| `libraries/nestjs-libraries/src/database/prisma/organizations/organization.service.ts` | + `getOwnerUserId` (autor dos comentários via API) |
| `libraries/nestjs-libraries/src/database/prisma/organizations/organization.service.spec.ts` | novo |
| `libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts` | + `getMediaForOrg` |
| `libraries/nestjs-libraries/src/database/prisma/media/media.repository.spec.ts` | + spec |
| `libraries/nestjs-libraries/src/database/prisma/media/media.service.ts` | + `getMediaInScope` (404/403) |
| `libraries/nestjs-libraries/src/database/prisma/media/media.service.scope.spec.ts` | novo |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts` | + `getIntegrationInScope` (404/403) |
| `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.spec.ts` | novo |
| `libraries/nestjs-libraries/src/dtos/posts/change.post.date.dto.ts` | novo: `ChangePostDateDto` |
| `libraries/nestjs-libraries/src/dtos/posts/create.post.comment.dto.ts` | novo: `CreatePostCommentDto` |
| `libraries/nestjs-libraries/src/dtos/integrations/update.integration.settings.dto.ts` | novo: `UpdateIntegrationSettingsDto` (aceita string JSON ou array) |
| `libraries/nestjs-libraries/src/dtos/integrations/update.integration.settings.dto.spec.ts` | novo |
| `apps/backend/src/public-api/routes/v1/public.posts.controller.ts` (+ `.spec.ts`) | GET `/posts/:id`, GET `/posts/group/:group`, GET `/posts/:id/statistics`, PUT `/posts/:id/date`, POST `/posts/:id/comments` |
| `apps/backend/src/public-api/routes/v1/public.media.controller.ts` (+ `.spec.ts`) | GET `/media`, DELETE `/media/:id`, POST `/media/information` |
| `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts` (+ `.spec.ts`) | + POST `/integrations/:id/enable`, `/disable`, `/settings`; `profile:${state}` no OAuth; escopo de perfil em `GET /posts`, `DELETE /posts/:id`, `DELETE /posts/group/:group` |
| `apps/backend/src/public-api/public.api.module.ts` | registra os dois controllers novos |
| `docs/api/posts-midia-canais.md` | guia pt-BR (novo) |
| `CHANGELOG.md`, `README.md`, `apps/backend/CLAUDE.md` | entrada, link, mapa |

---

### Task 1: Helpers de escopo — posts (`getPostInScope`, `getGroupInScope`)

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts`
- Test: `libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts` (append um `describe` novo no fim)

- [ ] **Step 1: Escrever os testes (RED)** — anexar ao fim de `posts.service.spec.ts` (o arquivo já tem os `jest.mock` de topo e um `beforeEach` que instancia `PostsService` com `repository` mockado dentro do primeiro `describe`; o novo `describe` recria o setup):

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "posts/posts\.service\.spec"`
Expected: FAIL (compilação: `getPostInScope`/`getGroupInScope` não existem).

- [ ] **Step 3: Implementar** em `posts.service.ts` (logo após `getPost`; `NotFoundException` já vem de `@nestjs/common` — conferir o import no topo, adicionar se faltar):

```ts
  /**
   * Escopo da API publica: post precisa existir na org e, com chave de
   * perfil, pertencer ao perfil. Posts sao estritos por perfil (getPosts e
   * deletePost filtram profileId exato), entao fora do escopo e 404.
   */
  async getPostInScope(orgId: string, id: string, profileId?: string) {
    const post = await this._postRepository.getPostById(id, orgId);
    if (!post || post.deletedAt) {
      throw new NotFoundException('Post not found');
    }
    if (profileId && post.profileId !== profileId) {
      throw new NotFoundException('Post not found');
    }
    return post;
  }

  /** Mesma regra de getPostInScope, para um grupo (post multi-canal). */
  async getGroupInScope(orgId: string, group: string, profileId?: string) {
    const posts = await this._postRepository.getPostsByGroup(orgId, group);
    if (!posts.length) {
      throw new NotFoundException('Post group not found');
    }
    if (profileId && posts.some((p) => p.profileId !== profileId)) {
      throw new NotFoundException('Post group not found');
    }
    return posts;
  }
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando; Expected: PASS (todos os `describe` do arquivo).

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/posts/posts.service.ts libraries/nestjs-libraries/src/database/prisma/posts/posts.service.spec.ts
git commit -F <arquivo com: "feat(posts): getPostInScope/getGroupInScope para a API publica (404 fora do perfil)">
```

---

### Task 2: Helpers de escopo — mídia, canal e dono da org

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts`, `media.service.ts`, `libraries/nestjs-libraries/src/database/prisma/integrations/integration.service.ts`, `libraries/nestjs-libraries/src/database/prisma/organizations/organization.service.ts`
- Test: `media/media.repository.spec.ts` (append), Create `media/media.service.scope.spec.ts`, Create `integrations/integration.service.spec.ts`, Create `organizations/organization.service.spec.ts`

- [ ] **Step 1: Testes (RED)**

`media/media.repository.spec.ts` — anexar dentro do `describe('MediaRepository'…)` existente (usa `createPrismaRepositoryMock('media')`; conferir o nome da variável do mock no arquivo — abaixo assume `prisma` e `repo` como nos outros specs de repositório):

```ts
  describe('getMediaForOrg', () => {
    it('busca por id + org, sem apagadas, e com OR perfil/null quando ha profileId', async () => {
      prisma.model.media.findFirst.mockResolvedValue(null);

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
```

`media/media.service.scope.spec.ts` (novo — copiar o bloco de `jest.mock` e o `buildService` de `media.service.get-media.spec.ts`):

```ts
// (mesmos jest.mock de media.service.get-media.spec.ts: subscription.service, video.manager, permission.exception.class)

import { MediaService } from './media.service';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MediaRepository } from '@gitroom/nestjs-libraries/database/prisma/media/media.repository';

const buildService = (repo: ReturnType<typeof createMock<MediaRepository>>) =>
  new MediaService(repo, null as any, null as any, null as any, null as any, null as any, null as any);

describe('MediaService.getMediaInScope', () => {
  it('devolve a midia quando esta na org (e no perfil ou compartilhada)', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMediaForOrg.mockResolvedValue({ id: 'm1', profileId: null } as any);

    await expect(buildService(repo).getMediaInScope('org-1', 'm1', 'prof-1')).resolves.toMatchObject({ id: 'm1' });
    expect(repo.getMediaForOrg).toHaveBeenCalledWith('org-1', 'm1', undefined);
  });

  it('lanca 404 quando nao existe na org', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMediaForOrg.mockResolvedValue(null);

    await expect(buildService(repo).getMediaInScope('org-1', 'm-x')).rejects.toMatchObject({ status: 404 });
  });

  it('lanca 403 quando a midia e de outro perfil', async () => {
    const repo = createMock<MediaRepository>();
    repo.getMediaForOrg.mockResolvedValue({ id: 'm1', profileId: 'prof-outro' } as any);

    await expect(buildService(repo).getMediaInScope('org-1', 'm1', 'prof-1')).rejects.toMatchObject({ status: 403 });
  });
});
```

`integrations/integration.service.spec.ts` (novo):

```ts
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManagerMock {},
}));
jest.mock('@gitroom/nestjs-libraries/integrations/refresh.integration.service', () => ({
  RefreshIntegrationService: class RefreshIntegrationServiceMock {},
}));

import { IntegrationService } from './integration.service';
import { IntegrationRepository } from './integration.repository';
import { createMock } from '@gitroom/nestjs-libraries/test';

const build = (repo: ReturnType<typeof createMock<IntegrationRepository>>) =>
  new IntegrationService(repo, null as any, null as any, null as any, null as any, null as any);

describe('IntegrationService.getIntegrationInScope', () => {
  it('devolve o canal quando esta na org e no perfil (ou sem perfil = compartilhado)', async () => {
    const repo = createMock<IntegrationRepository>();
    repo.getIntegrationById.mockResolvedValue({ id: 'int-1', profileId: null, deletedAt: null } as any);

    await expect(build(repo).getIntegrationInScope('org-1', 'int-1', 'prof-1')).resolves.toMatchObject({ id: 'int-1' });
    expect(repo.getIntegrationById).toHaveBeenCalledWith('org-1', 'int-1');
  });

  it('lanca 404 quando nao existe ou esta apagado', async () => {
    const repo = createMock<IntegrationRepository>();
    repo.getIntegrationById.mockResolvedValue(null);
    await expect(build(repo).getIntegrationInScope('org-1', 'x')).rejects.toMatchObject({ status: 404 });

    repo.getIntegrationById.mockResolvedValue({ id: 'int-1', deletedAt: new Date() } as any);
    await expect(build(repo).getIntegrationInScope('org-1', 'int-1')).rejects.toMatchObject({ status: 404 });
  });

  it('lanca 403 quando o canal e de outro perfil', async () => {
    const repo = createMock<IntegrationRepository>();
    repo.getIntegrationById.mockResolvedValue({ id: 'int-1', profileId: 'prof-outro', deletedAt: null } as any);

    await expect(build(repo).getIntegrationInScope('org-1', 'int-1', 'prof-1')).rejects.toMatchObject({ status: 403 });
  });
});
```

`organizations/organization.service.spec.ts` (novo):

```ts
import { OrganizationService } from './organization.service';
import { OrganizationRepository } from './organization.repository';
import { createMock } from '@gitroom/nestjs-libraries/test';

describe('OrganizationService.getOwnerUserId', () => {
  const build = (repo: ReturnType<typeof createMock<OrganizationRepository>>) =>
    new OrganizationService(repo, null as any);

  it('devolve o id do SUPERADMIN da org', async () => {
    const repo = createMock<OrganizationRepository>();
    repo.getTeam.mockResolvedValue({
      users: [
        { role: 'USER', user: { id: 'u-2' } },
        { role: 'SUPERADMIN', user: { id: 'u-1' } },
      ],
    } as any);

    await expect(build(repo).getOwnerUserId('org-1')).resolves.toBe('u-1');
  });

  it('cai para o primeiro membro quando nao ha SUPERADMIN e lanca 412 sem membros', async () => {
    const repo = createMock<OrganizationRepository>();
    repo.getTeam.mockResolvedValue({ users: [{ role: 'ADMIN', user: { id: 'u-9' } }] } as any);
    await expect(build(repo).getOwnerUserId('org-1')).resolves.toBe('u-9');

    repo.getTeam.mockResolvedValue({ users: [] } as any);
    await expect(build(repo).getOwnerUserId('org-1')).rejects.toMatchObject({ status: 412 });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "(media\.repository|media\.service\.scope|integration\.service\.spec|organization\.service\.spec)"`
Expected: FAIL (métodos inexistentes).

- [ ] **Step 3: Implementar**

`media.repository.ts` (após `deleteMedia`):

```ts
  getMediaForOrg(org: string, id: string, profileId?: string) {
    return this._media.model.media.findFirst({
      where: {
        id,
        organizationId: org,
        deletedAt: null,
        ...(profileId ? { OR: [{ profileId }, { profileId: null }] } : {}),
      },
    });
  }
```

`media.service.ts` (após `deleteMedia`; importar `ForbiddenException, NotFoundException` de `@nestjs/common`):

```ts
  /**
   * Escopo da API publica: 404 se nao existe na org; 403 se pertence a outro
   * perfil (midia sem perfil e compartilhada, como em deleteMedia/getMedia).
   */
  async getMediaInScope(org: string, id: string, profileId?: string) {
    const media = await this._mediaRepository.getMediaForOrg(org, id);
    if (!media) {
      throw new NotFoundException('Media not found');
    }
    if (profileId && media.profileId && media.profileId !== profileId) {
      throw new ForbiddenException('Media belongs to another profile');
    }
    return media;
  }
```

`integration.service.ts` (após `validateIntegrationProfile`; importar `ForbiddenException, NotFoundException`):

```ts
  /**
   * Versao da API publica de validateIntegrationProfile: 404 (inexistente/
   * apagado) e 403 (outro perfil) em vez de Error generico (500). Canal sem
   * perfil e compartilhado — mesma regra de getIntegrationById/getIntegrationsList.
   */
  async getIntegrationInScope(orgId: string, integrationId: string, profileId?: string) {
    const integration = await this._integrationRepository.getIntegrationById(orgId, integrationId);
    if (!integration || integration.deletedAt) {
      throw new NotFoundException('Integration not found');
    }
    if (profileId && integration.profileId && integration.profileId !== profileId) {
      throw new ForbiddenException('Integration belongs to another profile');
    }
    return integration;
  }
```

`organization.service.ts` (após `getTeam`; importar `HttpException, HttpStatus`):

```ts
  /**
   * Usuario "dono" da org (SUPERADMIN) — autor de acoes feitas por chave de
   * API que exigem userId (ex.: comentario interno num post).
   */
  async getOwnerUserId(orgId: string): Promise<string> {
    const team = await this._organizationRepository.getTeam(orgId);
    const users = team?.users ?? [];
    const owner = users.find((u) => u.role === 'SUPERADMIN') ?? users[0];
    if (!owner?.user?.id) {
      throw new HttpException('Organization has no members', HttpStatus.PRECONDITION_FAILED);
    }
    return owner.user.id;
  }
```

- [ ] **Step 4: Rodar e ver passar** — mesmo comando; Expected: PASS.
- [ ] **Step 5: Commit** — `feat(libs): helpers de escopo para midia, canal e dono da org (API publica)`

---

### Task 3: DTOs

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/posts/change.post.date.dto.ts`, `libraries/nestjs-libraries/src/dtos/posts/create.post.comment.dto.ts`, `libraries/nestjs-libraries/src/dtos/integrations/update.integration.settings.dto.ts`
- Test: `libraries/nestjs-libraries/src/dtos/integrations/update.integration.settings.dto.spec.ts`

- [ ] **Step 1: Teste do DTO de settings (RED)** (padrão de `dtos/media/get-media.query.dto.spec.ts`: `plainToInstance` + `validate`):

```ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateIntegrationSettingsDto } from './update.integration.settings.dto';

describe('UpdateIntegrationSettingsDto', () => {
  it('aceita array e serializa para a string JSON que o service grava', async () => {
    const dto = plainToInstance(UpdateIntegrationSettingsDto, {
      additionalSettings: [{ title: 'Verified', value: true }],
    });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.additionalSettings).toBe('[{"title":"Verified","value":true}]');
  });

  it('aceita string JSON de array e rejeita JSON invalido ou que nao e array', async () => {
    const ok = plainToInstance(UpdateIntegrationSettingsDto, { additionalSettings: '[]' });
    expect(await validate(ok)).toHaveLength(0);

    const invalido = plainToInstance(UpdateIntegrationSettingsDto, { additionalSettings: '{nao json' });
    expect(await validate(invalido)).not.toHaveLength(0);

    const objeto = plainToInstance(UpdateIntegrationSettingsDto, { additionalSettings: '{"a":1}' });
    expect(await validate(objeto)).not.toHaveLength(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `--testPathPattern "update\.integration\.settings"`; Expected: FAIL (módulo não existe).

- [ ] **Step 3: Criar os DTOs**

`update.integration.settings.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, Validate, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator';

@ValidatorConstraint({ name: 'isJsonArrayString', async: false })
class IsJsonArrayString implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    try {
      return Array.isArray(JSON.parse(value));
    } catch {
      return false;
    }
  }
  defaultMessage(): string {
    return 'additionalSettings deve ser um array JSON (ou a string JSON de um array)';
  }
}

export class UpdateIntegrationSettingsDto {
  @ApiProperty({
    description:
      'Configurações do provedor no formato da tela: array de `{ title, value }`. Pode vir como array ou como string JSON.',
    example: [{ title: 'Verified', value: true }],
  })
  // O service grava string (mesmo contrato da UI); aceitar array e mais
  // natural para clientes de API.
  @Transform(({ value }) => (typeof value === 'string' ? value : JSON.stringify(value)))
  @IsString()
  @MaxLength(20000)
  @Validate(IsJsonArrayString)
  additionalSettings: string;
}
```

`change.post.date.dto.ts`:

```ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional } from 'class-validator';

export class ChangePostDateDto {
  @ApiProperty({ example: '2026-09-20T13:00:00.000Z', description: 'Nova data/hora (ISO 8601, UTC).' })
  @IsISO8601({ strict: true })
  date: string;

  @ApiPropertyOptional({
    enum: ['schedule', 'update'],
    default: 'schedule',
    description: '`schedule` reagenda (volta para a fila); `update` só troca a data sem mexer no status.',
  })
  @IsOptional()
  @IsIn(['schedule', 'update'])
  action?: 'schedule' | 'update';
}
```

`create.post.comment.dto.ts`:

```ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreatePostCommentDto {
  @ApiProperty({ maxLength: 2000, description: 'Comentário interno (não vai para a rede social).' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  comment: string;
}
```

- [ ] **Step 4: Rodar e ver passar** — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(dtos): ChangePostDateDto, CreatePostCommentDto e UpdateIntegrationSettingsDto`

---

### Task 4: `PublicPostsController`

**Files:**
- Create: `apps/backend/src/public-api/routes/v1/public.posts.controller.ts`
- Test: `apps/backend/src/public-api/routes/v1/public.posts.controller.spec.ts`

- [ ] **Step 1: Spec (RED)**

```ts
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
```

- [ ] **Step 2: Rodar e ver falhar** — `--selectProjects backend --testPathPattern "public\.posts"`; Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar o controller**

```ts
import { Body, Controller, Get, HttpException, Param, Post, Put, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import { ChangePostDateDto } from '@gitroom/nestjs-libraries/dtos/posts/change.post.date.dto';
import { CreatePostCommentDto } from '@gitroom/nestjs-libraries/dtos/posts/create.post.comment.dto';

/**
 * Posts na API publica: detalhe, grupo, estatisticas, data e comentario.
 * Listar/criar/apagar continuam em public.integrations.controller.ts.
 * Posts sao estritos por perfil: fora do escopo da chave e 404
 * (PostsService.getPostInScope/getGroupInScope).
 */
@ApiTags('Posts')
@ApiSecurity('api-key')
@Controller('/public/v1')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class PublicPostsController {
  constructor(
    private _postsService: PostsService,
    private _organizationService: OrganizationService
  ) {}

  /** Chave por-perfil so opera no proprio perfil (`?profileId` divergente -> 403). */
  private resolveProfileId(publicApiProfileId: string | undefined, requestedProfileId?: string) {
    if (publicApiProfileId && requestedProfileId && requestedProfileId !== publicApiProfileId) {
      throw new HttpException({ msg: 'Profile key cannot access another profile' }, 403);
    }
    return publicApiProfileId ?? requestedProfileId;
  }

  @Get('/posts/group/:group')
  @ApiOperation({ summary: 'Todos os posts de um grupo (publicação multi-canal)' })
  @ApiParam({ name: 'group', description: 'ID do grupo (campo `group` de POST /posts)' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Grupo fora do seu escopo' })
  async getPostsByGroup(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('group') group: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._postsService.getGroupInScope(org.id, group, effectiveProfileId);
    return this._postsService.getPostsByGroup(org.id, group);
  }

  @Get('/posts/:id/statistics')
  @ApiOperation({ summary: 'Cliques nos links encurtados do post' })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  async getStatistics(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    return this._postsService.getStatistics(org.id, id);
  }

  @Get('/posts/:id')
  @ApiOperation({ summary: 'Detalhar um post (com os comentários encadeados e mídias)' })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  async getPost(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    return this._postsService.getPost(org.id, id);
  }

  @Put('/posts/:id/date')
  @ApiOperation({
    summary: 'Mudar a data de um post',
    description: '`action=schedule` (padrão) reagenda e volta o post para a fila; `update` só troca a data.',
  })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: ChangePostDateDto })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async changeDate(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: ChangePostDateDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    return this._postsService.changeDate(org.id, id, body.date, body.action ?? 'schedule', effectiveProfileId);
  }

  @Post('/posts/:id/comments')
  @ApiOperation({
    summary: 'Comentar internamente num post',
    description: 'Comentário da equipe (aparece na tela do post, não vai para a rede). Autor: dono da organização.',
  })
  @ApiParam({ name: 'id', description: 'ID do post' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: CreatePostCommentDto })
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async createComment(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: CreatePostCommentDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._postsService.getPostInScope(org.id, id, effectiveProfileId);
    const ownerId = await this._organizationService.getOwnerUserId(org.id);
    return this._postsService.createComment(org.id, ownerId, id, body.comment);
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — Expected: PASS (7).
- [ ] **Step 5: Commit** — `feat(api): PublicPostsController — detalhe, grupo, estatisticas, data e comentario`

---

### Task 5: `PublicMediaController`

**Files:**
- Create: `apps/backend/src/public-api/routes/v1/public.media.controller.ts`
- Test: `apps/backend/src/public-api/routes/v1/public.media.controller.spec.ts`

- [ ] **Step 1: Spec (RED)**

```ts
jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({}));
jest.mock('@sentry/nestjs', () => ({ metrics: { count: jest.fn() } }));

import { PublicMediaController } from './public.media.controller';

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
    controller = new PublicMediaController(media as any);
  });

  it('GET /media lista com pagina padrao 1, perfil da chave e periodo', async () => {
    media.getMedia.mockResolvedValue({ pages: 1, results: [] });

    const r = await controller.listMedia(org, 'prof-1', { from: '2026-09-01T03:00:00.000Z' } as any);

    expect(media.getMedia).toHaveBeenCalledWith('org-1', 1, 'prof-1', { from: '2026-09-01T03:00:00.000Z', to: undefined });
    expect(r).toEqual({ pages: 1, results: [] });
  });

  it('GET /media: chave de org mira perfil por ?profileId; chave de perfil divergente -> 403', async () => {
    media.getMedia.mockResolvedValue({ pages: 0, results: [] });
    await controller.listMedia(org, undefined, { page: 2, profileId: 'prof-2' } as any);
    expect(media.getMedia).toHaveBeenCalledWith('org-1', 2, 'prof-2', { from: undefined, to: undefined });

    await expect(controller.listMedia(org, 'prof-1', { profileId: 'prof-9' } as any)).rejects.toMatchObject({ status: 403 });
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
    expect(media.saveMediaInformation).toHaveBeenCalledWith('org-1', body);
    expect(r).toEqual({ id: 'm1', alt: 'x' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `--selectProjects backend --testPathPattern "public\.media"`; Expected: FAIL.

- [ ] **Step 3: Implementar** — `GetMediaQueryDto` não tem `profileId`; criar um DTO local de query no próprio arquivo do controller estendendo o existente:

```ts
import { Body, Controller, Delete, Get, HttpException, Param, Post, Query, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiPropertyOptional, ApiQuery, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { Organization } from '@prisma/client';
import * as Sentry from '@sentry/nestjs';
import { GetOrgFromRequest } from '@gitroom/nestjs-libraries/user/org.from.request';
import { GetPublicApiProfileId } from '@gitroom/nestjs-libraries/user/public.api.profile.from.request';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { GetMediaQueryDto } from '@gitroom/nestjs-libraries/dtos/media/get-media.query.dto';
import { SaveMediaInformationDto } from '@gitroom/nestjs-libraries/dtos/media/save.media.information.dto';

export class PublicGetMediaQueryDto extends GetMediaQueryDto {
  @ApiPropertyOptional({ description: 'Chave de organização: perfil alvo. Chave de perfil: precisa ser o próprio.' })
  @IsOptional()
  @IsString()
  profileId?: string;
}

/**
 * Biblioteca de midia na API publica. Upload continua em
 * public.integrations.controller.ts (POST /upload e /upload-from-url).
 * Midia sem perfil e compartilhada (mesma regra da tela): outro perfil -> 403.
 */
@ApiTags('Mídia')
@ApiSecurity('api-key')
@Controller('/public/v1')
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class PublicMediaController {
  constructor(private _mediaService: MediaService) {}

  private resolveProfileId(publicApiProfileId: string | undefined, requestedProfileId?: string) {
    if (publicApiProfileId && requestedProfileId && requestedProfileId !== publicApiProfileId) {
      throw new HttpException({ msg: 'Profile key cannot access another profile' }, 403);
    }
    return publicApiProfileId ?? requestedProfileId;
  }

  @Get('/media')
  @ApiOperation({
    summary: 'Listar a biblioteca de mídia',
    description: 'Paginado (`page`, 28 por página). `from`/`to` (ISO 8601) filtram pela data de upload.',
  })
  @ApiResponse({ status: 200, description: '`{ pages, results: [{ id, path, name, alt, thumbnail, createdAt, ... }] }`' })
  async listMedia(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query() query: PublicGetMediaQueryDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, query.profileId);
    return this._mediaService.getMedia(org.id, query.page ?? 1, effectiveProfileId, {
      from: query.from,
      to: query.to,
    });
  }

  @Delete('/media/:id')
  @ApiOperation({ summary: 'Apagar uma mídia da biblioteca' })
  @ApiParam({ name: 'id', description: 'ID da mídia' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Mídia de outro perfil' })
  @ApiResponse({ status: 404, description: 'Mídia inexistente' })
  async deleteMedia(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._mediaService.getMediaInScope(org.id, id, effectiveProfileId);
    return this._mediaService.deleteMedia(org.id, id, effectiveProfileId);
  }

  @Post('/media/information')
  @ApiOperation({ summary: 'Editar texto alternativo e miniatura de uma mídia' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: SaveMediaInformationDto })
  @ApiResponse({ status: 403, description: 'Mídia de outro perfil' })
  @ApiResponse({ status: 404, description: 'Mídia inexistente' })
  async saveMediaInformation(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query('profileId') profileId: string | undefined,
    @Body() body: SaveMediaInformationDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._mediaService.getMediaInScope(org.id, body.id, effectiveProfileId);
    return this._mediaService.saveMediaInformation(org.id, body);
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — Expected: PASS (4).
- [ ] **Step 5: Commit** — `feat(api): PublicMediaController — listar, apagar e editar informacao de midia`

---

### Task 6: Canais e escopo de perfil no `public.integrations.controller.ts`

**Files:**
- Modify: `apps/backend/src/public-api/routes/v1/public.integrations.controller.ts`
- Test: `apps/backend/src/public-api/routes/v1/public.integrations.controller.spec.ts` (ver como o spec instancia o controller — ele usa `jest.mock('./public.integrations.controller', …)` parcial e `makeIntegrationService`; seguir o padrão existente para os casos novos)

- [ ] **Step 1: Specs (RED)** — adicionar ao spec existente:

```ts
  describe('canais (enable/disable/settings)', () => {
    it('POST /integrations/:id/enable valida o escopo e habilita com o limite do plano', async () => {
      integrationService.getIntegrationInScope.mockResolvedValue({ id: 'int-1' });
      integrationService.enableChannel.mockResolvedValue({ id: 'int-1', disabled: false });

      await controller.enableChannel({ id: 'org-1' } as any, 'prof-1', 'int-1', undefined);

      expect(integrationService.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
      expect(integrationService.enableChannel).toHaveBeenCalledWith('org-1', expect.any(Number), 'int-1', 'prof-1');
    });

    it('POST /integrations/:id/disable valida o escopo e desabilita', async () => {
      integrationService.getIntegrationInScope.mockResolvedValue({ id: 'int-1' });
      integrationService.disableChannel.mockResolvedValue({ id: 'int-1', disabled: true });

      await controller.disableChannel({ id: 'org-1' } as any, undefined, 'int-1', 'prof-2');

      expect(integrationService.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-2');
      expect(integrationService.disableChannel).toHaveBeenCalledWith('org-1', 'int-1');
    });

    it('POST /integrations/:id/settings grava a string JSON e chave de perfil divergente -> 403', async () => {
      integrationService.getIntegrationInScope.mockResolvedValue({ id: 'int-1' });
      integrationService.updateProviderSettings.mockResolvedValue(undefined);

      const r = await controller.updateProviderSettings({ id: 'org-1' } as any, 'prof-1', 'int-1', undefined, {
        additionalSettings: '[{"title":"Verified","value":true}]',
      } as any);
      expect(integrationService.updateProviderSettings).toHaveBeenCalledWith('org-1', 'int-1', '[{"title":"Verified","value":true}]');
      expect(r).toEqual({ ok: true });

      await expect(
        controller.updateProviderSettings({ id: 'org-1' } as any, 'prof-1', 'int-1', 'prof-9', { additionalSettings: '[]' } as any)
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('escopo de perfil em posts', () => {
    it('GET /posts filtra pelo perfil da chave', async () => {
      postsService.getPosts.mockResolvedValue([]);
      await controller.getPosts({ id: 'org-1' } as any, 'prof-1', { startDate: 'a', endDate: 'b' } as any);
      expect(postsService.getPosts).toHaveBeenCalledWith('org-1', expect.objectContaining({ startDate: 'a' }), 'prof-1');
    });

    it('DELETE /posts/:id e /posts/group/:group apagam so no perfil da chave (404 fora)', async () => {
      postsService.getPostInScope.mockResolvedValue({ id: 'p1', group: 'g1' });
      postsService.deletePost.mockResolvedValue({ id: 'p1' });
      await controller.deletePost({ id: 'org-1' } as any, 'prof-1', 'p1');
      expect(postsService.getPostInScope).toHaveBeenCalledWith('org-1', 'p1', 'prof-1');
      expect(postsService.deletePost).toHaveBeenCalledWith('org-1', 'g1', 'prof-1');

      postsService.getGroupInScope.mockResolvedValue([{ id: 'p1' }]);
      await controller.deletePostByGroup({ id: 'org-1' } as any, 'prof-1', 'g1');
      expect(postsService.getGroupInScope).toHaveBeenCalledWith('org-1', 'g1', 'prof-1');
      expect(postsService.deletePost).toHaveBeenLastCalledWith('org-1', 'g1', 'prof-1');
    });
  });
```

(Adicionar `getIntegrationInScope`, `enableChannel`, `disableChannel`, `updateProviderSettings` em `makeIntegrationService` e `getPostInScope`, `getGroupInScope`, `deletePost`, `getPosts` no mock de `PostsService` do spec, conforme o arquivo já faz para os outros métodos.)

- [ ] **Step 2: Rodar e ver falhar** — `--selectProjects backend --testPathPattern "public\.integrations"`; Expected: FAIL.

- [ ] **Step 3: Implementar**

(a) Imports novos no topo: `Throttle` de `@nestjs/throttler`; `pricing` de `@gitroom/nestjs-libraries/database/prisma/subscriptions/pricing`; `UpdateIntegrationSettingsDto` de `@gitroom/nestjs-libraries/dtos/integrations/update.integration.settings.dto`; `ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiBody` de `@nestjs/swagger` (junto de `ApiSecurity, ApiTags`).

(b) `GET /posts` — trocar por:

```ts
  @Get('/posts')
  @ApiQuery({ name: 'profileId', required: false })
  async getPosts(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Query() query: GetPostsDto & { profileId?: string }
  ) {
    Sentry.metrics.count('public_api-request', 1);
    if (publicApiProfileId && query.profileId && query.profileId !== publicApiProfileId) {
      throw new HttpException({ msg: 'Profile key cannot access another profile' }, 403);
    }
    // Chave de perfil ve so os posts do perfil (mesma regra do dashboard).
    const posts = await this._postsService.getPosts(org.id, query, publicApiProfileId ?? query.profileId);
    return { posts };
  }
```

(c) `DELETE /posts/:id` e `DELETE /posts/group/:group`:

```ts
  @Delete('/posts/:id')
  @ApiResponse({ status: 404, description: 'Post fora do seu escopo' })
  async deletePost(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const post = await this._postsService.getPostInScope(org.id, id, publicApiProfileId);
    return this._postsService.deletePost(org.id, post.group, publicApiProfileId);
  }

  @Delete('/posts/group/:group')
  @ApiResponse({ status: 404, description: 'Grupo fora do seu escopo' })
  async deletePostByGroup(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('group') group: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    await this._postsService.getGroupInScope(org.id, group, publicApiProfileId);
    return this._postsService.deletePost(org.id, group, publicApiProfileId);
  }
```

(d) `GET /social/:integration` — adicionar `@GetPublicApiProfileId() publicApiProfileId: string | undefined` e `@Query('profileId') profileId?: string` aos parâmetros; após `ioRedis.set(\`login:${state}\`…)`:

```ts
      // Perfil da chave (ou ?profileId) viaja no state: o callback grava o
      // canal ja no perfil certo, em vez de deixa-lo sem perfil (compartilhado).
      const effectiveProfileId = publicApiProfileId ?? profileId;
      if (publicApiProfileId && profileId && profileId !== publicApiProfileId) {
        throw new HttpException({ msg: 'Profile key cannot access another profile' }, 403);
      }
      if (effectiveProfileId) {
        await ioRedis.set(`profile:${state}`, effectiveProfileId, 'EX', 3600);
      }
```

(a checagem de 403 deve vir **antes** do `try` para não cair no `catch` genérico que devolve 500 — mover a validação para logo após `Sentry.metrics.count`).

(e) Rotas novas de canal (após `@Delete('/integrations/:id')`):

```ts
  @Post('/integrations/:id/enable')
  @ApiOperation({ summary: 'Reativar um canal desativado' })
  @ApiParam({ name: 'id', description: 'ID do canal' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 404, description: 'Canal inexistente' })
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  async enableChannel(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._integrationService.getIntegrationInScope(org.id, id, effectiveProfileId);
    return this._integrationService.enableChannel(
      org.id,
      (org as any)?.subscription?.totalChannels || pricing.FREE.channel,
      id,
      effectiveProfileId
    );
  }

  @Post('/integrations/:id/disable')
  @ApiOperation({ summary: 'Desativar um canal (posts agendados nele deixam de sair)' })
  @ApiParam({ name: 'id', description: 'ID do canal' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 404, description: 'Canal inexistente' })
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  async disableChannel(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId?: string
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._integrationService.getIntegrationInScope(org.id, id, effectiveProfileId);
    return this._integrationService.disableChannel(org.id, id);
  }

  @Post('/integrations/:id/settings')
  @ApiOperation({
    summary: 'Atualizar as configurações do provedor de um canal',
    description: 'Mesmo formato de `GET /integration-settings/:id`: array de `{ title, value }`.',
  })
  @ApiParam({ name: 'id', description: 'ID do canal' })
  @ApiQuery({ name: 'profileId', required: false })
  @ApiBody({ type: UpdateIntegrationSettingsDto })
  @ApiResponse({ status: 403, description: 'Canal de outro perfil' })
  @ApiResponse({ status: 404, description: 'Canal inexistente' })
  @Throttle({ default: { limit: 30, ttl: 3600_000 } })
  @UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  async updateProviderSettings(
    @GetOrgFromRequest() org: Organization,
    @GetPublicApiProfileId() publicApiProfileId: string | undefined,
    @Param('id') id: string,
    @Query('profileId') profileId: string | undefined,
    @Body() body: UpdateIntegrationSettingsDto
  ) {
    Sentry.metrics.count('public_api-request', 1);
    const effectiveProfileId = this.resolveProfileId(publicApiProfileId, profileId);
    await this._integrationService.getIntegrationInScope(org.id, id, effectiveProfileId);
    await this._integrationService.updateProviderSettings(org.id, id, body.additionalSettings);
    return { ok: true };
  }
```

(f) Extrair o helper `resolveProfileId` (mesmo corpo do `PublicFlowsController`) como método privado da classe e usá-lo também em `listIntegration` no lugar do `if` inline (comportamento idêntico).

- [ ] **Step 4: Rodar e ver passar** — Expected: PASS (todo o spec).
- [ ] **Step 5: Commit** — `feat(api): ativar/desativar/configurar canal, perfil no OAuth e escopo de perfil em posts`

---

### Task 7: Registro no módulo + `tsc`

**Files:**
- Modify: `apps/backend/src/public-api/public.api.module.ts`

- [ ] **Step 1:** importar `PublicPostsController` e `PublicMediaController` e incluí-los em `authenticatedController` (o array alimenta `controllers` **e** `PublicAuthMiddleware.forRoutes` — sem isso a rota fica pública ou 404, como aconteceu na entrega 1):

```ts
import { PublicPostsController } from '@gitroom/backend/public-api/routes/v1/public.posts.controller';
import { PublicMediaController } from '@gitroom/backend/public-api/routes/v1/public.media.controller';

const authenticatedController = [
  PublicFlowsController,
  PublicPostsController,
  PublicMediaController,
  PublicIntegrationsController,
  PublicProfilesController,
];
```

`OrganizationService` já é exportado por `DatabaseModule` (global) — se o `tsc`/boot reclamar de provider, adicioná-lo a `providers` do módulo.

- [ ] **Step 2:** `node node_modules/typescript/bin/tsc --noEmit -p apps/backend/tsconfig.build.json` → 0 erros; `--selectProjects backend --testPathPattern "public\."` → todos verdes.
- [ ] **Step 3: Commit** — `feat(api): registra PublicPostsController e PublicMediaController`

---

### Task 8: Documentação e CHANGELOG

**Files:**
- Create: `docs/api/posts-midia-canais.md`
- Modify: `CHANGELOG.md` (`[Unreleased] / ### Adicionado`), `README.md` (seção n8n: link), `apps/backend/CLAUDE.md` (linha de `src/public-api/` no mapa: citar os 3 controllers), `docs/api/automacoes-e-dm.md` (link cruzado no fim)

- [ ] **Step 1:** escrever `docs/api/posts-midia-canais.md` no mesmo formato do guia da entrega 1: base/auth, tabela de rotas por área (Posts — incluindo o **upsert de `POST /posts`**: reenviar com o mesmo `group` e `posts[].value[].id` edita em vez de criar; Mídia; Canais — incluindo o `GET /social/:provider` já existente e o `profile` no state), exemplos `curl` de cada rota, tabela de erros (401/400/403/404/412/429) e a nota de escopo (posts estritos por perfil → 404; mídia/canal sem perfil = compartilhado → 403).
- [ ] **Step 2:** CHANGELOG — entrada única em pt-BR com acentos descrevendo o impacto para o usuário (o que passa a dar para fazer por API), mais a correção "`GET /posts` e `DELETE /posts/*` da API pública passam a respeitar o perfil da chave" em `### Corrigido`.
- [ ] **Step 3:** README (bullet apontando o guia novo) e `apps/backend/CLAUDE.md` (mapa de arquivos).
- [ ] **Step 4: Commit** — `docs(api): guia da API publica de posts, midia e canais + changelog`

---

### Task 9: Verificação, pipeline e entrega

- [ ] **Step 1:** Jest backend (`public\.`) e libs (`posts/posts\.service|media|integration\.service|organization\.service|update\.integration`) verdes; `tsc` backend e orchestrator 0.
- [ ] **Step 2:** `code-reviewer` + `security-auditor` em paralelo (superfície: escopo de perfil em posts/mídia/canais, `getOwnerUserId` como autor, `profile:${state}` no OAuth, DTO de settings com JSON); aplicar MUST FIX; `doc-maintainer`; `feature-acceptance-reviewer`.
- [ ] **Step 3:** PR em `marcelofrbr/robo-multipost` com `--base feat/atendimento-dm-ia`; merge; workflow "Build all-features image"; no VPS `docker pull` + `docker service update --image ... --detach multpost_multipost`.
- [ ] **Step 4:** validação em produção com a chave do perfil MFPRO (de dentro do VPS, sem imprimir a chave): `GET /media?page=1` (200), `GET /posts?...` com um post do perfil → `GET /posts/:id` (200) / `GET /posts/group/:group` (200) / `GET /posts/:id/statistics` (200) → `POST /posts/:id/comments` (201) → `PUT /posts/:id/date` com `action=update` para a **mesma** data (200); `GET /flows/integrations/<ig>/webhook-status` continua `ok:true`; `POST /integrations/<ig>/settings` com o mesmo array de `GET /integration-settings/<ig>` (200); `DELETE /media/<id de mídia de teste>` só se houver mídia descartável; 404/403 de contrato.
