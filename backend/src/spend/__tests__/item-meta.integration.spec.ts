import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, HttpException, NotFoundException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { PermissionGuard } from '../../auth/permission.guard';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { CapexAllocationCalculatorService } from '../../capex/capex-allocation-calculator.service';
import { CapexAllocationsService } from '../../capex/capex-allocations.service';
import { CapexItemsController } from '../../capex/capex-items.controller';
import { BudgetChangedAt1853840000000 } from '../../migrations/1853840000000-budget-changed-at';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { SpendAllocationsService } from '../spend-allocations.service';
import { SpendItemsController } from '../spend-items.controller';
import { BudgetLineMeta, readBudgetLineMeta } from '../item-meta';
import { COUNTER_WRITER_WINDOW } from '../../common/record-meta';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { Kind, TABLES, amountsService, budgetOperations, period, repeat, seedMonths, seedVersion } from './round-inputs.fixtures';
import { createRaceTenant, dropRaceTenant, seed } from './race-harness';

// The meta of an OPEX or CAPEX line (plan planning/perf-scale, lot 3G): what
// the workspace polls every 30 seconds to learn that someone else changed the
// line or its budget (`spend/item-meta.ts`, contract in `common/record-meta.ts`).
// - The counters move on another user's write, never on a write that changes
//   nothing; a version's `budget_changed_at` moves with its `budget_rev` only.
// - Who and when: the audit row that wrote the line's current `row_version`;
//   for a version, the first audit row about it written at or after its last
//   change (amounts, allocations, a column clear of its year). A change no
//   audit row explains names nobody (the line: no time either; a version: the
//   moment it changed).
// - The writes of the budget tab and of the Allocations tab answer the
//   version's `budget_rev`, so the screen's own saves are not "changed elsewhere".
// - Tenant: the statement reads the session's tenant only; another tenant's
//   line is not found. Permissions: the detail's read level, per type.
// Committed data on throwaway tenants (removed at the end), each step its own
// transaction, as requests are.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

const YEAR = 2026;
const realAudit = () => new AuditService(undefined as any);
const months12 = (value: string) => repeat(value, 12);

type Level = 'reader' | 'contributor' | 'member' | 'admin';
type Setup = { marie: string; jean: string; companyId: string; itemId: string; versionId: string };

async function seedPerson(runner: QueryRunner, tenantId: string, first: string, last: string, permissions: Record<string, Level> | 'Administrator' = {}): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Item meta role', false, false, now(), now()) RETURNING id`,
    [tenantId, permissions === 'Administrator' ? 'Administrator' : `Item meta ${first} ${randomUUID().slice(0, 8)}`],
  );
  if (permissions !== 'Administrator') {
    for (const [resource, level] of Object.entries(permissions)) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, role.id, resource, level]);
    }
  }
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, role.id, `${first.toLowerCase()}.${last.toLowerCase()}.${randomUUID().slice(0, 6)}@item-meta.example`, first, last],
  );
  return user.id;
}

function allocations(kind: Kind): any {
  return kind === 'opex'
    ? new SpendAllocationsService(undefined as any, undefined as any, new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any), realAudit() as any)
    : new CapexAllocationsService(undefined as any, undefined as any, new CapexAllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any), realAudit() as any);
}

const meta = (tenantId: string, kind: Kind, itemId: string, asTenant = tenantId) => seed(asTenant, (runner) => readBudgetLineMeta(runner.manager, kind, tenantId, itemId));

/** The line's meta, which must be found. */
async function found(tenantId: string, kind: Kind, itemId: string): Promise<BudgetLineMeta> {
  const answer = await meta(tenantId, kind, itemId);
  assert.ok(answer, 'the line has a meta');
  return answer!;
}

const versionOf = (answer: BudgetLineMeta, year = YEAR) => {
  const version = answer.versions.find((entry) => entry.budget_year === year);
  assert.ok(version, `a version of ${year}`);
  return version!;
};

async function storedLine(tenantId: string, kind: Kind, itemId: string) {
  return seed(tenantId, async (runner) => {
    const [row] = await runner.query(`SELECT row_version FROM ${TABLES[kind].items} WHERE id = $1`, [itemId]);
    return { rowVersion: Number(row.row_version) };
  });
}

