import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Task } from '../task.entity';
import { TasksDeleteService } from '../tasks-delete.service';

// Deleting a task deletes its history (`portfolio_activities.task_id` has no
// foreign key, so nothing cascades), alone or in a bulk delete, within the
// tenant only. The OPEX and CAPEX item deletes, which delete their tasks too,
// are covered in `spend/__tests__/item-delete-cleanup.integration.spec.ts`.

async function withTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Task delete test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `task-del-${tag}-${tenantId.slice(0, 8)}`],
  );
  return tenantId;
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTask(runner: QueryRunner, tenantId: string, itemNumber: number): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, itemNumber, `Task ${itemNumber}`],
  );
  await runner.query(
    `INSERT INTO portfolio_activities (tenant_id, task_id, type, content) VALUES ($1, $2, 'comment', 'A comment'), ($1, $2, 'change', NULL)`,
    [tenantId, row.id],
  );
  return row.id as string;
}

async function activities(runner: QueryRunner, taskId: string): Promise<number> {
  const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM portfolio_activities WHERE task_id = $1`, [taskId]);
  return n;
}

function service(runner: QueryRunner) {
  const audit = new AuditService(runner.manager.getRepository(AuditLog));
  return new TasksDeleteService(runner.manager.getRepository(Task), audit, { recalculateUserMonth: async () => undefined } as any);
}

async function testDeleteRemovesTheHistory() {
  await withTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'one');
    await useTenant(runner, tenantId);
    const deleted = await seedTask(runner, tenantId, 1);
    const kept = await seedTask(runner, tenantId, 2);
    await service(runner).delete(deleted, { manager: runner.manager, userId: null });
    assert.equal(await activities(runner, deleted), 0, 'the deleted task has no history left');
    assert.equal(await activities(runner, kept), 2, 'the other task keeps its history');
  });
}

async function testBulkDeleteRemovesEachHistory() {
  await withTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'bulk');
    await useTenant(runner, tenantId);
    const ids = [await seedTask(runner, tenantId, 1), await seedTask(runner, tenantId, 2), await seedTask(runner, tenantId, 3)];
    const result = await service(runner).bulkDelete([ids[0], ids[2]], null, { manager: runner.manager });
    assert.deepEqual(result.deleted, [ids[0], ids[2]]);
    assert.deepEqual(await Promise.all(ids.map((id) => activities(runner, id))), [0, 2, 0]);
  });
}

/** Another tenant's rows carrying the same task id (impossible through the app) are never touched. */
async function testOtherTenantUntouched() {
  await withTransaction(async (runner) => {
    const other = await seedTenant(runner, 'other');
    const tenantId = await seedTenant(runner, 'mine');
    await useTenant(runner, tenantId);
    const taskId = await seedTask(runner, tenantId, 1);
    await useTenant(runner, other);
    await runner.query(`INSERT INTO portfolio_activities (tenant_id, task_id, type) VALUES ($1, $2, 'change')`, [other, taskId]);
    await useTenant(runner, tenantId);
    await service(runner).delete(taskId, { manager: runner.manager, userId: null });
    await useTenant(runner, other);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM portfolio_activities WHERE tenant_id = $1 AND task_id = $2`, [other, taskId]);
    assert.equal(n, 1, "the other tenant's row stays");
  });
}

async function main() {
  await dataSource.initialize();
  let failed = 0;
  try {
    for (const [name, test] of [
      ['testDeleteRemovesTheHistory', testDeleteRemovesTheHistory],
      ['testBulkDeleteRemovesEachHistory', testBulkDeleteRemovesEachHistory],
      ['testOtherTenantUntouched', testOtherTenantUntouched],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`not ok - ${name}`);
        console.error(err);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failed > 0) {
    console.error(`tasks-delete-activities.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('tasks-delete-activities.integration.spec: ok');
}

void main();
