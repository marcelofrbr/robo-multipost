import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Contexto, criarContexto } from './contexto';
import { FERRAMENTAS } from './ferramentas/lista';

export const NOME_SERVIDOR = 'robo-multipost-local';
export const VERSAO_SERVIDOR = '1.0.0';

interface ConteudoTexto {
  type: 'text';
  text: string;
}

export interface RespostaFerramenta {
  content: ConteudoTexto[];
  isError?: boolean;
  // O `CallToolResult` do SDK e um tipo aberto; sem a assinatura de indice o
  // handler nao e aceito por `registerTool`.
  [chave: string]: unknown;
}

const comoTexto = (valor: unknown): string =>
  typeof valor === 'string' ? valor : JSON.stringify(valor, null, 2);

/**
 * Executa uma ferramenta e traduz o resultado para o formato do MCP.
 *
 * Falha vira `isError` com a mensagem legivel, nunca uma excecao que derrube
 * o processo: um servidor stdio que morre aparece no cliente apenas como
 * "desconectado", sem pista do motivo.
 */
export async function executarFerramenta(
  ctx: Contexto,
  nome: string,
  entrada: Record<string, unknown>
): Promise<RespostaFerramenta> {
  const ferramenta = FERRAMENTAS.find((f) => f.nome === nome);
  if (!ferramenta) {
    return {
      isError: true,
      content: [{ type: 'text', text: `Ferramenta desconhecida: ${nome}` }],
    };
  }

  try {
    const saida = await ferramenta.executar(ctx, entrada);
    return { content: [{ type: 'text', text: comoTexto(saida) }] };
  } catch (erro) {
    return {
      isError: true,
      content: [{ type: 'text', text: (erro as Error).message ?? String(erro) }],
    };
  }
}

export function criarServidor(ctx: Contexto = criarContexto()): McpServer {
  const servidor = new McpServer({
    name: NOME_SERVIDOR,
    version: VERSAO_SERVIDOR,
  });

  for (const ferramenta of FERRAMENTAS) {
    servidor.registerTool(
      ferramenta.nome,
      {
        title: ferramenta.titulo,
        description: ferramenta.descricao,
        inputSchema: ferramenta.esquema,
      },
      async (entrada: Record<string, unknown>) =>
        executarFerramenta(ctx, ferramenta.nome, entrada ?? {})
    );
  }

  return servidor;
}

export async function iniciarServidor(): Promise<void> {
  const servidor = criarServidor();
  await servidor.connect(new StdioServerTransport());
}
