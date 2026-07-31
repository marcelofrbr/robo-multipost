# MCP local: guia de integração para fluxo automático

**Para quem vai fazer a integração.** Este documento diz o que já existe, o que
ainda não foi validado, o que você pode reusar e o que **não** pode ser
quebrado.

Leia até a seção 2 antes de escrever qualquer linha. A seção 2 já foi executada
para a primeira conta (31/07/2026) e continua sendo pré-requisito para cada
conta nova.

- Pacote: `apps/mcp-local/`
- Manual de uso: [`apps/mcp-local/README.md`](../apps/mcp-local/README.md)
- Design e o porquê das decisões: [`docs/superpowers/specs/2026-07-30-mcp-local-agendamento-multiconta-design.md`](superpowers/specs/2026-07-30-mcp-local-agendamento-multiconta-design.md)

---

## 1. Estado atual, sem maquiagem

**Aceite executado em 31/07/2026** contra a instância real
(`post.marcelofranca.pro`, perfil MFPRO). Passos 1 a 6 da seção 2: verdes.
Passo 7 (publicação de verdade): pendente.

### Verificado

| O quê | Como foi verificado |
|---|---|
| Núcleo (contas, descoberta, cliente HTTP, agendador) | 87 testes, 5 suítes, `pnpm test:mcp-local` |
| Compilação | `pnpm build:mcp-local` sem erro, `tsc --noEmit` limpo |
| Handshake MCP por stdio | `initialize` + `tools/list` + `tools/call` respondidos por processo real |
| Registro como servidor MCP | `claude mcp add` no Claude Code: conecta e expõe as cinco ferramentas |
| Formato do payload de `POST /public/v1/posts` | Conferido campo a campo contra `CreatePostDto` e `MediaDto` do backend, sem divergência |
| `sincronizarCanais` contra a instância real | Autenticou com chave de perfil e devolveu as integrações reais |
| `listarPostsPendentes` e `validarPost` contra a instância real | Ponta a ponta, `ok: true`, canais resolvidos para os nomes reais |
| **`agendarPost` com `tipo: "draft"`** | **Upload multipart real de 2 mídias e post real criado.** Conferido no app: perfil certo, canal certo, legenda certa, slides na ordem certa e horário 23:00 respeitando o fuso `-03:00` |
| Idempotência | Segunda chamada recusada citando `.agendado.json`; o post migrou de `prontos` para `jaAgendados` |
| Leitura de `contas.json` + `.env`, ancoragem de caminho relativo, ordenação numérica de mídias | Idem |

### **Não** verificado

| O quê | Por que importa |
|---|---|
| Passo 7: publicar de verdade no horário marcado | Exige backend **e Temporal** no ar. É o único passo que publica conteúdo real |
| `agendarPost` com `tipo: "schedule"` | Mesmo caminho de código do draft; muda só o `type` do payload |
| Vídeo (`.mp4`) | Só imagens foram exercitadas ponta a ponta |
| LinkedIn e as demais redes | Só o Instagram foi exercitado ponta a ponta |
| Funcionamento dentro do Claude Desktop | Não instalado nesta máquina. Validado no Claude Code, que usa o mesmo transporte stdio |

**Consequência prática:** o caminho crítico — upload real e criação de post
real — está provado. Falta ver a coisa sair no horário (passo 7) antes de
confiar num laço automático.

---

## 2. Roteiro de aceite (pré-requisito)

**Já executado em 31/07/2026 para a conta `mfpro`** — passos 1 a 6 verdes, só o
7 falta. Você não precisa repetir para essa conta. O roteiro continua valendo,
na íntegra, para **cada conta nova** que entrar no `contas.json`: chave, canais
e permissões são por perfil, e nada disso é herdado.

Faça isto **manualmente**, uma vez por conta, antes de automatizar qualquer
coisa. Cada passo tem um critério objetivo.

### Passo 0 — Preparar

```bash
pnpm install
pnpm build:mcp-local
```

Crie `~/.robo-multipost/contas.json` a partir de
`apps/mcp-local/contas.exemplo.json` e o `.env` ao lado com a **chave de perfil**
(nunca a de organização).

Comece com **uma** conta só.

### Passo 1 — Config carrega

Chame `listarContas`.

✅ Devolve a conta com pasta e `baseUrl` corretos.
❌ "Arquivo de configuracao nao encontrado" → caminho errado, use `MCP_LOCAL_CONFIG`.

### Passo 2 — Autenticação e canais reais

Chame `sincronizarCanais` para essa conta. **Primeira requisição HTTP real.**

✅ Devolve `integracoesNoPerfil` com os canais que você reconhece.
❌ 401/403 → chave errada. Gere a chave de **perfil**. Não tente a de organização.

