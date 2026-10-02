import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAutosave, { classifySaveFailure, createAutosaveRegistry } from './useAutosave';
import { createPatchBuffer, sendPatchBuffer, usePatchBuffer } from './patchBuffer';
import { EditConflict, editConflictsOf, omitPath, pickLike, setPath, useEditConflicts } from './editConflicts';

// Field-level edit conflicts on the client (plan planning/perf-scale, lot 3C):
// each edit carries its base, a 409 edit_conflict keeps the edit for the
// user's choice (neither retried nor dropped), the choice sends what is left,
// and a conflict never reaches another item.

type Patch = Record<string, unknown>;

function conflictError(conflicts: Array<Partial<EditConflict> & { field: string }>) {
  return Object.assign(new Error('HTTP 409'), {
    response: {
      status: 409,
      headers: {},
      data: {
        statusCode: 409,
        code: 'edit_conflict',
        message: 'Someone else changed this field while you were editing it.',
        row_version: 4,
        conflicts: conflicts.map((conflict) => ({
          base: null, current: null, mine: null,
          labels: { base: null, current: null, mine: null },
          changed_by: { id: 'marie', name: 'Marie Dupont' },
          changed_at: '2026-10-02T12:02:00.000Z',
          ...conflict,
        })),
      },
    },
  });
}

async function settle() {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
  });
}

describe('editConflictsOf', () => {
  it('reads the conflicts of a 409 edit_conflict, nothing else', () => {
    const conflicts = editConflictsOf(conflictError([{ field: 'notes', base: 'a', current: 'b', mine: 'c' }]));
    expect(conflicts).toEqual([{
      field: 'notes', base: 'a', current: 'b', mine: 'c',
      labels: { base: null, current: null, mine: null },
      changed_by: { id: 'marie', name: 'Marie Dupont' },
      changed_at: '2026-10-02T12:02:00.000Z',
    }]);
    expect(classifySaveFailure(conflictError([{ field: 'notes' }]))).toEqual({ kind: 'edit_conflict' });
    const duplicate = Object.assign(new Error('x'), { response: { status: 409, data: { code: 'duplicate' } } });
    expect(editConflictsOf(duplicate)).toBeNull();
    // An answer without a conflict to show is no conflict to keep.
    expect(editConflictsOf(conflictError([]))).toBeNull();
  });

  it('works on nested paths (analytics values per dimension)', () => {
    const patch = { notes: 'x', analytics_values: { a: '1', b: null } };
    expect(omitPath(patch, 'analytics_values.a')).toEqual({ notes: 'x', analytics_values: { b: null } });
    expect(omitPath(omitPath(patch, 'analytics_values.a'), 'analytics_values.b')).toEqual({ notes: 'x' });
    expect(omitPath(patch, 'notes')).toEqual({ analytics_values: { a: '1', b: null } });
    expect(setPath({ notes: 'x' }, 'analytics_values.a', '2')).toEqual({ notes: 'x', analytics_values: { a: '2' } });
    expect(pickLike({ notes: 'n0', supplier_id: 's0', analytics_values: { a: '0', b: '9' } }, { notes: 'x', analytics_values: { a: '1' } }))
      .toEqual({ notes: 'n0', analytics_values: { a: '0' } });
  });
});

