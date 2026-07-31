import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { Conta } from './tipos';

export const NOME_ARQUIVO_CONFIG = 'contas.json';

/**
 * Erro de configuracao. Carrega TODOS os problemas encontrados, nao apenas o
 * primeiro: corrigir o `contas.json` de uma vez e melhor do que descobrir um
 * problema por execucao.
 *
 * A mensagem nunca inclui valor de chave — so o NOME da variavel de ambiente.
 */
export class ErroConfig extends Error {
  constructor(public readonly problemas: string[]) {
    super(
      `Configuracao invalida:\n${problemas.map((p) => `  - ${p}`).join('\n')}`
    );
    this.name = 'ErroConfig';
  }
}

/** Aceita `https://dominio/api` ou ja com `/public/v1`, com ou sem barra final. */
export function normalizarBaseUrl(bruto: string): string {
  const limpa = String(bruto ?? '')
    .trim()
    .replace(/\/+$/, '');
  if (!limpa) {
    throw new ErroConfig(['baseUrl ausente. Ex.: "https://seu-dominio/api"']);
  }
  if (!/^https?:\/\//.test(limpa)) {
    throw new ErroConfig([`baseUrl invalida (falta http/https): ${limpa}`]);
  }
  return limpa.endsWith('/public/v1') ? limpa : `${limpa}/public/v1`;
}

/**
 * Analisador minimo de `.env`. Evita uma dependencia so para ler quatro linhas
 * e funciona igual independente de como o processo foi iniciado (o cwd de um
 * servidor MCP stdio lancado pelo Claude Desktop e imprevisivel).
 */
export function analisarEnv(texto: string): Record<string, string> {
  const saida: Record<string, string> = {};
  for (const linhaBruta of String(texto ?? '').split(/\r?\n/)) {
    const linha = linhaBruta.trim();
    if (!linha || linha.startsWith('#')) {
      continue;
    }
    const corte = linha.indexOf('=');
    if (corte <= 0) {
      continue;
    }
    const chave = linha.slice(0, corte).trim();
    let valor = linha.slice(corte + 1).trim();
    const entreAspas =
      valor.length >= 2 &&
      ((valor.startsWith('"') && valor.endsWith('"')) ||
        (valor.startsWith("'") && valor.endsWith("'")));
    if (entreAspas) {
      valor = valor.slice(1, -1);
    }
    saida[chave] = valor;
  }
  return saida;
}

interface ContaBruta {
  apiKeyEnv?: string;
  pasta?: string;
  baseUrl?: string;
  canais?: Record<string, string>;
  canaisPadrao?: string[];
}

interface ConfigBruta {
  baseUrl?: string;
  contas?: Record<string, ContaBruta>;
}

/**
 * Converte o `contas.json` cru em contas resolvidas, com a chave puxada do
 * ambiente e os caminhos absolutos.
 *
 * `baseDir` ancora pastas relativas — normalmente o diretorio onde vive o
 * proprio `contas.json`, para que a config nao dependa do cwd do processo.
 */
