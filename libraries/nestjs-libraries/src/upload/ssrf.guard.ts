import { lookup } from 'dns/promises';
import { isIP } from 'net';

/**
 * Guarda anti-SSRF para fetch de URLs fornecidas pelo usuario (upload a partir
 * de URL: `MediaService.uploadFromUrl`, `storage.uploadSimple`, geracao de
 * imagem/video por IA, tool MCP `uploadMediaFromUrl`, endpoint publico
 * `/public/v1/upload-from-url`). Recusa loopback, link-local (incluindo o
 * metadata 169.254.169.254), ranges privados IPv4/IPv6 e protocolos que nao
 * sejam http/https. Resolve o host por DNS e valida cada IP resolvido para
 * evitar bypass por DNS apontando para IP interno, e revalida cada destino de
 * redirect.
 *
 * Limitacao conhecida (TOCTOU): o IP validado aqui pode diferir do IP ao qual o
 * `fetch` realmente conecta (re-resolucao). Mitigar 100% exigiria fixar o IP via
 * dispatcher customizado do undici. A validacao de todos os IPs resolvidos + a
 * revalidacao por hop reduzem fortemente a janela de ataque.
 */

const MAX_REDIRECTS = 3;

function isBlockedIpv4(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (
    parts.length !== 4 ||
    parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)
  ) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) return true; // 0.0.0.0/8 (this host)
  if (a === 127) return true; // loopback 127.0.0.0/8
  if (a === 10) return true; // privado 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // privado 172.16.0.0/12
  if (a === 192 && b === 168) return true; // privado 192.168.0.0/16
  if (a === 169 && b === 254) return true; // link-local 169.254.0.0/16 (metadata 169.254.169.254)
  return false;
}

function isBlockedIpv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true; // loopback / unspecified
  const v4mapped = lower.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4mapped) return isBlockedIpv4(v4mapped[1]);
  const firstHextet = lower.split(':')[0];
  // fc00::/7 unique-local (fc.. ou fd..)
  if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) return true;
  // fe80::/10 link-local
  if (/^fe[89ab]/.test(firstHextet)) return true;
  return false;
}

/**
 * Retorna true para IP de loopback, link-local, privado ou nao reconhecido
 * (fail-closed). Aceita apenas enderecos publicos roteaveis.
 */
export function isPrivateOrLoopbackIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  // Nao e um IP reconhecido: bloqueia por seguranca.
  return true;
}

/**
 * Valida que a URL aponta para um destino publico antes de qualquer conexao.
 * Lanca `Error('SSRF: ...')` quando o protocolo nao e http/https, quando o host
 * e localhost, quando o host e um IP interno literal, ou quando o host resolve
 * (DNS) para qualquer IP interno.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`SSRF: URL invalida (${String(rawUrl).slice(0, 60)})`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SSRF: protocolo nao permitido (${parsed.protocol})`);
  }

  const hostname = parsed.hostname.replace(/^\[/, '').replace(/\]$/, '');
  if (!hostname || hostname.toLowerCase() === 'localhost') {
    throw new Error('SSRF: host nao permitido (localhost)');
  }

  if (isIP(hostname)) {
    if (isPrivateOrLoopbackIp(hostname)) {
      throw new Error(`SSRF: IP interno bloqueado (${hostname})`);
    }
    return;
  }

  let resolved: Array<{ address: string }>;
  try {
    resolved = await lookup(hostname, { all: true });
  } catch {
    throw new Error(`SSRF: falha ao resolver o host (${hostname})`);
  }
  if (!resolved.length) {
    throw new Error(`SSRF: host sem enderecos (${hostname})`);
  }
  for (const { address } of resolved) {
    if (isPrivateOrLoopbackIp(address)) {
      throw new Error(
        `SSRF: host ${hostname} resolve para IP interno (${address})`
      );
    }
  }
}

/**
 * `fetch` com guarda anti-SSRF: valida a URL antes de conectar, segue redirects
 * manualmente (ate `MAX_REDIRECTS`) revalidando cada destino. Use em qualquer
 * fetch de URL fornecida pelo usuario.
 */
export async function safeFetch(
  rawUrl: string,
  init?: RequestInit
): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, { ...init, redirect: 'manual' });
    const isRedirect = res.status >= 300 && res.status < 400;
    const location = res.headers?.get?.('location');
    if (isRedirect && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error('SSRF: excesso de redirects');
}
