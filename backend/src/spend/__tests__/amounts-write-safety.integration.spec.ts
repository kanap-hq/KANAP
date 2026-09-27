import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { SpendAmountsService } from '../spend-amounts.service';
import { SpendItemsCsvService } from '../spend-items-csv.service';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { CapexAmountsService } from '../../capex/capex-amounts.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { FreezeService } from '../../freeze/freeze.service';

// Write safety of the amounts services against a real database, on OPEX and
// CAPEX: a write names its target measures and never touches the others.

type Measure = 'planned' | 'forecast' | 'committed' | 'actual' | 'expected_landing';
type Kind = 'opex' | 'capex';

const MEASURES: Measure[] = ['planned', 'forecast', 'committed', 'actual', 'expected_landing'];
const YEAR = 2031;

const noAudit = { log: async () => undefined };
const noFreeze = { assertNotFrozen: async () => undefined };

function service(kind: Kind, freeze: unknown = noFreeze): { bulkUpsert: (...args: any[]) => Promise<any> } {
  return kind === 'opex'
    ? new SpendAmountsService(undefined as any, undefined as any, undefined as any, noAudit as any, freeze as any)
    : new CapexAmountsService(undefined as any, undefined as any, noAudit as any, freeze as any);
}

/** The real freeze service: its FX collaborators are only used when freezing, never by the checks. */
function realFreeze() {
  return new FreezeService(undefined as any, undefined as any, undefined as any, undefined as any);
}

/** The legacy item CSV importer's amount writing, on the real service class. */
function importer(kind: Kind): {
  writeImportedTotals: (...args: any[]) => Promise<void>;
  importCsv: (...args: any[]) => Promise<any>;
  csvHeaders: () => string[];
} {
  if (kind === 'opex') {
    const args: any[] = Array.from({ length: 11 }, () => undefined);
    args[7] = noAudit;
    args[8] = noFreeze;
    args[9] = { getSettings: async () => ({ allowedCurrencies: null }) };
    return new (SpendItemsCsvService as any)(...args);
  }
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[5] = noAudit;
  args[6] = noFreeze;
  args[7] = { resolveRates: async () => ({ map: new Map(), settings: { allowedCurrencies: null } }) };
  return new (CapexItemsService as any)(...args);
}

function budgetOperations() {
  return new SpendBudgetOperationsService(
    undefined as any, undefined as any, undefined as any, undefined as any, noAudit as any, noFreeze as any, undefined as any,
  );
}

function period(month: number, year = YEAR) {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** Irregular monthly shape per measure, so a flat re-spread is visible too. */
function seededValue(measure: Measure, month: number) {
  const base = { planned: 100, forecast: 10, committed: 200, actual: 300, expected_landing: 400 }[measure];
  return base * month;
}

async function seedTenant(runner: QueryRunner, tag: string) {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `amt-${tag}-${tenantId.slice(0, 8)}`, `Amounts test ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

/** A line and its version for `year`, with the twelve seeded months unless `months` is false. */
async function seedVersion(runner: QueryRunner, kind: Kind, tenantId: string, { year = YEAR, months = true } = {}) {
  const itemId = randomUUID();
  const versionId = randomUUID();
  if (kind === 'opex') {
    await runner.query(
      `INSERT INTO spend_items (id, tenant_id, product_name, currency, effective_start, item_number)
       VALUES ($1, $2, 'Write safety line', 'EUR', '${year}-01-01', 1)`,
      [itemId, tenantId],
    );
    await runner.query(
      `INSERT INTO spend_versions (id, tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year)
       VALUES ($1, $2, $3, 'Y${year}', 'monthly', '${year}-01-01', ${year})`,
      [versionId, tenantId, itemId],
    );
  } else {
    await runner.query(
      `INSERT INTO capex_items (id, tenant_id, description, ppe_type, investment_type, priority, currency, effective_start, item_number)
       VALUES ($1, $2, 'Write safety line', 'hardware', 'replacement', 'medium', 'EUR', '${year}-01-01', 1)`,
      [itemId, tenantId],
    );
    await runner.query(
      `INSERT INTO capex_versions (id, tenant_id, capex_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
       VALUES ($1, $2, $3, 'Y${year}', 'monthly', '${year}-01-01', ${year}, 'default')`,
      [versionId, tenantId, itemId],
    );
  }
  const table = kind === 'opex' ? 'spend_amounts' : 'capex_amounts';
  for (let month = 1; months && month <= 12; month++) {
    await runner.query(
      `INSERT INTO ${table} (tenant_id, version_id, period, planned, forecast, committed, actual, expected_landing)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, versionId, period(month, year), ...MEASURES.map((m) => seededValue(m, month))],
    );
  }
  return versionId;
}

