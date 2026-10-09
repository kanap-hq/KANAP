/**
 * The address of the client of a request, the one the rate limits count by and every other part
 * of the API that needs the client's address reads.
 *
 * `RATE_LIMIT_TRUST_PROXY` says how many reverse proxies run in front of the API on the operator's
 * side: `false` (none), `true` (one) or a number from 1 to 3. Each trusted proxy appends the
 * address it received the request from to `X-Forwarded-For`; the client address is the entry
 * the outermost trusted proxy appended, counted from the right. Entries further left come from
 * the client or from a proxy that is not trusted and are not used. Without a trusted proxy the
 * client address is the address of the connection.
 *
 * Unset, the setting is one proxy in single-tenant mode (the documented installation puts a
 * reverse proxy on the same host, in front of the API port bound to 127.0.0.1) and none in
 * multi-tenant mode (the cloud servers set it explicitly). An explicit value always applies.
 *
 * Cloud servers: Cloudflare, then the host nginx, then the API. The host nginx takes the visitor
 * address from Cloudflare's header only for Cloudflare's own address ranges (`real_ip_header`,
 * infra/nginx/host/cloudflare-real-ip.conf) and appends it to X-Forwarded-For: one trusted proxy.
 * The API does not read `CF-Connecting-IP` itself: the host nginx has already resolved it.
 *
 * Express does the counting (`trust proxy` set to the number of proxies), so `req.ip`,
 * `req.protocol` and `req.hostname` follow the same rule.
 */

export const MAX_TRUSTED_PROXY_HOPS = 3;

export type TrustProxySetting = {
  /** Number of trusted reverse proxies in front of the API; 0 means none. */
  hops: number;
  /** `configured`: a valid value; `default`: unset or empty; `invalid`: a value outside the list, default used. */
  source: 'configured' | 'default' | 'invalid';
  /** The value as given, for the start-up line. */
  raw: string | undefined;
  singleTenant: boolean;
};

const TRUE_VALUES = new Set(['true', 'yes', 'y', 'on']);
const FALSE_VALUES = new Set(['false', 'no', 'n', 'off', '0']);

export function defaultTrustProxyHops(singleTenant: boolean): number {
  return singleTenant ? 1 : 0;
}

/**
 * Reads `RATE_LIMIT_TRUST_PROXY`. Accepted: `true` (one proxy), `false`, or a number of proxies
 * from 1 to 3; case and surrounding spaces do not matter, and the boolean words the setting took
 * before (`yes`, `on`, `no`, `off`, `0`, ...) keep their meaning. Anything else is ignored with
 * a start-up warning and the default applies.
 */
export function resolveTrustProxy(raw: string | undefined, singleTenant: boolean): TrustProxySetting {
  const text = String(raw ?? '').trim().toLowerCase();
  const fallback = defaultTrustProxyHops(singleTenant);
  if (!text) return { hops: fallback, source: 'default', raw, singleTenant };
  if (TRUE_VALUES.has(text)) return { hops: 1, source: 'configured', raw, singleTenant };
  if (FALSE_VALUES.has(text)) return { hops: 0, source: 'configured', raw, singleTenant };
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    if (hops >= 1 && hops <= MAX_TRUSTED_PROXY_HOPS) return { hops, source: 'configured', raw, singleTenant };
  }
  return { hops: fallback, source: 'invalid', raw, singleTenant };
}

/** The setting of this process: `RATE_LIMIT_TRUST_PROXY` and the deployment mode. */
export function trustProxySettingFromEnv(singleTenant: boolean, env: NodeJS.ProcessEnv = process.env): TrustProxySetting {
  return resolveTrustProxy(env.RATE_LIMIT_TRUST_PROXY, singleTenant);
}

/** Applies the setting to the Express application that serves the API. */
export function applyTrustProxy(expressApp: { set(name: string, value: unknown): unknown }, setting: TrustProxySetting): void {
  expressApp.set('trust proxy', setting.hops > 0 ? setting.hops : false);
}

/** The `[RATE-LIMIT]` start-up line: where the client address comes from, and why. */
export function trustProxyStartupLine(setting: TrustProxySetting): { level: 'log' | 'warn'; message: string } {
  const where = setting.hops > 0
    ? `taken from X-Forwarded-For behind ${setting.hops} trusted ${setting.hops === 1 ? 'proxy' : 'proxies'}`
    : 'the address of the connection, no trusted proxy';
  const mode = setting.singleTenant ? 'single-tenant' : 'multi-tenant';
  if (setting.source === 'configured') {
    return { level: 'log', message: `[RATE-LIMIT] Client address: ${where} (RATE_LIMIT_TRUST_PROXY=${String(setting.raw).trim()})` };
  }
  if (setting.source === 'invalid') {
    const shown = String(setting.raw).trim().slice(0, 40);
    return {
      level: 'warn',
      message: `[RATE-LIMIT] RATE_LIMIT_TRUST_PROXY="${shown}" is not true, false or a number from 1 to ${MAX_TRUSTED_PROXY_HOPS}: ignored, ${mode} default applied. Client address: ${where}`,
    };
  }
  if (setting.singleTenant) {
    return {
      level: 'warn',
      message: `[RATE-LIMIT] Client address: ${where} (RATE_LIMIT_TRUST_PROXY not set, ${mode} default; set it to true, false or the number of proxies in front of the API)`,
    };
  }
  return { level: 'log', message: `[RATE-LIMIT] Client address: ${where} (RATE_LIMIT_TRUST_PROXY not set, ${mode} default)` };
}

/**
 * The client address of a request, or null when the request has none: the address appended by
 * the outermost trusted proxy, or the address of the connection without one (see above).
 */
export function clientAddress(req: { ip?: unknown } | null | undefined): string | null {
  const ip = typeof req?.ip === 'string' ? req.ip.trim() : '';
  return ip || null;
}
