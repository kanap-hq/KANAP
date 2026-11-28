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

  it('gives the server refusal to the page, by field, and drops the save', async () => {
    const { getByTestId } = render(<Probe />);
    act(() => current.choose('mode', async () => { throw refused; }));
    await flushPromises();
    expect(getByTestId('status').textContent).toBe('error');
    expect(current.errorOf?.('mode')).toBe(refused);
    expect(current.error).toBeNull();
    expect(current.isBusy()).toBe(false);
  });

  it('sends both waiting fields when the server refuses the first one', async () => {
    const first = vi.fn(async () => { throw refused; });
    const second = vi.fn(async () => undefined);
    const { getByTestId } = render(<Probe />);
    act(() => current.type('first', first));
    act(() => current.type('second', second));
    act(() => current.commit());
    await flushPromises();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(getByTestId('status').textContent).toBe('error');
    expect(current.errorOf?.('first')).toBe(refused);
    expect(current.errorOf?.('second') ?? null).toBeNull();
  });

  it('sends the third field when the server refuses the second one, both sent while the first was on its way', async () => {
    let releaseFirst: () => void = () => undefined;
    const first = vi.fn(() => new Promise<void>((resolve) => { releaseFirst = resolve; }));
    const second = vi.fn(async () => { throw refused; });
    const third = vi.fn(async () => undefined);
    const { getByTestId } = render(<Probe />);
    act(() => current.choose('first', first));
    await flushPromises();
    act(() => current.choose('second', second));
    act(() => current.choose('third', third));
    await act(async () => { releaseFirst(); });
    await flushPromises();
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    expect(getByTestId('status').textContent).toBe('error');
    expect(current.errorOf?.('second')).toBe(refused);
    expect(current.errorOf?.('third') ?? null).toBeNull();
    expect(current.isBusy()).toBe(false);
  });

  it('sends again a field the busy server put off, when another field of the same run is refused', async () => {
    let calls = 0;
    const later = vi.fn(async () => { calls += 1; if (calls === 1) throw busy; });
    const refusedField = vi.fn(async () => { throw refused; });
    const { getByTestId } = render(<Probe />);
    act(() => current.type('later', later));
    act(() => current.type('refused', refusedField));
    act(() => current.commit());
    await flushPromises();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flushPromises();
    expect(later).toHaveBeenCalledTimes(2);
    expect(refusedField).toHaveBeenCalledTimes(1);
    expect(current.errorOf?.('refused')).toBe(refused);
    expect(getByTestId('status').textContent).toBe('error');
    expect(current.isBusy()).toBe(false);
  });

  it('keeps the refusal of a field until that field changes again, not when another field changes', async () => {
    const { getByTestId } = render(<Probe />);
    act(() => current.choose('a', async () => { throw refused; }));
    await flushPromises();
    act(() => current.choose('b', async () => undefined));
    await flushPromises();
    expect(getByTestId('status').textContent).toBe('saved');
    expect(current.errorOf?.('a')).toBe(refused);
    act(() => current.choose('a', async () => undefined));
    expect(current.errorOf?.('a') ?? null).toBeNull();
  });

  it('a text typed then put back while another save is on its way leaves that save its outcome: refused', async () => {
    let rejectFirst: (failure: unknown) => void = () => undefined;
    const { getByTestId } = render(<Probe />);
    act(() => current.choose('enabled', () => new Promise((_, reject) => { rejectFirst = reject; })));
    await flushPromises();
    act(() => current.type('name', async () => undefined));
    act(() => current.type('name', null));
    await act(async () => { rejectFirst(refused); });
    await flushPromises();
    expect(getByTestId('status').textContent).toBe('error');
    expect(current.errorOf?.('enabled')).toBe(refused);
  });

  it('a text typed then put back while another save is on its way leaves that save its outcome: put off, then sent again', async () => {
    let calls = 0;
    let rejectFirst: (failure: unknown) => void = () => undefined;
    const choice = vi.fn(() => {
      calls += 1;
      return calls === 1 ? new Promise<void>((_, reject) => { rejectFirst = reject; }) : Promise.resolve();
    });
    const { getByTestId } = render(<Probe />);
    act(() => current.choose('enabled', choice));
    await flushPromises();
    act(() => current.type('name', async () => undefined));
    act(() => current.type('name', null));
    await act(async () => { rejectFirst(busy); });
    await flushPromises();
    await act(async () => { vi.advanceTimersByTime(1000); });
    await flushPromises();
    expect(choice).toHaveBeenCalledTimes(2);
    expect(getByTestId('status').textContent).toBe('saved');
  });

  it('stays on the page, without a question, when the save sent on leaving is refused', async () => {
    render(<Probe />);
    act(() => current.type('name', async () => { throw refused; }));
    let allowed: boolean | null = null;
    await act(async () => { allowed = await confirmLeave(); });
    expect(allowed).toBe(false);
    expect(confirm).not.toHaveBeenCalled();
    expect(current.errorOf?.('name')).toBe(refused);
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
    // Kept to be sent again: the page says it is not saved yet.
    expect(current.error).toBe(busy);
  });

  it('warns on a reload while a save waits', () => {
    render(<Probe />);
    act(() => current.type('name', async () => undefined));
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
