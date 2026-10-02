import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAutosave, { AUTOSAVE_RETRY_DELAYS_MS } from './useAutosave';
import { createPatchBuffer, sendPatchBuffer, usePatchBuffer } from './patchBuffer';

// The review's cases (plan planning/perf-scale, lot 3A): a workspace page
// stays mounted from one item to the next, its autosave sends a moment later
// what was typed. A refused field must never be sent again, to its own item or
// to the next one; a busy field is sent again to its own item only; a discard
// drops everything for good.

function apiError(status: number, code?: string) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: code ? { code } : {}, headers: {} } });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  });
}

type Call = [string, Record<string, unknown>];

/** The page's wiring (SpendItemPage, CapexItemPage, IncidentWorkspacePage, ContributorWorkspacePage), on the real helpers. */
function usePage(itemId: string, calls: Call[], answer: (id: string, patch: Record<string, unknown>) => unknown) {
  const buffer = usePatchBuffer<Record<string, unknown>>();
  const refused: string[] = [];
  const autosave = useAutosave({ delay: 10 });
  const flushPending = React.useCallback(() => sendPatchBuffer(
    buffer,
    async (id, patch) => {
      calls.push([id, { ...patch }]);
      const error = answer(id, patch);
      if (error) throw error;
    },
    { onRefused: (id) => { refused.push(id); } },
  ), [buffer]);
  const edit = (patch: Record<string, unknown>) => {
    buffer.add(itemId, patch);
    autosave.schedule(flushPending);
  };
  return { autosave, edit, buffer, refused };
}

describe('patch buffer with the autosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('a refused field never reaches the next item, nor the next save of its own', async () => {
    const calls: Call[] = [];
    const { result, rerender } = renderHook(({ id }) => usePage(id, calls, (id, patch) => (
      id === 'A' && patch.description === 'X' ? apiError(409, 'duplicate') : null
    )), { initialProps: { id: 'A' } });

    act(() => result.current.edit({ description: 'X' }));
    await advance(10);
    await settle();
    expect(result.current.autosave.status).toBe('error');
    expect(result.current.autosave.isBusy()).toBe(false);
    expect(result.current.buffer.isEmpty()).toBe(true);

    // Navigation proceeds at once: nothing kept.
    let flushed: boolean | undefined;
    await act(async () => { flushed = await result.current.autosave.flush(); });
    expect(flushed).toBe(true);

    // The next edit on the same item carries only itself.
    act(() => result.current.edit({ notes: 'n1' }));
    await advance(10);
    await settle();

    // The page now shows item B (same instance): its edit goes to B, alone.
    rerender({ id: 'B' });
    act(() => result.current.edit({ notes: 'n' }));
    await advance(10);
    await settle();

    expect(calls).toEqual([
      ['A', { description: 'X' }],
      ['A', { notes: 'n1' }],
      ['B', { notes: 'n' }],
    ]);
    expect(calls).not.toContainEqual(['B', { description: 'X', notes: 'n' }]);
    expect(result.current.autosave.status).toBe('saved');
  });

  it('a busy field goes again to its own item only, even after the page moved to another item', async () => {
    const calls: Call[] = [];
    let busy = true;
    const { result, rerender } = renderHook(({ id }) => usePage(id, calls, () => (busy ? apiError(503, 'busy') : null)), {
      initialProps: { id: 'A' },
    });
    act(() => result.current.edit({ description: 'text for A' }));
    await advance(10);
    for (const wait of AUTOSAVE_RETRY_DELAYS_MS) await advance(wait);
    await settle();
    expect(result.current.autosave.status).toBe('error');
    expect(result.current.autosave.isBusy()).toBe(true);

    rerender({ id: 'B' });
    busy = false;
    act(() => result.current.edit({ notes: 'note for B' }));
    await advance(10);
    await settle();

    expect(calls.filter(([id]) => id === 'B')).toEqual([['B', { notes: 'note for B' }]]);
    expect(calls[calls.length - 2]).toEqual(['A', { description: 'text for A' }]);
    expect(result.current.autosave.isBusy()).toBe(false);
  });

  it('after a discard, nothing of the dropped edit is sent, to any item', async () => {
    const calls: Call[] = [];
    let busy = true;
    const { result, rerender } = renderHook(({ id }) => usePage(id, calls, () => (busy ? apiError(503, 'busy') : null)), {
      initialProps: { id: 'A' },
    });
    act(() => result.current.edit({ description: 'text for A' }));
    await advance(10);
    for (const wait of AUTOSAVE_RETRY_DELAYS_MS) await advance(wait);
    await settle();

    // "Leave without saving", then the page shows B.
    act(() => {
      result.current.autosave.discard();
      result.current.buffer.discard();
    });
    rerender({ id: 'B' });
    busy = false;
    let flushed: boolean | undefined;
    await act(async () => { flushed = await result.current.autosave.flush(); });
    expect(flushed).toBe(true);
    act(() => result.current.edit({ notes: 'note for B' }));
    await advance(10);
    await settle();

    const sent = AUTOSAVE_RETRY_DELAYS_MS.length + 1;
    expect(calls.slice(sent)).toEqual([['B', { notes: 'note for B' }]]);
    expect(calls.slice(0, sent).every(([id]) => id === 'A')).toBe(true);
  });
});

