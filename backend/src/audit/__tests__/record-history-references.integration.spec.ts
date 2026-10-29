// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import {
  FAMILY_KEYS,
  loadReferences,
  RecordHistoryService,
  type FamilyKey,
  type RecordHistoryContext,
  type RecordHistoryItem,
  type ReferenceReader,
} from '../record-history.service';
import { readableFamilies, REFERENCE_FAMILIES } from '../record-history/families';
import {
  audit,
  linePayload,
  seedHistoryData,
  seedPerson,
  type HistorySeed,
  type Level,
  type Person,
} from './record-history.fixtures';

// The references of a record history (review B1): every family is read under its own screen rules.
// A row of another tenant is hidden for each family (the tenant predicate and RLS); an application,
// a project or a request outside a Business Contributor's participation is hidden; a task outside
// their participation, or moved to a confidential incident they do not own, is hidden. The same
// person then reads the line's history through the service, so the predicates are wired into the
// answer.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const ALL_MODULES: Record<string, Level> = {
  budget: 'reader', contracts: 'reader', suppliers: 'reader', companies: 'reader', accounts: 'reader',
  portfolio_projects: 'reader', portfolio_requests: 'reader', contacts: 'reader', applications: 'reader',
  infrastructure: 'reader', tasks: 'reader', locations: 'reader', incidents: 'reader', departments: 'reader',
  business_processes: 'reader', working_day_profiles: 'reader', analytics: 'reader', portfolio_settings: 'reader',
  knowledge: 'reader',
};

const BC_PERMISSIONS: Record<string, Level> = {
  budget: 'reader', applications: 'reader', portfolio_projects: 'reader', portfolio_requests: 'reader',
  tasks: 'reader',
};

type Seeded = {
  seed: HistorySeed;
  reader: Person;
  bc: Person;
  foreign: HistorySeed;
  documentType: string;
  foreignDocumentType: string;
  classification: Classification;
  foreignClassification: Classification;
};

/** A source, a category and a stream of the portfolio classification. */
type Classification = { source: string; category: string; stream: string };

/** The tenant's portfolio classification: names every reader of a project or a request sees. */
async function seedClassification(runner: QueryRunner, tenantId: string): Promise<Classification> {
  const [source] = await runner.query(
    `INSERT INTO portfolio_sources (tenant_id, name) VALUES ($1, 'Spec source') RETURNING id`,
    [tenantId],
  );
  const [category] = await runner.query(
    `INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Spec category') RETURNING id`,
    [tenantId],
  );
  const [stream] = await runner.query(
    `INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Spec stream') RETURNING id`,
    [tenantId, category.id],
  );
  return { source: source.id, category: category.id, stream: stream.id };
}

