import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { ItemNumberService } from '../../../common/item-number.service';
import { CurrencySettingsService } from '../../../currency/currency-settings.service';
import dataSource from '../../../data-source';
import { EntityManager } from 'typeorm';
import { SpendItemsService } from '../../spend-items.service';
import { exportListQuery } from '../export-file';
import { PREFLIGHT_STALE } from '../import-file';
import { FLAT_PROFILE, spreadAnnualRows, writeAmountsPayload } from '../../amounts-write.util';
import { recordPayloadRoundInputs } from '../../round-inputs.util';
import { toCents } from '../../../common/amount';
import { BudgetFileService } from '../budget-file.service';
import * as budgetList from '../../budget-list/budget-list.service';
import { SUMMARY_SCOPES } from '../../spend-summary.builder';
import { realSummaryDeps } from '../../__tests__/oracle/oracle-deps';
import {
  amountsService,
  captureAudit,
  freezeColumn,
  Kind,
  noFreeze,
  readLines,
  readMeasure,
  readRecords,
  repeat,
  seedItem,
  seedLine,
  seedMonths,
  seedTenant,
  seedVersion,
  setBudgetColumns,
  setItemDates,
  setTenant,
} from '../../__tests__/round-inputs.fixtures';
import { readBudgetCsv } from '../interpret';
import { ITEM_TABLE, itemService, seedCompany, seedCostCenter, seedUser } from '../../__tests__/cost-center.fixtures';
import { BUDGET_FILE_OPTIONS, budgetFileService, exportBudgetFile, fileRows, loadBudgetFile, preflightBudgetFile, withCell } from '../../__tests__/budget-file.fixtures';
import { upsertRoundInput } from '../../round-inputs.util';
import { ensureDefaultAnalyticsAxis } from '../../../analytics/analytics-axes.util';
import { lockTenantBudgetOperations } from '../../budget-locks';

// The loader against the schema. The transaction rolls back, so this writes nothing that stays.
// @database-spec
// Run with DATABASE_URL on appdb_csvcopy, not appdb.

function dbAudit(manager: EntityManager) {
  return {
    log: async (entry: { table: string; recordId?: string | null; action: string; before?: unknown; after?: unknown; userId?: string | null; source?: string }) => {
      await manager.query(
        `INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, source, created_at)
         VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, clock_timestamp())`,
        [
          entry.table,
          entry.recordId ?? null,
          entry.action,
          entry.before == null ? null : JSON.stringify(entry.before),
          entry.after == null ? null : JSON.stringify(entry.after),
          entry.userId ?? null,
          entry.source ?? 'user',
        ],
      );
    },
  };
}

function opexItems(audit: ReturnType<typeof dbAudit>) {
  const args: unknown[] = Array.from({ length: 11 }, () => undefined);
  args[3] = audit;
  args[10] = new ItemNumberService();
  return new (SpendItemsService as unknown as new (...parts: unknown[]) => SpendItemsService)(...args);
}

async function amountSum(runner: { query: Function }, table: string, versionId: string): Promise<string> {
  const [row] = await runner.query(`SELECT COALESCE(sum(planned), 0)::text AS total FROM ${table} WHERE version_id = $1`, [versionId]);
  return String(Number(row.total));
}

async function countAudit(runner: { query: Function }, tenantId: string): Promise<number> {
  const [row] = await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = $1`, [tenantId]);
  return row.n as number;
}

async function testCreateAndSuppliers(runner: { query: Function; manager: EntityManager }, service: BudgetFileService) {
  const tenantId = await seedTenant(runner as any, 'csv-c2b-new');
  const [chart] = await runner.query(
    `INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'CSV', 'Chart', 'FR') RETURNING id`,
    [tenantId],
  );
  await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, coa_id) VALUES ($1, 'Acme', 'FR', 'Lyon', $2)`,
    [tenantId, chart.id],
  );
  await runner.query(
    `INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6000, 'Account')`,
    [tenantId, chart.id],
  );
  const caller = { manager: runner.manager, tenantId, userId: null };
  const file = 'item_number,name,company_name,account_number,currency,supplier_name,budget_2026\n,Widget,Acme,6000,EUR,Newco,120.00\n,Gadget,Acme,6000,EUR,Newco,120.00\n';
  const options = { language: 'en', dateOrder: '', createSuppliers: true, canCreateSuppliers: true };
  const preflight = await service.preflight('opex', Buffer.from(file), caller, options);
  assert.equal(preflight.ok, true, JSON.stringify(preflight.errors));
  const audit = dbAudit(runner.manager);
  const result = await service.importFile('opex', Buffer.from(file), preflight.snapshot, caller, options, {
    items: opexItems(audit), audit, freeze: noFreeze,
  });
  assert.equal('inserted' in result && result.inserted, 2);
  assert.equal('createdSuppliers' in result && result.createdSuppliers, true);
  const numbers = await runner.query(
    `SELECT item_number::int AS n FROM spend_items WHERE tenant_id = $1 ORDER BY item_number`,
    [tenantId],
  );
  assert.deepEqual(numbers.map((row: { n: number }) => row.n), [1, 2]);
  const [supplier] = await runner.query(
    `SELECT id FROM suppliers WHERE tenant_id = $1 AND name = 'Newco'`,
    [tenantId],
  );
  const linked = await runner.query(
    `SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1 AND supplier_id = $2`,
    [tenantId, supplier.id],
  );
  assert.equal(linked[0].n, 2);
  const [sequence] = await runner.query(
    `SELECT next_val::int AS next_val FROM item_sequences WHERE tenant_id = $1 AND entity_type = 'spend'`,
    [tenantId],
  );
  assert.equal(sequence.next_val, 3, 'the two numbers were reserved in one update');
  const pair = spreadAnnualRows(2026, { planned: 12000n }, FLAT_PROFILE.weights);
  const january = await runner.query(
    `SELECT a.planned::text AS planned
       FROM spend_amounts a
       JOIN spend_versions v ON v.tenant_id = a.tenant_id AND v.id = a.version_id
       JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id
      WHERE a.tenant_id = $1 AND i.product_name IN ('Widget', 'Gadget') AND a.period = '2026-01-01'`,
    [tenantId],
  );
  assert.equal(january.length, 2);
  for (const row of january) assert.equal(toCents(row.planned), pair[0].planned);

  await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, status) VALUES ($1, 'nature', 'Nature', 'enabled')`,
    [tenantId],
  );
  const dimFile = 'item_number,name,company_name,account_number,currency,analytics:nature\n,Cloud line,Acme,6000,EUR,Cloud\n';
  const dimPreflight = await service.preflight('opex', Buffer.from(dimFile), caller, options);
  assert.equal(dimPreflight.ok, true, JSON.stringify(dimPreflight.errors));
  const dimLoad = await service.importFile('opex', Buffer.from(dimFile), dimPreflight.snapshot, caller, options, {
    items: opexItems(audit), audit, freeze: noFreeze,
  });
  assert.equal('createdDimensionValues' in dimLoad && dimLoad.createdDimensionValues, true);
  const [value] = await runner.query(
    `SELECT c.name FROM analytics_categories c
       JOIN analytics_axes ax ON ax.tenant_id = c.tenant_id AND ax.id = c.axis_id
      WHERE c.tenant_id = $1 AND ax.code = 'nature'`,
    [tenantId],
  );
  assert.equal(value.name, 'Cloud');
  const [link] = await runner.query(
    `SELECT count(*)::int AS n FROM spend_item_analytics_values v
       JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id
      WHERE v.tenant_id = $1 AND c.name = 'Cloud'`,
    [tenantId],
  );
  assert.equal(link.n, 1);
}

async function testCapexSpread(runner: { query: Function; manager: EntityManager }, service: BudgetFileService, audit: ReturnType<typeof dbAudit>) {
  const tenantId = await seedTenant(runner as any, 'csv-c2b-capex');
  const itemId = await seedItem(runner as any, 'capex', tenantId, 1, 'Server');
  const versionId = await seedVersion(runner as any, 'capex', tenantId, itemId, 2026);
  await runner.query(
    `INSERT INTO capex_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-01-01', 100)`,
    [tenantId, versionId],
  );
  const caller = { manager: runner.manager, tenantId, userId: null };
  const exported = await service.exportFile('capex', [itemId], caller, { language: 'en', amountYears: '2026', columns: 'budget', detail: 'yearly' });
  const preflight = await service.preflight('capex', Buffer.from(exported.content), caller, {
    language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false,
  });
  const result = await service.importFile(
    'capex',
    Buffer.from(exported.content.replace('100.00', '50.00')),
    preflight.snapshot,
    caller,
    { language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false },
    { items: { create: async () => { throw new Error('capex details were not part of this file'); }, update: async () => { throw new Error('capex details were not part of this file'); } }, audit, freeze: noFreeze },
  );
  assert.equal('updated' in result && result.updated, 1);
  assert.equal(await amountSum(runner, 'capex_amounts', versionId), '50');
}

