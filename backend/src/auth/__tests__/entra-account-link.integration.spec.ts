// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { Features } from '../../config/features';
import { User } from '../../users/user.entity';
import { EntraAuthService } from '../entra-auth.service';
import { EntraDirectorySyncService } from '../entra-directory-sync.service';
import { EntraController } from '../entra.controller';
import { linkConfirmationHash } from '../entra-link-confirmation';
import { waitForBackgroundWork } from '../../common/background-work';

// A Microsoft sign-in whose Microsoft account is not linked yet, against the database:
// - an existing account with the same address is not linked at sign-in: a confirmation link goes
//   to the account's address, and the account is linked once that link is confirmed;
// - the link works once, while it is the account's latest and until it expires, on its own
//   workspace; a password link of the account neither cancels it nor is cancelled by it;
// - a confirmation sent less than 5 minutes ago stands: no new link and no new e-mail, whichever
//   Microsoft account signs in; the e-mail names the Microsoft account that asked and is sent
//   after the answer, and a failed send is logged without the address or the link;
// - requests and confirmations of one account run one after the other: two requests at once leave
//   one link, two confirmations at once link once, and one Microsoft account confirmed for two
//   accounts at once links one of them;
// - an invited account without a local password is linked at its first Microsoft sign-in, without
//   a confirmation, and enabled; an invited account with a password, an enabled account without
//   one and a disabled account are not; two sign-ins at once link it once; an account of another
//   workspace is never found;
// - an account linked to another Microsoft account keeps that link;
// - linking writes only the link: the local password and the two-step secret stay;
// - without an e-mail service an existing account is not linked this way;
// - a Microsoft account already linked signs in as before, and an unknown address still gets an
//   account created at sign-in.

const TENANT_ID = randomUUID();
const OTHER_TENANT_ID = randomUUID();
const DIRECTORY_ID = randomUUID();
const SLUG = `entra-link-${TENANT_ID.slice(0, 8)}`;
const browser = { headers: { host: `${SLUG}.lvh.me` }, protocol: 'http' };

type Mail = { to: string; confirmUrl: string; microsoftAccount: { name: string | null; username: string | null }; requestedAt: Date };
const mails: Mail[] = [];
const errorLogs: string[] = [];
const recordMail = { sendEntraLinkConfirmationEmail: async (mail: Mail) => { mails.push(mail); } };
// The sign-in events the controller records, as SecurityEventsService receives them.
const authEvents: Array<{ tenantId: string; event: { action: string; userId?: string | null; reason?: string | null }; details: any }> = [];
const securityEvents = {
  recordAuthEvent: async (tenantId: string, event: any, details: any) => { authEvents.push({ tenantId, event, details }); },
};
let roleId = '';

async function inTenant(fn: (manager: any) => Promise<any>, tenantId = TENANT_ID): Promise<any> {
  return dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    return fn(manager);
  });
}

async function seedTenant(): Promise<void> {
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, sso_provider, entra_tenant_id, sso_enabled, created_at, updated_at)
     VALUES ($1, $2, 'Entra link', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb,
             'entra', $3, true, now(), now())`,
    [TENANT_ID, SLUG, DIRECTORY_ID],
  );
  await inTenant(async (manager) => {
    const [role] = await manager.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Budget Reader') RETURNING id`, [TENANT_ID]);
    roleId = role.id;
    await manager.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Contact')`, [TENANT_ID]);
  });
}

async function seedAccount(opts: { status?: string; password?: boolean; provider?: string; subject?: string } = {}) {
  const email = `person-${randomUUID().slice(0, 8)}@example.invalid`;
  const id = await inTenant(async (manager) => {
    const [user] = await manager.query(
      `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status, password_hash, mfa_enabled, mfa_secret,
                          external_auth_provider, external_subject)
       VALUES ($1, $2, 'Local', 'Person', $3, $4, $5, true, 'stored-mfa-secret', $6, $7) RETURNING id`,
      [TENANT_ID, roleId, email, opts.status ?? 'enabled', opts.password === false ? null : 'stored-password-hash',
        opts.provider ?? null, opts.subject ?? null],
    );
    return user.id as string;
  });
  return { id, email };
}

