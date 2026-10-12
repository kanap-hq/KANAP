import 'dotenv/config';
import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { EDIT_CONFLICT_CODE } from '../../common/edit-conflicts';
import { BUDGET_CONFLICT_MESSAGE, BudgetEditConflictException } from '../budget-edit-conflicts';
import {
  AUDIT_LABELS,
  amountsService,
  assert,
  budgetOperations,
  captureAudit,
  FRANCE_218_2026,
  freezeColumn,
  inRolledBackTransaction,
  Kind,
  Measure,
  period,
  readLines,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedCalendar,
  seedLine,
  seedTenant,
  underSavepoint,
} from './round-inputs.fixtures';
import { exportBudgetFile, loadBudgetFile, withCell } from './budget-file.fixtures';

// The writes behind the redesigned budget tab (plan budget-tab-redesign, lot
// B), through `bulk-upsert` on OPEX and CAPEX:
// - B1, at a date: a yearly total over a period of one day goes whole to the
//   month of that date (the rule of the lines bought once on one date), and
//   a budget file keeps it there;
// - B2, `kind: 'restore'`: one column back to the months and the record the
//   screen read when the line was opened, written as sent, refused when
//   frozen or changed by someone else since (409, the body of every budget
//   conflict), refused when the record does not hold together, audited as
//   `restored`;
// - B3, `kind: 'copy'`: "Start from" another column of the same line and
//   year, with a percentage: the result of the Budget operations column copy
//   restricted to the line, by the lines when the source follows them, the
//   reference lines travelling with it.

const YEAR = 2026;
const KINDS: Kind[] = ['opex', 'capex'];
const realAudit = () => new AuditService(undefined as any);

type Ctx = { runner: QueryRunner; tenantId: string; itemId: string; versionId: string; calendarId: string };

