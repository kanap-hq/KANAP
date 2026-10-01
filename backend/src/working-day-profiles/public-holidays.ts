import type HolidaysLibrary from 'date-holidays';

/**
 * Standard working days from public holidays, offline: the rules come from the
 * `date-holidays` package (code ISC, holiday data CC BY-SA 3.0, attributions
 * in its LICENSE file), shipped unchanged.
 *
 * The working days of a month are its Monday to Friday days that are not a
 * public holiday (`type === 'public'`; bank, school, optional and observance
 * days do not count; nor does a first day that starts at 18:00 or later). A holiday's day is read from its `date` string, which is
 * local to the country: `start` is an instant, and its ISO form in a server
 * east of UTC falls on the day before. A holiday can span several days and
 * start in the previous year, so both years are walked day by day.
 *
 * Country names come from the runtime's Intl data, which names every country
 * of the package in the user's language; region and holiday names come from
 * the package (in the requested language, else the country's, else English).
 */

// The package's CommonJS entry exports the class itself (no `default`), and
// this backend compiles without esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Holidays: typeof HolidaysLibrary = require('date-holidays');

export interface HolidayDay {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  weekend: boolean;
}

export interface GeneratedYear {
  /** Twelve integer strings, January to December. */
  days: string[];
  holidays: HolidayDay[];
}

export interface CountryOption {
  code: string;
  name: string;
  regions: Array<{ code: string; name: string }>;
}

/** The calendar years (CALENDAR_YEAR_MIN / MAX of the calendars util). */
const FIRST_YEAR = 2000;
const LAST_YEAR = 2100;
const DAY_MS = 86_400_000;
/** A public holiday whose first day starts at this hour or later leaves that day a working day. */
const EVENING_HOUR = 18;
/** Generated years kept in memory; far above what a tenant's pages ask for. */
const CACHE_LIMIT = 5_000;

let catalogInstance: HolidaysLibrary | null = null;
function catalog(): HolidaysLibrary {
  catalogInstance ??= new Holidays();
  return catalogInstance;
}

let knownCountries: Set<string> | null = null;
function countryCodes(): Set<string> {
  knownCountries ??= new Set(Object.keys(catalog().getCountries('en') ?? {}));
  return knownCountries;
}

/** A language as the package and Intl take it ("fr-FR" -> "fr"); English by default. */
export function holidayLanguage(raw: unknown): string {
  const match = typeof raw === 'string' ? /^\s*([a-z]{2,3})(?:[-_]|\s*$)/i.exec(raw) : null;
  return match ? match[1].toLowerCase() : 'en';
}

/** The package's code of a country ("fr" -> "FR"), or null when it has no rules for it. */
export function canonicalCountry(code: unknown): string | null {
  if (typeof code !== 'string') return null;
  const upper = code.trim().toUpperCase();
  return countryCodes().has(upper) ? upper : null;
}

const statesCache = new Map<string, Record<string, string>>();
function states(country: string, lang: string): Record<string, string> {
  const key = `${country}|${lang}`;
  let found = statesCache.get(key);
  if (!found) {
    found = { ...(catalog().getStates(country, lang) ?? {}) };
    statesCache.set(key, found);
  }
  return found;
}

/** The package's code of a region of `country`, matched without case, or null. */
export function canonicalRegion(country: unknown, region: unknown): string | null {
  const countryCode = canonicalCountry(country);
  if (!countryCode || typeof region !== 'string') return null;
  const wanted = region.trim().toLowerCase();
  if (!wanted) return null;
  return Object.keys(states(countryCode, 'en')).find((code) => code.toLowerCase() === wanted) ?? null;
}

export function isKnownCountry(code: string): boolean {
  return canonicalCountry(code) !== null;
}

export function isKnownRegion(country: string, region: string): boolean {
  return canonicalRegion(country, region) !== null;
}

const displayNames = new Map<string, Intl.DisplayNames>();
function intlCountryName(code: string, lang: string): string | undefined {
  try {
    let names = displayNames.get(lang);
    if (!names) {
      names = new Intl.DisplayNames([lang, 'en'], { type: 'region', fallback: 'none' });
      displayNames.set(lang, names);
    }
    return names.of(code) || undefined;
  } catch {
    return undefined;
  }
}

/** The country's name in `lang`, else in English, else its code. */
export function countryName(code: string, lang: string): string {
  const language = holidayLanguage(lang);
  const country = canonicalCountry(code);
  if (!country) return typeof code === 'string' ? code.trim().toUpperCase() : String(code);
  return intlCountryName(country, language)
    ?? catalog().getCountries(language)?.[country]
    ?? catalog().getCountries('en')?.[country]
    ?? country;
}

/** The region's name in `lang`, else in English, else its code. */
export function regionName(country: string, region: string, lang: string): string {
  const countryCode = canonicalCountry(country);
  const regionCode = canonicalRegion(country, region);
  if (!countryCode || !regionCode) return typeof region === 'string' ? region.trim() : String(region);
  return states(countryCode, holidayLanguage(lang))[regionCode] ?? states(countryCode, 'en')[regionCode] ?? regionCode;
}

