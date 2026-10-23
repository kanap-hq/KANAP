import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeferredTextField, { DEFERRED_SAVE_MS } from './DeferredTextField';

function Harness({ onSave, initial = '' }: { onSave: (value: string) => Promise<unknown> | void; initial?: string }) {
  // The saved value follows what onSave received, as the application cache does.
  const [saved, setSaved] = React.useState(initial);
  return <DeferredTextField value={saved} resetKey="a" inputProps={{ 'aria-label': 'Publisher' }} onSave={async (value) => { await onSave(value); setSaved(value); }} />;
}

describe('DeferredTextField', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('sends one save with the whole value after a fast typing', async () => {
    const onSave = vi.fn(async () => undefined);
    render(<Harness onSave={onSave} />);
    const input = screen.getByLabelText('Publisher') as HTMLInputElement;
    let typed = '';
    for (const char of '0123456789ABCDEFGHIJ') {
      typed += char;
      fireEvent.change(input, { target: { value: typed } });
      await act(async () => { vi.advanceTimersByTime(25); });
    }
    expect(onSave).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(DEFERRED_SAVE_MS); });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith('0123456789ABCDEFGHIJ');
    expect(input.value).toBe('0123456789ABCDEFGHIJ');
  });

  it('saves when the field loses the focus, and never lets a response rewrite the typing', async () => {
    let release: () => void = () => undefined;
    const onSave = vi.fn((value: string) => (value === 'ab' ? new Promise<void>((resolve) => { release = resolve; }) : Promise.resolve()));
    render(<Harness onSave={onSave} />);
    const input = screen.getByLabelText('Publisher') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.blur(input);
    expect(onSave).toHaveBeenCalledWith('ab');
    // typing goes on while the first request is out: one request at a time
    fireEvent.change(input, { target: { value: 'abc' } });
    await act(async () => { vi.advanceTimersByTime(DEFERRED_SAVE_MS); });
    expect(onSave).toHaveBeenCalledTimes(1);
    await act(async () => { release(); });
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave).toHaveBeenLastCalledWith('abc');
    expect(input.value).toBe('abc');
  });

  it('puts the saved value back when the save fails', async () => {
    const onSave = vi.fn(async () => { throw new Error('refused'); });
    render(<DeferredTextField value="kept" resetKey="a" inputProps={{ 'aria-label': 'Publisher' }} onSave={onSave} />);
    const input = screen.getByLabelText('Publisher') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'lost' } });
    fireEvent.blur(input);
    await act(async () => { await Promise.resolve(); });
    expect(input.value).toBe('kept');
  });
});
