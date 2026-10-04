/**
 * How the server read the dates and the amounts of an imported file, shared by
 * every CSV import: the language the screen is written in, and the English
 * sentences the server answers with when it had to choose a reading.
 */

/** The languages the server writes its files and its messages in. */
export type ScreenLanguage = 'en' | 'fr' | 'de' | 'es';

/** The language the screen is shown in. Anything else is sent as English. */
export function screenLanguage(language: string | undefined): ScreenLanguage {
  const code = (language ?? '').toLowerCase().slice(0, 2);
  if (code === 'fr' || code === 'de' || code === 'es') return code;
  return 'en';
}

/* ---- Server sentences the dialogs say in the screen language ---- */

export const DATE_DAY = 'Dates read day first: 01/03/2027 is March 1.';
export const DATE_MONTH = 'Dates read month first: 01/03/2027 is January 3.';
export const AMOUNT_COMMA = 'Amounts read with a decimal comma: 12.280 is twelve thousand two hundred eighty.';
export const AMOUNT_DOT = 'Amounts read with a decimal dot: 12,280 is twelve thousand two hundred eighty.';

export type DateReading = 'day-first' | 'month-first';

/** Which order the server applied, when it had to say so. Null when the file settled it. */
export function dateReadingOf(notice: string | null): DateReading | null {
  if (notice === DATE_DAY) return 'day-first';
  if (notice === DATE_MONTH) return 'month-first';
  return null;
}

export type AmountReading = 'comma' | 'dot';

export function amountReadingOf(notice: string | null): AmountReading | null {
  if (notice === AMOUNT_COMMA) return 'comma';
  if (notice === AMOUNT_DOT) return 'dot';
  return null;
}
