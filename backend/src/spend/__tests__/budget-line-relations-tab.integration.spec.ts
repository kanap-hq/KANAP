// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from './round-inputs.fixtures';
import { BudgetLinesController } from '../budget-lines.controller';
import { BudgetLinesService } from '../budget-lines.service';
import { countItemRelations } from '../item-workspace.util';

// GET/POST/DELETE /budget-lines/:id/relations (lot R2d), on an empty migrated database:
// the tab of an OPEX line and of a CAPEX line, the supplier suggestions, one link at a time
// and its audit, the refusals, a Business Contributor's participation, the badge, and another tenant.

type Ref = { id: string; reference: string };

type Seed = {
  tenantId: string;
  readerId: string;
  contributorId: string;
  supplierName: string;
  opexId: string;
  opexNumber: number;
  capexId: string;
  capexNumber: number;
  capexLegacy: string;
  bareId: string;
  spareId: string;
  projects: { alpha: { id: string; item_number: number }; zulu: { id: string; item_number: number }; capex: { id: string; item_number: number }; free: { id: string } };
  apps: {
    alpha: Ref;
    mid: Ref;
    delta: Ref;
    cedar: Ref;
    echo: Ref;
    capex: Ref;
    disabled: Ref;
    ended: Ref;
    other: Ref;
  };
  contracts: { alpha: string; cedar: string; capex: string; disabled: string; ended: string; other: string };
  assets: { alpha: Ref; capex: Ref; free: Ref };
  techs: { alpha: Ref; mid: Ref; capex: Ref };
};

const ALL = {
  budget: 'reader',
  portfolio_projects: 'reader',
  applications: 'reader',
  infrastructure: 'reader',
  contracts: 'reader',
};
const WRITE = { ...ALL, budget: 'member' };

function httpOf(audit = captureAudit()) {
  const svc = new BudgetLinesService(
    undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any,
    audit as any,
  );
  return { audit, http: new BudgetLinesController(svc, undefined as any, undefined as any) };
}

