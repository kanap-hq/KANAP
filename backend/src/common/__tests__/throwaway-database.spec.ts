import * as assert from 'node:assert/strict';
import { assertThrowawayConnection, assertThrowawayDatabase } from './throwaway-database';

// The guard of the throwaway-only specs and of the race specs: a developer's `appdb` is refused by
// its URL before any connection, then by the database the connection opened; every other database,
// and GitHub Actions' `appdb`, is accepted. A refused connection is closed.

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

function testUrl() {
  const refused = (url: string | undefined, ci?: string) => withEnv({ DATABASE_URL: url, GITHUB_ACTIONS: ci }, () => {
    try {
      assertThrowawayDatabase('spec');
      return false;
    } catch {
      return true;
    }
  });
  assert.equal(refused(undefined), true, 'no DATABASE_URL');
  assert.equal(refused('postgres://app:app@localhost:5432/appdb'), true, 'a developer appdb');
  assert.equal(refused('postgres://app:app@localhost:5432/appdb?sslmode=disable'), true, 'appdb with parameters');
  assert.equal(refused('postgres://app:app@localhost:5432/%61ppdb'), true, 'appdb encoded');
  assert.equal(refused('postgres://app:app@localhost:5432/appdb', 'true'), false, 'GitHub Actions');
  assert.equal(refused('postgres://app:app@localhost:5432/appdb_2'), false, 'a lane copy');
  assert.equal(refused('postgres://app:app@localhost:5432/appdb_ci'), false, 'a dedicated database');
}

async function testConnection() {
  const opened = (db: string | null) => {
    const source = { closed: false, query: async () => [{ db: db ?? undefined }], destroy: async () => { source.closed = true; } };
    return source;
  };
  const saved = process.env.GITHUB_ACTIONS;
  delete process.env.GITHUB_ACTIONS;
  try {
    // A URL that names another database than its path (a socket URL with `?db=appdb`) passes the
    // first check: the connection says where it is.
    const appdb = opened('appdb');
    await assert.rejects(() => assertThrowawayConnection(appdb, 'spec'), /never runs against appdb/);
    assert.equal(appdb.closed, true, 'a refused connection is closed');
    await assert.rejects(() => assertThrowawayConnection(opened(null), 'spec'), /names no database/);
    const lane = opened('appdb_3');
    await assertThrowawayConnection(lane, 'spec');
    assert.equal(lane.closed, false, 'an accepted connection stays open');
    process.env.GITHUB_ACTIONS = 'true';
    await assertThrowawayConnection(opened('appdb'), 'spec');
  } finally {
    if (saved === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = saved;
  }
}

testUrl();
testConnection().then(() => console.log('throwaway-database.spec: ok'), (error) => {
  console.error(error);
  process.exitCode = 1;
});
