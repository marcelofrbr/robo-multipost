import { ThrottlerGuard } from '@nestjs/throttler';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

// Prefixo das chaves que @Throttle grava via Reflect.defineMetadata
// (`THROTTLER:LIMIT` + nome do throttler — 'default' quando nao nomeado).
// E constante interna do @nestjs/throttler, nao reexportada; o spec exercita o
// decorator real, entao uma mudanca de formato no pacote falha alto.
const THROTTLE_LIMIT_KEY_PREFIX = 'THROTTLER:LIMIT';

@Injectable()
export class ThrottlerBehindProxyGuard extends ThrottlerGuard {
  public override async canActivate(
    context: ExecutionContext
  ): Promise<boolean> {
    const { url, method } = context.switchToHttp().getRequest<Request>();
    if (method === 'POST' && url.includes('/public/v1/posts')) {
      return super.canActivate(context);
    }

    // Rotas com @Throttle explicito (no handler ou na classe) tambem passam
    // pelo limitador. Sem isso o decorator vira documentacao: as rotas de IA
    // e a API publica de automacoes declaravam limites que nunca valiam.
    if (this.hasExplicitThrottle(context)) {
      return super.canActivate(context);
    }

    return true;
  }

  protected override async getTracker(
    req: Record<string, any>
  ): Promise<string> {
    // Rotas autenticadas tem req.org (AuthMiddleware / PublicAuthMiddleware);
    // fora disso cai para o ip para nao derrubar a request com TypeError.
    const who = req.org?.id ?? req.ip;
    return who + '_' + (req.url.indexOf('/posts') > -1 ? 'posts' : 'other');
  }

  private hasExplicitThrottle(context: ExecutionContext): boolean {
    // Qualquer throttler (default ou nomeado) declarado no handler ou na classe.
    return [context.getHandler(), context.getClass()].some((target) =>
      Reflect.getMetadataKeys(target).some(
        (key) =>
          typeof key === 'string' && key.startsWith(THROTTLE_LIMIT_KEY_PREFIX)
      )
    );
  }
}
