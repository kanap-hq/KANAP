import { useRef } from 'react';
import { isTransientSaveFailure } from './useAutosave';
import {
  ConflictChoice,
  EditConflict,
  EditConflictSource,
  NO_CONFLICTS,
  editConflictsOf,
  hasPath,
  omitPath,
  pickLike,
  setPath,
} from './editConflicts';

/**
 * The fields a workspace page has edited and not saved yet, kept per item.
 *
 * A workspace page stays mounted from one item to the next (prev/next, a
 * link, the browser's back button only change the route's id), and its
 * debounced autosave sends what the user typed a moment later. Each edit is
 * therefore buffered with the id of the item it was typed on, and sent to
 * that item, whatever the page shows by then: a field typed on one item is
 * never sent to another.
 *
 * Each field also keeps its base (lot 3C, `editConflicts.ts`): the value the
 * screen showed when the edit of that field began. The first base of a field
 * wins until the field is saved: a field typed again while it is pending or
 * being sent keeps the base of its first keystroke, so someone else's change
 * meanwhile is still seen by the server.
 *
 * - `add` merges an edit over the fields already buffered for its item.
 * - `take` removes the oldest item's fields for sending; they count as held
 *   (`holds`) until `settle`, `refuse`, `park` or `putBack`.
 * - `putBack` returns fields whose save failed and will be sent again (a busy
 *   server, see `sendPatchBuffer`), under any edit typed on that item since.
 *   Fields taken before a `discard` are not put back.
 * - `refuse` drops fields refused for good; a newer edit of the same field
 *   goes back to the base the refused one had (the server still has it).
 * - `park` keeps fields refused with 409 `edit_conflict` until the user
 *   chooses (`resolve`); a new edit of that item sends them again, and the
 *   server compares again.
 * - `discard` drops everything: the user chose to leave without it.
 */
export type TakenPatch<P> = { targetId: string; patch: P; base: P; generation: number };

export interface PatchBuffer<P extends object> extends EditConflictSource {
  /** `base`: per field of the patch, the value the screen showed before this edit (ignored for a field already held). */
  add: (targetId: string, patch: P, base?: P) => void;
  take: () => TakenPatch<P> | null;
  putBack: (taken: TakenPatch<P>) => void;
  /** The taken fields are saved. */
  settle: (taken: TakenPatch<P>) => void;
  /** The taken fields were refused for good. */
  refuse: (taken: TakenPatch<P>) => void;
  /** The taken fields were refused because someone else changed some of them: kept until the user chooses. */
  park: (taken: TakenPatch<P>, conflicts: EditConflict[]) => void;
  /**
   * The user's choice for one conflicting field: `theirs` drops the field
   * (and `companions`, fields that only made sense with it) from the pending
   * edit; `mine` keeps it with their value as its base. True when the item's
   * last conflict is decided and something is left to send: the caller
   * schedules a save.
   */
  resolve: (targetId: string, field: string, choice: ConflictChoice, companions?: string[]) => boolean;
  /** Whether a conflict waits for the user's choice (on any item). */
  hasConflicts: () => boolean;
  discard: () => void;
  /** No field buffered or waiting for a choice. */
  isEmpty: () => boolean;
  /** Whether an item other than `targetId` has fields buffered (an edit left on the previous item). */
  holdsOtherThan: (targetId: string | null | undefined) => boolean;
  /** Whether a field of the item is buffered, being sent or waiting for a choice: the screen keeps its local value then. */
  holds: (targetId: string, field: string) => boolean;
  /** The item's held fields, newest last (for re-applying them over a reload). */
  held: (targetId: string) => P | undefined;
  /** The items with fields held. */
  targets: () => string[];
}

type Entry<P> = { patch: P; base: P };

const shallowMerge = <P extends object>(base: P, next: P): P => ({ ...base, ...next });

