import 'dotenv/config';
import { BadRequestException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { exportBudgetFile, loadBudgetFile, withCell } from './budget-file.fixtures';
import {
  amountsService,
  assert,
  budgetOperations,
  captureAudit,
  findVersion,
  inRolledBackTransaction,
  Kind,
  period,
  readLines,
  readMeasure,
  readRecords,
  repeat,
  runSpecs,
  seedCalendar,
  seedLine,
  seedTenant,
  setItemDates,
  TABLES,
} from './round-inputs.fixtures';

// The result of the lines kept on a column that no longer follows them
// (`lines_result`, FTE reports lot 2a), on OPEX and CAPEX, against the
// database behind `dataSource`, each test in a transaction that is rolled
// back: a yearly or quarterly spread (over a computed column, a column edited
// by hand, an already spread column) and a budget file load carry the result
// of the lines; a copy of lines that are only a reference computes it for the
// destination year with that year's calendars (shifted lines, item validity,
// calendar fallback, a calendar without days); removing the lines drops it;
// following the lines again replaces it.

const YEAR = 2034;
const NEXT = YEAR + 1;
const KINDS: Kind[] = ['opex', 'capex'];

/** The calendar's working days: 20 a month in YEAR, 16 in NEXT. */
const DAYS = { [YEAR]: repeat('20', 12), [NEXT]: repeat('16', 12) };

/**
 * A consultant 5 days a month at 400 a day over the year (FTE 5 ÷ the month's
 * working days), a developer full time at 300 a day from January to June
 * (FTE 1, amounts from the working days), and licences (no FTE). In YEAR:
 * 0.25 × 12 + 1 × 6 = 9 FTE-months, 0.75; in NEXT: 0.3125 × 12 + 6 = 9.75,
 * 0.8125, so 0.81.
 */
function staffLines(calendarId: string, year = YEAR) {
  return [
    {
      label: 'Consultant', quantity_unit: 'people', quantity: '1', unit_price: '400', price_basis: 'per_day', frequency: 'per_month',
      days_per_month: '5', period_start: `${year}-01-01`, period_end: `${year}-12-31`, working_day_profile_id: calendarId,
    },
    {
      label: 'Developer', quantity_unit: 'people', quantity: '1', unit_price: '300', price_basis: 'per_day', frequency: 'per_month',
      days_per_month: null, period_start: `${year}-01-01`, period_end: `${year}-06-30`, working_day_profile_id: calendarId,
    },
    {
      label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '20', price_basis: 'per_piece', frequency: 'per_month',
      days_per_month: null, period_start: `${year}-01-01`, period_end: `${year}-12-31`, working_day_profile_id: null,
    },
  ];
}

type Ctx = { runner: QueryRunner; tenantId: string; itemId: string; versionId: string; calendarId: string };

/** A tenant, the calendar, a line with its YEAR version, and the staff lines written on Budget (planned). */
async function withStaffLines(kind: Kind, tag: string, fn: (ctx: Ctx & { computed: any }) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-${tag}`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: DAYS });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, staffLines(calendarId));
    const computed = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([computed.method, computed.fte, computed.last_calculation.kind], ['computed', '0.75', 'computed'], 'harness: the column follows its lines');
    await fn({ runner, tenantId, itemId, versionId, calendarId, computed });
  });
}

function writeLines(runner: QueryRunner, kind: Kind, versionId: string, lines: unknown[], year = YEAR) {
  return amountsService(kind).bulkUpsert(versionId, { kind: 'lines', year, measure: 'planned', lines }, null, { manager: runner.manager });
}

function upsert(runner: QueryRunner, kind: Kind, versionId: string, payload: Record<string, unknown>) {
  return amountsService(kind).bulkUpsert(versionId, payload, null, { manager: runner.manager });
}

/** The computed calculation without its kind: what `lines_result` holds. */
function resultOf(calculation: Record<string, unknown>) {
  const { kind, ...rest } = calculation;
  assert.equal(kind, 'computed');
  return rest;
}

const handEdit = (runner: QueryRunner, kind: Kind, versionId: string) =>
  upsert(runner, kind, versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), planned: 1 }] });

/**
 * A yearly spread over a computed column keeps the computed calculation as
 * `lines_result`; a second spread (already spread) and a quarterly edit carry
 * it again; a hand edit afterwards keeps it as it is.
 */
async function testSpreadsCarryTheResult(kind: Kind) {
  await withStaffLines(kind, 'spread', async ({ runner, versionId, computed }) => {
    const expected = resultOf(computed.last_calculation);
    await upsert(runner, kind, versionId, { kind: 'annual', year: YEAR, totals: { planned: 12000 }, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-06-30` });
    const spread = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([spread.method, spread.last_calculation.kind, spread.last_calculation.total, spread.fte], ['spread', 'annual', '12000.00', '0.75']);
    assert.deepEqual(spread.last_calculation.lines_result, expected, `${kind}: the spread keeps what the lines gave`);

    await upsert(runner, kind, versionId, { kind: 'annual', year: YEAR, totals: { planned: 24000 } });
    const again = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([again.last_calculation.total, again.fte], ['24000.00', '0.75']);
    assert.deepEqual(again.last_calculation.lines_result, expected, `${kind}: a spread over a spread carries it again`);

    await upsert(runner, kind, versionId, { kind: 'quarterly', year: YEAR, measure: 'planned', Q1: 300, Q2: 300 });
    const quarterly = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([quarterly.method, quarterly.last_calculation.kind, quarterly.fte], ['spread', 'quarterly', '0.75']);
    assert.deepEqual(quarterly.last_calculation.lines_result, expected, `${kind}: a quarterly edit carries it`);

    await handEdit(runner, kind, versionId);
    const manual = (await readRecords(runner, kind, versionId)).planned;
    assert.equal(manual.method, 'manual');
    assert.deepEqual(manual.last_calculation, quarterly.last_calculation, `${kind}: a hand edit keeps the calculation as it is`);

    const listed = await amountsService(kind).listByYear(versionId, YEAR, { manager: runner.manager });
    assert.deepEqual(listed.round_inputs[0].last_calculation.lines_result, expected, `${kind}: the API returns it`);
  });
}

