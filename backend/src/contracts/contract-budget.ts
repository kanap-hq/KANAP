import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { FxRateService } from '../currency/fx-rate.service';
import { centsNumber, jsRound } from '../common/list-engine/sql-fragments';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';
import { BUDGET_YEAR_REACH, budgetListAmountsByIds } from '../spend/budget-list/budget-list.service';
import { SUMMARY_COLUMNS, SUMMARY_SCOPES } from '../spend/spend-summary.builder';
import { contractCommitmentSql } from './contract-terms';

/**
 * A contract against its budget lines (lot CB), for a year and a budget column the user picks.
 *
 * - Committed: the contract's commitment of the year (`contract-terms.ts`), converted to the
 *   reporting currency with the year's rates (`contractFxRates`, the conversion of the list's
 *   footer). Null when its currency has no rate that year (the totals name those currencies).
 * - Linked: the sum of its budget lines' amounts in that year and column, the very amounts the
 *   budget list shows for them (`budgetListAmountsByIds`), in the reporting currency.
 * - Gap: linked minus committed.
 * - State (`CONTRACT_BUDGET_STATES`), in this order: `no_commitment` (nothing committed, no line
 *   with an amount), `not_started` (no budget line of the tenant has an amount in that year and
 *   column), `no_line` (no linked line with an amount), `under` (linked below committed), `over`
 *   (linked above committed by more than `CONTRACT_BUDGET_OVER_PERCENT`), else `covered`.
 *
 * The five budget columns are equal: nothing here depends on a column's name or rank.
 *
 * One SQL statement gives these values for every contract of the tenant and year
 * (`contractBudgetSql`, a CTE the contract list joins to sort and filter on them, and the
 * contract page reads for its coverage table). Its inputs are read first, in a few statements
 * whatever the number of contracts (`loadContractBudgetInputs`): the line amounts by batch of
 * ids, the years that have budget data, the rates.
 */

export const CONTRACT_BUDGET_STATES = ['covered', 'under', 'over', 'no_line', 'no_commitment', 'not_started'] as const;
export type ContractBudgetState = (typeof CONTRACT_BUDGET_STATES)[number];

/** Linked lines above the commitment by more than this percentage read as "budget above the contract". */
export const CONTRACT_BUDGET_OVER_PERCENT = 10;

export type ContractBudgetColumn = (typeof SUMMARY_COLUMNS)[number]['measure'];
export type ContractBudgetSelection = { year: number; column: ContractBudgetColumn };

const LEVEL_RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };

/**
 * Whether the request may read budget amounts (`budget` reader or more, or an administrator), from
 * what `PermissionGuard` set on it. The contract's budget figures need it besides the contract.
 */
export function canReadContractBudget(req: { isAdmin?: boolean; permissions?: Record<string, string> } | null | undefined): boolean {
  return req?.isAdmin === true || (LEVEL_RANK[req?.permissions?.budget ?? ''] ?? 0) >= LEVEL_RANK.reader;
}

/** The current year of the budget figures (UTC, as the contract terms). */
export function contractBudgetCurrentYear(now: Date = new Date()): number {
  return now.getUTCFullYear();
}

/**
 * The year and column of a request (`yearKey`, `columnKey`): null when neither is given, 400 when
 * one is missing or invalid (a year more than `BUDGET_YEAR_REACH` years away, a column that is
 * not one of the five).
 */
export function parseContractBudgetSelection(
  query: Record<string, unknown> | null | undefined,
  currentYear: number,
  keys: { year: string; column: string } = { year: 'budget_year', column: 'budget_column' },
): ContractBudgetSelection | null {
  const rawYear = query?.[keys.year];
  const rawColumn = query?.[keys.column];
  const blank = (value: unknown) => value === undefined || value === null || value === '';
  if (blank(rawYear) && blank(rawColumn)) return null;
  const year = Number(rawYear);
  if (!Number.isInteger(year) || Math.abs(year - currentYear) > BUDGET_YEAR_REACH) {
    throw new BadRequestException(`${keys.year} must be a year within ${BUDGET_YEAR_REACH} years of ${currentYear}.`);
  }
  const column = SUMMARY_COLUMNS.find((entry) => entry.measure === rawColumn);
  if (!column) {
    throw new BadRequestException(`${keys.column} must be one of ${SUMMARY_COLUMNS.map((entry) => entry.measure).join(', ')}.`);
  }
  return { year, column: column.measure };
}

