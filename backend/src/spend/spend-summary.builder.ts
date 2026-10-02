import { BadRequestException } from '@nestjs/common';
import { EntityManager, In } from 'typeorm';
import { SpendItem } from './spend-item.entity';
import { SpendVersion } from './spend-version.entity';
import { CapexItem } from '../capex/capex-item.entity';
import { CapexVersion } from '../capex/capex-version.entity';
import { Company } from '../companies/company.entity';
import { Department } from '../departments/department.entity';
import { Supplier } from '../suppliers/supplier.entity';
import { Account } from '../accounts/account.entity';
import { User } from '../users/user.entity';
import { FxLookupKey, FxRateService, FxResolvedRate } from '../currency/fx-rate.service';
import { ACTIVE_TASK_STATUSES } from '../tasks/task.entity';
import { centsToNumber, formatCents, toCents } from '../common/amount';
import { StatusState } from '../common/status';
import { formatAllocationMethodLabel } from './allocation-utils';
import { costCenterLabel, loadCostCenterTree } from '../cost-centers/cost-center-tree.util';
import { analyticsFieldKey, parseAnalyticsFieldKey } from '../analytics/analytics-axes.util';
import { Decimal } from '../common/decimal';
import { naturalCompare } from '../common/list-engine/sql-fragments';

/**
 * The summary rows of the OPEX and CAPEX lists, built once for both item types.
 * Everything that differs between the two lives in a scope config; the query
 * functions (paging, filters, sort, totals) are the SQL list engine's
 * (`budget-list/`), which builds rows for the lines of one page only.
 */

/**
 * The five budget columns are equal slots: every year of the summary carries
 * all five, and every behaviour iterates this table (no column is special).
 * `measure` is the amount column, `key` the slot total, `suffix` the field
 * suffix (`yPlus1Forecast`), `ai` the AI key part (`y_plus1_forecast`), `label`
 * the product default name. The keys are technical aliases kept for the API.
 */
export const SUMMARY_COLUMNS = [
  { measure: 'planned', key: 'budget', suffix: 'Budget', ai: 'budget', label: 'Budget' },
  { measure: 'committed', key: 'revision', suffix: 'Revision', ai: 'review', label: 'Revision' },
  { measure: 'forecast', key: 'forecast', suffix: 'Forecast', ai: 'forecast', label: 'Forecast' },
  { measure: 'actual', key: 'follow_up', suffix: 'FollowUp', ai: 'actual', label: 'Actuals' },
  { measure: 'expected_landing', key: 'landing', suffix: 'Landing', ai: 'landing', label: 'Expected landing' },
] as const;

export type SummaryColumn = (typeof SUMMARY_COLUMNS)[number];
export type SlotMetric = SummaryColumn['key'];

/** The slots every row carries, relative to the current year. */
export const FIXED_SLOTS = [
  { key: 'yMinus2', offset: -2, ai: 'y_minus2', label: 'Y-2' },
  { key: 'yMinus1', offset: -1, ai: 'y_minus1', label: 'Y-1' },
  { key: 'y', offset: 0, ai: 'y', label: 'Y' },
  { key: 'yPlus1', offset: 1, ai: 'y_plus1', label: 'Y+1' },
  { key: 'yPlus2', offset: 2, ai: 'y_plus2', label: 'Y+2' },
] as const;

export type FixedSlot = (typeof FIXED_SLOTS)[number];

export type SummaryScope = 'opex' | 'capex';

export interface SummaryScopeConfig {
  scope: SummaryScope;
  itemEntity: typeof SpendItem | typeof CapexItem;
  versionEntity: typeof SpendVersion | typeof CapexVersion;
  itemTable: string;
  versionTable: string;
  /**
   * One row per version with the sums of its months of its own budget year,
   * kept by the database (migration 1853720000000): the list reads them
   * instead of aggregating the amounts.
   */
  totalsTable: string;
  /** One round per version and column: period, method and the FTE of its lines. */
  roundTable: string;
  versionItemFk: string;
  contractLink: { table: string; itemColumn: string };
  projectLink: { table: string; itemColumn: string };
  /** One value per line and analytics dimension (`item_id`, `axis_id`, `category_id`). */
  analyticsLink: { table: string };
  taskObjectType: string;
  refPrefix: string;
  nameField: string;
  /** Columns of the item table: the fields the plain item list (`GET /<items>`) filters and sorts on. */
  columns: readonly string[];
  /** Item fields of this type only, searched by the quick search and offered by the filter values. */
  extraFields: readonly string[];
  /**
   * Grid shape: the item columns the list grid reads; the row then carries
   * those, the derived fields the grid shows (`GRID_DERIVED_FIELDS`) and the
   * amounts it shows, nothing else.
   */
  gridItemColumns: readonly string[];
}

