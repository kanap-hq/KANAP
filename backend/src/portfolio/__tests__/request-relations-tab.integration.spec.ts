// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { PortfolioRequestsController } from '../portfolio-requests.controller';
import { PortfolioRequestsService } from '../portfolio-requests.service';
import { PortfolioRelationsService } from '../portfolio-relations.service';
import { PortfolioDependenciesService } from '../services/portfolio-dependencies.service';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { PortfolioProjectsService } from '../services/portfolio-projects.service';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// GET/POST/DELETE /portfolio/requests/:id/relations, on an empty migrated database:
// the tab in one round trip, one link at a time, the activity or the audit, the refusals,
// a Business Contributor's participation, and a request of another tenant.

const YEAR = new Date().getUTCFullYear();

type Ref = { id: string; reference: string };

type Seed = {
  tenantId: string;
  userId: string;
  contributorId: string;
  requestId: string;
  hiddenRequestId: string;
  apps: { alpha: Ref; mid: Ref; owned: Ref };
  assets: { alpha: Ref; mid: Ref; free: Ref };
  processes: { linked: string; free: string };
  projects: { alpha: { id: string; item_number: number }; mid: { id: string; item_number: number } };
  lines: { opex: string; capex: string; spare: string; extra: string };
};

const READ = {
  portfolio_requests: 'reader',
  budget: 'reader',
  applications: 'reader',
  infrastructure: 'reader',
  business_processes: 'reader',
  portfolio_projects: 'reader',
};
const WRITE = { ...READ, portfolio_requests: 'contributor', business_processes: 'member' };

function fxRates() {
  return {
    resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
    convertValue: (amount: number, rate: number) => amount * rate,
  };
}

function projectsService() {
  // The project's own audit rows (team, lines, applications, assets) go to a capture of their own:
  // this spec asserts the rows the Relations tab writes itself.
  const crud = new PortfolioProjectsCrudService(
    undefined as any, undefined as any, captureAudit() as any, undefined as any,
    undefined as any, undefined as any, undefined as any,
  );
  const dependencies = new PortfolioDependenciesService(undefined as any, captureAudit() as any);
  return new PortfolioProjectsService(
    undefined as any, crud, dependencies,
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
  );
}

function httpOf(audit = captureAudit()) {
  // The request's own audit rows (team, lines, applications, assets) go to a capture of their own:
  // this spec asserts the rows the Relations tab writes itself.
  const requests = new PortfolioRequestsService(
    undefined as any, captureAudit() as any, undefined as any, undefined as any, undefined as any,
    undefined as any, undefined as any, undefined as any, undefined as any,
  );
  const relations = new PortfolioRelationsService(projectsService(), requests, fxRates() as any, audit as any);
  return {
    audit,
    http: new PortfolioRequestsController(
      requests, undefined as any, undefined as any, undefined as any, undefined as any,
      undefined as any, undefined as any, undefined as any, relations,
    ),
  };
}

function req(runner: QueryRunner, seed: Seed, permissions: Record<string, string>, userId = seed.userId) {
  return {
    queryRunner: { manager: runner.manager },
    user: { sub: userId },
    tenant: { id: seed.tenantId },
    isAdmin: false,
    permissions,
  };
}

async function rejection(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal');
}

function assertModuleRight(err: Error, resource: string, level: string, message: string): void {
  assert.ok(err instanceof ForbiddenException, 'a ForbiddenException');
  assert.deepEqual(err.getResponse(), {
    statusCode: 403,
    error: 'Forbidden',
    code: 'MODULE_RIGHT_REQUIRED',
    message,
    params: { resource, level },
  });
}

async function ids(runner: QueryRunner, table: string, column: string, ownerColumn: string, ownerId: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await runner.query(
    `SELECT ${column} AS id FROM ${table} WHERE ${ownerColumn} = $1`,
    [ownerId],
  );
  return rows.map((row) => row.id).sort();
}

async function activities(runner: QueryRunner, requestId: string): Promise<unknown[]> {
  const rows: Array<{ changed_fields: unknown }> = await runner.query(
    `SELECT changed_fields FROM portfolio_activities WHERE request_id = $1`,
    [requestId],
  );
  return rows.map((row) => row.changed_fields);
}

