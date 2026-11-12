import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { ForbiddenException } from '@nestjs/common';
import { ApplicationsController } from '../../../applications/applications.controller';
import { AssetsController } from '../../../assets/assets.controller';
import { SpendItemsController } from '../../../spend/spend-items.controller';
import { CapexItemsController } from '../../../spend/capex-items.controller';
import { SpendItemContractsController } from '../../../contracts/spend-item-contracts.controller';
import { CapexItemContractsController } from '../../../contracts/capex-item-contracts.controller';
import { AiRelationMutationSupportService } from '../../../ai/mutation/ai-relation-mutation-support.service';

// A write that links records of a module (a replacement of the links, even an empty one) needs a
// read of that module, as the Relations tab: without it the answer is 403
// LINKED_MODULE_NOT_READABLE (the module's resource), the code of a document's links, before
// anything is read or written. With the read, or as an
// administrator, the route writes. Kad's relation writes follow the same rule.
//   - an application's budget lines (OPEX, CAPEX), contracts and projects;
//   - an asset's budget lines (OPEX, CAPEX), contracts and projects;
//   - a budget line's projects, applications and contracts (both natures).

const RECORD_ID = '11111111-1111-4111-8111-111111111111';

type Route = {
  label: string;
  /** The module the route belongs to, at the level of its decorator. */
  own: Record<string, string>;
  /** The resource read for the linked records. */
  linked: string;
  call: (ctx: any) => Promise<unknown>;
};

function stub(calls: string[]) {
  return new Proxy({}, {
    get: (_target, name) => async (...args: unknown[]) => {
      calls.push(String(name));
      return { ok: true, args: args.length };
    },
  });
}

function build(Controller: any, svcIndex: number, size: number, calls: string[]) {
  const args: any[] = Array.from({ length: size }, () => undefined);
  args[svcIndex] = stub(calls);
  const controller = new Controller(...args);
  // Ids are passed resolved: the refusal comes before the id is read.
  controller.resolveId = async (id: string) => id;
  controller.resolveItemId = async (id: string) => id;
  return controller;
}

function routes(calls: string[]): Route[] {
  const apps = build(ApplicationsController, 0, 9, calls);
  const assets = build(AssetsController, 0, 8, calls);
  const opex = build(SpendItemsController, 0, 9, calls);
  const capex = build(CapexItemsController, 0, 9, calls);
  const opexContracts = build(SpendItemContractsController, 0, 1, calls);
  const capexContracts = build(CapexItemContractsController, 0, 1, calls);
  const app = { applications: 'member' };
  const infra = { infrastructure: 'member' };
  const budget = { budget: 'member' };
  return [
    { label: 'application OPEX lines', own: app, linked: 'budget', call: (ctx) => apps.bulkReplaceLinkedSpend(RECORD_ID, { spend_item_ids: [] }, ctx) },
    { label: 'application CAPEX lines', own: app, linked: 'budget', call: (ctx) => apps.bulkReplaceLinkedCapex(RECORD_ID, { capex_item_ids: [] }, ctx) },
    { label: 'application contracts', own: app, linked: 'contracts', call: (ctx) => apps.bulkReplaceLinkedContracts(RECORD_ID, { contract_ids: [] }, ctx) },
    { label: 'application projects', own: app, linked: 'portfolio_projects', call: (ctx) => apps.bulkReplaceProjects(RECORD_ID, { project_ids: [] }, ctx) },
    { label: 'asset OPEX lines', own: infra, linked: 'budget', call: (ctx) => assets.replaceLinkedSpendItems(RECORD_ID, { spend_item_ids: [] }, ctx) },
    { label: 'asset CAPEX lines', own: infra, linked: 'budget', call: (ctx) => assets.replaceLinkedCapexItems(RECORD_ID, { capex_item_ids: [] }, ctx) },
    { label: 'asset contracts', own: infra, linked: 'contracts', call: (ctx) => assets.replaceLinkedContracts(RECORD_ID, { contract_ids: [] }, ctx) },
    { label: 'asset projects', own: infra, linked: 'portfolio_projects', call: (ctx) => assets.bulkReplaceProjects(RECORD_ID, { project_ids: [] }, ctx) },
    { label: 'OPEX line projects', own: budget, linked: 'portfolio_projects', call: (ctx) => opex.bulkReplaceProjects(RECORD_ID, { project_ids: [] }, ctx) },
    { label: 'OPEX line applications', own: budget, linked: 'applications', call: (ctx) => opex.bulkReplaceApplications(RECORD_ID, { application_ids: [] }, ctx) },
    { label: 'CAPEX line projects', own: budget, linked: 'portfolio_projects', call: (ctx) => capex.bulkReplaceProjects(RECORD_ID, { project_ids: [] }, ctx) },
    { label: 'CAPEX line applications', own: budget, linked: 'applications', call: (ctx) => capex.bulkReplaceApplications(RECORD_ID, { application_ids: [] }, ctx) },
    { label: 'OPEX line contracts', own: budget, linked: 'contracts', call: (ctx) => opexContracts.bulkReplace(RECORD_ID, { contract_ids: [] }, ctx) },
    { label: 'CAPEX line contracts', own: budget, linked: 'contracts', call: (ctx) => capexContracts.bulkReplace(RECORD_ID, { contract_ids: [] }, ctx) },
  ];
}

