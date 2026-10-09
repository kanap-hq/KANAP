import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import dataSource from '../../data-source';
import { ensureBootstrapAdministrator, BootstrapAdministratorParams } from '../bootstrap-admin';
import { BOOTSTRAP_PASSWORD_WARNING } from '../../common/startup-secrets';
import { UsersController } from '../../users/users.controller';
import {
  buildServices,
  cleanupTenants,
  countDifferences,
  countTenantRows,
  inTenant,
  runSpecs,
} from '../../admin/tenants/__tests__/tenant-reset-test-helpers';

// The administrator account of ADMIN_EMAIL at start-up (main.ts): created only when the workspace
// has no active administrator (enabled, holding the Administrator role as main role or through a
// role link, and able to sign in with its main role). An existing account is left as it is, except
// when no active administrator remains: then it is restored as an enabled administrator whose only
// primary role is Administrator, and keeps its password. The [SECURITY] password line appears only
// while the account's password is still ADMIN_PASSWORD and that value is an example one or short.

const STRONG_PASSWORD = 'vT9!rK2#pQ8$wL5^zN3&';
const EXAMPLE_PASSWORD = 'ChangeThisPassword123!';

type AccountState = {
  id: string;
  role_id: string;
  status: string;
  password_hash: string | null;
  updated_at: string;
  links: string;
};

async function newTenant(): Promise<{ tenantId: string; slug: string }> {
  const svc = buildServices();
  const slug = `bootstrap-admin-${randomUUID().slice(0, 8)}`;
  const tenant = await svc.tenants.createTenant({ slug, name: 'Bootstrap Org' });
  return { tenantId: tenant.id, slug };
}

function paramsFor(slug: string, email: string, password: string, checkPassword = true): BootstrapAdministratorParams {
  return { tenantSlug: slug, email, password, checkPassword };
}

/** Runs the call with the console captured; returns its result and the lines it printed. */
async function quietly<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const { log, warn } = console;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  console.warn = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = log;
    console.warn = warn;
  }
}

async function accountState(tenantId: string, email: string): Promise<AccountState | null> {
  const [row] = await inTenant(tenantId, (manager) => manager.query(
    `SELECT u.id, u.role_id, u.status, u.password_hash, u.updated_at::text AS updated_at,
            coalesce((SELECT string_agg(r.role_name || ':' || ur.is_primary, ',' ORDER BY r.role_name)
                        FROM user_roles ur JOIN roles r ON r.id = ur.role_id AND r.tenant_id = ur.tenant_id
                       WHERE ur.tenant_id = u.tenant_id AND ur.user_id = u.id), '') AS links
       FROM users u WHERE u.tenant_id = $1 AND u.email = $2`,
    [tenantId, email],
  ));
  return row ?? null;
}

async function roleId(tenantId: string, roleName: string): Promise<string> {
  const [row] = await inTenant(tenantId, (manager) =>
    manager.query(`SELECT id FROM roles WHERE tenant_id = $1 AND role_name = $2`, [tenantId, roleName]));
  return row.id;
}

/** Moves the user to the Contact role: main role and role links, as a role change in the application does. */
async function demote(tenantId: string, userId: string) {
  const contact = await roleId(tenantId, 'Contact');
  await inTenant(tenantId, async (manager) => {
    await manager.query(`UPDATE users SET role_id = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, userId, contact]);
    await manager.query(`DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2`, [tenantId, userId]);
    await manager.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`,
      [tenantId, userId, contact],
    );
  });
}

