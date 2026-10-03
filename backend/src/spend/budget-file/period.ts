/**
 * The period a typed yearly total is spread over, copied from the budget tab
 * (`frontend/src/components/finance/roundPeriod.ts`, `periodForEdit`). The
 * server does not import that file. A stored period, else the whole year when
 * the column already holds an amount, else the item's dates clipped to the
 * year. The spread then stays inside the item's dates.
 */

export interface FilePeriod {
  start: string;
  end: string;
}

const YMD = /^(\d{4})-(\d{2})-(\d{2})$/;

function isYmd(value: string | null | undefined): value is string {
  const match = YMD.exec(value ?? '');
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function yearStart(year: number): string {
  return `${year}-01-01`;
}

function yearEnd(year: number): string {
  return `${year}-12-31`;
}

export function wholeYearPeriod(year: number): FilePeriod {
  return { start: yearStart(year), end: yearEnd(year) };
}

/** The item's dates clipped to the year. Null when the item covers no day of it. */
export function suggestedPeriod(year: number, effectiveStart?: string | null, endOfValidity?: string | null): FilePeriod | null {
  const first = yearStart(year);
  const last = yearEnd(year);
  const start = isYmd(effectiveStart) && effectiveStart > first ? effectiveStart : first;
  const end = isYmd(endOfValidity) && endOfValidity < last ? endOfValidity : last;
  return start <= end ? { start, end } : null;
}

function columnPeriod(
  year: number,
  stored: FilePeriod | null,
  hasAmounts: boolean,
  suggestion: FilePeriod | null,
): FilePeriod | null {
  if (stored) return stored;
  if (hasAmounts) return wholeYearPeriod(year);
  return suggestion;
}

/** The period a yearly total in the file is spread over. Null when nothing proposes one. */
export function periodForYearlyTotal(
  year: number,
  stored: FilePeriod | null,
  hasAmounts: boolean,
  effectiveStart: string | null,
  endOfValidity: string | null,
): FilePeriod | null {
  const suggestion = suggestedPeriod(year, effectiveStart, endOfValidity);
  const period = columnPeriod(year, stored, hasAmounts, suggestion);
  if (!period || !suggestion) return period;
  const start = period.start > suggestion.start ? period.start : suggestion.start;
  const end = period.end < suggestion.end ? period.end : suggestion.end;
  return start <= end ? { start, end } : suggestion;
}
