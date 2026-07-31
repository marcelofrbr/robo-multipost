import { z } from 'zod';
import { obterConta } from '../../nucleo/contas';
import { Ferramenta } from '../contexto';

/** Apelido inicial a partir da rede, so como ponto de partida editavel. */
function sugerirApelido(identifier: string): string {
  const rede = String(identifier).toLowerCase();
  if (rede.startsWith('instagram')) {
    return 'ig';
  }
  if (rede.startsWith('linkedin')) {
    return 'li';
  }
  if (rede.startsWith('facebook')) {
    return 'fb';
  }
  return rede.split('-')[0] || rede;
}

/**
 * Reconectar um canal no app gera um novo `integrationId`, o que silenciosamente
 * invalida o apelido no `contas.json`. Esta ferramenta mostra a diferenca e
 * entrega o bloco corrigido pronto para colar.
 *
 * Nao escreve no `contas.json` de proposito: quem edita a config e o usuario.
 */
export const sincronizarCanais: Ferramenta = {
  nome: 'sincronizarCanais',
  titulo: 'Conferir os ids dos canais',
  descricao:
    'Lista as integracoes reais do perfil da conta e compara com os apelidos do contas.json. ' +
    'Aponta apelidos apontando para id inexistente e devolve um bloco "canais" pronto para colar. ' +
    'Use ao cadastrar uma conta nova ou depois de reconectar um canal.',
  esquema: {
    conta: z.string().describe('Slug da conta, como aparece em listarContas.'),
  },

  async executar(ctx, entrada) {
    const { contas, caminho } = ctx.carregar();
    const conta = obterConta(contas, String(entrada.conta));
    const integracoes = await ctx.clienteDe(conta).listarIntegracoes();

    const idsReais = new Set(integracoes.map((i) => i.id));
    const apelidosObsoletos = Object.entries(conta.canais)
      .filter(([, id]) => !idsReais.has(id))
      .map(([apelido, id]) => ({
        apelido,
        integrationIdConfigurado: id,
        motivo: 'esse id nao existe mais neste perfil',
      }));

    const porId = new Map(
      Object.entries(conta.canais).map(([apelido, id]) => [id, apelido])
    );

    return {
      conta: conta.slug,
      arquivoConfig: caminho,
      integracoesNoPerfil: integracoes.map((i) => ({
        id: i.id,
        nome: i.name,
        rede: i.identifier,
        desabilitada: Boolean(i.disabled),
        apelidoAtual: porId.get(i.id) ?? null,
      })),
      apelidosObsoletos,
      sugestaoCanais: Object.fromEntries(
        integracoes
          .filter((i) => !i.disabled)
          .map((i) => [porId.get(i.id) ?? sugerirApelido(i.identifier), i.id])
      ),
    };
  },
};
