import { createMcpRateLimit, mcpCallerKeys } from './mcp-rate-limit';

const makeRedis = () => {
  const counts = new Map<string, number>();
  return {
    counts,
    incr: jest.fn(async (k: string) => {
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return counts.get(k)!;
    }),
    expire: jest.fn(async () => 1),
  };
};

const req = (over: any = {}) =>
  ({ headers: {}, originalUrl: '/mcp', ip: '10.0.0.9', ...over }) as any;
const res = () => {
  const r: any = { statusCode: 200 };
  r.status = jest.fn((c: number) => ((r.statusCode = c), r));
  r.json = jest.fn(() => r);
  return r;
};

describe('mcp-rate-limit', () => {
  it('identifica o chamador pelo hash do token (Bearer ou na URL) + ip; nunca grava a chave crua', () => {
    const keys = mcpCallerKeys(req({ headers: { authorization: 'Bearer chave-secreta' } }));
    expect(keys.ip).toBe('ip:10.0.0.9');
    expect(keys.token).toMatch(/^tok:[a-f0-9]{32}$/);
    expect(keys.token).not.toContain('chave-secreta');

    const fromUrl = mcpCallerKeys(req({ originalUrl: '/mcp/chave-na-url?x=1' }));
    expect(fromUrl.token).toMatch(/^tok:[a-f0-9]{32}$/);

    const behindProxy = mcpCallerKeys(req({ headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' } }));
    expect(behindProxy.ip).toBe('ip:203.0.113.7');
    expect(mcpCallerKeys(req()).token).toBeUndefined();
  });

  it('deixa passar abaixo do limite e devolve 429 acima (por token e por ip)', async () => {
    const redis = makeRedis();
    const mw = createMcpRateLimit({ perToken: { limit: 2, windowSeconds: 60 }, perIp: { limit: 100, windowSeconds: 60 } }, redis as any);
    const r = req({ headers: { authorization: 'Bearer k' } });
    const next = jest.fn();

    await mw(r, res(), next);
    await mw(r, res(), next);
    expect(next).toHaveBeenCalledTimes(2);

    const blocked = res();
    await mw(r, blocked, next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(blocked.status).toHaveBeenCalledWith(429);
    expect(redis.expire).toHaveBeenCalled();
  });

  it('sem token, limita por ip (protege a validacao de chave contra forca bruta)', async () => {
    const redis = makeRedis();
    const mw = createMcpRateLimit({ perToken: { limit: 100, windowSeconds: 60 }, perIp: { limit: 1, windowSeconds: 60 } }, redis as any);
    const next = jest.fn();
    await mw(req(), res(), next);
    const blocked = res();
    await mw(req(), blocked, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(blocked.statusCode).toBe(429);
  });

  it('redis indisponivel nao derruba o MCP (fail-open com log)', async () => {
    const redis = { incr: jest.fn(async () => { throw new Error('down'); }), expire: jest.fn() };
    const mw = createMcpRateLimit({ perToken: { limit: 1, windowSeconds: 60 }, perIp: { limit: 1, windowSeconds: 60 } }, redis as any);
    const next = jest.fn();
    await mw(req(), res(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
