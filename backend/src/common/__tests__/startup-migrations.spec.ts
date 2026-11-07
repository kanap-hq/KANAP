import * as assert from 'node:assert/strict';
import { defer, lastValueFrom, type Observable } from 'rxjs';
import { QueryFailedError } from 'typeorm';
import { backendPath } from './backend-root';
import { isConnectionError } from '../database-connection-error';
import { hardenDatabaseRoleBeforeMigrations } from '../database-role-safety';

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

/** Runs the entrypoint's migration step with fakes; `exit` is recorded, never called for real. */
async function run(
  ds: FakeDataSource,
  env: Record<string, string | undefined> = {},
  beforeMigrations: (ds: FakeDataSource) => Promise<void> = async () => undefined,
) {
  const lines = { log: [] as string[], warn: [] as string[], error: [] as string[] };
  const exits: number[] = [];
  const sleeps: number[] = [];
  await entrypoint.runMigrationsIfNeeded({
    env: { MIGRATION_MAX_ATTEMPTS: '5', MIGRATION_RETRY_DELAY_MS: '7', ...env },
    loadDataSource: () => ds,
    // The real check, from src/: the entrypoint loads its compiled copy from dist/.
    checkDatabaseRole: (connected, log) => hardenDatabaseRoleBeforeMigrations(connected, 'entrypoint', log),
    beforeMigrations,
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
    const { lines, exits } = await run(ds);
    assert.deepEqual(statements, ['read role', 'migrate'], 'one read, no ALTER ROLE');
    assert.deepEqual(calls, { initialize: 1, runMigrations: 1, destroy: 1 });
    assert.deepEqual(exits, []);
    assert.ok(!lines.log.some((line) => line.includes('Hardening')), 'nothing to harden');
  }

  // 10. A protected role (postgres, pg_*) stops the start-up before any migration, not retried.
  for (const name of ['postgres', 'pg_monitor']) {
    const { ds, calls, statements } = fakeDataSource(0, async () => [{ name: 'A' }], { name, superuser: true, bypassRls: true });
    let guarded = false;
    const { lines, exits, sleeps } = await run(ds, {}, async () => { guarded = true; });
    assert.deepEqual(statements, ['read role'], `${name}: no ALTER ROLE, no migration`);
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
