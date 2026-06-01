import { DmRateLimitService } from './dm-rate-limit.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: { incr: jest.fn(), expire: jest.fn() },
}));

const mockedIncr = ioRedis.incr as jest.MockedFunction<typeof ioRedis.incr>;
const mockedExpire = ioRedis.expire as jest.MockedFunction<
  typeof ioRedis.expire
>;

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
    it('deve setar expire e permitir na primeira chamada', async () => {
      // ARRANGE
      mockedIncr.mockResolvedValue(1);
      mockedExpire.mockResolvedValue(1);

      // ACT
      const result = await service.allow('int-1', 'sender-1');

      // ASSERT
      expect(mockedIncr).toHaveBeenCalledWith('dmbot:rl:int-1:sender-1');
      expect(mockedExpire).toHaveBeenCalledWith(
        'dmbot:rl:int-1:sender-1',
        3600
      );
      expect(result).toBe(true);
    });

    it('deve bloquear quando o contador ultrapassa o limite', async () => {
      // ARRANGE: limite 20, incr retorna 21
      mockedIncr.mockResolvedValue(21);

      // ACT
      const result = await service.allow('int-1', 'sender-1');

      // ASSERT
      expect(mockedExpire).not.toHaveBeenCalled();
      expect(result).toBe(false);
    });
  });
});
