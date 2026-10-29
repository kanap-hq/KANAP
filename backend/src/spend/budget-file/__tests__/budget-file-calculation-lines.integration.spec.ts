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
import { exportBudgetFile, fileRows, loadBudgetFile, preflightBudgetFile, withCell } from '../../__tests__/budget-file.fixtures';

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

/** The annual spread the Budget tab sends for a column (`recordSpread` through the amounts payload). */
async function replaceWithBudgetTabSpread(ctx: Pick<Ctx, 'runner' | 'versionId'>, kind: Kind, total: string) {
  await amountsService(kind).bulkUpsert(
    ctx.versionId,
    {
      kind: 'annual',
      year: YEAR,
      totals: { planned: total },
      period_start: `${YEAR}-01-01`,
      period_end: `${YEAR}-12-31`,
    },
    null,
    { manager: ctx.runner.manager },
  );
}

const COMPARISON_IGNORED = new Set(['id', 'tenant_id', 'version_id', 'round_input_id', 'updated_at', 'updated_by', 'working_day_profile_id']);

/** What two tenants' copies of the same column can be compared on: the rows' keys and the calendar's UUID differ. */
function comparable(value: any): any {
  if (Array.isArray(value)) return value.map(comparable);
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (!COMPARISON_IGNORED.has(key)) result[key] = comparable(entry);
    }
    return result;
  }
  return value;
}

/**
 * The same yearly total in the Budget tab: `recordSpread` replaces the months
 * with a flat spread and carries the lines' result, exactly as the file does
 * for a different total. Both keep the lines and their result; nothing
 * distinguishes the file's record from the tab's.
 */
async function testBudgetTabWritesTheSameColumnAsTheFile(kind: Kind) {
  const file = await withCalculationLines(kind, 'tab-same-file', async (ctx) => {
    await loadBudgetTotal(ctx, kind, DIFFERENT_TOTAL);
    return {
      column: await column(ctx.runner, kind, ctx.versionId, 'planned'),
      screen: await screenRecord(ctx, kind, 'planned'),
      exported: await exportedTotal(ctx, kind),
    };
  });
  const tab = await withCalculationLines(kind, 'tab-same-tab', async (ctx) => {
    await replaceWithBudgetTabSpread(ctx, kind, DIFFERENT_TOTAL);
    return {
      column: await column(ctx.runner, kind, ctx.versionId, 'planned'),
      screen: await screenRecord(ctx, kind, 'planned'),
      exported: await exportedTotal(ctx, kind),
    };
  });

  assert.deepEqual(tab.column.months, repeat('6000.00', 12), `${kind}: the tab spreads the total flat`);
  assert.deepEqual(
    [tab.column.record!.method, tab.column.record!.last_calculation.kind, tab.column.record!.last_calculation.total, tab.column.record!.fte],
    ['spread', 'annual', DIFFERENT_TOTAL, '0.75'],
    `${kind}: the tab records its spread and keeps the FTE`,
  );
  assert.equal(tab.column.record!.last_calculation.lines_result.total, TOTAL_FROM_LINES, `${kind}: the tab keeps the lines' result`);
  assert.deepEqual(tab.column.lines.map((line) => line.label), ['Consultant', 'Developer'], `${kind}: the tab keeps the lines`);
  assert.deepEqual(
    [tab.screen.method, tab.screen.last_calculation.lines_result.total, tab.screen.lines.length],
    ['spread', TOTAL_FROM_LINES, 2],
    `${kind}: the tab reads the lines back as a reference with their result`,
  );
  assert.equal(tab.exported, DIFFERENT_TOTAL, `${kind}: the tab's next export writes its total`);

  assert.deepEqual(comparable(file.column), comparable(tab.column), `${kind}: the file and the tab write the same column`);
  assert.deepEqual(comparable(file.screen), comparable(tab.screen), `${kind}: and the tab reads the same record back`);
  assert.equal(file.exported, DIFFERENT_TOTAL, `${kind}: the file's next export writes its total`);
}