async function seedTab(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const memberRole = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`,
    [tenantId],
  )).id as string;
  const contributorRole = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Business Contributor') RETURNING id`,
    [tenantId],
  )).id as string;
  const user = (email: string, roleId: string, first: string, last: string) => one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, email, roleId, first, last],
  ).then((row) => row.id as string);
  const userId = await user(`req-${tag}-${tenantId.slice(0, 8)}@example.test`, memberRole, 'Ada', 'Martin');
  const contributorId = await user(`req-${tag}-bc-${tenantId.slice(0, 8)}@example.test`, contributorRole, 'Luc', 'Bernard');
  const ownerId = await user(`req-${tag}-owner-${tenantId.slice(0, 8)}@example.test`, memberRole, 'Claire', 'Dubois');
  const supplierId = (await one(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Acme ${tag}`],
  )).id as string;
  const requestId = (await one(
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, status, requestor_id) VALUES ($1, $2, 6, 'approved', $3) RETURNING id`,
    [tenantId, `Relations request ${tag}`, contributorId],
  )).id as string;
  const hiddenRequestId = (await one(
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, status) VALUES ($1, $2, 20, 'pending_review') RETURNING id`,
    [tenantId, `Hidden request ${tag}`],
  )).id as string;

  const application = async (name: string, criticality: string | null) => {
    const row = await one(
      `INSERT INTO applications (tenant_id, name, lifecycle, criticality, status) VALUES ($1, $2, 'active', $3, 'enabled') RETURNING id, sequential_id AS reference`,
      [tenantId, name, criticality],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const alpha = await application('Alpha app', 'high');
  const mid = await application('Mid app', null);
  const owned = await application('Owned app', 'low');
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, owned.id, contributorId],
  );
  await runner.query(
    `INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id) VALUES ($1, $2, $3), ($1, $2, $4), ($1, $2, $5)`,
    [tenantId, requestId, alpha.id, mid.id, owned.id],
  );

  const asset = async (name: string, kind: string, environment: string) => {
    const row = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', now(), now()) RETURNING id, asset_reference AS reference`,
      [tenantId, name, kind, environment],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const assetAlpha = await asset('Alpha srv', 'physical_server', 'prod');
  const assetMid = await asset('Mid srv', 'virtual_machine', 'test');
  const assetFree = await asset('Free srv', 'physical_server', 'prod');
  await runner.query(
    `INSERT INTO portfolio_request_assets (tenant_id, request_id, asset_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, requestId, assetAlpha.id, assetMid.id],
  );

  const process = async (name: string, owner: string | null) => (await one(
    `INSERT INTO business_processes (tenant_id, name, owner_user_id) VALUES ($1, $2, $3) RETURNING id`,
    [tenantId, name, owner],
  )).id as string;
  const linkedProcess = await process('Order to cash', ownerId);
  const freeProcess = await process('Procure to pay', null);
  await runner.query(
    `INSERT INTO portfolio_request_business_processes (tenant_id, request_id, business_process_id) VALUES ($1, $2, $3)`,
    [tenantId, requestId, linkedProcess],
  );

  const project = async (name: string, itemNumber: number, status: string, lead: string | null) => {
    const row = await one(
      `INSERT INTO portfolio_projects (tenant_id, name, item_number, status, it_lead_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, name, itemNumber, status, lead],
    );
    return { id: row.id as string, item_number: itemNumber };
  };
  const projectAlpha = await project('Alpha project', 3, 'in_progress', contributorId);
  const projectMid = await project('Mid project', 8, 'planned', null);
  await runner.query(
    `INSERT INTO portfolio_request_projects (tenant_id, request_id, project_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, requestId, projectAlpha.id, projectMid.id],
  );

  const line = async (nature: 'opex' | 'capex', name: string, itemNumber: number, withSupplier: boolean) => {
    const row = nature === 'opex'
      ? await one(
        `INSERT INTO spend_items (tenant_id, product_name, supplier_id, currency, effective_start, item_number, status)
         VALUES ($1, $2, $3, 'EUR', '2024-01-01', $4, 'enabled'::status_state) RETURNING id`,
        [tenantId, name, withSupplier ? supplierId : null, itemNumber],
      )
      : await one(
        `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number, legacy_number, ppe_type, investment_type, priority, status)
         VALUES ($1, 'capex', $2, 'EUR', '2024-01-01', $3, $4, 'hardware', 'replacement', 'medium', 'enabled'::status_state) RETURNING id`,
        [tenantId, name, itemNumber, `CPX-${itemNumber}`],
      );
    return row.id as string;
  };
  const opex = await line('opex', 'Opex licence', 11, true);
  const capex = await line('capex', 'Capex server', 500011, false);
  const spare = await line('opex', 'Opex spare', 12, false);
  const extra = await line('capex', 'Capex extra', 500012, false);
  const versionId = (await one(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, budget_year, as_of_date) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, opex, `Budget ${YEAR}`, YEAR, `${YEAR}-01-01`],
  )).id as string;
  await runner.query(
    `INSERT INTO spend_amounts (tenant_id, version_id, period, planned, committed) VALUES ($1, $2, $3, 100, 0), ($1, $2, $4, 50, 0)`,
    [tenantId, versionId, `${YEAR}-01-01`, `${YEAR}-02-01`],
  );
  await runner.query(
    `INSERT INTO portfolio_request_opex (tenant_id, request_id, opex_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, requestId, opex, capex],
  );

  return {
    tenantId, userId, contributorId, requestId, hiddenRequestId,
    apps: { alpha, mid, owned },
    assets: { alpha: assetAlpha, mid: assetMid, free: assetFree },
    processes: { linked: linkedProcess, free: freeProcess },
    projects: { alpha: projectAlpha, mid: projectMid },
    lines: { opex, capex, spare, extra },
  };
}

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'rtab-payload');
    const { http } = httpOf();
    const res = await http.getRelations(seed.requestId, req(runner, seed, READ));

    assert.equal(res.year, YEAR);
    assert.deepEqual(res.budget_column, { key: 'planned', label: 'Budget' });
    assert.deepEqual(res.budget_lines?.map((line) => [line.id, line.item_number, line.nature, line.product_name, line.supplier_name, line.amount, line.currency, line.status]), [
      [seed.lines.capex, 500011, 'capex', 'Capex server', null, null, 'EUR', 'enabled'],
      [seed.lines.opex, 11, 'opex', 'Opex licence', 'Acme rtab-payload', 150, 'EUR', 'enabled'],
    ]);
    assert.deepEqual(res.applications, [
      { id: seed.apps.alpha.id, reference: seed.apps.alpha.reference, name: 'Alpha app', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
      { id: seed.apps.mid.id, reference: seed.apps.mid.reference, name: 'Mid app', lifecycle: 'active', business_criticality: null, status: 'enabled' },
      { id: seed.apps.owned.id, reference: seed.apps.owned.reference, name: 'Owned app', lifecycle: 'active', business_criticality: 'low', status: 'enabled' },
    ]);
    assert.match(seed.apps.alpha.reference, /^APP-\d+$/);
    assert.deepEqual(res.assets, [
      { id: seed.assets.alpha.id, reference: seed.assets.alpha.reference, name: 'Alpha srv', kind: 'physical_server', environment: 'prod', status: 'active' },
      { id: seed.assets.mid.id, reference: seed.assets.mid.reference, name: 'Mid srv', kind: 'virtual_machine', environment: 'test', status: 'active' },
    ]);
    assert.match(seed.assets.alpha.reference, /^AST-\d+$/);
    assert.deepEqual(res.processes, [
      { id: seed.processes.linked, name: 'Order to cash', status: 'enabled', owner_name: 'Claire Dubois' },
    ]);
    assert.deepEqual(res.resulting_projects, [
      { id: seed.projects.alpha.id, item_number: 3, name: 'Alpha project', status: 'in_progress' },
      { id: seed.projects.mid.id, item_number: 8, name: 'Mid project', status: 'planned' },
    ]);
  });
}

