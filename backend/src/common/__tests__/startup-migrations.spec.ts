import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { QueryFailedError } from 'typeorm';
import { backendPath } from './backend-root';
import { isConnectionError } from '../database-connection-error';
import { assertSafeDatabaseRoleAtStart, hardenDatabaseRoleBeforeMigrations } from '../database-role-safety';
import { migrationsSkipped } from '../skip-migrations';
import { NO_SCHEMA_LINE, warnPendingMigrations } from '../startup-migrations';

/**
 * The image entrypoint (`scripts/migrate-and-start.js`) retries the database connection while the
 * database is not ready or goes away, and nothing else: a migration that fails on its own exits at
 * once (code 1) with its message, never run again (plan planning/budget-unifie.md, G.13). Before,
 * every error was retried 30 times 2 s apart, a deterministic migration failure included, which
 * kept the API down for the length of 30 failing runs before the container restarted and did it
 * all again.
 *
 * The API's own start uses the same classification (`database-connection-error.ts`, passed as
 * `toRetry`). Nest would otherwise retry every error of the data source factory nine times,
 * three seconds apart.
 */

// Nest's retry of the data source factory. Not a public export: the package applies it to every
// error of the factory unless `toRetry` returns false.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { handleRetry } = require('@nestjs/typeorm/dist/common/typeorm.utils') as {
  handleRetry: (
    retryAttempts?: number,
    retryDelay?: number,
    dataSourceName?: string,
    verboseRetryLog?: boolean,
    toRetry?: (err: unknown) => boolean,
  ) => <T>(source: Observable<T>) => Observable<T>;
};

type FakeDataSource = {
  isInitialized: boolean;
  query(sql: string): Promise<any>;
  initialize(): Promise<void>;
  runMigrations(): Promise<Array<{ name: string }>>;
  destroy(): Promise<void>;
};