async function storedVersion(tenantId: string, kind: Kind, versionId: string) {
  return seed(tenantId, async (runner) => {
    const [row] = await runner.query(`SELECT budget_rev, budget_changed_at FROM ${TABLES[kind].versions} WHERE id = $1`, [versionId]);
    return { budgetRev: Number(row.budget_rev), changedAt: row.budget_changed_at ? new Date(row.budget_changed_at).toISOString() : null };
  });
}

/** The latest audit row of `userId` about `recordId`. */
async function lastAudit(tenantId: string, recordId: string, userId: string): Promise<string> {
  return seed(tenantId, async (runner) => {
    const [row] = await runner.query(
      `SELECT created_at FROM audit_log WHERE tenant_id = $1 AND record_id = $2 AND user_id = $3 ORDER BY created_at DESC LIMIT 1`,
      [tenantId, recordId, userId],
    );
    return new Date(row.created_at).toISOString();
  });
}

async function setup(tenantId: string, kind: Kind): Promise<Setup> {
  return seed(tenantId, async (runner) => {
    const marie = await seedPerson(runner, tenantId, 'Marie', 'Dupont');
    const jean = await seedPerson(runner, tenantId, 'Jean', 'Martin');
    const { companyId } = await seedCompany(runner, tenantId, `Meta company ${kind}`);
    const line = await itemService(kind, realAudit()).create(
      lineBody(kind, `Meta line ${kind}`, { paying_company_id: companyId, notes: 'Start' }), marie, { manager: runner.manager },
    );
    // Seeded without an audit row, like an old version: its creation is its last change.
    const versionId = await seedVersion(runner, kind, tenantId, line.id, YEAR);
    await seedMonths(runner, kind, tenantId, versionId, YEAR, { planned: months12('100') });
    return { marie, jean, companyId, itemId: line.id as string, versionId };
  });
}

/** One request of `userId`: the line PATCH as the workspace sends it. */
const patchLine = (tenantId: string, kind: Kind, s: Setup, userId: string, body: Record<string, unknown>) =>
  seed<any>(tenantId, (runner) => itemService(kind, realAudit()).update(s.itemId, body, userId, { manager: runner.manager }));

/** One budget tab save of `userId`: March of the budget column. */
const saveMarch = (tenantId: string, kind: Kind, s: Setup, userId: string, value: string) =>
  seed(tenantId, (runner) => amountsService(kind, realAudit()).bulkUpsert(
    s.versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), planned: value }] }, userId, { manager: runner.manager },
  ));

