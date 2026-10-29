// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { PortfolioRequestsService } from '../portfolio-requests.service';
import { PortfolioProjectsController } from '../portfolio-projects.controller';
import { PortfolioRelationsService } from '../portfolio-relations.service';
import { PortfolioDependenciesService } from '../services/portfolio-dependencies.service';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { PortfolioProjectsService } from '../services/portfolio-projects.service';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// GET/POST/DELETE /portfolio/projects/:id/relations, on an empty migrated database:
// the tab in one round trip, one link at a time, the activity or the audit, the refusals,
// a Business Contributor's participation, and a project of another tenant.

const YEAR = new Date().getUTCFullYear();

type Ref = { id: string; reference: string };

type Seed = {
  tenantId: string;
  userId: string;
  contributorId: string;
  projectId: string;
  apps: { alpha: Ref; mid: Ref; owned: Ref };
  assets: { alpha: Ref; mid: Ref; free: Ref };
  techs: { alpha: Ref; free: Ref };
  requests: { source: { id: string; item_number: number }; other: { id: string; item_number: number } };
  lines: { opex: string; capex: string; spare: string; extra: string };
};

const READ = {
  portfolio_projects: 'reader',
  budget: 'reader',
  applications: 'reader',
  infrastructure: 'reader',
  portfolio_requests: 'reader',
};
const WRITE = { ...READ, portfolio_projects: 'contributor' };

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
  const projects = projectsService();
  const requests = new PortfolioRequestsService(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
    undefined as any, undefined as any, undefined as any, undefined as any,
  );
  const relations = new PortfolioRelationsService(projects, requests, fxRates() as any, audit as any);
  return {
    audit,
    http: new PortfolioProjectsController(
      projects, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, relations,
    ),
  };
}

