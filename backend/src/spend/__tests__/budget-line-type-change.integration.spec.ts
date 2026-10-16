import 'dotenv/config';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { PermissionGuard } from '../../auth/permission.guard';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { ItemNumberService } from '../../common/item-number.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { SpendItemsController } from '../spend-items.controller';
import { CapexItemsController } from '../capex-items.controller';
import { SpendTasksController } from '../spend-tasks.controller';
import { SpendTasksService } from '../spend-tasks.service';
import { CapexTasksController } from '../capex-tasks.controller';
import { ChargebackReportService, ChargebackScope } from '../chargeback-report.service';
import { SUMMARY_SCOPES } from '../spend-summary.builder';
import { readBudgetLineMeta } from '../item-meta';
import { accountNatureRefusal } from '../item-write.util';
import { notApplicableDimensionMessage, notApplicableValueMessage } from '../item-analytics.util';
import { natureChangeMessage } from '../budget-file/preflight';
import { realSummaryDeps } from './oracle/oracle-deps';
import { preflightBudgetFile } from './budget-file.fixtures';
import {
  changeAuditRows,
  lineChildren,
  seedRoleUser,
  seedTypeChangeLine,
  seedTypeChangeWorld,
  storedLine,
  typeChangeService,
  versionTotals,
} from './budget-line-type-change.fixtures';
import { assert, captureAudit, freezeColumn, inRolledBackTransaction, runSpecs, setTenant } from './round-inputs.fixtures';
import { itemService } from './cost-center.fixtures';

// The change of type of a budget line in place (lot M, plan planning/budget-unifie.md, decision
// U4; `budget-line-type-change.service.ts`), through the OPEX and CAPEX routes, each test in a
// transaction rolled back. A line seeded with every child (versions with months, a round input and
// an allocation, analytics values, a web link, a contact, an attachment, links to an application,
// an asset, a contract, a project and a request, a task):
// - OPEX to CAPEX and back keeps the line's id, BL number and every child; the tasks follow, the
//   search entry and the lists, the chargeback (OPEX, CAPEX, both) and the routes follow the
//   nature; the line gets a CPX number once, keeps it back in OPEX and takes it again; the CAPEX routes find it by the
//   reference the CAPEX screens build; one audit row under the new type's label, with the reason,
//   names the user as the line's last writer;
// - a frozen column of either type with an amount refuses it, a zero amount does not; an account
//   or a value given must suit the new type, a missing required dimension and a kept account of
//   the old type are tolerated; a stale `row_version` is a 409; a year outside the line's is a 400;
//   the `budget` member level is required;
// - a budget file names the line by its BL number in its new type, and refuses the old type.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const NUMBER = 990201;

type Ctx = { manager: any; tenantId: string; userId: string };

async function seedTenant(runner: QueryRunner): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Type change', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `type-change-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  return tenantId;
}

function controllers(runner: QueryRunner) {
  const none = undefined as any;
  const audit = captureAudit();
  const typeChange = typeChangeService(runner);
  const opexSvc = itemService('opex', audit);
  const capexSvc = itemService('capex', audit);
  const opex = new SpendItemsController(opexSvc, none, none, none, none, audit as any, none, capexSvc, typeChange) as any;
  const capex = new CapexItemsController(capexSvc, none, none, none, none, audit as any, none, opexSvc, typeChange) as any;
  const unified = new TasksUnifiedService(
    none, audit as any, none, none, { getTaskRecipients: async () => [] } as any, new ItemNumberService(),
    { logChange: async () => undefined } as any, { cleanupOrphanedImages: async () => undefined } as any, none,
  );
  const opexTasks = new SpendTasksController(new SpendTasksService(unified, audit as any)) as any;
  const capexTasks = new CapexTasksController(unified) as any;
  return { opex, capex, opexSvc, capexSvc, opexTasks, capexTasks, typeChange };
}