/** A tenant-wide Knowledge document type: the one document family whose rule is plain SQL. */
async function seedDocumentType(runner: QueryRunner, tenantId: string): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO document_types (tenant_id, name, is_active, is_system, is_default, display_order, created_at, updated_at)
     VALUES ($1, 'Spec type', true, false, false, 10, now(), now()) RETURNING id`,
    [tenantId],
  );
  return row.id;
}

function readableAll(): Record<FamilyKey, boolean> {
  return Object.fromEntries(FAMILY_KEYS.map((family) => [family, true])) as Record<FamilyKey, boolean>;
}

async function withRunner<T>(tenantId: string, fn: (runner: QueryRunner) => Promise<T>, limitedUserId?: string): Promise<T> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    if (limitedUserId) {
      const rows: Array<{ mode: string }> = await runner.query(`SELECT data_access_apply($1) AS mode`, [limitedUserId]);
      assert.equal(rows[0]?.mode, 'limited', 'the limited role is applied to the transaction');
    }
    return await fn(runner);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await runner.release();
  }
}

async function referencesFor(
  person: Person,
  ids: Map<FamilyKey, Set<string>>,
  permissions?: Record<string, Level>,
) {
  return withRunner(person.tenant_id, (runner) => {
    const reader: ReferenceReader = {
      manager: runner.manager,
      tenantId: person.tenant_id,
      userId: person.id,
      isAdmin: false,
      viewer: { userId: person.id, isAdmin: false },
    };
    // Without an explicit permission set the family modules do not filter: the case tests the
    // family's own screen rule. With one, `readableFamilies` applies the production module gate.
    const readable = permissions
      ? readableFamilies({ isAdmin: false, permissions })
      : readableAll();
    return loadReferences(reader, ids, readable);
  });
}

function idMap(entries: Array<[FamilyKey, string[]]>): Map<FamilyKey, Set<string>> {
  return new Map(entries.map(([family, ids]) => [family, new Set(ids.map((id) => id.toLowerCase()))]));
}

async function readPage(person: Person, seedRow: HistorySeed, permissions: Record<string, string>) {
  return withRunner(person.tenant_id, (runner) => {
    const ctx: RecordHistoryContext = {
      tenantId: person.tenant_id,
      userId: person.id,
      isAdmin: false,
      permissions,
      manager: runner.manager,
    };
    return new RecordHistoryService().list(ctx, 'spend_items', seedRow.opexLine, { limit: '100' });
  });
}

function findChange(items: RecordHistoryItem[], field: string) {
  for (const item of items) {
    const change = item.changes.find((candidate) => candidate.field === field);
    if (change) return { item, change };
  }
  return null;
}

type FamilyCase = { family: FamilyKey; home: string; away: string; label: string };

/** One case per family: the tenant's record and the same record of another tenant. */
function familyCases(seeded: Seeded): FamilyCase[] {
  const home = seeded.seed;
  const away = seeded.foreign;
  return [
    { family: 'user', home: home.owner, away: away.owner, label: 'user' },
    { family: 'company', home: home.companyA, away: away.companyA, label: 'company' },
    { family: 'supplier', home: home.supplier, away: away.supplier, label: 'supplier' },
    { family: 'chart_of_accounts', home: home.coa, away: away.coa, label: 'chart of accounts' },
    { family: 'account', home: home.account, away: away.account, label: 'account' },
    { family: 'project', home: home.project, away: away.project, label: 'project' },
    { family: 'request', home: home.request, away: away.request, label: 'request' },
    { family: 'contract', home: home.contractA, away: away.contractA, label: 'contract' },
    { family: 'cost_center', home: home.costCenterA, away: away.costCenterA, label: 'cost center' },
    { family: 'contact', home: home.contact, away: away.contact, label: 'contact' },
    { family: 'application', home: home.application, away: away.application, label: 'application' },
    { family: 'technology', home: home.technology, away: away.technology, label: 'technology' },
    { family: 'asset', home: home.asset, away: away.asset, label: 'asset' },
    { family: 'task', home: home.task, away: away.task, label: 'task' },
    { family: 'budget_line', home: home.opexLine, away: away.opexLine, label: 'budget line' },
    { family: 'location', home: home.location, away: away.location, label: 'location' },
    { family: 'sub_location', home: home.subLocation, away: away.subLocation, label: 'sub-location' },
    { family: 'connection', home: home.connection, away: away.connection, label: 'connection' },
    { family: 'interface', home: home.interfaceRecord, away: away.interfaceRecord, label: 'interface' },
    { family: 'incident', home: home.incident, away: away.incident, label: 'incident' },
    { family: 'department', home: home.department, away: away.department, label: 'department' },
    { family: 'business_process', home: home.businessProcess, away: away.businessProcess, label: 'business process' },
    { family: 'calendar', home: home.calendar, away: away.calendar, label: 'calendar' },
    { family: 'analytics_axis', home: home.axis, away: away.axis, label: 'analytics dimension' },
    { family: 'analytics_category', home: home.categoryA, away: away.categoryA, label: 'analytics value' },
    { family: 'contributor', home: home.contributor, away: away.contributor, label: 'contributor' },
    { family: 'document_type', home: seeded.documentType, away: seeded.foreignDocumentType, label: 'document type' },
    { family: 'portfolio_source', home: seeded.classification.source, away: seeded.foreignClassification.source, label: 'portfolio source' },
    { family: 'portfolio_category', home: seeded.classification.category, away: seeded.foreignClassification.category, label: 'portfolio category' },
    { family: 'portfolio_stream', home: seeded.classification.stream, away: seeded.foreignClassification.stream, label: 'portfolio stream' },
  ];
}

/** The families this run declares ahead of their record pages. */
const NEW_FAMILIES: readonly FamilyKey[] = [
  'location', 'sub_location', 'connection', 'interface', 'incident', 'department', 'business_process', 'calendar',
  'analytics_axis', 'analytics_category', 'contributor', 'document_type',
];

/** The tenant's record is named, another tenant's record is not (the tenant predicate and RLS). */
async function testEveryFamily(seeded: Seeded) {
  const cases = familyCases(seeded);
  // A family read by code (the Knowledge document, its folder and library) has no SQL visibility
  // predicate to probe here: `record-history-documents.integration.spec.ts` covers it through
  // `KnowledgeService`. Every SQL family still has exactly one case.
  const sqlFamilies = FAMILY_KEYS.filter((family) => !REFERENCE_FAMILIES[family].visibility.check);
  assert.deepEqual(cases.map((entry) => entry.family).sort(), [...sqlFamilies].sort(), 'one case per SQL family');

  const references = await referencesFor(seeded.reader, idMap(cases.map((entry) => [entry.family, [entry.home, entry.away]])));
  const reported: string[] = [];
  for (const entry of cases) {
    const rows = references.get(entry.family);
    assert.ok(rows, `${entry.label}: the family was read`);
    assert.ok(rows.has(entry.home.toLowerCase()), `${entry.label}: the tenant's record is named`);
    assert.ok(!rows.has(entry.away.toLowerCase()), `${entry.label}: another tenant's record is hidden`);
    reported.push(entry.label);
  }
  console.log(`  one visibility case per family (${reported.length}): ${reported.join(', ')}: OK`);
}

