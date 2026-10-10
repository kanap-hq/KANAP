import * as assert from 'node:assert/strict';
import { backendPath } from './backend-root';

/**
 * The image entrypoint (`scripts/migrate-and-start.js`) retries the database connection while the
 * database is not ready or goes away, and nothing else: a migration that fails on its own exits at
 * once (code 1) with its message, never run again (plan planning/budget-unifie.md, G.13). Before,
 * every error was retried 30 times 2 s apart, a deterministic migration failure included, which
 * kept the API down for the length of 30 failing runs before the container restarted and did it
 * all again.
 */

type FakeDataSource = {
  isInitialized: boolean;
  initialize(): Promise<void>;
  runMigrations(): Promise<Array<{ name: string }>>;
  destroy(): Promise<void>;
};

type RunOptions = {
  env?: Record<string, string | undefined>;
  loadDataSource?: () => FakeDataSource;
  exit?: (code: number) => void;
  sleepFn?: (ms: number) => Promise<void>;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type Entrypoint = { runMigrationsIfNeeded(options?: RunOptions): Promise<void>; isConnectionError(err: unknown): boolean };

// Requiring the entrypoint starts nothing: it runs only as the main module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const entrypoint: Entrypoint = require(backendPath('scripts', 'migrate-and-start.js'));

/** A data source whose connection fails `connectFailures` times, then whose migrations answer `migrate` (given the run's number). */
function fakeDataSource(connectFailures: number, migrate: (run: number) => Promise<Array<{ name: string }>>) {
  const calls = { initialize: 0, runMigrations: 0, destroy: 0 };
  const ds: FakeDataSource = {
    isInitialized: false,
    async initialize() {
      calls.initialize += 1;
      if (calls.initialize <= connectFailures) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      ds.isInitialized = true;
    },
    async runMigrations() {
      calls.runMigrations += 1;
      return migrate(calls.runMigrations);
    },
    async destroy() {
      calls.destroy += 1;
      ds.isInitialized = false;
    },
  };
  return { ds, calls };
}

/** Runs the entrypoint's migration step with fakes; `exit` is recorded, never called for real. */
async function run(ds: FakeDataSource, env: Record<string, string | undefined> = {}) {
  const lines = { log: [] as string[], warn: [] as string[], error: [] as string[] };
  const exits: number[] = [];
  const sleeps: number[] = [];
  await entrypoint.runMigrationsIfNeeded({
    env: { MIGRATION_MAX_ATTEMPTS: '5', MIGRATION_RETRY_DELAY_MS: '7', ...env },
    loadDataSource: () => ds,
    exit: (code) => { exits.push(code); },
    sleepFn: async (ms) => { sleeps.push(ms); },
    log: (...args) => lines.log.push(args.map(String).join(' ')),
    warn: (...args) => lines.warn.push(args.map(String).join(' ')),
    error: (...args) => lines.error.push(args.map(String).join(' ')),
  });
  return { lines, exits, sleeps };
}

async function main(): Promise<void> {
  // 1. The database answers on the third try: two retries, then the migrations run once.
  {
    const { ds, calls } = fakeDataSource(2, async () => [{ name: 'A' }, { name: 'B' }]);
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(calls, { initialize: 3, runMigrations: 1, destroy: 1 }, 'connected on the third try, migrated once, closed');
    assert.deepEqual(exits, [], 'no exit');
    assert.deepEqual(sleeps, [7, 7], 'one wait per failed connection');
    assert.equal(lines.warn.filter((line) => line.startsWith('[entrypoint] DB not ready')).length, 2);
    assert.ok(lines.log.includes('[entrypoint] Migrations complete (2 executed).'));
  }

  // 2. A migration fails: no retry, exit 1 at once, with the migration's message and statement.
  {
    const failure = Object.assign(new Error('Tenant acme: 3 CAPEX lines have no equivalent'), {
      query: 'DO $$ BEGIN\n  RAISE EXCEPTION   ...\nEND $$',
    });
    const { ds, calls } = fakeDataSource(0, async () => { throw failure; });
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(calls, { initialize: 1, runMigrations: 1, destroy: 1 }, 'one run of the migrations, the connection closed');
    assert.deepEqual(exits, [1], 'exit code 1, once');
    assert.deepEqual(sleeps, [], 'no wait: nothing is retried');
    assert.equal(lines.error[0], '[entrypoint] A migration failed, not retried: Tenant acme: 3 CAPEX lines have no equivalent');
    assert.equal(lines.error[1], '[entrypoint] Failed statement: DO $$ BEGIN RAISE EXCEPTION ... END $$', 'the statement on one line');
    assert.match(lines.error[2], /rolled back: the database is as before this start/);
    assert.ok(!lines.log.some((line) => line.startsWith('[entrypoint] Migrations complete')), 'no success line');
  }

  // 3. The database never answers: MIGRATION_MAX_ATTEMPTS tries, then exit 1; no migration runs.
  {
    const { ds, calls } = fakeDataSource(Number.MAX_SAFE_INTEGER, async () => []);
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(calls, { initialize: 5, runMigrations: 0, destroy: 0 }, 'five tries, never migrated');
    assert.deepEqual(exits, [1]);
    assert.equal(sleeps.length, 4, 'a wait between two tries');
    assert.match(lines.error[0], /^\[entrypoint\] DB not ready after 5 attempts: connect ECONNREFUSED/);
  }

  // 4. The database goes away during the migrations (57P01, admin shutdown): nothing was applied
  //    (one transaction), so the connection is retried and the migrations run again.
  {
    const shutdown = Object.assign(new Error('terminating connection due to administrator command'), { driverError: { code: '57P01' } });
    const { ds, calls } = fakeDataSource(0, async (run) => {
      if (run === 1) throw shutdown;
      return [{ name: 'A' }];
    });
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(calls, { initialize: 2, runMigrations: 2, destroy: 2 }, 'reconnected and migrated again');
    assert.deepEqual(exits, [], 'no exit');
    assert.deepEqual(sleeps, [7]);
    assert.match(lines.warn[0], /^\[entrypoint\] DB connection lost during the migrations \(rolled back, nothing applied\) \(attempt 1\): terminating connection/);
    assert.ok(!lines.error.some((line) => line.includes('A migration failed')), 'not reported as a failed migration');
    assert.ok(lines.log.includes('[entrypoint] Migrations complete (1 executed).'));
  }

  // 5. The connection keeps dropping during the migrations: MIGRATION_MAX_ATTEMPTS runs, then exit 1.
  {
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const { ds, calls } = fakeDataSource(0, async () => { throw reset; });
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(calls, { initialize: 5, runMigrations: 5, destroy: 5 });
    assert.deepEqual(exits, [1]);
    assert.equal(sleeps.length, 4);
    assert.match(lines.error[0], /^\[entrypoint\] DB connection lost during the migrations \(rolled back, nothing applied\) after 5 attempts: read ECONNRESET/);
  }

  // 6. What counts as a lost connection.
  const connection = (code: string) => entrypoint.isConnectionError(Object.assign(new Error('x'), { code }));
  for (const code of ['ECONNRESET', 'ECONNREFUSED', '57P01', '57P03', '08006', '08001']) {
    assert.equal(connection(code), true, `${code} is a connection error`);
  }
  assert.equal(entrypoint.isConnectionError({ message: 'x', driverError: { code: '57P01' } }), true, 'a driver error TypeORM wraps');
  assert.equal(entrypoint.isConnectionError(new Error('Connection terminated unexpectedly')), true, 'node-postgres without a code');
  for (const code of ['23505', '42P01', '22012', 'P0001']) {
    assert.equal(connection(code), false, `${code} is a migration's own failure`);
  }
  assert.equal(entrypoint.isConnectionError(new Error('Tenant acme: 3 CAPEX lines have no equivalent')), false, 'a migration\'s own error');

  // 7. SKIP_MIGRATIONS=true: the data source is not even loaded.
  {
    let loaded = false;
    const exits: number[] = [];
    const logged: string[] = [];
    await entrypoint.runMigrationsIfNeeded({
      env: { SKIP_MIGRATIONS: 'true' },
      loadDataSource: () => { loaded = true; throw new Error('not expected'); },
      exit: (code) => { exits.push(code); },
      log: (...args) => logged.push(args.map(String).join(' ')),
    });
    assert.equal(loaded, false);
    assert.deepEqual(exits, []);
    assert.deepEqual(logged, ['[entrypoint] SKIP_MIGRATIONS=true → skipping DB migrations']);
  }

  console.log('startup-migrations.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
