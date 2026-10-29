// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { PortfolioRequest } from '../portfolio-request.entity';
import { PortfolioRequestsService } from '../portfolio-requests.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedItem,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// The audit rows the request's history needs and its feed alone used to carry (record history,
// lot 2, run 5): its team, contacts, budget lines, applications, assets, dependencies, web links
// and the edit of an integrated document. Each real change writes one row on the request
// (`recordId` = the request, a set before and after); a write that changes nothing writes none.
// The feed's `change` entry stays written beside it.

type Seed = {
  tenantId: string;
  userA: string;
  userB: string;
  requestId: string;
  otherRequest: string;
  project: string;
  contact: string;
  application: string;
  asset: string;
};

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(sql, params);
  return rows[0].id as string;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = await seedTenant(runner, 'req-hist');
  const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Member') RETURNING id`, [tenantId]);
  const user = (first: string) => one(
    runner,
    `INSERT INTO users (tenant_id, email, role_id, first_name, last_name) VALUES ($1, $2, $3, $4, 'Spec') RETURNING id`,
    [tenantId, `${first.toLowerCase()}-${randomUUID().slice(0, 8)}@example.test`, role, first],
  );
  const userA = await user('Ada');
  const userB = await user('Bob');
  const request = (name: string, number: number) => one(
    runner,
    `INSERT INTO portfolio_requests (tenant_id, name, item_number, status, requestor_id, it_lead_id) VALUES ($1, $2, $3, 'pending_review', $4, $4) RETURNING id`,
    [tenantId, name, number, userA],
  );
  return {
    tenantId,
    userA,
    userB,
    requestId: await request('History request', 1),
    otherRequest: await request('Other request', 2),
    project: await one(runner, `INSERT INTO portfolio_projects (tenant_id, name, item_number, status) VALUES ($1, 'Target project', 3, 'planned') RETURNING id`, [tenantId]),
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
  };
}

const quiet = {
  notifyTeamAdded: () => undefined,
  notifyItLeadOfTeamChange: () => undefined,
};

function services(runner: QueryRunner, audit = captureAudit()) {
  const stub = () => ({}) as any;
  const requests = new PortfolioRequestsService(
    runner.manager.getRepository(PortfolioRequest),
    audit as any,
    stub(),
    stub(),
    stub(),
    quiet as any,
    stub(),
    stub(),
    stub(),
  );
  return { requests, audit };
}

/** The rows of one label, and nothing else written meanwhile. */
function rowsOf(audit: ReturnType<typeof captureAudit>, table: string) {
  return audit.entries.filter((entry) => entry.table === table);
}

/** The `change` entries of the request's feed: they stay written beside the audit rows. */
async function feedChanges(runner: QueryRunner, data: Seed): Promise<number> {
  const [{ n }] = await runner.query(
    `SELECT count(*)::int AS n FROM portfolio_activities WHERE tenant_id = $1 AND request_id = $2 AND type = 'change'`,
    [data.tenantId, data.requestId],
  );
  return n;
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
    const { requests, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const row = await onceThenNothing(audit, 'portfolio_request_team', () => requests.bulkReplaceTeam(data.requestId, 'business_team', [data.userB], opts));
    assert.equal(row.recordId, data.requestId);
    assert.deepEqual(row.before, { role: 'business_team', ids: [] });
    assert.deepEqual(row.after, { role: 'business_team', ids: [data.userB] });
    assert.equal(await feedChanges(runner, data), 1, 'the feed keeps its change entry');
  });
}

async function testContacts() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { requests, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const row = await onceThenNothing(audit, 'portfolio_request_contacts', () => requests.bulkReplaceContacts(data.requestId, [data.contact], opts));
    assert.equal(row.recordId, data.requestId);
    assert.equal(row.userId, data.userA, 'the author is the caller');
    assert.deepEqual(row.before, { ids: [] });
    assert.deepEqual(row.after, { ids: [data.contact.toLowerCase()] });
    await requests.bulkReplaceContacts(data.requestId, [], opts);
    assert.deepEqual(rowsOf(audit, 'portfolio_request_contacts')[1].after, { ids: [] }, 'the removal is a second row');
  });
}