/** A column computed, then edited by hand (kind computed, method manual), then spread: the computed calculation is kept. */
async function testSpreadOverHandEdit(kind: Kind) {
  await withStaffLines(kind, 'manual-spread', async ({ runner, versionId, computed }) => {
    await handEdit(runner, kind, versionId);
    const manual = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([manual.method, manual.last_calculation.kind], ['manual', 'computed'], 'harness');
    await upsert(runner, kind, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } });
    const spread = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([spread.method, spread.last_calculation.kind, spread.fte], ['spread', 'annual', '0.75']);
    assert.deepEqual(spread.last_calculation.lines_result, resultOf(computed.last_calculation), `${kind}: the hand-edited column's result is kept`);
  });
}

/** Removing the lines drops the result with the FTE; following the lines again replaces the calculation. */
async function testRemovingOrFollowingTheLines(kind: Kind) {
  await withStaffLines(kind, 'remove', async ({ runner, versionId, calendarId, computed }) => {
    await upsert(runner, kind, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } });
    assert.ok((await readRecords(runner, kind, versionId)).planned.last_calculation.lines_result, 'harness: the spread carries it');

    // Follow the lines again: computed, as a lines write stores it, nothing carried.
    await writeLines(runner, kind, versionId, staffLines(calendarId));
    const followed = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([followed.method, followed.fte], ['computed', '0.75']);
    assert.deepEqual(followed.last_calculation, computed.last_calculation, `${kind}: the computed calculation, without lines_result`);

    await upsert(runner, kind, versionId, { kind: 'annual', year: YEAR, totals: { planned: 1200 } });
    await writeLines(runner, kind, versionId, []);
    const removed = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([removed.method, removed.fte, removed.last_calculation.kind, removed.last_calculation.total], ['spread', null, 'annual', '1200.00']);
    assert.equal('lines_result' in removed.last_calculation, false, `${kind}: the lines removed, their result goes`);
    assert.deepEqual(await readLines(runner, kind, versionId, 'planned'), []);
  });
}

/**
 * The budget file: a yearly total over a column with lines leaves the
 * grouped flat path (`flatPeriod` takes only columns without lines) for the
 * amounts payload, whose spread record carries the result of the lines.
 */
async function testBudgetFileLoadCarriesTheResult(kind: Kind) {
  await withStaffLines(kind, 'file', async ({ runner, tenantId, itemId, versionId, computed }) => {
    const content = await exportBudgetFile(runner.manager, kind, tenantId, [itemId], { amountYears: String(YEAR), columns: 'budget', detail: 'yearly' });
    const loaded = await loadBudgetFile(runner.manager, kind, tenantId, withCell(content, `budget_${YEAR}`, '6000'));
    assert.equal((loaded as any).updated, 1, JSON.stringify((loaded as any).errors));
    const spread = (await readRecords(runner, kind, versionId)).planned;
    assert.deepEqual([spread.method, spread.spread_profile_name, spread.last_calculation.kind, spread.last_calculation.total, spread.fte], ['spread', 'flat', 'annual', '6000.00', '0.75']);
    assert.deepEqual(spread.last_calculation.lines_result, resultOf(computed.last_calculation), `${kind}: the load keeps the result of the lines`);
    assert.equal((await readLines(runner, kind, versionId, 'planned')).length, 3, `${kind}: and the lines`);
  });
}