/**
 * An equal yearly total: the file writes nothing, so the column keeps the
 * lines' own monthly split (8 000 then 2 000) and stays computed. The Budget
 * tab still records its annual spread: the months become 5 000 flat and the
 * lines become a reference with their result. That is the one difference.
 */
async function testEqualTotalOnlyTheBudgetTabRewritesTheColumn(kind: Kind) {
  const file = await withCalculationLines(kind, 'tab-equal-file', async (ctx) => {
    const { loaded } = await loadBudgetTotal(ctx, kind);
    return {
      loaded,
      column: await column(ctx.runner, kind, ctx.versionId, 'planned'),
      screen: await screenRecord(ctx, kind, 'planned'),
      exported: await exportedTotal(ctx, kind),
    };
  });
  const tab = await withCalculationLines(kind, 'tab-equal-tab', async (ctx) => {
    await replaceWithBudgetTabSpread(ctx, kind, TOTAL_FROM_LINES);
    return {
      column: await column(ctx.runner, kind, ctx.versionId, 'planned'),
      screen: await screenRecord(ctx, kind, 'planned'),
      exported: await exportedTotal(ctx, kind),
    };
  });

  assert.equal(file.loaded.updated, 0, `${kind}: the file writes nothing for an equal total`);
  assert.deepEqual(
    [file.column.record!.method, file.column.record!.last_calculation.kind, file.column.record!.last_calculation.total],
    ['computed', 'computed', TOTAL_FROM_LINES],
    `${kind}: the file leaves the column on its lines`,
  );
  assert.deepEqual(file.column.months.slice(0, 7), ['8000.00', '8000.00', '8000.00', '8000.00', '8000.00', '8000.00', '2000.00']);
  assert.equal(file.screen.last_calculation.lines_result, undefined, `${kind}: the tab has no reference result to read`);
  assert.equal(file.exported, TOTAL_FROM_LINES);

  assert.deepEqual(tab.column.months, repeat('5000.00', 12), `${kind}: the tab still spreads the equal total flat`);
  assert.deepEqual(
    [tab.column.record!.method, tab.column.record!.last_calculation.kind, tab.column.record!.last_calculation.total],
    ['spread', 'annual', TOTAL_FROM_LINES],
    `${kind}: the tab records the spread even when the total is equal`,
  );
  assert.equal(tab.column.record!.last_calculation.lines_result.total, TOTAL_FROM_LINES, `${kind}: and keeps the lines' result`);
  assert.deepEqual(
    [tab.screen.method, tab.screen.last_calculation.lines_result.total, tab.screen.lines.length],
    ['spread', TOTAL_FROM_LINES, 2],
    `${kind}: the tab reads the lines back as a reference`,
  );
  assert.equal(tab.exported, TOTAL_FROM_LINES);

  assert.notDeepEqual(comparable(file.column), comparable(tab.column), `${kind}: the file and the tab differ at an equal total`);
}

/** The export of the line's Budget column, yearly or by month. */
async function exportBudget(ctx: Pick<Ctx, 'runner' | 'tenantId' | 'itemId'>, kind: Kind, detail: 'yearly' | 'months' = 'yearly'): Promise<string> {
  return exportBudgetFile(ctx.runner.manager, kind, ctx.tenantId, [ctx.itemId], { amountYears: String(YEAR), columns: 'budget', detail });
}

/** The preflight's calculation lines warnings for a file, once the file is ready to load. */
async function calculationWarnings(ctx: Pick<Ctx, 'runner' | 'tenantId'>, kind: Kind, file: string) {
  const report = await preflightBudgetFile(ctx.runner.manager, kind, ctx.tenantId, file);
  assert.equal(report.ok, true, `${kind}: the file is ready to load`);
  return { report, warnings: report.warnings.calculationLines };
}

/** The warning of the line's Budget column: its two lines and their 60 000. */
function budgetWarning(item: string) {
  return {
    line: 2,
    item,
    column: 'budget',
    year: YEAR,
    count: 2,
    total: TOTAL_FROM_LINES,
    message: `${item} · Budget ${YEAR}: 2 calculation lines (60,000.00) will no longer drive these amounts.`,
  };
}

