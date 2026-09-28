import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import {
  calendarDeleteBlock,
  calendarTabYears,
  calendarUsageLine,
  checkYear,
  daysInMonth,
  normalizeDays,
  roundDaysTotal,
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
});
