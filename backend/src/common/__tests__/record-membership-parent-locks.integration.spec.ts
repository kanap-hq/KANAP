import 'dotenv/config';
import 'reflect-metadata';
import type { EntityManager } from 'typeorm';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Company } from '../../companies/company.entity';
import { CsvExportService } from '../csv/csv-export.service';
import { CsvImportService } from '../csv/csv-import.service';
import { CsvJsonValidators } from '../csv/csv-json-validators';
import { CsvResolverService } from '../csv/csv-resolver.service';
import { ItemNumberService } from '../item-number.service';
import { applyDataAccess } from '../../data-access/data-access';
import { Department } from '../../departments/department.entity';
import { DepartmentsService } from '../../departments/departments.service';
import { PortfolioCategory } from '../../portfolio/portfolio-category.entity';
import { PortfolioClassificationService } from '../../portfolio/portfolio-classification.service';
import { PortfolioRequest } from '../../portfolio/portfolio-request.entity';
import { PortfolioRequestsCsvService } from '../../portfolio/portfolio-requests-csv.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioSource } from '../../portfolio/portfolio-source.entity';
import { PortfolioStream } from '../../portfolio/portfolio-stream.entity';
import { PortfolioTaskType } from '../../portfolio/portfolio-task-type.entity';
import { bulkUpsertAllocations, plannedAllocationRows } from '../../spend/allocation-save';
import { User } from '../../users/user.entity';
import { UsersService } from '../../users/users.service';
import { knowledgeServiceFor, managedDocumentServices } from '../creation/__tests__/creation-cancel.fixtures';
import { DEPARTMENT_PAIR, settleRecordMembership, STREAM_PAIR } from '../record-membership';
import { assert, httpStatus, pgCode, progress, Race, runRaceSpecs, settle, withRace } from '../../spend/__tests__/race-harness';

// A record takes a department or a stream while it moves (lot I7a of 26.12.1). The move locks the row
// `FOR UPDATE` before it counts (`record-membership-moves.ts`); every write that reads the parent of a
// department or a stream to store it with it reads it `FOR KEY SHARE` in its transaction
// (`parentReadLock`): the rule's own read (people, requests, projects, tasks, contributors, Kad's
// execution, Entra), an import's load, a budget line's split by department, a document's
// classification. Whichever starts first, the other waits, and no record ends with a department of
// another company or a stream of another category. A preview (Kad's card, an import's check) locks
// nothing. The limited data access role takes the lock on both tables.

type Seeded = {
  alpha: string; beta: string; finance: string;
  it: string; biz: string; ops: string;
  request: string; user: string; limited: string;
};

