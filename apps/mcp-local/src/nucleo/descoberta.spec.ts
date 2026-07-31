import { join, resolve } from 'node:path';
import {
  ErroPost,
  SistemaArquivos,
  carregarPost,
  ehMidia,
  mimeDe,
  ordenarMidias,
  resolverPastaDoPost,
  varrerConta,
} from './descoberta';
import { Conta } from './tipos';

const PASTA = resolve('midias', 'marca-a');

const conta = (): Conta => ({
  slug: 'marca-a',
  baseUrl: 'https://exemplo.test/api/public/v1',
  apiKey: 'chave-de-teste',
  pasta: PASTA,
  canais: { ig: 'id-ig', li: 'id-li' },
  canaisPadrao: ['ig'],
});

const postJson = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({
    legenda: 'texto do post',
    data: '2026-08-01T09:00:00-03:00',
    canais: ['ig'],
    ...extra,
  });

/** Sistema de arquivos falso: nada toca o disco nestes testes. */
function fsFalso(arvore: Record<string, string[] | string>): SistemaArquivos {
  return {
    async listar(dir) {
      const item = arvore[dir];
      if (!Array.isArray(item)) {
        throw new Error(`diretorio inexistente: ${dir}`);
      }
      return item;
    },
    async ehDiretorio(caminho) {
      return Array.isArray(arvore[caminho]);
    },
    async existe(caminho) {
      return arvore[caminho] !== undefined;
    },
    async lerTexto(caminho) {
      const item = arvore[caminho];
      if (typeof item !== 'string') {
        throw new Error(`arquivo inexistente: ${caminho}`);
      }
      return item;
    },
  };
}

describe('ordenarMidias', () => {
  it('deve ordenar numericamente e nao alfabeticamente', () => {
    expect(ordenarMidias(['10.png', '2.png', '1.png'])).toEqual([
      '1.png',
      '2.png',
      '10.png',
    ]);
  });

  it('deve descartar arquivos que nao sao midia', () => {
    expect(
      ordenarMidias(['1.png', 'post.json', '.agendado.json', 'notas.txt'])
    ).toEqual(['1.png']);
  });

  it('deve aceitar extensao em maiuscula', () => {
    expect(ordenarMidias(['1.PNG', '2.Mp4'])).toEqual(['1.PNG', '2.Mp4']);
  });
});

describe('ehMidia e mimeDe', () => {
  it('deve reconhecer as extensoes permitidas', () => {
    expect(ehMidia('a.png')).toBe(true);
    expect(ehMidia('a.mp4')).toBe(true);
    expect(ehMidia('a.txt')).toBe(false);
    expect(ehMidia('a.exe')).toBe(false);
  });

  it('deve mapear a extensao para o mime correto', () => {
    expect(mimeDe('a.png')).toBe('image/png');
    expect(mimeDe('a.jpg')).toBe('image/jpeg');
    expect(mimeDe('a.mp4')).toBe('video/mp4');
  });
});

describe('resolverPastaDoPost', () => {
  it('deve resolver um nome simples dentro da pasta da conta', () => {
    expect(resolverPastaDoPost(conta(), 'post-1')).toBe(join(PASTA, 'post-1'));
  });

  it('deve recusar caminho que sobe de diretorio', () => {
    expect(() => resolverPastaDoPost(conta(), '..')).toThrow(/invalido|fora/i);
    expect(() => resolverPastaDoPost(conta(), '../outra')).toThrow(
      /invalido|fora/i
    );
  });

  it('deve recusar caminho com separador', () => {
    expect(() => resolverPastaDoPost(conta(), 'sub/post')).toThrow(
      /invalido|fora/i
    );
    expect(() => resolverPastaDoPost(conta(), 'sub\\post')).toThrow(
      /invalido|fora/i
    );
  });

  it('deve recusar caminho absoluto', () => {
    expect(() => resolverPastaDoPost(conta(), resolve('outro'))).toThrow(
      /invalido|fora/i
    );
  });

  it('deve recusar nome vazio ou ponto', () => {
    expect(() => resolverPastaDoPost(conta(), '')).toThrow(/invalido|fora/i);
    expect(() => resolverPastaDoPost(conta(), '.')).toThrow(/invalido|fora/i);
  });
});

