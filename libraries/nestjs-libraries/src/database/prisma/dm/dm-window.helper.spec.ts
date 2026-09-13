import { isOutsideDmWindow } from './dm-window.helper';

const DM_24H_WINDOW_MS = 24 * 60 * 60 * 1000;

describe('isOutsideDmWindow', () => {
  const now = new Date('2026-06-01T12:00:00.000Z').getTime();

  it('deve retornar true quando lastInboundAt e ausente (undefined)', () => {
    expect(isOutsideDmWindow(undefined, now)).toBe(true);
  });

  it('deve retornar true quando lastInboundAt e null', () => {
    expect(isOutsideDmWindow(null, now)).toBe(true);
  });

  it('deve retornar false quando dentro da janela de 24h', () => {
    const dentro = new Date(now - DM_24H_WINDOW_MS + 1000);
    expect(isOutsideDmWindow(dentro, now)).toBe(false);
  });

  it('deve retornar true quando fora da janela de 24h', () => {
    const fora = new Date(now - DM_24H_WINDOW_MS - 1000);
    expect(isOutsideDmWindow(fora, now)).toBe(true);
  });

  it('deve retornar false exatamente no limite de 24h (nao estritamente maior)', () => {
    const limite = new Date(now - DM_24H_WINDOW_MS);
    expect(isOutsideDmWindow(limite, now)).toBe(false);
  });

  it('deve aceitar lastInboundAt como string ISO', () => {
    const dentro = new Date(now - 1000).toISOString();
    expect(isOutsideDmWindow(dentro, now)).toBe(false);
  });
});