async function withLine(kind: Kind, fn: (ctx: Ctx) => Promise<void>, values: Parameters<typeof seedLine>[4] = {}) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-tab`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'FR218', name: 'France 218', days_by_year: { [YEAR]: FRANCE_218_2026 } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, values);
    await fn({ runner, tenantId, itemId, versionId, calendarId });
  });
}

/** A person of the tenant, so a conflict can name who changed the column. */
async function seedPerson(runner: QueryRunner, tenantId: string, first: string, last: string): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Budget tab writes role', false, false, now(), now()) RETURNING id`,
    [tenantId, `Budget tab role ${first}`],
  );
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, $4, $5, 'enabled') RETURNING id`,
    [tenantId, role.id, `${first.toLowerCase()}.${last.toLowerCase()}@budget-tab.example`, first, last],
  );
  return user.id;
}

/** A consultant on France 218, February to October, 400 a day: 64 000 over the year. */
function consultant(calendarId: string, overrides: Record<string, unknown> = {}) {
  return {
    label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '400', price_basis: 'per_day', frequency: 'per_month',
    days_per_month: null, period_start: `${YEAR}-02-01`, period_end: `${YEAR}-10-30`, working_day_profile_id: calendarId, ...overrides,
  };
}

/** Ten licences at 200 a piece each month, over the year: 2 000 a month. */
function licences(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '200', price_basis: 'per_piece', frequency: 'per_month',
    days_per_month: null, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, working_day_profile_id: null, ...overrides,
  };
}

const CONSULTANT_MONTHS = ['0.00', '7200.00', '8000.00', '8000.00', '6000.00', '8000.00', '6000.00', '6400.00', '8000.00', '7600.00', '0.00', '0.00'];

/** The column as the budget tab reads it (`GET …/amounts`): its twelve months and its record, through JSON. */
async function screenRead(kind: Kind, runner: QueryRunner, versionId: string, measure: Measure) {
  const read = JSON.parse(JSON.stringify(await amountsService(kind).listByYear(versionId, YEAR, { manager: runner.manager })));
  const months = Array.from({ length: 12 }, (_, i) => {
    const row = read.items.find((r: any) => String(r.period).slice(0, 10) === period(i + 1, YEAR));
    return row ? String(row[measure]) : '0';
  });
  const record = read.round_inputs.find((r: any) => r.measure === measure) ?? null;
  return { months, record };
}

/** A record as compared after a restore: what the column says, without who wrote it, when, or the lines' row ids. */
function comparable(record: any) {
  if (!record) return null;
  const { updated_at: _at, updated_by: _by, lines, ...rest } = record;
  return { ...rest, lines: lines.map(({ id: _id, ...line }: any) => line) };
}

function restoreBody(measure: Measure, opening: { months: string[]; record: unknown }, base: string[], extra: Record<string, unknown> = {}) {
  return { kind: 'restore', year: YEAR, measure, months: opening.months, record: opening.record, base: { columns: { [measure]: { months: base } } }, ...extra };
}

const write = (kind: Kind, runner: QueryRunner, versionId: string, body: Record<string, unknown>, audit: unknown = captureAudit(), userId: string | null = null, freeze?: unknown) =>
  amountsService(kind, audit, freeze).bulkUpsert(versionId, body, userId, { manager: runner.manager });

/* ── B1. At a date ─────────────────────────────────────────────────────────── */

/** 3 March: the whole total in March; the record keeps the date, flat; `also_measures` follows the date. */
async function testAnnualAtADate(kind: Kind) {
  await withLine(kind, async ({ runner, versionId }) => {
    const date = `${YEAR}-03-03`;
    const response = await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: '1234.56' }, period_start: date, period_end: date });
    assert.equal(response.updated, 12, `${kind}: twelve months written`);
    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'planned', YEAR),
      ['0.00', '0.00', '1234.56', ...repeat('0.00', 9)],
      `${kind}: everything in March`,
    );
    const { planned } = await readRecords(runner, kind, versionId);
    assert.deepEqual(
      [planned.method, planned.period_start, planned.period_end, planned.spread_profile_name],
      ['spread', date, date, 'flat'],
      `${kind}: the record keeps the date, flat`,
    );
    assert.deepEqual(planned.last_calculation, { kind: 'annual', total: '1234.56', profile: 'flat', active_months: [3], weights: ['1'] });

    // The same distribution for another column, from its stored total.
    await write(kind, runner, versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), committed: 100 }, { period: period(12, YEAR), committed: 50 }] });
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1000 }, also_measures: ['committed'], period_start: `${YEAR}-11-28`, period_end: `${YEAR}-11-28` });
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'committed', YEAR), [...repeat('0.00', 10), '150.00', '0.00'], `${kind}: 150 in November`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), [...repeat('0.00', 10), '1000.00', '0.00']);

    // Two days without a 15th still count no month.
    await assert.rejects(
      () => write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1 }, period_start: `${YEAR}-03-03`, period_end: `${YEAR}-03-04` }),
      (err: any) => err instanceof BadRequestException && /No month of the period counts/.test(err.message),
      `${kind}: the 15th rule for real periods`,
    );
  });
}

/** A budget file's new yearly total for a column at a date goes to that month too (flat load path). */
async function testBudgetFileKeepsTheDate(kind: Kind) {
  await withLine(kind, async ({ runner, tenantId, itemId, versionId }) => {
    const date = `${YEAR}-06-03`;
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1000 }, period_start: date, period_end: date });
    const content = await exportBudgetFile(runner.manager, kind, tenantId, [itemId], { amountYears: String(YEAR), columns: 'budget' });
    await loadBudgetFile(runner.manager, kind, tenantId, withCell(content, `budget_${YEAR}`, '4000'));
    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'planned', YEAR),
      [...repeat('0.00', 5), '4000.00', ...repeat('0.00', 6)],
      `${kind}: the new total in June`,
    );
    const { planned } = await readRecords(runner, kind, versionId);
    assert.deepEqual([planned.period_start, planned.period_end, planned.last_calculation.active_months], [date, date, [6]], `${kind}: the date kept`);
  });
}

/* ── B2. Restore ───────────────────────────────────────────────────────────── */

/**
 * Opening: Budget follows its lines, Revision holds an amount with lines kept
 * as a reference. The user spreads an amount over Budget and uses the lines
 * again on Revision; restoring each column gives back the months, the record
 * and the lines read at the opening, nothing computed again, audited
 * `restored`.
 */
async function testRestoreLinesColumns(kind: Kind) {
  await withLine(kind, async ({ runner, versionId, calendarId }) => {
    const lines = [consultant(calendarId), licences()];
    await write(kind, runner, versionId, { kind: 'lines', year: YEAR, measure: 'planned', also_measures: ['committed'], lines });
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { committed: 50000 }, period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31` });
    const planned = await screenRead(kind, runner, versionId, 'planned');
    const committed = await screenRead(kind, runner, versionId, 'committed');
    assert.equal(planned.record.method, 'computed', 'harness: Budget follows its lines');
    assert.deepEqual([committed.record.method, committed.record.lines.length, !!committed.record.last_calculation.lines_result], ['spread', 2, true], 'harness: Revision keeps reference lines');

    // The user's edits during the visit.
    const typed = await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } });
    const relined = await write(kind, runner, versionId, { kind: 'lines', year: YEAR, measure: 'committed', lines: [licences({ quantity: '3' })] });
    const now = (response: any, measure: Measure) => Array.from({ length: 12 }, (_, i) => response.items.find((r: any) => r.period === period(i + 1, YEAR))[measure]);

    const audit = captureAudit();
    const answer = await write(kind, runner, versionId, restoreBody('planned', planned, now(typed, 'planned')), audit);
    assert.deepEqual(Object.keys(answer).sort(), ['budget_rev', 'items', 'round_inputs', 'updated'], `${kind}: the answer of every write`);
    assert.equal(answer.updated, 12);
    await write(kind, runner, versionId, restoreBody('committed', committed, now(relined, 'committed')), audit);

    for (const [measure, opening] of [['planned', planned], ['committed', committed]] as const) {
      const after = await screenRead(kind, runner, versionId, measure);
      assert.deepEqual(after.months, opening.months, `${kind} ${measure}: the months of the opening`);
      assert.deepEqual(comparable(after.record), comparable(opening.record), `${kind} ${measure}: the record of the opening, lines included`);
    }
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), CONSULTANT_MONTHS.map((m) => (Number(m) + 2000).toFixed(2)));
    assert.deepEqual(
      (await readLines(runner, kind, versionId, 'committed')).map((l) => [l.label, l.quantity, l.unit_price]),
      [['Consultant', '1.000', '400.0000'], ['Licences', '10.000', '200.0000']],
      `${kind}: the reference lines are back`,
    );

    // One amounts row and one record row per column, both `restored`, in the format of every write.
    const amountRows = audit.entries.filter((e) => e.table === AUDIT_LABELS[kind].amounts);
    const recordRows = audit.entries.filter((e) => e.table === AUDIT_LABELS[kind].rounds);
    assert.deepEqual(amountRows.map((e) => [e.action, e.recordId]), [['restored', versionId], ['restored', versionId]], `${kind}: the months by the version`);
    assert.ok(amountRows.every((e) => Array.isArray(e.before) && Array.isArray(e.after) && e.after.length === 12), `${kind}: month rows before and after`);
    assert.deepEqual(recordRows.map((e) => [e.action, e.after.measure]), [['restored', 'planned'], ['restored', 'committed']], `${kind}: the records`);
    assert.equal(audit.entries.length, 4, `${kind}: nothing else`);

    // The same restore again changes nothing and writes nothing.
    const again = captureAudit();
    const same = await write(kind, runner, versionId, restoreBody('planned', planned, planned.months), again);
    assert.deepEqual([same.updated, again.entries.length], [0, 0], `${kind}: a no-op`);
  });
}