Cole o `sugestaoCanais` no `contas.json` e ajuste os apelidos.

### Passo 3 — Post de teste

Crie uma pasta com 2 imagens e um `post.json`:

```json
{ "legenda": "teste de integracao", "data": "2026-12-31T23:00:00-03:00" }
```

Chame `listarPostsPendentes`.

✅ O post aparece em `prontos`, com a contagem de mídias certa.

### Passo 4 — Validação sem efeito colateral

Chame `validarPost`.

✅ `ok: true`, canais resolvidos para os nomes reais.
❌ "aponta para integrationId ... que nao existe" → o passo 2 não foi concluído.

### Passo 5 — Rascunho (o teste que importa)

Chame `agendarPost` com `tipo: "draft"`.

Este é o passo que fecha o buraco: exercita upload multipart real e criação de
post real.

✅ Retorna sem erro, **e** o rascunho aparece no app com as imagens na ordem
certa, no perfil certo, com a legenda certa.
✅ `.agendado.json` foi criado na pasta.
❌ Erro de upload ou de payload → **pare aqui e conserte**. É exatamente o risco
que este roteiro existe para pegar.

### Passo 6 — Idempotência

Chame `agendarPost` de novo, no mesmo post.

✅ Recusa, citando `.agendado.json` e `forcar`.

### Passo 7 — Agendamento de verdade

Apague o `.agendado.json`, ajuste a data para daqui a alguns minutos, chame com
`tipo: "schedule"`.

✅ Aparece agendado no calendário do perfil certo.
✅ Publica na hora marcada (exige backend **e Temporal** no ar).

**Só depois do passo 7 verde é que faz sentido automatizar.**

---

## 3. Superfície de integração

### A regra que sustenta tudo

> **Os adaptadores conhecem o núcleo. O núcleo não conhece ninguém.**

`src/nucleo/` não importa nada de `src/mcp/`, e não deve importar nada do que
você construir. É o que mantém a lógica testável sem disco nem rede.

Se você precisar mudar o núcleo para o fluxo automático funcionar, provavelmente
está reimplementando algo. Confira antes.

### O que reusar (não reimplemente)

| Precisa de | Use | Onde |
|---|---|---|
| Ler config e resolver chaves | `carregarContas()`, `obterConta()` | `src/nucleo/contas.ts` |
| Descobrir posts numa conta | `varrerConta(conta)` | `src/nucleo/descoberta.ts` |
| Carregar um post específico | `carregarPost(conta, nome)` | `src/nucleo/descoberta.ts` |
| Falar com a API | `new ClienteApi(conta)` | `src/nucleo/cliente-api.ts` |
| Validar sem efeito colateral | `validarPost(...)` | `src/nucleo/agendador.ts` |
| **Agendar** | `agendarPost(depsPadrao(cliente), {...})` | `src/nucleo/agendador.ts` |

O ponto de entrada do fluxo automático é `agendarPost`. Ele já faz, nesta ordem:

1. checa `.agendado.json` (idempotência);
2. busca as integrações reais;
3. valida canais, mídias e data;
4. **só então** sobe as mídias;
5. cria os posts;
6. grava `.agendado.json`.

Se qualquer coisa falhar antes do passo 5, nada foi publicado e nada foi
registrado. Reexecutar é seguro.

### Injeção de dependência

`agendarPost` recebe um `DepsAgendamento`:

```ts
interface DepsAgendamento {
  cliente: ClienteApi;
  lerMidia(caminho: string): Promise<Buffer>;
  gravarRegistro(caminhoPost: string, registro: RegistroAgendamento): Promise<void>;
  agora(): Date;
  gerarId(): string;
}
```

Use `depsPadrao(cliente)` em produção. Troque peças nos testes — é assim que os
85 testes rodam sem tocar disco nem rede.

Exemplo de uso completo:

```ts
import { agendarPost, depsPadrao } from './nucleo/agendador';
import { ClienteApi } from './nucleo/cliente-api';
import { carregarContas, obterConta } from './nucleo/contas';
import { carregarPost } from './nucleo/descoberta';

const { contas } = carregarContas();
const conta = obterConta(contas, 'marca-a');
const post = await carregarPost(conta, '2026-08-01-carrossel');

const resultado = await agendarPost(depsPadrao(new ClienteApi(conta)), {
  conta,
  post,
  tipo: 'schedule',
});
```

---

## 4. O fluxo automático: varredura agendada, não watcher

**Recomendação: varredura periódica (Agendador de Tarefas / cron), não
observador de pasta.**

