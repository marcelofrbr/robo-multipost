# Métricas (Analytics) por canal e por post

Atualizado em 2026-11-02 (branch `feat/metricas-reais`).

## Como funciona

- As métricas são **somente leitura** e vêm **ao vivo** da API de cada rede. Nada é gravado no banco.
- Cache temporário no Redis: 1 hora em produção (1 s em desenvolvimento). Chave `integration:v2:<org>:<integration>:<dias>`.
- Fluxo: `GET /analytics/:integration?date=<dias>` → `IntegrationService.checkAnalytics` → `provider.analytics(...)`.
  Post: `GET /analytics/post/:postId?date=<dias>` → `PostsService.checkPostAnalytics` → `provider.postAnalytics(...)`.
- Mesmo contrato na API pública (`/public/v1/analytics/...`) e nas tools MCP `integrationAnalytics` / `postAnalytics`.

## Contrato `AnalyticsData` (aditivo, compatível com o formato antigo)

| Campo | Tipo | Significado |
|---|---|---|
| `label` | string | Nome da métrica em inglês; o frontend traduz por `analytics_label_<label>` |
| `data` | `{ total, date }[]` | Série para o gráfico (um ponto quando a rede só dá o total) |
| `percentageChange` | number | Variação real contra o período anterior de mesmo tamanho. `0` = sem comparação (o card esconde a seta) |
| `summary?` | number | Valor oficial do período. Quando existe, a tela mostra ele em vez de somar `data` |
| `previous?` | number | Mesmo valor no período anterior |
| `unit?` | `'count' \| 'percent' \| 'seconds'` | Formatação |
| `kind?` | `'period' \| 'snapshot' \| 'lifetime'` | `snapshot` = valor atual da conta (ex.: seguidores), `lifetime` = total desde a publicação (posts) |
| `average?` | boolean | Legado: a tela tira a média de `data` em vez de somar |

Regra da tela: com `summary`, usa `summary`; sem `summary`, soma `data` (ou média com `average`). Isso mantém funcionando qualquer provider não alterado.

## Janela de datas

`date` = número de dias (3, 7, 14, 30 ou 90, conforme a rede). Período atual = últimos `date` dias até agora; período anterior = os `date` dias imediatamente antes. Helper: `analytics.helper.ts` (`analyticsWindows`, `percentChange`, `buildMetric`, `fetchMetaInsights`).

## Por rede

### Instagram (Facebook Login e Instagram Login)
Conta, período (`metric_type=total_value`, valor oficial do período, sem soma de dias): `views`, `reach`, `accounts_engaged`, `total_interactions`, `likes`, `comments`, `shares`, `saves`, `replies`, `profile_links_taps`, `follows_and_unfollows` (breakdown `follow_type`). Série diária só de `reach` (único com `time_series`). Seguidores atuais por `GET /{id}?fields=followers_count`.
Post: métricas escolhidas pelo `media_product_type` (FEED, REELS, STORY), incluindo `profile_visits`, `follows` e, em reels, `ig_reels_avg_watch_time` e `ig_reels_video_view_total_time` (ms → s). `impressions` foi removida pela Meta em 21/04/2025.
Limites da Meta: atraso de até 48 h; `follows_and_unfollows` só com 100+ seguidores; dado indisponível vem vazio.

### Facebook (Página)
A Meta desativou `page_impressions_unique` e `page_posts_impressions_unique` (15/06/2025) e `page_impressions` (15/11/2025). Uma métrica inválida derrubava a chamada inteira. Agora: `page_media_view`, `page_total_media_view_unique`, `page_post_engagements`, `page_daily_follows_unique`, `page_video_views`, diárias. O alcance único diário não pode ser somado (conta a mesma pessoa várias vezes), então aparece como **média por dia**. Post: `post_media_view`, `post_total_media_view_unique`, `post_reactions_by_type_total`, `post_clicks`. O `releaseId` salvo costuma ser o id da foto/vídeo, que não tem insights (`#100 nonexisting field`); o provider usa `<idDaPagina>_<idDoPost>`. A Meta repete `post_total_media_view_unique` com `lifetime` e `day`: vale o `lifetime` (`fetchMetaInsights`).

### Validação com conta real (2026-11-02)
Rodado localmente contra as APIs reais (canais do perfil Pessoal Marketing, só leitura): Instagram conta 3/7/30 dias (13 métricas) e post (10 métricas, incluindo tempo assistido do reels), Facebook página 7/90 dias (6 métricas) e post (4 métricas), YouTube 30 dias (9 métricas). O teste revelou e corrigiu o id de post do Facebook e a métrica duplicada.

### YouTube
YouTube Analytics API: série diária + totais do período calculados pelo próprio YouTube (médias ponderadas corretas) + totais do período anterior. Atraso típico de 2 a 3 dias.

### LinkedIn (Página), Pinterest, Threads, X, TikTok, GMB
Sem comparação de período (seta escondida). Taxas calculadas a partir das contagens (LinkedIn engajamento = interações / impressões; Pinterest taxa de clique = cliques / impressões). TikTok: a API básica não tem data, então os rótulos dizem "últimos 20 vídeos" e os números são marcados como `snapshot`.

## Robustez (`fetchMetaInsights`)
Pede todas as métricas numa chamada; se a Meta recusar (métrica desativada ou incompatível com o tipo de mídia), pede uma a uma e descarta só as que falharem. Erros de métricas não disparam refresh de token nem desconectam o canal.

## Escopo de perfil
App: `checkAnalytics`/`checkPostAnalytics` recusam canal/post de outro perfil. API pública (antes sem filtro de perfil): `GET /public/v1/analytics/:integration` passa por `getIntegrationInScope` com o perfil da chave (403 outro perfil, 404 inexistente; canal compartilhado `profileId = null` continua liberado) e repassa o perfil a `checkAnalytics`; `GET /public/v1/analytics/post/:postId` repassa o perfil a `checkPostAnalytics` (post de outro perfil devolve lista vazia, mesma regra do app, sem bloquear posts antigos sem perfil).

## Cache e refresh
Resposta vazia não vai para o cache (falha passageira não fica presa por 1 hora). Em `RefreshToken`, o service renova o token e tenta **uma** vez; na segunda falha devolve lista vazia (antes podia recursar sem fim).

## Fora do escopo (decisão futura)
Histórico guardado no banco (evolução de um post ao longo dos dias), retenção segundo a segundo, público (idade/cidade), TikTok via API para empresas, canais via Zernio.
