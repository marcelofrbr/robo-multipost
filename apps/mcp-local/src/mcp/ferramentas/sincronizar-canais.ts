import { z } from 'zod';
import { obterConta } from '../../nucleo/contas';
import { Ferramenta } from '../contexto';

/** Apelido inicial a partir da rede, so como ponto de partida editavel. */
function sugerirApelido(identifier: string): string {
  const rede = String(identifier).toLowerCase();
  if (rede.startsWith('instagram')) {
    return 'ig';
  }
  if (rede === 'linkedin-page') {
    return 'li-pagina';
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
 * Garante apelido unico. Sem isso, duas contas da mesma rede no mesmo perfil
 * (dois Instagram, por exemplo) colapsam numa chave so e quem colar o bloco
 * perde um canal SEM aviso nenhum — o pior modo de falha para agendamento.
 */
function garantirUnico(base: string, usados: Set<string>): string {
  if (!usados.has(base)) {
    usados.add(base);
    return base;
  }
  let n = 2;
  while (usados.has(`${base}-${n}`)) {
    n += 1;
  }
  const apelido = `${base}-${n}`;
  usados.add(apelido);
  return apelido;
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

    const ativas = integracoes.filter((i) => !i.disabled);

    // Os apelidos ja batizados entram no conjunto antes de qualquer sugestao:
    // uma sugestao nunca rouba o nome de um canal que voce ja nomeou.
    const usados = new Set<string>(
      ativas
        .map((i) => porId.get(i.id))
        .filter((apelido): apelido is string => Boolean(apelido))
    );

    const sugestaoCanais: Record<string, string> = {};
    for (const integracao of ativas) {
      const apelido =
        porId.get(integracao.id) ??
        garantirUnico(sugerirApelido(integracao.identifier), usados);
      sugestaoCanais[apelido] = integracao.id;
    }

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
      sugestaoCanais,
    };
  },
};
