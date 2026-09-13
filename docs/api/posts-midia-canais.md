# API pública — Posts, mídia e canais

Base: `https://<seu-dominio>/api/public/v1` · Autenticação: header `Authorization: <chave de API>`.

Use a **chave do perfil** (Configurações → Desenvolvedores → chave do perfil): ela só enxerga posts, mídias e canais daquele perfil; pedir `?profileId` de outro perfil devolve **403**. A chave de organização vê tudo e pode mirar um perfil com `?profileId` em qualquer rota.

Regras de escopo que valem em todas as rotas abaixo:

- **Posts são estritos por perfil.** Um post de outro perfil (ou inexistente) responde **404** — o mesmo que a tela mostra.
- **Mídia e canais sem perfil são compartilhados.** Mídia/canal conectado antes de existirem perfis aparece para todos; se pertencer a *outro* perfil, **403**; se não existir, **404**.

Guia irmão: [Automações e DM](automacoes-e-dm.md).

## Posts

| Rota | O que faz |
|---|---|
| `GET /posts?startDate=&endDate=` | Posts do calendário no período (ISO 8601). Chave de perfil vê só os do perfil |
| `POST /posts` | Cria **ou edita**: reenviar com o mesmo `group` e `posts[].value[].id` atualiza os posts em vez de criar (o `id` de cada item é a chave do upsert) |
| `GET /posts/:id` | Post completo — grupo, mídias e comentários encadeados |
| `GET /posts/group/:group` | Todos os posts de uma publicação multi-canal |
| `GET /posts/:id/statistics` | Cliques nos links encurtados do post |
| `PUT /posts/:id/date` `{ "date", "action"? }` | Muda a data. `action=schedule` (padrão) reagenda e volta para a fila; `update` só troca a data |
| `POST /posts/:id/comments` `{ "comment" }` | Comentário interno da equipe (não vai para a rede). Autor: dono da organização |
| `DELETE /posts/:id` · `DELETE /posts/group/:group` | Apaga o post (e o grupo dele) / o grupo inteiro |
| `GET /find-slot/:integrationId` | Próximo horário livre do canal |
| `GET /posts/:id/missing` · `PUT /posts/:id/release-id` | Conteúdo pendente / id externo (já existiam) |

Exemplo — reagendar um post e deixar um comentário para a equipe:

```bash
curl -X PUT -H "Authorization: $CHAVE" -H "Content-Type: application/json" \
  "$BASE/posts/$POST/date" -d '{ "date": "2026-09-20T13:00:00.000Z" }'

curl -X POST -H "Authorization: $CHAVE" -H "Content-Type: application/json" \
  "$BASE/posts/$POST/comments" -d '{ "comment": "Trocar a chamada do carrossel antes de sair." }'
```

Exemplo — editar o texto de um post já agendado (upsert):

```bash
# 1) pegue o grupo e os ids dos itens
curl -H "Authorization: $CHAVE" "$BASE/posts/$POST"
# → { "group": "…", "posts": [{ "id": "…", "content": "…", "integration": {…}, … }] }

# 2) reenvie POST /posts com o mesmo group e o mesmo value[].id
curl -X POST -H "Authorization: $CHAVE" -H "Content-Type: application/json" "$BASE/posts" -d '{
  "type": "schedule", "date": "2026-09-20T13:00:00.000Z", "shortLink": false,
  "posts": [{
    "integration": { "id": "'$IG'" },
    "group": "'$GRUPO'",
    "value": [{ "id": "'$POST'", "content": "Texto novo", "image": [] }],
    "settings": { "__type": "instagram", "post_type": "post" }
  }]
}'
```

## Mídia

| Rota | O que faz |
|---|---|
| `GET /media?page=1&from=&to=` | Biblioteca paginada; `from`/`to` (ISO 8601) filtram pela data de upload |
| `POST /upload` (multipart `file`) · `POST /upload-from-url` `{ "url" }` | Envia mídia (já existiam) — devolvem `{ id, path }` |
| `POST /media/information` `{ "id", "alt", "thumbnail"?, "thumbnailTimestamp"? }` | Texto alternativo e miniatura |
| `DELETE /media/:id` | Remove da biblioteca (mídia usada em post agendado continua protegida na limpeza automática) |

```bash
curl -H "Authorization: $CHAVE" "$BASE/media?page=1&from=2026-09-01T03:00:00.000Z"
# → { "pages": 3, "results": [{ "id": "…", "path": "https://…", "name": "…", "alt": null, … }] }
```

## Canais

| Rota | O que faz |
|---|---|
| `GET /integrations` | Lista os canais (com `disabled`, `profile`) |
| `GET /social/:provider` | URL de OAuth para conectar um canal (`instagram`, `youtube`, …). O consentimento acontece no navegador; o canal nasce **no perfil da chave** (ou do `?profileId`) |
| `POST /integrations/:id/enable` · `POST /integrations/:id/disable` | Reativa / desativa o canal (posts agendados num canal desativado deixam de sair) |
| `GET /integration-settings/:id` | Configurações atuais do provedor |
| `POST /integrations/:id/settings` `{ "additionalSettings": [{ "title", "value" }] }` | Atualiza as configurações (aceita o array ou a string JSON dele) |
| `DELETE /integrations/:id` | Remove o canal (já existia) |

```bash
curl -X POST -H "Authorization: $CHAVE" "$BASE/integrations/$IG/disable"
curl -X POST -H "Authorization: $CHAVE" -H "Content-Type: application/json" \
  "$BASE/integrations/$IG/settings" -d '{ "additionalSettings": [{ "title": "Verified", "value": true }] }'
```

Segredos e administração (chave Zernio, credenciais Meta/IA, membros, criação de perfis, conclusão do OAuth) ficam **só na tela** — de propósito, para uma chave vazada não dar controle da conta.

## Erros

| Código | Quando |
|---|---|
| 401 | Sem chave ou chave inválida |
| 400 | Corpo inválido — campo desconhecido, data fora do ISO 8601, `action` inválida, `additionalSettings` que não é um array JSON |
| 403 | Chave de perfil pedindo outro perfil; mídia ou canal de outro perfil |
| 404 | Post/grupo fora do seu escopo; mídia ou canal inexistente |
| 412 | Organização sem membros (comentário) |
| 429 | Limites: 60/min para mudar data e comentar; 30/hora para ativar, desativar e configurar canal |

Todas as rotas também aparecem na documentação interativa: `https://<seu-dominio>/api/docs` (Swagger, seções **Posts**, **Mídia** e **Public API**) — clique em **Authorize** e cole a chave de API.
