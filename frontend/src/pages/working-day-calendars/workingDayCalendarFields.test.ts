import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  calendarDeleteBlock,
  calendarSourceLabel,
  calendarTabYears,
  calendarUsageLine,
  calendarYearsText,
  checkYear,
  daysInMonth,
  holidayRunDates,
  holidayRuns,
  joinNames,
  normalizeDays,
  refusalField,
  roundDaysTotal,
  standardCalendarCode,
  standardTabYears,
  sumDays,
} from './workingDayCalendarFields';

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})` : key) as unknown as TFunction;

describe('working-day calendar fields', () => {
  it('knows the days of each month, leap Februaries included', () => {
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2100, 2)).toBe(28);
    expect(daysInMonth(2027, 3)).toBe(31);
    expect(daysInMonth(2027, 4)).toBe(30);
  });

  it('writes days in the stored form', () => {
    expect(normalizeDays('18.500')).toBe('18.5');
    expect(normalizeDays('20.0')).toBe('20');
    expect(normalizeDays(' 7 ')).toBe('7');
    expect(normalizeDays('19.083333')).toBe('19.083333');
  });

  it('adds days exactly, blanks as zero', () => {
    expect(sumDays(['18', '18', '20', '20', '15', '20', '15', '16', '20', '19', '18', '19'])).toBe('218');
    expect(sumDays(Array.from({ length: 12 }, () => '19.083333'))).toBe('228.999996');
    expect(sumDays(['0.1', '0.2', '', null])).toBe('0.3');
  });

  it('shows a yearly total with at most 2 decimals, rounded half away from zero', () => {
    expect(roundDaysTotal('218')).toBe('218');
    expect(roundDaysTotal('218.5')).toBe('218.5');
    expect(roundDaysTotal('229.083333')).toBe('229.08');
    expect(roundDaysTotal('228.999996')).toBe('229');
    expect(roundDaysTotal('16.755')).toBe('16.76');
    expect(roundDaysTotal('16.704999')).toBe('16.7');
  });

  it('checks a year like the server does', () => {
    const full = Array.from({ length: 12 }, () => '20');
    expect(checkYear(2027, full)).toEqual({ problems: Array(12).fill(null), complete: true, empty: false });
    const tooMany = [...full];
    tooMany[1] = '28.5';
    expect(checkYear(2027, tooMany).problems[1]).toEqual({ kind: 'tooMany', max: 28 });
    expect(checkYear(2028, tooMany).problems[1]).toBeNull();
    const negative = [...full];
    negative[0] = '-1';
    expect(checkYear(2027, negative).problems[0]).toEqual({ kind: 'negative' });
    const precise = [...full];
    precise[0] = '1.1234567';
    expect(checkYear(2027, precise).problems[0]).toEqual({ kind: 'decimals' });
    const partial = [...full];
    partial[11] = '';
    expect(checkYear(2027, partial)).toMatchObject({ complete: false, empty: false });
    expect(checkYear(2027, Array(12).fill(''))).toMatchObject({ complete: false, empty: true });
  });

  it('offers the stored years, the current ones and one free year on either side', () => {
    expect(calendarTabYears({}, 2026)).toEqual([2025, 2026, 2027, 2028]);
    expect(calendarTabYears({ '2026': [], '2030': [] }, 2026)).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031]);
    expect(calendarTabYears({ '2020': [] }, 2026)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028]);
    expect(calendarTabYears({ '2100': [] }, 2099)).toEqual([2098, 2099, 2100]);
  });

  it('says which lines use the calendar, and why Delete is off', () => {
    expect(calendarUsageLine(t, 0, 0)).toBeNull();
    expect(calendarUsageLine(t, 3, 0)).toBe('workingDayCalendars.usage.one(lines=workingDayCalendars.usage.opex(count=3))');
    expect(calendarUsageLine(t, 3, 1)).toBe(
      'workingDayCalendars.usage.both(opex=workingDayCalendars.usage.opex(count=3),capex=workingDayCalendars.usage.capex(count=1))',
    );
    expect(calendarDeleteBlock(t, null)).toBeNull();
    expect(calendarDeleteBlock(t, 'Used by 1 CAPEX line.')).toBe('workingDayCalendars.deleteBlocked(usage=Used by 1 CAPEX line.)');
  });

  it('names the source of a standard calendar, region in parentheses', () => {
    const moselle = { country_iso: 'FR', region_code: '57', country_name: 'France', region_name: 'Moselle' };
    expect(calendarSourceLabel(moselle)).toBe('France (Moselle)');
    expect(calendarSourceLabel({ ...moselle, region_code: null, region_name: null })).toBe('France');
    // A name the server did not send falls back to the code.
    expect(calendarSourceLabel({ country_iso: 'FR', region_code: '57', country_name: null, region_name: null })).toBe('FR (57)');
    expect(calendarSourceLabel({ country_iso: null, region_code: null, country_name: null, region_name: null })).toBeNull();
  });

  it('gives a standard calendar its default code', () => {
    expect(standardCalendarCode('FR', null)).toBe('FR');
    expect(standardCalendarCode('FR', '57')).toBe('FR-57');
  });

  it('says "All years" for a standard calendar and lists the years of a custom one', () => {
    expect(calendarYearsText(t, { country_iso: 'FR' }, [])).toBe('workingDayCalendars.yearsAll');
    expect(calendarYearsText(t, { country_iso: 'FR' }, ['2026', '2027'])).toBe('workingDayCalendars.yearsAllEdited(years=2026, 2027)');
    expect(calendarYearsText(t, { country_iso: null }, ['2026', '2027'])).toBe('2026, 2027');
    expect(calendarYearsText(t, undefined, ['2026'])).toBe('2026');
    expect(calendarYearsText(t, { country_iso: null }, [])).toBe('');
  });

  it('offers every year the server accepts on a standard calendar', () => {
    const years = standardTabYears();
    expect(years[0]).toBe(2000);
    expect(years[years.length - 1]).toBe(2100);
    expect(years).toHaveLength(101);
  });

  it('groups the consecutive days of one holiday, marked weekend only when every day is', () => {
    // Bosnia and Herzegovina 2026: Kurban Bayram from Saturday 16 to Tuesday 19 May.
    const runs = holidayRuns([
      { date: '2026-05-01', name: 'Labour Day', weekend: false },
      { date: '2026-05-02', name: 'Labour Day', weekend: true },
      { date: '2026-05-16', name: 'Kurbanski bajram', weekend: true },
      { date: '2026-05-17', name: 'Kurbanski bajram', weekend: true },
      { date: '2026-05-18', name: 'Kurbanski bajram', weekend: false },
      { date: '2026-05-19', name: 'Kurbanski bajram', weekend: false },
      { date: '2026-05-21', name: 'Kurbanski bajram', weekend: false },
      { date: '2026-12-31', name: 'Old Year', weekend: false },
      { date: '2027-01-01', name: 'Old Year', weekend: false },
    ]);
    expect(runs).toEqual([
      { start: '2026-05-01', end: '2026-05-02', name: 'Labour Day', weekend: false },
      { start: '2026-05-16', end: '2026-05-19', name: 'Kurbanski bajram', weekend: false },
      // Not the day after: a separate entry.
      { start: '2026-05-21', end: '2026-05-21', name: 'Kurbanski bajram', weekend: false },
      { start: '2026-12-31', end: '2027-01-01', name: 'Old Year', weekend: false },
    ]);
    expect(holidayRuns([
      { date: '2026-08-15', name: 'Assumption', weekend: true },
      { date: '2026-08-16', name: 'Other', weekend: true },
    ])).toEqual([
      { start: '2026-08-15', end: '2026-08-15', name: 'Assumption', weekend: true },
      { start: '2026-08-16', end: '2026-08-16', name: 'Other', weekend: true },
    ]);
  });

  it('writes the dates of a holiday day first, in the UI language, without the year', () => {
    const run = (start: string, end: string) => ({ start, end, name: 'x', weekend: false });
    expect(holidayRunDates(t, run('2026-04-06', '2026-04-06'), 'en')).toBe('6 Apr');
    expect(holidayRunDates(t, run('2026-12-25', '2026-12-25'), 'de')).toMatch(/^25\.? Dez/);
    expect(holidayRunDates(t, run('2026-05-16', '2026-05-19'), 'en')).toBe('workingDayCalendars.days.holidayRange(from=16,to=19 May)');
    expect(holidayRunDates(t, run('2026-04-30', '2026-05-02'), 'en')).toBe('workingDayCalendars.days.holidayRange(from=30 Apr,to=2 May)');
    expect(holidayRunDates(t, run('not a date', 'not a date'), 'en')).toBe('not a date');
  });

  it('joins country names the way the language does', () => {
    expect(joinNames(['France', 'Netherlands', 'Italy'], 'en')).toBe('France, Netherlands, and Italy');
    expect(joinNames(['France', 'Italie'], 'fr')).toBe('France et Italie');
    expect(joinNames(['France'], 'en')).toBe('France');
  });

  it('puts a refused country or region under the field that names it', () => {
    expect(refusalField({ response: { data: { field: 'country_iso' } } })).toBe('country_iso');
    expect(refusalField({ response: { data: { field: 'region_code' } } })).toBe('region_code');
  });
});
