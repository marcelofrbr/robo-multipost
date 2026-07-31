import { Ferramenta } from '../contexto';

/**
 * Panorama da configuracao.
 *
 * A `apiKey` NUNCA entra na saida: o retorno de uma ferramenta vira texto no
 * historico do modelo.
 */
export const listarContas: Ferramenta = {
  nome: 'listarContas',
  titulo: 'Listar contas configuradas',
  descricao:
    'Mostra as contas do contas.json com pasta de midias, apelidos de canal e canais padrao. ' +
    'Use para descobrir quais contas existem antes de listar posts ou agendar. Nao devolve chaves de API.',
  esquema: {},

  async executar(ctx) {
    const { contas, caminho } = ctx.carregar();

    return {
      arquivoConfig: caminho,
      contas: Object.values(contas).map((conta) => ({
        conta: conta.slug,
        pasta: conta.pasta,
        baseUrl: conta.baseUrl,
        canais: conta.canais,
        canaisPadrao: conta.canaisPadrao,
      })),
    };
  },
};
