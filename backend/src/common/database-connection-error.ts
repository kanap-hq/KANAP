/**
 * Whether an error is the database going away or not answering, never a migration's own failure
 * or a refused database role.
 *
 * PostgreSQL codes of a lost or refused connection: 57P01 (admin shutdown), 57P03 (cannot connect
 * now), and the connection exception class 08; Node's ECONNRESET and ECONNREFUSED. The same codes
 * on the driver error TypeORM wraps count too, as does node-postgres' "Connection terminated
 * unexpectedly", which carries no code.
 *
 * Nest retries the data source factory nine times, three seconds apart, for every error, unless
 * `toRetry` says otherwise (`app.module.ts`). The image entrypoint keeps the same test in
 * `scripts/migrate-and-start.js` (CommonJS, outside dist). `startup-migrations.spec.ts` checks
 * that the two agree.
 */
const CONNECTION_ERROR_CODES = new Set(['ECONNRESET', 'ECONNREFUSED', '57P01', '57P03']);

type ConnectionErrorLike = {
  code?: unknown;
  message?: unknown;
  driverError?: { code?: unknown };
};

export function isConnectionError(err: unknown): boolean {
  const error = err as ConnectionErrorLike | null | undefined;
  const codes = [error?.code, error?.driverError?.code].filter((code) => code != null).map(String);
  if (codes.some((code) => CONNECTION_ERROR_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code))) return true;
  return /Connection terminated unexpectedly/i.test(String(error?.message || ''));
}
