# Atendimento Conversacional no Direct (DM) com IA + Handoff de Comentario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Um bot responde DMs do Instagram de forma conversacional usando a IA do projeto (factory + Mastra), a base de conhecimento (RAG) e a persona do perfil, com guardrails obrigatorios (kill-switch por perfil, escalacao pra humano quando nao sabe, rate limit, janela de 24h da Meta). E um comentario com palavra-chave (comment_on_post) responde o comentario, abre o DM e entrega a conversa pro bot (handoff).

**Architecture:** Decisoes do usuario: (1) geracao da IA roda em **Temporal** (novo `dmBotReplyWorkflow` + activities no orchestrator), nao no webhook; (2) **UI completa** na aba Automacoes (paridade Wizard + Flow Builder) alem do MCP; (3) o bot de DM e modelado como um **Flow `triggerType=direct_message`** (status ACTIVE/PAUSED = kill-switch, config no node TRIGGER). O webhook IG ganha um branch para DM comum; o estado da conversa vive em novos models `DmConversation`/`DmMessage`. Reusa `InstagramMessagingService` (envio + janela 24h server-side da Meta), `resolveIgRoute` (token/host), `KnowledgeService.query` (RAG), `persona.helper`, `AiClientFactory`, `NotificationService` (escalacao).

**Tech Stack:** NestJS, Prisma/PostgreSQL (+pgvector), Temporal.io (`nestjs-temporal-core`), Mastra/`ai` SDK v5, Next.js 14 + React 18 + Tailwind (xyflow no Flow Builder), Redis (`ioRedis`) para rate limit, Jest (`@gitroom/nestjs-libraries/test`).

**REGRA DE ESCRITA deste plano e de todo codigo/comentario/doc:** nunca usar travessoes (em-dash). Usar ponto, virgula, dois-pontos ou parenteses. i18n obrigatorio no frontend (`useT()`, chaves pt/en). TDD obrigatorio no backend/libraries.

---

## Correcoes vinculantes (pos plan-reviewer) - LER ANTES DE CODAR

Estas correcoes sobrescrevem qualquer detalhe conflitante nas tasks abaixo:

1. **`instagram-standalone` e cidadao de primeira classe (caminho self-hosted preferido).**
   - No webhook (`processDirectMessage`, Task 1.1): filtrar `providerIdentifier === 'instagram' || providerIdentifier === 'instagram-standalone'` (NAO copiar o filtro so-`instagram` de `processStoryReply`/`processComment`).
   - Criacao do Flow `direct_message`: `FlowsService.quickCreateFlow`/`createFlow` rejeitam non-`instagram` em `checkIntegrationWebhook` (`flows.service.ts:75`, "Apenas contas do Instagram suportam automacoes"). NAO reusar esse caminho. Criar um metodo dedicado `FlowsService.createOrUpdateDirectMessageBotFlow(orgId, integrationId, { enabled, fallbackMessage }, profileId?)` que aceita `instagram` E `instagram-standalone` e NAO chama a Graph API de verificacao de webhook (o bot de DM nao depende dessa subscricao especifica). A tool `configureDmBot` (Task 4.1) usa esse metodo.

2. **`AiClientFactory.text(orgId, profileId)` retorna `TextClientResult` = `{ provider, model, modelId, fallbackModel, fallbackModelId, options, credentialId }`.** Em `DmBotService` (Task 1.2): usar `model` no `generateObject`; no catch, se `fallbackModel` existir, tentar UMA vez com `fallbackModel` antes de escalar. So escala (fail-safe) se ambos falharem. A spec deve mockar o retorno com `model` e `fallbackModel`.

3. **`handleIncomingDirectMessage` NAO vai em `FlowsService` (evitar god-service + risco de ciclo).** Criar `libraries/nestjs-libraries/src/database/prisma/dm/dm-flow.service.ts` (`DmFlowService`) que injeta `FlowsRepository` (para `getActiveDirectMessageFlow`), `DmRepository` e `TemporalService`, e expoe `handleIncomingDirectMessage`. O webhook controller injeta `DmFlowService` (alem de `FlowsService`). Spec co-locada `dm-flow.service.spec.ts`.