Um `fs.watch` parece a escolha óbvia e é uma armadilha. Três motivos:

**1. Ele dispara cedo demais.** O evento chega quando o *primeiro* arquivo
aparece. Você copia 8 slides para a pasta e o watcher acorda no slide 1, com o
`post.json` ainda inexistente e 7 imagens faltando. Ou pior: acorda quando o
`post.json` já existe mas os slides ainda estão sendo escritos, e agenda um
carrossel pela metade.

**2. Ele não sobrevive a reinício.** Máquina reiniciou durante a noite? Tudo que
entrou nas pastas enquanto o processo estava fora nunca gera evento. Silêncio,
que é o pior modo de falha para agendamento.

**3. Ele erra em silêncio.** Um processo em background que morre não avisa
ninguém. Você descobre quando o cliente pergunta por que o post não saiu.

A varredura periódica resolve os três de graça: ela **sempre olha o estado atual
do mundo**, não a sequência de eventos. Reinício não perde nada, pasta
incompleta é rejeitada pela validação e tentada de novo no ciclo seguinte, e o
`.agendado.json` garante que ninguém publique duas vezes.

O custo é latência: um post fica até um ciclo esperando. Para agendamento de
conteúdo isso é irrelevante — você já agenda com horas ou dias de antecedência.

### O que construir

Um comando `varrer-e-agendar` que:

1. carrega o `contas.json`;
2. para **cada** conta, chama `varrerConta`;
3. para cada post em `prontos`, chama `agendarPost` com `tipo: "schedule"`;
4. escreve um relatório do que fez;
5. sai com código de saída significativo.

E uma entrada no Agendador de Tarefas do Windows rodando de 10 em 10 minutos.

### Comportamento exigido

| Situação | O que deve acontecer |
|---|---|
| Post em `prontos` e válido | Agenda, grava `.agendado.json`, registra no relatório |
| Post em `jaAgendados` | Ignora silenciosamente. **Nunca** passe `forcar: true` no fluxo automático |
| Post em `invalidos` | Registra o motivo no log. **Não** derruba o ciclo |
| Conta com pasta inexistente | Registra e segue para as outras contas |
| Falha de API numa conta | Registra e segue. O próximo ciclo tenta de novo |
| Data no passado | `validarPost` já rejeita. Vai para o log, não vira erro fatal |
| Nada a fazer | Sai em silêncio, código 0 |

**`forcar: true` é proibido no automático.** Ele existe para uso deliberado
humano. Num laço automático, ele transforma cada ciclo numa republicação.

### Códigos de saída

| Código | Significado |
|---|---|
| 0 | Ciclo completo, com ou sem posts agendados |
| 1 | Erro de configuração (config ausente, chave faltando) — exige intervenção |
| 2 | Ciclo rodou mas houve falha em pelo menos uma conta — vale investigar |

Diferenciar 1 de 2 importa: 1 significa "não vai funcionar até alguém arrumar",
2 significa "pode ser transitório, o próximo ciclo tenta".

### Log

Escreva em arquivo, com data e hora, uma linha por post processado. Sem log, um
agendamento automático que falhou é indistinguível de um que nunca teve nada
para fazer.

Nunca registre a chave de API. Use `mascararSegredo` (`src/nucleo/cliente-api.ts`)
se for logar corpo de resposta.

### Se você insistir no watcher

Se houver motivo real para reação imediata, use watcher **somando** à varredura,
nunca no lugar dela, e resolva o problema da pasta incompleta com uma das duas:

- **Marcador explícito:** só considera pronta a pasta que tiver um arquivo
  `pronto.txt`. Quem produz o conteúdo cria esse arquivo por último.
- **Estabilidade:** depois do último evento, espere N segundos sem mudança na
  pasta antes de processar.

Mesmo assim, mantenha a varredura periódica como rede de segurança.

---

## 5. Regras inegociáveis

Quebrar qualquer uma destas causa bug silencioso ou vazamento.

**1. `stdout` é do protocolo MCP.** Um `console.log` no processo do servidor
corrompe a sessão e o cliente desconecta sem explicar. Diagnóstico vai para
`stderr`. Vale para todo código que rode dentro do processo do servidor.

**2. Chave de perfil, nunca de organização.** A de organização agenda, mas os
posts ficam invisíveis no dashboard do perfil. Em 401/403 o cliente aborta de
propósito — não acrescente fallback.

**3. A chave nunca aparece na saída.** Nem em log, nem em retorno de ferramenta,
nem em mensagem de erro. `listarContas` omite o campo; erros passam por
`mascararSegredo`.

**4. Validar antes de subir.** A ordem em `agendarPost` é deliberada. Não mova
upload para antes da validação "para economizar uma chamada".

