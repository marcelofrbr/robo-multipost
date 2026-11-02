# MCP — paridade com a API pública (entrega 3) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tudo que a REST pública faz de conteúdo/operação passa a existir como tool MCP: posts (listar, ver, apagar, mudar data, horário livre, estatísticas, comentar), métricas, perfis, notificações, mídia (apagar, editar informação, listar com período), canais (ativar, desativar, configurações, URL de OAuth), automações (ver, editar, excluir, execuções, webhook) e resolver escalação de DM.

**Architecture:** Uma classe `@Injectable` por tool implementando `AgentToolInterface` (`name` + `run()` que devolve `createTool({ id, description, inputSchema, outputSchema, execute })`), agrupadas por domínio em poucos arquivos (`posts.tool.ts`, `analytics.tool.ts`, `profiles.notifications.tool.ts`, `media.manage.tool.ts`, `integration.manage.tool.ts`, extensões de `automations.tool.ts` e `dm-escalations.list.tool.ts`). Org e perfil vêm **sempre** do `AsyncLocalStorage` (`getAuth()`/`getProfileId()` de `chat/async.storage.ts`) — nunca do schema (pitfall #4 de `libraries/nestjs-libraries/src/chat/CLAUDE.md`). Cada tool reaproveita os **mesmos services e helpers de escopo** das entregas 1 e 2 (`getPostInScope`, `getGroupInScope`, `getMediaInScope`, `getIntegrationInScope`, `assertIntegrationAccess`, `getFlow` com perfil) — paridade de regra, não só de rota. Registro em `chat/tools/tool.list.ts` (o `ChatModule` espalha `...toolList` em `providers` e `LoadToolsService.loadTools()` monta o mapa; o MCP externo em `chat/start.mcp.ts` expõe `agent.listTools()`).

**Tech Stack:** Mastra `createTool` + zod, NestJS DI, Jest (`createMock<T>()`, `runWithContext({ requestId, auth: { id }, profileId }, fn)` para simular o contexto; `jest.mock('nostr-tools', …)` no topo quando o service importado cascateia até `integration.manager`).

Spec: `docs/superpowers/specs/2026-09-13-api-mcp-controle-total-design.md` (Entrega 3). Guias REST equivalentes: `docs/api/automacoes-e-dm.md`, `docs/api/posts-midia-canais.md`. Padrão de spec existente: `chat/tools/upload.media.from.url.tool.spec.ts`.

Comandos (worktree Windows): `node node_modules/jest/bin/jest.js --selectProjects nestjs-libraries --testMatch "**/src/**/*.spec.ts" --testPathPattern "chat/tools/<padrao>"`; `node node_modules/typescript/bin/tsc --noEmit -p apps/backend/tsconfig.build.json`. Nunca `git commit` junto com `-n` no mesmo comando; commit via `-F <arquivo>`.

---

## Mapa de arquivos

| Arquivo | Tools (id) |
|---|---|
| `libraries/nestjs-libraries/src/chat/tools/posts.tool.ts` (+ `.spec.ts`) | `listPosts`, `getPost`, `deletePost`, `changePostDate`, `findFreeSlot`, `postStatistics`, `createPostComment` |
| `chat/tools/analytics.tool.ts` (+ spec) | `integrationAnalytics`, `postAnalytics` |
| `chat/tools/profiles.notifications.tool.ts` (+ spec) | `listProfiles`, `listNotifications` |
| `chat/tools/media.manage.tool.ts` (+ spec) · `media.list.tool.ts` (modificar) | `deleteMedia`, `saveMediaInformation` · `listMedia` ganha `from`/`to` |
| `chat/tools/integration.manage.tool.ts` (+ spec) | `integrationEnable`, `integrationDisable`, `integrationSettings` (ler/gravar), `integrationAuthUrl` |
| `chat/tools/automations.tool.ts` (+ novo `automations.tool.spec.ts`) | + `getAutomation`, `updateAutomation`, `deleteAutomation`, `automationExecutions`, `webhookStatus`; `listInstagramPostsForAutomation` passa a enviar `getProfileId()` |
| `chat/tools/dm-escalations.list.tool.ts` (+ spec) | + `resolveDmEscalation` |
| `chat/tools/tool.list.ts` | registra as 23 tools novas |
| `libraries/nestjs-libraries/src/chat/CLAUDE.md`, `docs/api/mcp.md` (novo), CHANGELOG, README | docs |

Convenções comuns a todas as tools (repetidas em cada task para leitura fora de ordem):

```ts
const org = getAuth<{ id: string }>();
if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
const profileId = getProfileId();
```

Erros dos services (`NotFoundException`/`ForbiddenException`/`HttpException`) sobem como estão — o Mastra devolve `message` ao cliente MCP; não engolir.

---

### Task 1: `posts.tool.ts` — 7 tools de posts

**Files:**
- Create: `libraries/nestjs-libraries/src/chat/tools/posts.tool.ts`
- Test: `libraries/nestjs-libraries/src/chat/tools/posts.tool.spec.ts`

- [ ] **Step 1: Spec (RED)**

```ts
jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));

import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';
import {
  ListPostsTool, GetPostTool, DeletePostTool, ChangePostDateTool,
  FindFreeSlotTool, PostStatisticsTool, CreatePostCommentTool,
} from './posts.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1' }, profileId: 'prof-1' };
const run = (tool: any, input: any) => runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('posts tools', () => {
  it('listPosts repassa periodo e perfil do contexto', async () => {
    const posts = createMock<PostsService>();
    posts.getPosts.mockResolvedValue([{ id: 'p1', content: 'x', publishDate: new Date('2026-09-20T13:00:00Z'), integration: { id: 'i', name: 'IG', providerIdentifier: 'instagram' }, group: 'g', state: 'QUEUE' }] as any);
    const r = await run(new ListPostsTool(posts), { startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-30T00:00:00.000Z' });
    expect(posts.getPosts).toHaveBeenCalledWith('org-1', { startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-30T00:00:00.000Z' }, 'prof-1');
    expect(r.posts[0]).toMatchObject({ id: 'p1', group: 'g', integrationName: 'IG' });
  });

  it('getPost valida o escopo e devolve o grupo completo', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.getPost.mockResolvedValue({ group: 'g', posts: [{ id: 'p1', content: 'x' }] } as any);
    const r = await run(new GetPostTool(posts), { postId: 'p1' });
    expect(posts.getPostInScope).toHaveBeenCalledWith('org-1', 'p1', 'prof-1');
    expect(r.group).toBe('g');
  });

  it('deletePost apaga o grupo do post no escopo', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1', group: 'g1' } as any);
    posts.deletePost.mockResolvedValue({ id: 'p1' } as any);
    expect(await run(new DeletePostTool(posts), { postId: 'p1' })).toEqual({ deleted: true, group: 'g1' });
    expect(posts.deletePost).toHaveBeenCalledWith('org-1', 'g1', 'prof-1');
  });

  it('changePostDate valida o escopo e usa action schedule por padrao', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.changeDate.mockResolvedValue({ id: 'p1', publishDate: new Date('2026-09-21T13:00:00Z') } as any);
    const r = await run(new ChangePostDateTool(posts), { postId: 'p1', date: '2026-09-21T13:00:00.000Z' });
    expect(posts.changeDate).toHaveBeenCalledWith('org-1', 'p1', '2026-09-21T13:00:00.000Z', 'schedule', 'prof-1');
    expect(r).toEqual({ id: 'p1', publishDate: '2026-09-21T13:00:00.000Z' });
  });

  it('findFreeSlot devolve a data livre do canal', async () => {
    const posts = createMock<PostsService>();
    posts.findFreeDateTime.mockResolvedValue('2026-09-22T12:00:00.000Z' as any);
    expect(await run(new FindFreeSlotTool(posts), { integrationId: 'int-1' })).toEqual({ date: '2026-09-22T12:00:00.000Z' });
    expect(posts.findFreeDateTime).toHaveBeenCalledWith('org-1', 'int-1');
  });

  it('postStatistics valida o escopo e devolve os cliques', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.getStatistics.mockResolvedValue({ clicks: [{ short: 'a', original: 'b', clicks: '3' }] } as any);
    const r = await run(new PostStatisticsTool(posts), { postId: 'p1' });
    expect(r.clicks).toHaveLength(1);
  });

  it('createPostComment usa o dono da org como autor', async () => {
    const posts = createMock<PostsService>();
    const orgs = createMock<OrganizationService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    orgs.getOwnerUserId.mockResolvedValue('u-owner');
    posts.createComment.mockResolvedValue({ id: 'c1' } as any);
    expect(await run(new CreatePostCommentTool(posts, orgs), { postId: 'p1', comment: 'ok' })).toEqual({ id: 'c1' });
    expect(posts.createComment).toHaveBeenCalledWith('org-1', 'u-owner', 'p1', 'ok');
  });

  it('sem organizacao no contexto, lanca erro claro', async () => {
    const posts = createMock<PostsService>();
    await expect(new FindFreeSlotTool(posts).run().execute({ integrationId: 'i' } as any, {} as any)).rejects.toThrow('organizacao ausente');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — `--testPathPattern "chat/tools/posts\.tool"`; Expected: FAIL (módulo não existe).

- [ ] **Step 3: Implementar `posts.tool.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { OrganizationService } from '@gitroom/nestjs-libraries/database/prisma/organizations/organization.service';

const requireOrg = () => {
  const org = getAuth<{ id: string }>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org.id;
};

@Injectable()
export class ListPostsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'listPosts';
  run() {
    return createTool({
      id: 'listPosts',
      description:
        'Lista os posts do calendario do perfil atual num periodo (agendados, publicados, rascunhos). ' +
        'Use antes de editar, apagar ou reagendar um post — os ids voltam aqui.',
      inputSchema: z.object({
        startDate: z.string().describe('Inicio do periodo (ISO 8601)'),
        endDate: z.string().describe('Fim do periodo (ISO 8601)'),
      }),
      outputSchema: z.object({
        posts: z.array(z.object({
          id: z.string(), group: z.string(), publishDate: z.string(), state: z.string(),
          content: z.string(), integrationId: z.string(), integrationName: z.string(), provider: z.string(),
        })),
      }),
      execute: async (input: any) => {
        const orgId = requireOrg();
        const posts = await this._postsService.getPosts(orgId, { startDate: input.startDate, endDate: input.endDate } as any, getProfileId());
        return {
          posts: (posts as any[]).map((p) => ({
            id: p.id, group: p.group, publishDate: new Date(p.publishDate).toISOString(), state: p.state,
            content: p.content ?? '', integrationId: p.integration?.id ?? '', integrationName: p.integration?.name ?? '',
            provider: p.integration?.providerIdentifier ?? '',
          })),
        };
      },
    });
  }
}

