import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { RolesController } from '../../roles/roles.controller';
import { RolesService } from '../../roles/roles.service';
import { Role } from '../../roles/role.entity';
import { UserRole } from '../../users/user-role.entity';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { PermissionsService, RESOURCES } from '../permissions.service';
import { RolePermission } from '../role-permission.entity';
import { UserPageRole } from '../user-page-role.entity';

// One budget right (lot R), the names of before: on a real database, each case in a rolled-back
// transaction. A row still named `opex` or `capex` (a tenant export or a database of before
// migration 1853990000000) is read as `budget`, the higher level; a role written with these keys
// (an earlier client, a script) is written as `budget`: the keys of one call are merged, the
// highest level wins, a null removes the right only when every key naming it is null, and the
// rows of the old names go. `budget` grants `tasks:reader` like the two rights did.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

function servicesFor(runner: QueryRunner) {
  const manager = runner.manager;
  const roleRepo = manager.getRepository(Role);
  const rolePermRepo = manager.getRepository(RolePermission);
  const perms = new PermissionsService(manager.getRepository(UserPageRole), rolePermRepo);
  const controller = new RolesController(
    new RolesService(roleRepo, rolePermRepo),
    perms,
    roleRepo,
    rolePermRepo,
    manager.getRepository(UserRole),
    new AuditService(manager.getRepository(AuditLog)),
  );
  return { perms, controller, manager };
}

