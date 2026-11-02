import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import {
  analyticsWindows,
  buildMetric,
  fetchMetaInsights,
  metaDayFromEndTime,
  metaSeries,
  metaTotalValue,
  percentChange,
  sumSeries,
} from './analytics.helper';

dayjs.extend(utc);

const jsonResponse = (body: any) =>
  Promise.resolve({ ok: true, status: 200, json: async () => body } as any);

describe('analytics.helper', () => {
  describe('analyticsWindows', () => {
    it('deve montar periodo atual e anterior de mesmo tamanho, sem sobreposicao', () => {
      const now = dayjs.utc('2026-11-02T12:00:00Z');
      const w = analyticsWindows(7, now);

      expect(w.current.until).toBe(now.unix());
      expect(w.current.since).toBe(now.subtract(7, 'day').unix());
      expect(w.previous.until).toBe(w.current.since);
      expect(w.previous.since).toBe(now.subtract(14, 'day').unix());
    });

    it('deve usar 7 dias quando o valor for invalido', () => {
      const now = dayjs.utc('2026-11-02T12:00:00Z');
      expect(analyticsWindows(NaN, now).days).toBe(7);
      expect(analyticsWindows(0, now).days).toBe(7);
    });
  });

  describe('percentChange', () => {
    it('deve calcular a variacao real com uma casa decimal', () => {
      expect(percentChange(150, 100)).toBe(50);
      expect(percentChange(90, 120)).toBe(-25);
      expect(percentChange(1, 3)).toBe(-66.7);
    });

    it('deve devolver 0 quando nao ha base de comparacao', () => {
      expect(percentChange(10, 0)).toBe(0);
      expect(percentChange(10, undefined)).toBe(0);
      expect(percentChange(undefined, 10)).toBe(0);
    });
  });

  describe('buildMetric', () => {
    it('deve gerar um ponto unico com summary, previous e variacao', () => {
      const m = buildMetric({
        label: 'Reach',
        current: 200,
        previous: 100,
        date: '2026-11-02',
      });
      expect(m).toEqual({
        label: 'Reach',
        data: [{ total: '200', date: '2026-11-02' }],
        summary: 200,
        previous: 100,
        percentageChange: 100,
        unit: 'count',
        kind: 'period',
      });
    });

    it('deve manter a serie informada para o grafico', () => {
      const series = [
        { total: '1', date: '2026-11-01' },
        { total: '2', date: '2026-11-02' },
      ];
      const m = buildMetric({ label: 'Reach', current: 3, series });
      expect(m.data).toBe(series);
      expect(m.percentageChange).toBe(0);
      expect(m.previous).toBeUndefined();
    });
  });

  describe('metaDayFromEndTime', () => {
    it('deve devolver o dia anterior ao end_time da Meta, independente de fuso', () => {
      expect(metaDayFromEndTime('2026-11-01T07:00:00+0000')).toBe('2026-10-31');
      expect(metaDayFromEndTime('2026-03-01T08:00:00+0000')).toBe('2026-02-28');
    });
  });

  describe('metaTotalValue / metaSeries / sumSeries', () => {
    it('deve ler total_value e cair para a soma dos valores diarios', () => {
      expect(metaTotalValue({ total_value: { value: 42 } })).toBe(42);
      expect(
        metaTotalValue({
          values: [{ value: 1 }, { value: 2 }, { value: 'x' }],
        })
      ).toBe(3);
      expect(metaTotalValue(undefined)).toBeUndefined();
    });

    it('deve converter values em serie e somar a serie', () => {
      const s = metaSeries({
        values: [
          { value: 5, end_time: '2026-11-01T07:00:00+0000' },
          { value: 7, end_time: '2026-11-02T07:00:00+0000' },
        ],
      });
      expect(s).toEqual([
        { total: '5', date: '2026-10-31' },
        { total: '7', date: '2026-11-01' },
      ]);
      expect(sumSeries(s)).toBe(12);
    });
  });

  describe('fetchMetaInsights', () => {
    it('deve buscar todas as metricas numa unica chamada quando a Meta aceita', async () => {
      const fetchFn = jest.fn().mockImplementation(() =>
        jsonResponse({
          data: [
            { name: 'reach', total_value: { value: 10 } },
            { name: 'views', total_value: { value: 20 } },
          ],
        })
      );

      const result = await fetchMetaInsights(
        (m) => `https://x/insights?metric=${m}`,
        ['reach', 'views'],
        fetchFn
      );

      expect(fetchFn).toHaveBeenCalledTimes(1);
      expect(fetchFn.mock.calls[0][0]).toBe(
        'https://x/insights?metric=reach,views'
      );
      expect(result.reach.total_value.value).toBe(10);
      expect(result.views.total_value.value).toBe(20);
    });

    it('deve pedir uma a uma e descartar so a metrica recusada quando o lote falha', async () => {
      const fetchFn = jest.fn().mockImplementation((url: string) => {
        if (url.includes('reach,views,impressions')) {
          return jsonResponse({ error: { message: 'invalid metric' } });
        }
        if (url.includes('metric=impressions')) {
          return jsonResponse({ error: { message: 'deprecated' } });
        }
        const name = url.split('metric=')[1];
        return jsonResponse({
          data: [{ name, total_value: { value: name.length } }],
        });
      });

      const result = await fetchMetaInsights(
        (m) => `https://x/insights?metric=${m}`,
        ['reach', 'views', 'impressions'],
        fetchFn
      );

      expect(fetchFn).toHaveBeenCalledTimes(4);
      expect(Object.keys(result).sort()).toEqual(['reach', 'views']);
    });

    it('deve devolver objeto vazio sem lancar quando a rede cai', async () => {
      const fetchFn = jest.fn().mockRejectedValue(new Error('network'));
      await expect(
        fetchMetaInsights((m) => `u?metric=${m}`, ['reach'], fetchFn)
      ).resolves.toEqual({});
    });
  });
});

describe('fetchMetaInsights com metrica repetida', () => {
  it('deve preferir o valor lifetime quando a Meta repete a metrica com outro periodo', async () => {
    const fetchFn = jest.fn().mockImplementation(() =>
      Promise.resolve({
        json: async () => ({
          data: [
            { name: 'post_total_media_view_unique', period: 'lifetime', values: [{ value: 49 }] },
            { name: 'post_total_media_view_unique', period: 'day', values: [{ value: 0 }] },
            { name: 'x', period: 'day', values: [{ value: 1 }] },
            { name: 'x', period: 'week', values: [{ value: 9 }] },
          ],
        }),
      })
    );
    const r = await fetchMetaInsights((m) => `u?metric=${m}`, ['post_total_media_view_unique', 'x'], fetchFn);
    expect(r.post_total_media_view_unique.values[0].value).toBe(49);
    expect(r.x.values[0].value).toBe(1);
  });
});
