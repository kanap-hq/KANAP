import { createHash } from 'node:crypto';
import type { BudgetNature } from '../budget-nature';
import type { InterpretedRow } from './interpret';
import { accentFreeKey, similarity } from './matching';
import type { BudgetFileLookalikeReason, LineHint } from './types';

/**
 * The lookalikes of the budget file (lot I2 of 26.11.9): a row the file creates that looks like a
 * stored line of its nature the person reads, after the matching of lot I1 (supplier, company). Every
 * rule asks for the same paying company, once resolved (the workspace's default when the file gives
 * none), and leaves out a line that ends before the first year of the file's amounts. Three rules,
 * tried in this order, the smallest line number first within a rule:
 * - `title_supplier`: the same title, case and accents aside, and the same supplier (a row without a
 *   supplier and a line without one have the same);
 * - `amounts`: every non-zero amount the file gives for the row (months summed by year and measure)
 *   equal to the line's, the same currency, and the same account when the file gives one; one amount
 *   is enough with the same supplier, two at least without: a translated title is found this way;
 * - `close_title`: a close title (`similarity` of 0.6 at least), the same supplier and currency, and
 *   one equal amount.
 * A close title alone is no lookalike (`Microsoft 365 E3` and `E5`). The index replaces the scan of
 * every line for every row: by title, by amount, by supplier.
 */

export const CLOSE_TITLE_THRESHOLD = 0.6;

/** An amount ten times above or below its reference is told (a warning, never a refusal). */
export const UNUSUAL_RATIO = 10n;

/** The fewest comparable lines of a supplier for their median to be a reference. */
export const MEDIAN_MIN_LINES = 3;

/** `year|measure`, the key of a yearly total. */
export function totalKey(year: number, measure: string): string {
  return `${year}|${measure}`;
}

/** A row's non-zero amounts, months summed into their year, by `year|measure`, in cents. Blank, cleared and invalid cells aside. */
export function rowSums(row: InterpretedRow): Map<string, bigint> {
  const sums = new Map<string, bigint>();
  for (const amount of row.amounts) {
    if (amount.cell.kind !== 'value') continue;
    const key = totalKey(amount.year, amount.measure);
    sums.set(key, (sums.get(key) ?? 0n) + amount.cell.cents);
  }
  return new Map([...sums].filter(([, cents]) => cents !== 0n));
}

/**
 * A line's state, as the load's own freshness check reads it (the snapshot): its `row_version`, and
 * each version's id, year and `budget_rev`. Any write to the line or its amounts changes it. 16 hex
 * characters: short enough for a choice, a card and a form.
 */
export function lineState(rowVersion: number, versions: ReadonlyArray<{ year: number; id: string; budgetRev: number }>): string {
  const years = [...versions]
    .sort((a, b) => a.year - b.year || a.id.localeCompare(b.id))
    .map((version) => `${version.year}:${version.id}:${version.budgetRev}`);
  return createHash('sha256').update(`${rowVersion}|${years.join(',')}`).digest('hex').slice(0, 16);
}

export function hintState(hint: LineHint): string {
  return lineState(hint.rowVersion ?? 0, (hint.years ?? []).map((year) => ({ year: year.year, id: year.versionId, budgetRev: year.budgetRev })));
}

/**
 * What the lookalike pass knows of a row once its supplier, company and account are matched as the
 * check matches them. `supplier`: the supplier's id, null for none, undefined for a supplier the file
 * creates or that matches none. `accountId`: undefined when the file gives no account, null when the
 * account it gives matches none.
 */
export interface RowKeys {
  nature: BudgetNature;
  name: string;
  supplier: string | null | undefined;
  companyId: string | null;
  accountId: string | null | undefined;
  currency: string | null;
  sums: Map<string, bigint>;
  /** The first year of the file's amount columns: a line that ends before it is no target. Null without amounts. */
  firstYear: number | null;
}

export interface FoundLookalike {
  hint: LineHint;
  reason: BudgetFileLookalikeReason;
}

type Indexed = { hint: LineHint; totals: Map<string, bigint> };

