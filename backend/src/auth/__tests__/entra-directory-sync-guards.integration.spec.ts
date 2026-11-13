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
//   the directory, or deactivated there) keeps the account enabled, makes it a local account (its
//   Microsoft link removed, its password kept, an entry in its history) so that "Forgot password"
//   gives it back access, and names it in its report (the result and the stored sync status). The
//   next syncs leave it alone. With another enabled Administrator, the account is
//   disabled; a disabled Administrator does not count.
// - runs once at a time per workspace: a second run while one is in progress does nothing and
//   says so (`already_running`), without waiting. Two workspaces sync at the same time.
// - works on the connection that holds its lock: it runs in the smallest pool (DB_POOL_MAX=2)
//   while the caller holds the other connection (the scheduler's lock, a request's transaction),
//   and a run whose connection is lost fails, so the work is done once.
// - counts only the accounts it disables itself.
// - locks a person before the Administrator role, as every write on a person does: a write that
//   holds the person and then asks for the role does not deadlock with the sync.
// Microsoft is replaced by a fake directory; the database is real, with the smallest pool.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'directory-sync-guards-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
process.env.DB_POOL_MAX = '2';
process.env.DB_POOL_CONNECTION_TIMEOUT = '4000';
process.env.APP_BASE_URL ||= 'http://app.directory-sync-guards.test';

type PgClient = {
  connect(): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<{ rows: any[] }>;
  end(): Promise<void>;
};
const { Client } = require('pg') as { Client: new (config: { connectionString: string }) => PgClient };

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

