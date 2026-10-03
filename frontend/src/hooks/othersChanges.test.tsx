import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ default: { get: vi.fn() } }));

import api from '../api';
import { OTHERS_POLL_MS, RecordMetaAnswer, othersMoved, typingWithin, useOthersChanges, type UseOthersChangesOptions } from './othersChanges';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };
const LINE = 'line-1';
const MARIE = { id: 'marie', name: 'Marie Dupont' };

let visibility: DocumentVisibilityState = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
const setVisibility = (next: DocumentVisibilityState) => {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
};

function meta(rowVersion: number, versions: Array<{ year: number; rev: number }> = [], by = MARIE, at = '2026-10-02T12:02:00.000Z'): RecordMetaAnswer {
  return {
    id: LINE,
    row_version: rowVersion,
    changed_by: by,
    changed_at: at,
    versions: versions.map(({ year, rev }) => ({ id: `v${year}`, budget_year: year, budget_rev: rev, changed_by: { id: 'jean', name: 'Jean Martin' }, changed_at: '2026-10-02T12:05:00.000Z' })),
  };
}

/** The page's side of the hook: what is pending or saving, and what a refresh did. */
function setup(overrides: Partial<UseOthersChangesOptions> = {}) {
  const page = { saving: false, pending: false, refreshes: [] as unknown[] };
  const refresh = vi.fn(async (what: unknown) => { page.refreshes.push(what); });
  const options: UseOthersChangesOptions = {
    recordId: LINE,
    metaUrl: (id) => `/spend-items/${id}/meta`,
    loadedRowVersion: 5,
    shownYear: null,
    isSaving: () => page.saving,
    hasPending: () => page.pending,
    refresh,
    ...overrides,
  };
  const view = renderHook((props: UseOthersChangesOptions) => useOthersChanges(props), { initialProps: options });
  return { page, refresh, view, options };
}

const metaCalls = () => mocked.get.mock.calls.filter(([url]) => String(url).endsWith('/meta')).length;

beforeEach(() => {
  vi.useFakeTimers();
  mocked.get.mockReset();
  visibility = 'visible';
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useOthersChanges: the poll', () => {
  it('reads the meta every 30 seconds while the tab is visible, none while hidden, at once when visible again', async () => {
    mocked.get.mockResolvedValue({ data: meta(5) });
    setup();
    expect(metaCalls()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(OTHERS_POLL_MS); });
    expect(metaCalls()).toBe(1);
    expect(mocked.get.mock.calls[0][0]).toBe(`/spend-items/${LINE}/meta`);

    act(() => setVisibility('hidden'));
    await act(async () => { await vi.advanceTimersByTimeAsync(OTHERS_POLL_MS * 3); });
    expect(metaCalls()).toBe(1);

    await act(async () => { setVisibility('visible'); await vi.advanceTimersByTimeAsync(0); });
    expect(metaCalls()).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(OTHERS_POLL_MS); });
    expect(metaCalls()).toBe(3);
  });

  it('reads nothing while a save is on its way, and drops an answer read while one started', async () => {
    const { page, refresh, view } = setup();
    page.saving = true;
    await act(async () => { await vi.advanceTimersByTimeAsync(OTHERS_POLL_MS); });
    expect(metaCalls()).toBe(0);

    // A read starts with nothing saving; a save starts before its answer comes back.
    page.saving = false;
    let answer: (value: unknown) => void = () => undefined;
    mocked.get.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(OTHERS_POLL_MS); });
    expect(metaCalls()).toBe(1);
    page.saving = true;
    await act(async () => { answer({ data: meta(6) }); await vi.advanceTimersByTimeAsync(0); });
    expect(refresh).not.toHaveBeenCalled();
    expect(view.result.current.notice).toBeNull();
    expect(view.result.current.outdated).toBeNull();
  });

  it('no record to watch: no read', async () => {
    mocked.get.mockResolvedValue({ data: meta(9) });
    setup({ recordId: null });
    await act(async () => { await vi.advanceTimersByTimeAsync(OTHERS_POLL_MS * 2); });
    expect(metaCalls()).toBe(0);
  });
});