function byNumber(a: Indexed, b: Indexed): number {
  return a.hint.itemNumber - b.hint.itemNumber;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** The stored lines the person reads, indexed once per check. */
export class LineIndex {
  private readonly byTitle = new Map<string, Indexed[]>();
  private readonly byAmount = new Map<string, Indexed[]>();
  private readonly entries = new Map<LineHint, Indexed>();
  private readonly byItem = new Map<number, LineHint>();
  private readonly medians = new Map<string, Array<{ id: string | undefined; cents: bigint }>>();

  constructor(hints: readonly LineHint[]) {
    const all: Indexed[] = hints.map((hint) => {
      const totals = new Map<string, bigint>();
      for (const year of hint.years ?? []) {
        for (const [measure, cents] of Object.entries(year.totals)) {
          if (cents != null) totals.set(totalKey(year.year, measure), (totals.get(totalKey(year.year, measure)) ?? 0n) + cents);
        }
      }
      return { hint, totals };
    }).sort(byNumber);
    for (const entry of all) {
      const { hint, totals } = entry;
      this.entries.set(hint, entry);
      this.byItem.set(hint.itemNumber, hint);
      push(this.byTitle, `${hint.nature}|${accentFreeKey(hint.name)}|${hint.supplierId ?? ''}`, entry);
      for (const [key, cents] of totals) {
        if (cents === 0n) continue;
        push(this.byAmount, `${hint.nature}|${key}|${cents}`, entry);
        if (hint.supplierId && hint.currency) {
          push(this.medians, `${hint.nature}|${hint.supplierId}|${hint.currency}|${key}`, { id: hint.id, cents });
        }
      }
    }
  }

  /** The line a row looks like, by the first rule that finds one, or null. */
  find(row: RowKeys): FoundLookalike | null {
    // The same paying company in every rule; a line ended before the file's years is no target.
    if (!row.companyId) return null;
    const fits = (entry: Indexed) => (entry.hint.companyId ?? null) === row.companyId && !endedBefore(entry.hint, row.firstYear);
    if (row.supplier !== undefined) {
      const same = (this.byTitle.get(`${row.nature}|${accentFreeKey(row.name)}|${row.supplier ?? ''}`) ?? []).find(fits);
      if (same) return { hint: same.hint, reason: 'title_supplier' };
    }
    if (row.sums.size === 0) return null;
    const amounts = this.byAmounts(row, fits);
    if (amounts) return { hint: amounts.hint, reason: 'amounts' };
    if (row.supplier === undefined || !row.currency) return null;
    let close: Indexed | null = null;
    for (const [key, cents] of row.sums) {
      for (const entry of this.byAmount.get(`${row.nature}|${key}|${cents}`) ?? []) {
        if ((entry.hint.supplierId ?? null) !== row.supplier || (entry.hint.currency ?? '') !== row.currency || !fits(entry)) continue;
        if (close && close.hint.itemNumber <= entry.hint.itemNumber) continue;
        if (similarity(row.name, entry.hint.name) >= CLOSE_TITLE_THRESHOLD) close = entry;
      }
    }
    return close ? { hint: close.hint, reason: 'close_title' } : null;
  }

  /** Every non-zero amount equal: one is enough with the same supplier, two at least without. */
  private byAmounts(row: RowKeys, fits: (entry: Indexed) => boolean): Indexed | null {
    if (!row.currency || row.accountId === null) return null;
    const [first] = row.sums;
    for (const entry of this.byAmount.get(`${row.nature}|${first[0]}|${first[1]}`) ?? []) {
      const { hint, totals } = entry;
      if ((hint.currency ?? '') !== row.currency || !fits(entry)) continue;
      const sameSupplier = !!row.supplier && hint.supplierId === row.supplier;
      if (!sameSupplier && row.sums.size < 2) continue;
      if (row.accountId !== undefined && hint.accountId !== row.accountId) continue;
      if ([...row.sums].every(([key, cents]) => totals.get(key) === cents)) return entry;
    }
    return null;
  }

  /** The line of a number the person reads, or undefined. */
  hintOf(item: number): LineHint | undefined {
    return this.byItem.get(item);
  }

  /** A line's yearly total of `year|measure`, in cents; undefined when it has none. */
  totalOf(hint: LineHint, key: string): bigint | undefined {
    return this.entries.get(hint)?.totals.get(key);
  }

  /**
   * The median of the non-zero totals of `year|measure` of a supplier's lines of one nature and
   * currency, the line `except` aside; null below MEDIAN_MIN_LINES lines.
   */
  median(nature: BudgetNature, supplierId: string, currency: string, key: string, except: string | null): { cents: bigint; count: number } | null {
    const values = (this.medians.get(`${nature}|${supplierId}|${currency}|${key}`) ?? [])
      .filter((entry) => !except || entry.id !== except)
      .map((entry) => entry.cents)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    if (values.length < MEDIAN_MIN_LINES) return null;
    const middle = Math.floor(values.length / 2);
    const cents = values.length % 2 === 1 ? values[middle] : (values[middle - 1] + values[middle]) / 2n;
    return { cents, count: values.length };
  }
}

/** Whether a line ends before `year` (the first year of the file's amounts). */
function endedBefore(hint: LineHint, year: number | null): boolean {
  if (year == null || !hint.endOfValidity) return false;
  const end = new Date(hint.endOfValidity);
  return !Number.isNaN(end.getTime()) && end.getUTCFullYear() < year;
}

/** Whether `amount` is ten times above or below `reference` (both non-zero, compared by size). */
export function unusual(amount: bigint, reference: bigint): boolean {
  const a = amount < 0n ? -amount : amount;
  const r = reference < 0n ? -reference : reference;
  if (a === 0n || r === 0n) return false;
  return a >= r * UNUSUAL_RATIO || a * UNUSUAL_RATIO <= r;
}