export function resolverContas(
  bruto: unknown,
  env: Record<string, string | undefined>,
  baseDir: string = process.cwd()
): Record<string, Conta> {
  const raiz = (bruto ?? {}) as ConfigBruta;
  const contasBrutas = raiz.contas;

  if (
    !contasBrutas ||
    typeof contasBrutas !== 'object' ||
    Object.keys(contasBrutas).length === 0
  ) {
    throw new ErroConfig([
      'O arquivo precisa de um bloco "contas" com pelo menos uma conta.',
    ]);
  }

  const problemas: string[] = [];
  const saida: Record<string, Conta> = {};

  for (const slug of Object.keys(contasBrutas)) {
    const conta = (contasBrutas[slug] ?? {}) as ContaBruta;
    const prefixo = `conta "${slug}":`;

    let baseUrl = '';
    try {
      baseUrl = normalizarBaseUrl(conta.baseUrl ?? raiz.baseUrl ?? '');
    } catch {
      problemas.push(
        `${prefixo} baseUrl ausente ou invalida (nem na conta, nem na raiz do arquivo).`
      );
    }

    let apiKey = '';
    if (!conta.apiKeyEnv) {
      problemas.push(
        `${prefixo} falta "apiKeyEnv" (o NOME da variavel de ambiente que guarda a chave de perfil).`
      );
    } else {
      const valor = env[conta.apiKeyEnv];
      if (!valor) {
        problemas.push(
          `${prefixo} a variavel de ambiente ${conta.apiKeyEnv} nao esta definida. Confira o .env ao lado do contas.json.`
        );
      } else {
        apiKey = valor;
      }
    }

    let pasta = '';
    if (!conta.pasta) {
      problemas.push(`${prefixo} falta "pasta" (raiz das midias desta conta).`);
    } else {
      pasta = isAbsolute(conta.pasta)
        ? resolve(conta.pasta)
        : resolve(baseDir, conta.pasta);
    }

    const canais = conta.canais ?? {};
    const apelidos = Object.keys(canais);
    if (apelidos.length === 0) {
      problemas.push(
        `${prefixo} precisa de pelo menos um canal em "canais" (apelido -> integrationId). Rode a ferramenta sincronizarCanais para descobrir os ids.`
      );
    }

    const canaisPadrao = conta.canaisPadrao ?? apelidos;
    const desconhecidos = canaisPadrao.filter((a) => !apelidos.includes(a));
    if (desconhecidos.length > 0) {
      problemas.push(
        `${prefixo} canaisPadrao cita apelido que nao existe em "canais": ${desconhecidos.join(', ')}.`
      );
    }

    saida[slug] = { slug, baseUrl, apiKey, pasta, canais, canaisPadrao };
  }

  if (problemas.length > 0) {
    throw new ErroConfig(problemas);
  }

  return saida;
}

/**
 * Onde procurar o `contas.json`: `MCP_LOCAL_CONFIG` quando definido, senao
 * `~/.robo-multipost/contas.json`. Nunca o cwd, que e imprevisivel sob stdio.
 */
export function caminhoPadraoConfig(
  env: Record<string, string | undefined> = process.env,
  home: string = homedir()
): string {
  return env.MCP_LOCAL_CONFIG
    ? resolve(env.MCP_LOCAL_CONFIG)
    : join(home, '.robo-multipost', NOME_ARQUIVO_CONFIG);
}

export interface OpcoesCarregamento {
  caminho?: string;
  env?: Record<string, string | undefined>;
}

export interface ConfigCarregada {
  contas: Record<string, Conta>;
  caminho: string;
}

/**
 * Le o `contas.json` do disco e o `.env` ao lado dele. Variaveis ja presentes
 * no ambiente real tem precedencia sobre o arquivo.
 */
export function carregarContas(
  opcoes: OpcoesCarregamento = {}
): ConfigCarregada {
  const ambienteBase = opcoes.env ?? process.env;
  const caminho = opcoes.caminho
    ? resolve(opcoes.caminho)
    : caminhoPadraoConfig(ambienteBase);

  if (!existsSync(caminho)) {
    throw new ErroConfig([
      `Arquivo de configuracao nao encontrado: ${caminho}`,
      'Copie contas.exemplo.json para esse caminho, ou aponte a variavel MCP_LOCAL_CONFIG para o arquivo.',
    ]);
  }

  const diretorio = dirname(caminho);
  const ambiente: Record<string, string | undefined> = { ...ambienteBase };
  const caminhoEnv = join(diretorio, '.env');
  if (existsSync(caminhoEnv)) {
    const doArquivo = analisarEnv(readFileSync(caminhoEnv, 'utf-8'));
    for (const [chave, valor] of Object.entries(doArquivo)) {
      if (ambiente[chave] === undefined) {
        ambiente[chave] = valor;
      }
    }
  }

  let bruto: unknown;
  try {
    bruto = JSON.parse(readFileSync(caminho, 'utf-8'));
  } catch (erro) {
    throw new ErroConfig([
      `JSON invalido em ${caminho}: ${(erro as Error).message}`,
    ]);
  }

  return { contas: resolverContas(bruto, ambiente, diretorio), caminho };
}

/** Busca a conta pelo slug, com erro que lista as disponiveis. */
export function obterConta(contas: Record<string, Conta>, slug: string): Conta {
  const conta = contas[slug];
  if (!conta) {
    throw new ErroConfig([
      `Conta "${slug}" nao existe. Disponiveis: ${
        Object.keys(contas).join(', ') || '(nenhuma)'
      }.`,
    ]);
  }
  return conta;
}