export function createPatchBuffer<P extends object>(merge: (base: P, next: P) => P = shallowMerge): PatchBuffer<P> {
  let generation = 0;
  const empty = () => ({}) as P;
  const entries = new Map<string, Entry<P>>();
  const inFlight = new Set<TakenPatch<P>>();
  // Refused with 409 edit_conflict, waiting for the user's choice.
  const parked = new Map<string, Entry<P>>();
  const conflicts = new Map<string, readonly EditConflict[]>();
  const listeners = new Set<() => void>();
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const release = (taken: TakenPatch<P>) => { inFlight.delete(taken); };
  // `older` is sent first: its values lose to `newer`, its bases win.
  const combine = (older: Entry<P>, newer: Entry<P>): Entry<P> => ({ patch: merge(older.patch, newer.patch), base: merge(newer.base, older.base) });
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return {
    subscribe,
    add(targetId, patch, base) {
      const incoming: Entry<P> = { patch, base: pickLike(base ?? empty(), patch) };
      // An item waiting for a choice goes again with this edit: the server compares again (fresh who and when).
      const waiting = parked.get(targetId);
      if (waiting) parked.delete(targetId);
      const current = waiting ?? entries.get(targetId);
      entries.set(targetId, current ? combine(current, incoming) : incoming);
    },
    take() {
      const first = entries.entries().next();
      if (first.done) return null;
      const [targetId, entry] = first.value;
      entries.delete(targetId);
      const taken = { targetId, patch: entry.patch, base: entry.base, generation };
      inFlight.add(taken);
      return taken;
    },
    putBack(taken) {
      release(taken);
      if (taken.generation !== generation) return;
      const newer = entries.get(taken.targetId);
      const sent = { patch: taken.patch, base: taken.base };
      entries.set(taken.targetId, newer ? combine(sent, newer) : sent);
    },
    settle(taken) {
      release(taken);
      // Saved: whatever the item was asked to choose is settled with it.
      if (!parked.has(taken.targetId) && conflicts.delete(taken.targetId)) notify();
    },
    refuse(taken) {
      release(taken);
      if (taken.generation !== generation) return;
      const newer = entries.get(taken.targetId);
      if (newer) newer.base = merge(newer.base, pickLike(taken.base, newer.patch));
      if (!parked.has(taken.targetId) && conflicts.delete(taken.targetId)) notify();
    },
    park(taken, list) {
      release(taken);
      if (taken.generation !== generation) return;
      const newer = entries.get(taken.targetId);
      entries.delete(taken.targetId);
      const sent = { patch: taken.patch, base: taken.base };
      parked.set(taken.targetId, newer ? combine(sent, newer) : sent);
      conflicts.set(taken.targetId, list);
      notify();
    },
    resolve(targetId, field, choice, companions = []) {
      const list = conflicts.get(targetId);
      const conflict = list?.find((entry) => entry.field === field);
      if (!list || !conflict) return false;
      const holder = parked.get(targetId) ?? entries.get(targetId);
      if (holder) {
        if (choice === 'theirs') {
          for (const path of [field, ...companions]) {
            holder.patch = omitPath(holder.patch, path);
            holder.base = omitPath(holder.base, path);
          }
        } else if (hasPath(holder.patch, field)) {
          holder.base = setPath(holder.base, field, conflict.current);
        }
      }
      const rest = list.filter((entry) => entry !== conflict);
      if (rest.length > 0) {
        conflicts.set(targetId, rest);
        notify();
        return false;
      }
      conflicts.delete(targetId);
      const waiting = parked.get(targetId);
      if (waiting) {
        parked.delete(targetId);
        if (Object.keys(waiting.patch).length > 0) entries.set(targetId, waiting);
      }
      notify();
      return entries.has(targetId);
    },
    conflictsOf: (targetId) => conflicts.get(targetId) ?? NO_CONFLICTS,
    hasConflicts: () => conflicts.size > 0,
    discard() {
      generation += 1;
      entries.clear();
      inFlight.clear();
      parked.clear();
      if (conflicts.size > 0) {
        conflicts.clear();
        notify();
      }
    },
    isEmpty: () => entries.size === 0 && parked.size === 0,
    holdsOtherThan(targetId) {
      for (const key of entries.keys()) if (key !== targetId) return true;
      return false;
    },
    holds(targetId, field) {
      for (const entry of [entries.get(targetId), parked.get(targetId)]) {
        if (entry && field in (entry.patch as Record<string, unknown>)) return true;
      }
      for (const taken of inFlight) {
        if (taken.targetId === targetId && field in (taken.patch as Record<string, unknown>)) return true;
      }
      return false;
    },
    held(targetId) {
      let result: P | undefined;
      for (const taken of inFlight) {
        if (taken.targetId === targetId) result = result ? merge(result, taken.patch) : taken.patch;
      }
      for (const entry of [parked.get(targetId), entries.get(targetId)]) {
        if (entry) result = result ? merge(result, entry.patch) : entry.patch;
      }
      return result;
    },
    targets() {
      return [...new Set([...[...inFlight].map((taken) => taken.targetId), ...entries.keys(), ...parked.keys()])];
    },
  };
}

