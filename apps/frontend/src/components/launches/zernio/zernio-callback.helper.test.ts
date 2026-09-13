import { describe, expect, it } from 'vitest';
import { parseZernioCallback } from './zernio-callback.helper';

describe('parseZernioCallback', () => {
  it('retorna null para provider que nao e zernio', () => {
    const result = parseZernioCallback('tiktok', {
      accountId: '6aa45cce726ebfe037dbee80',
      profileId: '69fe1d30eab99a0db856d162',
    });

    expect(result).toBeNull();
  });

  it('retorna null quando accountId ou profileId faltam', () => {
    expect(
      parseZernioCallback('zernio-tiktok', {
        profileId: '69fe1d30eab99a0db856d162',
      })
    ).toBeNull();

    expect(
      parseZernioCallback('zernio-tiktok', {
        accountId: '6aa45cce726ebfe037dbee80',
      })
    ).toBeNull();
  });

  it('extrai plataforma, perfil zernio e conta do retorno', () => {
    const result = parseZernioCallback('zernio-tiktok', {
      connected: 'tiktok',
      profileId: '69fe1d30eab99a0db856d162',
      accountId: '6aa45cce726ebfe037dbee80',
      username: 'marcelofrancapro',
    });

    expect(result).toEqual({
      kind: 'connect',
      platform: 'tiktok',
      zernioProfileId: '69fe1d30eab99a0db856d162',
      accountId: '6aa45cce726ebfe037dbee80',
    });
  });

  it('ignora params que nao sejam string', () => {
    const result = parseZernioCallback('zernio-instagram', {
      profileId: ['69fe1d30eab99a0db856d162'],
      accountId: '69fe1d6692b3d8e85f9ec36d',
    });

    expect(result).toBeNull();
  });

  it('retorna erro quando o zernio devolve error na url', () => {
    const result = parseZernioCallback('zernio-tiktok', {
      platform: 'tiktok',
      error: 'tiktok_auth_failed',
    });

    expect(result).toEqual({ kind: 'error', message: 'tiktok_auth_failed' });
  });
});
