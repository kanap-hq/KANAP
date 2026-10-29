import { BadRequestException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import type { CurrencySettingsService } from '../../currency/currency-settings.service';
import type { CurrencyRateMatrix, ManualRatesService, MissingRatePair } from '../../currency/manual-rates.service';
import { isLimitedTransaction } from '../../data-access/line-write-checks';
import type { AiPolicyService } from '../ai-policy.service';
import type { AiExecutionContextWithManager } from '../ai.types';
import { compareText, numberMatch, paged, setMatch } from './ai-support.query';

/**
 * The exchange rates and the currency settings as the Currency settings screen shows them, for the
 * assistant and the MCP server: the family `exchange_rates`, one row per year and currency of the
 * screen's matrix (`ManualRatesService.listRateMatrix`, `GET /currency/rates`), the reporting
 * currency included, never a second formula. Each year reads its latest set of rates in the
 * reporting currency; a set captured in another base is left out, as on the screen. The matrix
 * keeps the currencies in use and those carrying a manual rate.
 *
 * Every response carries the settings (`CurrencySettingsService.getSettings`) and the pairs in use
 * without a rate (`listMissingPairs` with `report: false`): a read writes nothing and starts no
 * download. The inverse rate and the cross rate against another currency are computed here, so the
 * model never divides. The list is small (years × currencies in use): filtered, grouped, sorted and
 * paged in memory. Read with the budget right at reader level, as the routes, limited access
 * included: the currencies in use are read under the person's access, so a limited person's matrix
 * lists the currencies of their lines, as the screen's.
 */

export const AI_EXCHANGE_RATE_SOURCES = [
  'world-bank-annual', 'exchangerateapi-spot', 'world-bank-forward', 'estimate', 'identity', 'manual',
] as const;

export const AI_EXCHANGE_RATE_YEARS = { min: 1900, max: 3000 } as const;
export const AI_EXCHANGE_RATE_YEAR_REFUSAL = `year is a year from ${AI_EXCHANGE_RATE_YEARS.min} to ${AI_EXCHANGE_RATE_YEARS.max}, for example {"op": "eq", "value": 2026}.`;
export const AI_EXCHANGE_RATE_AGAINST_REFUSAL = 'against takes one currency code, for example "CHF": each row then carries cross_rate, the units of that currency for 1 unit of the row\'s currency.';

export type AiExchangeRateRow = {
  /** `year:currency`, distinct per row and stable. */
  key: string;
  year: number;
  currency: string;
  /** Units of the reporting currency for 1 unit of `currency`; null when the year has no rate for it. */
  rate: number | null;
  /** Units of `currency` for 1 unit of the reporting currency, computed here. */
  inverse_rate: number | null;
  source: string | null;
  manual: boolean;
  captured_at: string | null;
  reporting_currency: string;
  /** Why the cell is empty, in words, when `rate` is null (`rateGapText`). */
  rate_note?: string;
  /** With `against`: units of `against` for 1 unit of `currency`, from the two rates of the year. */
  cross_rate?: number | null;
  cross_rate_note?: string;
};

export type AiExchangeRatesSettings = {
  reporting_currency: string;
  default_opex_currency: string;
  default_capex_currency: string;
  /** Empty: every currency is allowed (`allowed_currencies_note`). */
  allowed_currencies: string[];
  allowed_currencies_note?: string;
};

export type AiExchangeRatesBlock = {
  settings: AiExchangeRatesSettings;
  /** The pairs in use without a rate, as the screen's "missing rates", whatever the filters. */
  missing_rates: MissingRatePair[];
  missing_rates_note: string;
  /** With `against`: the currency of `cross_rate` and the years where it could not be given. */
  against?: { currency: string; in_matrix: boolean; years_without_cross_rate: number[]; note: string };
  notes: string[];
};

export type AiExchangeRatesServices = {
  rates: Pick<ManualRatesService, 'listRateMatrix' | 'listMissingPairs'>;
  settings: Pick<CurrencySettingsService, 'getSettings'>;
};

export type AiExchangeRatesList = {
  items: AiExchangeRateRow[];
  total: number;
  page: number;
  limit: number;
  block: AiExchangeRatesBlock;
};

export const EXCHANGE_RATE_SORTS = new Set(['year', 'currency', 'source']);

function round6(value: number): number {
  return Number(value.toFixed(6));
}

function usable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function toIsoText(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  return String(value);
}

function upperValues(model: any): string[] {
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return [];
  return Array.from(new Set(model.values
    .filter((value: unknown): value is string => typeof value === 'string')
    .map((value: string) => value.trim().toUpperCase())
    .filter((value: string) => value.length > 0)));
}

/** A year filter: any operator, every value a year of 1900 to 3000, refused in words otherwise. */
function assertYearFilter(model: any): void {
  if (!model || model.filterType !== 'number') return;
  for (const raw of [model.filter, model.filterTo]) {
    if (raw == null) continue;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < AI_EXCHANGE_RATE_YEARS.min || value > AI_EXCHANGE_RATE_YEARS.max) {
      throw new BadRequestException(AI_EXCHANGE_RATE_YEAR_REFUSAL);
    }
  }
}