/**
 * A copy of lines that are only a reference: the lines are shifted a year,
 * their prices as they are, and computed with the destination year's
 * calendar: the record keeps what they give there and its FTE from it (0.81,
 * not the source's 0.75). The months are the source's × the uplift.
 */
async function testCopyOfReferenceLines(kind: Kind) {
  await withStaffLines(kind, 'copy', async ({ runner, itemId, versionId, calendarId }) => {
    await handEdit(runner, kind, versionId);
    const source = (await readRecords(runner, kind, versionId)).planned;
    const sourceMonths = await readMeasure(runner, kind, versionId, 'planned', YEAR);
    const op = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: NEXT, destinationColumn: 'budget', percentageIncrease: 10, overwrite: false };

    const preview = await budgetOperations(kind).copyBudgetColumn({ ...op, dryRun: true }, null, { manager: runner.manager });
    assert.deepEqual(preview.results.map((r: any) => [r.fromLines, r.calendarIssues, r.skipped]), [[false, [], false]], `${kind}: copied from the months`);

    await budgetOperations(kind).copyBudgetColumn({ ...op, dryRun: false }, null, { manager: runner.manager });
    const destination = (await findVersion(runner, kind, itemId, NEXT))!;
    const copied = (await readRecords(runner, kind, destination.id)).planned;
    assert.deepEqual(
      [copied.method, copied.last_calculation.kind, copied.last_calculation.source_method, copied.fte, source.fte],
      ['copied', 'copy', 'manual', '0.81', '0.75'],
      `${kind}: the FTE of the shifted lines on the destination year's calendar`,
    );
    const months = await readMeasure(runner, kind, destination.id, 'planned', NEXT);
    assert.deepEqual(months.map(Number), sourceMonths.map((m) => Math.round(Number(m) * 1.1)), `${kind}: months × uplift, whole units`);

    const result = copied.last_calculation.lines_result;
    assert.equal(Number(result.fte).toFixed(2), copied.fte, `${kind}: the record's FTE is the result's`);
    assert.deepEqual(
      [result.fte_period, result.active_months, result.fte_months.slice(5, 7), result.total],
      ['0.81', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], ['1.3125', '0.3125'], '55200.00'],
      `${kind}: 5 ÷ 16 a month, the developer until June; 2 000 + 200 a month, 4 800 for the developer`,
    );
    assert.deepEqual(
      result.lines.map((l: any) => [l.label, l.unit_price, l.period_start, l.period_end, l.working_day_profile_code, l.day_counts?.[0] ?? null, l.fte, l.total]),
      [
        ['Consultant', '400', `${NEXT}-01-01`, `${NEXT}-12-31`, 'C', '16', '0.31', '24000.00'],
        ['Developer', '300', `${NEXT}-01-01`, `${NEXT}-06-30`, 'C', '16', '0.5', '28800.00'],
        ['Licences', '20', `${NEXT}-01-01`, `${NEXT}-12-31`, null, null, '0', '2400.00'],
      ],
      `${kind}: each line computed for ${NEXT}, prices untouched`,
    );
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [l.label, l.unit_price, l.working_day_profile_id, l.period_start, l.period_end]),
      [
        ['Consultant', '400.0000', calendarId, `${NEXT}-01-01`, `${NEXT}-12-31`],
        ['Developer', '300.0000', calendarId, `${NEXT}-01-01`, `${NEXT}-06-30`],
        ['Licences', '20.0000', null, `${NEXT}-01-01`, `${NEXT}-12-31`],
      ],
      `${kind}: the stored lines are the lines of the result`,
    );

    // Removing the destination's lines drops the result.
    await amountsService(kind).bulkUpsert(destination.id, { kind: 'lines', year: NEXT, measure: 'planned', lines: [] }, null, { manager: runner.manager });
    const removed = (await readRecords(runner, kind, destination.id)).planned;
    assert.deepEqual([removed.method, removed.fte, removed.last_calculation.kind, 'lines_result' in removed.last_calculation], ['copied', null, 'copy', false]);
  });
}

