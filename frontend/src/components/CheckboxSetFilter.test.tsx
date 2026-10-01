import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import CheckboxSetFilter, { OPTION_ROW_HEIGHT, OPTION_WINDOW, SEARCH_APPLY_DELAY_MS } from './CheckboxSetFilter';

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
function renderFilter(initial?: Model, extra: Record<string, unknown> = { values: OPTIONS }) {
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
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <CheckboxSetFilter
        ref={filterRef}
        {...({ api, column, colDef: { field: COL }, ...extra } as any)}
      />
    </QueryClientProvider>,
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
    advance();
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

describe('CheckboxSetFilter clicks apply to the grid after a quiet delay', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows each click at once and applies a run of clicks with one call', () => {
    const { api, applied } = renderFilter();
    fireEvent.click(screen.getByRole('checkbox', { name: 'HR' }));
    expect(screen.getByRole('checkbox', { name: 'HR' })).not.toBeChecked();
    act(() => {
      vi.advanceTimersByTime(SEARCH_APPLY_DELAY_MS - 1);
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'B2C-RETAIL' }));
    expect(screen.getByRole('checkbox', { name: 'B2C-RETAIL' })).not.toBeChecked();
    act(() => {
      vi.advanceTimersByTime(SEARCH_APPLY_DELAY_MS - 1);
    });
    expect(api.setFilterModel).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(sorted(applied())).toEqual(['B2B-OPS', 'B2B-SALES']);
  });

  it('starts a search from the clicks not applied yet', () => {
    const { api, applied } = renderFilter();
    fireEvent.click(screen.getByRole('checkbox', { name: 'B2B-OPS' }));
    typeSearch('B2B');
    advance();
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(sorted(applied())).toEqual(['B2B-SALES']);
  });

  it('Clear, then a tick on one value: one call, with that value', () => {
    const { api, applied } = renderFilter();
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    for (const { value } of OPTIONS) expect(screen.getByRole('checkbox', { name: value })).not.toBeChecked();
    expect(api.setFilterModel).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'HR' }));
    advance();
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(applied()).toEqual({ filterType: 'set', values: ['HR'] });
  });

  it('All, then an untick: one call, without that value', () => {
    const { api, applied } = renderFilter({ filterType: 'set', values: ['HR'] });
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'B2B-OPS' }));
    advance();
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(sorted(applied())).toEqual(['B2B-SALES', 'B2C-RETAIL', 'HR']);
  });

  it('All alone clears the column filter after the quiet delay', () => {
    const { api, applied } = renderFilter({ filterType: 'set', values: ['HR'] });
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    expect(api.setFilterModel).not.toHaveBeenCalled();
    advance();
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(applied()).toBeUndefined();
  });

  it('drops clicks not applied yet when the model is set from outside', () => {
    const { filterRef, api } = renderFilter();
    fireEvent.click(screen.getByRole('checkbox', { name: 'HR' }));
    act(() => {
      filterRef.current.setModel({ filterType: 'set', values: ['HR'] });
    });
    advance();
    expect(api.setFilterModel).not.toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'HR' })).toBeChecked();
  });
});

