/**
 * A figure on a company list row. Null when the year has no metric row, or when
 * the column was left blank. A real zero stays zero. Sort and filter still treat
 * a blank as zero in SQL. A list total is null when no company has that figure
 * for the year.
 */
export function companyListMetric(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}