/** The status a call answers: 200 and its body, or the HttpException's status and body (in a savepoint undone on error). */
async function statusOf(runner: QueryRunner, call: () => Promise<unknown>): Promise<{ status: number; body?: any }> {
  await runner.query('SAVEPOINT type_change_call');
  try {
    const body = await call();
    await runner.query('RELEASE SAVEPOINT type_change_call');
    return { status: 200, body };
  } catch (err) {
    await runner.query('ROLLBACK TO SAVEPOINT type_change_call');
    if (err instanceof HttpException) return { status: err.getStatus(), body: err.getResponse() };
    throw err;
  }
}

function buildGuard(): PermissionGuard {
  return new PermissionGuard(
    new Reflector(),
    new (UsersService as any)(dataSource.getRepository(User)),
    new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    dataSource,
    { isConfigured: () => false } as any,
  );
}

async function guardAllows(runner: QueryRunner, tenantId: string, userId: string, controller: any, handler: string, method: string): Promise<boolean> {
  const req: any = { method, user: { sub: userId }, tenant: { id: tenantId }, queryRunner: runner };
  const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
  const context = {
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
    switchToHttp: () => http,
    getType: () => 'http',
    getArgs: () => [req, {}, undefined],
    getArgByIndex: (i: number) => [req, {}, undefined][i],
  } as unknown as ExecutionContext;
  try {
    return await buildGuard().canActivate(context);
  } catch (err) {
    if (err instanceof HttpException && err.getStatus() === 403) return false;
    throw err;
  }
}

async function capexSequence(runner: QueryRunner, tenantId: string): Promise<number | null> {
  const [row] = await runner.query(`SELECT next_val FROM item_sequences WHERE tenant_id = $1 AND entity_type = 'capex'`, [tenantId]);
  return row ? Number(row.next_val) : null;
}

async function searchTypes(runner: QueryRunner, tenantId: string, id: string): Promise<string[]> {
  return (await runner.query(`SELECT entity_type FROM search_index WHERE tenant_id = $1 AND entity_id = $2 ORDER BY 1`, [tenantId, id]))
    .map((row: { entity_type: string }) => row.entity_type);
}

/** The chargeback total of the year, on OPEX (the report's default scope) or another scope. */
async function chargebackTotal(runner: QueryRunner, tenantId: string, year: number, scope?: ChargebackScope): Promise<number> {
  const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
  const chargeback = new ChargebackReportService({ manager: runner.manager } as any, deps.allocationCalculator as any, deps.fxRates as any);
  const report: any = await chargeback.generateGlobal(year, 'budget', tenantId, { manager: runner.manager, scope });
  return (report.companies as Array<{ amount: number }>).reduce((sum, row) => sum + row.amount, 0);
}

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner);
  const w = await seedTypeChangeWorld(runner, tenantId);
  const member = await seedRoleUser(runner, tenantId, 'member', { budget: 'member', tasks: 'member' });
  const reader = await seedRoleUser(runner, tenantId, 'reader', { budget: 'reader', tasks: 'member' });
  const line = await seedTypeChangeLine(runner, w, {
    itemNumber: NUMBER,
    values: { [w.sharedAxis.id]: w.sharedAxis.opexOnly, [w.opexAxis.id]: w.opexAxis.first },
  });
  const ctx: Ctx = { manager: runner.manager, tenantId, userId: member };
  return { w, member, reader, line, ctx };
}