/** A family names its record only for a reader of its module, never without it. */
async function testFamilyModules(seeded: Seeded) {
  const cases = familyCases(seeded).filter((entry) => NEW_FAMILIES.includes(entry.family));
  const ids = idMap(cases.map((entry) => [entry.family, [entry.home]]));
  const withModules = await referencesFor(seeded.reader, ids, ALL_MODULES);
  const withoutModules = await referencesFor(seeded.reader, ids, {});
  for (const entry of cases) {
    assert.ok(withModules.get(entry.family)?.has(entry.home.toLowerCase()), `${entry.label}: named with its module`);
    assert.ok(!withoutModules.get(entry.family)?.has(entry.home.toLowerCase()), `${entry.label}: hidden without its module`);
  }
  console.log(`  ${cases.length} new families named with their module, hidden without it: OK`);
}

type ParticipationFixtures = {
  appIn: string;
  appOut: string;
  projectIn: string;
  projectOut: string;
  requestIn: string;
  requestOut: string;
  taskIn: string;
  taskOut: string;
  taskIncident: string;
  incident: string;
  confidentialIncident: string;
};

/** The records one Business Contributor owns and the ones they do not. */
async function createParticipationFixtures(seedRow: HistorySeed, bc: Person, fixture: QueryRunner): Promise<ParticipationFixtures> {
  const appIn = (await fixture.query(
    `INSERT INTO applications (tenant_id, name, sequential_id) VALUES ($1, 'Inside App', 'APP-91') RETURNING id`,
    [seedRow.tenantId],
  ))[0].id as string;
  const appOut = (await fixture.query(
    `INSERT INTO applications (tenant_id, name, sequential_id) VALUES ($1, 'Outside App', 'APP-92') RETURNING id`,
    [seedRow.tenantId],
  ))[0].id as string;
  await fixture.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [seedRow.tenantId, appIn, bc.id],
  );

  const projectIn = seedRow.project;
  const projectOut = (await fixture.query(
    `INSERT INTO portfolio_projects (tenant_id, item_number, name) VALUES ($1, 8, 'Outside Project') RETURNING id`,
    [seedRow.tenantId],
  ))[0].id as string;
  await fixture.query(
    `UPDATE portfolio_projects SET business_sponsor_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [seedRow.tenantId, projectIn, bc.id],
  );

  const requestIn = seedRow.request;
  const requestOut = (await fixture.query(
    `INSERT INTO portfolio_requests (tenant_id, item_number, name) VALUES ($1, 12, 'Outside Request') RETURNING id`,
    [seedRow.tenantId],
  ))[0].id as string;
  await fixture.query(
    `UPDATE portfolio_requests SET requestor_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [seedRow.tenantId, requestIn, bc.id],
  );

  const taskIn = seedRow.task;
  const taskOut = (await fixture.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id)
     VALUES ($1, 6, 'Outside task', 'spend_item', $2) RETURNING id`,
    [seedRow.tenantId, seedRow.opexLine],
  ))[0].id as string;
  const incident = (await fixture.query(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential)
     VALUES ($1, 3, 'Confidential incident', 'major', true) RETURNING id`,
    [seedRow.tenantId],
  ))[0].id as string;
  const taskIncident = (await fixture.query(
    `INSERT INTO tasks (tenant_id, item_number, title, related_object_type, related_object_id, assignee_user_id)
     VALUES ($1, 7, 'Incident task', 'incident', $2, $3) RETURNING id`,
    [seedRow.tenantId, incident, bc.id],
  ))[0].id as string;
  // A confidential incident the contributor reported: they name it as the reporter, a reader of
  // the register who is neither admin, reporter nor owner does not.
  const confidentialIncident = (await fixture.query(
    `INSERT INTO incidents (tenant_id, item_number, title, severity, confidential, reporter_user_id)
     VALUES ($1, 5, 'Reported incident', 'major', true, $2) RETURNING id`,
    [seedRow.tenantId, bc.id],
  ))[0].id as string;
  await fixture.query(
    `UPDATE tasks SET assignee_user_id = $3 WHERE tenant_id = $1 AND id = $2`,
    [seedRow.tenantId, taskIn, bc.id],
  );

  return {
    appIn, appOut, projectIn, projectOut, requestIn, requestOut, taskIn, taskOut, taskIncident, incident,
    confidentialIncident,
  };
}

