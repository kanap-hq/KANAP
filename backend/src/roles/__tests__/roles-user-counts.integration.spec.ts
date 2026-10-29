import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { RolePermission } from '../../permissions/role-permission.entity';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { UserRole } from '../../users/user-role.entity';
import { Role } from '../role.entity';
import { RolesController } from '../roles.controller';
import { RolesService } from '../roles.service';

// The Roles screen counts each person once, the same people as the people list filtered on the
// role: a primary role (`users.role_id`) with no `user_roles` row counts, and a person who holds
// the role both ways counts once. A role held only as a primary role cannot be deleted.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

function controllerFor(runner: QueryRunner) {
  const manager = runner.manager;
  const roleRepo = manager.getRepository(Role);
  return new RolesController(
    new RolesService(roleRepo, manager.getRepository(RolePermission)),
    { getRolePermissionsMap: async () => ({}) } as never,
    roleRepo,
    manager.getRepository(RolePermission),
    manager.getRepository(UserRole),
    { log: async () => undefined } as never,
  );
}

async function insertRole(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`,
    [tenantId, name],
  );
  return row.id as string;
}

async function insertUser(runner: QueryRunner, tenantId: string, email: string, roleId: string, status = 'enabled'): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO users (tenant_id, email, role_id, status) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, email, roleId, status],
  );
  return row.id as string;
}

/** The people list's role filter (`compileRolesFilter`): the primary role or a `user_roles` row. */
async function peopleWithRole(runner: QueryRunner, roleId: string): Promise<number> {
  const [row] = await runner.query(
    `SELECT count(*)::int AS n
       FROM users u
      WHERE u.tenant_id = app_current_tenant()
        AND (u.role_id = $1 OR EXISTS (
          SELECT 1 FROM user_roles ur
           WHERE ur.user_id = u.id AND ur.role_id = $1
        ))`,
    [roleId],
  );
  return Number(row.n);
}

/** Primary-role rows plus `user_roles` rows, before collapsing to one person. */
async function assignmentRows(runner: QueryRunner, roleId: string): Promise<number> {
  const [row] = await runner.query(
    `SELECT count(*)::int AS n FROM (
       SELECT u.id FROM users u WHERE u.tenant_id = app_current_tenant() AND u.role_id = $1
       UNION ALL
       SELECT ur.user_id FROM user_roles ur WHERE ur.tenant_id = app_current_tenant() AND ur.role_id = $1
     ) held`,
    [roleId],
  );
  return Number(row.n);
}

function countOf(items: Array<{ role_name: string; user_count?: number }>, name: string): number {
  const role = items.find((item) => item.role_name === name);
  assert.ok(role, name);
  return role.user_count ?? 0;
}

function refusal(err: unknown): { code: unknown; usages: unknown; message: string } {
  assert.ok(err instanceof ConflictException, `a 409, got ${(err as Error)?.constructor?.name}: ${(err as Error)?.message}`);
  const body = err.getResponse() as { code?: unknown; usages?: unknown; message?: unknown };
  return { code: body.code, usages: body.usages, message: String(body.message) };
}

async function testPrimaryRoleCountsOnceAndBlocksDelete() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'role-counts');
    const reviewers = await insertRole(runner, tenantId, 'Reviewers');
    const observers = await insertRole(runner, tenantId, 'Observers');
    const primaryOnlyRole = await insertRole(runner, tenantId, 'Primary only');
    const free = await insertRole(runner, tenantId, 'Free');

    // Reviewers: primary only, both sources, an additional role, and a disabled person.
    await insertUser(runner, tenantId, 'primary-only@example.test', reviewers);
    const both = await insertUser(runner, tenantId, 'both@example.test', reviewers);
    await runner.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`,
      [tenantId, both, reviewers],
    );
    const extra = await insertUser(runner, tenantId, 'extra@example.test', observers);
    await runner.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`,
      [tenantId, extra, observers],
    );
    await runner.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`,
      [tenantId, extra, reviewers],
    );
    await insertUser(runner, tenantId, 'disabled@example.test', reviewers, 'disabled');
    await insertUser(runner, tenantId, 'primary-role-holder@example.test', primaryOnlyRole);

    const controller = controllerFor(runner);
    const req = { queryRunner: runner };
    const listed = await controller.getRoles(req);

    assert.equal(countOf(listed.items, 'Reviewers'), 4);
    assert.equal(countOf(listed.items, 'Observers'), 1, 'the same person as primary role and in user_roles counts once');
    assert.equal(countOf(listed.items, 'Primary only'), 1);
    assert.equal(countOf(listed.items, 'Free'), 0);
    assert.equal(await assignmentRows(runner, reviewers), 5, 'one person holds Reviewers both ways');
    assert.equal(await peopleWithRole(runner, reviewers), countOf(listed.items, 'Reviewers'));
    assert.equal(await peopleWithRole(runner, observers), 1);
    assert.equal(await assignmentRows(runner, observers), 2, 'Observers is stored twice for one person');
    assert.equal(await peopleWithRole(runner, free), 0);

    const otherTenant = await seedTenant(runner, 'role-counts-other');
    await insertUser(runner, otherTenant, 'other-tenant@example.test', reviewers);
    await setTenant(runner, tenantId);
    const afterOther = await controller.getRoles(req);
    assert.equal(countOf(afterOther.items, 'Reviewers'), 4, 'a person of another tenant stays out');
    assert.equal(await peopleWithRole(runner, reviewers), 4);

    await assert.rejects(() => controller.deleteRole(primaryOnlyRole, req), (err: unknown) => {
      const body = refusal(err);
      assert.equal(body.code, 'ROLE_IN_USE');
      assert.deepEqual(body.usages, [{ type: 'users', total: 1 }]);
      assert.match(body.message, /with users assigned/);
      return true;
    });
    const [kept] = await runner.query(`SELECT count(*)::int AS n FROM roles WHERE id = $1`, [primaryOnlyRole]);
    assert.equal(Number(kept.n), 1, 'the role held only as a primary role is still there');

    await assert.rejects(() => controller.deleteRole(reviewers, req), (err: unknown) => {
      const body = refusal(err);
      assert.equal(body.code, 'ROLE_IN_USE');
      assert.deepEqual(body.usages, [{ type: 'users', total: 4 }]);
      return true;
    });

    assert.deepEqual(await controller.deleteRole(free, req), { ok: true });
    const [gone] = await runner.query(`SELECT count(*)::int AS n FROM roles WHERE id = $1`, [free]);
    assert.equal(Number(gone.n), 0);
  });
}

runSpecs('role user counts', [
  ['a primary role counts once and blocks delete', testPrimaryRoleCountsOnceAndBlocksDelete],
]);