async function seedRole(runner: QueryRunner, tenantId: string, name: string, rows: Record<string, string> = {}): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, 'compat') RETURNING id::text AS id`,
    [tenantId, name],
  );
  for (const [resource, level] of Object.entries(rows)) {
    await runner.query(
      `INSERT INTO role_permissions (role_id, resource, level, tenant_id) VALUES ($1, $2, $3, $4)`,
      [role.id, resource, level, tenantId],
    );
  }
  return role.id;
}

/** The rows stored for the role, by their stored name. */
async function storedRows(runner: QueryRunner, roleId: string): Promise<Record<string, string>> {
  const rows: Array<{ resource: string; level: string }> = await runner.query(
    `SELECT resource, level FROM role_permissions WHERE role_id = $1 ORDER BY resource`,
    [roleId],
  );
  return Object.fromEntries(rows.map((row) => [row.resource, row.level]));
}

async function testResources() {
  assert.ok((RESOURCES as readonly string[]).includes('budget'), 'budget is a resource');
  assert.ok(!(RESOURCES as readonly string[]).includes('opex'), 'opex is no longer a resource');
  assert.ok(!(RESOURCES as readonly string[]).includes('capex'), 'capex is no longer a resource');
  assert.ok((RESOURCES as readonly string[]).includes('budget_ops'), 'budget_ops stays apart');
}

async function testLeftoverRowsAreReadAsBudget() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'budget-compat-read');
    const { perms, controller, manager } = servicesFor(runner);
    const req = { queryRunner: runner, user: { sub: randomUUID() } };

    const asymmetric = await seedRole(runner, tenantId, 'Old asymmetric', { opex: 'reader', capex: 'admin' });
    const opexOnly = await seedRole(runner, tenantId, 'Old OPEX only', { opex: 'member' });
    const manager_ = await seedRole(runner, tenantId, 'Old manager', { capex: 'manager' });
    const mixed = await seedRole(runner, tenantId, 'Old and new', { budget: 'reader', opex: 'member' });

    assert.deepEqual(await perms.getRolePermissionsMap(asymmetric, { manager }), { budget: 'admin' });
    assert.deepEqual(await perms.getRolePermissionsMap(opexOnly, { manager }), { budget: 'member' });
    assert.deepEqual(await perms.getRolePermissionsMap(manager_, { manager }), { budget: 'member' }, 'manager reads as member');
    assert.deepEqual(await perms.getRolePermissionsMap(mixed, { manager }), { budget: 'member' }, 'the higher of the rows');
    // A user's rights are the union of their roles (the guard and /auth/me read this).
    const union = await perms.listForRoles([opexOnly, manager_], { manager });
    assert.equal(union.get('budget'), 'member');
    assert.equal(union.has('opex'), false);
    assert.equal(union.has('capex'), false);

    // The roles page reads every resource of RESOURCES: `budget`, never `opex` or `capex`.
    const page = await controller.getRolePermissions(asymmetric, req);
    assert.equal(page.budget, 'admin');
    assert.equal('opex' in page, false);
    assert.equal('capex' in page, false);
  });
}

async function testOldKeysAreWrittenAsBudget() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'budget-compat-write');
    const { controller } = servicesFor(runner);
    const req = { queryRunner: runner, user: { sub: randomUUID() }, tenant: { id: tenantId } };
    const role = await controller.createRole({ role_name: 'Compat writer', role_description: 'Writes old keys' }, req);

    // Both keys: the higher level, stored once as `budget`.
    let after = await controller.setRolePermissions(role.id, { permissions: { opex: 'member', capex: 'admin' } }, req);
    assert.deepEqual(after, { budget: 'admin', tasks: 'reader' });
    assert.deepEqual(await storedRows(runner, role.id), { budget: 'admin', tasks: 'reader' });

    // A null on one key does not remove the level the other key gives in the same call.
    after = await controller.setRolePermissions(role.id, { permissions: { opex: 'reader', capex: null } }, req);
    assert.deepEqual(after, { budget: 'reader', tasks: 'reader' });
    after = await controller.setRolePermissions(role.id, { permissions: { budget: null, capex: 'member' } }, req);
    assert.deepEqual(after, { budget: 'member', tasks: 'reader' });

    // Every key null: the right goes.
    after = await controller.setRolePermissions(role.id, { permissions: { opex: null, capex: null } }, req);
    assert.deepEqual(after, { tasks: 'reader' });
    assert.deepEqual(await storedRows(runner, role.id), { tasks: 'reader' });
  });
}

async function testSavingOverLeftoverRows() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'budget-compat-leftover');
    const { controller, perms, manager } = servicesFor(runner);
    const req = { queryRunner: runner, user: { sub: randomUUID() }, tenant: { id: tenantId } };
    const role = await seedRole(runner, tenantId, 'Old rows', { opex: 'admin', capex: 'admin', tasks: 'reader' });

    // Lowering the level replaces both old rows: no row of the old names is left to lift it again.
    const after = await controller.setRolePermissions(role, { permissions: { budget: 'reader' } }, req);
    assert.deepEqual(after, { budget: 'reader', tasks: 'reader' });
    assert.deepEqual(await storedRows(runner, role), { budget: 'reader', tasks: 'reader' });

    // A duplicate of a role with old rows holds `budget`.
    const old = await seedRole(runner, tenantId, 'Old to copy', { opex: 'member', capex: 'reader' });
    const copy = await controller.duplicateRole(old, { role_name: 'Old copy' }, req);
    assert.deepEqual(await storedRows(runner, copy.id), { budget: 'member', tasks: 'reader' });
    assert.deepEqual(await perms.getRolePermissionsMap(copy.id, { manager }), { budget: 'member', tasks: 'reader' });
  });
}

async function testTasksFollowTheBudgetRight() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'budget-compat-tasks');
    const { perms, manager } = servicesFor(runner);
    const fresh = async (name: string) => seedRole(runner, tenantId, name);

    const reader = await fresh('Budget reader');
    assert.deepEqual(await perms.setRolePermissionsMap(reader, { budget: 'reader' }, { manager }), { budget: 'reader', tasks: 'reader' });
    const viaOldKey = await fresh('Old key reader');
    assert.deepEqual(await perms.setRolePermissionsMap(viaOldKey, { capex: 'reader' }, { manager }), { budget: 'reader', tasks: 'reader' });
    const tasksSet = await fresh('Tasks set');
    assert.deepEqual(await perms.setRolePermissionsMap(tasksSet, { budget: 'admin', tasks: 'member' }, { manager }), { budget: 'admin', tasks: 'member' });
    const tasksCleared = await fresh('Tasks cleared');
    assert.deepEqual(await perms.setRolePermissionsMap(tasksCleared, { budget: 'member', tasks: null }, { manager }), { budget: 'member' });
    const contributor = await fresh('Contributor');
    assert.deepEqual(await perms.setRolePermissionsMap(contributor, { budget: 'contributor' }, { manager }), { budget: 'contributor' }, 'contributor grants no task access, as before');
  });
}

runSpecs('budget right compatibility', [
  ['budget is the resource, opex and capex are not', testResources],
  ['a row still named opex or capex is read as budget, the higher level', testLeftoverRowsAreReadAsBudget],
  ['opex and capex keys are written as budget, merged at the higher level', testOldKeysAreWrittenAsBudget],
  ['saving budget replaces the rows of the old names', testSavingOverLeftoverRows],
  ['budget grants tasks:reader like the two rights did', testTasksFollowTheBudgetRight],
]);
