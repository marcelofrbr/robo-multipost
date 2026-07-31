import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ClienteApi } from './cliente-api';
import { ARQUIVO_REGISTRO, mimeDe } from './descoberta';
import {
  CanalResolvido,
  ConfigPost,
  Conta,
  FormatoPost,
  Integracao,
  MidiaSubida,
  PostDescoberto,
  RegistroAgendamento,
  ResultadoAgendamento,
  ResultadoValidacao,
  TipoAgendamento,
} from './tipos';

/** Falha de agendamento que ja carrega a lista de problemas para o usuario. */
export class ErroAgendamento extends Error {
  constructor(
    public readonly problemas: string[],
    mensagem?: string
  ) {
    super(
      mensagem ??
        `Nao da para agendar:\n${problemas.map((p) => `  - ${p}`).join('\n')}`
    );
    this.name = 'ErroAgendamento';
  }
}

export interface DepsAgendamento {
  cliente: ClienteApi;
  lerMidia(caminho: string): Promise<Buffer>;
  gravarRegistro(
    caminhoPost: string,
    registro: RegistroAgendamento
  ): Promise<void>;
  agora(): Date;
  gerarId(): string;
}

const ALFABETO = 'abcdefghijklmnopqrstuvwxyz0123456789';

function idAleatorio(tamanho = 10): string {
  let saida = '';
  for (let i = 0; i < tamanho; i += 1) {
    saida += ALFABETO[Math.floor(Math.random() * ALFABETO.length)];
  }
  return saida;
}

/** Dependencias reais, usadas fora dos testes. */
export function depsPadrao(cliente: ClienteApi): DepsAgendamento {
  return {
    cliente,
    lerMidia: (caminho) => readFile(caminho),
    gravarRegistro: async (caminhoPost, registro) => {
      await writeFile(
        join(caminhoPost, ARQUIVO_REGISTRO),
        `${JSON.stringify(registro, null, 2)}\n`,
        'utf-8'
      );
    },
    agora: () => new Date(),
    gerarId: () => idAleatorio(),
  };
}

/**
 * Traduz o formato do post para o `settings` que cada rede espera.
 *
 * Instagram: `post_type` so aceita `post` ou `story` (ver `InstagramDto`). Um
 * video enviado como `post` ja e publicado como reel pela Meta, entao o
 * formato `reels` nao muda o payload — ele existe so para deixar a intencao
 * explicita no `post.json`.
 */
export function montarSettings(
  identifier: string,
  tipo: FormatoPost,
  config: ConfigPost
): Record<string, unknown> {
  const rede = String(identifier).toLowerCase();

  if (rede.startsWith('instagram')) {
    return {
      post_type: tipo === 'story' ? 'story' : 'post',
      collaborators: [],
    };
  }

  if (rede.startsWith('linkedin')) {
    const settings: Record<string, unknown> = {
      post_as_images_carousel: tipo === 'carrossel',
    };
    if (config.nomeCarrossel) {
      settings.carousel_name = config.nomeCarrossel;
    }
    return settings;
  }

  return {};
}

/**
 * Confere tudo o que pode dar errado ANTES de qualquer byte subir: apelidos,
 * existencia e estado das integracoes, e a data.
 */
