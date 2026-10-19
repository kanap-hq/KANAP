import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { contractBudgetYears } from '../contracts/contract-budget-years';
import { CurrencyRateSet } from './currency-rate-set.entity';
import { CurrencySettingsService } from './currency-settings.service';
import { FxIngestionService } from './fx-ingestion.service';
import { FxRateService } from './fx-rate.service';
import { ISO_CURRENCIES } from './iso-currencies';
import { lockRateSetWrite } from './rate-set-lock';

export type ManualRateInput = { currency: string; year: number; rate: number };
export type ManualRateTarget = { currency: string; year: number };
export type ManualRateRemoval = { ok: true; refreshQueued: boolean };
export type MissingRatePair = { currency: string; year: number };

/** One year of the rate matrix: the latest set whose base is the reporting currency. */
export type CurrencyRateYear = {
  fiscalYear: number;
  baseCurrency: string;
  rates: Record<string, number | null>;
  rateSources: Record<string, string>;
  capturedAt: Date | string | null;
  source: string | null;
};

/**
 * `GET /currency/rates`. `currencies` is the row list (reporting currency first);
 * `rates` is one object per year, and each object's maps hold only those rows.
 */
export type CurrencyRateMatrix = {
  currencies: string[];
  rates: CurrencyRateYear[];
};

/**
 * Currencies the tenant uses. `currencies` is the matrix universe (reporting,
 * defaults, allowed, budget lines, company turnovers, contracts). `pairs` is
 * the year-specific part of that universe, the input of the missing-rate list.
 */
export type CurrenciesInUse = {
  reporting: string;
  currencies: Set<string>;
  pairs: MissingRatePair[];
};

const YEAR_MIN = 1990;
const YEAR_MAX = 2100;
const RATE_MAX = 1e9;

export const MANUAL_RATE_CURRENCY_MESSAGE = 'Currency must be a 3-letter ISO code.';
export const MANUAL_RATE_REPORTING_MESSAGE = 'A manual rate cannot be set for the reporting currency.';
export const MANUAL_RATE_YEAR_MESSAGE = 'Year must be an integer between 1990 and 2100.';
export const MANUAL_RATE_RATE_MESSAGE = 'Rate must be a finite number greater than 0 and at most 1000000000.';
export const MANUAL_RATE_TOO_SMALL_MESSAGE = 'Rate rounds to 0 at 6 decimal places and cannot be stored.';

export const MANUAL_RATE_CURRENCY_CODE = 'currency_invalid';
export const MANUAL_RATE_REPORTING_CODE = 'currency_reporting';
export const MANUAL_RATE_YEAR_CODE = 'year_out_of_range';
export const MANUAL_RATE_RATE_CODE = 'rate_out_of_range';
export const MANUAL_RATE_TOO_SMALL_CODE = 'rate_too_small';
export const MANUAL_RATE_NOT_FOUND_CODE = 'manual_rate_not_found';

/** A 400 or 404 whose `code` the client maps. The English `message` stays for API clients. */
function codedError(status: 400 | 404, code: string, message: string): never {
  const body = { code, message };
  if (status === 404) throw new NotFoundException(body);
  throw new BadRequestException(body);
}

/** A usable cross rate: finite and strictly positive. Same rule as the ingestion. */
function isUsableRate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function roundRate(rate: number): number {
  return Number(rate.toFixed(6));
}

function fieldFor(record: Record<string, unknown> | null | undefined, currency: string): { key: string; value: unknown } | null {
  if (!record) return null;
  for (const [key, value] of Object.entries(record)) {
    if (key.toUpperCase() === currency) return { key, value };
  }
  return null;
}

function usableStoredRate(set: CurrencyRateSet | null, currency: string): number | null {
  const found = fieldFor(set?.rates as Record<string, unknown> | null | undefined, currency);
  return isUsableRate(found?.value) ? found.value : null;
}

/**
 * Source recorded for a usable value. A set captured before `rate_sources`
 * existed lends its set-level source, as the ingestion does.
 */
function storedSource(set: CurrencyRateSet | null, currency: string, rate: number | null): string | null {
  if (!set || rate == null) return null;
  const recorded = fieldFor(set.rate_sources as Record<string, unknown> | null | undefined, currency);
  if (typeof recorded?.value === 'string' && recorded.value.length > 0) return recorded.value;
  return set.source ?? null;
}

function manualStoredRate(set: CurrencyRateSet | null, currency: string): number | null {
  const recorded = fieldFor(set?.rate_sources as Record<string, unknown> | null | undefined, currency);
  if (recorded?.value !== 'manual') return null;
  return usableStoredRate(set, currency);
}