describe('createPatchBuffer', () => {
  it('merges edits per item, gives back a busy patch under the newer edits, and holds fields while they are sent', () => {
    const buffer = createPatchBuffer<Record<string, string>>();
    buffer.add('A', { description: 'one' });
    buffer.add('B', { notes: 'b' });
    buffer.add('A', { notes: 'two' });
    const takenA = buffer.take()!;
    expect(takenA.targetId).toBe('A');
    expect(takenA.patch).toEqual({ description: 'one', notes: 'two' });
    expect(buffer.holds('A', 'description')).toBe(true);
    expect(buffer.holdsOtherThan('A')).toBe(true);

    // Typed again while the save is in flight, then the save is busy: the newer text wins.
    buffer.add('A', { description: 'three' });
    buffer.putBack(takenA);
    expect(buffer.held('A')).toEqual({ description: 'three', notes: 'two' });

    // B was buffered before A's newer edit: it goes first; A stays held.
    const takenB = buffer.take()!;
    expect(takenB).toMatchObject({ targetId: 'B', patch: { notes: 'b' } });
    buffer.settle(takenB);
    expect(buffer.holds('B', 'notes')).toBe(false);
    expect(buffer.holds('A', 'description')).toBe(true);
    expect(buffer.targets()).toEqual(['A']);
  });

  it('does not take back a patch taken before a discard', () => {
    const buffer = createPatchBuffer<Record<string, string>>();
    buffer.add('A', { description: 'dropped' });
    const taken = buffer.take()!;
    buffer.discard();
    buffer.putBack(taken);
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.holds('A', 'description')).toBe(false);
  });

  it('sends every item, keeps the refused ones out, and throws the refusal once the others went', async () => {
    const buffer = createPatchBuffer<Record<string, string>>();
    buffer.add('A', { description: 'refused' });
    buffer.add('B', { notes: 'fine' });
    const sent: string[] = [];
    const refused: string[] = [];
    const conflict = apiError(409, 'parent_gone');
    await expect(sendPatchBuffer(
      buffer,
      async (id) => { sent.push(id); if (id === 'A') throw conflict; },
      { onRefused: (id) => refused.push(id) },
    )).rejects.toBe(conflict);
    expect(sent).toEqual(['A', 'B']);
    expect(refused).toEqual(['A']);
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.holds('A', 'description')).toBe(false);
  });

  it('stops at a busy item and keeps it and the rest for the next attempt', async () => {
    const buffer = createPatchBuffer<Record<string, string>>();
    buffer.add('A', { description: 'busy' });
    buffer.add('B', { notes: 'waits' });
    const busy = apiError(503, 'busy');
    await expect(sendPatchBuffer(buffer, async (id) => { if (id === 'A') throw busy; })).rejects.toBe(busy);
    expect(buffer.held('A')).toEqual({ description: 'busy' });
    expect(buffer.held('B')).toEqual({ notes: 'waits' });
  });
});
