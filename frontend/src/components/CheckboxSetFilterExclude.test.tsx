import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import CheckboxSetFilter, { SEARCH_APPLY_DELAY_MS } from './CheckboxSetFilter';
import CheckboxSetFloatingFilter from './CheckboxSetFloatingFilter';

// Exclude mode of the set filter (decision Q3, lot 2B PR B2): on a list whose endpoints honour it,
// "All" then untick stores the unticked values (`mode: 'exclude'`), so values added later show;
// "Clear" then tick stores the ticked values. A list without the opt-in never sends a mode.

const COL = 'supplier_name';
const OPTIONS = [{ value: 'Alpha' }, { value: 'Bravo' }, { value: 'Charlie' }, { value: null }];

type Model = { filterType: 'set'; mode?: 'include' | 'exclude'; values: Array<string | null> } | undefined;

/** AG Grid 32's reactive filter: the column's model comes back as the `model` prop after each setFilterModel. */
function renderFilter(opts: { exclude?: boolean; columnExclude?: boolean; initial?: Model; values?: Array<{ value: string | null }> } = {}) {
  let model: Record<string, any> = opts.initial ? { [COL]: opts.initial } : {};
  let values = opts.values ?? OPTIONS;
  const queryClient = new QueryClient();
  const column = { getColId: () => COL };
  const listeners = new Set<() => void>();
  const api: any = {
    getFilterModel: vi.fn(() => model),
    setFilterModel: vi.fn((next: Record<string, any>) => {
      model = next;
      rerender();
      listeners.forEach((listener) => listener());
    }),
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
  };
  const context = opts.exclude === undefined ? undefined : { setFilterExcludeMode: opts.exclude };
  const ui = () => (
    <QueryClientProvider client={queryClient}>
      <CheckboxSetFloatingFilter {...({ api, column, showParentFilter: vi.fn() } as any)} />
      <CheckboxSetFilter
        {...({
          api, column, colDef: { field: COL }, values, model: model[COL], onModelChange: vi.fn(), context,
          ...(opts.columnExclude !== undefined ? { excludeMode: opts.columnExclude } : {}),
        } as any)}
      />
    </QueryClientProvider>
  );
  const view = render(ui());
  function rerender() { view.rerender(ui()); }
  return {
    api,
    applied: () => model[COL] as Model,
    setFromOutside: (next: Record<string, any>) => { model = next; act(() => { rerender(); listeners.forEach((l) => l()); }); },
    setValues: (next: Array<{ value: string | null }>) => { values = next; act(() => rerender()); },
  };
}

const box = (name: string) => screen.getByRole('checkbox', { name });
const click = (name: string) => fireEvent.click(box(name));
const advance = () => act(() => { vi.advanceTimersByTime(SEARCH_APPLY_DELAY_MS); });
const hint = () => screen.queryByTestId('set-filter-mode-hint')?.textContent ?? null;
const label = () => screen.getAllByRole('button')[0].textContent;