/**
 * Opening: Forecast entered month by month, Landing empty. The user spreads a
 * total over Forecast and fills Landing; restoring puts Forecast's months and
 * manual record back and empties Landing, its record deleted.
 */
async function testRestoreMonthlyAndEmptyColumns(kind: Kind) {
  await withLine(kind, async ({ runner, versionId }) => {
    await write(kind, runner, versionId, {
      kind: 'monthly', year: YEAR, months: [{ period: period(2, YEAR), forecast: '10.01' }, { period: period(9, YEAR), forecast: -3 }],
    });
    const forecast = await screenRead(kind, runner, versionId, 'forecast');
    const landing = await screenRead(kind, runner, versionId, 'expected_landing');
    assert.deepEqual([forecast.record.method, landing.record], ['manual', null], 'harness: monthly and empty');

    const spread = await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { forecast: 999, expected_landing: 120 } });
    const now = (measure: Measure) => Array.from({ length: 12 }, (_, i) => spread.items[i][measure]);
    const audit = captureAudit();
    await write(kind, runner, versionId, restoreBody('forecast', forecast, now('forecast')), audit);
    await write(kind, runner, versionId, restoreBody('expected_landing', landing, now('expected_landing')), audit);

    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'forecast', YEAR),
      ['0.00', '10.01', ...repeat('0.00', 6), '-3.00', ...repeat('0.00', 3)],
      `${kind}: Forecast's months`,
    );
    assert.deepEqual(comparable((await screenRead(kind, runner, versionId, 'forecast')).record), comparable(forecast.record), `${kind}: manual again`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'expected_landing', YEAR), repeat('0.00', 12), `${kind}: Landing empty`);
    const records = await readRecords(runner, kind, versionId);
    assert.equal(records.expected_landing, undefined, `${kind}: Landing has no record`);
    const deleted = audit.entries.find((e) => e.table === AUDIT_LABELS[kind].rounds && e.after === null);
    assert.deepEqual([deleted?.action, deleted?.before?.measure], ['restored', 'expected_landing'], `${kind}: the record's removal is audited`);
  });
}

