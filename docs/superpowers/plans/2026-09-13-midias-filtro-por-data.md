# Mídias — filtro por data · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filtrar a biblioteca de mídia pela data de upload (atalhos + período livre) na tela Mídia e no seletor do composer, com paginação correta no servidor.

**Architecture:** O `GET /media` existente ganha `from`/`to` opcionais (ISO 8601) validados por DTO; `MediaService` valida `from <= to`; `MediaRepository` usa um único `where` (com `createdAt` e `deletedAt: null`) para `count` e `findMany`. No frontend, um helper puro converte datas locais em instantes UTC, um componente `MediaDateFilter` emite `{ from, to }`, e `MediaBox` inclui o período na chave do SWR e reseta a página.

**Tech Stack:** NestJS + class-validator (backend, Jest), Next.js 14 + React 18 + Tailwind + dayjs/tz (frontend, vitest para helpers puros), i18n via `useT()` com `pt`/`en`.

Spec: `docs/superpowers/specs/2026-09-13-midias-filtro-por-data-design.md`.

Convenções do repo que valem para TODAS as tarefas:
- Backend/libraries: specs `*.spec.ts` (Jest) co-locados; `describe`/`it` em pt-BR **sem acentos**.
- Frontend: helpers puros testados com **vitest** em `*.test.ts` (rodar `pnpm exec vitest run <pasta>`); componentes não têm teste de render.
- Rodar Jest neste worktree: `node node_modules/jest/bin/jest.js --selectProjects <backend|nestjs-libraries> --testMatch "**/src/**/*.spec.ts" --testPathPattern "<padrao>"` (o `--testMatch` explícito contorna um bug do Jest no Windows com o caminho `\.claude`).
- Sem `eslint-disable`; sem libs de UI do npm; strings de UI só via `useT()` com chave em `pt` e `en`.
- Commits pequenos; assunto em pt-BR sem acentos.

---

## File structure

| Arquivo | Responsabilidade |
|---|---|
| `libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.ts` (novo) | Contrato de query do `GET /media`: `page`, `from`, `to` |
| `libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.spec.ts` (novo) | Valida o DTO (ISO válido/inválido, page numérico) |
| `libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts` | `getMedia` com `range` e `where` único |
| `libraries/nestjs-libraries/src/database/prisma/media/media.repository.spec.ts` | Casos de `getMedia` |
| `libraries/nestjs-libraries/src/database/prisma/media/media.service.ts` | `getMedia` valida `from <= to` |
| `libraries/nestjs-libraries/src/database/prisma/media/media.service.get-media.spec.ts` (novo) | Casos do service |
| `apps/backend/src/api/routes/media.controller.ts` | `getMedia` recebe o DTO |
| `apps/frontend/src/components/media/media-date-range.helper.ts` (novo) | Presets e conversão local → ISO UTC; validação |
| `apps/frontend/src/components/media/media-date-range.helper.test.ts` (novo) | vitest do helper |
| `apps/frontend/src/components/media/media-date-filter.component.tsx` (novo) | Barra de filtro (atalhos + De/Até + Limpar) |
| `apps/frontend/src/components/media/media.component.tsx` | Integra o filtro no `MediaBox` |
| `libraries/react-shared-libraries/src/translation/locales/{pt,en}/translation.json` | 9 chaves novas |
| `CHANGELOG.md` | Entrada em `[Unreleased] / Adicionado` |

---

### Task 1: DTO de query do `GET /media`

**Files:**
- Create: `libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.ts`
- Test: `libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.spec.ts
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GetMediaQueryDto } from './get-media.query.dto';

const build = (query: Record<string, unknown>) =>
  plainToInstance(GetMediaQueryDto, query);

describe('GetMediaQueryDto', () => {
  it('aceita query vazia (todos os campos opcionais)', async () => {
    const errors = await validate(build({}));
    expect(errors).toHaveLength(0);
  });

  it('converte page para numero', async () => {
    const dto = build({ page: '3' });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
    expect(dto.page).toBe(3);
  });

  it('rejeita page menor que 1', async () => {
    const errors = await validate(build({ page: '0' }));
    expect(errors.map((e) => e.property)).toEqual(['page']);
  });

  it('aceita from e to em ISO 8601', async () => {
    const errors = await validate(
      build({
        from: '2026-09-01T03:00:00.000Z',
        to: '2026-09-30T02:59:59.999Z',
      })
    );
    expect(errors).toHaveLength(0);
  });

  it('rejeita from que nao e ISO 8601', async () => {
    const errors = await validate(build({ from: '01/09/2026' }));
    expect(errors.map((e) => e.property)).toEqual(['from']);
  });

  it('rejeita to que nao e ISO 8601', async () => {
    const errors = await validate(build({ to: 'ontem' }));
    expect(errors.map((e) => e.property)).toEqual(['to']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "get-media.query.dto"`
