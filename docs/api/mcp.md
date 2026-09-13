# MCP — comandar o Robô MultiPost por um agente

O servidor MCP (Model Context Protocol) expõe **as mesmas capacidades da API pública** como tools, para um agente de IA (Claude, ChatGPT, n8n com nó MCP, etc.) operar a conta em linguagem natural. Tudo que é conteúdo e operação — posts, mídia, canais, automações, bot de DM, métricas — está aqui. Segredos e administração (chave Zernio, credenciais Meta/IA, membros, criar perfis, concluir OAuth) ficam **só na tela**, de propósito.

## Conectar

| Modo | Como |
|---|---|
| Chave de API (recomendado) | URL `https://<seu-dominio>/api/mcp` + header `Authorization: Bearer <chave>` |
| Chave na URL (clientes sem header) | `https://<seu-dominio>/api/mcp/<chave>` |
| OAuth (ChatGPT Apps, etc.) | `https://<seu-dominio>/api/mcp-oauth` — o cliente faz o fluxo de autorização sozinho |

Use a **chave do perfil** (Configurações → Desenvolvedores): o agente enxerga só os posts, mídias, canais e automações daquele perfil — as mesmas regras de escopo da REST (posts são estritos por perfil; mídia/canal sem perfil são compartilhados; nada de outra organização). A chave de organização vê tudo.

Exemplo (Claude Desktop / `claude mcp add`):

```json
{
  "mcpServers": {
    "robo-multipost": {
      "url": "https://<seu-dominio>/api/mcp",
      "headers": { "Authorization": "Bearer <chave do perfil>" }
    }
  }
}
```

## Tools ↔ rotas REST

Cada tool espelha uma rota da API pública e passa pelos **mesmos guards de escopo** do backend (não há caminho "por fora").

### Posts

| Tool | Rota REST | O que faz |
|---|---|---|
| `listPosts` | `GET /posts?startDate&endDate` | Posts do calendário no período |
| `getPost` | `GET /posts/:id` | Post completo (grupo, thread, mídias; canal sem tokens) |
| `integrationSchedulePostTool` | `POST /posts` | Cria/agenda/publica (já existia) |
| `changePostDate` | `PUT /posts/:id/date` | Reagendar (`schedule`) ou só trocar a data (`update`) |
| `deletePost` | `DELETE /posts/group/:group` | Apaga o post e o grupo dele |
| `findFreeSlot` | `GET /find-slot/:integrationId` | Próximo horário livre do canal |
| `postStatistics` | `GET /posts/:id/statistics` | Cliques dos links encurtados |
| `createPostComment` | `POST /posts/:id/comments` | Comentário interno da equipe |
| `postAnalytics` | `GET /analytics/post/:postId` | Métricas do post publicado |

### Mídia

| Tool | Rota REST | O que faz |
|---|---|---|
| `listMedia` (agora com `from`/`to`) | `GET /media?page&from&to` | Biblioteca paginada, filtro por data de upload |
| `uploadMediaFromUrl` | `POST /upload-from-url` | Hospeda uma mídia a partir de URL (já existia) |
| `saveMediaInformation` | `POST /media/information` | Texto alternativo / miniatura |
| `deleteMedia` | `DELETE /media/:id` | Remove da biblioteca |
| `cleanupMedia` | — | Limpeza da galeria (já existia) |
| `generateImageTool`, `generateVideoTool`, `generateVideoOptions`, `videoFunctionTool` | `POST /generate-video`, `/video/function` | IA generativa (já existiam) |

### Canais

| Tool | Rota REST | O que faz |
|---|---|---|
| `integrationList` | `GET /integrations` | Lista os canais (já existia) |
| `integrationAuthUrl` | `GET /social/:provider` | URL de OAuth para conectar um canal novo (o usuário abre no navegador; o canal nasce no perfil atual) |
| `integrationEnable` / `integrationDisable` | `POST /integrations/:id/enable` · `/disable` | Reativa / desativa |
| `integrationSettings` | `GET /integration-settings/:id` · `POST /integrations/:id/settings` | Lê (sem `settings`) ou grava (com `settings`) as configurações do provedor |
| `integrationAnalytics` | `GET /analytics/:integration` | Métricas do canal |
| `integrationSchema`, `triggerTool` | `POST /integration-trigger/:id` | Validação / gatilhos do provedor (já existiam) |

