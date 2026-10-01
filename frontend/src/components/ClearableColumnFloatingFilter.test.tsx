import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../i18n';
import ClearableColumnFloatingFilter, { TEXT_FILTER_APPLY_DELAY_MS } from './ClearableColumnFloatingFilter';

const COL = 'name';

function renderBox() {
  let model: Record<string, any> = {};
  const api = {
    getFilterModel: vi.fn(() => model),
    setFilterModel: vi.fn((next: Record<string, any>) => { model = next; }),
  };
  const column = { getColId: () => COL, getColDef: () => ({ field: COL, headerName: 'Name', filterParams: {} }) };
  render(<ClearableColumnFloatingFilter {...({ api, column } as any)} />);
  return { api, box: screen.getByRole('textbox'), applied: () => model[COL] };
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
});
