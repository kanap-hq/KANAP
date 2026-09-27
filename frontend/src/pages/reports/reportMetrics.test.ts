import { describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { getMetricLabels, isMetricKey, metricKeys } from './reportMetrics';

describe('report metric labels', () => {
  it('uses the budget tab wording in English', () => {
    expect(getMetricLabels(i18n.getFixedT('en', 'ops'))).toEqual({
      budget: 'Budget',
      follow_up: 'Actuals',
      landing: 'Expected landing',
      revision: 'Revision',
      forecast: 'Forecast',
    });
  });

  it('uses the budget tab wording in French', () => {
    expect(getMetricLabels(i18n.getFixedT('fr', 'ops'))).toEqual({
      budget: 'Budget',
      follow_up: 'Réalisé',
      landing: 'Atterrissage prévu',
      revision: 'Révision',
      forecast: 'Prévision',
    });
  });

  it('resolves the labels from another namespace too', () => {
    expect(getMetricLabels(i18n.getFixedT('de', 'common')).landing).toBe('Erwarteter Endwert');
  });

  it('recognises the budget columns that have a label, Forecast included', () => {
    expect(isMetricKey('follow_up')).toBe(true);
    expect(isMetricKey('forecast')).toBe(true);
    expect(isMetricKey('currency')).toBe(false);
    expect(isMetricKey('toString')).toBe(false);
  });

  it('keeps Forecast out of the report pickers', () => {
    expect(metricKeys).not.toContain('forecast');
  });
});
