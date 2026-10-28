import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import {
  amountsService,
  assert,
  inRolledBackTransaction,
  Kind,
  repeat,
  readLines,
  readMeasure,
  readRecords,
  runSpecs,
  seedCalendar,
  seedLine,
  seedTenant,
  StoredLine,
  StoredRecord,
} from '../../__tests__/round-inputs.fixtures';
import { exportBudgetFile, fileRows, loadBudgetFile, withCell } from '../../__tests__/budget-file.fixtures';

// A budget file sets one yearly total per column. A column may also be built
// from quantity × price lines in the Budget tab (`spend_round_inputs` and
// `spend_round_input_lines`; `last_calculation` holds the computed result, and
// `lines_result` keeps what the lines gave once a spread replaces them).
//
// This spec observes what a yearly total of the file does to such a column,
// on OPEX and CAPEX. It is a test of today's behaviour, not a specification of
// what the load should do. The scenarios run in a transaction that is rolled
// back.
//
// What it observes (lot 4 bis):
// - a different total: the file replaces the months with its flat spread,
//   keeps the two calculation lines, keeps their result as `lines_result`, and
//   the Budget tab reads the lines back as a reference with that result;
// - an equal total: the file compares yearly totals and writes nothing, so the
//   column keeps following its lines and the tab shows them as the source;
// - the flat path (`annualSpreadFields` + `insertRoundRows`) is not used for a
//   column with lines: `flatPeriod` sends it to the amounts payload, whose
//   `recordSpread` carries `lines_result`. The feared loss does not happen.
// @database-spec

const YEAR = 2031;
const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
/** What the two lines give over the year: 8 000 a month from January to June, then 2 000. */
const TOTAL_FROM_LINES = '60000.00';
/** A total the lines do not give: the file's flat spread gives 6 000 a month. */
const DIFFERENT_TOTAL = '72000.00';
const KINDS: Kind[] = ['opex', 'capex'];

/** Twenty working days each month, so five days a month is FTE 0.25. */
const DAYS = { [YEAR]: repeat('20', 12) };

/**
 * Two calculation lines, as the Budget tab writes them:
 * - Consultant: one person, 400 a day, five days a month, all year: 2 000 a
 *   month, 24 000 a year, FTE 0.25;
 * - Developer: one person, 300 a day, full time, January to June: 6 000 a
 *   month, 36 000 a year, FTE 1 for those six months.
 * Together: 8 000 a month from January to June and 2 000 after, 60 000 a year,
 * FTE 0.75. A flat spread of 60 000 would give 5 000 a month, so an equal
 * yearly total is not an equal monthly column.
 */
function calculationLines(calendarId: string) {
  return [
    {
      label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '400', price_basis: 'per_day',
      frequency: 'per_month', days_per_month: '5', period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`,
      working_day_profile_id: calendarId,
    },
    {
      label: 'Developer', quantity_unit: 'people', quantity: '1', unit_price: '300', price_basis: 'per_day',
      frequency: 'per_month', days_per_month: null, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30`,
      working_day_profile_id: calendarId,
    },
  ];
}

type Ctx = { runner: QueryRunner; tenantId: string; itemId: string; versionId: string; otherVersionId: string };

type Column = { record: StoredRecord | undefined; months: string[]; lines: StoredLine[] };

type Snapshot = { planned: Column; forecast: Column; otherLine: Column };

async function column(runner: QueryRunner, kind: Kind, versionId: string, measure: 'planned' | 'forecast'): Promise<Column> {
  return {
    record: (await readRecords(runner, kind, versionId))[measure],
    months: await readMeasure(runner, kind, versionId, measure, YEAR),
    lines: await readLines(runner, kind, versionId, measure),
  };
}

/** The target line's Budget and Revision, and another line not named by the file. */
async function snapshot(runner: QueryRunner, kind: Kind, ctx: Pick<Ctx, 'versionId' | 'otherVersionId'>): Promise<Snapshot> {
  return {
    planned: await column(runner, kind, ctx.versionId, 'planned'),
    forecast: await column(runner, kind, ctx.versionId, 'forecast'),
    otherLine: await column(runner, kind, ctx.otherVersionId, 'planned'),
  };
}

/**
 * A tenant with the calendar, a line whose Budget is the two calculation
 * lines (written by the Budget tab's service, not raw SQL), its Revision at
 * 12 000, and a second line at 2 400 that the file never names.
 */
