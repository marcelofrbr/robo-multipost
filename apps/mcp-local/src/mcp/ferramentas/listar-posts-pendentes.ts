import { z } from 'zod';
import { varrerConta } from '../../nucleo/descoberta';
import { Conta, PostDescoberto } from '../../nucleo/tipos';
import { Ferramenta } from '../contexto';

const resumir = (post: PostDescoberto) => ({
  post: post.nome,
  caminho: post.caminho,
  legenda: post.config.legenda,
  data: post.config.data,
  tipo: post.config.tipo ?? 'carrossel',
  canais: post.config.canais ?? null,
  midias: post.midias.length,
});

export const listarPostsPendentes: Ferramenta = {
  nome: 'listarPostsPendentes',
  titulo: 'Listar posts nas pastas',
  descricao:
    'Varre as pastas das contas e separa o que esta pronto para agendar, o que ja foi agendado ' +
    '(tem .agendado.json) e o que esta com problema, com o motivo. Omita "conta" para varrer todas.',
  esquema: {
    conta: z
      .string()
      .optional()
      .describe('Slug da conta. Quando ausente, varre todas as contas.'),
  },

  async executar(ctx, entrada) {
    const { contas } = ctx.carregar();
    const alvo = entrada.conta as string | undefined;

    const selecionadas: Conta[] = alvo
      ? [contas[alvo]].filter(Boolean)
      : Object.values(contas);

    if (alvo && selecionadas.length === 0) {
      throw new Error(
        `Conta "${alvo}" nao existe. Disponiveis: ${Object.keys(contas).join(
          ', '
        )}.`
      );
    }

    // Uma conta com pasta ausente nao pode derrubar a varredura das outras.
    const resultados = await Promise.all(
      selecionadas.map(async (conta) => {
        try {
          const varredura = await varrerConta(conta);
          return {
            conta: conta.slug,
            pasta: conta.pasta,
            prontos: varredura.prontos.map(resumir),
            jaAgendados: varredura.jaAgendados.map(resumir),
            invalidos: varredura.invalidos,
          };
        } catch (erro) {
          return {
            conta: conta.slug,
            pasta: conta.pasta,
            erro: (erro as Error).message,
            prontos: [],
            jaAgendados: [],
            invalidos: [],
          };
        }
      })
    );

    return { contas: resultados };
  },
};
