import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendItem } from '../spend-item.entity';
import { CapexItemsDeleteService } from '../spend-items-delete.service';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedItem, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// Deleting a CAPEX item deletes its tasks, as OPEX does. Another item's tasks,
// and a task of another object type that happens to carry the same id, stay.

async function seedTask(runner: QueryRunner, tenantId: string, itemNumber: number, type: string, objectId: string) {
  const [row] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, itemNumber, `Task ${itemNumber}`, type, objectId],
  );
  return row.id as string;
}

async function testDeleteRemovesItsTasks() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'capex-delete');
    const deleted = await seedItem(runner, 'capex', tenantId, 1, 'Deleted line');
    const kept = await seedItem(runner, 'capex', tenantId, 2, 'Kept line');
    const own = [await seedTask(runner, tenantId, 1, 'capex_item', deleted), await seedTask(runner, tenantId, 2, 'capex_item', deleted)];
    const other = await seedTask(runner, tenantId, 3, 'capex_item', kept);
    const otherType = await seedTask(runner, tenantId, 4, 'spend_item', deleted);

    const audit = captureAudit();
    const svc = new CapexItemsDeleteService(
      runner.manager.getRepository(SpendItem), undefined as any, undefined as any, undefined as any, audit as any,
      undefined as any, undefined as any,
    );
    await svc.delete(deleted, { manager: runner.manager, userId: null });

    const left = await runner.query(`SELECT id FROM tasks WHERE tenant_id = $1 ORDER BY item_number`, [tenantId]);
    assert.deepEqual(left.map((r: any) => r.id), [other, otherType], 'only the deleted item\'s tasks are gone');
    assert.ok(own.every((id) => !left.some((r: any) => r.id === id)));
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM spend_items WHERE id = $1`, [deleted]);
    assert.equal(n, 0, 'the item is deleted');
    assert.deepEqual(audit.entries.map((e) => `${e.table}:${e.action}`), ['capex_items:delete']);
  });
}

void runSpecs('capex-delete-tasks.integration.spec', [
  ['testDeleteRemovesItsTasks', testDeleteRemovesItsTasks],
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
