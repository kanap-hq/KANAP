import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import CheckboxSetFilter, { SEARCH_APPLY_DELAY_MS } from './CheckboxSetFilter';

const COL = 'cost_center';
const OPTIONS = [
  { value: 'B2B-SALES' },
  { value: 'B2B-OPS' },
  { value: 'B2C-RETAIL' },
  { value: 'HR' },
];

type Model = { filterType: 'set'; values: Array<string | null> } | undefined;

// A minimal grid API that behaves like AG Grid: setFilterModel stores the model and calls
// setModel back on the filter instance (the echo of the filter's own update).
function renderFilter(initial?: Model) {
  const filterRef = React.createRef<any>();
  let model: Record<string, any> = initial ? { [COL]: initial } : {};
  const api = {
    getFilterModel: vi.fn(() => model),
    setFilterModel: vi.fn((next: Record<string, any>) => {
      model = next;
      filterRef.current?.setModel(next[COL] ?? null);
    }),
  };
  const column = { getColId: () => COL };
  render(
    <CheckboxSetFilter
      ref={filterRef}
      {...({ api, column, colDef: { field: COL } } as any)}
      values={OPTIONS}
    />,
  );
  const applied = (): Model => model[COL];
  return { api, filterRef, applied };
}

function typeSearch(value: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value } });
}

function advance() {
  act(() => {
    vi.advanceTimersByTime(SEARCH_APPLY_DELAY_MS);
  });
}

function sorted(model: Model) {
  return model ? [...model.values].sort() : model;
}

describe('CheckboxSetFilter search applies to the grid', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies the matching values after the debounce, with one call', () => {
    const { api, applied } = renderFilter();
    typeSearch('B');
    typeSearch('B2');
    typeSearch('B2B');
    expect(api.setFilterModel).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SEARCH_APPLY_DELAY_MS - 1);
    });
    expect(api.setFilterModel).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(sorted(applied())).toEqual(['B2B-OPS', 'B2B-SALES']);
    expect(screen.getByRole('textbox')).toHaveValue('B2B');
  });

  it('widens again from the snapshot when the search is edited', () => {
    const { applied } = renderFilter();
    typeSearch('B2B');
    advance();
    expect(sorted(applied())).toEqual(['B2B-OPS', 'B2B-SALES']);
    typeSearch('B2');
    advance();
    expect(sorted(applied())).toEqual(['B2B-OPS', 'B2B-SALES', 'B2C-RETAIL']);
  });

  it('restores the previous selection when the search is cleared', () => {
    const { applied } = renderFilter({ filterType: 'set', values: ['B2B-SALES', 'HR'] });
    typeSearch('B2B');
    advance();
    expect(sorted(applied())).toEqual(['B2B-SALES']);
    typeSearch('');
    advance();
    expect(sorted(applied())).toEqual(['B2B-SALES', 'HR']);
  });

  it('restores an unfiltered column when the search is cleared', () => {
    const { applied } = renderFilter();
    typeSearch('HR');
    advance();
    expect(sorted(applied())).toEqual(['HR']);
    typeSearch('');
    advance();
    expect(applied()).toBeUndefined();
  });

  it('applies an explicit empty filter when nothing matches', () => {
    const { applied } = renderFilter();
    typeSearch('zzz');
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: [] });
  });

  it('intersects a prior partial selection instead of taking every match', () => {
    const { applied } = renderFilter({ filterType: 'set', values: ['B2B-SALES', 'HR'] });
    typeSearch('B2');
    advance();
    expect(sorted(applied())).toEqual(['B2B-SALES']);
  });

  it('keeps a toggle made under a search once the search is cleared', () => {
    const { applied } = renderFilter();
    typeSearch('B2B');
    advance();
    fireEvent.click(screen.getByRole('checkbox', { name: 'B2B-OPS' }));
    expect(sorted(applied())).toEqual(['B2B-SALES']);
    typeSearch('');
    advance();
    expect(sorted(applied())).toEqual(['B2B-SALES', 'B2C-RETAIL', 'HR']);
  });

  it('clears only the visible options under a search', () => {
    const { applied } = renderFilter();
    typeSearch('B2B');
    advance();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(applied()).toEqual({ filterType: 'set', values: [] });
    typeSearch('');
    advance();
    expect(sorted(applied())).toEqual(['B2C-RETAIL', 'HR']);
  });

  it('resets the search when the model is set from outside', () => {
    const { filterRef, api, applied } = renderFilter();
    typeSearch('B2B');
    advance();
    expect(screen.getByRole('textbox')).toHaveValue('B2B');
    act(() => {
      filterRef.current.setModel({ filterType: 'set', values: ['HR'] });
    });
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('checkbox', { name: 'HR' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'B2B-SALES' })).not.toBeChecked();
    // The next search starts from the restored selection, not from the old snapshot.
    api.setFilterModel.mockClear();
    typeSearch('B2');
    advance();
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(applied()).toEqual({ filterType: 'set', values: [] });
  });

  it('cancels a pending search when the model is set from outside', () => {
    const { filterRef, api } = renderFilter();
    typeSearch('B2B');
    act(() => {
      filterRef.current.setModel(null);
    });
    advance();
    expect(api.setFilterModel).not.toHaveBeenCalled();
  });
});
