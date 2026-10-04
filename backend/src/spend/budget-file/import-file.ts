import { BadRequestException, ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { FreezeService } from '../../freeze/freeze.service';
import { loadAnalyticsAxes } from '../../analytics/analytics-axes.util';
import { allocateItemNumbers } from '../../common/item-number.service';
import { formatCents } from '../../common/amount';
import { AmountMeasure, AmountsWriteContext, FLAT_PROFILE, assertMeasuresEditable, spreadAnnualRows, writeAmountsPayload } from '../amounts-write.util';
import { ensureBudgetVersion } from '../budget-version-ensure';
import { lockBudgetLine, lockBudgetLines, lockBudgetVersions, lockTenantBudgetOperations } from '../budget-locks';
import { activeMonths } from '../spread.util';
import { annualSpreadFields, listRoundInputs, markRoundsManual, recordPayloadRoundInputs } from '../round-inputs.util';
import { interpretBudgetFile, moneyText, readBudgetCsv } from './interpret';
import { loadDimensionCodes, loadPreflight } from './load';
import { periodForYearlyTotal, wholeYearPeriod } from './period';
import { planBudgetFile } from './preflight';
import {
  BudgetFileAmountChange,
  BudgetFileLinePlan,
  BudgetFileReport,
  BudgetFileScope,
  BudgetFileSnapshotLine,
} from './types';
import { lineImportTables } from '../budget-import-statistics';
import { lockCsvCostCenters } from '../item-write.util';
import type { CsvDateOrder, CsvLanguage, DecimalMark } from '../../common/csv-sheet';

/** The load refuses the file when a counter moved after the preflight. */
export const PREFLIGHT_STALE = 'Some lines changed since the preflight. Run the preflight again.';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABLES = {
  opex: { items: 'spend_items', amounts: 'spend_amounts', rounds: 'spend_round_inputs', versions: 'spend_versions', entity: 'spend' as const },
  capex: { items: 'capex_items', amounts: 'capex_amounts', rounds: 'capex_round_inputs', versions: 'capex_versions', entity: 'capex' as const },
};

/** Column names of an amounts table. Only these are ever interpolated into SQL. */
const AMOUNT_COLUMNS = ['planned', 'committed', 'forecast', 'actual', 'expected_landing'] as const;

interface FlatSpread {
  itemId: string;
  versionId: string;
  year: number;
  period: { start: string; end: string };
  totals: Partial<Record<AmountMeasure, bigint>>;
  fte: Partial<Record<AmountMeasure, string | null>>;
}

export interface BudgetFileImportOk {
  ok: true;
  dryRun: false;
  inserted: number;
  updated: number;
  createdSuppliers: boolean;
  createdDimensionValues: boolean;
}

export type BudgetFileImportResult = BudgetFileReport | BudgetFileImportOk;

/** Tables for `analyzeAfterLargeImport`: the line tables, plus a table this load created rows in. */
export function importAnalyzeTables(scope: BudgetFileScope, result: BudgetFileImportResult): readonly string[] {
  const extra: string[] = [];
  if ('createdSuppliers' in result && result.createdSuppliers) extra.push('suppliers');
  if ('createdDimensionValues' in result && result.createdDimensionValues) extra.push('analytics_categories');
  return [...lineImportTables(scope), ...extra];
}

export interface BudgetFileItems {
  create(
    body: Record<string, unknown>,
    userId?: string,
    opts?: { manager?: EntityManager; itemNumber?: number; statusEmail?: boolean; source?: string },
  ): Promise<{ id: string }>;
  update(
    id: string,
    body: Record<string, unknown>,
    userId?: string,
    opts?: { manager?: EntityManager; statusEmail?: boolean; source?: string },
  ): Promise<unknown>;
}

export interface BudgetFileAudit {
  log(entry: {
    table: string;
    recordId?: string | null;
    action: 'create' | 'update' | 'disable' | 'delete';
    before?: unknown;
    after?: unknown;
    userId?: string | null;
    source?: string;
  }, opts?: { manager?: EntityManager }): Promise<void>;
}

export type BudgetFileFreeze = Pick<FreezeService, 'assertNotFrozen'>;

interface AuditRow {
  table: string;
  recordId: string;
  action: 'create' | 'update';
  before: unknown;
  after: unknown;
}

/**
 * The load. One transaction, already open on `manager`. Takes the tenant bulk
 * lock, locks the target lines in id order, and writes nothing when a snapshot
 * counter differs. Line details go through the item services. Versions go
 * through `ensureBudgetVersion`. Amounts go through `writeAmountsPayload`.
 */
export async function importBudgetFile(input: {
  scope: BudgetFileScope;
  file: Buffer;
  snapshot: { lines: BudgetFileSnapshotLine[] };
  manager: EntityManager;
  tenantId: string;
  userId: string | null;
  language: CsvLanguage;
  dateOrder?: CsvDateOrder;
  decimalMark?: DecimalMark;
  createSuppliers: boolean;
  canCreateSuppliers: boolean;
  allowedCurrencies: string[] | null;
  items: BudgetFileItems;
  audit: BudgetFileAudit;
  freeze: BudgetFileFreeze;
}): Promise<BudgetFileImportResult> {
  const first = await prepare(input);
  if (!first.report.ok) return first.report;

  await lockTenantBudgetOperations(input.manager, input.tenantId);
  const ids = new Set<string>();
  for (const line of input.snapshot.lines) ids.add(line.id);
  for (const line of first.report.snapshot.lines) ids.add(line.id);
  await lockBudgetLines(input.manager, input.scope, input.tenantId, ids);

  const second = await prepare(input);
  if (!second.report.ok) return second.report;
  if (!sameSnapshot(input.snapshot.lines, second.report.snapshot.lines)) throw new ConflictException(PREFLIGHT_STALE);

  const written = await applyPlans(input, second.plans, second.stored);
  return {
    ok: true,
    dryRun: false,
    inserted: written.inserted,
    updated: written.updated,
    createdSuppliers: written.createdSuppliers,
    createdDimensionValues: written.createdDimensionValues,
  };
}

interface Prepared {
  report: BudgetFileReport;
  plans: BudgetFileLinePlan[];
  stored: Awaited<ReturnType<typeof loadPreflight>>['stored'];
}

async function prepare(input: {
  scope: BudgetFileScope;
  file: Buffer;
  manager: EntityManager;
  tenantId: string;
  language: CsvLanguage;
  dateOrder?: CsvDateOrder;
  decimalMark?: DecimalMark;
  createSuppliers: boolean;
  canCreateSuppliers: boolean;
  allowedCurrencies: string[] | null;
}): Promise<Prepared> {
  const dimensionCodes = await loadDimensionCodes(input.manager, input.tenantId);
  const read = await readBudgetCsv(input.file, {
    scope: input.scope,
    language: input.language,
    dimensionCodes,
    dateOrder: input.dateOrder,
    decimalMark: input.decimalMark,
  });
  const numbers = interpretBudgetFile(input.scope, read).flatMap((row) => (row.itemNumber.kind === 'number' ? [row.itemNumber.n] : []));
  const loaded = await loadPreflight(input.manager, input.scope, input.tenantId, numbers, input.allowedCurrencies);
  const planned = planBudgetFile({
    scope: input.scope,
    read,
    catalog: loaded.catalog,
    stored: loaded.stored,
    names: loaded.names,
    createSuppliers: input.createSuppliers,
    canCreateSuppliers: input.canCreateSuppliers,
    currentYear: new Date().getFullYear(),
    labels: loaded.labels,
  });
  return { report: planned.report, plans: planned.plans, stored: loaded.stored };
}

function sameSnapshot(client: BudgetFileSnapshotLine[], fresh: BudgetFileSnapshotLine[]): boolean {
  if (client.length !== fresh.length) return false;
  const byId = new Map(fresh.map((line) => [line.id, line]));
  for (const line of client) {
    const got = byId.get(line.id);
    if (!got || got.rowVersion !== line.rowVersion || got.years.length !== line.years.length) return false;
    const years = new Map(got.years.map((year) => [year.year, year]));
    for (const year of line.years) {
      const found = years.get(year.year);
      if (!found || found.versionId !== year.versionId || found.budgetRev !== year.budgetRev) return false;
    }
  }
  return true;
}

/** The snapshot the client sends back. A missing or broken one is a 400. */
export function parseBudgetSnapshot(raw: unknown): { lines: BudgetFileSnapshotLine[] } {
  let value = raw;
  if (typeof raw === 'string') {
    if (raw.trim() === '') throw new BadRequestException('The preflight snapshot is missing. Run the preflight again.');
    try {
      value = JSON.parse(raw);
    } catch {
      throw new BadRequestException('The preflight snapshot is not valid. Run the preflight again.');
    }
  }
  if (!value || typeof value !== 'object' || !Array.isArray((value as { lines?: unknown }).lines)) {
    throw new BadRequestException('The preflight snapshot is missing. Run the preflight again.');
  }
  const lines = (value as { lines: unknown[] }).lines.map(parseSnapshotLine);
  return { lines };
}

function parseSnapshotLine(raw: unknown): BudgetFileSnapshotLine {
  const line = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const id = typeof line.id === 'string' ? line.id : '';
  if (!UUID.test(id)) throw new BadRequestException('The preflight snapshot is not valid. Run the preflight again.');
  if (typeof line.itemNumber !== 'number' || typeof line.rowVersion !== 'number' || !Array.isArray(line.years)) {
    throw new BadRequestException('The preflight snapshot is not valid. Run the preflight again.');
  }
  const years = line.years.map((year) => {
    const entry = year && typeof year === 'object' ? (year as Record<string, unknown>) : {};
    const versionId = typeof entry.versionId === 'string' ? entry.versionId : '';
    if (!UUID.test(versionId) || typeof entry.year !== 'number' || typeof entry.budgetRev !== 'number') {
      throw new BadRequestException('The preflight snapshot is not valid. Run the preflight again.');
    }
    return { year: entry.year, versionId, budgetRev: entry.budgetRev };
  });
  return { id, itemNumber: line.itemNumber, rowVersion: line.rowVersion, years };
}

async function applyPlans(
  input: {
    scope: BudgetFileScope;
    manager: EntityManager;
    tenantId: string;
    userId: string | null;
    items: BudgetFileItems;
    audit: BudgetFileAudit;
    freeze: BudgetFileFreeze;
  },
  plans: BudgetFileLinePlan[],
  stored: Prepared['stored'],
): Promise<{ inserted: number; updated: number; createdSuppliers: boolean; createdDimensionValues: boolean }> {
  const audits: AuditRow[] = [];
  // The cost centers the file assigns, once and in id order: the write gate's per-line
  // `FOR SHARE` then never waits on a node in file order against a tree write.
  await lockCsvCostCenters(input.manager, input.tenantId, plans.map((plan) => plan.body.cost_center_id as string | null | undefined));
  const supplierIds = await createSuppliers(input.manager, input.tenantId, plans, audits);
  const dimensionIds = await createDimensionValues(input.manager, input.tenantId, plans, audits);
  const storedById = new Map(stored.map((line) => [line.id, line]));
  const rounds = await loadRounds(input, plans, storedById);

  const updates = plans.filter((plan) => !plan.creating).sort((a, b) => (a.itemId ?? '').localeCompare(b.itemId ?? ''));
  const creates = plans.filter((plan) => plan.creating);
  let nextNumber = 0;
  if (creates.length > 0) {
    nextNumber = await allocateItemNumbers(TABLES[input.scope].entity, input.tenantId, creates.length, input.manager);
  }
  const checkedFreeze = new Set<string>();
  const flats: FlatSpread[] = [];
  for (const plan of updates) {
    await applyLine(input, plan, storedById.get(plan.itemId ?? ''), supplierIds, dimensionIds, rounds, checkedFreeze, audits, flats);
  }
  for (const plan of creates) {
    await applyLine(input, plan, undefined, supplierIds, dimensionIds, rounds, checkedFreeze, audits, flats, nextNumber);
    nextNumber += 1;
  }
  await writeFlatSpreads(input, flats, checkedFreeze, audits);
  await insertAudits(input.manager, input.userId, audits);
  return {
    inserted: creates.length,
    updated: updates.length,
    createdSuppliers: audits.some((row) => row.table === 'suppliers'),
    createdDimensionValues: audits.some((row) => row.table === 'analytics_categories'),
  };
}

async function loadRounds(
  input: { scope: BudgetFileScope; manager: EntityManager; tenantId: string },
  plans: BudgetFileLinePlan[],
  storedById: Map<string, Prepared['stored'][number]>,
) {
  const versionIds: string[] = [];
  for (const plan of plans) {
    if (!plan.itemId || !plan.amounts.some((amount) => amount.month == null)) continue;
    const line = storedById.get(plan.itemId);
    for (const version of line?.versions ?? []) {
      if (plan.amounts.some((amount) => amount.month == null && amount.year === version.year)) versionIds.push(version.id);
    }
  }
  return versionIds.length > 0
    ? listRoundInputs(input.manager, input.scope, input.tenantId, versionIds)
    : new Map();
}

async function applyLine(
  input: {
    scope: BudgetFileScope;
    manager: EntityManager;
    tenantId: string;
    userId: string | null;
    items: BudgetFileItems;
    audit: BudgetFileAudit;
    freeze: BudgetFileFreeze;
  },
  plan: BudgetFileLinePlan,
  stored: Prepared['stored'][number] | undefined,
  supplierIds: Map<string, string>,
  dimensionIds: Map<string, string>,
  rounds: Awaited<ReturnType<typeof listRoundInputs>>,
  checkedFreeze: Set<string>,
  audits: AuditRow[],
  flats: FlatSpread[],
  itemNumber?: number,
): Promise<void> {
  const body = lineBody(plan, supplierIds, dimensionIds);
  const file = { manager: input.manager, statusEmail: false as const, source: 'budget_file' };
  let itemId = plan.itemId;
  if (plan.creating) {
    const saved = await input.items.create(body, input.userId ?? undefined, { ...file, itemNumber });
    itemId = saved.id;
    await lockBudgetLine(input.manager, input.scope, input.tenantId, itemId);
  } else if (Object.keys(body).length > 0 && itemId) {
    await input.items.update(itemId, body, input.userId ?? undefined, file);
  }
  if (!itemId || plan.amounts.length === 0) return;

  const dates = lineDates(plan, stored);
  const years = Array.from(new Set(plan.amounts.map((amount) => amount.year))).sort((a, b) => a - b);
  for (const year of years) {
    const grain = plan.grains.find((entry) => entry.year === year)?.grain ?? 'annual';
    const existing = stored?.versions.find((version) => version.year === year);
    const version = existing
      ? { id: existing.id, tenant_id: input.tenantId, budget_year: year }
      : await createVersion(input, itemId, year, grain);
    const amounts = plan.amounts.filter((amount) => amount.year === year);
    const ctx: AmountsWriteContext = {
      manager: input.manager,
      freeze: input.freeze,
      scope: input.scope,
      version,
      checkedFreeze,
    };
    const outcome = await writeYear(input, ctx, itemId, year, amounts, stored, dates, rounds.get(version.id) ?? []);
    if (outcome.flat) flats.push(outcome.flat);
    if (!outcome.wrote) continue;
    audits.push({
      table: TABLES[input.scope].items,
      recordId: itemId,
      action: 'update',
      before: null,
      after: { operation: 'budget_file_import', year, source: 'budget_file' },
    });
  }
}

function lineBody(
  plan: BudgetFileLinePlan,
  supplierIds: Map<string, string>,
  dimensionIds: Map<string, string>,
): Record<string, unknown> {
  const body: Record<string, unknown> = { ...plan.body };
  if (plan.newSupplier) {
    const id = supplierIds.get(plan.newSupplier.name.toLowerCase());
    if (!id) throw new BadRequestException(`Supplier '${plan.newSupplier.name}' was not created.`);
    body.supplier_id = id;
  }
  if (plan.analytics.length > 0) {
    const values: Record<string, string | null> = {};
    for (const change of plan.analytics) {
      const axisId = dimensionIds.get(`axis:${change.code}`);
      if (!axisId) throw new BadRequestException(`Dimension ${change.code} was not found.`);
      if (change.createName) {
        const created = dimensionIds.get(`value:${change.code}:${change.createName.toLowerCase()}`);
        if (!created) throw new BadRequestException(`Value '${change.createName}' was not created.`);
        values[axisId] = created;
      } else {
        values[axisId] = change.categoryId;
      }
    }
    body.analytics_values = values;
  }
  return body;
}

async function createVersion(
  input: { scope: BudgetFileScope; manager: EntityManager; tenantId: string; audit: BudgetFileAudit; userId: string | null },
  itemId: string,
  year: number,
  grain: 'annual' | 'monthly',
): Promise<{ id: string; tenant_id: string; budget_year: number }> {
  const ensured = await ensureBudgetVersion(input.manager, input.scope, {
    tenantId: input.tenantId,
    itemId,
    year,
    versionName: `Y${year}`,
    inputGrain: grain,
    asOfDate: `${year}-01-01`,
    allocationMethod: 'default',
  });
  if (!ensured) {
    throw new BadRequestException(`Another year of a line already has a version named "Y${year}": rename it, then try again.`);
  }
  if (ensured.created) {
    await input.audit.log(
      { table: TABLES[input.scope].versions, recordId: ensured.version.id, action: 'create', before: null, after: ensured.version, userId: input.userId, source: 'budget_file' },
      { manager: input.manager },
    );
  }
  return { id: ensured.version.id, tenant_id: input.tenantId, budget_year: year };
}

/**
 * A yearly flat spread with no costed lines, over the column's stored period
 * (or the period a new column is given). Those share one set of statements.
 * Anything else, including a month edit, stays on `writeAmountsPayload`.
 */
function flatPeriod(
  year: number,
  amounts: BudgetFileAmountChange[],
  dates: { start: string | null; end: string | null },
  version: Prepared['stored'][number]['versions'][number] | undefined,
  rounds: Array<{ measure: AmountMeasure; period_start: string; period_end: string; lines: readonly unknown[]; fte: string | null }>,
): { start: string; end: string } | null {
  if (amounts.length === 0 || amounts.some((amount) => amount.month != null)) return null;
  const periods = new Set<string>();
  for (const amount of amounts) {
    const record = rounds.find((round) => round.measure === amount.measure);
    if (record && record.lines.length > 0) return null;
    const hasAmounts = !!version?.months[amount.measure].some((month) => month.cents != null && month.cents !== 0n);
    const period = periodForYearlyTotal(
      year,
      record ? { start: record.period_start, end: record.period_end } : null,
      hasAmounts,
      dates.start,
      dates.end,
    ) ?? wholeYearPeriod(year);
    if (record && (record.period_start !== period.start || record.period_end !== period.end)) return null;
    periods.add(`${period.start}|${period.end}`);
  }
  if (periods.size !== 1) return null;
  const [start, end] = Array.from(periods)[0].split('|');
  return { start, end };
}

async function writeYear(
  input: { audit: BudgetFileAudit; userId: string | null },
  ctx: AmountsWriteContext,
  itemId: string,
  year: number,
  amounts: BudgetFileAmountChange[],
  stored: Prepared['stored'][number] | undefined,
  dates: { start: string | null; end: string | null },
  rounds: Array<{ measure: AmountMeasure; period_start: string; period_end: string; lines: readonly unknown[]; fte: string | null }>,
): Promise<{ wrote: boolean; flat: FlatSpread | null }> {
  const version = stored?.versions.find((item) => item.year === year);
  const period = flatPeriod(year, amounts, dates, version, rounds);
  if (period) {
    const totals: Partial<Record<AmountMeasure, bigint>> = {};
    const fte: Partial<Record<AmountMeasure, string | null>> = {};
    for (const amount of amounts) {
      totals[amount.measure] = amount.cents;
      fte[amount.measure] = rounds.find((round) => round.measure === amount.measure)?.fte ?? null;
    }
    return { wrote: false, flat: { itemId, versionId: ctx.version.id, year, period, totals, fte } };
  }
  let wrote = false;
  const annual = new Map<string, { period: { start: string; end: string }; totals: Partial<Record<AmountMeasure, string>> }>();
  for (const amount of amounts) {
    if (amount.month != null) continue;
    const record = rounds.find((round) => round.measure === amount.measure);
    const hasAmounts = !!version?.months[amount.measure].some((month) => month.cents != null && month.cents !== 0n);
    const period = periodForYearlyTotal(
      year,
      record ? { start: record.period_start, end: record.period_end } : null,
      hasAmounts,
      dates.start,
      dates.end,
    ) ?? wholeYearPeriod(year);
    const key = `${period.start}|${period.end}`;
    const group = annual.get(key) ?? { period, totals: {} };
    group.totals[amount.measure] = moneyText(amount.cents);
    annual.set(key, group);
  }
  for (const group of annual.values()) {
    const result = await writeAmountsPayload(ctx, {
      kind: 'annual',
      year,
      totals: group.totals,
      spread_profile_name: 'flat',
      period_start: group.period.start,
      period_end: group.period.end,
    });
    if (result.after.length > 0) {
      wrote = true;
      await recordPayloadRoundInputs({ manager: ctx.manager, scope: ctx.scope, version: ctx.version, userId: input.userId, audit: fileAudit(input.audit) }, result);
      await input.audit.log(
        { table: ctx.scope === 'opex' ? 'spend_amounts' : 'capex_amounts', recordId: ctx.version.id, action: 'update', before: result.before, after: result.after, userId: input.userId, source: 'budget_file' },
        { manager: ctx.manager },
      );
    }
  }

  const months = amounts.filter((amount) => amount.month != null);
  if (months.length > 0) {
    const byPeriod = new Map<string, Record<string, string>>();
    for (const amount of months) {
      const period = `${year}-${String(amount.month).padStart(2, '0')}-01`;
      const row = byPeriod.get(period) ?? {};
      row[amount.measure] = moneyText(amount.cents);
      byPeriod.set(period, row);
    }
    const result = await writeAmountsPayload(ctx, {
      kind: 'monthly',
      year,
      months: Array.from(byPeriod.entries()).map(([period, cells]) => ({ period, ...cells })),
    });
    if (result.after.length > 0) {
      wrote = true;
      const rounds = { manager: ctx.manager, scope: ctx.scope, version: ctx.version, userId: input.userId, audit: fileAudit(input.audit) };
      await recordPayloadRoundInputs(rounds, result);
      // A new month of 0 compares equal to "nothing stored", so the helper above
      // leaves the column's record alone. The file still edited that month.
      const measures = Array.from(new Set(months.map((amount) => amount.measure)));
      await markRoundsManual(rounds, measures);
      await input.audit.log(
        { table: ctx.scope === 'opex' ? 'spend_amounts' : 'capex_amounts', recordId: ctx.version.id, action: 'update', before: result.before, after: result.after, userId: input.userId, source: 'budget_file' },
        { manager: ctx.manager },
      );
    }
  }
  return { wrote, flat: null };
}

/** Flat yearly spreads, one statement per measure set. Versions are locked in id order first. */
async function writeFlatSpreads(
  input: {
    scope: BudgetFileScope;
    manager: EntityManager;
    tenantId: string;
    userId: string | null;
    freeze: BudgetFileFreeze;
  },
  flats: FlatSpread[],
  checkedFreeze: Set<string>,
  audits: AuditRow[],
): Promise<void> {
  if (flats.length === 0) return;
  await lockBudgetVersions(input.manager, input.scope, input.tenantId, flats.map((flat) => flat.versionId));
  const seen = new Set<string>();
  for (const flat of flats) {
    const measures = AMOUNT_COLUMNS.filter((measure) => flat.totals[measure] !== undefined);
    const key = `${flat.year}:${measures.join(',')}`;
    if (seen.has(key)) continue;
    seen.add(key);
    await assertMeasuresEditable({
      manager: input.manager,
      freeze: input.freeze,
      scope: input.scope,
      version: { id: flat.versionId, tenant_id: input.tenantId, budget_year: flat.year },
      checkedFreeze,
    }, flat.year, measures);
  }

  const groups = new Map<string, { measures: AmountMeasure[]; rows: AmountRow[] }>();
  const roundRows: RoundRow[] = [];
  for (const flat of flats) {
    const measures = AMOUNT_COLUMNS.filter((measure) => flat.totals[measure] !== undefined);
    const months = activeMonths(flat.year, flat.period.start, flat.period.end);
    if (months.length === 0) {
      throw new BadRequestException('No month of the period counts: a month counts when the period covers its 15th.');
    }
    const spread = spreadAnnualRows(flat.year, flat.totals, FLAT_PROFILE.weights, flat.period);
    const key = measures.join(',');
    const group = groups.get(key) ?? { measures: [...measures], rows: [] };
    for (const row of spread) {
      group.rows.push({
        versionId: flat.versionId,
        period: row.period,
        cents: Object.fromEntries(measures.map((measure) => [measure, row[measure] ?? 0n])) as Partial<Record<AmountMeasure, bigint>>,
      });
    }
    groups.set(key, group);
    for (const measure of measures) {
      const fields = annualSpreadFields(
        flat.totals[measure] as bigint,
        FLAT_PROFILE,
        { period_start: flat.period.start, period_end: flat.period.end, active_months: months },
        flat.fte[measure] ?? null,
      );
      roundRows.push({
        versionId: flat.versionId,
        measure,
        periodStart: fields.period_start,
        periodEnd: fields.period_end,
        profile: fields.spread_profile_name ?? 'flat',
        calculation: JSON.stringify(fields.last_calculation),
        fte: fields.fte,
      });
    }
    audits.push(
      {
        table: TABLES[input.scope].amounts,
        recordId: flat.versionId,
        action: 'update',
        before: null,
        after: {
          source: 'budget_file',
          year: flat.year,
          totals: Object.fromEntries(measures.map((measure) => [measure, formatCents(flat.totals[measure] as bigint)])),
        },
      },
      {
        table: TABLES[input.scope].items,
        recordId: flat.itemId,
        action: 'update',
        before: null,
        after: { operation: 'budget_file_import', year: flat.year, source: 'budget_file' },
      },
    );
  }

  for (const group of groups.values()) await insertAmountRows(input, group.measures, group.rows);
  await insertRoundRows(input, roundRows);
}

interface AmountRow {
  versionId: string;
  period: string;
  cents: Partial<Record<AmountMeasure, bigint>>;
}

interface RoundRow {
  versionId: string;
  measure: AmountMeasure;
  periodStart: string;
  periodEnd: string;
  profile: string;
  calculation: string;
  fte: string | null;
}

async function insertAmountRows(
  input: { scope: BudgetFileScope; manager: EntityManager; tenantId: string },
  measures: readonly AmountMeasure[],
  rows: AmountRow[],
): Promise<void> {
  const columns = AMOUNT_COLUMNS.filter((measure) => measures.includes(measure));
  const chunk = 20000;
  for (let start = 0; start < rows.length; start += chunk) {
    const slice = rows.slice(start, start + chunk);
    const arrays: unknown[] = [
      input.tenantId,
      slice.map((row) => row.versionId),
      slice.map((row) => row.period),
    ];
    const valueLists = columns.map((measure) => slice.map((row) => formatCents(row.cents[measure] ?? 0n)));
    const placeholders = valueLists.map((_, index) => `$${index + 4}::text[]`).join(', ');
    await input.manager.query(
      `INSERT INTO ${TABLES[input.scope].amounts} (tenant_id, version_id, period, ${columns.join(', ')})
       SELECT $1::uuid, u.version_id, u.period, ${columns.map((_, index) => `u.c${index}::numeric`).join(', ')}
         FROM unnest($2::uuid[], $3::date[], ${placeholders})
           AS u(version_id, period, ${columns.map((_, index) => `c${index}`).join(', ')})
       ON CONFLICT (version_id, period) DO UPDATE
       SET ${columns.map((measure) => `${measure} = EXCLUDED.${measure}`).join(', ')}, updated_at = now()`,
      [...arrays, ...valueLists],
    );
  }
}

async function insertRoundRows(
  input: { scope: BudgetFileScope; manager: EntityManager; tenantId: string; userId: string | null },
  rows: RoundRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const chunk = 20000;
  for (let start = 0; start < rows.length; start += chunk) {
    const slice = rows.slice(start, start + chunk);
    await input.manager.query(
      `INSERT INTO ${TABLES[input.scope].rounds}
         (tenant_id, version_id, measure, period_start, period_end, method, spread_profile_name, last_calculation, fte, updated_by)
       SELECT $1::uuid, u.version_id, u.measure, u.period_start, u.period_end, 'spread', u.profile, u.calculation::jsonb,
              NULLIF(u.fte, '')::numeric, $9::uuid
         FROM unnest($2::uuid[], $3::text[], $4::date[], $5::date[], $6::text[], $7::text[], $8::text[])
           AS u(version_id, measure, period_start, period_end, profile, calculation, fte)
       ON CONFLICT (tenant_id, version_id, measure) DO UPDATE
       SET period_start = EXCLUDED.period_start,
           period_end = EXCLUDED.period_end,
           method = EXCLUDED.method,
           spread_profile_name = EXCLUDED.spread_profile_name,
           last_calculation = EXCLUDED.last_calculation,
           fte = EXCLUDED.fte,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by`,
      [
        input.tenantId,
        slice.map((row) => row.versionId),
        slice.map((row) => row.measure),
        slice.map((row) => row.periodStart),
        slice.map((row) => row.periodEnd),
        slice.map((row) => row.profile),
        slice.map((row) => row.calculation),
        slice.map((row) => row.fte ?? ''),
        input.userId,
      ],
    );
  }
}

function lineDates(plan: BudgetFileLinePlan, stored: Prepared['stored'][number] | undefined): { start: string | null; end: string | null } {
  const start = Object.prototype.hasOwnProperty.call(plan.body, 'effective_start')
    ? (plan.body.effective_start as string | null)
    : (stored?.effectiveStart ?? null);
  const end = Object.prototype.hasOwnProperty.call(plan.body, 'disabled_at')
    ? calendarDay(plan.body.disabled_at)
    : (stored?.endOfValidity ? stored.endOfValidity.slice(0, 10) : null);
  return { start: start ?? null, end };
}

function fileAudit(audit: BudgetFileAudit): BudgetFileAudit {
  return {
    log: (entry, opts) => audit.log({ ...entry, source: entry.source ?? 'budget_file' }, opts),
  };
}

function calendarDay(value: unknown): string | null {
  if (value == null || value === '') return null;
  return String(value).slice(0, 10);
}

async function createSuppliers(
  manager: EntityManager,
  tenantId: string,
  plans: BudgetFileLinePlan[],
  audits: AuditRow[],
): Promise<Map<string, string>> {
  const byName = new Map<string, { name: string; erpId: string | null }>();
  for (const plan of plans) {
    if (!plan.newSupplier) continue;
    const key = plan.newSupplier.name.toLowerCase();
    if (!byName.has(key)) byName.set(key, plan.newSupplier);
  }
  const created = new Map<string, string>();
  const rows = Array.from(byName.values());
  if (rows.length === 0) return created;
  const inserted: Array<{ id: string; name: string }> = await manager.query(
    `INSERT INTO suppliers (tenant_id, name, erp_supplier_id, status)
     SELECT $1, n.name, NULLIF(n.erp, ''), 'enabled'::status_state
       FROM unnest($2::text[], $3::text[]) AS n(name, erp)
     ON CONFLICT ON CONSTRAINT uq_suppliers_tenant_name DO NOTHING
     RETURNING id::text AS id, name`,
    [tenantId, rows.map((row) => row.name), rows.map((row) => row.erpId ?? '')],
  );
  const found: Array<{ id: string; name: string }> = await manager.query(
    `SELECT id::text AS id, name FROM suppliers WHERE tenant_id = $1 AND lower(name) = ANY($2::text[])`,
    [tenantId, rows.map((row) => row.name.toLowerCase())],
  );
  for (const row of found) created.set(row.name.toLowerCase(), row.id);
  for (const row of inserted) {
    audits.push({ table: 'suppliers', recordId: row.id, action: 'create', before: null, after: row });
  }
  return created;
}

async function createDimensionValues(
  manager: EntityManager,
  tenantId: string,
  plans: BudgetFileLinePlan[],
  audits: AuditRow[],
): Promise<Map<string, string>> {
  const axes = await loadAnalyticsAxes(manager, tenantId);
  const ids = new Map<string, string>();
  for (const axis of axes) if (axis.status === 'enabled') ids.set(`axis:${axis.code}`, axis.id);
  const wanted = new Map<string, { axisId: string; code: string; name: string }>();
  for (const plan of plans) {
    for (const change of plan.analytics) {
      if (!change.createName) continue;
      const axisId = ids.get(`axis:${change.code}`);
      if (!axisId) continue;
      wanted.set(`${change.code}:${change.createName.toLowerCase()}`, { axisId, code: change.code, name: change.createName });
    }
  }
  const rows = Array.from(wanted.values());
  if (rows.length === 0) return ids;
  const inserted: Array<{ id: string; axis_id: string; name: string }> = await manager.query(
    `INSERT INTO analytics_categories (tenant_id, axis_id, name, status)
     SELECT $1, n.axis_id, n.name, 'enabled'::status_state
       FROM unnest($2::uuid[], $3::text[]) AS n(axis_id, name)
     ON CONFLICT (tenant_id, axis_id, lower(name)) DO NOTHING
     RETURNING id::text AS id, axis_id::text AS axis_id, name`,
    [tenantId, rows.map((row) => row.axisId), rows.map((row) => row.name)],
  );
  const found: Array<{ id: string; code: string; name: string }> = await manager.query(
    `SELECT c.id::text AS id, ax.code, c.name
       FROM analytics_categories c
       JOIN analytics_axes ax ON ax.tenant_id = c.tenant_id AND ax.id = c.axis_id
      WHERE c.tenant_id = $1 AND ax.code = ANY($2::text[]) AND lower(c.name) = ANY($3::text[])`,
    [tenantId, rows.map((row) => row.code), rows.map((row) => row.name.toLowerCase())],
  );
  for (const row of found) ids.set(`value:${row.code}:${row.name.toLowerCase()}`, row.id);
  const codeOf = new Map(axes.map((axis) => [axis.id, axis.code]));
  for (const row of inserted) {
    audits.push({
      table: 'analytics_categories',
      recordId: row.id,
      action: 'create',
      before: null,
      after: { id: row.id, axis_id: row.axis_id, name: row.name, code: codeOf.get(row.axis_id) ?? null },
    });
  }
  return ids;
}

/** One statement for the operation rows and the rows this load created. */
async function insertAudits(manager: EntityManager, userId: string | null, rows: AuditRow[]): Promise<void> {
  if (rows.length === 0) return;
  await manager.query(
    `INSERT INTO audit_log (table_name, record_id, action, before_json, after_json, user_id, source, created_at)
     SELECT t.table_name, t.record_id, t.action,
            CASE WHEN t.before_json IS NULL THEN NULL ELSE t.before_json::jsonb END,
            t.after_json::jsonb, $4, 'budget_file', clock_timestamp()
       FROM unnest($1::text[], $2::uuid[], $3::text[], $5::text[], $6::text[])
         AS t(table_name, record_id, action, before_json, after_json)`,
    [
      rows.map((row) => row.table),
      rows.map((row) => row.recordId),
      rows.map((row) => row.action),
      userId,
      rows.map((row) => (row.before == null ? null : JSON.stringify(row.before))),
      rows.map((row) => JSON.stringify(row.after)),
    ],
  );
}
