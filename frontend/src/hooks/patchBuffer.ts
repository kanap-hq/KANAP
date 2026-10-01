import { useRef } from 'react';
import { isTransientSaveFailure } from './useAutosave';

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
 * - `add` merges an edit over the fields already buffered for its item.
 * - `take` removes the oldest item's fields for sending; they count as held
 *   (`holds`) until `settle` or `putBack`.
 * - `putBack` returns fields whose save failed and will be sent again (a busy
 *   server, see `sendPatchBuffer`), under any edit typed on that item since.
 *   Fields taken before a `discard` are not put back.
 * - `discard` drops everything: the user chose to leave without it.
 */
export type TakenPatch<P> = { targetId: string; patch: P; generation: number };

export interface PatchBuffer<P extends object> {
  add: (targetId: string, patch: P) => void;
  take: () => TakenPatch<P> | null;
  putBack: (taken: TakenPatch<P>) => void;
  settle: (taken: TakenPatch<P>) => void;
  discard: () => void;
  isEmpty: () => boolean;
  /** Whether an item other than `targetId` has fields buffered (an edit left on the previous item). */
  holdsOtherThan: (targetId: string | null | undefined) => boolean;
  /** Whether a field of the item is buffered or being sent: the screen keeps its local value then. */
  holds: (targetId: string, field: string) => boolean;
  /** The item's buffered and in-flight fields, newest last (for re-applying them over a reload). */
  held: (targetId: string) => P | undefined;
  /** The items with fields buffered or being sent. */
  targets: () => string[];
}

const shallowMerge = <P extends object>(base: P, next: P): P => ({ ...base, ...next });

export function createPatchBuffer<P extends object>(merge: (base: P, next: P) => P = shallowMerge): PatchBuffer<P> {
  let generation = 0;
  const entries = new Map<string, P>();
  const inFlight = new Set<TakenPatch<P>>();
  const release = (taken: TakenPatch<P>) => { inFlight.delete(taken); };
  return {
    add(targetId, patch) {
      const current = entries.get(targetId);
      entries.set(targetId, current ? merge(current, patch) : patch);
    },
    take() {
      const first = entries.entries().next();
      if (first.done) return null;
      const [targetId, patch] = first.value;
      entries.delete(targetId);
      const taken = { targetId, patch, generation };
      inFlight.add(taken);
      return taken;
    },
    putBack(taken) {
      release(taken);
      if (taken.generation !== generation) return;
      const newer = entries.get(taken.targetId);
      entries.set(taken.targetId, newer ? merge(taken.patch, newer) : taken.patch);
    },
    settle: release,
    discard() {
      generation += 1;
      entries.clear();
      inFlight.clear();
    },
    isEmpty: () => entries.size === 0,
    holdsOtherThan(targetId) {
      for (const key of entries.keys()) if (key !== targetId) return true;
      return false;
    },
    holds(targetId, field) {
      const buffered = entries.get(targetId) as Record<string, unknown> | undefined;
      if (buffered && field in buffered) return true;
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
      const buffered = entries.get(targetId);
      if (buffered) result = result ? merge(result, buffered) : buffered;
      return result;
    },
    targets() {
      return [...new Set([...[...inFlight].map((taken) => taken.targetId), ...entries.keys()])];
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
 * save function for a page that buffers its fields.
 *
 * - Saved: `onSaved` (refresh the item's cache).
 * - Busy or a write at the same moment (transient): the fields go back into
 *   the buffer for the autosave's next attempt, and the error is thrown at
 *   once (the other items' fields wait with them).
 * - Refused for good (a conflict, a validation error): the fields are not put
 *   back, so a later edit never carries them again; `onRefused` lets the page
 *   show the item's server values again. The other items are still sent, and
 *   the first refusal is thrown at the end, for the autosave to report.
 */
export async function sendPatchBuffer<P extends object>(
  buffer: PatchBuffer<P>,
  send: (targetId: string, patch: P) => Promise<void>,
  handlers: {
    onSaved?: (targetId: string, patch: P) => void | Promise<void>;
    onRefused?: (targetId: string, patch: P, error: unknown) => void;
  } = {},
): Promise<void> {
  let refused: unknown = null;
  for (let taken = buffer.take(); taken; taken = buffer.take()) {
    try {
      await send(taken.targetId, taken.patch);
    } catch (error) {
      if (isTransientSaveFailure(error)) {
        buffer.putBack(taken);
        throw error;
      }
      buffer.settle(taken);
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
}
