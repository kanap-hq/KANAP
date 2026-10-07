export function requireEnv(name: string, env: NodeJS.ProcessEnv = process.env): string {
  const value = env[name];
  if (!value || value.trim() === '') {
    throw new Error(`FATAL: ${name} environment variable is required`);
  }
  return value;
}

export function requireJwtSecret(env: NodeJS.ProcessEnv = process.env): string {
  return requireEnv('JWT_SECRET', env);
}

export function requireAppBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const value = env.APP_BASE_URL || env.PUBLIC_APP_URL;
  if (!value || value.trim() === '') {
    throw new Error('FATAL: APP_BASE_URL environment variable is required');
  }
  return value;
}

export function parseBoolean(raw: string | undefined): boolean {
  const value = (raw || '').trim().toLowerCase();
  return value === 'true' || value === '1' || value === 'yes' || value === 'y' || value === 'on';
}

/**
 * CORS pattern entry. Can be:
 * - Exact origin: "https://app.kanap.net"
 * - Wildcard subdomain: "https://*.kanap.net" (matches any subdomain)
 * - Wildcard port: "http://localhost:*" (matches any port)
 */
export interface CorsPattern {
  protocol: string;
  host: string; // may contain leading "*." for wildcard subdomain
  port: string; // may be "*" for wildcard port, or empty for default
}

function parseCorsPattern(value: string): CorsPattern | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  // Handle wildcard patterns that aren't valid URLs
  // e.g., "https://*.kanap.net" or "http://localhost:*"
  const wildcardMatch = trimmed.match(/^(https?):\/\/(\*\.[^:/]+|\*|[^:/]+)(?::(\*|\d+))?$/);
  if (wildcardMatch) {
    const [, protocol, host, port] = wildcardMatch;
    return { protocol: protocol + ':', host, port: port || '' };
  }

  // Try parsing as a standard URL for exact origins
  try {
    const url = new URL(trimmed);
    // Extract port, accounting for default ports
    let port = url.port;
    if (!port) {
      port = ''; // Use empty string for default port
    }
    return { protocol: url.protocol, host: url.hostname, port };
  } catch {
    return null;
  }
}

export function parseCorsPatterns(env: NodeJS.ProcessEnv = process.env): CorsPattern[] {
  const raw = env.CORS_ORIGINS;
  if (!raw) return [];
  const patterns: CorsPattern[] = [];
  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const pattern = parseCorsPattern(entry);
    if (pattern) {
      const key = `${pattern.protocol}//${pattern.host}:${pattern.port}`;
      if (!seen.has(key)) {
        seen.add(key);
        patterns.push(pattern);
      }
    }
  }
  return patterns;
}

/**
 * Check if an origin matches any of the configured CORS patterns.
 * Supports:
 * - Exact match: "https://app.kanap.net"
 * - Wildcard subdomain: "https://*.kanap.net" matches "https://tenant.kanap.net"
 * - Wildcard port: "http://localhost:*" matches "http://localhost:5173"
 */
export function matchesCorsOrigin(origin: string, patterns: CorsPattern[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }

  const originProtocol = parsed.protocol;
  const originHost = parsed.hostname.toLowerCase();
  const originPort = parsed.port; // empty string if default port

  for (const pattern of patterns) {
    // Protocol must match exactly
    if (pattern.protocol !== originProtocol) continue;

    // Check port
    if (pattern.port !== '*' && pattern.port !== originPort) continue;

    // Check host
    if (pattern.host.startsWith('*.')) {
      // Wildcard subdomain: *.kanap.net matches foo.kanap.net and bar.kanap.net
      const domain = pattern.host.slice(2).toLowerCase();
      if (originHost === domain || originHost.endsWith('.' + domain)) {
        return true;
      }
    } else if (pattern.host === '*') {
      // Full wildcard host (rare, but supported)
      return true;
    } else {
      // Exact host match
      if (pattern.host.toLowerCase() === originHost) {
        return true;
      }
    }
  }

  return false;
}

// Legacy function for backward compatibility (deprecated)
export function parseCorsOrigins(): string[] {
  const patterns = parseCorsPatterns();
  // Return only exact origins (no wildcards) for backward compat
  return patterns
    .filter(p => !p.host.includes('*') && p.port !== '*')
    .map(p => {
      const portSuffix = p.port ? `:${p.port}` : '';
      return `${p.protocol}//${p.host}${portSuffix}`;
    });
}

/** A pattern with a `*` in its host or port (`https://*.kanap.net`, `http://localhost:*`). */
export function isWildcardCorsPattern(pattern: CorsPattern): boolean {
  return pattern.host.includes('*') || pattern.port === '*';
}

export function formatCorsPattern(pattern: CorsPattern): string {
  return `${pattern.protocol}//${pattern.host}${pattern.port ? `:${pattern.port}` : ''}`;
}