async function testHiddenWithoutRights() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'rtab-noread');
    const { http } = httpOf();
    const res = await http.getRelations(seed.requestId, req(runner, seed, { portfolio_requests: 'reader' }));
    assert.equal(res.year, YEAR);
    assert.equal(res.budget_lines, null);
    assert.equal(res.applications, null);
    assert.equal(res.assets, null);
    assert.equal(res.processes, null);
    assert.equal(res.resulting_projects, null);
  });
}

async function testParticipation() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'rtab-scope');
    const { http } = httpOf();
    const scoped = req(runner, seed, WRITE, seed.contributorId);
    const res = await http.getRelations(seed.requestId, scoped);
    assert.deepEqual(res.applications?.map((row) => row.id), [seed.apps.owned.id]);
    assert.deepEqual(res.resulting_projects?.map((row) => row.id), [seed.projects.alpha.id]);

    const hiddenRequest = await rejection(() => http.getRelations(seed.hiddenRequestId, scoped));
    assert.ok(hiddenRequest instanceof NotFoundException);
    assert.equal(hiddenRequest.message, 'Request not found');

    const hidden = await rejection(() => http.unlinkRelation(seed.requestId, 'applications', seed.apps.mid.id, scoped));
    assert.ok(hidden instanceof BadRequestException);
    assert.equal(hidden.message, 'One or more applications were not found');
    assert.deepEqual(
      await ids(runner, 'portfolio_request_applications', 'application_id', 'request_id', seed.requestId),
      [seed.apps.alpha.id, seed.apps.mid.id, seed.apps.owned.id].sort(),
    );

    assert.deepEqual(
      await http.unlinkRelation(seed.requestId, 'applications', seed.apps.owned.id, scoped),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await ids(runner, 'portfolio_request_applications', 'application_id', 'request_id', seed.requestId),
      [seed.apps.alpha.id, seed.apps.mid.id].sort(),
    );
    const after = await http.getRelations(seed.requestId, scoped);
    assert.deepEqual(after.applications, []);
  });
}