async function lineCounters(tenantId: string, kind: Kind) {
  const s = await setup(tenantId, kind);
  const start = await found(tenantId, kind, s.itemId);
  assert.equal(start.id, s.itemId);
  assert.equal(start.row_version, (await storedLine(tenantId, kind, s.itemId)).rowVersion, 'the stored counter');
  assert.equal(start.changed_by?.name, 'Marie Dupont', 'the creation wrote it');
  assert.equal(start.changed_at, await lastAudit(tenantId, s.itemId, s.marie));
  console.log(`ok - ${kind}: the line's counter and its author`);

  // Jean changes the notes: the counter moves, Jean wrote it.
  const saved = await patchLine(tenantId, kind, s, s.jean, { notes: 'Notes from Jean' });
  const afterJean = await found(tenantId, kind, s.itemId);
  assert.equal(afterJean.row_version, start.row_version + 1, 'another user\'s write moves the counter');
  assert.equal(Number(saved.row_version), afterJean.row_version, 'the PATCH answers the counter it left');
  assert.deepEqual(afterJean.changed_by, { id: s.jean, name: 'Jean Martin' });
  assert.equal(afterJean.changed_at, await lastAudit(tenantId, s.itemId, s.jean));
  console.log(`ok - ${kind}: another user's write moves row_version and names its author`);

  // Marie saves the same notes: nothing changes, and her audit row does not take Jean's place.
  await patchLine(tenantId, kind, s, s.marie, { notes: 'Notes from Jean' });
  const afterNoop = await found(tenantId, kind, s.itemId);
  assert.equal(afterNoop.row_version, afterJean.row_version, 'a write that changes nothing moves nothing');
  assert.deepEqual(afterNoop.changed_by, afterJean.changed_by, 'the author stays the one who wrote the value');
  assert.equal(afterNoop.changed_at, afterJean.changed_at);
  console.log(`ok - ${kind}: a write that changes nothing moves nothing and names nobody new`);

  // A change outside the audit trail (a script): the counter moves, nobody is named, no time.
  await seed(tenantId, (runner) => runner.query(`UPDATE ${TABLES[kind].items} SET notes = 'Script' WHERE id = $1`, [s.itemId]));
  const afterScript = await found(tenantId, kind, s.itemId);
  assert.equal(afterScript.row_version, afterJean.row_version + 1);
  assert.equal(afterScript.changed_by, null, 'a change the audit does not explain names nobody (never the last editor)');
  assert.equal(afterScript.changed_at, null);
  // The next logged change is named again.
  await patchLine(tenantId, kind, s, s.marie, { notes: 'Marie again' });
  const afterMarie = await found(tenantId, kind, s.itemId);
  assert.equal(afterMarie.row_version, afterScript.row_version + 1);
  assert.equal(afterMarie.changed_by?.name, 'Marie Dupont');
  console.log(`ok - ${kind}: a change no audit row explains names nobody`);

  // Names only: a user without a first or last name is named by nobody's e-mail.
  const nameless = await seed(tenantId, async (runner) => {
    const [role] = await runner.query(`SELECT role_id FROM users WHERE id = $1`, [s.marie]);
    const [user] = await runner.query(
      `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, NULL, NULL, 'enabled') RETURNING id`,
      [tenantId, role.role_id, `nameless.${randomUUID().slice(0, 6)}@item-meta.example`],
    );
    return user.id as string;
  });
  await patchLine(tenantId, kind, s, nameless, { notes: 'From someone without a name' });
  assert.deepEqual((await found(tenantId, kind, s.itemId)).changed_by, { id: nameless, name: null }, 'their id, no name, never the e-mail');
  console.log(`ok - ${kind}: a user without a name is given without one`);

  // Bounded: the writer is looked for among the line's newest audit rows only. Rows of writes
  // that changed nothing counted (here a relation saved again and again) push it out after the window.
  await patchLine(tenantId, kind, s, s.jean, { notes: 'Jean, before many relation saves' });
  const relationRows = (count: number) => seed(tenantId, (runner) => runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id, source, created_at)
     SELECT $1, $2, $3, 'update', '[]'::jsonb, '[]'::jsonb, $4, 'user', clock_timestamp() FROM generate_series(1, $5)`,
    [tenantId, kind === 'opex' ? 'spend_item_applications' : 'capex_item_applications', s.itemId, s.marie, count],
  ));
  await relationRows(COUNTER_WRITER_WINDOW - 1);
  assert.equal((await found(tenantId, kind, s.itemId)).changed_by?.name, 'Jean Martin', 'within the window: named');
  await relationRows(1);
  assert.equal((await found(tenantId, kind, s.itemId)).changed_by, null, 'beyond it: nobody, never someone else');
  console.log(`ok - ${kind}: the writer is searched among the line's newest ${COUNTER_WRITER_WINDOW} audit rows`);
  return s;
}

