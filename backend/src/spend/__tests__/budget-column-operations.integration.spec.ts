import 'dotenv/config';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { copiedMonths, shiftPeriod } from '../budget-column-operations';
import { Decimal } from '../../common/decimal';
import { upsertRoundInput } from '../round-inputs.util';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import {
  amountsService,
  assert,
  budgetOperations,
  captureAudit,
  findVersion,
  freezeColumn,
  inRolledBackTransaction,
  Kind,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedLine,
  seedMonths,
  seedTenant,
  seedVersion,
  setBudgetColumns,
  underSavepoint,
} from './round-inputs.fixtures';

// Copy and clear of a budget column on OPEX and CAPEX: the monthly shape is
// kept, an uplift rounds to whole units with the remainder on the last month
// that has an amount, the period follows the copy, and both operations are
// all or nothing.

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
    { period_start: start, period_end: end, method: 'spread', spread_profile_name: '4-4-5', last_calculation: null },
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
  // 100.40 × 12, +2.5 % → 103 × 11 and 102 (round(1 234.92) = 1 235).
  assert.deepEqual(units(copiedMonths(repeat(10_040n, 12), Decimal.from('2.5'))), [...repeat(103, 11), 102]);
  // −3 % on January to June: 97 × 5 and June 99 (round(584.328) = 584); July to December stay zero.
  assert.deepEqual(units(copiedMonths([...repeat(10_040n, 6), ...repeat(0n, 6)], Decimal.from(-3))), [...repeat(97, 5), 99, ...repeat(0, 6)]);
  // Half away from zero on a whole unit: 1.00 +50 % is 1.50, so 2; −1.00 +50 % is −2.
  assert.deepEqual(units(copiedMonths([100n, -100n], Decimal.from(50))), [2, -2]);
  // Periods: shifted by the year delta, 29 February clamps to 28, 28 February stays 28.
  assert.deepEqual(shiftPeriod({ period_start: '2032-02-29', period_end: '2032-12-31' }, 1), { period_start: '2033-02-28', period_end: '2033-12-31' });
  assert.deepEqual(shiftPeriod({ period_start: '2031-02-28', period_end: '2031-11-30' }, 1), { period_start: '2032-02-28', period_end: '2032-11-30' });
  assert.deepEqual(shiftPeriod({ period_start: '2031-04-01', period_end: '2031-12-31' }, -1), { period_start: '2030-04-01', period_end: '2030-12-31' });
}

/** 0 %: every month copied to the cent, the period shifted, provenance recorded, the grain of the source kept. */
async function testCopyKeepsTheShape(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, `${kind}-copy`);
    const { itemId, versionId } = await seedLine(runner, kind, tenantId, YEAR, { planned: IRREGULAR });
    await runner.query(`UPDATE ${kind === 'opex' ? 'spend_versions' : 'capex_versions'} SET input_grain = 'quarterly' WHERE id = $1`, [versionId]);
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
    assert.deepEqual(await readMeasure(runner, kind, secondDestination!.id, 'committed', YEAR + 2), [...repeat('103.00', 11), '102.00']);
    const { committed } = await readRecords(runner, kind, secondDestination!.id);
    assert.deepEqual(
      [committed.period_start, committed.period_end, committed.last_calculation.total, committed.last_calculation.source_method],
      [`${YEAR + 2}-01-01`, `${YEAR + 2}-12-31`, '1235.00', null],
      `${kind}: a source without a record copies to the whole year`,
    );

    // A negative uplift: whole units, the remainder on the last month with an amount (June).
    const third = await seedLine(runner, kind, tenantId, YEAR, { expected_landing: [...repeat('100.40', 6), ...repeat('0', 6)] }, 3);
    await copy(kind, runner, { sourceYear: YEAR, sourceColumn: 'landing', destinationYear: YEAR, destinationColumn: 'budget', percentageIncrease: '-3', overwrite: true });
    assert.deepEqual(
      await readMeasure(runner, kind, third.versionId, 'planned', YEAR),
      [...repeat('97.00', 5), '99.00', ...repeat('0.00', 6)],
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
      `SELECT version_name FROM ${kind === 'opex' ? 'spend_versions' : 'capex_versions'} WHERE id = $1`,
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

void runSpecs('budget-column-operations.integration.spec', [
  ['testCopyArithmetic', testCopyArithmetic],
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
  ] as Array<[string, () => Promise<void>]>),
]);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
