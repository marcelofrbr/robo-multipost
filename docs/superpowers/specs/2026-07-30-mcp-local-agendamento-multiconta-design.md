# MCP local de agendamento multiconta

**Data:** 2026-07-30
**Status:** aprovado
**Pacote:** `apps/mcp-local/`

## Problema

Agendar posts hoje exige passos manuais: abrir o app, subir mídia, copiar link, montar
o post. O script `scripts/agendar-carrossel.mjs` já automatiza o caminho
pasta → upload → agendamento, mas atende **uma** conta por execução (uma chave de
perfil por variável de ambiente) e só o formato carrossel.

O objetivo é disparar agendamentos a partir de pastas no computador local, para
**vários perfis e vários canais**, sem tocar em interface, e com espaço para novas
contas entrarem sem reescrever nada.

## Restrição de fundo

A mídia precisa chegar ao servidor. Instagram, LinkedIn e afins publicam puxando o
arquivo por URL do storage da instância. Nenhum deles lê arquivo do computador do
usuário. O que este projeto elimina é o **passo manual**, não o upload.

Por isso o MCP tem que ser **local** (transporte stdio, rodando na máquina do
usuário). O MCP remoto que já existe em `libraries/nestjs-libraries/src/chat/start.mcp.ts`
roda no backend e não enxerga o disco do usuário — sua tool `uploadMediaFromUrl`
exige URL pública, que arquivo local não tem.

Adicionar uma tool de caminho local ao MCP remoto **não** resolveria: ela resolveria o
caminho no disco do servidor, além de abrir leitura arbitrária de arquivo na VPS.

## Decisões

| Decisão | Escolha | Motivo |
|---|---|---|
| Camada de "conta" | Perfil **e** canal | O usuário tem múltiplos perfis, cada um com múltiplos canais |
| Organização em disco | Pasta por conta, subpasta por post | Roteamento por convenção, sem config por post |
| Gatilho | MCP sob demanda (fase 1) + vigia (fase 2) | Começa observável, automatiza depois sobre o mesmo núcleo |
| Segredos | `contas.json` versionável + `.env` fora do git | Adicionar conta = 1 bloco + 1 linha; segredo nunca no repositório |
| Destino do post | Apelidos de canal por conta | `post.json` legível; reconectar canal não reescreve posts |
| Onde mora o código | Pacote TypeScript no monorepo | Herda jest, eslint e tipos; config é lida em runtime, então uso diário não exige rebuild |

## Arquitetura

Regra de dependência única: **os adaptadores conhecem o núcleo; o núcleo não conhece
ninguém.**

```
apps/mcp-local/src/
  nucleo/
    tipos.ts          contratos compartilhados
    contas.ts         carrega contas.json + .env, valida, resolve chaves
    descoberta.ts     varre a pasta da conta -> posts prontos
    cliente-api.ts    HTTP contra /public/v1
    agendador.ts      resolve canais -> sobe midias -> agenda
  mcp/
    servidor.ts       stdio; registra ferramentas
    ferramentas/      uma por arquivo, casca fina sobre o nucleo
  vigia/              fase 2
  index.ts            entrypoint
```

`cliente-api.ts` fala apenas HTTP com a instância no ar. Nenhum import de
`libraries/nestjs-libraries`: o MCP local não precisa de Prisma, Redis ou Temporal.

Essa regra é o que torna o vigia da fase 2 uma peça pequena — ele não reimplementa
nada, apenas chama `agendarPost()`.

## Contratos de arquivo

### `contas.json`

```json
{
  "baseUrl": "https://seu-dominio/api",
  "contas": {
    "marca-a": {
      "apiKeyEnv": "POSTIZ_KEY_MARCA_A",
      "pasta": "C:/midias/marca-a",
      "canais": { "ig": "cm3x...", "li": "cm7y..." },
      "canaisPadrao": ["ig", "li"]
    }
  }
}
```

`baseUrl` pode ser sobrescrito por conta. Nenhum segredo mora aqui.

### `post.json`

```json
{
  "legenda": "texto do post",
  "data": "2026-08-01T09:00:00-03:00",
  "canais": ["ig"],
  "tipo": "carrossel",
  "legendaPorCanal": { "li": "versão mais longa" }
}
```

Obrigatórios: `legenda` e `data`. Omitir `canais` usa `canaisPadrao`. A data leva
fuso explícito — o script atual assume `Z`, o que desloca agendamento em três horas
para quem está em `-03:00`.

### `.agendado.json`

Escrito pelo agendador na pasta do post após sucesso, com os IDs devolvidos pela API.
É o registro de idempotência: se existe, `agendarPost` recusa reagendar salvo
`forcar: true`. Sem ele o vigia da fase 2 duplicaria posts a cada reinício.

### Ordenação de slides

Por nome, com comparação numérica (`localeCompare` com `numeric: true`), de modo que
`01, 02, 10` não vire `01, 10, 02`.

## Ferramentas MCP

| Ferramenta | Função |
|---|---|
| `listarContas` | Contas configuradas, pastas e apelidos de canal |
| `listarPostsPendentes` | O que está pronto, o que já foi agendado, o que tem problema |
| `validarPost` | Ensaio completo sem subir nada |
| `agendarPost` | Sobe mídias e agenda; aceita `tipo` e `forcar` |
| `sincronizarCanais` | Busca os `integrationId` reais para corrigir o `contas.json` |

`agendarPost` valida tudo **antes** do primeiro byte subir. Canal, mídia e data errados
abortam sem tocar na instância — por isso rascunho obrigatório não é necessário como
muleta.

## Erros e segurança

- **Só chave de perfil.** Em 401/403 aborta e nunca cai para a chave de organização,
  que cria posts invisíveis no dashboard do perfil.
- **Chave nunca em log ou mensagem de erro** — sempre mascarada.
- **Caminho vindo do LLM é confinado** à pasta da conta; qualquer `..` que escape é
  rejeitado antes de qualquer leitura.
- **Upload parcial não agenda.** Falha no meio aborta antes do `POST /posts` e não
  grava `.agendado.json`. Reexecutar é seguro; mídia órfã é recolhida pelo
  `MediaCleanupService` da instância.
- **Allowlist de extensões:** png, jpg, jpeg, webp, gif, mp4.

## Testes

Specs co-locados, `fetch` mockado, nenhum teste tocando a rede:

- `contas.spec.ts` — chave ausente no ambiente, conta inexistente, apelido de canal
  desconhecido, `canaisPadrao` citando apelido que não existe.
- `descoberta.spec.ts` — ordenação numérica, post sem `post.json`, post já agendado,
  pasta vazia, path traversal rejeitado.
- `cliente-api.spec.ts` — 401 sem fallback, chave mascarada no erro.
- `agendador.spec.ts` — resolve apelidos, monta `settings` por rede, aborta em upload
  parcial, respeita `.agendado.json`, honra `forcar`.

## Fora de escopo nesta entrega

- O vigia (fase 2). A pasta `vigia/` fica preparada pela regra de dependência, mas
  não é implementada agora.
- Geração de legenda por IA. O `post.json` é escrito pelo usuário ou por um agente
  antes de chamar o MCP.
