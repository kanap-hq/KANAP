// The reader's time zone is fixed before the first formatter is built (the formatters are cached).
(globalThis as unknown as { process: { env: Record<string, string> } }).process.env.TZ = 'Europe/Paris';

import { describe, expect, it } from 'vitest';
import { formatShortDate, formatShortInstantDate } from './dateFormat';

describe('formatShortInstantDate', () => {
  it('shows the local day of an instant, the one the History tab shows', () => {
    // 00:46 on 24 November in Paris.
    expect(formatShortInstantDate('2026-11-23T23:46:56.750Z', 'fr', { year: 'always' })).toBe('24 nov. 2026');
    expect(formatShortInstantDate('2026-11-23T23:46:56.750Z', 'en', { year: 'always' })).toBe('24 Nov 2026');
    expect(formatShortInstantDate('2026-11-23T23:46:56.750Z', 'de', { year: 'always' })).toBe('24. Nov. 2026');
    expect(formatShortInstantDate(new Date('2026-11-23T23:46:56.750Z'), 'es', { year: 'always' })).toBe('24 nov 2026');
  });

  it('keeps the options of formatShortDate', () => {
    expect(formatShortInstantDate('2001-04-06T12:00:00Z', 'en', { year: 'never' })).toBe('6 Apr');
    expect(formatShortInstantDate(null, 'en', { empty: '-' })).toBe('-');
    expect(formatShortInstantDate('', 'en', { empty: '-' })).toBe('-');
    expect(formatShortInstantDate('not a date', 'en', { empty: '-' })).toBe('-');
  });

  it('leaves a calendar date on its day with formatShortDate', () => {
    expect(formatShortDate('2026-11-23', 'en', { year: 'always' })).toBe('23 Nov 2026');
    // A date-only value read as an instant would shift: that is why calendar fields keep formatShortDate.
    expect(formatShortDate('2026-11-23T23:46:56.750Z', 'en', { year: 'always' })).toBe('23 Nov 2026');
  });
});