**5. `.agendado.json` é a trava.** Não a contorne. Se precisar reagendar num
fluxo, apague o arquivo conscientemente — não passe `forcar` por padrão.

**6. Caminho de post é entrada não confiável.** Ele chega de um modelo. Use
sempre `resolverPastaDoPost`, que rejeita `..`, separador e caminho absoluto.
Não monte caminho com concatenação de string.

**7. Extensões pela allowlist.** `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`,
`.mp4`. Não amplie sem entender o que a rede de destino aceita.

**8. Instagram: `post_type` é só `post` ou `story`.** Não existe `'reel'` — o
`InstagramDto` rejeita com 400. Vídeo enviado como `post` já vira reel pela
própria Meta.

**9. Data com fuso explícito.** `2026-08-01T09:00:00-03:00`. Sem o fuso vira
UTC e o post sai 3 horas fora do lugar.

**10. TDD.** Regra do repositório. Spec co-locado, sufixo `.spec.ts`, escrito
antes. `describe`/`it` em pt-BR sem acentos.

---

## 6. Como testar o que você construir

```bash
pnpm test:mcp-local        # da raiz
pnpm build:mcp-local
```

Specs novos vão em `apps/mcp-local/src/**/*.spec.ts` — o `testMatch` do projeto
já os coleta.

Siga o padrão que já está lá: injete as dependências, nada de disco nem de rede
nos testes. Veja `src/nucleo/agendador.spec.ts` para o exemplo mais completo
(mocks de cliente, leitura de mídia, gravação de registro e relógio fixo).

Para o comando de varredura, cubra no mínimo:

- conta com pasta inexistente não derruba as outras;
- post em `jaAgendados` é ignorado;
- post inválido vai para o log e não interrompe o ciclo;
- falha de API numa conta não impede as outras;
- código de saída correto em cada cenário;
- **`forcar` nunca é passado**.

### Sobre o lint

O `pnpm lint` citado no `CLAUDE.md` **não existe** no `package.json`, e chamar o
eslint direto quebra com `Converting circular structure to JSON` — problema
pré-existente do repositório, no eslint 8.57.0, que reproduz em arquivo
intocado. Não perca tempo tentando consertar seu código por causa disso.

Verifique com `npx tsc -p apps/mcp-local/tsconfig.json --noEmit` e com os testes.

### Suíte com falha conhecida

`libraries/nestjs-libraries/src/database/prisma/startup-migration.service.spec.ts`
falha por erro de tipo (mock devolve `{deleted, skipped}`, serviço exige também
`failed`). É pré-existente e não tem relação com este pacote.

---

## 7. Checklist de entrega

- [ ] Roteiro de aceite da seção 2 completo, incluindo o passo 7
- [ ] Comando de varredura implementado com specs
- [ ] `pnpm test:mcp-local` verde
- [ ] `npx tsc -p apps/mcp-local/tsconfig.json --noEmit` limpo
- [ ] Tarefa agendada criada e testada com uma execução manual
- [ ] Log em arquivo, com rotação ou limite de tamanho
- [ ] Confirmado que `forcar` não aparece no caminho automático
- [ ] Confirmado que a chave não aparece em nenhum log
- [ ] Um ciclo completo observado: pasta nova → agendado → `.agendado.json` → ciclo seguinte ignora
- [ ] `README.md` do pacote atualizado com a seção do fluxo automático
- [ ] `CHANGELOG.md`, seção `## [Unreleased]`, em pt-BR com acentos

---

## 8. Mapa rápido dos arquivos

```
apps/mcp-local/
  README.md                 manual de uso
  contas.exemplo.json       modelo do registro de contas
  post.exemplo.json         modelo do post.json
  src/
    nucleo/                 NÃO conhece MCP nem automação
      tipos.ts              contratos compartilhados
      contas.ts             carrega contas.json + .env, valida, resolve chaves
      descoberta.ts         varre pastas, ordena mídias, confina caminho
      cliente-api.ts        HTTP contra /public/v1, mascara segredo
      agendador.ts          valida -> sobe mídias -> agenda -> grava registro
    mcp/                    casca fina sobre o núcleo
      contexto.ts           o que as ferramentas enxergam
      servidor.ts           stdio, registra ferramentas, erro vira isError
      ferramentas/          uma por arquivo + lista.ts (registro)
    index.ts                entrypoint
    vigia/                  reservado para o fluxo automático
```

A pasta `vigia/` está reservada de propósito. Se o fluxo automático virar um
processo residente, é ali que ele mora. Se virar um comando de varredura chamado
pelo agendador do sistema, considere `src/cli/`.
