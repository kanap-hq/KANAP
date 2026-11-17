import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ContractsController } from '../../contracts/contracts.controller';
import { CostCentersController } from '../../cost-centers/cost-centers.controller';
import { BusinessProcessesController } from '../../business-processes/business-processes.controller';

// The contracts, cost centers and business processes import routes call their service with the
// clearing rule of every import route (D21 of 26.11.9, `mode: 'enrich'`), whatever the address
// says, as Kad does: a service called without a mode replaces, as the chart of accounts templates call it.

function probe<T extends object>(controller: new (...args: any[]) => T, field: string) {
  const calls: any[] = [];
  const instance = Object.create(controller.prototype);
  instance[field] = { importCsv: async (args: any) => { calls.push(args); return { ok: true }; } };
  return { instance: instance as any, calls };
}

async function main() {
  const file = { buffer: Buffer.from('name\nx\n') } as Express.Multer.File;
  const req = { tenant: { id: 't' }, user: { sub: null }, queryRunner: { manager: {} } };

  const contracts = probe(ContractsController, 'svc');
  await contracts.instance.import(file, 'true', 'en', undefined, undefined, undefined, req);
  assert.equal(contracts.calls[0]?.mode, 'enrich', 'contracts');

  const processes = probe(BusinessProcessesController, 'svc');
  await processes.instance.import(file, 'true', 'en', undefined, undefined, undefined, req);
  assert.equal(processes.calls[0]?.mode, 'enrich', 'business processes');

  const centers = probe(CostCentersController, 'csv');
  await centers.instance.import(file, 'true', 'en', undefined, undefined, undefined, { manager: {}, tenantId: 't', userId: null });
  assert.equal(centers.calls[0]?.mode, 'enrich', 'cost centers');

  console.log('import-routes-clear-rule.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
