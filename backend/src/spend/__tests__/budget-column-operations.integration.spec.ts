import 'dotenv/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { copiedMonths, periodWithinValidity, shiftLines, shiftPeriod, validityInYear } from '../budget-column-operations';
import { Decimal } from '../../common/decimal';
import { upsertRoundInput } from '../round-inputs.util';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { auditTableOf } from '../budget-nature';
import {
  amountsService,
  assert,
  budgetOperations,
  captureAudit,
  findVersion,
  freezeColumn,
  inRolledBackTransaction,
  Kind,
  period,
  readLines,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedCalendar,
  seedLine,
  seedMonths,
  seedTenant,
  seedVersion,
  setBudgetColumns,
  setItemDates,
  TABLES,
  underSavepoint,
} from './round-inputs.fixtures';

// Copy and clear of a budget column on OPEX and CAPEX: the monthly shape is
// kept, an uplift rounds to whole units (truncated toward zero, the units
// left to the largest dropped fractions, no month changes sign), the period
// follows the copy, and both operations are all or nothing. A copy writes
// only the lines valid in the destination year, prorated to the months of
// their validity; a clear runs on every line.

const YEAR = 2031;
const KINDS: Kind[] = ['opex', 'capex'];

type CopyOp = {
  sourceYear: number;
  sourceColumn: string;
  destinationYear: number;
  destinationColumn: string;
  percentageIncrease: number | string;
  overwrite?: boolean;
  dryRun?: boolean;
  acceptCalendarChanges?: boolean;
};

function copy(kind: Kind, runner: QueryRunner, op: CopyOp, audit = captureAudit(), freeze?: unknown) {
  return budgetOperations(kind, audit, freeze).copyBudgetColumn(
    { overwrite: false, dryRun: false, ...op },
    null,
    { manager: runner.manager },
  );
}

async function spreadRecord(
  runner: QueryRunner, kind: Kind, tenantId: string, versionId: string, year: number, start: string, end: string, measure = 'planned',
) {
  await upsertRoundInput(
    { manager: runner.manager, scope: kind, version: { id: versionId, tenant_id: tenantId, budget_year: year }, userId: null, audit: captureAudit() },
    measure,
    { period_start: start, period_end: end, method: 'spread', spread_profile_name: '4-4-5', last_calculation: null, fte: null },
  );
}

const IRREGULAR = ['0', '0', '0', '100.10', '0.01', '250.55', '0', '-10.00', '999.99', '0', '0', '1.25'];
const IRREGULAR_STORED = IRREGULAR.map((v) => Number(v).toFixed(2));

/** Pure checks of the arithmetic, including the D3 vectors. */
async function testCopyArithmetic() {
  const cents = (values: string[]) => values.map((v) => BigInt(Math.round(Number(v) * 100)));
  const units = (months: bigint[]) => months.map((m) => Number(m) / 100);
  // 0 %: exact.
  assert.deepEqual(copiedMonths(cents(IRREGULAR), Decimal.from(0)), cents(IRREGULAR));
  // 12 000 over April to December, +2 % → 1 360 × 9 = 12 240.
  const milestone = [0n, 0n, 0n, ...repeat(133_333n, 8), 133_336n];
  assert.deepEqual(units(copiedMonths(milestone, Decimal.from(2))), [0, 0, 0, ...repeat(1360, 9)]);
  // 100.40 × 12, +2.5 %: 102.91 each → 102, round(1 234.92) = 1 235 leaves 11 units, ties go to the latest months.
  assert.deepEqual(units(copiedMonths(repeat(10_040n, 12), Decimal.from('2.5'))), [102, ...repeat(103, 11)]);
  // −3 % on January to June: 97.388 → 97, round(584.328) = 584 leaves 2 units for May and June; July to December stay zero.
  assert.deepEqual(units(copiedMonths([...repeat(10_040n, 6), ...repeat(0n, 6)], Decimal.from(-3))), [...repeat(97, 4), 98, 98, ...repeat(0, 6)]);
  // Half away from zero on a whole unit: 1.00 +50 % is 1.50, so 2; −1.00 +50 % is −2; each sign group rounds its own total.
  assert.deepEqual(units(copiedMonths([100n], Decimal.from(50))), [2]);
  assert.deepEqual(units(copiedMonths([-100n], Decimal.from(50))), [-2]);
  assert.deepEqual(units(copiedMonths([100n, -100n], Decimal.from(50))), [2, -2]);
  // 0.60 × 12, +0.1 %: 0.6006 each → 0, round(7.2072) = 7 units for the seven latest months, never a negative month.
  assert.deepEqual(units(copiedMonths(repeat(60n, 12), Decimal.from('0.1'))), [...repeat(0, 5), ...repeat(1, 7)]);
  // 0.50 × 12, +1 %: 0.505 each → 0, round(6.06) = 6 units for the six latest months.
  assert.deepEqual(units(copiedMonths(repeat(50n, 12), Decimal.from(1))), [...repeat(0, 6), ...repeat(1, 6)]);
  // A credit note mirrors it: −0.60 × 12 gives −1 to the seven latest months.
  assert.deepEqual(units(copiedMonths(repeat(-60n, 12), Decimal.from('0.1'))), [...repeat(0, 5), ...repeat(-1, 7)]);
  // Mixed signs, 100.40 × 11 and a credit of −50.40 in December, +2.5 %: the positive months share
  // round(1 132.01) = 1 132 (102 in January, 103 after), the credit round(−51.66) = −52; 1 080 for the year.
  const mixed = copiedMonths([...repeat(10_040n, 11), -5_040n], Decimal.from('2.5'));
  assert.deepEqual(units(mixed), [102, ...repeat(103, 10), -52]);
  assert.equal(mixed.reduce((a, b) => a + b, 0n), 108_000n);
  // Mixed signs where the groups overshoot: 0.60 × 11 and −0.40, +0.1 %. The positive months would take
  // round(6.6066) = 7 and the credit round(−0.4004) = 0, but the year is round(6.2062) = 6: the positive
  // group, rounded away from zero, gives one unit back. The credit month becomes 0, never positive.
  assert.deepEqual(units(copiedMonths([...repeat(60n, 11), -40n], Decimal.from('0.1'))), [...repeat(0, 5), ...repeat(1, 6), 0]);
  // Periods: shifted by the year delta, 29 February clamps to 28, 28 February stays 28.
  assert.deepEqual(shiftPeriod({ period_start: '2032-02-29', period_end: '2032-12-31' }, 1), { period_start: '2033-02-28', period_end: '2033-12-31' });
  assert.deepEqual(shiftPeriod({ period_start: '2031-02-28', period_end: '2031-11-30' }, 1), { period_start: '2032-02-28', period_end: '2032-11-30' });
  assert.deepEqual(shiftPeriod({ period_start: '2031-04-01', period_end: '2031-12-31' }, -1), { period_start: '2030-04-01', period_end: '2030-12-31' });
  // Lines: each period shifted to the destination year the same way; quantity, price, how often, days per month and calendar kept.
  const stored = (period_start: string, period_end: string) => ({
    id: 'x', sort: 1, label: 'Licences', quantity_unit: 'pieces' as const, quantity: '10', unit_price: '200', price_basis: 'per_piece' as const,
    frequency: 'per_month' as const, days_per_month: null,
    period_start, period_end, working_day_profile_id: null, working_day_profile_code: null, working_day_profile_name: null,
  });
  const leap = { lines: [stored('2032-02-29', '2032-03-31'), stored('2032-01-01', '2032-02-29')] };
  const periods = (year: number) => shiftLines(leap, year).map((l) => [l.period_start, l.period_end]);
  assert.deepEqual(periods(2033), [['2033-02-28', '2033-03-31'], ['2033-01-01', '2033-02-28']], '29 February becomes 28 February');
  assert.deepEqual(periods(2036), [['2036-02-29', '2036-03-31'], ['2036-01-01', '2036-02-29']], 'a leap year keeps it');
  assert.deepEqual(periods(2030), [['2030-02-28', '2030-03-31'], ['2030-01-01', '2030-02-28']], 'backwards too');
  assert.deepEqual(shiftLines(leap, 2033)[0], {
    label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '200', price_basis: 'per_piece', frequency: 'per_month',
    days_per_month: null, period_start: '2033-02-28', period_end: '2033-03-31', working_day_profile_id: null,
  });
  // A person 5 days a month and a laptop on one date: how often and the days per month travel; one date stays one date.
  const person = {
    ...stored('2032-02-01', '2032-07-31'), label: 'Project manager', quantity_unit: 'people' as const, quantity: '1', unit_price: '1200',
    price_basis: 'per_day' as const, days_per_month: '5', working_day_profile_id: 'cal', working_day_profile_code: 'FR', working_day_profile_name: 'France',
  };
  const laptop = { ...stored('2032-02-29', '2032-02-29'), label: 'Laptop', quantity: '1', unit_price: '2000', frequency: 'once' as const };
  assert.deepEqual(shiftLines({ lines: [person, laptop] }, 2033).map((l) => [l.label, l.frequency, l.days_per_month, l.period_start, l.period_end]), [
    ['Project manager', 'per_month', '5', '2033-02-01', '2033-07-31'],
    ['Laptop', 'once', null, '2033-02-28', '2033-02-28'],
  ]);
  assert.deepEqual(shiftLines(undefined, 2033), [], 'no source record, no lines');
}

