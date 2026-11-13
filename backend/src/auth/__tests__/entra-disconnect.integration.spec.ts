import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { NestFactory } from '@nestjs/core';
import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { EntraDirectorySyncService } from '../entra-directory-sync.service';
import { AdminAuthController } from '../admin-auth.controller';
import { AuthController } from '../auth.controller';
import { AuthService } from '../auth.service';
import { EntraController } from '../entra.controller';
import { Features } from '../../config/features';
import { lockTenantConnection } from '../entra-link-confirmation';

// Removing a workspace's Microsoft connection (Administration > Authentication, Disconnect):
// - makes every linked account of the workspace local, and none of another workspace: an account
//   with a password signs in with it at once, one without gets a "Forgot password" link and signs
//   in; each person gets one entry in their history;
// - the confirmation reads, from the server, how many accounts keep a password and how many will
//   set one with "Forgot password";
// - an administrator without a password gives one with the disconnect: refused without it (nothing
//   written), done with it;
// - two disconnects at once: one does the work, the other is refused;
// - the directory sync no longer touches the accounts, even when the disconnect happens while a
//   sync is reading the directory, and even once the workspace is connected again;
// - a disconnect and a Microsoft sign-in that links an account wait for each other, and the
//   workspace's other writes go on during a disconnect;
// - connected again, an existing account is linked by the usual rule (confirmation by e-mail, or the
//   first sign-in of an invited account without a password); a confirmation sent before the
//   disconnect no longer works.
// Microsoft is replaced by a fake directory and the e-mails are recorded; the database is real.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'entra-disconnect-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
process.env.APP_BASE_URL ||= 'http://app.entra-disconnect.test';

const PASSWORD = 'A-stored-password-1';

/** A fake Microsoft directory: profiles by object id; `holdRead` holds the n-th read until released. */
class FakeDirectory {
  enabled = new Set<string>();
  reads = 0;
  holdRead = 0;
  private release: (() => void) | null = null;
  private reached: (() => void) | null = null;
  held = new Promise<void>((resolve) => { this.reached = resolve; });

  acquireAppToken = async () => 'token';
  probeDirectoryAccess = async () => undefined;
  invalidateAppToken = () => undefined;
  isConsentError = () => false;
  fetchDirectoryUsers = async (_token: string, ids: string[]) => {
    this.reads += 1;
    if (this.reads === this.holdRead) {
      const gate = new Promise<void>((resolve) => { this.release = resolve; });
      this.reached?.();
      await gate;
    }
    return ids.filter((id) => this.enabled.has(id)).map((id) => ({ id, accountEnabled: true, givenName: null, surname: null }));
  };
  releaseRead() { this.release?.(); }
}

type Workspace = {
  tenantId: string;
  slug: string;
  directoryId: string;
  user: (key: string, opts?: { admin?: boolean; contact?: boolean; status?: string; entra?: boolean; password?: boolean }) => Promise<string>;
  email: (key: string) => string;
};

const created: string[] = [];