/** The run-mode value: `APP_ENV`, or `NODE_ENV` when `APP_ENV` is absent. */
export function getEnvMode(env: NodeJS.ProcessEnv = process.env): string {
  return (env.APP_ENV || env.NODE_ENV || '').trim().toLowerCase();
}

/**
 * The run mode the API applies:
 * - `development`: the run-mode value is explicitly development, dev, local or test. Only this
 *   mode turns on the workstation conveniences (links that follow a local development host,
 *   CORS open to every origin when `CORS_ORIGINS` is empty, the `*` platform-admin allowlist).
 * - `production`: the value is explicitly production or prod. Blocking start-up checks and the
 *   forced `Secure` cookie attribute apply.
 * - `unspecified`: any other value, or none (an installation that never set `APP_ENV`). The
 *   production rules apply to links, browser origins and platform administration; what could
 *   stop an installation from starting or from working over HTTP stays as it was or is a
 *   start-up warning.
 */
export type RuntimeMode = 'development' | 'production' | 'unspecified';

const DEVELOPMENT_MODE_VALUES = new Set(['development', 'dev', 'local', 'test']);
const PRODUCTION_MODE_VALUES = new Set(['production', 'prod']);

export function getRuntimeMode(env: NodeJS.ProcessEnv = process.env): RuntimeMode {
  const value = getEnvMode(env);
  if (PRODUCTION_MODE_VALUES.has(value)) return 'production';
  if (DEVELOPMENT_MODE_VALUES.has(value)) return 'development';
  return 'unspecified';
}

export function isProductionEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return getRuntimeMode(env) === 'production';
}

export function isDevelopmentEnv(env: NodeJS.ProcessEnv = process.env): boolean {
  return getRuntimeMode(env) === 'development';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export type StartupEnvReport = {
  mode: RuntimeMode;
  /** One line each, to print as start-up warnings. */
  warnings: string[];
};

/**
 * Start-up checks of the environment. Throws only where the API always refused to start:
 * `DATABASE_URL` or `JWT_SECRET` missing, and in production mode `APP_BASE_URL` or
 * `CORS_ORIGINS` missing. Everything else is returned as a warning.
 */
export function validateStartupEnv(
  env: NodeJS.ProcessEnv = process.env,
  options: { singleTenant: boolean },
): StartupEnvReport {
  requireEnv('DATABASE_URL', env);
  requireEnv('JWT_SECRET', env);
  const mode = getRuntimeMode(env);
  const warnings: string[] = [];

  if (mode === 'unspecified') {
    warnings.push(
      `[ENV] APP_ENV is ${env.APP_ENV ? `"${String(env.APP_ENV).trim()}"` : 'not set'}: production rules apply to links, browser origins and platform administration. Set APP_ENV=production (or development on a workstation).`,
    );
  }

  const appBaseUrl = String(env.APP_BASE_URL || env.PUBLIC_APP_URL || '').trim();
  // Multi-tenant links can also derive from APP_URL (common/url.ts).
  const anyAppAddress = appBaseUrl || (options.singleTenant ? '' : String(env.APP_URL || '').trim());
  if (mode === 'production') {
    requireAppBaseUrl(env);
  } else if (!anyAppAddress) {
    warnings.push(
      '[CONFIG] APP_BASE_URL is not set: password reset and invitation emails, notification links and sign-in redirects are refused. Set APP_BASE_URL to the address users open KANAP at (for example https://kanap.example.com).',
    );
  }
  if (appBaseUrl && !isHttpUrl(appBaseUrl)) {
    warnings.push(`[CONFIG] APP_BASE_URL is not a valid http(s) address: set it to the address users open KANAP at (for example https://kanap.example.com).`);
  }

  const patterns = parseCorsPatterns(env);
  if (patterns.length === 0) {
    if (mode === 'production') {
      throw new Error('FATAL: CORS_ORIGINS must be set in production. Example: CORS_ORIGINS=https://*.kanap.net');
    }
    warnings.push(
      mode === 'development'
        ? '[CORS] CORS_ORIGINS not set; allowing all origins (development only)'
        : '[CORS] CORS_ORIGINS is not set: browsers are allowed only from APP_BASE_URL and from the address of each request. Set CORS_ORIGINS to the exact address users open KANAP at (for example https://kanap.example.com).',
    );
  } else if (options.singleTenant && mode !== 'development') {
    for (const pattern of patterns.filter(isWildcardCorsPattern)) {
      warnings.push(
        `[CORS] CORS_ORIGINS entry ${formatCorsPattern(pattern)} is a pattern: it is still accepted in this version. Replace it with the exact address users open KANAP at (for example https://kanap.example.com); a later version accepts exact addresses only.`,
      );
    }
  }

  return { mode, warnings };
}
