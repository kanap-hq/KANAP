import { describe, expect, it } from 'vitest';
import { formatDecimal, formatPercentPoints, formatSharePercent } from './formatters';

const FR_GROUP = ' ';

describe('formatDecimal', () => {
  it('writes a decimal with the separators of the language', () => {
    expect(formatDecimal(12.5, 'fr')).toBe('12,5');
    expect(formatDecimal(332.5, 'fr')).toBe('332,5');
    expect(formatDecimal(1200.5, 'fr')).toBe(`1${FR_GROUP}200,5`);
    expect(formatDecimal(12.5, 'en')).toBe('12.5');
    expect(formatDecimal(1200.5, 'de')).toBe('1.200,5');
    expect(formatDecimal(1200.5, 'es')).toBe('1.200,5');
  });

  it('keeps a real zero and groups an integer', () => {
    expect(formatDecimal(0, 'fr')).toBe('0');
    expect(formatDecimal(1200, 'fr')).toBe(`1${FR_GROUP}200`);
  });
});

describe('formatPercentPoints', () => {
  it('formats a share already expressed in percent points', () => {
    const fr = new Intl.NumberFormat('fr', {
      style: 'percent',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(0.0495);
    expect(formatPercentPoints(4.95, 'fr', 2)).toBe(fr);
    expect(formatPercentPoints(4.95, 'fr', 2)).toContain('4,95');
    expect(formatPercentPoints(4.95, 'fr', 2)).toContain('%');
    expect(formatPercentPoints(100, 'fr', 2)).toBe(
      new Intl.NumberFormat('fr', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1),
    );
    expect(formatPercentPoints(4.95, 'en', 2)).toBe('4.95%');
    expect(formatPercentPoints(12.3, 'en', 1)).toBe('12.3%');
  });
});

describe('formatSharePercent', () => {
  it('leaves an empty cell blank and formats a present share', () => {
    expect(formatSharePercent(null, 'fr', 2)).toBe('');
    expect(formatSharePercent(undefined, 'en', 1)).toBe('');
    expect(formatSharePercent(4.95, 'en', 2)).toBe('4.95%');
    expect(formatSharePercent(12.3, 'fr', 1)).toContain('12,3');
  });
});
