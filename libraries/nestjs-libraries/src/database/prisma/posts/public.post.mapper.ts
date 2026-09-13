/**
 * Allowlist do objeto `integration` embutido nos posts devolvidos pela API
 * publica. O repositorio traz a linha inteira (include: { integration: true })
 * para a UI privada; na API publica so saem campos de exibicao — nunca
 * token/refreshToken/internalId/customInstanceDetails/additionalSettings.
 * Mesma lista de GET /public/v1/integrations.
 */
const PUBLIC_INTEGRATION_FIELDS = [
  'id',
  'name',
  'picture',
  'providerIdentifier',
  'disabled',
  'profileId',
] as const;

export function toPublicIntegration<T extends Record<string, any> | null | undefined>(
  integration: T
) {
  if (!integration) {
    return integration;
  }
  const safe: Record<string, unknown> = {};
  for (const key of PUBLIC_INTEGRATION_FIELDS) {
    if (key in integration) {
      safe[key] = integration[key];
    }
  }
  if (integration.customer) {
    safe.customer = {
      id: integration.customer.id,
      name: integration.customer.name,
    };
  }
  return safe;
}

export function toPublicPostPayload<T extends { posts?: any[] }>(payload: T): T {
  if (!payload?.posts) {
    return payload;
  }
  return {
    ...payload,
    posts: payload.posts.map((post) => ({
      ...post,
      integration: toPublicIntegration(post?.integration),
    })),
  };
}
