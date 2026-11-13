import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { withTenantExecution } from '../../common/tenant-runner';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { Features } from '../../config/features';
import { EntraController } from '../entra.controller';
import { lockAccountForLink } from '../entra-link-confirmation';
import { UsersService } from '../../users/users.service';

// A Microsoft sign-in of a linked account and an administrator's "Unlink from Microsoft" at the
// same moment. The sign-in locks the account and reads it again before it saves it:
// - unlinked while the sign-in reads the account: the sign-in waits, then treats the account as an
//   existing account without a link (a confirmation is e-mailed), never links it back in silence
//   and opens no session;
// - unlinked while the sign-in holds the account: the unlink waits for the sign-in, and the account
//   ends unlinked.
// Microsoft's answer is given as verified claims; the database is real.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret-of-at-least-32-characters';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'entra-sign-in-unlink-race';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';
process.env.APP_BASE_URL ||= 'http://app.entra-sign-in-unlink-race.test';

const created: string[] = [];

type Workspace = { tenantId: string; slug: string; directoryId: string; userId: string; email: string };

async function workspace(ds: DataSource): Promise<Workspace> {
  const tenantId = randomUUID();
  const slug = `entra-race-${tenantId.slice(0, 8)}`;
  const directoryId = randomUUID();
  await ds.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, sso_enabled, entra_tenant_id, created_at, updated_at)
     VALUES ($1, $2, $4, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, 'entra', true, $3, now(), now())`,
    [tenantId, slug, directoryId, slug],
  );
  created.push(tenantId);
  const email = `bob-${tenantId.slice(0, 8)}@example.test`;
  const userId = await withTenantExecution(ds, tenantId, async (manager) => {
    const [role] = await manager.query(`INSERT INTO roles (tenant_id, role_name, is_system) VALUES ($1, 'Budget Reader', false) RETURNING id`, [tenantId]);
    const [row] = await manager.query(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, external_auth_provider, external_subject)
       VALUES ($1, $2, 'Bob', 'Tester', $3, 'enabled', 'entra', 'oid-bob') RETURNING id`,
      [tenantId, email, role.id],
    );
    return row.id as string;
  });
  return { tenantId, slug, directoryId, userId, email };
}

function signIn(entra: EntraController, w: Workspace) {
  const outcome: { location: string } = { location: '' };
  const done = (entra as any).handleLoginCallback(
    w.tenantId, w.slug, '/',
    { tid: w.directoryId, oid: 'oid-bob', email: w.email, name: 'Bob Tester' },
    null,
    { tenant: { id: w.tenantId, slug: w.slug }, headers: { host: `${w.slug}.lvh.me` }, protocol: 'http', ip: '127.0.0.1' },
    { redirect: (url: string) => { outcome.location = url; } },
  ) as Promise<void>;
  return { outcome, done };
}

async function link(ds: DataSource, w: Workspace) {
  const [row] = await withTenantExecution(ds, w.tenantId, (manager) =>
    manager.query(`SELECT external_auth_provider, external_subject FROM users WHERE id = $1`, [w.userId]),
  );
  return row as { external_auth_provider: string | null; external_subject: string | null };
}

async function openTransaction(ds: DataSource, tenantId: string) {
  const runner = ds.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [{ pid }] = await runner.query(`SELECT pg_backend_pid() AS pid`);
  return { runner, pid: pid as number };
}

/** Resolves once backend `pid` waits for a lock, or once `settled` says its work ended. */
async function blockedOrSettled(ds: DataSource, pid: number, settled: () => boolean): Promise<'blocked' | 'settled'> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (settled()) return 'settled';
    const [row] = await ds.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return 'blocked';
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`backend ${pid} neither finished nor waited`);
}

