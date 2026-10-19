import type { TFunction } from 'i18next';

/**
 * Amounts left out of the reporting currency for lack of an exchange rate: one entry per line
 * currency and budget year, with the number of distinct lines it left out (`fxMissing` of the
 * summary totals and aggregates).
 */
export type FxMissing = { currency: string; year: number; lines: number };

/**
 * The sentence naming the amounts left out for lack of an exchange rate: the currencies and years in
 * the order received, with their line counts (the notice's text, also a chargeback report warning).
 * Counts are per currency and year: a line missing two years is in both, so several entries give no
 * total of distinct lines.
 */
export function fxMissingText(t: TFunction, items: ReadonlyArray<FxMissing>): string {
  if (items.length === 1) {
    return t('ops:shared.fxMissing.excluding', {
      count: items[0].lines,
      pairs: t('ops:shared.fxMissing.pair', { currency: items[0].currency, year: items[0].year }),
    });
  }
  return t('ops:shared.fxMissing.excludingSeveral', {
    pairs: items.map((item) => t('ops:shared.fxMissing.pairWithCount', { currency: item.currency, year: item.year, count: item.lines })).join(', '),
  });
}

/**
 * The entries of several answers as one list, in the order first met. The same currency and year in
 * two answers keeps the larger count: two aggregates of one report (a delta's two years, a compare's
 * columns) read the same lines, so adding their counts would count a line twice.
 */
export function mergeFxMissing(...lists: ReadonlyArray<ReadonlyArray<FxMissing> | null | undefined>): FxMissing[] {
  const byKey = new Map<string, FxMissing>();
  for (const list of lists) {
    for (const entry of list ?? []) {
      if (!entry?.currency) continue;
      const key = `${entry.currency}\u0000${entry.year}`;
      const known = byKey.get(key);
      if (!known) byKey.set(key, { currency: entry.currency, year: entry.year, lines: entry.lines });
      else if (entry.lines > known.lines) known.lines = entry.lines;
    }
  }
  return Array.from(byKey.values());
}

/** The `fx_missing` of a grid row's year slot: the line currency and the amounts in that currency. */
export type SlotFxMissing = { currency: string; amounts?: Partial<Record<string, number | null>> };