type RunOptions = {
  env?: Record<string, string | undefined>;
  loadDataSource?: () => FakeDataSource;
  checkDatabaseRole?: (ds: FakeDataSource, log: (line: string) => void) => Promise<unknown>;
  beforeMigrations?: (ds: FakeDataSource) => Promise<void>;
  withMigrationLock?: <T>(ds: FakeDataSource, fn: (lockConnection?: unknown) => Promise<T>, onWait?: () => void) => Promise<T>;
  runPendingMigrations?: (ds: FakeDataSource, lockConnection?: unknown) => Promise<Array<{ name: string }>>;
  exit?: (code: number) => void;
  sleepFn?: (ms: number) => Promise<void>;
  log?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type MigrateOnlyOptions = {
  env?: Record<string, string | undefined>;
  exit?: (code: number) => void;
  migrationOptions?: RunOptions;
  runRollout?: () => Promise<void>;
  strict?: boolean;
  log?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type Entrypoint = {
  runMigrationsIfNeeded(options?: RunOptions): Promise<void>;
  migrateOnly(options?: MigrateOnlyOptions): Promise<void>;
  isConnectionError(err: unknown): boolean;
  migrationsSkipped(env: Record<string, string | undefined>): boolean;
  stopOnSignals(options: { on: (signal: string, handler: () => void) => void; exit: (code: number) => void; error: (line: string) => void }): void;
};

// Requiring the entrypoint starts nothing: it runs only as the main module.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const entrypoint: Entrypoint = require(backendPath('scripts', 'migrate-and-start.js'));

type RoleState = { name: string; superuser: boolean; bypassRls: boolean; bootstrap?: boolean };

/**
 * A data source whose connection fails `connectFailures` times, then whose migrations answer
 * `migrate` (given the run's number). `query` plays PostgreSQL for the role check: it answers
 * `current_user`, `rolsuper` and `rolbypassrls` from `role`, and `ALTER ROLE` clears both flags
 * (or fails with `alterError`, after `onAlterError`). `statements` records every statement, in order with the migrations.
 */
function fakeDataSource(
  connectFailures: number,
  migrate: (run: number) => Promise<Array<{ name: string }>>,
  role: RoleState = { name: 'kanap', superuser: false, bypassRls: false },
  alterError?: Error,
  onAlterError: () => void = () => undefined,
) {
  const calls = { initialize: 0, runMigrations: 0, destroy: 0 };
  const statements: string[] = [];
  const alters: string[] = [];
  const ds: FakeDataSource = {
    isInitialized: false,
    async query(sql: string): Promise<any> {
      if (/ALTER ROLE %I NO(SUPERUSER|BYPASSRLS)/.test(sql)) {
        statements.push('alter role');
        alters.push(sql.match(/ALTER ROLE %I ([A-Z ]+)'/)![1]);
        if (alterError) {
          onAlterError();
          throw alterError;
        }
        role.superuser = false;
        role.bypassRls = false;
        return [];
      }
      if (/FROM pg_roles r\s+WHERE r\.rolname = current_user/.test(sql)) {
        statements.push('read role');
        return [{
          current_user: role.name,
          is_superuser: role.superuser ? 't' : 'f',
          can_bypass_rls: role.bypassRls,
          is_bootstrap_role: role.bootstrap === true,
        }];
      }
      throw new Error(`unexpected statement: ${sql}`);
    },
    async initialize() {
      calls.initialize += 1;
      if (calls.initialize <= connectFailures) throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
      ds.isInitialized = true;
    },
    async runMigrations() {
      calls.runMigrations += 1;
      statements.push('migrate');
      return migrate(calls.runMigrations);
    },
    async destroy() {
      calls.destroy += 1;
      ds.isInitialized = false;
    },
  };
  return { ds, calls, statements, alters };
}

const LOCK_CONNECTION = { lock: 'connection' };

/** Runs the entrypoint's migration step with fakes; `exit` is recorded, never called for real. */
async function run(
  ds: FakeDataSource,
  env: Record<string, string | undefined> = {},
  beforeMigrations: (ds: FakeDataSource) => Promise<void> = async () => undefined,
  lockTaken = false,
) {
  const lines = { log: [] as string[], warn: [] as string[], error: [] as string[] };
  const exits: number[] = [];
  const sleeps: number[] = [];
  const locks: string[] = [];
  await entrypoint.runMigrationsIfNeeded({
    env: { MIGRATION_MAX_ATTEMPTS: '5', MIGRATION_RETRY_DELAY_MS: '7', ...env },
    loadDataSource: () => ds,
    // The real check, from src/: the entrypoint loads its compiled copy from dist/.
    checkDatabaseRole: (connected, log) => hardenDatabaseRoleBeforeMigrations(connected, 'entrypoint', log),
    beforeMigrations,
    // The lock of the API's start (startup-migrations.ts), played here: taken on the connected
    // source (after a wait when `lockTaken`), released whatever the steps inside do. The
    // migrations run on the connection that holds it.
    withMigrationLock: async (connected, fn, onWait) => {
      locks.push(connected === ds && connected.isInitialized ? 'lock' : 'lock too early');
      if (lockTaken) onWait?.();
      try {
        return await fn(LOCK_CONNECTION);
      } finally {
        locks.push('unlock');
      }
    },
    runPendingMigrations: async (connected, lockConnection) => {
      if (lockConnection !== LOCK_CONNECTION) locks.push('migrate elsewhere');
      return connected.runMigrations();
    },
    exit: (code) => { exits.push(code); },
    sleepFn: async (ms) => { sleeps.push(ms); },
    log: (...args) => lines.log.push(args.map(String).join(' ')),
    warn: (...args) => lines.warn.push(args.map(String).join(' ')),
    error: (...args) => lines.error.push(args.map(String).join(' ')),
  });
  return { lines, exits, sleeps, locks };
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
    assert.match(lines.error[2], /rolled back: none of them is applied/);
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

  // 6. What counts as a lost connection. The entrypoint and the API start agree on every case.
  const migrationError = new QueryFailedError(
    'SELECT 1',
    [],
    Object.assign(new Error('relation "missing" does not exist'), { code: '42P01' }),
  );
  const refusedRole = new Error(
    '[migrations] DATABASE_URL resolves to protected PostgreSQL role "postgres" with SUPERUSER, BYPASSRLS.',
  );
  const droppedQuery = new QueryFailedError(
    'SELECT 1',
    [],
    Object.assign(new Error('connection failure'), { code: '08006' }),
  );
  const cases: Array<{ label: string; err: unknown; connection: boolean }> = [
    ...['ECONNRESET', 'ECONNREFUSED', '57P01', '57P03', '08006', '08001'].map((code) => ({
      label: `${code} is a connection error`,
      err: Object.assign(new Error('x'), { code }),
      connection: true,
    })),
    { label: 'a driver error TypeORM wraps', err: { message: 'x', driverError: { code: '57P01' } }, connection: true },
    { label: 'node-postgres without a code', err: new Error('Connection terminated unexpectedly'), connection: true },
    { label: 'a query whose connection dropped', err: droppedQuery, connection: true },
    ...['23505', '42P01', '22012', 'P0001'].map((code) => ({
      label: `${code} is a migration's own failure`,
      err: Object.assign(new Error('x'), { code }),
      connection: false,
    })),
    { label: 'a migration\'s own error', err: new Error('Tenant acme: 3 CAPEX lines have no equivalent'), connection: false },
    { label: 'a QueryFailedError 42P01', err: migrationError, connection: false },
    { label: 'a refused database role', err: refusedRole, connection: false },
  ];
  for (const { label, err, connection } of cases) {
    assert.equal(entrypoint.isConnectionError(err), connection, label);
    assert.equal(isConnectionError(err), entrypoint.isConnectionError(err), `${label}: the API and the entrypoint agree`);
    assert.equal(isConnectionError(err), connection, `${label} (API)`);
  }

  // 6b. Nest retries the factory nine times unless toRetry returns false. A migration error and a
  // refused role stop at once; a lost connection is retried. The delay here is 1 ms (Nest's own
  // default is 3 s): the attempt count is what the start waits on. Nest logs each retry on stderr.
  const stderrWrite = process.stderr.write;
  process.stderr.write = (() => true) as typeof process.stderr.write;
  try {
    const attemptsOf = async (err: unknown, toRetry?: (error: unknown) => boolean) => {
      let attempts = 0;
      let thrown: unknown;
      try {
        await lastValueFrom(defer(() => {
          attempts += 1;
          return Promise.reject(err);
        }).pipe(handleRetry(9, 1, 'default', false, toRetry)));
      } catch (error) {
        thrown = error;
      }
      return { attempts, thrown };
    };

    const bare = await attemptsOf(migrationError);
    assert.equal(bare.attempts, 9, 'without toRetry, Nest retries a migration error nine times');

    const failed = await attemptsOf(migrationError, isConnectionError);
    assert.equal(failed.attempts, 1, 'a QueryFailedError 42P01 is not retried');
    assert.equal(failed.thrown, migrationError, 'the migration error is the one that stops the start');

    const role = await attemptsOf(refusedRole, isConnectionError);
    assert.equal(role.attempts, 1, 'a refused database role is not retried');
    assert.equal(role.thrown, refusedRole);

    let connects = 0;
    const up = await lastValueFrom(defer(() => {
      connects += 1;
      if (connects < 3) return Promise.reject(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
      return Promise.resolve('up');
    }).pipe(handleRetry(9, 1, 'default', false, isConnectionError)));
    assert.equal(up, 'up');
    assert.equal(connects, 3, 'a lost connection is retried until the database answers');
  } finally {
    process.stderr.write = stderrWrite;
  }

  // 8. The data-access guard runs on the connected data source, before the migrations (an
  // application role that inherits the limited role must not migrate under its policies).
  {
    const order: string[] = [];
    const { ds } = fakeDataSource(0, async () => { order.push('migrate'); return []; });
    const { exits } = await run(ds, {}, async (connected) => {
      order.push(connected === ds && connected.isInitialized ? 'guard on the connected source' : 'guard too early');
    });
    assert.deepEqual(order, ['guard on the connected source', 'migrate']);
    assert.deepEqual(exits, []);
  }

  // 9. A safe role: one read of the role, nothing else, then the migrations.
  {
    const { ds, calls, statements } = fakeDataSource(0, async () => [{ name: 'A' }]);
    const { lines, exits, locks } = await run(ds);
    assert.deepEqual(statements, ['read role', 'migrate'], 'one read, no ALTER ROLE');
    assert.deepEqual(locks, ['lock', 'unlock'], 'the role check and the migrations run under the migration lock');
    assert.deepEqual(calls, { initialize: 1, runMigrations: 1, destroy: 1 });
    assert.deepEqual(exits, []);
    assert.ok(!lines.log.some((line) => line.includes('Hardening')), 'nothing to harden');
  }

  // 10. A protected role (postgres, pg_*) stops the start-up before any migration, not retried.
  for (const name of ['postgres', 'pg_monitor']) {
    const { ds, calls, statements } = fakeDataSource(0, async () => [{ name: 'A' }], { name, superuser: true, bypassRls: true });
    let guarded = false;
    const { lines, exits, sleeps, locks } = await run(ds, {}, async () => { guarded = true; });
    assert.deepEqual(statements, ['read role'], `${name}: no ALTER ROLE, no migration`);
    assert.deepEqual(locks, ['lock', 'unlock'], `${name}: the lock is released`);
    assert.deepEqual(calls, { initialize: 1, runMigrations: 0, destroy: 1 }, `${name}: the connection closed`);
    assert.equal(guarded, false, `${name}: the data-access guard does not run either`);
    assert.deepEqual(exits, [1]);
    assert.deepEqual(sleeps, [], 'not retried');
    assert.match(lines.error[0], new RegExp(`^\\[entrypoint\\] DATABASE_URL resolves to protected PostgreSQL role "${name}" with SUPERUSER, BYPASSRLS\\.`));
    assert.match(lines.error[0], /Create a dedicated application role without SUPERUSER or BYPASSRLS, point DATABASE_URL to it and restart/);
    assert.equal(lines.error[1], '[entrypoint] No migration ran.');
  }

  // 11. Another role with SUPERUSER or BYPASSRLS: ALTER ROLE before the data-access guard and the
  //     migrations, which then run under the hardened role.
  for (const flags of [{ superuser: true, bypassRls: false }, { superuser: false, bypassRls: true }, { superuser: true, bypassRls: true }]) {
    const role = { name: 'kanap', ...flags };
    const { ds, statements, alters } = fakeDataSource(0, async () => {
      assert.deepEqual(role, { name: 'kanap', superuser: false, bypassRls: false }, 'the migrations run under the hardened role');
      return [{ name: 'A' }];
    }, role);
    const { lines, exits } = await run(ds, {}, async () => { statements.push('guard'); });
    assert.deepEqual(statements, ['read role', 'alter role', 'read role', 'guard', 'migrate']);
    assert.deepEqual(alters, [[flags.superuser ? 'NOSUPERUSER' : '', flags.bypassRls ? 'NOBYPASSRLS' : ''].filter(Boolean).join(' ')], 'only the attributes the role has');
    assert.deepEqual(exits, []);
    assert.ok(lines.log.some((line) => /^\[entrypoint\] Hardening PostgreSQL role "kanap" from .+ to NOSUPERUSER NOBYPASSRLS before the migrations$/.test(line)));
    assert.ok(lines.log.includes('[entrypoint] Migrations complete (1 executed).'));
  }

  // 12. PostgreSQL refuses ALTER ROLE (a BYPASSRLS role that is not superuser, the bootstrap
  //     role): the start-up stops before any migration and says what to run instead.
  {
    const refused = Object.assign(new Error('permission denied to alter role'), {
      code: '42501',
      detail: 'Only roles with the SUPERUSER attribute may change the BYPASSRLS attribute.',
    });
    const { ds, calls, statements } = fakeDataSource(0, async () => [], { name: 'kanap', superuser: false, bypassRls: true }, refused);
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(statements, ['read role', 'alter role', 'read role'], 'read again after the refusal: still unsafe');
    assert.equal(calls.runMigrations, 0);
    assert.deepEqual(exits, [1]);
    assert.deepEqual(sleeps, []);
    assert.match(lines.error[0], /could not remove these attributes \(permission denied to alter role Only roles with the SUPERUSER attribute/);
    assert.match(lines.error[0], /run ALTER ROLE "kanap" NOSUPERUSER NOBYPASSRLS and restart/);
  }

  // 13. The connection drops during the role check: retried like any lost connection.
  {
    let reads = 0;
    const { ds, calls } = fakeDataSource(0, async () => [{ name: 'A' }]);
    const query = ds.query.bind(ds);
    ds.query = async (sql: string): Promise<any> => {
      reads += 1;
      if (reads === 1) throw Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
      return query(sql);
    };
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(calls, { initialize: 2, runMigrations: 1, destroy: 2 });
    assert.deepEqual(exits, []);
    assert.deepEqual(sleeps, [7]);
    assert.match(lines.warn[0], /^\[entrypoint\] DB not ready \(attempt 1\): read ECONNRESET/);
  }

  // 14. The bootstrap role (the one that created the cluster, POSTGRES_USER of the Docker image) is
  //     protected whatever its name: PostgreSQL never lets it drop SUPERUSER.
  {
    const { ds, calls, statements } = fakeDataSource(0, async () => [], { name: 'kanap', superuser: true, bypassRls: true, bootstrap: true });
    const { lines, exits } = await run(ds);
    assert.deepEqual(statements, ['read role'], 'no ALTER ROLE on the bootstrap role');
    assert.equal(calls.runMigrations, 0);
    assert.deepEqual(exits, [1]);
    assert.match(lines.error[0], /protected PostgreSQL role "kanap" with SUPERUSER, BYPASSRLS\. .*Create a dedicated application role/);
  }

  // 15. Two starts at once: the other one hardened the role first, so this ALTER ROLE is refused
  //     (the role is no longer superuser). The role is safe: the migrations run.
  {
    const role = { name: 'kanap', superuser: true, bypassRls: false };
    const refused = Object.assign(new Error('permission denied to alter role'), { code: '42501' });
    const { ds, statements } = fakeDataSource(0, async () => [{ name: 'A' }], role, refused, () => { role.superuser = false; });
    const { lines, exits } = await run(ds);
    assert.deepEqual(statements, ['read role', 'alter role', 'read role', 'migrate']);
    assert.deepEqual(exits, []);
    assert.ok(lines.log.includes('[entrypoint] PostgreSQL role "kanap" is ready for native RLS enforcement'));
  }

  // 16. The connection drops during ALTER ROLE: retried like any lost connection, then hardened.
  {
    const role = { name: 'kanap', superuser: true, bypassRls: false };
    const reset = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    let alters = 0;
    const { ds, calls } = fakeDataSource(0, async () => [{ name: 'A' }], role);
    const query = ds.query.bind(ds);
    ds.query = async (sql: string): Promise<any> => {
      if (/ALTER ROLE/.test(sql) && ++alters === 1) throw reset;
      return query(sql);
    };
    const { lines, exits, sleeps } = await run(ds);
    assert.deepEqual(calls, { initialize: 2, runMigrations: 1, destroy: 2 }, 'reconnected, hardened, migrated');
    assert.deepEqual(exits, []);
    assert.deepEqual(sleeps, [7]);
    assert.ok(lines.warn.some((line) => line.startsWith('[entrypoint] DB not ready (attempt 1)')));
    assert.deepEqual(role, { name: 'kanap', superuser: false, bypassRls: false });
  }

  // 7. SKIP_MIGRATIONS on (`true`, `1`, `yes`, `y`, `on`, any case, spaces ignored): the data
  //    source is not even loaded. The API reads the variable with the same rule.
  const skipValues: Array<[string | undefined, boolean]> = [
    ['true', true], ['TRUE', true], [' true ', true], ['1', true], ['yes', true], ['Y', true], ['on', true],
    [undefined, false], ['', false], ['false', false], ['0', false], ['no', false], ['off', false], ['enabled', false],
  ];
  for (const [value, skipped] of skipValues) {
    const env = { SKIP_MIGRATIONS: value };
    assert.equal(entrypoint.migrationsSkipped(env), skipped, `SKIP_MIGRATIONS=${JSON.stringify(value)} (entrypoint)`);
    assert.equal(migrationsSkipped(env), skipped, `SKIP_MIGRATIONS=${JSON.stringify(value)} (API)`);
    let loaded = false;
    const exits: number[] = [];
    const logged: string[] = [];
    await entrypoint.runMigrationsIfNeeded({
      env,
      loadDataSource: () => { loaded = true; return fakeDataSource(0, async () => []).ds; },
      checkDatabaseRole: async () => undefined,
      beforeMigrations: async () => undefined,
      withMigrationLock: async (_connected, fn) => fn(),
      runPendingMigrations: async (connected) => connected.runMigrations(),
      exit: (code) => { exits.push(code); },
      sleepFn: async () => undefined,
      log: (...args) => logged.push(args.map(String).join(' ')),
      warn: () => undefined,
      error: () => undefined,
    });
    if (skipped) {
      assert.equal(loaded, false, `${JSON.stringify(value)}: the data source is not loaded`);
      assert.deepEqual(exits, []);
      assert.deepEqual(logged, ['[entrypoint] SKIP_MIGRATIONS=true → skipping DB migrations']);
    } else {
      assert.equal(loaded, true, `${JSON.stringify(value)}: the migrations run`);
      assert.deepEqual(exits, []);
    }
  }

  // 7b. --migrate-only: the migration step, then exit 0; nothing of the API is loaded.
  const migrateOnly = async (options: MigrateOnlyOptions & { ds?: FakeDataSource }) => {
    const exits: number[] = [];
    const lines = { log: [] as string[], error: [] as string[] };
    let rollouts = 0;
    await entrypoint.migrateOnly({
      env: { MIGRATION_MAX_ATTEMPTS: '2', MIGRATION_RETRY_DELAY_MS: '1' },
      runRollout: async () => { rollouts += 1; },
      strict: false,
      ...options,
      exit: (code) => { exits.push(code); },
      log: (...args) => lines.log.push(args.map(String).join(' ')),
      error: (...args) => lines.error.push(args.map(String).join(' ')),
      migrationOptions: options.ds ? {
        loadDataSource: () => options.ds as FakeDataSource,
        checkDatabaseRole: (connected, log) => hardenDatabaseRoleBeforeMigrations(connected as any, 'entrypoint', log),
        beforeMigrations: async () => undefined,
        withMigrationLock: async (_connected, fn) => fn(),
        runPendingMigrations: async (connected) => connected.runMigrations(),
        sleepFn: async () => undefined,
        log: (...args) => lines.log.push(args.map(String).join(' ')),
        warn: () => undefined,
        error: (...args) => lines.error.push(args.map(String).join(' ')),
      } : {},
    });
    return { exits, lines, rollouts };
  };
  {
    const { ds, calls } = fakeDataSource(1, async () => [{ name: 'A' }]);
    const { exits, lines, rollouts } = await migrateOnly({ ds });
    assert.deepEqual(calls, { initialize: 2, runMigrations: 1, destroy: 1 }, 'the connection is retried, the migrations run once, closed');
    assert.equal(rollouts, 1, 'the integrated-doc repair runs after the migrations');
    assert.deepEqual(exits, [0], 'exit 0');
    assert.ok(lines.log.includes('[entrypoint] Migrations complete (1 executed).'));
    assert.equal(lines.log[lines.log.length - 1], '[entrypoint] Migration step complete (--migrate-only): exiting without starting the API.');
  }
  // A protected role: exit 1, no migration, no repair.
  {
    const { ds, calls } = fakeDataSource(0, async () => [{ name: 'A' }], { name: 'postgres', superuser: true, bypassRls: true });
    const { exits, lines, rollouts } = await migrateOnly({ ds });
    assert.equal(calls.runMigrations, 0);
    assert.equal(rollouts, 0);
    assert.deepEqual(exits, [1], 'exit 1, once');
    assert.equal(lines.error[1], '[entrypoint] No migration ran.');
  }
  // A failed migration: exit 1, no repair.
  {
    const { ds } = fakeDataSource(0, async () => { throw new Error('boom'); });
    const { exits, rollouts } = await migrateOnly({ ds });
    assert.deepEqual(exits, [1]);
    assert.equal(rollouts, 0);
  }
  // The repair fails: not strict, one error line and exit 0; strict, exit 1.
  for (const strict of [false, true]) {
    const { ds } = fakeDataSource(0, async () => []);
    const { exits, lines } = await migrateOnly({ ds, strict, runRollout: async () => { throw new Error('lock refused'); } });
    assert.deepEqual(exits, [strict ? 1 : 0], `strict=${strict}`);
    assert.match(lines.error[0], strict ? /^\[entrypoint\] Integrated-doc rollout: lock refused$/ : /the rollout check step failed \(lock refused\)/);
  }
  // SKIP_MIGRATIONS on with the argument: exit 2 and one line, nothing loaded.
  {
    let loaded = false;
    const { exits, lines, rollouts } = await migrateOnly({
      env: { SKIP_MIGRATIONS: 'yes' },
      migrationOptions: { loadDataSource: () => { loaded = true; throw new Error('loaded'); } },
    });
    assert.deepEqual(exits, [2]);
    assert.equal(loaded, false);
    assert.equal(rollouts, 0);
    assert.deepEqual(lines.error, ['[entrypoint] --migrate-only with SKIP_MIGRATIONS on: no migration ran. Unset SKIP_MIGRATIONS for the migration step.']);
  }
  // The real script, as the image starts it: the argument is read before anything else.
  {
    const result = spawnSync(process.execPath, [backendPath('scripts', 'migrate-and-start.js'), '--migrate-only'], {
      env: { PATH: process.env.PATH, SKIP_MIGRATIONS: 'true' },
      encoding: 'utf8',
      timeout: 30_000,
    });
    assert.equal(result.status, 2, `the script exits 2 (${result.stderr})`);
    assert.match(result.stderr, /--migrate-only with SKIP_MIGRATIONS on: no migration ran/);
    const packageJson = JSON.parse(readFileSync(backendPath('package.json'), 'utf8'));
    assert.equal(packageJson.scripts.migrate, 'node ./scripts/migrate-and-start.js --migrate-only', 'npm run migrate');
  }

  // 8. Another run holds the migration lock: one line says so before the wait, then the
  //    migrations run on the connection that holds the lock.
  {
    const { ds, calls } = fakeDataSource(0, async () => []);
    const { lines, exits, locks } = await run(ds, {}, async () => undefined, true);
    assert.deepEqual(exits, []);
    assert.deepEqual(locks, ['lock', 'unlock'], 'the migrations ran on the lock connection');
    assert.equal(calls.runMigrations, 1);
    assert.deepEqual(lines.log.filter((line) => /migration lock/.test(line)), ['[entrypoint] Another instance holds the migration lock, waiting...']);
    assert.ok(lines.log.indexOf('[entrypoint] Another instance holds the migration lock, waiting...') < lines.log.indexOf('[entrypoint] DB initialized. Running migrations...'));
  }

  // 9. --migrate-only stops on SIGTERM (143) and SIGINT (130), with one line each.
  {
    const handlers = new Map<string, () => void>();
    const exits: number[] = [];
    const errors: string[] = [];
    entrypoint.stopOnSignals({ on: (signal, handler) => { handlers.set(signal, handler); }, exit: (code) => { exits.push(code); }, error: (line) => { errors.push(line); } });
    assert.deepEqual([...handlers.keys()], ['SIGTERM', 'SIGINT']);
    handlers.get('SIGTERM')!();
    handlers.get('SIGINT')!();
    assert.deepEqual(exits, [143, 130]);
    assert.equal(errors.length, 2);
    assert.match(errors[0], /^\[entrypoint\] SIGTERM received during the migration step: stopping \(exit 143\)/);
    const script = readFileSync(backendPath('scripts', 'migrate-and-start.js'), 'utf8');
    assert.match(script, /if \(argv\.includes\('--migrate-only'\)\) \{\n {4}stopOnSignals\(\);/, 'installed for --migrate-only');
    assert.equal((script.match(/stopOnSignals\(\);/g) || []).length, 1, 'and for that mode only');
  }

  // 10. The API started with SKIP_MIGRATIONS (app.module.ts, every process; warnPendingMigrations).
  {
    const start = async (counts: { executed: number; pending: number } | Error, workers: number) => {
      const lines: string[] = [];
      const exits: number[] = [];
      const processes = workers === 1 ? [{}] : Array.from({ length: workers }, (_, i) => ({ KANAP_WORKER_ID: String(i + 1), KANAP_WORKER_COUNT: String(workers) }));
      for (const env of processes) {
        await warnPendingMigrations({} as never, {
          env,
          warn: (line) => lines.push(`warn ${line}`),
          error: (line) => lines.push(`error ${line}`),
          exit: (code) => { exits.push(code); },
          readMigrations: async () => { if (counts instanceof Error) throw counts; return counts; },
        });
      }
      return { lines, exits };
    };
    for (const workers of [1, 2, 4]) {
      // A database no migration ever ran on: one named line, every process exits 1.
      const empty = await start({ executed: 0, pending: 419 }, workers);
      assert.deepEqual(empty.lines, [`error ${NO_SCHEMA_LINE}`], `${workers} process(es), no schema: one line`);
      assert.deepEqual(empty.exits, Array(workers).fill(1), `${workers} process(es), no schema: each exits 1`);
      // A database behind: one warning whatever the number of workers, and the start goes on.
      const behind = await start({ executed: 418, pending: 1 }, workers);
      assert.deepEqual(behind.lines, ['warn [migrations] SKIP_MIGRATIONS is on and 1 migration(s) are pending: run the migration step (node scripts/migrate-and-start.js --migrate-only) first. Until it has run, /health/ready answers 503.'], `${workers} process(es), behind`);
      assert.deepEqual(behind.exits, []);
      const current = await start({ executed: 419, pending: 0 }, workers);
      assert.deepEqual([current.lines, current.exits], [[], []], `${workers} process(es), up to date`);
      const unreadable = await start(new Error('permission denied'), workers);
      assert.equal(unreadable.lines.length, 1, `${workers} process(es), unreadable: one warning`);
      assert.deepEqual(unreadable.exits, []);
    }
    assert.match(NO_SCHEMA_LINE, /^\[migrations\] SKIP_MIGRATIONS is on and the database has no schema/);
  }

  // 11. The API's role check at start (main.ts, every process; assertSafeDatabaseRoleAtStart). With
  // SKIP_MIGRATIONS on nothing hardened the role before: a role with SUPERUSER or BYPASSRLS stops
  // each process with exit 1 and its refusal on one line, written by the lead process; any other
  // error is thrown as it is.
  {
    const role = (name: string, flags: { superuser?: boolean; bypass?: boolean; bootstrap?: boolean } = {}) => ({
      query: async () => [{ current_user: name, is_superuser: flags.superuser ?? false, can_bypass_rls: flags.bypass ?? false, is_bootstrap_role: flags.bootstrap ?? false }],
    });
    const start = async (executor: { query(sql: string): Promise<any> }, workers: number) => {
      const lines: string[] = [];
      const exits: number[] = [];
      const outcomes: unknown[] = [];
      const processes = workers === 1 ? [{}] : Array.from({ length: workers }, (_, i) => ({ KANAP_WORKER_ID: String(i + 1), KANAP_WORKER_COUNT: String(workers) }));
      for (const env of processes) {
        await assertSafeDatabaseRoleAtStart(executor, { env, error: (line) => lines.push(line), exit: (code) => { exits.push(code); } })
          .then((state) => outcomes.push(state.currentUser), (failure) => outcomes.push(failure));
      }
      return { lines, exits, outcomes };
    };
    for (const workers of [1, 2, 4]) {
      const bypass = await start(role('kanap', { bypass: true }), workers);
      assert.equal(bypass.lines.length, 1, `${workers} process(es), BYPASSRLS: one line`);
      assert.match(bypass.lines[0], /^\[startup\] DATABASE_URL resolves to PostgreSQL role "kanap" with BYPASSRLS\. This bypasses tenant isolation\. Remove these attributes as a PostgreSQL superuser \(ALTER ROLE "kanap" NOSUPERUSER NOBYPASSRLS\)/);
      assert.ok(!bypass.lines[0].includes('\n'), 'the refusal is one line');
      assert.deepEqual(bypass.exits, Array(workers).fill(1), `${workers} process(es), BYPASSRLS: each exits 1`);
      const protectedRole = await start(role('postgres', { superuser: true, bypass: true, bootstrap: true }), workers);
      assert.equal(protectedRole.lines.length, 1, `${workers} process(es), protected role: one line`);
      assert.match(protectedRole.lines[0], /^\[startup\] DATABASE_URL resolves to protected PostgreSQL role "postgres" with SUPERUSER, BYPASSRLS\./);
      assert.deepEqual(protectedRole.exits, Array(workers).fill(1), `${workers} process(es), protected role: each exits 1`);
      const safe = await start(role('kanap'), workers);
      assert.deepEqual([safe.lines, safe.exits, safe.outcomes], [[], [], Array(workers).fill('kanap')], `${workers} process(es), safe role`);
    }
    const refused = new Error('connect ECONNREFUSED 127.0.0.1:5432');
    const unreadable = await start({ query: async () => { throw refused; } }, 2);
    assert.deepEqual([unreadable.lines, unreadable.exits, unreadable.outcomes], [[], [], [refused, refused]], 'another error is thrown as it is');
    const main = readFileSync(backendPath('src', 'main.ts'), 'utf8');
    assert.match(main, /const roleState = await assertSafeDatabaseRoleAtStart\(ds\);/, 'main.ts checks the role through it');
    assert.doesNotMatch(main, /assertSafeDatabaseRole\(/, 'and nowhere else');
  }

  console.log('startup-migrations.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