function controller(email: unknown = recordMail) {
  const entra = new EntraAuthService({ get: () => '' } as any);
  const tenants = {
    findById: async (id: string) => (id === TENANT_ID
      ? { id, slug: SLUG, sso_provider: 'entra', entra_tenant_id: DIRECTORY_ID }
      : { id, slug: 'other', sso_provider: 'entra', entra_tenant_id: DIRECTORY_ID }),
  };
  // Accounts created at sign-in, as UsersService.createUser does for this path.
  const users = {
    createUser: async (input: any, { manager }: any) => {
      const [role] = await manager.query(`SELECT id FROM roles WHERE tenant_id = $1 AND role_name = 'Contact'`, [TENANT_ID]);
      const [row] = await manager.query(
        `INSERT INTO users (tenant_id, role_id, email, status) VALUES ($1, $2, $3, $4) RETURNING id`,
        [TENANT_ID, role.id, input.email, input.status],
      );
      return row;
    },
    findById: (id: string, { manager }: any) => manager.getRepository(User).findOne({ where: { id }, relations: ['role'] }),
    // The end of an invitation, as UsersService.enableUser does within the seats.
    enableUser: async (id: string, _actor: string | null, { manager }: any) => {
      await manager.query(`UPDATE users SET status = 'enabled' WHERE tenant_id = $1 AND id = $2`, [TENANT_ID, id]);
    },
  };
  // The directory side is not reached: no Graph profile, no reporting line.
  const directorySync = new EntraDirectorySyncService(dataSource, null as any, null as any, null as any, null as any, null as any);
  return new EntraController(
    entra,
    tenants as any,
    {} as any,
    users as any,
    dataSource,
    new AuditService(dataSource.getRepository(AuditLog)),
    { notifySsoUserProvisioned: async () => undefined } as any,
    directorySync,
    securityEvents as any,
    email as any,
  );
}

async function signInWithMicrosoft(claims: Record<string, unknown>, email?: unknown): Promise<string> {
  let location = '';
  await (controller(email) as any).handleLoginCallback(
    TENANT_ID,
    SLUG,
    '/',
    { tid: DIRECTORY_ID, ...claims },
    null,
    browser,
    { redirect: (url: string) => { location = url; } },
  );
  // The e-mail goes out after the answer.
  assert.equal(await waitForBackgroundWork(Date.now() + 5000), 0);
  return location;
}

/** Makes the account's pending confirmations older, as if sent `minutes` earlier. */
async function ageLinks(userId: string, minutes: number) {
  await inTenant((manager) => manager.query(
    `UPDATE password_reset_tokens SET created_at = created_at - make_interval(mins => $2) WHERE user_id = $1`,
    [userId, minutes],
  ));
}