/** 0 %: every month copied to the cent, the period shifted, provenance recorded, the grain of the source kept. */
async function testCopyKeepsTheShape(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-copy`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: IRREGULAR });
    await runner.query(`UPDATE ${TABLES[kind].versions} SET input_grain = 'quarterly' WHERE id = $1`, [versionId]);
    await spreadRecord(runner, kind, tenantId, versionId, YEAR, `${YEAR}-04-01`, `${YEAR}-12-31`);

    const preview = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0, dryRun: true });
    assert.deepEqual(preview.results.map((r: any) => [r.sourceValue, r.currentDestinationValue, r.newValue]), [[1341.9, 0, 1341.9]], `${kind}: dry run keeps the cents`);
    assert.equal(await findVersion(runner, kind, itemId, YEAR + 1), undefined, `${kind}: dry run writes nothing`);

    const audit = captureAudit();
    const result = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: '0' }, audit);
    assert.deepEqual(result.summary, { totalItems: 1, processed: 1, skipped: 0, errors: 0 });
    const destination = await findVersion(runner, kind, itemId, YEAR + 1);
    assert.ok(destination, `${kind}: destination version created`);
    assert.equal(destination!.input_grain, 'quarterly', `${kind}: the new version takes the source's grain`);
    assert.deepEqual(await readMeasure(runner, kind, destination!.id, 'planned', YEAR + 1), IRREGULAR_STORED, `${kind}: months copied to the cent`);
    const { planned } = await readRecords(runner, kind, destination!.id);
    assert.deepEqual(
      [planned.method, planned.period_start, planned.period_end, planned.spread_profile_name],
      ['copied', `${YEAR + 1}-04-01`, `${YEAR + 1}-12-31`, '4-4-5'],
    );
    assert.deepEqual(planned.last_calculation, {
      kind: 'copy', source_year: YEAR, source_measure: 'planned', uplift_pct: '0', source_total: '1341.90', total: '1341.90', source_method: 'spread',
    });
    const roundAudit = audit.entries.find((e) => e.table.endsWith('_round_inputs'));
    assert.equal(roundAudit?.action, 'create', `${kind}: the record is audited`);
  });
}

/** Milestone: Budget 12 000 over April to December, +2 % → same shape, 12 240, period April to December next year. */
async function testCopyWithUplift(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-uplift`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await amountsService(kind).bulkUpsert(
      versionId,
      { kind: 'annual', year: YEAR, totals: { planned: 12000 }, period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31` },
      null,
      { manager: runner.manager },
    );
    // A second line: 100.40 × 12 into Revision, copied with +2.5 % below.
    const second = await seedLine(runner, kind, tenantId, YEAR, { committed: repeat('100.40', 12) }, 2);

    const preview = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 2, dryRun: true });
    const milestone = preview.results.find((r: any) => r.itemId === itemId);
    assert.deepEqual([milestone.sourceValue, milestone.newValue], [12000, 12240], `${kind}: preview of the milestone`);

    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 2 });
    const destination = await findVersion(runner, kind, itemId, YEAR + 1);
    assert.deepEqual(await readMeasure(runner, kind, destination!.id, 'planned', YEAR + 1), ['0.00', '0.00', '0.00', ...repeat('1360.00', 9)]);
    const { planned } = await readRecords(runner, kind, destination!.id);
    assert.deepEqual([planned.period_start, planned.period_end, planned.method], [`${YEAR + 1}-04-01`, `${YEAR + 1}-12-31`, 'copied']);
    assert.deepEqual(
      [planned.last_calculation.uplift_pct, planned.last_calculation.source_total, planned.last_calculation.total, planned.last_calculation.source_method],
      ['2', '12000.00', '12240.00', 'spread'],
    );

    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'revision', destinationYear: YEAR + 2, destinationColumn: 'revision', percentageIncrease: '2.5' });
    const secondDestination = await findVersion(runner, kind, second.itemId, YEAR + 2);
    assert.deepEqual(await readMeasure(runner, kind, secondDestination!.id, 'committed', YEAR + 2), ['102.00', ...repeat('103.00', 11)]);
    const { committed } = await readRecords(runner, kind, secondDestination!.id);
    assert.deepEqual(
      [committed.period_start, committed.period_end, committed.last_calculation.total, committed.last_calculation.source_method],
      [`${YEAR + 2}-01-01`, `${YEAR + 2}-12-31`, '1235.00', null],
      `${kind}: a source without a record copies to the whole year`,
    );

    // A negative uplift: whole units, the two units left on the latest months with an amount (May and June).
    const third = await seedLine(runner, kind, tenantId, YEAR, { expected_landing: [...repeat('100.40', 6), ...repeat('0', 6)] }, 3);
    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'landing', destinationYear: YEAR, destinationColumn: 'budget', percentageIncrease: '-3', overwrite: true });
    assert.deepEqual(
      await readMeasure(runner, kind, third.versionId, 'planned', YEAR),
      [...repeat('97.00', 4), '98.00', '98.00', ...repeat('0.00', 6)],
    );
  });
}