@Injectable()
export class GetPostTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'getPost';
  run() {
    return createTool({
      id: 'getPost',
      description: 'Detalha um post do perfil atual: grupo, itens encadeados (thread/carrossel), midias e canal.',
      inputSchema: z.object({ postId: z.string() }),
      outputSchema: z.object({
        group: z.string().optional(),
        posts: z.array(z.object({ id: z.string(), content: z.string(), publishDate: z.string().optional(), image: z.array(z.any()).optional() })),
      }),
      execute: async (input: any) => {
        const orgId = requireOrg();
        await this._postsService.getPostInScope(orgId, input.postId, getProfileId());
        const full = await this._postsService.getPost(orgId, input.postId);
        return {
          group: full.group,
          posts: (full.posts as any[]).map((p) => ({
            id: p.id, content: p.content ?? '', publishDate: p.publishDate ? new Date(p.publishDate).toISOString() : undefined, image: p.image,
          })),
        };
      },
    });
  }
}

@Injectable()
export class DeletePostTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'deletePost';
  run() {
    return createTool({
      id: 'deletePost',
      description: 'Apaga um post do perfil atual (e todo o grupo dele, se for publicacao multi-canal). Irreversivel.',
      inputSchema: z.object({ postId: z.string() }),
      outputSchema: z.object({ deleted: z.boolean(), group: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrg();
        const profileId = getProfileId();
        const post = await this._postsService.getPostInScope(orgId, input.postId, profileId);
        await this._postsService.deletePost(orgId, post.group, profileId);
        return { deleted: true, group: post.group };
      },
    });
  }
}