/**
 * The years the contract budget figures offer: the year before the current one when the budget
 * holds lines for it, the current year and the two after, and `extra` (the year asked for).
 */
export async function contractBudgetYears(manager: EntityManager, tenantId: string, currentYear: number, extra?: number): Promise<number[]> {
  const [row]: Array<{ previous: boolean }> = await manager.query(
    `SELECT EXISTS (
       SELECT 1 FROM spend_versions v
         JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id${naturesAnd('i', BUDGET_NATURES)}
        WHERE v.tenant_id = $1 AND v.budget_year = $2
     ) AS previous`,
    [tenantId, currentYear - 1],
  );
  const years = new Set([...(row?.previous ? [currentYear - 1] : []), currentYear, currentYear + 1, currentYear + 2]);
  if (extra != null) years.add(extra);
  return Array.from(years).sort((a, b) => a - b);
}

/** The currency a contract converts from: its code in upper case, EUR when blank (as the list's footer). */
export function contractCurrencySql(alias: string): string {
  return `COALESCE(NULLIF(UPPER(TRIM(${alias}.currency)), ''), 'EUR')`;
}

export type ContractFxRates = {
  reportingCurrency: string;
  /** The rate of `currency` to the reporting currency in `year`: 1 for the reporting currency, null without one. */
  rateOf(year: number, currency: string): number | null;
};

/**
 * The rates contract amounts convert with: each year's latest rate set, the one the budget's live
 * columns use. A currency the set does not rate (or a year without a set) has no rate: the FX
 * service would count it at 1. `resolveRates` is called with no lookup, for the tenant's
 * settings only: it resolves no rate. Years in which a contract currency of the tenant has no
 * rate are reported to the missing-rate listener, which fetches them.
 */
export async function contractFxRates(
  fxRates: Pick<FxRateService, 'resolveRates' | 'getLatestRateSet' | 'reportMissingYears'>,
  manager: EntityManager,
  tenantId: string,
  years: number[],
): Promise<ContractFxRates> {
  const { settings } = await fxRates.resolveRates(tenantId, [], { manager });
  const reportingCurrency = settings.reportingCurrency.toUpperCase();
  const uniqueYears = Array.from(new Set(years));
  const sets = new Map<number, Awaited<ReturnType<FxRateService['getLatestRateSet']>>>();
  for (const year of uniqueYears) {
    sets.set(year, await fxRates.getLatestRateSet(tenantId, year, reportingCurrency, { manager }));
  }
  const rates: ContractFxRates = {
    reportingCurrency,
    rateOf(year, currency) {
      const code = currency.toUpperCase();
      if (code === reportingCurrency) return 1;
      const raw = sets.get(year)?.rates?.[code];
      return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
    },
  };
  const rows: Array<{ currency: string | null }> = await manager.query(
    `SELECT DISTINCT UPPER(currency) AS currency FROM contracts WHERE tenant_id = $1`,
    [tenantId],
  );
  const codes = rows
    .map((row) => (typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : ''))
    .filter((code) => /^[A-Z]{3}$/.test(code));
  const missing = uniqueYears.filter((year) => codes.some((code) => rates.rateOf(year, code) == null));
  if (missing.length) fxRates.reportMissingYears(tenantId, missing);
  return rates;
}

/** What `contractBudgetSql` reads besides the contracts, for some years and one column. */
export type ContractBudgetInputs = {
  tenantId: string;
  years: number[];
  column: ContractBudgetColumn;
  reportingCurrency: string;
  /** The contracts the inputs were read for; null for every contract of the tenant. */
  contractIds: string[] | null;
  /** Per linked line, its amount (cents, reporting currency) in each year. */
  lineAmounts: Map<string, Map<number, bigint>>;
  /** The years in which some budget line of the tenant has an amount in the column. */
  startedYears: number[];
  /** The rates of the contracts' currencies, per year (null without a rate). */
  rates: Array<{ year: number; currency: string; rate: number | null }>;
};

/** The amount key of the budget list for a year and column (`y2027Budget`). */
export function budgetAmountKey(year: number, column: ContractBudgetColumn): string {
  return `y${year}${SUMMARY_COLUMNS.find((entry) => entry.measure === column)!.suffix}`;
}

/**
 * Reads the inputs of the budget figures of `contractIds` (null: every contract of the tenant) for
 * `years` and `column`: their linked lines' amounts from the budget list's engine (one statement
 * for every line), the years with budget data, the rates of their currencies.
 */
