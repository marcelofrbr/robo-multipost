import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import customParseFormat from 'dayjs/plugin/customParseFormat';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(customParseFormat);

export type MediaDatePreset = 'today' | 'last7' | 'last30' | 'thisMonth';

/** Datas locais no formato YYYY-MM-DD (o que o <input type="date"> usa). */
export interface MediaDateRange {
  from?: string;
  to?: string;
}

/** Instantes ISO 8601 (UTC) enviados ao GET /media. */
export interface MediaIsoRange {
  from?: string;
  to?: string;
}

const DAY = 'YYYY-MM-DD';

/**
 * Calcula o periodo de um atalho a partir de `now`, no fuso `tz`.
 * `last7`/`last30` incluem o dia de hoje (7 e 30 dias corridos).
 */
export function presetDateRange(
  preset: MediaDatePreset,
  now: Date,
  tz: string
): MediaDateRange {
  const today = dayjs(now).tz(tz);
  const to = today.format(DAY);
  switch (preset) {
    case 'today':
      return { from: to, to };
    case 'last7':
      return { from: today.subtract(6, 'day').format(DAY), to };
    case 'last30':
      return { from: today.subtract(29, 'day').format(DAY), to };
    case 'thisMonth':
      return { from: today.startOf('month').format(DAY), to };
  }
}

/**
 * Converte datas locais em instantes UTC: `from` vira o inicio do dia local
 * e `to` o fim do dia local (inclusivo), ambos no fuso `tz`.
 */
export function toIsoRange(range: MediaDateRange, tz: string): MediaIsoRange {
  const iso: MediaIsoRange = {};
  if (range.from) {
    iso.from = dayjs.tz(range.from, DAY, tz).startOf('day').toISOString();
  }
  if (range.to) {
    iso.to = dayjs.tz(range.to, DAY, tz).endOf('day').toISOString();
  }
  return iso;
}

/** `from` nao pode ser depois de `to`; lados ausentes sao validos. */
export function isValidDateRange(range: MediaDateRange): boolean {
  if (!range.from || !range.to) {
    return true;
  }
  return range.from <= range.to;
}
