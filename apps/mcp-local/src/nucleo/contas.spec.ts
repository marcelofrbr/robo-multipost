import {
  ErroConfig,
  analisarEnv,
  normalizarBaseUrl,
  resolverContas,
} from './contas';

const configValida = () => ({
  baseUrl: 'https://exemplo.test/api',
  contas: {
    'marca-a': {
      apiKeyEnv: 'CHAVE_A',
      pasta: 'C:/midias/marca-a',
      canais: { ig: 'id-ig', li: 'id-li' } as Record<string, string>,
      canaisPadrao: ['ig'] as string[],
    },
  },
});

describe('normalizarBaseUrl', () => {
  it('deve acrescentar /public/v1 quando a base termina em /api', () => {
    expect(normalizarBaseUrl('https://exemplo.test/api')).toBe(
      'https://exemplo.test/api/public/v1'
    );
  });

  it('deve remover barras finais antes de acrescentar o sufixo', () => {
    expect(normalizarBaseUrl('https://exemplo.test/api///')).toBe(
      'https://exemplo.test/api/public/v1'
    );
  });

  it('deve manter a base que ja termina em /public/v1', () => {
    expect(normalizarBaseUrl('https://exemplo.test/api/public/v1')).toBe(
      'https://exemplo.test/api/public/v1'
    );
  });

  it('deve recusar base sem protocolo http', () => {
    expect(() => normalizarBaseUrl('exemplo.test/api')).toThrow(/baseUrl/i);
  });
});

describe('analisarEnv', () => {
  it('deve ler pares chave=valor ignorando comentario e linha vazia', () => {
    const texto = ['# comentario', '', 'CHAVE_A=abc123', 'CHAVE_B=def456'].join(
      '\n'
    );

    expect(analisarEnv(texto)).toEqual({ CHAVE_A: 'abc123', CHAVE_B: 'def456' });
  });

  it('deve remover aspas ao redor do valor', () => {
    expect(analisarEnv('CHAVE_A="abc123"')).toEqual({ CHAVE_A: 'abc123' });
    expect(analisarEnv("CHAVE_A='abc123'")).toEqual({ CHAVE_A: 'abc123' });
  });

  it('deve preservar sinais de igual dentro do valor', () => {
    expect(analisarEnv('CHAVE_A=ab=c1=23')).toEqual({ CHAVE_A: 'ab=c1=23' });
  });

  it('deve tolerar quebra de linha do Windows', () => {
    expect(analisarEnv('CHAVE_A=abc\r\nCHAVE_B=def')).toEqual({
      CHAVE_A: 'abc',
      CHAVE_B: 'def',
    });
  });
});

describe('resolverContas', () => {
  it('deve resolver a conta com a chave vinda do ambiente', () => {
    const contas = resolverContas(configValida(), { CHAVE_A: 'segredo-a' });

    expect(contas['marca-a']).toEqual({
      slug: 'marca-a',
      baseUrl: 'https://exemplo.test/api/public/v1',
      apiKey: 'segredo-a',
      pasta: expect.stringContaining('marca-a'),
      canais: { ig: 'id-ig', li: 'id-li' },
      canaisPadrao: ['ig'],
    });
  });

  it('deve usar todos os canais como padrao quando canaisPadrao e omitido', () => {
    const bruto = configValida();
    delete (bruto.contas['marca-a'] as { canaisPadrao?: string[] }).canaisPadrao;

    const contas = resolverContas(bruto, { CHAVE_A: 'segredo-a' });

    expect(contas['marca-a'].canaisPadrao).toEqual(['ig', 'li']);
  });

  it('deve permitir baseUrl especifica por conta', () => {
    const bruto = configValida();
    (bruto.contas['marca-a'] as { baseUrl?: string }).baseUrl =
      'https://outra.test/api';

    const contas = resolverContas(bruto, { CHAVE_A: 'segredo-a' });

    expect(contas['marca-a'].baseUrl).toBe('https://outra.test/api/public/v1');
  });

  it('deve falhar quando a variavel de ambiente da chave nao esta definida', () => {
    expect(() => resolverContas(configValida(), {})).toThrow(ErroConfig);
    expect(() => resolverContas(configValida(), {})).toThrow(/CHAVE_A/);
  });

  it('deve falhar quando canaisPadrao cita apelido inexistente', () => {
    const bruto = configValida();
    bruto.contas['marca-a'].canaisPadrao = ['ig', 'tiktok'];

    expect(() => resolverContas(bruto, { CHAVE_A: 'segredo-a' })).toThrow(
      /tiktok/
    );
  });

  it('deve falhar quando a conta nao tem canais', () => {
    const bruto = configValida();
    bruto.contas['marca-a'].canais = {};

    expect(() => resolverContas(bruto, { CHAVE_A: 'segredo-a' })).toThrow(
      /canais/i
    );
  });

  it('deve falhar quando a conta nao tem pasta', () => {
    const bruto = configValida();
    delete (bruto.contas['marca-a'] as { pasta?: string }).pasta;

    expect(() => resolverContas(bruto, { CHAVE_A: 'segredo-a' })).toThrow(
      /pasta/i
    );
  });

  it('deve falhar quando nao ha bloco de contas', () => {
    expect(() =>
      resolverContas({ baseUrl: 'https://exemplo.test/api' }, {})
    ).toThrow(/contas/i);
  });

  it('deve reunir todos os problemas numa unica mensagem', () => {
    const bruto = {
      baseUrl: 'https://exemplo.test/api',
      contas: {
        'marca-a': { apiKeyEnv: 'CHAVE_A', canais: { ig: 'id-ig' } },
        'marca-b': { apiKeyEnv: 'CHAVE_B', pasta: 'C:/midias/marca-b' },
      },
    };

    let capturado: ErroConfig | undefined;
    try {
      resolverContas(bruto, {});
    } catch (erro) {
      capturado = erro as ErroConfig;
    }

    expect(capturado).toBeInstanceOf(ErroConfig);
    expect(capturado?.problemas.length).toBeGreaterThanOrEqual(4);
    expect(capturado?.message).toContain('marca-a');
    expect(capturado?.message).toContain('marca-b');
  });

  it('nao deve vazar o valor da chave na mensagem de erro', () => {
    const bruto = configValida();
    bruto.contas['marca-a'].canaisPadrao = ['inexistente'];

    let capturado: ErroConfig | undefined;
    try {
      resolverContas(bruto, { CHAVE_A: 'segredo-secretissimo' });
    } catch (erro) {
      capturado = erro as ErroConfig;
    }

    expect(capturado?.message).not.toContain('segredo-secretissimo');
  });
});
