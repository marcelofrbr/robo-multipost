jest.mock('dns/promises', () => ({ lookup: jest.fn() }));

import { lookup } from 'dns/promises';
import {
  isPrivateOrLoopbackIp,
  assertPublicUrl,
  safeFetch,
} from './ssrf.guard';

const mockedLookup = lookup as unknown as jest.Mock;

describe('isPrivateOrLoopbackIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.0.1',
    '169.254.169.254',
    '0.0.0.0',
    '::1',
    'fc00::1',
    'fd12:3456::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    'nao-e-ip',
  ])('bloqueia %s', (ip) => {
    expect(isPrivateOrLoopbackIp(ip)).toBe(true);
  });

  it.each([
    '8.8.8.8',
    '1.1.1.1',
    '172.32.0.1',
    '192.169.0.1',
    '93.184.216.34',
    '2606:4700:4700::1111',
  ])('permite %s', (ip) => {
    expect(isPrivateOrLoopbackIp(ip)).toBe(false);
  });
});

describe('assertPublicUrl', () => {
  beforeEach(() => mockedLookup.mockReset());

  it('rejeita protocolo que nao seja http/https', async () => {
    await expect(assertPublicUrl('file:///etc/passwd')).rejects.toThrow('SSRF');
    await expect(assertPublicUrl('ftp://example.com/x')).rejects.toThrow('SSRF');
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejeita localhost literal sem resolver DNS', async () => {
    await expect(assertPublicUrl('http://localhost/x')).rejects.toThrow('SSRF');
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejeita IP interno literal sem resolver DNS', async () => {
    await expect(
      assertPublicUrl('http://169.254.169.254/latest/meta-data')
    ).rejects.toThrow('SSRF');
    await expect(assertPublicUrl('http://[::1]:8080/')).rejects.toThrow('SSRF');
    expect(mockedLookup).not.toHaveBeenCalled();
  });

  it('rejeita host que resolve para IP interno (anti DNS rebinding)', async () => {
    mockedLookup.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);
    await expect(assertPublicUrl('http://evil.example.com/x')).rejects.toThrow(
      'SSRF'
    );
  });

  it('rejeita se QUALQUER IP resolvido for interno', async () => {
    mockedLookup.mockResolvedValue([
      { address: '93.184.216.34', family: 4 },
      { address: '127.0.0.1', family: 4 },
    ]);
    await expect(assertPublicUrl('https://example.com/x')).rejects.toThrow(
      'SSRF'
    );
  });

  it('aceita host que resolve apenas para IP publico', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    await expect(
      assertPublicUrl('https://example.com/x')
    ).resolves.toBeUndefined();
  });
});

describe('safeFetch', () => {
  beforeEach(() => mockedLookup.mockReset());
  afterEach(() => jest.restoreAllMocks());

  it('bloqueia redirect que cai em IP interno', async () => {
    mockedLookup.mockImplementation(async (host: string) =>
      host === 'publico.example.com'
        ? [{ address: '93.184.216.34', family: 4 }]
        : [{ address: '169.254.169.254', family: 4 }]
    );
    jest.spyOn(global, 'fetch').mockResolvedValue({
      status: 302,
      headers: {
        get: (h: string) =>
          h.toLowerCase() === 'location' ? 'http://169.254.169.254/' : null,
      },
    } as unknown as Response);

    await expect(
      safeFetch('https://publico.example.com/img.png')
    ).rejects.toThrow('SSRF');
  });

  it('retorna a resposta final quando tudo e publico', async () => {
    mockedLookup.mockResolvedValue([{ address: '93.184.216.34', family: 4 }]);
    const response = {
      status: 200,
      headers: { get: () => 'image/png' },
      arrayBuffer: async () => new ArrayBuffer(0),
    } as unknown as Response;
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(response);

    const res = await safeFetch('https://example.com/img.png');

    expect(res).toBe(response);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://example.com/img.png',
      expect.objectContaining({ redirect: 'manual' })
    );
  });
});