async function readMonths(runner: QueryRunner, kind: Kind, versionId: string) {
  const table = kind === 'opex' ? 'spend_amounts' : 'capex_amounts';
  const rows = await runner.query(
    `SELECT to_char(period, 'YYYY-MM-DD') AS period, planned, forecast, committed, actual, expected_landing
     FROM ${table} WHERE version_id = $1 ORDER BY period`,
    [versionId],
  );
  return rows as Array<Record<Measure | 'period', string>>;
}

function assertUntouched(rows: Array<Record<Measure | 'period', string>>, measures: Measure[], label: string) {
  assert.equal(rows.length, 12, `${label}: twelve months expected`);
  rows.forEach((row, idx) => {
    for (const measure of measures) {
      assert.equal(
        Number(row[measure]),
        seededValue(measure, idx + 1),
        `${label}: ${measure} of ${row.period} must be left as stored`,
      );
    }
  });
}

async function withTransaction(
  kind: Kind,
  tag: string,
  fn: (runner: QueryRunner, versionId: string, tenantId: string) => Promise<void>,
  seed: { year?: number } = {},
) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner, `${kind}-${tag}`);
    const versionId = await seedVersion(runner, kind, tenantId, seed);
    await fn(runner, versionId, tenantId);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

/** A flat (annual) Budget write must not erase Forecast nor reshape the other measures. */
async function testAnnualBudgetPreservesOtherMeasures(kind: Kind) {
  await withTransaction(kind, 'annual', async (runner, versionId) => {
    await service(kind).bulkUpsert(
      versionId,
      { kind: 'annual', year: YEAR, totals: { planned: 12000 } },
      undefined,
      { manager: runner.manager },
    );
    const rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['forecast', 'committed', 'actual', 'expected_landing'], `${kind} annual Budget`);
    const plannedTotal = rows.reduce((sum, r) => sum + Number(r.planned), 0);
    assert.equal(plannedTotal, 12000, `${kind} annual Budget: yearly total`);
  });
}

/** A quarterly Revision write must leave the four other measures as stored. */
async function testQuarterlyRevisionPreservesOtherMeasures(kind: Kind) {
  await withTransaction(kind, 'quarterly', async (runner, versionId) => {
    await service(kind).bulkUpsert(
      versionId,
      { kind: 'quarterly', year: YEAR, measure: 'committed', Q1: 300, Q2: 600, Q3: 900, Q4: 1200 },
      undefined,
      { manager: runner.manager },
    );
    const rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['planned', 'forecast', 'actual', 'expected_landing'], `${kind} quarterly Revision`);
    const committedTotal = rows.reduce((sum, r) => sum + Number(r.committed), 0);
    assert.equal(committedTotal, 3000, `${kind} quarterly Revision: yearly total`);
  });
}

function sumOf(rows: Array<Record<Measure | 'period', string>>, measure: Measure) {
  return rows.reduce((sum, r) => sum + Number(r[measure]), 0);
}

/** One monthly Revision cell: Budget and the other months of Revision stay as stored. */
async function testMonthlyPatchTouchesOneCell(kind: Kind) {
  await withTransaction(kind, 'monthly', async (runner, versionId) => {
    await service(kind).bulkUpsert(
      versionId,
      { kind: 'monthly', year: YEAR, months: [{ period: period(3), committed: 1234.56 }] },
      undefined,
      { manager: runner.manager },
    );
    const rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['planned', 'forecast', 'actual', 'expected_landing'], `${kind} monthly Revision`);
    rows.forEach((row, idx) => {
      const expected = idx === 2 ? 1234.56 : seededValue('committed', idx + 1);
      assert.equal(Number(row.committed), expected, `${kind} monthly Revision: committed of ${row.period}`);
    });
  });
}

