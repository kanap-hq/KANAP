import { useRef } from 'react';
import { isTransientSaveFailure } from './useAutosave';
import {
  ConflictChoice,
  EditConflict,
  EditConflictSource,
  NO_CONFLICTS,
  editConflictsOf,
  getPath,
  hasPath,
  isEmptyPatch,
  mergeConflicts,
  omitLike,
  omitPath,
  pickLike,
  sameEditValue,
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
 * - `take` removes one item's fields for sending (an edit whose choices are
 *   made first, then the oldest item's); they count as held (`holds`) until
 *   `settle`, `refuse`, `park` or `putBack`.
 * - `putBack` returns fields whose save failed and will be sent again (a busy
 *   server, see `sendPatchBuffer`), under any edit typed on that item since.
 *   Fields taken before a `discard` are not put back.
 * - `refuse` drops fields refused for good; a newer edit of the same field
 *   goes back to the base the refused one had (the server still has it).
 * - `park` keeps fields refused with 409 `edit_conflict` until the user
 *   chooses (`resolve`). While they wait they are never sent with another
 *   edit (lot 3C review: the server checks a request before it compares it,
 *   so a refusal of the other field would drop them): an edit of another
 *   field of the item goes alone, an edit of a waiting field joins it and
 *   waits too (the banner shows that newer value as the user's). Once every
 *   choice is made, what is left goes in a request of its own, and the
 *   server compares again.
 * - `discard` drops everything: the user chose to leave without it.
 */
export type TakenPatch<P> = {
  targetId: string;
  patch: P;
  base: P;
  generation: number;
  /** An edit that waited for the user's choice: a busy answer keeps it apart again. */
  chosen?: boolean;
};

export interface PatchBuffer<P extends object> extends EditConflictSource {
  /**
   * `base`: per field of the patch, the value the screen showed before this edit (ignored for a
   * field already held). False when the whole edit joined fields waiting for a choice: nothing
   * to send, the caller schedules no save.
   */
  add: (targetId: string, patch: P, base?: P) => boolean;
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
   * (and `companions`, fields that only made sense with it, whose rows are
   * decided with it) from the waiting edit; `mine` keeps it with their value
   * as its base. True when the item's last conflict is decided and something
   * is left to send: the caller schedules a save.
   */
  resolve: (targetId: string, field: string, choice: ConflictChoice, companions?: string[]) => boolean;
  /** Whether a conflict waits for the user's choice (on any item). */
  hasConflicts: () => boolean;
  /** The item's edit waiting for a choice (its fields and the user's values), if any. */
  waiting: (targetId: string) => P | undefined;
  /**
   * Drops everything (the user chose to leave without it). `keepChoices`
   * keeps the edits waiting for a choice: the user leaves a save that fails,
   * not the choice the page still shows (a tab change).
   */
  discard: (options?: { keepChoices?: boolean }) => void;
  /** No field buffered or waiting for a choice. */
  isEmpty: () => boolean;
  /** Fields to send now: buffered, or waiting whose choices are made. */
  hasUnsent: () => boolean;
  /** Whether an item other than `targetId` has fields to send (an edit left on the previous item). */
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
  // Refused with 409 edit_conflict: waiting for the user's choice while `conflicts` has the item, then to send.
  const parked = new Map<string, Entry<P>>();
  const conflicts = new Map<string, readonly EditConflict[]>();
  let conflictTargets: readonly string[] = [];
  const listeners = new Set<() => void>();
  const notify = () => {
    const targets = [...conflicts.keys()];
    if (targets.length !== conflictTargets.length || targets.some((id, index) => id !== conflictTargets[index])) conflictTargets = targets;
    for (const listener of [...listeners]) listener();
  };
  const release = (taken: TakenPatch<P>) => { inFlight.delete(taken); };
  // `older` is sent first: its values lose to `newer`, its bases win.
  const combine = (older: Entry<P>, newer: Entry<P>): Entry<P> => ({ patch: merge(older.patch, newer.patch), base: merge(newer.base, older.base) });
  /** `entry` split in the fields `shape` holds and the others. */
  const split = (entry: Entry<P>, shape: P): [Entry<P>, Entry<P>] => [
    { patch: pickLike(entry.patch, shape), base: pickLike(entry.base, shape) },
    { patch: omitLike(entry.patch, shape), base: omitLike(entry.base, shape) },
  ];
  /**
   * The conflicts' `mine` follow the waiting edit: a field typed again after
   * the answer shows its newer value (the server's names only fit its own).
   */
  const followWaiting = (targetId: string) => {
    const list = conflicts.get(targetId);
    const kept = parked.get(targetId);
    if (!list || !kept) return;
    let changed = false;
    const next = list.map((conflict) => {
      if (!hasPath(kept.patch, conflict.field)) return conflict;
      const value = getPath(kept.patch, conflict.field);
      if (sameEditValue(value, conflict.mine)) return conflict;
      changed = true;
      const label = sameEditValue(value, conflict.current) ? conflict.labels.current
        : sameEditValue(value, conflict.base) ? conflict.labels.base : null;
      return { ...conflict, mine: value, labels: { ...conflict.labels, mine: label }, mineEdited: true };
    });
    if (changed) conflicts.set(targetId, next);
  };
  /** Keeps a taken edit apart until it is sent alone; edits of its fields typed meanwhile join it. */
  const keep = (taken: TakenPatch<P>) => {
    let kept: Entry<P> = { patch: taken.patch, base: taken.base };
    const newer = entries.get(taken.targetId);
    if (newer) {
      const [again, rest] = split(newer, taken.patch);
      if (!isEmptyPatch(again.patch)) {
        kept = combine(kept, again);
        if (isEmptyPatch(rest.patch)) entries.delete(taken.targetId);
        else entries.set(taken.targetId, rest);
      }
    }
    const already = parked.get(taken.targetId);
    parked.set(taken.targetId, already ? combine(already, kept) : kept);
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  };
  return {
    subscribe,
    add(targetId, patch, base) {
      let incoming: Entry<P> = { patch, base: pickLike(base ?? empty(), patch) };
      // A field waiting for a choice stays there with its newer value; the others go on their own.
      const kept = parked.get(targetId);
      if (kept) {
        const [again, rest] = split(incoming, kept.patch);
        if (!isEmptyPatch(again.patch)) {
          kept.patch = merge(kept.patch, again.patch);
          followWaiting(targetId);
          notify();
          incoming = rest;
          if (isEmptyPatch(incoming.patch)) return false;
        }
      }
      const current = entries.get(targetId);
      entries.set(targetId, current ? combine(current, incoming) : incoming);
      return true;
    },
    take() {
      // An edit whose choices are made goes first, and alone.
      for (const [targetId, entry] of parked) {
        if (conflicts.has(targetId)) continue;
        parked.delete(targetId);
        const taken = { targetId, patch: entry.patch, base: entry.base, generation, chosen: true };
        inFlight.add(taken);
        return taken;
      }
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
      if (taken.chosen) {
        keep(taken);
        return;
      }
      const newer = entries.get(taken.targetId);
      const sent = { patch: taken.patch, base: taken.base };
      entries.set(taken.targetId, newer ? combine(sent, newer) : sent);
    },
    settle(taken) {
      release(taken);
    },
    refuse(taken) {
      release(taken);
      if (taken.generation !== generation) return;
      const newer = entries.get(taken.targetId);
      if (newer) newer.base = merge(newer.base, pickLike(taken.base, newer.patch));
    },
    park(taken, list) {
      release(taken);
      if (taken.generation !== generation) return;
      keep(taken);
      conflicts.set(taken.targetId, mergeConflicts(conflicts.get(taken.targetId), list));
      followWaiting(taken.targetId);
      notify();
    },
    resolve(targetId, field, choice, companions = []) {
      const list = conflicts.get(targetId);
      const conflict = list?.find((entry) => entry.field === field);
      if (!list || !conflict) return false;
      const kept = parked.get(targetId);
      const decided = new Set([field]);
      if (kept) {
        if (choice === 'theirs') {
          for (const path of [field, ...companions]) {
            kept.patch = omitPath(kept.patch, path);
            kept.base = omitPath(kept.base, path);
            decided.add(path);
          }
        } else if (hasPath(kept.patch, field)) {
          kept.base = setPath(kept.base, field, conflict.current);
        }
      }
      const rest = list.filter((entry) => !decided.has(entry.field));
      if (rest.length > 0) {
        conflicts.set(targetId, rest);
        notify();
        return false;
      }
      conflicts.delete(targetId);
      // Every choice made: what is left goes alone (`take`), nothing left drops the edit.
      if (kept && isEmptyPatch(kept.patch)) parked.delete(targetId);
      notify();
      return parked.has(targetId);
    },
    conflictsOf: (targetId) => conflicts.get(targetId) ?? NO_CONFLICTS,
    conflictTargets: () => conflictTargets,
    hasConflicts: () => conflicts.size > 0,
    waiting: (targetId) => parked.get(targetId)?.patch,
    discard(options) {
      generation += 1;
      entries.clear();
      inFlight.clear();
      if (options?.keepChoices) return;
      parked.clear();
      if (conflicts.size > 0) {
        conflicts.clear();
        notify();
      }
    },
    isEmpty: () => entries.size === 0 && parked.size === 0,
    hasUnsent() {
      if (entries.size > 0) return true;
      for (const targetId of parked.keys()) if (!conflicts.has(targetId)) return true;
      return false;
    },
    holdsOtherThan(targetId) {
      for (const key of entries.keys()) if (key !== targetId) return true;
      for (const key of parked.keys()) if (key !== targetId && !conflicts.has(key)) return true;
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

/*
 * Buffers kept for the whole session, one per kind of page (lot 3C review).
 * A page left another way than through its own controls (the browser's back
 * button, a save answered after the page went) must not lose an edit waiting
 * for a choice: coming back to the item shows the choice and the user's
 * values again, and leaving still asks. Cleared when the session ends or
 * another one starts (`resetSharedPatchBuffers`, AuthContext); another tenant
 * is another address, so another page load.
 */
const sharedBuffers = new Map<string, PatchBuffer<any>>();

export function sharedPatchBuffer<P extends object>(key: string, merge?: (base: P, next: P) => P): PatchBuffer<P> {
  let buffer = sharedBuffers.get(key) as PatchBuffer<P> | undefined;
  if (!buffer) {
    buffer = createPatchBuffer<P>(merge);
    sharedBuffers.set(key, buffer);
  }
  return buffer;
}

/** The session's buffer for this kind of page (`opex`, `capex`), the same one each time the page mounts. */
export function useSharedPatchBuffer<P extends object>(key: string, merge?: (base: P, next: P) => P): PatchBuffer<P> {
  const ref = useRef<PatchBuffer<P> | null>(null);
  if (!ref.current) ref.current = sharedPatchBuffer<P>(key, merge);
  return ref.current;
}

/** Drops every page's kept edits: the session ended (logout, expiry) or another one starts. */
export function resetSharedPatchBuffers(): void {
  for (const buffer of sharedBuffers.values()) buffer.discard();
  sharedBuffers.clear();
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
