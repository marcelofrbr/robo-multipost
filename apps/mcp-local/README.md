# MCP local — agendamento a partir de pastas do seu computador

Servidor MCP que roda **na sua máquina** e agenda posts no Robô MultiPost a
partir de pastas de mídia locais, para **várias contas e vários canais**.

Você põe as imagens numa pasta, escreve duas linhas num `post.json`, e pede no
chat: *"agenda o post de lançamento da marca-a"*. Ele sobe as mídias na ordem
certa e agenda em todos os canais daquela conta.

---

## Índice

1. [O que ele resolve (e o que não resolve)](#o-que-ele-resolve-e-o-que-não-resolve)
2. [Como funciona por dentro](#como-funciona-por-dentro)
3. [Instalação](#instalação)
4. [Configuração das contas](#configuração-das-contas)
5. [Como organizar as pastas](#como-organizar-as-pastas)
6. [Ligar no Claude Desktop](#ligar-no-claude-desktop)
7. [As cinco ferramentas](#as-cinco-ferramentas)
8. [Uso no dia a dia](#uso-no-dia-a-dia)
9. [Adicionar uma conta nova](#adicionar-uma-conta-nova)
10. [Segurança](#segurança)
11. [Solução de problemas](#solução-de-problemas)
12. [Desenvolvimento](#desenvolvimento)

---

## O que ele resolve (e o que não resolve)

**Resolve:** o trabalho manual. Nada de abrir o app, arrastar arquivo, copiar
link, montar post, repetir para cada canal e cada conta.

**Não resolve:** a mídia ainda precisa chegar ao servidor. Instagram, LinkedIn e
afins publicam puxando o arquivo por URL do storage da instância — nenhum deles
lê arquivo do seu computador. O que some é o passo manual, não o upload.

Por isso este MCP é **local** (stdio, na sua máquina). O MCP remoto que já existe
no backend não enxerga seu disco: a ferramenta `uploadMediaFromUrl` dele exige
URL pública, e arquivo local não tem uma.

---

## Como funciona por dentro

```
Você (no chat)
      |
      v
MCP local (esta pasta, na sua máquina)
      |
      |  1. lê contas.json  -> descobre a conta e a chave de perfil
      |  2. varre a pasta   -> acha o post, ordena as mídias
      |  3. valida TUDO     -> canais, integrações, data
      |  4. sobe as mídias  -> POST /public/v1/upload
      |  5. agenda          -> POST /public/v1/posts
      |  6. grava .agendado.json
      v
Sua instância do Robô MultiPost
```

O passo 3 acontece **antes** do passo 4. Se um canal, uma mídia ou a data
estiverem errados, nada é enviado — a instância nem fica sabendo da tentativa.

---

## Instalação

Na raiz do repositório:

```bash
pnpm install
pnpm build:mcp-local
```

Isso gera `apps/mcp-local/dist/index.js`, que é o arquivo que o cliente MCP vai
executar.

Refaça o build **só quando mexer no código** deste pacote. Editar `contas.json`
ou `post.json` não precisa de rebuild — eles são lidos em tempo de execução.

---

## Configuração das contas

Dois arquivos, lado a lado, em `~/.robo-multipost/`:

```
C:\Users\<voce>\.robo-multipost\
  contas.json    <- pode versionar, não tem segredo
  .env           <- as chaves, NUNCA versionar
```

### `contas.json`

Copie de [`contas.exemplo.json`](contas.exemplo.json):

```json
{
  "baseUrl": "https://seu-dominio/api",
  "contas": {
    "marca-a": {
      "apiKeyEnv": "POSTIZ_KEY_MARCA_A",
      "pasta": "C:/midias/marca-a",
      "canais": {
        "ig": "cm3x...id-do-instagram",
        "li": "cm7y...id-do-linkedin"
      },
      "canaisPadrao": ["ig", "li"]
    }
  }
}
```

| Campo | Obrigatório | O que é |
|---|---|---|
| `baseUrl` | sim | Base da API. Aceita `https://dominio/api` ou já com `/public/v1`. Pode ser repetido dentro de uma conta para sobrescrever. |
| `apiKeyEnv` | sim | **Nome** da variável de ambiente que guarda a chave. Não é a chave. |
| `pasta` | sim | Raiz das mídias da conta. Caminho relativo é resolvido a partir da pasta do `contas.json`. |
| `canais` | sim | Apelido curto → `integrationId`. Descubra os ids com `sincronizarCanais`. |
| `canaisPadrao` | não | Apelidos usados quando o post não declara `canais`. Omitido, usa todos. |

### `.env`

```
POSTIZ_KEY_MARCA_A=chave-de-perfil-da-marca-a
POSTIZ_KEY_MARCA_B=chave-de-perfil-da-marca-b
```

> **Use a chave de PERFIL, nunca a de organização.** A chave de organização até
> agenda, mas os posts ficam invisíveis no dashboard do perfil. Se der 401 ou
> 403, o erro vai lembrar disso — troque pela chave de perfil correta em vez de
> tentar a de organização.

Variáveis já presentes no ambiente do sistema têm precedência sobre o `.env`.

### Outro local para a config

Aponte `MCP_LOCAL_CONFIG` para o caminho do `contas.json`. Sem essa variável, o
padrão é `~/.robo-multipost/contas.json`.

---

## Como organizar as pastas

**Uma pasta por conta. Uma subpasta por post.**

```
C:\midias\
  marca-a\
    2026-08-01-carrossel-lancamento\
      01.png
      02.png
      03.png
      post.json
    2026-08-05-dica-semanal\
      video.mp4
      post.json
  marca-b\
    2026-08-02-bastidores\
      01.jpg
      post.json
```

O nome da subpasta é como você chama o post nas ferramentas. Use um nome que
você reconheça — a data na frente ajuda a ordenar.

### Ordem dos slides

As mídias são ordenadas **numericamente pelo nome**, então `1, 2, 10` fica na
ordem certa e não vira `1, 10, 2`. Nomear como `01, 02, 03` também funciona.

Extensões aceitas: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.mp4`. Qualquer
outro arquivo na pasta é ignorado — inclusive o próprio `post.json`.

### `post.json`

Modelo completo em [`post.exemplo.json`](post.exemplo.json). O mínimo:

```json
{
  "legenda": "Texto do post",
  "data": "2026-08-01T09:00:00-03:00"
}
```

| Campo | Obrigatório | O que é |
|---|---|---|
| `legenda` | sim | Texto do post. |
| `data` | sim | ISO 8601 **com fuso**. Ver aviso abaixo. |
| `canais` | não | Apelidos de destino. Omitido, usa `canaisPadrao` da conta. |
| `tipo` | não | `carrossel` (padrão), `post`, `reels` ou `story`. |
| `legendaPorCanal` | não | Legenda diferente por apelido. Quem não aparecer usa a `legenda`. |
| `nomeCarrossel` | não | Nome do carrossel no LinkedIn. |
| `encurtarLinks` | não | Encurtar links do corpo. Padrão `false`. |

> **Sempre ponha o fuso na data.** `2026-08-01T09:00:00-03:00` agenda para 9h de
> Brasília. `2026-08-01T09:00:00` sem fuso é interpretado como UTC, e o post sai
> 3 horas fora do lugar.

Sobre `tipo`: no Instagram, o `post_type` da API só aceita `post` ou `story`. Um
vídeo enviado como `post` já é publicado como reel pela própria Meta, então
`reels` existe para deixar sua intenção explícita, não para mudar o envio.

### `.agendado.json`

Gravado automaticamente na pasta do post depois que o agendamento dá certo:

```json
{
  "agendadoEm": "2026-07-30T15:00:00.000Z",
  "tipo": "schedule",
  "data": "2026-08-01T09:00:00-03:00",
  "canais": ["ig", "li"],
  "resposta": [{ "id": "..." }]
}
```

É a trava contra duplicata: com esse arquivo presente, `agendarPost` se recusa a
agendar de novo. Para reagendar de propósito, passe `forcar: true` — e saiba que
isso cria uma **segunda** publicação, não substitui a primeira.

Apagou o arquivo? O post volta a aparecer como pronto e pode ser agendado de
novo. É assim que se destrava um post manualmente.

---

## Ligar no Claude Desktop

Edite `%APPDATA%\Claude\claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "robo-multipost-local": {
      "command": "node",
      "args": ["C:/Users/<voce>/Documents/GitHub/postiz-multpost/apps/mcp-local/dist/index.js"]
    }
  }
}
```

Se o `contas.json` não estiver em `~/.robo-multipost/`, acrescente:

```json
      "env": { "MCP_LOCAL_CONFIG": "D:/config/contas.json" }
```

Reinicie o Claude Desktop. As cinco ferramentas aparecem no menu de ferramentas.

Serve para qualquer cliente MCP com transporte stdio — basta apontar o mesmo
comando.

---

## As cinco ferramentas

### `listarContas`

Sem argumentos. Mostra as contas configuradas com pasta, apelidos de canal e
canais padrão. **Nunca devolve chave de API.**

### `listarPostsPendentes`

`conta` (opcional — omita para varrer todas).

Separa em três listas:

- **prontos** — têm `post.json` válido e mídia, e ainda não foram agendados;
- **jaAgendados** — já têm `.agendado.json`;
- **invalidos** — o motivo vem junto ("falta o arquivo post.json", "nenhuma mídia na pasta"...).

Uma conta com pasta inexistente reporta o erro sem derrubar a varredura das
outras.

### `sincronizarCanais`

`conta`.

Lista as integrações reais do perfil e compara com os apelidos do `contas.json`.
Devolve:

- `integracoesNoPerfil` — id, nome, rede, se está desabilitada, e o apelido atual;
- `apelidosObsoletos` — apelidos apontando para id que não existe mais;
- `sugestaoCanais` — bloco `canais` pronto para colar, preservando os apelidos que você já usa.

Use ao cadastrar conta nova e sempre que reconectar um canal — reconectar gera um
`integrationId` novo e quebra o apelido silenciosamente.

Não escreve no `contas.json`: quem edita a config é você.

### `validarPost`

`conta`, `post`, `tipo` (opcional).

Ensaio completo **sem efeito colateral**: resolve apelidos, confere se as
integrações existem e estão ativas, valida a data, conta as mídias. Não sobe nada
e não cria post.

### `agendarPost`

`conta`, `post`, `tipo` (opcional), `forcar` (opcional).

Sobe as mídias e agenda. `tipo` aceita:

| `tipo` | Efeito |
|---|---|
| `schedule` (padrão) | Agenda para a `data` do `post.json`. |
| `draft` | Cria rascunho, não publica. Aceita data no passado. |
| `now` | Publica na hora, ignorando a `data`. |

---

## Uso no dia a dia

Você não chama ferramenta na mão — descreve o que quer:

> "quais posts estão prontos?"

> "valida o post de lançamento da marca-a"

> "agenda o 2026-08-01-carrossel-lancamento da marca-a"

> "agenda como rascunho pra eu conferir no app antes"

> "agora agenda de verdade"

Um fluxo seguro para começar: `listarPostsPendentes` → `validarPost` →
`agendarPost` com `tipo: "draft"` → conferir no app → `agendarPost` de novo com
`forcar: true` e `tipo: "schedule"`.

Depois que pegar confiança, `agendarPost` direto resolve — ele já valida tudo
antes de enviar qualquer coisa.

---

## Adicionar uma conta nova

1. Gere a chave de **perfil** da conta no app.
2. Acrescente uma linha no `.env`:
   ```
   POSTIZ_KEY_MARCA_C=a-chave-nova
   ```
3. Acrescente o bloco no `contas.json`, por enquanto com um canal chutado:
   ```json
   "marca-c": {
     "apiKeyEnv": "POSTIZ_KEY_MARCA_C",
     "pasta": "C:/midias/marca-c",
     "canais": { "ig": "a-descobrir" }
   }
   ```
4. Peça: *"roda o sincronizarCanais da marca-c"*.
5. Cole o `sugestaoCanais` que ele devolver por cima do bloco `canais`, ajustando
   os apelidos como preferir.
6. Crie a pasta `C:/midias/marca-c`.

Pronto. Sem rebuild, sem reiniciar o Claude Desktop — a config é relida a cada
chamada de ferramenta.

---

## Segurança

- **A chave nunca aparece na saída.** `listarContas` omite o campo, e qualquer
  erro da API tem a chave substituída por `***` antes de virar mensagem.
- **Sem fallback para chave de organização.** Em 401/403 o servidor aborta e
  explica, em vez de tentar outra credencial.
- **Caminho confinado.** O nome do post chega de um modelo, então é tratado como
  entrada não confiável: só um nome simples de subpasta é aceito, nunca `..`,
  separador de caminho ou caminho absoluto.
- **Allowlist de extensões.** Um `.zip`, `.psd` ou `.exe` esquecido na pasta é
  ignorado, nunca enviado.
- **Upload parcial não agenda.** Se um upload falhar no meio, o post não é criado
  e o `.agendado.json` não é gravado. Rodar de novo é seguro; as mídias órfãs são
  recolhidas pelo `MediaCleanupService` da instância.

Ponha `contas.json` e `.env` fora do repositório (`~/.robo-multipost/` é o padrão
justamente por isso). Se optar por versionar o `contas.json`, confira antes que
ele só tem **nomes** de variável, nunca valores.

---

## Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Servidor não aparece no Claude Desktop | Caminho errado no `args`, ou build não feito | Rode `pnpm build:mcp-local` e confira que `dist/index.js` existe no caminho configurado |
| "Arquivo de configuracao nao encontrado" | Não existe `~/.robo-multipost/contas.json` | Copie o `contas.exemplo.json` para lá, ou aponte `MCP_LOCAL_CONFIG` |
| "a variavel de ambiente X nao esta definida" | Falta a linha no `.env`, ou o `.env` não está ao lado do `contas.json` | Os dois arquivos precisam estar na mesma pasta |
| 401 / 403 | Chave errada, ou chave de organização | Gere a chave de **perfil** da conta certa. Não use a de organização |
| "aponta para integrationId ... que nao existe neste perfil" | Canal reconectado, id mudou | Rode `sincronizarCanais` e cole a sugestão |
| "a data ... esta no passado" | `data` do `post.json` já passou | Corrija a data, ou use `tipo: "draft"` |
| "falta o arquivo post.json" | Pasta sem config | Copie o `post.exemplo.json` para dentro dela como `post.json` |
| "nenhuma midia na pasta" | Só há arquivos de extensão não aceita | Use png, jpg, jpeg, webp, gif ou mp4 |
| "ja foi agendado" | Existe `.agendado.json` | Use `forcar: true` para uma segunda publicação, ou apague o arquivo |
| Slides na ordem errada | Nomes sem número | Renomeie para `01, 02, 03...` |
| Post agendado mas invisível no dashboard | Chave de organização em vez de perfil | Troque a chave e reagende |

Os erros do servidor vão para `stderr`. No Claude Desktop, os logs ficam em
`%APPDATA%\Claude\logs\`.

---

## Desenvolvimento

```bash
pnpm test:mcp-local        # da raiz do repo
pnpm build:mcp-local
pnpm lint                  # sempre da raiz
```

### Estrutura

```
src/
  nucleo/          não conhece MCP nem vigia
    tipos.ts       contratos compartilhados
    contas.ts      carrega contas.json + .env, valida, resolve chaves
    descoberta.ts  varre pastas -> posts prontos
    cliente-api.ts HTTP contra /public/v1
    agendador.ts   valida -> sobe mídias -> agenda
  mcp/             casca fina sobre o núcleo
    contexto.ts    o que as ferramentas enxergam
    servidor.ts    stdio; registra as ferramentas
    ferramentas/   uma por arquivo + lista.ts (registro)
  index.ts         entrypoint
```

Regra de dependência: **os adaptadores conhecem o núcleo; o núcleo não conhece
ninguém.** É o que mantém a lógica testável sem disco nem rede, e o que vai
tornar o vigia da fase 2 uma peça pequena.

### Adicionar uma ferramenta

1. Escreva o spec em `src/mcp/ferramentas.spec.ts`.
2. Crie `src/mcp/ferramentas/<nome>.ts` implementando `Ferramenta`.
3. Registre em `src/mcp/ferramentas/lista.ts`.
4. Documente na seção [As cinco ferramentas](#as-cinco-ferramentas) deste README.

Lógica de negócio vai para `src/nucleo/`, com spec próprio. A ferramenta deve
continuar sendo só a tradução entre o MCP e o núcleo.

### Cuidado com o `stdout`

`stdout` é o canal do protocolo MCP. Um único `console.log` corrompe a sessão e
o cliente desconecta sem explicar por quê. Diagnóstico vai para `stderr`.

---

## Referências

- **Colocar em fluxo automático**: [`docs/mcp-local-integracao-fluxo-automatico.md`](../../docs/mcp-local-integracao-fluxo-automatico.md) — roteiro de aceite contra a instância real, superfície de integração e regras inegociáveis. Leia antes de automatizar.
- Design: [`docs/superpowers/specs/2026-07-30-mcp-local-agendamento-multiconta-design.md`](../../docs/superpowers/specs/2026-07-30-mcp-local-agendamento-multiconta-design.md)
- Script que originou este pacote: [`scripts/agendar-carrossel.mjs`](../../scripts/agendar-carrossel.mjs)
- MCP remoto (outro propósito): `libraries/nestjs-libraries/src/chat/start.mcp.ts`