/**
 * Two columns to restore; a colleague changed one of them meanwhile. That
 * column is refused with the 409 of every budget conflict and stays as the
 * colleague left it; the other one is restored.
 */
async function testRestoreConflictOnOneColumn(kind: Kind) {
  await withLine(kind, async ({ runner, tenantId, versionId }) => {
    const claire = await seedPerson(runner, tenantId, 'Claire', 'Dubois');
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200, committed: 2400 } });
    const planned = await screenRead(kind, runner, versionId, 'planned');
    const committed = await screenRead(kind, runner, versionId, 'committed');
    const mine = await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 600, committed: 3600 } }, realAudit());
    const known = (measure: Measure) => Array.from({ length: 12 }, (_, i) => mine.items[i][measure]);

    // Claire raises Revision in May, after the user's last save.
    await write(kind, runner, versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(5, YEAR), committed: 999 }] }, realAudit(), claire);

    await write(kind, runner, versionId, restoreBody('planned', planned, known('planned')), realAudit());
    let conflict: any;
    await assert.rejects(
      () => underSavepoint(runner, () => write(kind, runner, versionId, restoreBody('committed', committed, known('committed')), realAudit())),
      (err: any) => {
        conflict = err;
        return err instanceof BudgetEditConflictException;
      },
      `${kind}: Revision refused`,
    );
    const body = conflict.getResponse();
    assert.deepEqual(
      [body.statusCode, body.code, body.message, typeof body.budget_rev],
      [409, EDIT_CONFLICT_CODE, BUDGET_CONFLICT_MESSAGE, 'number'],
      `${kind}: the 409 of every budget conflict`,
    );
    assert.equal(body.conflicts.length, 1);
    const [entry] = body.conflicts;
    assert.deepEqual(
      [entry.field, entry.periods, entry.base, entry.current[4], entry.mine, entry.changed_by?.name],
      ['committed', [period(5, YEAR)], repeat('300.00', 12), '999.00', repeat('200.00', 12), 'Claire Dubois'],
      `${kind}: May moved, Claire changed it, mine is the opening`,
    );
    assert.deepEqual(Object.keys(entry).sort(), ['base', 'changed_at', 'changed_by', 'current', 'field', 'labels', 'mine', 'periods']);

    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('100.00', 12), `${kind}: Budget restored`);
    const revision = await readMeasure(runner, kind, versionId, 'committed', YEAR);
    assert.deepEqual([revision[0], revision[4]], ['300.00', '999.00'], `${kind}: Revision as Claire left it`);

    // « Overwrite »: the column the 409 answered as the base.
    await write(kind, runner, versionId, restoreBody('committed', committed, entry.current), realAudit());
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'committed', YEAR), repeat('200.00', 12), `${kind}: restored once the user chose`);
  });
}