/**
 * One yearly total, on a stored partial period with the other measures already
 * filled, written once by the grouped load and once by `writeAmountsPayload`.
 * The months, the round inputs and `budget_rev` have to match.
 */
async function testGroupedMatchesPayload(
  runner: { query: Function; manager: EntityManager },
  service: BudgetFileService,
  audit: ReturnType<typeof dbAudit>,
) {
  const tenantId = await seedTenant(runner as any, 'csv-c2b-diff');
  const year = 2026;
  const periodStart = '2026-03-01';
  const periodEnd = '2026-10-31';
  const filled = {
    committed: Array.from({ length: 12 }, (_, index) => String(10 + index)),
    forecast: Array.from({ length: 12 }, (_, index) => String(30 + index)),
    actual: Array.from({ length: 12 }, (_, index) => String(50 + index)),
    expected_landing: Array.from({ length: 12 }, (_, index) => String(70 + index)),
  };

  async function seedCompared(itemNumber: number, name: string) {
    const itemId = await seedItem(runner as any, 'opex', tenantId, itemNumber, name);
    const versionId = await seedVersion(runner as any, 'opex', tenantId, itemId, year);
    await seedMonths(runner as any, 'opex', tenantId, versionId, year, {
      planned: Array.from({ length: 12 }, () => '100'),
      ...filled,
    });
    await runner.query(
      `INSERT INTO spend_round_inputs
         (tenant_id, version_id, measure, period_start, period_end, method, spread_profile_name, last_calculation, fte)
       VALUES
         ($1, $2, 'planned', $3, $4, 'spread', 'flat', '{"kind":"annual","total":"1200.00"}'::jsonb, 1.50),
         ($1, $2, 'committed', $5, $6, 'manual', NULL, NULL, NULL)`,
      [tenantId, versionId, periodStart, periodEnd, `${year}-01-01`, `${year}-12-31`],
    );
    const [rev] = await runner.query(
      `SELECT budget_rev::int AS budget_rev FROM spend_versions WHERE id = $1`,
      [versionId],
    );
    return { itemId, versionId, budgetRev: rev.budget_rev as number };
  }

  const grouped = await seedCompared(1, 'Grouped');
  const payload = await seedCompared(2, 'Payload');
  assert.equal(grouped.budgetRev, payload.budgetRev, 'the two lines start from the same budget revision');

  const caller = { manager: runner.manager, tenantId, userId: null };
  const options = { language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false };
  const file = 'item_number,name,currency,budget_2026\nOPX-1,Grouped,EUR,2400.00\n';
  const preflight = await service.preflight('opex', Buffer.from(file), caller, options);
  assert.equal(preflight.ok, true, JSON.stringify({ errors: preflight.errors, file: preflight.fileErrors, header: preflight.headerErrors }));
  assert.equal(preflight.changes.updated, 1);
  const loaded = await service.importFile('opex', Buffer.from(file), preflight.snapshot, caller, options, {
    items: opexItems(audit), audit, freeze: noFreeze,
  });
  assert.equal('updated' in loaded && loaded.updated, 1);
  const [amountAudit] = await runner.query(
    `SELECT before_json FROM audit_log
      WHERE tenant_id = $1 AND table_name = 'spend_amounts' AND record_id = $2`,
    [tenantId, grouped.versionId],
  );
  assert.equal(amountAudit.before_json, null, 'a stored partial period with no costed lines takes the grouped path');

  const version = { id: payload.versionId, tenant_id: tenantId, budget_year: year };
  const written = await writeAmountsPayload(
    { manager: runner.manager, freeze: noFreeze, scope: 'opex', version },
    {
      kind: 'annual',
      year,
      totals: { planned: '2400.00' },
      spread_profile_name: 'flat',
      period_start: periodStart,
      period_end: periodEnd,
    },
  );
  assert.ok(written.after.length > 0, 'the amounts payload wrote the new total');
  await recordPayloadRoundInputs(
    { manager: runner.manager, scope: 'opex', version, userId: null, audit },
    written,
  );

  const groupedState = await versionState(runner, grouped.versionId);
  const payloadState = await versionState(runner, payload.versionId);
  assert.deepEqual(payloadState, groupedState);
  const spread = spreadAnnualRows(year, { planned: 240000n }, FLAT_PROFILE.weights, { start: periodStart, end: periodEnd });
  assert.deepEqual(
    groupedState.months.map((month) => month.planned),
    spread.map((row) => row.planned),
    'the shared spread is what both paths stored',
  );
  for (const measure of Object.keys(filled) as Array<keyof typeof filled>) {
    assert.deepEqual(
      groupedState.months.map((month) => month[measure]),
      filled[measure].map((value) => toCents(value)),
      `${measure} stays as it was`,
    );
  }
  assert.ok(groupedState.budgetRev > grouped.budgetRev, 'the write moves budget_rev');
  const plannedRound = groupedState.rounds.find((round) => round.measure === 'planned');
  assert.equal(plannedRound?.fte, 1.5);
  const committedRound = groupedState.rounds.find((round) => round.measure === 'committed');
  assert.deepEqual(
    [committedRound?.method, committedRound?.period_start, committedRound?.period_end, committedRound?.spread_profile_name],
    ['manual', `${year}-01-01`, `${year}-12-31`, null],
  );
}

interface ComparedMonth {
  period: string;
  planned: bigint;
  committed: bigint;
  forecast: bigint;
  actual: bigint;
  expected_landing: bigint;
}

interface ComparedRound {
  measure: string;
  period_start: string;
  period_end: string;
  method: string;
  spread_profile_name: string | null;
  last_calculation: unknown;
  fte: number | null;
}

interface ComparedState {
  months: ComparedMonth[];
  rounds: ComparedRound[];
  budgetRev: number;
}