async function versionCounters(tenantId: string, kind: Kind, s: Setup) {
  const start = versionOf(await found(tenantId, kind, s.itemId));
  const stored = await storedVersion(tenantId, kind, s.versionId);
  assert.equal(start.id, s.versionId);
  assert.equal(start.budget_rev, stored.budgetRev);
  assert.ok(stored.changedAt, 'a new version starts with its creation as its last change');
  assert.equal(start.changed_at, stored.changedAt);
  assert.equal(start.changed_by, null, 'created without an audit row: nobody');

  // Jean saves March: the counter moves, the save answers it, Jean is named at the moment it changed.
  const answer = await saveMarch(tenantId, kind, s, s.jean, '150');
  const afterJean = versionOf(await found(tenantId, kind, s.itemId));
  assert.ok(afterJean.budget_rev > start.budget_rev, 'another user\'s budget write moves budget_rev');
  assert.equal(answer.budget_rev, afterJean.budget_rev, 'bulk-upsert answers the counter it left');
  assert.deepEqual(afterJean.changed_by, { id: s.jean, name: 'Jean Martin' });
  const stamped = await storedVersion(tenantId, kind, s.versionId);
  // The save bumps more than once (its amounts, then the column's record turning manual), each logged after it.
  assert.equal(afterJean.changed_at, stamped.changedAt, 'when: the moment the counter last moved');
  console.log(`ok - ${kind}: a budget save moves budget_rev, answers it, and names its author`);

  // Marie saves the same value: no write, no audit row, nothing moves.
  const same = await saveMarch(tenantId, kind, s, s.marie, '150');
  const afterNoop = versionOf(await found(tenantId, kind, s.itemId));
  assert.equal(afterNoop.budget_rev, afterJean.budget_rev);
  assert.equal(same.budget_rev, afterJean.budget_rev);
  assert.deepEqual(afterNoop.changed_by, afterJean.changed_by);
  assert.equal(afterNoop.changed_at, afterJean.changed_at, 'budget_changed_at moves with budget_rev only');
  // A version update that counts nothing (the view choice) leaves the moment.
  await seed(tenantId, (runner) => runner.query(`UPDATE ${TABLES[kind].versions} SET input_grain = 'annual', notes = 'n' WHERE id = $1`, [s.versionId]));
  const afterView = await storedVersion(tenantId, kind, s.versionId);
  assert.equal(afterView.budgetRev, afterJean.budget_rev);
  assert.equal(afterView.changedAt, afterJean.changed_at);
  console.log(`ok - ${kind}: a budget write that changes nothing moves nothing`);

  // A change nothing logs (a script, an item CSV total): nobody, at the moment it happened.
  await seed(tenantId, (runner) => runner.query(
    `UPDATE ${TABLES[kind].amounts} SET planned = planned + 1 WHERE version_id = $1 AND period = $2`, [s.versionId, period(5, YEAR)],
  ));
  const afterScript = versionOf(await found(tenantId, kind, s.itemId));
  assert.ok(afterScript.budget_rev > afterJean.budget_rev);
  assert.equal(afterScript.changed_by, null, 'not Jean, the last one logged');
  assert.equal(afterScript.changed_at, (await storedVersion(tenantId, kind, s.versionId)).changedAt);
  assert.ok(afterScript.changed_at! > afterJean.changed_at!);
  console.log(`ok - ${kind}: a budget change nothing logs names nobody, with its moment`);

  // Marie clears the forecast column of the year (Administration): her operation row on the line names her.
  await seed(tenantId, (runner) => runner.query(
    `UPDATE ${TABLES[kind].amounts} SET forecast = 10 WHERE version_id = $1`, [s.versionId],
  ));
  await seed(tenantId, (runner) => budgetOperations(kind, realAudit()).clearBudgetColumn({ year: YEAR, column: 'forecast' }, s.marie, { manager: runner.manager }));
  const afterClear = versionOf(await found(tenantId, kind, s.itemId));
  assert.ok(afterClear.budget_rev > afterScript.budget_rev);
  assert.equal(afterClear.changed_by?.name, 'Marie Dupont', 'a column clear names who ran it');
  console.log(`ok - ${kind}: a column clear of the year names who ran it`);

  // A column whose months are all zero but keeps its record (its lines): the clear removes the
  // record and names who ran it too.
  await seed(tenantId, (runner) => runner.query(
    `INSERT INTO ${TABLES[kind].rounds} (tenant_id, version_id, measure, period_start, period_end, method) VALUES ($1, $2, 'committed', $3, $4, 'manual')`,
    [tenantId, s.versionId, `${YEAR}-01-01`, `${YEAR}-12-31`],
  ));
  const recordOnly = versionOf(await found(tenantId, kind, s.itemId));
  assert.equal(recordOnly.changed_by, null, 'a record written outside the audit trail: nobody');
  await seed(tenantId, (runner) => budgetOperations(kind, realAudit()).clearBudgetColumn({ year: YEAR, column: 'revision' }, s.jean, { manager: runner.manager }));
  const afterRecordClear = versionOf(await found(tenantId, kind, s.itemId));
  assert.ok(afterRecordClear.budget_rev > recordOnly.budget_rev, 'removing the record is a change');
  assert.equal(afterRecordClear.changed_by?.name, 'Jean Martin', 'the clear of a column with a record and no amount names who ran it');
  // Many edits of the line since: the operation is still found, among the first rows after the moment.
  await seed(tenantId, (runner) => runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, user_id, source, created_at)
     SELECT $1, $2, $3, 'update', '{}'::jsonb, '{}'::jsonb, $4, 'user', clock_timestamp() FROM generate_series(1, 200)`,
    [tenantId, TABLES[kind].items, s.itemId, s.marie],
  ));
  assert.equal(versionOf(await found(tenantId, kind, s.itemId)).changed_by?.name, 'Jean Martin', 'later edits of the line do not hide it');
  console.log(`ok - ${kind}: clearing a column with a record and no amount names who ran it`);

  // Jean saves the allocation: the PUT and the GET answer the counter, Jean is named.
  const service = allocations(kind);
  const read = await seed<any>(tenantId, (runner) => service.listForVersion(s.versionId, { manager: runner.manager, tenantId }));
  assert.equal(read.budget_rev, afterRecordClear.budget_rev, 'the allocation read answers the counter it was read with');
  const put = await seed<any>(tenantId, (runner) => service.put(s.versionId, {
    method: 'manual_pct', driver: 'headcount', rows: [{ company_id: s.companyId, department_id: null, allocation_pct: 100 }], base_signature: read.base_signature,
  }, s.jean, { manager: runner.manager, tenantId }));
  const afterPut = versionOf(await found(tenantId, kind, s.itemId));
  assert.ok(afterPut.budget_rev > afterRecordClear.budget_rev, 'an allocation save moves budget_rev');
  assert.equal(put.budget_rev, afterPut.budget_rev, 'the PUT answers the counter it left');
  assert.equal(afterPut.changed_by?.name, 'Jean Martin');
  console.log(`ok - ${kind}: an allocation save answers budget_rev and names its author`);

  // The allocation's answers carry the year's totals, read after the counter: a save after
  // someone else's budget change shows their amounts, never the ones the tab had.
  const storedTotals = async () => seed(tenantId, async (runner) => {
    const [row] = await runner.query(`SELECT planned FROM ${TABLES[kind].versions.replace('versions', 'version_totals')} WHERE version_id = $1`, [s.versionId]);
    return Number(row?.planned ?? 0);
  });
  assert.equal(read.totals.planned, put.totals.planned, 'no amount changed between them');
  assert.equal(put.totals.planned, await storedTotals());
  await saveMarch(tenantId, kind, s, s.marie, '400');
  const again = await seed<any>(tenantId, (runner) => service.put(s.versionId, {
    method: 'manual_pct', driver: 'headcount', rows: [{ company_id: s.companyId, department_id: null, allocation_pct: 100 }], base_signature: put.base_signature,
  }, s.jean, { manager: runner.manager, tenantId }));
  assert.equal(again.totals.planned, await storedTotals(), 'the PUT answers the year as stored now');
  assert.equal(again.totals.planned, put.totals.planned + 250, 'Marie\'s March (150 to 400) is in it');
  assert.equal(again.budget_rev, versionOf(await found(tenantId, kind, s.itemId)).budget_rev);
  console.log(`ok - ${kind}: the allocation answers carry the year's totals with the counter`);

  // A second year: one entry per version, in year order.
  await seed(tenantId, (runner) => seedVersion(runner, kind, tenantId, s.itemId, YEAR + 1));
  const both = await found(tenantId, kind, s.itemId);
  assert.deepEqual(both.versions.map((version) => version.budget_year), [YEAR, YEAR + 1]);
}