async function setStatus(tenantId: string, userId: string, status: string) {
  await inTenant(tenantId, (manager) =>
    manager.query(`UPDATE users SET status = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, userId, status]));
}

async function addAdministrator(tenantId: string): Promise<string> {
  const svc = buildServices();
  return inTenant(tenantId, async (manager) => (await svc.users.createUser({
    email: `other-admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`,
    role_name: 'Administrator',
    password: STRONG_PASSWORD,
    status: 'enabled',
    tenant_id: tenantId,
  } as any, { manager })).id);
}

/** Adds a role link that is not primary, as the role picker does for a second role. */
async function addRoleLink(tenantId: string, userId: string, roleName: string) {
  const role = await roleId(tenantId, roleName);
  await inTenant(tenantId, (manager) => manager.query(
    `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`,
    [tenantId, userId, role],
  ));
}

async function addUser(tenantId: string, roleName: string, status = 'enabled'): Promise<string> {
  const svc = buildServices();
  return inTenant(tenantId, async (manager) => (await svc.users.createUser({
    email: `user-${randomUUID().slice(0, 8)}@bootstrap-spec.test`,
    role_name: roleName,
    status,
    tenant_id: tenantId,
  } as any, { manager })).id);
}

async function markSignsInThroughProvider(tenantId: string, userId: string) {
  await inTenant(tenantId, (manager) => manager.query(
    `UPDATE users SET external_auth_provider = 'entra' WHERE tenant_id = $1 AND id = $2`, [tenantId, userId]));
}

/** The roles of the user as the role screens read them (GET /users/:id/roles), in their order. */
async function rolesAsListed(tenantId: string, userId: string): Promise<Array<{ name: string | null; is_primary: boolean }>> {
  const listed = await inTenant(tenantId, (manager) =>
    UsersController.prototype.getUserRoles.call(null, userId, { queryRunner: { manager } }));
  return listed.items.map(({ name, is_primary }: { name: string | null; is_primary: boolean }) => ({ name, is_primary }));
}

async function testCreatedOnceThenLeftAlone() {
  const { tenantId, slug } = await newTenant();
  const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    const first = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(first.result.outcome, 'created');
    assert.deepEqual(first.result.warnings, []);
    assert.ok(first.lines.some((line) => line.includes(`Created administrator account ${email}`)), 'creation is logged');
    const created = await accountState(tenantId, email);
    assert.ok(created, 'the account exists');
    assert.equal(created.status, 'enabled');
    assert.equal(created.role_id, await roleId(tenantId, 'Administrator'));
    assert.equal(created.links, 'Administrator:true');
    assert.equal(await argon2.verify(created.password_hash!, STRONG_PASSWORD), true);

    // A second start: nothing changes, the password hash included.
    const counts = await countTenantRows(tenantId);
    const second = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(second.result.outcome, 'unchanged');
    assert.deepEqual(await accountState(tenantId, email), created);
    assert.deepEqual(countDifferences(counts, await countTenantRows(tenantId)), []);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testDemotedWithAnotherAdministratorStaysDemoted() {
  const { tenantId, slug } = await newTenant();
  const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    await addAdministrator(tenantId);
    const account = (await accountState(tenantId, email))!;
    await demote(tenantId, account.id);
    const demoted = await accountState(tenantId, email);

    const { result } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(result.outcome, 'unchanged');
    assert.deepEqual(await accountState(tenantId, email), demoted, 'role, links, status and password untouched');
    assert.equal(demoted!.role_id, await roleId(tenantId, 'Contact'));
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testNoActiveAdministratorRestoresTheAccount() {
  const { tenantId, slug } = await newTenant();
  const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    const otherId = await addAdministrator(tenantId);
    const account = (await accountState(tenantId, email))!;
    // The password was changed in the application since.
    const changedHash = await argon2.hash('a password set later in the app', { type: argon2.argon2id });
    await inTenant(tenantId, (manager) =>
      manager.query(`UPDATE users SET password_hash = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, account.id, changedHash]));
    await demote(tenantId, account.id);
    await setStatus(tenantId, account.id, 'disabled');
    // The other administrator is disabled too: no active administrator remains.
    await setStatus(tenantId, otherId, 'disabled');

    const { result, lines } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(result.outcome, 'restored');
    assert.ok(lines.some((line) => line.includes(`Restored ${email} as an enabled administrator`) && line.includes('password unchanged')),
      'the restoration is logged');
    const restored = (await accountState(tenantId, email))!;
    assert.equal(restored.id, account.id, 'the same account');
    assert.equal(restored.status, 'enabled');
    assert.equal(restored.role_id, await roleId(tenantId, 'Administrator'));
    assert.equal(restored.links, 'Administrator:true,Contact:false', 'Administrator is the only primary link, Contact kept');
    assert.equal(restored.password_hash, changedHash, 'password untouched');
    // The role screens list Administrator first, so saving the roles keeps it as the main role.
    assert.deepEqual(await rolesAsListed(tenantId, account.id), [
      { name: 'Administrator', is_primary: true },
      { name: 'Contact', is_primary: false },
    ]);

    // The other administrator is left as it is.
    const [other] = await inTenant(tenantId, (manager) =>
      manager.query(`SELECT status FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, otherId]));
    assert.equal(other.status, 'disabled');

    // Next start: an active administrator exists again, nothing changes.
    const again = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(again.result.outcome, 'unchanged');
    assert.deepEqual(await accountState(tenantId, email), restored);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testAccountWithoutPasswordGetsTheStartupOneWhenRestored() {
  const { tenantId, slug } = await newTenant();
  const email = `contact-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    const svc = buildServices();
    // A directory contact with the ADMIN_EMAIL address, no password, and no administrator at all.
    await inTenant(tenantId, (manager) => svc.users.createUser({
      email, role_name: 'Contact', status: 'contact', tenant_id: tenantId,
    } as any, { manager }));
    const { result } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(result.outcome, 'restored');
    const restored = (await accountState(tenantId, email))!;
    assert.equal(restored.status, 'enabled');
    assert.equal(restored.role_id, await roleId(tenantId, 'Administrator'));
    assert.equal(await argon2.verify(restored.password_hash!, STRONG_PASSWORD), true);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testIdentityProviderAccountGetsNoLocalPassword() {
  const { tenantId, slug } = await newTenant();
  const email = `sso-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    const svc = buildServices();
    // An account of the identity provider with the ADMIN_EMAIL address, no password, no administrator at all.
    const userId = await inTenant(tenantId, async (manager) => (await svc.users.createUser({
      email, role_name: 'Contact', status: 'enabled', tenant_id: tenantId,
    } as any, { manager })).id);
    await markSignsInThroughProvider(tenantId, userId);

    const { result, lines } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, EXAMPLE_PASSWORD)));
    assert.equal(result.outcome, 'restored');
    assert.deepEqual(result.warnings, [], 'no [SECURITY] line: the account has no password');
    assert.ok(lines.some((line) => line.includes(`Restored ${email}`) && line.includes('signs in through the identity provider')),
      'the restoration says the account keeps signing in through the identity provider');
    assert.ok(!lines.some((line) => line.includes('[SECURITY]')));
    const restored = (await accountState(tenantId, email))!;
    assert.equal(restored.status, 'enabled');
    assert.equal(restored.role_id, await roleId(tenantId, 'Administrator'));
    assert.equal(restored.links, 'Administrator:true,Contact:false');
    assert.equal(restored.password_hash, null, 'no local password');
  } finally {
    await cleanupTenants([tenantId]);
  }
}

/**
 * Which other user counts as an active administrator: with one, the ADMIN_EMAIL account is not
 * created ('unchanged'); without, it is ('created').
 */
async function testWhoCountsAsActiveAdministrator() {
  const cases: Array<{ name: string; expected: 'unchanged' | 'created'; setup: (tenantId: string) => Promise<void> }> = [
    {
      name: 'main role Administrator, no role link',
      expected: 'unchanged',
      setup: async (tenantId) => {
        const id = await addAdministrator(tenantId);
        await inTenant(tenantId, (manager) =>
          manager.query(`DELETE FROM user_roles WHERE tenant_id = $1 AND user_id = $2`, [tenantId, id]));
      },
    },
    {
      name: 'Administrator link, main role a workspace role',
      expected: 'unchanged',
      setup: async (tenantId) => addRoleLink(tenantId, await addUser(tenantId, 'Budget reviewer'), 'Administrator'),
    },
    {
      name: 'local account, Administrator link, main role Contact',
      expected: 'created',
      setup: async (tenantId) => addRoleLink(tenantId, await addUser(tenantId, 'Contact'), 'Administrator'),
    },
    {
      name: 'identity provider account, Administrator link, main role Contact',
      expected: 'unchanged',
      setup: async (tenantId) => {
        const id = await addUser(tenantId, 'Contact');
        await addRoleLink(tenantId, id, 'Administrator');
        await markSignsInThroughProvider(tenantId, id);
      },
    },
    {
      name: 'invited administrator',
      expected: 'created',
      setup: async (tenantId) => setStatus(tenantId, await addAdministrator(tenantId), 'invited'),
    },
    {
      name: 'disabled administrator',
      expected: 'created',
      setup: async (tenantId) => setStatus(tenantId, await addAdministrator(tenantId), 'disabled'),
    },
  ];
  for (const testCase of cases) {
    const { tenantId, slug } = await newTenant();
    const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
    try {
      await testCase.setup(tenantId);
      const { result } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
      assert.equal(result.outcome, testCase.expected, testCase.name);
    } finally {
      await cleanupTenants([tenantId]);
    }
  }

  // An administrator of another workspace does not count.
  const other = await newTenant();
  const { tenantId, slug } = await newTenant();
  try {
    await addAdministrator(other.tenantId);
    const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
    const { result } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(result.outcome, 'created', 'administrator of another workspace');
  } finally {
    await cleanupTenants([tenantId, other.tenantId]);
  }
}

async function testDeletedWithAnotherAdministratorIsNotRecreated() {
  const { tenantId, slug } = await newTenant();
  const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    await addAdministrator(tenantId);
    const account = (await accountState(tenantId, email))!;
    await inTenant(tenantId, (manager) =>
      manager.query(`DELETE FROM users WHERE tenant_id = $1 AND id = $2`, [tenantId, account.id]));
    const counts = await countTenantRows(tenantId);

    const { result, lines } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.equal(result.outcome, 'unchanged');
    assert.ok(lines.some((line) => line.includes(`Administrator account ${email} not created`)), 'logged');
    assert.equal(await accountState(tenantId, email), null, 'not recreated');
    assert.deepEqual(countDifferences(counts, await countTenantRows(tenantId)), []);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testPasswordLineOnlyWhileTheAccountUsesAdminPassword() {
  const { tenantId, slug } = await newTenant();
  const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    // Created with an example value: reported.
    const created = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, EXAMPLE_PASSWORD)));
    assert.equal(created.result.outcome, 'created');
    assert.deepEqual(created.result.warnings, [BOOTSTRAP_PASSWORD_WARNING]);
    assert.ok(!created.lines.some((line) => line.includes(EXAMPLE_PASSWORD)), 'no line prints the password');

    // Next start, the account still has that password: reported again.
    const still = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, EXAMPLE_PASSWORD)));
    assert.equal(still.result.outcome, 'unchanged');
    assert.deepEqual(still.result.warnings, [BOOTSTRAP_PASSWORD_WARNING]);

    // Another process than the lead one: no check, no line.
    const notLead = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, EXAMPLE_PASSWORD, false)));
    assert.deepEqual(notLead.result.warnings, []);

    // A short ADMIN_PASSWORD that is not the account's password: nothing.
    const short = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, 'Short1!')));
    assert.deepEqual(short.result.warnings, []);

    // Password changed in the application: the hash no longer matches, nothing is reported.
    const account = (await accountState(tenantId, email))!;
    await inTenant(tenantId, async (manager) => manager.query(
      `UPDATE users SET password_hash = $3 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, account.id, await argon2.hash(STRONG_PASSWORD, { type: argon2.argon2id })],
    ));
    const changed = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, EXAMPLE_PASSWORD)));
    assert.deepEqual(changed.result.warnings, []);

    // A strong ADMIN_PASSWORD matching the account: nothing.
    const strong = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.deepEqual(strong.result.warnings, []);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testShortPasswordReportedAtCreation() {
  const { tenantId, slug } = await newTenant();
  const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  try {
    const { result } = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, 'Qz7#mWp2vLx')));
    assert.equal(result.outcome, 'created', 'a short value is reported, never refused');
    assert.deepEqual(result.warnings, [BOOTSTRAP_PASSWORD_WARNING]);
  } finally {
    await cleanupTenants([tenantId]);
  }
}

