import type { EntityManager } from 'typeorm';
import type { FxLookupKey, FxRateService, FxResolvedRate } from '../../currency/fx-rate.service';
import type { CurrencySettings } from '../../currency/currency-settings.service';
import type { SummaryScopeConfig } from '../spend-summary.builder';
import type { SqlStatement } from '../../common/list-engine/sql-statement';
import { jsTrim, jsUpper } from '../../common/list-engine/sql-fragments';
import { natureAnd } from '../budget-nature';

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
  /**
   * One row per rate set key (a set id or `live`), year and stored currency
   * (`currency::text`, the join key: the normalised code, `lineCurrencySql`,
   * is computed once per distinct value here, not once per line). The rate
   * is the multiplier: the resolved rate, or 0 where `convertValue` gives 0
   * (a rate that is not finite or not positive).
   */
  rows: Array<{ setKey: string; year: number; currency: string; rate: number }>;
  /** Rate sets of the tenant; a version on any other set reads `live`, as the FX service falls back. */
  knownSets: string[];
  reportingCurrency: string;
}

/** The line currency as the builder keys it: `String(currency || 'EUR').trim().toUpperCase()`. */
export function lineCurrencySql(alias: string): string {
  return jsUpper(jsTrim(`${alias}.currency::text`));
}

/** The currency the table is keyed by: the stored one. */
export function fxKeyCurrency(alias: string): string {
  return `${alias}.currency::text`;
}

/**
 * The table as an inline function scan `<alias>(set_key, yr, cur, rate)`
 * (`fx` by default; not a CTE: the planner then knows its size and hashes
 * it), its parameters bound once per statement, whatever the alias.
 */
export function fxTableSql(stmt: SqlStatement, fx: FxTable, alias = 'fx'): string {
  const rows = stmt.once('fx_rows', () => {
    const r = fx.rows;
    return `unnest(${stmt.bind(r.map((row) => row.setKey), 'text[]')}, ${stmt.bind(r.map((row) => row.year), 'int[]')}, ${stmt.bind(r.map((row) => row.currency), 'text[]')}, ${stmt.bind(r.map((row) => String(row.rate)), 'float8[]')})`;
  });
  return `${rows} AS ${alias}(set_key, yr, cur, rate)`;
}

/** The table key of a version's rate set: the set when the tenant has it, else `live`. */
export function fxSetKeySql(stmt: SqlStatement, fx: FxTable, setIdExpr: string): string {
  const known = stmt.once('fx_known_sets', () => stmt.bind(fx.knownSets, 'uuid[]'));
  return `CASE WHEN ${setIdExpr} = ANY(${known}) THEN ${setIdExpr}::text ELSE 'live' END`;
}

const rateKey = (setKey: string, year: number, currency: string) => `${setKey}:${year}:${currency.toUpperCase()}`;

/**
 * An FX service that answers from the rates a request already resolved, and
 * asks the real service only for keys it has not seen: the page builder then
 * reuses the engine's table instead of resolving the same rates again.
 *
 * The engine's table is speculative (every rate set × year × currency, most
 * of which no version uses), so it is resolved quietly (`quiet: true`, no
 * "Missing FX rate" warning). A caller that converts real versions (the row
 * builder) still gets the service's warning: a missing rate it asks for that
 * was only resolved quietly is resolved again, loudly.
 */
export class RequestFxRates implements FxRates {
  private readonly cache = new Map<string, FxResolvedRate>();
  private readonly quietKeys = new Set<string>();
  private settings: CurrencySettings | null = null;

  constructor(private readonly inner: FxRates) {}

  async resolveRates(
    tenantId: string,
    lookups: FxLookupKey[],
    opts?: { manager?: EntityManager; quiet?: boolean },
  ): Promise<{ map: Map<string, FxResolvedRate>; settings: CurrencySettings }> {
    const quiet = opts?.quiet === true;
    const keyOf = (lookup: FxLookupKey) => rateKey(lookup.rateSetId || 'live', lookup.fiscalYear, lookup.sourceCurrency);
    const toResolve = lookups.filter((lookup) => {
      const key = keyOf(lookup);
      const cached = this.cache.get(key);
      return !cached || (!quiet && cached.source === 'missing' && this.quietKeys.has(key));
    });
    if (toResolve.length || !this.settings) {
      const resolved = await this.inner.resolveRates(tenantId, toResolve, opts);
      for (const [key, rate] of resolved.map) {
        this.cache.set(key, rate);
        if (quiet) this.quietKeys.add(key);
        else this.quietKeys.delete(key);
      }
      this.settings = resolved.settings;
    }
    const map = new Map<string, FxResolvedRate>();
    for (const lookup of lookups) {
      const key = keyOf(lookup);
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
    manager.query(
      `SELECT DISTINCT ${fxKeyCurrency('i')} AS raw, ${lineCurrencySql('i')} AS cur FROM ${config.itemTable} i WHERE i.tenant_id = $1${natureAnd('i', config.nature)}`,
      [tenantId],
    ),
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
  const fx = await fxRates.resolveRates(tenantId, entries.map((entry) => entry.lookup), { manager, quiet: true });
  const rows = entries.map(({ setKey, year, raw, lookup }) => {
    const rate = fx.map.get(rateKey(setKey, year, lookup.sourceCurrency))?.rate ?? 1;
    return { setKey, year, currency: raw, rate: Number.isFinite(rate) && rate > 0 ? rate : 0 };
  });
  return { rows, knownSets, reportingCurrency: fx.settings?.reportingCurrency ?? 'EUR' };
}
