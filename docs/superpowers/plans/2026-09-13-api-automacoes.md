# API pública — automações e DM (entrega 1) · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expor automações de comentário/story, execuções, alvos, status do webhook e bot/escalações de DM na API pública (`/public/v1`), com escopo de perfil da chave e guard de integração.

**Architecture:** Porte do `public.flows.controller` da `maiconramos/main` (mesmo `FlowsService` de produção) + extensão com handlers que espelham o controller privado (`flows.controller.ts`). `FlowsService.assertIntegrationAccess` fecha IDOR por `integrationId` (412/403). DTOs de flow ganham Swagger e validadores; `DmBotConfigDto` e `handoffToBot` de produção preservados.

**Tech Stack:** NestJS 11, class-validator/class-transformer, Swagger, Jest (`describe`/`it` em pt-BR sem acentos).

Spec: `docs/superpowers/specs/2026-09-13-api-mcp-controle-total-design.md` (Entrega 1).

Comandos deste worktree: `node node_modules/jest/bin/jest.js --selectProjects <backend|nestjs-libraries> --testMatch "**/src/**/*.spec.ts" --testPathPattern "<padrao>"`; `node node_modules/typescript/bin/tsc --noEmit -p apps/backend/tsconfig.build.json`. **Nunca** combinar `git commit` com `sed -n`/`grep -n` no mesmo comando (o hook pré-bash lê `-n` como `--no-verify`).

---

### Task 1: Porte do controller, DTOs e validador — ✅ feito (commit 3caef002)

- [x] `libraries/nestjs-libraries/src/dtos/validators/is-public-https-url.validator.ts` (da `main`)
- [x] `libraries/nestjs-libraries/src/dtos/flows/flow.dto.ts` = versão da `main` + `handoffToBot` + `DmBotConfigDto`
- [x] `apps/backend/src/public-api/routes/v1/public.flows.controller.ts` + `.spec.ts` (15 casos)
- [x] Registro em `apps/backend/src/public-api/public.api.module.ts`

### Task 2: Guard `assertIntegrationAccess` — ✅ feito (commit 3caef002)

- [x] RED: 4 casos em `flows/__tests__/flows.service.spec.ts` (412 inexistente, 412 desativada, 403 outro perfil em `quickCreateFlow`, 403 em `quickUpdateFlow`)
- [x] GREEN: método privado + chamadas em `createFlow`, `quickCreateFlow`, `quickUpdateFlow` (78/78)

### Task 3: Rotas novas — ✅ feito (commit 9e8fcc0b)

- [x] RED: 9 casos novos no spec do controller (execuções, alvos, webhook, DM)
- [x] GREEN: `listExecutions`, `getExecution` (404 fora do escopo), `listIntegrationPosts`, `listIntegrationStories`, `webhookStatus`, `configureDmBot`, `listDmEscalations`, `resolveDmEscalation` (24/24; `tsc` 0)

### Task 4: Documentação e CHANGELOG

**Files:**
- Create: `docs/api/automacoes-e-dm.md` — guia em pt-BR: autenticação (chave de perfil), fluxo "criar automação para o próximo post", exemplos `curl` de cada rota, códigos de erro (401/403/404/412).
- Modify: `CHANGELOG.md` — `[Unreleased] / ### Adicionado`.

- [ ] **Step 1:** escrever `docs/api/automacoes-e-dm.md`
- [ ] **Step 2:** entrada no CHANGELOG
- [ ] **Step 3:** `git add docs/api CHANGELOG.md && git commit -m "docs(api): guia da API publica de automacoes e DM"`

### Task 5: Verificação final e entrega

- [ ] **Step 1:** `jest` backend (`public.flows|public.integrations|public.profiles`) e libs (`flows/__tests__`) verdes; `tsc` backend 0
- [ ] **Step 2:** pipeline: `code-reviewer` + `security-auditor` (superfície: API pública autenticada por chave, escopo de perfil, IDOR) em paralelo; `doc-maintainer`; `feature-acceptance-reviewer`
- [ ] **Step 3:** PR em `marcelofrbr/robo-multipost` com `--base feat/atendimento-dm-ia`; merge; build `:all`; `docker pull` + `docker service update` no VPS
- [ ] **Step 4:** validação em produção com a chave do perfil MFPRO: `GET /flows` (200), `GET /flows/integrations/<ig>/webhook-status` (`ok: true`), `GET /flows/integrations/<ig>/posts` (lista), `GET /flows/dm/escalations` (200), e um `POST /flows` com `postMode=next_publication` pausado (`status: PAUSED`) seguido de `DELETE`
