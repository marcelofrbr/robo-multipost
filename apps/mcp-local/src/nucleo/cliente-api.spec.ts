import { Buscador, ClienteApi, ErroApi, mascararSegredo } from './cliente-api';
import { Conta } from './tipos';

const CHAVE = 'chave-de-perfil-falsa';

const conta = (): Conta => ({
  slug: 'marca-a',
  baseUrl: 'https://exemplo.test/api/public/v1',
  apiKey: CHAVE,
  pasta: 'C:/midias/marca-a',
  canais: { ig: 'id-ig' },
  canaisPadrao: ['ig'],
});

interface ChamadaRegistrada {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

function buscadorFalso(
  respostas: Array<{ status: number; corpo: unknown }>,
  registro: ChamadaRegistrada[] = []
): Buscador {
  let indice = 0;
  return async (url, opcoes) => {
    registro.push({ url, ...(opcoes ?? {}) });
    const resposta = respostas[Math.min(indice, respostas.length - 1)];
    indice += 1;
    return {
      ok: resposta.status >= 200 && resposta.status < 300,
      status: resposta.status,
      text: async () =>
        typeof resposta.corpo === 'string'
          ? resposta.corpo
          : JSON.stringify(resposta.corpo),
    };
  };
}

describe('mascararSegredo', () => {
  it('deve trocar todas as ocorrencias do segredo', () => {
    expect(mascararSegredo(`erro com ${CHAVE} e ${CHAVE}`, CHAVE)).toBe(
      'erro com *** e ***'
    );
  });

  it('deve devolver o texto intacto quando o segredo e vazio', () => {
    expect(mascararSegredo('texto', '')).toBe('texto');
  });
});

describe('ClienteApi.listarIntegracoes', () => {
  it('deve chamar /integrations com a chave no header Authorization', async () => {
    const registro: ChamadaRegistrada[] = [];
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso(
        [
          {
            status: 200,
            corpo: [{ id: 'id-ig', name: 'Canal IG', identifier: 'instagram' }],
          },
        ],
        registro
      )
    );

    const integracoes = await cliente.listarIntegracoes();

    expect(integracoes).toEqual([
      { id: 'id-ig', name: 'Canal IG', identifier: 'instagram' },
    ]);
    expect(registro[0].url).toBe(
      'https://exemplo.test/api/public/v1/integrations'
    );
    expect(registro[0].headers?.Authorization).toBe(CHAVE);
  });

  it('deve lancar ErroApi com orientacao de chave de perfil no 401', async () => {
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso([{ status: 401, corpo: { message: 'Unauthorized' } }])
    );

    await expect(cliente.listarIntegracoes()).rejects.toThrow(ErroApi);
    await expect(cliente.listarIntegracoes()).rejects.toThrow(
      /chave de perfil/i
    );
  });

  it('deve orientar contra o fallback para chave de organizacao no 403', async () => {
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso([{ status: 403, corpo: { message: 'Forbidden' } }])
    );

    await expect(cliente.listarIntegracoes()).rejects.toThrow(/organizacao/i);
  });

  it('nao deve vazar a chave quando a api devolve a chave no corpo do erro', async () => {
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso([
        { status: 500, corpo: { message: `token invalido: ${CHAVE}` } },
      ])
    );

    let capturado: Error | undefined;
    try {
      await cliente.listarIntegracoes();
    } catch (erro) {
      capturado = erro as Error;
    }

    expect(capturado).toBeInstanceOf(ErroApi);
    expect(capturado?.message).not.toContain(CHAVE);
    expect(capturado?.message).toContain('***');
  });

  it('deve expor o status http no erro', async () => {
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso([{ status: 502, corpo: 'bad gateway' }])
    );

    let capturado: ErroApi | undefined;
    try {
      await cliente.listarIntegracoes();
    } catch (erro) {
      capturado = erro as ErroApi;
    }

    expect(capturado?.status).toBe(502);
  });
});

describe('ClienteApi.subirMidia', () => {
  it('deve devolver id e path do upload', async () => {
    const registro: ChamadaRegistrada[] = [];
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso(
        [
          {
            status: 200,
            corpo: {
              id: 'midia-1',
              path: 'https://exemplo.test/uploads/1.png',
            },
          },
        ],
        registro
      )
    );

    const midia = await cliente.subirMidia(
      '1.png',
      'image/png',
      Buffer.from('bytes-falsos')
    );

    expect(midia).toEqual({
      id: 'midia-1',
      path: 'https://exemplo.test/uploads/1.png',
    });
    expect(registro[0].url).toBe('https://exemplo.test/api/public/v1/upload');
    expect(registro[0].method).toBe('POST');
  });

  it('deve falhar quando a resposta nao traz id e path', async () => {
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso([{ status: 200, corpo: { ok: true } }])
    );

    await expect(
      cliente.subirMidia('1.png', 'image/png', Buffer.from('x'))
    ).rejects.toThrow(/id.*path|path.*id/i);
  });
});

describe('ClienteApi.subirMidiaDeUrl', () => {
  it('deve enviar a url em json para /upload-from-url', async () => {
    const registro: ChamadaRegistrada[] = [];
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso(
        [{ status: 200, corpo: { id: 'midia-2', path: 'p' } }],
        registro
      )
    );

    await cliente.subirMidiaDeUrl('https://exemplo.test/externa.png');

    expect(registro[0].url).toBe(
      'https://exemplo.test/api/public/v1/upload-from-url'
    );
    expect(registro[0].headers?.['Content-Type']).toBe('application/json');
    expect(JSON.parse(String(registro[0].body))).toEqual({
      url: 'https://exemplo.test/externa.png',
    });
  });
});

describe('ClienteApi.criarPosts', () => {
  it('deve enviar o payload em json para /posts', async () => {
    const registro: ChamadaRegistrada[] = [];
    const cliente = new ClienteApi(
      conta(),
      buscadorFalso([{ status: 200, corpo: [{ id: 'post-1' }] }], registro)
    );

    const payload = { type: 'schedule', posts: [] };
    const resposta = await cliente.criarPosts(payload);

    expect(resposta).toEqual([{ id: 'post-1' }]);
    expect(registro[0].url).toBe('https://exemplo.test/api/public/v1/posts');
    expect(registro[0].method).toBe('POST');
    expect(JSON.parse(String(registro[0].body))).toEqual(payload);
  });
});