async function testMissingTenantChangesNothing() {
  const slug = `bootstrap-admin-missing-${randomUUID().slice(0, 8)}`;
  const { result } = await quietly(() =>
    ensureBootstrapAdministrator(dataSource, paramsFor(slug, 'nobody@bootstrap-spec.test', STRONG_PASSWORD)));
  assert.deepEqual(result, { outcome: 'tenant-missing', warnings: [] });
}

/**
 * `logUnchanged` (main.ts passes the lead process only): a run that changes nothing prints its
 * line only when asked; a creation and a restore are always printed.
 */
async function testUnchangedLineOnlyWhenAsked() {
  const { tenantId, slug } = await newTenant();
  const email = `admin-${randomUUID().slice(0, 8)}@bootstrap-spec.test`;
  const quiet = (s: string) => ({ ...paramsFor(s, email, STRONG_PASSWORD), logUnchanged: false });
  try {
    const created = await quietly(() => ensureBootstrapAdministrator(dataSource, quiet(slug)));
    assert.equal(created.result.outcome, 'created');
    assert.ok(created.lines.some((line) => line.includes(`Created administrator account ${email}`)), 'a creation is printed with logUnchanged: false');

    const asked = await quietly(() => ensureBootstrapAdministrator(dataSource, { ...paramsFor(slug, email, STRONG_PASSWORD), logUnchanged: true }));
    assert.equal(asked.result.outcome, 'unchanged');
    assert.ok(asked.lines.some((line) => line.includes(`Administrator account ${email} left unchanged`)), 'logUnchanged: true prints the unchanged line');

    const byDefault = await quietly(() => ensureBootstrapAdministrator(dataSource, paramsFor(slug, email, STRONG_PASSWORD)));
    assert.ok(byDefault.lines.some((line) => line.includes('left unchanged')), 'printed by default');

    const silent = await quietly(() => ensureBootstrapAdministrator(dataSource, quiet(slug)));
    assert.equal(silent.result.outcome, 'unchanged');
    assert.deepEqual(silent.lines, [], 'logUnchanged: false prints nothing for an account left as it was');

    // No active administrator remains: the restore is printed even with logUnchanged: false.
    const account = (await accountState(tenantId, email))!;
    await demote(tenantId, account.id);
    await setStatus(tenantId, account.id, 'disabled');
    const restored = await quietly(() => ensureBootstrapAdministrator(dataSource, quiet(slug)));
    assert.equal(restored.result.outcome, 'restored');
    assert.ok(restored.lines.some((line) => line.includes(`Restored ${email} as an enabled administrator`)), 'a restore is printed with logUnchanged: false');

    const missing = await quietly(() => ensureBootstrapAdministrator(dataSource, quiet(`${slug}-missing`)));
    assert.equal(missing.result.outcome, 'tenant-missing');
    assert.deepEqual(missing.lines, [], 'a missing tenant prints nothing with logUnchanged: false');
  } finally {
    await cleanupTenants([tenantId]);
  }
}

runSpecs('bootstrap-admin.integration.spec', [
  testCreatedOnceThenLeftAlone,
  testDemotedWithAnotherAdministratorStaysDemoted,
  testNoActiveAdministratorRestoresTheAccount,
  testAccountWithoutPasswordGetsTheStartupOneWhenRestored,
  testIdentityProviderAccountGetsNoLocalPassword,
  testWhoCountsAsActiveAdministrator,
  testDeletedWithAnotherAdministratorIsNotRecreated,
  testPasswordLineOnlyWhileTheAccountUsesAdminPassword,
  testShortPasswordReportedAtCreation,
  testMissingTenantChangesNothing,
  testUnchangedLineOnlyWhenAsked,
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