function ctx(runner: QueryRunner, seed: Seed, permissions: Record<string, string>, userId = seed.userId) {
  return {
    tenantId: seed.tenantId,
    userId,
    userRoles: [],
    isAdmin: false,
    permissions,
    manager: runner.manager,
    queryRunner: { manager: runner.manager },
  } as any;
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

async function activities(runner: QueryRunner, projectId: string): Promise<unknown[]> {
  const rows: Array<{ changed_fields: unknown }> = await runner.query(
    `SELECT changed_fields FROM portfolio_activities WHERE project_id = $1`,
    [projectId],
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
  const userId = await user(`proj-${tag}-${tenantId.slice(0, 8)}@example.test`, memberRole, 'Ada', 'Martin');
  const contributorId = await user(`proj-${tag}-bc-${tenantId.slice(0, 8)}@example.test`, contributorRole, 'Luc', 'Bernard');
  const supplierId = (await one(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Acme ${tag}`],
  )).id as string;
  const projectId = (await one(
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, status, it_lead_id) VALUES ($1, $2, 3, 'in_progress', $3) RETURNING id`,
    [tenantId, `Relations project ${tag}`, contributorId],
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
    `INSERT INTO application_projects (tenant_id, application_id, project_id) VALUES ($1, $2, $3), ($1, $4, $3), ($1, $5, $3)`,
    [tenantId, alpha.id, projectId, mid.id, owned.id],
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
    `INSERT INTO asset_projects (tenant_id, asset_id, project_id) VALUES ($1, $2, $3), ($1, $4, $3)`,
    [tenantId, assetAlpha.id, projectId, assetMid.id],
  );

  const tech = async (n: number, name: string, editor: string | null) => {
    const row = await one(
      `INSERT INTO technologies (tenant_id, item_number, name, family, editor) VALUES ($1, $2, $3, 'database', $4) RETURNING id`,
      [tenantId, n, name, editor],
    );
    return { id: row.id as string, reference: `TEC-${n}` };
  };
  const techAlpha = await tech(1, 'Alpha tech', 'Oracle');
  const techFree = await tech(2, 'Free tech', null);
  await runner.query(
    `INSERT INTO technology_projects (tenant_id, technology_id, project_id) VALUES ($1, $2, $3)`,
    [tenantId, techAlpha.id, projectId],
  );

  const request = async (name: string, itemNumber: number, requestor: string | null, status: string) => {
    const row = await one(
      `INSERT INTO portfolio_requests (tenant_id, name, item_number, status, requestor_id) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, name, itemNumber, status, requestor],
    );
    return { id: row.id as string, item_number: itemNumber };
  };
  const source = await request('From request', 4, contributorId, 'approved');
  const other = await request('Other request', 9, null, 'candidate');
  await runner.query(
    `INSERT INTO portfolio_request_projects (tenant_id, request_id, project_id) VALUES ($1, $2, $3), ($1, $4, $3)`,
    [tenantId, source.id, projectId, other.id],
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
    `INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, projectId, opex, capex],
  );

  return {
    tenantId, userId, contributorId, projectId,
    apps: { alpha, mid, owned },
    assets: { alpha: assetAlpha, mid: assetMid, free: assetFree },
    techs: { alpha: techAlpha, free: techFree },
    requests: { source, other },
    lines: { opex, capex, spare, extra },
  };
}

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ptab-payload');
    const { http } = httpOf();
    const res = await http.getRelations(seed.projectId, ctx(runner, seed, READ));

    assert.equal(res.year, YEAR);
    assert.deepEqual(res.budget_column, { key: 'planned', label: 'Budget' });
    assert.deepEqual(res.budget_lines?.map((line) => [line.id, line.item_number, line.nature, line.product_name, line.supplier_name, line.amount, line.currency, line.status]), [
      [seed.lines.capex, 500011, 'capex', 'Capex server', null, null, 'EUR', 'enabled'],
      [seed.lines.opex, 11, 'opex', 'Opex licence', `Acme ptab-payload`, 150, 'EUR', 'enabled'],
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
    assert.deepEqual(res.technologies, [
      { id: seed.techs.alpha.id, reference: 'TEC-1', name: 'Alpha tech', family: 'database', vendor: 'Oracle' },
    ]);
    assert.deepEqual(res.source_requests, [
      { id: seed.requests.source.id, item_number: 4, name: 'From request', status: 'approved' },
      { id: seed.requests.other.id, item_number: 9, name: 'Other request', status: 'candidate' },
    ]);
  });
}

async function testHiddenWithoutRights() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ptab-noread');
    const { http } = httpOf();
    const res = await http.getRelations(seed.projectId, ctx(runner, seed, { portfolio_projects: 'reader' }));
    assert.equal(res.year, YEAR);
    assert.equal(res.budget_lines, null);
    assert.equal(res.applications, null);
    assert.equal(res.assets, null);
    assert.equal(res.technologies, null);
    assert.equal(res.source_requests, null);
  });
}

async function testParticipation() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ptab-scope');
    const { http } = httpOf();
    const scoped = ctx(runner, seed, WRITE, seed.contributorId);
    const res = await http.getRelations(seed.projectId, scoped);
    assert.deepEqual(res.applications?.map((row) => row.id), [seed.apps.owned.id]);
    assert.deepEqual(res.source_requests?.map((row) => row.id), [seed.requests.source.id]);

    const hidden = await rejection(() => http.unlinkRelation(seed.projectId, 'applications', seed.apps.mid.id, scoped));
    assert.ok(hidden instanceof BadRequestException);
    assert.equal(hidden.message, 'One or more applications were not found');
    assert.deepEqual(
      await ids(runner, 'application_projects', 'application_id', 'project_id', seed.projectId),
      [seed.apps.alpha.id, seed.apps.mid.id, seed.apps.owned.id].sort(),
    );

    assert.deepEqual(
      await http.unlinkRelation(seed.projectId, 'applications', seed.apps.owned.id, scoped),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await ids(runner, 'application_projects', 'application_id', 'project_id', seed.projectId),
      [seed.apps.alpha.id, seed.apps.mid.id].sort(),
    );
    const after = await http.getRelations(seed.projectId, scoped);
    assert.deepEqual(after.applications, []);
  });
}

