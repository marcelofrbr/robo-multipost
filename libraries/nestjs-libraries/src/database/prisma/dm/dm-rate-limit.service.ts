import { Injectable } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const WINDOW_SECONDS = 3600;

/**
 * Rate limit por (integracao, remetente) para o bot de DM.
 * Janela deslizante simples baseada em contador no Redis com TTL de 1h.
 * Limite configuravel via DM_BOT_RATE_LIMIT_PER_HOUR (default 20).
 */
@Injectable()
export class DmRateLimitService {
  async allow(integrationId: string, igSenderId: string): Promise<boolean> {
    const limit =
      parseInt(process.env.DM_BOT_RATE_LIMIT_PER_HOUR || '20', 10) || 20;
    const key = `dmbot:rl:${integrationId}:${igSenderId}`;

    const n = await ioRedis.incr(key);
    if (n === 1) {
      await ioRedis.expire(key, WINDOW_SECONDS);
    }
    return n <= limit;
  }
}