// Table and column names come only from here: never from the caller.
export const SUMMARY_SCOPES: Record<SummaryScope, SummaryScopeConfig> = {
  opex: {
    scope: 'opex',
    itemEntity: SpendItem,
    versionEntity: SpendVersion,
    itemTable: 'spend_items',
    versionTable: 'spend_versions',
    totalsTable: 'spend_version_totals',
    roundTable: 'spend_round_inputs',
    versionItemFk: 'spend_item_id',
    contractLink: { table: 'contract_spend_items', itemColumn: 'spend_item_id' },
    projectLink: { table: 'portfolio_project_opex', itemColumn: 'opex_id' },
    analyticsLink: { table: 'spend_item_analytics_values' },
    taskObjectType: 'spend_item',
    refPrefix: 'opx',
    nameField: 'product_name',
    columns: [
      'id', 'item_number', 'product_name', 'description', 'supplier_id', 'account_id', 'paying_company_id', 'currency',
      'effective_start', 'disabled_at', 'status', 'owner_it_id', 'owner_business_id', 'project_id',
      'contract_id', 'cost_center_id', 'run_build', 'notes', 'created_at', 'updated_at',
    ],
    extraFields: [],
    // Read by OpexListPage.tsx: the cells, their tooltips and links, the row id and the delete
    // confirmation (product_name).
    gridItemColumns: [
      'id', 'item_number', 'product_name', 'description', 'status', 'currency', 'effective_start', 'disabled_at',
      'notes', 'created_at', 'updated_at',
    ],
  },
  capex: {
    scope: 'capex',
    itemEntity: CapexItem,
    versionEntity: CapexVersion,
    itemTable: 'capex_items',
    versionTable: 'capex_versions',
    totalsTable: 'capex_version_totals',
    roundTable: 'capex_round_inputs',
    versionItemFk: 'capex_item_id',
    contractLink: { table: 'contract_capex_items', itemColumn: 'capex_item_id' },
    projectLink: { table: 'portfolio_project_capex', itemColumn: 'capex_id' },
    analyticsLink: { table: 'capex_item_analytics_values' },
    taskObjectType: 'capex_item',
    refPrefix: 'cpx',
    nameField: 'description',
    columns: [
      'id', 'item_number', 'description', 'paying_company_id', 'supplier_id', 'account_id', 'ppe_type', 'investment_type', 'priority',
      'currency', 'effective_start', 'disabled_at', 'status', 'owner_it_id', 'owner_business_id', 'project_id',
      'cost_center_id', 'run_build', 'notes', 'created_at', 'updated_at',
    ],
    extraFields: ['ppe_type', 'investment_type', 'priority'],
    // Read by CapexPage.tsx: the cells (the three enums through their labels), their tooltips and
    // links, the row id and the delete confirmation (description).
    gridItemColumns: [
      'id', 'item_number', 'description', 'ppe_type', 'investment_type', 'priority', 'status', 'currency', 'effective_start',
      'disabled_at', 'notes', 'created_at', 'updated_at',
    ],
  },
};

type AllocationShareLike = { company_id: string | null; department_id: string | null; allocation_pct: number };
type AllocationLike = { resolvedMethod?: string | null; shares?: AllocationShareLike[]; error?: string | null };

export interface SummaryDeps {
  allocationCalculator: {
    computeForVersions(versions: any[], opts: { manager?: EntityManager; tenantId: string; suppressErrors?: boolean }): Promise<Map<string, AllocationLike>>;
  };
  fxRates: Pick<FxRateService, 'resolveRates' | 'convertValue'>;
}

/**
 * Enum columns that sort in their business order, the declaration order of
 * their database enum, not alphabetically by code: the list engine ranks
 * their values (a value outside the list sorts as blank). The CAPEX priority,
 * investment type and PPE type joined status and run or build with lot 2B's
 * decision Q4 (they sorted by code before: high, low, mandatory, medium). A
 * spec checks each list against `pg_enum`.
 */
export const FIXED_SORT_ORDERS: Record<string, readonly string[]> = {
  status: [StatusState.ENABLED, StatusState.DISABLED],
  run_build: ['run', 'build'],
  priority: ['mandatory', 'high', 'medium', 'low'],
  investment_type: ['replacement', 'capacity', 'productivity', 'security', 'conformity', 'business_growth', 'other'],
  ppe_type: ['hardware', 'software'],
};

export type SummarySlotTotals = Record<SlotMetric, number>;

export type SummarySlot = {
  year?: number;
  version_id?: string;
  totals: SummarySlotTotals;
  reporting?: SummarySlotTotals & {
    currency: string;
    reporting_currency: string;
    fx_rate: number;
    fx_source: FxResolvedRate['source'];
    fx_rate_set_id: string | null;
  };
};

export type BudgetSummaryRow = Record<string, any> & {
  id: string;
  company_name: string | null;
  paying_company_name: string | null;
  supplier?: { id: string; name: string };
  supplier_name?: string;
  account?: { id: string; account_number: string; account_name: string };
  account_number?: string;
  account_name?: string;
  account_display?: string;
  account_warning: string | null;
  owner_it_name: string;
  owner_business_name: string;
  /**
   * The value on the default analytics dimension, read from the links (never
   * the legacy item column). Every dimension of the tenant also has its own
   * key `analytics_<axis id>` (the value's name, null when the line has none).
   */
  analytics_category_id: string | null;
  analytics_category_name: string | null;
  /** The line's values by dimension: `{ [axis id]: category id }`, dimensions without a value left out. */
  analytics_value_ids: Record<string, string>;
  cost_center_id: string | null;
  cost_center_code: string | null;
  cost_center_name: string | null;
  /** `code · name`, the list column. */
  cost_center_label: string | null;
  /** Names from the root group to the cost center, joined with ' › '. */
  cost_center_path: string | null;
  /** The cost center's owner, derived at read time (never stored on the line). */
  budget_holder_id: string | null;
  budget_holder_name: string | null;
  run_build: 'run' | 'build' | null;
  latest_contract_id: string | null;
  latest_contract_name: string;
  project_name: string | null;
  project_stream_name: string | null;
  project_category_name: string | null;
  latest_task?: { id: string; title: string | null; description: string | null; status: string; created_at: Date } | null;
  spread_mode_for_y: 'flat' | 'manual' | null;
  allocation_method_label: string;
  allocation_warning: string | null;
  main_recipient?: { company_id: string | null; department_id: string | null; pct?: number; label: string } | null;
  next_year_allocation_method_label?: string;
  versions: Record<string, SummarySlot>;
};

/** The OPEX name of the row type, kept for existing imports. */
export type SpendSummaryRow = BudgetSummaryRow;

export interface BuildRowsOptions {
  /** Every year to read; each gets a `y<year>` slot next to the fixed ones. */
  years: number[];
  currentYear: number;
  includeLatestTask?: boolean;
  includeRecipientDetails?: boolean;
  includeNextYearAllocation?: boolean;
  /**
   * `full` (default): every key, as the AI and the API read them. `grid`: the
   * keys the list grid shows (`gridRow`: the scope's `gridItemColumns`, the
   * derived fields and enabled dimensions the grid shows, the latest task's
   * title, the four list year slots, the `fte_*` keys of `fteKeys`), and no
   * allocation computation when `allocationLabels` gives each line's label.
   */
  shape?: 'full' | 'grid';
  /** Grid shape: the FTE keys to emit (`fte_yBudget`, `fte_y2028Revision`). */
  fteKeys?: readonly string[];
  /** Grid shape: the allocation method label of each item, read by the list statement. */
  allocationLabels?: ReadonlyMap<string, string>;
}