/** Resolves once a backend of this database waits for `pid`, or once `settled` says the work ended. */
async function blockingOrSettled(ds: DataSource, pid: number, settled: () => boolean): Promise<'blocked' | 'settled'> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (settled()) return 'settled';
    const [row] = await ds.query(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND $1 = ANY(pg_blocking_pids(pid))`,
      [pid],
    );
    if (row?.n > 0) return 'blocked';
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`nothing waited for backend ${pid}`);
}

async function end(runner: QueryRunner) {
  if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
  if (!runner.isReleased) await runner.release();
}

/** The account is unlinked (committed) between the sign-in's read and its save. */
async function testUnlinkWhileTheSignInReads(ds: DataSource, entra: EntraController, users: UsersService, mails: string[]) {
  const w = await workspace(ds);
  const unlinking = await openTransaction(ds, w.tenantId);
  try {
    await users.unlinkExternalSignIn(w.userId, null, { manager: unlinking.runner.manager });
    const { outcome, done } = signIn(entra, w);
    let finished = false;
    done.then(() => { finished = true; }, () => { finished = true; });
    // The sign-in reads the account as still linked (the unlink is not committed) and waits for it.
    const state = await blockingOrSettled(ds, unlinking.pid, () => finished);
    assert.equal(state, 'blocked', 'the sign-in waits for the unlink');
    await new Promise((resolve) => setTimeout(resolve, 300));
    await unlinking.runner.commitTransaction();
    await done.catch((error) => assert.fail(`the sign-in failed: ${error?.message}`));
    assert.deepEqual(await link(ds, w), { external_auth_provider: null, external_subject: null }, 'not linked back');
    assert.doesNotMatch(outcome.location, /handoff=/, 'no session for an account no longer linked');
    assert.match(outcome.location, /ssoNotice=ENTRA_LINK_SENT/, 'the owner confirms the link by e-mail');
    for (let i = 0; i < 20 && !mails.includes(w.email); i++) await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(mails.includes(w.email), 'a confirmation is e-mailed');
  } finally {
    await end(unlinking.runner);
  }
}

/** The sign-in holds the account when the administrator unlinks it: the unlink waits and wins last. */
async function testUnlinkWhileTheSignInHoldsTheAccount(ds: DataSource, entra: EntraController, users: UsersService) {
  const w = await workspace(ds);
  const sync = (entra as any).directorySync;
  const apply = sync.applyDirectoryProfile;
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const atGate = new Promise<void>((resolve) => { reached = resolve; });
  sync.applyDirectoryProfile = async (...args: any[]) => { reached(); await gate; return apply.apply(sync, args); };
  const unlinking = await openTransaction(ds, w.tenantId);
  try {
    const { outcome, done } = signIn(entra, w);
    done.catch(() => undefined);
    await atGate;
    let unlinked = false;
    const unlink = users
      .unlinkExternalSignIn(w.userId, null, { manager: unlinking.runner.manager })
      .then(() => unlinking.runner.commitTransaction())
      .finally(() => { unlinked = true; });
    unlink.catch(() => undefined);
    const state = await blockedOrSettled(ds, unlinking.pid, () => unlinked);
    release();
    await done;
    await unlink;
    assert.equal(state, 'blocked', 'the unlink waits for the sign-in that holds the account');
    assert.match(outcome.location, /handoff=/, 'the sign-in that came first opens its session');
    assert.deepEqual(await link(ds, w), { external_auth_provider: null, external_subject: null }, 'the unlink is kept');
  } finally {
    release();
    sync.applyDirectoryProfile = apply;
    await end(unlinking.runner);
  }
}

/**
 * While a sign-in holds the account, a row that references it is written without waiting (its
 * foreign key reads the account): a write that holds another lock first, then names the account
 * (a manager named), cannot meet a sign-in that holds the account and asks for that lock.
 */
async function testHeldAccountLeavesItsReferencesFree(ds: DataSource) {
  const w = await workspace(ds);
  const signInTx = await openTransaction(ds, w.tenantId);
  const writer = await openTransaction(ds, w.tenantId);
  try {
    await lockAccountForLink(signInTx.runner.manager, w.tenantId, w.userId);
    await writer.runner.query(`SET LOCAL lock_timeout = '2s'`);
    const [role] = await writer.runner.query(`SELECT role_id FROM users WHERE id = $1`, [w.userId]);
    await writer.runner.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`,
      [w.tenantId, w.userId, role.role_id],
    );
  } finally {
    await end(writer.runner);
    await end(signInTx.runner);
  }
}

async function run() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for entra-sign-in-unlink-race.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  const ds = app.get(DataSource);
  const entra = app.get(EntraController);
  const users = app.get(UsersService);
  const mails: string[] = [];
  const email = (entra as any).email;
  const send = email.sendEntraLinkConfirmationEmail;
  email.sendEntraLinkConfirmationEmail = async (input: { to: string }) => { mails.push(input.to); };
  const emailFlag = Features.EMAIL_ENABLED;
  (Features as any).EMAIL_ENABLED = true;
  let failures = 0;
  const tests: Array<[string, () => Promise<void>]> = [
    ['unlinked while the sign-in reads the account', () => testUnlinkWhileTheSignInReads(ds, entra, users, mails)],
    ['unlinked while the sign-in holds the account', () => testUnlinkWhileTheSignInHoldsTheAccount(ds, entra, users)],
    ['a held account leaves its references free', () => testHeldAccountLeavesItsReferencesFree(ds)],
  ];
  try {
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (error) {
        failures += 1;
        console.error(`not ok - ${name}`);
        console.error(error);
      }
    }
  } finally {
    email.sendEntraLinkConfirmationEmail = send;
    (Features as any).EMAIL_ENABLED = emailFlag;
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    for (const tenantId of created) {
      await withTenantExecution(ds, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
      await ds.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    }
    await app.close();
  }
  if (failures > 0) {
    console.error(`entra-sign-in-unlink-race.integration.spec: ${failures} failed`);
    process.exit(1);
  }
  console.log('entra-sign-in-unlink-race.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
