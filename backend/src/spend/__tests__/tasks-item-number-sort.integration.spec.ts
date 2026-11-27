// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { TasksService } from '../tasks.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from './round-inputs.fixtures';

/**
 * The tasks list sorts on the task number (the "#" column) in both directions, for the rows and
 * for the ids the navigation and the export read, whatever the creation dates say.
 */

async function seedTask(runner: QueryRunner, tenantId: string, itemNumber: number, createdAt: string) {
  const [row] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, created_at)
     VALUES ($1, $2, $3, $4::timestamptz) RETURNING id`,
    [tenantId, itemNumber, `Task ${itemNumber}`, createdAt],
  );
  return row.id as string;
}

async function testSortByNumber() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-num');
    // The creation dates run against the numbers: a fallback on created_at gives the reverse order.
    const t1 = await seedTask(runner, tenantId, 1, '2026-03-01T00:00:00Z');
    const t2 = await seedTask(runner, tenantId, 2, '2026-01-01T00:00:00Z');
    const t3 = await seedTask(runner, tenantId, 3, '2026-02-01T00:00:00Z');

    const svc = new TasksService(undefined as any);
    const opts = { manager: runner.manager, tenantId };
    const rows = (sort: string) => svc.listAllTasks({ page: 1, limit: 50, sort }, opts).then((page) => page.items.map((row) => row.id));
    const ids = (sort: string) => svc.listIds({ sort }, opts).then((page) => page.ids);

    assert.deepEqual(await rows('item_number:ASC'), [t1, t2, t3], 'the rows follow the number upwards');
    assert.deepEqual(await rows('item_number:DESC'), [t3, t2, t1], 'the rows follow the number downwards');
    assert.deepEqual(await ids('item_number:ASC'), [t1, t2, t3], 'the ids follow the number upwards');
    assert.deepEqual(await ids('item_number:DESC'), [t3, t2, t1], 'the ids follow the number downwards');
  });
}

void runSpecs('tasks-item-number-sort', [
  ['testSortByNumber', testSortByNumber],
]);

void dataSource;