type Cents = Record<SlotMetric, bigint>;

type VersionReporting = {
  cents: Cents;
  currency: string;
  reporting_currency: string;
  fx_rate: number;
  fx_source: FxResolvedRate['source'];
  fx_rate_set_id: string | null;
};

export interface VersionTotals {
  /** One version per item and year: the newest when several exist, as the budget tab shows. */
  versionsByItemYear: Map<string, Map<number, any>>;
  /** Per version, in the item's currency. */
  cents: Map<string, Cents>;
  /** Per version with amounts, converted to the reporting currency. */
  reporting: Map<string, VersionReporting>;
  reportingCurrency: string;
  /**
   * Per version and measure with quantity × price lines, the yearly FTE the
   * lines give (2 decimals; `0` when no line counts people or days). Filled
   * only when asked; a measure without lines is absent (unknown, never 0).
   */
  fte: Map<string, Map<string, string>>;
}

const zeroCents = (): Cents => Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, 0n])) as Cents;

/**
 * The account as the list shows, sorts and filters it: "6110 - Software", or the
 * number alone when the account has no name (never "6110 - "). The list
 * statement computes the same text (`budget-list.config.ts`).
 */
export function accountDisplayText(accountNumber: unknown, accountName: unknown): string {
  const name = accountName == null ? '' : String(accountName);
  return name === '' ? String(accountNumber) : `${accountNumber} - ${name}`;
}

/** Year slots the list grid shows (Y-1 to Y+2); Y-2 and named years stay in the full shape. */
const GRID_VERSION_SLOTS = ['yMinus1', 'y', 'yPlus1', 'yPlus2'] as const;

/**
 * Derived fields the list grid reads (grid shape with `gridItemColumns`): names
 * and labels its cells, tooltips and links show, besides the item columns, the
 * default dimension's value name, the enabled other dimensions, the latest
 * task's title, the amounts and the requested FTE keys.
 */
const GRID_DERIVED_FIELDS = [
  'cost_center_id', 'run_build', 'latest_contract_id', 'latest_contract_name', 'supplier_name', 'paying_company_name',
  'account_display', 'allocation_method_label', 'owner_it_name', 'owner_business_name', 'cost_center_label',
  'cost_center_path', 'budget_holder_name', 'project_name', 'analytics_category_name',
] as const;

/**
 * A year slot as the grid reads it: the five amounts the cells show, in the
 * reporting currency (`reporting`, the key the full shape uses), or nothing
 * when the line has no version that year (the cells show 0, as for the full
 * slot's zero totals).
 */
function gridSlot(slot: SummarySlot | undefined): { reporting?: SummarySlotTotals } {
  if (!slot?.version_id) return {};
  const source: SummarySlotTotals = slot.reporting ?? slot.totals;
  return { reporting: Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, source[c.key]])) as SummarySlotTotals };
}

export function centsToNumbers(cents: Cents): SummarySlotTotals {
  return Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, centsToNumber(cents[c.key])])) as SummarySlotTotals;
}

/** The tenant of the request transaction; every engine query names it explicitly besides RLS. */
export async function summaryTenantId(manager: EntityManager): Promise<string> {
  const [row] = await manager.query(`SELECT app_current_tenant() AS tenant_id`);
  const tenantId = row?.tenant_id as string | null;
  if (!tenantId) throw new BadRequestException('Tenant context is required');
  return tenantId;
}

/** Four-digit years from 1000 to 9999, without duplicates (`2028,2029`, an array, or numbers); anything else is ignored. */
export function parseSummaryYears(raw: unknown): number[] {
  const parts = Array.isArray(raw) ? raw.flatMap((part) => String(part).split(',')) : typeof raw === 'string' ? raw.split(',') : [];
  const years = parts.map((part) => String(part).trim()).filter((part) => /^\d{4}$/.test(part)).map(Number);
  return Array.from(new Set(years.filter((year) => year >= 1000)));
}

/** The UTC year of the end of validity: later years show nothing. */
function endOfValidityYear(disabledAt: unknown): number | null {
  if (!disabledAt) return null;
  const date = disabledAt instanceof Date ? disabledAt : new Date(disabledAt as string);
  return Number.isNaN(date.getTime()) ? null : date.getUTCFullYear();
}

/** The version an item shows for `year`: none after the year of its end of validity. */
export function versionWithinValidity<T>(perYear: Map<number, T> | undefined, year: number, disabledAt: unknown): T | undefined {
  const endYear = endOfValidityYear(disabledAt);
  return endYear != null && year > endYear ? undefined : perYear?.get(year);
}

const SLOT_FIELD = new RegExp(
  `^(${[...FIXED_SLOTS.filter((s) => s.key !== 'y').map((s) => s.key), 'y\\d{4}', 'y'].join('|')})(${SUMMARY_COLUMNS.map((c) => c.suffix).join('|')})$`,
);

/** `<slot><Suffix>` (`yPlus1Forecast`, `y2028Revision`) to its slot and column; null for any other field. */
export function resolveAmountField(field: string): { slot: string; year: number | null; column: SummaryColumn } | null {
  const match = SLOT_FIELD.exec(String(field ?? ''));
  if (!match) return null;
  const [, slot, suffix] = match;
  const column = SUMMARY_COLUMNS.find((c) => c.suffix === suffix)!;
  const dynamic = /^y(\d{4})$/.exec(slot);
  if (dynamic) {
    const year = Number(dynamic[1]);
    return year >= 1000 ? { slot, year, column } : null;
  }
  return { slot, year: null, column };
}

/** The FTE field of an amount field: `fte_<slot><Suffix>` (`fte_yBudget`, `fte_y2028Revision`). */
export const FTE_FIELD_PREFIX = 'fte_';