/** A pending confirmation stored as the sign-in stores one, for the concurrency checks. */
async function pendingLink(userId: string, email: string, oid: string): Promise<string> {
  const entra = new EntraAuthService({ get: () => '' } as any);
  const { token, expiresAt } = entra.signLinkConfirmation({ tenantId: TENANT_ID, userId, email, oid, tid: DIRECTORY_ID }, '1h');
  await inTenant((manager) => manager.query(
    `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [TENANT_ID, userId, linkConfirmationHash(token), expiresAt],
  ));
  return token;
}

/**
 * Runs `work` while another transaction holds the rows of `userIds` (accounts and their pending
 * links), and releases them once `waiting` calls wait on a lock: the calls then run at once.
 */
async function whileLocked<T>(userIds: string[], waiting: number, work: () => Promise<T>[]): Promise<T[]> {
  const holder = dataSource.createQueryRunner();
  await holder.connect();
  await holder.startTransaction();
  try {
    await holder.query(`SELECT set_config('app.current_tenant', $1, true)`, [TENANT_ID]);
    await holder.query(`SELECT id FROM users WHERE id = ANY($1::uuid[]) FOR UPDATE`, [userIds]);
    await holder.query(`SELECT id FROM password_reset_tokens WHERE user_id = ANY($1::uuid[]) FOR UPDATE`, [userIds]);
    const calls = work();
    const deadline = Date.now() + 5000;
    for (;;) {
      const [row] = await dataSource.query(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`,
      );
      if (row.n >= waiting) break;
      assert.ok(Date.now() < deadline, `the ${waiting} calls wait on the held rows`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await holder.commitTransaction();
    return await Promise.all(calls);
  } finally {
    if (holder.isTransactionActive) await holder.rollbackTransaction();
    await holder.release();
  }
}

async function validLinks(userId: string): Promise<number> {
  const [row] = await inTenant((manager) => manager.query(
    `SELECT count(*)::int AS n FROM password_reset_tokens
     WHERE user_id = $1 AND token_hash LIKE 'entra-link:%' AND used_at IS NULL AND expires_at > now()`,
    [userId],
  ));
  return row.n;
}

async function refusedSignIn(claims: Record<string, unknown>): Promise<string> {
  try {
    await signInWithMicrosoft(claims);
  } catch (error: any) {
    return String(error?.message);
  }
  assert.fail('the sign-in is refused');
}

function tokenOf(mail: Mail): string {
  const token = new URLSearchParams(mail.confirmUrl.split('#')[1] ?? '').get('token');
  assert.ok(token, 'the link carries its token in the fragment');
  return token as string;
}

async function confirm(token: string, tenantId = TENANT_ID): Promise<string> {
  try {
    const result = await controller().confirmLink({ token }, { tenant: { id: tenantId } });
    assert.deepEqual(result, { linked: true });
    return 'linked';
  } catch (error: any) {
    return String(error?.message);
  }
}

async function account(userId: string) {
  return inTenant(async (manager) => {
    const [row] = await manager.query(
      `SELECT email, status, external_auth_provider, external_subject, password_hash, mfa_enabled, mfa_secret FROM users WHERE id = $1`,
      [userId],
    );
    return row;
  });
}

async function linkRows(userId: string) {
  return inTenant((manager) => manager.query(
    `SELECT token_hash, used_at FROM password_reset_tokens WHERE user_id = $1 ORDER BY created_at, id`,
    [userId],
  ));
}

async function testExistingAccountIsLinkedOnlyAfterConfirmation() {
  const person = await seedAccount();
  const oid = `oid-${randomUUID()}`;
  mails.length = 0;

  const location = await signInWithMicrosoft({
    oid,
    email: person.email.toUpperCase(),
    name: 'Julie Martin',
    preferred_username: 'julie.martin@contoso.test',
  });
  assert.equal(location, `http://${SLUG}.lvh.me/login?ssoNotice=ENTRA_LINK_SENT#${new URLSearchParams({ to: person.email })}`);
  let row = await account(person.id);
  assert.equal(row.external_auth_provider, null, 'no link at sign-in');
  assert.equal(row.external_subject, null);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, person.email, 'sent to the account address');
  assert.ok(mails[0].confirmUrl.startsWith(`http://${SLUG}.lvh.me/login/link-microsoft#token=`));
  assert.deepEqual(mails[0].microsoftAccount, { name: 'Julie Martin', username: 'julie.martin@contoso.test' });
  assert.ok(mails[0].requestedAt instanceof Date);
  const rows = await linkRows(person.id);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].token_hash.startsWith('entra-link:'), 'stored apart from the password links');

  const token = tokenOf(mails[0]);
  assert.equal(await confirm(token, OTHER_TENANT_ID), 'ENTRA_LINK_INVALID', 'refused on another workspace');
  assert.equal(await confirm(token), 'linked');
  row = await account(person.id);
  assert.equal(row.external_auth_provider, 'entra');
  assert.equal(row.external_subject, oid);
  assert.equal(row.password_hash, 'stored-password-hash', 'the local password stays');
  assert.equal(row.mfa_enabled, true);
  assert.equal(row.mfa_secret, 'stored-mfa-secret', 'the two-step secret stays');
  const audit = await inTenant((manager) => manager.query(
    `SELECT count(*)::int AS n FROM audit_log WHERE record_id = $1 AND source_ref = 'entra-link-confirmed'`,
    [person.id],
  ));
  assert.equal(audit[0].n, 1);

  assert.equal(await confirm(token), 'ENTRA_LINK_INVALID', 'a link works once');

  // The linked Microsoft account now signs in as before.
  mails.length = 0;
  assert.match(await signInWithMicrosoft({ oid, email: person.email }), /\/login\/callback#handoff=/);
  assert.equal(mails.length, 0);
  assert.equal((await account(person.id)).password_hash, 'stored-password-hash');
}

