import { describe, expect, it } from 'vitest';
import {
  isValidDateRange,
  presetDateRange,
  toIsoRange,
} from './media-date-range.helper';

const TZ = 'America/Sao_Paulo';
// 15/09/2026 12:00 em Sao Paulo (UTC-3) = 15:00Z
const NOW = new Date('2026-09-15T15:00:00.000Z');

describe('presetDateRange', () => {
  it('hoje: from e to no mesmo dia local', () => {
    expect(presetDateRange('today', NOW, TZ)).toEqual({
      from: '2026-09-15',
      to: '2026-09-15',
    });
  });

  it('7 dias: hoje e os 6 dias anteriores', () => {
    expect(presetDateRange('last7', NOW, TZ)).toEqual({
      from: '2026-09-09',
      to: '2026-09-15',
    });
  });

  it('30 dias: hoje e os 29 dias anteriores', () => {
    expect(presetDateRange('last30', NOW, TZ)).toEqual({
      from: '2026-08-17',
      to: '2026-09-15',
    });
  });

  it('este mes: do dia 1 ate hoje', () => {
    expect(presetDateRange('thisMonth', NOW, TZ)).toEqual({
      from: '2026-09-01',
      to: '2026-09-15',
    });
  });

  it('usa a data local do fuso, nao a UTC', () => {
    // 23:30 em Sao Paulo de 14/09 = 02:30Z de 15/09
    const lateNight = new Date('2026-09-15T02:30:00.000Z');
    expect(presetDateRange('today', lateNight, TZ)).toEqual({
      from: '2026-09-14',
      to: '2026-09-14',
    });
  });
});

describe('toIsoRange', () => {
  it('converte inicio e fim do dia local em instantes UTC', () => {
    expect(toIsoRange({ from: '2026-09-01', to: '2026-09-30' }, TZ)).toEqual({
      from: '2026-09-01T03:00:00.000Z',
      to: '2026-10-01T02:59:59.999Z',
    });
  });

  it('aceita so um dos lados', () => {
    expect(toIsoRange({ to: '2026-09-30' }, TZ)).toEqual({
      to: '2026-10-01T02:59:59.999Z',
    });
    expect(toIsoRange({ from: '2026-09-01' }, TZ)).toEqual({
      from: '2026-09-01T03:00:00.000Z',
    });
  });

  it('retorna objeto vazio sem datas', () => {
    expect(toIsoRange({}, TZ)).toEqual({});
  });
});

describe('isValidDateRange', () => {
  it('valido quando from <= to ou quando falta um dos lados', () => {
    expect(isValidDateRange({ from: '2026-09-01', to: '2026-09-01' })).toBe(true);
    expect(isValidDateRange({ from: '2026-09-01', to: '2026-09-02' })).toBe(true);
    expect(isValidDateRange({ from: '2026-09-01' })).toBe(true);
    expect(isValidDateRange({})).toBe(true);
  });

  it('invalido quando from > to', () => {
    expect(isValidDateRange({ from: '2026-09-02', to: '2026-09-01' })).toBe(false);
  });
});