export function fteFieldKey(amountField: string): string {
  return `${FTE_FIELD_PREFIX}${amountField}`;
}

/** `fte_<slot><Suffix>` to its slot and column, like `resolveAmountField`; null for any other field. */
export function resolveFteField(field: string): ReturnType<typeof resolveAmountField> {
  const text = String(field ?? '');
  return text.startsWith(FTE_FIELD_PREFIX) ? resolveAmountField(text.slice(FTE_FIELD_PREFIX.length)) : null;
}

/** Years named by `y<YYYY><Suffix>` and `fte_y<YYYY><Suffix>` fields (a sort or a filter key), so their slot is loaded. */
export function yearsNamedByFields(fields: string[]): number[] {
  const years = new Set<number>();
  for (const field of fields) {
    const resolved = resolveAmountField(field) ?? resolveFteField(field);
    if (resolved?.year != null) years.add(resolved.year);
  }
  return Array.from(years);
}

function slotValue(row: any, slotKey: string, metric: SlotMetric): number {
  const slot = row?.versions?.[slotKey];
  if (!slot) return 0;
  if (slot.reporting && typeof slot.reporting[metric] === 'number') return slot.reporting[metric];
  if (slot.totals && typeof slot.totals[metric] === 'number') return slot.totals[metric];
  return 0;
}

function displayName(user?: User | null): string {
  if (!user) return '';
  const fn = (user as any).first_name ? String((user as any).first_name).trim() : '';
  const ln = (user as any).last_name ? String((user as any).last_name).trim() : '';
  const name = [fn, ln].filter(Boolean).join(' ');
  return name || (user as any).email || '';
}

// The engine's text order (ICU, then code points), so the joined names equal the list statement's.
const byName = (a: string, b: string) => naturalCompare(a, b);
const joinNames = (names: string[]) => (names.length ? names.join(', ') : null);

/**
 * The project fields join the names of every linked project with ", ". The
 * names themselves are kept per built row, so a filter or a filter-value list
 * can work with one name (a name may itself contain ", ").
 */
export const PROJECT_LIST_FIELDS: readonly string[] = ['project_name', 'project_stream_name', 'project_category_name'];
const projectNamesByRow = new WeakMap<object, Record<string, string[]>>();

function projectNames(row: any, field: string): string[] {
  const lists = row && typeof row === 'object' ? projectNamesByRow.get(row) : undefined;
  if (lists) return lists[field] ?? [];
  // A row not built here (a copy, a test double) carries the joined value only.
  const joined = row?.[field];
  return joined == null || joined === '' ? [] : String(joined).split(', ').filter(Boolean);
}

/** Every value a row holds for `field`: each linked name for the project fields, else the one field value. */
export function summaryFieldValues(row: any, field: string): unknown[] {
  return PROJECT_LIST_FIELDS.includes(field) ? projectNames(row, field) : [getSummaryFieldValue(row, field)];
}

/**
 * Versions of the items for the given years (the newest per item and year) and
 * their totals: the stored sums of each version's months of its own year (a
 * version without such a month has no totals row, so no entry), kept in cents,
 * and each version converted to the reporting currency once.
 */
export async function loadVersionTotals(
  config: SummaryScopeConfig,
  deps: Pick<SummaryDeps, 'fxRates'>,
  manager: EntityManager,
  tenantId: string,
  items: any[],
  years: number[],
  opts: { reporting: boolean; fte?: boolean },
): Promise<VersionTotals> {
  const result: VersionTotals = { versionsByItemYear: new Map(), cents: new Map(), reporting: new Map(), reportingCurrency: 'EUR', fte: new Map() };
  const itemIds = items.map((item) => item.id);
  const uniqueYears = Array.from(new Set(years));
  const versions: any[] = itemIds.length && uniqueYears.length
    ? await manager.getRepository<any>(config.versionEntity as any)
      .createQueryBuilder('v')
      .where('v.tenant_id = :tenantId', { tenantId })
      .andWhere(`v.${config.versionItemFk} = ANY(:itemIds)`, { itemIds })
      .andWhere('v.budget_year = ANY(:years)', { years: uniqueYears })
      .orderBy('v.created_at', 'DESC')
      .addOrderBy('v.id', 'DESC')
      .getMany()
    : [];
  const kept: any[] = [];
  for (const version of versions) {
    const itemId = version[config.versionItemFk] as string;
    const year = Number(version.budget_year);
    let perYear = result.versionsByItemYear.get(itemId);
    if (!perYear) {
      perYear = new Map();
      result.versionsByItemYear.set(itemId, perYear);
    }
    if (perYear.has(year)) continue;
    perYear.set(year, version);
    kept.push(version);
  }

  if (kept.length) {
    const sums: Array<Record<string, string>> = await manager.query(
      // Cents straight from the database: the stored sums have 2 decimals, and round() is half away from zero
      // like toCents. Numeric, not bigint: twelve months of numeric(18,2) can exceed a bigint of cents.
      `SELECT t.version_id, ${SUMMARY_COLUMNS.map((c) => `round(t.${c.measure} * 100)::text AS ${c.measure}`).join(', ')}
       FROM ${config.totalsTable} t
       WHERE t.tenant_id = $1 AND t.version_id = ANY($2::uuid[])`,
      [tenantId, kept.map((v) => v.id)],
    );
    for (const row of sums) {
      result.cents.set(row.version_id, Object.fromEntries(SUMMARY_COLUMNS.map((c) => [c.key, BigInt(row[c.measure])])) as Cents);
    }
    if (opts.fte) result.fte = await loadVersionFte(config, manager, tenantId, kept.map((v) => v.id));
  }

  if (!opts.reporting) return result;

  const itemById = new Map(items.map((item) => [item.id, item]));
  const currencyOf = (version: any) => String(itemById.get(version[config.versionItemFk])?.currency || 'EUR').trim().toUpperCase();
  const lookups: FxLookupKey[] = kept.map((version) => ({
    key: '',
    rateSetId: version.fx_rate_set_id ?? null,
    fiscalYear: Number(version.budget_year),
    sourceCurrency: currencyOf(version),
  }));
  const fx = await deps.fxRates.resolveRates(tenantId, lookups, { manager });
  result.reportingCurrency = fx.settings?.reportingCurrency ?? 'EUR';
  for (const version of kept) {
    const cents = result.cents.get(version.id);
    if (!cents) continue;
    const currency = currencyOf(version);
    const rate = fx.map.get(`${version.fx_rate_set_id || 'live'}:${Number(version.budget_year)}:${currency}`);
    const fxRate = rate?.rate ?? 1;
    result.reporting.set(version.id, {
      cents: Object.fromEntries(SUMMARY_COLUMNS.map((c) => [
        c.key,
        toCents(deps.fxRates.convertValue(centsToNumber(cents[c.key]), fxRate)),
      ])) as Cents,
      currency,
      reporting_currency: rate?.reportingCurrency ?? result.reportingCurrency,
      fx_rate: fxRate,
      fx_source: rate?.source ?? 'identity',
      fx_rate_set_id: version.fx_rate_set_id ?? null,
    });
  }
  return result;
}

