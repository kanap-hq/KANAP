import { formatShortDate } from '../../../lib/dateFormat';
import { buildItemPath, formatItemRef } from '../../../utils/item-ref';

/** Totals appear from this many rows on (fried, 2026-10-16). */
export const TOTALS_FROM = 2;

/** One page of a relation picker's server search. */
export const PAGE = 30;

/** The placeholder of an empty cell. */
export const DASH = '—';

type RefType = 'budget' | 'project' | 'request' | 'task' | 'incident';

export function refOf(type: RefType, itemNumber: number | null): string | null {
  return itemNumber != null ? formatItemRef(type, itemNumber) : null;
}

export function pathOf(
  type: 'budget' | 'project' | 'request' | 'task',
  row: { id: string; item_number: number | null },
): string {
  return buildItemPath(type, refOf(type, row.item_number) ?? row.id);
}

export function todayYmd(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function relationDate(value: string | null, lang: string): string {
  return value ? formatShortDate(value, lang) : DASH;
}
