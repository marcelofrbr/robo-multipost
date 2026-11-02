# Design — Automação de Comentário + IA de Direct (paridade ManyChat)

**Data:** 2026-06-02
**Status:** Design para aprovação
**Branch base:** `feat/atendimento-dm-ia`
**Perfil alvo inicial:** MFPRO (`b138c657-d836-467d-8fd7-a3d36986c819`)

## Contexto

A plataforma (fork do Postiz) **já está em produção** com agendamentos reais, MCP e outras funcionalidades em uso. Já existe uma base robusta de automação de comentário e de bot de DM com IA. O objetivo é evoluir essas duas áreas até uma **paridade funcional com o ManyChat**, no escopo **comentário + IA de Direct** — sem prejudicar nada que já roda.

## Objetivo e escopo

**Dentro do escopo:**
- Automação de **comentário** (gatilho por palavra-chave → responder comentário + DM, follow-gate, handoff).
- **IA de Direct (DM)** — bot conversacional com RAG + persona, escalação para humano.
- Recursos do ManyChat que faltam nessas duas áreas (ver roadmap).

**Fora do escopo (YAGNI por enquanto):**
- Broadcasts / sequências de DM agendadas.
- Growth tools (ref URLs, landing pages).
- CRM completo (além de tags de contato simples).

## Estado atual (gap analysis vs ManyChat)

Já existe: gatilho de comentário + story_reply, palavras-chave, responder comentário, enviar DM, follow-gate (2 etapas com botão), handoff comentário→DM, bot de DM com IA (RAG+persona), inbox de atendimento humano, limites/janela 24h/anti-prompt-injection, tools MCP (`createCommentAutomation`, `configureDmBot`, etc.).

Falta para paridade ManyChat: botões/quick-replies dentro da conversa de DM (parcial), regras por palavra-chave no DM (hoje é só IA), tags/campos de contato, analytics das automações.

## 🔒 Contrato de Segurança de Produção (princípio nº 1, inegociável)

1. **Branch separada** — nada vai direto pra produção; build + review antes de deploy (deploy disparado pelo dono).
2. **Só aditivo** — código/tabelas/colunas/enums novos. Nunca remove/renomeia/edita o caminho de **agendamento** (`PostsService.createPost`, workflows de post) nem as **tools de MCP** existentes.
3. **Teste-primeiro nos caminhos quentes** — antes de tocar em intake de DM (`DmFlowService`) ou no webhook do IG, escrever specs que travam o comportamento atual (RED → GREEN).
4. **Nasce dormente** — toda feature ligada por Flow status, por perfil; ship sem efeito até ligar.
5. **Migração idempotente** — schema novo via padrão `StartupMigrationService` (count-guard); sem DDL destrutivo.
6. **Reversível** — cada fase é um deploy isolado, revertível trocando a tag da imagem.

**Fato de isolamento:** comentário/DM/IA vivem em `FlowsService` / `DmFlowService` / webhook IG / `dmBotReplyWorkflow`. Agendamento vive em `PostsService` + workflows de post. MCP nas tools de chat. São domínios separados — adicionar no domínio de DM não edita o código de agendamento nem as tools de MCP em uso.

## Roadmap em fases (menor risco → maior)

### Fase 0 — Operacionalizar o que já existe (risco: 🟢 zero código novo)
Colocar comentário + DM IA rodando no MFPRO usando o que já existe. **Operacional, não é desenvolvimento.**

Três blocos:
1. **Webhook Meta (portão):** assinar a integração do Instagram nos campos *comments* + *messages*, com app Meta tendo `instagram_manage_comments` + `instagram_manage_messages`. **Dependência externa:** essas permissões exigem App Review da Meta; status a confirmar pelo dono. Callback `https://post.marcelofranca.pro/api/...` verificada.
2. **Automação de comentário:** criar Flow ACTIVE (post-alvo + palavras-chave → responder + DM). Conteúdo fornecido pelo dono.
3. **Bot de DM:** `enabled=true` + mensagem de fallback. Depende de IA configurada no workspace.

**Critério de sucesso:** um comentário com a palavra-chave gera resposta + DM; uma DM gera resposta do bot; execução visível sem erro; nenhum impacto em agendamento/MCP.

**Inputs necessários do dono:** confirmação das permissões Meta; IA do workspace configurada; conteúdo da automação (post, palavras-chave, resposta, DM, fallback).

### Fase 1 — Tags de contato + Analytics (risco: 🟢 baixíssimo)
- **Tags de contato:** tabela nova ligada a `DmConversation`/remetente; segmentar quem interagiu. Aditivo, não toca caminho existente.
- **Analytics:** leitura/agregação sobre `Flow`/`FlowExecution`/`DmConversation` (execuções, taxas, escalações). Read-only.

### Fase 2 — Keyword no DM + botões/quick-replies (risco: 🟡 médio, teste-primeiro)
- **Regra por palavra-chave no DM:** passo novo no intake de `DmFlowService.handleIncomingDirectMessage`, **antes** de enfileirar a IA — se casar uma regra, responde fixo; senão, segue pra IA (comportamento atual preservado).
- **Botões/quick-replies na conversa:** estende o envio da resposta do bot (aditivo).

Cada fase só começa após a anterior estável em produção.

## Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Refactor não-commitado em `flows.service.ts` (+305) | Fechar/commitar esse refactor antes de construir em cima |
| Caminho quente (intake DM, webhook IG) | Teste-primeiro travando comportamento atual + pipeline de review |
| Permissões Meta não aprovadas | Confirmar status antes da Fase 0; é o gargalo de cronograma |
| Schema | Apenas aditivo + migração idempotente |

## Próximos passos

1. Dono revisa este spec.
2. Dono confirma permissões Meta (destrava Fase 0).
3. Executar Fase 0 (operacional, colaborativo).
4. Para Fase 1 (primeiro código), gerar plano de implementação via writing-plans.
