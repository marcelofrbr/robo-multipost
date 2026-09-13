import { createHash } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Rate limit das rotas do MCP (/mcp, /mcp/:id, /mcp-oauth, /sse, /message).
 *
 * Essas rotas sao montadas com `app.use` direto no Express (start.mcp.ts), fora
 * do pipeline de controllers do Nest — logo o ThrottlerBehindProxyGuard
 * (APP_GUARD) nunca roda para elas. Este middleware faz o equivalente com um
 * contador Redis por janela:
 *  - por token (hash da chave/OAuth token — nunca a chave crua no Redis): freia
 *    abuso de tools caras/destrutivas por quem tem uma chave valida;
 *  - por ip: freia forca bruta contra a validacao da chave (resolveAuth), que
 *    cada tentativa com token diferente nao alcancaria pelo contador por token.
 * Redis fora do ar -> fail-open (o MCP continua servindo) com log.
 */
export interface McpRateLimitWindow {
  limit: number;
  windowSeconds: number;
}

export interface McpRateLimitOptions {
  perToken: McpRateLimitWindow;
  perIp: McpRateLimitWindow;
  prefix?: string;
  /**
   * Quantos proxies confiaveis ANEXAM ao X-Forwarded-For antes do app. Em
   * producao sao 2 (Traefik na borda grava o ip real; o nginx do container
   * anexa o ip do Traefik), entao o cliente e o penultimo valor. O primeiro
   * valor da lista e controlado pelo cliente e nunca deve ser usado.
   * Env: MCP_TRUSTED_PROXY_HOPS.
   */
  trustedProxyHops?: number;
}

const hopsFromEnv = () => {
  const n = Number(process.env.MCP_TRUSTED_PROXY_HOPS);
  return Number.isInteger(n) && n > 0 ? n : 2;
};

export const MCP_RATE_LIMIT_DEFAULTS: McpRateLimitOptions = {
  perToken: { limit: 120, windowSeconds: 60 },
  perIp: { limit: 300, windowSeconds: 60 },
  prefix: 'mcp-rl',
  trustedProxyHops: hopsFromEnv(),
};

type RedisLike = {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
};

const logger = new Logger('McpRateLimit');

export function mcpCallerKeys(
  req: Request,
  trustedProxyHops = MCP_RATE_LIMIT_DEFAULTS.trustedProxyHops ?? 2
): { ip: string; token?: string } {
  const auth = String(req.headers?.authorization ?? '');
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const fromUrl = String(req.originalUrl ?? '').match(
    /\/(?:mcp|sse|message)\/([^/?#]+)/
  )?.[1];
  const token = bearer || fromUrl;
  const chain = String(req.headers?.['x-forwarded-for'] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Do lado direito, descontando os hops confiaveis; com menos entradas que
  // hops (dev sem borda), fica o que o proxy confiavel gravou.
  const forwarded = chain.length
    ? chain[Math.max(0, chain.length - trustedProxyHops)]
    : '';
  return {
    ip: 'ip:' + (forwarded || req.ip || 'unknown'),
    token: token
      ? 'tok:' + createHash('sha256').update(token).digest('hex').slice(0, 32)
      : undefined,
  };
}

async function hit(
  redis: RedisLike,
  key: string,
  window: McpRateLimitWindow
): Promise<boolean> {
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, window.windowSeconds);
  }
  return count > window.limit;
}

export function createMcpRateLimit(
  options: McpRateLimitOptions = MCP_RATE_LIMIT_DEFAULTS,
  redis: RedisLike = ioRedis as unknown as RedisLike
) {
  const prefix = options.prefix ?? 'mcp-rl';
  const hops = options.trustedProxyHops ?? MCP_RATE_LIMIT_DEFAULTS.trustedProxyHops;
  return async (req: Request, res: Response, next: NextFunction) => {
    const keys = mcpCallerKeys(req, hops);
    try {
      const overIp = await hit(redis, `${prefix}:${keys.ip}`, options.perIp);
      const overToken = keys.token
        ? await hit(redis, `${prefix}:${keys.token}`, options.perToken)
        : false;
      if (overIp || overToken) {
        const window = overToken ? options.perToken : options.perIp;
        res.status(429).json({
          error: 'rate_limited',
          retryAfterSeconds: window.windowSeconds,
        });
        return;
      }
    } catch (err) {
      logger.warn(`Redis indisponivel, MCP sem rate limit nesta request: ${err}`);
    }
    next();
  };
}
