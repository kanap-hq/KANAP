import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useEditorRows } from './useEditorRows';

type Row = { localId: string; label: string };

describe('useEditorRows', () => {
  it('tells the page from the change itself, each change starting from the one before', () => {
    const onChange = vi.fn();
    const items: Row[] = [{ localId: 'a', label: '' }];
    const { result } = renderHook(() => useEditorRows(items, onChange));
    act(() => {
      result.current[1]((rows) => rows.map((row) => ({ ...row, label: 'H' })));
      // The page hears of the change before any render.
      expect(onChange).toHaveBeenCalledTimes(1);
      result.current[1]((rows) => rows.map((row) => ({ ...row, label: `${row.label}T` })));
    });
    expect(onChange.mock.calls.map((call) => call[0][0].label)).toEqual(['H', 'HT']);
    expect(result.current[0][0].label).toBe('HT');
  });

  it('sends nothing when a change leaves the rows as they are', () => {
    const onChange = vi.fn();
    const { result } = renderHook(() => useEditorRows([{ localId: 'a', label: 'x' }], onChange));
    act(() => { result.current[1]((rows) => rows); });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps its newer rows when the page hands back a list the editor sent, and takes any other list', () => {
    const onChange = vi.fn();
    const { result, rerender } = renderHook(({ items }) => useEditorRows(items, onChange), {
      initialProps: { items: [{ localId: 'a', label: '' }] as Row[] },
    });
    act(() => { result.current[1]((rows) => rows.map((row) => ({ ...row, label: 'H' }))); });
    const sentFirst = onChange.mock.calls[0][0] as Row[];
    act(() => { result.current[1]((rows) => rows.map((row) => ({ ...row, label: 'HT' }))); });
    rerender({ items: sentFirst });
    expect(result.current[0][0].label).toBe('HT');
    const fromPage: Row[] = [{ localId: 'b', label: 'New' }, { localId: 'a', label: 'HT' }];
    rerender({ items: fromPage });
    expect(result.current[0]).toBe(fromPage);
    act(() => { result.current[1]((rows) => rows.slice(1)); });
    expect(onChange).toHaveBeenLastCalledWith([{ localId: 'a', label: 'HT' }]);
  });
});