/**
 * The yearly FTE of each round with lines, in one query: stored with the
 * round when its lines are written, so a later hand edit or spread of the
 * months leaves it as the lines gave it.
 */
async function loadVersionFte(
  config: SummaryScopeConfig,
  manager: EntityManager,
  tenantId: string,
  versionIds: string[],
): Promise<Map<string, Map<string, string>>> {
  const rounds: Array<{ version_id: string; measure: string; fte: string }> = await manager.query(
    `SELECT r.version_id, r.measure, r.fte::text AS fte
     FROM ${config.roundTable} r
     WHERE r.tenant_id = $1
       AND r.version_id = ANY($2::uuid[])
       AND r.fte IS NOT NULL`,
    [tenantId, versionIds],
  );
  const result = new Map<string, Map<string, string>>();
  for (const round of rounds) {
    let perMeasure = result.get(round.version_id);
    if (!perMeasure) {
      perMeasure = new Map();
      result.set(round.version_id, perMeasure);
    }
    perMeasure.set(round.measure, Decimal.from(round.fte).toString());
  }
  return result;
}

/** The yearly FTE a version holds in one column: null (unknown) without a version or lines. */
export function versionFte(totals: VersionTotals, version: any | undefined, measure: string): string | null {
  return version ? totals.fte.get(version.id)?.get(measure) ?? null : null;
}

function toSlot(version: any | undefined, totals: VersionTotals): SummarySlot {
  if (!version) {
    return { year: undefined, totals: centsToNumbers(zeroCents()), version_id: undefined, reporting: undefined };
  }
  const reporting = totals.reporting.get(version.id);
  return {
    year: Number(version.budget_year),
    totals: centsToNumbers(totals.cents.get(version.id) ?? zeroCents()),
    version_id: version.id,
    reporting: reporting
      ? {
          ...centsToNumbers(reporting.cents),
          currency: reporting.currency,
          reporting_currency: reporting.reporting_currency,
          fx_rate: reporting.fx_rate,
          fx_source: reporting.fx_source,
          fx_rate_set_id: reporting.fx_rate_set_id,
        }
      : undefined,
  };
}

async function findByIds<T>(manager: EntityManager, entity: any, tenantId: string, ids: string[]): Promise<T[]> {
  if (!ids.length) return [];
  return manager.getRepository<any>(entity).find({ where: { tenant_id: tenantId, id: In(ids) } as any }) as Promise<T[]>;
}

const distinct = (values: unknown[]) => Array.from(new Set(values.filter(Boolean))) as string[];

/**
 * Code, name, path and budget holder (the node's owner) of the cost centers
 * the items name: the tenant's tree is read once (it is small, one query with
 * the owner joined) and the paths computed in memory; no read without a cost
 * center on the page.
 */
async function loadCostCentersForRows(
  manager: EntityManager,
  tenantId: string,
  items: any[],
): Promise<Map<string, { code: string; name: string; path: string; owner_user_id: string | null; owner_name: string | null }>> {
  if (!items.some((item) => item.cost_center_id)) return new Map();
  const nodes = await loadCostCenterTree(manager, tenantId);
  return new Map(nodes.map((node) => [node.id, {
    code: node.code,
    name: node.name,
    path: node.path,
    owner_user_id: node.owner_user_id,
    owner_name: node.owner_name,
  }]));
}

type ItemAnalyticsValue = { category_id: string; name: string | null };

/**
 * The tenant's analytics dimensions and the values the items hold on them, in
 * one query: every dimension comes back at least once (with no link when no
 * item has a value on it), then once per link row of the given items. A tenant
 * without dimensions reads as none (read paths never create the default).
 */
async function loadAnalyticsForRows(
  config: SummaryScopeConfig,
  manager: EntityManager,
  tenantId: string,
  itemIds: string[],
): Promise<{ axisIds: string[]; activeAxisIds: Set<string>; defaultAxisId: string | null; byItem: Map<string, Map<string, ItemAnalyticsValue>> }> {
  const rows: Array<{ axis_id: string; is_default: boolean; active: boolean; item_id: string | null; category_id: string | null; category_name: string | null }> =
    await manager.query(
      // `active`: enabled now, as the list builds its dimension columns (isAnalyticsActive in the web app).
      `SELECT ax.id AS axis_id, ax.is_default,
              (ax.status <> 'disabled' AND (ax.disabled_at IS NULL OR ax.disabled_at > now())) AS active,
              v.item_id, v.category_id, c.name AS category_name
       FROM analytics_axes ax
       LEFT JOIN ${config.analyticsLink.table} v
         ON v.tenant_id = $1 AND v.axis_id = ax.id AND v.item_id = ANY($2::uuid[])
       LEFT JOIN analytics_categories c ON c.id = v.category_id AND c.tenant_id = $1
       WHERE ax.tenant_id = $1
       ORDER BY ax.sort_order, ax.id`, // the dimensions' order, whatever the plan: the rows' keys come in it
      [tenantId, itemIds],
    );
  const axisIds = new Set<string>();
  const activeAxisIds = new Set<string>();
  let defaultAxisId: string | null = null;
  const byItem = new Map<string, Map<string, ItemAnalyticsValue>>();
  for (const row of rows) {
    axisIds.add(row.axis_id);
    if (row.active) activeAxisIds.add(row.axis_id);
    if (row.is_default) defaultAxisId = row.axis_id;
    if (!row.item_id || !row.category_id) continue;
    let values = byItem.get(row.item_id);
    if (!values) {
      values = new Map();
      byItem.set(row.item_id, values);
    }
    values.set(row.axis_id, { category_id: row.category_id, name: row.category_name ?? null });
  }
  return { axisIds: Array.from(axisIds), activeAxisIds, defaultAxisId, byItem };
}