/** The period follows the copy (29 February becomes 28); Actuals copy and are copied like any column. */
async function testCopyPeriodsAndActuals(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-leap`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, 2032, { planned: repeat('10', 12), actual: repeat('7', 12) });
    await spreadRecord(runner, kind, tenantId, versionId, 2032, '2032-02-29', '2032-12-31');

    await copy(kind, runner, { sourceYear: 2032, sourceColumn: 'budget', destinationYear: 2033, destinationColumn: 'budget', percentageIncrease: 0 });
    const next = await findVersion(runner, kind, itemId, 2033);
    const leap = (await readRecords(runner, kind, next!.id)).planned;
    assert.deepEqual([leap.period_start, leap.period_end], ['2033-02-28', '2033-12-31'], `${kind}: 29 February becomes 28`);

    // Actuals as the source, without a record: whole-year period, like any column without one.
    await copy(kind, runner, { sourceYear: 2032, sourceColumn: 'follow_up', destinationYear: 2033, destinationColumn: 'landing', percentageIncrease: 0 });
    let landing = (await readRecords(runner, kind, next!.id)).expected_landing;
    assert.deepEqual(
      [landing.period_start, landing.period_end, landing.last_calculation.source_measure, landing.last_calculation.source_method],
      ['2033-01-01', '2033-12-31', 'actual', null],
    );
    assert.deepEqual(await readMeasure(runner, kind, next!.id, 'expected_landing', 2033), repeat('7.00', 12));

    // Actuals as the source, with a record: its period is shifted like any other.
    await spreadRecord(runner, kind, tenantId, versionId, 2032, '2032-03-01', '2032-09-30', 'actual');
    await copy(kind, runner, { sourceYear: 2032, sourceColumn: 'follow_up', destinationYear: 2033, destinationColumn: 'landing', percentageIncrease: 0, overwrite: true });
    landing = (await readRecords(runner, kind, next!.id)).expected_landing;
    assert.deepEqual(
      [landing.method, landing.period_start, landing.period_end, landing.last_calculation.source_method],
      ['copied', '2033-03-01', '2033-09-30', 'spread'],
      `${kind}: the Actuals period follows the copy`,
    );

    // Actuals as the destination: months copied and the copied record written.
    await copy(kind, runner, { sourceYear: 2032, sourceColumn: 'budget', destinationYear: 2033, destinationColumn: 'follow_up', percentageIncrease: 0, overwrite: true });
    assert.deepEqual(await readMeasure(runner, kind, next!.id, 'actual', 2033), repeat('10.00', 12));
    const actual = (await readRecords(runner, kind, next!.id)).actual;
    assert.deepEqual(
      [actual.method, actual.period_start, actual.period_end, actual.last_calculation.source_measure],
      ['copied', '2033-02-28', '2033-12-31', 'planned'],
      `${kind}: Actuals get the copied record`,
    );

    // Clearing Actuals deletes its record.
    const cleared = await budgetOperations(kind).clearBudgetColumn({ year: 2033, column: 'follow_up' }, null, { manager: runner.manager });
    assert.equal(cleared.summary.cleared, 1);
    assert.deepEqual(await readMeasure(runner, kind, next!.id, 'actual', 2033), repeat('0.00', 12));
    assert.equal((await readRecords(runner, kind, next!.id)).actual, undefined, `${kind}: clear deletes the Actuals record`);
  });
}

/** Skips, refusals and freezes. */
async function testCopySkipsAndRefusals(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-skip`);
    const { itemId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12), committed: repeat('0', 12) });
    const destination = await seedVersion(runner, kind, tenantId, itemId, YEAR + 1);
    await seedMonths(runner, kind, tenantId, destination, YEAR + 1, { planned: repeat('5', 12) });

    await assert.rejects(
      () => copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR, destinationColumn: 'budget', percentageIncrease: 0 }),
      BadRequestException,
      `${kind}: copy onto itself`,
    );
    await assert.rejects(
      () => copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 'abc' }),
      BadRequestException,
      `${kind}: percentage that is not a number`,
    );
    // −100 % or less would copy zeros or turn every month's sign: refused, dry run included; just above is fine.
    for (const percentageIncrease of [-100, '-100.00', -150, '-1000']) {
      await assert.rejects(
        () => copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease, overwrite: true, dryRun: true }),
        (err: any) => err instanceof BadRequestException && err.message === 'The percentage must be above -100 %, or the copied amounts would be zero or change sign.',
        `${kind}: ${percentageIncrease} % refused`,
      );
    }
    const almostAll = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: '-99.9', overwrite: true, dryRun: true });
    assert.deepEqual(almostAll.results.map((r: any) => r.newValue), [0], `${kind}: -99.9 % of 120 rounds to 0`);
    const noOverwrite = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 });
    assert.deepEqual([noOverwrite.summary.processed, noOverwrite.summary.skipped], [0, 1], `${kind}: destination has amounts, no overwrite`);
    const zeroSource = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'revision', destinationYear: YEAR + 1, destinationColumn: 'revision', percentageIncrease: 0 });
    assert.deepEqual([zeroSource.summary.processed, zeroSource.summary.skipped], [0, 1], `${kind}: all-zero source`);
    assert.deepEqual(await readMeasure(runner, kind, destination, 'planned', YEAR + 1), repeat('5.00', 12));

    await freezeColumn(runner, kind, tenantId, YEAR + 1, 'budget');
    await assert.rejects(
      () => copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0, overwrite: true }, captureAudit(), realFreeze()),
      ForbiddenException,
      `${kind}: frozen destination`,
    );
    assert.deepEqual(await readMeasure(runner, kind, destination, 'planned', YEAR + 1), repeat('5.00', 12));
  });
}

