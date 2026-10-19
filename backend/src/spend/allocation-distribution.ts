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

export type TurnoverConversion = {
  reportingCurrency: string;
  /** Company id → its turnover in the reporting currency (null when it has none). */
  values: Map<string, number | null>;
  /**
   * The currencies without a rate for the year: their turnover is counted unconverted (rate 1),
   * as the version amounts are, and `resolveRates` has the missing year fetched.
   */
  missingCurrencies: string[];
};

/**
 * Turnovers entered in each company's base currency, converted into the tenant's reporting
 * currency at the rate of the year, with the rule of the version amounts: the version's
 * frozen rate set (`rateSetId`), else the latest live set of the year. A company in the
 * reporting currency, or without a base currency, is not converted. No rate is read when
 * no entry carries a turnover.
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

  const missing = new Set<string>();
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
      missing.add(entry.currency);
      values.set(entry.companyId, entry.turnover);
      continue;
    }
    // Not `convertValue`: it rounds to cents, and a turnover is entered in millions.
    values.set(entry.companyId, entry.turnover * rate.rate);
  }
  return { reportingCurrency, values, missingCurrencies: Array.from(missing).sort() };
}

/**
 * A split computed with a reservation: the turnovers in `currencies` had no rate into
 * `reportingCurrency` for `year` and were counted unconverted. Data, not a sentence: each
 * screen words it in the user's language (`ops:shared.allocationWarnings`).
 */
export type TurnoverFxMissingWarning = {
  code: 'turnover_fx_missing';
  currencies: string[];
  year: number;
  reportingCurrency: string;
};

/** The warning of a split whose turnovers lack a rate (counted unconverted), or null. */
export function turnoverFxMissingWarning(missingCurrencies: string[], fiscalYear: number, reportingCurrency: string): TurnoverFxMissingWarning | null {
  if (missingCurrencies.length === 0) return null;
  return { code: 'turnover_fx_missing', currencies: [...missingCurrencies], year: fiscalYear, reportingCurrency };
}

/** The warning in English, for the API's text fields that are not shown as such (the AI's summary rows). */
export function describeAllocationWarning(warning: TurnoverFxMissingWarning): string {
  return `No ${warning.reportingCurrency} exchange rate for ${warning.currencies.join(', ')} in ${warning.year}: `
    + 'the turnover of the companies in that currency is counted unconverted until the rate is available.';
}

export type CompanySharesResult = {
  shares: Map<string, number>;
  /** Set for the turnover driver only (see `convertTurnovers`). */
  fxMissing: string[];
  reportingCurrency: string | null;
};

/**
 * Company split for a manual company selection, shared by the OPEX/CAPEX calculators
 * (read path) and the allocation services (save path).
 *
 * Companies must belong to the tenant and be enabled for the fiscal year: a company is
 * considered enabled when `disabled_at` is NULL or falls on/after January 1st of that
 * year. Percentages come from each company's driver value for the same year; turnovers
 * are converted into the reporting currency first (`convertTurnovers`, with `rateSetId`,
 * the version's frozen rate set, or null for the live rates of the year).
 */
export async function computeCompanySharesWithFx(args: {
  manager: EntityManager;
  tenantId: string;
  fiscalYear: number;
  companyIds: string[];
  driver: AllocationDriver;
  fxRates: TurnoverFxRates | undefined;
  rateSetId?: string | null;
}): Promise<CompanySharesResult> {
  const { manager, tenantId, fiscalYear, companyIds, driver } = args;

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

  let fxMissing: string[] = [];
  let reportingCurrency: string | null = null;
  const driverValueByCompany = new Map<string, number | string | null>();
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
        turnover: metrics.find((m) => m.company_id === companyId)?.turnover ?? null,
      })),
    });
    fxMissing = converted.missingCurrencies;
    reportingCurrency = converted.reportingCurrency;
    for (const companyId of companyIds) driverValueByCompany.set(companyId, converted.values.get(companyId) ?? null);
  } else {
    for (const companyId of companyIds) {
      const metric = metrics.find((m) => m.company_id === companyId);
      if (driver === 'headcount') driverValueByCompany.set(companyId, metric?.headcount ?? null);
      else if (driver === 'it_users') driverValueByCompany.set(companyId, metric?.it_users ?? null);
      else driverValueByCompany.set(companyId, metric?.turnover ?? null);
    }
  }

  const distribution = normalizeWeights(buildCompanyWeights(companyIds, driverValueByCompany, driver));
  const shares = new Map<string, number>();
  distribution.forEach(({ id, pct }) => shares.set(id, pct));
  return { shares, fxMissing, reportingCurrency };
}

/** `computeCompanySharesWithFx`, the shares only. */
export async function computeCompanyShares(args: Parameters<typeof computeCompanySharesWithFx>[0]): Promise<Map<string, number>> {
  return (await computeCompanySharesWithFx(args)).shares;
}
