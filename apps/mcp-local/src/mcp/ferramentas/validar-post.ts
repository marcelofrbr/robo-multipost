import { z } from 'zod';
import { validarPost as validarNoNucleo } from '../../nucleo/agendador';
import { obterConta } from '../../nucleo/contas';
import { carregarPost } from '../../nucleo/descoberta';
import { TIPOS_AGENDAMENTO, TipoAgendamento } from '../../nucleo/tipos';
import { Ferramenta } from '../contexto';

/**
 * Ensaio completo do agendamento, sem efeito colateral: nenhuma midia sobe e
 * nenhum post e criado.
 */
export const validarPost: Ferramenta = {
  nome: 'validarPost',
  titulo: 'Validar um post sem publicar',
  descricao:
    'Confere um post sem subir nada: resolve os apelidos de canal para integracoes reais, ' +
    'verifica se elas existem e estao ativas no perfil, confere a data e conta as midias. ' +
    'Nao sobe midia nem cria post.',
  esquema: {
    conta: z.string().describe('Slug da conta, como aparece em listarContas.'),
    post: z
      .string()
      .describe('Nome da subpasta do post dentro da pasta da conta.'),
    tipo: z
      .enum(['draft', 'schedule', 'now'])
      .optional()
      .describe('Tipo de agendamento a simular. Padrao: schedule.'),
  },

  async executar(ctx, entrada) {
    const { contas } = ctx.carregar();
    const conta = obterConta(contas, String(entrada.conta));
    const tipo = (entrada.tipo as TipoAgendamento) ?? 'schedule';

    if (!TIPOS_AGENDAMENTO.includes(tipo)) {
      throw new Error(
        `tipo "${tipo}" invalido. Use um de: ${TIPOS_AGENDAMENTO.join(', ')}.`
      );
    }

    const post = await carregarPost(conta, String(entrada.post));
    const integracoes = await ctx.clienteDe(conta).listarIntegracoes();
    const resultado = validarNoNucleo(
      conta,
      post,
      integracoes,
      tipo,
      new Date()
    );

    return {
      conta: conta.slug,
      post: post.nome,
      tipo,
      ok: resultado.ok,
      problemas: resultado.problemas,
      formato: resultado.tipoPost,
      data: resultado.data,
      midias: post.midias.map((m) => m.split(/[\\/]/).pop()),
      jaAgendado: post.jaAgendado,
      canais: resultado.canais.map((c) => ({
        apelido: c.apelido,
        nome: c.nome,
        rede: c.identifier,
        legenda: c.legenda,
      })),
    };
  },
};
