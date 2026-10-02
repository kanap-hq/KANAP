import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import ClearableColumnFloatingFilter, { TEXT_FILTER_APPLY_DELAY_MS } from './ClearableColumnFloatingFilter';

const COL = 'name';

/**
 * The box as AG Grid 32 runs it (reactive): the column's model as the `model` prop, handed back
 * after every setFilterModel, left out when the column has no filter.
 */
function renderBox(initial?: Record<string, any>) {
  let model: Record<string, any> = initial ?? {};
  const api = {
    getFilterModel: vi.fn(() => model),
    setFilterModel: vi.fn((next: Record<string, any>) => { model = next; rerender(); }),
  };
  const column = { getColId: () => COL, getColDef: () => ({ field: COL, headerName: 'Name', filterParams: {} }) };
  const ui = () => <ClearableColumnFloatingFilter {...({ api, column, model: model[COL], onModelChange: vi.fn() } as any)} />;
  const view = render(ui());
  function rerender() { view.rerender(ui()); }
  const setFromOutside = (next: Record<string, any>) => { model = next; act(() => rerender()); };
  return { api, box: screen.getByRole('textbox') as HTMLInputElement, applied: () => model[COL], setFromOutside };
}

const type = (box: HTMLElement, value: string) => fireEvent.change(box, { target: { value } });

describe('ClearableColumnFloatingFilter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('filters once, after a pause in typing', () => {
    const { api, box, applied } = renderBox();
    for (const value of ['c', 'cl', 'clo', 'clou', 'cloud']) {
      type(box, value);
      act(() => { vi.advanceTimersByTime(TEXT_FILTER_APPLY_DELAY_MS - 1); });
    }
    expect(api.setFilterModel).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(applied()).toEqual({ filter: 'cloud', type: 'contains', filterType: 'text' });
  });

  it('filters at once on Enter, and not again after the pause', () => {
    const { api, box, applied } = renderBox();
    type(box, 'clo');
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(applied()).toMatchObject({ filter: 'clo' });
    act(() => { vi.advanceTimersByTime(TEXT_FILTER_APPLY_DELAY_MS); });
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
  });

  it('filters at once when the box loses the focus', () => {
    const { api, box, applied } = renderBox();
    type(box, 'lic');
    fireEvent.blur(box);
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
    expect(applied()).toMatchObject({ filter: 'lic' });
  });

  it('asks nothing when the text comes back to the filter already applied', () => {
    const { api, box } = renderBox();
    type(box, 'abc');
    fireEvent.keyDown(box, { key: 'Enter' });
    type(box, 'ab');
    type(box, 'abc');
    act(() => { vi.advanceTimersByTime(TEXT_FILTER_APPLY_DELAY_MS); });
    expect(api.setFilterModel).toHaveBeenCalledTimes(1);
  });

  it('the cross right after typing changes nothing: the typed text is never applied', () => {
    const { api, box } = renderBox();
    type(box, 'abc');
    const cross = screen.getByRole('button', { name: /clear filter/i });
    // Default prevented: the box keeps the focus and is not left (no apply on blur).
    expect(fireEvent.mouseDown(cross)).toBe(false);
    fireEvent.click(cross);
    act(() => { vi.advanceTimersByTime(TEXT_FILTER_APPLY_DELAY_MS); });
    expect(api.setFilterModel).not.toHaveBeenCalled();
    expect(box).toHaveValue('');
  });

  it('shows the model it starts with and a model set from outside', () => {
    const { box, setFromOutside } = renderBox({ [COL]: { filterType: 'text', type: 'contains', filter: 'abc' } });
    expect(box).toHaveValue('abc');
    setFromOutside({ [COL]: { filterType: 'text', type: 'contains', filter: 'xyz' } });
    expect(box).toHaveValue('xyz');
    setFromOutside({});
    expect(box).toHaveValue('');
  });

  it('keeps text typed and not applied yet when the model changes from outside', () => {
    const { box, setFromOutside, applied } = renderBox({ [COL]: { filterType: 'text', type: 'contains', filter: 'abc' } });
    type(box, 'abcd');
    setFromOutside({ [COL]: { filterType: 'text', type: 'contains', filter: 'abc' }, other: { filterType: 'text', type: 'contains', filter: 'x' } });
    expect(box).toHaveValue('abcd');
    act(() => { vi.advanceTimersByTime(TEXT_FILTER_APPLY_DELAY_MS); });
    expect(applied()).toMatchObject({ filter: 'abcd' });
    expect(box).toHaveValue('abcd');
  });
});