const countriesCache = new Map<string, CountryOption[]>();

/** Every country the package has rules for, with its regions, sorted by name in `lang`. */
export function listCountries(lang: string): CountryOption[] {
  const language = holidayLanguage(lang);
  const cached = countriesCache.get(language);
  if (cached) return cached;
  const collator = new Intl.Collator([language, 'en'], { sensitivity: 'base' });
  const list = [...countryCodes()]
    .map((code) => ({
      code,
      name: countryName(code, language),
      regions: Object.keys(states(code, 'en'))
        .map((region) => ({ code: region, name: regionName(code, region, language) }))
        .sort((a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code)),
    }))
    .sort((a, b) => collator.compare(a.name, b.name) || a.code.localeCompare(b.code));
  countriesCache.set(language, list);
  return list;
}

function isoDay(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Every public holiday day of `year`, as YYYY-MM-DD -> names. A holiday's
 * length in days counts from the local start of its first day, so one that
 * starts at noon still ends on that day and a clock change does not add a day.
 * Whole days are the unit: a first day that starts at 18:00 or later removes
 * no working hour and is left out (Christmas Eve from 19:00 in AU-NT); one
 * that starts earlier counts as a whole day (Labour Day from 12:00 in CH-VS).
 * Only the first day has a start time; the days after it are whole.
 */
function publicHolidayDays(hd: HolidaysLibrary, year: number): Map<string, string[]> {
  const days = new Map<string, string[]>();
  for (const holiday of [...hd.getHolidays(year - 1), ...hd.getHolidays(year)]) {
    if (holiday.type !== 'public') continue;
    const match = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}):(\d{2}):(\d{2}))?/.exec(String(holiday.date ?? ''));
    if (!match) continue;
    const first = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    const sinceMidnight = ((Number(match[4] ?? 0) * 60 + Number(match[5] ?? 0)) * 60 + Number(match[6] ?? 0)) * 1000;
    const duration = new Date(holiday.end).getTime() - new Date(holiday.start).getTime();
    const length = Number.isFinite(duration) ? Math.max(1, Math.round((sinceMidnight + duration) / DAY_MS)) : 1;
    const eveningStart = Number(match[4] ?? 0) >= EVENING_HOUR;
    for (let offset = eveningStart ? 1 : 0; offset < length; offset += 1) {
      const time = first + offset * DAY_MS;
      if (new Date(time).getUTCFullYear() !== year) continue;
      const day = isoDay(time);
      const names = days.get(day) ?? [];
      if (!names.includes(holiday.name)) names.push(holiday.name);
      days.set(day, names);
    }
  }
  return days;
}

const generatedCache = new Map<string, GeneratedYear>();

function copy(year: GeneratedYear): GeneratedYear {
  return { days: [...year.days], holidays: year.holidays.map((holiday) => ({ ...holiday })) };
}

/**
 * The standard working days of `year` for a country (and region), and the
 * public holidays behind them, names in `lang`. Throws on a country or region
 * the package does not know, or a year outside 2000 to 2100: callers check
 * the source and the year first.
 */
export function generateWorkingDays(country: string, region: string | null, year: number, lang: string): GeneratedYear {
  const countryCode = canonicalCountry(country);
  if (!countryCode) throw new Error(`No public holiday rules for country ${String(country)}.`);
  const regionCode = region == null || region === '' ? null : canonicalRegion(countryCode, region);
  if (region != null && region !== '' && !regionCode) {
    throw new Error(`No public holiday rules for region ${String(region)} of ${countryCode}.`);
  }
  if (!Number.isInteger(year) || year < FIRST_YEAR || year > LAST_YEAR) {
    throw new Error(`Standard working days exist for the years ${FIRST_YEAR} to ${LAST_YEAR}.`);
  }
  const language = holidayLanguage(lang);
  const key = `${countryCode}|${regionCode ?? ''}|${year}|${language}`;
  const cached = generatedCache.get(key);
  if (cached) return copy(cached);

  const hd = regionCode
    ? new Holidays(countryCode, regionCode, { languages: [language] })
    : new Holidays(countryCode, { languages: [language] });
  const holidayDays = publicHolidayDays(hd, year);

  const days: string[] = [];
  for (let month = 0; month < 12; month += 1) {
    const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    let working = 0;
    for (let date = 1; date <= last; date += 1) {
      const time = Date.UTC(year, month, date);
      const weekday = new Date(time).getUTCDay();
      if (weekday === 0 || weekday === 6) continue;
      if (!holidayDays.has(isoDay(time))) working += 1;
    }
    days.push(String(working));
  }
  const holidays: HolidayDay[] = [...holidayDays.keys()].sort().flatMap((date) => {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    return holidayDays.get(date)!.map((name) => ({ date, name, weekend: weekday === 0 || weekday === 6 }));
  });

  const result: GeneratedYear = { days, holidays };
  if (generatedCache.size >= CACHE_LIMIT) {
    const oldest = generatedCache.keys().next().value;
    if (oldest !== undefined) generatedCache.delete(oldest);
  }
  generatedCache.set(key, result);
  return copy(result);
}