async function tenantIsolation(tenantId: string, otherTenantId: string, kind: Kind, s: Setup) {
  // Asked from the other tenant's session, or for the other tenant from this session: not found.
  assert.equal(await meta(tenantId, kind, s.itemId, otherTenantId), null, 'RLS: another tenant\'s session reads nothing');
  assert.equal(await meta(otherTenantId, kind, s.itemId, tenantId), null, 'the tenant predicate: the line of another tenant is not found');
  // Through the service: 404.
  await assert.rejects(
    seed(otherTenantId, (runner) => itemService(kind).meta(s.itemId, otherTenantId, { manager: runner.manager })),
    (error: unknown) => error instanceof NotFoundException,
  );
  await assert.rejects(
    seed(tenantId, (runner) => itemService(kind).meta(randomUUID(), tenantId, { manager: runner.manager })),
    (error: unknown) => error instanceof NotFoundException,
  );
  console.log(`ok - ${kind}: another tenant's line is not found (RLS and the tenant predicate)`);
}

/* ---- Permissions: the real guard, then the real handler with its @Tenant() argument ---- */

type Route = { name: string; controller: any; svc: any };

function buildGuard(): PermissionGuard {
  return new PermissionGuard(
    new Reflector(),
    new (UsersService as any)(dataSource.getRepository(User)),
    new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    dataSource,
    { isConfigured: () => false } as any,
  );
}

