import { describe, expect, it } from 'vitest';
import { createTheme } from '@mui/material/styles';
import { addMonthsYmd, formatSupportDate, supportStateColor, supportStateNeedsAttention, supportStateOf } from './supportState';

const TODAY = '2026-10-17';

describe('supportStateOf', () => {
  it('is unknown without any end date', () => {
    expect(supportStateOf(null, null, TODAY)).toBe('unknown');
    expect(supportStateOf('', undefined, TODAY)).toBe('unknown');
  });

  it('is ended when every end is past, the end date itself still supported', () => {
    expect(supportStateOf('2025-01-01', null, TODAY)).toBe('ended');
    expect(supportStateOf('2024-01-01', '2026-10-16', TODAY)).toBe('ended');
    expect(supportStateOf('2026-10-17', null, TODAY)).toBe('ending_soon');
  });

  it('is extended between the standard end and the extended end', () => {
    expect(supportStateOf('2025-01-01', '2030-01-01', TODAY)).toBe('extended');
    expect(supportStateOf('2025-01-01', '2026-11-01', TODAY)).toBe('extended');
  });

  it('is ending soon when the first end falls within the horizon', () => {
    expect(supportStateOf('2027-10-17', '2030-01-01', TODAY)).toBe('ending_soon');
    expect(supportStateOf('2027-10-18', null, TODAY)).toBe('supported');
    expect(supportStateOf('2027-03-01', null, TODAY, 3)).toBe('supported');
    expect(supportStateOf(null, '2027-01-01', TODAY)).toBe('ending_soon');
  });

  it('accepts a Date and ISO date-times', () => {
    expect(supportStateOf('2030-01-01T00:00:00.000Z', null, new Date(2026, 9, 17))).toBe('supported');
  });
});

describe('addMonthsYmd', () => {
  it('clamps the day to the end of the month', () => {
    expect(addMonthsYmd('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsYmd('2026-10-17', 12)).toBe('2027-10-17');
  });
});

describe('supportStateColor', () => {
  const palette = (mode: 'light' | 'dark') => createTheme({
    palette: {
      mode,
      kanap: { danger: `danger-${mode}`, orange: `orange-${mode}`, text: { secondary: `grey-${mode}` } },
    } as never,
  });

  it('colours attention only: red when ended, orange when extended or ending soon', () => {
    for (const mode of ['light', 'dark'] as const) {
      const theme = palette(mode);
      expect(supportStateColor('ended', theme)).toBe(`danger-${mode}`);
      expect(supportStateColor('extended', theme)).toBe(`orange-${mode}`);
      expect(supportStateColor('ending_soon', theme)).toBe(`orange-${mode}`);
      expect(supportStateColor('supported', theme)).toBe(`grey-${mode}`);
      expect(supportStateColor('unknown', theme)).toBe(`grey-${mode}`);
    }
    expect(supportStateNeedsAttention('supported')).toBe(false);
    expect(supportStateNeedsAttention('ending_soon')).toBe(true);
  });
});

describe('formatSupportDate', () => {
  it('always shows the year, in the current year too', () => {
    const thisYear = new Date().getFullYear();
    expect(formatSupportDate(`${thisYear}-11-12`, 'en')).toBe(`12 Nov ${thisYear}`);
    expect(formatSupportDate(`${thisYear}-11-12`, 'fr')).toBe(`12 nov. ${thisYear}`);
    expect(formatSupportDate('2029-11-08', 'en')).toBe('8 Nov 2029');
    expect(formatSupportDate(null, 'en', '—')).toBe('—');
  });
});