describe('CheckboxSetFilter exclude mode', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('without the opt-in, "All" then untick sends the ticked values and no mode', () => {
    const { applied } = renderFilter();
    click('Bravo');
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: ['Alpha', 'Charlie', null] });
    expect(JSON.stringify(applied())).not.toContain('mode');
    expect(hint()).toBeNull();
    // Explicitly off (a list whose set code reads the ticked values only).
    const off = renderFilter({ exclude: false });
    fireEvent.click(screen.getAllByRole('checkbox', { name: 'Alpha' })[1]);
    advance();
    expect(off.applied()).toEqual({ filterType: 'set', values: ['Bravo', 'Charlie', null] });
  });

  it('with the opt-in, unticking from "All" excludes the unticked values', () => {
    const { applied, api } = renderFilter({ exclude: true });
    click('Bravo');
    expect(hint()).toBe('All but 1. Values added later show too.');
    advance();
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Bravo'] });
    expect(label()).toBe('All but 1');
    click('(Blank)');
    advance();
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Bravo', null] });
    expect(label()).toBe('All but 2');
    // Ticking every value again: no filter.
    click('Bravo');
    click('(Blank)');
    advance();
    expect(applied()).toBeUndefined();
    expect(label()).toBe('All');
    expect(hint()).toBeNull();
  });

  it('"Clear" then tick includes the ticked values, also when the tick comes before the delay', () => {
    const { applied } = renderFilter({ exclude: true });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    click('Charlie');
    expect(hint()).toBe('Only the ticked value shows.');
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: ['Charlie'] });
    expect(label()).toBe('1 selected');
    click('Alpha');
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: ['Charlie', 'Alpha'] });
    expect(hint()).toBe('Only the 2 ticked values show.');
    // "All" then untick: back to exclude.
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    click('Alpha');
    advance();
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Alpha'] });
  });

  it('an exclude model from outside (a link, a reload) ticks every other value, also values added later', () => {
    const { setValues, applied } = renderFilter({ exclude: true, initial: { filterType: 'set', mode: 'exclude', values: ['Bravo'] } });
    expect(box('Alpha')).toBeChecked();
    expect(box('Bravo')).not.toBeChecked();
    expect(box('Charlie')).toBeChecked();
    expect(label()).toBe('All but 1');
    // A supplier created afterwards appears in the values: ticked, so shown by the list.
    setValues([...OPTIONS, { value: 'Delta' }]);
    expect(box('Delta')).toBeChecked();
    expect(box('Bravo')).not.toBeChecked();
    // Unticking it adds it to the excluded values, keeping Bravo.
    click('Delta');
    advance();
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Bravo', 'Delta'] });
  });

  it('keeps an excluded value the list no longer offers (another filter hides it), and lists it unticked', () => {
    const { setValues, applied } = renderFilter({ exclude: true, initial: { filterType: 'set', mode: 'exclude', values: ['Bravo'] } });
    setValues([{ value: 'Alpha' }, { value: 'Charlie' }]);
    expect(box('Bravo')).not.toBeChecked();
    click('Alpha');
    advance();
    expect(applied()?.mode).toBe('exclude');
    expect([...(applied()?.values ?? [])].sort()).toEqual(['Alpha', 'Bravo']);
    // Every offered value ticked again: Bravo, listed unticked, stays excluded.
    click('Alpha');
    advance();
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Bravo'] });
  });

  it('a search narrows the values listed: ticking or unticking then moves only those values, the filter stays exclude', async () => {
    const values = Array.from({ length: 25 }, (_, i) => ({ value: `Supplier ${i}` }));
    const { applied, api, setValues } = renderFilter({ exclude: true, values });
    fireEvent.click(box('Supplier 3'));
    advance();
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Supplier 3'] });
    const calls = api.setFilterModel.mock.calls.length;
    // Typing a search changes nothing on the list: no model sent, still "All but 1".
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Supplier 2' } });
    advance();
    expect(api.setFilterModel.mock.calls.length).toBe(calls);
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Supplier 3'] });
    expect(hint()).toBe('All but 1. Values added later show too.');
    // Unticking a value found by the search: that value joins the excluded ones, nothing else moves.
    fireEvent.click(box('Supplier 20'));
    advance();
    expect(applied()?.mode).toBe('exclude');
    expect([...(applied()?.values ?? [])].sort()).toEqual(['Supplier 20', 'Supplier 3']);
    expect(label()).toBe('All but 2');
    // The popup closed with the search still typed: the filter is the exclude one (values added later show).
    setValues([...values, { value: 'Supplier 99' }]);
    expect(applied()?.mode).toBe('exclude');
    expect([...(applied()?.values ?? [])].sort()).toEqual(['Supplier 20', 'Supplier 3']);
    // "Clear" with a search unticks the values listed only; "All" ticks them back.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Supplier 1' } });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    advance();
    expect(applied()?.mode).toBe('exclude');
    expect([...(applied()?.values ?? [])].sort()).toEqual(
      ['Supplier 1', 'Supplier 10', 'Supplier 11', 'Supplier 12', 'Supplier 13', 'Supplier 14', 'Supplier 15', 'Supplier 16', 'Supplier 17', 'Supplier 18', 'Supplier 19', 'Supplier 20', 'Supplier 3'],
    );
    fireEvent.click(screen.getByRole('button', { name: /^all$/i }));
    advance();
    expect([...(applied()?.values ?? [])].sort()).toEqual(['Supplier 20', 'Supplier 3']);
    // The search cleared: same filter.
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    advance();
    expect([...(applied()?.values ?? [])].sort()).toEqual(['Supplier 20', 'Supplier 3']);
    expect(box('Supplier 99')).toBeChecked();
  });

  it('after "Clear" (only the ticked values), a search keeps the ticked matching values as before', () => {
    const { applied } = renderFilter({ exclude: true, values: Array.from({ length: 25 }, (_, i) => ({ value: `Supplier ${i}` })) });
    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));
    fireEvent.click(box('Supplier 2'));
    fireEvent.click(box('Supplier 5'));
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: ['Supplier 2', 'Supplier 5'] });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Supplier 2' } });
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: ['Supplier 2'] });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '' } });
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: ['Supplier 2', 'Supplier 5'] });
  });

  it('a column can turn it off on a list that has it', () => {
    const { applied } = renderFilter({ exclude: true, columnExclude: false });
    click('Bravo');
    advance();
    expect(applied()).toEqual({ filterType: 'set', values: ['Alpha', 'Charlie', null] });
  });

  it('the cross under the header ends an exclude filter: every box ticked, the next untick excludes again', () => {
    const { setFromOutside, applied } = renderFilter({ exclude: true });
    click('Alpha');
    advance();
    setFromOutside({});
    for (const name of ['Alpha', 'Bravo', 'Charlie', '(Blank)']) expect(box(name)).toBeChecked();
    expect(label()).toBe('All');
    click('Charlie');
    advance();
    expect(applied()).toEqual({ filterType: 'set', mode: 'exclude', values: ['Charlie'] });
  });
});
