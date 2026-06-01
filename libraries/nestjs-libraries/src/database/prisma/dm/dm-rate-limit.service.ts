import { Injectable } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

const WINDOW_SECONDS = 3600;

/**
 * Rate limit por (integracao, remetente) para o bot de DM.
 * Janela deslizante simples baseada em contador no Redis com TTL de 1h.
 * Limite configuravel via DM_BOT_RATE_LIMIT_PER_HOUR (default 20).
 *
 * Consumido pela activity `sendDmReply` na Fase 2 do atendimento por DM
 * (NAO e dead code): antes de responder, a activity chama `allow(...)` para
 * respeitar o teto de mensagens por hora por remetente.
 */
@Injectable()
export class DmRateLimitService {
  async allow(integrationId: string, igSenderId: string): Promise<boolean> {
    const limit =
      parseInt(process.env.DM_BOT_RATE_LIMIT_PER_HOUR || '20', 10) || 20;
    const key = `dmbot:rl:${integrationId}:${igSenderId}`;

    // INCR + EXPIRE atomicos via pipeline para evitar contador sem TTL caso
    // o processo morra entre as duas chamadas (chave vazaria para sempre).
    // O retorno do ioredis e Array<[err, result]> por comando enfileirado.
    const results = await ioRedis
      .pipeline()
      .incr(key)
      .expire(key, WINDOW_SECONDS)
      .exec();
    const n = (results?.[0]?.[1] as number) ?? 0;

    return n <= limit;
  }
}