async function seedAll(race: Race): Promise<Seeded> {
  return race.seedWith(async (runner) => {
    const tenant = race.tenantId;
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const alpha = await one(`INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, 'Alpha', 'FR', 'Lyon', 'EUR') RETURNING id`, [tenant]);
    const beta = await one(`INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, 'Beta', 'FR', 'Brest', 'EUR') RETURNING id`, [tenant]);
    const finance = await one(`INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance') RETURNING id`, [tenant, alpha]);
    const it = await one(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'IT') RETURNING id`, [tenant]);
    const biz = await one(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Business') RETURNING id`, [tenant]);
    const ops = await one(`INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Ops') RETURNING id`, [tenant, it]);
    const request = await one(
      `INSERT INTO portfolio_requests (tenant_id, item_number, name, status, category_id) VALUES ($1, 1, 'Request', 'pending_review', $2) RETURNING id`,
      [tenant, it],
    );
    const role = await one(`INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, 'Locks', 'Locks', false, false) RETURNING id`, [tenant]);
    const user = await one(
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, mfa_enabled, status, company_id) VALUES ($1, 'locks-person@example.invalid', 'Lock', 'Person', $2, false, 'enabled', $3) RETURNING id`,
      [tenant, role, alpha],
    );
    const limited = await one(
      `INSERT INTO users (tenant_id, email, role_id, status, data_access_mode) VALUES ($1, 'locks-limited@example.invalid', $2, 'enabled', 'limited') RETURNING id`,
      [tenant, role],
    );
    return { alpha, beta, finance, it, biz, ops, request, user, limited };
  });
}

const noAudit = { log: async () => undefined };
const quiet = { notifyTeamAdded: () => undefined, notifyItLeadOfTeamChange: () => undefined, getProjectRecipients: async () => [], getRequestRecipients: async () => [], notifyStatusChange: () => undefined };

function moveDepartment(manager: EntityManager, id: string, company: string) {
  return new DepartmentsService(manager.getRepository(Department), manager.getRepository(Company), noAudit as any)
    .update(id, { company_id: company } as any, undefined, { manager });
}

function moveStream(manager: EntityManager, tenantId: string, id: string, category: string) {
  return new PortfolioClassificationService(
    manager.getRepository(PortfolioSource), manager.getRepository(PortfolioCategory), manager.getRepository(PortfolioStream), manager.getRepository(PortfolioTaskType),
  ).updateStream(id, tenantId, { category_id: category }, { manager });
}

function updatePerson(manager: EntityManager, id: string, body: Record<string, unknown>) {
  return new UsersService(manager.getRepository(User), manager.getRepository(Company), manager.getRepository(Department), {} as any, {} as any, {} as any, noAudit as any)
    .updateUser(id, body as any, undefined, { manager });
}

function updateRequest(manager: EntityManager, tenantId: string, id: string, body: Record<string, unknown>) {
  return new PortfolioRequestsService(
    manager.getRepository(PortfolioRequest), new AuditService(manager.getRepository(AuditLog)), {} as any, {} as any, { logChange: async () => undefined } as any, quiet as any,
    new ItemNumberService(), {} as any, managedDocumentServices(manager),
  ).update(id, body as any, tenantId, null as any, { manager });
}

const parentRead = (table: string) => (text: string) => new RegExp(`AS parent FROM ${table}\\b`).test(text);
const moveCount = (text: string) => /FROM unnest\(\$1::uuid\[\], \$2::uuid\[\]\) AS m\(id, parent\)/.test(text);

/** A department taken by a person while it moves: record first, then move first. */
async function departmentRace(order: 'record first' | 'move first') {
  await withRace(`parent-lock-department-${order.split(' ')[0]}`, async (race) => {
    const s = await seedAll(race);
    const recordSide = await race.open('the person takes Finance');
    const moveSide = await race.open('Finance moves to Beta');
    if (order === 'record first') {
      const read = race.gate(recordSide, { label: 'parent read', when: 'after', match: parentRead('departments') });
      const record = race.start(recordSide, (m) => updatePerson(m, s.user, { department_id: s.finance }));
      assert.equal(await progress(record, { party: recordSide, gate: read }), 'gated', 'harness: the person read Finance');
      const move = race.start(moveSide, (m) => moveDepartment(m, s.finance, s.beta));
      assert.equal(await progress(move, { party: moveSide }), 'blocked', 'the move waits for the person');
      read.release();
      assert.equal((await settle(record)).ok, true, 'the person is saved');
      const moved = await settle(move);
      assert.equal(moved.ok ? 200 : httpStatus(moved.error), 400, 'the move is refused once the person counts');
    } else {
      const counted = race.gate(moveSide, { label: 'counted', when: 'after', match: moveCount });
      const move = race.start(moveSide, (m) => moveDepartment(m, s.finance, s.beta));
      assert.equal(await progress(move, { party: moveSide, gate: counted }), 'gated', 'harness: the move counted nothing');
      const record = race.start(recordSide, (m) => updatePerson(m, s.user, { department_id: s.finance }));
      assert.equal(await progress(record, { party: recordSide }), 'blocked', 'the person waits for the move');
      counted.release();
      assert.equal((await settle(move)).ok, true, 'Finance moves');
      const recorded = await settle(record);
      assert.equal(recorded.ok ? 200 : httpStatus(recorded.error), 400, 'the person is checked on the new company');
    }
    const [person] = await race.read(
      `SELECT u.company_id::text AS company, d.company_id::text AS department_company FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`,
      [s.user],
    );
    assert.ok(person.department_company == null || person.department_company === person.company, `no contradictory pair: ${JSON.stringify(person)}`);
  });
}

/** A stream taken by a request while it moves: record first, then move first. */
async function streamRace(order: 'record first' | 'move first') {
  await withRace(`parent-lock-stream-${order.split(' ')[0]}`, async (race) => {
    const s = await seedAll(race);
    const recordSide = await race.open('the request takes Ops');
    const moveSide = await race.open('Ops moves to Business');
    if (order === 'record first') {
      const read = race.gate(recordSide, { label: 'parent read', when: 'after', match: parentRead('portfolio_streams') });
      const record = race.start(recordSide, (m) => updateRequest(m, race.tenantId, s.request, { stream_id: s.ops }));
      assert.equal(await progress(record, { party: recordSide, gate: read }), 'gated', 'harness: the request read Ops');
      const move = race.start(moveSide, (m) => moveStream(m, race.tenantId, s.ops, s.biz));
      assert.equal(await progress(move, { party: moveSide }), 'blocked', 'the move waits for the request');
      read.release();
      assert.equal((await settle(record)).ok, true, 'the request is saved');
      const moved = await settle(move);
      assert.equal(moved.ok ? 200 : httpStatus(moved.error), 400, 'the move is refused once the request counts');
    } else {
      const counted = race.gate(moveSide, { label: 'counted', when: 'after', match: moveCount });
      const move = race.start(moveSide, (m) => moveStream(m, race.tenantId, s.ops, s.biz));
      assert.equal(await progress(move, { party: moveSide, gate: counted }), 'gated', 'harness: the move counted nothing');
      const record = race.start(recordSide, (m) => updateRequest(m, race.tenantId, s.request, { stream_id: s.ops }));
      assert.equal(await progress(record, { party: recordSide }), 'blocked', 'the request waits for the move');
      counted.release();
      assert.equal((await settle(move)).ok, true, 'Ops moves');
      const recorded = await settle(record);
      assert.equal(recorded.ok ? 200 : httpStatus(recorded.error), 400, 'the request is checked on the new category');
    }
    const [request] = await race.read(
      `SELECT r.category_id::text AS category, s.category_id::text AS stream_category FROM portfolio_requests r LEFT JOIN portfolio_streams s ON s.id = r.stream_id WHERE r.id = $1`,
      [s.request],
    );
    assert.ok(request.stream_category == null || request.stream_category === request.category, `no contradictory pair: ${JSON.stringify(request)}`);
  });
}

/**
 * Whether `work`, paused right after its read of the parent, holds the row: another connection's
 * `FOR UPDATE NOWAIT` (a move's lock) is refused (55P03) while it does.
 */
async function holdsParent(
  race: Race,
  table: 'departments' | 'portfolio_streams',
  id: string,
  read: (text: string) => boolean,
  work: (manager: EntityManager) => Promise<unknown>,
): Promise<boolean> {
  const writer = await race.open(`a write reading ${table}`);
  const probe = await race.open('a move');
  const gate = race.gate(writer, { label: 'parent read', when: 'after', match: read });
  const running = race.start(writer, work);
  assert.equal(await progress(running, { party: writer, gate }), 'gated', `harness: the write reads ${table}`);
  const tried = await settle(race.start(probe, (m) => m.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE NOWAIT`, [id])));
  gate.release();
  await settle(running);
  if (tried.ok) return false;
  assert.equal(pgCode(tried.error), '55P03', `the probe fails on the lock only: ${String(tried.error)}`);
  return true;
}

