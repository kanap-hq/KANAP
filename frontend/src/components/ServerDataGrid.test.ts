import { describe, expect, it } from 'vitest';
import type { ColumnState } from 'ag-grid-community';
import { mergeSavedColumnState } from './ServerDataGrid';

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
