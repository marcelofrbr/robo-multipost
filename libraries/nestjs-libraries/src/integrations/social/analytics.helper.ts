import dayjs from 'dayjs';
import {
  AnalyticsData,
  AnalyticsKind,
  AnalyticsUnit,
} from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

/**
 * Helpers compartilhados pelas metricas dos providers (Instagram, Facebook,
 * YouTube). Somente leitura; nenhum helper lanca erro para nao afetar o
 * restante do provider. Ver docs/architecture/analytics-metricas.md.
 */

export interface AnalyticsWindow {
  since: number;
  until: number;
}

/** Periodo atual (ultimos `days` dias) e o anterior de mesmo tamanho, em unix seconds. */
export const analyticsWindows = (days: number, now = dayjs()) => {
  const safeDays = Number.isFinite(days) && days > 0 ? Math.floor(days) : 7;
  const until = now.unix();
  const since = now.subtract(safeDays, 'day').unix();
  const previousSince = now.subtract(safeDays * 2, 'day').unix();
  return {
    days: safeDays,
    current: { since, until } as AnalyticsWindow,
    previous: { since: previousSince, until: since } as AnalyticsWindow,
  };
};

const isNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

/** Variacao percentual com 1 casa; 0 quando nao ha base de comparacao. */
export const percentChange = (
  current?: number | null,
  previous?: number | null
): number => {
  if (!isNumber(current) || !isNumber(previous) || previous === 0) {
    return 0;
  }
  return Math.round(((current - previous) / previous) * 1000) / 10;
};

export const buildMetric = (opts: {
  label: string;
  current: number;
  previous?: number;
  unit?: AnalyticsUnit;
  kind?: AnalyticsKind;
  series?: AnalyticsData['data'];
  date?: string;
}): AnalyticsData => {
  const metric: AnalyticsData = {
    label: opts.label,
    data:
      opts.series && opts.series.length
        ? opts.series
        : [
            {
              total: String(opts.current),
              date: opts.date || dayjs().format('YYYY-MM-DD'),
            },
          ],
    summary: opts.current,
    percentageChange: percentChange(opts.current, opts.previous),
    unit: opts.unit || 'count',
    kind: opts.kind || 'period',
  };
  if (isNumber(opts.previous)) {
    metric.previous = opts.previous;
  }
  return metric;
};

/** A Meta fecha o dia no `end_time` (meia-noite do dia seguinte); devolve o dia medido. */
export const metaDayFromEndTime = (endTime: string): string =>
  dayjs(String(endTime).slice(0, 10)).subtract(1, 'day').format('YYYY-MM-DD');

/** total_value.value, ou a soma de values[] quando a Meta devolve serie. */
export const metaTotalValue = (item: any): number | undefined => {
  if (!item) return undefined;
  if (isNumber(item?.total_value?.value)) return item.total_value.value;
  if (Array.isArray(item?.values)) {
    return item.values.reduce(
      (acc: number, v: any) => acc + (isNumber(v?.value) ? v.value : 0),
      0
    );
  }
  return undefined;
};

export const metaSeries = (item: any): AnalyticsData['data'] =>
  Array.isArray(item?.values)
    ? item.values
        .filter((v: any) => isNumber(v?.value) && v?.end_time)
        .map((v: any) => ({
          total: String(v.value),
          date: metaDayFromEndTime(v.end_time),
        }))
    : [];

export const sumSeries = (series: AnalyticsData['data']): number =>
  series.reduce((acc, p) => acc + (Number(p.total) || 0), 0);

type FetchLike = (url: string) => Promise<{ json: () => Promise<any> }>;

const readInsights = async (fetchFn: FetchLike, url: string) => {
  try {
    const body = await (await fetchFn(url)).json();
    if (!body || body.error || !Array.isArray(body.data)) {
      return null;
    }
    return body.data as any[];
  } catch {
    return null;
  }
};

/**
 * Busca insights da Meta pedindo tudo numa chamada; se a Meta recusar o lote
 * (metrica desativada ou incompativel com o tipo de midia), pede uma a uma e
 * descarta so as recusadas. Nunca lanca.
 */
export const fetchMetaInsights = async (
  buildUrl: (metrics: string) => string,
  metrics: string[],
  fetchFn: FetchLike = (url) => fetch(url)
): Promise<Record<string, any>> => {
  // A Meta pode repetir a mesma metrica com periodos diferentes (ex.: post
  // com `lifetime` e `day`): vale o `lifetime`; senao, a primeira ocorrencia.
  const toMap = (items: any[]) =>
    items.reduce((acc, item) => {
      if (!item?.name) return acc;
      const current = acc[item.name];
      if (
        !current ||
        (item.period === 'lifetime' && current.period !== 'lifetime')
      ) {
        acc[item.name] = item;
      }
      return acc;
    }, {} as Record<string, any>);

  const batch = await readInsights(fetchFn, buildUrl(metrics.join(',')));
  if (batch) {
    return toMap(batch);
  }
  if (metrics.length === 1) {
    return {};
  }

  const single = await Promise.all(
    metrics.map((m) => readInsights(fetchFn, buildUrl(m)))
  );
  return toMap(single.flatMap((items) => items || []));
};
