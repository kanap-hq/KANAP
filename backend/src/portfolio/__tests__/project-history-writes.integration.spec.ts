// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioDependenciesService } from '../services/portfolio-dependencies.service';
import { PortfolioProjectsCrudService } from '../services/portfolio-projects-crud.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedItem,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// The audit rows the project's history needs and its feed alone used to carry (record history,
// lot 2, run 4): its team, contacts, budget lines, applications, assets, dependencies, web links,
// effort allocations, the edit of an integrated document and the request it was converted from.
// Each real change writes one row on the project (`recordId` = the project, a set before and
// after); a write that changes nothing writes none.

type Seed = {
  tenantId: string;
  userA: string;
  userB: string;
  projectId: string;
  otherProject: string;
  contact: string;
  application: string;
  asset: string;
  requestId: string;
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(sql, params);
  return rows[0].id as string;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = await seedTenant(runner, 'proj-hist');
  const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`, [tenantId]);
  const user = (first: string) => one(
    runner,
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'Spec') RETURNING id`,
    [tenantId, `${first.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`, role, first],
  );
  const userA = await user('Ada');
  const userB = await user('Bob');
  const project = (name: string, number: number) => one(
    runner,
    `INSERT INTO portfolio_projects (tenant_id, name, item_number, status, it_lead_id) VALUES ($1, $2, $3, 'in_progress', $4) RETURNING id`,
    [tenantId, name, number, userA],
  );
  return {
    tenantId,
    userA,
    userB,
    projectId: await project('History project', 1),
    otherProject: await project('Other project', 2),
    contact: await one(runner, `INSERT INTO contacts (tenant_id, first_name, last_name, email) VALUES ($1, 'Cleo', 'Contact', $2) RETURNING id`, [tenantId, `cleo-${randomUUID().slice(0, 8)}@example.test`]),
    application: await one(
      runner,
      `INSERT INTO applications (tenant_id, name, lifecycle, criticality, status) VALUES ($1, 'Billing', 'active', 'medium', 'enabled') RETURNING id`,
      [tenantId],
    ),
    asset: await one(
      runner,
      `INSERT INTO assets (tenant_id, name, kind, environment, status, created_at, updated_at)
       VALUES ($1, 'srv-01', 'server', 'prod', 'active', now(), now()) RETURNING id`,
      [tenantId],
    ),
    requestId: await one(
      runner,
      `INSERT INTO portfolio_requests (tenant_id, name, item_number, status, requestor_id) VALUES ($1, 'Origin request', 3, 'approved', $2) RETURNING id`,
      [tenantId, userA],
    ),
  };
}

const quiet = { notifyTeamAdded: () => undefined, notifyItLeadOfTeamChange: () => undefined };

function services(runner: QueryRunner, audit = captureAudit()) {
  const crud = new PortfolioProjectsCrudService(
    runner.manager.getRepository(PortfolioProject),
    runner.manager.getRepository(PortfolioRequest),
    audit as any,
    { calculateEffortFromCriteria: async () => ({ estimated_effort_it: 0, estimated_effort_business: 0 }) } as any,
    quiet as any,
    { nextItemNumber: async () => 9 } as any,
    { createProjectPurposeFromRequest: async () => undefined } as any,
  );
  const dependencies = new PortfolioDependenciesService(runner.manager.getRepository(PortfolioProject), audit as any);
  return { crud, dependencies, audit };
}

/** The rows of one label, and nothing else written meanwhile. */
function rowsOf(audit: ReturnType<typeof captureAudit>, table: string) {
  return audit.entries.filter((entry) => entry.table === table);
}

/** A write, then the same write again: one row for the change, none for the repeat. */
async function onceThenNothing(
  audit: ReturnType<typeof captureAudit>,
  table: string,
  write: () => Promise<unknown>,
): Promise<any> {
  await write();
  assert.equal(rowsOf(audit, table).length, 1, `${table}: one row for the change`);
  await write();
  assert.equal(rowsOf(audit, table).length, 1, `${table}: no row when nothing changes`);
  return rowsOf(audit, table)[0];
}

async function testTeam() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { crud, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const row = await onceThenNothing(audit, 'portfolio_project_team', () => crud.bulkReplaceTeam(data.projectId, 'it_team', [data.userB], opts));
    assert.equal(row.recordId, data.projectId);
    assert.deepEqual(row.before, { role: 'it_team', ids: [] });
    assert.deepEqual(row.after, { role: 'it_team', ids: [data.userB] });
  });
}

async function testContacts() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { crud, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const row = await onceThenNothing(audit, 'portfolio_project_contacts', () => crud.bulkReplaceContacts(data.projectId, [data.contact], opts));
    assert.equal(row.recordId, data.projectId);
    assert.deepEqual(row.before, { ids: [] });
    assert.deepEqual(row.after, { ids: [data.contact.toLowerCase()] });
    await crud.bulkReplaceContacts(data.projectId, [], opts);
    assert.deepEqual(rowsOf(audit, 'portfolio_project_contacts')[1].after, { ids: [] }, 'the removal is a second row');
  });
}