async function testRoundTrip() {
  await inRolledBackTransaction(async (runner) => {
    const { w, member, line, ctx } = await seed(runner);
    const c = controllers(runner);
    const tenantId = w.tenantId;
    const children = await lineChildren(runner, tenantId, line.id);
    const totals = await versionTotals(runner, tenantId, line.id);
    const before = (await storedLine(runner, tenantId, line.id))!;
    assert.equal(await chargebackTotal(runner, tenantId, 2026), 1200, 'the OPEX line is charged back');
    assert.equal(await chargebackTotal(runner, tenantId, 2026, 'capex'), 0, 'not on CAPEX');
    assert.equal(await chargebackTotal(runner, tenantId, 2026, 'all'), 1200, 'and on both natures');

    // The dialog's read: in place from the first year, nothing frozen, what to ask, what moves.
    const check = await c.opex.changeTypeCheck(`OPX-${NUMBER}`, undefined, ctx);
    assert.deepEqual(
      [check.mode, check.from_nature, check.to_nature, check.first_year, check.last_year, check.years, check.from_year, check.blockers, check.row_version],
      ['in_place', 'opex', 'capex', 2025, 2027, [2025, 2026, 2027], 2025, [], Number(before.row_version)],
      'the check of an OPEX line',
    );
    assert.deepEqual(check.account, { id: w.accounts.opex, account_number: 6100, account_name: 'Account 6100', fits: false, carried: false }, 'its OPEX account does not fit');
    assert.deepEqual(
      check.dimensions.map((d: any) => [d.axis_id, d.reason, d.required, d.current?.id ?? null]),
      [[w.requiredAxis.id, 'required', false, null], [w.sharedAxis.id, 'value_other_type', false, w.sharedAxis.opexOnly]],
      'the required CAPEX dimension and the OPEX-only value are asked, neither is required in place',
    );
    assert.deepEqual(check.carried, {
      versions: 3, tasks: 1, attachments: 1, links: 1, contacts: 1, applications: 1, assets: 1, contracts: 1, projects: 1, requests: 1, technologies: 1,
    }, 'everything stays with the line');
    assert.equal(check.successor, null);

    // OPEX to CAPEX in place, with a reason; nothing else given.
    const sequence = await capexSequence(runner, tenantId);
    const result = await c.opex.changeType(line.id, { row_version: check.row_version, reason: 'Bought outright' }, ctx);
    assert.deepEqual(result, { id: line.id, reference: `BL-${NUMBER}`, nature: 'capex' }, 'the same line, now CAPEX');
    const changed = (await storedLine(runner, tenantId, line.id))!;
    const cpx = Number(String(changed.legacy_number).replace('CPX-', ''));
    assert.equal(changed.legacy_number, `CPX-${sequence ?? 1}`, 'a CPX number from the capex sequence');
    assert.equal(await capexSequence(runner, tenantId), (sequence ?? 1) + 1, 'one number taken');
    assert.deepEqual([changed.nature, changed.item_number, changed.account_id], ['capex', NUMBER, w.accounts.opex], 'same BL number, the account kept');
    assert.equal(Number(changed.row_version), Number(before.row_version) + 1, 'one more row_version');
    const tasksAfter = children.tasks.map((task: string) => task.replace(':spend_item', ':capex_item'));
    assert.deepEqual(await lineChildren(runner, tenantId, line.id), { ...children, tasks: tasksAfter }, 'every child kept, the task of the CAPEX type');
    assert.deepEqual(await versionTotals(runner, tenantId, line.id), totals, 'the totals of each version unchanged');
    assert.deepEqual(await searchTypes(runner, tenantId, line.id), ['capex_items'], 'a CAPEX search entry, no OPEX one');

    // Its audit row: the CAPEX label, a new row_version, the reason; the line's meta names the member.
    const [row] = await changeAuditRows(runner, tenantId, line.id);
    assert.equal(row.table_name, 'capex_items');
    assert.equal(row.user_id, member);
    assert.deepEqual(
      [row.after_json.from_nature, row.after_json.to_nature, row.after_json.from_year, row.after_json.reason, row.after_json.from_reference, row.after_json.to_reference],
      ['opex', 'capex', 2025, 'Bought outright', `OPX-${NUMBER}`, `CPX-${cpx}`],
    );
    assert.equal(Number(row.after_json.row_version), Number(changed.row_version), 'the row records the line\'s row_version');
    assert.notEqual(Number(row.before_json.row_version), Number(row.after_json.row_version));
    assert.equal(row.before_json.item_number, NUMBER, 'before, the BL number (no CPX number yet)');
    assert.equal(row.after_json.item_number, cpx, 'after, its CPX number, as the CAPEX audit rows show it');
    const meta = await readBudgetLineMeta(runner.manager, 'capex', tenantId, line.id);
    assert.equal(meta?.changed_by?.id, member, 'the CAPEX workspace says who changed the line');

    // The routes and lists of each nature.
    assert.equal((await statusOf(runner, () => c.opex.get(line.id, ctx))).status, 404, 'the OPEX route no longer finds it');
    const presented = await c.capex.get(line.id, ctx);
    assert.deepEqual([presented.item_number, presented.reference, presented.description], [cpx, `BL-${NUMBER}`, `Line ${NUMBER}`], 'the CAPEX contract');
    for (const ref of [`CPX-${presented.item_number}`, `BL-${NUMBER}`, String(cpx)]) {
      assert.equal((await c.capex.get(ref, ctx)).id, line.id, `the CAPEX route finds it by ${ref}`);
    }
    assert.deepEqual((await c.opexSvc.list({ includeDisabled: 'true' }, { manager: runner.manager })).items.map((i: any) => i.id), [], 'not in the OPEX list');
    assert.deepEqual((await c.capexSvc.list({ includeDisabled: 'true' }, { manager: runner.manager })).items.map((i: any) => i.id), [line.id], 'in the CAPEX list');
    const capexTasks = await c.capexTasks.list(line.id, { queryRunner: runner });
    assert.deepEqual(capexTasks.map((t: any) => t.id), [line.taskId], 'the task shows on the CAPEX line');
    assert.equal(await chargebackTotal(runner, tenantId, 2026), 0, 'the CAPEX line leaves the OPEX chargeback');
    assert.equal(await chargebackTotal(runner, tenantId, 2026, 'capex'), 1200, 'it is charged back on CAPEX');
    assert.equal(await chargebackTotal(runner, tenantId, 2026, 'all'), 1200, 'and stays in the chargeback of both natures');

    // Back to OPEX: the CPX number stays (old files and links), no number taken.
    const back = await c.capex.changeType(`CPX-${cpx}`, { row_version: changed.row_version }, ctx);
    assert.deepEqual(back, { id: line.id, reference: `BL-${NUMBER}`, nature: 'opex' });
    const opexAgain = (await storedLine(runner, tenantId, line.id))!;
    assert.deepEqual([opexAgain.nature, opexAgain.legacy_number], ['opex', `CPX-${cpx}`], 'OPEX again, its CPX number kept');
    assert.equal((await c.opex.get(`OPX-${NUMBER}`, ctx)).id, line.id, 'the OPEX route finds it by OPX-n again');
    assert.deepEqual(await lineChildren(runner, tenantId, line.id), children, 'its children, its task of the OPEX type');
    assert.deepEqual(await searchTypes(runner, tenantId, line.id), ['spend_items']);
    assert.equal(await chargebackTotal(runner, tenantId, 2026), 1200, 'charged back again');
    const [, backRow] = await changeAuditRows(runner, tenantId, line.id);
    assert.equal(backRow.table_name, 'spend_items', 'the row of the change back has the OPEX label');

    // CAPEX once more: the same CPX number, still none taken.
    await c.opex.changeType(line.id, { row_version: opexAgain.row_version }, ctx);
    assert.equal((await storedLine(runner, tenantId, line.id))!.legacy_number, `CPX-${cpx}`, 'its CPX number reused');
    assert.equal(await capexSequence(runner, tenantId), (sequence ?? 1) + 1, 'no number taken');
  });
}