async function withCalculationLines<T>(kind: Kind, tag: string, fn: (ctx: Ctx) => Promise<T>): Promise<T> {
  let result!: T;
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-${tag}`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Twenty days', days_by_year: DAYS });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    const svc = amountsService(kind);
    await svc.bulkUpsert(
      versionId,
      { kind: 'lines', year: YEAR, measure: 'planned', lines: calculationLines(calendarId) },
      null,
      { manager: runner.manager },
    );
    await svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { forecast: 12000 } }, null, { manager: runner.manager });
    const other = await seedLine(runner, kind, tenantId, YEAR, {}, 2);
    await svc.bulkUpsert(other.versionId, { kind: 'annual', year: YEAR, totals: { planned: 2400 } }, null, { manager: runner.manager });
    result = await fn({ runner, tenantId, itemId, versionId, otherVersionId: other.versionId });
  });
  return result;
}

/** The export of the line's Budget column, then the same file with its total set to `total` (or unchanged when omitted). */
async function loadBudgetTotal(
  ctx: Pick<Ctx, 'runner' | 'tenantId' | 'itemId'>,
  kind: Kind,
  total?: string,
): Promise<{ cell: string; loaded: any }> {
  const content = await exportBudgetFile(ctx.runner.manager, kind, ctx.tenantId, [ctx.itemId], {
    amountYears: String(YEAR),
    columns: 'budget',
    detail: 'yearly',
  });
  const cell = fileRows(content)[0][`budget_${YEAR}`];
  const file = total === undefined ? content : withCell(content, `budget_${YEAR}`, total);
  const loaded = await loadBudgetFile(ctx.runner.manager, kind, ctx.tenantId, file);
  return { cell, loaded };
}

/** The record the Budget tab reads for one column (`listByYear`, the screen's GET …/amounts). */
async function screenRecord(ctx: Pick<Ctx, 'runner' | 'versionId'>, kind: Kind, measure: 'planned' | 'forecast') {
  const read = await amountsService(kind).listByYear(ctx.versionId, YEAR, { manager: ctx.runner.manager });
  return read.round_inputs.find((record: any) => record.measure === measure) ?? null;
}

/** The yearly total the next export writes for the line's Budget column. */
async function exportedTotal(ctx: Pick<Ctx, 'runner' | 'tenantId' | 'itemId'>, kind: Kind): Promise<string> {
  const content = await exportBudgetFile(ctx.runner.manager, kind, ctx.tenantId, [ctx.itemId], {
    amountYears: String(YEAR),
    columns: 'budget',
    detail: 'yearly',
  });
  return fileRows(content)[0][`budget_${YEAR}`];
}

/**
 * A different yearly total: the column becomes a flat spread of the file's
 * total; the two calculation lines and their result stay, as a reference the
 * Budget tab reads back. The Revision and the other line do not move.
 */
async function testDifferentFileTotalKeepsTheLinesAndTheirResult(kind: Kind) {
  await withCalculationLines(kind, 'file-different', async (ctx) => {
    const before = await snapshot(ctx.runner, kind, ctx);
    assert.deepEqual(
      [before.planned.record!.method, before.planned.record!.last_calculation.kind, before.planned.record!.fte],
      ['computed', 'computed', '0.75'],
      `${kind}: the column starts on its lines`,
    );
    assert.deepEqual(before.planned.months.slice(0, 7), ['8000.00', '8000.00', '8000.00', '8000.00', '8000.00', '8000.00', '2000.00']);
    assert.equal(before.planned.lines.length, 2);

    const { cell, loaded } = await loadBudgetTotal(ctx, kind, DIFFERENT_TOTAL);
    assert.equal(cell, TOTAL_FROM_LINES, `${kind}: the export writes what the lines give`);
    assert.equal(loaded.updated, 1, `${kind}: the file changed the line (${JSON.stringify(loaded.errors ?? loaded)})`);

    const after = await snapshot(ctx.runner, kind, ctx);
    assert.deepEqual(after.planned.months, repeat('6000.00', 12), `${kind}: the file's total, spread flat over the year`);

    const record = after.planned.record!;
    assert.deepEqual(
      [record.method, record.spread_profile_name, record.period_start, record.period_end, record.fte],
      ['spread', 'flat', `${YEAR}-01-01`, `${YEAR}-12-31`, '0.75'],
      `${kind}: the column is a spread and keeps its FTE`,
    );
    assert.deepEqual(
      [record.last_calculation.kind, record.last_calculation.total, record.last_calculation.profile, record.last_calculation.active_months],
      ['annual', DIFFERENT_TOTAL, 'flat', MONTHS],
      `${kind}: the record says what the file wrote`,
    );
    assert.ok(record.last_calculation.lines_result, `${kind}: the result of the lines is kept`);
    assert.deepEqual(
      [record.last_calculation.lines_result.total, record.last_calculation.lines_result.fte],
      [TOTAL_FROM_LINES, '0.75'],
      `${kind}: the result is what the lines gave, not the file's total`,
    );
    assert.deepEqual(
      record.last_calculation.lines_result.lines.map((line: any) => line.label),
      ['Consultant', 'Developer'],
      `${kind}: each line's result is kept`,
    );
    assert.deepEqual(
      after.planned.lines.map((line) => line.label),
      ['Consultant', 'Developer'],
      `${kind}: the lines themselves are kept`,
    );

    const screen = await screenRecord(ctx, kind, 'planned');
    assert.deepEqual(
      [screen.method, screen.last_calculation.kind, screen.last_calculation.lines_result.total],
      ['spread', 'annual', TOTAL_FROM_LINES],
      `${kind}: the Budget tab reads the lines as a reference with their result`,
    );
    assert.equal(screen.lines.length, 2, `${kind}: and still shows the two lines`);

    assert.deepEqual(after.forecast, before.forecast, `${kind}: the Revision column does not move`);
    assert.deepEqual(after.otherLine, before.otherLine, `${kind}: the other line does not move`);
    assert.equal(await exportedTotal(ctx, kind), DIFFERENT_TOTAL, `${kind}: the next export writes the file's total`);
  });
}

