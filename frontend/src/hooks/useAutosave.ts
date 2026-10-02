import { useCallback, useEffect, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { getApiErrorMessage } from '../utils/apiErrorMessage';
import { EDIT_CONFLICT_CODE } from './editConflicts';

/** `conflict`: someone else changed a field being saved; the edit waits for the user's choice (lot 3C). */
export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error' | 'conflict';

/**
 * What a failed save means for the autosave, from the API's answer (the
 * backend's database error codes, plan planning/perf-scale lot 1D):
 * - `transient`: 409 `retry` (another write to the same data at the same
 *   moment) or 503 `busy` (the data is held by a long operation, or the
 *   server is saturated). The same save can go through a moment later: it is
 *   retried by itself a few times, then kept (see useAutosave);
 * - `conflict`: 409 `duplicate`, `parent_gone` or `in_use`. Sending the same
 *   save again fails the same way: it is reported and dropped, and the page
 *   rolls the screen back to the server's values;
 * - `edit_conflict`: 409 `edit_conflict` (lot 3C): someone else changed a
 *   field of this save since the user's edit began. Neither retried nor
 *   dropped: the page keeps the edit for the user's choice (`PatchBuffer.park`)
 *   and the autosave shows the `conflict` state, without an error message;
 * - `fatal`: anything else. Reported and dropped.
 */
export type SaveFailure = { kind: 'transient' | 'conflict' | 'edit_conflict' | 'fatal'; retryAfterMs?: number };

/**
 * Whether a failed save is kept to be sent again (409 `retry`, 503 `busy`).
 * A save that takes its payload out of a buffer before sending puts it back
 * only then (see `sendPatchBuffer`): any other failure drops the payload, so a
 * refused field is never sent again with the next edit.
 */
export function isTransientSaveFailure(error: unknown): boolean {
  return classifySaveFailure(error).kind === 'transient';
}

/**
 * Waits before each automatic retry of a transient failure. Three retries per
 * pending edit in all, flushes included: a new edit gives a fresh three. The
 * wait is the longer of this and the server's Retry-After (the backend sends
 * a fixed 2 s), so the waits grow: 2, 2, 4 s on a busy answer.
 */
export const AUTOSAVE_RETRY_DELAYS_MS: readonly number[] = [1_000, 2_000, 4_000];
/** Ceiling for a wait the server asks for in Retry-After. */
const MAX_RETRY_AFTER_MS = 10_000;

const CONFLICT_CODES = new Set(['duplicate', 'parent_gone', 'in_use']);

export function classifySaveFailure(error: unknown): SaveFailure {
  const response = (error as { response?: { status?: number; data?: { code?: unknown }; headers?: Record<string, unknown> } } | null)?.response;
  const status = response?.status;
  const code = typeof response?.data?.code === 'string' ? response.data.code : undefined;
  if ((status === 409 && code === 'retry') || (status === 503 && code === 'busy')) {
    const seconds = Number(String(response?.headers?.['retry-after'] ?? '').trim() || NaN);
    return {
      kind: 'transient',
      retryAfterMs: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, MAX_RETRY_AFTER_MS) : undefined,
    };
  }
  if (status === 409 && code && CONFLICT_CODES.has(code)) return { kind: 'conflict' };
  if (status === 409 && code === EDIT_CONFLICT_CODE) return { kind: 'edit_conflict' };
  return { kind: 'fatal' };
}

/**
 * The message for an autosave error. A transient one reaches the screen only
 * once its retries are spent, while the edit is still kept: it says the change
 * is not saved yet, not that it was refused.
 */
export function autosaveErrorMessage(error: unknown, t: TFunction, fallback: string): string {
  return isTransientSaveFailure(error) ? t('errors:notSavedYet') : getApiErrorMessage(error, t, fallback);
}

/**
 * Serializes the save tasks of several autosave controllers that write to the
 * SAME entity. Endpoints that replace a JSON column wholesale (agent policy
 * JSON) lose updates when two PATCHes overlap: the second one was computed from
 * a snapshot taken before the first one landed. Sharing one queue makes the
 * PATCHes strictly sequential, so every task reads a definition that already
 * includes the previous task's result.
 */
export interface AutosaveQueue {
  /** Run `task` after every task already queued, whatever their outcome. */
  run: (task: () => Promise<void>) => Promise<void>;
}

const ignore = () => undefined;

export function createAutosaveQueue(): AutosaveQueue {
  let tail: Promise<unknown> = Promise.resolve();
  return {
    run(task) {
      // Chain on both outcomes: one failing save must never block the queue.
      const result = tail.then(task, task);
      tail = result.then(ignore, ignore);
      return result;
    },
  };
}

