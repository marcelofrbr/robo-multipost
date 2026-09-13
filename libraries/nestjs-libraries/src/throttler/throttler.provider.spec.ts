import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ThrottlerBehindProxyGuard } from './throttler.provider';

const makeContext = (
  method: string,
  url: string,
  handler: (...args: any[]) => any = () => undefined,
  classRef: any = class Sem {},
  org: { id: string } | undefined = { id: 'org-1' }
) =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method, url, org, ip: '10.0.0.9' }),
    }),
    getHandler: () => handler,
    getClass: () => classRef,
  }) as unknown as ExecutionContext;

describe('ThrottlerBehindProxyGuard', () => {
  let guard: ThrottlerBehindProxyGuard;
  let superCanActivate: jest.SpyInstance;

  beforeEach(() => {
    guard = new ThrottlerBehindProxyGuard(
      { throttlers: [{ ttl: 1000, limit: 1 }] } as any,
      {} as any,
      new Reflector()
    );
    superCanActivate = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('aplica o limitador em POST /public/v1/posts (allowlist legado)', async () => {
    await guard.canActivate(makeContext('POST', '/public/v1/posts'));

    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it('libera rota sem @Throttle sem consultar o limitador', async () => {
    const result = await guard.canActivate(
      makeContext('GET', '/public/v1/flows')
    );

    expect(result).toBe(true);
    expect(superCanActivate).not.toHaveBeenCalled();
  });

  it('aplica o limitador em rota com @Throttle explicito no handler', async () => {
    class Ctrl {
      @Throttle({ default: { limit: 5, ttl: 1000 } })
      handler(): void {
        return undefined;
      }
    }

    await guard.canActivate(
      makeContext('GET', '/public/v1/flows', Ctrl.prototype.handler, Ctrl)
    );

    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it('aplica o limitador em rota com @Throttle na classe', async () => {
    @Throttle({ default: { limit: 5, ttl: 1000 } })
    class Ctrl {
      handler(): void {
        return undefined;
      }
    }

    await guard.canActivate(
      makeContext('POST', '/flows/dm/bot', Ctrl.prototype.handler, Ctrl)
    );

    expect(superCanActivate).toHaveBeenCalledTimes(1);
  });

  it('getTracker usa a org e cai para o ip quando nao ha org na request', async () => {
    const tracker = (guard as any).getTracker.bind(guard);

    await expect(
      tracker({ org: { id: 'org-1' }, url: '/public/v1/posts' })
    ).resolves.toBe('org-1_posts');
    await expect(
      tracker({ url: '/public/v1/flows', ip: '10.0.0.9' })
    ).resolves.toBe('10.0.0.9_other');
  });
});