export function validarPost(
  conta: Conta,
  post: PostDescoberto,
  integracoes: Integracao[],
  tipo: TipoAgendamento,
  agora: Date
): ResultadoValidacao {
  const problemas: string[] = [];
  const canais: CanalResolvido[] = [];
  const tipoPost: FormatoPost = post.config.tipo ?? 'carrossel';

  const apelidos = post.config.canais ?? conta.canaisPadrao;
  if (!apelidos || apelidos.length === 0) {
    problemas.push(
      `nenhum canal definido: informe "canais" no post.json ou "canaisPadrao" na conta "${conta.slug}".`
    );
  }

  for (const apelido of apelidos ?? []) {
    const integrationId = conta.canais[apelido];
    if (!integrationId) {
      problemas.push(
        `apelido "${apelido}" nao existe em "canais" da conta "${
          conta.slug
        }". Disponiveis: ${Object.keys(conta.canais).join(', ') || '(nenhum)'}.`
      );
      continue;
    }

    const integracao = integracoes.find((i) => i.id === integrationId);
    if (!integracao) {
      problemas.push(
        `o canal "${apelido}" aponta para integrationId ${integrationId}, que nao existe neste perfil. Rode sincronizarCanais para atualizar o contas.json.`
      );
      continue;
    }
    if (integracao.disabled) {
      problemas.push(
        `a integracao "${integracao.name}" (apelido "${apelido}") esta desabilitada no app.`
      );
      continue;
    }

    canais.push({
      apelido,
      integrationId,
      nome: integracao.name,
      identifier: integracao.identifier,
      legenda: post.config.legendaPorCanal?.[apelido] ?? post.config.legenda,
    });
  }

  if (post.midias.length === 0) {
    problemas.push('o post nao tem nenhuma midia.');
  }

  if (tipo !== 'now') {
    const quando = Date.parse(post.config.data);
    if (Number.isNaN(quando)) {
      problemas.push(`data invalida: ${post.config.data}`);
    } else if (tipo === 'schedule' && quando <= agora.getTime()) {
      problemas.push(
        `a data ${post.config.data} esta no passado. Ajuste o post.json ou use tipo "draft".`
      );
    }
  }

  return {
    ok: problemas.length === 0,
    problemas,
    canais,
    quantidadeMidias: post.midias.length,
    data: post.config.data,
    tipoPost,
  };
}

export interface EntradaAgendamento {
  conta: Conta;
  post: PostDescoberto;
  tipo?: TipoAgendamento;
  forcar?: boolean;
}

/**
 * Sobe as midias e agenda o post em cada canal.
 *
 * Ordem deliberada: idempotencia, depois validacao completa, e so entao o
 * primeiro upload. Se algo falhar no meio dos uploads, `criarPosts` nunca e
 * chamado e o registro nao e gravado — reexecutar continua seguro, e as
 * midias orfas sao recolhidas pelo `MediaCleanupService` da instancia.
 */
export async function agendarPost(
  deps: DepsAgendamento,
  entrada: EntradaAgendamento
): Promise<ResultadoAgendamento> {
  const { conta, post } = entrada;
  const tipo = entrada.tipo ?? 'schedule';

  if (post.jaAgendado && !entrada.forcar) {
    throw new ErroAgendamento(
      [],
      `O post "${post.nome}" ja foi agendado (existe ${ARQUIVO_REGISTRO} na pasta). ` +
        'Passe forcar: true para agendar de novo — isso cria uma SEGUNDA publicacao, nao substitui a anterior.'
    );
  }

  const integracoes = await deps.cliente.listarIntegracoes();
  const agora = deps.agora();
  const validacao = validarPost(conta, post, integracoes, tipo, agora);
  if (!validacao.ok) {
    throw new ErroAgendamento(validacao.problemas);
  }

  const midias: MidiaSubida[] = [];
  for (const caminho of post.midias) {
    const bytes = await deps.lerMidia(caminho);
    midias.push(
      await deps.cliente.subirMidia(basename(caminho), mimeDe(caminho), bytes)
    );
  }

  const imagem = midias.map((m) => ({ id: m.id, path: m.path }));
  const data = tipo === 'now' ? agora.toISOString() : post.config.data;

  const payload = {
    type: tipo,
    shortLink: post.config.encurtarLinks ?? false,
    date: data,
    tags: [],
    posts: validacao.canais.map((canal) => ({
      integration: { id: canal.integrationId },
      group: deps.gerarId(),
      settings: montarSettings(
        canal.identifier,
        validacao.tipoPost,
        post.config
      ),
      value: [{ content: canal.legenda, id: deps.gerarId(), image: imagem }],
    })),
  };

  const resposta = await deps.cliente.criarPosts(payload);

  const registro: RegistroAgendamento = {
    agendadoEm: agora.toISOString(),
    tipo,
    data,
    canais: validacao.canais.map((c) => c.apelido),
    resposta,
  };
  await deps.gravarRegistro(post.caminho, registro);

  return {
    conta: conta.slug,
    post: post.nome,
    tipo,
    data,
    canais: validacao.canais,
    midias,
    resposta,
  };
}