/** Stable per-component queue instance. */
export function useAutosaveQueue(): AutosaveQueue {
  const ref = useRef<AutosaveQueue | null>(null);
  if (!ref.current) ref.current = createAutosaveQueue();
  return ref.current;
}

export type FlushOptions = {
  /**
   * Edits waiting for the user's choice (`held`) do not make the flush fail:
   * a move that keeps the page and its conflict banner (a tab change) only
   * waits for the saves that can go.
   */
  ignoreHeld?: boolean;
};

export interface AutosaveHandle {
  /** See {@link AutosaveController.flush}. */
  flush: (options?: FlushOptions) => Promise<boolean>;
  /** See {@link AutosaveController.isBusy}. */
  isBusy: () => boolean;
  /** See {@link AutosaveController.discard}. */
  discard: () => void;
}

/**
 * Collects the autosave controllers of a screen so an ancestor can drain them
 * all before a controlled transition (tab change, close) unmounts them, and so
 * a hard unload can at least warn the user.
 */
export interface AutosaveRegistry {
  /** Register a controller; returns the unregister function. */
  register: (handle: AutosaveHandle) => () => void;
  /** Drain every registered controller. False if any save rejected. */
  flushAll: () => Promise<boolean>;
  /** True when any registered controller has pending or in-flight work. */
  isBusy: () => boolean;
  /** Drop every registered controller's pending work (the user chose to leave without it). */
  discardAll: () => void;
}

export function createAutosaveRegistry(): AutosaveRegistry {
  const handles = new Set<AutosaveHandle>();
  return {
    register(handle) {
      handles.add(handle);
      return () => {
        handles.delete(handle);
      };
    },
    async flushAll() {
      const results = await Promise.all(
        [...handles].map((handle) => handle.flush().catch(() => false)),
      );
      return results.every(Boolean);
    },
    isBusy() {
      return [...handles].some((handle) => handle.isBusy());
    },
    discardAll() {
      for (const handle of handles) handle.discard();
    },
  };
}

/**
 * Stable registry instance + a best-effort guard on hard unloads: the browser
 * confirmation dialog is the only thing that can keep an unsaved edit alive
 * there, so it is raised whenever a registered controller is still busy.
 */
export function useAutosaveRegistry(): AutosaveRegistry {
  const ref = useRef<AutosaveRegistry | null>(null);
  if (!ref.current) ref.current = createAutosaveRegistry();
  const registry = ref.current;
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!registry.isBusy()) return;
      // Fire the debounced save immediately — it may still reach the server
      // while the browser asks for confirmation.
      void registry.flushAll();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [registry]);
  return registry;
}

export interface UseAutosaveOptions {
  /** Debounce window before a scheduled save fires (ms). */
  delay?: number;
  /** How long the transient "Saved" state lingers before returning to idle (ms). */
  savedLingerMs?: number;
  /** Called when a save rejects. The error status is surfaced regardless. */
  onError?: (error: unknown) => void;
  /** Shared queue serializing this controller's saves with its siblings'. */
  queue?: AutosaveQueue;
  /** Registry an ancestor can use to flush this controller before unmounting it. */
  registry?: AutosaveRegistry;
  /**
   * Edits kept outside the controller until the user decides: the page's
   * unresolved edit conflicts (`PatchBuffer.hasConflicts`, lot 3C). While it
   * is true the controller is busy (leaving asks for confirmation, a hard
   * unload warns) and a flush resolves false: nothing can save them without
   * the user's choice.
   */
  held?: () => boolean;
}

export interface AutosaveController {
  /** Reactive status for a subtle "Saving… / Saved" indicator. */
  status: AutosaveStatus;
  /**
   * Schedule a debounced save. The most recently scheduled save wins; if a save
   * is already in flight, the latest pending one runs immediately after it.
   */
  schedule: (save: () => Promise<void>) => void;
  /**
   * Cancel the debounce and run any pending/in-flight save now, resolving when
   * fully drained. Use on controlled transitions (tab/year/prev/next/close/Escape)
   * where persistence must complete before navigating. Resolves to false if the
   * save rejected (caller should abort the navigation to avoid losing the edit),
   * or while edits wait for the user's choice (`held`), unless `ignoreHeld`.
   */
  flush: (options?: FlushOptions) => Promise<boolean>;
  /** True when a save is pending (debouncing, or kept after a transient failure), in flight, or held for the user's choice (`held`). */
  isBusy: () => boolean;
  /** True when a save is pending or in flight (the edits waiting for a choice aside). */
  isSaving: () => boolean;
  /** The user made every choice and nothing was left to send: the `conflict` state ends. */
  resetConflict: () => void;
  /**
   * Drop the pending save, the one kept after a failure included, without
   * sending it: the user chose to leave without it. A request already in
   * flight still lands or fails, but is neither retried nor kept nor
   * reported. The caller drops its own buffered payload and shows the
   * server's values again.
   */
  discard: () => void;
}