/** One buffer for the page's lifetime. */
export function usePatchBuffer<P extends object>(merge?: (base: P, next: P) => P): PatchBuffer<P> {
  const ref = useRef<PatchBuffer<P> | null>(null);
  if (!ref.current) ref.current = createPatchBuffer<P>(merge);
  return ref.current;
}

/**
 * Sends every buffered edit to its own item, oldest first; the autosave's
 * save function for a page that buffers its fields. `send` gets the fields'
 * bases too (a page that compares them puts them in the body's `base`).
 *
 * - Saved: `onSaved` (refresh the item's cache).
 * - Busy or a write at the same moment (transient): the fields go back into
 *   the buffer for the autosave's next attempt, and the error is thrown at
 *   once (the other items' fields wait with them).
 * - Someone else changed a field meanwhile (409 `edit_conflict`): the fields
 *   are kept for the user's choice (`park`), `onConflict` lets the page
 *   reload the item; the other items are still sent.
 * - Refused for good (a duplicate, a validation error): the fields are not
 *   put back, so a later edit never carries them again; `onRefused` lets the
 *   page show the item's server values again. The other items are still sent.
 * At the end a refusal is thrown for the autosave to report, else a conflict
 * (the autosave's `conflict` state).
 */
export async function sendPatchBuffer<P extends object>(
  buffer: PatchBuffer<P>,
  send: (targetId: string, patch: P, base: P) => Promise<void>,
  handlers: {
    onSaved?: (targetId: string, patch: P) => void | Promise<void>;
    onRefused?: (targetId: string, patch: P, error: unknown) => void;
    onConflict?: (targetId: string, conflicts: EditConflict[]) => void;
  } = {},
): Promise<void> {
  let refused: unknown = null;
  let conflicted: unknown = null;
  for (let taken = buffer.take(); taken; taken = buffer.take()) {
    try {
      await send(taken.targetId, taken.patch, taken.base);
    } catch (error) {
      if (isTransientSaveFailure(error)) {
        buffer.putBack(taken);
        throw error;
      }
      const conflicts = editConflictsOf(error);
      if (conflicts) {
        buffer.park(taken, conflicts);
        handlers.onConflict?.(taken.targetId, conflicts);
        conflicted ??= error;
        continue;
      }
      buffer.refuse(taken);
      handlers.onRefused?.(taken.targetId, taken.patch, error);
      refused ??= error;
      continue;
    }
    try {
      await handlers.onSaved?.(taken.targetId, taken.patch);
    } finally {
      buffer.settle(taken);
    }
  }
  if (refused) throw refused;
  if (conflicted) throw conflicted;
}