/** A failure on one item fails the whole request; the request transaction then leaves every item as it was. */
async function testCopyAndClearAreAllOrNothing(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-atomic`);
    const first = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) }, 1);
    const second = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('20', 12) }, 2);
    const itemTable = kind === 'opex' ? 'spend_items' : 'capex_items';
    const failOnSecondItem = () => {
      let seen = 0;
      return captureAudit((entry) => entry.table === itemTable && ++seen === 2);
    };

    await assert.rejects(
      () => underSavepoint(runner, () => copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 }, failOnSecondItem())),
      /forced failure/,
      `${kind}: copy fails as a whole`,
    );
    assert.equal(await findVersion(runner, kind, first.itemId, YEAR + 1), undefined, `${kind}: copy left the first item unchanged`);
    assert.equal(await findVersion(runner, kind, second.itemId, YEAR + 1), undefined, `${kind}: copy left the second item unchanged`);

    await assert.rejects(
      () => underSavepoint(runner, () => budgetOperations(kind, failOnSecondItem()).clearBudgetColumn({ year: YEAR, column: 'budget' }, null, { manager: runner.manager })),
      /forced failure/,
      `${kind}: clear fails as a whole`,
    );
    assert.deepEqual(await readMeasure(runner, kind, first.versionId, 'planned', YEAR), repeat('10.00', 12));
    assert.deepEqual(await readMeasure(runner, kind, second.versionId, 'planned', YEAR), repeat('20.00', 12));
  });
}

/** Clear: twelve zeros, the record deleted, other measures and years untouched. */
async function testClear(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-clear`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12), committed: repeat('3', 12) });
    await spreadRecord(runner, kind, tenantId, versionId, YEAR, `${YEAR}-04-01`, `${YEAR}-12-31`);
    const nextYear = await seedVersion(runner, kind, tenantId, itemId, YEAR + 1);
    await seedMonths(runner, kind, tenantId, nextYear, YEAR + 1, { planned: repeat('4', 12) });
    await spreadRecord(runner, kind, tenantId, nextYear, YEAR + 1, `${YEAR + 1}-01-01`, `${YEAR + 1}-12-31`);
    // A second line whose Budget is already zero but carries a record.
    const empty = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('0', 12) }, 2);
    await spreadRecord(runner, kind, tenantId, empty.versionId, YEAR, `${YEAR}-01-01`, `${YEAR}-12-31`);

    const audit = captureAudit();
    const result = await budgetOperations(kind, audit).clearBudgetColumn({ year: YEAR, column: 'budget' }, null, { manager: runner.manager });
    assert.deepEqual(result.summary, { totalItems: 2, cleared: 1, skipped: 1, errors: 0 });
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12));
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'committed', YEAR), repeat('3.00', 12), `${kind}: other measures untouched`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: record deleted`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, empty.versionId)), [], `${kind}: record of a skipped version deleted too`);
    assert.deepEqual(await readMeasure(runner, kind, nextYear, 'planned', YEAR + 1), repeat('4.00', 12), `${kind}: other years untouched`);
    assert.equal((await readRecords(runner, kind, nextYear)).planned.method, 'spread', `${kind}: other years keep their record`);
    const deletions = audit.entries.filter((e) => e.table.endsWith('_round_inputs') && e.action === 'delete');
    assert.equal(deletions.length, 2, `${kind}: one audit row per deleted record`);
    assert.ok(deletions.every((e) => typeof e.recordId === 'string' && e.before?.measure === 'planned' && e.after === null));
  });
}

/**
 * The dry run says which lines the copy skips, with the server's own rule
 * (per month, not per total): +500 / −500 is copied, a destination holding
 * +50 / −50 counts as not empty.
 */
async function testDryRunSkippedFlag(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-flag`);
    const netZero = await seedLine(runner, kind, tenantId, YEAR, { planned: ['500', '-500', ...repeat('0', 10)] }, 1);
    const busy = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) }, 2);
    const busyNext = await seedVersion(runner, kind, tenantId, busy.itemId, YEAR + 1);
    await seedMonths(runner, kind, tenantId, busyNext, YEAR + 1, { planned: ['50', '-50', ...repeat('0', 10)] });
    const empty = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('0', 12) }, 3);

    const preview = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0, dryRun: true });
    const byItem = new Map(preview.results.map((r: any) => [r.itemId, r]));
    const flags = [netZero.itemId, busy.itemId, empty.itemId].map((id) => {
      const r: any = byItem.get(id);
      return [r.sourceValue, r.currentDestinationValue, r.newValue, r.skipped];
    });
    assert.deepEqual(flags, [[0, 0, 0, false], [120, 0, 0, true], [0, 0, 0, true]], `${kind}: skipped follows the months`);
    assert.deepEqual([preview.summary.processed, preview.summary.skipped], [1, 2]);

    const overwrite = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0, overwrite: true, dryRun: true });
    assert.equal((overwrite.results.find((r: any) => r.itemId === busy.itemId) as any).skipped, false, `${kind}: overwrite copies onto a non-empty destination`);

    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 });
    const copied = await findVersion(runner, kind, netZero.itemId, YEAR + 1);
    assert.deepEqual((await readMeasure(runner, kind, copied!.id, 'planned', YEAR + 1)).slice(0, 3), ['500.00', '-500.00', '0.00'], `${kind}: a net-zero source is copied`);
  });
}

/**
 * Forecast is copied and cleared like any column; a created destination
 * version is named neutrally; an unknown column lists the five API names; a
 * frozen destination is refused with the tenant's name for the column.
 */
async function testForecastCopyAndClear(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-forecast`);
    await setBudgetColumns(runner, tenantId, { labels: { forecast: 'A2' } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { forecast: repeat('7', 12), planned: repeat('1', 12) });

    const copied = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'forecast', destinationYear: YEAR + 1, destinationColumn: 'forecast', percentageIncrease: 0 });
    assert.deepEqual([copied.summary.processed, copied.summary.skipped], [1, 0], `${kind}: forecast copied`);
    const destination = await findVersion(runner, kind, itemId, YEAR + 1);
    assert.deepEqual(await readMeasure(runner, kind, destination!.id, 'forecast', YEAR + 1), repeat('7.00', 12));
    assert.deepEqual(await readMeasure(runner, kind, destination!.id, 'planned', YEAR + 1), repeat('0.00', 12), `${kind}: only the destination column is written`);
    const [{ version_name }] = await runner.query(
      `SELECT version_name FROM ${TABLES[kind].versions} WHERE id = $1`,
      [destination!.id],
    );
    assert.equal(version_name, `Y${YEAR + 1}`, `${kind}: a created version is named after its year`);

    const cleared = await budgetOperations(kind).clearBudgetColumn({ year: YEAR, column: 'forecast' }, null, { manager: runner.manager });
    assert.equal(cleared.summary.cleared, 1, `${kind}: forecast cleared`);
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'forecast', YEAR), repeat('0.00', 12));
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('1.00', 12));

    await assert.rejects(
      () => budgetOperations(kind).clearBudgetColumn({ year: YEAR, column: 'bogus' }, null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && err.message === 'column must be one of budget, revision, forecast, follow_up, landing.',
    );
    await freezeColumn(runner, kind, tenantId, YEAR + 1, 'forecast');
    await assert.rejects(
      () => copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'forecast', percentageIncrease: 0, overwrite: true }, captureAudit(), realFreeze()),
      (err: any) => err instanceof ForbiddenException && err.message === `Copy not allowed: ${kind.toUpperCase()} A2 for ${YEAR + 1} is frozen`,
    );
  });
}

/** Pure checks of the validity window of an item within a year. */
async function testValidityInYear() {
  const months = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
  const at = (effective_start: string | null, end_of_validity: string | null) => validityInYear(2027, { effective_start, end_of_validity });
  assert.deepEqual(at(null, null), { start: '2027-01-01', end: '2027-12-31', months: months(1, 12) });
  assert.deepEqual(at('2020-01-01', null), { start: '2027-01-01', end: '2027-12-31', months: months(1, 12) });
  assert.equal(at('2020-01-01', '2026-12-31'), null, 'ended the year before');
  assert.deepEqual(at('2020-01-01', '2027-06-30'), { start: '2027-01-01', end: '2027-06-30', months: months(1, 6) });
  assert.deepEqual(at('2020-01-01', '2027-06-10'), { start: '2027-01-01', end: '2027-06-10', months: months(1, 5) });
  assert.deepEqual(at('2020-01-01', '2027-06-15')?.months, months(1, 6), 'the 15th counts');
  assert.deepEqual(at('2020-01-01', '2027-02-28')?.months, months(1, 2));
  assert.equal(at('2020-01-01', '2027-01-10'), null, 'no 15th before the end');
  assert.deepEqual(at('2027-04-01', null), { start: '2027-04-01', end: '2027-12-31', months: months(4, 12) });
  assert.deepEqual(at('2027-06-15', null)?.months, months(6, 12));
  assert.deepEqual(at('2027-06-16', null)?.months, months(7, 12));
  assert.equal(at('2027-12-16', null), null, 'starts after the last 15th');
  assert.equal(at('2028-01-01', null), null, 'starts the year after');
  assert.deepEqual(at('2027-03-01', '2027-09-30'), { start: '2027-03-01', end: '2027-09-30', months: months(3, 9) });
  assert.equal(at('2027-09-01', '2027-03-31'), null, 'starts after it ends');

  const window = at('2027-04-01', '2027-10-31')!;
  assert.deepEqual(periodWithinValidity({ period_start: '2027-01-01', period_end: '2027-12-31' }, window), { period_start: '2027-04-01', period_end: '2027-10-31' });
  assert.deepEqual(periodWithinValidity({ period_start: '2027-05-01', period_end: '2027-06-30' }, window), { period_start: '2027-05-01', period_end: '2027-06-30' });
  assert.deepEqual(periodWithinValidity({ period_start: '2027-01-01', period_end: '2027-03-31' }, window), { period_start: '2027-04-01', period_end: '2027-10-31' }, 'no month in common: the validity');
  assert.deepEqual(periodWithinValidity({ period_start: '2027-10-20', period_end: '2027-12-31' }, window), { period_start: '2027-04-01', period_end: '2027-10-31' }, 'days in common but no 15th: the validity');
}

/**
 * A line ending on December 31 of the source year is not valid in the next
 * year: left out of the dry run and of the copy. The end of validity is read
 * as its UTC calendar date, whatever the session time zone.
 */
async function testEndedLineIsNotCopied(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-ended`);
    // UTC+14: 12:00 UTC on December 31 is already January 1 here, 12:00 UTC on June 14 is June 15.
    await runner.query(`SET LOCAL TIME ZONE 'Pacific/Kiritimati'`);
    const ended = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) }, 1);
    await setItemDates(runner, kind, ended.itemId, { disabledAt: `${YEAR}-12-31T12:00:00Z` });
    const fourteenth = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) }, 2);
    await setItemDates(runner, kind, fourteenth.itemId, { disabledAt: `${YEAR + 1}-06-14T12:00:00Z` });
    const open = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) }, 3);

    const op = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 };
    const preview = await copy(kind, runner, { ...op, dryRun: true });
    assert.deepEqual(
      preview.results.map((r: any) => [r.itemId, r.newValue, r.prorated]).sort(),
      [[fourteenth.itemId, 50, true], [open.itemId, 120, false]].sort(),
      `${kind}: the ended line is not in the dry run; June 14 at 12:00 UTC ends before the 15th`,
    );
    assert.deepEqual(preview.summary, { totalItems: 2, processed: 2, skipped: 0, errors: 0 });

    const done = await copy(kind, runner, op);
    assert.deepEqual(done.summary, { totalItems: 2, processed: 2, skipped: 0, errors: 0 });
    assert.equal(await findVersion(runner, kind, ended.itemId, YEAR + 1), undefined, `${kind}: no version for the ended line`);
    const next = await findVersion(runner, kind, fourteenth.itemId, YEAR + 1);
    assert.deepEqual(await readMeasure(runner, kind, next!.id, 'planned', YEAR + 1), [...repeat('10.00', 5), ...repeat('0.00', 7)]);
  });
}

