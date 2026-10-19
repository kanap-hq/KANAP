/**
 * Amounts left out of the reporting currency for lack of an exchange rate: one entry per line
 * currency and budget year, with the number of distinct lines it left out (`fxMissing` of the
 * summary totals and aggregates).
 */
export type FxMissing = { currency: string; year: number; lines: number };

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