/** One summary row per item (same order), for the years given; slots after the end of validity are empty. */
export async function buildBudgetSummaryRows(
  config: SummaryScopeConfig,
  deps: SummaryDeps,
  manager: EntityManager,
  tenantId: string,
  items: any[],
  options: BuildRowsOptions,
): Promise<BudgetSummaryRow[]> {
  if (!items.length) return [];
  const Y = options.currentYear;
  const years = Array.from(new Set(options.years)).sort((a, b) => a - b);
  const itemIds = items.map((item) => item.id);
  const grid = options.shape === 'grid';
  const gridFteKeys = new Set(options.fteKeys ?? []);
  const labelsFromList = grid ? options.allocationLabels : undefined;
  const totals = await loadVersionTotals(config, deps, manager, tenantId, items, years, { reporting: true, fte: !grid || gridFteKeys.size > 0 });

  const versionsOfYear = (year: number) => Array.from(totals.versionsByItemYear.values())
    .map((perYear) => perYear.get(year))
    .filter((version): version is any => !!version);
  const allocate = async (year: number) => {
    const versions = versionsOfYear(year);
    return versions.length
      ? deps.allocationCalculator.computeForVersions(versions, { manager, tenantId, suppressErrors: true })
      : new Map<string, AllocationLike>();
  };
  const allocationForY = labelsFromList ? new Map<string, AllocationLike>() : await allocate(Y);
  const allocationForNext = options.includeNextYearAllocation && !grid ? await allocate(Y + 1) : new Map<string, AllocationLike>();

  const [suppliers, accounts, owners, payingCompanies] = await Promise.all([
    findByIds<Supplier>(manager, Supplier, tenantId, distinct(items.map((i) => i.supplier_id))),
    findByIds<Account>(manager, Account, tenantId, distinct(items.map((i) => i.account_id))),
    findByIds<User>(manager, User, tenantId, distinct(items.flatMap((i) => [i.owner_it_id, i.owner_business_id]))),
    findByIds<Company>(manager, Company, tenantId, distinct(items.map((i) => i.paying_company_id))),
  ]);
  const analytics = await loadAnalyticsForRows(config, manager, tenantId, itemIds);
  const costCenterById = await loadCostCentersForRows(manager, tenantId, items);
  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const ownerById = new Map(owners.map((u) => [u.id, u]));
  const payingCompanyById = new Map(payingCompanies.map((c) => [c.id, c]));

  const contracts: Array<{ item_id: string; contract_id: string; contract_name: string }> = await manager.query(
    `SELECT DISTINCT ON (l.${config.contractLink.itemColumn})
            l.${config.contractLink.itemColumn} AS item_id, c.id AS contract_id, c.name AS contract_name
     FROM ${config.contractLink.table} l
     JOIN contracts c ON c.id = l.contract_id AND c.tenant_id = l.tenant_id
     WHERE l.tenant_id = $1 AND l.${config.contractLink.itemColumn} = ANY($2::uuid[])
     ORDER BY l.${config.contractLink.itemColumn}, l.created_at DESC, l.id DESC`,
    [tenantId, itemIds],
  );
  const contractByItem = new Map(contracts.map((row) => [row.item_id, row]));

  // Projects linked in the Relations panel, plus the legacy item field when set and not already linked.
  const projectRows: Array<{ item_id: string; name: string; stream_name: string | null; category_name: string | null }> = await manager.query(
    `SELECT l.item_id, p.name, pst.name AS stream_name, pc.name AS category_name
     FROM (
       SELECT pl.${config.projectLink.itemColumn} AS item_id, pl.project_id
       FROM ${config.projectLink.table} pl
       WHERE pl.tenant_id = $1 AND pl.${config.projectLink.itemColumn} = ANY($2::uuid[])
       UNION
       SELECT i.id AS item_id, i.project_id
       FROM ${config.itemTable} i
       WHERE i.tenant_id = $1 AND i.id = ANY($2::uuid[]) AND i.project_id IS NOT NULL
     ) l
     JOIN portfolio_projects p ON p.id = l.project_id AND p.tenant_id = $1
     LEFT JOIN portfolio_streams pst ON pst.id = p.stream_id AND pst.tenant_id = p.tenant_id
     LEFT JOIN portfolio_categories pc ON pc.id = p.category_id AND pc.tenant_id = p.tenant_id`,
    [tenantId, itemIds],
  );
  const projectsByItem = new Map<string, typeof projectRows>();
  for (const row of projectRows) {
    const list = projectsByItem.get(row.item_id) ?? [];
    list.push(row);
    projectsByItem.set(row.item_id, list);
  }

  const latestTaskByItem = new Map<string, NonNullable<BudgetSummaryRow['latest_task']>>();
  if (options.includeLatestTask) {
    const tasks: Array<{ id: string; related_object_id: string; title: string | null; description: string | null; status: string; created_at: Date }> = await manager.query(
      `SELECT DISTINCT ON (related_object_id) id, related_object_id, title, description, status, created_at
       FROM tasks
       WHERE tenant_id = $1
         AND related_object_type = $2
         AND related_object_id = ANY($3::uuid[])
         AND status = ANY($4)
       ORDER BY related_object_id, created_at DESC, id DESC`,
      [tenantId, config.taskObjectType, itemIds, ACTIVE_TASK_STATUSES],
    );
    for (const { related_object_id: itemId, ...task } of tasks) {
      if (grid) delete (task as any).description;
      latestTaskByItem.set(itemId, task as any);
    }
  }

  let companyById = new Map<string, Company>();
  let departmentById = new Map<string, Department>();
  if (options.includeRecipientDetails && !grid && allocationForY.size) {
    const shares = Array.from(allocationForY.values()).flatMap((entry) => entry.shares ?? []);
    const [companies, departments] = await Promise.all([
      findByIds<Company>(manager, Company, tenantId, distinct(shares.map((s) => s.company_id))),
      findByIds<Department>(manager, Department, tenantId, distinct(shares.map((s) => s.department_id))),
    ]);
    companyById = new Map(companies.map((c) => [c.id, c]));
    departmentById = new Map(departments.map((d) => [d.id, d]));
  }

  const mainRecipient = (allocation: AllocationLike | undefined): BudgetSummaryRow['main_recipient'] => {
    const shares = allocation?.shares ?? [];
    if (!shares.length) return null;
    const top = shares.reduce((acc, share) => (share.allocation_pct > acc.allocation_pct ? share : acc), shares[0]);
    const company = top.company_id ? companyById.get(top.company_id) : undefined;
    if (!company) return null;
    const department = top.department_id ? departmentById.get(top.department_id) : undefined;
    const pct = Number(top.allocation_pct || 0);
    return department
      ? { company_id: top.company_id, department_id: top.department_id, pct, label: `${company.name} - ${department.name} (${pct.toFixed(2)}%)` }
      : { company_id: top.company_id, department_id: null, pct, label: `${company.name} (${pct.toFixed(2)}%)` };
  };

  const fixedYears = new Set(FIXED_SLOTS.map((slot) => Y + slot.offset));
  // Grid shape: the dimensions the grid builds a column for (enabled, other than the default one).
  const gridAxisKeys = analytics.axisIds
    .filter((axisId) => axisId !== analytics.defaultAxisId && analytics.activeAxisIds.has(axisId))
    .map((axisId) => analyticsFieldKey(axisId));
  return items.map((item) => {
    const perYear = totals.versionsByItemYear.get(item.id);
    const shown = (year: number) => versionWithinValidity(perYear, year, item.disabled_at);
    const versions: Record<string, SummarySlot> = {};
    const fte: Record<string, number | null> = {};
    const slotYears: Array<[string, number]> = [
      ...FIXED_SLOTS.map((slot): [string, number] => [slot.key, Y + slot.offset]),
      ...years.filter((year) => !grid || !fixedYears.has(year)).map((year): [string, number] => [`y${year}`, year]),
    ];
    for (const [slotKey, year] of slotYears) {
      const version = shown(year);
      versions[slotKey] = toSlot(version, totals);
      for (const column of SUMMARY_COLUMNS) {
        const key = fteFieldKey(`${slotKey}${column.suffix}`);
        if (grid && !gridFteKeys.has(key)) continue;
        const value = versionFte(totals, version, column.measure);
        fte[key] = value == null ? null : Number(value);
      }
    }

    const current = shown(Y);
    const allocation = current ? allocationForY.get(current.id) : undefined;
    const next = shown(Y + 1);
    const nextAllocation = next ? allocationForNext.get(next.id) : undefined;

    const supplier = item.supplier_id ? supplierById.get(item.supplier_id) : undefined;
    const account = item.account_id ? accountById.get(item.account_id) : undefined;
    const analyticsValues = analytics.byItem.get(item.id);
    const defaultValue = analytics.defaultAxisId ? analyticsValues?.get(analytics.defaultAxisId) : undefined;
    const analyticsFields: Record<string, string | null> = {};
    const analyticsValueIds: Record<string, string> = {};
    for (const axisId of analytics.axisIds) {
      const value = analyticsValues?.get(axisId);
      analyticsFields[analyticsFieldKey(axisId)] = value?.name ?? null;
      if (value) analyticsValueIds[axisId] = value.category_id;
    }
    const costCenter = item.cost_center_id ? costCenterById.get(item.cost_center_id) : undefined;
    const payingCompany = item.paying_company_id ? payingCompanyById.get(item.paying_company_id) : undefined;
    const contract = contractByItem.get(item.id);
    const projects = projectsByItem.get(item.id) ?? [];
    const projectLists: Record<string, string[]> = {
      project_name: projects.map((p) => p.name).sort(byName),
      project_stream_name: distinct(projects.map((p) => p.stream_name)).sort(byName),
      project_category_name: distinct(projects.map((p) => p.category_name)).sort(byName),
    };

    // An account from another chart of accounts than the paying company's is obsolete.
    const accountCoa = (account as any)?.coa_id || null;
    const companyCoa = (payingCompany as any)?.coa_id || null;
    const accountWarning = accountCoa && companyCoa && accountCoa !== companyCoa ? 'coa_mismatch' : null;

    const row: BudgetSummaryRow = {
      ...item,
      company_name: payingCompany?.name ?? null,
      paying_company_name: payingCompany?.name ?? null,
      supplier: supplier ? { id: supplier.id, name: supplier.name } : undefined,
      supplier_name: supplier ? supplier.name : undefined,
      account: account ? { id: account.id, account_number: (account as any).account_number, account_name: (account as any).account_name } : undefined,
      account_number: account ? (account as any).account_number : undefined,
      account_name: account ? (account as any).account_name : undefined,
      account_display: account ? accountDisplayText((account as any).account_number, (account as any).account_name) : undefined,
      account_warning: accountWarning,
      owner_it_name: displayName(ownerById.get(item.owner_it_id) || null),
      owner_business_name: displayName(ownerById.get(item.owner_business_id) || null),
      analytics_category_id: defaultValue?.category_id ?? null,
      analytics_category_name: defaultValue?.name ?? null,
      ...analyticsFields,
      analytics_value_ids: analyticsValueIds,
      cost_center_id: item.cost_center_id ?? null,
      cost_center_code: costCenter?.code ?? null,
      cost_center_name: costCenter?.name ?? null,
      cost_center_label: costCenter ? costCenterLabel(costCenter) : null,
      cost_center_path: costCenter?.path ?? null,
      budget_holder_id: costCenter?.owner_user_id ?? null,
      budget_holder_name: costCenter?.owner_user_id ? costCenter.owner_name || null : null,
      run_build: item.run_build ?? null,
      latest_contract_id: contract?.contract_id ?? null,
      latest_contract_name: contract?.contract_name ?? '',
      project_name: joinNames(projectLists.project_name),
      project_stream_name: joinNames(projectLists.project_stream_name),
      project_category_name: joinNames(projectLists.project_category_name),
      latest_task: options.includeLatestTask ? latestTaskByItem.get(item.id) ?? null : undefined,
      spread_mode_for_y: current ? (current.input_grain === 'annual' ? 'flat' : 'manual') : null,
      allocation_method_label: labelsFromList
        ? labelsFromList.get(item.id) ?? ''
        : formatAllocationMethodLabel(allocation?.resolvedMethod ?? current?.allocation_method ?? null),
      allocation_warning: allocation?.error ?? null,
      versions,
      ...fte,
    };
    if (grid) return gridRow(row, config.gridItemColumns, gridAxisKeys, fte);
    if (options.includeRecipientDetails) {
      row.main_recipient = mainRecipient(allocation);
    }
    if (options.includeNextYearAllocation) {
      row.next_year_allocation_method_label = formatAllocationMethodLabel(nextAllocation?.resolvedMethod ?? next?.allocation_method ?? null);
    }
    projectNamesByRow.set(row, projectLists);
    return row;
  });
}

