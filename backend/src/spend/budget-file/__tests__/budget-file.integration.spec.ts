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
import { noFreeze, seedItem, seedMonths, seedTenant, seedVersion, setItemDates, setTenant } from '../../__tests__/round-inputs.fixtures';
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
  const args: unknown[] = Array.from({ length: 12 }, () => undefined);
  args[3] = audit;
  args[11] = new ItemNumberService();
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