async function testLinksActivityAndAudit() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'rtab-links');
    const { http, audit } = httpOf();
    const writer = req(runner, seed, WRITE);

    assert.deepEqual(
      await http.linkRelation(seed.requestId, 'applications', { id: seed.apps.alpha.id }, writer),
      { ok: true, changed: false },
    );
    assert.deepEqual(await activities(runner, seed.requestId), []);

    assert.deepEqual(
      await http.linkRelation(seed.requestId, 'budget_lines', { id: seed.lines.spare }, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await http.linkRelation(seed.requestId, 'budget_lines', { id: seed.lines.extra }, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(await activities(runner, seed.requestId), [
      // Each side stores the lines with their ids, so the history can be read per reader.
      { opex_items: [[{ id: seed.lines.opex, label: 'Opex licence' }], [{ id: seed.lines.opex, label: 'Opex licence' }, { id: seed.lines.spare, label: 'Opex spare' }]] },
      { capex_items: [[{ id: seed.lines.capex, label: 'Capex server' }], [{ id: seed.lines.extra, label: 'Capex extra' }, { id: seed.lines.capex, label: 'Capex server' }]] },
    ]);
    assert.deepEqual(
      await http.unlinkRelation(seed.requestId, 'budget_lines', seed.lines.opex, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await ids(runner, 'portfolio_request_opex', 'opex_id', 'request_id', seed.requestId),
      [seed.lines.capex, seed.lines.spare, seed.lines.extra].sort(),
    );

    assert.deepEqual(
      await http.linkRelation(seed.requestId, 'assets', { id: seed.assets.free.id }, writer),
      { ok: true, changed: true },
    );
    const assetActivity = (await activities(runner, seed.requestId)).find((row) => row && typeof row === 'object' && 'assets' in (row as object));
    assert.deepEqual(assetActivity, { assets: [['Alpha srv', 'Mid srv'], ['Alpha srv', 'Free srv', 'Mid srv']] });

    const linked = [seed.processes.linked, seed.processes.free].sort();
    assert.deepEqual(
      await http.linkRelation(seed.requestId, 'processes', { id: seed.processes.free }, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await http.linkRelation(seed.requestId, 'processes', { id: seed.processes.free }, writer),
      { ok: true, changed: false },
    );
    assert.deepEqual(audit.entries, [{
      table: 'portfolio_request_business_processes', recordId: seed.requestId, action: 'update',
      before: [seed.processes.linked], after: linked, userId: seed.userId,
    }]);
    assert.deepEqual(
      await http.unlinkRelation(seed.requestId, 'processes', seed.processes.linked, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(audit.entries[1].before, linked);
    assert.deepEqual(audit.entries[1].after, [seed.processes.free]);
    assert.deepEqual(
      await http.unlinkRelation(seed.requestId, 'processes', seed.processes.linked, writer),
      { ok: true, changed: false },
    );
    assert.equal(audit.entries.length, 2);
    const shown = await http.getRelations(seed.requestId, req(runner, seed, READ));
    assert.deepEqual(shown.processes, [
      { id: seed.processes.free, name: 'Procure to pay', status: 'enabled', owner_name: null },
    ]);
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'rtab-refuse');
    const { http, audit } = httpOf();
    const writer = req(runner, seed, WRITE);
    const missing = randomUUID();

    const unknown = await rejection(() => http.linkRelation(missing, 'resulting_projects', { id: 'nope' }, writer));
    assert.ok(unknown instanceof NotFoundException);
    assert.equal(unknown.message, 'Unknown relation type.');
    const garbage = await rejection(() => http.unlinkRelation(seed.requestId, 'nope', seed.apps.alpha.id, writer));
    assert.equal(garbage.message, 'Unknown relation type.');

    const noProcess = req(runner, seed, { portfolio_requests: 'contributor' });
    const noRead = await rejection(() => http.linkRelation(missing, 'processes', { id: 'nope' }, noProcess));
    assertModuleRight(noRead, 'business_processes', 'reader', 'You cannot read this module.');
    const readerOnly = req(runner, seed, { portfolio_requests: 'contributor', business_processes: 'reader' });
    const noEdit = await rejection(() => http.unlinkRelation(seed.requestId, 'processes', 'nope', readerOnly));
    assertModuleRight(noEdit, 'business_processes', 'member', 'You cannot edit this module.');

    const noBudget = req(runner, seed, { portfolio_requests: 'contributor', business_processes: 'member' });
    const noBudgetRead = await rejection(() => http.linkRelation(seed.requestId, 'budget_lines', { id: 'nope' }, noBudget));
    assertModuleRight(noBudgetRead, 'budget', 'reader', 'You cannot read this module.');

    const invalid = await rejection(() => http.linkRelation(missing, 'applications', { id: 'nope' }, writer));
    assert.ok(invalid instanceof BadRequestException);
    assert.equal(invalid.message, 'Invalid id.');
    const gone = await rejection(() => http.linkRelation(missing, 'assets', { id: randomUUID() }, writer));
    assert.ok(gone instanceof NotFoundException);
    assert.equal(gone.message, 'Request not found');
    const missingGet = await rejection(() => http.getRelations(missing, req(runner, seed, READ)));
    assert.equal(missingGet.message, 'Request not found');

    const missingApp = await rejection(() => http.linkRelation(seed.requestId, 'applications', { id: randomUUID() }, writer));
    assert.equal(missingApp.message, 'One or more applications were not found');
    const missingAsset = await rejection(() => http.linkRelation(seed.requestId, 'assets', { id: randomUUID() }, writer));
    assert.equal(missingAsset.message, 'One or more assets were not found');
    const missingProcess = await rejection(() => http.linkRelation(seed.requestId, 'processes', { id: randomUUID() }, writer));
    assert.equal(missingProcess.message, 'One or more business processes were not found.');
    const missingLine = await rejection(() => http.linkRelation(seed.requestId, 'budget_lines', { id: randomUUID() }, writer));
    assert.equal(missingLine.message, 'Budget line not found.');

    assert.equal(audit.entries.length, 0);
    assert.deepEqual(await activities(runner, seed.requestId), []);
    assert.deepEqual(
      await ids(runner, 'portfolio_request_business_processes', 'business_process_id', 'request_id', seed.requestId),
      [seed.processes.linked],
    );
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTab(runner, 'rtab-a');
    const b = await seedTab(runner, 'rtab-b');
    await setTenant(runner, b.tenantId);
    const { http } = httpOf();
    const reader = req(runner, b, READ);
    const writer = req(runner, b, WRITE);

    for (const call of [
      () => http.getRelations(a.requestId, reader),
      () => http.linkRelation(a.requestId, 'applications', { id: b.apps.alpha.id }, writer),
      () => http.unlinkRelation(a.requestId, 'assets', a.assets.alpha.id, writer),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof NotFoundException);
      assert.equal(err.message, 'Request not found');
    }

    const foreign = await rejection(() => http.linkRelation(b.requestId, 'applications', { id: a.apps.alpha.id }, writer));
    assert.ok(foreign instanceof BadRequestException);
    assert.equal(foreign.message, 'One or more applications were not found');
    const foreignProcess = await rejection(() => http.linkRelation(b.requestId, 'processes', { id: a.processes.free }, writer));
    assert.equal(foreignProcess.message, 'One or more business processes were not found.');
    const own = await http.getRelations(b.requestId, reader);
    assert.deepEqual(own.resulting_projects?.map((row) => row.name), ['Alpha project', 'Mid project']);
    assert.deepEqual(
      await ids(runner, 'portfolio_request_business_processes', 'business_process_id', 'request_id', b.requestId),
      [b.processes.linked],
    );

    await setTenant(runner, a.tenantId);
    const back = await http.getRelations(a.requestId, req(runner, a, READ));
    assert.equal(back.processes?.length, 1);
  });
}

void runSpecs('request-relations-tab.integration.spec', [
  ['testPayload', testPayload],
  ['testHiddenWithoutRights', testHiddenWithoutRights],
  ['testParticipation', testParticipation],
  ['testLinksActivityAndAudit', testLinksActivityAndAudit],
  ['testRefusals', testRefusals],
  ['testTenantIsolation', testTenantIsolation],
]);