Expected: FAIL — `Cannot find module './get-media.query.dto'`

- [ ] **Step 3: Write minimal implementation**

```typescript
// libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.ts
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Min } from 'class-validator';

export class GetMediaQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  // Instante ISO 8601 (UTC). O frontend calcula o inicio do dia no fuso do
  // usuario e envia o instante correspondente.
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  // Inclusivo: o frontend envia o fim do dia local (23:59:59.999).
  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "get-media.query.dto"`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.ts libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.spec.ts
git commit -m "feat(media): DTO de query do GET /media com from/to opcionais"
```

---

### Task 2: `MediaRepository.getMedia` com período e `where` único

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts:109-150`
- Test: `libraries/nestjs-libraries/src/database/prisma/media/media.repository.spec.ts` (append)

- [ ] **Step 1: Write the failing tests** (append ao final do arquivo de spec existente)

```typescript
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

    const where = {
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

    const where = {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "media.repository"`
Expected: FAIL — os 3 primeiros casos novos falham (o `count` atual recebe `{ where: { organization: { id } } }` sem `deletedAt`, e `createdAt` não é aplicado).

- [ ] **Step 3: Write minimal implementation** — substituir o método `getMedia` inteiro (linhas 109-150) por:

```typescript
  async getMedia(
    org: string,
    page: number,
    profileId?: string,
    range?: { from?: string; to?: string }
  ) {
    const pageNum = (page || 1) - 1;
    // Show media for the active profile + unscoped media (profileId is null)
    const profileFilter = profileId
      ? { OR: [{ profileId }, { profileId: null }] }
      : {};
    const createdAtFilter =
      range?.from || range?.to
        ? {
            createdAt: {
              ...(range.from ? { gte: new Date(range.from) } : {}),
              ...(range.to ? { lte: new Date(range.to) } : {}),
            },
          }
        : {};
    // Um unico `where` para contagem e listagem: antes a contagem ignorava
    // deletedAt e midias apagadas inflavam o numero de paginas.
    const where = {
      organizationId: org,
      deletedAt: null,
      ...profileFilter,
      ...createdAtFilter,
    };
    const pages = Math.ceil((await this._media.model.media.count({ where })) / 18);
    const results = await this._media.model.media.findMany({
      where,
      orderBy: {
        createdAt: 'desc',
      },
      select: {
        id: true,
        name: true,
        originalName: true,
        path: true,
        thumbnail: true,
        alt: true,
        thumbnailTimestamp: true,
      },
      skip: pageNum * 18,
      take: 18,
    });

    return {
      pages,
      results,
    };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "media.repository"`
Expected: PASS (todos, incluindo os pré-existentes de `getDeletableMedia` e `getMediaStats`)

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/media/media.repository.ts libraries/nestjs-libraries/src/database/prisma/media/media.repository.spec.ts
git commit -m "feat(media): getMedia filtra por periodo e conta paginas com o mesmo where"
```

---

### Task 3: `MediaService.getMedia` valida `from <= to`

**Files:**
- Modify: `libraries/nestjs-libraries/src/database/prisma/media/media.service.ts:156-158`
- Test: `libraries/nestjs-libraries/src/database/prisma/media/media.service.get-media.spec.ts` (novo)

- [ ] **Step 1: Write the failing test**

```typescript
// libraries/nestjs-libraries/src/database/prisma/media/media.service.get-media.spec.ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "media.service.get-media"`
Expected: FAIL — o 1º caso falha porque o service chama o repositório com 3 argumentos; o 3º falha porque nada é rejeitado.

- [ ] **Step 3: Write minimal implementation** — substituir o método `getMedia` (linhas 156-158) por:

