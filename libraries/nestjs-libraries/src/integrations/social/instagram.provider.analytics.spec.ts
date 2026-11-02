import 'reflect-metadata';
import { InstagramProvider } from './instagram.provider';

const ok = (body: any) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body } as any);

/** Simula a Graph API: devolve valores distintos para periodo atual e anterior. */
const graphMock = (opts: { failMetric?: string } = {}) =>
  jest.fn().mockImplementation((url: string) => {
    const u = new URL(url);
    if (!u.pathname.endsWith('/insights')) {
      return ok({ followers_count: 1500, media_count: 80, id: 'ig-1' });
    }
    const metrics = (u.searchParams.get('metric') || '').split(',');
    if (opts.failMetric && metrics.includes(opts.failMetric)) {
      return ok({ error: { message: 'metric not supported' } });
    }
    const since = Number(u.searchParams.get('since'));
    const isPrevious = since < Date.now() / 1000 - 8 * 86400;
    const base = isPrevious ? 100 : 200;

    if (u.searchParams.get('breakdown') === 'follow_type') {
      return ok({
        data: [
          {
            name: 'follows_and_unfollows',
            total_value: {
              breakdowns: [
                {
                  results: [
                    { dimension_values: ['FOLLOWER'], value: base / 10 },
                    { dimension_values: ['NON_FOLLOWER'], value: 3 },
                  ],
                },
              ],
            },
          },
        ],
      });
    }

    if (u.searchParams.get('metric_type') !== 'total_value') {
      return ok({
        data: [
          {
            name: 'reach',
            values: [
              { value: 40, end_time: '2026-11-01T07:00:00+0000' },
              { value: 60, end_time: '2026-11-02T07:00:00+0000' },
            ],
          },
        ],
      });
    }

    return ok({
      data: metrics.map((name) => ({ name, total_value: { value: base } })),
    });
  });