describe('patch buffer bases', () => {
  it('keeps the base of the first keystroke until the field is saved', () => {
    const buffer = createPatchBuffer<Patch>();
    buffer.add('A', { notes: 'x' }, { notes: 'n0' });
    buffer.add('A', { notes: 'xy' }, { notes: 'x' });
    expect(buffer.take()).toMatchObject({ patch: { notes: 'xy' }, base: { notes: 'n0' } });
  });

  it('a field typed again while it is sent starts from the value being sent; a busy answer gives back the first base', () => {
    const buffer = createPatchBuffer<Patch>();
    buffer.add('A', { notes: 'v1' }, { notes: 'n0' });
    const first = buffer.take()!;
    buffer.add('A', { notes: 'v2' }, { notes: 'v1' });
    buffer.putBack(first);
    expect(buffer.take()).toMatchObject({ patch: { notes: 'v2' }, base: { notes: 'n0' } });

    const other = createPatchBuffer<Patch>();
    other.add('A', { notes: 'v1' }, { notes: 'n0' });
    const sent = other.take()!;
    other.add('A', { notes: 'v2' }, { notes: 'v1' });
    other.settle(sent);
    // Saved: 'v1' is the stored value the next save starts from.
    expect(other.take()).toMatchObject({ patch: { notes: 'v2' }, base: { notes: 'v1' } });
  });

  it('a refused field gives its base back to a newer edit of the same field (the server still has it)', () => {
    const buffer = createPatchBuffer<Patch>();
    buffer.add('A', { notes: 'v1', supplier_id: 's1' }, { notes: 'n0', supplier_id: 's0' });
    const sent = buffer.take()!;
    buffer.add('A', { notes: 'v2' }, { notes: 'v1' });
    buffer.refuse(sent);
    expect(buffer.take()).toMatchObject({ patch: { notes: 'v2' }, base: { notes: 'n0' } });
  });

  it('keeps no base for a field the edit does not carry', () => {
    const buffer = createPatchBuffer<Patch>();
    buffer.add('A', { notes: 'x' }, { notes: 'n0', supplier_id: 's0' });
    expect(buffer.take()?.base).toEqual({ notes: 'n0' });
  });
});

describe('patch buffer conflicts', () => {
  function parked() {
    const buffer = createPatchBuffer<Patch>();
    buffer.add('A', { notes: 'mine', supplier_id: 's1', disabled_at: '2027-01-01', status: 'enabled' }, {
      notes: 'n0', supplier_id: 's0', disabled_at: null,
    });
    const taken = buffer.take()!;
    buffer.park(taken, [
      { field: 'notes', base: 'n0', current: 'theirs', mine: 'mine', labels: { base: null, current: null, mine: null }, changed_by: null, changed_at: null },
      { field: 'disabled_at', base: null, current: '2026-12-31', mine: '2027-01-01', labels: { base: null, current: null, mine: null }, changed_by: null, changed_at: null },
    ]);
    return buffer;
  }

  it('keeps the whole refused edit for the choice, held and not sendable', () => {
    const buffer = parked();
    expect(buffer.hasConflicts()).toBe(true);
    expect(buffer.conflictsOf('A').map((c) => c.field)).toEqual(['notes', 'disabled_at']);
    expect(buffer.take()).toBeNull();
    expect(buffer.holds('A', 'supplier_id')).toBe(true);
    expect(buffer.held('A')).toMatchObject({ notes: 'mine', supplier_id: 's1' });
    expect(buffer.isEmpty()).toBe(false);
  });

  it('keep theirs drops the field (and its companions), apply mine sends with their value as base, once all are decided', () => {
    const buffer = parked();
    expect(buffer.resolve('A', 'disabled_at', 'theirs', ['status'])).toBe(false);
    expect(buffer.conflictsOf('A').map((c) => c.field)).toEqual(['notes']);
    expect(buffer.take()).toBeNull();
    expect(buffer.resolve('A', 'notes', 'mine')).toBe(true);
    expect(buffer.hasConflicts()).toBe(false);
    expect(buffer.take()).toMatchObject({
      patch: { notes: 'mine', supplier_id: 's1' },
      base: { notes: 'theirs', supplier_id: 's0' },
    });
  });

  it('nothing left to send after keeping theirs for every field', () => {
    const buffer = createPatchBuffer<Patch>();
    buffer.add('A', { notes: 'mine' }, { notes: 'n0' });
    buffer.park(buffer.take()!, [{
      field: 'notes', base: 'n0', current: 'theirs', mine: 'mine', labels: { base: null, current: null, mine: null }, changed_by: null, changed_at: null,
    }]);
    expect(buffer.resolve('A', 'notes', 'theirs')).toBe(false);
    expect(buffer.isEmpty()).toBe(true);
    expect(buffer.holds('A', 'notes')).toBe(false);
  });

  it('a new edit of the item sends it all again (the server compares again); the conflicts show until the answer', () => {
    const buffer = parked();
    buffer.add('A', { notes: 'mine, longer' }, { notes: 'mine' });
    expect(buffer.conflictsOf('A')).toHaveLength(2);
    const again = buffer.take()!;
    expect(again.patch).toMatchObject({ notes: 'mine, longer', supplier_id: 's1' });
    // The base is still the one the edit started from.
    expect(again.base).toMatchObject({ notes: 'n0', supplier_id: 's0' });
    buffer.settle(again);
    expect(buffer.hasConflicts()).toBe(false);
  });

  it('a discard drops the conflicts and tells the screen', () => {
    const buffer = parked();
    const listener = vi.fn();
    buffer.subscribe(listener);
    buffer.discard();
    expect(listener).toHaveBeenCalled();
    expect(buffer.hasConflicts()).toBe(false);
    expect(buffer.isEmpty()).toBe(true);
  });
});