/**
 * A different yearly total on a column that follows its lines: the check says, once, that the two
 * lines and their total no longer drive it. The file still loads.
 */
async function testDifferentTotalWarnsAboutTheLines(kind: Kind) {
  await withCalculationLines(kind, 'warn-different', async (ctx) => {
    const content = await exportBudget(ctx, kind);
    const item = fileRows(content)[0].item_number;
    const { report, warnings } = await calculationWarnings(ctx, kind, withCell(content, `budget_${YEAR}`, DIFFERENT_TOTAL));
    assert.deepEqual(warnings, [budgetWarning(item)], `${kind}: the lines' count and total`);
    assert.equal(report.changes.updated, 1);
    const loaded: any = await loadBudgetFile(ctx.runner.manager, kind, ctx.tenantId, withCell(content, `budget_${YEAR}`, DIFFERENT_TOTAL));
    assert.equal(loaded.updated, 1, `${kind}: the warning never refuses the load`);
  });
}

/** An equal total, and a changed total on a column whose lines are already a reference: no warning. */
async function testNoWarningForAnEqualTotalOrAReference(kind: Kind) {
  await withCalculationLines(kind, 'warn-none', async (ctx) => {
    const content = await exportBudget(ctx, kind);
    const equal = await calculationWarnings(ctx, kind, content);
    assert.deepEqual(equal.warnings, [], `${kind}: an equal total keeps the column on its lines`);
    assert.equal(equal.report.changes.unchanged, 1);

    await loadBudgetTotal(ctx, kind, DIFFERENT_TOTAL);
    const again = await exportBudget(ctx, kind);
    const reference = await calculationWarnings(ctx, kind, withCell(again, `budget_${YEAR}`, '50000.00'));
    assert.equal(reference.report.changes.updated, 1, `${kind}: the new total is a change`);
    assert.deepEqual(reference.warnings, [], `${kind}: the lines are already a reference`);
  });
}

/** Months changed on a column that follows its lines: one warning for the column, whatever the months. */
async function testMonthChangeWarnsOnce(kind: Kind) {
  await withCalculationLines(kind, 'warn-month', async (ctx) => {
    const content = await exportBudget(ctx, kind, 'months');
    const item = fileRows(content)[0].item_number;
    const file = withCell(withCell(content, `budget_${YEAR}_03`, '9000.00'), `budget_${YEAR}_04`, '9000.00');
    const { report, warnings } = await calculationWarnings(ctx, kind, file);
    assert.deepEqual(report.changes.updatedLines.map((line) => line.fields), [[`budget ${YEAR}-03`, `budget ${YEAR}-04`]]);
    assert.deepEqual(warnings, [budgetWarning(item)], `${kind}: said once for the column`);
    const unchanged = await calculationWarnings(ctx, kind, content);
    assert.deepEqual(unchanged.warnings, [], `${kind}: the same months say nothing`);
  });
}

void runSpecs(
  'budget-file-calculation-lines.integration.spec',
  KINDS.flatMap((kind) => [
    [`a different yearly total keeps the calculation lines and their result (${kind})`, () => testDifferentFileTotalKeepsTheLinesAndTheirResult(kind)],
    [`an equal yearly total leaves the column on its calculation lines (${kind})`, () => testEqualFileTotalLeavesTheColumnOnItsLines(kind)],
    [`the Budget tab writes the same column as the file for a different total (${kind})`, () => testBudgetTabWritesTheSameColumnAsTheFile(kind)],
    [`at an equal total only the Budget tab rewrites the column (${kind})`, () => testEqualTotalOnlyTheBudgetTabRewritesTheColumn(kind)],
    [`the check warns when a different total stops the calculation lines (${kind})`, () => testDifferentTotalWarnsAboutTheLines(kind)],
    [`the check says nothing for an equal total or lines kept as a reference (${kind})`, () => testNoWarningForAnEqualTotalOrAReference(kind)],
    [`the check warns once when months change on a column with lines (${kind})`, () => testMonthChangeWarnsOnce(kind)],
  ] as Array<[string, () => Promise<void>]>),
);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
