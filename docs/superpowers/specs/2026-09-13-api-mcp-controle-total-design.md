# API pública e MCP com controle total (exceto segredos) — design

**Data:** 2026-09-13 · **Status:** aprovado pelo dono · **Escopo:** 3 entregas independentes (3 PRs)

## Problema

O dono vai comandar o Robô MultiPost por um aplicativo externo (REST e MCP). Hoje a REST pública de produção cobre posts/mídia/canais/métricas mas **não** automações nem DM; o MCP externo cobre automações/DM/mídia/IA mas **não** listar/apagar posts, métricas, perfis nem editar automações. Editar post já existe (`POST /posts` é upsert) mas não está documentado.

## Objetivo

Tudo que é **conteúdo e operação** (posts, mídia, canais, automações, bot de DM, métricas) controlável por REST **e** por MCP, com paridade entre os dois. Segredos e administração (chave Zernio, credenciais Meta/IA, membros, perfis, conclusão de OAuth) ficam **só na tela** — uma chave de API vazada não pode dar controle da conta.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Fonte das automações na REST | Portar `public.flows.controller` da `maiconramos/main` (mesmo `FlowsService`) e estender | Código já revisado; produção tem o mesmo service |
| Guard de integração | Portar `FlowsService.assertIntegrationAccess` (412 se inexistente/desativada, 403 se de outro perfil) e chamá-lo em `createFlow`/`quickCreateFlow`/`quickUpdateFlow` | Fecha IDOR por `integrationId` na API pública |
| Escopo de perfil | Chave por perfil só opera no próprio perfil (`?profileId`/body divergente → 403); chave de org sem `profileId` → perfil Default | Padrão já usado em `public.integrations`/`public.flows` |
| Validação | `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })` **por controller novo** | Anti mass-assignment sem mexer no pipe global |
| MCP | Uma tool por capacidade, mesmo padrão das 20 existentes (`createTool` + `getAuth`/`getProfileId`), registrada em `tool.list.ts` | O MCP externo expõe `agent.listTools()` |
| Segredos | Fora (nem leitura) | Decisão do dono |
| Docs | Swagger em cada endpoint + `docs/api/` + CHANGELOG | Document-First |

## Entrega 1 — REST: automações e DM (`feat/api-automacoes`)

Endpoints em `/public/v1` (todos com `Sentry.metrics.count('public_api-request')` como os demais):

| Método | Rota | Serviço |
|---|---|---|
| GET/POST | `/flows` | `getFlows` / `quickCreateFlow` (porte) |
| GET/PUT/DELETE | `/flows/:id` | `getFlow` / `quickUpdateFlow` / `deleteFlow` (porte) |
| POST | `/flows/:id/status` | `updateFlowStatus` (porte) |
| GET | `/flows/integrations/:integrationId/posts` · `/stories` | `getInstagramPostsByIntegration` / `getInstagramStoriesByIntegration` |
| GET | `/flows/integrations/:integrationId/webhook-status` | `checkIntegrationWebhook` |
| GET | `/flows/:id/executions` (`?page&limit`) · `/flows/:id/executions/:executionId` | `getExecutions` / `getExecution` |
| POST | `/flows/dm/bot` (`DmBotConfigDto`) | `createOrUpdateDirectMessageBotFlow` |
| GET | `/flows/dm/escalations` · POST `/flows/dm/escalations/:id/resolve` | `DmFlowService.listEscalations` / `resolveConversation` |

Regras: `integrationId` sempre validado por `assertIntegrationAccess`; rotas de leitura por `id` verificam org+perfil (os services já filtram por `orgId`/`profileId`). `flow.dto.ts` recebe as anotações Swagger e validadores da `main` (`IsPublicHttpsUrl`, `MaxLength`, `ArrayNotEmpty`) mantendo `DmBotConfigDto`.

## Entrega 2 — REST: posts, mídia, canais (`feat/api-posts-midia-canais`)

| Método | Rota | Serviço |
|---|---|---|
| GET | `/posts/:id` · `/posts/group/:group` · `/posts/:id/statistics` | `getPost` / `getPostsByGroup` / `getStatistics` |
| PUT | `/posts/:id/date` (`{ date, action? }`) | `changeDate` |
| POST | `/posts/:id/comments` (`{ comment }`) | `createComment` (autor = dono da org) |
| — | `POST /posts` documentado como upsert (`group` + `posts[].value[].id` editam) | Swagger |
| GET | `/media` (`page`, `from`, `to` — `GetMediaQueryDto`) | `getMedia` |
| DELETE | `/media/:id` | `deleteMedia` |
| POST | `/media/information` (`SaveMediaInformationDto`) | `saveMediaInformation` |
| POST | `/integrations/:id/enable` · `/disable` | `enableChannel` / `disableChannel` (após `validateIntegrationProfile`) |
| POST | `/integrations/:id/settings` (`{ additionalSettings }`) | `updateProviderSettings` |
| GET | `/integrations/social/:provider` | URL de OAuth (o consentimento é no navegador) |

## Entrega 3 — MCP: paridade (`feat/mcp-paridade`)

Tools novas (id → serviço): `listPosts`, `getPost`, `deletePost`, `changePostDate`, `findFreeSlot`, `postStatistics`, `createPostComment`, `integrationAnalytics`, `postAnalytics`, `listProfiles`, `listNotifications`, `deleteMedia`, `saveMediaInformation`, `integrationEnable`, `integrationDisable`, `integrationSettings`, `integrationAuthUrl`, `getAutomation`, `updateAutomation`, `deleteAutomation`, `automationExecutions`, `webhookStatus`, `resolveDmEscalation`. `listMedia` ganha `from`/`to`. Cada tool: schema zod de entrada/saída, erro claro sem org no contexto, spec co-locado.

## Erros e limites

- Sem `Authorization` → 401 (middleware); chave de perfil em recurso de outro perfil → 403; integração inexistente/desativada → 412; corpo com campo extra → 400 (whitelist).
- Rate limit: `@Throttle` nos POST de automação (porte).
- Nada de segredo em respostas (tokens de integração nunca serializados — os services já omitem).

## Testes

- Jest: spec por controller (padrão `public.flows.controller.spec.ts` da `main`: service mockado, `@sentry/nestjs` e `integration.manager` mockados) cobrindo 200/403/412 e o escopo de perfil; `FlowsService.assertIntegrationAccess` (3 casos); specs das tools MCP (padrão `createMock`).
- `tsc` limpo; Swagger renderizando; validação em produção com a chave do perfil MFPRO (curl) e via MCP.

## Fora do escopo

Segredos/credenciais, membros/perfis, conclusão de OAuth, Zernio invites, repost rules, tags, review links, MCP local (`apps/mcp-local`).