/**
 * Debounced autosave orchestrator with an awaitable flush.
 *
 * State machine invariant: once work is scheduled, the controller always ends up
 * in `saved` or `error` — never stranded in `pending`/`saving`. Every path that
 * can drop the work (a throwing save, an uncontrolled unmount) either drains it
 * or reports the failure.
 *
 * Hard unloads (tab close / refresh) cannot reliably await an async PATCH — see
 * the bounded-flush note in the OPEX revamp plan. Reliable persistence is only
 * guaranteed on controlled transitions that call `flush()` (see
 * {@link useAutosaveRegistry} for flushing a whole screen at once).
 *
 * A failed save is classified by {@link classifySaveFailure}:
 * - transient: retried in place (status stays `saving`), at most three times
 *   per pending edit in all ({@link AUTOSAVE_RETRY_DELAYS_MS}); a new edit
 *   (schedule) gives a fresh three. Once they are spent the save is kept
 *   pending (`isBusy()` stays true, status `error`, reported once): the next
 *   edit sends it again, an explicit flush makes one more attempt, and a page
 *   lets the user leave without it after a confirmation (`discard`). A kept
 *   save must be safe to run again: a caller that takes its payload out of a
 *   buffer puts it back on a transient failure only;
 * - edit_conflict: neither retried nor reported through `onError`; the save
 *   function has kept its payload for the user's choice, the status becomes
 *   `conflict` while `held` says so;
 * - conflict or anything else: reported and dropped. A save scheduled while
 *   it was in flight still runs, the failure is reported once it has.
 */