async function testBudgetLines() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const opex = await seedItem(runner, 'opex', data.tenantId, 11, 'Licences');
    const capex = await seedItem(runner, 'capex', data.tenantId, 12, 'Servers');
    const { requests, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const opexRow = await onceThenNothing(audit, 'portfolio_request_opex', () => requests.bulkReplaceOpex(data.requestId, [opex], opts));
    assert.equal(opexRow.recordId, data.requestId);
    assert.deepEqual(opexRow.before, { ids: [] });
    assert.deepEqual(opexRow.after, { ids: [opex.toLowerCase()] });
    assert.deepEqual(opexRow.parent, { table: 'spend_items', id: opex.toLowerCase() }, 'the one line changed is the parent');
    const capexRow = await onceThenNothing(audit, 'portfolio_request_capex', () => requests.bulkReplaceCapex(data.requestId, [capex], opts));
    assert.deepEqual(capexRow.after, { ids: [capex.toLowerCase()] });
    assert.equal(rowsOf(audit, 'portfolio_request_opex').length, 1, 'a CAPEX replacement writes no OPEX row');
    assert.equal(await feedChanges(runner, data), 2, 'the feed keeps one change entry per nature');
  });
}

async function testApplicationsAndAssets() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { requests, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const app = await onceThenNothing(audit, 'portfolio_request_applications', () => requests.bulkReplaceApplications(data.requestId, [data.application], opts));
    assert.equal(app.recordId, data.requestId);
    assert.deepEqual(app.before, { ids: [] });
    assert.deepEqual(app.after, { ids: [data.application.toLowerCase()] });
    const asset = await onceThenNothing(audit, 'portfolio_request_assets', () => requests.bulkReplaceAssets(data.requestId, [data.asset], opts));
    assert.equal(asset.recordId, data.requestId);
    assert.deepEqual(asset.after, { ids: [data.asset.toLowerCase()] });
  });
}

async function testDependencies() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { requests, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const added = await onceThenNothing(audit, 'portfolio_request_dependencies',
      () => requests.addDependency(data.requestId, 'project', data.project, data.tenantId, opts));
    assert.equal(added.recordId, data.requestId);
    assert.deepEqual(added.before, { ids: [], request_ids: [] });
    assert.deepEqual(added.after, { ids: [data.project.toLowerCase()], request_ids: [] });
    await requests.addDependency(data.requestId, 'request', data.otherRequest, data.tenantId, opts);
    const rows = rowsOf(audit, 'portfolio_request_dependencies');
    assert.deepEqual(rows[1].after, { ids: [data.project.toLowerCase()], request_ids: [data.otherRequest.toLowerCase()] }, 'a request dependency');
    await requests.removeDependency(data.requestId, 'project', data.project, opts);
    await requests.removeDependency(data.requestId, 'project', data.project, opts);
    assert.equal(rowsOf(audit, 'portfolio_request_dependencies').length, 3, 'one row for the removal, none for the repeat');
    assert.deepEqual(rowsOf(audit, 'portfolio_request_dependencies')[2].after, { ids: [], request_ids: [data.otherRequest.toLowerCase()] });
  });
}

async function testUrls() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const { requests, audit } = services(runner);
    const opts = { manager: runner.manager, userId: data.userA };
    const row = await onceThenNothing(audit, 'portfolio_request_urls',
      () => requests.replaceUrls(data.requestId, [{ url: 'https://wiki.example.test/request', label: 'Wiki' }], opts));
    assert.equal(row.recordId, data.requestId);
    assert.equal(row.userId, data.userA, 'the author is the caller');
    assert.deepEqual(row.before, []);
    assert.deepEqual(row.after, [{ url: 'https://wiki.example.test/request', label: 'Wiki' }]);
  });
}

async function testDocumentEdit() {
  await inRolledBackTransaction(async (runner) => {
    const data = await seed(runner);
    const documents = new IntegratedDocumentsService(undefined as any, undefined as any, undefined as any, undefined as any);
    const log = (documents as any).logSourceSemanticActivity.bind(documents);
    await log('requests', data.requestId, 'risks_mitigations', data.tenantId, data.userA, runner.manager);
    const rows: Array<{ record_id: string; after_json: unknown; action: string }> = await runner.query(
      `SELECT record_id, after_json, action FROM audit_log WHERE tenant_id = $1 AND table_name = 'portfolio_request_documents'`,
      [data.tenantId],
    );
    assert.deepEqual(rows, [{ record_id: data.requestId, after_json: { slot: 'risks_mitigations' }, action: 'update' }],
      'one row for the request edit');
    assert.equal(await feedChanges(runner, data), 1, 'the feed keeps its change entry');
  });
}

void runSpecs('request-history-writes.integration.spec', [
  ['team: one row per change, none for the same team', testTeam],
  ['contacts: one row per change', testContacts],
  ['budget lines: one row per nature, the line as parent', testBudgetLines],
  ['applications and assets: one row on the request', testApplicationsAndAssets],
  ['dependencies: one row per add or remove, projects and requests', testDependencies],
  ['web links: one row per change', testUrls],
  ['integrated document: one row for a request edit', testDocumentEdit],
]);
