import { describe, expect, it } from 'vitest';
import type { ColumnState } from 'ag-grid-community';
import { columnMinWidth, floorSavedColumnWidths, gridRowSelection, mergeSavedColumnState, withoutColumnFilters } from './ServerDataGrid';

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

describe('columnMinWidth', () => {
  it('gives a flex column a readable floor and keeps an explicit minimum', () => {
    expect(columnMinWidth({ flex: 1 })).toBe(160);
    expect(columnMinWidth({ flex: 1, minWidth: 220 })).toBe(220);
    expect(columnMinWidth({ width: 120 })).toBeUndefined();
  });
});

describe('floorSavedColumnWidths', () => {
  it('lifts a stored width that is below the column minimum and leaves the rest', () => {
    const mins = new Map([['name', 160]]);
    const state = floorSavedColumnWidths(
      [
        { colId: 'name', width: 36 },
        { colId: 'city', width: 80 },
        { colId: 'notes', width: 200 },
        { colId: 'name2', width: null },
      ],
      mins,
    );
    expect(state.find((col) => col.colId === 'name')?.width).toBe(160);
    expect(state.find((col) => col.colId === 'city')?.width).toBe(80);
    expect(state.find((col) => col.colId === 'notes')?.width).toBe(200);
    expect(state.find((col) => col.colId === 'name2')?.width).toBeNull();
  });
});

describe('gridRowSelection', () => {
  it('keeps row checkboxes and skips the header checkbox the infinite model rejects', () => {
    expect(gridRowSelection(true)).toEqual({
      mode: 'multiRow',
      checkboxes: true,
      headerCheckbox: false,
      enableClickSelection: false,
    });
    expect(gridRowSelection(false)).toEqual({
      mode: 'singleRow',
      checkboxes: false,
      enableClickSelection: false,
    });
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
