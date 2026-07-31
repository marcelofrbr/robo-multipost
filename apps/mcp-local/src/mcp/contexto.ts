import { ZodRawShape } from 'zod';
import { ClienteApi } from '../nucleo/cliente-api';
import { ConfigCarregada, carregarContas } from '../nucleo/contas';
import { Conta } from '../nucleo/tipos';

/**
 * O que as ferramentas enxergam do mundo. Existe para os testes trocarem
 * config e cliente HTTP sem tocar disco nem rede.
 */
export interface Contexto {
  /**
   * Le a configuracao. Deliberadamente relido a cada chamada: assim editar o
   * `contas.json` (adicionar conta, corrigir um id de canal) passa a valer na
   * proxima ferramenta, sem reiniciar o cliente MCP.
   */
  carregar(): ConfigCarregada;
  clienteDe(conta: Conta): ClienteApi;
}

/** Contrato de uma ferramenta MCP deste servidor. */
export interface Ferramenta {
  nome: string;
  titulo: string;
  descricao: string;
  esquema: ZodRawShape;
  executar(ctx: Contexto, entrada: Record<string, unknown>): Promise<unknown>;
}

export function criarContexto(opcoes: { caminho?: string } = {}): Contexto {
  return {
    carregar: () => carregarContas({ caminho: opcoes.caminho }),
    clienteDe: (conta) => new ClienteApi(conta),
  };
}
