# Fase 0 — Operacionalizar Automações (Comentário + DM IA) no MFPRO

> **Natureza:** runbook OPERACIONAL (configuração em produção), não desenvolvimento de código. Nenhum arquivo de produção é alterado. Tudo reversível. Não toca agendamento nem MCP.

**Goal:** Deixar a automação de comentário e o bot de DM com IA rodando de verdade no perfil MFPRO, usando o que já existe.

**Architecture:** O webhook da Meta entrega eventos de comentário/DM → backend (`ig-webhook.controller`, já existente, valida HMAC) → `FlowsService`/`DmFlowService` → ação. A ativação é por Flow `ACTIVE` por perfil. Reversível pausando/apagando o Flow.

---

## ⛔ Pré-requisitos (BLOQUEIOS — fornecidos pelo dono; sem eles a Fase 0 não executa)

- **P1 — Permissões + webhook Meta:** app Meta com `instagram_manage_comments` + `instagram_manage_messages` aprovados (App Review). No painel da Meta: webhook do Instagram assinado nos campos **comments** e **messages**, callback `https://post.marcelofranca.pro/api/<rota-do-webhook-ig>`, verify token batendo com o do app. (A assinatura é manual no painel da Meta — o código não assina sozinho.)
- **P2 — IA do workspace configurada:** provider/chave de IA ativos (o bot de DM usa para gerar resposta com RAG + persona). Sem isso o bot escala tudo pra humano.
- **P3 — Conteúdo da automação de comentário:** post(s)-alvo, palavras-chave, texto(s) de resposta no comentário, mensagem de DM (+ botão opcional), e a **mensagem de fallback** do bot de DM.

## 🔒 Checagens de segurança (valem em todos os passos)
- Read-only primeiro; nenhuma alteração em `Post`/agendamento/MCP.
- Toda criação é um registro de `Flow` (reversível: pausar/soft-delete).
- Após cada passo, confirmar que agendamento e MCP seguem intactos (smoke rápido).

---

### Task 1: Confirmar que o webhook está recebendo eventos (read-only)

**Pré:** P1 feito no painel da Meta.

- [ ] **Passo 1: Verificar assinatura do webhook no banco**

Via SSH (ver `~/.claude/.../memory/vps-access.md`):
```bash
ssh -i ~/.ssh/robo_vps root@post.marcelofranca.pro \
  'PG=$(docker ps --format "{{.Names}}" | grep "^multpost_multipost-postgres" | head -1); docker exec "$PG" psql -U "$(docker exec "$PG" printenv POSTGRES_USER)" -d "$(docker exec "$PG" printenv POSTGRES_DB)" -c "SELECT \"integrationId\", count(*) FROM \"IntegrationsWebhooks\" GROUP BY \"integrationId\";"'
```
Esperado: pelo menos 1 linha para a integração do Instagram (`cmptsmbd8001yqh8u6csqfy4g`). Se vazio, o webhook não está assinado → voltar ao painel da Meta.

- [ ] **Passo 2: Teste real de chegada de evento**

Comentar manualmente em um post do Instagram do MFPRO. Em seguida, tail dos logs do app:
```bash
ssh -i ~/.ssh/robo_vps root@post.marcelofranca.pro \
  'APP=$(docker ps --format "{{.Names}}" | grep "^multpost_multipost\." | head -1); docker logs --since 3m "$APP" 2>&1 | grep -iE "ig-webhook|webhook|comment" | tail -20'
```
Esperado: linha indicando recebimento do evento de comentário (sem erro de HMAC).

---

### Task 2: Criar a automação de comentário (ACTIVE)

**Pré:** P3 (conteúdo). **Mecanismo recomendado:** UI Wizard "Automação de comentário" no MFPRO (mais seguro e visual) OU MCP `createCommentAutomation`. Evita montar payload de `/flows` à mão.

