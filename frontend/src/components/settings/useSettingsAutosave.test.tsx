import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key };
  return { useTranslation: () => translation };
});
const confirm = vi.fn(async (_options: unknown) => true);
vi.mock('../design', () => ({ useKanapDialogs: () => ({ confirm }) }));

import { useSettingsAutosave, type SettingsAutosave } from './useSettingsAutosave';
import { confirmLeave } from '../../hooks/leaveGuard';

let current: SettingsAutosave;
function Probe() {
  current = useSettingsAutosave();
  return <span data-testid="status">{current.status}</span>;
}

const busy = Object.assign(new Error('busy'), { response: { status: 503, data: { code: 'busy' } } });
const refused = Object.assign(new Error('Bad Request'), { response: { status: 400, data: { message: 'No.' } } });

describe('useSettingsAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    confirm.mockClear();
    confirm.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const flushPromises = async () => {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) await Promise.resolve();
    });
  };

  it('sends a choice at once, says Saving then Saved, then rests', async () => {
    const save = vi.fn(async () => undefined);
    const { getByTestId } = render(<Probe />);
    act(() => current.choose('mode', save));
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
    expect(getByTestId('status').textContent).toBe('saved');
    await act(async () => { vi.advanceTimersByTime(1500); });
    expect(getByTestId('status').textContent).toBe('idle');
  });

  it('sends a text 700 ms after the last key, once, with the last value', async () => {
    const save = vi.fn(async (_value: string) => undefined);
    const { getByTestId } = render(<Probe />);
    act(() => current.type('name', () => save('A')));
    await act(async () => { vi.advanceTimersByTime(400); });
    act(() => current.type('name', () => save('A1')));
    expect(getByTestId('status').textContent).toBe('pending');
    await act(async () => { vi.advanceTimersByTime(699); });
    expect(save).not.toHaveBeenCalled();
    await act(async () => { vi.advanceTimersByTime(1); });
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith('A1');
  });

  it('sends a text when the field loses the focus, without waiting', async () => {
    const save = vi.fn(async () => undefined);
    render(<Probe />);
    act(() => current.type('name', save));
    act(() => current.commit());
    await flushPromises();
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('never sends a value the page refuses: what waited for the field is dropped', async () => {
    const save = vi.fn(async () => undefined);
    const { getByTestId } = render(<Probe />);
    act(() => current.type('name', save));
    act(() => current.type('name', null));
    await act(async () => { vi.advanceTimersByTime(2000); });
    await flushPromises();
    expect(save).not.toHaveBeenCalled();
    expect(getByTestId('status').textContent).toBe('idle');
    expect(current.isBusy()).toBe(false);
  });

  it('keeps the save of another field when one field is refused', async () => {
    const other = vi.fn(async () => undefined);
    render(<Probe />);
    act(() => current.type('first', other));
    act(() => current.type('second', null));
    act(() => current.commit());
    await flushPromises();
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('gives the server refusal to the page and drops the save', async () => {
    const { getByTestId } = render(<Probe />);
    act(() => current.choose('mode', async () => { throw refused; }));
    await flushPromises();
    expect(getByTestId('status').textContent).toBe('error');
    expect(current.error).toBe(refused);
    expect(current.isBusy()).toBe(false);
  });

  it('sends what waits before the page is left, and asks nothing when it went through', async () => {
    const save = vi.fn(async () => undefined);
    render(<Probe />);
    act(() => current.type('name', save));
    let allowed = false;
    await act(async () => { allowed = await confirmLeave(); });
    expect(allowed).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before leaving when a save could not go through, and stays when the person says so', async () => {
    const save = vi.fn(async () => { throw busy; });
    render(<Probe />);
    act(() => current.type('name', save));
    confirm.mockResolvedValueOnce(false);
    let allowed: boolean | null = null;
    const leaving = confirmLeave().then((value) => { allowed = value; });
    // The three automatic retries of a busy server, then the question.
    for (let i = 0; i < 6; i += 1) {
      await act(async () => { vi.advanceTimersByTime(4000); });
      await flushPromises();
    }
    await act(async () => { await leaving; });
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(allowed).toBe(false);
    expect(current.isBusy()).toBe(true);
  });

  it('warns on a reload while a save waits', () => {
    render(<Probe />);
    act(() => current.type('name', async () => undefined));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