async function testRules() {
  await inRolledBackTransaction(async (runner) => {
    const { w, member, reader, line, ctx } = await seed(runner);
    const c = controllers(runner);
    const tenantId = w.tenantId;
    const rv = async () => Number((await storedLine(runner, tenantId, line.id))!.row_version);

    // The level: a budget member, as a line's creation and update; a reader is refused.
    for (const [controller, handler, method] of [[SpendItemsController, 'changeType', 'POST'], [CapexItemsController, 'changeType', 'POST'], [SpendItemsController, 'changeTypeCheck', 'GET']] as const) {
      assert.equal(await guardAllows(runner, tenantId, member, controller, handler, method), true, `${controller.name}.${handler}: a member passes`);
      assert.equal(await guardAllows(runner, tenantId, reader, controller, handler, method), false, `${controller.name}.${handler}: a reader is refused`);
    }

    // The body: a row_version, a year of the line.
    const noVersion = await statusOf(runner, () => c.opex.changeType(line.id, {}, ctx));
    assert.equal(noVersion.status, 400, 'row_version is required');
    const stale = await statusOf(runner, async () => c.opex.changeType(line.id, { row_version: (await rv()) - 1 }, ctx));
    assert.deepEqual([stale.status, stale.body.code, stale.body.row_version], [409, 'edit_conflict', await rv()], 'a line changed since the dialog read it');
    for (const year of [2024, 2028, 'next']) {
      const refused = await statusOf(runner, async () => c.opex.changeType(line.id, { row_version: await rv(), from_year: year }, ctx));
      assert.equal(refused.status, 400, `${year} is not a year the line offers (${JSON.stringify(refused.body)})`);
    }
    assert.equal((await statusOf(runner, () => c.opex.changeTypeCheck(line.id, '2031', ctx))).status, 400, 'the check refuses it too');

    // A frozen column with an amount, of either type, in a year that changes: 409, nothing written.
    await freezeColumn(runner as any, 'capex', tenantId, 2026, 'forecast');
    const zero = await c.opex.changeTypeCheck(line.id, undefined, ctx);
    assert.deepEqual(zero.blockers, [], 'a frozen column where the line holds nothing does not count');
    await freezeColumn(runner as any, 'opex', tenantId, 2026, 'budget');
    await freezeColumn(runner as any, 'capex', tenantId, 2027, 'actual');
    const frozen = await c.opex.changeTypeCheck(line.id, undefined, ctx);
    assert.deepEqual(
      frozen.blockers.map((b: any) => `${b.year} ${b.column} ${b.nature}`),
      ['2026 budget opex', '2027 actual capex'],
      'the frozen columns of both types',
    );
    const refused = await statusOf(runner, async () => c.opex.changeType(line.id, { row_version: await rv() }, ctx));
    assert.equal(refused.status, 409);
    assert.equal(refused.body.code, 'budget_frozen');
    assert.match(refused.body.message, /amounts in Budget 2026, a frozen OPEX column/);
    assert.equal((await storedLine(runner, tenantId, line.id))!.nature, 'opex', 'nothing written');
    await runner.query(`DELETE FROM freeze_states WHERE tenant_id = $1`, [tenantId]);

    // An account given must suit CAPEX lines; a value given must apply to them.
    const otherOpex = await statusOf(runner, async () => c.opex.changeType(line.id, { row_version: await rv(), account_id: w.accounts.opex2 }, ctx));
    assert.deepEqual([otherOpex.status, otherOpex.body.message], [400, accountNatureRefusal('capex')], 'an OPEX account chosen is refused');
    const opexValue = await statusOf(runner, async () => c.opex.changeType(line.id, { row_version: await rv(), analytics_values: { [w.sharedAxis.id]: w.sharedAxis.opexOnly2 } }, ctx));
    assert.deepEqual([opexValue.status, opexValue.body.message], [400, notApplicableValueMessage({ name: 'Support', applies_to: 'opex' }, 'capex')], 'an OPEX-only value chosen is refused');
    const opexDimension = await statusOf(runner, async () => c.opex.changeType(line.id, { row_version: await rv(), analytics_values: { [w.opexAxis.id]: w.opexAxis.second } }, ctx));
    assert.deepEqual([opexDimension.status, opexDimension.body.message], [400, notApplicableDimensionMessage({ name: 'Recurrence', applies_to: 'opex' })], 'an OPEX-only dimension is refused');
    assert.equal((await storedLine(runner, tenantId, line.id))!.nature, 'opex', 'nothing written by a refusal');

    // A CAPEX account and a CAPEX value given: written. The OPEX-only value it keeps stays (it is the
    // line's own, as on any edit); the missing required dimension is tolerated in place.
    const done = await statusOf(runner, async () => c.opex.changeType(line.id, {
      row_version: await rv(), account_id: w.accounts.capex, analytics_values: { [w.sharedAxis.id]: w.sharedAxis.opexOnly },
    }, ctx));
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const after = (await storedLine(runner, tenantId, line.id))!;
    assert.deepEqual([after.nature, after.account_id], ['capex', w.accounts.capex], 'CAPEX, with the account chosen');
    const values = (await lineChildren(runner, tenantId, line.id)).values;
    assert.deepEqual(values, [`${w.opexAxis.id}:${w.opexAxis.first}`, `${w.sharedAxis.id}:${w.sharedAxis.opexOnly}`].sort(), 'the values kept, none added');
    const [row] = await changeAuditRows(runner, tenantId, line.id);
    assert.equal(row.before_json.account_id, w.accounts.opex);
    assert.equal(row.after_json.account_id, w.accounts.capex, 'the audit row shows the account change');

    // Back to OPEX with a value of the required CAPEX dimension given: refused, it does not apply to OPEX lines.
    const capexDimension = await statusOf(runner, async () => c.capex.changeType(line.id, { row_version: await rv(), analytics_values: { [w.requiredAxis.id]: w.requiredAxis.first } }, ctx));
    assert.deepEqual([capexDimension.status, capexDimension.body.message], [400, notApplicableDimensionMessage({ name: 'Investment kind', applies_to: 'capex' })]);

    // A line of the other nature is not found on a route.
    assert.equal((await statusOf(runner, async () => c.opex.changeType(line.id, { row_version: await rv() }, ctx))).status, 404, 'the OPEX route 404s for the CAPEX line');
    assert.equal((await statusOf(runner, () => c.opex.changeTypeCheck(line.id, undefined, ctx))).status, 404);
  });
}

