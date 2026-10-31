// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { TasksService } from '../tasks.service';
import { assert, inRolledBackTransaction, runSpecs, seedItem, seedTenant } from './round-inputs.fixtures';

/**
 * The tasks list treats both natures of a budget line as one family: the related-object
 * name filter matches a CAPEX line, and a sort on the context column groups the two natures.
 */

async function seedTask(runner: QueryRunner, tenantId: string, itemNumber: number, title: string, type: string, objectId: string) {
  const [row] = await runner.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, itemNumber, title, type, objectId],
  );
  return row.id as string;
}

async function testCapexNameFilterAndFamilySort() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-bl');
    const opex = await seedItem(runner, 'opex', tenantId, 1, 'Opex Alpha Vessel');
    const capex = await seedItem(runner, 'capex', tenantId, 2, 'Capex Alpha Vessel');
    const opexTask = await seedTask(runner, tenantId, 11, 'First follow-up', 'spend_item', opex);
    const capexTask = await seedTask(runner, tenantId, 12, 'Second follow-up', 'capex_item', capex);
    const contractTask = await seedTask(runner, tenantId, 13, 'Third follow-up', 'contract', randomUUID());
    const projectTask = await seedTask(runner, tenantId, 14, 'Fourth follow-up', 'project', randomUUID());

    const svc = new TasksService(undefined as any);
    const rows = (query: Record<string, unknown>) => svc.listAllTasks(
      { page: 1, limit: 50, ...query },
      { manager: runner.manager, tenantId },
    ).then((page) => page.items);

    const capexHits = await rows({ filters: JSON.stringify({ related_object_name: { filter: 'Capex Alpha' } }) });
    assert.deepEqual(capexHits.map((row) => row.id), [capexTask], 'the name filter finds the task on the CAPEX line');
    const opexHits = await rows({ filters: JSON.stringify({ related_object_name: { filter: 'Opex Alpha' } }) });
    assert.deepEqual(opexHits.map((row) => row.id), [opexTask], 'the name filter still finds the OPEX line');
    const both = await rows({ filters: JSON.stringify({ related_object_name: { filter: 'Alpha Vessel' } }) });
    assert.deepEqual(both.map((row) => row.id).sort(), [opexTask, capexTask].sort(), 'one filter matches both natures');

    const quick = await rows({ q: 'Capex Alpha' });
    assert.deepEqual(quick.map((row) => row.id), [capexTask], 'the quick search matches the CAPEX line name');

    const sorted = await rows({ sort: 'related_object_type:ASC' });
    const order = sorted.map((row) => row.id);
    const at = (id: string) => order.indexOf(id);
    assert.ok(at(opexTask) < at(contractTask) && at(capexTask) < at(contractTask), `budget lines sort together, before the contract: ${order.join(',')}`);
    assert.ok(at(contractTask) < at(projectTask), `the contract sorts before the project: ${order.join(',')}`);
    const byId = new Map(sorted.map((row) => [row.id, row]));
    assert.equal(byId.get(opexTask)?.related_object_type, 'spend_item', 'the stored OPEX type stays on the row');
    assert.equal(byId.get(capexTask)?.related_object_type, 'capex_item', 'the stored CAPEX type stays on the row');
  });
}

void runSpecs('tasks-budget-line-related', [
  ['testCapexNameFilterAndFamilySort', testCapexNameFilterAndFamilySort],
]);

void dataSource;
