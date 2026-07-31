import { z } from 'zod';
import {
  agendarPost as agendarNoNucleo,
  depsPadrao,
} from '../../nucleo/agendador';
import { obterConta } from '../../nucleo/contas';
import { carregarPost } from '../../nucleo/descoberta';
import { TIPOS_AGENDAMENTO, TipoAgendamento } from '../../nucleo/tipos';
import { Ferramenta } from '../contexto';

export const agendarPost: Ferramenta = {
  nome: 'agendarPost',
  titulo: 'Agendar um post da pasta',
  descricao:
    'Sobe as midias da pasta do post, na ordem numerica do nome, e agenda em cada canal ' +
    'resolvido a partir dos apelidos. Valida tudo ANTES do primeiro upload: se um canal, ' +
    'uma midia ou a data estiver errada, nada e enviado. Grava .agendado.json ao final, e ' +
    'recusa reagendar um post que ja tenha esse arquivo (a menos que forcar seja true).',
  esquema: {
    conta: z.string().describe('Slug da conta, como aparece em listarContas.'),
    post: z
      .string()
      .describe('Nome da subpasta do post dentro da pasta da conta.'),
    tipo: z
      .enum(['draft', 'schedule', 'now'])
      .optional()
      .describe(
        'draft cria rascunho, schedule agenda para a data do post.json, now publica na hora. Padrao: schedule.'
      ),
    forcar: z
      .boolean()
      .optional()
      .describe(
        'Agenda de novo um post ja agendado. Cria uma SEGUNDA publicacao, nao substitui a anterior.'
      ),
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
    const cliente = ctx.clienteDe(conta);

    const resultado = await agendarNoNucleo(depsPadrao(cliente), {
      conta,
      post,
      tipo,
      forcar: Boolean(entrada.forcar),
    });

    return {
      conta: resultado.conta,
      post: resultado.post,
      tipo: resultado.tipo,
      data: resultado.data,
      midiasEnviadas: resultado.midias.length,
      canais: resultado.canais.map((c) => ({
        apelido: c.apelido,
        nome: c.nome,
        rede: c.identifier,
      })),
      resposta: resultado.resposta,
    };
  },
};