function executionContext(route: Route, req: any): ExecutionContext {
  const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
  return {
    getHandler: () => route.controller.prototype.meta,
    getClass: () => route.controller,
    switchToHttp: () => http,
    getType: () => 'http',
    getArgs: () => [req, {}, undefined],
    getArgByIndex: (i: number) => [req, {}, undefined][i],
    switchToRpc: () => { throw new Error('http only'); },
    switchToWs: () => { throw new Error('http only'); },
  } as unknown as ExecutionContext;
}

async function call(guard: PermissionGuard, runner: QueryRunner, tenantId: string, userId: string, route: Route, id: string) {
  const req: any = { method: 'GET', user: { sub: userId }, tenant: { id: tenantId }, queryRunner: runner };
  const context = executionContext(route, req);
  await runner.query('SAVEPOINT meta_call');
  try {
    if (!(await guard.canActivate(context))) {
      await runner.query('RELEASE SAVEPOINT meta_call');
      return { status: 403 };
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, route.controller, 'meta') as Record<string, { factory?: Function; data?: unknown }>;
    const custom = Object.values(args).find((arg) => typeof arg.factory === 'function');
    const ctx = custom!.factory!(custom!.data, context);
    const controller = Object.assign(Object.create(route.controller.prototype), { svc: route.svc });
    const body = await route.controller.prototype.meta.call(controller, id, ctx);
    await runner.query('RELEASE SAVEPOINT meta_call');
    return { status: 200, body };
  } catch (error) {
    await runner.query('ROLLBACK TO SAVEPOINT meta_call');
    if (error instanceof HttpException) return { status: error.getStatus(), body: error.getResponse() };
    throw error;
  }
}

