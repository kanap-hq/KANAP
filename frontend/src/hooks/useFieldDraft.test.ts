import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useFieldDraft } from './useFieldDraft';

function setup(initial = 'stored') {
  return renderHook(({ value }) => useFieldDraft(value), { initialProps: { value: initial } });
}

describe('useFieldDraft', () => {
  it('follows the stored value when the field is not focused', () => {
    const { result, rerender } = setup();
    rerender({ value: 'next' });
    expect(result.current.draft).toBe('next');
  });

  it('keeps what the user types when a save lands during the edit', () => {
    const { result, rerender } = setup();
    act(() => { result.current.onFocus(); });
    act(() => { result.current.setDraft('typed again'); });
    rerender({ value: 'earlier save' });
    expect(result.current.draft).toBe('typed again');
  });

  it('shows a stored change that lands while the field only has focus (a normalised value)', () => {
    const { result, rerender } = setup('  raw  ');
    act(() => { result.current.onFocus(); });
    rerender({ value: 'raw' });
    expect(result.current.draft).toBe('raw');
  });

  it('follows the stored value again after blur, and a programmatic reset does not lock it', () => {
    const { result, rerender } = setup();
    act(() => { result.current.onFocus(); });
    act(() => { result.current.setDraft('typed'); });
    act(() => { result.current.onBlur(); });
    act(() => { result.current.setDraft('stored'); });
    rerender({ value: 'saved elsewhere' });
    expect(result.current.draft).toBe('saved elsewhere');
  });
});