@Injectable()
export class ChangePostDateTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'changePostDate';
  run() {
    return createTool({
      id: 'changePostDate',
      description: 'Muda a data de um post. action=schedule (padrao) reagenda e volta para a fila; update so troca a data.',
      inputSchema: z.object({
        postId: z.string(),
        date: z.string().describe('Nova data/hora ISO 8601 (UTC)'),
        action: z.enum(['schedule', 'update']).optional(),
      }),
      outputSchema: z.object({ id: z.string(), publishDate: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrg();
        const profileId = getProfileId();
        await this._postsService.getPostInScope(orgId, input.postId, profileId);
        const updated: any = await this._postsService.changeDate(orgId, input.postId, input.date, input.action ?? 'schedule', profileId);
        return { id: updated.id, publishDate: new Date(updated.publishDate).toISOString() };
      },
    });
  }
}

@Injectable()
export class FindFreeSlotTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'findFreeSlot';
  run() {
    return createTool({
      id: 'findFreeSlot',
      description: 'Proximo horario livre de um canal, seguindo os horarios de postagem configurados nele.',
      inputSchema: z.object({ integrationId: z.string() }),
      outputSchema: z.object({ date: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrg();
        const date = await this._postsService.findFreeDateTime(orgId, input.integrationId);
        return { date: String(date) };
      },
    });
  }
}