4. **`getActiveDirectMessageFlow(integrationId)` filtra em memoria, nao em SQL JSON.** Seguir o padrao de `getTriggerType` (`flows.service.ts`): carregar flows ACTIVE com `nodes` incluidos (reusar/estender `getActiveFlowsForIntegration`) e filtrar por `triggerType === 'direct_message'` lendo `FlowNode.data` (JSON) em JS. NAO usar `JSON_CONTAINS`/`jsonb` ad-hoc.

5. **Persona:** `persona.helper.ts` exporta `loadPersonaBlock(profileService: ProfileService, profileId?: string)`. `DmBotService` injeta `ProfileService` (ja global no `DatabaseModule`) alem de `AiClientFactory` e `KnowledgeService`. A spec mocka `ProfileService` e usa `createMock<KnowledgeService>()` (NAO instanciar `KnowledgeService` real, que puxa `KnowledgeRepository`/`pgVector`).

6. **`DmRateLimitService`** usa `import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service'` (padrao do `unmatched-comment.service.ts`). A spec usa module-mock: `jest.mock('.../redis/redis.service', () => ({ ioRedis: { incr: jest.fn(), expire: jest.fn() } }))` (NAO `createMock<Redis>()` injetado).

7. **Temporal:** `taskQueue` e `'main'` (confirmado em `flows.service.ts:1013`). Registrar `dmBotReplyWorkflow` em `apps/orchestrator/src/workflows/index.ts` (o worker resolve via `require.resolve('./workflows')`); sem o export la, `workflow.start('dmBotReplyWorkflow')` falha por workflow nao registrado.

8. **Escalacao:** usar `NotificationService.inAppNotification(orgId, subject, message, sendEmail, digest, type)` (nao existe `createNotification`). So ha contexto de `orgId`.

9. **Migracao:** rodar `pnpm prisma-db-push` em staging antes de producao (adiciona back-relations em god-nodes Organization/Integration/Profile; modelos novos sem dados, risco baixo, mas validar).

---

## File Structure

### Fase 0 - Schema e fundacoes
- Modify: `libraries/nestjs-libraries/src/database/prisma/schema.prisma` - models `DmConversation`, `DmMessage`, enum `DmConversationStatus`, back-relations em `Organization`/`Profile`/`Integration`.
- Create: `libraries/nestjs-libraries/src/database/prisma/dm/dm.repository.ts` (+ spec) - CRUD de conversa/mensagem.
- Modify: `libraries/nestjs-libraries/src/database/prisma/database.module.ts` - registra repo + services novos.

### Fase 1 - Feature 5 backend (intake de DM + bot)
- Modify: `apps/backend/src/api/routes/ig-webhook.controller.ts` - branch de DM comum em `processMessagingEvent`.
- Modify: `libraries/nestjs-libraries/src/database/prisma/flows/flows.service.ts` - `handleIncomingDirectMessage` + enqueue Temporal.
- Modify: `libraries/nestjs-libraries/src/database/prisma/flows/flows.repository.ts` - achar Flow `direct_message` ativo.
- Create: `libraries/nestjs-libraries/src/database/prisma/dm/dm-bot.service.ts` (+ spec) - geracao da resposta (RAG + persona + factory) com saida estruturada e guardrail de escalacao.
- Create: `libraries/nestjs-libraries/src/database/prisma/dm/dm-rate-limit.service.ts` (+ spec) - rate limit via Redis.

### Fase 2 - Orchestrator (Temporal)
- Create: `apps/orchestrator/src/workflows/dm-bot-reply.workflow.ts`
- Modify: `apps/orchestrator/src/activities/flow.activity.ts` - activities `generateDmReply`, `sendDmReply`, `escalateDmToHuman`, `seedDmHandoff` (Feature 6).
- Modify: registro de workflows do worker.

### Fase 3 - Feature 6 (handoff comment_on_post -> DM bot)
- Modify: `apps/orchestrator/src/workflows/flow.execution.workflow.ts` - apos opening DM, se `handoffToBot`, chama `seedDmHandoff`.
- Modify: `libraries/nestjs-libraries/src/dtos/flows/flow.dto.ts` - campo `handoffToBot` no `QuickCreateFlowDto`.
- Modify: `libraries/nestjs-libraries/src/database/prisma/flows/flows.service.ts` - `quickCreateFlow` persiste `handoffToBot`.