async function testExpiredOrReplacedLinksAreRefused() {
  const person = await seedAccount();
  mails.length = 0;
  await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email });
  await inTenant((manager) => manager.query(
    `UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = $1`,
    [person.id],
  ));
  assert.equal(await confirm(tokenOf(mails[0])), 'ENTRA_LINK_INVALID', 'an expired link is refused');

  const first = `oid-${randomUUID()}`;
  const second = `oid-${randomUUID()}`;
  mails.length = 0;
  await signInWithMicrosoft({ oid: first, email: person.email });
  await ageLinks(person.id, 6);
  await signInWithMicrosoft({ oid: second, email: person.email });
  assert.equal(mails.length, 2);
  assert.equal(await confirm(tokenOf(mails[0])), 'ENTRA_LINK_INVALID', 'a newer link replaces the earlier one');
  assert.equal(await confirm(tokenOf(mails[1])), 'linked');
  assert.equal((await account(person.id)).external_subject, second);

  assert.equal(await confirm('not-a-link'), 'ENTRA_LINK_INVALID');
}

async function testPasswordLinksAndConfirmationsAreIndependent() {
  const person = await seedAccount();
  const resetHash = createHash('sha256').update(randomUUID()).digest('hex');
  const insertReset = (hash: string) => inTenant((manager) => manager.query(
    `INSERT INTO password_reset_tokens (tenant_id, user_id, token_hash, expires_at) VALUES ($1, $2, $3, now() + interval '1 hour')`,
    [TENANT_ID, person.id, hash],
  ));
  await insertReset(resetHash);
  mails.length = 0;
  await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email });
  // A password reset asked after the sign-in.
  await insertReset(createHash('sha256').update(randomUUID()).digest('hex'));

  const resetRows = (await linkRows(person.id)).filter((row: any) => !row.token_hash.startsWith('entra-link:'));
  assert.equal(resetRows.length, 2);
  assert.ok(resetRows.every((row: any) => row.used_at === null), 'the password links stay usable');
  assert.equal(await confirm(tokenOf(mails[0])), 'linked', 'a later password link does not cancel the confirmation');
}

async function testRecentLinkHoldsOffAnother() {
  const person = await seedAccount();
  const first = `oid-${randomUUID()}`;
  mails.length = 0;
  const sent = await signInWithMicrosoft({ oid: first, email: person.email, name: 'First', preferred_username: 'first@contoso.test' });
  assert.equal(await signInWithMicrosoft({ oid: first, email: person.email }), sent, 'the same message');
  // Another Microsoft account with the same address, within 5 minutes.
  assert.equal(
    await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email, name: 'Second', preferred_username: 'second@contoso.test' }),
    sent,
    'the same message',
  );
  assert.equal(mails.length, 1, 'one e-mail');
  assert.equal((await linkRows(person.id)).length, 1, 'one link');
  assert.equal(mails[0].microsoftAccount.username, 'first@contoso.test');
  assert.equal(await confirm(tokenOf(mails[0])), 'linked');
  assert.equal((await account(person.id)).external_subject, first, 'the Microsoft account the e-mail names');
}

async function testFailedDeliveryIsLoggedWithoutAddress() {
  const person = await seedAccount();
  errorLogs.length = 0;
  let url = '';
  const failing = {
    sendEntraLinkConfirmationEmail: async (mail: Mail) => {
      url = mail.confirmUrl;
      throw new Error(`550 ${mail.to} refused ${mail.confirmUrl}`);
    },
  };
  assert.match(await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email }, failing), /ssoNotice=ENTRA_LINK_SENT/);
  const token = new URLSearchParams(url.split('#')[1]).get('token') as string;
  const logged = errorLogs.join('\n');
  assert.match(logged, /link confirmation e-mail not sent/);
  assert.ok(!logged.includes(person.email) && !logged.includes(token), logged);
}

