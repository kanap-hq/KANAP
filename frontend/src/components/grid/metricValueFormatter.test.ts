import { afterEach, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { formatCount } from '../../i18n/formatters';
import { formatMetricValue, metricValueFormatter } from './metricValueFormatter';

const FR_GROUP = ' ';

describe('formatMetricValue', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('shows a dash for an absent metric and keeps a real zero', () => {
    expect(formatMetricValue(null, 'fr', 'count')).toBe('—');
    expect(formatMetricValue('', 'fr', 'decimal')).toBe('—');
    expect(formatMetricValue(undefined, 'en', 'count')).toBe('—');
    expect(formatMetricValue('nope', 'en', 'decimal')).toBe('—');
    expect(formatMetricValue(0, 'fr', 'count')).toBe('0');
    expect(formatMetricValue('0', 'en', 'decimal')).toBe('0');
  });

  it('formats a present metric in the user language', async () => {
    expect(formatMetricValue(12.5, 'fr', 'decimal')).toBe('12,5');
    expect(formatMetricValue(332.5, 'fr', 'decimal')).toBe('332,5');
    expect(formatMetricValue(1200, 'fr', 'count')).toBe(formatCount(1200, 'fr'));
    expect(formatMetricValue(1200, 'fr', 'count')).toBe(`1${FR_GROUP}200`);
    await i18n.changeLanguage('fr');
    expect(metricValueFormatter('decimal')({ value: 12.5 })).toBe('12,5');
    expect(metricValueFormatter('count')({ value: null })).toBe('—');
    expect(metricValueFormatter('count')({ value: 0 })).toBe('0');
  });
});
