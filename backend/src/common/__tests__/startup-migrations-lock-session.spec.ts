// @throwaway-db-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { DataSource, MigrationInterface, QueryRunner } from 'typeorm';
import { backendPath } from './backend-root';
import { assertThrowawayDatabase } from './throwaway-database';
import { hardenDatabaseRoleBeforeMigrations } from '../database-role-safety';
import { runPendingMigrations, runStartupMigrations, withMigrationLock } from '../startup-migrations';

/**
 * The session that holds the migration lock ends while a migration runs (idle_session_timeout,
 * pg_terminate_backend, a lost network). The migrations run on that very session
 * (`runPendingMigrations` on the connection `withMigrationLock` holds), so the migration ends with
 * it and rolls back: the run fails, and the run waiting behind the lock then migrates alone. When
 * the lock sat on a connection of its own, the first run kept migrating on another one while the
 * second took the freed lock and applied the same migration: a migration that can run twice was
 * recorded twice in `migrations`, one that cannot made the second run fail.
 *
 * Played for the image entrypoint (two pods of the migration Job) and for the API's own start
 * followed by a Job. A scratch database, created and dropped here; the admin connection is
 * postgres/postgres on the host of DATABASE_URL unless MIGRATION_TEST_ADMIN_URL names another.
 * DATABASE_URL gives the application role and must name a throwaway database.
 */

const SPEC = 'startup-migrations-lock-session.spec';
assertThrowawayDatabase(SPEC);

const APP_URL = process.env.DATABASE_URL as string;
const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL || urlWith(APP_URL, { username: 'postgres', password: 'postgres', database: 'postgres' });
const DB = 'appdb_migrace_lock_session';

type PgClient = { connect(): Promise<void>; query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>; end(): Promise<void> };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { Client } = require('pg') as { Client: new (config: { connectionString: string }) => PgClient };

type Entrypoint = { runMigrationsIfNeeded(options: Record<string, unknown>): Promise<void> };
// eslint-disable-next-line @typescript-eslint/no-var-requires
const entrypoint: Entrypoint = require(backendPath('scripts', 'migrate-and-start.js'));

function urlWith(base: string, parts: { username?: string; password?: string; database: string }): string {
  const url = new URL(base);
  if (parts.username) url.username = parts.username;
  if (parts.password) url.password = parts.password;
  url.pathname = `/${parts.database}`;
  return url.toString();
}

/** A slow migration that can run twice: run twice at once, it is recorded twice. */
class LockSessionSlow1856999000001 implements MigrationInterface {
  name = 'LockSessionSlow1856999000001';
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('SELECT pg_sleep(3)');
    await queryRunner.query('CREATE TABLE IF NOT EXISTS lock_session_probe (id int)');
  }
  async down(): Promise<void> {}
}

async function withClient<T>(url: string, fn: (client: PgClient) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

const admin = <T>(fn: (client: PgClient) => Promise<T>) => withClient(ADMIN_URL, fn);

async function dropDatabase(): Promise<void> {
  await admin(async (client) => {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [DB]);
    await client.query(`DROP DATABASE IF EXISTS ${DB}`);
  });
}

async function createDatabase(): Promise<void> {
  await dropDatabase();
  const role = decodeURIComponent(new URL(APP_URL).username || 'app');
  await admin((client) => client.query(`CREATE DATABASE ${DB} OWNER ${role}`));
}

function dataSource(): DataSource {
  return new DataSource({ type: 'postgres', url: urlWith(APP_URL, { database: DB }), migrations: [LockSessionSlow1856999000001], logging: false });
}

type Outcome = { label: string; exits: number[]; executed: number | null; failure: string | null };

