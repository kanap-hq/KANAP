import { BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { EntityManager, In, Raw } from 'typeorm';
import { Company } from '../companies/company.entity';
import { CompanyMetric } from '../companies/company-metric.entity';
import type { FxLookupKey, FxRateService } from '../currency/fx-rate.service';

export type AllocationDriver = 'headcount' | 'it_users' | 'turnover';

export type WeightedEntry = { id: string; weight: number };

/**
 * January 1st of a fiscal year. A company counts as enabled for a year when `disabled_at`
 * is NULL or falls on/after that date.
 */
export function fiscalYearStart(fiscalYear: number): Date {
  return new Date(`${String(fiscalYear).padStart(4, '0')}-01-01T00:00:00.000Z`);
}

/**
 * Normalizes weights into percentages summing to exactly 100.
 *
 * Every entry is rounded to four decimals and the last one absorbs the rounding
 * remainder, so the exported percentages always add up to 100.
 */
export function normalizeWeights(weights: WeightedEntry[]): Array<{ id: string; pct: number }> {
  const total = weights.reduce((acc, entry) => acc + entry.weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    throw new BadRequestException('Allocation source values must sum to a positive amount.');
  }

  let running = 0;
  return weights.map((entry, idx) => {
    let pct = Number(((entry.weight * 100) / total).toFixed(4));
    if (idx === weights.length - 1) {
      const diff = Number((100 - (running + pct)).toFixed(4));
      pct = Number((pct + diff).toFixed(4));
    }
    running += pct;
    return { id: entry.id, pct };
  });
}

/**
 * Builds the weighting of a manual company selection from the driver value of each
 * selected company.
 *
 * Every selected company must carry a strictly positive value for the year; the check
 * stays here so both the save path and the read path reject the same selections.
 */
export function buildCompanyWeights(
  companyIds: string[],
  driverValueByCompany: ReadonlyMap<string, number | string | null | undefined>,
  driver: AllocationDriver,
): WeightedEntry[] {
  // A single selected company takes everything, so it needs no driver value.
  if (companyIds.length === 1) {
    return [{ id: companyIds[0], weight: 1 }];
  }

  const weights: WeightedEntry[] = companyIds.map((companyId) => {
    const raw = driverValueByCompany.get(companyId);
    const weight = raw == null ? 0 : Number(raw);
    return { id: companyId, weight: Number.isFinite(weight) ? weight : 0 };
  });

  if (weights.some((entry) => !Number.isFinite(entry.weight) || entry.weight <= 0)) {
    throw new BadRequestException(`Provide ${driver.replace('_', ' ')} values for the selected companies.`);
  }

  return weights;
}

/** What converting turnovers needs from `FxRateService`. */
export type TurnoverFxRates = Pick<FxRateService, 'resolveRates'>;

/**
 * `fxRates` reading the rates once per (rate set, year), for all of `currencies` at once: one
 * calculator call converts the turnovers of many selections and versions of the same years.
 * For one tenant and one manager (a calculator call). A lookup naming a currency outside
 * `currencies`, or several (rate set, year), goes to `fxRates` as it is.
 */
export function memoizeTurnoverRates(fxRates: TurnoverFxRates | undefined, currencies: Iterable<string | null | undefined>): TurnoverFxRates | undefined {
  if (!fxRates) return undefined;
  const universe = Array.from(new Set(
    Array.from(currencies, (code) => String(code ?? '').trim().toUpperCase()).filter((code) => code.length > 0),
  )).sort();
  const known = new Set(universe);
  const cache = new Map<string, ReturnType<TurnoverFxRates['resolveRates']>>();
  return {
    resolveRates: (tenantId, lookups, opts) => {
      const groups = new Set(lookups.map((l) => `${l.rateSetId || 'live'}:${l.fiscalYear}`));
      if (groups.size > 1 || lookups.some((l) => !known.has(l.sourceCurrency.toUpperCase()))) {
        return fxRates.resolveRates(tenantId, lookups, opts);
      }
      // No lookup: the settings only (the reporting currency), read once too.
      const key = lookups.length === 0 ? 'settings' : `${lookups[0].rateSetId || 'live'}:${lookups[0].fiscalYear}`;
      let pending = cache.get(key);
      if (!pending) {
        const all = lookups.length === 0
          ? []
          : universe.map((sourceCurrency) => ({ key: '', rateSetId: lookups[0].rateSetId, fiscalYear: lookups[0].fiscalYear, sourceCurrency }));
        pending = fxRates.resolveRates(tenantId, all, opts);
        cache.set(key, pending);
      }
      return pending;
    },
  };
}

/** A company whose turnover has no rate for the year: left out of `values`. */
export type TurnoverMissing = { companyId: string; currency: string };

export type TurnoverConversion = {
  reportingCurrency: string;
  /**
   * Company id → its turnover in the reporting currency (null when it has none).
   * A company whose currency has no rate for the year is absent.
   */
  values: Map<string, number | null>;
  /**
   * Companies left out because their currency has no rate for the year.
   * `resolveRates` has still been called, so the missing year is fetched.
   */
  missing: TurnoverMissing[];
};

/**
 * Turnovers entered in each company's base currency, converted into the tenant's reporting
 * currency at the rate of the year, with the rule of the version amounts: the version's
 * frozen rate set (`rateSetId`), else the latest live set of the year. A company in the
 * reporting currency, or without a base currency, is not converted. A company whose
 * currency has no rate is left out of `values`. No rate is read when no entry carries
 * a turnover.
 */
export async function convertTurnovers(args: {
  fxRates: TurnoverFxRates | undefined;
  manager: EntityManager;
  tenantId: string;
  fiscalYear: number;
  rateSetId: string | null;
  entries: Array<{ companyId: string; currency: string | null | undefined; turnover: number | string | null | undefined }>;
}): Promise<TurnoverConversion> {
  const { fxRates, manager, tenantId, fiscalYear, rateSetId, entries } = args;
  if (!fxRates) throw new InternalServerErrorException('Converting turnovers needs the exchange rates.');
  const normalized = entries.map((entry) => {
    const n = entry.turnover == null || entry.turnover === '' ? null : Number(entry.turnover);
    const currency = String(entry.currency ?? '').trim().toUpperCase() || null;
    return { companyId: entry.companyId, currency, turnover: n != null && Number.isFinite(n) ? n : null };
  });
  const currencies = Array.from(new Set(
    normalized.filter((e) => e.turnover != null && e.currency).map((e) => e.currency as string),
  ));
  const lookups: FxLookupKey[] = currencies.map((sourceCurrency) => ({ key: '', rateSetId, fiscalYear, sourceCurrency }));
  const fx = await fxRates.resolveRates(tenantId, lookups, { manager });
  const reportingCurrency = String(fx.settings.reportingCurrency || 'EUR').toUpperCase();

  const missing: TurnoverMissing[] = [];
  const values = new Map<string, number | null>();
  for (const entry of normalized) {
    if (entry.turnover == null) {
      values.set(entry.companyId, null);
      continue;
    }
    if (!entry.currency || entry.currency === reportingCurrency) {
      values.set(entry.companyId, entry.turnover);
      continue;
    }
    const rate = fx.map.get(`${rateSetId || 'live'}:${fiscalYear}:${entry.currency}`);
    if (!rate || rate.source === 'missing' || !Number.isFinite(rate.rate) || rate.rate <= 0) {
      missing.push({ companyId: entry.companyId, currency: entry.currency });
      continue;
    }
    // Not `convertValue`: it rounds to cents, and a turnover is entered in millions.
    values.set(entry.companyId, entry.turnover * rate.rate);
  }
  missing.sort((a, b) => a.currency.localeCompare(b.currency) || a.companyId.localeCompare(b.companyId));
  return { reportingCurrency, values, missing };
}

/** One company left out of a turnover split or total. */
export type TurnoverFxMissingItem = {
  companyId: string;
  companyName: string;
  currency: string;
  year: number;
};

/**
 * A split or a total that left turnovers out: each company in `items` had no rate into
 * `reportingCurrency` for `items[].year`. Data, not a sentence: each screen words it in
 * the user's language (`ops:shared.allocationWarnings`).
 */
export type TurnoverFxMissingWarning = {
  code: 'turnover_fx_missing';
  items: TurnoverFxMissingItem[];
  reportingCurrency: string;
};

/** Names for `turnoverFxMissingWarning`, from the companies the conversion just read. */
export function turnoverMissingItems(
  missing: TurnoverMissing[],
  year: number,
  companies: ReadonlyArray<{ id: string; name?: string | null }>,
): TurnoverFxMissingItem[] {
  return missing.map((item) => ({
    companyId: item.companyId,
    companyName: companies.find((company) => company.id === item.companyId)?.name ?? '',
    currency: item.currency,
    year,
  }));
}

/**
 * The rate set a budget year is frozen at: the set the freeze pinned on the year's versions
 * (`FreezeService.attachFxRates`; the one most of them carry, should they differ), or null when
 * the year is not frozen. Turnovers split for no version in particular (the default method's
 * preview, the companies' totals) convert at it, as the year's versions and their allocations do.
 */
export async function yearRateSetId(manager: EntityManager, tenantId: string, fiscalYear: number): Promise<string | null> {
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT fx_rate_set_id AS id
     FROM spend_versions
     WHERE tenant_id = $1 AND budget_year = $2 AND fx_rate_set_id IS NOT NULL
     GROUP BY fx_rate_set_id
     ORDER BY COUNT(*) DESC, fx_rate_set_id
     LIMIT 1`,
    [tenantId, fiscalYear],
  );
  return rows[0]?.id ?? null;
}

/** The warning of turnovers left out for lack of a rate, or null. */
export function turnoverFxMissingWarning(
  items: TurnoverFxMissingItem[],
  reportingCurrency: string,
): TurnoverFxMissingWarning | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.year - b.year
    || a.currency.localeCompare(b.currency)
    || a.companyName.localeCompare(b.companyName)
    || a.companyId.localeCompare(b.companyId));
  return {
    code: 'turnover_fx_missing',
    items: sorted.map((item) => ({ ...item })),
    reportingCurrency,
  };
}

/**
 * A split that cannot be weighted. `warning` is the turnovers left out for lack of a
 * rate, so a caller that turns the error into an empty split still names them.
 */
export class AllocationSplitError extends BadRequestException {
  readonly warning: TurnoverFxMissingWarning;

  /** `code`, when given, goes into the 400 body beside the message. */
  constructor(message: string, warning: TurnoverFxMissingWarning, code?: string) {
    super(code ? { statusCode: 400, error: 'Bad Request', code, message } : message);
    this.warning = warning;
  }
}

/** Every company of a turnover split lacks a rate into the reporting currency. */
export const TURNOVER_FX_MISSING_ALL_CODE = 'turnover_fx_missing_all';

/** The 400 message of `TURNOVER_FX_MISSING_ALL_CODE`: the currencies and the year without a rate. */
export function turnoverFxMissingAllMessage(warning: TurnoverFxMissingWarning): string {
  const currencies = Array.from(new Set(warning.items.map((item) => item.currency))).sort();
  const years = Array.from(new Set(warning.items.map((item) => item.year))).sort((a, b) => a - b);
  return `No exchange rate from ${currencies.join(', ')} to ${warning.reportingCurrency} for ${years.join(', ')}: `
    + 'the turnover of the selected companies cannot be compared. Enter the rate, or choose another allocation driver.';
}

/**
 * A report computed without some amounts: the budget lines in `items[].currency` had no rate into
 * `reportingCurrency` for `items[].year`, so their amounts are left out of every sum in the
 * reporting currency (`lines`: the number of distinct budget lines left out). One warning per
 * report, listing every pair. Data, not a sentence, as `TurnoverFxMissingWarning`.
 */
export type AmountFxMissingWarning = {
  code: 'amount_fx_missing';
  items: Array<{ currency: string; year: number; lines: number }>;
  reportingCurrency: string;
};

/** The structured warnings of an allocation or a chargeback, each screen words them. */
export type AllocationWarning = TurnoverFxMissingWarning | AmountFxMissingWarning;

/** The warning of a report that left out amounts without a rate, or null when none was left out. */
export function amountFxMissingWarning(
  items: Array<{ currency: string; year: number; lines: number }>,
  reportingCurrency: string,
): AmountFxMissingWarning | null {
  if (items.length === 0) return null;
  const sorted = [...items].sort((a, b) => a.currency.localeCompare(b.currency) || a.year - b.year);
  return { code: 'amount_fx_missing', items: sorted.map((item) => ({ ...item })), reportingCurrency };
}

/** The warning in English, for the API's text fields that are not shown as such (the AI's summary rows). */
export function describeAllocationWarning(warning: AllocationWarning): string {
  if (warning.code === 'amount_fx_missing') {
    const pairs = warning.items
      .map((item) => `${item.currency} in ${item.year} (${item.lines} ${item.lines === 1 ? 'line' : 'lines'})`)
      .join(', ');
    return `No ${warning.reportingCurrency} exchange rate for ${pairs}: `
      + 'the amounts of those lines are left out of the totals until the rate is available.';
  }
  const seen = new Set<string>();
  const pairs: string[] = [];
  for (const item of warning.items) {
    const label = `${item.currency} in ${item.year}`;
    if (seen.has(label)) continue;
    seen.add(label);
    pairs.push(label);
  }
  return `No ${warning.reportingCurrency} exchange rate for ${pairs.join(', ')}: `
    + 'the turnover of those companies is left out of the totals until the rate is available.';
}

export type CompanySharesResult = {
  shares: Map<string, number>;
  /** Companies left out of a turnover split (see `convertTurnovers`). Empty for the other drivers. */
  fxMissing: TurnoverFxMissingItem[];
  reportingCurrency: string | null;
};

type CompanySelectionArgs = {
  manager: EntityManager;
  tenantId: string;
  fiscalYear: number;
  companyIds: string[];
  driver: AllocationDriver;
};

/**
 * The companies of a manual selection and their metrics of the year. Companies must belong to
 * the tenant and be enabled for the fiscal year: a company is considered enabled when
 * `disabled_at` is NULL or falls on/after January 1st of that year.
 */
async function readCompanySelection(args: CompanySelectionArgs): Promise<{ companies: Company[]; metrics: CompanyMetric[] }> {
  const { manager, tenantId, fiscalYear, companyIds } = args;
  const periodStart = fiscalYearStart(fiscalYear);
  const companies = await manager.getRepository(Company).find({
    where: {
      tenant_id: tenantId,
      id: In(companyIds) as any,
      disabled_at: Raw((alias) => `${alias} IS NULL OR ${alias} >= :period_start`, { period_start: periodStart }),
    } as any,
  });
  if (companies.length !== companyIds.length) {
    throw new BadRequestException('Some companies are not available for manual allocation.');
  }

  const metrics = await manager.getRepository(CompanyMetric).find({
    where: {
      tenant_id: tenantId,
      fiscal_year: fiscalYear,
      company_id: In(companyIds) as any,
    } as any,
  });
  return { companies, metrics };
}

/** Each selected company's driver value as entered (a turnover in its base currency). */
function enteredDriverValues(companyIds: string[], metrics: CompanyMetric[], driver: AllocationDriver): Map<string, number | string | null> {
  const values = new Map<string, number | string | null>();
  for (const companyId of companyIds) {
    const metric = metrics.find((m) => m.company_id === companyId);
    if (driver === 'headcount') values.set(companyId, metric?.headcount ?? null);
    else if (driver === 'it_users') values.set(companyId, metric?.it_users ?? null);
    else values.set(companyId, metric?.turnover ?? null);
  }
  return values;
}

/**
 * Checks that a manual selection can be split on the values entered, without reading any rate.
 * A turnover without a rate is left out when the split is computed (`computeCompanySharesWithFx`).
 */
export async function assertCompanySelection(args: CompanySelectionArgs): Promise<void> {
  const { metrics } = await readCompanySelection(args);
  normalizeWeights(buildCompanyWeights(args.companyIds, enteredDriverValues(args.companyIds, metrics, args.driver), args.driver));
}

/**
 * Company split for a manual company selection, shared by the OPEX/CAPEX calculators
 * (read path) and the allocation services (save path).
 *
 * The companies must be available for the year (`readCompanySelection`). Percentages come
 * from each company's driver value for the same year; turnovers are converted into the
 * reporting currency first (`convertTurnovers`, with `rateSetId`, the version's frozen rate
 * set, or null for the live rates of the year).
 */
export async function computeCompanySharesWithFx(args: CompanySelectionArgs & {
  fxRates: TurnoverFxRates | undefined;
  rateSetId?: string | null;
}): Promise<CompanySharesResult> {
  const { manager, tenantId, fiscalYear, companyIds, driver } = args;
  const { companies, metrics } = await readCompanySelection(args);

  let fxMissing: TurnoverFxMissingItem[] = [];
  let reportingCurrency: string | null = null;
  let driverValueByCompany = enteredDriverValues(companyIds, metrics, driver);
  // A company whose turnover has no rate is left out. A company with no turnover entered stays,
  // so the existing "provide a value" check still applies to it.
  let weightedIds = companyIds;
  if (driver === 'turnover' && companyIds.length > 1) {
    const converted = await convertTurnovers({
      fxRates: args.fxRates,
      manager,
      tenantId,
      fiscalYear,
      rateSetId: args.rateSetId ?? null,
      entries: companyIds.map((companyId) => ({
        companyId,
        currency: companies.find((c) => c.id === companyId)?.base_currency,
        turnover: driverValueByCompany.get(companyId),
      })),
    });
    fxMissing = turnoverMissingItems(converted.missing, fiscalYear, companies);
    reportingCurrency = converted.reportingCurrency;
    const missingIds = new Set(converted.missing.map((item) => item.companyId));
    weightedIds = companyIds.filter((companyId) => !missingIds.has(companyId));
    driverValueByCompany = new Map(weightedIds.map((companyId) => [companyId, converted.values.get(companyId) ?? null]));
  }

  const warning = reportingCurrency ? turnoverFxMissingWarning(fxMissing, reportingCurrency) : null;
  if (weightedIds.length === 0) {
    if (warning) throw new AllocationSplitError(turnoverFxMissingAllMessage(warning), warning, TURNOVER_FX_MISSING_ALL_CODE);
    throw new BadRequestException('Allocation source values must sum to a positive amount.');
  }
  let distribution: Array<{ id: string; pct: number }>;
  try {
    distribution = normalizeWeights(buildCompanyWeights(weightedIds, driverValueByCompany, driver));
  } catch (err) {
    if (warning && err instanceof BadRequestException) throw new AllocationSplitError(err.message, warning);
    throw err;
  }
  const shares = new Map<string, number>();
  distribution.forEach(({ id, pct }) => shares.set(id, pct));
  return { shares, fxMissing, reportingCurrency };
}

/** `computeCompanySharesWithFx`, the shares only. */
export async function computeCompanyShares(args: Parameters<typeof computeCompanySharesWithFx>[0]): Promise<Map<string, number>> {
  return (await computeCompanySharesWithFx(args)).shares;
}
