import { resolve } from 'node:path';
import { ClienteApi } from '../nucleo/cliente-api';
import { Conta, Integracao } from '../nucleo/tipos';
import { Contexto } from './contexto';
import { FERRAMENTAS } from './ferramentas/lista';
import { executarFerramenta } from './servidor';

const CHAVE = 'chave-secreta-de-teste';
const CAMINHO_CONFIG = resolve('config', 'contas.json');

const conta = (ajustes: Partial<Conta> = {}): Conta => ({
  slug: 'marca-a',
  baseUrl: 'https://exemplo.test/api/public/v1',
  apiKey: CHAVE,
  pasta: resolve('midias', 'marca-a'),
  canais: { ig: 'id-ig', li: 'id-li' },
  canaisPadrao: ['ig'],
  ...ajustes,
});

const integracoes = (): Integracao[] => [
  { id: 'id-ig', name: 'Canal IG', identifier: 'instagram' },
  { id: 'nova-li', name: 'Pagina LI', identifier: 'linkedin-page' },
];

function contextoFalso(
  contas: Record<string, Conta>,
  listarIntegracoes = jest.fn().mockResolvedValue(integracoes())
): Contexto {
  return {
    carregar: () => ({ contas, caminho: CAMINHO_CONFIG }),
    clienteDe: () => ({ listarIntegracoes }) as unknown as ClienteApi,
  };
}

const textoDe = (resposta: { content: Array<{ text: string }> }) =>
  resposta.content[0].text;

describe('registro de ferramentas', () => {
  it('deve expor exatamente as cinco ferramentas do design', () => {
    expect(FERRAMENTAS.map((f) => f.nome)).toEqual([
      'listarContas',
      'listarPostsPendentes',
      'sincronizarCanais',
      'validarPost',
      'agendarPost',
    ]);
  });

  it('deve dar titulo e descricao a toda ferramenta', () => {
    for (const ferramenta of FERRAMENTAS) {
      expect(ferramenta.titulo.length).toBeGreaterThan(0);
      expect(ferramenta.descricao.length).toBeGreaterThan(0);
    }
  });
});

describe('executarFerramenta', () => {
  it('deve sinalizar erro para ferramenta desconhecida', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }),
      'naoExiste',
      {}
    );

    expect(resposta.isError).toBe(true);
    expect(textoDe(resposta)).toMatch(/desconhecida/i);
  });

  it('deve converter excecao em isError em vez de derrubar o processo', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }),
      'sincronizarCanais',
      { conta: 'inexistente' }
    );

    expect(resposta.isError).toBe(true);
    expect(textoDe(resposta)).toMatch(/inexistente/);
  });
});

describe('listarContas', () => {
  it('nao deve vazar a chave de api na saida', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }),
      'listarContas',
      {}
    );

    expect(textoDe(resposta)).not.toContain(CHAVE);
    expect(textoDe(resposta)).not.toMatch(/apiKey/i);
  });

  it('deve devolver pasta, canais e canais padrao de cada conta', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({
        'marca-a': conta(),
        'marca-b': conta({ slug: 'marca-b', canaisPadrao: ['li'] }),
      }),
      'listarContas',
      {}
    );

    const saida = JSON.parse(textoDe(resposta));
    expect(saida.arquivoConfig).toBe(CAMINHO_CONFIG);
    expect(saida.contas).toHaveLength(2);
    expect(saida.contas[0]).toEqual({
      conta: 'marca-a',
      pasta: resolve('midias', 'marca-a'),
      baseUrl: 'https://exemplo.test/api/public/v1',
      canais: { ig: 'id-ig', li: 'id-li' },
      canaisPadrao: ['ig'],
    });
  });
});

describe('listarPostsPendentes', () => {
  it('deve reportar a pasta ausente da conta sem derrubar a varredura', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({
        'marca-a': conta({ pasta: resolve('pasta-que-nao-existe') }),
      }),
      'listarPostsPendentes',
      {}
    );

    expect(resposta.isError).toBeUndefined();
    const saida = JSON.parse(textoDe(resposta));
    expect(saida.contas[0].erro).toMatch(/pasta/i);
    expect(saida.contas[0].prontos).toEqual([]);
  });

  it('deve recusar conta inexistente com a lista de disponiveis', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }),
      'listarPostsPendentes',
      { conta: 'marca-z' }
    );

    expect(resposta.isError).toBe(true);
    expect(textoDe(resposta)).toContain('marca-a');
  });
});

describe('sincronizarCanais', () => {
  it('deve apontar apelido cujo integrationId sumiu do perfil', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }),
      'sincronizarCanais',
      { conta: 'marca-a' }
    );

    const saida = JSON.parse(textoDe(resposta));
    expect(saida.apelidosObsoletos).toEqual([
      {
        apelido: 'li',
        integrationIdConfigurado: 'id-li',
        motivo: 'esse id nao existe mais neste perfil',
      },
    ]);
  });

  it('deve preservar o apelido existente e sugerir um para o canal novo', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }),
      'sincronizarCanais',
      { conta: 'marca-a' }
    );

    const saida = JSON.parse(textoDe(resposta));
    expect(saida.sugestaoCanais).toEqual({ ig: 'id-ig', li: 'nova-li' });
  });

  it('deve marcar o apelido atual de cada integracao do perfil', async () => {
    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }),
      'sincronizarCanais',
      { conta: 'marca-a' }
    );

    const saida = JSON.parse(textoDe(resposta));
    expect(saida.integracoesNoPerfil).toEqual([
      {
        id: 'id-ig',
        nome: 'Canal IG',
        rede: 'instagram',
        desabilitada: false,
        apelidoAtual: 'ig',
      },
      {
        id: 'nova-li',
        nome: 'Pagina LI',
        rede: 'linkedin-page',
        desabilitada: false,
        apelidoAtual: null,
      },
    ]);
  });

  it('deve deixar canal desabilitado fora da sugestao', async () => {
    const listar = jest.fn().mockResolvedValue([
      { id: 'id-ig', name: 'Canal IG', identifier: 'instagram' },
      {
        id: 'nova-li',
        name: 'Pagina LI',
        identifier: 'linkedin-page',
        disabled: true,
      },
    ]);

    const resposta = await executarFerramenta(
      contextoFalso({ 'marca-a': conta() }, listar),
      'sincronizarCanais',
      { conta: 'marca-a' }
    );

    const saida = JSON.parse(textoDe(resposta));
    expect(saida.sugestaoCanais).toEqual({ ig: 'id-ig' });
  });
});

describe('validarPost e agendarPost', () => {
  it('devem recusar tipo de agendamento invalido', async () => {
    const ctx = contextoFalso({ 'marca-a': conta() });

    for (const nome of ['validarPost', 'agendarPost']) {
      const resposta = await executarFerramenta(ctx, nome, {
        conta: 'marca-a',
        post: 'post-1',
        tipo: 'publicar-ja',
      });

      expect(resposta.isError).toBe(true);
      expect(textoDe(resposta)).toMatch(/publicar-ja/);
    }
  });

  it('devem recusar nome de post que escapa da pasta da conta', async () => {
    const ctx = contextoFalso({ 'marca-a': conta() });

    for (const nome of ['validarPost', 'agendarPost']) {
      const resposta = await executarFerramenta(ctx, nome, {
        conta: 'marca-a',
        post: '../../etc',
      });

      expect(resposta.isError).toBe(true);
      expect(textoDe(resposta)).toMatch(/invalido|fora/i);
    }
  });
});