async function linkOf(ds: DataSource, tenantId: string, userId: string) {
  return withTenantExecution(ds, tenantId, async (manager) => {
    const [row] = await manager.query(
      `SELECT external_auth_provider, external_subject, external_synced_at, password_hash FROM users WHERE tenant_id = $1 AND id = $2`,
      [tenantId, userId],
    );
    return row;
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
  const link = await linkOf(ds, w.tenantId, admin);
  assert.equal(link.external_auth_provider, null, 'the kept account becomes local');
  assert.equal(link.external_subject, null);
  assert.equal(link.external_synced_at, null);
  const history = await withTenantExecution(ds, w.tenantId, (manager) =>
    manager.query(
      `SELECT source, source_ref, before_json->>'external_auth_provider' AS before_provider, after_json->>'external_auth_provider' AS after_provider
         FROM audit_log WHERE tenant_id = $1 AND table_name = 'users' AND record_id = $2`,
      [w.tenantId, admin],
    ),
  );
  assert.deepEqual(
    history.map((row: any) => ({ ...row })),
    [{ source: 'system', source_ref: 'entra-sync:last-administrator', before_provider: 'entra', after_provider: null }],
    'one entry in the person\'s history',
  );

  // The next sync leaves the local account alone and keeps nobody.
  const next = await sync.syncTenant(w.tenantId);
  assert.equal(next.status, 'ok');
  assert.equal(next.kept_administrator, null, 'nobody kept on the next sync');
  assert.equal(next.removed + next.disabled + next.synced, 0, 'the local account is out of the sync');
  assert.equal(await statusOf(ds, w.tenantId, admin), 'enabled');
  assert.equal((await storedSyncStatus(ds, w.tenantId))?.kept_administrator, null);
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

/**
 * A write on a person holds their row, then asks for the Administrator role, while the sync comes
 * to disable that person: the sync waits for the row, the write gets the role, both end.
 */
async function testPersonBeforeRole(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const w = await workspace(ds);
  await w.user('tia', { admin: true });
  const leaver = await w.user('uma', { admin: false });
  dir.entries.set('oid-tia', { accountEnabled: true });
  // Outside the pool: the sync and the test's own reads use its two connections.
  const writer = new Client({ connectionString: process.env.DATABASE_URL as string });
  await writer.connect();
  let open!: () => void;
  dir.gate = new Promise<void>((resolve) => { open = resolve; });
  const readsBefore = dir.reads;
  const run = sync.syncTenant(w.tenantId);
  try {
    for (let i = 0; i < 100 && dir.reads === readsBefore; i++) await new Promise((r) => setTimeout(r, 20));
    await writer.query('BEGIN');
    await writer.query(`SELECT set_config('app.current_tenant', $1, true)`, [w.tenantId]);
    await writer.query(`SELECT id FROM users WHERE tenant_id = $1 AND id = $2 FOR UPDATE`, [w.tenantId, leaver]);
    open();
    // Wait until the sync waits on a lock the writer holds.
    let waiting = 0;
    for (let i = 0; i < 250 && waiting === 0; i++) {
      await new Promise((r) => setTimeout(r, 20));
      const [row] = await ds.query(
        `SELECT count(*)::int AS n FROM pg_locks
          WHERE NOT granted AND database IS NOT DISTINCT FROM (SELECT oid FROM pg_database WHERE datname = current_database())
             OR (NOT granted AND locktype = 'transactionid')`,
      );
      waiting = row.n;
    }
    assert.ok(waiting > 0, 'the sync waits for the person the writer holds');
    const role = await writer
      .query(
        `SELECT id FROM roles WHERE tenant_id = $1 AND lower(trim(role_name)) = 'administrator' FOR UPDATE`,
        [w.tenantId],
      )
      .then(() => null, (error: unknown) => error);
    assert.equal(role, null, `the writer gets the role (got ${String(role)})`);
    await writer.query('COMMIT');
    const result = await within(run, 15_000, 'sync after the writer');
    assert.equal(result.status, 'ok', `sync: ${result.message}`);
    assert.equal(result.removed, 1);
  } finally {
    open();
    await writer.query('ROLLBACK').catch(() => undefined);
    await writer.end();
    await run.catch(() => undefined);
  }
  assert.equal(await statusOf(ds, w.tenantId, leaver), 'disabled');
}

/** A kept account with a password keeps it; "Forgot password" works for a kept account without one. */
async function testKeptAccountSignsInWithAPassword(
  sync: EntraDirectorySyncService,
  _dir: FakeDirectory,
  ds: DataSource,
  app: any,
) {
  const { AuthController } = require('../auth.controller');
  const { AuthService } = require('../auth.service');
  const { Features } = require('../../config/features');
  const controller = app.get(AuthController);
  const auth = app.get(AuthService);

  // With a password: kept as it is.
  const withPassword = await workspace(ds);
  const holder = await withPassword.user('vic', { admin: true });
  await withTenantExecution(ds, withPassword.tenantId, (manager) =>
    manager.query(`UPDATE users SET password_hash = 'stored-password-hash' WHERE id = $1`, [holder]),
  );
  await sync.syncTenant(withPassword.tenantId);
  assert.equal((await linkOf(ds, withPassword.tenantId, holder)).password_hash, 'stored-password-hash', 'the password stays');

  // Without a password: "Forgot password" sends nothing while the account is linked to Microsoft,
  // and a link once it is local.
  const w = await workspace(ds);
  const admin = await w.user('wes', { admin: true });
  const email = `wes-${w.tenantId.slice(0, 8)}@example.test`;
  const sent: string[] = [];
  const emails = (controller as any).emails;
  const send = emails.sendPasswordResetEmail;
  const emailEnabled = Features.EMAIL_ENABLED;
  emails.sendPasswordResetEmail = async (input: { resetUrl: string }) => { sent.push(input.resetUrl); };
  (Features as any).EMAIL_ENABLED = true;
  const req = { tenant: { id: w.tenantId, slug: `dir-sync-${w.tenantId.slice(0, 8)}` }, headers: {}, ip: '127.0.0.1' };
  const settle = async () => { for (let i = 0; i < 50; i++) await new Promise((r) => setTimeout(r, 20)); };
  try {
    await controller.requestPasswordReset({ email }, req);
    await settle();
    assert.equal(sent.length, 0, 'an account linked to Microsoft gets no link');

    const result = await sync.syncTenant(w.tenantId);
    assert.equal(result.kept_administrator, 'wes Tester');

    await controller.requestPasswordReset({ email }, req);
    for (let i = 0; i < 100 && sent.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
    assert.equal(sent.length, 1, 'the kept account gets a link');
    const token = decodeURIComponent(sent[0].split('#token=')[1]);
    await controller.completePasswordReset({ token, password: 'A-new-password-for-wes-1' }, req);
    const signedIn: { id: string } = await withTenantExecution(ds, w.tenantId, (manager) =>
      auth.validateUser(email, 'A-new-password-for-wes-1', manager),
    );
    assert.equal(signedIn.id, admin, 'the kept account signs in with its new password');
  } finally {
    emails.sendPasswordResetEmail = send;
    (Features as any).EMAIL_ENABLED = emailEnabled;
  }
}

/**
 * A directory answer without the list of users (no `value`, or not a list) is an error of the
 * sync, not an empty directory: nobody is disabled, and the run reports the error.
 */
async function testMalformedDirectoryAnswerDisablesNobody(sync: EntraDirectorySyncService, dir: FakeDirectory, ds: DataSource) {
  const { EntraAuthService } = require('../entra-auth.service');
  const w = await workspace(ds);
  const one = await w.user('kim', { admin: true });
  const two = await w.user('lou', { admin: false });
  const fetchDirectoryUsers = dir.fetchDirectoryUsers;
  try {
    for (const answer of [{}, { value: null }, { value: { id: 'x' } }, { value: 'none' }, null]) {
      // The real reading of Graph's answer, on a Graph that answers `answer`.
      const graph = Object.create(EntraAuthService.prototype);
      graph.fetchJsonWithAuth = async () => answer;
      graph.logger = { warn: () => undefined, debug: () => undefined };
      dir.fetchDirectoryUsers = (token: string, ids: string[]) => graph.fetchDirectoryUsers(token, ids);
      const result = await sync.syncTenant(w.tenantId);
      assert.equal(result.status, 'error', `an answer ${JSON.stringify(answer)} is an error`);
      assert.equal(result.disabled + result.removed, 0);
      assert.equal(await statusOf(ds, w.tenantId, one), 'enabled');
      assert.equal(await statusOf(ds, w.tenantId, two), 'enabled', 'nobody is disabled');
    }
  } finally {
    dir.fetchDirectoryUsers = fetchDirectoryUsers;
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
  const tests: Array<[string, (s: EntraDirectorySyncService, d: FakeDirectory, ds: DataSource, app: any) => Promise<void>]> = [
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
    ['the person is locked before the Administrator role', testPersonBeforeRole],
    ['the kept account signs in with a password', testKeptAccountSignsInWithAPassword],
    ['a malformed directory answer disables nobody', testMalformedDirectoryAnswerDisablesNobody],
  ];
  try {
    for (const [name, test] of tests) {
      dir.entries.clear();
      dir.gate = null;
      try {
        await test(sync, dir, dataSource, app);
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
