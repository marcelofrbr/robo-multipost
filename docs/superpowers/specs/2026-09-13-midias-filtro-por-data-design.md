# Mídias — filtro por data (design)

**Data:** 2026-09-13 · **Status:** aprovado pelo dono · **Escopo:** um PR

## Problema

A biblioteca de mídia (`Mídia` no menu e o seletor dentro de "Criar publicação") lista tudo em páginas de 18 itens, ordenado por data de upload, sem nenhum filtro. Com centenas de arquivos, achar "o que subi na semana passada" exige paginar às cegas.

## Objetivo

Filtrar a listagem pela **data de upload** (`Media.createdAt`), com atalhos rápidos e um período livre, nos dois lugares em que a biblioteca aparece, mantendo a paginação correta.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Qual data | `createdAt` (upload) | É a única data que a mídia tem |
| Formato | Atalhos (Hoje · 7 dias · 30 dias · Este mês) + De/Até | Rápido no dia a dia e flexível quando precisa |
| Onde | Tela Mídia **e** seletor do composer | Mesmo componente (`MediaBox`); custo igual |
| Onde filtra | No servidor, no `GET /media` existente | Paginação é do servidor; filtrar no navegador daria resultado parcial |
| Fuso horário | O navegador calcula os limites do dia e envia instantes UTC (ISO 8601) | O servidor não adivinha fuso; o app já usa `dayjs.tz` |
| Persistência | Não persiste (abre sempre sem filtro) | Simples e previsível |
| Endpoint novo | Não | Parâmetros opcionais mantêm compatibilidade |

## Contrato da API

`GET /media?page=1&from=<ISO>&to=<ISO>`

- `page` (opcional, ≥ 1, padrão 1) — como hoje.
- `from` / `to` (opcionais, ISO 8601 com instante). `to` é inclusivo (o frontend envia o fim do dia local, 23:59:59.999).
- Regras: ambos opcionais e independentes; se os dois vierem, `from <= to`, senão **400**.
- Resposta inalterada: `{ pages: number, results: Media[] }`, agora calculada sobre o período.
- Correção embutida: a contagem de páginas passa a usar o **mesmo `where`** da listagem (hoje ignora `deletedAt`, então mídias apagadas inflam `pages`).
- A API pública `/public/v1/media` não muda.

## Backend

- `libraries/nestjs-libraries/src/dtos/media/get-media.query.dto.ts` (novo): `page?`, `from?`, `to?` com `class-validator` (`@IsOptional()`, `@IsISO8601()`, `@Type(() => Number)` no page) e validação cruzada `from <= to` no service (erro 400 `HttpException`).
- `apps/backend/src/api/routes/media.controller.ts` → `getMedia(@Query() query: GetMediaQueryDto)` e repassa `{ from, to }`.
- `media.service.ts#getMedia(org, page, profileId, range?)` → valida `from <= to` e delega.
- `media.repository.ts#getMedia(org, page, profileId, range?)` → um único `where` (`organizationId`, `deletedAt: null`, filtro de perfil, `createdAt: { gte, lte }` quando informado) usado em `count` e `findMany`.

## Frontend

- `apps/frontend/src/components/media/media-date-range.helper.ts` (novo, puro): `presetRange(preset, now)` (hoje/7d/30d/este mês) e `toIsoRange({ from, to })` (início/fim do dia local → ISO UTC); `isValidRange`. Testado com vitest (`*.test.ts`).
- `apps/frontend/src/components/media/media-date-filter.component.tsx` (novo): atalhos, dois `<input type="date">` (primitivos nativos, Tailwind + tokens `--new-*`), botão "Limpar", `aria-*`. Emite `{ from?: string; to?: string }` (datas `YYYY-MM-DD`).
- `media.component.tsx` (`MediaBox`): estado do filtro; chave do SWR inclui o período; trocar o filtro reseta `page` para 0; estado vazio com filtro ativo mostra "Nenhuma mídia neste período" e mantém o botão Limpar.
- i18n (`pt` + `en`): `media_filter_date`, `media_filter_today`, `media_filter_last_7_days`, `media_filter_last_30_days`, `media_filter_this_month`, `media_filter_from`, `media_filter_to`, `media_filter_clear`, `media_filter_no_results`.

## Erros

| Situação | Comportamento |
|---|---|
| `from`/`to` não ISO | 400 (DTO) |
| `from > to` | Campos com `min`/`max` cruzados, aviso inline, e o grid mantém o **último período válido** (a API nunca recebe o par inválido); o servidor responde 400 por segurança |
| Falha de rede ao filtrar | Mesmo comportamento da listagem sem filtro (o `MediaBox` não trata `response.ok`): a grade mostra o estado vazio até a próxima tentativa; sem toaster |

## Testes

- Jest: `media.repository.spec.ts` (where com/sem datas; `count` e `findMany` recebem o mesmo filtro; `deletedAt: null` na contagem), `media.service.spec.ts` (`from > to` → 400; repasse do range), DTO (rejeita data inválida).
- Vitest: `media-date-range.helper.test.ts` (atalhos, limites do dia, fuso, `isValidRange`).
- `tsc --noEmit` no frontend e backend.
- Navegador (produção, após deploy): tela Mídia e seletor do composer — atalho, período livre, paginação com filtro, limpar.

## Fora do escopo

Filtro por tipo/nome/tamanho, ordenação, persistência do filtro, mudanças na API pública.
