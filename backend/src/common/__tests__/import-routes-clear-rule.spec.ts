import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ContractsController } from '../../contracts/contracts.controller';
import { CostCentersController } from '../../cost-centers/cost-centers.controller';
import { BusinessProcessesController } from '../../business-processes/business-processes.controller';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { ApplicationsController } from '../../applications/applications.controller';
import { AssetsController } from '../../assets/assets.controller';
import { IncidentsController } from '../../incidents/incidents.controller';
import { PortfolioProjectsController } from '../../portfolio/portfolio-projects.controller';
import { PortfolioRequestsController } from '../../portfolio/portfolio-requests.controller';
import { TasksController } from '../../spend/tasks.controller';

// The contracts, cost centers and business processes import routes call their service with the
// clearing rule of every import route (D21 of 26.11.9, `mode: 'enrich'`), whatever the address
// says, as Kad does: a service called without a mode replaces, as the chart of accounts templates call it.
// The six imports of the shared CSV import (applications, assets, incidents, projects, requests,
// tasks) have one behaviour (T-I6b): their routes read no `mode` (an older client that still sends
// one is not refused, the address parameter is not read) and pass none to their service.

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

  const ctx = {
    tenant: { id: 't' }, user: { sub: null }, queryRunner: { manager: {} },
    tenantId: 't', userId: null, manager: {}, isAdmin: true, permissions: {},
  };
  const shared: Array<[string, new (...args: any[]) => object, string]> = [
    ['applications', ApplicationsController, 'import'],
    ['assets', AssetsController, 'importCsv'],
    ['incidents', IncidentsController, 'importCsv'],
    ['projects', PortfolioProjectsController, 'importCsv'],
    ['requests', PortfolioRequestsController, 'importCsv'],
    ['tasks', TasksController, 'importCsv'],
  ];
  for (const [name, controller, method] of shared) {
    const args = Object.values(Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, method) ?? {}) as Array<{ data?: unknown }>;
    assert.ok(args.length > 0, `${name}: the route arguments are read`);
    assert.ok(!args.some((arg) => arg.data === 'mode'), `${name}: the route reads no mode`);
    const calls: any[] = [];
    const instance = Object.create(controller.prototype);
    instance.csvSvc = { import: async (_file: unknown, params: any) => { calls.push(params); return { ok: true }; } };
    instance.requireManager = () => ({});
    await instance[method](file, 'true', 'upsert', 'en', undefined, ctx);
    assert.equal(calls.length, 1, `${name}: the service is called`);
    assert.ok(!('mode' in calls[0]), `${name}: no mode reaches the service`);
    assert.equal(calls[0].operation, 'upsert', `${name}: the operation is the address's`);
  }

  console.log('import-routes-clear-rule.spec: ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
