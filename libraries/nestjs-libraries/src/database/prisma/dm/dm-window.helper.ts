// Janela de mensageria da Meta: so e permitido enviar DM dentro de 24h
// apos o ultimo inbound do usuario. Fora disso a Meta rejeita server-side.
const DM_24H_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Verdadeiro quando estamos FORA da janela de 24h da Meta. Sem inbound
 * conhecido (ausente/null) tambem conta como fora, por seguranca.
 *
 * Helper puro e testavel: nao toca em DB nem em estado externo. O parametro
 * `now` (default Date.now()) facilita os testes deterministicos.
 */
export function isOutsideDmWindow(
  lastInboundAt?: Date | string | null,
  now: number = Date.now()
): boolean {
  if (!lastInboundAt) {
    return true;
  }
  return now - new Date(lastInboundAt).getTime() > DM_24H_WINDOW_MS;
}