function ctx(runner: QueryRunner, seed: Seed, permissions: Record<string, string>, userId: string | null = seed.readerId, isAdmin = false) {
  return {
    tenantId: seed.tenantId,
    userId,
    userRoles: [],
    isAdmin,
    permissions,
    manager: runner.manager,
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

async function linkIds(runner: QueryRunner, table: string, column: string, ownerColumn: string, ownerId: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await runner.query(
    `SELECT ${column} AS id FROM ${table} WHERE ${ownerColumn} = $1`,
    [ownerId],
  );
  return rows.map((row) => row.id).sort();
}

const suggestion = (type: 'application' | 'contract', row: { id: string; reference: string | null; name: string }) => ({
  type,
  id: row.id,
  reference: row.reference,
  name: row.name,
  via: { kind: 'same_supplier' as const, label: null },
});

async function seedTab(runner: QueryRunner, tag: string): Promise<Seed> {
  const tenantId = await seedTenant(runner, tag);
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
  const readerRole = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Budget reader') RETURNING id`,
    [tenantId],
  )).id as string;
  const contributorRole = (await one(
    `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Business Contributor') RETURNING id`,
    [tenantId],
  )).id as string;
  // A permission on the Business Contributor role itself does not lift the participation scope.
  await runner.query(
    `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'applications', 'reader'), ($1, $2, 'portfolio_projects', 'reader')`,
    [tenantId, contributorRole],
  );
  const user = (roleId: string, name: string) => one(
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'Martin') RETURNING id`,
    [tenantId, `${name}-${tag}-${tenantId.slice(0, 8)}@example.test`, roleId, name],
  ).then((row) => row.id as string);
  const readerId = await user(readerRole, 'Rita');
  const contributorId = await user(contributorRole, 'Ada');

  const companyId = (await one(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon') RETURNING id`,
    [tenantId, `Line company ${tag}`],
  )).id as string;
  const supplierName = `Line supplier ${tag}`;
  const supplierId = (await one(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, supplierName],
  )).id as string;
  const otherSupplierId = (await one(
    `INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2) RETURNING id`,
    [tenantId, `Other supplier ${tag}`],
  )).id as string;

  const line = async (nature: 'opex' | 'capex', itemNumber: number, name: string, supplier: string | null) => {
    if (nature === 'opex') {
      const row = await one(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id)
         VALUES ($1, $2, 'EUR', '2026-01-01', $3, $4) RETURNING id`,
        [tenantId, name, itemNumber, supplier],
      );
      return row.id as string;
    }
    const row = await one(
      `INSERT INTO spend_items (tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number, supplier_id)
       VALUES ($1, 'capex', $2, 'hardware', 'replacement', 'medium', 'EUR', '2026-01-01', $3::int + 500000, 'CPX-' || $3::int, $4) RETURNING id`,
      [tenantId, name, itemNumber, supplier],
    );
    return row.id as string;
  };
  const opexNumber = 41;
  const opexId = await line('opex', opexNumber, `Opex line ${tag}`, supplierId);
  const capexNumber = opexNumber + 500000;
  const capexId = await line('capex', opexNumber, `Capex line ${tag}`, supplierId);
  const bareId = await line('opex', 42, `Bare line ${tag}`, null);
  const spareId = await line('opex', 43, `Spare line ${tag}`, supplierId);

  const project = async (name: string, itemNumber: number, plannedEnd: string | null, status: string) => {
    const row = await one(
      `INSERT INTO portfolio_projects (tenant_id, name, item_number, status, planned_end) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, name, itemNumber, status, plannedEnd],
    );
    return { id: row.id as string, item_number: itemNumber };
  };
  const alphaProject = await project('Alpha project', 3, '2026-06-01', 'in_progress');
  const zuluProject = await project('Zulu project', 4, null, 'planned');
  const capexProject = await project('Capex project', 5, '2027-01-15', 'planned');
  const freeProject = await project('Free project', 6, null, 'planned');
  await runner.query(
    `INSERT INTO portfolio_project_team (tenant_id, project_id, user_id, role) VALUES ($1, $2, $3, 'business_team')`,
    [tenantId, alphaProject.id, contributorId],
  );
  await runner.query(
    `INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3), ($1, $4, $3)`,
    [tenantId, alphaProject.id, opexId, zuluProject.id],
  );
  await runner.query(
    `INSERT INTO portfolio_project_opex (tenant_id, project_id, opex_id) VALUES ($1, $2, $3)`,
    [tenantId, capexProject.id, capexId],
  );

  const application = async (name: string, supplier: string, columns: { lifecycle?: string; criticality?: string | null; status?: string; ended?: boolean } = {}) => {
    const row = await one(
      `INSERT INTO applications (tenant_id, name, supplier_id, lifecycle, criticality, status, disabled_at)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::bool THEN now() - interval '1 day' ELSE NULL END)
       RETURNING id, sequential_id AS reference`,
      [tenantId, name, supplier, columns.lifecycle ?? 'active', columns.criticality ?? null, columns.status ?? 'enabled', columns.ended === true],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const alpha = await application('Alpha app', supplierId, { criticality: 'high' });
  const mid = await application('Mid app', supplierId, { lifecycle: 'proposed' });
  const delta = await application('Delta app', supplierId, {});
  const cedar = await application('Cedar app', supplierId, {});
  const echo = await application('Echo app', supplierId, {});
  const capexApp = await application('Capex app', supplierId, {});
  const disabled = await application('Old app', supplierId, { status: 'disabled' });
  const ended = await application('Ended app', supplierId, { ended: true });
  const other = await application('Other app', otherSupplierId, {});
  for (const owned of [mid, cedar]) {
    await runner.query(
      `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
      [tenantId, owned.id, contributorId],
    );
  }
  await runner.query(
    `INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3), ($1, $4, $3), ($1, $5, $3)`,
    [tenantId, alpha.id, opexId, mid.id, delta.id],
  );
  await runner.query(
    `INSERT INTO application_spend_items (tenant_id, application_id, spend_item_id) VALUES ($1, $2, $3)`,
    [tenantId, capexApp.id, capexId],
  );

  const contract = async (name: string, supplier: string, columns: { status?: string; ended?: boolean; yearly?: number | null } = {}) => {
    const row = await one(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, notice_period_months, auto_renewal, yearly_amount_at_signature, currency, status, disabled_at)
       VALUES ($1, $2, $3, $4, DATE '2026-01-01', 12, 1, true, $5, 'EUR', $6, CASE WHEN $7::bool THEN now() - interval '1 day' ELSE NULL END)
       RETURNING id`,
      [tenantId, name, companyId, supplier, columns.yearly ?? 0, columns.status ?? 'enabled', columns.ended === true],
    );
    return row.id as string;
  };
  const alphaContract = await contract('Alpha contract', supplierId, { yearly: 1200 });
  const cedarContract = await contract('Cedar contract', supplierId, {});
  const capexContract = await contract('Capex contract', supplierId, { yearly: 480 });
  const disabledContract = await contract('Old contract', supplierId, { status: 'disabled' });
  const endedContract = await contract('Ended contract', supplierId, { ended: true });
  const otherContract = await contract('Other contract', otherSupplierId, {});
  await runner.query(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`,
    [tenantId, alphaContract, opexId],
  );
  await runner.query(
    `INSERT INTO contract_spend_items (tenant_id, contract_id, spend_item_id) VALUES ($1, $2, $3)`,
    [tenantId, capexContract, capexId],
  );

  const asset = async (name: string, kind: string, environment: string) => {
    const row = await one(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', now(), now()) RETURNING id, asset_reference AS reference`,
      [tenantId, name, kind, environment],
    );
    return { id: row.id as string, reference: row.reference as string };
  };
  const alphaAsset = await asset('Alpha asset', 'physical_server', 'prod');
  const capexAsset = await asset('Capex asset', 'virtual_machine', 'test');
  const freeAsset = await asset('Free asset', 'physical_server', 'dev');
  await runner.query(
    `INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id) VALUES ($1, $2, $3)`,
    [tenantId, alphaAsset.id, opexId],
  );
  await runner.query(
    `INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id) VALUES ($1, $2, $3)`,
    [tenantId, capexAsset.id, capexId],
  );
  await runner.query(
    `INSERT INTO asset_spend_items (tenant_id, asset_id, spend_item_id) VALUES ($1, $2, $3)`,
    [tenantId, freeAsset.id, spareId],
  );

  const tech = async (n: number, name: string, family: string, editor: string | null) => {
    const row = await one(
      `INSERT INTO technologies (tenant_id, item_number, name, family, editor) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [tenantId, n, name, family, editor],
    );
    return { id: row.id as string, reference: `TEC-${n}` };
  };
  const techAlpha = await tech(1, 'Alpha tech', 'database', 'Oracle');
  const techMid = await tech(2, 'Mid tech', 'runtime', null);
  const techCapex = await tech(3, 'Capex tech', 'os', 'Debian');
  await runner.query(
    `INSERT INTO technology_spend_items (tenant_id, technology_id, spend_item_id) VALUES ($1, $2, $3), ($1, $4, $3)`,
    [tenantId, techAlpha.id, opexId, techMid.id],
  );
  await runner.query(
    `INSERT INTO technology_spend_items (tenant_id, technology_id, spend_item_id) VALUES ($1, $2, $3)`,
    [tenantId, techCapex.id, capexId],
  );

  return {
    tenantId,
    readerId,
    contributorId,
    supplierName,
    opexId,
    opexNumber,
    capexId,
    capexNumber,
    capexLegacy: `CPX-${opexNumber}`,
    bareId,
    spareId,
    projects: { alpha: alphaProject, zulu: zuluProject, capex: capexProject, free: { id: freeProject.id } },
    apps: { alpha, mid, delta, cedar, echo, capex: capexApp, disabled, ended, other },
    contracts: { alpha: alphaContract, cedar: cedarContract, capex: capexContract, disabled: disabledContract, ended: endedContract, other: otherContract },
    assets: { alpha: alphaAsset, capex: capexAsset, free: freeAsset },
    techs: { alpha: techAlpha, mid: techMid, capex: techCapex },
  };
}

function opexSuggestions(seed: Seed) {
  return [
    suggestion('application', { ...seed.apps.capex, name: 'Capex app' }),
    suggestion('contract', { id: seed.contracts.capex, reference: null, name: 'Capex contract' }),
    suggestion('application', { ...seed.apps.cedar, name: 'Cedar app' }),
    suggestion('contract', { id: seed.contracts.cedar, reference: null, name: 'Cedar contract' }),
    suggestion('application', { ...seed.apps.echo, name: 'Echo app' }),
  ];
}

async function testPayload() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'blrel-payload');
    const { http } = httpOf();
    const reader = ctx(runner, seed, ALL);
    const res = await http.relations(seed.opexId, reader);

    assert.deepEqual(Object.keys(res).sort(), ['applications', 'assets', 'contracts', 'contracts_hidden', 'projects', 'suggestions', 'technologies']);
    assert.deepEqual(res.projects, [
      { id: seed.projects.alpha.id, item_number: 3, name: 'Alpha project', status: 'in_progress', planned_end: '2026-06-01' },
      { id: seed.projects.zulu.id, item_number: 4, name: 'Zulu project', status: 'planned', planned_end: null },
    ]);
    assert.deepEqual(res.applications, [
      { id: seed.apps.alpha.id, reference: seed.apps.alpha.reference, name: 'Alpha app', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
      { id: seed.apps.delta.id, reference: seed.apps.delta.reference, name: 'Delta app', lifecycle: 'active', business_criticality: null, status: 'enabled' },
      { id: seed.apps.mid.id, reference: seed.apps.mid.reference, name: 'Mid app', lifecycle: 'proposed', business_criticality: null, status: 'enabled' },
    ]);
    assert.match(seed.apps.alpha.reference, /^APP-\d+$/);
    assert.deepEqual(res.technologies, [
      { id: seed.techs.alpha.id, reference: 'TEC-1', name: 'Alpha tech', family: 'database', vendor: 'Oracle' },
      { id: seed.techs.mid.id, reference: 'TEC-2', name: 'Mid tech', family: 'runtime', vendor: null },
    ]);
    assert.deepEqual(res.contracts, [
      {
        id: seed.contracts.alpha, name: 'Alpha contract', supplier_name: seed.supplierName,
        end_date: '2026-12-31', yearly_amount: 1200, currency: 'EUR', auto_renewal: true,
        in_renewal_window: true, status: 'enabled',
        // The line has no paying company; the contract names one. Cost center is unset on the contract, so it is not checked.
        mismatches: [{ field: 'paying_company', line_value: null, contract_value: `Line company ${'blrel-payload'}` }],
      },
    ]);
    assert.deepEqual(res.assets, [
      { id: seed.assets.alpha.id, reference: seed.assets.alpha.reference, name: 'Alpha asset', kind: 'physical_server', environment: 'prod', status: 'active' },
    ]);
    assert.match(seed.assets.alpha.reference, /^AST-\d+$/);
    assert.ok(!res.assets.some((row) => row.id === seed.assets.capex.id), 'a CAPEX asset stays off the OPEX line');
    assert.deepEqual(res.suggestions, opexSuggestions(seed));

    const byRef = await http.relations(`BL-${seed.opexNumber}`, reader);
    assert.deepEqual(byRef.applications?.map((row) => row.id), res.applications?.map((row) => row.id));

    const capex = await http.relations(seed.capexId, reader);
    assert.deepEqual(capex.projects, [
      { id: seed.projects.capex.id, item_number: 5, name: 'Capex project', status: 'planned', planned_end: '2027-01-15' },
    ]);
    assert.deepEqual(capex.applications?.map((row) => row.id), [seed.apps.capex.id]);
    assert.deepEqual(capex.technologies, [
      { id: seed.techs.capex.id, reference: 'TEC-3', name: 'Capex tech', family: 'os', vendor: 'Debian' },
    ]);
    assert.equal(capex.contracts?.[0].id, seed.contracts.capex);
    assert.equal(capex.contracts?.[0].yearly_amount, 480);
    assert.deepEqual(capex.assets?.map((row) => row.id), [seed.assets.capex.id]);
    assert.ok(!capex.assets?.some((row) => row.id === seed.assets.alpha.id));
    assert.deepEqual(capex.suggestions.map((row) => row.id), [
      seed.apps.alpha.id,
      seed.contracts.alpha,
      seed.apps.cedar.id,
      seed.contracts.cedar,
      seed.apps.delta.id,
      seed.apps.echo.id,
      seed.apps.mid.id,
    ]);
    const byLegacy = await http.relations(seed.capexLegacy, reader);
    assert.deepEqual(byLegacy.assets?.map((row) => row.id), [seed.assets.capex.id]);
    const byBl = await http.relations(`BL-${seed.capexNumber}`, reader);
    assert.equal(byBl.contracts?.[0].id, seed.contracts.capex);

    const bare = await http.relations(seed.bareId, reader);
    assert.deepEqual(bare.projects, []);
    assert.deepEqual(bare.applications, []);
    assert.deepEqual(bare.technologies, []);
    assert.deepEqual(bare.contracts, []);
    assert.deepEqual(bare.assets, []);
    assert.deepEqual(bare.suggestions, [], 'a line with no supplier has no suggestion');

    const budgetOnly = ctx(runner, seed, { budget: 'reader' });
    const hidden = await http.relations(seed.opexId, budgetOnly);
    assert.equal(hidden.projects, null);
    assert.equal(hidden.applications, null);
    assert.equal(hidden.technologies, null);
    assert.equal(hidden.contracts, null);
    assert.equal(hidden.assets, null);
    assert.deepEqual(hidden.suggestions, []);

    const noInfra = await http.relations(seed.opexId, ctx(runner, seed, { ...ALL, infrastructure: 'none' }));
    assert.equal(noInfra.technologies, null);
    assert.equal(noInfra.assets, null);
    assert.deepEqual(noInfra.suggestions, opexSuggestions(seed));

    const noContracts = await http.relations(seed.opexId, ctx(runner, seed, { ...ALL, contracts: 'none' }));
    assert.equal(noContracts.contracts, null);
    assert.deepEqual(noContracts.suggestions.filter((row) => row.type === 'contract'), []);
    assert.ok(noContracts.suggestions.some((row) => row.type === 'application'));
  });
}

async function testContributor() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'blrel-scope');
    const { audit, http } = httpOf();
    const who = ctx(runner, seed, WRITE, seed.contributorId);
    const res = await http.relations(seed.opexId, who);

    assert.deepEqual(res.projects?.map((row) => row.id), [seed.projects.alpha.id]);
    assert.deepEqual(res.applications?.map((row) => row.id), [seed.apps.mid.id]);
    assert.deepEqual(res.assets?.map((row) => row.id), [seed.assets.alpha.id], 'assets have no participation scope');
    assert.equal(res.technologies?.length, 2);
    assert.equal(res.contracts?.length, 1);
    assert.deepEqual(res.suggestions, [
      suggestion('contract', { id: seed.contracts.capex, reference: null, name: 'Capex contract' }),
      suggestion('application', { ...seed.apps.cedar, name: 'Cedar app' }),
      suggestion('contract', { id: seed.contracts.cedar, reference: null, name: 'Cedar contract' }),
    ]);

    const admin = await http.relations(seed.opexId, ctx(runner, seed, WRITE, seed.contributorId, true));
    assert.ok(admin.suggestions.some((row) => row.id === seed.apps.echo.id), 'an administrator is not scoped');

    const hiddenApp = await rejection(() => http.unlinkRelation(seed.opexId, 'applications', seed.apps.delta.id, who));
    assert.ok(hiddenApp instanceof BadRequestException);
    assert.equal(hiddenApp.message, 'One or more applications were not found.');
    const hiddenProject = await rejection(() => http.unlinkRelation(seed.opexId, 'projects', seed.projects.zulu.id, who));
    assert.ok(hiddenProject instanceof BadRequestException);
    assert.equal(hiddenProject.message, 'One or more projects not found');
    const hiddenAdd = await rejection(() => http.linkRelation(seed.opexId, 'applications', { id: seed.apps.echo.id }, who));
    assert.ok(hiddenAdd instanceof BadRequestException);
    assert.deepEqual(
      await linkIds(runner, 'application_spend_items', 'application_id', 'spend_item_id', seed.opexId),
      [seed.apps.alpha.id, seed.apps.delta.id, seed.apps.mid.id].sort(),
    );
    assert.deepEqual(
      await linkIds(runner, 'portfolio_project_opex', 'project_id', 'opex_id', seed.opexId),
      [seed.projects.alpha.id, seed.projects.zulu.id].sort(),
    );

    assert.deepEqual(
      await http.linkRelation(seed.opexId, 'applications', { id: seed.apps.cedar.id }, who),
      { ok: true, changed: true },
    );
    assert.deepEqual(
      await http.unlinkRelation(seed.opexId, 'projects', seed.projects.alpha.id, who),
      { ok: true, changed: true },
    );
    assert.equal(audit.entries.length, 2);
    assert.equal(audit.entries[0].table, 'application_spend_items');
    assert.equal(audit.entries[0].recordId, seed.opexId);
    assert.equal(audit.entries[1].table, 'portfolio_project_opex');
    assert.ok(!(await linkIds(runner, 'portfolio_project_opex', 'project_id', 'opex_id', seed.opexId)).includes(seed.projects.alpha.id));
    assert.ok((await linkIds(runner, 'portfolio_project_opex', 'project_id', 'opex_id', seed.opexId)).includes(seed.projects.zulu.id));
  });
}

async function testLinksAndAudit() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'blrel-write');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed, WRITE, seed.readerId);
    const appIds = [seed.apps.alpha.id, seed.apps.delta.id, seed.apps.mid.id].sort();

    assert.deepEqual(
      await http.linkRelation(seed.opexId, 'applications', { id: seed.apps.cedar.id.toUpperCase() }, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(audit.entries[0], {
      table: 'application_spend_items', recordId: seed.opexId, action: 'update',
      before: appIds, after: [...appIds, seed.apps.cedar.id].sort(), userId: seed.readerId,
      parent: { table: 'spend_items', id: seed.opexId },
    });
    assert.deepEqual(
      await http.linkRelation(seed.opexId, 'applications', { id: seed.apps.cedar.id }, writer),
      { ok: true, changed: false },
    );
    assert.equal(audit.entries.length, 1, 'linking what is linked writes no audit row');
    const afterLink = await http.relations(seed.opexId, writer);
    assert.ok(!afterLink.suggestions.some((row) => row.id === seed.apps.cedar.id));

    assert.deepEqual(
      await http.unlinkRelation(seed.opexId, 'applications', seed.apps.cedar.id, writer),
      { ok: true, changed: true },
    );
    assert.deepEqual(audit.entries[1].after, appIds);
    assert.deepEqual(
      await http.unlinkRelation(seed.opexId, 'applications', seed.apps.cedar.id, writer),
      { ok: true, changed: false },
    );

    const projectIds = [seed.projects.alpha.id, seed.projects.zulu.id].sort();
    assert.deepEqual(await http.linkRelation(seed.opexId, 'projects', { id: seed.projects.free.id }, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[2], {
      table: 'portfolio_project_opex', recordId: seed.opexId, action: 'update',
      before: projectIds, after: [...projectIds, seed.projects.free.id].sort(), userId: seed.readerId,
      parent: { table: 'spend_items', id: seed.opexId },
    });

    const techIds = [seed.techs.alpha.id, seed.techs.mid.id].sort();
    assert.deepEqual(await http.unlinkRelation(seed.opexId, 'technologies', seed.techs.mid.id, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[3], {
      table: 'technology_spend_items', recordId: seed.opexId, action: 'update',
      before: techIds, after: [seed.techs.alpha.id], userId: seed.readerId,
      parent: { table: 'spend_items', id: seed.opexId },
    });

    assert.deepEqual(await http.linkRelation(seed.opexId, 'contracts', { id: seed.contracts.cedar }, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[4], {
      table: 'contract_spend_items', recordId: seed.opexId, action: 'update',
      before: [seed.contracts.alpha], after: [seed.contracts.alpha, seed.contracts.cedar].sort(), userId: seed.readerId,
      parent: { table: 'spend_items', id: seed.opexId },
    });

    // The asset audit names the asset and the lines of this nature. The spare OPEX link is already there.
    assert.deepEqual(await http.linkRelation(seed.opexId, 'assets', { id: seed.assets.free.id }, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[5], {
      table: 'asset_spend_items', recordId: seed.assets.free.id, action: 'update',
      before: { ids: [seed.spareId] }, after: { ids: [seed.opexId, seed.spareId].sort() }, userId: seed.readerId,
      parent: { table: 'spend_items', id: seed.opexId },
    });
    assert.deepEqual(await http.linkRelation(seed.opexId, 'assets', { id: seed.assets.free.id }, writer), { ok: true, changed: false });
    assert.deepEqual(await http.unlinkRelation(seed.opexId, 'assets', seed.assets.alpha.id, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[6], {
      table: 'asset_spend_items', recordId: seed.assets.alpha.id, action: 'update',
      before: { ids: [seed.opexId] }, after: { ids: [] }, userId: seed.readerId,
      parent: { table: 'spend_items', id: seed.opexId },
    });

    const opexBadge = await countItemRelations(runner.manager, 'opex', { id: seed.opexId, tenant_id: seed.tenantId }, { technologies: true });
    assert.equal(opexBadge.assets, 1, 'the free asset replaced the alpha asset');
    assert.equal(opexBadge.technologies, 1);
    const hiddenBadge = await countItemRelations(runner.manager, 'opex', { id: seed.opexId, tenant_id: seed.tenantId });
    assert.equal(hiddenBadge.assets, null);
    assert.equal(hiddenBadge.total, opexBadge.total - (opexBadge.technologies ?? 0) - (opexBadge.assets ?? 0));

    // A CAPEX line keeps the CAPEX audit labels. Technologies keep the one table name.
    assert.deepEqual(await http.linkRelation(seed.capexId, 'applications', { id: seed.apps.cedar.id }, writer), { ok: true, changed: true });
    assert.equal(audit.entries[7].table, 'application_capex_items');
    assert.equal(audit.entries[7].recordId, seed.capexId);
    assert.deepEqual(audit.entries[7].before, [seed.apps.capex.id]);

    assert.deepEqual(await http.linkRelation(seed.capexId, 'projects', { id: seed.projects.free.id }, writer), { ok: true, changed: true });
    assert.equal(audit.entries[8].table, 'portfolio_project_capex');
    assert.deepEqual(await http.linkRelation(seed.capexId, 'contracts', { id: seed.contracts.cedar }, writer), { ok: true, changed: true });
    assert.equal(audit.entries[9].table, 'contract_capex_items');
    assert.deepEqual(await http.linkRelation(seed.capexId, 'technologies', { id: seed.techs.alpha.id }, writer), { ok: true, changed: true });
    assert.equal(audit.entries[10].table, 'technology_spend_items');
    assert.equal(audit.entries[10].recordId, seed.capexId);
    for (const index of [7, 8, 9, 10]) {
      assert.deepEqual(audit.entries[index].parent, { table: 'spend_items', id: seed.capexId }, `entry ${index}: the CAPEX line`);
    }

    // The OPEX link of this asset is not part of the CAPEX audit.
    assert.deepEqual(await http.linkRelation(seed.capexId, 'assets', { id: seed.assets.free.id }, writer), { ok: true, changed: true });
    assert.deepEqual(audit.entries[11], {
      table: 'asset_capex_items', recordId: seed.assets.free.id, action: 'update',
      before: { ids: [] }, after: { ids: [seed.capexId] }, userId: seed.readerId,
      parent: { table: 'spend_items', id: seed.capexId },
    });
    assert.ok(
      (await linkIds(runner, 'asset_spend_items', 'spend_item_id', 'asset_id', seed.assets.free.id)).includes(seed.spareId),
      'the OPEX link stays when the CAPEX link is written',
    );

    const capexBadge = await countItemRelations(runner.manager, 'capex', { id: seed.capexId, tenant_id: seed.tenantId }, { technologies: true });
    assert.equal(capexBadge.assets, 2);
    assert.equal(
      (await countItemRelations(runner.manager, 'opex', { id: seed.capexId, tenant_id: seed.tenantId }, { technologies: true })).assets,
      0,
    );
  });
}

async function testRefusals() {
  await inRolledBackTransaction(async (runner) => {
    const seed = await seedTab(runner, 'blrel-refuse');
    const { audit, http } = httpOf();
    const writer = ctx(runner, seed, WRITE, seed.readerId);
    const noTech = ctx(runner, seed, { ...WRITE, infrastructure: 'none' }, seed.readerId);
    const noApps = ctx(runner, seed, { ...WRITE, applications: 'none' }, seed.readerId);

    const invalid = await rejection(() => http.linkRelation(seed.opexId, 'applications', { id: 'nope' }, writer));
    assert.ok(invalid instanceof BadRequestException);
    assert.equal(invalid.message, 'Invalid id.');

    for (const [kind, message] of [
      ['applications', 'One or more applications were not found.'],
      ['technologies', 'One or more technologies were not found.'],
      ['contracts', 'One or more contracts not found.'],
      ['projects', 'One or more projects not found'],
      ['assets', 'One or more assets were not found'],
    ] as const) {
      const err = await rejection(() => http.linkRelation(seed.opexId, kind, { id: randomUUID() }, writer));
      assert.ok(err instanceof BadRequestException, kind);
      assert.equal(err.message, message, kind);
    }

    const unknown = await rejection(() => http.linkRelation(seed.opexId, 'incidents', { id: seed.apps.cedar.id }, writer));
    assert.ok(unknown instanceof NotFoundException);
    assert.equal(unknown.message, 'Unknown relation type.');
    const unknownFirst = await rejection(() => http.linkRelation(randomUUID(), 'nope', { id: 'nope' }, noApps));
    assert.ok(unknownFirst instanceof NotFoundException);

    const refusedTech = await rejection(() => http.unlinkRelation(seed.opexId, 'technologies', 'nope', noTech));
    assertModuleRight(refusedTech, 'infrastructure', 'reader', 'You cannot read technologies.');
    const refusedApps = await rejection(() => http.linkRelation(seed.opexId, 'applications', { id: 'nope' }, noApps));
    assertModuleRight(refusedApps, 'applications', 'reader', 'You cannot read this module.');
    const refusedAssets = await rejection(() => http.linkRelation(seed.opexId, 'assets', { id: randomUUID() }, noTech));
    assertModuleRight(refusedAssets, 'infrastructure', 'reader', 'You cannot read this module.');

    const missing = await rejection(() => http.linkRelation(randomUUID(), 'applications', { id: seed.apps.cedar.id }, writer));
    assert.ok(missing instanceof NotFoundException);
    assert.equal(missing.message, 'Budget line not found');
    const badRef = await rejection(() => http.relations('not a reference', writer));
    assert.ok(badRef instanceof BadRequestException);

    assert.equal(audit.entries.length, 0);
    assert.equal((await linkIds(runner, 'technology_spend_items', 'technology_id', 'spend_item_id', seed.opexId)).length, 2);
    assert.equal((await linkIds(runner, 'asset_spend_items', 'asset_id', 'spend_item_id', seed.opexId)).length, 1);
  });
}

async function testSuggestionCap() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'blrel-cap');
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0];
    const companyId = (await one(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Cap company', 'FR', 'Lyon') RETURNING id`,
      [tenantId],
    )).id as string;
    const supplierId = (await one(
      `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Cap supplier') RETURNING id`,
      [tenantId],
    )).id as string;
    const lineId = (await one(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, supplier_id)
       VALUES ($1, 'Cap line', 'EUR', '2026-01-01', 70, $2) RETURNING id`,
      [tenantId, supplierId],
    )).id as string;
    for (let n = 1; n <= 21; n += 1) {
      await runner.query(
        `INSERT INTO applications (tenant_id, name, supplier_id, lifecycle, status) VALUES ($1, $2, $3, 'active', 'enabled')`,
        [tenantId, `Cap ${String(n).padStart(2, '0')}`, supplierId],
      );
    }
    const contractId = (await one(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Cap contract', $2, $3, DATE '2026-01-01') RETURNING id`,
      [tenantId, companyId, supplierId],
    )).id as string;
    const { http } = httpOf();
    const seed = { tenantId, readerId: randomUUID() } as Seed;
    const res = await http.relations(lineId, ctx(runner, seed, ALL, null));
    const apps = res.suggestions.filter((row) => row.type === 'application');
    const contracts = res.suggestions.filter((row) => row.type === 'contract');
    assert.equal(apps.length, 20);
    assert.deepEqual(apps.map((row) => row.name), Array.from({ length: 20 }, (_, i) => `Cap ${String(i + 1).padStart(2, '0')}`));
    assert.deepEqual(contracts, [suggestion('contract', { id: contractId, reference: null, name: 'Cap contract' })]);
    assert.equal(res.suggestions[res.suggestions.length - 1].name, 'Cap contract');
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTab(runner, 'blrel-a');
    const b = await seedTab(runner, 'blrel-b');
    await setTenant(runner, b.tenantId);
    const { audit, http } = httpOf();
    const reader = ctx(runner, b, ALL);
    const writer = ctx(runner, b, WRITE, b.readerId);

    for (const call of [
      () => http.relations(a.opexId, reader),
      () => http.linkRelation(a.opexId, 'applications', { id: b.apps.cedar.id }, writer),
      () => http.unlinkRelation(a.capexId, 'assets', a.assets.capex.id, writer),
    ]) {
      const err = await rejection(call);
      assert.ok(err instanceof NotFoundException, err.message);
    }

    const foreign = await rejection(() => http.linkRelation(b.opexId, 'applications', { id: a.apps.cedar.id }, writer));
    assert.ok(foreign instanceof BadRequestException);
    assert.equal(foreign.message, 'One or more applications were not found.');
    const foreignAsset = await rejection(() => http.linkRelation(b.opexId, 'assets', { id: a.assets.free.id }, writer));
    assert.ok(foreignAsset instanceof BadRequestException);
    assert.equal(audit.entries.length, 0);
    const own = await http.relations(b.opexId, reader);
    assert.deepEqual(own.applications?.map((row) => row.id), [b.apps.alpha.id, b.apps.delta.id, b.apps.mid.id]);
    assert.ok(!own.suggestions.some((row) => row.id === a.apps.cedar.id));

    await setTenant(runner, a.tenantId);
    const back = await http.relations(a.opexId, ctx(runner, a, ALL));
    assert.deepEqual(back.applications?.map((row) => row.id), [a.apps.alpha.id, a.apps.delta.id, a.apps.mid.id]);
    assert.deepEqual(back.assets?.map((row) => row.id), [a.assets.alpha.id]);
  });
}

function testPermissionMetadata() {
  const proto = BudgetLinesController.prototype;
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.relations), { resource: 'budget', level: 'reader' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.linkRelation), { resource: 'budget', level: 'member' });
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.unlinkRelation), { resource: 'budget', level: 'member' });
  return Promise.resolve();
}

void runSpecs('budget-line-relations-tab.integration.spec', [
  ['testPermissionMetadata', testPermissionMetadata],
  ['testPayload', testPayload],
  ['testContributor', testContributor],
  ['testLinksAndAudit', testLinksAndAudit],
  ['testRefusals', testRefusals],
  ['testSuggestionCap', testSuggestionCap],
  ['testTenantIsolation', testTenantIsolation],
]);
