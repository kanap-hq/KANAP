import { describe, expect, it } from 'vitest';
import type { ColumnState } from 'ag-grid-community';
import { mergeSavedColumnState, withoutColumnFilters } from './ServerDataGrid';

const col = (colId: string, hide = false): ColumnState => ({ colId, hide });
const ids = (state: ColumnState[]) => state.map((c) => c.colId);

describe('mergeSavedColumnState', () => {
  const defaults = [col('ref'), col('name'), col('yBudget'), col('yRevision', true), col('yForecast', true), col('yLanding'), col('created', true)];

  it('puts a column the saved layout does not know right after its predecessor in the default order', () => {
    const saved = [col('name'), col('ref'), col('yBudget'), col('yLanding'), col('created', false)];
    expect(ids(mergeSavedColumnState(saved, defaults))).toEqual(['name', 'ref', 'yBudget', 'yRevision', 'yForecast', 'yLanding', 'created']);
  });

  it('keeps the saved order and settings, and new columns keep their default visibility', () => {
    const saved = [col('yLanding', true), col('ref'), col('name'), col('yBudget'), col('created', false)];
    const merged = mergeSavedColumnState(saved, defaults);
    expect(ids(merged)).toEqual(['yLanding', 'ref', 'name', 'yBudget', 'yRevision', 'yForecast', 'created']);
    expect(merged.find((c) => c.colId === 'yLanding')?.hide).toBe(true);
    expect(merged.find((c) => c.colId === 'created')?.hide).toBe(false);
    expect(merged.find((c) => c.colId === 'yForecast')?.hide).toBe(true);
  });

  it('puts a new first column first and drops columns that no longer exist', () => {
    const saved = [col('name'), col('project_id'), col('yBudget'), col('yRevision'), col('yForecast'), col('yLanding'), col('created')];
    expect(ids(mergeSavedColumnState(saved, defaults))).toEqual(['ref', 'name', 'yBudget', 'yRevision', 'yForecast', 'yLanding', 'created']);
  });
});

describe('withoutColumnFilters', () => {
  const model = {
    name: { filterType: 'text', type: 'contains', filter: 'abc' },
    yForecast: { filterType: 'number', type: 'greaterThan', filter: 0 },
  };

  it('drops the given columns and keeps the others', () => {
    expect(withoutColumnFilters(model, ['name'])).toEqual({ yForecast: model.yForecast });
  });

  it('answers null when none of them had a filter, so nothing is written back', () => {
    expect(withoutColumnFilters(model, ['yLanding'])).toBeNull();
    expect(withoutColumnFilters(model, [])).toBeNull();
    expect(withoutColumnFilters({}, ['name'])).toBeNull();
    expect(withoutColumnFilters(null, ['name'])).toBeNull();
  });

  it('drops several columns at once, and the whole model gives an empty one', () => {
    expect(withoutColumnFilters(model, ['name', 'yForecast'])).toEqual({});
  });

  it('leaves the model it reads untouched', () => {
    withoutColumnFilters(model, ['name']);
    expect(Object.keys(model)).toEqual(['name', 'yForecast']);
  });

  it('keeps a filter whose value is null, which a model can carry', () => {
    expect(withoutColumnFilters({ name: null }, ['yForecast'])).toBeNull();
    expect(withoutColumnFilters({ name: null }, ['name'])).toEqual({});
  });
});