- [ ] **Passo 1: Criar via Wizard** — no app, perfil MFPRO ativo → Automações → novo → gatilho "comentário em publicação" → selecionar post-alvo → palavras-chave → ação responder comentário + DM (com o conteúdo de P3) → salvar.

- [ ] **Passo 2: Deixar ACTIVE** — publicar/ativar o Flow no Wizard.

- [ ] **Passo 3: Verificar no banco (read-only)**
```bash
ssh -i ~/.ssh/robo_vps root@post.marcelofranca.pro \
  'PG=$(docker ps --format "{{.Names}}" | grep "^multpost_multipost-postgres" | head -1); docker exec "$PG" psql -U "$(docker exec "$PG" printenv POSTGRES_USER)" -d "$(docker exec "$PG" printenv POSTGRES_DB)" -c "SELECT name, status, \"integrationId\" FROM \"Flow\" WHERE \"integrationId\"='\''cmptsmbd8001yqh8u6csqfy4g'\'' AND \"deletedAt\" IS NULL;"'
```
Esperado: o Flow recém-criado com `status = ACTIVE`.

---

### Task 3: Ligar o bot de DM (IA)

**Pré:** P2 (IA configurada) + mensagem de fallback (P3).

- [ ] **Passo 1: Ativar** — via UI (toggle "Atendimento por DM (IA)") OU MCP `configureDmBot` (`integrationId` do Instagram, `enabled=true`, `fallbackMessage=<texto de P3>`). Endpoint subjacente: `POST /flows/dm/bot` (`DmBotConfigDto`).

- [ ] **Passo 2: Verificar Flow direct_message ACTIVE (read-only)** — mesma query da Task 2 Passo 3; conferir que existe um Flow com trigger `direct_message` em `ACTIVE` para a integração do Instagram.

---

### Task 4: Smoke test ponta a ponta

- [ ] **Passo 1: Comentário** — comentar com a palavra-chave configurada num post-alvo. Esperado: resposta no comentário + DM recebida.

- [ ] **Passo 2: DM** — enviar uma DM ao MFPRO. Esperado: resposta do bot (ou escalada para humano com a fallback, se a IA decidir).

- [ ] **Passo 3: Verificar execuções + conversas (read-only)**
```bash
ssh -i ~/.ssh/robo_vps root@post.marcelofranca.pro \
  'PG=$(docker ps --format "{{.Names}}" | grep "^multpost_multipost-postgres" | head -1); U=$(docker exec "$PG" printenv POSTGRES_USER); D=$(docker exec "$PG" printenv POSTGRES_DB); docker exec "$PG" psql -U "$U" -d "$D" -c "SELECT status, count(*) FROM \"FlowExecution\" GROUP BY status;"; docker exec "$PG" psql -U "$U" -d "$D" -c "SELECT status, count(*) FROM \"DmConversation\" GROUP BY status;"'
```
Esperado: execuções com sucesso e/ou conversa de DM criada. Sem linhas de erro.

- [ ] **Passo 4: Confirmar que agendamento/MCP seguem intactos** — abrir o calendário (posts agendados aparecem normalmente) e checar que o MCP responde. Nenhuma mudança esperada (não tocamos nesses domínios).

---

### Task 5: Rollback (se algo sair errado)

- [ ] **Pausar a automação** — no Wizard, mudar o Flow para PAUSED (para imediatamente, sem apagar config).
- [ ] **Desligar o bot de DM** — `configureDmBot` `enabled=false` (ou Flow `direct_message` → PAUSED).
- [ ] Nenhuma ação de rollback toca agendamento/MCP (domínios separados).

---

## Critério de conclusão da Fase 0
Comentário com palavra-chave gera resposta + DM; DM gera resposta do bot; execuções visíveis sem erro; posts agendados e MCP inalterados. Estável por alguns dias → libera Fase 1.

## O que destrava a execução
Os 3 pré-requisitos (P1 permissões/webhook Meta, P2 IA configurada, P3 conteúdo). Assim que o dono confirmar, executamos Task 1→4 juntos.