/** Explicit zero writes zero, for a yearly total and for a single cell. */
async function testExplicitZeroClears(kind: Kind) {
  await withTransaction(kind, 'zero', async (runner, versionId) => {
    const svc = service(kind);
    await svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { expected_landing: 0 } }, undefined, { manager: runner.manager });
    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(5), forecast: 0 }] }, undefined, { manager: runner.manager });
    const rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['planned', 'committed', 'actual'], `${kind} explicit zero`);
    rows.forEach((row, idx) => {
      assert.equal(row.expected_landing, '0.00', `${kind} explicit zero: landing of ${row.period}`);
      assert.equal(Number(row.forecast), idx === 4 ? 0 : seededValue('forecast', idx + 1), `${kind} explicit zero: forecast of ${row.period}`);
    });
  });
}

/** Malformed writes are refused before anything is written. */
async function testInvalidPayloadsAreRefused(kind: Kind) {
  await withTransaction(kind, 'invalid', async (runner, versionId) => {
    const svc = service(kind);
    const refused = async (payload: unknown, label: string) => {
      await assert.rejects(
        () => svc.bulkUpsert(versionId, payload, undefined, { manager: runner.manager }),
        BadRequestException,
        `${kind}: ${label} must be refused`,
      );
    };
    await refused({ kind: 'annual', year: YEAR + 1, totals: { planned: 100 } }, 'wrong year (annual)');
    await refused({ kind: 'monthly', year: YEAR - 1, months: [{ period: `${YEAR - 1}-01-01`, planned: 1 }] }, 'wrong year (monthly)');
    await refused({ kind: 'quarterly', year: YEAR + 1, measure: 'planned', Q1: 1 }, 'wrong year (quarterly)');
    await refused({ kind: 'annual', totals: { planned: 100 } }, 'missing year');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: period(2), planned: 1 }, { period: period(2), committed: 2 }] }, 'duplicate period');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: period(2), committed: null }] }, 'null cell');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: `${YEAR}-02-15`, planned: 1 }] }, 'not a first of month');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: `${YEAR + 1}-02-01`, planned: 1 }] }, 'period of another year');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: `${YEAR}-13-01`, planned: 1 }] }, 'month 13');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: period(2) }] }, 'month without amount');
    await refused({ kind: 'monthly', year: YEAR, months: [] }, 'no month');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: period(2), budget: 1 }] }, 'unknown measure');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: period(2), planned: 'abc' }] }, 'non-numeric cell');
    await refused({ kind: 'annual', year: YEAR, totals: {} }, 'empty totals');
    await refused({ kind: 'annual', year: YEAR, totals: { planned: null } }, 'null total');
    await refused({ kind: 'annual', year: YEAR, totals: { planned: Number.NaN } }, 'NaN total');
    await refused({ kind: 'annual', year: YEAR, totals: { budget: 100 } }, 'unknown total');
    // numeric(18,2) holds less than 10^16; a huge value must not become zero either.
    await refused({ kind: 'annual', year: YEAR, totals: { planned: '1e350' } }, 'total far out of range');
    await refused({ kind: 'annual', year: YEAR, totals: { committed: 1e16 } }, 'total just out of range');
    await refused({ kind: 'monthly', year: YEAR, months: [{ period: period(2), actual: '-10000000000000000' }] }, 'cell out of range');
    await refused({ kind: 'quarterly', year: YEAR, measure: 'forecast', Q2: '1e20' }, 'quarter out of range');
    await assert.rejects(
      () => svc.bulkUpsert(versionId, { kind: 'annual', year: YEAR, totals: { planned: '1e350' } }, undefined, { manager: runner.manager }),
      /Budget total is too large/,
    );
    await refused({ kind: 'quarterly', year: YEAR, measure: 'committed', Q1: 100, Q2: null }, 'null quarter');
    await refused({ kind: 'quarterly', year: YEAR, measure: 'budget', Q1: 100 }, 'unknown quarterly measure');
    await refused({ kind: 'weekly', year: YEAR }, 'unknown kind');
    const rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, MEASURES, `${kind} after refused writes`);
  });
}

