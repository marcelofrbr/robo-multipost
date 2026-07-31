import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, extname, join, resolve, sep } from 'node:path';
import {
  ConfigPost,
  Conta,
  FORMATOS,
  FormatoPost,
  PostDescoberto,
  PostInvalido,
  RegistroAgendamento,
  VarreduraConta,
} from './tipos';

export const ARQUIVO_CONFIG_POST = 'post.json';
export const ARQUIVO_REGISTRO = '.agendado.json';

/**
 * Allowlist de extensoes. Qualquer coisa fora daqui e ignorada na varredura,
 * o que impede subir por acidente um `.psd`, `.zip` ou `.exe` que esteja
 * dormindo na pasta.
 */
export const MIME_POR_EXTENSAO: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
};

export const EXTENSOES_PERMITIDAS = Object.keys(MIME_POR_EXTENSAO);

/** Problema em um post especifico do disco. */
export class ErroPost extends Error {
  constructor(
    public readonly post: string,
    mensagem: string
  ) {
    super(`post "${post}": ${mensagem}`);
    this.name = 'ErroPost';
  }
}

/**
 * Costura fina sobre o `fs`, para os testes exercitarem a logica sem tocar o
 * disco.
 */
export interface SistemaArquivos {
  listar(diretorio: string): Promise<string[]>;
  ehDiretorio(caminho: string): Promise<boolean>;
  existe(caminho: string): Promise<boolean>;
  lerTexto(caminho: string): Promise<string>;
}

export const fsReal: SistemaArquivos = {
  listar: (diretorio) => readdir(diretorio),
  ehDiretorio: async (caminho) => {
    try {
      return (await stat(caminho)).isDirectory();
    } catch {
      return false;
    }
  },
  existe: async (caminho) => {
    try {
      await stat(caminho);
      return true;
    } catch {
      return false;
    }
  },
  lerTexto: (caminho) => readFile(caminho, 'utf-8'),
};

export function ehMidia(nome: string): boolean {
  return EXTENSOES_PERMITIDAS.includes(extname(nome).toLowerCase());
}

export function mimeDe(caminho: string): string {
  return (
    MIME_POR_EXTENSAO[extname(caminho).toLowerCase()] ??
    'application/octet-stream'
  );
}

/**
 * Filtra midias e ordena por nome com comparacao numerica, para que
 * `1, 2, 10` nao vire `1, 10, 2` — a ordem dos slides do carrossel e a ordem
 * em que sao publicados.
 */