async function permissions(tenantId: string, lines: Record<Kind, Setup>) {
  const people = await seed(tenantId, async (runner) => ({
    opexReader: await seedPerson(runner, tenantId, 'Olivia', 'Reader', { opex: 'reader' }),
    capexReader: await seedPerson(runner, tenantId, 'Carl', 'Reader', { capex: 'reader' }),
    outsider: await seedPerson(runner, tenantId, 'Paul', 'Outsider', { tasks: 'reader' }),
    admin: await seedPerson(runner, tenantId, 'Ada', 'Admin', 'Administrator'),
  }));
  const opex: Route = { name: 'GET /spend-items/:id/meta', controller: SpendItemsController, svc: itemService('opex') };
  const capex: Route = { name: 'GET /capex-items/:id/meta', controller: CapexItemsController, svc: itemService('capex') };
  for (const [route, resource] of [[opex, 'opex'], [capex, 'capex']] as const) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, route.controller.prototype.meta), { resource, level: 'reader' }, `${route.name}: the detail's read level`);
  }
  const guard = buildGuard();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const cases: Array<[string, string, Route, Kind, number]> = [
      ['OPEX reader', people.opexReader, opex, 'opex', 200], ['OPEX reader', people.opexReader, capex, 'capex', 403],
      ['CAPEX reader', people.capexReader, capex, 'capex', 200], ['CAPEX reader', people.capexReader, opex, 'opex', 403],
      ['no budget access', people.outsider, opex, 'opex', 403], ['no budget access', people.outsider, capex, 'capex', 403],
      ['administrator', people.admin, opex, 'opex', 200], ['administrator', people.admin, capex, 'capex', 200],
    ];
    for (const [who, userId, route, kind, status] of cases) {
      const answer = await call(guard, runner, tenantId, userId, route, lines[kind].itemId);
      assert.equal(answer.status, status, `${who} on ${route.name}: ${JSON.stringify(answer.body ?? null)}`);
      if (status === 200) {
        assert.equal(answer.body.id, lines[kind].itemId);
        assert.ok(Array.isArray(answer.body.versions) && typeof answer.body.row_version === 'number');
      }
    }
    // A reference works like on the detail route; an unknown line is a 404.
    const [{ item_number }] = await runner.query(`SELECT item_number FROM spend_items WHERE id = $1`, [lines.opex.itemId]);
    const byRef = await call(guard, runner, tenantId, people.opexReader, opex, `OPX-${item_number}`);
    assert.equal(byRef.status, 200);
    assert.equal(byRef.body.id, lines.opex.itemId);
    assert.equal((await call(guard, runner, tenantId, people.opexReader, opex, randomUUID())).status, 404);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log('ok - permissions: the detail\'s read level per type; a reference resolves, an unknown line is a 404');
}

/** The migration runs again without harm (in a transaction rolled back). */
async function migrationIdempotent() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const migration = new BudgetChangedAt1853840000000();
    await migration.up(runner);
    await migration.up(runner);
    const triggers = await runner.query(
      `SELECT tgrelid::regclass::text AS table, tgname FROM pg_trigger WHERE tgname LIKE '%_budget_rev_stamp' AND NOT tgisinternal ORDER BY 1`,
    );
    assert.deepEqual(triggers.map((row: { table: string }) => row.table), ['capex_versions', 'spend_versions']);
    // The stamp fires after the method trigger (name order), so it sees the counter that one set.
    const order = await runner.query(
      `SELECT tgname FROM pg_trigger WHERE tgrelid = 'spend_versions'::regclass AND NOT tgisinternal AND tgname LIKE 'spend_versions_budget_rev%' ORDER BY tgname`,
    );
    assert.deepEqual(order.map((row: { tgname: string }) => row.tgname), ['spend_versions_budget_rev', 'spend_versions_budget_rev_stamp']);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log('ok - the migration is idempotent; the stamp trigger runs after the method trigger');
}

/** A method change (the version's own trigger) stamps the moment too. */
async function methodStamps(tenantId: string, kind: Kind, s: Setup) {
  const before = await storedVersion(tenantId, kind, s.versionId);
  await seed(tenantId, (runner: QueryRunner) => (runner.manager as EntityManager).query(
    `UPDATE ${TABLES[kind].versions} SET allocation_method = 'headcount' WHERE id = $1`, [s.versionId],
  ));
  const after = await storedVersion(tenantId, kind, s.versionId);
  assert.equal(after.budgetRev, before.budgetRev + 1);
  assert.ok(after.changedAt! > before.changedAt!, 'the method trigger\'s bump is stamped');
  console.log(`ok - ${kind}: a method change stamps budget_changed_at`);
}

async function main() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('item-meta');
  const otherTenantId = await createRaceTenant('item-meta-other');
  try {
    await migrationIdempotent();
    const lines = {} as Record<Kind, Setup>;
    for (const kind of ['opex', 'capex'] as const) {
      const s = await lineCounters(tenantId, kind);
      await versionCounters(tenantId, kind, s);
      await methodStamps(tenantId, kind, s);
      await tenantIsolation(tenantId, otherTenantId, kind, s);
      lines[kind] = s;
    }
    await permissions(tenantId, lines);
  } finally {
    await dropRaceTenant(tenantId);
    await dropRaceTenant(otherTenantId);
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
