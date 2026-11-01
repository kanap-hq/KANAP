import { describe, expect, it } from 'vitest';
import { formatAmount, formatCompactAmount, formatDecimal, formatEuro, formatPercentPoints, formatSharePercent, formatThousandsAmount } from './formatters';

const FR_GROUP = ' ';

describe('formatAmount', () => {
  it('keeps a space between thousands when no language is given', () => {
    expect(formatAmount(18750)).toBe('18 750');
    expect(formatAmount(650000.4)).toBe('650 000');
    expect(formatAmount(-1400)).toBe('-1 400');
    expect(formatAmount(null)).toBe('0');
    expect(formatAmount(Number.NaN)).toBe('');
  });

  it('follows the language, and groups four digits too', () => {
    expect(formatAmount(650000, 'en')).toBe('650,000');
    expect(formatAmount(650000, 'de')).toBe('650.000');
    expect(formatAmount(650000, 'es')).toBe('650.000');
    expect(formatAmount(650000, 'fr')).toBe(`650${FR_GROUP}000`);
    expect(formatAmount(7486, 'es')).toBe('7.486');
    expect(formatAmount(7486, 'en')).toBe('7,486');
    expect(formatAmount(650000.6, 'en')).toBe('650,001');
    expect(formatAmount(1.5, 'fr')).toBe('2');
  });
});

describe('formatEuro', () => {
  it('writes euro amounts with the separators and currency placement of the language', () => {
    expect(formatEuro(0, 'fr')).toBe('0,00\u00a0EUR');
    expect(formatEuro(1.5, 'fr')).toBe('1,50\u00a0EUR');
    expect(formatEuro(1234.5, 'fr')).toBe('1\u202f234,50\u00a0EUR');
    expect(formatEuro(0.0012, 'fr', 4)).toBe('0,0012\u00a0EUR');
    expect(formatEuro(1.5, 'en')).toBe('EUR\u00a01.50');
    expect(formatEuro(1234.5, 'en')).toBe('EUR\u00a01,234.50');
    expect(formatEuro(1234.5, 'de')).toBe('1.234,50\u00a0EUR');
    expect(formatEuro(1234.5, 'es')).toBe('1.234,50\u00a0EUR');
    expect(formatEuro(Number.NaN, 'en')).toBe('EUR\u00a00.00');
  });
});

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

describe('formatThousandsAmount', () => {
  it('rounds to thousands and groups with the separators of the language', () => {
    expect(formatThousandsAmount(7_846_000, 'en')).toBe('7,846k');
    expect(formatThousandsAmount(7_846_000, 'fr')).toBe(`7${FR_GROUP}846\u00a0k`);
    expect(formatThousandsAmount(7_846_000, 'de')).toBe('7.846\u00a0k');
    expect(formatThousandsAmount(7_846_000, 'es')).toBe('7.846\u00a0k');
    expect(formatThousandsAmount(12_000, 'en')).toBe('12k');
    expect(formatThousandsAmount(12_000, 'fr')).toBe('12\u00a0k');
    expect(formatThousandsAmount(400, 'en')).toBe('0k');
    expect(formatThousandsAmount(-4_000, 'en')).toBe('-4k');
    expect(formatThousandsAmount(-400, 'fr')).toBe('0\u00a0k');
    expect(formatThousandsAmount(null, 'en')).toBe('0k');
    expect(formatThousandsAmount('nope', 'en')).toBe('\u2014');
  });
});

describe('formatCompactAmount', () => {
  it('follows the interface language, with a lowercase k', () => {
    expect(formatCompactAmount(340_100, 'en')).toBe('340.1k');
    expect(formatCompactAmount(340_100, 'fr')).toBe('340,1\u00a0k');
    expect(formatCompactAmount(340_100, 'de')).toBe('340,1\u00a0k');
    expect(formatCompactAmount(340_100, 'es')).toBe('340,1\u00a0k');
    expect(formatCompactAmount(2_000, 'en')).toBe('2k');
    expect(formatCompactAmount(2_000, 'fr')).toBe('2\u00a0k');
    expect(formatCompactAmount(300, 'en')).toBe('300');
    expect(formatCompactAmount(300, 'fr')).toBe('300');
    expect(formatCompactAmount(1_500_000, 'en')).toBe('1.5M');
    expect(formatCompactAmount(1_500_000, 'fr')).toBe('1,5\u00a0M');
    expect(formatCompactAmount(1_200_000_000, 'en')).toBe('1.2B');
    expect(formatCompactAmount(null, 'en')).toBe('0');
    expect(formatCompactAmount('nope', 'fr')).toBe('\u2014');
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
