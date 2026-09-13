# API pública — Automações de comentário e DM

Base: `https://<seu-dominio>/api/public/v1` · Autenticação: header `Authorization: <chave de API>`.

Use a **chave do perfil** (Configurações → Desenvolvedores → chave do perfil). Ela só enxerga os canais e automações daquele perfil; pedir `?profileId` de outro perfil devolve **403**. A chave de organização opera no perfil Default (ou no `?profileId` informado).

## Pré-requisitos

1. Canal do Instagram conectado no perfil (nativo, via Meta). Pegue o `integrationId` em `GET /integrations` (`identifier: "instagram"`).
2. Webhook da Meta assinado para `comments` + `messages`. Confira:

```bash
curl -H "Authorization: $CHAVE" \
  "$BASE/flows/integrations/$IG/webhook-status"
# → { "ok": true }   (se ok=false, o campo error explica o que falta)
```

## Criar uma automação de comentário

`POST /flows` — corpo (`QuickCreateFlowDto`):

| Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|
| `name` | string ≤200 | sim | Nome da automação |
| `integrationId` | string | sim | Canal do Instagram |
| `triggerType` | `comment_on_post` \| `story_reply` | não (padrão `comment_on_post`) | Gatilho |
| `postMode` | `all` \| `specific` \| `next_publication` | não (padrão `next_publication`) | `all` = qualquer post; `specific` = só os `postIds`; `next_publication` = vincula ao **próximo** post publicado |
| `postIds` / `storyIds` | string[] ≤100 | quando `specific` | IDs de mídia do Instagram (`GET /flows/integrations/:id/posts` ou `/stories`) |
| `keywords` | string[] | não | Palavras que disparam (vazio = qualquer comentário) |
| `matchMode` | string | não | Como casar as palavras (padrão do app) |
| `matchReactions` | boolean | não | Reagir também a reações |
| `replyMessage` / `replyMessages` | string / string[] | não | Resposta pública no comentário (uma ou várias, sorteadas) |
| `dmMessage` | string | não | Mensagem enviada no Direct |
| `dmButtonText` / `dmButtonUrl` | string / URL https pública | não | Botão com link no DM |
| `requireFollow` | boolean | não | Exigir que a pessoa siga o perfil antes de receber o DM |
| `followGateMessage`, `openingDmMessage`, `openingDmButtonText`, `alreadyFollowedButtonText`, `gateExhaustedMessage`, `maxGateAttempts` | | não | Textos e limite do portão de seguir |
| `handoffToBot` | boolean | não | Depois do DM inicial, o bot de DM assume a conversa |

Exemplo — responder "quero" no próximo post, com DM e link:

```bash
curl -X POST -H "Authorization: $CHAVE" -H "Content-Type: application/json" \
  "$BASE/flows" -d '{
    "name": "Lançamento setembro",
    "integrationId": "'$IG'",
    "postMode": "next_publication",
    "keywords": ["quero", "link"],
    "replyMessage": "Te mandei no direct 🚀",
    "dmMessage": "Aqui está o link que você pediu:",
    "dmButtonText": "Acessar",
    "dmButtonUrl": "https://exemplo.com/oferta",
    "requireFollow": true
  }'
```

A automação nasce **ativa** (`status: ACTIVE`); ao ativar, o app inscreve a conta do Instagram no webhook automaticamente. Para criar pausada, chame em seguida `POST /flows/:id/status` com `{ "status": "PAUSED" }`.

## Demais rotas

| Método e rota | Faz |
|---|---|
| `GET /flows` (`?integrationId`, `?profileId`) | Lista automações |
| `GET /flows/:id` | Detalha (com nós e arestas) |
| `PUT /flows/:id` | Edita no formato simples (mesmo corpo do `POST`) |
| `POST /flows/:id/status` `{ "status": "ACTIVE" \| "PAUSED" \| "ARCHIVED" \| "DRAFT" }` | Liga/pausa/arquiva |
| `DELETE /flows/:id` | Exclui |
| `GET /flows/:id/executions?page=1&limit=20` | Histórico (comentários respondidos, DMs, erros) |
| `GET /flows/:id/executions/:executionId` | Uma execução com log |
| `GET /flows/integrations/:integrationId/posts` | Posts do IG para escolher o alvo |
| `GET /flows/integrations/:integrationId/stories` | Stories ativos |
| `GET /flows/integrations/:integrationId/webhook-status` | Diagnóstico do webhook da Meta |
| `POST /flows/dm/bot` `{ "integrationId", "enabled": true, "fallbackMessage"? }` | Liga/desliga o bot de DM (IA) do canal |
| `GET /flows/dm/escalations` | Conversas escaladas para humano |
| `POST /flows/dm/escalations/:id/resolve` | Marca a escalação como resolvida |

## Erros

| Código | Quando |
|---|---|
| 401 | Sem chave ou chave inválida |
| 400 | Corpo inválido — campo desconhecido, `postIds` vazio com `postMode=specific`, URL de botão não-https |
| 403 | Chave de perfil pedindo outro perfil, ou canal de outro perfil |
| 404 | Automação/execução fora do seu escopo |
| 412 | Canal inexistente, desativado ou com token expirado (reconecte na tela) |
| 429 | Limite de requisições nos `POST` de automação |

Todas as rotas também aparecem na documentação interativa (Swagger) do backend, seção **Automações (Flows)**.
