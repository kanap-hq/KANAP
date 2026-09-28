import { describe, expect, it } from 'vitest';
import { formatShortDate } from './dateFormat';

describe('formatShortDate', () => {
  const thisYear = new Date().getFullYear();

  it('omits the current year and shows another one by default', () => {
    expect(formatShortDate(`${thisYear}-03-15`, 'en')).toBe('15 Mar');
    expect(formatShortDate('2001-11-30', 'en')).toBe('30 Nov 2001');
  });

  it('always shows the year when asked', () => {
    expect(formatShortDate(`${thisYear}-03-15`, 'en', { year: 'always' })).toBe(`15 Mar ${thisYear}`);
  });

  it('never shows the year when the screen already does', () => {
    expect(formatShortDate('2001-04-06', 'en', { year: 'never' })).toBe('6 Apr');
    expect(formatShortDate('2001-12-25', 'de', { year: 'never' })).toMatch(/^25\.? Dez/);
  });

  it('gives the empty text for a missing or unreadable date', () => {
    expect(formatShortDate(null, 'en', { empty: 'Not set' })).toBe('Not set');
    expect(formatShortDate('not a date', 'en', { year: 'never', empty: 'not a date' })).toBe('not a date');
  });
});