async function testBudgetLines() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const opex = await seedItem(runner, 'opex', data.tenantId, 11, 'Licences');
    const capex = await seedItem(runner, 'capex', data.tenantId, 12, 'Servers');
    const { crud, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const opexRow = await onceThenNothing(audit, 'portfolio_project_opex', () => crud.bulkReplaceOpex(data.projectId, [opex], opts));
    assert.equal(opexRow.recordId, data.projectId);
    assert.deepEqual(opexRow.after, { ids: [opex.toLowerCase()] });
    assert.deepEqual(opexRow.parent, { table: 'spend_items', id: opex.toLowerCase() }, 'the one line changed is the parent');
    const capexRow = await onceThenNothing(audit, 'portfolio_project_capex', () => crud.bulkReplaceCapex(data.projectId, [capex], opts));
    assert.deepEqual(capexRow.after, { ids: [capex.toLowerCase()] });
    assert.equal(rowsOf(audit, 'portfolio_project_opex').length, 1, 'a CAPEX replacement writes no OPEX row');
  });
}

async function testApplicationsAndAssets() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { dependencies, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const app = await onceThenNothing(audit, 'application_projects', () => dependencies.bulkReplaceLinkedApplications(data.projectId, [data.application], opts));
    assert.equal(app.recordId, data.projectId);
    assert.deepEqual(app.after, { ids: [data.application.toLowerCase()] });
    assert.deepEqual(app.parent, { table: 'applications', id: data.application.toLowerCase() });
    const asset = await onceThenNothing(audit, 'asset_projects', () => dependencies.bulkReplaceLinkedAssets(data.projectId, [data.asset], opts));
    assert.deepEqual(asset.after, { ids: [data.asset.toLowerCase()] });
    assert.deepEqual(asset.parent, { table: 'assets', id: data.asset.toLowerCase() });
  });
}

async function testDependencies() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { dependencies, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const added = await onceThenNothing(audit, 'portfolio_project_dependencies',
      () => dependencies.addDependency(data.projectId, 'project', data.otherProject, data.tenantId, opts));
    assert.deepEqual(added.before, { ids: [] });
    assert.deepEqual(added.after, { ids: [data.otherProject.toLowerCase()] });
    await dependencies.removeDependency(data.projectId, 'project', data.otherProject, opts);
    await dependencies.removeDependency(data.projectId, 'project', data.otherProject, opts);
    const rows = rowsOf(audit, 'portfolio_project_dependencies');
    assert.equal(rows.length, 2, 'one row for the removal, none for the repeat');
    assert.deepEqual(rows[1].after, { ids: [] });
  });
}

async function testUrls() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { dependencies, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const row = await onceThenNothing(audit, 'portfolio_project_urls',
      () => dependencies.replaceUrls(data.projectId, [{ url: 'https://wiki.example.test/project', label: 'Wiki' }], opts));
    assert.equal(row.recordId, data.projectId);
    assert.deepEqual(row.before, []);
    assert.deepEqual(row.after, [{ url: 'https://wiki.example.test/project', label: 'Wiki' }]);
  });
}

async function testEffortAllocations() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { crud, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const set = await onceThenNothing(audit, 'portfolio_project_effort_allocations',
      () => crud.setEffortAllocations(data.projectId, 'it', [{ user_id: data.userA, allocation_pct: 100 }], opts));
    assert.equal(set.recordId, data.projectId);
    assert.equal(set.before.mode, 'auto');
    assert.deepEqual(set.after, {
      effort_type: 'it',
      mode: 'manual',
      allocations: [{ user_id: data.userA.toLowerCase(), allocation_pct: 100 }],
    });
    await crud.resetEffortAllocations(data.projectId, 'it', opts);
    await crud.resetEffortAllocations(data.projectId, 'it', opts);
    const rows = rowsOf(audit, 'portfolio_project_effort_allocations');
    assert.equal(rows.length, 2, 'one row for the reset, none for the repeat');
    assert.deepEqual(rows[1].after, { effort_type: 'it', mode: 'auto', allocations: [] });
  });
}

async function testConversion() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { crud, audit } = services(runner);
    const project = await crud.convertFromRequest(data.requestId, {}, data.tenantId, data.userA, { manager: runner.manager, userId: data.userA });
    const created = rowsOf(audit, 'portfolio_projects');
    assert.equal(created.length, 1);
    assert.equal(created[0].recordId, project.id);
    assert.equal(created[0].action, 'create');
    assert.equal((created[0].after as any).source_request_id, data.requestId, 'the creation names the request');
  });
}

async function testDocumentEdit() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const documents = new IntegratedDocumentsService(undefined as any, undefined as any, undefined as any, undefined as any);
    const log = (documents as any).logSourceSemanticActivity.bind(documents);
    await log('projects', data.projectId, 'risks_mitigations', data.tenantId, data.userA, runner.manager);
    await log('requests', data.requestId, 'purpose', data.tenantId, data.userA, runner.manager);
    const rows: Array<{ record_id: string; after_json: unknown; action: string }> = await runner.query(
      `SELECT record_id, after_json, action FROM audit_log WHERE tenant_id = $1 AND table_name = 'portfolio_project_documents'`,
      [data.tenantId],
    );
    assert.deepEqual(rows, [{ record_id: data.projectId, after_json: { slot: 'risks_mitigations' }, action: 'update' }],
      'one row for the project edit, none for a request');
  });
}

void runSpecs('project-history-writes.integration.spec', [
  ['team: one row per change, none for the same team', testTeam],
  ['contacts: one row per change', testContacts],
  ['budget lines: one row per nature, the line as parent', testBudgetLines],
  ['applications and assets: one row on the project', testApplicationsAndAssets],
  ['dependencies: one row per add or remove', testDependencies],
  ['web links: one row per change', testUrls],
  ['effort allocations: set and reset', testEffortAllocations],
  ['conversion: the creation names its request', testConversion],
  ['integrated document: one row for a project edit', testDocumentEdit],
]);