async function versionState(runner: { query: Function }, versionId: string): Promise<ComparedState> {
  const months = await runner.query(
    `SELECT to_char(period, 'YYYY-MM-DD') AS period,
            planned::text AS planned, committed::text AS committed, forecast::text AS forecast,
            actual::text AS actual, expected_landing::text AS expected_landing
       FROM spend_amounts WHERE version_id = $1 ORDER BY period`,
    [versionId],
  );
  const rounds = await runner.query(
    `SELECT measure, to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end, method, spread_profile_name,
            last_calculation, fte::text AS fte
       FROM spend_round_inputs WHERE version_id = $1 ORDER BY measure`,
    [versionId],
  );
  const [version] = await runner.query(
    `SELECT budget_rev::int AS budget_rev FROM spend_versions WHERE id = $1`,
    [versionId],
  );
  return {
    months: months.map((row: { period: string; planned: string; committed: string; forecast: string; actual: string; expected_landing: string }) => ({
      period: row.period,
      planned: toCents(row.planned),
      committed: toCents(row.committed),
      forecast: toCents(row.forecast),
      actual: toCents(row.actual),
      expected_landing: toCents(row.expected_landing),
    })),
    rounds: rounds.map((row: {
      measure: string; period_start: string; period_end: string; method: string;
      spread_profile_name: string | null; last_calculation: unknown; fte: string | null;
    }) => ({
      measure: row.measure,
      period_start: row.period_start,
      period_end: row.period_end,
      method: row.method,
      spread_profile_name: row.spread_profile_name,
      last_calculation: row.last_calculation,
      fte: row.fte == null ? null : Number(row.fte),
    })),
    budgetRev: version.budget_rev as number,
  };
}

async function testOperationRunning(
  service: BudgetFileService,
  caller: { tenantId: string; userId: null },
  loadDeps: { items: SpendItemsService; audit: ReturnType<typeof dbAudit>; freeze: typeof noFreeze },
) {
  // The test transaction already holds this tenant's bulk lock. A second connection must be refused.
  const other = dataSource.createQueryRunner();
  await other.connect();
  await other.startTransaction();
  try {
    await setTenant(other, caller.tenantId);
    await assert.rejects(
      () => service.importFile('opex', Buffer.from('item_number,name,currency\n'), { lines: [] }, {
        manager: other.manager, tenantId: caller.tenantId, userId: null,
      }, {
        language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false,
      }, loadDeps),
      (err: unknown) => {
        if (!(err instanceof ConflictException)) return false;
        const body = err.getResponse() as { code?: string };
        return body.code === 'operation_running';
      },
    );
  } finally {
    await other.rollbackTransaction();
    await other.release();
  }
}

// ---- Rules the removed item files and budget rows file checked, on the budget file ----

const MONTHS_YEAR = 2026;
const IRREGULAR = ['0', '0', '0', '100.10', '0.01', '250.55', '0', '-10.00', '999.99', '0', '0', '1.25'];
const ALL_COLUMNS = 'budget,revision,forecast,actual,landing';

/** Stored values as `readMeasure` returns them. */
const stored = (values: string[]) => values.map((v) => Number(v).toFixed(2));

/** A file of the given columns; every row a record of cells (a missing cell is empty). */
function csvOf(columns: string[], rows: Array<Record<string, string>>): string {
  return `${columns.join(',')}\n${rows.map((row) => columns.map((column) => row[column] ?? '').join(',')).join('\n')}\n`;
}

/** The detail columns a new line of the type needs, then `extra`. */
function newLineColumns(kind: Kind, extra: string[] = []): string[] {
  return kind === 'opex'
    ? ['item_number', 'name', 'company_name', 'account_number', 'currency', ...extra]
    : ['item_number', 'name', 'ppe_type', 'investment_type', 'priority', 'company_name', 'account_number', 'currency', ...extra];
}