```typescript
  async getMedia(
    org: string,
    page: number,
    profileId?: string,
    range?: { from?: string; to?: string }
  ) {
    if (
      range?.from &&
      range?.to &&
      new Date(range.from).getTime() > new Date(range.to).getTime()
    ) {
      throw new HttpException('from must be before or equal to to', 400);
    }
    return this._mediaRepository.getMedia(org, page, profileId, range);
  }
```

(`HttpException` já é importado no topo do arquivo. O método é `async` para que a exceção vire rejeição da Promise — como o spec espera.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "media.service"`
Expected: PASS (novo spec + `media.service.upload-from-url.spec.ts` + `media.service.generate-image.spec.ts` continuam verdes)

- [ ] **Step 5: Commit**

```bash
git add libraries/nestjs-libraries/src/database/prisma/media/media.service.ts libraries/nestjs-libraries/src/database/prisma/media/media.service.get-media.spec.ts
git commit -m "feat(media): getMedia valida periodo (from <= to) antes de consultar"
```

---

### Task 4: Controller usa o DTO

**Files:**
- Modify: `apps/backend/src/api/routes/media.controller.ts:237-243` e imports (linha ~28)

- [ ] **Step 1: Add the import** (junto dos outros DTOs de mídia)

```typescript
import { GetMediaQueryDto } from '@gitroom/nestjs-libraries/dtos/media/get-media.query.dto';
```

- [ ] **Step 2: Replace the handler**

```typescript
  @Get('/')
  getMedia(
    @GetOrgFromRequest() org: Organization,
    @GetProfileFromRequest() profile: Profile | null,
    @Query() query: GetMediaQueryDto
  ) {
    return this._mediaService.getMedia(org.id, query.page ?? 1, profile?.id, {
      from: query.from,
      to: query.to,
    });
  }
```

(O `ValidationPipe({ transform: true })` global em `apps/backend/src/main.ts` aplica o DTO e converte `page`.)

- [ ] **Step 3: Type-check the backend**

Run: `node node_modules/typescript/bin/tsc --noEmit -p apps/backend/tsconfig.build.json 2>&1 | grep -E "error TS" | head`
Expected: sem saída (0 erros)

- [ ] **Step 4: Commit**

```bash
git add apps/backend/src/api/routes/media.controller.ts
git commit -m "feat(media): GET /media aceita from/to via GetMediaQueryDto"
```

---

### Task 5: Helper puro de período (frontend)

**Files:**
- Create: `apps/frontend/src/components/media/media-date-range.helper.ts`
- Test: `apps/frontend/src/components/media/media-date-range.helper.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/frontend/src/components/media/media-date-range.helper.test.ts
import { describe, expect, it } from 'vitest';
import {
  isValidDateRange,
  presetDateRange,
  toIsoRange,
} from './media-date-range.helper';

const TZ = 'America/Sao_Paulo';
// 15/09/2026 12:00 em Sao Paulo (UTC-3) = 15:00Z
const NOW = new Date('2026-09-15T15:00:00.000Z');

describe('presetDateRange', () => {
  it('hoje: from e to no mesmo dia local', () => {
    expect(presetDateRange('today', NOW, TZ)).toEqual({
      from: '2026-09-15',
      to: '2026-09-15',
    });
  });

  it('7 dias: hoje e os 6 dias anteriores', () => {
    expect(presetDateRange('last7', NOW, TZ)).toEqual({
      from: '2026-09-09',
      to: '2026-09-15',
    });
  });

  it('30 dias: hoje e os 29 dias anteriores', () => {
    expect(presetDateRange('last30', NOW, TZ)).toEqual({
      from: '2026-08-17',
      to: '2026-09-15',
    });
  });

  it('este mes: do dia 1 ate hoje', () => {
    expect(presetDateRange('thisMonth', NOW, TZ)).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it('usa a data local do fuso, nao a UTC', () => {
    // 23:30 em Sao Paulo de 14/09 = 02:30Z de 15/09
    const lateNight = new Date('2026-09-15T02:30:00.000Z');
    expect(presetDateRange('today', lateNight, TZ)).toEqual({
      from: '2026-09-14',
      to: '2026-09-14',
    });
  });
});

describe('toIsoRange', () => {
  it('converte inicio e fim do dia local em instantes UTC', () => {
    expect(toIsoRange({ from: '2026-09-01', to: '2026-09-30' }, TZ)).toEqual({
      from: '2026-09-01T03:00:00.000Z',
      to: '2026-10-01T02:59:59.999Z',
    });
  });

  it('aceita so um dos lados', () => {
    expect(toIsoRange({ to: '2026-09-30' }, TZ)).toEqual({
      to: '2026-10-01T02:59:59.999Z',
    });
    expect(toIsoRange({ from: '2026-09-01' }, TZ)).toEqual({
      from: '2026-09-01T03:00:00.000Z',
    });
  });

  it('retorna objeto vazio sem datas', () => {
    expect(toIsoRange({}, TZ)).toEqual({});
  });
});

describe('isValidDateRange', () => {
  it('valido quando from <= to ou quando falta um dos lados', () => {
    expect(isValidDateRange({ from: '2026-09-01', to: '2026-09-01' })).toBe(true);
    expect(isValidDateRange({ from: '2026-09-01', to: '2026-09-02' })).toBe(true);
    expect(isValidDateRange({ from: '2026-09-01' })).toBe(true);
    expect(isValidDateRange({})).toBe(true);
  });

  it('invalido quando from > to', () => {
    expect(isValidDateRange({ from: '2026-09-02', to: '2026-09-01' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run apps/frontend/src/components/media`
Expected: FAIL — `Failed to resolve import "./media-date-range.helper"`

- [ ] **Step 3: Write minimal implementation**

```typescript
// apps/frontend/src/components/media/media-date-range.helper.ts
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export type MediaDatePreset = 'today' | 'last7' | 'last30' | 'thisMonth';

/** Datas locais no formato YYYY-MM-DD (o que o <input type="date"> usa). */
export interface MediaDateRange {
  from?: string;
  to?: string;
}

/** Instantes ISO 8601 (UTC) enviados ao GET /media. */
export interface MediaIsoRange {
  from?: string;
  to?: string;
}

const DAY = 'YYYY-MM-DD';

/**
 * Calcula o periodo de um atalho a partir de `now`, no fuso `tz`.
 * `last7`/`last30` incluem o dia de hoje (7 e 30 dias corridos).
 */
export function presetDateRange(
  preset: MediaDatePreset,
  now: Date,
  tz: string
): MediaDateRange {
  const today = dayjs(now).tz(tz);
  const to = today.format(DAY);
  switch (preset) {
    case 'today':
      return { from: to, to };
    case 'last7':
      return { from: today.subtract(6, 'day').format(DAY), to };
    case 'last30':
      return { from: today.subtract(29, 'day').format(DAY), to };
    case 'thisMonth':
      return { from: today.startOf('month').format(DAY), to };
  }
}

/**
 * Converte datas locais em instantes UTC: `from` vira o inicio do dia local
 * e `to` o fim do dia local (inclusivo), ambos no fuso `tz`.
 */
export function toIsoRange(range: MediaDateRange, tz: string): MediaIsoRange {
  const iso: MediaIsoRange = {};
  if (range.from) {
    iso.from = dayjs.tz(range.from, DAY, tz).startOf('day').toISOString();
  }
  if (range.to) {
    iso.to = dayjs.tz(range.to, DAY, tz).endOf('day').toISOString();
  }
  return iso;
}

/** `from` nao pode ser depois de `to`; lados ausentes sao validos. */
export function isValidDateRange(range: MediaDateRange): boolean {
  if (!range.from || !range.to) {
    return true;
  }
  return range.from <= range.to;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run apps/frontend/src/components/media`
Expected: PASS (11 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/components/media/media-date-range.helper.ts apps/frontend/src/components/media/media-date-range.helper.test.ts
git commit -m "feat(media): helper puro de periodo (atalhos, fuso, validacao)"
```

---

### Task 6: Chaves de tradução

**Files:**
- Modify: `libraries/react-shared-libraries/src/translation/locales/pt/translation.json` (logo após a chave `"you_dont_have_any_media_yet"`)
- Modify: `libraries/react-shared-libraries/src/translation/locales/en/translation.json` (mesmo ponto)

- [ ] **Step 1: Add the keys (pt)**

```json
  "media_filter_date": "Filtrar por data",
  "media_filter_today": "Hoje",
  "media_filter_last_7_days": "7 dias",
  "media_filter_last_30_days": "30 dias",
  "media_filter_this_month": "Este mês",
  "media_filter_from": "De",
  "media_filter_to": "Até",
  "media_filter_clear": "Limpar",
  "media_filter_no_results": "Nenhuma mídia neste período",
```

- [ ] **Step 2: Add the keys (en)**

```json
  "media_filter_date": "Filter by date",
  "media_filter_today": "Today",
  "media_filter_last_7_days": "7 days",
  "media_filter_last_30_days": "30 days",
  "media_filter_this_month": "This month",
  "media_filter_from": "From",
  "media_filter_to": "To",
  "media_filter_clear": "Clear",
  "media_filter_no_results": "No media in this period",
```

- [ ] **Step 3: Validate JSON**

Run: `node -e "for (const l of ['pt','en']) JSON.parse(require('fs').readFileSync('libraries/react-shared-libraries/src/translation/locales/'+l+'/translation.json','utf8')); console.log('JSON OK')"`
Expected: `JSON OK`

- [ ] **Step 4: Commit**

```bash
git add libraries/react-shared-libraries/src/translation/locales/pt/translation.json libraries/react-shared-libraries/src/translation/locales/en/translation.json
git commit -m "feat(i18n): chaves do filtro por data da biblioteca de midia (pt/en)"
```

---

### Task 7: Componente `MediaDateFilter`

**Files:**
- Create: `apps/frontend/src/components/media/media-date-filter.component.tsx`

- [ ] **Step 1: Write the component**

```tsx
// apps/frontend/src/components/media/media-date-filter.component.tsx
'use client';

import { FC, useCallback } from 'react';
import clsx from 'clsx';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
import {
  isValidDateRange,
  MediaDatePreset,
  MediaDateRange,
  presetDateRange,
} from '@gitroom/frontend/components/media/media-date-range.helper';

const PRESETS: { key: MediaDatePreset; label: string; fallback: string }[] = [
  { key: 'today', label: 'media_filter_today', fallback: 'Today' },
  { key: 'last7', label: 'media_filter_last_7_days', fallback: '7 days' },
  { key: 'last30', label: 'media_filter_last_30_days', fallback: '30 days' },
  { key: 'thisMonth', label: 'media_filter_this_month', fallback: 'This month' },
];

const inputClass =
  'bg-newBgColorInner h-[36px] border-newTableBorder border rounded-[8px] text-textColor text-[13px] px-[10px] outline-none';

const chipClass = (active: boolean) =>
  clsx(
    'h-[36px] px-[12px] rounded-[8px] text-[13px] border transition-colors',
    active
      ? 'bg-btnSimple border-transparent text-white'
      : 'bg-newBgColorInner border-newTableBorder text-textColor hover:bg-newTextColor/[0.06]'
  );

/**
 * Barra de filtro por data de upload: atalhos + periodo livre + limpar.
 * Emite datas locais (YYYY-MM-DD); quem consome converte para ISO com
 * `toIsoRange`.
 */
export const MediaDateFilter: FC<{
  value: MediaDateRange;
  onChange: (range: MediaDateRange) => void;
}> = ({ value, onChange }) => {
  const t = useT();
  const tz = getTimezone();

  const isPresetActive = useCallback(
    (preset: MediaDatePreset) => {
      const range = presetDateRange(preset, new Date(), tz);
      return range.from === value.from && range.to === value.to;
    },
    [value, tz]
  );

  const applyPreset = useCallback(
    (preset: MediaDatePreset) => () =>
      onChange(presetDateRange(preset, new Date(), tz)),
    [onChange, tz]
  );

  const setFrom = useCallback(
    (from: string) => onChange({ ...value, from: from || undefined }),
    [onChange, value]
  );

  const setTo = useCallback(
    (to: string) => onChange({ ...value, to: to || undefined }),
    [onChange, value]
  );

  const hasFilter = !!value.from || !!value.to;
  const invalid = !isValidDateRange(value);

  return (
    <div
      className="flex flex-wrap items-center gap-[8px]"
      role="group"
      aria-label={t('media_filter_date', 'Filter by date')}
    >
      {PRESETS.map((preset) => (
        <button
          key={preset.key}
          type="button"
          className={chipClass(isPresetActive(preset.key))}
          aria-pressed={isPresetActive(preset.key)}
          onClick={applyPreset(preset.key)}
        >
          {t(preset.label, preset.fallback)}
        </button>
      ))}
      <label className="flex items-center gap-[6px] text-[13px] text-textColor">
        {t('media_filter_from', 'From')}
        <input
          type="date"
          className={clsx(inputClass, invalid && 'border-red-400')}
          value={value.from || ''}
          max={value.to || undefined}
          aria-invalid={invalid}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="flex items-center gap-[6px] text-[13px] text-textColor">
        {t('media_filter_to', 'To')}
        <input
          type="date"
          className={clsx(inputClass, invalid && 'border-red-400')}
          value={value.to || ''}
          min={value.from || undefined}
          aria-invalid={invalid}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      {hasFilter && (
        <button
          type="button"
          className="h-[36px] px-[12px] rounded-[8px] text-[13px] text-textColor underline"
          onClick={() => onChange({})}
        >
          {t('media_filter_clear', 'Clear')}
        </button>
      )}
    </div>
  );
};
```

- [ ] **Step 2: Type-check**

Run: `node node_modules/typescript/bin/tsc --noEmit -p apps/frontend/tsconfig.json 2>&1 | grep -E "error TS" | head`
Expected: sem saída

- [ ] **Step 3: Commit**

```bash
git add apps/frontend/src/components/media/media-date-filter.component.tsx
git commit -m "feat(media): componente MediaDateFilter (atalhos, De/Ate, limpar)"
```

---

### Task 8: Integrar o filtro no `MediaBox`

**Files:**
- Modify: `apps/frontend/src/components/media/media.component.tsx` — imports (~linha 55), estado/`loadMedia` (linhas 209-216), barra superior (linhas 407-439) e estado vazio (linhas ~472-497)

- [ ] **Step 1: Add imports** (após a linha do `LoadingComponent`)

```tsx
import { MediaDateFilter } from '@gitroom/frontend/components/media/media-date-filter.component';
import {
  isValidDateRange,
  MediaDateRange,
  toIsoRange,
} from '@gitroom/frontend/components/media/media-date-range.helper';
import { getTimezone } from '@gitroom/frontend/components/layout/set.timezone';
```

- [ ] **Step 2: Replace state + loader** (linhas 209-216 atuais):

```tsx
  const [page, setPage] = useState(0);
  const [dateRange, setDateRange] = useState<MediaDateRange>({});
  const fetch = useFetch();
  const modals = useModals();
  const toaster = useToaster();
  // Trocar o filtro sempre volta para a primeira pagina.
  const changeDateRange = useCallback((range: MediaDateRange) => {
    setDateRange(range);
    setPage(0);
  }, []);
  const rangeQuery = useMemo(() => {
    if (!isValidDateRange(dateRange)) {
      return '';
    }
    const iso = toIsoRange(dateRange, getTimezone());
    const params = new URLSearchParams();
    if (iso.from) params.set('from', iso.from);
    if (iso.to) params.set('to', iso.to);
    const query = params.toString();
    return query ? `&${query}` : '';
  }, [dateRange]);
  const hasDateFilter = !!dateRange.from || !!dateRange.to;
  const loadMedia = useCallback(async () => {
    return (await fetch(`/media?page=${page + 1}${rangeQuery}`)).json();
  }, [page, rangeQuery]);
  const { data, mutate, isLoading } = useSWR(
    `get-media-${page}-${rangeQuery}`,
    loadMedia
  );
```

- [ ] **Step 3: Show the filter in the top bar** — o bloco atual só renderiza a barra quando há resultados (`!isLoading && !!data?.results?.length`). Com filtro ativo e zero resultados a barra precisa continuar visível (senão o usuário não consegue limpar). Substituir o `<div className={clsx('flex', !isLoading && !data?.results?.length && 'hidden')}>` e seu conteúdo (linhas 407-439) por:

```tsx
        <div
          className={clsx(
            'flex flex-col gap-[10px]',
            !isLoading && !data?.results?.length && !hasDateFilter && 'hidden'
          )}
        >
          <div className="flex">
            {!isLoading && !!data?.results?.length && (
              <div className="flex-1 text-[14px] font-[600] whitespace-pre-line">
                {t(
                  'select_or_upload_pictures_max_1gb',
                  'Select or upload pictures (maximum 1 GB per upload).'
                )}
                {'\n'}
                {t(
                  'you_can_drag_drop_pictures',
                  'You can also drag & drop pictures.'
                )}
              </div>
            )}
            <input
              type="file"
              ref={uploaderRef}
              onChange={addToUpload}
              className="hidden"
              multiple={true}
            />
            {!isLoading && (!!data?.results?.length || hasDateFilter) && (
              <div className="flex gap-[8px]">
                {btn}
                <ThirdPartyMediaLibrary onImported={() => mutate()} />
              </div>
            )}
          </div>
          <MediaDateFilter value={dateRange} onChange={changeDateRange} />
        </div>
```

- [ ] **Step 4: Empty state with active filter** — dentro do bloco `{!isLoading && !data?.results?.length && (<> ... </>)}` (o que mostra `NoMediaIcon` + "You don't have any media yet"), condicionar o conteúdo atual a `!hasDateFilter` e adicionar a variante filtrada:

```tsx
            {!isLoading && !data?.results?.length && hasDateFilter && (
              <>
                <NoMediaIcon />
                <div className="text-[20px] font-[600]">
                  {t('media_filter_no_results', 'No media in this period')}
                </div>
                <button
                  type="button"
                  className="text-[14px] text-textColor underline"
                  onClick={() => changeDateRange({})}
                >
                  {t('media_filter_clear', 'Clear')}
                </button>
              </>
            )}
            {!isLoading && !data?.results?.length && !hasDateFilter && (
              <>
                <NoMediaIcon />
                <div className="text-[20px] font-[600]">
                  {t(
                    'you_dont_have_any_media_yet',
                    "You don't have any media yet"
                  )}
                </div>
                <div className="whitespace-pre-line text-newTextColor/[0.6] text-center">
                  {t(
                    'select_or_upload_pictures_max_1gb',
                    'Select or upload pictures (maximum 1 GB per upload).'
                  )}{' '}
                  {'\n'}
                  {t(
                    'you_can_drag_drop_pictures',
                    'You can also drag & drop pictures.'
                  )}
                </div>
                <div className="forceChange flex gap-[8px]">
                  {btn}
                  <ThirdPartyMediaLibrary onImported={() => mutate()} />
                </div>
              </>
            )}
```

- [ ] **Step 5: Type-check + vitest**

Run: `node node_modules/typescript/bin/tsc --noEmit -p apps/frontend/tsconfig.json 2>&1 | grep -E "error TS" | head; pnpm exec vitest run apps/frontend/src/components/media`
Expected: sem erros de tipo; vitest 11/11

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/components/media/media.component.tsx
git commit -m "feat(media): filtro por data na biblioteca e no seletor do composer"
```

---

### Task 9: CHANGELOG

**Files:**
- Modify: `CHANGELOG.md` — `## [Unreleased]`, seção `### Adicionado` (criar se não existir, acima de `### Corrigido`)

- [ ] **Step 1: Add the entry**

```markdown
### Adicionado

- **Filtro por data na biblioteca de mídia.** Em *Mídia* (e no seletor de mídia do "Criar publicação") agora dá para filtrar pela data de upload com atalhos — Hoje, 7 dias, 30 dias, Este mês — ou um período livre (De/Até). O filtro roda no servidor (`GET /media?from=&to=`, datas ISO), então a paginação continua correta; trocar o filtro volta para a primeira página, e com o filtro ativo sem resultados aparece "Nenhuma mídia neste período" com o botão Limpar. De quebra, a contagem de páginas passou a ignorar mídias apagadas (antes inflava o número de páginas).
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): filtro por data na biblioteca de midia"
```

---

### Task 10: Verificação final

- [ ] **Step 1: Backend specs completos da área**

Run: `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "media|get-media"`
Expected: PASS em todos os suites (`media.repository`, `media.service.*`, `media.cleanup.service`, `get-media.query.dto`)

- [ ] **Step 2: Type-check dos dois apps**

Run: `node node_modules/typescript/bin/tsc --noEmit -p apps/backend/tsconfig.build.json 2>&1 | grep -c "error TS"; node node_modules/typescript/bin/tsc --noEmit -p apps/frontend/tsconfig.json 2>&1 | grep -c "error TS"`
Expected: `0` e `0`

- [ ] **Step 3: Pipeline de revisão do repo** — `code-reviewer` (e `security-auditor` só se ele escalar), `doc-maintainer`, e `feature-acceptance-reviewer` (≥ 5 arquivos, 3 áreas).

- [ ] **Step 4: Validação no navegador (produção, após deploy)** — tela Mídia e seletor do composer: atalho "7 dias", período livre, paginação com filtro (se houver > 18 itens no período), Limpar, e estado vazio com filtro.
