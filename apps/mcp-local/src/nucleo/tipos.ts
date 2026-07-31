/**
 * Contratos compartilhados do MCP local.
 *
 * Nenhum arquivo deste pacote importa de `libraries/nestjs-libraries`: o MCP
 * local conversa com a instancia apenas por HTTP (`/public/v1`).
 */

/** Como o post entra na instancia. */
export type TipoAgendamento = 'draft' | 'schedule' | 'now';

/**
 * Formato do post. Traduzido para `settings` por rede em `montarSettings`.
 *
 * Nao existe formato "reel" no Instagram do Postiz: o `InstagramDto` aceita
 * `post_type: 'post' | 'story'` e um video enviado como `post` ja e publicado
 * como reel pela propria Meta.
 */
export type FormatoPost = 'carrossel' | 'post' | 'reels' | 'story';

export const FORMATOS: readonly FormatoPost[] = [
  'carrossel',
  'post',
  'reels',
  'story',
];

export const TIPOS_AGENDAMENTO: readonly TipoAgendamento[] = [
  'draft',
  'schedule',
  'now',
];

/** Uma conta ja resolvida: chave carregada do ambiente, caminhos absolutos. */
export interface Conta {
  /** Identificador curto usado nas ferramentas, ex.: `marca-a`. */
  slug: string;
  /** Base da API publica, ex.: `https://dominio/api/public/v1`. */
  baseUrl: string;
  /** Chave de PERFIL. Nunca de organizacao. */
  apiKey: string;
  /** Pasta raiz das midias desta conta, absoluta. */
  pasta: string;
  /** Apelido do canal -> integrationId. */
  canais: Record<string, string>;
  /** Apelidos usados quando o post nao declara `canais`. */
  canaisPadrao: string[];
}

/** O `post.json` como o usuario escreve. */
export interface ConfigPost {
  legenda: string;
  /** ISO 8601. Use fuso explicito, ex.: `2026-08-01T09:00:00-03:00`. */
  data: string;
  canais?: string[];
  tipo?: FormatoPost;
  legendaPorCanal?: Record<string, string>;
  /** Encurtar links no corpo do post. */
  encurtarLinks?: boolean;
  /** Nome do carrossel no LinkedIn. */
  nomeCarrossel?: string;
}

/** O que foi gravado em `.agendado.json` depois de um agendamento bem-sucedido. */
export interface RegistroAgendamento {
  agendadoEm: string;
  tipo: TipoAgendamento;
  data: string;
  canais: string[];
  resposta: unknown;
}

/** Um post encontrado em disco. */
export interface PostDescoberto {
  /** Nome da subpasta, ex.: `2026-08-01-carrossel-lancamento`. */
  nome: string;
  /** Caminho absoluto da subpasta. */
  caminho: string;
  config: ConfigPost;
  /** Caminhos absolutos das midias, ja ordenados. */
  midias: string[];
  jaAgendado: boolean;
  registro?: RegistroAgendamento;
}

/** Uma pasta que parece um post mas nao pode ser usada. */
export interface PostInvalido {
  nome: string;
  caminho: string;
  motivo: string;
}

export interface VarreduraConta {
  conta: string;
  prontos: PostDescoberto[];
  jaAgendados: PostDescoberto[];
  invalidos: PostInvalido[];
}

/** Integracao como devolvida por `GET /public/v1/integrations`. */
export interface Integracao {
  id: string;
  name: string;
  identifier: string;
  disabled?: boolean;
  picture?: string;
  profile?: string;
}

/** Midia hospedada, como devolvida por `POST /upload`. */
export interface MidiaSubida {
  id: string;
  path: string;
}

/** Um canal ja resolvido de apelido para integracao real. */
export interface CanalResolvido {
  apelido: string;
  integrationId: string;
  nome: string;
  identifier: string;
  legenda: string;
}

export interface ResultadoValidacao {
  ok: boolean;
  problemas: string[];
  canais: CanalResolvido[];
  quantidadeMidias: number;
  data?: string;
  tipoPost: FormatoPost;
}

export interface ResultadoAgendamento {
  conta: string;
  post: string;
  tipo: TipoAgendamento;
  data?: string;
  canais: CanalResolvido[];
  midias: MidiaSubida[];
  resposta: unknown;
}