/** One run of the entrypoint's migration step, with a single connection attempt. */
async function entrypointRun(label: string): Promise<Outcome> {
  const outcome: Outcome = { label, exits: [], executed: null, failure: null };
  const quiet = () => undefined;
  await entrypoint.runMigrationsIfNeeded({
    env: { MIGRATION_MAX_ATTEMPTS: '1' },
    loadDataSource: dataSource,
    checkDatabaseRole: (ds: DataSource, log: (line: string) => void) => hardenDatabaseRoleBeforeMigrations(ds, 'entrypoint', log),
    beforeMigrations: async () => undefined,
    // The real lock and migration run, from src/: the entrypoint loads their compiled copy from dist/.
    withMigrationLock,
    runPendingMigrations,
    exit: (code: number) => { outcome.exits.push(code); },
    sleepFn: async () => undefined,
    log: (...args: unknown[]) => {
      const match = /Migrations complete \((\d+) executed\)/.exec(args.map(String).join(' '));
      if (match) outcome.executed = Number(match[1]);
    },
    warn: quiet,
    error: (...args: unknown[]) => { outcome.failure ??= args.map(String).join(' '); },
  });
  return outcome;
}

/** One start of the API that migrates (app.module.ts, without SKIP_MIGRATIONS). */
async function apiRun(label: string): Promise<Outcome> {
  const outcome: Outcome = { label, exits: [], executed: null, failure: null };
  const ds = dataSource();
  await ds.initialize();
  const log = console.log;
  console.log = () => undefined;
  try {
    outcome.executed = (await runStartupMigrations(ds, async () => undefined)).length;
  } catch (error) {
    outcome.failure = (error as Error)?.message || String(error);
  } finally {
    console.log = log;
    await ds.destroy().catch(() => undefined);
  }
  return outcome;
}

/** Polls `sql` (on the admin connection) until it returns a row; the rows, or a failed assertion. */
async function waitFor(what: string, sql: string, params: unknown[]): Promise<any[]> {
  const until = Date.now() + 15_000;
  for (;;) {
    const rows = await admin(async (client) => (await client.query(sql, params)).rows);
    if (rows.length > 0) return rows;
    assert.ok(Date.now() < until, `${what} within 15 s`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const ADVISORY = `SELECT pid FROM pg_locks
  WHERE locktype = 'advisory' AND granted = $2
    AND database = (SELECT oid FROM pg_database WHERE datname = $1)`;

async function scenario(name: string, first: () => Promise<Outcome>): Promise<void> {
  await createDatabase();
  const a = first();
  // The first run is inside the slow migration.
  await waitFor(`${name}: the slow migration started`, "SELECT pid FROM pg_stat_activity WHERE datname = $1 AND query LIKE 'SELECT pg_sleep%'", [DB]);
  const b = entrypointRun('the Job behind it');
  await waitFor(`${name}: the second run waits for the lock`, ADVISORY, [DB, false]);
  const [holder] = await waitFor(`${name}: the lock holder`, ADVISORY, [DB, true]);
  await admin((client) => client.query('SELECT pg_terminate_backend($1)', [holder.pid]));
  const outcomes = await Promise.all([a, b]);
  const rows = await withClient(urlWith(APP_URL, { database: DB }), async (client) =>
    (await client.query('SELECT name, count(*)::int AS n FROM migrations GROUP BY name')).rows);
  const report = JSON.stringify({ outcomes, rows });
  const [firstRun, second] = outcomes;
  assert.ok(firstRun.failure !== null && firstRun.executed === null, `${name}: the run whose lock session ended fails (${report})`);
  assert.deepEqual([second.exits, second.failure, second.executed], [[], null, 1], `${name}: the run behind it migrates alone (${report})`);
  assert.deepEqual(rows, [{ name: 'LockSessionSlow1856999000001', n: 1 }], `${name}: the migration recorded once (${report})`);
  await dropDatabase();
  console.log(`  ${name}: OK`);
}

async function main(): Promise<void> {
  try {
    await scenario('two Job pods, the first one loses its lock session', () => entrypointRun('the first Job pod'));
    await scenario('an API that migrates, then a Job; the API loses its lock session', () => apiRun('the API'));
  } finally {
    await dropDatabase().catch(() => undefined);
  }
  console.log(`${SPEC}: ok`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
