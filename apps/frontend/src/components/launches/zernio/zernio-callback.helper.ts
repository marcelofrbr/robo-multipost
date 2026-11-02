const ZERNIO_PREFIX = 'zernio-';

export type ZernioCallback =
  | {
      kind: 'connect';
      platform: string;
      zernioProfileId: string;
      accountId: string;
    }
  | { kind: 'error'; message: string };

const asString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

/**
 * Interpreta os query params que o Zernio anexa ao `redirect_url` depois do
 * OAuth: `connected=<plataforma>&profileId=...&accountId=...&username=...`
 * (ou `error=<slug>` em caso de falha). O Zernio nao devolve `state`/`code`,
 * entao esse retorno nao pode seguir o fluxo generico de `social-connect`.
 *
 * So `profileId` e `accountId` sao aproveitados: nome e plataforma reais vem
 * do backend, que confere a conta no perfil Zernio do usuario.
 *
 * Retorna `null` quando o provider nao e Zernio ou faltam os campos
 * obrigatorios — nesse caso o chamador segue o fluxo generico.
 */
export function parseZernioCallback(
  provider: string,
  searchParams: Record<string, unknown>
): ZernioCallback | null {
  if (!provider.startsWith(ZERNIO_PREFIX)) {
    return null;
  }

  const error = asString(searchParams.error);
  if (error) {
    return { kind: 'error', message: error };
  }

  const zernioProfileId = asString(searchParams.profileId);
  const accountId = asString(searchParams.accountId);
  if (!zernioProfileId || !accountId) {
    return null;
  }

  return {
    kind: 'connect',
    platform: provider.slice(ZERNIO_PREFIX.length),
    zernioProfileId,
    accountId,
  };
}
