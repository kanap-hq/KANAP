import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CurrencyRateSet } from './currency-rate-set.entity';
import { CurrencySettingsService } from './currency-settings.service';
import { FxIngestionService } from './fx-ingestion.service';
import { FxRateService } from './fx-rate.service';
import { lockRateSetWrite } from './rate-set-lock';

export type ManualRateInput = { currency: string; year: number; rate: number };
export type ManualRateTarget = { currency: string; year: number };
export type ManualRateRemoval = { ok: true; refreshQueued: boolean };
export type MissingRatePair = { currency: string; year: number };

const YEAR_MIN = 1990;
const YEAR_MAX = 2100;
const RATE_MAX = 1e9;

export const MANUAL_RATE_CURRENCY_MESSAGE = 'Currency must be a 3-letter code.';
export const MANUAL_RATE_REPORTING_MESSAGE = 'A manual rate cannot be set for the reporting currency.';
export const MANUAL_RATE_YEAR_MESSAGE = 'Year must be an integer between 1990 and 2100.';
export const MANUAL_RATE_RATE_MESSAGE = 'Rate must be a finite number greater than 0 and at most 1000000000.';

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
  if (typeof input !== 'string') throw new BadRequestException(MANUAL_RATE_CURRENCY_MESSAGE);
  const code = input.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestException(MANUAL_RATE_CURRENCY_MESSAGE);
  return code;
}

function parseYear(input: unknown): number {
  if (typeof input !== 'number' || !Number.isInteger(input) || input < YEAR_MIN || input > YEAR_MAX) {
    throw new BadRequestException(MANUAL_RATE_YEAR_MESSAGE);
  }
  return input;
}

function parseRate(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input) || input <= 0 || input > RATE_MAX) {
    throw new BadRequestException(MANUAL_RATE_RATE_MESSAGE);
  }
  const rounded = roundRate(input);
  if (!(rounded > 0) || rounded > RATE_MAX) throw new BadRequestException(MANUAL_RATE_RATE_MESSAGE);
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
    if (currency === reporting) throw new BadRequestException(MANUAL_RATE_REPORTING_MESSAGE);
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
      throw new NotFoundException(`No manual rate is stored for ${currency} in ${year}.`);
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
   * Pairs in use that the latest set of the year, in the reporting currency,
   * does not rate with a finite value above 0. One query per source. The years
   * found are reported so the page that lists them also tries the sources.
   */
  async listMissingPairs(tenantId: string, manager: EntityManager): Promise<MissingRatePair[]> {
    await this.setTenant(manager, tenantId);
    const reporting = (await this.settings.getSettings(tenantId, { manager })).reportingCurrency.toUpperCase();
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
    const rateRows = await manager.query(
      `SELECT DISTINCT ON (fiscal_year) fiscal_year, rates
         FROM currency_rate_sets
        WHERE tenant_id = $1
          AND UPPER(TRIM(base_currency)) = $2
        ORDER BY fiscal_year, captured_at DESC`,
      [tenantId, reporting],
    );

    const ratesByYear = new Map<number, Record<string, unknown>>();
    for (const row of rateRows as Array<{ fiscal_year: unknown; rates: unknown }>) {
      const year = typeof row.fiscal_year === 'number' ? row.fiscal_year : Number(row.fiscal_year);
      if (!Number.isInteger(year)) continue;
      ratesByYear.set(year, row.rates && typeof row.rates === 'object' ? row.rates as Record<string, unknown> : {});
    }

    const seen = new Set<string>();
    const items: MissingRatePair[] = [];
    for (const pair of [
      ...readPairs(budgetRows),
      ...readPairs(companyRows),
      ...readPairs(contractRows),
    ]) {
      if (pair.currency === reporting) continue;
      const key = `${pair.year}:${pair.currency}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (yearHasUsableRate(ratesByYear.get(pair.year), pair.currency)) continue;
      items.push(pair);
    }
    items.sort((a, b) => a.year - b.year || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
    this.fxRates.reportMissingYears(tenantId, items.map((item) => item.year));
    return items;
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