function newLine(kind: Kind, name: string, cells: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = kind === 'opex'
    ? { name, company_name: 'File company', account_number: '6000', currency: 'EUR' }
    : { name, ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium', company_name: 'File company', account_number: '6000', currency: 'EUR' };
  return { ...base, ...cells };
}

function ref(kind: Kind, n: number): string {
  return `${kind === 'opex' ? 'OPX' : 'CPX'}-${n}`;
}

/** The lines of the tenant by name: item number, company, account, cost center, run/build, currency. */
async function linesByName(runner: { query: Function }, kind: Kind, tenantId: string) {
  const name = kind === 'opex' ? 'product_name' : 'description';
  const rows: any[] = await runner.query(
    `SELECT id, item_number::int AS n, ${name} AS name, paying_company_id, account_id, cost_center_id,
            run_build::text AS run_build, currency, owner_it_id
       FROM ${ITEM_TABLE[kind]} WHERE tenant_id = $1`,
    [tenantId],
  );
  return new Map(rows.map((row) => [row.name as string, row]));
}

function rowErrors(report: { errors: Array<{ line: number; column: string | null; message: string }> }): string[] {
  return report.errors.map((error) => `${error.line} ${error.column}: ${error.message}`);
}

/**
 * Month cells against stored amounts and round-input records (the budget rows
 * file's rules): an export of hand-shaped months on every column reads back and
 * loads unchanged, records untouched; a changed month marks its column manual,
 * keeping the record's profile and last calculation, and a column without a
 * record gets a manual one; a computed column keeps its lines and FTE.
 */
async function testMonthCells(runner: { query: Function; manager: EntityManager }) {
  const tenantId = await seedTenant(runner as any, 'csv-c3-months');
  const opex = await seedLine(runner as any, 'opex', tenantId, MONTHS_YEAR, {
    planned: IRREGULAR,
    committed: repeat('50', 12),
    forecast: IRREGULAR.map((v) => String(Number(v) * 2)),
    actual: repeat('12.34', 12),
    expected_landing: repeat('0', 12),
  }, 7);
  const record = (measure: string, start: string, end: string, method: 'spread' | 'copied' | 'manual') => upsertRoundInput(
    { manager: runner.manager, scope: 'opex', version: { id: opex.versionId, tenant_id: tenantId, budget_year: MONTHS_YEAR }, userId: null, audit: captureAudit() },
    measure,
    {
      period_start: start, period_end: end, method, spread_profile_name: '4-4-5',
      last_calculation: { kind: 'annual', total: '1341.90', profile: '4-4-5', active_months: [4], weights: ['1'] }, fte: null,
    } as any,
  );
  await record('planned', `${MONTHS_YEAR}-04-01`, `${MONTHS_YEAR}-12-31`, 'spread');
  await record('committed', `${MONTHS_YEAR}-01-01`, `${MONTHS_YEAR}-06-30`, 'copied');
  await record('actual', `${MONTHS_YEAR}-02-01`, `${MONTHS_YEAR}-11-30`, 'manual');
  const before = await readRecords(runner as any, 'opex', opex.versionId);

  const content = await exportBudgetFile(runner.manager, 'opex', tenantId, [opex.itemId], { amountYears: String(MONTHS_YEAR), columns: ALL_COLUMNS, detail: 'months' });
  const [cells] = fileRows(content);
  assert.deepEqual(
    [cells[`budget_${MONTHS_YEAR}_04`], cells[`budget_${MONTHS_YEAR}_05`], cells[`budget_${MONTHS_YEAR}_08`], cells[`landing_${MONTHS_YEAR}_01`]],
    ['100.10', '0.01', '-10.00', '0.00'],
    'every stored month is written, a stored 0 included',
  );
  const report = await preflightBudgetFile(runner.manager, 'opex', tenantId, content);
  assert.deepEqual([report.ok, report.changes.unchanged, report.changes.updated], [true, 1, 0], `the export reads back unchanged: ${JSON.stringify(report.errors)}`);
  const same = await loadBudgetFile(runner.manager, 'opex', tenantId, content);
  assert.deepEqual([(same as any).inserted, (same as any).updated], [0, 0]);
  const after = await readRecords(runner as any, 'opex', opex.versionId);
  assert.deepEqual(Object.keys(after).sort(), ['actual', 'committed', 'planned'], 'no record created by an unchanged file');
  for (const measure of ['planned', 'committed', 'actual']) {
    assert.equal(after[measure].updated_at.getTime(), before[measure].updated_at.getTime(), `${measure}: provenance kept`);
  }
  assert.deepEqual(await readMeasure(runner as any, 'opex', opex.versionId, 'planned', MONTHS_YEAR), stored(IRREGULAR));

  const changed = withCell(withCell(content, `budget_${MONTHS_YEAR}_01`, '5'), `forecast_${MONTHS_YEAR}_12`, '77.50');
  const loaded = await loadBudgetFile(runner.manager, 'opex', tenantId, changed);
  assert.equal((loaded as any).updated, 1, JSON.stringify((loaded as any).errors));
  const records = await readRecords(runner as any, 'opex', opex.versionId);
  assert.deepEqual(
    [records.planned.method, records.planned.period_start, records.planned.period_end, records.planned.spread_profile_name, records.planned.last_calculation?.total],
    ['manual', `${MONTHS_YEAR}-04-01`, `${MONTHS_YEAR}-12-31`, '4-4-5', '1341.90'],
    'a changed month: edited by hand, the period, profile and last calculation kept',
  );
  assert.deepEqual([records.forecast?.method, records.forecast?.period_start], ['manual', `${MONTHS_YEAR}-01-01`], 'Forecast gets a record');
  assert.equal(records.committed.method, 'copied', 'an unchanged column keeps its record');
  assert.equal((await readMeasure(runner as any, 'opex', opex.versionId, 'planned', MONTHS_YEAR))[0], '5.00');
  assert.equal((await readMeasure(runner as any, 'opex', opex.versionId, 'forecast', MONTHS_YEAR))[11], '77.50');
  assert.deepEqual(await readMeasure(runner as any, 'opex', opex.versionId, 'committed', MONTHS_YEAR), repeat('50.00', 12));

  // A column computed from quantity × price lines.
  const computed = await seedLine(runner as any, 'opex', tenantId, MONTHS_YEAR, {}, 5);
  await amountsService('opex').bulkUpsert(computed.versionId, {
    kind: 'lines',
    year: MONTHS_YEAR,
    measure: 'forecast',
    lines: [{
      label: 'Support', quantity_unit: 'people', quantity: '2', unit_price: '1000', price_basis: 'per_month',
      period_start: `${MONTHS_YEAR}-01-01`, period_end: `${MONTHS_YEAR}-06-30`,
    }],
  }, null, { manager: runner.manager });
  const computedFile = await exportBudgetFile(runner.manager, 'opex', tenantId, [computed.itemId], { amountYears: String(MONTHS_YEAR), columns: 'forecast', detail: 'months' });
  assert.deepEqual([fileRows(computedFile)[0][`forecast_${MONTHS_YEAR}_01`], fileRows(computedFile)[0][`forecast_${MONTHS_YEAR}_07`]], ['2000.00', '0.00']);
  const reloaded = await loadBudgetFile(runner.manager, 'opex', tenantId, computedFile);
  assert.deepEqual([(reloaded as any).updated], [0], 'an exported computed column loads unchanged');
  assert.equal((await readRecords(runner as any, 'opex', computed.versionId)).forecast.method, 'computed');
  await loadBudgetFile(runner.manager, 'opex', tenantId, withCell(computedFile, `forecast_${MONTHS_YEAR}_01`, '2500'));
  const edited = (await readRecords(runner as any, 'opex', computed.versionId)).forecast;
  assert.deepEqual([edited.method, edited.fte, edited.last_calculation.kind], ['manual', '1.00', 'computed'], 'like a hand edit');
  assert.equal((await readMeasure(runner as any, 'opex', computed.versionId, 'forecast', MONTHS_YEAR))[0], '2500.00');
  assert.deepEqual((await readLines(runner as any, 'opex', computed.versionId, 'forecast')).map((line) => line.label), ['Support'], 'the lines stay');
}

/**
 * Frozen and hidden columns, read from the tenant: an unchanged frozen column
 * passes, a changed one refuses the whole file and nothing is written; a hidden
 * column is exported when named and loads; frozen, it refuses under the
 * tenant's label.
 */
async function testFrozenAndHiddenColumns(runner: { query: Function; manager: EntityManager }) {
  const tenantId = await seedTenant(runner as any, 'csv-c3-freeze');
  const line = await seedLine(runner as any, 'opex', tenantId, MONTHS_YEAR, { planned: repeat('100', 12), committed: repeat('50', 12), forecast: repeat('10', 12) }, 7);
  await freezeColumn(runner as any, 'opex', tenantId, MONTHS_YEAR, 'budget');
  await setBudgetColumns(runner as any, tenantId, { labels: { forecast: 'A2' }, enabled: { forecast: false } });
  const content = await exportBudgetFile(runner.manager, 'opex', tenantId, [line.itemId], { amountYears: String(MONTHS_YEAR), columns: 'budget,revision,forecast', detail: 'months' });
  assert.equal(fileRows(content)[0][`forecast_${MONTHS_YEAR}_01`], '10.00', 'a hidden column is exported when named');
  const identical = await preflightBudgetFile(runner.manager, 'opex', tenantId, content);
  assert.deepEqual([identical.ok, identical.changes.unchanged], [true, 1], 'an unchanged frozen column passes');

  const changed = withCell(withCell(content, `budget_${MONTHS_YEAR}_01`, '1'), `revision_${MONTHS_YEAR}_01`, '1');
  const report = await preflightBudgetFile(runner.manager, 'opex', tenantId, changed);
  assert.equal(report.ok, false);
  assert.deepEqual(rowErrors(report), [`2 budget_${MONTHS_YEAR}_01: Budget for ${MONTHS_YEAR} is frozen.`]);
  const refused = await budgetFileService().importFile('opex', Buffer.from(changed), report.snapshot, { manager: runner.manager, tenantId, userId: null }, BUDGET_FILE_OPTIONS, {
    items: opexItems(dbAudit(runner.manager)), audit: dbAudit(runner.manager), freeze: noFreeze,
  });
  assert.equal(refused.ok, false, 'the load refuses the file too');
  assert.deepEqual(await readMeasure(runner as any, 'opex', line.versionId, 'committed', MONTHS_YEAR), repeat('50.00', 12), 'the unfrozen column is not written either');

  await loadBudgetFile(runner.manager, 'opex', tenantId, withCell(content, `forecast_${MONTHS_YEAR}_01`, '1'));
  assert.equal((await readMeasure(runner as any, 'opex', line.versionId, 'forecast', MONTHS_YEAR))[0], '1.00', 'a hidden column loads');
  await freezeColumn(runner as any, 'opex', tenantId, MONTHS_YEAR, 'forecast');
  const hiddenFrozen = await preflightBudgetFile(runner.manager, 'opex', tenantId, withCell(content, `forecast_${MONTHS_YEAR}_01`, '2'));
  assert.deepEqual(rowErrors(hiddenFrozen), [`2 forecast_${MONTHS_YEAR}_01: A2 for ${MONTHS_YEAR} is frozen.`], 'under the tenant\'s label');
}

/**
 * The cost_center_code and run_build cells: a code matches case-insensitively;
 * an unknown code, a group or a disabled cost center that is not the line's
 * own is a row error; run_build is run or build in any case; a blank company
 * on a new line takes the cost center's (the account resolves in its chart);
 * an absent column keeps, `-` clears; a line whose cost center was disabled
 * since reads back unchanged.
 */
async function testCostCenterCells(runner: { query: Function; manager: EntityManager }, kind: Kind) {
  const tenantId = await seedTenant(runner as any, `csv-c3-cc-${kind}`);
  await seedCompany(runner as any, tenantId, 'File company');
  const other = await seedCompany(runner as any, tenantId, 'Other company');
  const group = await seedCostCenter(runner as any, tenantId, { code: 'GRP', name: 'Group', kind: 'group' });
  const cc2 = await seedCostCenter(runner as any, tenantId, { code: 'CC-2', name: 'Second', parentId: group, companyId: other.companyId });
  await seedCostCenter(runner as any, tenantId, { code: 'OLD', name: 'Retired', companyId: other.companyId, disabled: true });
  const columns = newLineColumns(kind, ['cost_center_code', 'run_build']);

  const created = await loadBudgetFile(runner.manager, kind, tenantId, csvOf(columns, [
    newLine(kind, 'From the center', { company_name: '', cost_center_code: 'cc-2', run_build: 'BUILD' }),
    newLine(kind, 'Plain line', { run_build: 'run' }),
    newLine(kind, 'Line three'),
    newLine(kind, 'Line four'),
  ]));
  assert.equal((created as any).inserted, 4, `${kind}: ${JSON.stringify((created as any).errors)}`);
  let lines = await linesByName(runner, kind, tenantId);
  const fromCenter = lines.get('From the center');
  assert.deepEqual(
    [fromCenter.cost_center_id, fromCenter.run_build, fromCenter.paying_company_id, fromCenter.account_id],
    [cc2, 'build', other.companyId, other.accountId],
    `${kind}: the code matches in any case, a blank company takes the cost center's, the account its chart's`,
  );

  const plain = lines.get('Plain line');
  const refused = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(newLineColumns(kind, ['cost_center_code', 'run_build']), [
    { item_number: ref(kind, plain.n), cost_center_code: 'GRP' },
    { item_number: ref(kind, lines.get('Line three').n), cost_center_code: 'OLD' },
    { item_number: ref(kind, lines.get('Line four').n), cost_center_code: 'NOPE', run_build: 'maybe' },
    newLine(kind, 'No company', { company_name: '' }),
  ]));
  assert.equal(refused.ok, false);
  assert.deepEqual(rowErrors(refused), [
    '2 cost_center_code: GRP is a group. Choose a cost center.',
    '3 cost_center_code: Cost center OLD is disabled.',
    '4 cost_center_code: Cost center NOPE was not found.',
    "4 run_build: run_build 'maybe' is not a value. Use run or build.",
    '5 company_name: company_name is required.',
  ], `${kind}: row errors found by the preflight; a new line needs a company or a cost center that has one`);

  // The line's own cost center, disabled since: an export reads back unchanged; another line cannot take it.
  await runner.query(`UPDATE cost_centers SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id = $2`, [tenantId, cc2]);
  const exported = await exportBudgetFile(runner.manager, kind, tenantId, [fromCenter.id, plain.id]);
  const roundTrip = await preflightBudgetFile(runner.manager, kind, tenantId, exported);
  assert.deepEqual([roundTrip.ok, roundTrip.changes.unchanged], [true, 2], `${kind}: a disabled current cost center reads back (${JSON.stringify(roundTrip.errors)})`);
  const taken = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', 'cost_center_code'], [{ item_number: ref(kind, plain.n), cost_center_code: 'CC-2' }]));
  assert.deepEqual(rowErrors(taken), ['2 cost_center_code: Cost center CC-2 is disabled.'], `${kind}: a disabled cost center is refused as a new assignment`);

  // An absent column keeps, `-` clears.
  await loadBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', 'currency'], [{ item_number: ref(kind, fromCenter.n), currency: 'EUR' }]));
  lines = await linesByName(runner, kind, tenantId);
  assert.deepEqual([lines.get('From the center').cost_center_id, lines.get('From the center').run_build], [cc2, 'build'], `${kind}: absent columns keep`);
  await loadBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', 'cost_center_code', 'run_build'], [{ item_number: ref(kind, fromCenter.n), cost_center_code: '-', run_build: '-' }]));
  lines = await linesByName(runner, kind, tenantId);
  assert.deepEqual(
    [lines.get('From the center').cost_center_id, lines.get('From the center').run_build, lines.get('From the center').paying_company_id],
    [null, null, other.companyId],
    `${kind}: - clears the cost center and run/build, the company stays`,
  );
}