/** A Business Contributor only names the applications, projects, requests and tasks they take part in. */
async function testParticipation(bc: Person, fixtures: ParticipationFixtures, interfaceId: string) {
  const references = await referencesFor(bc, idMap([
    ['application', [fixtures.appIn, fixtures.appOut]],
    ['project', [fixtures.projectIn, fixtures.projectOut]],
    ['request', [fixtures.requestIn, fixtures.requestOut]],
    ['task', [fixtures.taskIn, fixtures.taskOut, fixtures.taskIncident]],
    ['interface', [interfaceId]],
  ]));
  assert.ok(references.get('application')?.has(fixtures.appIn.toLowerCase()), 'an application the contributor owns is named');
  assert.ok(!references.get('application')?.has(fixtures.appOut.toLowerCase()), 'another application is hidden');
  assert.ok(!references.get('interface')?.has(interfaceId.toLowerCase()), 'an interface of the applications module is hidden from a limited contributor');
  assert.ok(references.get('project')?.has(fixtures.projectIn.toLowerCase()), 'a project the contributor sponsors is named');
  assert.ok(!references.get('project')?.has(fixtures.projectOut.toLowerCase()), 'another project is hidden');
  assert.ok(references.get('request')?.has(fixtures.requestIn.toLowerCase()), 'a request the contributor raised is named');
  assert.ok(!references.get('request')?.has(fixtures.requestOut.toLowerCase()), 'another request is hidden');
  assert.ok(references.get('task')?.has(fixtures.taskIn.toLowerCase()), 'a task assigned to the contributor is named');
  assert.ok(!references.get('task')?.has(fixtures.taskOut.toLowerCase()), 'another task is hidden');
  assert.ok(!references.get('task')?.has(fixtures.taskIncident.toLowerCase()), 'a task on a confidential incident is hidden');
  console.log('  business contributor: application, interface, project, request, task and confidential incident: OK');
}

/** The register's confidentiality rule applies to the incident family itself. */
async function testIncidentVisibility(reader: Person, bc: Person, fixtures: ParticipationFixtures) {
  const ids = idMap([['incident', [fixtures.confidentialIncident]]]);
  const asReader = await referencesFor(reader, ids);
  assert.ok(
    !asReader.get('incident')?.has(fixtures.confidentialIncident.toLowerCase()),
    'a confidential incident is hidden from a register reader who is not admin, reporter or owner',
  );
  const asReporter = await referencesFor(bc, ids);
  assert.ok(
    asReporter.get('incident')?.has(fixtures.confidentialIncident.toLowerCase()),
    'the reporter names the confidential incident',
  );
  console.log('  confidential incident: hidden from a register reader, named for the reporter: OK');
}