/** A column frozen since the opening is refused (403), nothing written; a restore needs a base. */
async function testRestoreFrozenColumn(kind: Kind) {
  await withLine(kind, async ({ runner, tenantId, versionId }) => {
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { forecast: 1200, actual: 120 } });
    const forecast = await screenRead(kind, runner, versionId, 'forecast');
    const actual = await screenRead(kind, runner, versionId, 'actual');
    const changed = await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { forecast: 2400, actual: 240 } });
    const known = (measure: Measure) => Array.from({ length: 12 }, (_, i) => changed.items[i][measure]);
    await freezeColumn(runner, kind, tenantId, YEAR, 'forecast');

    const audit = captureAudit();
    await assert.rejects(
      () => underSavepoint(runner, () => write(kind, runner, versionId, restoreBody('forecast', forecast, known('forecast')), audit, null, realFreeze())),
      (err: any) => err instanceof ForbiddenException && /for 2026 is frozen/.test(err.message),
      `${kind}: the frozen column is refused`,
    );
    assert.deepEqual([audit.entries.length, (await readMeasure(runner, kind, versionId, 'forecast', YEAR))[0]], [0, '200.00'], `${kind}: nothing written`);
    await write(kind, runner, versionId, restoreBody('actual', actual, known('actual')), audit, null, realFreeze());
    assert.equal((await readMeasure(runner, kind, versionId, 'actual', YEAR))[0], '10.00', `${kind}: the other column is restored`);

    await assert.rejects(
      () => write(kind, runner, versionId, { ...restoreBody('actual', actual, known('actual')), base: undefined }),
      (err: any) => err instanceof BadRequestException && err.message.startsWith('A restore needs the base of its column'),
      `${kind}: no base, no restore`,
    );
  });
}

/** Records that do not hold together are refused (400) before anything is written. */
async function testRestoreRefusals(kind: Kind) {
  await withLine(kind, async ({ runner, versionId }) => {
    await write(kind, runner, versionId, { kind: 'lines', year: YEAR, measure: 'planned', lines: [licences()] });
    const opening = await screenRead(kind, runner, versionId, 'planned');
    const base = opening.months;
    const refused = async (label: string, body: Record<string, unknown>, pattern: RegExp) => {
      await assert.rejects(
        () => underSavepoint(runner, () => write(kind, runner, versionId, body)),
        (err: any) => err instanceof BadRequestException && pattern.test(err.message),
        `${kind}: ${label}`,
      );
    };
    const record = opening.record;
    const spreadRecord = { ...record, method: 'spread', last_calculation: { kind: 'annual', total: '24000.00', profile: 'flat', active_months: [1], weights: ['1'] } };
    await refused('no record key', { kind: 'restore', year: YEAR, measure: 'planned', months: base, base: { columns: { planned: { months: base } } } }, /^record must be/);
    await refused('eleven months', restoreBody('planned', { months: base.slice(1), record }, base), /twelve months/);
    await refused('a month that is not a number', restoreBody('planned', { months: ['x', ...base.slice(1)], record }, base), /^Month 1 must be a number/);
    await refused('unknown column', { ...restoreBody('planned', opening, base), measure: 'budget' }, /Unknown amount 'budget'/);
    await refused('the record of another column', restoreBody('planned', { months: base, record: { ...record, measure: 'forecast' } }, base), /record of forecast, not of planned/);
    await refused('unknown method', restoreBody('planned', { months: base, record: { ...record, method: 'typed' } }, base), /Unknown method 'typed'/);
    await refused('period outside the year', restoreBody('planned', { months: base, record: { ...record, period_start: `${YEAR - 1}-12-01` } }, base), /within 2026/);
    await refused('computed without lines', restoreBody('planned', { months: base, record: { ...record, lines: [], fte: null } }, base), /computed record needs the lines/);
    await refused('computed with a spread calculation', restoreBody('planned', { months: base, record: { ...record, last_calculation: spreadRecord.last_calculation } }, base), /computed record needs a calculation of kind computed/);
    await refused('spread without calculation', restoreBody('planned', { months: base, record: { ...record, method: 'spread', last_calculation: null } }, base), /spread record needs a calculation of kind annual or quarterly/);
    await refused('months against the total', restoreBody('planned', { months: repeat('1000', 12), record }, base), /The months add up to 12000\.00, but the record's calculation gives 24000\.00/);
    await refused('months against the spread total', restoreBody('planned', { months: base, record: { ...spreadRecord, last_calculation: { ...spreadRecord.last_calculation, total: '1.00' } } }, base), /gives 1\.00/);
    await refused('lines without FTE', restoreBody('planned', { months: base, record: { ...record, fte: null } }, base), /lines needs their FTE/);
    await refused('FTE without lines', restoreBody('planned', { months: base, record: { ...record, method: 'manual', lines: [] } }, base), /without lines has no FTE/);
    await refused('a negative FTE', restoreBody('planned', { months: base, record: { ...record, fte: '-1' } }, base), /FTE of the record cannot be below 0/);
    await refused('a line that is not one', restoreBody('planned', { months: base, record: { ...record, lines: [{ ...licences(), quantity_unit: 'weeks' }] } }, base), /^Line 1: unknown unit 'weeks'/);
    await refused('a calendar not found', restoreBody('planned', { months: base, record: { ...record, method: 'manual', lines: [consultant('00000000-0000-4000-8000-000000000000')] } }, base), /^Line 1: the calendar was not found\./);
    await refused('an unknown calculation', restoreBody('planned', { months: base, record: { ...record, method: 'manual', last_calculation: { kind: 'guess' } } }, base), /last_calculation must be null or a calculation/);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('2000.00', 12), `${kind}: nothing written`);
  });
}

