import { DmRateLimitService } from './dm-rate-limit.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { pipeline: jest.fn() },
}));

const mockedPipeline = ioRedis.pipeline as jest.MockedFunction<
  typeof ioRedis.pipeline
>;

/**
 * Monta um pipeline chainable (`.incr().expire().exec()`) cujo `exec`
 * resolve com o retorno padrao do ioredis: Array<[err, result]> por comando.
 */
function mockPipeline(incrResult: number) {
  const incr = jest.fn();
  const expire = jest.fn();
  const exec = jest.fn().mockResolvedValue([
    [null, incrResult],
    [null, 1],
  ]);
  const chain = { incr, expire, exec };
  incr.mockReturnValue(chain);
  expire.mockReturnValue(chain);
  mockedPipeline.mockReturnValue(chain as any);
  return chain;
}

describe('DmRateLimitService', () => {
  let service: DmRateLimitService;
  const originalLimit = process.env.DM_BOT_RATE_LIMIT_PER_HOUR;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.DM_BOT_RATE_LIMIT_PER_HOUR = '20';
    service = new DmRateLimitService();
  });

  afterEach(() => {
    if (originalLimit === undefined) {
      delete process.env.DM_BOT_RATE_LIMIT_PER_HOUR;
    } else {
      process.env.DM_BOT_RATE_LIMIT_PER_HOUR = originalLimit;
    }
  });

  describe('allow', () => {
    it('deve incrementar e setar expire atomicamente permitindo na primeira chamada', async () => {
      // ARRANGE
      const chain = mockPipeline(1);

      // ACT
      const result = await service.allow('int-1', 'sender-1');

      // ASSERT
      expect(chain.incr).toHaveBeenCalledWith('dmbot:rl:int-1:sender-1');
      expect(chain.expire).toHaveBeenCalledWith(
        'dmbot:rl:int-1:sender-1',
        3600
      );
      expect(chain.exec).toHaveBeenCalledTimes(1);
      expect(result).toBe(true);
    });

    it('deve bloquear quando o contador ultrapassa o limite', async () => {
      // ARRANGE: limite 20, incr retorna 21
      mockPipeline(21);

      // ACT
      const result = await service.allow('int-1', 'sender-1');

      // ASSERT
      expect(result).toBe(false);
    });
  });
});