describe('useOthersChanges: what moved', () => {
  it('idle: the line moved, it is refreshed in place and the notice names who and when; the same answer again does nothing', async () => {
    mocked.get.mockResolvedValue({ data: meta(6) });
    const { refresh, view } = setup();
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenCalledWith({ line: true, budgetYear: null, rowVersion: 6 });
    expect(view.result.current.notice).toEqual({ by: MARIE, at: '2026-10-02T12:02:00.000Z' });
    expect(view.result.current.outdated).toBeNull();

    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('nothing moved: nothing refreshed, nothing said', async () => {
    mocked.get.mockResolvedValue({ data: meta(5) });
    const { refresh, view } = setup();
    await act(async () => { await view.result.current.check(); });
    expect(refresh).not.toHaveBeenCalled();
    expect(view.result.current.notice).toBeNull();
  });

  it('the page\'s own save is not a change: its answer\'s counter is known before the next read', async () => {
    mocked.get.mockResolvedValue({ data: meta(6) });
    const { refresh, view } = setup();
    act(() => view.result.current.noteRowVersion(LINE, 6));
    await act(async () => { await view.result.current.check(); });
    expect(refresh).not.toHaveBeenCalled();
    expect(view.result.current.notice).toBeNull();
    // A save of another line says nothing about this one.
    act(() => view.result.current.noteRowVersion('other-line', 9));
    mocked.get.mockResolvedValue({ data: meta(7) });
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('pending: nothing refreshed, the badge says changed elsewhere; Reload refreshes, keeps the pending edits to the page, and says who', async () => {
    mocked.get.mockResolvedValue({ data: meta(6) });
    const { page, refresh, view } = setup();
    page.pending = true;
    await act(async () => { await view.result.current.check(); });
    expect(refresh).not.toHaveBeenCalled();
    expect(view.result.current.outdated).toEqual({ by: MARIE, at: '2026-10-02T12:02:00.000Z' });
    expect(view.result.current.notice).toBeNull();

    await act(async () => { await view.result.current.reload(); });
    expect(refresh).toHaveBeenCalledWith({ line: true, budgetYear: null, rowVersion: 6 });
    expect(view.result.current.outdated).toBeNull();
    expect(view.result.current.notice).toEqual({ by: MARIE, at: '2026-10-02T12:02:00.000Z' });
    // Known now: the next read finds nothing new.
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the badge goes once the page\'s own save answered a counter as new as the change', async () => {
    mocked.get.mockResolvedValue({ data: meta(6) });
    const { page, view } = setup();
    page.pending = true;
    await act(async () => { await view.result.current.check(); });
    expect(view.result.current.outdated).not.toBeNull();
    // The user's save goes (it meets the conflict check) and answers 7; the page reloaded the line.
    act(() => view.result.current.noteRowVersion(LINE, 7));
    expect(view.result.current.outdated).toBeNull();
  });

  it('pending ends: the next read refreshes and says it', async () => {
    mocked.get.mockResolvedValue({ data: meta(6) });
    const { page, refresh, view } = setup();
    page.pending = true;
    await act(async () => { await view.result.current.check(); });
    page.pending = false;
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(view.result.current.outdated).toBeNull();
    expect(view.result.current.notice).not.toBeNull();
  });

  it('the version of the year shown: a counter beyond the known one, or a version created elsewhere, refreshes the year', async () => {
    const { refresh, view } = setup({ shownYear: 2026 });
    act(() => view.result.current.noteBudgetRev(LINE, 2026, 3));
    // Another year moved: not shown, nothing to do.
    mocked.get.mockResolvedValue({ data: meta(5, [{ year: 2026, rev: 3 }, { year: 2027, rev: 9 }]) });
    await act(async () => { await view.result.current.check(); });
    expect(refresh).not.toHaveBeenCalled();

    mocked.get.mockResolvedValue({ data: meta(5, [{ year: 2026, rev: 4 }]) });
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenLastCalledWith({ line: false, budgetYear: 2026, rowVersion: 5 });
    expect(view.result.current.notice).toEqual({ by: { id: 'jean', name: 'Jean Martin' }, at: '2026-10-02T12:05:00.000Z' });

    // A year the tab showed without a version: one created elsewhere is a change too.
    view.rerender({ ...setupOptions(refresh), shownYear: 2027 });
    act(() => view.result.current.noteBudgetRev(LINE, 2027, null));
    mocked.get.mockResolvedValue({ data: meta(5, [{ year: 2026, rev: 4 }, { year: 2027, rev: 1 }]) });
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenLastCalledWith({ line: false, budgetYear: 2027, rowVersion: 5 });
  });

  it('a year whose counter the tab has not given yet is not compared', async () => {
    mocked.get.mockResolvedValue({ data: meta(5, [{ year: 2026, rev: 40 }]) });
    const { refresh, view } = setup({ shownYear: 2026 });
    await act(async () => { await view.result.current.check(); });
    expect(refresh).not.toHaveBeenCalled();
  });

  it('another line: what was known and said is gone', async () => {
    mocked.get.mockResolvedValue({ data: meta(6) });
    const { refresh, view, options } = setup();
    await act(async () => { await view.result.current.check(); });
    expect(view.result.current.notice).not.toBeNull();
    view.rerender({ ...options, recordId: 'line-2', loadedRowVersion: 1 });
    expect(view.result.current.notice).toBeNull();
    // Its answer names another record: dropped.
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('the record deleted (404): said once, and no more reads', async () => {
    mocked.get.mockRejectedValue(Object.assign(new Error('HTTP 404'), { response: { status: 404 } }));
    const { refresh, view } = setup();
    await act(async () => { await view.result.current.check(); });
    expect(view.result.current.gone).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(OTHERS_POLL_MS * 3); });
    expect(metaCalls()).toBe(1);
    expect(refresh).not.toHaveBeenCalled();
  });

  it('another failure says nothing: the next read tries again', async () => {
    mocked.get.mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { response: { status: 503 } }));
    mocked.get.mockResolvedValue({ data: meta(6) });
    const { view } = setup();
    await act(async () => { await view.result.current.check(); });
    expect(view.result.current.gone).toBe(false);
    await act(async () => { await view.result.current.check(); });
    expect(view.result.current.notice).not.toBeNull();
  });

  it('gives the counter it knows for a year, to a tab that may hold an older copy', () => {
    const { view } = setup({ shownYear: 2026 });
    expect(view.result.current.knownBudgetRev(LINE, 2026)).toBeUndefined();
    act(() => view.result.current.noteBudgetRev(LINE, 2026, 4));
    act(() => view.result.current.noteBudgetRev(LINE, 2026, 3));
    expect(view.result.current.knownBudgetRev(LINE, 2026)).toBe(4);
    expect(view.result.current.knownBudgetRev('other-line', 2026)).toBeUndefined();
  });

  it('a refresh that fails changes nothing known: the next read tries again', async () => {
    mocked.get.mockResolvedValue({ data: meta(6) });
    const refresh = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined);
    const { view } = setup({ refresh });
    await act(async () => { await view.result.current.check(); });
    expect(view.result.current.notice).toBeNull();
    await act(async () => { await view.result.current.check(); });
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(view.result.current.notice).not.toBeNull();
  });
});

/** The options of `setup` with another refresh (for a rerender). */
function setupOptions(refresh: UseOthersChangesOptions['refresh']): UseOthersChangesOptions {
  return {
    recordId: LINE,
    metaUrl: (id) => `/spend-items/${id}/meta`,
    loadedRowVersion: 5,
    shownYear: null,
    isSaving: () => false,
    hasPending: () => false,
    refresh,
  };
}

describe('othersMoved', () => {
  const known = (row: number | null, budget: Array<[number, number | null]> = []) => ({ recordId: LINE, row, budget: new Map(budget) });

  it('the later of two changes names who and when', () => {
    const answer = meta(6, [{ year: 2026, rev: 2 }]);
    expect(othersMoved(answer, known(5, [[2026, 1]]), 2026).change).toEqual({ by: { id: 'jean', name: 'Jean Martin' }, at: '2026-10-02T12:05:00.000Z' });
    expect(othersMoved({ ...answer, changed_at: '2026-10-02T12:09:00.000Z' }, known(5, [[2026, 1]]), 2026).change?.by).toEqual(MARIE);
  });

  it('nobody known: the change is still said, without a name', () => {
    expect(othersMoved({ ...meta(6), changed_by: null, changed_at: null }, known(5), null).change).toEqual({ by: null, at: null });
  });

  it('a counter not known yet compares nothing', () => {
    expect(othersMoved(meta(6), known(null), null).change).toBeNull();
  });
});

describe('typingWithin', () => {
  it('a text field with the focus inside the workspace; not a checkbox, not a read-only field, not outside', () => {
    const root = document.createElement('div');
    const outside = document.createElement('input');
    root.innerHTML = '<input id="text" /><input id="box" type="checkbox" /><input id="ro" readonly /><textarea id="notes"></textarea><button id="b">b</button>';
    document.body.append(root, outside);
    const focus = (selector: string) => (root.querySelector(selector) as HTMLElement).focus();
    focus('#text');
    expect(typingWithin(root)).toBe(true);
    focus('#notes');
    expect(typingWithin(root)).toBe(true);
    focus('#box');
    expect(typingWithin(root)).toBe(false);
    focus('#ro');
    expect(typingWithin(root)).toBe(false);
    focus('#b');
    expect(typingWithin(root)).toBe(false);
    outside.focus();
    expect(typingWithin(root)).toBe(false);
    root.remove();
    outside.remove();
  });
});
