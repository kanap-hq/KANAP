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
  const dayIndex = parts.findIndex((part) => part.type === 'day');
  // German writes the day as an ordinal ("19. Okt."): keep the period Intl puts after it.
  const dayPart = dayIndex >= 0
    ? `${parts[dayIndex].value}${parts[dayIndex + 1]?.type === 'literal' && parts[dayIndex + 1].value.startsWith('.') ? '.' : ''}`
    : undefined;
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

const abbreviatedMonths = new Map<string, RegExp | null>();

/** The months a locale abbreviates with a period ("oct.", "Okt."), as a pattern, or null when none. */
function abbreviatedMonthPattern(locale: string): RegExp | null {
  const language = (locale || 'en').split('-')[0];
  if (abbreviatedMonths.has(language)) return abbreviatedMonths.get(language)!;
  const formatter = new Intl.DateTimeFormat(language, { day: 'numeric', month: 'short' });
  const months = Array.from({ length: 12 }, (_, month) => formatter
    .formatToParts(new Date(2001, month, 15))
    .find((part) => part.type === 'month')?.value ?? '')
    .filter((month) => month.endsWith('.'));
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = months.length > 0
    ? new RegExp(`(^|[\\s\\u00a0])(${months.map(escape).join('|')})\\.(?=$|[\\s\\u00a0)»”"])`, 'g')
    : null;
  abbreviatedMonths.set(language, pattern);
  return pattern;
}

/**
 * A sentence that ends on an abbreviated month keeps a single period: "la semaine du 19 oct." and not
 * "19 oct..". Applied to every translated text (i18n post-processor).
 */
export function mergeAbbreviationPeriods(text: string, locale: string): string {
  if (!text.includes('..')) return text;
  const pattern = abbreviatedMonthPattern(locale);
  return pattern ? text.replace(pattern, '$1$2') : text;
}