export async function loadContractBudgetInputs(
  deps: { fxRates: FxRateService },
  manager: EntityManager,
  tenantId: string,
  years: number[],
  column: ContractBudgetColumn,
  contractIds: string[] | null = null,
): Promise<ContractBudgetInputs> {
  const uniqueYears = Array.from(new Set(years)).sort((a, b) => a - b);
  const scoped = contractIds !== null;
  const ids = scoped ? Array.from(new Set(contractIds)) : [];
  const linked: Array<{ id: string }> = await manager.query(
    `SELECT DISTINCT l.spend_item_id AS id
       FROM contract_spend_items l
       JOIN spend_items i ON i.tenant_id = l.tenant_id AND i.id = l.spend_item_id${naturesAnd('i', BUDGET_NATURES)}
      WHERE l.tenant_id = $1${scoped ? ' AND l.contract_id = ANY($2::uuid[])' : ''}`,
    scoped ? [tenantId, ids] : [tenantId],
  );
  const keys = uniqueYears.map((year) => budgetAmountKey(year, column));
  const amounts = await budgetListAmountsByIds(SUMMARY_SCOPES.all, deps, manager, linked.map((row) => row.id), keys);
  const lineAmounts = new Map<string, Map<number, bigint>>();
  for (const [lineId, byKey] of amounts) {
    lineAmounts.set(lineId, new Map(uniqueYears.map((year, i) => [year, byKey[keys[i]] ?? 0n])));
  }

  // Validated against the five columns above: safe to name. A version after its line's end of
  // validity does not count, as the list hides it.
  const started: Array<{ yr: number }> = await manager.query(
    `SELECT DISTINCT v.budget_year AS yr
       FROM spend_versions v
       JOIN spend_items i ON i.tenant_id = v.tenant_id AND i.id = v.spend_item_id${naturesAnd('i', BUDGET_NATURES)}
       JOIN spend_version_totals t ON t.tenant_id = v.tenant_id AND t.version_id = v.id
      WHERE v.tenant_id = $1 AND v.budget_year = ANY($2::int[]) AND t.${column} <> 0
        AND (i.disabled_at IS NULL OR v.budget_year <= extract(year FROM i.disabled_at AT TIME ZONE 'UTC'))`,
    [tenantId, uniqueYears],
  );

  const currencies: Array<{ currency: string }> = await manager.query(
    `SELECT DISTINCT ${contractCurrencySql('c')} AS currency FROM contracts c
      WHERE c.tenant_id = $1${scoped ? ' AND c.id = ANY($2::uuid[])' : ''}`,
    scoped ? [tenantId, ids] : [tenantId],
  );
  const fx = await contractFxRates(deps.fxRates, manager, tenantId, uniqueYears);
  const rates = uniqueYears.flatMap((year) => currencies.map(({ currency }) => ({ year, currency, rate: fx.rateOf(year, currency) })));

  return {
    tenantId,
    years: uniqueYears,
    column,
    reportingCurrency: fx.reportingCurrency,
    contractIds: scoped ? ids : null,
    lineAmounts,
    startedYears: started.map((row) => Number(row.yr)),
    rates,
  };
}

/** The named parameters (`cb…`) of `contractBudgetSql`. */
export function contractBudgetParams(inputs: ContractBudgetInputs): Record<string, unknown> {
  const lineIds: string[] = [];
  const lineYears: number[] = [];
  const lineCents: string[] = [];
  for (const [lineId, byYear] of inputs.lineAmounts) {
    for (const [year, cents] of byYear) {
      lineIds.push(lineId);
      lineYears.push(year);
      lineCents.push(cents.toString());
    }
  }
  return {
    cbTenant: inputs.tenantId,
    cbYears: inputs.years,
    cbStartedYears: inputs.startedYears,
    cbLineIds: lineIds,
    cbLineYears: lineYears,
    cbLineCents: lineCents,
    cbFxYears: inputs.rates.map((entry) => entry.year),
    cbFxCurrencies: inputs.rates.map((entry) => entry.currency),
    cbFxRates: inputs.rates.map((entry) => entry.rate),
    ...(inputs.contractIds ? { cbContractIds: inputs.contractIds } : {}),
  };
}

