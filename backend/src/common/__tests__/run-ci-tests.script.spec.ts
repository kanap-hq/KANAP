import * as assert from 'node:assert/strict';
import * as path from 'node:path';

// scripts/run-ci-tests.js (`npm run test:ci`) against a developer's `appdb`:
// the race specs refuse that database (their harness throws), so the runner
// leaves them out there, outside GitHub Actions, and says how to run them.
// GitHub Actions' `appdb` is a throwaway service container: they run there.

// eslint-disable-next-line @typescript-eslint/no-var-requires
const runner = require(path.resolve(__dirname, '../../../scripts/run-ci-tests.js')) as {
  databaseName: (url?: string) => string | null;
  racesRefused: () => boolean;
  RACE_SPEC: RegExp;
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

testDatabaseName();
testRacesRefused();
testRaceSpecPattern();
console.log('run-ci-tests.script.spec: ok');
