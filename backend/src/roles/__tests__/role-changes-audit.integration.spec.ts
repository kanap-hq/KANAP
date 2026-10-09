import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UserRole } from '../../users/user-role.entity';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Role } from '../role.entity';
import { RolesController } from '../roles.controller';
import { RolesService } from '../roles.service';

// Changes to a role's rights are in the audit log, on a real database, each
// case in a rolled-back transaction: creating, renaming, duplicating and
// deleting a role, and changing its permissions, write a `roles` row with the
// state before, the state after and the person who made the change, in the
// request's transaction. A permission save that changes nothing writes no row,
// and a tenant's rows are not visible from another tenant.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

function controllerFor(runner: QueryRunner) {
  const manager = runner.manager;
  const roleRepo = manager.getRepository(Role);
  const rolePermRepo = manager.getRepository(RolePermission);
  const controller = new RolesController(
    new RolesService(roleRepo, rolePermRepo),
    new PermissionsService(manager.getRepository(UserPageRole), rolePermRepo),
    roleRepo,
    rolePermRepo,
    manager.getRepository(UserRole),
    new AuditService(manager.getRepository(AuditLog)),
  );
  return controller;
}

async function roleRows(runner: QueryRunner, roleId: string) {
  return runner.query(
    `SELECT action, before_json, after_json, user_id, record_id FROM audit_log
      WHERE table_name = 'roles' AND record_id = $1 ORDER BY created_at, id`,
    [roleId],
  );
}

async function testRoleChangesAreLogged() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'role-audit');
    const actorId = randomUUID();
    const req = { queryRunner: runner, user: { sub: actorId }, tenant: { id: tenantId } };
    const controller = controllerFor(runner);

    const created = await controller.createRole({ role_name: 'Budget reviewer', role_description: 'Reads budgets' }, req);
    await controller.setRolePermissions(created.id, { permissions: { opex: 'reader', capex: 'reader' } }, req);
    await controller.setRolePermissions(created.id, { permissions: { opex: 'admin', capex: null } }, req);
    // Saving the same permissions again changes nothing: no row.
    await controller.setRolePermissions(created.id, { permissions: { opex: 'admin' } }, req);
    await controller.updateRole(created.id, { role_name: 'Budget owner', role_description: 'Owns budgets' }, req);

    const rows = await roleRows(runner, created.id);
    assert.deepEqual(rows.map((row: any) => row.action), ['create', 'update', 'update', 'update']);
    for (const row of rows) assert.equal(row.user_id, actorId, 'the person who made the change');
    assert.deepEqual(rows[0].before_json, null);
    assert.deepEqual(rows[0].after_json, { role_name: 'Budget reviewer', role_description: 'Reads budgets' });
    // First permission change: from nothing to reader on both (tasks follows the operations rights).
    assert.deepEqual(rows[1].before_json.permissions, {});
    assert.deepEqual(rows[1].after_json.permissions, { opex: 'reader', capex: 'reader', tasks: 'reader' });
    // Second: before and after, the removed right gone.
    assert.deepEqual(rows[2].before_json.permissions, { opex: 'reader', capex: 'reader', tasks: 'reader' });
    assert.deepEqual(rows[2].after_json.permissions, { opex: 'admin', tasks: 'reader' });
    assert.deepEqual(rows[3].before_json, { role_name: 'Budget reviewer', role_description: 'Reads budgets' });
    assert.deepEqual(rows[3].after_json, { role_name: 'Budget owner', role_description: 'Owns budgets' });

    // Duplicate: a creation with the copied permissions and where it came from.
    const copy = await controller.duplicateRole(created.id, { role_name: 'Budget owner copy' }, req);
    const [copyRow] = await roleRows(runner, copy.id);
    assert.equal(copyRow.action, 'create');
    assert.equal(copyRow.user_id, actorId);
    assert.deepEqual(copyRow.after_json, {
      role_name: 'Budget owner copy',
      role_description: 'Owns budgets',
      permissions: { opex: 'admin', tasks: 'reader' },
      duplicated_from: { id: created.id, role_name: 'Budget owner' },
    });

    // Delete: the state before, permissions included.
    await controller.deleteRole(copy.id, req);
    const copyRows = await roleRows(runner, copy.id);
    assert.equal(copyRows.length, 2);
    assert.equal(copyRows[1].action, 'delete');
    assert.equal(copyRows[1].user_id, actorId);
    assert.deepEqual(copyRows[1].before_json, { role_name: 'Budget owner copy', role_description: 'Owns budgets', permissions: { opex: 'admin', tasks: 'reader' } });
    assert.equal(copyRows[1].after_json, null);

    // Another tenant does not see these rows.
    const otherTenant = await seedTenant(runner, 'role-audit-other');
    await setTenant(runner, otherTenant);
    assert.equal((await roleRows(runner, created.id)).length, 0);
    await setTenant(runner, tenantId);
  });
}

async function testRefusedChangesWriteNothing() {
  await inRolledBackTransaction(async (runner) => {
    await seedTenant(runner, 'role-audit-refused');
    const req = { queryRunner: runner, user: { sub: randomUUID() } };
    const controller = controllerFor(runner);
    const system = await new RolesService(runner.manager.getRepository(Role), runner.manager.getRepository(RolePermission))
      .createRole({ role_name: 'Administrator', role_description: 'All rights' }, { manager: runner.manager });
    await assert.rejects(() => controller.setRolePermissions(system.id, { permissions: { opex: 'reader' } }, req), /cannot be modified/);
    await assert.rejects(() => controller.deleteRole(system.id, req), /Cannot delete system role/);
    assert.equal((await roleRows(runner, system.id)).length, 0);
  });
}

runSpecs('role changes audit', [
  ['creating, changing, duplicating and deleting a role is logged with before, after and actor', testRoleChangesAreLogged],
  ['a refused change writes no row', testRefusedChangesWriteNothing],
]);
