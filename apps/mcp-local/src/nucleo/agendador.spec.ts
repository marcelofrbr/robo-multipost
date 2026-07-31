import { join, resolve } from 'node:path';
import { ClienteApi } from './cliente-api';
import {
  DepsAgendamento,
  ErroAgendamento,
  agendarPost,
  montarSettings,
  validarPost,
} from './agendador';
import {
  ConfigPost,
  Conta,
  Integracao,
  PostDescoberto,
  RegistroAgendamento,
} from './tipos';

const PASTA = resolve('midias', 'marca-a');
const CAMINHO_POST = join(PASTA, 'post-1');
const AGORA = new Date('2026-07-30T12:00:00-03:00');

const conta = (): Conta => ({
  slug: 'marca-a',
  baseUrl: 'https://exemplo.test/api/public/v1',
  apiKey: 'chave-de-teste',
  pasta: PASTA,
  canais: { ig: 'id-ig', li: 'id-li' },
  canaisPadrao: ['ig', 'li'],
});

const integracoes = (): Integracao[] => [
  { id: 'id-ig', name: 'Canal IG', identifier: 'instagram' },
  { id: 'id-li', name: 'Pagina LI', identifier: 'linkedin-page' },
];

const post = (config: Partial<ConfigPost> = {}): PostDescoberto => ({
  nome: 'post-1',
  caminho: CAMINHO_POST,
  config: {
    legenda: 'legenda padrao',
    data: '2026-08-01T09:00:00-03:00',
    ...config,
  },
  midias: [join(CAMINHO_POST, '1.png'), join(CAMINHO_POST, '2.png')],
  jaAgendado: false,
});

interface Espioes {
  deps: DepsAgendamento;
  listarIntegracoes: jest.Mock;
  subirMidia: jest.Mock;
  criarPosts: jest.Mock;
  gravarRegistro: jest.Mock;
}

function montarDeps(
  ajustes: {
    integracoes?: Integracao[];
    subirMidia?: jest.Mock;
    criarPosts?: jest.Mock;
  } = {}
): Espioes {
  const listarIntegracoes = jest
    .fn()
    .mockResolvedValue(ajustes.integracoes ?? integracoes());

  let contador = 0;
  const subirMidia =
    ajustes.subirMidia ??
    jest.fn().mockImplementation(async (nome: string) => {
      contador += 1;
      return { id: `midia-${contador}`, path: `https://cdn.test/${nome}` };
    });

  const criarPosts =
    ajustes.criarPosts ?? jest.fn().mockResolvedValue([{ id: 'post-criado' }]);

  const gravarRegistro = jest.fn().mockResolvedValue(undefined);

  const cliente = {
    listarIntegracoes,
    subirMidia,
    criarPosts,
  } as unknown as ClienteApi;

  return {
    deps: {
      cliente,
      lerMidia: jest.fn().mockResolvedValue(Buffer.from('bytes')),
      gravarRegistro,
      agora: () => AGORA,
      gerarId: () => 'id-fixo',
    },
    listarIntegracoes,
    subirMidia,
    criarPosts,
    gravarRegistro,
  };
}

describe('montarSettings', () => {
  it('deve mapear instagram para post_type post', () => {
    expect(montarSettings('instagram', 'carrossel', post().config)).toEqual({
      post_type: 'post',
      collaborators: [],
    });
  });

  it('deve mapear o formato story para post_type story', () => {
    expect(montarSettings('instagram', 'story', post().config)).toEqual({
      post_type: 'story',
      collaborators: [],
    });
  });

  it('deve tratar reels como post_type post', () => {
    expect(montarSettings('instagram', 'reels', post().config)).toEqual({
      post_type: 'post',
      collaborators: [],
    });
  });

  it('deve ligar o carrossel do linkedin apenas no formato carrossel', () => {
    expect(montarSettings('linkedin-page', 'carrossel', post().config)).toEqual({
      post_as_images_carousel: true,
    });
    expect(montarSettings('linkedin-page', 'post', post().config)).toEqual({
      post_as_images_carousel: false,
    });
  });

  it('deve repassar o nome do carrossel do linkedin quando informado', () => {
    expect(
      montarSettings(
        'linkedin',
        'carrossel',
        post({ nomeCarrossel: 'Guia rapido' }).config
      )
    ).toEqual({
      post_as_images_carousel: true,
      carousel_name: 'Guia rapido',
    });
  });

  it('deve devolver settings vazio para rede sem regra especifica', () => {
    expect(montarSettings('mastodon', 'post', post().config)).toEqual({});
  });
});