/** Lines ending mid destination year get only their months; the uplift's units left go to the latest months kept. */
async function testCopyProratesTheEnd(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-prorata-end`);
    const june30 = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('100.40', 12) }, 1);
    await setItemDates(runner, kind, june30.itemId, { disabledAt: `${YEAR + 1}-06-30T12:00:00Z` });
    await spreadRecord(runner, kind, tenantId, june30.versionId, YEAR, `${YEAR}-01-01`, `${YEAR}-12-31`);
    const june10 = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) }, 2);
    await setItemDates(runner, kind, june10.itemId, { disabledAt: `${YEAR + 1}-06-10T12:00:00Z` });
    // Amounts only within the validity: nothing is cut, so not prorated.
    const early = await seedLine(runner, kind, tenantId, YEAR, { planned: [...repeat('5', 3), ...repeat('0', 9)] }, 3);
    await setItemDates(runner, kind, early.itemId, { disabledAt: `${YEAR + 1}-06-30T12:00:00Z` });

    const op = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: '2.5' };
    const preview = await copy(kind, runner, { ...op, dryRun: true });
    const byItem = new Map(preview.results.map((r: any) => [r.itemId, [r.sourceValue, r.newValue, r.skipped, r.prorated]]));
    assert.deepEqual(byItem.get(june30.itemId), [1204.8, 617, false, true], `${kind}: 602.40 +2.5 % is 617`);
    assert.deepEqual(byItem.get(june10.itemId), [120, 51, false, true], `${kind}: 50 +2.5 % is 51`);
    assert.deepEqual(byItem.get(early.itemId), [15, 15, false, false], `${kind}: nothing cut`);

    const audit = captureAudit();
    await copy(kind, runner, op, audit);
    const june30Next = await findVersion(runner, kind, june30.itemId, YEAR + 1);
    assert.deepEqual(await readMeasure(runner, kind, june30Next!.id, 'planned', YEAR + 1), ['102.00', ...repeat('103.00', 5), ...repeat('0.00', 6)]);
    let { planned } = await readRecords(runner, kind, june30Next!.id);
    assert.deepEqual([planned.period_start, planned.period_end, planned.last_calculation.total], [`${YEAR + 1}-01-01`, `${YEAR + 1}-06-30`, '617.00']);

    const june10Next = await findVersion(runner, kind, june10.itemId, YEAR + 1);
    assert.deepEqual(await readMeasure(runner, kind, june10Next!.id, 'planned', YEAR + 1), [...repeat('10.00', 4), '11.00', ...repeat('0.00', 7)]);
    ({ planned } = await readRecords(runner, kind, june10Next!.id));
    assert.deepEqual([planned.period_start, planned.period_end], [`${YEAR + 1}-01-01`, `${YEAR + 1}-06-10`], `${kind}: the whole year cut at the end of validity`);

    const itemAudit = (itemId: string) => audit.entries.find((e) => e.table === (kind === 'opex' ? 'spend_items' : 'capex_items') && e.recordId === itemId)?.after;
    assert.equal(itemAudit(june30.itemId)?.prorated, true, `${kind}: the audit says prorated`);
    assert.equal(itemAudit(june10.itemId)?.prorated, true);
    assert.equal('prorated' in itemAudit(early.itemId), false, `${kind}: no prorated flag when nothing is cut`);
  });
}

/** A line starting mid destination year: the months before are zero, the period starts with it. */
async function testCopyProratesTheStart(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-prorata-start`);
    const source = ['0', ...repeat('10', 10), '0'];
    const late = await seedLine(runner, kind, tenantId, YEAR, { planned: source }, 1);
    await setItemDates(runner, kind, late.itemId, { effectiveStart: `${YEAR + 1}-04-01` });
    await spreadRecord(runner, kind, tenantId, late.versionId, YEAR, `${YEAR}-02-01`, `${YEAR}-11-30`);
    // Its source period (January to March) shares no month with the validity: the record takes the validity.
    const apart = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) }, 2);
    await setItemDates(runner, kind, apart.itemId, { effectiveStart: `${YEAR + 1}-04-01` });
    await spreadRecord(runner, kind, tenantId, apart.versionId, YEAR, `${YEAR}-01-01`, `${YEAR}-03-31`);

    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 });
    const lateNext = await findVersion(runner, kind, late.itemId, YEAR + 1);
    assert.deepEqual(await readMeasure(runner, kind, lateNext!.id, 'planned', YEAR + 1), [...repeat('0.00', 3), ...repeat('10.00', 8), '0.00']);
    let { planned } = await readRecords(runner, kind, lateNext!.id);
    assert.deepEqual([planned.period_start, planned.period_end], [`${YEAR + 1}-04-01`, `${YEAR + 1}-11-30`], `${kind}: period start clamped`);

    const apartNext = await findVersion(runner, kind, apart.itemId, YEAR + 1);
    assert.deepEqual(await readMeasure(runner, kind, apartNext!.id, 'planned', YEAR + 1), [...repeat('0.00', 3), ...repeat('10.00', 9)]);
    ({ planned } = await readRecords(runner, kind, apartNext!.id));
    assert.deepEqual([planned.period_start, planned.period_end], [`${YEAR + 1}-04-01`, `${YEAR + 1}-12-31`], `${kind}: no month in common, the validity`);
  });
}

