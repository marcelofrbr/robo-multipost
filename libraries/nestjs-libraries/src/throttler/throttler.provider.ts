import { ThrottlerGuard } from '@nestjs/throttler';
// Constante interna (nao reexportada pelo index do pacote): e a mesma chave
// que @Throttle grava no handler/classe.
import { THROTTLER_LIMIT } from '@nestjs/throttler/dist/throttler.constants';
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';

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
    const limit = this.reflector.getAllAndOverride<unknown>(
      THROTTLER_LIMIT + 'default',
      [context.getHandler(), context.getClass()]
    );
    return limit !== undefined;
  }
}