/**
 * A link request is a sign-in event, as a password reset request: the account, the address and
 * agent of the sign-in, and `email_not_sent` when its e-mail could not be sent. A request held off
 * by a recent confirmation makes no link and records nothing.
 */
async function testLinkRequestIsRecorded() {
  const person = await seedAccount();
  authEvents.length = 0;
  await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email });
  assert.deepEqual(
    authEvents.map(({ tenantId, event }) => ({ tenantId, ...event })),
    [{ tenantId: TENANT_ID, action: 'sso_link_requested', userId: person.id, reason: null }],
  );
  assert.ok('ip' in authEvents[0].details && 'headers' in authEvents[0].details, 'the address and agent of the sign-in');

  authEvents.length = 0;
  await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email });
  assert.equal(authEvents.length, 0, 'a request held off records nothing');

  const other = await seedAccount();
  const failing = { sendEntraLinkConfirmationEmail: async () => { throw new Error('550 refused'); } };
  await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: other.email }, failing);
  assert.deepEqual(
    authEvents.map(({ event }) => ({ ...event })),
    [{ action: 'sso_link_requested', userId: other.id, reason: 'email_not_sent' }],
  );
}

async function testConcurrentRequestsLeaveOneLink() {
  const person = await seedAccount();
  await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email });
  await ageLinks(person.id, 10);
  mails.length = 0;
  const locations = await whileLocked([person.id], 2, () => [
    signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email }),
    signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email }),
  ]);
  assert.ok(locations.every((location) => /ssoNotice=ENTRA_LINK_SENT/.test(location)));
  assert.equal(await validLinks(person.id), 1, 'one valid link');
  assert.equal(mails.length, 1, 'one e-mail');
}

async function testConcurrentConfirmationsLinkOnce() {
  const person = await seedAccount();
  const tokens = [
    await pendingLink(person.id, person.email, `oid-${randomUUID()}`),
    await pendingLink(person.id, person.email, `oid-${randomUUID()}`),
  ];
  const results = await whileLocked([person.id], 2, () => tokens.map((token) => confirm(token)));
  assert.deepEqual([...results].sort(), ['ENTRA_ACCOUNT_LINKED', 'linked']);
  const audit = await inTenant((manager) => manager.query(
    `SELECT count(*)::int AS n FROM audit_log WHERE record_id = $1 AND source_ref = 'entra-link-confirmed'`,
    [person.id],
  ));
  assert.equal(audit[0].n, 1, 'one audit entry, for the link made');
}

async function testOneMicrosoftAccountForTwoAccountsAtOnce() {
  const a = await seedAccount();
  const b = await seedAccount();
  const oid = `oid-${randomUUID()}`;
  const tokens = [await pendingLink(a.id, a.email, oid), await pendingLink(b.id, b.email, oid)];
  const results = await whileLocked([a.id, b.id], 2, () => tokens.map((token) => confirm(token)));
  assert.deepEqual([...results].sort(), ['ENTRA_ACCOUNT_LINKED', 'linked']);
  const subjects = [(await account(a.id)).external_subject, (await account(b.id)).external_subject];
  assert.equal(subjects.filter((subject) => subject === oid).length, 1);
}

async function testLinkedAccountKeepsItsLink() {
  const person = await seedAccount({ provider: 'entra', subject: 'oid-first' });
  mails.length = 0;
  assert.equal(await refusedSignIn({ oid: `oid-${randomUUID()}`, email: person.email }), 'ENTRA_ACCOUNT_LINKED');
  assert.equal(await refusedSignIn({ oid: `oid-${randomUUID()}`, preferred_username: person.email }), 'ENTRA_ACCOUNT_LINKED');
  const row = await account(person.id);
  assert.equal(row.external_subject, 'oid-first', 'the link is unchanged');
  assert.equal(mails.length, 0);
  assert.equal((await linkRows(person.id)).length, 0);
}

async function testConfirmationIsRefusedWhenTheMicrosoftAccountIsTaken() {
  const person = await seedAccount();
  const oid = `oid-${randomUUID()}`;
  mails.length = 0;
  await signInWithMicrosoft({ oid, email: person.email });
  await seedAccount({ provider: 'entra', subject: oid });
  assert.equal(await confirm(tokenOf(mails[0])), 'ENTRA_ACCOUNT_LINKED');
  assert.equal((await account(person.id)).external_auth_provider, null);
}