/** Validity follows the destination year, not today: a copy into 2020 keeps a line that ended on 2020-06-30. */
async function testCopyIntoAPastYear(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-past`);
    const line = await seedLine(runner, kind, tenantId, 2020, { expected_landing: repeat('10', 12) });
    await setItemDates(runner, kind, line.itemId, { disabledAt: '2020-06-30T12:00:00Z' });

    const done = await copy(kind, runner, { sourceYear: 2020, sourceColumn: 'landing', destinationYear: 2020, destinationColumn: 'budget', percentageIncrease: 0 });
    assert.deepEqual([done.summary.totalItems, done.summary.processed], [1, 1], `${kind}: the ended line is copied`);
    assert.deepEqual(await readMeasure(runner, kind, line.versionId, 'planned', 2020), [...repeat('10.00', 6), ...repeat('0.00', 6)]);
    const { planned } = await readRecords(runner, kind, line.versionId);
    assert.deepEqual([planned.period_start, planned.period_end], ['2020-01-01', '2020-06-30']);
  });
}

/** Clear runs on every line: amounts of a line that ended long ago are cleared too. */
async function testClearEndedLine(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-clear-ended`);
    const line = await seedLine(runner, kind, tenantId, YEAR, { planned: repeat('10', 12) });
    await setItemDates(runner, kind, line.itemId, { disabledAt: '2020-06-30T12:00:00Z' });

    const result = await budgetOperations(kind).clearBudgetColumn({ year: YEAR, column: 'budget' }, null, { manager: runner.manager });
    assert.deepEqual(result.summary, { totalItems: 1, cleared: 1, skipped: 0, errors: 0 });
    assert.deepEqual(await readMeasure(runner, kind, line.versionId, 'planned', YEAR), repeat('0.00', 12));
  });
}

/** Copy of allocations is all or nothing too: a failure on one item fails the request, nothing is kept. */
async function testCopyAllocationsIsAllOrNothing() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'alloc');
    const [{ id: companyId }] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Allocation test company', 'FR', 'Lyon') RETURNING id`,
      [tenantId],
    );
    const lines = [];
    for (const itemNumber of [1, 2]) {
      const line = await seedLine(runner, 'opex', tenantId, YEAR, { planned: repeat('10', 12) }, itemNumber);
      await runner.query(`UPDATE spend_versions SET allocation_method = 'manual_pct' WHERE id = $1`, [line.versionId]);
      await runner.query(
        `INSERT INTO spend_allocations (tenant_id, version_id, company_id, allocation_pct, is_system_generated) VALUES ($1, $2, $3, 100, false)`,
        [tenantId, line.versionId, companyId],
      );
      lines.push(line);
    }
    const calculator = new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
    const operations = (audit: unknown) => new SpendBudgetOperationsService(
      undefined as any, undefined as any, undefined as any, undefined as any, audit as any, undefined as any, calculator,
    );
    const op = { sourceYear: YEAR, destinationYear: YEAR + 1, overwrite: false, dryRun: false };

    let seen = 0;
    const failOnSecond = captureAudit((entry) => entry.table === 'spend_allocations' && ++seen === 2);
    await assert.rejects(
      () => underSavepoint(runner, () => operations(failOnSecond).copyAllocations(op, null, { manager: runner.manager })),
      /forced failure/,
    );
    for (const line of lines) {
      assert.equal(await findVersion(runner, 'opex', line.itemId, YEAR + 1), undefined, 'no item keeps a copied year');
    }

    // Without a failure both items are copied: the failure above did hit after a first item was written.
    const done = await operations(captureAudit()).copyAllocations(op, null, { manager: runner.manager });
    assert.deepEqual([done.success, done.summary.processed, done.summary.errors], [true, 2, 0]);
    for (const line of lines) {
      const next = await findVersion(runner, 'opex', line.itemId, YEAR + 1);
      const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM spend_allocations WHERE version_id = $1`, [next!.id]);
      assert.equal(n, 1);
    }
  });
}

/* ── Columns that follow their quantity × price lines ─────────────────────── */

const NEXT_DAYS = ['20', '19', '21', '20', '18', '21', '22', '20', '21', '22', '20', '19'];

/** People full time on `calendarId` and licences each month, over the source year. */
function consultantLine(calendarId: string, overrides: Record<string, unknown> = {}) {
  return {
    label: 'Consultant', quantity_unit: 'people', quantity: '2', unit_price: '333.33', price_basis: 'per_day', frequency: 'per_month',
    days_per_month: null, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, working_day_profile_id: calendarId, ...overrides,
  };
}
function licenceLine(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Licences', quantity_unit: 'pieces', quantity: '10', unit_price: '199.99', price_basis: 'per_piece', frequency: 'per_month',
    days_per_month: null, period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, working_day_profile_id: null, ...overrides,
  };
}

async function writeLines(runner: QueryRunner, kind: Kind, versionId: string, lines: unknown[], year = YEAR) {
  await amountsService(kind).bulkUpsert(versionId, { kind: 'lines', year, measure: 'planned', lines }, null, { manager: runner.manager });
}

/** A paying company in `country` for the item, and the tenant's standard calendar of that country; returns the calendar id. */
async function payingCompanyWithStandardCalendar(runner: QueryRunner, kind: Kind, tenantId: string, itemId: string, country: string | null) {
  const [{ id: companyId }] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Paying company', 'FR', 'Lyon') RETURNING id`,
    [tenantId],
  );
  await runner.query(`UPDATE ${TABLES[kind].items} SET paying_company_id = $2 WHERE id = $1`, [itemId, companyId]);
  if (!country) return null;
  const [{ id }] = await runner.query(
    `INSERT INTO working_day_profiles (tenant_id, code, name, days_by_year, status, country_iso)
     VALUES ($1, $2, 'France', '{}'::jsonb, 'enabled', $2) RETURNING id`,
    [tenantId, country],
  );
  return id as string;
}

const itemAudit = (kind: Kind, audit: ReturnType<typeof captureAudit>, itemId: string) =>
  audit.entries.find((e) => e.table === auditTableOf(kind, TABLES[kind].items) && e.recordId === itemId)?.after;