describe('CheckboxSetFilter values', () => {
  const many = (count: number) => Array.from({ length: count }, (_, i) => ({ value: `Supplier ${String(i).padStart(4, '0')}` }));

  it('loads nothing when the grid creates it, and once when it opens', async () => {
    const getValues = vi.fn(async () => OPTIONS);
    const { filterRef } = renderFilter(undefined, { getValues, searchable: false, context: { getQueryState: () => ({ endpoint: '/things', filters: {} }) } });
    await act(async () => { await Promise.resolve(); });
    expect(getValues).not.toHaveBeenCalled();
    act(() => { filterRef.current.afterGuiAttached(); });
    expect(await screen.findByRole('checkbox', { name: 'HR' })).toBeInTheDocument();
    expect(getValues).toHaveBeenCalledTimes(1);
    // Closed and opened again on the same list state: the values are still fresh.
    act(() => { filterRef.current.afterGuiDetached(); });
    act(() => { filterRef.current.afterGuiAttached(); });
    await act(async () => { await Promise.resolve(); });
    expect(getValues).toHaveBeenCalledTimes(1);
  });

  it('asks again when the rest of the list changed, not for its own filter', async () => {
    const getValues = vi.fn(async () => OPTIONS);
    let state: Record<string, unknown> = { endpoint: '/things', filters: {} };
    const { filterRef } = renderFilter(undefined, { getValues, context: { getQueryState: () => state } });
    act(() => { filterRef.current.afterGuiAttached(); });
    await screen.findByRole('checkbox', { name: 'HR' });
    act(() => { filterRef.current.afterGuiDetached(); });

    state = { endpoint: '/things', filters: { [COL]: { filterType: 'set', values: ['HR'] } } };
    act(() => { filterRef.current.afterGuiAttached(); });
    await act(async () => { await Promise.resolve(); });
    expect(getValues).toHaveBeenCalledTimes(1);
    act(() => { filterRef.current.afterGuiDetached(); });

    state = { endpoint: '/things', q: 'cloud', filters: { [COL]: { filterType: 'set', values: ['HR'] } } };
    act(() => { filterRef.current.afterGuiAttached(); });
    await waitForCalls(getValues, 2);
    // The previous values stay shown while the new ones load.
    expect(screen.getByRole('checkbox', { name: 'HR' })).toBeInTheDocument();
  });

  it('asks again after a refresh of the list (a delete, an import)', async () => {
    const getValues = vi.fn(async () => OPTIONS);
    let state: Record<string, unknown> = { endpoint: '/things', filters: {}, refreshKey: 0 };
    const { filterRef } = renderFilter(undefined, { getValues, context: { getQueryState: () => state } });
    act(() => { filterRef.current.afterGuiAttached(); });
    await screen.findByRole('checkbox', { name: 'HR' });
    act(() => { filterRef.current.afterGuiDetached(); });
    state = { ...state, refreshKey: 1 };
    act(() => { filterRef.current.afterGuiAttached(); });
    await waitForCalls(getValues, 2);
  });

  it('shows a refused values request at once, without retrying', async () => {
    const getValues = vi.fn(async () => { throw new Error('431'); });
    const queryClient = new QueryClient();
    const filterRef = React.createRef<any>();
    render(
      <QueryClientProvider client={queryClient}>
        <CheckboxSetFilter
          ref={filterRef}
          {...({ api: { getFilterModel: () => ({}), setFilterModel: vi.fn() }, column: { getColId: () => COL }, colDef: { field: COL }, getValues, context: { getQueryState: () => ({}) } } as any)}
        />
      </QueryClientProvider>,
    );
    act(() => { filterRef.current.afterGuiAttached(); });
    await waitForCalls(getValues, 1);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(getValues).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/loading/i)).not.toBeInTheDocument();
  });

  it(`draws at most ${OPTION_WINDOW} rows of 1,500 values, and the rows near the scroll position`, () => {
    renderFilter(undefined, { values: many(1500), searchable: false });
    expect(screen.getAllByRole('checkbox')).toHaveLength(OPTION_WINDOW);
    expect(screen.getByRole('checkbox', { name: 'Supplier 0000' })).toBeInTheDocument();
    const list = screen.getByTestId('set-filter-options');
    fireEvent.scroll(list, { target: { scrollTop: 30 * 1000 } });
    expect(screen.getAllByRole('checkbox').length).toBeLessThanOrEqual(OPTION_WINDOW);
    expect(screen.getByRole('checkbox', { name: 'Supplier 1000' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Supplier 0000' })).not.toBeInTheDocument();
  });

  it('keeps its width while a search narrows the list', () => {
    const { container } = render(
      <QueryClientProvider client={new QueryClient()}>
        <CheckboxSetFilter {...({ api: { getFilterModel: () => ({}), setFilterModel: vi.fn() }, column: { getColId: () => COL }, colDef: { field: COL }, values: many(100) } as any)} />
      </QueryClientProvider>,
    );
    const root = container.firstElementChild as HTMLElement;
    const width = getComputedStyle(root).width;
    expect(width).toBe('300px');
    typeSearch('Supplier 0001');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(getComputedStyle(root).width).toBe(width);
  });

  it('tells screen readers how many values the list holds and where each drawn row sits', () => {
    renderFilter(undefined, { values: many(1500), searchable: false });
    const list = screen.getByRole('list', { name: '1,500 values' });
    const items = screen.getAllByRole('listitem');
    expect(list).toContainElement(items[0]);
    expect(items[0]).toHaveAttribute('aria-setsize', '1500');
    expect(items[0]).toHaveAttribute('aria-posinset', '1');
  });

  it(`Tab and Shift+Tab go on past the ${OPTION_WINDOW} drawn rows`, () => {
    renderFilter(undefined, { values: many(1500), searchable: false });
    // On the first value, Shift+Tab leaves the list as usual.
    const first = screen.getByRole('checkbox', { name: 'Supplier 0000' });
    first.focus();
    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(true);
    const last = screen.getByRole('checkbox', { name: `Supplier ${String(OPTION_WINDOW - 1).padStart(4, '0')}` });
    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    const next = screen.getByRole('checkbox', { name: `Supplier ${String(OPTION_WINDOW).padStart(4, '0')}` });
    expect(next).toHaveFocus();
    expect(next.closest('[role="listitem"]')).toHaveAttribute('aria-posinset', String(OPTION_WINDOW + 1));
    expect(next.closest('[role="listitem"]')).toHaveStyle({ top: `${OPTION_WINDOW * OPTION_ROW_HEIGHT}px` });
    fireEvent.keyDown(next, { key: 'Tab', shiftKey: true });
    expect(screen.getByRole('checkbox', { name: `Supplier ${String(OPTION_WINDOW - 1).padStart(4, '0')}` })).toHaveFocus();
  });

  it('shows the search box from 20 values on a column that does not ask for it', () => {
    renderFilter(undefined, { values: many(19), searchable: false });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('shows the search box with 20 values', () => {
    renderFilter(undefined, { values: many(20), searchable: false });
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });
});

describe('CheckboxSetFilter in AG Grid reactive mode (model as a prop)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // AG Grid 32 hands the column's model back as the `model` prop after every setFilterModel, and
  // leaves it out (undefined) when the column has no filter.
  function renderReactive() {
    let model: Record<string, any> = {};
    const queryClient = new QueryClient();
    const column = { getColId: () => COL };
    const api: any = {
      getFilterModel: vi.fn(() => model),
      setFilterModel: vi.fn((next: Record<string, any>) => {
        model = next;
        rerender();
      }),
    };
    const ui = () => (
      <QueryClientProvider client={queryClient}>
        <CheckboxSetFilter {...({ api, column, colDef: { field: COL }, values: OPTIONS, model: model[COL], onModelChange: vi.fn() } as any)} />
      </QueryClientProvider>
    );
    const view = render(ui());
    function rerender() { view.rerender(ui()); }
    return { api, setFromOutside: (next: Record<string, any>) => { model = next; act(() => rerender()); }, applied: () => model[COL] as Model };
  }

  it('keeps its search when the grid hands back its own model', () => {
    const { applied } = renderReactive();
    typeSearch('B2B');
    advance();
    expect(sorted(applied())).toEqual(['B2B-OPS', 'B2B-SALES']);
    expect(screen.getByRole('textbox')).toHaveValue('B2B');
  });

  it('follows a model set from outside: search ended, clicks dropped, boxes from the model', () => {
    const { api, setFromOutside } = renderReactive();
    typeSearch('B2B');
    advance();
    fireEvent.click(screen.getByRole('checkbox', { name: 'B2B-OPS' }));
    api.setFilterModel.mockClear();
    setFromOutside({});
    advance();
    expect(api.setFilterModel).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('');
    for (const { value } of OPTIONS) expect(screen.getByRole('checkbox', { name: value })).toBeChecked();
  });

  it('ticks every box again when the column cross removes its model, and the next click starts from all values', () => {
    const { setFromOutside, applied } = renderReactive();
    fireEvent.click(screen.getByRole('checkbox', { name: 'HR' }));
    advance();
    expect(sorted(applied())).toEqual(['B2B-OPS', 'B2B-SALES', 'B2C-RETAIL']);
    // The floating filter's cross: the column's model is removed, the prop is undefined.
    setFromOutside({});
    for (const { value } of OPTIONS) expect(screen.getByRole('checkbox', { name: value })).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: 'B2C-RETAIL' }));
    advance();
    expect(sorted(applied())).toEqual(['B2B-OPS', 'B2B-SALES', 'HR']);
  });
});

async function waitForCalls(fn: ReturnType<typeof vi.fn>, count: number) {
  for (let i = 0; i < 50 && fn.mock.calls.length < count; i += 1) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  }
  expect(fn).toHaveBeenCalledTimes(count);
}