function withoutCurrency<T>(record: Record<string, T> | null | undefined, currency: string): Record<string, T> {
  const next: Record<string, T> = {};
  for (const [key, value] of Object.entries(record ?? {})) {
    if (key.toUpperCase() === currency) continue;
    next[key] = value;
  }
  return next;
}

function readPairs(rows: Array<{ currency?: unknown; year?: unknown }> | null | undefined): MissingRatePair[] {
  const pairs: MissingRatePair[] = [];
  for (const row of rows ?? []) {
    const currency = typeof row.currency === 'string' ? row.currency.trim().toUpperCase() : '';
    const year = typeof row.year === 'number' ? row.year : Number(row.year);
    if (!/^[A-Z]{3}$/.test(currency) || !Number.isInteger(year)) continue;
    pairs.push({ currency, year });
  }
  return pairs;
}

function yearHasUsableRate(rates: Record<string, unknown> | undefined, currency: string): boolean {
  if (!rates) return false;
  for (const [key, value] of Object.entries(rates)) {
    if (key.toUpperCase() !== currency) continue;
    if (isUsableRate(value)) return true;
  }
  return false;
}

function parseCurrency(input: unknown): string {
  if (typeof input !== 'string') codedError(400, MANUAL_RATE_CURRENCY_CODE, MANUAL_RATE_CURRENCY_MESSAGE);
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) codedError(400, MANUAL_RATE_CURRENCY_CODE, MANUAL_RATE_CURRENCY_MESSAGE);
  // Same list the currency settings use. Checked before any lock or tenant write.
  if (!Object.prototype.hasOwnProperty.call(ISO_CURRENCIES, code)) {
    codedError(400, MANUAL_RATE_CURRENCY_CODE, MANUAL_RATE_CURRENCY_MESSAGE);
  }
  return code;
}

function parseYear(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < YEAR_MIN || input > YEAR_MAX) {
    codedError(400, MANUAL_RATE_YEAR_CODE, MANUAL_RATE_YEAR_MESSAGE);
  }
  return input;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Reporting currency first, then the other codes in alphabetical order. */
export function sortMatrixCurrencies(reporting: string, codes: Iterable<string>): string[] {
  const rest = new Set<string>();
  for (const code of codes) {
    const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
    if (normalized !== reporting && /^[A-Z]{3}$/.test(normalized)) rest.add(normalized);
  }
  return [reporting, ...Array.from(rest).sort()];
}

/**
 * Keeps currencies in use, plus any currency whose source on this set is `manual`.
 * Keys come out uppercased. A manual source with no stored rate stays in `rateSources`.
 */
function filterRateMaps(
  rates: Record<string, unknown>,
  sources: Record<string, unknown>,
  inUse: Set<string>,
): { rates: Record<string, number | null>; rateSources: Record<string, string> } {
  const sourceByCode = new Map<string, string>();
  for (const [key, value] of Object.entries(sources)) {
    if (typeof value === 'string' && value.length > 0) sourceByCode.set(key.toUpperCase(), value);
  }
  const outRates: Record<string, number | null> = {};
  const outSources: Record<string, string> = {};
  const seen = new Set<string>();
  for (const [key, value] of Object.entries(rates)) {
    const code = key.toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    const source = sourceByCode.get(code);
    if (!inUse.has(code) && source !== 'manual') continue;
    if (typeof value === 'number' && Number.isFinite(value)) outRates[code] = value;
    else if (value === null) outRates[code] = null;
    if (source) outSources[code] = source;
  }
  for (const [code, source] of sourceByCode) {
    if (source !== 'manual' || seen.has(code)) continue;
    outSources[code] = source;
  }
  return { rates: outRates, rateSources: outSources };
}

function parseRate(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0 || input > RATE_MAX) {
    codedError(400, MANUAL_RATE_RATE_CODE, MANUAL_RATE_RATE_MESSAGE);
  }
  const rounded = roundRate(input);
  if (rounded > RATE_MAX) codedError(400, MANUAL_RATE_RATE_CODE, MANUAL_RATE_RATE_MESSAGE);
  // Finite and strictly positive, but gone once stored at 6 decimals (seen: 0.0000001).
  if (!(rounded > 0)) codedError(400, MANUAL_RATE_TOO_SMALL_CODE, MANUAL_RATE_TOO_SMALL_MESSAGE);
  return rounded;
}

