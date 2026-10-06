import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { backendPath } from './backend-root';

// scripts/run-ci-tests.js (`npm run test:ci`) against a developer's `appdb`:
// the race specs refuse that database (their harness throws), so the runner
// leaves them out there, outside GitHub Actions, and says how to run them.
// GitHub Actions' `appdb` is a throwaway service container: they run there.
// It runs each spec from the output of `tsc -p tsconfig.ci.json`: the path it
// computes must match that config's outDir and rootDir.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runner = require(backendPath('scripts', 'run-ci-tests.js')) as {
  databaseName: (url?: string) => string | null;
  racesRefused: () => boolean;
  RACE_SPEC: RegExp;
  compiledPath: (file: string) => string;
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

testDatabaseName();
testRacesRefused();
testRaceSpecPattern();
testCompiledPath();
console.log('run-ci-tests.script.spec: ok');