describe('validarPost', () => {
  it('deve resolver os apelidos padrao da conta quando o post nao declara canais', () => {
    const resultado = validarPost(
      conta(),
      post(),
      integracoes(),
      'schedule',
      AGORA
    );

    expect(resultado.ok).toBe(true);
    expect(resultado.canais.map((c) => c.apelido)).toEqual(['ig', 'li']);
    expect(resultado.canais.map((c) => c.integrationId)).toEqual([
      'id-ig',
      'id-li',
    ]);
  });

  it('deve usar a legenda por canal quando existe', () => {
    const resultado = validarPost(
      conta(),
      post({ legendaPorCanal: { li: 'legenda do linkedin' } }),
      integracoes(),
      'schedule',
      AGORA
    );

    expect(resultado.canais[0].legenda).toBe('legenda padrao');
    expect(resultado.canais[1].legenda).toBe('legenda do linkedin');
  });

  it('deve apontar apelido que nao existe na conta', () => {
    const resultado = validarPost(
      conta(),
      post({ canais: ['tiktok'] }),
      integracoes(),
      'schedule',
      AGORA
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(' ')).toMatch(/tiktok/);
  });

  it('deve apontar integracao que nao existe no perfil da chave', () => {
    const resultado = validarPost(
      conta(),
      post({ canais: ['ig'] }),
      [{ id: 'outro-id', name: 'Outro', identifier: 'instagram' }],
      'schedule',
      AGORA
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(' ')).toMatch(/id-ig/);
  });

  it('deve apontar integracao desabilitada', () => {
    const resultado = validarPost(
      conta(),
      post({ canais: ['ig'] }),
      [
        {
          id: 'id-ig',
          name: 'Canal IG',
          identifier: 'instagram',
          disabled: true,
        },
      ],
      'schedule',
      AGORA
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(' ')).toMatch(/desabilitada/i);
  });

  it('deve recusar agendamento com data no passado', () => {
    const resultado = validarPost(
      conta(),
      post({ data: '2026-07-01T09:00:00-03:00' }),
      integracoes(),
      'schedule',
      AGORA
    );

    expect(resultado.ok).toBe(false);
    expect(resultado.problemas.join(' ')).toMatch(/passado/i);
  });

  it('deve aceitar data no passado quando o tipo e rascunho', () => {
    const resultado = validarPost(
      conta(),
      post({ data: '2026-07-01T09:00:00-03:00' }),
      integracoes(),
      'draft',
      AGORA
    );

    expect(resultado.ok).toBe(true);
  });
});

