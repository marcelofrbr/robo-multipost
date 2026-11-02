import { describe, expect, it } from 'vitest';
import {
  analyticsLabelKey,
  formatDuration,
  formatMetric,
  metricValue,
} from './analytics-format.helper';

const point = (total: string | number, date = '2026-11-01') => ({ total, date });

describe('metricValue', () => {
  it('usa o summary do backend quando existe (sem somar a serie)', () => {
    expect(
      metricValue({ label: 'Reach', data: [point(40), point(60)], summary: 75 })
    ).toBe(75);
  });

  it('formato antigo: soma a serie convertendo texto em numero', () => {
    expect(metricValue({ label: 'Likes', data: [point('10'), point('5')] })).toBe(15);
  });

  it('formato antigo com average: tira a media', () => {
    expect(
      metricValue({ label: 'Rate', average: true, data: [point(2), point(4)] })
    ).toBe(3);
  });

  it('serie vazia vale zero', () => {
    expect(metricValue({ label: 'X', data: [] })).toBe(0);
  });
});

describe('formatDuration', () => {
  it('segundos, minutos e horas', () => {
    expect(formatDuration(4.5)).toBe('4,5 s');
    expect(formatDuration(252)).toBe('4 min 12 s');
    expect(formatDuration(12000)).toBe('3 h 20 min');
  });
});

describe('formatMetric', () => {
  it('contagem em pt-BR com separador de milhar', () => {
    expect(formatMetric({ label: 'Views', data: [], summary: 12345, unit: 'count' })).toBe('12.345');
  });

  it('percentual com ate duas casas', () => {
    expect(formatMetric({ label: 'Rate', data: [], summary: 2.5, unit: 'percent' })).toBe('2,5%');
  });

  it('duracao em segundos', () => {
    expect(formatMetric({ label: 'Watch', data: [], summary: 52.5, unit: 'seconds' })).toBe('52,5 s');
  });

  it('formato antigo com average continua mostrando percentual', () => {
    expect(
      formatMetric({ label: 'Rate', average: true, data: [point(1), point(2)] })
    ).toBe('1,5%');
  });
});

describe('analyticsLabelKey', () => {
  it('gera a chave de traducao a partir do rotulo', () => {
    expect(analyticsLabelKey('Views (last 20 videos)')).toBe('analytics_label_views_last_20_videos');
    expect(analyticsLabelKey('Daily Reach (avg)')).toBe('analytics_label_daily_reach_avg');
    expect(analyticsLabelKey('Average View Duration')).toBe('analytics_label_average_view_duration');
  });
});
