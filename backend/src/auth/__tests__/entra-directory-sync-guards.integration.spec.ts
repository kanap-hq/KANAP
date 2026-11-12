import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { EntraDirectorySyncService } from '../entra-directory-sync.service';

// The Microsoft directory sync of a workspace:
// - keeps the workspace's last enabled Administrator: a sync that would disable them (removed from
//   the directory, or deactivated there) leaves the account as it is and names it in its report
//   (the result and the stored sync status). With another enabled Administrator, the account is
//   disabled; a disabled Administrator does not count.
// - runs once at a time per workspace: a second run while one is in progress does nothing and
//   says so (`already_running`), without waiting. Two workspaces sync at the same time.
// - works on the connection that holds its lock: it runs in the smallest pool (DB_POOL_MAX=2)
//   while the caller holds the other connection (the scheduler's lock, a request's transaction),
//   and a run whose connection is lost fails, so the work is done once.
// - counts only the accounts it disables itself.
// Microsoft is replaced by a fake directory; the database is real, with the smallest pool.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'directory-sync-guards-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
process.env.DB_POOL_MAX = '2';
process.env.DB_POOL_CONNECTION_TIMEOUT = '4000';

type DirectoryEntry = { accountEnabled: boolean } | undefined;

/** A fake Microsoft directory: profiles by object id, and an optional gate that holds the reads. */
class FakeDirectory {
  entries = new Map<string, DirectoryEntry>();
  gate: Promise<void> | null = null;
  reads = 0;

  acquireAppToken = async () => 'token';
  probeDirectoryAccess = async () => undefined;
  invalidateAppToken = () => undefined;
  isConsentError = () => false;
  fetchDirectoryUsers = async (_token: string, ids: string[]) => {
    this.reads += 1;
    // The gate holds one read only.
    const gate = this.gate;
    this.gate = null;
    if (gate) await gate;
    return ids
      .map((id) => ({ id, entry: this.entries.get(id) }))
      .filter(({ entry }) => !!entry)
      .map(({ id, entry }) => ({ id, accountEnabled: entry!.accountEnabled, givenName: null, surname: null }));
  };
}

type Workspace = {
  tenantId: string;
  adminRole: string;
  contactRole: string;
  user: (key: string, opts: { admin: boolean; status?: string; entra?: boolean; viaExtraRole?: boolean }) => Promise<string>;
};

const created: string[] = [];

async function workspace(dataSource: DataSource): Promise<Workspace> {
  const tenantId = randomUUID();
  const slug = `dir-sync-${tenantId.slice(0, 8)}`;
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, sso_enabled, entra_tenant_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, 'entra', true, $4, now(), now())`,
    [tenantId, slug, slug, randomUUID()],
  );
  created.push(tenantId);
  const roles = await withTenantExecution(dataSource, tenantId, async (manager) => {
    const role = async (name: string, permissions: Record<string, string>) => {
      const [row] = await manager.query(
        `INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, $2, true) RETURNING id`,
        [tenantId, name],
      );
      for (const [resource, level] of Object.entries(permissions)) {
        await manager.query(
          `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`,
          [tenantId, row.id, resource, level],
        );
      }
      return row.id as string;
    };
    return { adminRole: await role('Administrator', { users: 'admin' }), contactRole: await role('Contact', {}) };
  });
  const user: Workspace['user'] = (key, opts) =>
    withTenantExecution(dataSource, tenantId, async (manager) => {
      const mainRole = opts.admin && !opts.viaExtraRole ? roles.adminRole : roles.contactRole;
      const [row] = await manager.query(
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, external_auth_provider, external_subject)
         VALUES ($1, $2, $3, 'Tester', $4, $5, $6, $7) RETURNING id`,
        [
          tenantId,
          `${key}-${tenantId.slice(0, 8)}@example.test`,
          key,
          mainRole,
          opts.status ?? 'enabled',
          opts.entra === false ? null : 'entra',
          opts.entra === false ? null : `oid-${key}`,
        ],
      );
      await manager.query(
        `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`,
        [tenantId, row.id, mainRole],
      );
      if (opts.viaExtraRole) {
        await manager.query(
          `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`,
          [tenantId, row.id, roles.adminRole],
        );
      }
      return row.id as string;
    });
  return { tenantId, ...roles, user };
}