/** A frozen Forecast refuses every write that targets it, and only those. */
async function testFrozenForecastIsRefused(kind: Kind) {
  await withTransaction(kind, 'frozen', async (runner, versionId, tenantId) => {
    await runner.query(
      `INSERT INTO freeze_states (tenant_id, budget_year, scope, column_key, is_frozen) VALUES ($1, $2, $3, 'forecast', true)`,
      [tenantId, YEAR, kind],
    );
    const svc = service(kind, realFreeze());
    for (const payload of [
      { kind: 'monthly', year: YEAR, months: [{ period: period(1), forecast: 5 }] },
      { kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 5, forecast: 5 }] },
      { kind: 'annual', year: YEAR, totals: { forecast: 1200 } },
      { kind: 'quarterly', year: YEAR, measure: 'forecast', Q1: 300 },
    ]) {
      await assert.rejects(
        () => svc.bulkUpsert(versionId, payload, undefined, { manager: runner.manager }),
        (err: any) => err instanceof ForbiddenException && /Forecast for 2031 is frozen/.test(err.message),
        `${kind}: ${JSON.stringify(payload)} must be refused while Forecast is frozen`,
      );
    }
    assertUntouched(await readMonths(runner, kind, versionId), MEASURES, `${kind} frozen Forecast`);

    await svc.bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 5 }] }, undefined, { manager: runner.manager });
    const rows = await readMonths(runner, kind, versionId);
    assert.equal(Number(rows[0].planned), 5, `${kind} frozen Forecast: Budget stays editable`);
    assertUntouched(rows, ['forecast', 'committed', 'actual', 'expected_landing'], `${kind} frozen Forecast, Budget write`);
  });
}

/** The legacy item CSV import writes only the yearly totals present in the file. */
async function testCsvImportWritesOnlyTheTotalsInTheFile(kind: Kind) {
  await withTransaction(kind, 'csv', async (runner, versionId, tenantId) => {
    const version = { id: versionId, tenant_id: tenantId, budget_year: YEAR };
    await importer(kind).writeImportedTotals(runner.manager, version, YEAR, { planned: 24000 });
    let rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['forecast', 'committed', 'actual', 'expected_landing'], `${kind} CSV Budget only`);
    rows.forEach((row) => assert.equal(Number(row.planned), 2000, `${kind} CSV Budget only: planned of ${row.period}`));

    // A blank cell (undefined) leaves the measure; an explicit 0 clears it.
    await importer(kind).writeImportedTotals(runner.manager, version, YEAR, { actual: 0, committed: undefined });
    rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['forecast', 'committed', 'expected_landing'], `${kind} CSV zero Actuals`);
    rows.forEach((row) => assert.equal(Number(row.actual), 0, `${kind} CSV zero Actuals: actual of ${row.period}`));
  });
}

/** Clear writes zeros (never NULL) on one measure; copy replaces one measure. OPEX only. */
async function testBudgetColumnOperations(kind: Kind) {
  if (kind !== 'opex') return;
  await withTransaction(kind, 'ops', async (runner, versionId) => {
    const ops = budgetOperations();
    const cleared = await ops.clearBudgetColumn({ year: YEAR, column: 'landing' }, null, { manager: runner.manager });
    assert.equal(cleared.summary.cleared, 1, 'clear: one item cleared');
    let rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['planned', 'forecast', 'committed', 'actual'], 'clear Landing');
    rows.forEach((row) => assert.equal(row.expected_landing, '0.00', `clear Landing: ${row.period} is zero, not NULL`));

    // Revision of the year copied onto Budget keeps its monthly shape (200 × month).
    const copied = await ops.copyBudgetColumn(
      { sourceYear: YEAR, sourceColumn: 'revision', destinationYear: YEAR, destinationColumn: 'budget', percentageIncrease: 0, overwrite: true, dryRun: false },
      null,
      { manager: runner.manager },
    );
    assert.equal(copied.summary.processed, 1, 'copy: one item processed');
    rows = await readMonths(runner, kind, versionId);
    assertUntouched(rows, ['forecast', 'committed', 'actual'], 'copy Revision to Budget');
    rows.forEach((row, idx) => {
      assert.equal(Number(row.planned), seededValue('committed', idx + 1), `copy Revision to Budget: planned of ${row.period}`);
      assert.equal(row.expected_landing, '0.00', `copy Revision to Budget: landing of ${row.period}`);
    });
  });
}

