import 'dotenv/config';
import * as assert from 'node:assert/strict';
import dataSource from '../../data-source';
import { taskCsvConfig } from '../task-csv.config';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The task CSV import names a contract by its name, or by its reference `CTR-n` as the task list
// shows it (lot R4 of 26.11.9), as an incident is named `INC-n`. A number with a leading zero is no
// reference (`CTR-013`), and a reference wins over a contract that carries it as its name. Runs the
// import's `beforeCommit` in a transaction rolled back.

async function testContractByReference() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'task-csv-contract-ref');
    const { companyId } = await seedCompany(runner, tenantId, 'Fromage Co');
    const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
    const contract = async (name: string, itemNumber: number): Promise<string> => (await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number) VALUES ($1, $2, $3, $4, '2026-01-01', $5) RETURNING id`,
      [tenantId, name, companyId, supplier.id, itemNumber],
    ))[0].id;
    const support = await contract('Support', 13);
    const namedLikeAReference = await contract('CTR-14', 15);
    const fourteen = await contract('Fourteen', 14);
    const padded = await contract('CTR-013', 16);

    const entities: any[] = [
      { title: 'By name', related_object_type: 'contract', _related_object_name: 'support' },
      { title: 'By reference', related_object_type: 'contract', _related_object_name: 'CTR-13' },
      { title: 'Lower case', related_object_type: 'contract', _related_object_name: 'ctr-13' },
      { title: 'Reference first', related_object_type: 'contract', _related_object_name: 'CTR-14' },
      { title: 'Padded is a name', related_object_type: 'contract', _related_object_name: 'CTR-013' },
    ];
    await taskCsvConfig.beforeCommit!(entities, {
      tenantId, manager: runner.manager, params: {} as any, resolverCache: new Map(), userId: null,
    } as any);
    assert.deepEqual(
      entities.map((entity) => [entity.title, entity.related_object_id]),
      [
        ['By name', support],
        ['By reference', support],
        ['Lower case', support],
        ['Reference first', fourteen],
        ['Padded is a name', padded],
      ],
    );
    assert.notEqual(namedLikeAReference, fourteen);

    await assert.rejects(
      taskCsvConfig.beforeCommit!([{ title: 'Unknown', related_object_type: 'contract', _related_object_name: 'CTR-999' }], {
        tenantId, manager: runner.manager, params: {} as any, resolverCache: new Map(), userId: null,
      } as any),
      /Related object not found: "CTR-999"/,
    );
  });
}

async function main() {
  await dataSource.initialize();
  let failed = false;
  try {
    await testContractByReference();
  } catch (err) {
    failed = true;
    console.error(`task-csv-contract-reference.integration.spec: ${(err as Error).message}`);
  } finally {
    await dataSource.destroy();
  }
  if (failed) process.exit(1);
  console.log('task-csv-contract-reference.integration.spec: ok');
}

void main();
