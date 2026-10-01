/**
 * Shared display formatters for dates (Refined Density charter).
 *
 * All user-facing dates render as "31 Mar" (current year) or "31 Mar 2027"
 * (other years) regardless of locale word order — the day-month-year order is
 * enforced explicitly so the 'en' locale does not fall back to US ordering.
 * Numeric dd/mm/yyyy is reserved for date inputs while they are being edited
 * (see DateEUField).
 */

export type FormatShortDateOptions = {
  /**
   * 'auto' (default) omits the year when it matches the current year; 'never' omits it always, for a
   * date whose year the screen already shows (a year tab).
   */
  year?: 'auto' | 'always' | 'never';
  /** Returned for null/undefined/empty/unparsable values. Defaults to ''. */
  empty?: string;
};

// One formatter per locale, shared by every call: list cells format a date each, and building a
// formatter is far slower than formatting.
const dayMonthYearFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function cachedFormatter(
  cache: Map<string, Intl.DateTimeFormat>,
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  let formatter = cache.get(locale);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    cache.set(locale, formatter);
  }
  return formatter;
}

function getDatePart(value: string): string {
  return value.includes('T') ? value.split('T')[0] : value;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const datePart = getDatePart(value);
  const [yearText, monthText, dayText] = datePart.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!year || !month || !day) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  // Construct in local time so date-only strings never shift a day across timezones.
  return new Date(year, month - 1, day);
}

export function formatShortDate(
  value: string | Date | null | undefined,
  locale = 'en',
  options: FormatShortDateOptions = {},
): string {
  const { year: yearMode = 'auto', empty = '' } = options;
  const date = toDate(value);
  if (!date) return empty;

  const showYear = yearMode === 'always' || (yearMode === 'auto' && date.getFullYear() !== new Date().getFullYear());
  const parts = cachedFormatter(dayMonthYearFormatters, locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  const dayPart = parts.find((part) => part.type === 'day')?.value;
  const monthPart = parts.find((part) => part.type === 'month')?.value;
  const yearPart = showYear ? parts.find((part) => part.type === 'year')?.value : undefined;

  return [dayPart, monthPart, yearPart].filter(Boolean).join(' ') || empty;
}

export function formatShortDateTime(
  value: string | Date | null | undefined,
  locale = 'en',
  options: { empty?: string } = {},
): string {
  const { empty = '' } = options;
  if (!value) return empty;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return empty;

  const datePart = formatShortDate(date, locale, { year: 'always' });
  const timePart = cachedFormatter(timeFormatters, locale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
  return `${datePart}, ${timePart}`;
}