async function testInvitedAccountWithoutPasswordIsLinkedAtSignIn() {
  const person = await seedAccount({ status: 'invited', password: false });
  const oid = `oid-${randomUUID()}`;
  mails.length = 0;
  assert.match(await signInWithMicrosoft({ oid, email: person.email.toUpperCase() }), /\/login\/callback#handoff=/);
  const row = await account(person.id);
  assert.equal(row.external_auth_provider, 'entra');
  assert.equal(row.external_subject, oid);
  assert.equal(row.status, 'enabled', 'the invitation ends, as after an accepted invitation');
  assert.equal(row.password_hash, null);
  assert.equal(mails.length, 0, 'no confirmation');
  assert.equal((await linkRows(person.id)).length, 0);
  const audit = await inTenant((manager) => manager.query(
    `SELECT count(*)::int AS n FROM audit_log WHERE record_id = $1 AND source_ref = 'entra-auto-link'`,
    [person.id],
  ));
  assert.equal(audit[0].n, 1);
}

async function testOtherAccountsStillNeedConfirmation() {
  for (const opts of [{ status: 'invited', password: true }, { status: 'enabled', password: false }]) {
    const person = await seedAccount(opts);
    mails.length = 0;
    assert.match(await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email }), /ssoNotice=ENTRA_LINK_SENT/, JSON.stringify(opts));
    const row = await account(person.id);
    assert.equal(row.external_auth_provider, null, JSON.stringify(opts));
    assert.equal(row.status, opts.status);
    assert.equal(mails.length, 1);
  }
  const disabled = await seedAccount({ status: 'disabled', password: false });
  mails.length = 0;
  assert.equal(await refusedSignIn({ oid: `oid-${randomUUID()}`, email: disabled.email }), 'Entra user is not allowed to sign in');
  assert.equal((await account(disabled.id)).external_auth_provider, null);
  assert.equal(mails.length, 0);
}

