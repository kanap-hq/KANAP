// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { Features } from '../../config/features';
import { User } from '../../users/user.entity';
import { EntraAuthService } from '../entra-auth.service';
import { EntraDirectorySyncService } from '../entra-directory-sync.service';
import { EntraController } from '../entra.controller';

// A Microsoft sign-in whose Microsoft account is not linked yet, against the database:
// - an existing account with the same address is not linked at sign-in: a confirmation link goes
//   to the account's address, and the account is linked once that link is confirmed;
// - the link works once, while it is the account's latest and until it expires, on its own
//   workspace; a password link of the account neither cancels it nor is cancelled by it;
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

type Mail = { to: string; confirmUrl: string };
const mails: Mail[] = [];
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

function controller() {
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
  };
  const email = { sendEntraLinkConfirmationEmail: async (mail: Mail) => { mails.push(mail); } };
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
    {} as any,
    email as any,
  );
}

async function signInWithMicrosoft(claims: Record<string, unknown>): Promise<string> {
  let location = '';
  await (controller() as any).handleLoginCallback(
    TENANT_ID,
    SLUG,
    '/',
    { tid: DIRECTORY_ID, ...claims },
    null,
    browser,
    { redirect: (url: string) => { location = url; } },
  );
  return location;
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

  const location = await signInWithMicrosoft({ oid, email: person.email.toUpperCase() });
  assert.equal(location, `http://${SLUG}.lvh.me/login?ssoNotice=ENTRA_LINK_SENT#${new URLSearchParams({ to: person.email })}`);
  let row = await account(person.id);
  assert.equal(row.external_auth_provider, null, 'no link at sign-in');
  assert.equal(row.external_subject, null);
  assert.equal(mails.length, 1);
  assert.equal(mails[0].to, person.email, 'sent to the account address');
  assert.ok(mails[0].confirmUrl.startsWith(`http://${SLUG}.lvh.me/login/link-microsoft#token=`));
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

async function testInvitedAccountAlsoWaitsForConfirmation() {
  const person = await seedAccount({ status: 'invited', password: false });
  mails.length = 0;
  assert.match(await signInWithMicrosoft({ oid: `oid-${randomUUID()}`, email: person.email }), /ssoNotice=ENTRA_LINK_SENT/);
  const row = await account(person.id);
  assert.equal(row.external_auth_provider, null);
  assert.equal(row.status, 'invited');
  assert.equal(mails.length, 1);
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
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [TENANT_ID]).catch(() => undefined);
}

async function main() {
  process.env.APP_BASE_URL = process.env.APP_BASE_URL || 'http://lvh.me';
  // The CI runner gives every spec one; run alone, the spec signs its links with a key of its own.
  process.env.JWT_SECRET = process.env.JWT_SECRET || `entra-link-spec-${randomUUID()}`;
  (Features as any).EMAIL_ENABLED = true;
  await dataSource.initialize();
  try {
    await seedTenant();
    await testExistingAccountIsLinkedOnlyAfterConfirmation();
    await testExpiredOrReplacedLinksAreRefused();
    await testPasswordLinksAndConfirmationsAreIndependent();
    await testLinkedAccountKeepsItsLink();
    await testConfirmationIsRefusedWhenTheMicrosoftAccountIsTaken();
    await testInvitedAccountAlsoWaitsForConfirmation();
    await testWithoutEmailServiceNoLink();
    await testUnknownAddressStillCreatesAnAccount();
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