/**
 * The analytics:<code> cells: an unknown or disabled dimension refuses the
 * file by its header; a value matches by name in its own dimension, any case;
 * an unknown name is created in that dimension only; a disabled value is
 * refused as a new assignment and kept as the line's own; an absent column
 * keeps, `-` clears that dimension only; an export of two dimensions reads
 * back unchanged. A dimension of the other line type refuses the file by its
 * header with its own message; the export leaves it out, and loading that
 * export back keeps the hidden value the line holds there.
 */
async function testDimensionCells(runner: { query: Function; manager: EntityManager }, kind: Kind) {
  const tenantId = await seedTenant(runner as any, `csv-c3-dim-${kind}`);
  await seedCompany(runner as any, tenantId, 'File company');
  const main = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
  const axis = async (code: string, name: string, sortOrder: number, disabled = false) => (await runner.query(
    `INSERT INTO analytics_axes (tenant_id, code, name, sort_order, status, disabled_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [tenantId, code, name, sortOrder, disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
  ))[0].id as string;
  const nature = await axis('nature', 'Nature', 1);
  await axis('old', 'Old axis', 2, true);
  const value = async (axisId: string, name: string, disabled = false) => (await runner.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, status, disabled_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [tenantId, axisId, name, disabled ? 'disabled' : 'enabled', disabled ? new Date(Date.now() - 86_400_000) : null],
  ))[0].id as string;
  await value(main, 'Licences');
  await value(nature, 'Hardware');
  const retired = await value(nature, 'Retired', true);
  const valuesOf = async (axisId: string) => (await runner.query(
    `SELECT name FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2 ORDER BY name`, [tenantId, axisId],
  )).map((row: { name: string }) => row.name);
  const links = async () => (await runner.query(
    `SELECT i.${kind === 'opex' ? 'product_name' : 'description'} AS line, ax.code, c.name AS value
       FROM ${kind === 'opex' ? 'spend_item_analytics_values' : 'capex_item_analytics_values'} v
       JOIN ${ITEM_TABLE[kind]} i ON i.tenant_id = v.tenant_id AND i.id = v.item_id
       JOIN analytics_axes ax ON ax.tenant_id = v.tenant_id AND ax.id = v.axis_id
       JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id
      WHERE v.tenant_id = $1`,
    [tenantId],
  )).map((row: { line: string; code: string; value: string }) => `${row.line} | ${row.code} | ${row.value}`).sort();

  for (const header of ['analytics:nope', 'analytics:old']) {
    const report = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(newLineColumns(kind, [header]), [newLine(kind, 'Refused', { [header]: 'Hardware' })]));
    assert.equal(report.ok, false, `${kind}: ${header} refuses the file`);
    assert.ok(report.headerErrors.length > 0, `${kind}: ${header} is a header error (${JSON.stringify(report)})`);
  }

  const columns = newLineColumns(kind, ['analytics:default', 'analytics:nature']);
  const names = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(columns, [
    newLine(kind, 'Too long', { 'analytics:default': 'L'.repeat(250) }),
    newLine(kind, 'Invisible', { 'analytics:nature': 'Zero​width' }),
  ]));
  assert.deepEqual(rowErrors(names), [
    '2 analytics:default: Name must be 200 characters or fewer.',
    '3 analytics:nature: Name cannot contain control or invisible characters.',
  ], `${kind}: the value name rules, as row errors`);
  await loadBudgetFile(runner.manager, kind, tenantId, csvOf(columns, [
    newLine(kind, 'Alpha', { 'analytics:default': 'licences', 'analytics:nature': 'HARDWARE' }),
    newLine(kind, 'Bravo', { 'analytics:nature': 'Brand new value' }),
  ]));
  assert.deepEqual(await links(), ['Alpha | default | Licences', 'Alpha | nature | Hardware', 'Bravo | nature | Brand new value'], `${kind}: names match in any case`);
  assert.deepEqual(await valuesOf(nature), ['Brand new value', 'Hardware', 'Retired'], `${kind}: the new name is created in its dimension`);
  assert.deepEqual(await valuesOf(main), ['Licences'], `${kind}: and nowhere else`);

  const lines = await linesByName(runner, kind, tenantId);
  const alpha = lines.get('Alpha');
  const bravo = lines.get('Bravo');
  const disabled = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', 'analytics:nature'], [{ item_number: ref(kind, alpha.n), 'analytics:nature': 'Retired' }]));
  assert.deepEqual(rowErrors(disabled), ['2 analytics:nature: Retired is disabled. Pick an enabled value.'], `${kind}: a disabled value is refused as new`);

  const exported = await exportBudgetFile(runner.manager, kind, tenantId, [alpha.id, bravo.id]);
  const roundTrip = await preflightBudgetFile(runner.manager, kind, tenantId, exported);
  assert.deepEqual([roundTrip.ok, roundTrip.changes.unchanged], [true, 2], `${kind}: an export of two dimensions reads back unchanged (${JSON.stringify(roundTrip.errors)})`);

  await runner.query(
    `UPDATE ${kind === 'opex' ? 'spend_item_analytics_values' : 'capex_item_analytics_values'} SET category_id = $3 WHERE tenant_id = $1 AND item_id = $2 AND axis_id = $4`,
    [tenantId, alpha.id, retired, nature],
  );
  const kept = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', 'analytics:nature'], [{ item_number: ref(kind, alpha.n), 'analytics:nature': 'Retired' }]));
  assert.deepEqual([kept.ok, kept.changes.unchanged], [true, 1], `${kind}: a disabled value that is the line's own is kept (${JSON.stringify(kept.errors)})`);

  await loadBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', 'analytics:nature'], [{ item_number: ref(kind, alpha.n), 'analytics:nature': '-' }]));
  assert.deepEqual(
    (await links()).filter((link: string) => link.startsWith('Alpha')),
    ['Alpha | default | Licences'],
    `${kind}: - clears its dimension only, the absent column keeps`,
  );

  // A dimension of the other line type, on which Alpha holds a value from before.
  const other = kind === 'opex' ? 'capex' : 'opex';
  const recurrence = await axis('recurrence', 'Recurrence', 3);
  const monthly = await value(recurrence, 'Monthly');
  await runner.query(
    `INSERT INTO ${kind === 'opex' ? 'spend_item_analytics_values' : 'capex_item_analytics_values'} (tenant_id, item_id, axis_id, category_id)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, alpha.id, recurrence, monthly],
  );
  await runner.query(`UPDATE analytics_axes SET applies_to = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, recurrence, other]);
  const message = `The Recurrence dimension is for ${other.toUpperCase()} lines only. `
    + `Remove the analytics:recurrence column from this ${kind.toUpperCase()} file.`;
  for (const header of ['analytics:recurrence', 'Analytics:Recurrence']) {
    const refused = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', header], [{ item_number: ref(kind, alpha.n), [header]: 'Monthly' }]));
    assert.equal(refused.ok, false, `${kind}: ${header} refuses the file`);
    assert.deepEqual(refused.headerErrors, [message], `${kind}: ${header} is a header error with its own message`);
  }
  // Disabled as well: the unknown dimension error, as for any disabled dimension.
  await runner.query(`UPDATE analytics_axes SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id = $2`, [tenantId, recurrence]);
  const disabledOther = await preflightBudgetFile(runner.manager, kind, tenantId, csvOf(['item_number', 'analytics:recurrence'], [{ item_number: ref(kind, alpha.n), 'analytics:recurrence': 'Monthly' }]));
  assert.deepEqual(disabledOther.headerErrors, ["Unknown dimension 'recurrence'."], `${kind}: a disabled dimension stays unknown`);
  await runner.query(`UPDATE analytics_axes SET status = 'enabled', disabled_at = NULL WHERE tenant_id = $1 AND id = $2`, [tenantId, recurrence]);

  const withoutHidden = await exportBudgetFile(runner.manager, kind, tenantId, [alpha.id, bravo.id]);
  const header = withoutHidden.replace(/^\uFEFF/, '').split('\n')[0].split(',');
  assert.ok(header.includes('analytics:nature'), `${kind}: the export keeps the dimensions of its type`);
  assert.ok(!header.includes('analytics:recurrence'), `${kind}: the export leaves out a dimension of the other type (${header.join(',')})`);
  await loadBudgetFile(runner.manager, kind, tenantId, withoutHidden);
  assert.ok((await links()).includes('Alpha | recurrence | Monthly'), `${kind}: loading the export back keeps the hidden value`);
}

/**
 * Owners, accounts and the currency against the tenant's data: an owner email
 * must name an enabled user of this tenant (another tenant's user, a disabled,
 * invited or contact user is a row error, and nothing of the file is written,
 * not even a dimension value it names); an account number found in two charts
 * is the paying company's; a blank currency keeps the stored one.
 */
async function testOwnersAccountsAndCurrency(runner: { query: Function; manager: EntityManager }) {
  const otherTenant = await seedTenant(runner as any, 'csv-c3-elsewhere');
  await seedUser(runner as any, otherTenant, 'elsewhere@example.com');
  const tenantId = await seedTenant(runner as any, 'csv-c3-owners');
  await seedCompany(runner as any, tenantId, 'File company');
  const second = await seedCompany(runner as any, tenantId, 'Second company');
  const owner = await seedUser(runner as any, tenantId, 'owner@example.com');
  for (const status of ['disabled', 'invited', 'contact']) await seedUser(runner as any, tenantId, `${status}@example.com`, status);
  await ensureDefaultAnalyticsAxis(runner.manager, tenantId);

  const columns = newLineColumns('opex', ['owner_it_email', 'analytics:default']);
  const file = csvOf(columns, [
    newLine('opex', 'Owned', { owner_it_email: 'OWNER@example.com', 'analytics:default': 'Created only if the file loads' }),
    newLine('opex', 'Elsewhere', { owner_it_email: 'elsewhere@example.com' }),
    newLine('opex', 'Disabled', { owner_it_email: 'disabled@example.com' }),
    newLine('opex', 'Invited', { owner_it_email: 'invited@example.com' }),
    newLine('opex', 'Contact', { owner_it_email: 'contact@example.com' }),
  ]);
  const report = await preflightBudgetFile(runner.manager, 'opex', tenantId, file);
  assert.equal(report.ok, false);
  assert.deepEqual(rowErrors(report), [
    "3 owner_it_email: owner_it_email 'elsewhere@example.com' was not found.",
    "4 owner_it_email: owner_it_email 'disabled@example.com' is not an active user.",
    "5 owner_it_email: owner_it_email 'invited@example.com' is not an active user.",
    "6 owner_it_email: owner_it_email 'contact@example.com' is not an active user.",
  ]);
  const refused = await budgetFileService().importFile('opex', Buffer.from(file), report.snapshot, { manager: runner.manager, tenantId, userId: null }, BUDGET_FILE_OPTIONS, {
    items: opexItems(dbAudit(runner.manager)), audit: dbAudit(runner.manager), freeze: noFreeze,
  });
  assert.equal(refused.ok, false);
  const [{ n: written }] = await runner.query(
    `SELECT (SELECT count(*) FROM spend_items WHERE tenant_id = $1) + (SELECT count(*) FROM analytics_categories WHERE tenant_id = $1) AS n`,
    [tenantId],
  );
  assert.equal(Number(written), 0, 'nothing of the file is written, not even the dimension value');

  await loadBudgetFile(runner.manager, 'opex', tenantId, csvOf(newLineColumns('opex', ['owner_it_email']), [
    newLine('opex', 'Owned', { owner_it_email: 'OWNER@example.com' }),
    newLine('opex', 'Second chart', { company_name: 'Second company' }),
  ]));
  const lines = await linesByName(runner, 'opex', tenantId);
  assert.equal(lines.get('Owned').owner_it_id, owner, 'an owner email matches in any case');
  assert.equal(lines.get('Second chart').account_id, second.accountId, 'account 6000 resolves in the paying company\'s chart');

  await runner.query(`UPDATE spend_items SET currency = 'USD' WHERE tenant_id = $1 AND product_name = 'Owned'`, [tenantId]);
  await loadBudgetFile(runner.manager, 'opex', tenantId, csvOf(['item_number', 'currency', 'notes'], [{ item_number: ref('opex', lines.get('Owned').n), currency: '', notes: 'Updated' }]));
  const [kept] = await runner.query(`SELECT currency, notes FROM spend_items WHERE tenant_id = $1 AND product_name = 'Owned'`, [tenantId]);
  assert.deepEqual([kept.currency, kept.notes], ['USD', 'Updated'], 'a blank currency keeps the stored one');

  const euroOnly = new BudgetFileService({ getSettings: async () => ({ allowedCurrencies: ['EUR'] }) } as unknown as CurrencySettingsService);
  const notAllowed = await euroOnly.preflight('opex', Buffer.from(csvOf(newLineColumns('opex'), [newLine('opex', 'Dollar line', { currency: 'USD' })])), {
    manager: runner.manager, tenantId, userId: null,
  }, BUDGET_FILE_OPTIONS);
  assert.deepEqual(rowErrors(notAllowed), ["2 currency: currency 'USD' is not allowed."], 'a currency outside the tenant\'s allowed list is a row error');
}

/** An unchanged French export retains its date order on an English import screen. */
async function testExportLanguageHint(runner: { query: Function; manager: EntityManager }, kind: Kind) {
  const tenantId = await seedTenant(runner as any, `csv-p1-${kind}`);
  const itemId = await seedItem(runner as any, kind, tenantId, 1, 'Convention hint');
  await setItemDates(runner as any, kind, itemId, {
    effectiveStart: '2027-03-01', disabledAt: '2027-11-05T12:00:00.000Z',
  });
  const service = budgetFileService();
  const caller = { manager: runner.manager, tenantId, userId: null };
  const exported = await service.exportFile(kind, [itemId], caller, {
    language: 'fr', amountYears: '2027', columns: 'budget', detail: 'yearly',
  });
  assert.ok(exported.content.includes('01/03/2027'));
  assert.ok(exported.content.includes('05/11/2027'));
  assert.match(exported.content, /v\d+\.fr/);
  const report = await service.preflight(kind, Buffer.from(exported.content), caller, BUDGET_FILE_OPTIONS);
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.errors, []);
  assert.equal(report.changes.unchanged, 1);
  assert.equal(report.changes.updated, 0);
  assert.deepEqual(report.changes.updatedLines, []);
  assert.deepEqual(report.changedSinceExport, []);
  assert.equal(report.changedSinceExportCount, 0);
  assert.equal(report.notices.dates, 'Dates read day first: 01/03/2027 is March 1.');

  // The token is last, so blank it while keeping the exported cells and separator.
  const blanked = exported.content.replace(/;v\d+(?:\.\d{4}r\d+)*\.fr(?=\r?\n|$)/g, ';');
  assert.notEqual(blanked, exported.content);
  const withoutHint = await service.preflight(kind, Buffer.from(blanked), caller, BUDGET_FILE_OPTIONS);
  assert.equal(withoutHint.ok, true, JSON.stringify(withoutHint));
  assert.equal(withoutHint.notices.dates, 'Dates read month first: 01/03/2027 is January 3.');
  assert.equal(withoutHint.changes.updated, 1);
  assert.deepEqual(withoutHint.changes.updatedLines[0].fields.slice().sort(), ['effective_start', 'end_of_validity']);
  assert.deepEqual(withoutHint.changedSinceExport, []);
}