describe('InstagramProvider metricas', () => {
  let provider: InstagramProvider;
  let originalFetch: typeof fetch;

  beforeEach(() => {
    provider = new InstagramProvider();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.resetAllMocks();
  });

  describe('analytics', () => {
    it('deve devolver o valor oficial do periodo sem duplicar pontos', async () => {
      global.fetch = graphMock() as any;

      const result = await provider.analytics('ig-1', 'TOK', 7);
      const likes = result.find((m) => m.label === 'Likes')!;

      expect(likes.summary).toBe(200);
      expect(likes.data).toHaveLength(1);
      expect(likes.data[0].total).toBe('200');
    });

    it('deve calcular a variacao real contra o periodo anterior', async () => {
      global.fetch = graphMock() as any;

      const result = await provider.analytics('ig-1', 'TOK', 7);
      const views = result.find((m) => m.label === 'Views')!;

      expect(views.previous).toBe(100);
      expect(views.percentageChange).toBe(100);
      expect(result.every((m) => m.percentageChange !== 5)).toBe(true);
    });

    it('deve usar a serie diaria de alcance no grafico e o total oficial no numero', async () => {
      global.fetch = graphMock() as any;

      const result = await provider.analytics('ig-1', 'TOK', 7);
      const reach = result.find((m) => m.label === 'Reach')!;

      expect(reach.summary).toBe(200);
      expect(reach.data).toEqual([
        { total: '40', date: '2026-10-31' },
        { total: '60', date: '2026-11-01' },
      ]);
    });

    it('deve trazer seguidores atuais, novos seguidores e deixaram de seguir', async () => {
      global.fetch = graphMock() as any;

      const result = await provider.analytics('ig-1', 'TOK', 7);

      const followers = result.find((m) => m.label === 'Followers')!;
      expect(followers.summary).toBe(1500);
      expect(followers.kind).toBe('snapshot');

      expect(result.find((m) => m.label === 'New Followers')!.summary).toBe(20);
      expect(result.find((m) => m.label === 'Unfollows')!.summary).toBe(3);
    });

    it('deve usar o host recebido (Instagram Login) em todas as chamadas', async () => {
      const fetchMock = graphMock();
      global.fetch = fetchMock as any;

      await provider.analytics('ig-1', 'TOK', 7, undefined, 'graph.instagram.com');

      for (const [url] of fetchMock.mock.calls) {
        expect(url).toMatch(/^https:\/\/graph\.instagram\.com\//);
      }
    });

    it('deve ignorar so a metrica recusada pela Meta e manter as demais', async () => {
      global.fetch = graphMock({ failMetric: 'replies' }) as any;

      const result = await provider.analytics('ig-1', 'TOK', 7);
      const labels = result.map((m) => m.label);

      expect(labels).not.toContain('Replies');
      expect(labels).toContain('Likes');
      expect(labels).toContain('Views');
    });

    it('deve devolver lista vazia sem lancar quando a Graph API cai', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('down')) as any;
      await expect(provider.analytics('ig-1', 'TOK', 7)).resolves.toEqual([]);
    });
  });

  describe('postAnalytics', () => {
    const postMock = (productType: string, metricsSeen: string[][]) =>
      jest.fn().mockImplementation((url: string) => {
        const u = new URL(url);
        if (!u.pathname.endsWith('/insights')) {
          return ok({ media_product_type: productType, media_type: 'VIDEO' });
        }
        const metrics = (u.searchParams.get('metric') || '').split(',');
        metricsSeen.push(metrics);
        return ok({
          data: metrics.map((name) => ({
            name,
            values: [
              {
                value:
                  name === 'ig_reels_avg_watch_time'
                    ? 4500
                    : name === 'reach'
                    ? 1000
                    : name === 'total_interactions'
                    ? 50
                    : 10,
              },
            ],
          })),
        });
      });

    it('deve pedir metricas de reels e converter tempo assistido para segundos', async () => {
      const seen: string[][] = [];
      global.fetch = postMock('REELS', seen) as any;

      const result = await provider.postAnalytics('ig-1', 'TOK', 'm-1', 7);

      expect(seen[0]).toContain('ig_reels_avg_watch_time');
      const watch = result.find((m) => m.label === 'Average Watch Time')!;
      expect(watch.summary).toBe(4.5);
      expect(watch.unit).toBe('seconds');
      expect(watch.kind).toBe('lifetime');
    });

    it('deve calcular a taxa de engajamento sobre o alcance', async () => {
      global.fetch = postMock('FEED', []) as any;

      const result = await provider.postAnalytics('ig-1', 'TOK', 'm-1', 7);
      const rate = result.find((m) => m.label === 'Engagement Rate')!;

      expect(rate.summary).toBe(5);
      expect(rate.unit).toBe('percent');
    });

    it('deve pedir metricas de story (respostas) e nao as de reels', async () => {
      const seen: string[][] = [];
      global.fetch = postMock('STORY', seen) as any;

      await provider.postAnalytics('ig-1', 'TOK', 'm-1', 7);

      expect(seen[0]).toContain('replies');
      expect(seen[0]).not.toContain('ig_reels_avg_watch_time');
      expect(seen[0]).not.toContain('saved');
    });

    it('deve manter as metricas antigas quando nao consegue ler o tipo da midia', async () => {
      const seen: string[][] = [];
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (!url.includes('/insights')) {
          return ok({ error: { message: 'no permission' } });
        }
        const metrics = new URL(url).searchParams.get('metric')!.split(',');
        seen.push(metrics);
        return ok({ data: metrics.map((name) => ({ name, values: [{ value: 1 }] })) });
      }) as any;

      const result = await provider.postAnalytics('ig-1', 'TOK', 'm-1', 7);

      expect(seen[0].sort()).toEqual(
        ['comments', 'likes', 'reach', 'saved', 'shares', 'views'].sort()
      );
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