@Injectable()
export class ManualRatesService {
  constructor(
    private readonly settings: CurrencySettingsService,
    private readonly fxRates: FxRateService,
    private readonly fxIngestion: FxIngestionService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Inserts a new rate set for the year with this currency's value marked
   * `manual`. A stored manual value then wins over every later fetch until it
   * is removed. The rate is units of the reporting currency for 1 unit of the
   * currency, rounded to 6 decimals like a fetched cross rate.
   */
  async setManualRate(
    tenantId: string,
    input: ManualRateInput,
    userId: string | null,
    manager: EntityManager,
  ): Promise<CurrencyRateSet> {
    const currency = parseCurrency(input?.currency);
    const year = parseYear(input?.year);
    const rate = parseRate(input?.rate);
    await this.setTenant(manager, tenantId);
    const reporting = (await this.settings.getSettings(tenantId, { manager })).reportingCurrency.toUpperCase();
    if (currency === reporting) codedError(400, MANUAL_RATE_REPORTING_CODE, MANUAL_RATE_REPORTING_MESSAGE);
    await this.settings.ensureCurrencyRecords([reporting, currency], { manager });

    await lockRateSetWrite(manager, tenantId, year);
    const existing = await this.fxRates.getLatestRateSet(tenantId, year, reporting, { manager });
    const previousRate = usableStoredRate(existing, currency);
    const previousSource = storedSource(existing, currency, previousRate);
    const rates = existing
      ? withoutCurrency(existing.rates, currency)
      : { [reporting]: 1 };
    const rateSources = existing
      ? withoutCurrency(existing.rate_sources, currency)
      : { [reporting]: 'identity' };
    rates[currency] = rate;
    rateSources[currency] = 'manual';

    const saved = await this.insertSet(manager, {
      tenantId,
      year,
      baseCurrency: reporting,
      rates,
      rateSources,
      rateBasis: existing ? existing.rate_basis : 'manual',
      source: existing ? existing.source : 'manual',
    });
    await this.audit.log(
      {
        table: 'currency_rate_sets',
        recordId: saved.id,
        action: existing ? 'update' : 'create',
        before: { fiscal_year: year, currency, rate: previousRate, source: previousSource },
        after: { fiscal_year: year, currency, rate, source: 'manual' },
        userId,
      },
      { manager },
    );
    return saved;
  }

  /**
   * Inserts a new set in which the currency is null and has no source, then
   * queues a refresh of the year so the automatic rate can return. The refresh
   * waits on the same tenant-year lock, which this transaction holds until it
   * commits, and then reads the set without the manual value.
   */
  async removeManualRate(
    tenantId: string,
    input: ManualRateTarget,
    userId: string | null,
    manager: EntityManager,
  ): Promise<ManualRateRemoval> {
    const currency = parseCurrency(input?.currency);
    const year = parseYear(input?.year);
    await this.setTenant(manager, tenantId);
    const reporting = (await this.settings.getSettings(tenantId, { manager })).reportingCurrency.toUpperCase();

    await lockRateSetWrite(manager, tenantId, year);
    const existing = await this.fxRates.getLatestRateSet(tenantId, year, reporting, { manager });
    const manualRate = manualStoredRate(existing, currency);
    if (manualRate == null || !existing) {
      codedError(404, MANUAL_RATE_NOT_FOUND_CODE, `No manual rate is stored for ${currency} in ${year}.`);
    }
    const rates = withoutCurrency(existing.rates, currency);
    rates[currency] = null;
    const rateSources = withoutCurrency(existing.rate_sources, currency);

    const saved = await this.insertSet(manager, {
      tenantId,
      year,
      baseCurrency: reporting,
      rates,
      rateSources,
      rateBasis: existing.rate_basis,
      source: existing.source,
    });
    await this.audit.log(
      {
        table: 'currency_rate_sets',
        recordId: saved.id,
        action: 'delete',
        before: { fiscal_year: year, currency, rate: manualRate, source: 'manual' },
        after: null,
        userId,
      },
      { manager },
    );

    const status = await this.fxIngestion.queueManualRefresh(tenantId, [year], { label: 'manual-rate-removed' });
    if (status === 'skipped') this.fxRates.reportMissingYears(tenantId, [year]);
    return { ok: true, refreshQueued: status === 'queued' };
  }

  /**
   * Versions of this budget year that keep a pinned rate set. A manual rate
   * writes a new live set and does not reach them.
   */
  async countFrozenVersions(tenantId: string, year: number, manager: EntityManager): Promise<number> {
    const rows = await manager.query(
      `SELECT COUNT(*)::int AS n
         FROM spend_versions
        WHERE tenant_id = $1
          AND budget_year = $2
          AND fx_rate_set_id IS NOT NULL`,
      [tenantId, year],
    );
    const raw = Array.isArray(rows) ? (rows[0] as { n?: unknown } | undefined)?.n : undefined;
    const count = typeof raw === 'number' ? raw : Number(raw);
    return Number.isInteger(count) && count > 0 ? count : 0;
  }

  /**
   * Pairs in use that the latest set of the year, in the reporting currency,
   * does not rate with a finite value above 0. One query per source
   * (`currenciesInUse`). The years found are reported so the page that lists
   * them also tries the sources. `report: false` only reads: a forced sync
   * collects the years, then waits for its own refresh, and must not start
   * that refresh early.
   */
  async listMissingPairs(
    tenantId: string,
    manager: EntityManager,
    opts?: { report?: boolean },
  ): Promise<MissingRatePair[]> {
    const use = await this.currenciesInUse(tenantId, manager);
    const rateRows = await manager.query(
      `SELECT DISTINCT ON (fiscal_year) fiscal_year, rates
         FROM currency_rate_sets
        WHERE tenant_id = $1
          AND UPPER(TRIM(base_currency)) = $2
        ORDER BY fiscal_year, captured_at DESC`,
      [tenantId, use.reporting],
    );

    const ratesByYear = new Map<number, Record<string, unknown>>();
    for (const row of rateRows as Array<{ fiscal_year: unknown; rates: unknown }>) {
      const year = typeof row.fiscal_year === 'number' ? row.fiscal_year : Number(row.fiscal_year);
      if (!Number.isInteger(year)) continue;
      ratesByYear.set(year, asRecord(row.rates));
    }

    const items: MissingRatePair[] = [];
    for (const pair of use.pairs) {
      if (pair.currency === use.reporting) continue;
      if (yearHasUsableRate(ratesByYear.get(pair.year), pair.currency)) continue;
      items.push(pair);
    }
    items.sort((a, b) => a.year - b.year || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
    if (opts?.report !== false) this.fxRates.reportMissingYears(tenantId, items.map((item) => item.year));
    return items;
  }

  /**
   * The rate matrix: the latest set of each year whose base is the current
   * reporting currency. Each year's maps keep the currencies in use
   * (`currenciesInUse`) and any currency carrying a manual rate on that set.
   * `currencies` is the row list, reporting currency first.
   */
  async listRateMatrix(tenantId: string, manager: EntityManager): Promise<CurrencyRateMatrix> {
    const use = await this.currenciesInUse(tenantId, manager);
    const rows = await manager.query(
      `SELECT DISTINCT ON (fiscal_year)
              fiscal_year,
              TRIM(base_currency) AS base_currency,
              rates,
              rate_sources,
              captured_at,
              source
         FROM currency_rate_sets
        WHERE tenant_id = $1
          AND UPPER(TRIM(base_currency)) = $2
        ORDER BY fiscal_year ASC, captured_at DESC`,
      [tenantId, use.reporting],
    );

    const manual = new Set<string>();
    const rates: CurrencyRateYear[] = [];
    for (const row of rows as Array<Record<string, unknown>>) {
      const year = typeof row.fiscal_year === 'number' ? row.fiscal_year : Number(row.fiscal_year);
      if (!Number.isInteger(year)) continue;
      const sources = asRecord(row.rate_sources);
      for (const [key, value] of Object.entries(sources)) {
        if (value === 'manual') manual.add(key.toUpperCase());
      }
      const filtered = filterRateMaps(asRecord(row.rates), sources, use.currencies);
      const base = typeof row.base_currency === 'string' ? row.base_currency.trim() : '';
      rates.push({
        fiscalYear: year,
        baseCurrency: base,
        rates: filtered.rates,
        rateSources: filtered.rateSources,
        capturedAt: (row.captured_at as Date | string | null) ?? null,
        source: typeof row.source === 'string' ? row.source : null,
      });
    }
    return {
      currencies: sortMatrixCurrencies(use.reporting, [...use.currencies, ...manual]),
      rates,
    };
  }

  /**
   * Every year a change of reporting currency has to refresh for the new base:
   * budget version years (a frozen version is one of them), company metric years
   * with a turnover, the years contract amounts are read for, and the current
   * calendar year with the year before and the year after it.
   */
  async reportingChangeYears(tenantId: string, manager: EntityManager): Promise<number[]> {
    await this.setTenant(manager, tenantId);
    const currentYear = new Date().getFullYear();
    const rows: Array<{ year: unknown }> = await manager.query(
      `SELECT DISTINCT year FROM (
         SELECT v.budget_year AS year
           FROM spend_versions v
          WHERE v.tenant_id = $1
            AND v.budget_year IS NOT NULL
         UNION
         SELECT m.fiscal_year AS year
           FROM company_metrics m
          WHERE m.tenant_id = $1
            AND m.turnover IS NOT NULL
            AND m.fiscal_year IS NOT NULL
       ) years`,
      [tenantId],
    );
    const years = new Set<number>([currentYear - 1, currentYear, currentYear + 1]);
    for (const row of rows) {
      const year = typeof row.year === 'number' ? row.year : Number(row.year);
      if (Number.isInteger(year)) years.add(year);
    }
    for (const year of await contractBudgetYears(manager, tenantId, currentYear)) years.add(year);
    return Array.from(years).sort((a, b) => a - b);
  }

  /**
   * The currencies in use, shared by the missing-rate list and the rate matrix.
   * Standing currencies (reporting, the two defaults, the allowed list) belong
   * to every year. Budget lines, company turnovers and contracts name a year.
   */
  async currenciesInUse(tenantId: string, manager: EntityManager): Promise<CurrenciesInUse> {
    await this.setTenant(manager, tenantId);
    const settings = await this.settings.getSettings(tenantId, { manager });
    const reporting = settings.reportingCurrency.toUpperCase();
    const currentYear = new Date().getFullYear();

    const budgetRows = await manager.query(
      `SELECT DISTINCT UPPER(TRIM(i.currency)) AS currency, v.budget_year AS year
         FROM spend_items i
         JOIN spend_versions v
           ON v.tenant_id = i.tenant_id
          AND v.spend_item_id = i.id
        WHERE i.tenant_id = $1
          AND v.tenant_id = $1
          AND i.currency IS NOT NULL
          AND v.budget_year IS NOT NULL`,
      [tenantId],
    );
    const companyRows = await manager.query(
      `SELECT DISTINCT UPPER(TRIM(c.base_currency)) AS currency, m.fiscal_year AS year
         FROM companies c
         JOIN company_metrics m
           ON m.tenant_id = c.tenant_id
          AND m.company_id = c.id
        WHERE c.tenant_id = $1
          AND m.tenant_id = $1
          AND c.base_currency IS NOT NULL
          AND m.turnover IS NOT NULL`,
      [tenantId],
    );
    const contractRows = await manager.query(
      `SELECT DISTINCT UPPER(TRIM(c.currency)) AS currency, y.year
         FROM contracts c
         CROSS JOIN (
           SELECT DISTINCT v.budget_year AS year
             FROM spend_versions v
            WHERE v.tenant_id = $1
              AND v.budget_year IS NOT NULL
           UNION
           SELECT $2::int AS year
         ) y
        WHERE c.tenant_id = $1
          AND c.currency IS NOT NULL`,
      [tenantId, currentYear],
    );

    const seen = new Set<string>();
    const pairs: MissingRatePair[] = [];
    for (const pair of [
      ...readPairs(budgetRows),
      ...readPairs(companyRows),
      ...readPairs(contractRows),
    ]) {
      const key = `${pair.year}:${pair.currency}`;
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push(pair);
    }

    const currencies = new Set<string>([reporting]);
    for (const code of [settings.defaultSpendCurrency, settings.defaultCapexCurrency, ...(settings.allowedCurrencies ?? [])]) {
      const normalized = typeof code === 'string' ? code.trim().toUpperCase() : '';
      if (/^[A-Z]{3}$/.test(normalized)) currencies.add(normalized);
    }
    for (const pair of pairs) currencies.add(pair.currency);
    return { reporting, currencies, pairs };
  }

  private async setTenant(manager: EntityManager, tenantId: string): Promise<void> {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  }

  /**
   * `now()` is the start of the transaction, so a set written beside another
   * in the same transaction would tie on `captured_at`. `clock_timestamp()`
   * keeps this set strictly later for readers that take the latest capture.
   */
  private async insertSet(
    manager: EntityManager,
    fields: {
      tenantId: string;
      year: number;
      baseCurrency: string;
      rates: Record<string, number | null>;
      rateSources: Record<string, string>;
      rateBasis: string;
      source: string;
    },
  ): Promise<CurrencyRateSet> {
    const repo = manager.getRepository(CurrencyRateSet);
    const saved = await repo.save(repo.create({
      tenant_id: fields.tenantId,
      fiscal_year: fields.year,
      base_currency: fields.baseCurrency,
      rates: fields.rates,
      rate_sources: Object.keys(fields.rateSources).length ? fields.rateSources : null,
      rate_basis: fields.rateBasis,
      source: fields.source,
    }));
    await manager.query(`UPDATE currency_rate_sets SET captured_at = clock_timestamp() WHERE id = $1`, [saved.id]);
    return (await repo.findOne({ where: { id: saved.id } })) ?? saved;
  }
}