### Fase 4 - MCP tools
- Modify: `libraries/nestjs-libraries/src/chat/tools/automations.tool.ts` - `createCommentAutomation` aceita `handoffToBot`; novas tools `configureDmBot` e `listDmEscalations`.
- Modify: `libraries/nestjs-libraries/src/chat/tools/tool.list.ts`

### Fase 5 - Frontend (paridade Wizard + Flow Builder)
- Modify: `apps/frontend/src/components/automations/automation-wizard.component.tsx`
- Modify: `apps/frontend/src/components/automations/flow-editor.component.tsx`, `node-config-panel.tsx`, `nodes/*`
- Create: `apps/frontend/src/components/automations/dm-escalations.component.tsx`
- Modify: `react-shared-libraries/src/translation/locales/{pt,en}/translation.json`

### Fase 6 - Docs, credenciais, fechamento
- Modify: `docs/architecture/instagram-automations.md`, `docs/automacoes-instagram.md`
- Modify: `CHANGELOG.md`, `.env.example`, CLAUDE.md afetados (via doc-maintainer).

### Env nova
- `DM_BOT_RATE_LIMIT_PER_HOUR` (default 20), `DM_BOT_MAX_REPLIES_PER_CONVERSATION` (default 50). Janela de 24h e constante (regra Meta).

---

## FASE 0 - Schema e fundacoes

**Contexto factual:** `Flow.status` (enum `FlowStatus` DRAFT/ACTIVE/PAUSED) ja existe e serve de kill-switch. `triggerType` em `FlowExecution` e String livre (sem enum), entao `direct_message` nao precisa de migracao de enum. Nao existe model de conversa de DM. Migracao via `pnpm prisma-db-push` (DDL). Repo pattern: um repositorio por dominio, services nunca tocam Prisma direto.

### Task 0.1: Models DmConversation + DmMessage no schema

**Files:** Modify `schema.prisma`

- [ ] **Step 1: Adicionar enum + models + back-relations**

```prisma
enum DmConversationStatus {
  BOT_ACTIVE
  HUMAN_HANDOFF
  CLOSED
}

model DmConversation {
  id               String               @id @default(uuid())
  organizationId   String
  profileId        String?
  integrationId    String
  igAccountId      String
  igSenderId       String
  igSenderName     String?
  status           DmConversationStatus @default(BOT_ACTIVE)
  source           String               @default("direct_message")
  lastInboundAt    DateTime?
  lastBotReplyAt   DateTime?
  escalatedAt      DateTime?
  escalationReason String?
  botReplyCount    Int                  @default(0)
  createdAt        DateTime             @default(now())
  updatedAt        DateTime             @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id])
  profile      Profile?     @relation(fields: [profileId], references: [id])
  integration  Integration  @relation(fields: [integrationId], references: [id])
  messages     DmMessage[]

  @@unique([integrationId, igSenderId])
  @@index([organizationId])
  @@index([profileId])
  @@index([status])
  @@index([igAccountId])
}

model DmMessage {
  id             String   @id @default(uuid())
  conversationId String
  role           String
  text           String
  metaMid        String?  @unique
  createdAt      DateTime @default(now())

  conversation DmConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)

  @@index([conversationId])
}
```

Adicionar back-relations: `Organization` (`dmConversations DmConversation[]`), `Profile` (`dmConversations DmConversation[]`), `Integration` (`dmConversations DmConversation[]`). LEIA cada model antes (Prisma exige o campo dos dois lados).

- [ ] **Step 2:** `pnpm prisma-generate && pnpm prisma-db-push`. Expected: aplicado, client com `dmConversation`/`dmMessage`.
- [ ] **Step 3: Commit** `feat(dm): models DmConversation e DmMessage`

### Task 0.2: DmRepository

**Files:** Create `dm/dm.repository.ts` (+ spec); Modify `database.module.ts`