export default function useAutosave(options?: UseAutosaveOptions): AutosaveController {
  const delay = options?.delay ?? 700;
  const savedLingerMs = options?.savedLingerMs ?? 1500;
  const onError = options?.onError;
  const registry = options?.registry;
  // Read at call time: the page's buffer may be created after the controller.
  const heldRef = useRef(options?.held);
  heldRef.current = options?.held;

  const [status, setStatus] = useState<AutosaveStatus>('idle');

  const timerRef = useRef<number | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<null | (() => Promise<void>)>(null);
  // Automatic retries left for the pending edit, across drains and flushes; a new edit resets them.
  const retriesLeftRef = useRef(AUTOSAVE_RETRY_DELAYS_MS.length);
  // Bumped by discard(): a save started before it is neither retried, kept nor reported.
  const generationRef = useRef(0);
  const drainingRef = useRef<Promise<void> | null>(null);
  // Read at execution time so a queue/handler swap never strands a running drain.
  const queueRef = useRef(options?.queue);
  queueRef.current = options?.queue;

  const clearTimer = () => {
    if (timerRef.current != null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };
  const clearSavedTimer = () => {
    if (savedTimerRef.current != null) {
      window.clearTimeout(savedTimerRef.current);
      savedTimerRef.current = null;
    }
  };

  const drain = useCallback(async (): Promise<void> => {
    // Coalesce concurrent drains onto a single in-flight promise.
    if (drainingRef.current) return drainingRef.current;
    // Nothing to run (e.g. the debounce fires after the running loop already
    // picked the work up): that loop has set the terminal status itself.
    if (!pendingRef.current) return;
    let run: Promise<void> | null = null;
    run = (async () => {
      // Yield once so `drainingRef` is assigned before `finally` can clear it;
      // a save that throws synchronously would otherwise strand a settled marker.
      await Promise.resolve();
      // A save dropped while a newer one was pending: reported once the loop ends.
      let dropped: unknown = null;
      // A save kept for the user's choice (409 edit_conflict): the `conflict` state once the loop ends.
      let conflicted: unknown = null;
      let saved = false;
      try {
        while (pendingRef.current) {
          const fn = pendingRef.current;
          const generation = generationRef.current;
          pendingRef.current = null;
          setStatus('saving');
          const queue = queueRef.current;
          try {
            // Serialized with the sibling controllers when a queue is shared, so
            // two sections never PATCH the same entity concurrently.
            await (queue ? queue.run(fn) : fn());
            if (generation === generationRef.current) saved = true;
          } catch (error) {
            // Discarded while in flight: nothing to keep, retry or report.
            if (generation !== generationRef.current) continue;
            const failure = classifySaveFailure(error);
            if (failure.kind === 'edit_conflict') {
              conflicted ??= error;
              continue;
            }
            if (failure.kind !== 'transient') {
              // Dropped; a save scheduled meanwhile carries only newer edits and still goes.
              dropped ??= error;
              continue;
            }
            // Kept. A save scheduled meanwhile carries this one's payload too
            // (callers put a transient payload back), so it goes instead.
            if (!pendingRef.current) pendingRef.current = fn;
            if (retriesLeftRef.current === 0) throw error;
            const attempt = AUTOSAVE_RETRY_DELAYS_MS.length - retriesLeftRef.current;
            retriesLeftRef.current -= 1;
            const wait = Math.max(failure.retryAfterMs ?? 0, AUTOSAVE_RETRY_DELAYS_MS[attempt]);
            await new Promise((resolve) => window.setTimeout(resolve, wait));
          }
        }
        if (dropped) throw dropped;
        // Still waiting for a choice (a later save may have carried it already).
        if (conflicted && (!heldRef.current || heldRef.current())) throw conflicted;
        if (!saved) {
          // A conflict already decided, nothing saved since: nothing pending either.
          if (conflicted) setStatus('idle');
          // Everything left was discarded: discard() already set the status.
          return;
        }
        retriesLeftRef.current = AUTOSAVE_RETRY_DELAYS_MS.length;
        setStatus('saved');
        clearSavedTimer();
        savedTimerRef.current = window.setTimeout(() => {
          savedTimerRef.current = null;
          setStatus('idle');
        }, savedLingerMs);
      } catch (error) {
        if (classifySaveFailure(error).kind === 'edit_conflict') {
          // Kept by the page, shown by its conflict banner: not an error message.
          setStatus('conflict');
        } else {
          setStatus('error');
          onError?.(error);
        }
        throw error;
      } finally {
        if (drainingRef.current === run) drainingRef.current = null;
      }
    })();
    drainingRef.current = run;
    return run;
  }, [onError, savedLingerMs]);

  const schedule = useCallback((save: () => Promise<void>) => {
    pendingRef.current = save;
    // A new edit: a fresh set of automatic retries.
    retriesLeftRef.current = AUTOSAVE_RETRY_DELAYS_MS.length;
    clearTimer();
    clearSavedTimer();
    setStatus('pending');
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      try {
        void drain().catch(() => {
          /* surfaced via status / onError */
        });
      } catch (error) {
        // drain() is async and should never throw synchronously; if it ever
        // does, the controller must still land in a terminal state.
        pendingRef.current = null;
        setStatus('error');
        onError?.(error);
      }
    }, delay);
  }, [delay, drain, onError]);

  const flush = useCallback(async (options?: FlushOptions): Promise<boolean> => {
    clearTimer();
    if (pendingRef.current || drainingRef.current) {
      // A save scheduled while the drain was finishing still needs its own run.
      for (let round = 0; round === 0 || (round === 1 && pendingRef.current); round += 1) {
        try {
          await drain();
        } catch (error) {
          // An answer kept for the user's choice, when the caller keeps the page and its banner.
          if (options?.ignoreHeld && classifySaveFailure(error).kind === 'edit_conflict') continue;
          // Surfaced via status / onError. Report failure so callers can abort navigation.
          return false;
        }
      }
    }
    // Edits waiting for the user's choice cannot be flushed.
    return !!options?.ignoreHeld || !heldRef.current?.();
  }, [drain]);

  const discard = useCallback(() => {
    clearTimer();
    clearSavedTimer();
    pendingRef.current = null;
    generationRef.current += 1;
    retriesLeftRef.current = AUTOSAVE_RETRY_DELAYS_MS.length;
    setStatus('idle');
  }, []);

  const isSaving = useCallback(() => pendingRef.current != null || drainingRef.current != null, []);
  const isBusy = useCallback(() => isSaving() || !!heldRef.current?.(), [isSaving]);
  const resetConflict = useCallback(() => {
    setStatus((current) => (current === 'conflict' && !heldRef.current?.() ? 'idle' : current));
  }, []);

  // Stable handle over the latest closures, so registering/unregistering does
  // not churn every render.
  const latestHandleRef = useRef<AutosaveHandle>({ flush, isBusy, discard });
  latestHandleRef.current = { flush, isBusy, discard };
  const handleRef = useRef<AutosaveHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = {
      flush: (options) => latestHandleRef.current.flush(options),
      isBusy: () => latestHandleRef.current.isBusy(),
      discard: () => latestHandleRef.current.discard(),
    };
  }
  const handle = handleRef.current;

  useEffect(() => {
    if (!registry) return undefined;
    return registry.register(handle);
  }, [registry, handle]);

  const drainRef = useRef(drain);
  drainRef.current = drain;
  useEffect(() => () => {
    clearTimer();
    clearSavedTimer();
    // Uncontrolled unmount (route change, back button, a parent that did not
    // flush): run the pending save anyway. Dropping it here is silent data loss.
    if (pendingRef.current || drainingRef.current) {
      void drainRef.current().catch(() => {
        /* surfaced via onError */
      });
    }
  }, []);

  return { status, schedule, flush, isBusy, isSaving, resetConflict, discard };
}