function againstOf(filters: Record<string, any> | undefined): string | null {
  const values = upperValues(filters?.against);
  if (values.length > 1) throw new BadRequestException(AI_EXCHANGE_RATE_AGAINST_REFUSAL);
  return values[0] ?? null;
}

/**
 * Why a cell of the matrix is empty. A pair of the missing rates is used that year without a rate.
 * Any other empty cell is what the screen shows, an empty cell, whatever the stored set holds: the
 * matrix keeps a currency's rates only when it is in use or entered by hand (a currency shown for a
 * manual rate of another year has no cell value this year).
 */
function rateGapText(currency: string, year: number, missing: boolean): string {
  return missing
    ? `No ${currency} rate is recorded for ${year}, a year where ${currency} is used (missing_rates)`
    : `The rate matrix of the Currency settings screen has no ${currency} rate for ${year} (the screen leaves the cell empty)`;
}

/**
 * Every cell of the screen's matrix, in its order: years ascending (the years of the sets and of
 * the missing pairs, as the screen's columns), the reporting currency first, then the others.
 */
function matrixRows(matrix: CurrencyRateMatrix, missing: MissingRatePair[], reporting: string): AiExchangeRateRow[] {
  const setByYear = new Map(matrix.rates.map((set) => [set.fiscalYear, set]));
  const years = Array.from(new Set([...matrix.rates.map((set) => set.fiscalYear), ...missing.map((pair) => pair.year)])).sort((a, b) => a - b);
  const currencies = matrix.currencies.map((code) => code.trim().toUpperCase()).filter((code) => code.length > 0);
  const missingKeys = new Set(missing.map((pair) => `${pair.year}:${String(pair.currency).trim().toUpperCase()}`));
  const rows: AiExchangeRateRow[] = [];
  for (const year of years) {
    const set = setByYear.get(year);
    for (const currency of currencies) {
      const stored = set?.rates?.[currency];
      const rate = usable(stored) ? stored : null;
      // A set captured before per-rate sources lends its own source to its rates, as the ingestion.
      const source = set?.rateSources?.[currency] ?? (rate != null ? set?.source ?? null : null);
      rows.push({
        key: `${year}:${currency}`,
        year,
        currency,
        rate,
        inverse_rate: rate != null ? round6(1 / rate) : null,
        source,
        manual: source === 'manual',
        captured_at: set ? toIsoText(set.capturedAt) : null,
        reporting_currency: reporting,
        ...(rate == null ? { rate_note: `${rateGapText(currency, year, missingKeys.has(`${year}:${currency}`))}.` } : {}),
      });
    }
  }
  return rows;
}

/** `cross_rate` on every row: units of `against` for 1 unit of the row's currency, same year. */
function withCrossRates(rows: AiExchangeRateRow[], against: string, inMatrix: boolean, limited: boolean): AiExchangeRateRow[] {
  const againstRow = new Map(rows.filter((row) => row.currency === against).map((row) => [row.year, row]));
  return rows.map((row) => {
    const other = againstRow.get(row.year) ?? null;
    if (row.rate != null && other?.rate != null) return { ...row, cross_rate: round6(row.rate / other.rate) };
    // Each empty cell says why, as its own row does (`rate_note`).
    const gaps = Array.from(new Set([row.rate == null ? row : null, other && other.rate == null && other !== row ? other : null]
      .filter((cell): cell is AiExchangeRateRow => !!cell)
      .map((cell) => String(cell.rate_note ?? '').replace(/\.$/, ''))));
    const note = !inMatrix
      ? `${against} is not in the rate matrix${limited ? ' within your access' : ''}: no cross rate.`
      : `${gaps.join('; ')}: no cross rate for this year.`;
    return { ...row, cross_rate: null, cross_rate_note: note };
  });
}

