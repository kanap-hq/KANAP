import { ExecutionContext, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryRunner } from 'typeorm';

/**
 * Bounded waits of the request transaction (plan planning/perf-scale, lot 1D).
 *
 * Without them a request that meets a row held by a long operation waits until
 * that operation ends (up to the proxy's 300 s), holding one of the pool's
 * connections shared by every tenant. The request transaction therefore runs
 * with, as `SET LOCAL` (they end with the transaction):
 * - lock_timeout: a write waiting longer for a row lock gives up (55P03,
 *   answered 503 `busy`; the autosave retries it);
 * - statement_timeout: one statement running longer is cancelled (57014,
 *   503 `busy`);
 * - idle_in_transaction_session_timeout: a transaction left idle longer (a
 *   handler stuck in JavaScript or waiting on an outside service while it
 *   holds its transaction) is ended by the server, its locks released.
 *
 * Defaults 5 s / 30 s / 60 s, overridable by environment (milliseconds, 0 =
 * no limit): DB_LOCK_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS,
 * DB_IDLE_IN_TRANSACTION_TIMEOUT_MS. A legitimately long route raises them with
 * `@LongRunningRequest({...})`; a value there never lowers the default.
 */
export type RequestDbTimeouts = {
  lockTimeoutMs: number;
  statementTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
};

export const DEFAULT_REQUEST_DB_TIMEOUTS: Readonly<RequestDbTimeouts> = Object.freeze({
  lockTimeoutMs: 5_000,
  statementTimeoutMs: 30_000,
  idleInTransactionTimeoutMs: 60_000,
});

const ENV: Record<keyof RequestDbTimeouts, string> = {
  lockTimeoutMs: 'DB_LOCK_TIMEOUT_MS',
  statementTimeoutMs: 'DB_STATEMENT_TIMEOUT_MS',
  idleInTransactionTimeoutMs: 'DB_IDLE_IN_TRANSACTION_TIMEOUT_MS',
};

export const REQUEST_DB_TIMEOUTS_KEY = 'kanap:requestDbTimeouts';

/** Raises the bounded waits of the route's request transaction (see the module comment). */
export const LongRunningRequest = (timeouts: Partial<RequestDbTimeouts>) => SetMetadata(REQUEST_DB_TIMEOUTS_KEY, timeouts);

/**
 * CSV imports, budget column copy and clear, allocation copy, year copy of
 * master data, freeze / unfreeze (FX pinning over every line of the year),
 * bulk delete of budget lines: all or nothing over many rows.
 * - lock 30 s: such an operation would rather wait for a user's save in
 *   flight than fail and lose its work; a save that meets the operation still
 *   gives up after the default 5 s (and its autosave retries);
 * - statement 2 min: one statement may cover every row (a cascade delete of
 *   lines and their months, a set-based insert);
 * - idle 5 min: parsing and checking a large file in JavaScript happens
 *   between two statements of the open transaction.
 */
export const BULK_WRITE_TIMEOUTS: Readonly<Partial<RequestDbTimeouts>> = Object.freeze({
  lockTimeoutMs: 30_000,
  statementTimeoutMs: 120_000,
  idleInTransactionTimeoutMs: 300_000,
});

/**
 * Outside work while the request transaction waits idle: Netbox inventory
 * pages, the Microsoft Graph directory sync, pandoc document rendering, an AI
 * provider test, Stripe calls (its client waits up to 80 s per attempt). Only
 * the idle limit is raised (10 min); the transaction holds no lock meanwhile.
 */
export const OUTSIDE_WORK_TIMEOUTS: Readonly<Partial<RequestDbTimeouts>> = Object.freeze({
  idleInTransactionTimeoutMs: 600_000,
});

/**
 * Tenant deletion: the purge runs in its own transaction and deletes every
 * stored file, one storage call each, while the platform request transaction
 * waits idle (30 min).
 */
export const TENANT_PURGE_TIMEOUTS: Readonly<Partial<RequestDbTimeouts>> = Object.freeze({
  idleInTransactionTimeoutMs: 1_800_000,
});

function parseMs(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

/** The defaults, after the environment overrides (an invalid value keeps the built-in default). */
export function requestDbTimeoutDefaults(env: NodeJS.ProcessEnv = process.env): RequestDbTimeouts {
  return {
    lockTimeoutMs: parseMs(env[ENV.lockTimeoutMs], DEFAULT_REQUEST_DB_TIMEOUTS.lockTimeoutMs),
    statementTimeoutMs: parseMs(env[ENV.statementTimeoutMs], DEFAULT_REQUEST_DB_TIMEOUTS.statementTimeoutMs),
    idleInTransactionTimeoutMs: parseMs(env[ENV.idleInTransactionTimeoutMs], DEFAULT_REQUEST_DB_TIMEOUTS.idleInTransactionTimeoutMs),
  };
}

/** The longer of two waits, 0 meaning no limit. */
function longer(a: number, b: number | undefined): number {
  if (b == null || !Number.isInteger(b) || b < 0) return a;
  if (a === 0 || b === 0) return 0;
  return Math.max(a, b);
}

/** The defaults raised by the route's `@LongRunningRequest` (handler first, then controller). */
export function resolveRequestDbTimeouts(
  reflector: Reflector,
  context: ExecutionContext,
  defaults: RequestDbTimeouts = requestDbTimeoutDefaults(),
): RequestDbTimeouts {
  const raised = reflector.getAllAndOverride<Partial<RequestDbTimeouts> | undefined>(REQUEST_DB_TIMEOUTS_KEY, [
    context.getHandler(),
    context.getClass(),
  ]);
  if (!raised) return defaults;
  return {
    lockTimeoutMs: longer(defaults.lockTimeoutMs, raised.lockTimeoutMs),
    statementTimeoutMs: longer(defaults.statementTimeoutMs, raised.statementTimeoutMs),
    idleInTransactionTimeoutMs: longer(defaults.idleInTransactionTimeoutMs, raised.idleInTransactionTimeoutMs),
  };
}

/**
 * Opens the request transaction on the runner: the tenant and the bounded
 * waits, all transaction-local, in one round trip.
 */
export async function startTenantTransaction(runner: QueryRunner, tenantId: string, timeouts: RequestDbTimeouts): Promise<void> {
  await runner.startTransaction();
  await runner.query(
    `SELECT set_config('app.current_tenant', $1, true),
            set_config('lock_timeout', $2, true),
            set_config('statement_timeout', $3, true),
            set_config('idle_in_transaction_session_timeout', $4, true)`,
    [tenantId, String(timeouts.lockTimeoutMs), String(timeouts.statementTimeoutMs), String(timeouts.idleInTransactionTimeoutMs)],
  );
}