/**
 * The grid shape of a built row: the scope's grid item columns, the derived
 * fields and dimensions the grid shows, the latest task's title, the four list
 * year slots (`gridSlot`) and the requested FTE keys. About a quarter of the full row: no ids the grid does not link to, no
 * supplier or account objects, no Y-2 or named-year slots, no FX details.
 */
function gridRow(
  row: BudgetSummaryRow,
  itemColumns: readonly string[],
  axisKeys: readonly string[],
  fte: Record<string, number | null>,
): BudgetSummaryRow {
  const lean: Record<string, unknown> = {};
  for (const key of [...itemColumns, ...GRID_DERIVED_FIELDS, ...axisKeys]) lean[key] = row[key];
  if (row.latest_task !== undefined) lean.latest_task = row.latest_task ? { title: row.latest_task.title } : null;
  lean.versions = Object.fromEntries(GRID_VERSION_SLOTS.map((key) => [key, gridSlot(row.versions[key])]));
  Object.assign(lean, fte);
  return lean as BudgetSummaryRow;
}

/** The OPEX builder under its former name. */
export async function buildSpendSummaryRows(params: {
  manager: EntityManager;
  items: SpendItem[];
  years: number[];
  currentYear: number;
  allocationCalculator: SummaryDeps['allocationCalculator'];
  fxRates: SummaryDeps['fxRates'];
  includeRecipientDetails?: boolean;
  includeLatestTask?: boolean;
  tenantId?: string | null;
}): Promise<{ rows: BudgetSummaryRow[] }> {
  const tenantId = params.tenantId || (await summaryTenantId(params.manager));
  const rows = await buildBudgetSummaryRows(
    SUMMARY_SCOPES.opex,
    { allocationCalculator: params.allocationCalculator, fxRates: params.fxRates },
    params.manager,
    tenantId,
    params.items,
    params,
  );
  return { rows };
}

