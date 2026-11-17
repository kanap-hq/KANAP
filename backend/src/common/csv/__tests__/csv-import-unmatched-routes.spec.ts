import * as assert from 'node:assert/strict';
import 'reflect-metadata';
import { ApplicationsController } from '../../../applications/applications.controller';
import { AssetsController } from '../../../assets/assets.controller';
import { PortfolioProjectsController } from '../../../portfolio/portfolio-projects.controller';
import { PortfolioRequestsController } from '../../../portfolio/portfolio-requests.controller';
import { TasksController } from '../../../spend/tasks.controller';
import { ContractsController } from '../../../contracts/contracts.controller';
import { CostCentersController } from '../../../cost-centers/cost-centers.controller';
import { BusinessProcessesController } from '../../../business-processes/business-processes.controller';
import { IncidentsController } from '../../../incidents/incidents.controller';
import { TechnologiesController } from '../../../technologies/technologies.controller';
import { csvUnmatched } from '../csv-unmatched';

// Lot I3 of 26.11.9, fifth pass: the import routes of the screens take the matches the person undid
// (the `unmatched` field of the form, a JSON list) and hand them to their service, the check and the
// load alike; a list the route cannot read is refused before any work. Without a database: each
// handler is called as Nest calls it, its service replaced by a probe.

const FILE = { originalname: 'file.csv', buffer: Buffer.from('name\nAlpha\n') } as Express.Multer.File;
const UNDONE = [{ column: 'supplier_name', value: 'Societe Generale' }];
const manager = { query: async () => [] };
const req = { tenant: { id: 't-1' }, user: { sub: 'u-1' }, queryRunner: { manager }, isAdmin: true, permissions: {} };
const ctx = { manager, tenantId: 't-1', userId: 'u-1', isAdmin: true, permissions: {} };

type Route = {
  name: string;
  /** The handler, called with the form's `unmatched` field; returns what its service received. */
  call: (unmatched: unknown) => Promise<unknown>;
};

/** A controller whose service field `field` records the arguments of its import method `method`. */
function probe(type: any, field: string, method: string, seen: unknown[][]): any {
  const controller = Object.create(type.prototype);
  controller[field] = { [method]: async (...args: unknown[]) => { seen.push(args); return { ok: true }; } };
  return controller;
}

function declarative(name: string, type: any, viaReq: boolean): Route {
  return {
    name,
    call: async (unmatched) => {
      const seen: unknown[][] = [];
      const controller = probe(type, 'csvSvc', 'import', seen);
      const handler = typeof controller.import === 'function' ? 'import' : 'importCsv';
      await controller[handler](FILE, 'true', 'enrich', 'upsert', 'en', unmatched, viaReq ? req : ctx);
      return (seen[0][1] as { unmatched?: unknown }).unmatched;
    },
  };
}

function ownLists(name: string, type: any, field: string, viaReq: boolean): Route {
  return {
    name,
    call: async (unmatched) => {
      const seen: unknown[][] = [];
      const controller = probe(type, field, 'importCsv', seen);
      await controller.import(FILE, 'true', 'en', undefined, undefined, unmatched, viaReq ? req : ctx);
      return (seen[0][0] as { unmatched?: unknown }).unmatched;
    },
  };
}

/**
 * A file of links of the technology layer (lot I3 of 26.11.9, merge of the fourth and fifth passes):
 * the route hands the undone matches and the person's rights to the link import.
 */
function links(name: string, handler: string, method: string): Route {
  return {
    name,
    call: async (unmatched) => {
      const seen: unknown[][] = [];
      const controller = probe(TechnologiesController, 'linkFiles', method, seen);
      await controller[handler](FILE, 'true', 'en', unmatched, ctx);
      const request = seen[0][0] as { unmatched?: unknown; access?: unknown };
      assert.deepEqual(request.access, { isAdmin: true, permissions: {} }, `${name}: the person's rights reach the link import`);
      return request.unmatched;
    },
  };
}

const ROUTES: Route[] = [
  declarative('applications', ApplicationsController, false),
  declarative('assets', AssetsController, true),
  declarative('portfolio projects', PortfolioProjectsController, false),
  declarative('portfolio requests', PortfolioRequestsController, true),
  declarative('tasks', TasksController, true),
  ownLists('contracts', ContractsController, 'svc', true),
  ownLists('cost centers', CostCentersController, 'csv', false),
  ownLists('business processes', BusinessProcessesController, 'svc', true),
  declarative('incidents', IncidentsController, false),
  links('server links', 'importAssetLinks', 'importAssetLinks'),
  links('application links', 'importApplicationLinks', 'importApplicationLinks'),
];

async function testEachRouteHandsTheUndoneMatchesToItsService() {
  for (const route of ROUTES) {
    assert.deepEqual(await route.call(JSON.stringify(UNDONE)), UNDONE, `${route.name}: the form's list reaches the service`);
    assert.deepEqual(await route.call(undefined), [], `${route.name}: no field, nothing undone`);
    await assert.rejects(route.call('{not json'), /undone matches are not valid/, `${route.name}: an unreadable list is refused`);
  }
  console.log('  the import routes of the screens hand the undone matches to their service: OK');
}

function testTheListIsBoundedAsTheBudgetFileChoices() {
  assert.deepEqual(csvUnmatched(''), []);
  assert.deepEqual(
    csvUnmatched([{ column: 'company_name', value: ' Societe ' }, { column: 'company_name', value: 'SOCIETE' }]),
    [{ column: 'company_name', value: 'Societe' }],
    'the same value twice, case aside, is one entry',
  );
  const many = Array.from({ length: 201 }, (_, index) => ({ column: 'company_name', value: `Value ${index}` }));
  assert.throws(() => csvUnmatched(many), /not valid/, 'more than 200 entries');
  assert.throws(() => csvUnmatched([{ column: 'company_name', value: 'x'.repeat(201) }]), /not valid/, 'a value too long');
  assert.throws(() => csvUnmatched([{ column: 'company_name', value: '' }]), /not valid/, 'an empty value');
  assert.throws(() => csvUnmatched([{ kind: 'lookalike', line: 2 }]), /not valid/, 'another kind of choice');
  assert.throws(() => csvUnmatched({ column: 'company_name', value: 'x' }), /not valid/, 'not a list');
  console.log('  the undone matches are bounded as the budget file\'s choices: OK');
}

async function run() {
  await testEachRouteHandsTheUndoneMatchesToItsService();
  testTheListIsBoundedAsTheBudgetFileChoices();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