@Injectable()
export class PostStatisticsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postStatistics';
  run() {
    return createTool({
      id: 'postStatistics',
      description: 'Cliques nos links encurtados de um post do perfil atual.',
      inputSchema: z.object({ postId: z.string() }),
      outputSchema: z.object({ clicks: z.array(z.any()) }),
      execute: async (input: any) => {
        const orgId = requireOrg();
        await this._postsService.getPostInScope(orgId, input.postId, getProfileId());
        return this._postsService.getStatistics(orgId, input.postId);
      },
    });
  }
}

@Injectable()
export class CreatePostCommentTool implements AgentToolInterface {
  constructor(private _postsService: PostsService, private _organizationService: OrganizationService) {}
  name = 'createPostComment';
  run() {
    return createTool({
      id: 'createPostComment',
      description: 'Deixa um comentario interno da equipe num post (nao vai para a rede social). Autor: dono da organizacao.',
      inputSchema: z.object({ postId: z.string(), comment: z.string().min(1).max(2000) }),
      outputSchema: z.object({ id: z.string() }),
      execute: async (input: any) => {
        const orgId = requireOrg();
        await this._postsService.getPostInScope(orgId, input.postId, getProfileId());
        const ownerId = await this._organizationService.getOwnerUserId(orgId);
        const c: any = await this._postsService.createComment(orgId, ownerId, input.postId, input.comment);
        return { id: c.id };
      },
    });
  }
}
```

- [ ] **Step 4: Rodar e ver passar** — Expected: PASS (8).
- [ ] **Step 5: Commit** — `feat(mcp): tools de posts (listar, ver, apagar, data, horario livre, estatisticas, comentario)`

---

### Task 2: `analytics.tool.ts`, `profiles.notifications.tool.ts`

**Files:**
- Create: `chat/tools/analytics.tool.ts` (+ spec), `chat/tools/profiles.notifications.tool.ts` (+ spec)

- [ ] **Step 1: Specs (RED)**

`analytics.tool.spec.ts`:

```ts
jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));
import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';
import { IntegrationAnalyticsTool, PostAnalyticsTool } from './analytics.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1', name: 'Org' }, profileId: 'prof-1' };
const run = (tool: any, input: any) => runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('analytics tools', () => {
  it('integrationAnalytics valida o escopo do canal e repassa a org inteira + dias', async () => {
    const integrations = createMock<IntegrationService>();
    integrations.getIntegrationInScope.mockResolvedValue({ id: 'int-1' } as any);
    integrations.checkAnalytics.mockResolvedValue([{ label: 'Seguidores', data: [] }] as any);
    const r = await run(new IntegrationAnalyticsTool(integrations), { integrationId: 'int-1', days: '7' });
    expect(integrations.getIntegrationInScope).toHaveBeenCalledWith('org-1', 'int-1', 'prof-1');
    expect(integrations.checkAnalytics).toHaveBeenCalledWith(ctx.auth, 'int-1', '7');
    expect(r.metrics).toHaveLength(1);
  });

  it('postAnalytics valida o escopo do post', async () => {
    const posts = createMock<PostsService>();
    posts.getPostInScope.mockResolvedValue({ id: 'p1' } as any);
    posts.checkPostAnalytics.mockResolvedValue([{ label: 'Curtidas', data: [] }] as any);
    const r = await run(new PostAnalyticsTool(posts), { postId: 'p1', days: '30' });
    expect(posts.checkPostAnalytics).toHaveBeenCalledWith('org-1', 'p1', 30);
    expect(r.metrics).toHaveLength(1);
  });
});
```

`profiles.notifications.tool.spec.ts`:

```ts
jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));
import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';
import { ListProfilesTool, ListNotificationsTool } from './profiles.notifications.tool';

const run = (tool: any, input: any, profileId?: string) =>
  runWithContext({ requestId: 'r', auth: { id: 'org-1' }, profileId }, () => tool.run().execute(input, {} as any));