async function testLineWithoutBudget() {
  await inRolledBackTransaction(async (runner) => {
    const { w, ctx } = await seed(runner);
    const c = controllers(runner);
    const bare = await seedTypeChangeLine(runner, w, { itemNumber: NUMBER + 1, years: [] });
    const check = await c.opex.changeTypeCheck(bare.id, undefined, ctx);
    assert.deepEqual([check.mode, check.first_year, check.years, check.dated_refusal], ['in_place', null, [], null], 'a line without a version: in place only');
    const dated = await statusOf(runner, () => c.opex.changeType(bare.id, { row_version: check.row_version, from_year: 2026 }, ctx));
    assert.equal(dated.status, 400);
    const done = await c.opex.changeType(bare.id, { row_version: check.row_version, from_year: null }, ctx);
    assert.equal(done.nature, 'capex');
  });
}

async function testBudgetFile() {
  await inRolledBackTransaction(async (runner) => {
    const { w, line, ctx } = await seed(runner);
    const c = controllers(runner);
    const tenantId = w.tenantId;
    const check = await c.opex.changeTypeCheck(line.id, undefined, ctx);
    await c.opex.changeType(line.id, { row_version: check.row_version }, ctx);
    const name = `Line ${NUMBER}`;
    const header = 'nature,item_number,name\n';
    const same = await preflightBudgetFile(runner.manager, 'capex', tenantId, `${header}capex,BL-${NUMBER},${name}\n`);
    assert.deepEqual([same.ok, same.changes.unchanged], [true, 1], `BL-${NUMBER} names the line in its new type (${JSON.stringify(same.errors)})`);
    const old = await preflightBudgetFile(runner.manager, 'opex', tenantId, `${header}opex,BL-${NUMBER},${name}\n`);
    assert.deepEqual(old.errors.map((e: any) => e.message), [natureChangeMessage(`BL-${NUMBER}`, 'capex', 'opex')], 'a file of before says the type changed');
    const opxFile = await preflightBudgetFile(runner.manager, 'opex', tenantId, `item_number,name\nOPX-${NUMBER},${name}\n`);
    assert.equal(opxFile.ok, false, 'OPX-n no longer names a line that became CAPEX (a risk accepted, BL-n does)');
  });
}

runSpecs('budget-line-type-change.integration.spec', [
  ['in place: OPEX to CAPEX and back, everything kept, numbers, tasks, search, routes, lists, chargeback, audit', testRoundTrip],
  ['in place: level, body, freezes of both types, account and dimensions', testRules],
  ['in place: a line without a budget', testLineWithoutBudget],
  ['a budget file names the line by its BL number in its new type', testBudgetFile],
]);