async function workspace(ds: DataSource): Promise<Workspace> {
  const tenantId = randomUUID();
  const slug = `entra-off-${tenantId.slice(0, 8)}`;
  const directoryId = randomUUID();
  await ds.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, sso_enabled, entra_tenant_id, entra_metadata, created_at, updated_at)
     VALUES ($1, $2, $4, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, 'entra', true, $3, '{"display_name":"Dir"}'::jsonb, now(), now())`,
    [tenantId, slug, directoryId, slug],
  );
  created.push(tenantId);
  const roles = await withTenantExecution(ds, tenantId, async (manager) => {
    const role = async (name: string, isSystem: boolean, permissions: Record<string, string>) => {
      const [row] = await manager.query(`INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, $2, $3) RETURNING id`, [tenantId, name, isSystem]);
      for (const [resource, level] of Object.entries(permissions)) {
        await manager.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, row.id, resource, level]);
      }
      return row.id as string;
    };
    return {
      admin: await role('Administrator', true, { users: 'admin' }),
      contact: await role('Contact', true, {}),
      reader: await role('Budget Reader', false, { opex: 'reader' }),
    };
  });
  const hash = await argon2.hash(PASSWORD, { type: argon2.argon2id });
  const email = (key: string) => `${key}-${tenantId.slice(0, 8)}@example.test`;
  const user: Workspace['user'] = (key, opts = {}) =>
    withTenantExecution(ds, tenantId, async (manager) => {
      const roleId = opts.admin ? roles.admin : opts.contact ? roles.contact : roles.reader;
      const [row] = await manager.query(
        `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, password_hash, mfa_enabled,
                            external_auth_provider, external_subject, external_synced_at)
         VALUES ($1, $2, $3, 'Tester', $4, $5, $6, true, $7, $8, $9) RETURNING id`,
        [
          tenantId, email(key), key, roleId, opts.status ?? 'enabled', opts.password === false ? null : hash,
          opts.entra === false ? null : 'entra', opts.entra === false ? null : `oid-${key}`, opts.entra === false ? null : new Date(),
        ],
      );
      await manager.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, row.id, roleId]);
      return row.id as string;
    });
  return { tenantId, slug, directoryId, user, email };
}

function request(w: Workspace, actorId: string, manager?: EntityManager) {
  return {
    tenant: { id: w.tenantId, slug: w.slug },
    user: { sub: actorId },
    queryRunner: manager ? { manager } : undefined,
    headers: { host: `${w.slug}.lvh.me` },
    protocol: 'http',
    ip: '127.0.0.1',
  };
}

function inTenant<T>(ds: DataSource, tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  return withTenantExecution(ds, tenantId, fn);
}

async function disconnect(ds: DataSource, admin: AdminAuthController, w: Workspace, actorId: string, body: Record<string, unknown> = {}) {
  return inTenant(ds, w.tenantId, (manager) => admin.disconnect(request(w, actorId, manager) as any, body as any));
}

async function settings(ds: DataSource, admin: AdminAuthController, w: Workspace, actorId: string): Promise<any> {
  return inTenant(ds, w.tenantId, (manager) => admin.getSettings(request(w, actorId, manager) as any));
}

async function links(ds: DataSource, w: Workspace): Promise<Record<string, string | null>> {
  const rows = await inTenant(ds, w.tenantId, (manager) =>
    manager.query(`SELECT first_name, external_auth_provider, external_subject, external_synced_at FROM users WHERE tenant_id = $1`, [w.tenantId]),
  );
  return Object.fromEntries(rows.map((row: any) => [row.first_name, row.external_auth_provider ?? row.external_subject ?? row.external_synced_at ?? null]));
}

async function tenantRow(ds: DataSource, w: Workspace) {
  const [row] = await ds.query(`SELECT sso_provider, sso_enabled, entra_tenant_id, entra_metadata FROM tenants WHERE id = $1`, [w.tenantId]);
  return row;
}

async function disconnectHistory(ds: DataSource, w: Workspace) {
  return inTenant(ds, w.tenantId, (manager) =>
    manager.query(
      `SELECT table_name, record_id, user_id, before_json->>'external_auth_provider' AS before_provider,
              after_json->>'external_auth_provider' AS after_provider, after_json ? 'password_hash' AS leaks
         FROM audit_log WHERE tenant_id = $1 AND source_ref = 'entra-disconnect' ORDER BY table_name, record_id`,
      [w.tenantId],
    ),
  );
}

async function statuses(ds: DataSource, w: Workspace): Promise<Record<string, string>> {
  const rows = await inTenant(ds, w.tenantId, (manager) => manager.query(`SELECT first_name, status FROM users WHERE tenant_id = $1`, [w.tenantId]));
  return Object.fromEntries(rows.map((row: any) => [row.first_name, row.status]));
}

async function signIn(ds: DataSource, auth: AuthService, w: Workspace, key: string, password: string): Promise<string> {
  const user = await inTenant(ds, w.tenantId, (manager) => auth.validateUser(w.email(key), password, manager));
  return user.id;
}

async function rejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected a refusal');
}

function codeOf(error: any): string | undefined {
  const response = error?.getResponse?.();
  return typeof response === 'object' ? response?.code : undefined;
}

type Ctx = {
  ds: DataSource;
  admin: AdminAuthController;
  auth: AuthService;
  authController: AuthController;
  entraController: EntraController;
  sync: EntraDirectorySyncService;
  dir: FakeDirectory;
  resetLinks: string[];
  linkMails: Array<{ to: string; confirmUrl: string }>;
};

/** Every linked account of the workspace becomes local; another workspace keeps its links. */
async function testAccountsBecomeLocal(c: Ctx) {
  const w = await workspace(c.ds);
  const other = await workspace(c.ds);
  const otherUser = await other.user('olga');
  const ada = await w.user('ada', { admin: true });
  const bob = await w.user('bob');
  const cyd = await w.user('cyd', { password: false });
  await w.user('dan', { status: 'disabled', password: false });
  await w.user('eve', { contact: true, password: false });
  await w.user('fay', { entra: false });

  const summary = (await settings(c.ds, c.admin, w, ada)).disconnect;
  assert.deepEqual(summary, { keep_password: 2, need_password: 1, password_required: false }, 'the two numbers of the confirmation');

  await disconnect(c.ds, c.admin, w, ada);
  assert.deepEqual(await links(c.ds, w), { ada: null, bob: null, cyd: null, dan: null, eve: null, fay: null }, 'every account is local');
  const otherLinks = await links(c.ds, other);
  assert.equal(otherLinks.olga, 'entra', 'another workspace keeps its links');
  assert.ok(otherUser);
  const tenant = await tenantRow(c.ds, w);
  assert.equal(tenant.sso_provider, 'none');
  assert.equal(tenant.entra_tenant_id, null);
  assert.equal(tenant.sso_enabled, false);

  const history = await disconnectHistory(c.ds, w);
  const people = history.filter((row: any) => row.table_name === 'users');
  assert.equal(people.length, 5, 'one entry per account made local');
  assert.equal(new Set(people.map((row: any) => row.record_id)).size, 5);
  for (const row of people) {
    assert.equal(row.before_provider, 'entra');
    assert.equal(row.after_provider, null);
    assert.equal(row.user_id, ada, 'the administrator who disconnected is the author');
    assert.equal(row.leaks, false);
  }
  assert.equal(history.filter((row: any) => row.table_name === 'tenants').length, 1, 'one entry for the workspace');

  // With a password: signs in at once.
  assert.equal(await signIn(c.ds, c.auth, w, 'bob', PASSWORD), bob);
  // Without: "Forgot password" sends a link, which sets a password.
  const req = request(w, cyd);
  c.resetLinks.length = 0;
  await c.authController.requestPasswordReset({ email: w.email('cyd') } as any, req);
  for (let i = 0; i < 100 && c.resetLinks.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  assert.equal(c.resetLinks.length, 1, 'the local account gets a reset link');
  const token = decodeURIComponent(c.resetLinks[0].split('#token=')[1]);
  await c.authController.completePasswordReset({ token, password: 'A-new-password-for-cyd-1' } as any, req);
  assert.equal(await signIn(c.ds, c.auth, w, 'cyd', 'A-new-password-for-cyd-1'), cyd);
}

/** The administrator without a password gives one with the disconnect; without it nothing is written. */
async function testAdministratorWithoutPassword(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true, password: false });
  await w.user('bob', { password: false });

  const summary = (await settings(c.ds, c.admin, w, ada)).disconnect;
  assert.deepEqual(summary, { keep_password: 1, need_password: 1, password_required: true });

  for (const body of [{}, { password: 'short' }]) {
    const error = await rejection(disconnect(c.ds, c.admin, w, ada, body));
    assert.equal(error?.getStatus?.(), 400);
    assert.equal(codeOf(error), 'LOCAL_PASSWORD_REQUIRED');
  }
  assert.equal((await tenantRow(c.ds, w)).sso_provider, 'entra', 'still connected after a refusal');
  assert.deepEqual(await links(c.ds, w), { ada: 'entra', bob: 'entra' }, 'still linked after a refusal');
  assert.equal((await disconnectHistory(c.ds, w)).length, 0, 'nothing written after a refusal');

  await disconnect(c.ds, c.admin, w, ada, { password: 'Ada-own-password-1' });
  assert.equal(await signIn(c.ds, c.auth, w, 'ada', 'Ada-own-password-1'), ada, 'the administrator signs in with the new password');
  assert.deepEqual(await links(c.ds, w), { ada: null, bob: null });
}

/** An administrator who has a password is asked nothing, and a password sent anyway is not written. */
async function testAdministratorWithPasswordKeepsIt(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true });
  await disconnect(c.ds, c.admin, w, ada, { password: 'Another-password-1' });
  assert.equal(await signIn(c.ds, c.auth, w, 'ada', PASSWORD), ada, 'the stored password stays');
}

/** Two disconnects at once: one makes the accounts local, the other is refused. */
async function testTwoDisconnectsAtOnce(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true });
  const ben = await w.user('ben', { admin: true });
  for (let i = 0; i < 5; i++) await w.user(`p${i}`, { password: i % 2 === 0 });
  const outcomes = await Promise.allSettled([disconnect(c.ds, c.admin, w, ada), disconnect(c.ds, c.admin, w, ben)]);
  assert.equal(outcomes.filter((o) => o.status === 'fulfilled').length, 1, 'one disconnect does the work');
  const refused = outcomes.find((o) => o.status === 'rejected') as PromiseRejectedResult;
  assert.equal(refused.reason?.getStatus?.(), 409);
  assert.equal(codeOf(refused.reason), 'SSO_NOT_CONNECTED');
  const history = await disconnectHistory(c.ds, w);
  assert.equal(history.filter((row: any) => row.table_name === 'users').length, 7, 'one entry per person');
  assert.equal(history.filter((row: any) => row.table_name === 'tenants').length, 1);
  assert.ok(Object.values(await links(c.ds, w)).every((link) => link === null));
}

/** After a disconnect, the nightly task and "Sync now" leave the accounts alone, even connected again. */
async function testSyncLeavesTheAccountsAlone(c: Ctx) {
  const w = await workspace(c.ds);
  const still = await workspace(c.ds);
  await still.user('sam');
  const ada = await w.user('ada', { admin: true });
  await w.user('bob');
  await disconnect(c.ds, c.admin, w, ada);

  const now = await c.sync.syncTenant(w.tenantId);
  assert.equal(now.status, 'error');
  assert.equal(now.message, 'SSO_NOT_CONFIGURED', '"Sync now" does not run');

  // The nightly task: only the workspaces still connected.
  const seen: string[] = [];
  const syncTenant = c.sync.syncTenant;
  const ssoFlag = Features.ENTRA_SSO;
  (Features as any).ENTRA_SSO = true;
  c.sync.syncTenant = async (tenantId: string) => { seen.push(tenantId); return { status: 'ok', synced: 0, disabled: 0, removed: 0, managers_updated: 0, managers_unresolved: 0, kept_administrator: null } as any; };
  try {
    await c.sync.runAll();
  } finally {
    c.sync.syncTenant = syncTenant;
    (Features as any).ENTRA_SSO = ssoFlag;
  }
  assert.ok(!seen.includes(w.tenantId), 'the nightly task skips the disconnected workspace');
  assert.ok(seen.includes(still.tenantId), 'and still runs for a connected one');

  // Connected again to the same directory, where neither account exists any more: both stay.
  await c.ds.query(`UPDATE tenants SET sso_provider = 'entra', sso_enabled = true, entra_tenant_id = $2 WHERE id = $1`, [w.tenantId, w.directoryId]);
  const again = await c.sync.syncTenant(w.tenantId);
  assert.equal(again.status, 'ok');
  assert.equal(again.synced + again.disabled + again.removed, 0, 'the local accounts are out of the sync');
  assert.deepEqual(await statuses(c.ds, w), { ada: 'enabled', bob: 'enabled' });
}

/** A disconnect while the sync reads the directory: the accounts it made local stay enabled and local. */
async function testDisconnectDuringDirectoryRead(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true });
  const ben = await w.user('ben', { admin: true });
  assert.ok(ben);
  c.dir.enabled.add('oid-ada');
  c.dir.enabled.add('oid-ben');
  // More people than one directory read: the second read is held while the workspace is disconnected.
  for (let i = 0; i < 20; i++) await w.user(`p${String(i).padStart(2, '0')}`);
  c.dir.holdRead = 2;
  const run = c.sync.syncTenant(w.tenantId);
  await c.dir.held;
  await disconnect(c.ds, c.admin, w, ada);
  c.dir.releaseRead();
  await run;
  const after = await statuses(c.ds, w);
  assert.deepEqual(Object.entries(after).filter(([, status]) => status !== 'enabled'), [], 'nobody is disabled');
  assert.ok(Object.values(await links(c.ds, w)).every((link) => link === null), 'nobody is linked again');
}

/** Connected again: an account is linked by the usual rule; a confirmation sent before no longer works. */
async function testReconnectUsesTheLinkRule(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true });
  const bob = await w.user('bob');
  const ivy = await w.user('ivy', { status: 'invited', password: false, entra: false });
  const signInWithMicrosoft = async (key: string) => {
    let location = '';
    await (c.entraController as any).handleLoginCallback(
      w.tenantId,
      w.slug,
      '/',
      { tid: w.directoryId, oid: `oid-${key}`, email: w.email(key), name: `${key} Tester` },
      null,
      request(w, ada),
      { redirect: (url: string) => { location = url; } },
    );
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 10));
    return location;
  };
  // Ivy asks for a link while the workspace is connected (she is not invited yet without a password).
  await inTenant(c.ds, w.tenantId, (m) => m.query(`UPDATE users SET status = 'enabled', password_hash = 'x' WHERE id = $1`, [ivy]));
  c.linkMails.length = 0;
  assert.match(await signInWithMicrosoft('ivy'), /ssoNotice=ENTRA_LINK_SENT/);
  assert.equal(c.linkMails.length, 1);
  const oldToken = new URLSearchParams(c.linkMails[0].confirmUrl.split('#')[1]).get('token');
  await inTenant(c.ds, w.tenantId, (m) => m.query(`UPDATE users SET status = 'invited', password_hash = NULL WHERE id = $1`, [ivy]));

  await disconnect(c.ds, c.admin, w, ada);
  await c.ds.query(`UPDATE tenants SET sso_provider = 'entra', sso_enabled = true, entra_tenant_id = $2 WHERE id = $1`, [w.tenantId, w.directoryId]);

  const refused = await rejection(c.entraController.confirmLink({ token: oldToken } as any, request(w, ivy)));
  assert.match(String(refused?.message), /ENTRA_LINK_INVALID/, 'a confirmation sent before the disconnect no longer works');

  // Bob, made local, is linked only once he confirms.
  assert.match(await signInWithMicrosoft('bob'), /ssoNotice=ENTRA_LINK_SENT/, 'an existing account waits for its confirmation');
  assert.equal((await links(c.ds, w)).bob, null);
  assert.ok(bob);
  // Ivy, invited without a password, is linked at her first sign-in.
  assert.match(await signInWithMicrosoft('ivy'), /\/login\/callback#handoff=/);
  assert.equal((await links(c.ds, w)).ivy, 'entra');
}

/** A transaction of the workspace, left open for the test to end. */
async function openTransaction(c: Ctx, w: Workspace) {
  const runner = c.ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [w.tenantId]);
  const [{ pid }] = await runner.query(`SELECT pg_backend_pid() AS pid`);
  return { runner, pid: pid as number };
}

async function waitUntilBlocked(c: Ctx, pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await c.ds.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`backend ${pid} never waited for a lock`);
}

async function endAll(...runners: QueryRunner[]) {
  for (const runner of runners) {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    if (!runner.isReleased) await runner.release();
  }
}

/**
 * A disconnect and a Microsoft sign-in that links an account exclude each other on the
 * workspace's row: the disconnect waits for the sign-in, and a sign-in that comes during the
 * disconnect waits for it and then reads the workspace disconnected.
 */
async function testDisconnectAndLinkingSignInExcludeEachOther(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true });
  await w.user('bob');

  const signIn = await openTransaction(c, w);
  const disconnecting = await openTransaction(c, w);
  try {
    assert.equal((await lockTenantConnection(signIn.runner.manager, w.tenantId))?.sso_provider, 'entra');
    let done = false;
    const pending = c.admin.disconnect(request(w, ada, disconnecting.runner.manager) as any, {} as any).finally(() => { done = true; });
    pending.catch(() => undefined);
    await waitUntilBlocked(c, disconnecting.pid);
    assert.equal(done, false, 'the disconnect waits for the sign-in');
    await signIn.runner.commitTransaction();
    await pending;
    await disconnecting.runner.rollbackTransaction();
  } finally {
    await endAll(signIn.runner, disconnecting.runner);
  }

  const held = await openTransaction(c, w);
  const late = await openTransaction(c, w);
  try {
    await c.admin.disconnect(request(w, ada, held.runner.manager) as any, {} as any);
    const seen: { row?: Awaited<ReturnType<typeof lockTenantConnection>> } = {};
    const pending = lockTenantConnection(late.runner.manager, w.tenantId).then((row) => { seen.row = row; });
    pending.catch(() => undefined);
    await waitUntilBlocked(c, late.pid);
    assert.ok(!('row' in seen), 'the sign-in waits for the disconnect');
    await held.runner.commitTransaction();
    await pending;
    assert.equal(seen.row?.sso_provider, 'none', 'and reads the workspace disconnected');
    assert.equal(seen.row?.entra_tenant_id, null);
  } finally {
    await endAll(held.runner, late.runner);
  }
}

/**
 * While a disconnect is in progress, the workspace's other writes go on: a row that references the
 * workspace (its foreign key reads the workspace's row) is written without waiting.
 */
async function testDisconnectLeavesOtherWritesFree(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true });
  await w.user('bob');
  const held = await openTransaction(c, w);
  const writer = await openTransaction(c, w);
  try {
    await c.admin.disconnect(request(w, ada, held.runner.manager) as any, {} as any);
    await writer.runner.query(`SET LOCAL lock_timeout = '2s'`);
    await writer.runner.query(`INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Written during a disconnect')`, [w.tenantId]);
    await writer.runner.rollbackTransaction();
    await held.runner.commitTransaction();
  } finally {
    await endAll(held.runner, writer.runner);
  }
}