/**
 * An equal yearly total: the file compares yearly totals, so the line is not
 * written at all. The column keeps following its lines, their monthly split,
 * their FTE and their result; the tab shows the lines as the source. The next
 * export writes the same total.
 */
async function testEqualFileTotalLeavesTheColumnOnItsLines(kind: Kind) {
  await withCalculationLines(kind, 'file-equal', async (ctx) => {
    const before = await snapshot(ctx.runner, kind, ctx);
    const { cell, loaded } = await loadBudgetTotal(ctx, kind);
    assert.equal(cell, TOTAL_FROM_LINES, `${kind}: the exported total is the lines' total`);
    assert.equal(loaded.updated, 0, `${kind}: a total equal to the lines writes nothing`);

    const after = await snapshot(ctx.runner, kind, ctx);
    assert.deepEqual(after.planned, before.planned, `${kind}: the column is untouched, months, record and lines`);
    assert.deepEqual(
      [after.planned.record!.method, after.planned.record!.last_calculation.kind, after.planned.record!.last_calculation.total],
      ['computed', 'computed', TOTAL_FROM_LINES],
      `${kind}: the column still follows its lines`,
    );
    assert.equal('lines_result' in after.planned.record!.last_calculation, false, `${kind}: the computed calculation is its own result`);
    assert.equal(after.planned.lines.length, 2, `${kind}: the two lines are kept`);

    const screen = await screenRecord(ctx, kind, 'planned');
    assert.deepEqual(
      [screen.method, screen.last_calculation.kind, screen.lines.length],
      ['computed', 'computed', 2],
      `${kind}: the Budget tab reads the lines as the source of the column`,
    );
    assert.equal(screen.last_calculation.lines_result, undefined, `${kind}: no reference result for a column that follows its lines`);

    assert.deepEqual(after.forecast, before.forecast, `${kind}: the Revision column does not move`);
    assert.deepEqual(after.otherLine, before.otherLine, `${kind}: the other line does not move`);
    assert.equal(await exportedTotal(ctx, kind), TOTAL_FROM_LINES, `${kind}: the next export writes the same total`);
  });
}

void runSpecs(
  'budget-file-calculation-lines.integration.spec',
  KINDS.flatMap((kind) => [
    [`a different yearly total keeps the calculation lines and their result (${kind})`, () => testDifferentFileTotalKeepsTheLinesAndTheirResult(kind)],
    [`an equal yearly total leaves the column on its calculation lines (${kind})`, () => testEqualFileTotalLeavesTheColumnOnItsLines(kind)],
  ] as Array<[string, () => Promise<void>]>),
);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
