import { Conta, Integracao, MidiaSubida } from './tipos';

/** Resposta HTTP no minimo que este cliente precisa. `Response` satisfaz. */
export interface RespostaHttp {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface OpcoesHttp {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

/** Costura sobre o `fetch`, para os testes nao tocarem a rede. */
export type Buscador = (
  url: string,
  opcoes?: OpcoesHttp
) => Promise<RespostaHttp>;

const buscadorPadrao: Buscador = (url, opcoes) =>
  fetch(url, opcoes as Parameters<typeof fetch>[1]);

export class ErroApi extends Error {
  constructor(
    public readonly status: number,
    public readonly corpo: unknown,
    mensagem: string
  ) {
    super(mensagem);
    this.name = 'ErroApi';
  }
}

/**
 * Remove o segredo de um texto antes de ele virar mensagem de erro.
 *
 * Nao e paranoia: a API pode devolver o token no corpo do erro, e esse corpo
 * vai parar na resposta de uma ferramenta MCP, que por sua vez vai para o
 * historico de um modelo.
 */
export function mascararSegredo(texto: string, segredo: string): string {
  if (!segredo) {
    return texto;
  }
  return texto.split(segredo).join('***');
}

/** Cliente HTTP da API publica, escopado a UMA conta (uma chave de perfil). */
export class ClienteApi {
  constructor(
    private readonly conta: Conta,
    private readonly buscar: Buscador = buscadorPadrao
  ) {}

  private async requisitar<T>(
    caminho: string,
    opcoes: OpcoesHttp = {}
  ): Promise<T> {
    const url = `${this.conta.baseUrl}${caminho}`;
    const resposta = await this.buscar(url, {
      ...opcoes,
      headers: { Authorization: this.conta.apiKey, ...(opcoes.headers ?? {}) },
    });

    const texto = await resposta.text();
    let corpo: unknown;
    try {
      corpo = texto ? JSON.parse(texto) : null;
    } catch {
      corpo = texto;
    }

    if (!resposta.ok) {
      throw new ErroApi(
        resposta.status,
        corpo,
        this.mensagemDeErro(caminho, resposta.status, corpo)
      );
    }

    return corpo as T;
  }

  /**
   * Monta a mensagem de falha. No 401/403 a orientacao e explicita: trocar
   * pela chave de PERFIL correta, nunca cair para a chave de organizacao —
   * ela agenda, mas os posts ficam invisiveis no dashboard do perfil.
   */
  private mensagemDeErro(
    caminho: string,
    status: number,
    corpo: unknown
  ): string {
    const detalhe = mascararSegredo(
      typeof corpo === 'string' ? corpo : JSON.stringify(corpo),
      this.conta.apiKey
    );

    const base = `conta "${this.conta.slug}": ${caminho} falhou (HTTP ${status}): ${detalhe}`;

    if (status === 401 || status === 403) {
      return (
        `${base}\n` +
        'Autenticacao recusada. Confira a chave de perfil desta conta no .env. ' +
        'NAO troque pela chave de organizacao: ela cria os posts invisiveis no dashboard do perfil.'
      );
    }

    return base;
  }

  async listarIntegracoes(): Promise<Integracao[]> {
    return this.requisitar<Integracao[]>('/integrations');
  }

  /** Sobe bytes locais via multipart. Devolve `{ id, path }`. */
  async subirMidia(
    nome: string,
    mime: string,
    bytes: Buffer | Uint8Array
  ): Promise<MidiaSubida> {
    const formulario = new FormData();
    formulario.append(
      'file',
      new Blob([new Uint8Array(bytes)], { type: mime }),
      nome
    );

    const saida = await this.requisitar<Partial<MidiaSubida>>('/upload', {
      method: 'POST',
      body: formulario,
    });

    return this.exigirMidia(saida, nome);
  }

  /** Hospeda uma midia que ja esta numa URL publica. */
  async subirMidiaDeUrl(url: string): Promise<MidiaSubida> {
    const saida = await this.requisitar<Partial<MidiaSubida>>(
      '/upload-from-url',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      }
    );

    return this.exigirMidia(saida, url);
  }

  private exigirMidia(
    saida: Partial<MidiaSubida>,
    origem: string
  ): MidiaSubida {
    if (!saida?.id || !saida?.path) {
      throw new ErroApi(
        200,
        saida,
        `upload de "${origem}" nao devolveu id e path: ${mascararSegredo(
          JSON.stringify(saida),
          this.conta.apiKey
        )}`
      );
    }
    return { id: saida.id, path: saida.path };
  }

  async criarPosts(payload: unknown): Promise<unknown> {
    return this.requisitar('/posts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
}