/** The page's wiring (SpendItemPage, CapexItemPage) on the real helpers, with a fake server per item. */
function usePage(itemId: string, calls: Array<[string, Patch, Patch]>, answer: (id: string, patch: Patch, base: Patch) => unknown) {
  const buffer = usePatchBuffer<Patch>();
  const registry = React.useMemo(() => createAutosaveRegistry(), []);
  const onError = React.useRef(vi.fn()).current;
  const autosave = useAutosave({ delay: 10, onError, registry, held: buffer.hasConflicts });
  const conflicts = useEditConflicts(buffer, itemId);
  const flushPending = React.useCallback(() => sendPatchBuffer(buffer, async (id, patch, base) => {
    calls.push([id, { ...patch }, { ...base }]);
    const error = answer(id, patch, base);
    if (error) throw error;
  }), [buffer]);
  const edit = (patch: Patch, base: Patch) => {
    buffer.add(itemId, patch, base);
    autosave.schedule(flushPending);
  };
  const resolve = (field: string, choice: 'theirs' | 'mine') => {
    if (buffer.resolve(itemId, field, choice)) autosave.schedule(flushPending);
  };
  return { autosave, buffer, registry, conflicts, edit, resolve, onError };
}

describe('autosave and a 409 edit_conflict', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  /** The server of one item: notes changed by Marie to 'theirs' since the screen read 'n0'. */
  function server() {
    const stored: Patch = { notes: 'theirs', supplier_id: 's0' };
    return {
      stored,
      answer: (_id: string, patch: Patch, base: Patch) => {
        const conflicts = Object.keys(patch)
          .filter((field) => field in base && base[field] !== stored[field] && patch[field] !== stored[field])
          .map((field) => ({ field, base: base[field], current: stored[field], mine: patch[field] }));
        if (conflicts.length > 0) return conflictError(conflicts);
        Object.assign(stored, patch);
        return null;
      },
    };
  }

  it('is a conflict state: kept, never retried, no error message, leaving asks first', async () => {
    const calls: Array<[string, Patch, Patch]> = [];
    const fake = server();
    const { result } = renderHook(() => usePage('A', calls, fake.answer));
    act(() => result.current.edit({ notes: 'mine', supplier_id: 's1' }, { notes: 'n0', supplier_id: 's0' }));
    await advance(10);
    await settle();
    // Far beyond any automatic retry.
    for (let i = 0; i < 5; i += 1) await advance(5_000);

    expect(calls).toHaveLength(1);
    expect(result.current.autosave.status).toBe('conflict');
    expect(result.current.onError).not.toHaveBeenCalled();
    expect(result.current.conflicts.map((c) => c.field)).toEqual(['notes']);
    // Nothing written: the supplier of the same request waits too.
    expect(fake.stored).toEqual({ notes: 'theirs', supplier_id: 's0' });
    expect(result.current.autosave.isBusy()).toBe(true);
    expect(result.current.registry.isBusy()).toBe(true);
    let flushed: boolean | undefined;
    await act(async () => { flushed = await result.current.autosave.flush(); });
    expect(flushed).toBe(false);
  });

  it('apply mine sends the edit again with their value as base', async () => {
    const calls: Array<[string, Patch, Patch]> = [];
    const fake = server();
    const { result } = renderHook(() => usePage('A', calls, fake.answer));
    act(() => result.current.edit({ notes: 'mine', supplier_id: 's1' }, { notes: 'n0', supplier_id: 's0' }));
    await advance(10);
    await settle();
    act(() => result.current.resolve('notes', 'mine'));
    await advance(10);
    await settle();
    expect(calls[1]).toEqual(['A', { notes: 'mine', supplier_id: 's1' }, { notes: 'theirs', supplier_id: 's0' }]);
    expect(fake.stored).toEqual({ notes: 'mine', supplier_id: 's1' });
    expect(result.current.autosave.status).toBe('saved');
    expect(result.current.conflicts).toEqual([]);
    expect(result.current.autosave.isBusy()).toBe(false);
  });

  it('keep theirs sends the rest of the edit without the field', async () => {
    const calls: Array<[string, Patch, Patch]> = [];
    const fake = server();
    const { result } = renderHook(() => usePage('A', calls, fake.answer));
    act(() => result.current.edit({ notes: 'mine', supplier_id: 's1' }, { notes: 'n0', supplier_id: 's0' }));
    await advance(10);
    await settle();
    act(() => result.current.resolve('notes', 'theirs'));
    await advance(10);
    await settle();
    expect(calls[1]).toEqual(['A', { supplier_id: 's1' }, { supplier_id: 's0' }]);
    expect(fake.stored).toEqual({ notes: 'theirs', supplier_id: 's1' });
    expect(result.current.buffer.holds('A', 'notes')).toBe(false);
    expect(result.current.autosave.isBusy()).toBe(false);
  });

  it('never leaks to another item: the next item is saved alone, the conflict waits on its own item', async () => {
    const calls: Array<[string, Patch, Patch]> = [];
    const fake = server();
    const { result, rerender } = renderHook(({ id }) => usePage(id, calls, (target, patch, base) => (
      target === 'A' ? fake.answer(target, patch, base) : null
    )), { initialProps: { id: 'A' } });
    act(() => result.current.edit({ notes: 'mine' }, { notes: 'n0' }));
    await advance(10);
    await settle();
    expect(result.current.conflicts).toHaveLength(1);

    // The page now shows B: no banner there, and B's edit goes to B alone.
    rerender({ id: 'B' });
    expect(result.current.conflicts).toEqual([]);
    act(() => result.current.edit({ notes: 'for B' }, { notes: 'b0' }));
    await advance(10);
    await settle();
    expect(calls.slice(1)).toEqual([['B', { notes: 'for B' }, { notes: 'b0' }]]);
    // A's edit is still waiting for the choice, on A.
    expect(result.current.buffer.held('A')).toEqual({ notes: 'mine' });
    expect(result.current.autosave.isBusy()).toBe(true);

    rerender({ id: 'A' });
    expect(result.current.conflicts.map((c) => c.field)).toEqual(['notes']);
  });

  it('leaving drops the edit waiting for a choice: it is never sent', async () => {
    const calls: Array<[string, Patch, Patch]> = [];
    const fake = server();
    const { result } = renderHook(() => usePage('A', calls, fake.answer));
    act(() => result.current.edit({ notes: 'mine' }, { notes: 'n0' }));
    await advance(10);
    await settle();
    // The page's "Leave without saving".
    act(() => {
      result.current.registry.discardAll();
      result.current.buffer.discard();
    });
    expect(result.current.registry.isBusy()).toBe(false);
    expect(result.current.conflicts).toEqual([]);
    let flushed: boolean | undefined;
    await act(async () => { flushed = await result.current.autosave.flush(); });
    expect(flushed).toBe(true);
    await advance(30_000);
    expect(calls).toHaveLength(1);
  });
});