### Automações e DM

| Tool | Rota REST | O que faz |
|---|---|---|
| `listAutomations` | `GET /flows` | Lista as automações (já existia) |
| `getAutomation` | `GET /flows/:id` | Configuração completa — leia antes de editar |
| `createCommentAutomation` | `POST /flows` | Cria (contrato completo: comentário **ou** story, follow-gate em 1 ou 2 passos, `handoffToBot`) |
| `updateAutomation` | `PUT /flows/:id` | **Reescreve** a automação com o mesmo contrato — reenvie todos os campos que devem permanecer. O canal (`integrationId`) não muda no update |
| `setAutomationStatus` | `POST /flows/:id/status` | Ativar / pausar / arquivar (já existia) |
| `deleteAutomation` | `DELETE /flows/:id` | Exclui |
| `automationExecutions` | `GET /flows/:id/executions` | Histórico do que a automação fez (`{ page, limit, hasMore, items }`) |
| `listInstagramPostsForAutomation` | `GET /flows/integrations/:id/posts` | Posts do Instagram para escolher o alvo |
| `webhookStatus` | `GET /flows/integrations/:id/webhook-status` | Diagnóstico do webhook da Meta — rode antes de criar automações |
| `configureDmBot` | `POST /flows/dm/bot` | Liga/desliga o bot de DM (já existia) |
| `listDmEscalations` / `resolveDmEscalation` | `GET /flows/dm/escalations` · `POST /flows/dm/escalations/:id/resolve` | Conversas escaladas para humano / marcar como resolvida |

### Perfis, notificações, conhecimento

| Tool | Rota REST | O que faz |
|---|---|---|
| `listProfiles` | `GET /profiles` | Perfis da organização (chave de perfil vê só o próprio) |
| `listNotifications` | `GET /notifications` | Avisos e falhas de publicação |
| `knowledgeBaseQuery`, `webSearchTool`, `extractUrlsTool` | — | Base de conhecimento e pesquisa (já existiam) |

## Exemplos de pedidos em linguagem natural

- "Liste os posts agendados desta semana e reagende o de sexta para sábado às 9h." → `listPosts` + `changePostDate`
- "Antes de criar a automação, confira se o webhook do Instagram está ok." → `webhookStatus`
- "Crie uma automação: quem comentar *quero* no próximo post recebe a DM com o link." → `createCommentAutomation` (`postMode: next_publication`, `keywords: ["quero"]`, `dmMessage`, `dmButtonUrl`)
- "Mude a automação X para responder também a stories." → `getAutomation` + `updateAutomation` (reenviando os campos atuais + `triggerType: story_reply`)
- "Quais conversas o bot de DM passou para humano hoje? Marque a primeira como resolvida." → `listDmEscalations` + `resolveDmEscalation`
- "Desative o canal do YouTube até segunda." → `integrationList` + `integrationDisable`

## Limites

Por token: 120 requisições/min; por IP: 300/min. Acima disso o servidor responde **429** (`{ "error": "rate_limited", "retryAfterSeconds": 60 }`). O IP é lido do `X-Forwarded-For` descontando os proxies confiáveis (`MCP_TRUSTED_PROXY_HOPS`, padrão 2 = Traefik + nginx do container) — o valor enviado pelo cliente não conta.

## Erros

As tools devolvem a mensagem do backend: `Post not found` (fora do escopo), `Integration belongs to another profile`, `Profile key cannot access another profile`, `Integracao desativada ou com token expirado`, etc. — os mesmos textos e regras da REST. Sem organização no contexto (chave inválida) a tool falha com `MCP: organizacao ausente no contexto`.

Guias REST equivalentes: [Automações e DM](automacoes-e-dm.md) · [Posts, mídia e canais](posts-midia-canais.md).
