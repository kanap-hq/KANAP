import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { isTenantAdministrator } from '../tenant-administrator';

// The single administrator rule, on a real database, in a rolled-back transaction:
// an enabled user whose main role, or an additional role (`user_roles`), is named
// Administrator. A disabled user, a user of another tenant, a module level such as
// `users: admin` on another role, a malformed id and a null id are not.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function seedRole(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
    [tenantId, name],
  );
  return row.id as string;
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, status = 'enabled'): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO users (id, tenant_id, first_name, last_name, email, role_id, status)
     VALUES ($1, $2, 'Ada', 'Tester', $3, $4, $5)`,
    [id, tenantId, `admin-rule-${id.slice(0, 8)}@example.test`, roleId, status],
  );
  return id;
}

async function testTheAdministratorRule() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'admin-rule');
    const otherId = await seedTenant(runner, 'admin-rule-other');

    await setTenant(runner, tenantId);
    const administrator = await seedRole(runner, tenantId, 'Administrator');
    const member = await seedRole(runner, tenantId, 'Member');
    await runner.query(
      `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'users', 'admin')`,
      [tenantId, member],
    );

    const byMainRole = await seedUser(runner, tenantId, administrator);
    const byExtraRole = await seedUser(runner, tenantId, member);
    await runner.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`,
      [tenantId, byExtraRole, administrator],
    );
    const disabled = await seedUser(runner, tenantId, administrator, 'disabled');
    const moduleLevel = await seedUser(runner, tenantId, member);

    await setTenant(runner, otherId);
    const otherAdministrator = await seedRole(runner, otherId, 'Administrator');
    const otherUser = await seedUser(runner, otherId, otherAdministrator);

    await setTenant(runner, tenantId);
    const manager = runner.manager;
    assert.equal(await isTenantAdministrator(manager, tenantId, byMainRole), true, 'main role Administrator');
    assert.equal(await isTenantAdministrator(manager, tenantId, byExtraRole), true, 'additional role through user_roles');
    assert.equal(await isTenantAdministrator(manager, tenantId, disabled), false, 'a disabled user');
    assert.equal(await isTenantAdministrator(manager, tenantId, otherUser), false, 'a user of another tenant');
    assert.equal(await isTenantAdministrator(manager, tenantId, moduleLevel), false, 'users: admin on a non-administrator role');
    assert.equal(await isTenantAdministrator(manager, tenantId, 'not-a-uuid'), false, 'a malformed id');
    assert.equal(await isTenantAdministrator(manager, tenantId, null as unknown as string), false, 'a null id');
  });
}

runSpecs('tenant administrator', [
  ['an enabled Administrator, by main role or through user_roles, and nobody else', testTheAdministratorRule],
]);