/**
 * A Microsoft sign-in never waits for a transaction that holds the workspace's row (an import of
 * applications, a settings change): only a disconnect or a connection make it wait.
 */
async function testSignInDoesNotWaitForTheWorkspaceRow(c: Ctx) {
  const w = await workspace(c.ds);
  const ada = await w.user('ada', { admin: true });
  await w.user('bob');
  const holder = await openTransaction(c, w);
  try {
    await holder.runner.query(`SELECT id FROM tenants WHERE id = $1 FOR UPDATE`, [w.tenantId]);
    let location = '';
    const signIn = (c.entraController as any).handleLoginCallback(
      w.tenantId, w.slug, '/',
      { tid: w.directoryId, oid: 'oid-bob', email: w.email('bob'), name: 'bob Tester' },
      null,
      request(w, ada),
      { redirect: (url: string) => { location = url; } },
    ) as Promise<void>;
    signIn.catch(() => undefined);
    const outcome = await Promise.race([
      signIn.then(() => 'signed in'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still waiting after 3 s'), 3000)),
    ]);
    await holder.runner.commitTransaction();
    await signIn;
    assert.equal(outcome, 'signed in');
    assert.match(location, /handoff=/);
  } finally {
    await endAll(holder.runner);
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for entra-disconnect.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const ds = app.get(DataSource);
  const sync = app.get(EntraDirectorySyncService);
  const dir = new FakeDirectory();
  (sync as any).entra = dir;
  (sync as any).logger = { warn: () => undefined, log: () => undefined, debug: () => undefined };
  const authController = app.get(AuthController);
  const entraController = app.get(EntraController);
  const resetLinks: string[] = [];
  const linkMails: Array<{ to: string; confirmUrl: string }> = [];
  const emails = (authController as any).emails;
  const sendReset = emails.sendPasswordResetEmail;
  const sendLink = emails.sendEntraLinkConfirmationEmail;
  emails.sendPasswordResetEmail = async (input: { resetUrl: string }) => { resetLinks.push(input.resetUrl); };
  emails.sendEntraLinkConfirmationEmail = async (input: { to: string; confirmUrl: string }) => { linkMails.push(input); };
  const emailFlag = Features.EMAIL_ENABLED;
  (Features as any).EMAIL_ENABLED = true;
  const ctx: Ctx = {
    ds,
    admin: app.get(AdminAuthController),
    auth: app.get(AuthService),
    authController,
    entraController,
    sync,
    dir,
    resetLinks,
    linkMails,
  };
  let failures = 0;
  const tests: Array<[string, (c: Ctx) => Promise<void>]> = [
    ['every linked account becomes local', testAccountsBecomeLocal],
    ['an administrator without a password gives one', testAdministratorWithoutPassword],
    ['an administrator with a password keeps it', testAdministratorWithPasswordKeepsIt],
    ['two disconnects at once', testTwoDisconnectsAtOnce],
    ['the sync leaves the accounts alone', testSyncLeavesTheAccountsAlone],
    ['a disconnect during a directory read', testDisconnectDuringDirectoryRead],
    ['connected again, the usual link rule applies', testReconnectUsesTheLinkRule],
    ['a disconnect and a linking sign-in exclude each other', testDisconnectAndLinkingSignInExcludeEachOther],
    ["a disconnect leaves the workspace's other writes free", testDisconnectLeavesOtherWritesFree],
    ["a sign-in does not wait for the workspace's row", testSignInDoesNotWaitForTheWorkspaceRow],
  ];
  const only = process.argv[2];
  try {
    for (const [name, test] of tests) {
      if (only && !name.includes(only)) continue;
      dir.enabled.clear();
      dir.reads = 0;
      dir.holdRead = 0;
      dir.held = new Promise<void>((resolve) => { (dir as any).reached = resolve; });
      try {
        await test(ctx);
        console.log(`ok - ${name}`);
      } catch (error) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(error);
        dir.releaseRead();
      }
    }
  } finally {
    emails.sendPasswordResetEmail = sendReset;
    emails.sendEntraLinkConfirmationEmail = sendLink;
    (Features as any).EMAIL_ENABLED = emailFlag;
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 20));
    for (const tenantId of created) {
      await withTenantExecution(ds, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
      await ds.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await app.close();
  }
  if (failures > 0) {
    console.error(`entra-disconnect.integration.spec: ${failures} failed`);
    process.exit(1);
  }
  console.log('entra-disconnect.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