async function testLinksActivityAndAudit() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ptab-links');
    const { http, audit } = httpOf();
    const writer = ctx(runner, seed, WRITE);

    assert.deepEqual(
      await http.linkRelation(seed.projectId, 'applications', { id: seed.apps.alpha.id }, writer),
      { ok: true, changed: false },
    );
    assert.deepEqual(await activities(runner, seed.projectId), []);

    assert.deepEqual(
      await http.linkRelation(seed.projectId, 'budget_lines', { id: seed.lines.spare }, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await http.linkRelation(seed.projectId, 'budget_lines', { id: seed.lines.spare }, writer),
      { ok: true, changed: false },
    );
    assert.deepEqual(
      await http.linkRelation(seed.projectId, 'budget_lines', { id: seed.lines.extra }, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(await activities(runner, seed.projectId), [
      // Each side stores the lines with their ids, so the history can be read per reader.
      { opex_items: [[{ id: seed.lines.opex, label: 'Opex licence' }], [{ id: seed.lines.opex, label: 'Opex licence' }, { id: seed.lines.spare, label: 'Opex spare' }]] },
      { capex_items: [[{ id: seed.lines.capex, label: 'Capex server' }], [{ id: seed.lines.extra, label: 'Capex extra' }, { id: seed.lines.capex, label: 'Capex server' }]] },
    ]);
    assert.deepEqual(
      await ids(runner, 'portfolio_project_opex', 'opex_id', 'project_id', seed.projectId),
      [seed.lines.opex, seed.lines.capex, seed.lines.spare, seed.lines.extra].sort(),
    );

    assert.deepEqual(
      await http.unlinkRelation(seed.projectId, 'budget_lines', seed.lines.opex, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await ids(runner, 'portfolio_project_opex', 'opex_id', 'project_id', seed.projectId),
      [seed.lines.capex, seed.lines.spare, seed.lines.extra].sort(),
    );
    assert.deepEqual(
      await http.unlinkRelation(seed.projectId, 'budget_lines', seed.lines.opex, writer),
      { ok: true, changed: false },
    );

    assert.deepEqual(
      await http.linkRelation(seed.projectId, 'assets', { id: seed.assets.free.id }, writer),
      { ok: true, changed: true },
    );
    const assetActivity = (await activities(runner, seed.projectId)).find((row) => row && typeof row === 'object' && 'assets' in (row as object));
    assert.deepEqual(assetActivity, { assets: [['Alpha srv', 'Mid srv'], ['Alpha srv', 'Free srv', 'Mid srv']] });

    const linked = [seed.techs.alpha.id, seed.techs.free.id].sort();
    assert.deepEqual(
      await http.linkRelation(seed.projectId, 'technologies', { id: seed.techs.free.id }, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await http.linkRelation(seed.projectId, 'technologies', { id: seed.techs.free.id }, writer),
      { ok: true, changed: false },
    );
    assert.deepEqual(audit.entries, [{
      table: 'technology_projects', recordId: seed.projectId, action: 'update',
      before: [seed.techs.alpha.id], after: linked, userId: seed.userId,
    }]);
    assert.deepEqual(
      await http.unlinkRelation(seed.projectId, 'technologies', seed.techs.alpha.id, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(audit.entries[1], {
      table: 'technology_projects', recordId: seed.projectId, action: 'update',
      before: linked, after: [seed.techs.free.id], userId: seed.userId,
    });
    assert.deepEqual(
      await http.unlinkRelation(seed.projectId, 'technologies', seed.techs.alpha.id, writer),
      { ok: true, changed: false },
    );
    assert.equal(audit.entries.length, 2);
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'ptab-refuse');
    const { http, audit } = httpOf();
    const writer = ctx(runner, seed, WRITE);
    const missing = randomUUID();

    const unknown = await rejection(() => http.linkRelation(missing, 'source_requests', { id: 'nope' }, writer));
    assert.ok(unknown instanceof NotFoundException);
    assert.equal(unknown.message, 'Unknown relation type.');
    const garbage = await rejection(() => http.unlinkRelation(seed.projectId, 'nope', seed.apps.alpha.id, writer));
    assert.equal(garbage.message, 'Unknown relation type.');

    const noTech = ctx(runner, seed, { portfolio_projects: 'contributor' });
    const refused = await rejection(() => http.linkRelation(missing, 'technologies', { id: 'nope' }, noTech));
    assertModuleRight(refused, 'infrastructure', 'reader', 'You cannot read technologies.');

    const noBudget = ctx(runner, seed, { portfolio_projects: 'contributor', infrastructure: 'reader', applications: 'reader' });
    const noBudgetRead = await rejection(() => http.linkRelation(seed.projectId, 'budget_lines', { id: 'nope' }, noBudget));
    assertModuleRight(noBudgetRead, 'budget', 'reader', 'You cannot read this module.');

    const invalid = await rejection(() => http.linkRelation(missing, 'applications', { id: 'nope' }, writer));
    assert.ok(invalid instanceof BadRequestException);
    assert.equal(invalid.message, 'Invalid id.');
    const gone = await rejection(() => http.linkRelation(missing, 'assets', { id: randomUUID() }, writer));
    assert.ok(gone instanceof NotFoundException);
    assert.equal(gone.message, 'Project not found');
    const missingGet = await rejection(() => http.getRelations(missing, ctx(runner, seed, READ)));
    assert.equal(missingGet.message, 'Project not found');

    const missingApp = await rejection(() => http.linkRelation(seed.projectId, 'applications', { id: randomUUID() }, writer));
    assert.equal(missingApp.message, 'One or more applications were not found');
    const missingAsset = await rejection(() => http.linkRelation(seed.projectId, 'assets', { id: randomUUID() }, writer));
    assert.equal(missingAsset.message, 'One or more assets were not found');
    const missingTech = await rejection(() => http.linkRelation(seed.projectId, 'technologies', { id: randomUUID() }, writer));
    assert.equal(missingTech.message, 'One or more technologies not found.');
    const missingLine = await rejection(() => http.linkRelation(seed.projectId, 'budget_lines', { id: randomUUID() }, writer));
    assert.equal(missingLine.message, 'Budget line not found.');

    assert.equal(audit.entries.length, 0);
    assert.deepEqual(await activities(runner, seed.projectId), []);
    assert.deepEqual(
      await ids(runner, 'technology_projects', 'technology_id', 'project_id', seed.projectId),
      [seed.techs.alpha.id],
    );
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTab(runner, 'ptab-a');
    const b = await seedTab(runner, 'ptab-b');
    await setTenant(runner, b.tenantId);
    const { http } = httpOf();
    const reader = ctx(runner, b, READ);
    const writer = ctx(runner, b, WRITE);

    for (const call of [
      () => http.getRelations(a.projectId, reader),
      () => http.linkRelation(a.projectId, 'applications', { id: b.apps.alpha.id }, writer),
      () => http.unlinkRelation(a.projectId, 'assets', a.assets.alpha.id, writer),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof NotFoundException);
      assert.equal(err.message, 'Project not found');
    }

    const foreign = await rejection(() => http.linkRelation(b.projectId, 'applications', { id: a.apps.alpha.id }, writer));
    assert.ok(foreign instanceof BadRequestException);
    assert.equal(foreign.message, 'One or more applications were not found');
    const foreignTech = await rejection(() => http.linkRelation(b.projectId, 'technologies', { id: a.techs.free.id }, writer));
    assert.equal(foreignTech.message, 'One or more technologies not found.');
    const own = await http.getRelations(b.projectId, reader);
    assert.deepEqual(own.applications?.map((row) => row.name), ['Alpha app', 'Mid app', 'Owned app']);
    assert.deepEqual(
      await ids(runner, 'technology_projects', 'technology_id', 'project_id', b.projectId),
      [b.techs.alpha.id],
    );

    await setTenant(runner, a.tenantId);
    const back = await http.getRelations(a.projectId, ctx(runner, a, READ));
    assert.equal(back.technologies?.length, 1);
  });
}

void runSpecs('project-relations-tab.integration.spec', [
  ['testPayload', testPayload],
  ['testHiddenWithoutRights', testHiddenWithoutRights],
  ['testParticipation', testParticipation],
  ['testLinksActivityAndAudit', testLinksActivityAndAudit],
  ['testRefusals', testRefusals],
  ['testTenantIsolation', testTenantIsolation],
]);