/**
 * A source that follows its lines: the prices take the uplift (exact, 4
 * decimals, half away from zero), the months are computed again with the
 * destination year's days, the column is computed with the FTE of its lines.
 */
async function testCopyRaisesLinePrices(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-lines-uplift`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: repeat('20', 12), [YEAR + 1]: NEXT_DAYS } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, [consultantLine(calendarId), licenceLine()]);
    const op = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: '2.5' };

    // 333.33 × 1.025 = 341.66325 → 341.6633; 199.99 × 1.025 = 204.98975 → 204.9898. January: 20 days × 2 × 341.6633 + 10 × 204.9898.
    const january = 13666.53 + 2049.9;
    const months = NEXT_DAYS.map((d) => Decimal.from(d).mul('683.3266').toCents() + 204990n);
    const total = Number(months.reduce((a, b) => a + b, 0n)) / 100;
    const preview = await copy(kind, runner, { ...op, dryRun: true });
    assert.deepEqual(
      preview.results.map((r: any) => [r.newValue, r.fromLines, r.calendarIssues, r.skipped]),
      [[total, true, [], false]],
      `${kind}: the preview gives the recomputed total`,
    );
    assert.equal(await findVersion(runner, kind, itemId, YEAR + 1), undefined, `${kind}: dry run writes nothing`);

    const audit = captureAudit();
    await copy(kind, runner, op, audit);
    const destination = (await findVersion(runner, kind, itemId, YEAR + 1))!;
    const stored = await readMeasure(runner, kind, destination.id, 'planned', YEAR + 1);
    assert.equal(stored[0], january.toFixed(2));
    assert.deepEqual(stored, months.map((c) => (Number(c) / 100).toFixed(2)), `${kind}: months from the raised prices and next year's days`);
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [l.label, l.quantity, l.unit_price, l.working_day_profile_id, l.period_start, l.period_end]),
      [
        ['Consultant', '2.000', '341.6633', calendarId, `${YEAR + 1}-01-01`, `${YEAR + 1}-12-31`],
        ['Licences', '10.000', '204.9898', null, `${YEAR + 1}-01-01`, `${YEAR + 1}-12-31`],
      ],
    );
    const { planned } = await readRecords(runner, kind, destination.id);
    assert.deepEqual(
      [planned.method, planned.fte, planned.last_calculation.kind, planned.last_calculation.total, planned.period_start, planned.period_end],
      ['computed', '2.00', 'computed', total.toFixed(2), `${YEAR + 1}-01-01`, `${YEAR + 1}-12-31`],
      `${kind}: the column follows its lines`,
    );
    const after = itemAudit(kind, audit, itemId);
    assert.deepEqual([after.from_lines, after.operation, after.calendar_issues], [true, 'budget_column_copy', undefined], `${kind}: the audit keeps the copy origin`);
  });
}

/** A calendar without days for the destination year: the paying company's standard calendar replaces it, after confirmation. */
async function testCopyLinesCalendarFallback(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-lines-fallback`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: repeat('20', 12) } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, [consultantLine(calendarId, { quantity: '1', unit_price: '100' })]);
    const franceId = await payingCompanyWithStandardCalendar(runner, kind, tenantId, itemId, 'FR');
    const op = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 };

    const issue = { line: 'Consultant', lineNumber: 1, calendar: 'Custom', kind: 'fallback', fallback: 'France' };
    const preview = await copy(kind, runner, { ...op, dryRun: true });
    assert.deepEqual(preview.results.map((r: any) => [r.fromLines, r.calendarIssues]), [[true, [issue]]], `${kind}: the preview names the fallback`);

    await assert.rejects(
      () => copy(kind, runner, op),
      (err: any) => err instanceof BadRequestException
        && err.message === `Some lines use a calendar with no working days for ${YEAR + 1}. Run the preview, then confirm.`,
      `${kind}: refused without the confirmation`,
    );
    assert.equal(await findVersion(runner, kind, itemId, YEAR + 1), undefined, `${kind}: the refusal wrote nothing`);

    const audit = captureAudit();
    await copy(kind, runner, { ...op, acceptCalendarChanges: true }, audit);
    const destination = (await findVersion(runner, kind, itemId, YEAR + 1))!;
    const [line] = await readLines(runner, kind, destination.id, 'planned');
    assert.equal(line.working_day_profile_id, franceId, `${kind}: the line takes the standard calendar`);
    const [france] = await runner.query(`SELECT days_by_year FROM working_day_profiles WHERE id = $1`, [franceId]);
    assert.deepEqual(france.days_by_year, {}, 'harness: the standard calendar follows the public holidays');
    const { planned } = await readRecords(runner, kind, destination.id);
    assert.deepEqual([planned.method, planned.last_calculation.lines[0].working_day_profile_name], ['computed', 'France']);
    const days = planned.last_calculation.lines[0].day_counts as string[];
    assert.deepEqual(
      await readMeasure(runner, kind, destination.id, 'planned', YEAR + 1),
      days.map((d) => (Number(d) * 100).toFixed(2)),
      `${kind}: months from the standard calendar's days`,
    );
    assert.deepEqual(itemAudit(kind, audit, itemId).calendar_issues, [issue], `${kind}: the audit keeps the calendar change`);
  });
}

/** No replacement calendar: refused without the confirmation; with it, the item is copied the old way. */
async function testCopyLinesMissingCalendar(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-lines-missing`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: repeat('20', 12) } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, [consultantLine(calendarId, { quantity: '1', unit_price: '100' }), licenceLine({ label: '' })]);
    // A paying company without a standard calendar of its country.
    await payingCompanyWithStandardCalendar(runner, kind, tenantId, itemId, null);
    const op = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 5 };

    const preview = await copy(kind, runner, { ...op, dryRun: true });
    // 2 000 + 1 999.90 a month, +5 %: 4 199.895 a month, whole units.
    assert.deepEqual(
      preview.results.map((r: any) => [r.newValue, r.fromLines, r.calendarIssues]),
      [[50399, false, [{ line: 'Consultant', lineNumber: 1, calendar: 'Custom', kind: 'missing' }]]],
      `${kind}: the preview says the item is copied without recalculation`,
    );
    await assert.rejects(() => copy(kind, runner, op), BadRequestException, `${kind}: refused without the confirmation`);

    await copy(kind, runner, { ...op, acceptCalendarChanges: true });
    const destination = (await findVersion(runner, kind, itemId, YEAR + 1))!;
    const { planned } = await readRecords(runner, kind, destination.id);
    assert.deepEqual([planned.method, planned.last_calculation.kind, planned.last_calculation.total], ['copied', 'copy', '50399.00']);
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [l.unit_price, l.working_day_profile_id]),
      [['100.0000', calendarId], ['199.9900', null]],
      `${kind}: the lines stay as they are, a reference`,
    );
  });
}

/** A disabled calendar that has the days is still used: the copy goes through with the issue, no confirmation needed. */
async function testCopyLinesDisabledCalendar(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-lines-disabled`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Old calendar', days_by_year: { [YEAR]: repeat('20', 12), [YEAR + 1]: NEXT_DAYS } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, [consultantLine(calendarId, { quantity: '1', unit_price: '100' })]);
    await runner.query(`UPDATE working_day_profiles SET status = 'disabled', disabled_at = '2020-01-01T12:00:00Z' WHERE id = $1`, [calendarId]);
    const op = { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 };

    const issue = { line: 'Consultant', lineNumber: 1, calendar: 'Old calendar', kind: 'disabled' };
    const preview = await copy(kind, runner, { ...op, dryRun: true });
    assert.deepEqual(preview.results.map((r: any) => [r.fromLines, r.calendarIssues]), [[true, [issue]]]);

    const audit = captureAudit();
    await copy(kind, runner, op, audit);
    const destination = (await findVersion(runner, kind, itemId, YEAR + 1))!;
    assert.deepEqual(await readMeasure(runner, kind, destination.id, 'planned', YEAR + 1), NEXT_DAYS.map((d) => `${d}00.00`));
    assert.equal((await readRecords(runner, kind, destination.id)).planned.method, 'computed');
    assert.deepEqual(itemAudit(kind, audit, itemId).calendar_issues, [issue]);
  });
}

