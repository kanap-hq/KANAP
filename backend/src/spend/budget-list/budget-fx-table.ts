import type { EntityManager } from 'typeorm';
import type { FxLookupKey, FxRateService, FxResolvedRate } from '../../currency/fx-rate.service';
import type { CurrencySettings } from '../../currency/currency-settings.service';
import type { SummaryScopeConfig } from '../spend-summary.builder';
import { jsTrim, jsUpper } from '../../common/list-engine/sql-fragments';

type FxRates = Pick<FxRateService, 'resolveRates' | 'convertValue'>;

/**
 * The FX rates of a list request as a small parameter table, resolved by the
 * FX service (single source of truth): every rate set of the tenant plus
 * `live`, for every year in play and every currency of the tenant's lines.
 * The engine joins it per version (`fx_rate_set_id` or `live`, budget year,
 * line currency) and converts in SQL to the cent like the builder:
 * `Math.round(amount × rate × 100)`.
 */
export interface FxTable {
  setKeys: string[];
  years: number[];
  /**
   * The line currency as stored (`currency::text`), the join key: the
   * normalised code (`lineCurrencySql`) is computed once per distinct value
   * here, not once per line in the statement.
   */
  currencies: string[];
  /** The multiplier of each row: the resolved rate, or 0 where `convertValue` gives 0 (a rate that is not finite or not positive). */
  rates: number[];
  /** Rate sets of the tenant; a version on any other set reads `live`, as the FX service falls back. */
  knownSets: string[];
  reportingCurrency: string;
}

/** The line currency as the builder keys it: `String(currency || 'EUR').trim().toUpperCase()`. */
export function lineCurrencySql(alias: string): string {
  return jsUpper(jsTrim(`${alias}.currency::text`));
}

/** The join key of the FX table: the stored currency. */
export function fxJoinCurrency(alias: string): string {
  return `${alias}.currency::text`;
}

/** The FX table as a CTE body: one row per rate set key, year and stored currency. */
export function fxTableSql(bind: (value: unknown, cast: string) => string, fx: FxTable): string {
  return `SELECT * FROM unnest(${bind(fx.setKeys, 'text[]')}, ${bind(fx.years, 'int[]')}, ${bind(fx.currencies, 'text[]')}, ${bind(fx.rates.map(String), 'float8[]')}) AS t(set_key, yr, cur, rate)`;
}

const rateKey = (setKey: string, year: number, currency: string) => `${setKey}:${year}:${currency.toUpperCase()}`;

/**
 * An FX service that answers from the rates a request already resolved, and
 * asks the real service only for keys it has not seen: the page builder then
 * reuses the engine's table instead of resolving the same rates again.
 */
export class RequestFxRates implements FxRates {
  private readonly cache = new Map<string, FxResolvedRate>();
  private settings: CurrencySettings | null = null;

  constructor(private readonly inner: FxRates) {}

  async resolveRates(
    tenantId: string,
    lookups: FxLookupKey[],
    opts?: { manager?: EntityManager },
  ): Promise<{ map: Map<string, FxResolvedRate>; settings: CurrencySettings }> {
    const missing = lookups.filter((lookup) => !this.cache.has(rateKey(lookup.rateSetId || 'live', lookup.fiscalYear, lookup.sourceCurrency)));
    if (missing.length || !this.settings) {
      const resolved = await this.inner.resolveRates(tenantId, missing, opts);
      for (const [key, rate] of resolved.map) this.cache.set(key, rate);
      this.settings = resolved.settings;
    }
    const map = new Map<string, FxResolvedRate>();
    for (const lookup of lookups) {
      const key = rateKey(lookup.rateSetId || 'live', lookup.fiscalYear, lookup.sourceCurrency);
      const rate = this.cache.get(key);
      if (rate) map.set(key, rate);
    }
    return { map, settings: this.settings! };
  }

  convertValue(amount: number, rate: number): number {
    return this.inner.convertValue(amount, rate);
  }
}

export async function buildFxTable(
  config: SummaryScopeConfig,
  fxRates: FxRates,
  manager: EntityManager,
  tenantId: string,
  years: number[],
): Promise<FxTable> {
  const [currencyRows, setRows] = await Promise.all([
    manager.query(`SELECT DISTINCT ${fxJoinCurrency('i')} AS raw, ${lineCurrencySql('i')} AS cur FROM ${config.itemTable} i WHERE i.tenant_id = $1`, [tenantId]),
    manager.query(`SELECT s.id FROM currency_rate_sets s WHERE s.tenant_id = $1`, [tenantId]),
  ]);
  const currencies: Array<{ raw: string; cur: string }> = currencyRows;
  const knownSets: string[] = setRows.map((row: { id: string }) => row.id);
  const uniqueYears = Array.from(new Set(years));
  const entries: Array<{ setKey: string; year: number; raw: string; lookup: FxLookupKey }> = [];
  for (const setId of [null, ...knownSets]) {
    for (const year of uniqueYears) {
      for (const currency of currencies) {
        entries.push({
          setKey: setId || 'live',
          year,
          raw: currency.raw,
          lookup: { key: '', rateSetId: setId, fiscalYear: year, sourceCurrency: currency.cur },
        });
      }
    }
  }
  const fx = await fxRates.resolveRates(tenantId, entries.map((entry) => entry.lookup), { manager });
  const table: FxTable = {
    setKeys: [],
    years: [],
    currencies: [],
    rates: [],
    knownSets,
    reportingCurrency: fx.settings?.reportingCurrency ?? 'EUR',
  };
  for (const { setKey, year, raw, lookup } of entries) {
    const rate = fx.map.get(rateKey(setKey, year, lookup.sourceCurrency))?.rate ?? 1;
    table.setKeys.push(setKey);
    table.years.push(year);
    table.currencies.push(raw);
    table.rates.push(Number.isFinite(rate) && rate > 0 ? rate : 0);
  }
  return table;
}
