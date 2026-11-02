import 'reflect-metadata';
import { google } from 'googleapis';
import { YoutubeProvider } from './youtube.provider';

const METRICS = [
  'views',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
  'subscribersGained',
  'subscribersLost',
  'likes',
  'comments',
  'shares',
];

const headers = (withDay: boolean) =>
  [...(withDay ? ['day'] : []), ...METRICS].map((name) => ({ name }));

/** Simula reports.query: diario (dimensions=day), total do periodo e total do anterior. */
const queryMock = (opts: { failTotals?: boolean } = {}) =>
  jest.fn().mockImplementation(async (params: any) => {
    if (params.dimensions === 'day') {
      return {
        data: {
          columnHeaders: headers(true),
          rows: [
            ['2026-10-31', 100, 50, 30, 40, 2, 1, 10, 3, 1],
            ['2026-11-01', 300, 150, 60, 50, 4, 0, 20, 5, 2],
          ],
        },
      };
    }
    if (opts.failTotals) {
      throw new Error('quota');
    }
    const isPrevious = params.startDate < '2026-10-27';
    return {
      data: {
        columnHeaders: headers(false),
        rows: [
          isPrevious
            ? [200, 100, 40, 45, 3, 1, 15, 4, 1]
            : [400, 200, 52.5, 47.5, 6, 1, 30, 8, 3],
        ],
      },
    };
  });

describe('YoutubeProvider metricas', () => {
  let provider: YoutubeProvider;

  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date('2026-11-02T12:00:00Z'),
      doNotFake: ['nextTick', 'setImmediate'],
    });
    provider = new YoutubeProvider();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  const mockAnalytics = (query: jest.Mock) =>
    jest
      .spyOn(google, 'youtubeAnalytics')
      .mockReturnValue({ reports: { query } } as any);

  it('deve usar os totais do periodo calculados pelo YouTube (media ponderada correta)', async () => {
    mockAnalytics(queryMock());

    const result = await provider.analytics('ch-1', 'TOK', 7);
    const duration = result.find((m) => m.label === 'Average View Duration')!;

    expect(duration.summary).toBe(52.5);
    expect(duration.unit).toBe('seconds');
    expect(duration.previous).toBe(40);
  });

  it('deve trazer visualizacoes com serie diaria e variacao real', async () => {
    mockAnalytics(queryMock());

    const result = await provider.analytics('ch-1', 'TOK', 7);
    const views = result.find((m) => m.label === 'Views')!;

    expect(views.summary).toBe(400);
    expect(views.previous).toBe(200);
    expect(views.percentageChange).toBe(100);
    expect(views.data).toEqual([
      { total: '100', date: '2026-10-31' },
      { total: '300', date: '2026-11-01' },
    ]);
  });

  it('deve marcar a porcentagem assistida como percentual', async () => {
    mockAnalytics(queryMock());

    const result = await provider.analytics('ch-1', 'TOK', 7);

    expect(
      result.find((m) => m.label === 'Average View Percentage')!.unit
    ).toBe('percent');
  });

  it('deve pedir periodos atual e anterior de mesmo tamanho', async () => {
    const query = queryMock();
    mockAnalytics(query);

    await provider.analytics('ch-1', 'TOK', 7);
    const ranges = query.mock.calls
      .map(([p]) => `${p.startDate}..${p.endDate}`)
      .sort();

    expect(ranges).toEqual([
      '2026-10-20..2026-10-26',
      '2026-10-27..2026-11-02',
      '2026-10-27..2026-11-02',
    ]);
  });

  it('deve cair para a soma diaria quando o total do periodo falha', async () => {
    mockAnalytics(queryMock({ failTotals: true }));

    const result = await provider.analytics('ch-1', 'TOK', 7);
    const views = result.find((m) => m.label === 'Views')!;

    expect(views.summary).toBe(400);
    expect(views.percentageChange).toBe(0);
  });

  it('deve arredondar valores fracionados para 2 casas', async () => {
    const query = jest.fn().mockImplementation(async (params: any) => ({
      data: {
        columnHeaders: headers(params.dimensions === 'day'),
        rows: params.dimensions === 'day' ? [] : [[1, 1, 1, 7.580000000000001, 0, 0, 0, 0, 0]],
      },
    }));
    mockAnalytics(query);

    const result = await provider.analytics('ch-1', 'TOK', 7);

    expect(result.find((m) => m.label === 'Average View Percentage')!.summary).toBe(7.58);
  });

  it('deve devolver lista vazia sem lancar quando a API cai', async () => {
    mockAnalytics(jest.fn().mockRejectedValue(new Error('down')));
    await expect(provider.analytics('ch-1', 'TOK', 7)).resolves.toEqual([]);
  });
});