async function statusOf(dataSource: DataSource, tenantId: string, userId: string): Promise<string> {
  return withTenantExecution(dataSource, tenantId, async (manager) => {
    const [row] = await manager.query(`SELECT status FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, userId]);
    return row?.status;
  });
}

async function storedSyncStatus(dataSource: DataSource, tenantId: string): Promise<Record<string, any> | null> {
  const [row] = await dataSource.query(`SELECT entra_metadata FROM tenants WHERE id = $1`, [tenantId]);
  return row?.entra_metadata?.directory_sync ?? null;
}

/** The last enabled Administrator, removed from the directory, is kept and named. Others go. */
async function testRemovedLastAdministratorIsKept(sync: EntraDirectorySyncService, _dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  const admin = await w.user('alice', { admin: true });
  const leaver = await w.user('bob', { admin: false });
  // Neither is in the directory any more.
  const result = await sync.syncTenant(w.tenantId);
  assert.equal(result.status, 'ok');
  assert.equal(await statusOf(ds, w.tenantId, admin), 'enabled', 'the last Administrator stays enabled');
  assert.equal(await statusOf(ds, w.tenantId, leaver), 'disabled', 'another removed account is disabled');
  assert.equal(result.removed, 1, 'only the disabled account is counted');
  assert.equal((result as any).kept_administrator, 'alice Tester', 'the report names the kept account');
  assert.equal((await storedSyncStatus(ds, w.tenantId))?.kept_administrator, 'alice Tester', 'the stored status names it too');
}

/** Deactivated in the directory, through an extra role: kept too. */
async function testDeactivatedLastAdministratorIsKept(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  const admin = await w.user('carol', { admin: true, viaExtraRole: true });
  dir.entries.set('oid-carol', { accountEnabled: false });
  const result = await sync.syncTenant(w.tenantId);
  assert.equal(result.status, 'ok');
  assert.equal(await statusOf(ds, w.tenantId, admin), 'enabled');
  assert.equal(result.disabled, 0);
  assert.equal((result as any).kept_administrator, 'carol Tester');
}

/** With another enabled Administrator, the removed one is disabled and nothing is kept. */
async function testOneOfTwoAdministratorsIsDisabled(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  const leaving = await w.user('dave', { admin: true });
  const staying = await w.user('erin', { admin: true });
  dir.entries.set('oid-erin', { accountEnabled: true });
  const result = await sync.syncTenant(w.tenantId);
  assert.equal(result.status, 'ok');
  assert.equal(await statusOf(ds, w.tenantId, leaving), 'disabled');
  assert.equal(await statusOf(ds, w.tenantId, staying), 'enabled');
  assert.equal(result.removed, 1);
  assert.equal((result as any).kept_administrator ?? null, null);
  assert.equal((await storedSyncStatus(ds, w.tenantId))?.kept_administrator ?? null, null);
}

/** Both enabled Administrators removed: the first goes, the last one is kept. */
async function testTwoRemovedAdministratorsKeepOne(sync: EntraDirectorySyncService, _dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  const one = await w.user('fay', { admin: true });
  const two = await w.user('gus', { admin: true });
  const result = await sync.syncTenant(w.tenantId);
  const statuses = [await statusOf(ds, w.tenantId, one), await statusOf(ds, w.tenantId, two)].sort();
  assert.deepEqual(statuses, ['disabled', 'enabled'], 'exactly one Administrator stays enabled');
  assert.equal(result.removed, 1);
  assert.ok(['fay Tester', 'gus Tester'].includes((result as any).kept_administrator), 'the kept one is named');
}

/** A disabled Administrator does not count: the only enabled one is kept. */
async function testDisabledAdministratorDoesNotCount(sync: EntraDirectorySyncService, _dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  const enabled = await w.user('hal', { admin: true });
  await w.user('ida', { admin: true, status: 'disabled', entra: false });
  const result = await sync.syncTenant(w.tenantId);
  assert.equal(await statusOf(ds, w.tenantId, enabled), 'enabled');
  assert.equal((result as any).kept_administrator, 'hal Tester');
}

function within<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}: still waiting after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Two runs on one workspace at the same time: the second does nothing and says so, at once. Another
 * workspace syncs meanwhile. Once the first run ends, the next one works.
 */
async function testOneRunAtATime(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  const other = await workspace(ds);
  await w.user('jan', { admin: true });
  await w.user('kim', { admin: false });
  dir.entries.set('oid-jan', { accountEnabled: true });
  dir.entries.set('oid-kim', { accountEnabled: true });
  await other.user('lou', { admin: true });
  dir.entries.set('oid-lou', { accountEnabled: true });

  let open!: () => void;
  dir.gate = new Promise<void>((resolve) => { open = resolve; });
  const readsBefore = dir.reads;
  const first = sync.syncTenant(w.tenantId);
  // Wait until the first run is inside the directory read, holding its lock.
  for (let i = 0; i < 100 && dir.reads === readsBefore; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(dir.reads, readsBefore + 1, 'the first run reads the directory');
  const statusDuringFirst = await storedSyncStatus(ds, w.tenantId);

  try {
    const second = await within(sync.syncTenant(w.tenantId), 3_000, 'second run on the same workspace');
    assert.equal(second.status, 'already_running', 'the second run says a sync is running');
    assert.equal(second.synced, 0);
    assert.equal(dir.reads, readsBefore + 1, 'the second run does not read the directory');
    assert.deepEqual(await storedSyncStatus(ds, w.tenantId), statusDuringFirst, 'the second run records nothing');

    // Another workspace is not held by the first one's lock (its read passes the gate once opened
    // below; here it only has to take its own lock and reach the directory).
    const readsBeforeOther = dir.reads;
    const otherRun = sync.syncTenant(other.tenantId);
    for (let i = 0; i < 100 && dir.reads === readsBeforeOther; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(dir.reads, readsBeforeOther + 1, 'another workspace syncs at the same time');
    open();
    const [firstResult, otherResult] = await within(Promise.all([first, otherRun]), 10_000, 'runs after the gate');
    assert.equal(firstResult.status, 'ok');
    assert.equal(firstResult.synced, 2);
    assert.equal(otherResult.status, 'ok');
  } finally {
    open();
    dir.gate = null;
    await first.catch(() => undefined);
  }

  const next = await sync.syncTenant(w.tenantId);
  assert.equal(next.status, 'ok', 'the lock ends with the run');
}

/** A run that fails releases the lock too. */
async function testFailedRunReleasesTheLock(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  await w.user('max', { admin: true });
  dir.entries.set('oid-max', { accountEnabled: true });
  const read = dir.fetchDirectoryUsers;
  dir.fetchDirectoryUsers = async () => { throw new Error('Graph unavailable'); };
  try {
    const failed = await sync.syncTenant(w.tenantId);
    assert.equal(failed.status, 'error');
  } finally {
    dir.fetchDirectoryUsers = read;
  }
  const next = await sync.syncTenant(w.tenantId);
  assert.equal(next.status, 'ok', 'a failed run leaves no lock behind');
}

/** The caller holds one of the pool's two connections: the scheduler's lock, a request's transaction. */
async function testSmallestPool(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  await w.user('nia', { admin: true });
  const leaver = await w.user('oli', { admin: false });
  dir.entries.set('oid-nia', { accountEnabled: true });
  for (const caller of ['scheduler', 'request'] as const) {
    const held = ds.createQueryRunner();
    await held.connect();
    try {
      if (caller === 'scheduler') {
        await held.query(`SELECT pg_try_advisory_lock(hashtext('directory-sync-guards-spec'))`);
      } else {
        await held.startTransaction();
        await held.query(`SELECT set_config('app.current_tenant', $1, true)`, [w.tenantId]);
      }
      const result = await within(sync.syncTenant(w.tenantId), 15_000, `sync beside the ${caller}`);
      assert.equal(result.status, 'ok', `${caller}: ${result.message}`);
      assert.equal(result.synced, 1, `${caller}: the run did its work`);
      assert.equal((await storedSyncStatus(ds, w.tenantId))?.status, 'ok', `${caller}: status recorded`);
    } finally {
      if (held.isTransactionActive) await held.rollbackTransaction();
      else await held.query(`SELECT pg_advisory_unlock_all()`);
      await held.release();
    }
  }
  assert.equal(await statusOf(ds, w.tenantId, leaver), 'disabled');
}

/** The lock's connection is lost during the directory read: that run fails, the next does the work once. */
async function testLostLockConnection(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  await w.user('pat', { admin: true });
  const leaver = await w.user('quinn', { admin: false });
  dir.entries.set('oid-pat', { accountEnabled: true });

  let open!: () => void;
  dir.gate = new Promise<void>((resolve) => { open = resolve; });
  const readsBefore = dir.reads;
  const first = sync.syncTenant(w.tenantId);
  try {
    for (let i = 0; i < 100 && dir.reads === readsBefore; i++) await new Promise((r) => setTimeout(r, 20));
    const holders: Array<{ pid: number }> = await ds.query(
      `SELECT pid FROM pg_locks
        WHERE locktype = 'advisory' AND database = (SELECT oid FROM pg_database WHERE datname = current_database())
          AND classid::bigint = $1 AND objid::bigint = (hashtext($2)::bigint + 4294967296) % 4294967296 AND objsubid = 2`,
      [0x45445359, `entra-directory-sync:${w.tenantId}`],
    );
    assert.equal(holders.length, 1, 'one connection holds the sync lock');
    const [killed] = await ds.query(`SELECT pg_terminate_backend($1) AS ok`, [holders[0].pid]);
    assert.equal(killed.ok, true);
    for (let i = 0; i < 100; i++) {
      const [row] = await ds.query(`SELECT count(*)::int AS n FROM pg_stat_activity WHERE pid = $1`, [holders[0].pid]);
      if (row.n === 0) break;
      await new Promise((r) => setTimeout(r, 20));
    }

    const second = await within(sync.syncTenant(w.tenantId), 15_000, 'run after the lost connection');
    assert.equal(second.status, 'ok', `second run: ${second.message}`);
    open();
    const firstResult = await within(first, 15_000, 'first run after the gate');
    assert.equal(firstResult.status, 'error', 'the run that lost its connection fails');
    assert.equal(firstResult.removed + second.removed, 1, 'the account is disabled and counted once');
    assert.equal(firstResult.synced + second.synced, 1, 'the profile is refreshed once');
  } finally {
    open();
    await first.catch(() => undefined);
  }
  assert.equal(await statusOf(ds, w.tenantId, leaver), 'disabled');
}

/** An account disabled meanwhile (from the Users screen) is not counted by the run. */
async function testAlreadyDisabledIsNotCounted(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  await w.user('rae', { admin: true });
  const leaver = await w.user('sam', { admin: false });
  dir.entries.set('oid-rae', { accountEnabled: true });
  let open!: () => void;
  dir.gate = new Promise<void>((resolve) => { open = resolve; });
  const readsBefore = dir.reads;
  const run = sync.syncTenant(w.tenantId);
  try {
    for (let i = 0; i < 100 && dir.reads === readsBefore; i++) await new Promise((r) => setTimeout(r, 20));
    await withTenantExecution(ds, w.tenantId, (manager) =>
      manager.query(`UPDATE users SET status = 'disabled' WHERE tenant_id = $1 AND id = $2`, [w.tenantId, leaver]),
    );
    open();
    const result = await within(run, 15_000, 'run after the gate');
    assert.equal(result.status, 'ok');
    assert.equal(result.removed, 0, 'the run disabled nobody');
    assert.equal(result.disabled, 0);
  } finally {
    open();
    await run.catch(() => undefined);
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for entra-directory-sync-guards.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const dataSource = app.get(DataSource);
  const sync = app.get(EntraDirectorySyncService);
  const dir = new FakeDirectory();
  (sync as any).entra = dir;
  (sync as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined };
  let failures = 0;
  const tests: Array<[string, (s: EntraDirectorySyncService, d: FakeDirectory, ds: DataSource) => Promise<void>]> = [
    ['removed last Administrator is kept', testRemovedLastAdministratorIsKept],
    ['deactivated last Administrator is kept', testDeactivatedLastAdministratorIsKept],
    ['one of two Administrators is disabled', testOneOfTwoAdministratorsIsDisabled],
    ['two removed Administrators keep one', testTwoRemovedAdministratorsKeepOne],
    ['a disabled Administrator does not count', testDisabledAdministratorDoesNotCount],
    ['one run at a time per workspace', testOneRunAtATime],
    ['a failed run releases the lock', testFailedRunReleasesTheLock],
    ['the smallest pool is enough', testSmallestPool],
    ['a lost lock connection fails its run', testLostLockConnection],
    ['an account disabled meanwhile is not counted', testAlreadyDisabledIsNotCounted],
  ];
  try {
    for (const [name, test] of tests) {
      dir.entries.clear();
      dir.gate = null;
      try {
        await test(sync, dir, dataSource);
        console.log(`ok - ${name}`);
      } catch (error) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(error);
      }
    }
  } finally {
    for (const tenantId of created) {
      await withTenantExecution(dataSource, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
      await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await app.close();
  }
  if (failures > 0) {
    console.error(`entra-directory-sync-guards.integration.spec: ${failures} failed`);
    process.exit(1);
  }
  console.log('entra-directory-sync-guards.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