/**
 * One row per contract (of the inputs) and year: `contract_id`, `yr`, `committed_local` (cents of
 * the contract's currency), `committed` (cents of the reporting currency, a float8 holding an
 * integer; null without a rate, 0 when nothing is committed), `linked` (cents), `has_amount`,
 * `started`, `gap` (cents, null without a rate) and `state`. With TypeORM's named parameters of
 * `contractBudgetParams`; usable as a CTE or a subquery.
 *
 * The conversion is the list footer's (`convertValue`): `Math.round(amount × rate × 100)` cents.
 */
export function contractBudgetSql(inputs: Pick<ContractBudgetInputs, 'contractIds'>): string {
  const committed = `CASE WHEN cm.local = 0 THEN 0::float8
                WHEN fxr.rate IS NULL THEN NULL
                ELSE ${jsRound(`${centsNumber('cm.local')} * fxr.rate * 100`)} END`;
  return `SELECT b.*,
         (b.linked - b.committed::numeric) AS gap,
         CASE WHEN b.committed IS NULL THEN NULL
              WHEN b.committed = 0 AND NOT b.has_amount THEN 'no_commitment'
              WHEN NOT b.started THEN 'not_started'
              WHEN NOT b.has_amount THEN 'no_line'
              WHEN b.linked < b.committed::numeric THEN 'under'
              WHEN (b.linked - b.committed::numeric) * 100 > b.committed::numeric * ${CONTRACT_BUDGET_OVER_PERCENT} THEN 'over'
              ELSE 'covered' END AS state
    FROM (
      SELECT c.id AS contract_id, y.yr,
             cm.local AS committed_local,
             ${committed} AS committed,
             COALESCE(lk.linked, 0)::numeric AS linked,
             COALESCE(lk.has_amount, false) AS has_amount,
             (y.yr = ANY(:cbStartedYears::int[])) AS started
        FROM contracts c
        CROSS JOIN unnest(:cbYears::int[]) AS y(yr)
        CROSS JOIN LATERAL (SELECT ${contractCommitmentSql('c', 'y.yr')} AS local) cm
        LEFT JOIN unnest(:cbFxYears::int[], :cbFxCurrencies::text[], :cbFxRates::float8[]) AS fxr(yr, cur, rate)
          ON fxr.yr = y.yr AND fxr.cur = ${contractCurrencySql('c')}
        LEFT JOIN (
          SELECT l.contract_id, la.yr, sum(la.cents) AS linked, bool_or(la.cents <> 0) AS has_amount
            FROM contract_spend_items l
            JOIN unnest(:cbLineIds::uuid[], :cbLineYears::int[], :cbLineCents::numeric[]) AS la(id, yr, cents) ON la.id = l.spend_item_id
           WHERE l.tenant_id = :cbTenant
           GROUP BY l.contract_id, la.yr
        ) lk ON lk.contract_id = c.id AND lk.yr = y.yr
       WHERE c.tenant_id = :cbTenant${inputs.contractIds ? ' AND c.id = ANY(:cbContractIds::uuid[])' : ''}
    ) b`;
}

export type ContractBudgetRow = {
  contract_id: string;
  year: number;
  /** In the contract's currency. */
  committed_local: number;
  /** In the reporting currency; null when the contract's currency has no rate that year. */
  committed: number | null;
  linked: number;
  gap: number | null;
  state: ContractBudgetState | null;
};

/** A raw row of `contractBudgetSql` in units (amounts with 2 decimals). */
export function presentContractBudgetRow(row: Record<string, any>): ContractBudgetRow {
  const units = (cents: unknown) => (cents == null ? null : Math.round(Number(cents)) / 100);
  return {
    contract_id: row.contract_id,
    year: Number(row.yr),
    committed_local: units(row.committed_local) ?? 0,
    committed: units(row.committed),
    linked: units(row.linked) ?? 0,
    gap: units(row.gap),
    state: (row.state ?? null) as ContractBudgetState | null,
  };
}

/** The rows of `contractBudgetSql` for `inputs` (every contract and year they were read for). */
export async function readContractBudgetRows(manager: EntityManager, inputs: ContractBudgetInputs): Promise<ContractBudgetRow[]> {
  const rows = await manager
    .createQueryBuilder()
    .select('cb.*')
    .from(`(${contractBudgetSql(inputs)})`, 'cb')
    .setParameters(contractBudgetParams(inputs))
    .orderBy('cb.contract_id')
    .addOrderBy('cb.yr')
    .getRawMany();
  return rows.map(presentContractBudgetRow);
}