async function limitedRoleTakesTheLock() {
  await withRace('parent-lock-limited', async (race) => {
    const s = await seedAll(race);
    const asLimited = (pair: typeof DEPARTMENT_PAIR, given: Record<string, unknown>) => async (m: EntityManager) => {
      await applyDataAccess(m, s.limited);
      const [{ role }] = await m.query(`SELECT current_setting('role') AS role`);
      assert.equal(role, 'kanap_data_limited', 'harness: the limited role');
      return settleRecordMembership(m, [pair], given, null, race.tenantId);
    };
    assert.equal(await holdsParent(race, 'departments', s.finance, parentRead('departments'), asLimited(DEPARTMENT_PAIR, { department_id: s.finance })), true,
      'the limited role reads departments FOR KEY SHARE');
    assert.equal(await holdsParent(race, 'portfolio_streams', s.ops, parentRead('portfolio_streams'), asLimited(STREAM_PAIR, { stream_id: s.ops })), true,
      'the limited role reads portfolio_streams FOR KEY SHARE');
    // Kad's card writes nothing: it locks nothing.
    assert.equal(await holdsParent(race, 'portfolio_streams', s.ops, parentRead('portfolio_streams'),
      (m) => settleRecordMembership(m, [STREAM_PAIR], { stream_id: s.ops }, null, race.tenantId, { lock: false })), false, 'a preview locks nothing');
  });
}

