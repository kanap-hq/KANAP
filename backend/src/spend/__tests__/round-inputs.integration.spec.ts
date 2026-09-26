import 'dotenv/config';
import { BadRequestException, ForbiddenException, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { upsertRoundInput } from '../round-inputs.util';
import {
  amountsService,
  assert,
  captureAudit,
  inRolledBackTransaction,
  itemCsvImporter,
  Kind,
  period,
  readMeasure,
  readRecords,
  realFreeze,
  repeat,
  runSpecs,
  seedLine,
  seedTenant,
  setTenant,
  TABLES,
} from './round-inputs.fixtures';

// Round inputs (period and provenance of each planning column) through the
// amounts services, the legacy item CSV and the tenant isolation of the two
// new tables, on OPEX and CAPEX, against the database behind `dataSource`.

const YEAR = 2031;
const KINDS: Kind[] = ['opex', 'capex'];

async function withLine(
  kind: Kind,
  fn: (ctx: { runner: QueryRunner; tenantId: string; versionId: string }) => Promise<void>,
  values: Parameters<typeof seedLine>[4] = {},
) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, kind);
    const { versionId } = await seedLine(runner, kind, tenantId, YEAR, values);
    await fn({ runner, tenantId, versionId });
  });
}

/** Milestone: 12 000 flat over April to December; Revision 6 000 over July to December leaves Budget alone. */
async function testAnnualSpreadRecordsItsPeriod(kind: Kind) {
  await withLine(kind, async ({ runner, versionId }) => {
    const svc = amountsService(kind);
    const response = await svc.bulkUpsert(
      versionId,
      { kind: 'annual', year: YEAR, totals: { planned: '12000' }, period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31` },
      null,
      { manager: runner.manager },
    );
    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'planned', YEAR),
      ['0.00', '0.00', '0.00', ...repeat('1333.33', 8), '1333.36'],
      `${kind}: 12 000 over April to December`,
    );
    const expected = {
      measure: 'planned',
      period_start: `${YEAR}-04-01`,
      period_end: `${YEAR}-12-31`,
      method: 'spread',
      spread_profile_name: 'flat',
      last_calculation: { kind: 'annual', total: '12000.00', profile: 'flat', active_months: [4, 5, 6, 7, 8, 9, 10, 11, 12], weights: repeat('1', 9) },
      updated_by: null,
    };
    assert.equal(response.updated, 12, `${kind}: twelve months written`);
    assert.equal(response.round_inputs.length, 1, `${kind}: one record returned`);
    const { updated_at, ...returned } = response.round_inputs[0];
    assert.deepEqual(returned, expected, `${kind}: record returned by bulk-upsert`);
    assert.ok(!Number.isNaN(Date.parse(updated_at)), `${kind}: updated_at is an ISO date`);

    await svc.bulkUpsert(
      versionId,
      { kind: 'annual', year: YEAR, totals: { committed: 6000 }, period_start: `${YEAR}-07-01`, period_end: `${YEAR}-12-31` },
      null,
      { manager: runner.manager },
    );
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'committed', YEAR), [...repeat('0.00', 6), ...repeat('1000.00', 6)]);
    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'planned', YEAR),
      ['0.00', '0.00', '0.00', ...repeat('1333.33', 8), '1333.36'],
      `${kind}: Budget untouched by the Revision spread`,
    );

    const listed = await svc.listByYear(versionId, YEAR, { manager: runner.manager });
    assert.deepEqual(listed.round_inputs.map((r: any) => [r.measure, r.period_start, r.period_end, r.method]), [
      ['planned', `${YEAR}-04-01`, `${YEAR}-12-31`, 'spread'],
      ['committed', `${YEAR}-07-01`, `${YEAR}-12-31`, 'spread'],
    ], `${kind}: listByYear returns the records`);
    const withoutYear = await svc.listByYear(versionId, undefined, { manager: runner.manager });
    assert.equal(withoutYear.round_inputs.length, 2, `${kind}: listByYear without a year returns them too`);

    // Without a period: the whole year, as legacy callers expect.
    await svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { expected_landing: 1200 } }, null, { manager: runner.manager });
    const records = await readRecords(runner, kind, versionId);
    assert.equal(records.expected_landing.period_start, `${YEAR}-01-01`);
    assert.equal(records.expected_landing.period_end, `${YEAR}-12-31`);
  });
}

/** Quarterly spreads over the period; Q1 = 0 is fine from April, a Q1 amount is refused naming Q1. */
async function testQuarterlySpreadRecordsItsPeriod(kind: Kind) {
  await withLine(kind, async ({ runner, versionId }) => {
    const svc = amountsService(kind);
    const window = { period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31` };
    await assert.rejects(
      () => svc.bulkUpsert(versionId, { kind: 'quarterly', year: YEAR, measure: 'forecast', Q1: 100, Q2: 300, ...window }, null, { manager: runner.manager }),
      (err: any) => err instanceof BadRequestException && /^Q1 /.test(err.message),
      `${kind}: a Q1 amount outside the period is refused naming Q1`,
    );
    await svc.bulkUpsert(
      versionId,
      { kind: 'quarterly', year: YEAR, measure: 'forecast', Q1: 0, Q2: 1300, Q3: 1300, Q4: 1300, spread_profile_name: '4-4-5', ...window },
      null,
      { manager: runner.manager },
    );
    assert.deepEqual(
      await readMeasure(runner, kind, versionId, 'forecast', YEAR),
      ['0.00', '0.00', '0.00', '400.00', '400.00', '500.00', '400.00', '400.00', '500.00', '400.00', '400.00', '500.00'],
    );
    const { forecast } = await readRecords(runner, kind, versionId);
    assert.equal(forecast.method, 'spread');
    assert.equal(forecast.period_start, `${YEAR}-04-01`);
    assert.equal(forecast.spread_profile_name, '4-4-5');
    assert.deepEqual(forecast.last_calculation, {
      kind: 'quarterly',
      quarters: { Q1: '0.00', Q2: '1300.00', Q3: '1300.00', Q4: '1300.00' },
      distribution: '445',
      active_months: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    });
  });
}

/** A monthly resubmit of stored values changes nothing; a real edit marks the column manual and keeps its period. */
async function testMonthlyEditsAndProvenance(kind: Kind) {
  await withLine(kind, async ({ runner, versionId }) => {
    const svc = amountsService(kind);
    await svc.bulkUpsert(
      versionId,
      { kind: 'annual', year: YEAR, totals: { planned: 900 }, spread_profile_name: '4-4-5', period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31` },
      null,
      { manager: runner.manager },
    );
    const spread = (await readRecords(runner, kind, versionId)).planned;
    const stored = await readMeasure(runner, kind, versionId, 'planned', YEAR);

    // No-op resubmit of every month (as the grid may send): the record is left as it is.
    const response = await svc.bulkUpsert(
      versionId,
      { kind: 'monthly', year: YEAR, months: stored.map((value, i) => ({ period: period(i + 1, YEAR), planned: value })) },
      null,
      { manager: runner.manager },
    );
    const unchanged = (await readRecords(runner, kind, versionId)).planned;
    assert.equal(unchanged.method, 'spread', `${kind}: a no-op resubmit keeps the spread`);
    assert.equal(unchanged.updated_at.getTime(), spread.updated_at.getTime(), `${kind}: a no-op resubmit writes nothing`);
    assert.equal(response.round_inputs[0].method, 'spread');

    // A real edit: manual, period, profile and last calculation kept.
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(5, YEAR), planned: 1 }] }, null, { manager: runner.manager });
    const manual = (await readRecords(runner, kind, versionId)).planned;
    assert.equal(manual.method, 'manual', `${kind}: a real edit marks the column edited by hand`);
    assert.equal(manual.period_start, `${YEAR}-04-01`);
    assert.equal(manual.spread_profile_name, '4-4-5');
    assert.deepEqual(manual.last_calculation, spread.last_calculation);

    // A column without a record gets a whole-year manual one on its first real edit.
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(2, YEAR), committed: 5 }] }, null, { manager: runner.manager });
    const { committed } = await readRecords(runner, kind, versionId);
    assert.deepEqual(
      [committed.method, committed.period_start, committed.period_end, committed.spread_profile_name, committed.last_calculation],
      ['manual', `${YEAR}-01-01`, `${YEAR}-12-31`, null, null],
    );

    // Zero into a month that was not stored yet is no change: no record.
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(3, YEAR), expected_landing: 0 }] }, null, { manager: runner.manager });
    assert.equal((await readRecords(runner, kind, versionId)).expected_landing, undefined, `${kind}: a zero into an empty month is no edit`);
  });
}

/** Actuals never get a record, whatever the payload; the helper refuses them by name. */
async function testActualsNeverGetARecord(kind: Kind) {
  await withLine(kind, async ({ runner, versionId, tenantId }) => {
    const svc = amountsService(kind);
    await svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { actual: 1200 }, period_start: `${YEAR}-04-01`, period_end: `${YEAR}-06-30` }, null, { manager: runner.manager });
    await svc.bulkUpsert(versionId, { kind: 'quarterly', year: YEAR, measure: 'actual', Q2: 300 }, null, { manager: runner.manager });
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), actual: 7 }] }, null, { manager: runner.manager });
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record for Actuals`);
    await assert.rejects(
      () => upsertRoundInput(
        { manager: runner.manager, scope: kind, version: { id: versionId, tenant_id: tenantId, budget_year: YEAR }, userId: null, audit: captureAudit() },
        'actual',
        { period_start: `${YEAR}-01-01`, period_end: `${YEAR}-12-31`, method: 'spread', spread_profile_name: null, last_calculation: null },
      ),
      (err: any) => err instanceof InternalServerErrorException && /Actuals/.test(err.message),
    );
  });
}

/** Unknown profiles and bad periods are 400s and write nothing. CAPEX 4-4-5 is no longer flat. */
async function testRefusalsAndProfiles(kind: Kind) {
  await withLine(kind, async ({ runner, versionId }) => {
    const svc = amountsService(kind);
    const refused = async (payload: Record<string, unknown>, pattern: RegExp, label: string) => {
      await assert.rejects(
        () => svc.bulkUpsert(versionId, { year: YEAR, ...payload }, null, { manager: runner.manager }),
        (err: any) => err instanceof BadRequestException && pattern.test(err.message),
        `${kind}: ${label}`,
      );
    };
    const annual = { kind: 'annual', totals: { planned: 1200 } };
    await refused({ ...annual, spread_profile_name: 'weekly' }, /Unknown spread profile 'weekly'\. Use flat, 4-4-5/, 'unknown annual profile');
    await refused({ ...annual, spread_profile_name: 'equal' }, /Unknown spread profile 'equal'/, 'equal is not a yearly profile');
    await refused({ kind: 'quarterly', measure: 'planned', Q1: 1, spread_profile_name: 'weekly' }, /Use equal, flat or 4-4-5/, 'unknown quarterly profile');
    await refused({ ...annual, period_start: `${YEAR}-04-01` }, /both period_start and period_end/, 'half a period');
    await refused({ ...annual, period_end: `${YEAR}-04-30` }, /both period_start and period_end/, 'the other half');
    await refused({ ...annual, period_start: `${YEAR - 1}-12-01`, period_end: `${YEAR}-04-30` }, new RegExp(`within ${YEAR}`), 'outside the year');
    await refused({ ...annual, period_start: `${YEAR}-09-01`, period_end: `${YEAR}-04-30` }, /starts after it ends/, 'start after end');
    await refused({ ...annual, period_start: `${YEAR}-04-16`, period_end: `${YEAR}-05-14` }, /No month of the period counts: a month counts when the period covers its 15th\./, 'no active month');
    await refused({ ...annual, period_start: `${YEAR}-02-30`, period_end: `${YEAR}-04-30` }, /not a date/, 'not a date');
    await refused({ kind: 'quarterly', measure: 'planned', Q2: 1, period_start: `${YEAR}-06-16`, period_end: `${YEAR}-07-14` }, /No month of the period counts/, 'quarterly without active month');
    assert.deepEqual(await readMeasure(runner, kind, versionId, 'planned', YEAR), repeat('0.00', 12), `${kind}: nothing written`);
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record written`);

    // The stored 4-4-5 profile applies on both scopes (CAPEX used to spread flat whatever the name).
    await svc.bulkUpsert(versionId, { ...annual, year: YEAR, totals: { planned: 13000 }, spread_profile_name: '4-4-5' }, null, { manager: runner.manager });
    const months = await readMeasure(runner, kind, versionId, 'planned', YEAR);
    assert.deepEqual(months.slice(0, 3), ['1000.00', '1000.00', '1250.00'], `${kind}: 4-4-5 over the year`);
    const { planned } = await readRecords(runner, kind, versionId);
    assert.equal(planned.spread_profile_name, '4-4-5');
    assert.deepEqual(planned.last_calculation.weights.slice(0, 3), ['0.0769230769', '0.0769230769', '0.0961538462']);
  });
}

/** The legacy item CSV records a whole-year flat spread; a blank cell leaves the column's record alone. */
async function testItemCsvRecords(kind: Kind) {
  await withLine(kind, async ({ runner, versionId, tenantId }) => {
    const version = { id: versionId, tenant_id: tenantId, budget_year: YEAR };
    const svc = amountsService(kind);
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1, YEAR), committed: 10 }] }, null, { manager: runner.manager });
    const before = (await readRecords(runner, kind, versionId)).committed;

    await itemCsvImporter(kind).writeImportedTotals(runner.manager, version, YEAR, { planned: 2400, actual: 1200, committed: undefined });
    const records = await readRecords(runner, kind, versionId);
    assert.deepEqual(
      [records.planned.method, records.planned.period_start, records.planned.period_end, records.planned.spread_profile_name],
      ['spread', `${YEAR}-01-01`, `${YEAR}-12-31`, 'flat'],
    );
    assert.deepEqual(records.planned.last_calculation, {
      kind: 'annual', total: '2400.00', profile: 'flat', active_months: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], weights: repeat('1', 12), source: 'item_csv',
    });
    assert.equal(records.actual, undefined, `${kind}: no record for Actuals`);
    assert.equal(records.committed.method, 'manual', `${kind}: a blank cell leaves the record`);
    assert.equal(records.committed.updated_at.getTime(), before.updated_at.getTime());
  });
}

/**
 * One negative spec per new table: tenant A cannot write round inputs through
 * tenant B's version id, nor insert a row carrying B's tenant_id.
 */
async function testCrossTenantIsolation(kind: Kind) {
  await inRolledBackTransaction(async (runner) => {
    const tenantB = await seedTenant(runner, `${kind}-b`);
    const { versionId: versionB } = await seedLine(runner, kind, tenantB, YEAR);
    await amountsService(kind).bulkUpsert(versionB, { kind: 'annual', year: YEAR, totals: { planned: 1200 } }, null, { manager: runner.manager });
    const recordsB = await readRecords(runner, kind, versionB);
    assert.equal(recordsB.planned.method, 'spread');

    const tenantA = await seedTenant(runner, `${kind}-a`);
    await assert.rejects(
      () => amountsService(kind).bulkUpsert(versionB, { kind: 'annual', year: YEAR, totals: { planned: 99 } }, null, { manager: runner.manager }),
      NotFoundException,
      `${kind}: tenant A cannot reach tenant B's version`,
    );
    assert.deepEqual(await readRecords(runner, kind, versionB), {}, `${kind}: B's records are invisible to A`);

    await runner.query('SAVEPOINT cross_tenant');
    await assert.rejects(
      () => runner.query(
        `INSERT INTO ${TABLES[kind].rounds} (tenant_id, version_id, measure, period_start, period_end, method)
         VALUES ($1, $2, 'committed', '${YEAR}-01-01', '${YEAR}-12-31', 'manual')`,
        [tenantB, versionB],
      ),
      /row-level security/,
      `${kind}: a row with B's tenant_id is refused under A`,
    );
    await runner.query('ROLLBACK TO SAVEPOINT cross_tenant');

    await setTenant(runner, tenantB);
    const after = await readRecords(runner, kind, versionB);
    assert.deepEqual(Object.keys(after), ['planned'], `${kind}: B still has only its own record`);
    assert.equal(after.planned.updated_at.getTime(), recordsB.planned.updated_at.getTime(), `${kind}: B's record unchanged`);
    assert.equal(tenantA === tenantB, false);
  });
}

/** A frozen column refuses a spread before any record is written. */
async function testFrozenSpreadWritesNoRecord(kind: Kind) {
  await withLine(kind, async ({ runner, versionId, tenantId }) => {
    await runner.query(
      `INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, $3, 'budget', true)`,
      [tenantId, YEAR, kind],
    );
    await assert.rejects(
      () => amountsService(kind, captureAudit(), realFreeze()).bulkUpsert(
        versionId,
        { kind: 'annual', year: YEAR, totals: { planned: 1200 }, period_start: `${YEAR}-04-01`, period_end: `${YEAR}-12-31` },
        null,
        { manager: runner.manager },
      ),
      ForbiddenException,
    );
    assert.deepEqual(Object.keys(await readRecords(runner, kind, versionId)), [], `${kind}: no record while frozen`);
  });
}

void runSpecs(
  'round-inputs.integration.spec',
  KINDS.flatMap((kind) => [
    [`testAnnualSpreadRecordsItsPeriod(${kind})`, () => testAnnualSpreadRecordsItsPeriod(kind)],
    [`testQuarterlySpreadRecordsItsPeriod(${kind})`, () => testQuarterlySpreadRecordsItsPeriod(kind)],
    [`testMonthlyEditsAndProvenance(${kind})`, () => testMonthlyEditsAndProvenance(kind)],
    [`testActualsNeverGetARecord(${kind})`, () => testActualsNeverGetARecord(kind)],
    [`testRefusalsAndProfiles(${kind})`, () => testRefusalsAndProfiles(kind)],
    [`testItemCsvRecords(${kind})`, () => testItemCsvRecords(kind)],
    [`testCrossTenantIsolation(${kind})`, () => testCrossTenantIsolation(kind)],
    [`testFrozenSpreadWritesNoRecord(${kind})`, () => testFrozenSpreadWritesNoRecord(kind)],
  ] as Array<[string, () => Promise<void>]>),
);

// `dataSource` is imported so the CI runner schedules this spec on the database lane.
void dataSource;
