import { CsvDateOrder, CsvLanguage, CsvSeparator } from './types';

export interface CsvProfile {
  language: CsvLanguage;
  separator: CsvSeparator;
  /** The decimal mark written in amounts. There is no thousands separator. */
  decimal: '.' | ',';
  /** How an ambiguous local date is read. English files are still written as ISO. */
  dateOrder: CsvDateOrder;
}

const PROFILES: Record<CsvLanguage, CsvProfile> = {
  en: { language: 'en', separator: ',', decimal: '.', dateOrder: 'month-first' },
  fr: { language: 'fr', separator: ';', decimal: ',', dateOrder: 'day-first' },
  es: { language: 'es', separator: ';', decimal: ',', dateOrder: 'day-first' },
  de: { language: 'de', separator: ';', decimal: ',', dateOrder: 'day-first' },
};

/** `en`, `fr`, `de` and `es`. Anything else, including a missing locale, is English. */
export function csvLanguage(locale: string | null | undefined): CsvLanguage {
  if (locale === 'en' || locale === 'fr' || locale === 'de' || locale === 'es') return locale;
  return 'en';
}

export function csvProfile(language: CsvLanguage): CsvProfile {
  return PROFILES[language];
}

export function dateOrderNotice(order: CsvDateOrder): string {
  if (order === 'day-first') return 'Dates read day first: 01/03/2027 is March 1.';
  return 'Dates read month first: 01/03/2027 is January 3.';
}