async function testLineHistory(seedRow: HistorySeed, bc: Person, data: ParticipationFixtures, foreignOwner: string) {
  await seed(seedRow.tenantId, async (runner) => {
    await audit(runner, {
      table: 'spend_items', recordId: seedRow.opexLine, action: 'create', userId: bc.id,
      after: linePayload(seedRow, seedRow.opexLine, { project_id: data.projectIn }),
    });
    await audit(runner, {
      table: 'spend_items', recordId: seedRow.opexLine, action: 'update', userId: bc.id,
      before: { project_id: data.projectIn, owner_it_id: seedRow.owner },
      after: { project_id: data.projectOut, owner_it_id: foreignOwner },
    });
    await audit(runner, {
      table: 'application_spend_items', recordId: seedRow.opexLine, action: 'update', userId: bc.id, parent: { table: 'spend_items', id: seedRow.opexLine },
      before: [], after: [data.appIn, data.appOut],
    });
    for (const task of [data.taskOut, data.taskIn, data.taskIncident]) {
      await audit(runner, {
        table: 'tasks', recordId: task, action: 'create', userId: bc.id,
        after: { related_object_type: 'spend_item', related_object_id: seedRow.opexLine },
      });
    }
  });

  const page = await readPage(bc, seedRow, BC_PERMISSIONS);
  const project = findChange(page.items, 'project_id');
  assert.ok(project, 'the project change is present');
  assert.equal((project.change.after as any)?.hidden, true, 'the project outside the participation is hidden');
  assert.equal((project.change.after as any)?.kind, 'project');
  assert.equal((project.change.before as any)?.label, 'Project Alpha', 'the sponsored project is named');
  const owner = findChange(page.items, 'owner_it_id');
  assert.ok(owner, 'the owner change is present');
  assert.deepEqual(
    owner.change.after,
    { hidden: true, kind: 'user', deleted: true },
    'a person absent from this tenant\'s users is deleted here, never merely withheld',
  );

  const applications = page.items
    .filter((item) => item.subject.kind === 'application')
    .flatMap((item) => item.changes)
    .filter((change) => change.event === 'added');
  assert.ok(applications.some((change) => (change.after as any)?.label === 'Inside App'), 'the owned application is named');
  assert.ok(applications.some((change) => (change.after as any)?.hidden === true), 'the other application is hidden');

  const tasks = page.items.filter((item) => item.subject.kind === 'task');
  assert.ok(tasks.some((item) => item.subject.label === 'Follow up'), 'the participant task is named');
  assert.ok(tasks.some((item) => !item.subject.label && item.changes.some((change) => (change.after as any)?.hidden)), 'the other tasks are hidden');
  const serialized = JSON.stringify(page);
  for (const leak of ['Outside App', 'Outside Project', 'Outside task', 'Confidential incident', 'Incident task']) {
    assert.ok(!serialized.includes(leak), `${leak} does not leak`);
  }
  console.log('  line history through the service: hidden application, project and task, no name leak: OK');
}

async function run() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('record-history-references');
  const foreignTenantId = await createRaceTenant('record-history-references-foreign');
  try {
    const seeded = await seed(tenantId, async (runner) => {
      const seedData = await seedHistoryData(runner, tenantId);
      const reader = await seedPerson(runner, tenantId, { first: 'Rita', last: 'Reader' }, ALL_MODULES);
      const bc = await seedPerson(
        runner,
        tenantId,
        { first: 'Baptiste', last: 'Contributor' },
        BC_PERMISSIONS,
        { exactRoleName: 'Business Contributor' },
      );
      const documentType = await seedDocumentType(runner, tenantId);
      return { seed: seedData, reader, bc, documentType, classification: await seedClassification(runner, tenantId) };
    });
    const foreign = await seed(foreignTenantId, async (runner) => {
      const seedRow = await seedHistoryData(runner, foreignTenantId);
      return {
        seed: seedRow,
        documentType: await seedDocumentType(runner, foreignTenantId),
        classification: await seedClassification(runner, foreignTenantId),
      };
    });
    const full = {
      ...seeded,
      foreign: foreign.seed,
      foreignDocumentType: foreign.documentType,
      foreignClassification: foreign.classification,
    };

    const participation = await seed(tenantId, (runner) => createParticipationFixtures(full.seed, full.bc, runner));
    await testEveryFamily(full);
    await testFamilyModules(full);
    await testParticipation(full.bc, participation, full.seed.interfaceRecord);
    await testIncidentVisibility(full.reader, full.bc, participation);
    await testLineHistory(full.seed, full.bc, participation, full.foreign.owner);
    console.log('record-history-references.integration.spec: ok');
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(foreignTenantId);
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
