import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { backendPath } from './backend-root';

// scripts/run-ci-tests.js (`npm run test:ci`) against a developer's `appdb`:
// the race specs refuse that database (their harness throws), so the runner
// leaves them out there, outside GitHub Actions, and says how to run them.
// GitHub Actions' `appdb` is a throwaway service container: they run there.
// It runs each spec from the output of `tsc -p tsconfig.ci.json`: the path it
// computes must match that config's outDir and rootDir.
// With `--db-lanes N` each lane runs on `<db>_<n>`, a throwaway copy where the
// races run too, and the specs that touch the whole server run alone.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runner = require(backendPath('scripts', 'run-ci-tests.js')) as {
  databaseName: (url?: string) => string | null;
  racesRefused: (url?: string) => boolean;
  RACE_SPEC: RegExp;
  compiledPath: (file: string) => string;
  laneUrl: (url: string, n: number) => string;
  exclusiveReason: (file: string) => string | null;
  EXCLUSIVE_PATTERNS: RegExp[];
};

function withEnv<T>(env: Record<string, string | undefined>, fn: () => T): T {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    return fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function testDatabaseName() {
  assert.equal(runner.databaseName('postgres://app:app@localhost:5432/appdb'), 'appdb');
  assert.equal(runner.databaseName('postgres://app:app@localhost:5432/appdb_races?sslmode=disable'), 'appdb_races');
  assert.equal(runner.databaseName(''), null);
  assert.equal(runner.databaseName('not a url'), null);
}

function testRacesRefused() {
  const appdb = 'postgres://app:app@localhost:5432/appdb';
  assert.equal(withEnv({ DATABASE_URL: appdb, GITHUB_ACTIONS: undefined }, runner.racesRefused), true, 'a developer appdb: left out');
  assert.equal(withEnv({ DATABASE_URL: appdb, GITHUB_ACTIONS: 'true' }, runner.racesRefused), false, 'CI: they run');
  assert.equal(
    withEnv({ DATABASE_URL: 'postgres://app:app@localhost:5432/appdb_races', GITHUB_ACTIONS: undefined }, runner.racesRefused),
    false,
    'a dedicated database: they run',
  );
}

function testRaceSpecPattern() {
  assert.ok(runner.RACE_SPEC.test('src/spend/__tests__/spend-versions-race.integration.spec.ts'));
  assert.ok(runner.RACE_SPEC.test('src/common/__tests__/request-lock-timeout-race.integration.spec.ts'));
  assert.equal(runner.RACE_SPEC.test('src/spend/__tests__/allocations-unique-key-migration.integration.spec.ts'), false);
  assert.equal(runner.RACE_SPEC.test('src/common/__tests__/request-transaction-bounds-http.integration.spec.ts'), false);
}

function testCompiledPath() {
  const config = JSON.parse(fs.readFileSync(backendPath('tsconfig.ci.json'), 'utf8'));
  assert.equal(config.compilerOptions.noEmit, false);
  assert.equal(config.compilerOptions.rootDir, '..', 'rootDir is the repository root: a spec imports a frontend module');
  const outDir = path.resolve(backendPath(), config.compilerOptions.outDir);
  const rootDir = path.resolve(backendPath(), config.compilerOptions.rootDir);
  for (const file of ['src/spend/__tests__/budget-summary.integration.spec.ts', 'scripts/rls-self-test.ts']) {
    const expected = path.join(outDir, path.relative(rootDir, backendPath(file))).replace(/\.ts$/, '.js');
    assert.equal(runner.compiledPath(file), expected, file);
  }
}

// Database lanes: each lane runs on `<db>_<n>`, a copy of the migrated database.
function testLaneUrl() {
  assert.equal(runner.laneUrl('postgres://app:app@127.0.0.1:5432/appdb', 2), 'postgres://app:app@127.0.0.1:5432/appdb_2');
  assert.equal(
    runner.laneUrl('postgres://app:app@localhost:5432/appdb_ci?sslmode=disable', 1),
    'postgres://app:app@localhost:5432/appdb_ci_1?sslmode=disable',
  );
  const lane = runner.laneUrl('postgres://app:app@localhost:5432/appdb', 1);
  assert.equal(withEnv({ GITHUB_ACTIONS: undefined }, () => runner.racesRefused(lane)), false, 'a lane copy is throwaway: the races run there');
  assert.equal(withEnv({ GITHUB_ACTIONS: undefined }, () => runner.racesRefused('postgres://app:app@localhost:5432/appdb')), true);
}

// Exclusive database specs: statements on state the whole server shares.
function testExclusivePatterns() {
  const exclusive = (source: string) => runner.EXCLUSIVE_PATTERNS.some((pattern) => pattern.test(source));
  const tick = '`';
  for (const source of [
    `await client.query(${tick}DROP DATABASE IF EXISTS scratch${tick})`,
    `await q(${tick}create role reader login${tick})`,
    `await q(${tick}ALTER ROLE app NOSUPERUSER${tick})`,
    `await q(${tick}ALTER SYSTEM SET fsync = off${tick})`,
    `await q(${tick}SELECT pg_reload_conf()${tick})`,
    `await q(${tick}CHECKPOINT${tick})`,
    `await q(${tick}SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1${tick})`,
    `await q(${tick}SELECT pg_stat_reset()${tick})`,
    `await q(${tick}SELECT count(*) FROM pg_stat_activity WHERE state = 'active'${tick})`,
    `await q(${tick}SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'${tick})`,
    `// @${'exclusive-db-spec'}: asserts on the load of the whole server`,
  ]) {
    assert.ok(exclusive(source), `exclusive: ${source}`);
  }
  for (const source of [
    `await q(${tick}SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1${tick})`,
    `await q(${tick}SELECT count(*) FROM pg_stat_activity\n WHERE datname = current_database() AND wait_event_type = 'Lock'${tick})`,
    `await q(${tick}SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'\n AND database = (SELECT oid FROM pg_database WHERE datname = current_database())${tick})`,
    `await q(${tick}SELECT pg_try_advisory_xact_lock(hashtext($1))${tick})`,
    `await q(${tick}ALTER TABLE spend_amounts SET (autovacuum_vacuum_scale_factor = 0.02)${tick})`,
    `await q(${tick}ANALYZE spend_amounts${tick})`,
    '// the user creates a draft, then the checkpoint of the import is kept',
  ]) {
    assert.equal(exclusive(source), false, `parallel: ${source}`);
  }
}

// A statement in a test helper (a `__tests__` file the spec imports) counts for the spec.
function testExclusiveReasonFollowsHelpers() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-ci-tests-'));
  try {
    const tests = path.join(dir, 'src', 'x', '__tests__');
    fs.mkdirSync(tests, { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'x', 'service.ts'), 'export const sql = `DROP DATABASE nope`;\n');
    fs.writeFileSync(path.join(tests, 'helper.ts'), 'export async function reset(q: any) { await q(`SELECT pg_stat_reset()`); }\n');
    fs.writeFileSync(path.join(tests, 'uses-helper.spec.ts'), "import { reset } from './helper';\n");
    fs.writeFileSync(path.join(tests, 'uses-service.spec.ts'), "import { sql } from '../service';\n");
    assert.match(runner.exclusiveReason(path.join(tests, 'uses-helper.spec.ts')) ?? '', /pg_stat_reset in .*helper\.ts$/);
    assert.equal(runner.exclusiveReason(path.join(tests, 'uses-service.spec.ts')), null, 'application code is not read: it takes the marker');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(runner.exclusiveReason('src/incidents/__tests__/incident-review-migration.spec.ts') ?? '', /DATABASE/);
  assert.equal(runner.exclusiveReason('src/admin/scheduled-tasks/__tests__/scheduled-tasks-lock.integration.spec.ts'), null);
}

testDatabaseName();
testRacesRefused();
testRaceSpecPattern();
testCompiledPath();
testLaneUrl();
testExclusivePatterns();
testExclusiveReasonFollowsHelpers();
console.log('run-ci-tests.script.spec: ok');