/** English Excel can add comma grouping to an export that recorded German conventions. */
async function testExportAmountSwitch(runner: { query: Function; manager: EntityManager }, kind: Kind) {
  const tenantId = await seedTenant(runner as any, `csv-p1b-${kind}`);
  const itemId = await seedItem(runner as any, kind, tenantId, 1, 'Amount switch');
  const versionId = await seedVersion(runner as any, kind, tenantId, itemId, 2027);
  const table = kind === 'opex' ? 'spend_amounts' : 'capex_amounts';
  await runner.query(
    `INSERT INTO ${table} (tenant_id, version_id, period, planned) VALUES ($1, $2, '2027-01-01', 12280)`,
    [tenantId, versionId],
  );
  const service = budgetFileService();
  const caller = { manager: runner.manager, tenantId, userId: null };
  const exported = await service.exportFile(kind, [itemId], caller, {
    language: 'de', amountYears: '2027', columns: 'budget', detail: 'yearly',
  });
  assert.ok(exported.content.includes('12280,00'));
  assert.match(exported.content, /v\d+\.2027r\d+\.de/);
  const resaved = exported.content.replace('12280,00', '12,280');
  const options = { ...BUDGET_FILE_OPTIONS, language: 'de' };
  const unswitched = await service.preflight(kind, Buffer.from(resaved), caller, options);
  assert.equal(unswitched.ok, true, JSON.stringify(unswitched));
  assert.equal(unswitched.notices.amounts, 'Amounts read with a decimal comma: 12.280 is twelve thousand two hundred eighty.');
  assert.deepEqual(unswitched.changes.updatedLines[0].fields, ['budget 2027']);
  const interpreted = await readBudgetCsv(resaved, { scope: kind, language: 'de', dimensionCodes: [] });
  const amount = interpreted.rows[0].amounts.budget_2027;
  assert.equal(amount.kind === 'value' && amount.decimal.cmp('12.28'), 0);

  const switchedOptions = { ...options, decimalMark: 'dot' };
  const switched = await service.preflight(kind, Buffer.from(resaved), caller, switchedOptions);
  assert.equal(switched.ok, true, JSON.stringify(switched));
  assert.equal(switched.notices.amounts, 'Amounts read with a decimal dot: 12,280 is twelve thousand two hundred eighty.');
  assert.equal(switched.changes.unchanged, 1);
  assert.equal(switched.changes.updated, 0);
  assert.deepEqual(switched.changes.updatedLines, []);
  assert.deepEqual(switched.changedSinceExport, []);

  const audit = dbAudit(runner.manager);
  const loaded = await service.importFile(kind, Buffer.from(resaved), switched.snapshot, caller, switchedOptions, {
    items: itemService(kind, audit), audit, freeze: noFreeze,
  });
  assert.equal(loaded.ok, true, JSON.stringify(loaded));
  assert.equal('updated' in loaded && loaded.updated, 0);
  assert.equal(await amountSum(runner, table, versionId), '12280', 'the import uses the same explicit decimal mark');
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner, 'csv-c2a');
    await setTenant(runner, tenantId);
    const itemId = await seedItem(runner, 'opex', tenantId, 1, 'Widget');
    const versionId = await seedVersion(runner, 'opex', tenantId, itemId, 2026);
    await runner.query(
      `INSERT INTO spend_amounts (tenant_id, version_id, period, planned) VALUES ($1, $2, '2026-01-01', 100)`,
      [tenantId, versionId],
    );
    const service = new BudgetFileService({
      getSettings: async () => ({ allowedCurrencies: null, reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR' }),
    } as unknown as CurrencySettingsService);
    const caller = { manager: runner.manager, tenantId, userId: null };
    const exported = await service.exportFile('opex', [itemId], caller, {
      language: 'en', amountYears: '2026', columns: 'budget', detail: 'yearly',
    });
    assert.equal(exported.filename, 'opex.csv');
    assert.ok(exported.content.includes('OPX-1'), exported.content);
    assert.ok(exported.content.includes('Widget'));
    assert.ok(exported.content.includes('kanap_token'));
    assert.ok(exported.content.includes('100.00'), exported.content);
    const report = await service.preflight('opex', Buffer.from(exported.content), caller, {
      language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false,
    });
    assert.equal(report.ok, true, JSON.stringify({ errors: report.errors, file: report.fileErrors, header: report.headerErrors }));
    assert.equal(report.changes.unchanged, 1);
    assert.equal(report.changes.updated, 0);
    assert.equal(report.changes.created, 0);
    assert.equal(report.snapshot.lines.length, 1);
    assert.equal(report.snapshot.lines[0].id, itemId);

    const endedId = await seedItem(runner, 'opex', tenantId, 2, 'Ended');
    await setItemDates(runner, 'opex', endedId, { disabledAt: '2020-01-01T12:00:00.000Z' });
    const deps = realSummaryDeps(SUMMARY_SCOPES.opex);
    const fileQuery = { language: 'en', amountYears: '2026', columns: 'budget', detail: 'yearly', status: 'enabled', q: 'no-such-line' };
    const activeIds = await budgetList.budgetListIds(SUMMARY_SCOPES.opex, deps, exportListQuery(fileQuery, false), runner.manager);
    const allIds = await budgetList.budgetListIds(SUMMARY_SCOPES.opex, deps, exportListQuery(fileQuery, true), runner.manager);
    const activeFile = await service.exportFile('opex', activeIds.ids, caller, { language: 'en', amountYears: '2026', columns: 'budget', detail: 'yearly' });
    const allFile = await service.exportFile('opex', allIds.ids, caller, { language: 'en', amountYears: '2026', columns: 'budget', detail: 'yearly' });
    assert.ok(!activeFile.content.includes('Ended'), 'a default export leaves an ended line out');
    assert.ok(allFile.content.includes('Ended'), 'all=true includes an ended line');
    assert.ok(allFile.content.includes('Widget'));

    const audit = dbAudit(runner.manager);
    const items = opexItems(audit);
    const loadDeps = { items, audit, freeze: noFreeze };
    const options = { language: 'en', dateOrder: '', createSuppliers: false, canCreateSuppliers: false };
    const unchanged = await service.importFile('opex', Buffer.from(exported.content), report.snapshot, caller, options, loadDeps);
    assert.equal(unchanged.ok, true);
    assert.equal('dryRun' in unchanged && unchanged.dryRun, false);
    assert.equal('inserted' in unchanged && unchanged.inserted, 0);
    assert.equal('updated' in unchanged && unchanged.updated, 0);
    assert.equal(await amountSum(runner, 'spend_amounts', versionId), '100');
    assert.equal(await countAudit(runner, tenantId), 0, 'an unchanged file writes no audit row');

    const changed = await service.importFile('opex', Buffer.from(exported.content.replace('100.00', '200.00')), report.snapshot, caller, options, loadDeps);
    assert.equal('updated' in changed && changed.updated, 1);
    assert.equal(await amountSum(runner, 'spend_amounts', versionId), '200');
    const spread = spreadAnnualRows(2026, { planned: 20000n }, FLAT_PROFILE.weights);
    const [januaryPlanned] = await runner.query(
      `SELECT planned::text AS planned FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2 AND period = '2026-01-01'`,
      [tenantId, versionId],
    );
    assert.equal(toCents(januaryPlanned.planned), spread[0].planned, 'January is the flat spread of the yearly total');
    const [round] = await runner.query(
      `SELECT method, spread_profile_name FROM spend_round_inputs WHERE tenant_id = $1 AND version_id = $2 AND measure = 'planned'`,
      [tenantId, versionId],
    );
    assert.deepEqual([round.method, round.spread_profile_name], ['spread', 'flat']);
    const [amountAudit] = await runner.query(
      `SELECT record_id::text AS record_id, source FROM audit_log WHERE tenant_id = $1 AND table_name = 'spend_amounts'`,
      [tenantId],
    );
    assert.equal(amountAudit.record_id, versionId);
    assert.equal(amountAudit.source, 'budget_file');
    const [operation] = await runner.query(
      `SELECT after_json->>'operation' AS operation, after_json->>'year' AS year, source
         FROM audit_log WHERE tenant_id = $1 AND table_name = 'spend_items' AND after_json->>'operation' IS NOT NULL`,
      [tenantId],
    );
    assert.deepEqual([operation.operation, operation.year, operation.source], ['budget_file_import', '2026', 'budget_file']);

    const monthItem = await seedItem(runner, 'opex', tenantId, 3, 'Months');
    const monthFile = 'item_number,name,currency,budget_2026_01\nOPX-3,Months,EUR,0\n';
    const monthPreflight = await service.preflight('opex', Buffer.from(monthFile), caller, options);
    assert.equal(monthPreflight.ok, true, JSON.stringify(monthPreflight.errors));
    const monthLoad = await service.importFile('opex', Buffer.from(monthFile), monthPreflight.snapshot, caller, options, loadDeps);
    assert.equal('inserted' in monthLoad && monthLoad.updated, 1);
    const [monthVersion] = await runner.query(
      `SELECT id, input_grain::text AS input_grain FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2`,
      [tenantId, monthItem],
    );
    assert.equal(monthVersion.input_grain, 'monthly');
    const [january] = await runner.query(
      `SELECT planned::text AS planned FROM spend_amounts WHERE tenant_id = $1 AND version_id = $2 AND period = '2026-01-01'`,
      [tenantId, monthVersion.id],
    );
    assert.equal(Number(january.planned), 0);
    const [manual] = await runner.query(
      `SELECT method FROM spend_round_inputs WHERE tenant_id = $1 AND version_id = $2 AND measure = 'planned'`,
      [tenantId, monthVersion.id],
    );
    assert.equal(manual.method, 'manual');

    const yearItem = await seedItem(runner, 'opex', tenantId, 4, 'Next');
    const yearFile = 'item_number,name,currency,budget_2027\nOPX-4,Next,EUR,12\n';
    const yearPreflight = await service.preflight('opex', Buffer.from(yearFile), caller, options);
    assert.equal(yearPreflight.ok, true, JSON.stringify(yearPreflight.errors));
    await service.importFile('opex', Buffer.from(yearFile), yearPreflight.snapshot, caller, options, loadDeps);
    const [yearVersion] = await runner.query(
      `SELECT input_grain::text AS input_grain FROM spend_versions WHERE tenant_id = $1 AND spend_item_id = $2`,
      [tenantId, yearItem],
    );
    assert.equal(yearVersion.input_grain, 'annual');

    await assert.rejects(
      () => service.importFile('opex', Buffer.from(exported.content.replace('100.00', '200.00')), report.snapshot, caller, options, loadDeps),
      (err: unknown) => err instanceof ConflictException && String((err as ConflictException).message).includes(PREFLIGHT_STALE),
    );
    assert.equal(await amountSum(runner, 'spend_amounts', versionId), '200');

    const refused = await service.importFile(
      'opex',
      Buffer.from('item_number,name,currency,budget_2026\nOPX-1,Widget,EUR,1.234\n'),
      report.snapshot,
      caller,
      options,
      loadDeps,
    );
    assert.equal(refused.ok, false);
    assert.equal(await amountSum(runner, 'spend_amounts', versionId), '200');

    await testCreateAndSuppliers(runner, service);
    await testCapexSpread(runner, service, audit);
    await testGroupedMatchesPayload(runner, service, audit);
    await testMonthCells(runner);
    await testFrozenAndHiddenColumns(runner);
    for (const kind of ['opex', 'capex'] as Kind[]) {
      await testExportLanguageHint(runner, kind);
      await testExportAmountSwitch(runner, kind);
      await testCostCenterCells(runner, kind);
      await testDimensionCells(runner, kind);
    }
    await testOwnersAccountsAndCurrency(runner);
    await setTenant(runner, tenantId);
    await testOperationRunning(service, caller, loadDeps);

    console.log('budget-file.integration.spec: ok');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