describe('carregarPost', () => {
  const caminhoPost = join(PASTA, 'post-1');

  it('deve ler a config e ordenar as midias', async () => {
    const fs = fsFalso({
      [caminhoPost]: ['2.png', '10.png', '1.png', 'post.json'],
      [join(caminhoPost, 'post.json')]: postJson(),
    });

    const post = await carregarPost(conta(), 'post-1', fs);

    expect(post.nome).toBe('post-1');
    expect(post.config.legenda).toBe('texto do post');
    expect(post.midias).toEqual([
      join(caminhoPost, '1.png'),
      join(caminhoPost, '2.png'),
      join(caminhoPost, '10.png'),
    ]);
    expect(post.jaAgendado).toBe(false);
  });

  it('deve marcar como ja agendado quando existe .agendado.json', async () => {
    const registro = {
      agendadoEm: '2026-07-30T12:00:00-03:00',
      tipo: 'schedule',
      data: '2026-08-01T09:00:00-03:00',
      canais: ['ig'],
      resposta: {},
    };
    const fs = fsFalso({
      [caminhoPost]: ['1.png', 'post.json', '.agendado.json'],
      [join(caminhoPost, 'post.json')]: postJson(),
      [join(caminhoPost, '.agendado.json')]: JSON.stringify(registro),
    });

    const post = await carregarPost(conta(), 'post-1', fs);

    expect(post.jaAgendado).toBe(true);
    expect(post.registro?.canais).toEqual(['ig']);
  });

  it('deve falhar quando nao ha post.json', async () => {
    const fs = fsFalso({ [caminhoPost]: ['1.png'] });

    await expect(carregarPost(conta(), 'post-1', fs)).rejects.toThrow(
      /post\.json/i
    );
  });

  it('deve falhar quando o post.json nao e json valido', async () => {
    const fs = fsFalso({
      [caminhoPost]: ['1.png', 'post.json'],
      [join(caminhoPost, 'post.json')]: '{ nao e json',
    });

    await expect(carregarPost(conta(), 'post-1', fs)).rejects.toThrow(ErroPost);
  });

  it('deve falhar quando falta legenda ou data', async () => {
    const semLegenda = fsFalso({
      [caminhoPost]: ['1.png', 'post.json'],
      [join(caminhoPost, 'post.json')]: JSON.stringify({
        data: '2026-08-01T09:00:00-03:00',
      }),
    });
    await expect(carregarPost(conta(), 'post-1', semLegenda)).rejects.toThrow(
      /legenda/i
    );

    const semData = fsFalso({
      [caminhoPost]: ['1.png', 'post.json'],
      [join(caminhoPost, 'post.json')]: JSON.stringify({ legenda: 'oi' }),
    });
    await expect(carregarPost(conta(), 'post-1', semData)).rejects.toThrow(
      /data/i
    );
  });

  it('deve falhar quando a pasta nao tem nenhuma midia', async () => {
    const fs = fsFalso({
      [caminhoPost]: ['post.json'],
      [join(caminhoPost, 'post.json')]: postJson(),
    });

    await expect(carregarPost(conta(), 'post-1', fs)).rejects.toThrow(/midia/i);
  });

  it('deve falhar quando o tipo declarado nao existe', async () => {
    const fs = fsFalso({
      [caminhoPost]: ['1.png', 'post.json'],
      [join(caminhoPost, 'post.json')]: postJson({ tipo: 'boomerang' }),
    });

    await expect(carregarPost(conta(), 'post-1', fs)).rejects.toThrow(
      /boomerang/
    );
  });
});

describe('varrerConta', () => {
  it('deve separar prontos, ja agendados e invalidos', async () => {
    const pronto = join(PASTA, 'pronto');
    const agendado = join(PASTA, 'agendado');
    const quebrado = join(PASTA, 'quebrado');

    const fs = fsFalso({
      [PASTA]: ['pronto', 'agendado', 'quebrado', 'leia-me.txt'],
      [pronto]: ['1.png', 'post.json'],
      [join(pronto, 'post.json')]: postJson(),
      [agendado]: ['1.png', 'post.json', '.agendado.json'],
      [join(agendado, 'post.json')]: postJson(),
      [join(agendado, '.agendado.json')]: JSON.stringify({
        agendadoEm: '2026-07-30T12:00:00-03:00',
        tipo: 'schedule',
        data: '2026-08-01T09:00:00-03:00',
        canais: ['ig'],
        resposta: {},
      }),
      [quebrado]: ['1.png'],
      [join(PASTA, 'leia-me.txt')]: 'nao e pasta',
    });

    const varredura = await varrerConta(conta(), fs);

    expect(varredura.conta).toBe('marca-a');
    expect(varredura.prontos.map((p) => p.nome)).toEqual(['pronto']);
    expect(varredura.jaAgendados.map((p) => p.nome)).toEqual(['agendado']);
    expect(varredura.invalidos.map((p) => p.nome)).toEqual(['quebrado']);
    expect(varredura.invalidos[0].motivo).toMatch(/post\.json/i);
  });

  it('deve devolver listas vazias quando a pasta da conta esta vazia', async () => {
    const varredura = await varrerConta(conta(), fsFalso({ [PASTA]: [] }));

    expect(varredura.prontos).toEqual([]);
    expect(varredura.jaAgendados).toEqual([]);
    expect(varredura.invalidos).toEqual([]);
  });

  it('deve falhar com mensagem clara quando a pasta da conta nao existe', async () => {
    await expect(varrerConta(conta(), fsFalso({}))).rejects.toThrow(/pasta/i);
  });
});
