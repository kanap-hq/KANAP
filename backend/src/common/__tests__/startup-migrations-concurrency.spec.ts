// @throwaway-db-spec
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { DataSource } from 'typeorm';
import { backendPath } from './backend-root';
import { assertThrowawayDatabase } from './throwaway-database';
import { hardenDatabaseRoleBeforeMigrations } from '../database-role-safety';
import { runStartupMigrations, withMigrationLock } from '../startup-migrations';
import { runDataAccessBeforeMigrations } from '../../data-access/data-access-availability';

/**
 * Two migration runs at once on one database: two pods of the migration Job, a Job and an API
 * started without SKIP_MIGRATIONS during a rolling update, two `npm run migrate` by hand. TypeORM
 * takes no lock of its own: both runs read the same pending list and apply it. They take turns
 * under one session advisory lock (`withMigrationLock`, common/startup-migrations.ts), shared by
 * the image entrypoint and the API's own start: the first one migrates, the other one waits, then
 * finds nothing pending. No migration runs twice, no name appears twice in `migrations`.
 *
 * Scratch databases, created and dropped here (CI runs this spec alone, as an exclusive
 * database spec): an empty one (the whole chain), and one a single migration behind. The admin
 * connection is postgres/postgres on the host of DATABASE_URL unless MIGRATION_TEST_ADMIN_URL
 * names another. DATABASE_URL gives the application role and must name a throwaway database.
 */

const SPEC = 'startup-migrations-concurrency.spec';
assertThrowawayDatabase(SPEC);

const APP_URL = process.env.DATABASE_URL as string;
const ADMIN_URL = process.env.MIGRATION_TEST_ADMIN_URL || urlWith(APP_URL, { username: 'postgres', password: 'postgres', database: 'postgres' });
const EMPTY_DB = 'appdb_migrace_empty';
const BEHIND_DB = 'appdb_migrace_behind';

type MigrationClass = { new (): unknown; name: string };
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

function appRole(): string {
  return decodeURIComponent(new URL(APP_URL).username || 'app');
}