function filtered(rows: AiExchangeRateRow[], query: Record<string, any>): AiExchangeRateRow[] {
  const filters = query.filters;
  const currencies = upperValues(filters?.currency);
  const needle = String(query.q ?? '').trim().toLowerCase();
  return rows.filter((row) => numberMatch(row.year, filters?.year)
    // A currency compares exactly, without case: `usd` is USD.
    && (!filters?.currency || currencies.includes(row.currency))
    && setMatch(row.source, filters?.source)
    && setMatch(String(row.manual), filters?.manual)
    && (!needle || row.currency.toLowerCase().includes(needle) || String(row.year) === needle));
}

function sortRows(rows: AiExchangeRateRow[], sort: string | undefined): AiExchangeRateRow[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = EXCHANGE_RATE_SORTS.has(requested) ? requested : 'year';
  const descending = String(requestedDirection ?? 'asc').toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const order = field === 'year'
        ? a.row.year - b.row.year
        : field === 'source'
          ? compareText(a.row.source, b.row.source)
          // The screen's order of currencies: the reporting currency first, then by code.
          : (a.row.currency === a.row.reporting_currency ? -1 : 0) - (b.row.currency === b.row.reporting_currency ? -1 : 0)
            || compareText(a.row.currency, b.row.currency);
      // Ties keep the screen's order: years, then currencies.
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

function settingsBlock(settings: { reportingCurrency: string; defaultSpendCurrency: string; defaultCapexCurrency: string; allowedCurrencies: string[] | null }): AiExchangeRatesSettings {
  const allowed = settings.allowedCurrencies ?? [];
  return {
    reporting_currency: settings.reportingCurrency,
    default_opex_currency: settings.defaultSpendCurrency,
    default_capex_currency: settings.defaultCapexCurrency,
    allowed_currencies: [...allowed],
    ...(allowed.length ? {} : { allowed_currencies_note: 'Every currency is allowed: no list restricts the currencies of the budget lines.' }),
  };
}

/** The sentence on the direction of a rate, with a figure of the tenant's own matrix when it has one. */
function directionNote(rows: AiExchangeRateRow[], reporting: string): string {
  const example = [...rows].reverse().find((row) => row.currency !== reporting && row.rate != null);
  const base = `rate is the number of ${reporting} (the reporting currency) for 1 unit of the row's currency, as the screen's "Rate in ${reporting} for 1 unit"; inverse_rate is the number of units of the row's currency for 1 ${reporting}.`;
  if (!example) return base;
  return `${base} For example ${example.currency} ${example.year} = ${example.rate} means 1 ${example.currency} = ${example.rate} ${reporting}, and its inverse_rate ${example.inverse_rate} means 1 ${reporting} = ${example.inverse_rate} ${example.currency}. Give a rate with its direction: "${reporting}/${example.currency}" alone is ambiguous.`;
}

export async function listAiExchangeRates(
  services: AiExchangeRatesServices,
  opts: { manager: EntityManager; tenantId: string; limited: boolean },
  query: Record<string, any>,
  readAll = false,
): Promise<AiExchangeRatesList> {
  // Both refused in words before any read.
  const against = againstOf(query.filters);
  assertYearFilter(query.filters?.year);
  const settings = await services.settings.getSettings(opts.tenantId, { manager: opts.manager });
  const reporting = settings.reportingCurrency.toUpperCase();
  const matrix = await services.rates.listRateMatrix(opts.tenantId, opts.manager);
  // Read only: `report: false` starts no download of the missing years.
  const missing = await services.rates.listMissingPairs(opts.tenantId, opts.manager, { report: false });
  const all = matrixRows(matrix, missing, reporting);
  const inMatrix = against ? all.some((row) => row.currency === against) : false;
  const rows = against ? withCrossRates(all, against, inMatrix, opts.limited) : all;
  const kept = sortRows(filtered(rows, query), query.sort);

  const notes = [
    directionNote(all, reporting),
    `The rows are the matrix of the Currency settings screen: each year reads its latest set of rates in ${reporting}, and the currencies are those in use (the reporting currency, the default and allowed currencies, the currencies of the budget lines, of the company turnovers and of the contracts) and those with a manual rate. A currency outside them has no row. The reporting currency is 1 by definition (source identity).`,
    'A frozen budget version keeps the set of rates captured when it was frozen: its lines convert at that set, which can differ from the rate of the year here.',
  ];
  if (!all.some((row) => row.rate != null)) {
    notes.push('No exchange rate is recorded in this workspace. Rates come from the configured rate sources or are entered by hand on the Currency settings screen; on an installation without a rate source they stay empty until someone enters them there.');
  }
  if (opts.limited) {
    notes.push('Within your access: the currencies in use are read from the budget lines and contracts you see, so a currency used only by lines outside your access has no row here, and its missing rates are not listed.');
  }
  if (against) {
    notes.push(`cross_rate is the number of ${against} for 1 unit of the row's currency, computed by the server from the two rates of the same year.`);
  }

  const block: AiExchangeRatesBlock = {
    settings: settingsBlock(settings),
    missing_rates: missing,
    missing_rates_note: missing.length
      ? `These currencies are used in these years without a rate in ${reporting}: their amounts are left out of the figures in ${reporting} until a rate is downloaded or entered on the Currency settings screen. The list covers every year, whatever the filters.`
      : 'No rate is missing: every currency in use has a rate for every year it is used in.',
    ...(against ? {
      against: {
        currency: against,
        in_matrix: inMatrix,
        years_without_cross_rate: Array.from(new Set(kept.filter((row) => row.cross_rate == null).map((row) => row.year))).sort((a, b) => a - b),
        note: inMatrix
          ? `cross_rate gives the units of ${against} for 1 unit of the row's currency; a year where either rate is missing has none (cross_rate_note).`
          : opts.limited
            ? `${against} is not among the currencies of the rate matrix within your access (no budget line, company, contract or setting within your access uses it, and it has no manual rate): no cross rate can be given.`
            : `${against} is not among the currencies of the rate matrix (no budget line, company, contract or setting uses it, and it has no manual rate): no cross rate can be given.`,
      },
    } : {}),
    notes,
  };
  return { ...paged(kept, query, readAll), block };
}

/**
 * The family as both read tools give it: the budget right checked again here (the database does not
 * guard the settings), refused in words naming the exchange rates, then the screen's services read
 * in the person's transaction.
 */
export async function readAiExchangeRates(
  deps: {
    policy?: Pick<AiPolicyService, 'assertEntityTypeReadRight'>;
    rates?: AiExchangeRatesServices['rates'];
    settings?: AiExchangeRatesServices['settings'];
  },
  context: AiExecutionContextWithManager,
  query: Record<string, any>,
  readAll = false,
): Promise<AiExchangeRatesList> {
  if (!deps.policy || !deps.rates || !deps.settings) throw new BadRequestException('The exchange rates are not available.');
  await deps.policy.assertEntityTypeReadRight(context, 'exchange_rates', context.manager);
  return listAiExchangeRates(
    { rates: deps.rates, settings: deps.settings },
    { manager: context.manager, tenantId: context.tenantId, limited: await isLimitedTransaction(context.manager) },
    query,
    readAll,
  );
}

/** The group key of a row, for the in-memory aggregate. */
export function exchangeRateGroupValue(row: AiExchangeRateRow, groupBy: string): string | null {
  switch (groupBy) {
    case 'year': return String(row.year);
    case 'currency': return row.currency;
    case 'source': return row.source;
    case 'manual': return String(row.manual);
    default: return null;
  }
}

/** The rows of each group of the filtered rows, most rows first. */
export function aggregateExchangeRateRows(rows: AiExchangeRateRow[], groupBy: string): Array<{ key: string | null; count: number }> {
  const groups = new Map<string | null, number>();
  for (const row of rows) {
    const key = exchangeRateGroupValue(row, groupBy);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}