/** Lines that are only a reference (the column was edited by hand) are copied as they are: months × uplift, prices untouched. */
async function testCopyReferenceLinesUnchanged(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-lines-reference`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, [licenceLine({ unit_price: '100', quantity: '1' })]);
    await amountsService(kind).bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), planned: 300 }] }, null, { manager: runner.manager });
    assert.equal((await readRecords(runner, kind, versionId)).planned.method, 'manual', 'harness: the lines are a reference');

    const preview = await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 10, dryRun: true });
    assert.deepEqual(preview.results.map((r: any) => [r.newValue, r.fromLines, r.calendarIssues]), [[1540, false, []]]);
    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 10 });
    const destination = (await findVersion(runner, kind, itemId, YEAR + 1))!;
    assert.deepEqual(await readMeasure(runner, kind, destination.id, 'planned', YEAR + 1), ['330.00', ...repeat('110.00', 11)]);
    assert.equal((await readRecords(runner, kind, destination.id)).planned.method, 'copied');
    assert.deepEqual((await readLines(runner, kind, destination.id, 'planned')).map((l) => l.unit_price), ['100.0000'], `${kind}: the reference price is untouched`);
  });
}

/**
 * The item ends during the destination year: each line is cut to its
 * validity, a line left without a month is dropped, a bundle bought once
 * keeps its whole quantity on the months left. A price over the limit after
 * the increase fails the request, naming the item.
 */
async function testCopyLinesWithinValidity(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-lines-validity`);
    const calendarId = await seedCalendar(runner, tenantId, { code: 'C', name: 'Custom', days_by_year: { [YEAR]: repeat('20', 12), [YEAR + 1]: NEXT_DAYS } });
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR);
    await writeLines(runner, kind, versionId, [
      licenceLine({ quantity: '1', unit_price: '100' }),
      licenceLine({ label: 'Summer interns', quantity: '1', unit_price: '50', period_start: `${YEAR}-07-01`, period_end: `${YEAR}-08-31` }),
      { label: 'Audit', quantity_unit: 'days', quantity: '12', unit_price: '100', price_basis: 'per_day', frequency: 'once',
        period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, working_day_profile_id: calendarId },
    ]);
    await setItemDates(runner, kind, itemId, { disabledAt: `${YEAR + 1}-03-31T12:00:00Z` });

    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 1, destinationColumn: 'budget', percentageIncrease: 0 });
    const destination = (await findVersion(runner, kind, itemId, YEAR + 1))!;
    assert.deepEqual(
      (await readLines(runner, kind, destination.id, 'planned')).map((l) => [l.label, l.quantity, l.period_start, l.period_end]),
      [['Licences', '1.000', `${YEAR + 1}-01-01`, `${YEAR + 1}-03-31`], ['Audit', '12.000', `${YEAR + 1}-01-01`, `${YEAR + 1}-03-31`]],
      `${kind}: cut to the validity, the summer line dropped, the bundle keeps its 12 days`,
    );
    assert.deepEqual(
      await readMeasure(runner, kind, destination.id, 'planned', YEAR + 1),
      [...repeat('500.00', 3), ...repeat('0.00', 9)],
      `${kind}: 100 a month and the 1 200 bundle over January to March`,
    );
    const { planned } = await readRecords(runner, kind, destination.id);
    assert.deepEqual([planned.period_start, planned.period_end], [`${YEAR + 1}-01-01`, `${YEAR + 1}-03-31`]);

    // 90 000 000 000 000 + 20 % is over the unit price limit (below 100 000 000 000 000).
    const big = await seedLine(runner, kind, tenantId, YEAR, {}, 2);
    await writeLines(runner, kind, big.versionId, [licenceLine({ label: 'Mainframe', quantity: '0.001', unit_price: '90000000000000' })]);
    await assert.rejects(
      () => copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'budget', destinationYear: YEAR + 2, destinationColumn: 'budget', percentageIncrease: 20, dryRun: true }),
      (err: any) => err instanceof BadRequestException && err.message === 'Round inputs line, Mainframe: the unit price after the increase is too large.',
    );
  });
}

void runSpecs('budget-column-operations.integration.spec', [
  ['testCopyArithmetic', testCopyArithmetic],
  ['testValidityInYear', testValidityInYear],
  ['testCopyAllocationsIsAllOrNothing', testCopyAllocationsIsAllOrNothing],
  ...KINDS.flatMap((kind) => [
    [`testCopyKeepsTheShape(${kind})`, () => testCopyKeepsTheShape(kind)],
    [`testCopyWithUplift(${kind})`, () => testCopyWithUplift(kind)],
    [`testCopyPeriodsAndActuals(${kind})`, () => testCopyPeriodsAndActuals(kind)],
    [`testCopySkipsAndRefusals(${kind})`, () => testCopySkipsAndRefusals(kind)],
    [`testCopyAndClearAreAllOrNothing(${kind})`, () => testCopyAndClearAreAllOrNothing(kind)],
    [`testClear(${kind})`, () => testClear(kind)],
    [`testDryRunSkippedFlag(${kind})`, () => testDryRunSkippedFlag(kind)],
    [`testForecastCopyAndClear(${kind})`, () => testForecastCopyAndClear(kind)],
    [`testEndedLineIsNotCopied(${kind})`, () => testEndedLineIsNotCopied(kind)],
    [`testCopyProratesTheEnd(${kind})`, () => testCopyProratesTheEnd(kind)],
    [`testCopyProratesTheStart(${kind})`, () => testCopyProratesTheStart(kind)],
    [`testCopyIntoAPastYear(${kind})`, () => testCopyIntoAPastYear(kind)],
    [`testClearEndedLine(${kind})`, () => testClearEndedLine(kind)],
    [`testCopyRaisesLinePrices(${kind})`, () => testCopyRaisesLinePrices(kind)],
    [`testCopyLinesCalendarFallback(${kind})`, () => testCopyLinesCalendarFallback(kind)],
    [`testCopyLinesMissingCalendar(${kind})`, () => testCopyLinesMissingCalendar(kind)],
    [`testCopyLinesDisabledCalendar(${kind})`, () => testCopyLinesDisabledCalendar(kind)],
    [`testCopyReferenceLinesUnchanged(${kind})`, () => testCopyReferenceLinesUnchanged(kind)],
    [`testCopyLinesWithinValidity(${kind})`, () => testCopyLinesWithinValidity(kind)],
  ] as Array<[string, () => Promise<void>]>),
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