/** A paying company in France for the item and the tenant's standard France calendar (public holidays); returns the calendar id. */
async function standardFrance(runner: QueryRunner, kind: Kind, tenantId: string, itemId: string, withCalendar: boolean) {
  const [{ id: companyId }] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Paying company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  await runner.query(`UPDATE ${TABLES[kind].items} SET paying_company_id = $2 WHERE id = $1`, [itemId, companyId]);
  if (!withCalendar) return null;
  const [{ id }] = await runner.query(
    `INSERT INTO working_day_profiles (tenant_id, code, name, days_by_year, status, country_iso)
     VALUES ($1, 'FR', 'France', '{}'::jsonb, 'enabled', 'FR') RETURNING id`,
    [tenantId],
  );
  return id as string;
}

/**
 * Reference lines whose calendar has no days for the destination year are
 * handled like those of a column that follows its lines (the two tests below).
 */
async function withReferenceLinesWithoutNextYear(kind: Kind, tag: string, fn: (ctx: Ctx) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-${tag}`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: DAYS[YEAR] } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, staffLines(calendarId));
    await handEdit(runner, kind, versionId);
    await fn({ runner, tenantId, itemId, versionId, calendarId });
  });
}

const copyOp = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: NEXT, destinationColumn: 'budget', percentageIncrease: 0, overwrite: false };

/**
 * - a fallback: the paying company's standard calendar replaces it, named in
 *   the preview and confirmed; the lines take it and the result comes from it;
 */
async function testCopyOfReferenceLinesFallback(kind: Kind) {
  await withReferenceLinesWithoutNextYear(kind, 'copy-fallback', async ({ runner, tenantId, itemId }) => {
    const franceId = await standardFrance(runner, kind, tenantId, itemId, true);
    const issues = ['Consultant', 'Developer'].map((line, i) => ({ line, lineNumber: i + 1, calendar: 'Custom', kind: 'fallback', fallback: 'France' }));
    const preview = await budgetOperations(kind).copyBudgetColumn({ ...copyOp, dryRun: true }, null, { manager: runner.manager });
    assert.deepEqual(preview.results.map((r: any) => [r.fromLines, r.calendarIssues]), [[false, issues]], `${kind}: the preview names the fallback`);
    await assert.rejects(
      () => budgetOperations(kind).copyBudgetColumn({ ...copyOp, dryRun: false }, null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && /Run the preview, then confirm\.$/.test(err.message),
      `${kind}: refused without the confirmation`,
    );
    const audit = captureAudit();
    await budgetOperations(kind, audit).copyBudgetColumn({ ...copyOp, dryRun: false, acceptCalendarChanges: true }, null, { manager: runner.manager });
    const destination = (await findVersion(runner, kind, itemId, NEXT))!;
    const copied = (await readRecords(runner, kind, destination.id)).planned;
    const result = copied.last_calculation.lines_result;
    assert.deepEqual(result.lines.map((l: any) => l.working_day_profile_name), ['France', 'France', null], `${kind}: computed with the standard calendar`);
    assert.equal(copied.fte, Number(result.fte).toFixed(2), `${kind}: the FTE from it`);
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => l.working_day_profile_id),
      [franceId, franceId, null],
      `${kind}: the lines take it`,
    );
    const itemAudit = audit.entries.find((e) => e.table === TABLES[kind].items && e.recordId === itemId)?.after;
    assert.deepEqual([itemAudit.calendar_issues, itemAudit.from_lines], [issues, undefined], `${kind}: the audit keeps the calendar change`);
  });
}

/** - no replacement: confirmed, copied the old way: the lines as they are, the source's FTE, no result. */
async function testCopyOfReferenceLinesMissingCalendar(kind: Kind) {
  await withReferenceLinesWithoutNextYear(kind, 'copy-missing', async ({ runner, tenantId, itemId, calendarId }) => {
    await standardFrance(runner, kind, tenantId, itemId, false);
    const preview = await budgetOperations(kind).copyBudgetColumn({ ...copyOp, dryRun: true }, null, { manager: runner.manager });
    assert.deepEqual(
      preview.results.map((r: any) => r.calendarIssues.map((i: any) => [i.line, i.kind])),
      [[['Consultant', 'missing'], ['Developer', 'missing']]],
    );
    await assert.rejects(() => budgetOperations(kind).copyBudgetColumn({ ...copyOp, dryRun: false }, null, { manager: runner.manager }), BadRequestException);
    await budgetOperations(kind).copyBudgetColumn({ ...copyOp, dryRun: false, acceptCalendarChanges: true }, null, { manager: runner.manager });
    const destination = (await findVersion(runner, kind, itemId, NEXT))!;
    const copied = (await readRecords(runner, kind, destination.id)).planned;
    assert.deepEqual([copied.method, copied.fte, 'lines_result' in copied.last_calculation], ['copied', '0.75', false], `${kind}: the source's FTE, no result`);
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [l.label, l.working_day_profile_id, l.period_end]),
      [['Consultant', calendarId, `${NEXT}-12-31`], ['Developer', calendarId, `${NEXT}-06-30`], ['Licences', null, `${NEXT}-12-31`]],
      `${kind}: the lines shifted as they are`,
    );
  });
}

