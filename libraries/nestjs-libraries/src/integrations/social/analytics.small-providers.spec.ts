import 'reflect-metadata';
import { LinkedinPageProvider } from './linkedin.page.provider';
import { PinterestProvider } from './pinterest.provider';
import { ThreadsProvider } from './threads.provider';
import { TiktokProvider } from './tiktok.provider';

const ok = (body: any) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body } as any);

describe('Metricas: ajustes em LinkedIn, Pinterest, Threads e TikTok', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('LinkedinPageProvider.analytics', () => {
    const day = (start: number, s: Record<string, number>) => ({
      timeRange: { start, end: start + 86400000 },
      totalShareStatistics: s,
    });

    beforeEach(() => {
      global.fetch = jest.fn().mockImplementation((url: string) => {
        if (url.includes('organizationalEntityShareStatistics')) {
          return ok({
            elements: [
              day(Date.UTC(2026, 9, 31, 12), {
                impressionCount: 1000,
                clickCount: 20,
                likeCount: 25,
                commentCount: 3,
                shareCount: 2,
                engagement: 0.05,
              }),
              day(Date.UTC(2026, 10, 1, 12), {
                impressionCount: 3000,
                clickCount: 30,
                likeCount: 15,
                commentCount: 3,
                shareCount: 2,
                engagement: 0.0167,
              }),
            ],
          });
        }
        return ok({ elements: [] });
      }) as any;
    });

    it('deve calcular a taxa de engajamento do periodo a partir das contagens', async () => {
      const result = await new LinkedinPageProvider().analytics('org-1', 'TOK', 7);
      const engagement = result.find((m) => m.label === 'Engagement')!;

      // (20+25+3+2 + 30+15+3+2) / (1000+3000) = 100/4000 = 2,5%
      expect(engagement.summary).toBe(2.5);
      expect(engagement.unit).toBe('percent');
      expect(engagement.data.map((p) => p.total)).toEqual(['5', '1.67']);
    });

    it('deve trazer impressoes e nao inventar variacao', async () => {
      const result = await new LinkedinPageProvider().analytics('org-1', 'TOK', 7);

      expect(
        result
          .find((m) => m.label === 'Impressions')!
          .data.map((p) => Number(p.total))
      ).toEqual([1000, 3000]);
      expect(result.every((m) => m.percentageChange === 0)).toBe(true);
    });
  });

  describe('PinterestProvider.analytics', () => {
    it('deve calcular a taxa de clique a partir de cliques e impressoes', async () => {
      global.fetch = jest.fn().mockImplementation(() =>
        ok({
          all: {
            daily_metrics: [
              {
                date: '2026-10-31',
                metrics: {
                  PIN_CLICK_RATE: 0.01,
                  IMPRESSION: 1000,
                  PIN_CLICK: 10,
                  ENGAGEMENT: 30,
                  SAVE: 4,
                },
              },
              {
                date: '2026-11-01',
                metrics: {
                  PIN_CLICK_RATE: 0.03,
                  IMPRESSION: 1000,
                  PIN_CLICK: 30,
                  ENGAGEMENT: 50,
                  SAVE: 6,
                },
              },
            ],
          },
        })
      ) as any;

      const result = await new PinterestProvider().analytics('acc', 'TOK', 7);
      const rate = result.find((m) => m.label === 'Pin click rate')!;

      expect(rate.summary).toBe(2);
      expect(rate.unit).toBe('percent');
      expect(rate.data.map((p) => p.total)).toEqual(['1', '3']);
      expect(
        result.find((m) => m.label === 'Impressions')!.percentageChange
      ).toBe(0);
    });
  });

  describe('ThreadsProvider.analytics', () => {
    it('nao deve inventar variacao de +5%', async () => {
      global.fetch = jest.fn().mockImplementation(() =>
        ok({
          data: [
            { name: 'likes', total_value: { value: 12 } },
            {
              name: 'views',
              values: [{ value: 3, end_time: '2026-11-01T07:00:00+0000' }],
            },
          ],
        })
      ) as any;

      const result = await new ThreadsProvider().analytics('th-1', 'TOK', 7);

      expect(result.length).toBe(2);
      expect(result.every((m) => m.percentageChange === 0)).toBe(true);
    });
  });

  describe('TiktokProvider.analytics', () => {
    it('deve rotular os totais como ultimos 20 videos e marcar valores atuais', async () => {
      const provider = new TiktokProvider();
      jest.spyOn(provider as any, 'fetch').mockImplementation((url: any) => {
        if (String(url).includes('user/info')) {
          return ok({
            data: {
              user: {
                follower_count: 900,
                following_count: 10,
                likes_count: 5000,
                video_count: 40,
              },
            },
          });
        }
        if (String(url).includes('video/list')) {
          return ok({ data: { videos: [{ id: 'v1' }, { id: 'v2' }] } });
        }
        return ok({
          data: {
            videos: [
              { id: 'v1', view_count: 100, like_count: 10, comment_count: 1, share_count: 2 },
              { id: 'v2', view_count: 300, like_count: 30, comment_count: 3, share_count: 4 },
            ],
          },
        });
      });

      const result = await provider.analytics('tt-1', 'TOK', 7);
      const labels = result.map((m) => m.label);

      expect(labels).toContain('Views (last 20 videos)');
      expect(labels).not.toContain('Recent Likes');
      expect(
        result.find((m) => m.label === 'Views (last 20 videos)')!.summary
      ).toBe(400);
      expect(result.every((m) => m.kind === 'snapshot')).toBe(true);
    });
  });
});
