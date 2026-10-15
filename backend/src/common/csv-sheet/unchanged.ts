/**
 * Whether a re-imported row changes what is stored. A row whose values all equal the stored
 * ones counts as unchanged: the import does not write it, so it leaves no audit line and no
 * new `updated_at`. When equality cannot be proven, the row is an update, as before.
 *
 * The stored side is what PostgreSQL returns: bigint and numeric as strings, date and
 * timestamp columns as Dates (a date at local midnight), JSON as objects.
 */

import { StatusState, deriveStatusFromDisabledAt } from '../status';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || value === '' || (Array.isArray(value) && value.length === 0);
}

function localDay(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function sameDate(date: Date, other: unknown): boolean {
  if (typeof other === 'string' && DAY.test(other)) return localDay(date) === other;
  const instant = other instanceof Date ? other : typeof other === 'string' ? new Date(other) : null;
  return !!instant && !Number.isNaN(instant.getTime()) && instant.getTime() === date.getTime();
}

/** JSON with sorted keys, so two objects with the same content compare equal. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const entries = Object.keys(value as Record<string, unknown>).sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value instanceof Date ? value.toISOString() : value);
}

/** One stored value against the value a row sets. */
export function sameStoredValue(stored: unknown, next: unknown): boolean {
  if (isBlank(stored) || isBlank(next)) return isBlank(stored) && isBlank(next);
  if (stored instanceof Date) return sameDate(stored, next);
  if (next instanceof Date) return sameDate(next, stored);
  if (typeof next === 'number' || typeof stored === 'number') {
    const a = typeof stored === 'string' ? stored.trim() : stored;
    const b = typeof next === 'string' ? next.trim() : next;
    if (a === '' || b === '') return false;
    return Number(a) === Number(b) && !Number.isNaN(Number(a));
  }
  if (Array.isArray(stored) || Array.isArray(next)) {
    return Array.isArray(stored) && Array.isArray(next)
      && stored.length === next.length
      && stored.every((value, i) => sameStoredValue(value, next[i]));
  }
  if (typeof stored === 'object' || typeof next === 'object') return stableJson(stored) === stableJson(next);
  return stored === next;
}

/**
 * True when every value `next` sets (anything but undefined) equals the stored one. A value for
 * a property the stored row lacks cannot be proven equal. `keys` limits the comparison.
 */
export function sameStoredValues(
  stored: Record<string, unknown>,
  next: Record<string, unknown>,
  keys: readonly string[] = Object.keys(next),
): boolean {
  return keys.every((key) => {
    const value = next[key];
    if (value === undefined) return true;
    if (!(key in stored)) return false;
    return sameStoredValue(stored[key], value);
  });
}

/**
 * The status and end of validity a row sets (`csvItemLifecycle`: undefined keeps the stored
 * value) against the stored ones. The stored status is read from the stored date, as the
 * exports write it: it can lag until the hourly sync once the date passes.
 */
export function sameStoredLifecycle(
  stored: { disabled_at?: Date | string | null },
  next: { status?: StatusState | null; disabled_at?: Date | string | null },
): boolean {
  if (next.disabled_at !== undefined && !sameStoredValue(stored.disabled_at ?? null, next.disabled_at)) return false;
  // An enabled status with no date clears a stored end of validity, even one still to come.
  if (next.status === StatusState.ENABLED && next.disabled_at === undefined && !isBlank(stored.disabled_at)) return false;
  return next.status == null || next.status === deriveStatusFromDisabledAt(stored.disabled_at ?? null);
}
