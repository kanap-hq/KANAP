import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import i18n from '../../i18n';
import { resolveBudgetColumns } from '../../hooks/useBudgetColumns';
import { DEFAULT_BUDGET_COLUMNS, type BudgetColumnsSettings } from '../../services/budgetColumns';
import {
  isMetricKey,
  metricFileName,
  metricKeys,
  resolveMetric,
  resolveMetrics,
  shownMetricKeys,
} from './reportMetrics';

const en = i18n.getFixedT('en', 'ops') as unknown as TFunction;

function columnsFor(patch: Partial<BudgetColumnsSettings> = {}) {
  return resolveBudgetColumns({ ...DEFAULT_BUDGET_COLUMNS, ...patch }, en);
}

/** Every column shown and renamed, column 3 the default. */
const renamed = columnsFor({
  labels: { planned: 'A0', committed: 'A1', forecast: 'A2', actual: 'A3', expected_landing: 'Réel' },
  enabled: { planned: true, committed: true, forecast: true, actual: true, expected_landing: true },
  default_column: 'forecast',
});

describe('report metric keys', () => {
  it('lists the five columns in the fixed order', () => {
    expect(metricKeys).toEqual(['budget', 'revision', 'forecast', 'follow_up', 'landing']);
  });

  it('recognises the summary key of every column, Forecast included', () => {
    expect(isMetricKey('follow_up')).toBe(true);
    expect(isMetricKey('forecast')).toBe(true);
    expect(isMetricKey('planned')).toBe(false);
    expect(isMetricKey('currency')).toBe(false);
    expect(isMetricKey('toString')).toBe(false);
  });
});

describe('report pickers', () => {
  it('offer the shown columns in the fixed order: Forecast only when shown', () => {
    expect(shownMetricKeys(columnsFor())).toEqual(['budget', 'revision', 'follow_up', 'landing']);
    expect(shownMetricKeys(renamed)).toEqual(['budget', 'revision', 'forecast', 'follow_up', 'landing']);
  });

  it('preselect the default column and fall back to it for a hidden or unknown column', () => {
    expect(resolveMetric(columnsFor(), null)).toBe('budget');
    expect(resolveMetric(renamed, null)).toBe('forecast');
    expect(resolveMetric(renamed, 'landing')).toBe('landing');
    const onlyFirst = columnsFor({
      enabled: { planned: true, committed: false, forecast: false, actual: false, expected_landing: false },
    });
    expect(resolveMetric(onlyFirst, 'landing')).toBe('budget');
    expect(resolveMetric(onlyFirst, 'nonsense')).toBe('budget');
  });

  it('preselect the default column and the last shown one for the trend reports', () => {
    expect(resolveMetrics(columnsFor(), null)).toEqual(['budget', 'landing']);
    expect(resolveMetrics(renamed, null)).toEqual(['forecast', 'landing']);
    const lastIsDefault = columnsFor({ default_column: 'expected_landing' });
    expect(resolveMetrics(lastIsDefault, null)).toEqual(['landing']);
  });

  it('keep picked columns in the fixed order, drop hidden ones, and keep the default when emptied', () => {
    expect(resolveMetrics(renamed, ['landing', 'budget'])).toEqual(['budget', 'landing']);
    expect(resolveMetrics(columnsFor(), ['forecast', 'revision'])).toEqual(['revision']);
    expect(resolveMetrics(renamed, [])).toEqual(['forecast']);
  });
});

describe('column names in reports', () => {
  it('use the tenant names, else the product names', () => {
    expect(renamed.label('forecast')).toBe('A2');
    expect(columnsFor().label('follow_up')).toBe('Actuals');
  });

  it('make file-safe names from the column name, never the technical key', () => {
    expect(metricFileName(columnsFor(), 'landing')).toBe('expected-landing');
    expect(metricFileName(renamed, 'landing')).toBe('reel');
    expect(metricFileName(renamed, 'forecast')).toBe('a2');
    const symbols = columnsFor({ labels: { ...DEFAULT_BUDGET_COLUMNS.labels, committed: '***' } });
    expect(metricFileName(symbols, 'revision')).toBe('column-2');
  });
});

describe('top items wording', () => {
  it('names the column without a preposition, article or case that depends on it', () => {
    const lines = ['en', 'fr', 'de', 'es'].map((lng) => {
      const t = i18n.getFixedT(lng, 'ops');
      return [t('reports.topOpex.totalMetric', { metric: 'Réel' }), t('reports.topOpex.ofFilteredMetric', { pct: 40 })];
    });
    expect(lines).toEqual([
      ['Réel, total', '40% of the filtered total'],
      ['Réel, total', '40 % du total filtré'],
      ['Réel, gesamt', '40 % der gefilterten Summe'],
      ['Réel, total', '40 % del total filtrado'],
    ]);
  });
});