/**
 * The value of `field` on a built row, as the list shows it (the AI
 * aggregates group and measure with it; the list engine's oracle sorts and
 * filters on it): an amount field is the slot's reporting total (item
 * currency when there is no reporting), an FTE field its number or null
 * (unknown), a derived field its row value, anything else the item column.
 * Blank derived text reads as null so blanks sort last ascending.
 */
export function getSummaryFieldValue(row: any, field: string): any {
  const amount = resolveAmountField(field);
  if (amount) return slotValue(row, amount.slot, amount.column.key);
  if (resolveFteField(field)) return typeof row?.[field] === 'number' ? row[field] : null;
  const blankToNull = (value: unknown) => (value == null || value === '' ? null : value);
  switch (field) {
    case 'supplier_name':
      return blankToNull(row?.supplier_name ?? row?.supplier?.name);
    case 'paying_company_name':
      return blankToNull(row?.paying_company_name ?? row?.company_name);
    case 'company_name':
      return blankToNull(row?.company_name ?? row?.paying_company_name);
    case 'account_display':
    case 'account_name':
    case 'account_number':
    case 'owner_it_name':
    case 'owner_business_name':
    case 'analytics_category_name':
    case 'cost_center_code':
    case 'cost_center_name':
    case 'cost_center_label':
    case 'cost_center_path':
    case 'budget_holder_name':
    case 'project_name':
    case 'project_stream_name':
    case 'project_category_name':
    case 'account_warning':
      return blankToNull(row?.[field]);
    case 'contract_name':
      return blankToNull(row?.latest_contract_name);
    case 'allocation_label':
    case 'allocation_method_label':
      return blankToNull(row?.allocation_method_label);
    case 'latest_task_text':
      return blankToNull(row?.latest_task?.title);
    default: {
      // A key the row does not hold itself (`constructor`, `__proto__`…) reads as missing, never as an inherited member.
      const own = row != null && Object.prototype.hasOwnProperty.call(row, field) ? row[field] : undefined;
      // A dimension's value name (`analytics_<axis id>`) is derived text like the names above.
      return parseAnalyticsFieldKey(field) ? blankToNull(own) : own;
    }
  }
}

/** The OPEX name of the resolver, kept for existing imports. */
export const getSpendSummaryFieldValue = getSummaryFieldValue;