/** Seed a tenant, a line and its twelve months in a committed transaction. */
async function seedCommitted(kind: Kind, { months = true } = {}) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner, `${kind}-race`);
    const versionId = await seedVersion(runner, kind, tenantId, { months });
    await runner.commitTransaction();
    return { tenantId, versionId };
  } catch (err) {
    await runner.rollbackTransaction();
    throw err;
  } finally {
    await runner.release();
  }
}

async function deleteSeed(kind: Kind, tenantId: string) {
  const [items, versions, amounts] = kind === 'opex'
    ? ['spend_items', 'spend_versions', 'spend_amounts']
    : ['capex_items', 'capex_versions', 'capex_amounts'];
  await dataSource.transaction(async (manager) => {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await manager.query(`DELETE FROM ${amounts} WHERE tenant_id = $1`, [tenantId]);
    await manager.query(`DELETE FROM ${versions} WHERE tenant_id = $1`, [tenantId]);
    await manager.query(`DELETE FROM ${items} WHERE tenant_id = $1`, [tenantId]);
  });
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function openTenantTransaction(tenantId: string) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return runner;
}

async function waitUntilBlocked(pid: number) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const [row] = await dataSource.query(`SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (row?.wait_event_type === 'Lock') return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('the second write never waited for the first one');
}

/**
 * Two people edit different measures of the same month at the same time:
 * T1 writes Budget (uncommitted), T2 writes Revision and waits on the row,
 * T1 commits, T2 completes. Both values land.
 */
async function testConcurrentPatchesOnDifferentMeasures(kind: Kind) {
  const { tenantId, versionId } = await seedCommitted(kind);
  const t1 = await openTenantTransaction(tenantId);
  const t2 = await openTenantTransaction(tenantId);
  try {
    await service(kind).bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 111 }] }, undefined, { manager: t1.manager });

    const [{ pid }] = await t2.query(`SELECT pg_backend_pid() AS pid`);
    let t2Done = false;
    const t2Write = service(kind)
      .bulkUpsert(versionId, { kind: 'monthly', year: YEAR, months: [{ period: period(1), committed: 222 }] }, undefined, { manager: t2.manager })
      .finally(() => { t2Done = true; });
    await waitUntilBlocked(pid);
    assert.equal(t2Done, false, `${kind} race: the second write waits for the first`);

    await t1.commitTransaction();
    await t2Write;
    await t2.commitTransaction();

    const rows = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const table = kind === 'opex' ? 'spend_amounts' : 'capex_amounts';
      return manager.query(
        `SELECT to_char(period, 'YYYY-MM-DD') AS period, planned, forecast, committed, actual, expected_landing
         FROM ${table} WHERE version_id = $1 ORDER BY period`,
        [versionId],
      );
    });
    assert.equal(Number(rows[0].planned), 111, `${kind} race: Budget of T1 kept`);
    assert.equal(Number(rows[0].committed), 222, `${kind} race: Revision of T2 kept`);
    assert.equal(Number(rows[0].forecast), seededValue('forecast', 1), `${kind} race: Forecast untouched`);
    assert.equal(rows.length, 12, `${kind} race: twelve months`);
    rows.slice(1).forEach((row: any, idx: number) => {
      for (const measure of MEASURES) {
        assert.equal(Number(row[measure]), seededValue(measure, idx + 2), `${kind} race: ${measure} of ${row.period}`);
      }
    });
  } finally {
    for (const runner of [t1, t2]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
    await deleteSeed(kind, tenantId);
  }
}

/** A monthly patch whose rows name different measures: every cell lands, nothing else moves. */
async function testMonthlyPatchWithMixedMeasures(kind: Kind) {
  await withTransaction(kind, 'mixed', async (runner, versionId) => {
    await service(kind).bulkUpsert(
      versionId,
      {
        kind: 'monthly',
        year: YEAR,
        months: [
          { period: period(4), actual: 44 },
          { period: period(1), planned: 11 },
          { period: period(2), committed: 22, forecast: 23 },
          { period: period(3), planned: 33 },
        ],
      },
      undefined,
      { manager: runner.manager },
    );
    const written: Record<string, Partial<Record<Measure, number>>> = {
      [period(1)]: { planned: 11 },
      [period(2)]: { committed: 22, forecast: 23 },
      [period(3)]: { planned: 33 },
      [period(4)]: { actual: 44 },
    };
    const rows = await readMonths(runner, kind, versionId);
    rows.forEach((row, idx) => {
      for (const measure of MEASURES) {
        const expected = written[row.period]?.[measure] ?? seededValue(measure, idx + 1);
        assert.equal(Number(row[measure]), expected, `${kind} mixed patch: ${measure} of ${row.period}`);
      }
    });
  });
}

/** A manager whose first INSERT holds until `gate` resolves, to interleave two writers. */
function pauseAfterFirstInsert(manager: EntityManager, gate: Promise<void>) {
  let paused = false;
  let reached!: () => void;
  const reachedPromise = new Promise<void>((resolve) => { reached = resolve; });
  const gated = Object.create(manager) as EntityManager;
  (gated as any).query = async (sql: string, params?: unknown[]) => {
    const result = await manager.query(sql, params);
    if (!paused && /^\s*INSERT/i.test(sql)) {
      paused = true;
      reached();
      await gate;
    }
    return result;
  };
  return { manager: gated, reached: reachedPromise };
}

/**
 * Two writers create the same missing months with measure sets in crossing
 * orders. T1 pauses after its first insert, T2 runs until it waits on T1,
 * then T1 resumes. Neither may deadlock, and every value lands.
 */
async function testConcurrentPatchesCreatingMonths(kind: Kind) {
  const { tenantId, versionId } = await seedCommitted(kind, { months: false });
  const t1 = await openTenantTransaction(tenantId);
  const t2 = await openTenantTransaction(tenantId);
  try {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const paused = pauseAfterFirstInsert(t1.manager, gate);
    const t1Flow = service(kind)
      .bulkUpsert(
        versionId,
        { kind: 'monthly', year: YEAR, months: [{ period: period(1), planned: 101 }, { period: period(2), committed: 202 }, { period: period(3), planned: 303 }] },
        undefined,
        { manager: paused.manager },
      )
      .then(() => t1.commitTransaction());
    await paused.reached;

    const [{ pid }] = await t2.query(`SELECT pg_backend_pid() AS pid`);
    const t2Flow = service(kind)
      .bulkUpsert(
        versionId,
        { kind: 'monthly', year: YEAR, months: [{ period: period(2), planned: 404 }, { period: period(3), committed: 505 }] },
        undefined,
        { manager: t2.manager },
      )
      .then(() => t2.commitTransaction());
    const settled = Promise.allSettled([t1Flow, t2Flow]);
    await waitUntilBlocked(pid);
    release();

    const failures = (await settled)
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((f) => String(f.reason?.message ?? f.reason));
    assert.equal(failures.length, 0, `${kind} crossing creations: both writes commit (${failures.join('; ')})`);

    const rows = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const table = kind === 'opex' ? 'spend_amounts' : 'capex_amounts';
      return manager.query(
        `SELECT to_char(period, 'YYYY-MM-DD') AS period, planned, forecast, committed, actual, expected_landing
         FROM ${table} WHERE version_id = $1 ORDER BY period`,
        [versionId],
      );
    });
    const values = rows.map((r: any) => ({ period: r.period, planned: Number(r.planned), committed: Number(r.committed), other: Number(r.forecast) + Number(r.actual) + Number(r.expected_landing) }));
    assert.deepEqual(values, [
      { period: period(1), planned: 101, committed: 0, other: 0 },
      { period: period(2), planned: 404, committed: 202, other: 0 },
      { period: period(3), planned: 303, committed: 505, other: 0 },
    ], `${kind} crossing creations: every value lands`);
  } finally {
    for (const runner of [t1, t2]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
      await runner.release();
    }
    await deleteSeed(kind, tenantId);
  }
}

function csvFile(headers: string[], values: Record<string, string>) {
  const line = headers.map((h) => values[h] ?? '').join(';');
  return { buffer: Buffer.from(`${headers.join(';')}\n${line}\n`, 'utf8') } as any;
}

/** The item row of a legacy CSV file matching the seeded line, without amounts. */
function csvLine(kind: Kind): Record<string, string> {
  return kind === 'opex'
    ? { product_name: 'Write safety line', company_name: 'Csv test company', account_number: '6000', currency: 'EUR', status: 'enabled' }
    : { description: 'Write safety line', ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', currency: 'EUR', status: 'enabled', company_name: 'Csv test company' };
}

async function seedCompany(runner: QueryRunner, tenantId: string) {
  await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Csv test company', 'FR', 'Lyon')`,
    [tenantId],
  );
}