/**
 * The item ends during the destination year: like a copy of followed lines,
 * each reference line is cut to the validity and a line left without a month
 * is dropped; with no line left, the column keeps none and no FTE.
 */
async function testCopyOfReferenceLinesWithinValidity(kind: Kind) {
  await withStaffLines(kind, 'copy-validity', async ({ runner, tenantId, itemId, versionId, calendarId }) => {
    // Licences from July only: cut out by an end of validity in March.
    await writeLines(runner, kind, versionId, [
      ...staffLines(calendarId).slice(0, 2),
      { ...staffLines(calendarId)[2], period_start: `${YEAR}-07-01` },
    ]);
    await handEdit(runner, kind, versionId);
    await setItemDates(runner, kind, itemId, { disabledAt: `${NEXT}-03-31T12:00:00Z` });
    await budgetOperations(kind).copyBudgetColumn({ ...copyOp, dryRun: false }, null, { manager: runner.manager });
    const destination = (await findVersion(runner, kind, itemId, NEXT))!;
    const copied = (await readRecords(runner, kind, destination.id)).planned;
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [l.label, l.period_start, l.period_end]),
      [['Consultant', `${NEXT}-01-01`, `${NEXT}-03-31`], ['Developer', `${NEXT}-01-01`, `${NEXT}-03-31`]],
      `${kind}: cut to the validity, the licences dropped`,
    );
    // (0.3125 + 1) × 3 months ÷ 12 = 0.328125.
    assert.deepEqual([copied.fte, copied.last_calculation.lines_result.fte, copied.last_calculation.lines_result.active_months], ['0.33', '0.33', [1, 2, 3]]);
    assert.deepEqual([copied.period_start, copied.period_end], [`${NEXT}-01-01`, `${NEXT}-03-31`]);

    // No line within the validity: amounts copied, no line, no FTE, no result.
    const late = await seedLine(runner, kind, tenantId, YEAR, {}, 2);
    await writeLines(runner, kind, late.versionId, [{ ...staffLines(calendarId)[2], period_start: `${YEAR}-07-01` }]);
    await upsert(runner, kind, late.versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), planned: 50 }] });
    await setItemDates(runner, kind, late.itemId, { disabledAt: `${NEXT}-03-31T12:00:00Z` });
    await budgetOperations(kind).copyBudgetColumn({ ...copyOp, dryRun: false, overwrite: true }, null, { manager: runner.manager });
    const lateDestination = (await findVersion(runner, kind, late.itemId, NEXT))!;
    const lateCopied = (await readRecords(runner, kind, lateDestination.id)).planned;
    assert.deepEqual([lateCopied.method, lateCopied.fte, 'lines_result' in lateCopied.last_calculation], ['copied', null, false]);
    assert.deepEqual(await readLines(runner, kind, lateDestination.id, 'planned'), [], `${kind}: no line left`);
    assert.equal((await readMeasure(runner, kind, lateDestination.id, 'planned', NEXT))[0], '50.00', `${kind}: the amounts are copied`);
  });
}

void runSpecs('round-lines-result.integration.spec', KINDS.flatMap((kind) => [
  [`testSpreadsCarryTheResult(${kind})`, () => testSpreadsCarryTheResult(kind)],
  [`testSpreadOverHandEdit(${kind})`, () => testSpreadOverHandEdit(kind)],
  [`testRemovingOrFollowingTheLines(${kind})`, () => testRemovingOrFollowingTheLines(kind)],
  [`testBudgetFileLoadCarriesTheResult(${kind})`, () => testBudgetFileLoadCarriesTheResult(kind)],
  [`testCopyOfReferenceLines(${kind})`, () => testCopyOfReferenceLines(kind)],
  [`testCopyOfReferenceLinesFallback(${kind})`, () => testCopyOfReferenceLinesFallback(kind)],
  [`testCopyOfReferenceLinesMissingCalendar(${kind})`, () => testCopyOfReferenceLinesMissingCalendar(kind)],
  [`testCopyOfReferenceLinesWithinValidity(${kind})`, () => testCopyOfReferenceLinesWithinValidity(kind)],
] as Array<[string, () => Promise<void>]>));

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