- [ ] **Step 1: Spec (RED)** com `createPrismaRepositoryMock('dmConversation')` (+ `dmMessage`). Cobrir `upsertConversation` (`where: { integrationId_igSenderId }`), `appendMessage`, `getRecentMessages` (orderBy createdAt desc + take), `markHandoff` (status HUMAN_HANDOFF + escalatedAt + escalationReason), `incrementBotReply` (`botReplyCount: { increment: 1 }` + lastBotReplyAt), `listEscalations(orgId, profileId?)` (status HUMAN_HANDOFF), `findByMetaMid(metaMid)` para idempotencia.
- [ ] **Step 2: Run RED** `pnpm jest libraries/nestjs-libraries/src/database/prisma/dm/dm.repository.spec.ts --no-coverage`
- [ ] **Step 3: Implementar** espelhando como `flows.repository.ts` injeta o PrismaRepository e acessa multiplas tabelas (`this._prisma.model.X`).
- [ ] **Step 4: Run GREEN** + registrar em `database.module.ts`.
- [ ] **Step 5: Commit** `feat(dm): DmRepository (conversas e mensagens)`

---

## FASE 1 - Feature 5 backend: intake de DM + geracao da resposta

**Contexto factual:** `ig-webhook.controller.ts:163` `processMessagingEvent` trata postback (`pb_`), story reply/reaction, e **ignora DM sem story** (linha 214-217). HMAC ja validado em `verifySignature` (dois secrets). `FlowsService.handleIncomingComment` (linha 895) e o molde: acha flows ativos via `_flowsRepository.getActiveFlowsForIntegration`, cria FlowExecution, e enfileira `temporalClient.workflow.start('flowExecutionWorkflow', {...})` via `this._temporalService.client.getRawClient()`. Idempotencia de DM: `DmMessage.metaMid @unique`.

### Task 1.1: Branch de DM comum no webhook

**Files:** Modify `ig-webhook.controller.ts`

- [ ] **Step 1:** No `processMessagingEvent`, antes do `if (!igStoryId) return;`, capturar DM comum:

```typescript
const incomingText: string = message?.text || '';
const incomingMid: string | undefined = message?.mid;
if (!igStoryId && !event?.postback && incomingText && incomingMid) {
  await this.processDirectMessage({
    igAccountId,
    igThreadId: recipientId,
    igMessageId: incomingMid,
    igSenderId: senderId,
    messageText: incomingText,
  });
  return;
}
```

Criar `processDirectMessage(...)` espelhando `processStoryReply`: resolve integrations via `getIntegrationsByInternalId`, filtra `instagram` E `instagram-standalone` ativos (standalone e o caminho preferido self-hosted para DM), chama `this._flowsService.handleIncomingDirectMessage({...})`.

- [ ] **Step 2:** Confirmar que echoes do bot (`event.message.is_echo` / `senderId === igAccountId`) ja sao filtrados (linha 171). Sim.
- [ ] **Step 3: Build** `pnpm --filter ./apps/backend run build`. Commit `feat(dm): webhook IG captura DM comum`

### Task 1.2: DmBotService (RAG + persona + factory + escalacao fail-safe)

**Files:** Create `dm/dm-bot.service.ts` (+ spec)

