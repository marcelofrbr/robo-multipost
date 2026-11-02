import 'reflect-metadata';
import { FacebookProvider } from './facebook.provider';

const ok = (body: any) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body } as any);

const DEPRECATED = [
  'page_impressions',
  'page_impressions_unique',
  'page_posts_impressions_unique',
];

/** Graph API simulada: recusa o lote inteiro se houver metrica desativada (como a Meta faz). */
const pageMock = (seen: string[] = []) =>
  jest.fn().mockImplementation((url: string) => {
    const u = new URL(url);
    if (!u.pathname.endsWith('/insights')) {
      return ok({ followers_count: 3200, fan_count: 3000 });
    }
    const metrics = (u.searchParams.get('metric') || '').split(',');
    seen.push(...metrics);
    if (metrics.some((m) => DEPRECATED.includes(m))) {
      return ok({ error: { message: 'invalid metric', code: 100 } });
    }
    const since = Number(u.searchParams.get('since'));
    const isPrevious = since < Date.now() / 1000 - 8 * 86400;
    const v = isPrevious ? 5 : 10;
    return ok({
      data: metrics.map((name) => ({
        name,
        period: 'day',
        values: [
          { value: v, end_time: '2026-11-01T07:00:00+0000' },
          { value: v * 3, end_time: '2026-11-02T07:00:00+0000' },
        ],
      })),
    });
  });

describe('FacebookProvider metricas', () => {
  let provider: FacebookProvider;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    provider = new FacebookProvider();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  describe('analytics', () => {
    it('nao deve pedir metricas desativadas pela Meta', async () => {
      const seen: string[] = [];
      global.fetch = pageMock(seen) as any;

      const result = await provider.analytics('page-1', 'TOK', 7);

      expect(seen.some((m) => DEPRECATED.includes(m))).toBe(false);
      expect(result.length).toBeGreaterThan(0);
    });

    it('deve somar contagens diarias e comparar com o periodo anterior', async () => {
      global.fetch = pageMock() as any;

      const result = await provider.analytics('page-1', 'TOK', 7);
      const views = result.find((m) => m.label === 'Views')!;

      expect(views.summary).toBe(40);
      expect(views.previous).toBe(20);
      expect(views.percentageChange).toBe(100);
      expect(views.data).toEqual([
        { total: '10', date: '2026-10-31' },
        { total: '30', date: '2026-11-01' },
      ]);
    });

    it('deve mostrar o alcance unico como media diaria, nunca como soma', async () => {
      global.fetch = pageMock() as any;

      const result = await provider.analytics('page-1', 'TOK', 7);
      const reach = result.find((m) => m.label === 'Daily Reach (avg)')!;

      expect(reach.summary).toBe(20);
      expect(reach.previous).toBe(10);
    });

    it('deve trazer os seguidores atuais da pagina', async () => {
      global.fetch = pageMock() as any;

      const result = await provider.analytics('page-1', 'TOK', 7);
      const followers = result.find((m) => m.label === 'Followers')!;

      expect(followers.summary).toBe(3200);
      expect(followers.kind).toBe('snapshot');
    });

    it('deve devolver lista vazia sem lancar quando a Graph API cai', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
      await expect(provider.analytics('page-1', 'TOK', 7)).resolves.toEqual([]);
    });
  });

  describe('postAnalytics', () => {
    it('deve somar as reacoes por tipo e trazer visualizacoes do post', async () => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        const metrics = new URL(url).searchParams.get('metric')!.split(',');
        return ok({
          data: metrics.map((name) => ({
            name,
            values: [
              {
                value:
                  name === 'post_reactions_by_type_total'
                    ? { like: 7, love: 3 }
                    : 50,
              },
            ],
          })),
        });
      }) as any;

      const result = await provider.postAnalytics('page-1', 'TOK', 'post-1', 7);

      expect(result.find((m) => m.label === 'Reactions')!.summary).toBe(10);
      expect(result.find((m) => m.label === 'Views')!.summary).toBe(50);
      expect(result.every((m) => m.kind === 'lifetime')).toBe(true);
    });
  });
});

describe('FacebookProvider.postAnalytics com id de midia', () => {
  afterEach(() => jest.restoreAllMocks());

  it('deve montar pagina_post quando o releaseId salvo e so o id da foto/video', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      urls.push(url);
      return Promise.resolve({ json: async () => ({ data: [{ name: 'post_media_view', period: 'lifetime', values: [{ value: 60 }] }] }) });
    }) as any;

    const result = await new FacebookProvider().postAnalytics('page-1', 'TOK', '123456', 7);

    expect(urls[0]).toContain('/v25.0/page-1_123456/insights');
    expect(result.find((m) => m.label === 'Views')!.summary).toBe(60);
  });

  it('deve manter o id quando ja vem no formato pagina_post', async () => {
    const urls: string[] = [];
    global.fetch = jest.fn().mockImplementation((url: string) => {
      urls.push(url);
      return Promise.resolve({ json: async () => ({ data: [] }) });
    }) as any;

    await new FacebookProvider().postAnalytics('page-1', 'TOK', 'page-1_999', 7);

    expect(urls[0]).toContain('/v25.0/page-1_999/insights');
  });
});