async function importLocksOnLoad() {
  await withRace('parent-lock-import', async (race) => {
    const s = await seedAll(race);
    const csv = 'name;category_name;stream_name\nImported;IT;Ops';
    const run = (dryRun: boolean) => (m: EntityManager) => {
      const resolver = new CsvResolverService();
      const service = new PortfolioRequestsCsvService(null as any, new CsvExportService(resolver), new CsvImportService(resolver, new CsvJsonValidators()), managedDocumentServices(m));
      const file = { buffer: Buffer.from(csv, 'utf8'), originalname: 'import.csv', mimetype: 'text/csv', size: csv.length } as Express.Multer.File;
      return (service as any).import(file, { dryRun, operation: 'upsert' }, { manager: m, tenantId: race.tenantId, userId: s.user, isAdmin: true, access: { isAdmin: true } });
    };
    const streamsRead = (text: string) => /FROM portfolio_streams WHERE tenant_id = \$1/.test(text);
    assert.equal(await holdsParent(race, 'portfolio_streams', s.ops, streamsRead, run(false)), true, 'the load holds the streams it reads');
    assert.equal(await holdsParent(race, 'portfolio_streams', s.ops, streamsRead, run(true)), false, 'the check holds nothing');
  });
}

async function allocationLocksOnSave() {
  await withRace('parent-lock-allocation', async (race) => {
    const s = await seedAll(race);
    const version = await race.seedWith(async (runner) => {
      const [item] = await runner.query(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number) VALUES ($1, 'Line', 'EUR', '2020-01-01', 1) RETURNING id`,
        [race.tenantId],
      );
      const [v] = await runner.query(
        `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
         VALUES ($1, $2, 'Y2026', 'monthly', '2026-01-01', 2026, 'manual_department') RETURNING id`,
        [race.tenantId, item.id],
      );
      await runner.query(`INSERT INTO department_metrics (tenant_id, department_id, fiscal_year, headcount) VALUES ($1, $2, 2026, 10)`, [race.tenantId, s.finance]);
      return v.id as string;
    });
    const items = [{ company_id: s.alpha, department_id: s.finance }];
    const departmentsRead = (text: string) => /FROM "departments"/.test(text);
    const deps = (m: EntityManager) => ({ manager: m, audit: noAudit, calculator: { computeForVersions: async () => new Map() } });
    assert.equal(await holdsParent(race, 'departments', s.finance, departmentsRead,
      (m) => bulkUpsertAllocations(deps(m) as any, 'opex' as any, race.tenantId, version, items as any, s.user)), true, 'the save holds the departments it reads');
    assert.equal(await holdsParent(race, 'departments', s.finance, departmentsRead,
      (m) => plannedAllocationRows(m, 'opex' as any, race.tenantId, version, items as any, undefined)), false, 'Kad\'s card holds nothing');
  });
}

async function documentLocksOnClassification() {
  await withRace('parent-lock-document', async (race) => {
    const s = await seedAll(race);
    const document = await race.seedWith(async (runner) => {
      const [library] = await runner.query(`INSERT INTO document_libraries (tenant_id, name, slug) VALUES ($1, 'Library', 'library') RETURNING id`, [race.tenantId]);
      const [doc] = await runner.query(
        `INSERT INTO documents (tenant_id, item_number, title, library_id) VALUES ($1, 1, 'Document', $2) RETURNING id`, [race.tenantId, library.id],
      );
      return doc.id as string;
    });
    const read = (text: string) => /FROM portfolio_streams\s+WHERE id = \$1/.test(text);
    assert.equal(await holdsParent(race, 'portfolio_streams', s.ops, read,
      (m) => knowledgeServiceFor(m).knowledge.bulkReplaceClassifications(document, [{ category_id: s.it, stream_id: s.ops }], { manager: m })), true,
      'a document\'s classification holds its stream');
  });
}

void runRaceSpecs('record-membership-parent-locks', [
  ['a department taken by a person, the person first', () => departmentRace('record first')],
  ['a department taken by a person, the move first', () => departmentRace('move first')],
  ['a stream taken by a request, the request first', () => streamRace('record first')],
  ['a stream taken by a request, the move first', () => streamRace('move first')],
  ['the limited data access role takes the lock on departments and streams; a preview takes none', limitedRoleTakesTheLock],
  ['an import holds the streams it reads on its load, not on its check', importLocksOnLoad],
  ['a split by department holds the departments on its save, not on Kad\'s card', allocationLocksOnSave],
  ['a document\'s classification holds its stream', documentLocksOnClassification],
]);