/* ── B3. Start from another column ─────────────────────────────────────────── */

/** What a column holds, to compare a copy of the tab with the operation's. */
async function columnState(runner: QueryRunner, kind: Kind, versionId: string, measure: Measure): Promise<{ months: string[]; record: any; lines: Array<Record<string, any>> }> {
  const record = (await readRecords(runner, kind, versionId))[measure];
  const { id: _id, updated_at: _at, updated_by: _by, ...fields } = record ?? ({} as any);
  return {
    months: await readMeasure(runner, kind, versionId, measure, YEAR),
    record: record ? fields : null,
    lines: (await readLines(runner, kind, versionId, measure)).map(({ id: _l, ...line }) => line),
  };
}

/** The operation of Budget operations on the same year, the destination overwritten, rolled back afterwards. */
async function operationResult(runner: QueryRunner, kind: Kind, versionId: string, op: { sourceColumn: string; destinationColumn: string; percentageIncrease: number | string }, measure: Measure) {
  await runner.query('SAVEPOINT operation_copy');
  try {
    await budgetOperations(kind).copyBudgetColumn(
      { sourceYear: YEAR, destinationYear: YEAR, overwrite: true, dryRun: false, ...op },
      null,
      { manager: runner.manager },
    );
    return await columnState(runner, kind, versionId, measure);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT operation_copy');
  }
}

const copyBody = (source: Measure, measure: Measure, percentage: number | string, base: string[] = repeat('0', 12)) => (
  { kind: 'copy', year: YEAR, source, measure, percentage, base: { columns: { [measure]: { months: base } } } }
);