/** The migration classes of the running tree (.ts under ts-node, .js once compiled), in order. */
function migrationClasses(): MigrationClass[] {
  const directory = path.join(__dirname, '..', '..', 'migrations');
  const found: Array<{ timestamp: number; migration: MigrationClass }> = [];
  for (const file of fs.readdirSync(directory).sort()) {
    if (!/\.(ts|js)$/.test(file) || file.endsWith('.d.ts')) continue;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    for (const exported of Object.values(require(path.join(directory, file)))) {
      const match = typeof exported === 'function' ? /(\d{13})$/.exec((exported as MigrationClass).name || '') : null;
      if (match) found.push({ timestamp: Number(match[1]), migration: exported as MigrationClass });
    }
  }
  return found.sort((a, b) => a.timestamp - b.timestamp).map((entry) => entry.migration);
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

async function dropDatabase(name: string): Promise<void> {
  await withClient(ADMIN_URL, async (client) => {
    await client.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()', [name]);
    await client.query(`DROP DATABASE IF EXISTS ${name}`);
  });
}

/** A new database owned by the application role, with the extensions an installation provides. */
async function createDatabase(name: string): Promise<void> {
  await dropDatabase(name);
  await withClient(ADMIN_URL, (client) => client.query(`CREATE DATABASE ${name} OWNER ${appRole()}`));
  await withClient(urlWith(ADMIN_URL, { database: name }), async (client) => {
    for (const extension of ['citext', 'pgcrypto', '"uuid-ossp"', 'pg_trgm', 'unaccent']) {
      await client.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`);
    }
  });
}

function dataSource(database: string, migrations: MigrationClass[]): DataSource {
  return new DataSource({ type: 'postgres', url: urlWith(APP_URL, { database }), migrations, logging: false });
}

type Outcome = { label: string; exits: number[]; executed: number | null; failure: string | null };

/** One run of the image entrypoint's migration step (`--migrate-only` and the default start). */
async function entrypointRun(label: string, database: string, migrations: MigrationClass[]): Promise<Outcome> {
  const outcome: Outcome = { label, exits: [], executed: null, failure: null };
  const quiet = () => undefined;
  await entrypoint.runMigrationsIfNeeded({
    env: { MIGRATION_MAX_ATTEMPTS: '1' },
    loadDataSource: () => dataSource(database, migrations),
    checkDatabaseRole: (ds: DataSource, log: (line: string) => void) => hardenDatabaseRoleBeforeMigrations(ds, 'entrypoint', log),
    beforeMigrations: (ds: DataSource) => runDataAccessBeforeMigrations(ds, { log: quiet, warn: quiet }),
    // The real lock, from src/: the entrypoint loads its compiled copy from dist/.
    withMigrationLock,
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
async function apiRun(label: string, database: string, migrations: MigrationClass[]): Promise<Outcome> {
  const outcome: Outcome = { label, exits: [], executed: null, failure: null };
  const ds = dataSource(database, migrations);
  await ds.initialize();
  const runMigrations = ds.runMigrations.bind(ds);
  ds.runMigrations = async (options) => {
    const executed = await runMigrations(options);
    outcome.executed = executed.length;
    return executed;
  };
  try {
    await runStartupMigrations(ds, (connected) => runDataAccessBeforeMigrations(connected, { log: () => undefined, warn: () => undefined }));
  } catch (error) {
    outcome.failure = (error as Error)?.message || String(error);
  } finally {
    await ds.destroy();
  }
  return outcome;
}

async function migrationRows(database: string): Promise<{ total: number; distinct: number }> {
  return withClient(urlWith(APP_URL, { database }), async (client) => {
    const { rows } = await client.query('SELECT count(*)::int AS total, count(DISTINCT name)::int AS "distinct" FROM migrations');
    return rows[0];
  });
}

function check(name: string, outcomes: Outcome[], pending: number, rows: { total: number; distinct: number }, all: number): void {
  const report = JSON.stringify({ outcomes, rows });
  for (const outcome of outcomes) {
    assert.deepEqual(outcome.exits, [], `${name}: ${outcome.label} exits with no error (${report})`);
    assert.equal(outcome.failure, null, `${name}: ${outcome.label} reports no failure (${report})`);
  }
  assert.deepEqual(outcomes.map((o) => o.executed).sort(), [0, pending], `${name}: one run applies the ${pending} pending migration(s), the other none (${report})`);
  assert.deepEqual(rows, { total: all, distinct: all }, `${name}: every migration recorded once (${report})`);
}

/** A database one migration behind `chain`: a Job and an API that migrates, started together. */
async function oneBehind(name: string, chain: MigrationClass[]): Promise<void> {
  await createDatabase(BEHIND_DB);
  const previous = dataSource(BEHIND_DB, chain.slice(0, -1));
  await previous.initialize();
  await previous.runMigrations({ transaction: 'all' });
  await previous.destroy();
  const outcomes = await Promise.all([
    entrypointRun('the migration Job', BEHIND_DB, chain),
    apiRun('the API', BEHIND_DB, chain),
  ]);
  check(name, outcomes, 1, await migrationRows(BEHIND_DB), chain.length);
  await dropDatabase(BEHIND_DB);
  console.log(`  ${name}, a Job and an API at once: OK`);
}

async function main(): Promise<void> {
  const all = migrationClasses();
  assert.ok(all.length > 1, 'the migrations of the tree are found');
  // A migration that can run twice (it only dates records): without the lock both runs applied it
  // and `migrations` named it twice. The last migration of the chain, which creates a table, made
  // one of the two runs fail instead.
  const idempotent = all.findIndex((migration) => migration.name.endsWith('1856277000000'));
  assert.ok(idempotent > 0, 'the record dating migration is found');
  try {
    // 1. A database one migration behind.
    await oneBehind('behind by the last migration', all);
    await oneBehind('behind by a migration that can run twice', all.slice(0, idempotent + 1));

    // 2. An empty database: two pods of the migration Job at once.
    await createDatabase(EMPTY_DB);
    const empty = await Promise.all([
      entrypointRun('the first Job pod', EMPTY_DB, all),
      entrypointRun('the second Job pod', EMPTY_DB, all),
    ]);
    check('empty database', empty, all.length, await migrationRows(EMPTY_DB), all.length);
    console.log('  empty database, two Job pods at once: OK');
  } finally {
    await dropDatabase(BEHIND_DB).catch(() => undefined);
    await dropDatabase(EMPTY_DB).catch(() => undefined);
  }
  console.log(`${SPEC}: ok`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