describe('profiles/notifications tools', () => {
  it('listProfiles: chave de perfil ve so o proprio perfil; chave de org ve todos', async () => {
    const profiles = createMock<ProfileService>();
    profiles.getProfileById.mockResolvedValue({ id: 'prof-1', name: 'MFPRO', isDefault: false, apiKey: 'k' } as any);
    profiles.getProfilesByOrgId.mockResolvedValue([{ id: 'a', name: 'Default', isDefault: true }, { id: 'b', name: 'X', isDefault: false }] as any);

    expect((await run(new ListProfilesTool(profiles), {}, 'prof-1')).profiles).toEqual([{ id: 'prof-1', name: 'MFPRO', isDefault: false }]);
    expect((await run(new ListProfilesTool(profiles), {})).profiles).toHaveLength(2);
  });

  it('listNotifications pagina a partir de 0', async () => {
    const notifications = createMock<NotificationService>();
    notifications.getNotificationsPaginated.mockResolvedValue({ notifications: [{ id: 'n1', content: 'x', createdAt: new Date('2026-09-13T00:00:00Z') }], pages: 1 } as any);
    const r = await run(new ListNotificationsTool(notifications), { page: '0' });
    expect(notifications.getNotificationsPaginated).toHaveBeenCalledWith('org-1', 0);
    expect(r.notifications[0]).toMatchObject({ id: 'n1', content: 'x' });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar** — Expected: FAIL.

- [ ] **Step 3: Implementar**

`analytics.tool.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { PostsService } from '@gitroom/nestjs-libraries/database/prisma/posts/posts.service';

const requireOrg = <T extends { id: string }>() => {
  const org = getAuth<T>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org;
};

@Injectable()
export class IntegrationAnalyticsTool implements AgentToolInterface {
  constructor(private _integrationService: IntegrationService) {}
  name = 'integrationAnalytics';
  run() {
    return createTool({
      id: 'integrationAnalytics',
      description: 'Metricas de um canal (seguidores, alcance, etc.) nos ultimos N dias, como na tela de Analytics.',
      inputSchema: z.object({ integrationId: z.string(), days: z.string().optional().describe('7, 30 ou 90 (default 7)') }),
      outputSchema: z.object({ metrics: z.array(z.any()) }),
      execute: async (input: any) => {
        const org = requireOrg();
        await this._integrationService.getIntegrationInScope(org.id, input.integrationId, getProfileId());
        const metrics = await this._integrationService.checkAnalytics(org as any, input.integrationId, input.days ?? '7');
        return { metrics: (metrics as any[]) ?? [] };
      },
    });
  }
}

@Injectable()
export class PostAnalyticsTool implements AgentToolInterface {
  constructor(private _postsService: PostsService) {}
  name = 'postAnalytics';
  run() {
    return createTool({
      id: 'postAnalytics',
      description: 'Metricas de um post publicado (curtidas, comentarios, alcance) nos ultimos N dias.',
      inputSchema: z.object({ postId: z.string(), days: z.string().optional().describe('default 7') }),
      outputSchema: z.object({ metrics: z.array(z.any()) }),
      execute: async (input: any) => {
        const org = requireOrg();
        await this._postsService.getPostInScope(org.id, input.postId, getProfileId());
        const metrics = await this._postsService.checkPostAnalytics(org.id, input.postId, Number(input.days ?? 7));
        return { metrics: (metrics as any[]) ?? [] };
      },
    });
  }
}
```

`profiles.notifications.tool.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { AgentToolInterface } from '@gitroom/nestjs-libraries/chat/agent.tool.interface';
import { getAuth, getProfileId } from '@gitroom/nestjs-libraries/chat/async.storage';
import { ProfileService } from '@gitroom/nestjs-libraries/database/prisma/profiles/profile.service';
import { NotificationService } from '@gitroom/nestjs-libraries/database/prisma/notifications/notification.service';

const requireOrgId = () => {
  const org = getAuth<{ id: string }>();
  if (!org?.id) throw new Error('MCP: organizacao ausente no contexto');
  return org.id;
};

@Injectable()
export class ListProfilesTool implements AgentToolInterface {
  constructor(private _profileService: ProfileService) {}
  name = 'listProfiles';
  run() {
    return createTool({
      id: 'listProfiles',
      description: 'Perfis da organizacao. Com chave de perfil, devolve so o perfil atual.',
      inputSchema: z.object({}),
      outputSchema: z.object({ profiles: z.array(z.object({ id: z.string(), name: z.string(), isDefault: z.boolean() })) }),
      execute: async () => {
        const orgId = requireOrgId();
        const profileId = getProfileId();
        if (profileId) {
          const p = await this._profileService.getProfileById(orgId, profileId);
          return { profiles: p ? [{ id: p.id, name: p.name, isDefault: p.isDefault }] : [] };
        }
        const all = await this._profileService.getProfilesByOrgId(orgId);
        return { profiles: all.map((p) => ({ id: p.id, name: p.name, isDefault: p.isDefault })) };
      },
    });
  }
}

@Injectable()
export class ListNotificationsTool implements AgentToolInterface {
  constructor(private _notificationService: NotificationService) {}
  name = 'listNotifications';
  run() {
    return createTool({
      id: 'listNotifications',
      description: 'Notificacoes do app (falhas de publicacao, avisos), paginadas a partir de 0.',
      inputSchema: z.object({ page: z.string().optional() }),
      outputSchema: z.object({ pages: z.number(), notifications: z.array(z.object({ id: z.string(), content: z.string(), createdAt: z.string() })) }),
      execute: async (input: any) => {
        const orgId = requireOrgId();
        const r: any = await this._notificationService.getNotificationsPaginated(orgId, parseInt(input?.page ?? '0', 10) || 0);
        return {
          pages: r.pages ?? 0,
          notifications: (r.notifications ?? []).map((n: any) => ({ id: n.id, content: n.content, createdAt: new Date(n.createdAt).toISOString() })),
        };
      },
    });
  }
}
```

- [ ] **Step 4: Rodar e ver passar.** Confirmar as assinaturas reais de `IntegrationService.checkAnalytics(org, integration, date)`, `PostsService.checkPostAnalytics(orgId, postId, date:number)`, `ProfileService.getProfileById/getProfilesByOrgId`, `NotificationService.getNotificationsPaginated(orgId, page)` (todas já usadas pelos controllers públicos) e ajustar o shape do `output` ao retorno real.
- [ ] **Step 5: Commit** — `feat(mcp): tools de metricas, perfis e notificacoes`

---

### Task 3: mídia — `media.manage.tool.ts` + `listMedia` com período

**Files:**
- Create: `chat/tools/media.manage.tool.ts` (+ spec)
- Modify: `chat/tools/media.list.tool.ts` (adicionar `from`/`to`) — Test: `chat/tools/media.list.tool.spec.ts` (novo)

- [ ] **Step 1: Specs (RED)** — `media.manage.tool.spec.ts`:

```ts
jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));
import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { DeleteMediaTool, SaveMediaInformationTool } from './media.manage.tool';
import { MediaListTool } from './media.list.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1' }, profileId: 'prof-1' };
const run = (tool: any, input: any) => runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('media tools', () => {
  it('deleteMedia valida o escopo e apaga', async () => {
    const media = createMock<MediaService>();
    media.getMediaInScope.mockResolvedValue({ id: 'm1' } as any);
    media.deleteMedia.mockResolvedValue({ id: 'm1' } as any);
    expect(await run(new DeleteMediaTool(media), { mediaId: 'm1' })).toEqual({ deleted: true });
    expect(media.getMediaInScope).toHaveBeenCalledWith('org-1', 'm1', 'prof-1');
    expect(media.deleteMedia).toHaveBeenCalledWith('org-1', 'm1', 'prof-1');
  });

  it('saveMediaInformation valida o escopo e grava alt/thumbnail', async () => {
    const media = createMock<MediaService>();
    media.getMediaInScope.mockResolvedValue({ id: 'm1' } as any);
    media.saveMediaInformation.mockResolvedValue({ id: 'm1', alt: 'x' } as any);
    const r = await run(new SaveMediaInformationTool(media), { mediaId: 'm1', alt: 'x' });
    expect(media.saveMediaInformation).toHaveBeenCalledWith('org-1', { id: 'm1', alt: 'x', thumbnail: undefined, thumbnailTimestamp: undefined });
    expect(r).toEqual({ id: 'm1', alt: 'x' });
  });

  it('listMedia repassa from/to ao service', async () => {
    const media = createMock<MediaService>();
    media.getMediaStats.mockResolvedValue({ total: 0, totalSizeBytes: 0 } as any);
    media.getMedia.mockResolvedValue({ pages: 0, results: [] } as any);
    await run(new MediaListTool(media), { page: '2', from: '2026-09-01T03:00:00.000Z' });
    expect(media.getMedia).toHaveBeenCalledWith('org-1', 2, 'prof-1', { from: '2026-09-01T03:00:00.000Z', to: undefined });
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** `media.manage.tool.ts` (mesmo padrão: `DeleteMediaTool` → `getMediaInScope` + `deleteMedia`; `SaveMediaInformationTool` → `getMediaInScope` + `saveMediaInformation(orgId, { id, alt, thumbnail, thumbnailTimestamp })`; input `{ mediaId, alt, thumbnail?, thumbnailTimestamp? }`) e em `media.list.tool.ts` adicionar `from`/`to` (`z.string().optional()`) ao `inputSchema` e passar `{ from: input?.from, to: input?.to }` como 4º argumento de `getMedia`; descrição menciona o filtro por data de upload.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(mcp): apagar/editar midia e periodo em listMedia`

---

### Task 4: canais — `integration.manage.tool.ts`

**Files:**
- Create: `chat/tools/integration.manage.tool.ts` (+ spec)

- [ ] **Step 1: Spec (RED)**

```ts
jest.mock('nostr-tools', () => ({ SimplePool: class {}, finalizeEvent: jest.fn(), getPublicKey: jest.fn(), nip19: {} }));
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({ ioRedis: { set: jest.fn() } }));
import { runWithContext } from '@gitroom/nestjs-libraries/chat/async.storage';
import { createMock } from '@gitroom/nestjs-libraries/test';
import { IntegrationService } from '@gitroom/nestjs-libraries/database/prisma/integrations/integration.service';
import { IntegrationManager } from '@gitroom/nestjs-libraries/integrations/integration.manager';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { IntegrationEnableTool, IntegrationDisableTool, IntegrationSettingsTool, IntegrationAuthUrlTool } from './integration.manage.tool';

const ctx = { requestId: 'r', auth: { id: 'org-1', subscription: { totalChannels: 5 } }, profileId: 'prof-1' };
const run = (tool: any, input: any) => runWithContext(ctx, () => tool.run().execute(input, {} as any));

describe('integration manage tools', () => {
  it('integrationEnable/Disable validam o escopo', async () => {
    const s = createMock<IntegrationService>();
    s.getIntegrationInScope.mockResolvedValue({ id: 'int-1' } as any);
    s.enableChannel.mockResolvedValue({ id: 'int-1', disabled: false } as any);
    s.disableChannel.mockResolvedValue({ id: 'int-1', disabled: true } as any);

    expect(await run(new IntegrationEnableTool(s), { integrationId: 'int-1' })).toEqual({ id: 'int-1', disabled: false });
    expect(s.enableChannel).toHaveBeenCalledWith('org-1', 5, 'int-1', 'prof-1');
    expect(await run(new IntegrationDisableTool(s), { integrationId: 'int-1' })).toEqual({ id: 'int-1', disabled: true });
  });

  it('integrationSettings le e grava (array vira string JSON)', async () => {
    const s = createMock<IntegrationService>();
    s.getIntegrationInScope.mockResolvedValue({ id: 'int-1', additionalSettings: '[{"title":"Verified","value":true}]' } as any);
    s.updateProviderSettings.mockResolvedValue(undefined as any);

    expect(await run(new IntegrationSettingsTool(s), { integrationId: 'int-1' })).toEqual({ settings: [{ title: 'Verified', value: true }] });
    await run(new IntegrationSettingsTool(s), { integrationId: 'int-1', settings: [{ title: 'Verified', value: false }] });
    expect(s.updateProviderSettings).toHaveBeenCalledWith('org-1', 'int-1', '[{"title":"Verified","value":false}]');
  });

  it('integrationAuthUrl gera a URL e grava org/login/profile no state', async () => {
    const manager = createMock<IntegrationManager>();
    manager.getAllowedSocialsIntegrations.mockReturnValue(['instagram'] as any);
    manager.getSocialIntegration.mockReturnValue({ generateAuthUrl: async () => ({ url: 'https://meta/oauth', state: 'st', codeVerifier: 'cv' }) } as any);
    const r = await run(new IntegrationAuthUrlTool(manager), { provider: 'instagram' });
    expect(r).toEqual({ url: 'https://meta/oauth' });
    expect(ioRedis.set).toHaveBeenCalledWith('organization:st', 'org-1', 'EX', 3600);
    expect(ioRedis.set).toHaveBeenCalledWith('login:st', 'cv', 'EX', 3600);
    expect(ioRedis.set).toHaveBeenCalledWith('profile:st', 'prof-1', 'EX', 3600);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** — `IntegrationEnableTool` (`enableChannel(orgId, org.subscription?.totalChannels || pricing.FREE.channel, id, profileId)`), `IntegrationDisableTool`, `IntegrationSettingsTool` (input `{ integrationId, settings?: array }`: sem `settings` devolve `JSON.parse(integration.additionalSettings || '[]')`; com `settings`, `updateProviderSettings(orgId, id, JSON.stringify(settings))` e devolve o array gravado), `IntegrationAuthUrlTool` (replica `getIntegrationUrl` do controller público: valida `getAllowedSocialsIntegrations().includes(provider)`, rejeita `externalUrl`, `generateAuthUrl()`, grava `organization:`/`login:`/`profile:` no Redis com TTL 3600, devolve `{ url }`; descrição diz que o usuário precisa abrir a URL no navegador e que o canal nasce no perfil atual).
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** — `feat(mcp): ativar/desativar/configurar canal e URL de OAuth`

---

### Task 5: automações — estender `automations.tool.ts` + `dm-escalations.list.tool.ts`

**Files:**
- Modify: `chat/tools/automations.tool.ts` (+ Create `automations.tool.spec.ts`), `chat/tools/dm-escalations.list.tool.ts` (+ Create `dm-escalations.list.tool.spec.ts`)

- [ ] **Step 1: Specs (RED)** — `automations.tool.spec.ts` cobrindo: `getAutomation` (→ `getFlow(orgId, id, profileId)`, 404 se null), `updateAutomation` (→ `getFlow` + `quickUpdateFlow(orgId, id, body, profileId)`; input = mesmos campos de `createCommentAutomation`), `deleteAutomation` (→ `getFlow` + `deleteFlow(orgId, id, profileId)`), `automationExecutions` (→ `getFlow` + `getExecutions(orgId, id, page, limit)` com `limit` ≤ 100), `webhookStatus` (→ `assertIntegrationAccess(orgId, integrationId, profileId)` + `checkIntegrationWebhook`), e a **correção** de `listInstagramPostsForAutomation` passar `getProfileId()` como 5º argumento de `getInstagramPostsByIntegration`. `dm-escalations.list.tool.spec.ts`: `resolveDmEscalation` → `DmFlowService.resolveConversation(orgId, conversationId, profileId)`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar** as 5 classes novas no fim de `automations.tool.ts` (mesmo `requireOrg`; para `updateAutomation` reaproveitar o `inputSchema` de `CreateCommentAutomationTool` — extrair para uma constante `automationInputSchema` compartilhada), corrigir `listInstagramPostsForAutomation`, e `ResolveDmEscalationTool` em `dm-escalations.list.tool.ts`.
- [ ] **Step 4: Rodar e ver passar** — inclui os specs antigos de `automations` (se existirem em outro arquivo) continuando verdes.
- [ ] **Step 5: Commit** — `feat(mcp): ver/editar/excluir automacao, execucoes, webhook e resolver escalacao`

---

### Task 6: Registro, `tsc`, boot do MCP

**Files:**
- Modify: `chat/tools/tool.list.ts`

- [ ] **Step 1:** importar e adicionar as 23 tools em `toolList` (agrupadas por domínio, com comentário). Sem isso o `ChatModule` não instancia a classe e `LoadToolsService.loadTools()` não a expõe.
- [ ] **Step 2:** `tsc` backend e orchestrator 0; `--testPathPattern "chat/tools"` verde.
- [ ] **Step 3:** conferir que nenhuma tool nova declara `orgId`/`profileId` no `inputSchema` (grep `orgId` em `chat/tools/*.tool.ts` deve dar zero fora de comentários).
- [ ] **Step 4: Commit** — `feat(mcp): registra as tools de paridade em tool.list.ts`

---

### Task 7: Documentação e CHANGELOG

**Files:**
- Create: `docs/api/mcp.md` — guia pt-BR: como conectar (URL do MCP, header/token com a chave de perfil), tabela **tool ↔ rota REST equivalente** (as 43 tools), exemplos de uso em linguagem natural ("reagende o post X para amanhã às 9h"), regras de escopo (mesmas da REST), o que fica fora (segredos).
- Modify: `libraries/nestjs-libraries/src/chat/CLAUDE.md` (tabela de tools em `tools/` — adicionar os arquivos novos; contagem "12+ MCP tools" → "40+"), `CHANGELOG.md` (`### Adicionado`), `README.md` (bullet do guia MCP).
- [ ] **Commit** — `docs(mcp): guia de paridade MCP x REST + changelog`

---

### Task 8: Verificação, pipeline e entrega

- [ ] `code-reviewer` + `security-auditor` (superfície: tools MCP com escopo via AsyncLocalStorage, `integrationAuthUrl` gravando state no Redis, `createPostComment` com dono da org); `doc-maintainer`; `feature-acceptance-reviewer`.
- [ ] PR em `marcelofrbr/robo-multipost` `--base feat/atendimento-dm-ia`; merge; build `:all`; `docker pull` + `service update` no VPS.
- [ ] Validação em produção: conectar um cliente MCP com a chave do perfil MFPRO (ou `curl` no endpoint MCP com `tools/list` e `tools/call`) e exercitar `listProfiles`, `listPosts`, `getPost`, `findFreeSlot`, `listMedia` com `from`, `integrationSettings` (leitura), `webhookStatus`, `getAutomation` de um flow existente, `automationExecutions`; escritas reversíveis: `createPostComment` num post de teste, `changePostDate` com `action=update` para a mesma data.
