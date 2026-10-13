import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { taskCsvConfig } from '../task-csv.config';
import { inRolledBackTransaction, seedItem, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The task CSV import names a budget line by its id (lot M, review point 7): the task takes the type
// of the line's nature, whatever the file says, since a file exported before the line changed type
// keeps the type of before. A name resolves within the type the file gives, as before; an id that
// names no budget line is left as it is. Runs the import's `beforeCommit` in a transaction rolled
// back.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

async function testTypeFollowsNature() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-nature');
    const opexLine = await seedItem(runner, 'opex', tenantId, 990501, 'OPEX line for tasks');
    const capexLine = await seedItem(runner, 'capex', tenantId, 990502, 'CAPEX line for tasks');
    const unknown = randomUUID();
    const entities: any[] = [
      { title: 'File says OPEX, line is CAPEX', related_object_type: 'spend_item', related_object_id: capexLine },
      { title: 'File says CAPEX, line is OPEX', related_object_type: 'capex_item', related_object_id: opexLine },
      { title: 'Both OPEX', related_object_type: 'spend item', related_object_id: opexLine },
      { title: 'Unknown line', related_object_type: 'spend_item', related_object_id: unknown },
      { title: 'By name', related_object_type: 'capex', _related_object_name: 'CAPEX line for tasks' },
    ];
    await taskCsvConfig.beforeCommit!(entities, {
      tenantId, manager: runner.manager, params: {} as any, resolverCache: new Map(), userId: null,
    } as any);
    assert.deepEqual(
      entities.map((entity) => [entity.title, entity.related_object_type, entity.related_object_id]),
      [
        ['File says OPEX, line is CAPEX', 'capex_item', capexLine],
        ['File says CAPEX, line is OPEX', 'spend_item', opexLine],
        ['Both OPEX', 'spend_item', opexLine],
        ['Unknown line', 'spend_item', unknown],
        ['By name', 'capex_item', capexLine],
      ],
    );
  });
}

async function main() {
  await dataSource.initialize();
  let failed = false;
  try {
    await testTypeFollowsNature();
  } catch (err) {
    failed = true;
    console.error(`task-csv-budget-line-nature.integration.spec: ${(err as Error).message}`);
  } finally {
    await dataSource.destroy();
  }
  if (failed) process.exit(1);
  console.log('task-csv-budget-line-nature.integration.spec: ok');
}

void main();