// The routes read the context as `ctx` (`@Tenant()`) or as the request (`@Req()`): one object serves both.
const ctx = (permissions: Record<string, string>, isAdmin = false): any => ({
  manager: {}, queryRunner: { manager: {} }, tenantId: 't-1', tenant: { id: 't-1' }, userId: 'u-1', user: { sub: 'u-1' }, isAdmin, permissions,
});

async function testRoutes() {
  const calls: string[] = [];
  for (const route of routes(calls)) {
    // A refusal thrown before the route returns its promise counts as one.
    const call = (c: any) => Promise.resolve().then(() => route.call(c));
    const error = await call(ctx(route.own)).then(() => null, (caught: unknown) => caught);
    assert.ok(error instanceof ForbiddenException, `${route.label}: 403 without a read of ${route.linked}`);
    const body = error.getResponse() as { code?: string; params?: Record<string, unknown> };
    assert.equal(body.code, 'LINKED_MODULE_NOT_READABLE', `${route.label}: code`);
    assert.deepEqual(body.params, { resources: [route.linked] }, `${route.label}: params`);
    assert.deepEqual(calls, [], `${route.label}: nothing read, nothing written`);

    await call(ctx({ ...route.own, [route.linked]: 'reader' }));
    assert.equal(calls.length, 1, `${route.label}: written with the read`);
    await call(ctx({}, true));
    assert.equal(calls.length, 2, `${route.label}: written by an administrator`);
    calls.length = 0;
  }
}

// Kad's relation write: the read of the linked module is asked with the source's own level.
async function testAssistantRelations() {
  const asked: Array<[string, string]> = [];
  const policy = {
    assertBusinessPermission: async (_context: unknown, resource: string, level: string) => {
      asked.push([resource, level]);
      throw new ForbiddenException({ code: 'MODULE_RIGHT_REQUIRED', message: 'refused', params: { resource, level } });
    },
  };
  const service = new AiRelationMutationSupportService(null as any, null as any, null as any, null as any, policy as any);
  const context: any = { tenantId: 't-1', userId: 'u-1', surface: 'chat', authMethod: 'jwt', manager: { query: async () => [{ id: RECORD_ID, name: 'Record' }] } };
  const cases: Array<[string, string, string]> = [
    ['applications', 'budget_lines', 'budget'],
    ['applications', 'contracts', 'contracts'],
    ['applications', 'projects', 'portfolio_projects'],
    ['assets', 'budget_lines', 'budget'],
    ['assets', 'contracts', 'contracts'],
    ['assets', 'projects', 'portfolio_projects'],
    ['budget_lines', 'projects', 'portfolio_projects'],
    ['budget_lines', 'applications', 'applications'],
    ['budget_lines', 'contracts', 'contracts'],
    ['contracts', 'budget_lines', 'budget'],
  ];
  for (const [entity, relation, resource] of cases) {
    asked.length = 0;
    const error = await service.prepareUpdatePreview(context, { entity_type: entity, ref: RECORD_ID, relation, add: [], remove: [] } as any)
      .then(() => null, (caught: unknown) => caught);
    assert.ok(error instanceof ForbiddenException, `Kad ${entity}.${relation}: refused`);
    assert.deepEqual(asked, [[resource, 'reader']], `Kad ${entity}.${relation}: read of ${resource} asked`);
  }
}

async function run() {
  await testRoutes();
  await testAssistantRelations();
  console.log('linked-module-write-routes.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