async function countItems(runner: QueryRunner, kind: Kind) {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM ${kind === 'opex' ? 'spend_items' : 'capex_items'}`);
  return row.n as number;
}

/**
 * The legacy item CSV import, end to end on the current year: an amount that
 * is not a number is a row error and nothing is written (dry run or not); a
 * blank cell leaves its measure, 0 and -0 clear it, a value replaces it.
 */
async function testCsvImportEndToEnd(kind: Kind) {
  const currentYear = new Date().getFullYear();
  await withTransaction(kind, 'csv-import', async (runner, versionId, tenantId) => {
    await seedCompany(runner, tenantId);
    const svc = importer(kind);
    const headers = svc.csvHeaders.call(svc);

    for (const dryRun of [true, false]) {
      const result = await svc.importCsv(
        { file: csvFile(headers, { ...csvLine(kind), y_budget: '1.2.3', y_revision: '100' }), dryRun, userId: null },
        { manager: runner.manager },
      );
      assert.equal(result.ok, false, `${kind} CSV unparsable amount (dry run ${dryRun}): refused`);
      assert.deepEqual(result.errors, [{ row: 2, message: 'y_budget must be a number' }], `${kind} CSV unparsable amount (dry run ${dryRun}): row error`);
    }
    assert.equal(await countItems(runner, kind), 1, `${kind} CSV unparsable amount: no item written`);
    const seededMonths = (await readMonths(runner, kind, versionId)).map((row, idx) => ({ ...row, idx }));
    seededMonths.forEach((row) => {
      for (const measure of MEASURES) {
        assert.equal(Number(row[measure]), seededValue(measure, row.idx + 1), `${kind} CSV unparsable amount: ${measure} of ${row.period} untouched`);
      }
    });

    const result = await svc.importCsv(
      { file: csvFile(headers, { ...csvLine(kind), y_budget: '', y_follow_up: '0', y_landing: '-0', y_revision: '1 200' }), dryRun: false, userId: null },
      { manager: runner.manager },
    );
    assert.equal(result.ok, true, `${kind} CSV import: accepted (${JSON.stringify(result.errors)})`);
    assert.equal(await countItems(runner, kind), 1, `${kind} CSV import: the existing line is updated`);
    const rows = await readMonths(runner, kind, versionId);
    rows.forEach((row, idx) => {
      assert.equal(Number(row.planned), seededValue('planned', idx + 1), `${kind} CSV import: blank Budget leaves ${row.period}`);
      assert.equal(Number(row.forecast), seededValue('forecast', idx + 1), `${kind} CSV import: Forecast of ${row.period} untouched`);
      assert.equal(row.actual, '0.00', `${kind} CSV import: 0 clears Actuals of ${row.period}`);
      assert.equal(row.expected_landing, '0.00', `${kind} CSV import: -0 clears Expected landing of ${row.period}`);
      assert.equal(Number(row.committed), 100, `${kind} CSV import: Revision of ${row.period}`);
    });
  }, { year: currentYear });
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const kind of ['opex', 'capex'] as Kind[]) {
      for (const test of [
        testAnnualBudgetPreservesOtherMeasures,
        testQuarterlyRevisionPreservesOtherMeasures,
        testMonthlyPatchTouchesOneCell,
        testExplicitZeroClears,
        testInvalidPayloadsAreRefused,
        testFrozenForecastIsRefused,
        testCsvImportWritesOnlyTheTotalsInTheFile,
        testBudgetColumnOperations,
        testConcurrentPatchesOnDifferentMeasures,
        testMonthlyPatchWithMixedMeasures,
        testConcurrentPatchesCreatingMonths,
        testCsvImportEndToEnd,
      ]) {
        try {
          await test(kind);
        } catch (err) {
          failures.push(`${test.name}(${kind}): ${(err as Error).message.split('\n')[0]}`);
        }
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`amounts-write-safety.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('amounts-write-safety.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