/** An amount spread over April to December copied at −10 %: whole units, the period kept, the origin said. */
async function testCopyAmountColumn(kind: Kind) {
  await withLine(kind, async ({ runner, itemId, versionId }) => {
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: '100000.01' }, period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31` });
    const expected = await operationResult(runner, kind, versionId, { sourceColumn: 'budget', destinationColumn: 'landing', percentageIncrease: -10 }, 'expected_landing');

    const audit = captureAudit();
    const answer = await write(kind, runner, versionId, copyBody('planned', 'expected_landing', -10), audit);
    assert.deepEqual(answer.copy, { prorated: false, from_lines: false, calendar_issues: [] }, `${kind}: what the copy did`);
    const copied = await columnState(runner, kind, versionId, 'expected_landing');
    assert.deepEqual(copied, expected, `${kind}: the operation's result, restricted to the line`);
    // 11 111.11 × 0.9 = 9 999.999 and 11 111.13 × 0.9 = 10 000.017: whole units adding up to 90 000.009 → 90 000.
    assert.deepEqual(copied.months, [...repeat('0.00', 3), ...repeat('10000.00', 9)], `${kind}: whole units`);
    assert.deepEqual(
      [copied.record.method, copied.record.period_start, copied.record.period_end, copied.record.spread_profile_name],
      ['copied', `${YEAR}-04-01`, `${YEAR}-12-31`, 'flat'],
    );
    assert.deepEqual(copied.record.last_calculation, {
      kind: 'copy', source_year: YEAR, source_measure: 'planned', uplift_pct: '-10', source_total: '100000.01', total: '90000.00', source_method: 'spread',
    }, `${kind}: the record says where it comes from`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), [...repeat('0.00', 3), ...repeat('11111.11', 8), '11111.13'], `${kind}: the source untouched`);

    const line = audit.entries.find((e) => e.table === AUDIT_LABELS[kind].items && e.recordId === itemId);
    assert.deepEqual([line?.action, line?.before, line?.after], ['update', { landing: 0 }, {
      landing: 90000, operation: 'budget_column_copy', sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'landing', percentageIncrease: '-10',
    }], `${kind}: the line's audit row of a column copy`);
    assert.deepEqual(
      audit.entries.map((e) => [e.table, e.action]),
      [[AUDIT_LABELS[kind].amounts, 'update'], [AUDIT_LABELS[kind].rounds, 'create'], [AUDIT_LABELS[kind].items, 'update']],
      `${kind}: the months, the record, the line`,
    );
  });
}

/**
 * Budget follows its lines: copied by its lines at −10 %, prices lowered, the
 * months computed again, the column follows the new lines. Forecast holds an
 * amount with reference lines: the copy keeps them, prices untouched.
 */
async function testCopyLinesColumns(kind: Kind) {
  await withLine(kind, async ({ runner, versionId, calendarId }) => {
    await write(kind, runner, versionId, { kind: 'lines', year: YEAR, measure: 'planned', also_measures: ['forecast'], lines: [consultant(calendarId), licences()] });
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { forecast: 60000 } });

    const fromLines = await operationResult(runner, kind, versionId, { sourceColumn: 'budget', destinationColumn: 'revision', percentageIncrease: '-10' }, 'committed');
    const answer = await write(kind, runner, versionId, copyBody('planned', 'committed', '-10'));
    assert.deepEqual(answer.copy, { prorated: false, from_lines: true, calendar_issues: [] });
    const copied = await columnState(runner, kind, versionId, 'committed');
    assert.deepEqual(copied, fromLines, `${kind}: the operation's result by the lines`);
    assert.deepEqual(copied.lines.map((l) => [l.label, l.unit_price]), [['Consultant', '360.0000'], ['Licences', '180.0000']], `${kind}: prices lowered`);
    assert.deepEqual(copied.months, CONSULTANT_MONTHS.map((m) => (Number(m) * 0.9 + 1800).toFixed(2)), `${kind}: months computed again`);
    assert.deepEqual([copied.record.method, copied.record.fte], ['computed', '0.75'], `${kind}: the column follows its lines`);

    const withReference = await operationResult(runner, kind, versionId, { sourceColumn: 'forecast', destinationColumn: 'landing', percentageIncrease: -10 }, 'expected_landing');
    await write(kind, runner, versionId, copyBody('forecast', 'expected_landing', -10));
    const landing = await columnState(runner, kind, versionId, 'expected_landing');
    assert.deepEqual(landing, withReference, `${kind}: the operation's result with reference lines`);
    assert.deepEqual(landing.months, repeat('4500.00', 12), `${kind}: 5 000 a month at −10 %`);
    assert.deepEqual(landing.lines.map((l) => [l.label, l.unit_price]), [['Consultant', '400.0000'], ['Licences', '200.0000']], `${kind}: reference prices untouched`);
    assert.deepEqual(
      [landing.record.method, landing.record.fte, landing.record.last_calculation.kind, landing.record.last_calculation.lines_result.total],
      ['copied', '0.75', 'copy', '89200.00'],
      `${kind}: the reference lines and what they give travel with the copy`,
    );
  });
}

