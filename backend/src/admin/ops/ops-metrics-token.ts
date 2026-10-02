/**
 * The token of `GET /ops/metrics` (ops-metrics.controller.ts): `OPS_METRICS_TOKEN`, 24 characters
 * or more (e.g. `openssl rand -hex 32`). A shorter one is not accepted: the route stays disabled
 * (404), and the start says so.
 */
export const OPS_METRICS_TOKEN_MIN_LENGTH = 24;

export function configuredOpsMetricsToken(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = String(env.OPS_METRICS_TOKEN ?? '').trim();
  return token.length >= OPS_METRICS_TOKEN_MIN_LENGTH ? token : null;
}

/** The start-up warning for a token set but too short, or null. */
export function opsMetricsTokenWarning(env: NodeJS.ProcessEnv = process.env): string | null {
  const token = String(env.OPS_METRICS_TOKEN ?? '').trim();
  if (token === '' || token.length >= OPS_METRICS_TOKEN_MIN_LENGTH) return null;
  return `OPS_METRICS_TOKEN is set but has ${token.length} characters, under ${OPS_METRICS_TOKEN_MIN_LENGTH}: GET /ops/metrics stays disabled. Use e.g. openssl rand -hex 32.`;
}