**Contexto:** `AiClientFactory.text(orgId, profileId)` -> `{ model }` (AI SDK v5). Persona via `persona.helper.ts` (LER a assinatura real). RAG via `KnowledgeService.query(profileId, query, topK)` -> `[{score,text,filename}]`. Saida estruturada com `generateObject` (`ai` SDK), schema `{ reply, escalate, reason }`. Guardrail (b): se `generateObject` falhar (modelos free instaveis, ver pitfall #11 do ai/CLAUDE.md) OU `escalate===true` OU pedir humano -> escalar (fail-safe, nunca inventa). Embrulhar trechos do KB em `<source>...</source>` (anti prompt-injection, padrao do `ai-web-search.service.ts`).

- [ ] **Step 1: Spec (RED)** com `createMock` de `AiClientFactory`, `KnowledgeService` (+ persona helper). Casos: resposta normal (chamou `query` com a msg do usuario, retorna `{reply, escalate:false}`); pedido humano ("quero falar com atendente") -> `escalate:true` sem chamar IA; fail-safe (geracao lanca/parse falha) -> `{ escalate:true, reason contem 'confianca' }` e reply vazio (nao inventa).
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implementar** `generateReply({ orgId, profileId, integrationId, history, userMessage })`: (1) heuristica regex pt/en de pedido-humano -> escala; (2) `query` RAG best-effort; (3) system prompt persona + regra "responda SOMENTE com base nos FATOS; sem base -> escalate=true, nao invente" + KB em `<source>`; (4) `const { model } = await factory.text(orgId, profileId)`; (5) `generateObject({ model, schema, system, prompt })` em try/catch, catch -> escalar; (6) retorna `{ reply, escalate, reason }`.
- [ ] **Step 4: Run GREEN** + registrar em `database.module.ts`.
- [ ] **Step 5: Commit** `feat(dm): DmBotService com RAG+persona+factory e escalacao fail-safe`

### Task 1.3: DmRateLimitService (Redis)

**Files:** Create `dm/dm-rate-limit.service.ts` (+ spec)

- [ ] **Step 1: Spec (RED)** mockando `ioRedis`. `allow(integrationId, igSenderId)`: `INCR` key `dmbot:rl:{integrationId}:{igSenderId}`, `EXPIRE` 3600 na primeira; `false` quando passa de `DM_BOT_RATE_LIMIT_PER_HOUR` (default 20).
- [ ] **Step 2-4:** RED -> implementar -> GREEN + registrar.
- [ ] **Step 5: Commit** `feat(dm): rate limit por conversa via Redis`

### Task 1.4: FlowsService.handleIncomingDirectMessage

**Files:** Modify `flows.service.ts`, `flows.repository.ts`, spec

- [ ] **Step 1: Spec (RED):** kill-switch (sem Flow direct_message ACTIVE -> no-op); idempotencia (metaMid existente -> no-op); HUMAN_HANDOFF (registra inbound, NAO enfileira bot); caminho feliz (upsert conversa BOT_ACTIVE + lastInboundAt + append DmMessage user + `workflow.start('dmBotReplyWorkflow', ...)`).
- [ ] **Step 2: Run RED**.
- [ ] **Step 3: Implementar:** `flows.repository.ts` `getActiveDirectMessageFlow(integrationId)` (status ACTIVE + node TRIGGER data triggerType=direct_message + deletedAt null). `flows.service.ts` `handleIncomingDirectMessage({ integrationId, organizationId, profileId, igAccountId, igSenderId, igSenderName, igMessageId, messageText })`: kill-switch -> idempotencia (`DmRepository.findByMetaMid`) -> upsert conversa + append -> branch handoff/humano -> enqueue Temporal (`workflowId` deterministico `dmbot-{conversationId}-{shortMid}`, mesmo `taskQueue` do flowExecutionWorkflow).
- [ ] **Step 4: Run GREEN**.
- [ ] **Step 5: Commit** `feat(dm): handleIncomingDirectMessage (kill-switch, idempotencia, enqueue Temporal)`

---

## FASE 2 - Orchestrator: dmBotReplyWorkflow + activities

**Contexto factual:** workflows em `apps/orchestrator/src/workflows/`, activities em `flow.activity.ts`. `resolveIgRoute(integration)` decide token/host. `InstagramMessagingService.sendDmWithToken`/`sendStoryReply` enviam (Meta impoe janela 24h server-side). `NotificationService` para escalacao.

### Task 2.1: Activities de DM

**Files:** Modify `flow.activity.ts`

- [ ] **Step 1:** Activities finas (chamam services das libraries):
  - `generateDmReply(input)` -> `DmRepository.getRecentMessages` + `DmBotService.generateReply` -> `{ reply, escalate, reason }`.
  - `sendDmReply(input)` -> guarda janela 24h (`lastInboundAt > 24h` -> no-op log), guarda rate limit (`DmRateLimitService.allow`) e cap `botReplyCount < DM_BOT_MAX_REPLIES_PER_CONVERSATION`, `resolveIgRoute`, `sendDmWithToken`/`sendStoryReply`, `DmRepository.appendMessage(bot)` + `incrementBotReply`.
  - `escalateDmToHuman(input)` -> `DmRepository.markHandoff` + `NotificationService` + holding message UMA vez.
  - `seedDmHandoff(input)` (Feature 6) -> `DmRepository.upsertConversation(status=BOT_ACTIVE, source='comment_handoff')`.
- [ ] **Step 2: Build** `pnpm --filter ./apps/orchestrator run build`.
- [ ] **Step 3: Commit** `feat(dm): activities de DM (gerar/enviar/escalar/handoff)`

### Task 2.2: dmBotReplyWorkflow

**Files:** Create `dm-bot-reply.workflow.ts`; Modify registro do worker

- [ ] **Step 1:** `generateDmReply` -> se `escalate` chama `escalateDmToHuman` e termina; senao `sendDmReply`. `proxyActivities` com retries/timeouts no padrao do `flow.execution.workflow.ts`. Registrar `dmBotReplyWorkflow` no worker.
- [ ] **Step 2: Build** OK. **Step 3: Commit** `feat(dm): dmBotReplyWorkflow`

---

## FASE 3 - Feature 6: handoff comment_on_post -> DM bot

**Contexto factual:** `flow.execution.workflow.ts` ja envia opening DM no branch comment_on_post. `QuickCreateFlowDto` em `dtos/flows/flow.dto.ts`. `quickCreateFlow` (flows.service.ts:550) persiste nodes.

### Task 3.1: handoffToBot no contrato e na criacao

**Files:** Modify `flow.dto.ts`, `flows.service.ts`, spec

- [ ] **Step 1: Spec (RED):** `quickCreateFlow` com `handoffToBot:true` persiste a flag no node SEND_DM.
- [ ] **Step 2-4:** `handoffToBot?: boolean` no DTO (`@IsOptional() @IsBoolean()`), persistir no `data` do SEND_DM. GREEN.
- [ ] **Step 5: Commit** `feat(dm): flag handoffToBot no comment_on_post`

### Task 3.2: Workflow do comentario chama seedDmHandoff

**Files:** Modify `flow.execution.workflow.ts`

- [ ] **Step 1:** No branch comment_on_post, APOS opening DM com sucesso, se SEND_DM tiver `handoffToBot:true`, chamar `seedDmHandoff({...})`.
- [ ] **Step 2: Build** OK. **Step 3: Commit** `feat(dm): handoff do comentario para o bot (seedDmHandoff)`

---

## FASE 4 - MCP tools

**Contexto factual:** padrao em `src/chat/tools/`: `@Injectable` `AgentToolInterface`, `run()` -> `createTool`, org/profile via `getAuth`/`getProfileId`, sem `orgId` no schema, sem `z.any()`. Registro em `tool.list.ts` (`...toolList` em chat.module; DatabaseModule @Global).

### Task 4.1: handoffToBot + configureDmBot + listDmEscalations

**Files:** Modify `automations.tool.ts`, `tool.list.ts`

- [ ] **Step 1:** `createCommentAutomation` ganha `handoffToBot: z.boolean().optional()` repassado ao DTO.
- [ ] **Step 2:** `configureDmBot`: `{ integrationId: z.string(), enabled: z.boolean(), fallbackMessage: z.string().optional() }` -> cria/atualiza Flow direct_message (status ACTIVE/PAUSED) via FlowsService.
- [ ] **Step 3:** `listDmEscalations`: lista conversas HUMAN_HANDOFF do org (`DmRepository.listEscalations`), sem orgId no schema.
- [ ] **Step 4:** Registrar em `tool.list.ts`. `pnpm jest libraries/nestjs-libraries/src/chat/ --no-coverage`.
- [ ] **Step 5: Commit** `feat(mcp): handoffToBot + configureDmBot + listDmEscalations`

---

## FASE 5 - Frontend (paridade Wizard + Flow Builder)

**Contexto factual:** Wizard `automation-wizard.component.tsx`; Flow Builder `flow-editor.component.tsx` + `node-config-panel.tsx` + `nodes/*`. Paridade Wizard<->Flow Builder OBRIGATORIA. Toda string via `useT()`; chaves pt/en. Componentes nativos (sem libs UI npm).

### Task 5.1: Wizard - trigger direct_message + config bot + toggle handoff

**Files:** Modify `automation-wizard.component.tsx`, locales pt/en

- [ ] **Step 1:** Trigger "Atendimento por DM (IA)" (`direct_message`) com enabled (kill-switch), `fallbackMessage`, `escalationNote`. No `comment_on_post`, toggle "Entregar a conversa pro bot de DM" -> `handoffToBot`. Strings via `useT()`, chaves pt/en.
- [ ] **Step 2:** `pnpm --filter ./apps/frontend exec tsc --noEmit -p tsconfig.json`. **Step 3: Commit**

### Task 5.2: Flow Builder - paridade

**Files:** Modify `flow-editor.component.tsx`, `node-config-panel.tsx`, `nodes/trigger-node.tsx`, locales

- [ ] **Step 1:** Trigger `direct_message` no canvas + campos no `node-config-panel` (mesmo triggerConfig do wizard). Badge no trigger-node. i18n.
- [ ] **Step 2:** tsc --noEmit. **Step 3: Commit**

### Task 5.3: Inbox de escalacoes

**Files:** Create `dm-escalations.component.tsx`; Modify controller REST + locales

- [ ] **Step 1:** Rota REST autenticada `GET /automations/dm/escalations` (FlowsService/DmRepository) + componente listando conversas HUMAN_HANDOFF (perfil, @usuario, ultima msg, motivo) com acao "resolver" (status CLOSED). i18n pt/en.
- [ ] **Step 2:** tsc --noEmit. **Step 3: Commit**

---

## FASE 6 - Docs, credenciais, fechamento

### Task 6.1: Setup Meta + docs de automacao
- [ ] `docs/architecture/instagram-automations.md` (gatilho `direct_message`, fluxo bot, handoff) + `docs/automacoes-instagram.md` (guia usuario). Credenciais: IG Login Standalone (ou Page Token + System User/IG User Token), assinatura do webhook no campo `messages` no painel Meta, scopes (`instagram_manage_messages`/`instagram_business_manage_messages`), janela de 24h. Commit.

### Task 6.2: CHANGELOG + env + suite
- [ ] `CHANGELOG.md` `[Unreleased]` pt-BR (Features 5 e 6, envs). `.env.example`: `DM_BOT_RATE_LIMIT_PER_HOUR`, `DM_BOT_MAX_REPLIES_PER_CONVERSATION`.
- [ ] `pnpm test:libs` verde; `pnpm --filter ./apps/frontend exec tsc --noEmit`; builds backend/orchestrator/frontend OK.

### Task 6.3: doc-maintainer + code-reviewer + security-auditor
- [ ] doc-maintainer (chat, flows/dm, social, orchestrator, frontend CLAUDE.md). code-reviewer no diff. **security-auditor obrigatorio** (webhook HMAC, branch DM novo, prompt injection RAG via `<source>`, tokens messaging, rate limit, cross-tenant na conversa por integration/org).

---

## Guardrails (rastreabilidade)

| Guardrail | Onde | Task |
|---|---|---|
| (a) liga/desliga por perfil | Flow direct_message status ACTIVE/PAUSED | 1.4, 4.1, 5.1 |
| (b) nao inventa: escala + notifica | DmBotService fail-safe + escalateDmToHuman + NotificationService | 1.2, 2.1 |
| (c) rate limit | DmRateLimitService (Redis) | 1.3, 2.1 |
| (d) nunca DM fora da janela 24h | guarda lastInboundAt em sendDmReply + Meta server-side | 0.1, 2.1 |

## Aceite

- F5: pessoa manda DM -> bot responde com persona + RAG; escala quando nao sabe; desligavel por perfil. -> Fases 0,1,2,4,5.
- F6: comentou palavra-chave -> resposta no comentario + DM inicial -> bot assume no Direct. -> Fase 3 (+ reuso 1,2).

## Self-Review (writing-plans)
- Cobertura: webhook DM (1.1), geracao IA+RAG+persona (1.2), envio+janela (2.1), guardrails a/b/c/d (tabela), handoff (3.x), MCP (4.1), UI paridade (5.x), credenciais/docs (6.1). Todo requisito tem task.
- Riscos sinalizados ao usuario antes de codar: alta complexidade (6 fases, multi-app: schema+orchestrator+backend+IA+frontend), models novos com back-relations (migracao), `generateObject` instavel em modelos free (mitigado: fail-safe escala), tamanho da Fase 5 (frontend + i18n + paridade).
- Tipos consistentes: `generateReply -> { reply, escalate, reason }` igual em service/activity/workflow. `DmConversationStatus` (BOT_ACTIVE/HUMAN_HANDOFF/CLOSED) consistente repo/service/UI. `handoffToBot` consistente DTO/quickCreateFlow/workflow/MCP.