export function ordenarMidias(nomes: string[]): string[] {
  return nomes
    .filter(ehMidia)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

/**
 * Converte o nome de um post no caminho absoluto dele, recusando qualquer
 * coisa que escape da pasta da conta.
 *
 * O nome chega de um LLM atraves da chamada MCP, entao e entrada nao confiavel:
 * so um segmento simples e aceito, nunca separador, `..` ou caminho absoluto.
 */
export function resolverPastaDoPost(conta: Conta, nome: string): string {
  const limpo = String(nome ?? '').trim();

  if (!limpo || limpo === '.' || limpo === '..') {
    throw new ErroPost(limpo || '(vazio)', 'nome de post invalido.');
  }
  if (limpo.includes('/') || limpo.includes('\\')) {
    throw new ErroPost(
      limpo,
      'nome de post invalido: use apenas o nome da subpasta, sem caminho.'
    );
  }
  if (limpo !== basename(limpo)) {
    throw new ErroPost(limpo, 'nome de post invalido.');
  }

  const raiz = resolve(conta.pasta);
  const alvo = resolve(raiz, limpo);
  if (alvo !== join(raiz, limpo) || !alvo.startsWith(raiz + sep)) {
    throw new ErroPost(limpo, 'caminho fora da pasta da conta.');
  }

  return alvo;
}

function validarConfig(nome: string, bruto: unknown): ConfigPost {
  const config = (bruto ?? {}) as Partial<ConfigPost>;

  if (!config.legenda || typeof config.legenda !== 'string') {
    throw new ErroPost(nome, `${ARQUIVO_CONFIG_POST} precisa de "legenda".`);
  }
  if (!config.data || typeof config.data !== 'string') {
    throw new ErroPost(
      nome,
      `${ARQUIVO_CONFIG_POST} precisa de "data" em ISO 8601 com fuso, ex.: "2026-08-01T09:00:00-03:00".`
    );
  }
  if (Number.isNaN(Date.parse(config.data))) {
    throw new ErroPost(nome, `data invalida: ${config.data}`);
  }
  if (config.tipo && !FORMATOS.includes(config.tipo as FormatoPost)) {
    throw new ErroPost(
      nome,
      `tipo "${config.tipo}" nao existe. Use um de: ${FORMATOS.join(', ')}.`
    );
  }

  return config as ConfigPost;
}

/** Le e valida um post especifico. Lanca `ErroPost` quando algo impede o uso. */
export async function carregarPost(
  conta: Conta,
  nome: string,
  fs: SistemaArquivos = fsReal
): Promise<PostDescoberto> {
  const caminho = resolverPastaDoPost(conta, nome);

  let entradas: string[];
  try {
    entradas = await fs.listar(caminho);
  } catch {
    throw new ErroPost(nome, `pasta nao encontrada: ${caminho}`);
  }

  if (!entradas.includes(ARQUIVO_CONFIG_POST)) {
    throw new ErroPost(
      nome,
      `falta o arquivo ${ARQUIVO_CONFIG_POST} nesta pasta.`
    );
  }

  const caminhoConfig = join(caminho, ARQUIVO_CONFIG_POST);
  let bruto: unknown;
  try {
    bruto = JSON.parse(await fs.lerTexto(caminhoConfig));
  } catch (erro) {
    throw new ErroPost(
      nome,
      `${ARQUIVO_CONFIG_POST} nao e JSON valido: ${(erro as Error).message}`
    );
  }

  const config = validarConfig(nome, bruto);
  const midias = ordenarMidias(entradas).map((m) => join(caminho, m));
  if (midias.length === 0) {
    throw new ErroPost(
      nome,
      `nenhuma midia na pasta. Extensoes aceitas: ${EXTENSOES_PERMITIDAS.join(
        ', '
      )}.`
    );
  }

  let registro: RegistroAgendamento | undefined;
  const jaAgendado = entradas.includes(ARQUIVO_REGISTRO);
  if (jaAgendado) {
    try {
      registro = JSON.parse(
        await fs.lerTexto(join(caminho, ARQUIVO_REGISTRO))
      ) as RegistroAgendamento;
    } catch {
      registro = undefined;
    }
  }

  return { nome, caminho, config, midias, jaAgendado, registro };
}

/**
 * Varre a pasta da conta e classifica cada subpasta. Nunca lanca por causa de
 * um post ruim: quem esta quebrado vai para `invalidos` com o motivo, e o
 * resto segue utilizavel.
 */
export async function varrerConta(
  conta: Conta,
  fs: SistemaArquivos = fsReal
): Promise<VarreduraConta> {
  let entradas: string[];
  try {
    entradas = await fs.listar(conta.pasta);
  } catch {
    throw new ErroPost(
      conta.slug,
      `pasta da conta nao encontrada: ${conta.pasta}`
    );
  }

  const prontos: PostDescoberto[] = [];
  const jaAgendados: PostDescoberto[] = [];
  const invalidos: PostInvalido[] = [];

  const ordenadas = [...entradas].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true })
  );

  for (const entrada of ordenadas) {
    const caminho = join(conta.pasta, entrada);
    if (!(await fs.ehDiretorio(caminho))) {
      continue;
    }

    try {
      const post = await carregarPost(conta, entrada, fs);
      if (post.jaAgendado) {
        jaAgendados.push(post);
      } else {
        prontos.push(post);
      }
    } catch (erro) {
      invalidos.push({
        nome: entrada,
        caminho,
        motivo:
          erro instanceof ErroPost
            ? erro.message.replace(`post "${entrada}": `, '')
            : String(erro),
      });
    }
  }

  return { conta: conta.slug, prontos, jaAgendados, invalidos };
}
