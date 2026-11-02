/**
 * Formatacao das metricas (sem React). Contrato em
 * docs/architecture/analytics-metricas.md: com `summary` usa o valor oficial
 * do periodo; sem `summary` mantem o comportamento antigo (soma, ou media com
 * `average`).
 */
export interface AnalyticsItem {
  label: string;
  data: Array<{ total: string | number; date: string }>;
  percentageChange?: number;
  summary?: number;
  previous?: number;
  unit?: 'count' | 'percent' | 'seconds';
  kind?: 'period' | 'snapshot' | 'lifetime';
  average?: boolean;
}

const LOCALE = 'pt-BR';

const decimal = (value: number, max = 2) =>
  new Intl.NumberFormat(LOCALE, { maximumFractionDigits: max }).format(value);

export const metricValue = (item: AnalyticsItem): number => {
  if (typeof item.summary === 'number' && Number.isFinite(item.summary)) {
    return item.summary;
  }
  const points = item.data || [];
  const total = points.reduce((acc, p) => acc + (Number(p.total) || 0), 0);
  return item.average && points.length ? total / points.length : total;
};

export const formatDuration = (seconds: number): string => {
  const s = Math.max(0, seconds);
  if (s < 60) {
    return `${decimal(s, 1)} s`;
  }
  if (s < 3600) {
    return `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
  }
  return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
};

export const formatMetric = (item: AnalyticsItem): string => {
  const value = metricValue(item);
  const unit = item.unit || (item.average ? 'percent' : 'count');
  if (unit === 'percent') {
    return `${decimal(value)}%`;
  }
  if (unit === 'seconds') {
    return formatDuration(value);
  }
  return new Intl.NumberFormat(LOCALE).format(Math.round(value));
};

/** Mesma regra de chave usada pelos cards: analytics_label_<rotulo normalizado>. */
export const analyticsLabelKey = (label: string): string =>
  `analytics_label_${label
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')}`;