describe('agendarPost', () => {
  it('deve subir as midias em ordem e montar um post por canal', async () => {
    const espioes = montarDeps();

    const resultado = await agendarPost(espioes.deps, {
      conta: conta(),
      post: post(),
      tipo: 'schedule',
    });

    expect(espioes.subirMidia).toHaveBeenCalledTimes(2);
    expect(espioes.subirMidia.mock.calls[0][0]).toBe('1.png');
    expect(espioes.subirMidia.mock.calls[1][0]).toBe('2.png');

    const payload = espioes.criarPosts.mock.calls[0][0];
    expect(payload.type).toBe('schedule');
    expect(payload.date).toBe('2026-08-01T09:00:00-03:00');
    expect(payload.posts).toHaveLength(2);
    expect(payload.posts[0].integration).toEqual({ id: 'id-ig' });
    expect(payload.posts[1].integration).toEqual({ id: 'id-li' });
    expect(payload.posts[0].value[0].content).toBe('legenda padrao');
    expect(payload.posts[0].value[0].image).toEqual([
      { id: 'midia-1', path: 'https://cdn.test/1.png' },
      { id: 'midia-2', path: 'https://cdn.test/2.png' },
    ]);
    expect(resultado.canais).toHaveLength(2);
  });

  it('deve gravar o registro de idempotencia depois do sucesso', async () => {
    const espioes = montarDeps();

    await agendarPost(espioes.deps, {
      conta: conta(),
      post: post(),
      tipo: 'schedule',
    });

    expect(espioes.gravarRegistro).toHaveBeenCalledTimes(1);
    const [caminho, registro] = espioes.gravarRegistro.mock.calls[0] as [
      string,
      RegistroAgendamento,
    ];
    expect(caminho).toBe(CAMINHO_POST);
    expect(registro.tipo).toBe('schedule');
    expect(registro.canais).toEqual(['ig', 'li']);
    expect(registro.agendadoEm).toBe(AGORA.toISOString());
  });

  it('deve recusar post ja agendado sem forcar', async () => {
    const espioes = montarDeps();
    const jaFeito = { ...post(), jaAgendado: true };

    await expect(
      agendarPost(espioes.deps, {
        conta: conta(),
        post: jaFeito,
        tipo: 'schedule',
      })
    ).rejects.toThrow(/forcar/i);

    expect(espioes.subirMidia).not.toHaveBeenCalled();
    expect(espioes.criarPosts).not.toHaveBeenCalled();
  });

  it('deve reagendar post ja agendado quando forcar e verdadeiro', async () => {
    const espioes = montarDeps();
    const jaFeito = { ...post(), jaAgendado: true };

    await agendarPost(espioes.deps, {
      conta: conta(),
      post: jaFeito,
      tipo: 'schedule',
      forcar: true,
    });

    expect(espioes.criarPosts).toHaveBeenCalledTimes(1);
  });

  it('deve abortar antes de subir qualquer midia quando a validacao falha', async () => {
    const espioes = montarDeps();

    await expect(
      agendarPost(espioes.deps, {
        conta: conta(),
        post: post({ canais: ['tiktok'] }),
        tipo: 'schedule',
      })
    ).rejects.toThrow(ErroAgendamento);

    expect(espioes.subirMidia).not.toHaveBeenCalled();
    expect(espioes.criarPosts).not.toHaveBeenCalled();
    expect(espioes.gravarRegistro).not.toHaveBeenCalled();
  });

  it('nao deve agendar nem gravar registro quando um upload falha no meio', async () => {
    const subirMidia = jest
      .fn()
      .mockResolvedValueOnce({ id: 'midia-1', path: 'p1' })
      .mockRejectedValueOnce(new Error('upload caiu'));
    const espioes = montarDeps({ subirMidia });

    await expect(
      agendarPost(espioes.deps, {
        conta: conta(),
        post: post(),
        tipo: 'schedule',
      })
    ).rejects.toThrow(/upload caiu/);

    expect(espioes.criarPosts).not.toHaveBeenCalled();
    expect(espioes.gravarRegistro).not.toHaveBeenCalled();
  });

  it('nao deve gravar registro quando a criacao do post falha', async () => {
    const criarPosts = jest.fn().mockRejectedValue(new Error('api caiu'));
    const espioes = montarDeps({ criarPosts });

    await expect(
      agendarPost(espioes.deps, {
        conta: conta(),
        post: post(),
        tipo: 'schedule',
      })
    ).rejects.toThrow(/api caiu/);

    expect(espioes.gravarRegistro).not.toHaveBeenCalled();
  });

  it('deve usar o horario atual como data quando o tipo e now', async () => {
    const espioes = montarDeps();

    await agendarPost(espioes.deps, {
      conta: conta(),
      post: post(),
      tipo: 'now',
    });

    expect(espioes.criarPosts.mock.calls[0][0].date).toBe(AGORA.toISOString());
  });

  it('deve repassar encurtarLinks para o payload', async () => {
    const espioes = montarDeps();

    await agendarPost(espioes.deps, {
      conta: conta(),
      post: post({ encurtarLinks: true }),
      tipo: 'schedule',
    });

    expect(espioes.criarPosts.mock.calls[0][0].shortLink).toBe(true);
  });
});