async function testInvitedAccountTwoSignInsAtOnce() {
  const person = await seedAccount({ status: 'invited', password: false });
  const attempt = (oid: string) => signInWithMicrosoft({ oid, email: person.email }).catch((error) => String(error?.message));
  const results = await whileLocked([person.id], 2, () => [attempt(`oid-${randomUUID()}`), attempt(`oid-${randomUUID()}`)]);
  assert.equal(results.filter((result) => /\/login\/callback#handoff=/.test(result)).length, 1, results.join(' | '));
  assert.equal(results.filter((result) => result === 'ENTRA_ACCOUNT_LINKED').length, 1, results.join(' | '));
}

async function testInvitedAccountOfAnotherWorkspaceIsNotFound() {
  const email = `invited-${randomUUID().slice(0, 8)}@example.invalid`;
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Entra link other', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [OTHER_TENANT_ID, `entra-link-other-${OTHER_TENANT_ID.slice(0, 8)}`],
  );
  const otherId = await inTenant(async (manager) => {
    const [role] = await manager.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Budget Reader') RETURNING id`, [OTHER_TENANT_ID]);
    const [user] = await manager.query(
      `INSERT INTO users (tenant_id, role_id, email, status) VALUES ($1, $2, $3, 'invited') RETURNING id`,
      [OTHER_TENANT_ID, role.id, email],
    );
    return user.id as string;
  }, OTHER_TENANT_ID);
  const oid = `oid-${randomUUID()}`;
  assert.match(await signInWithMicrosoft({ oid, email }), /\/login\/callback#handoff=/);
  const [other] = await inTenant(
    (manager) => manager.query(`SELECT status, external_subject FROM users WHERE id = $1`, [otherId]),
    OTHER_TENANT_ID,
  );
  assert.deepEqual({ ...other }, { status: 'invited', external_subject: null }, 'the other workspace is untouched');
  const [created] = await inTenant((manager) => manager.query(`SELECT external_subject FROM users WHERE email = $1`, [email]));
  assert.equal(created.external_subject, oid, 'an account created at sign-in in this workspace');
}

async function testWithoutEmailServiceNoLink() {
  const person = await seedAccount();
  mails.length = 0;
  const previous = Features.EMAIL_ENABLED;
  (Features as any).EMAIL_ENABLED = false;
  try {
    assert.equal(await refusedSignIn({ oid: `oid-${randomUUID()}`, email: person.email }), 'ENTRA_LINK_NEEDS_EMAIL');
  } finally {
    (Features as any).EMAIL_ENABLED = previous;
  }
  assert.equal((await account(person.id)).external_auth_provider, null);
  assert.equal((await linkRows(person.id)).length, 0);
  assert.equal(mails.length, 0);
}

async function testUnknownAddressStillCreatesAnAccount() {
  const email = `newcomer-${randomUUID().slice(0, 8)}@example.invalid`;
  const oid = `oid-${randomUUID()}`;
  mails.length = 0;
  assert.match(await signInWithMicrosoft({ oid, email }), /\/login\/callback#handoff=/);
  const [row] = await inTenant((manager) => manager.query(
    `SELECT external_auth_provider, external_subject FROM users WHERE email = $1`,
    [email],
  ));
  assert.deepEqual({ ...row }, { external_auth_provider: 'entra', external_subject: oid });
  assert.equal(mails.length, 0);
}

async function cleanup() {
  await inTenant(async (manager) => {
    await manager.query(`DELETE FROM audit_log WHERE tenant_id = $1`, [TENANT_ID]);
    await manager.query(`DELETE FROM password_reset_tokens WHERE tenant_id = $1`, [TENANT_ID]);
    await manager.query(`DELETE FROM users WHERE tenant_id = $1`, [TENANT_ID]);
    await manager.query(`DELETE FROM roles WHERE tenant_id = $1`, [TENANT_ID]);
  }).catch((error) => console.error('cleanup', error));
  await inTenant(async (manager) => {
    await manager.query(`DELETE FROM users WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
    await manager.query(`DELETE FROM roles WHERE tenant_id = $1`, [OTHER_TENANT_ID]);
  }, OTHER_TENANT_ID).catch(() => undefined);
  await dataSource.query(`DELETE FROM tenants WHERE id = ANY($1::uuid[])`, [[TENANT_ID, OTHER_TENANT_ID]]).catch(() => undefined);
}

async function main() {
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://lvh.me';
  Logger.overrideLogger({
    log: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
    error: (message: unknown) => { errorLogs.push(String(message)); },
  });
  // The CI runner gives every spec one; run alone, the spec signs its links with a key of its own.
  process.env.JWT_SECRET = process.env.JWT_SECRET || `entra-link-spec-${randomUUID()}`;
  (Features as any).EMAIL_ENABLED = true;
  await dataSource.initialize();
  try {
    await seedTenant();
    const tests: Array<() => Promise<void>> = [
      testExistingAccountIsLinkedOnlyAfterConfirmation,
      testExpiredOrReplacedLinksAreRefused,
      testPasswordLinksAndConfirmationsAreIndependent,
      testRecentLinkHoldsOffAnother,
      testFailedDeliveryIsLoggedWithoutAddress,
      testLinkRequestIsRecorded,
      testConcurrentRequestsLeaveOneLink,
      testConcurrentConfirmationsLinkOnce,
      testOneMicrosoftAccountForTwoAccountsAtOnce,
      testLinkedAccountKeepsItsLink,
      testConfirmationIsRefusedWhenTheMicrosoftAccountIsTaken,
      testInvitedAccountWithoutPasswordIsLinkedAtSignIn,
      testOtherAccountsStillNeedConfirmation,
      testInvitedAccountTwoSignInsAtOnce,
      testInvitedAccountOfAnotherWorkspaceIsNotFound,
      testWithoutEmailServiceNoLink,
      testUnknownAddressStillCreatesAnAccount,
    ];
    // A name on the command line runs the tests whose name contains it.
    const only = process.argv[2];
    for (const test of tests) {
      if (only && !test.name.includes(only)) continue;
      await test();
    }
  } finally {
    await cleanup();
    await dataSource.destroy();
  }
  console.log('entra-account-link.integration.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
