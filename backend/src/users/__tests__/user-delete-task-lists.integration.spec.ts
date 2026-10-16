import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { User } from '../user.entity';
import { UsersDeleteService } from '../users-delete.service';

// A task names its owners and viewers in two lists (`owner_ids`, `viewer_ids`), which no foreign key
// can cover (common/reference-keys.inventory.ts). Deleting a user removes it from the lists of its
// tenant's tasks; the other users stay, in their order, and so do the tasks.

async function inRollback(fn: (runner: QueryRunner, tenantId: string) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'User delete lists', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `user-del-lists-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedUser(runner: QueryRunner, tenantId: string, roleId: string, name: string): Promise<string> {
  const [{ id }] = await runner.query(
    `INSERT INTO users (tenant_id, first_name, last_name, email, password_hash, role_id, mfa_enabled, status)
     VALUES ($1, $2, 'Tester', $3, null, $4, false, 'enabled') RETURNING id`,
    [tenantId, name, `${name.toLowerCase()}-${tenantId.slice(0, 8)}@user-lists.test`, roleId],
  );
  return id;
}

async function testDeletedUserLeavesTaskLists() {
  await inRollback(async (runner, tenantId) => {
    const roleId = randomUUID();
    await runner.query(
      `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
       VALUES ($1, $2, 'Lists role', 'Lists role', false, false, now(), now())`,
      [roleId, tenantId],
    );
    const gone = await seedUser(runner, tenantId, roleId, 'Gone');
    const kept = await seedUser(runner, tenantId, roleId, 'Kept');
    const [{ id: taskId }] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, owner_ids, viewer_ids)
       VALUES ($1, 1, 'Shared task', $2::jsonb, $3::jsonb) RETURNING id`,
      [tenantId, JSON.stringify([gone, kept]), JSON.stringify([kept, gone])],
    );
    const [{ id: otherTaskId }] = await runner.query(
      `INSERT INTO tasks (tenant_id, item_number, title, owner_ids, viewer_ids) VALUES ($1, 2, 'Other task', $2::jsonb, '[]'::jsonb) RETURNING id`,
      [tenantId, JSON.stringify([kept])],
    );

    const service = new UsersDeleteService(dataSource.getRepository(User), { log: async () => undefined } as any);
    await service.deleteUser(gone, null, { manager: runner.manager });

    const rows = await runner.query(`SELECT id, owner_ids, viewer_ids FROM tasks WHERE tenant_id = $1 ORDER BY item_number`, [tenantId]);
    assert.deepEqual(rows, [
      { id: taskId, owner_ids: [kept], viewer_ids: [kept] },
      { id: otherTaskId, owner_ids: [kept], viewer_ids: [] },
    ]);
  });
}

async function main() {
  await dataSource.initialize();
  try {
    await testDeletedUserLeavesTaskLists();
    console.log('  ok testDeletedUserLeavesTaskLists');
  } finally {
    await dataSource.destroy();
  }
  console.log('user-delete-task-lists.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