/** A destination someone changed since the screen read it: 409, nothing written. */
async function testCopyConflict(kind: Kind) {
  await withLine(kind, async ({ runner, tenantId, versionId }) => {
    const claire = await seedPerson(runner, tenantId, 'Claire', 'Dubois');
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } });
    await write(kind, runner, versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), committed: 5 }] }, realAudit(), claire);
    let conflict: any;
    await assert.rejects(
      () => underSavepoint(runner, () => write(kind, runner, versionId, copyBody('planned', 'committed', 10), realAudit())),
      (err: any) => {
        conflict = err;
        return err instanceof BudgetEditConflictException;
      },
    );
    const [entry] = conflict.getResponse().conflicts;
    assert.deepEqual(
      [entry.field, entry.periods, entry.current[2], entry.mine, entry.changed_by?.name],
      ['committed', [period(3, YEAR)], '5.00', repeat('110.00', 12), 'Claire Dubois'],
      `${kind}: Revision moved in March`,
    );
    assert.deepEqual((await readMeasure(runner, kind, versionId, 'committed', YEAR))[2], '5.00', `${kind}: nothing written`);
  });
}

/** Refusals: a frozen destination, the column onto itself, an empty source, −100 %, unknown columns. */
async function testCopyRefusals(kind: Kind) {
  await withLine(kind, async ({ runner, tenantId, versionId }) => {
    await write(kind, runner, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } });
    const refused = async (label: string, body: Record<string, unknown>, check: (err: any) => boolean, freeze?: unknown) => {
      await assert.rejects(() => underSavepoint(runner, () => write(kind, runner, versionId, body, captureAudit(), null, freeze)), check, `${kind}: ${label}`);
    };
    const bad = (pattern: RegExp) => (err: any) => err instanceof BadRequestException && pattern.test(err.message);
    await refused('onto itself', copyBody('planned', 'planned', 0), bad(/cannot be copied onto itself/));
    await refused('empty source', copyBody('forecast', 'committed', 0), bad(/^Nothing to copy: Forecast 2026 is empty\.$/));
    await refused('−100 %', copyBody('planned', 'committed', -100), bad(/above -100 %/));
    await refused('not a percentage', copyBody('planned', 'committed', 'ten'), bad(/^percentage must be a number\./));
    await refused('unknown source', copyBody('budget' as Measure, 'committed', 0), bad(/^source must be one of/));
    await refused('unknown destination', { ...copyBody('planned', 'committed', 0), measure: 'revision' }, bad(/^measure must be one of/));
    await freezeColumn(runner, kind, tenantId, YEAR, 'revision');
    await refused('frozen destination', copyBody('planned', 'committed', 0), (err) => err instanceof ForbiddenException && /Revision for 2026 is frozen/.test(err.message), realFreeze());
    // A frozen source can still be copied from.
    await freezeColumn(runner, kind, tenantId, YEAR, 'budget');
    await write(kind, runner, versionId, copyBody('planned', 'forecast', 0), captureAudit(), null, realFreeze());
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'forecast', YEAR), repeat('100.00', 12), `${kind}: copied from a frozen column`);
  });
}

void runSpecs('budget-tab-writes.integration.spec', [
  ...KINDS.flatMap((kind) => [
    [`testAnnualAtADate(${kind})`, () => testAnnualAtADate(kind)],
    [`testBudgetFileKeepsTheDate(${kind})`, () => testBudgetFileKeepsTheDate(kind)],
    [`testRestoreLinesColumns(${kind})`, () => testRestoreLinesColumns(kind)],
    [`testRestoreMonthlyAndEmptyColumns(${kind})`, () => testRestoreMonthlyAndEmptyColumns(kind)],
    [`testRestoreConflictOnOneColumn(${kind})`, () => testRestoreConflictOnOneColumn(kind)],
    [`testRestoreFrozenColumn(${kind})`, () => testRestoreFrozenColumn(kind)],
    [`testRestoreRefusals(${kind})`, () => testRestoreRefusals(kind)],
    [`testCopyAmountColumn(${kind})`, () => testCopyAmountColumn(kind)],
    [`testCopyLinesColumns(${kind})`, () => testCopyLinesColumns(kind)],
    [`testCopyConflict(${kind})`, () => testCopyConflict(kind)],
    [`testCopyRefusals(${kind})`, () => testCopyRefusals(kind)],
  ] as Array<[string, () => Promise<void>]>),
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
