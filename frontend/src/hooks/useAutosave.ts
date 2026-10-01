import { useCallback, useEffect, useRef, useState } from 'react';

export type AutosaveStatus = 'idle' | 'pending' | 'saving' | 'saved' | 'error';

/**
 * What a failed save means for the autosave, from the API's answer (the
 * backend's database error codes, plan planning/perf-scale lot 1D):
 * - `transient`: 409 `retry` (another write at the same moment) or 503 `busy`
 *   (the data is held by a long operation, or the server is saturated). The
 *   save is retried by itself, a few times, after a short wait (the server's
 *   Retry-After when it sends one);
 * - `conflict`: 409 `duplicate`, `parent_gone` or `in_use`. Retrying the same
 *   save cannot help: the error is reported, the save is kept for one more
 *   attempt (the next edit or flush) instead of being dropped silently;
 * - `fatal`: anything else. Reported and dropped, as before.
 */
export type SaveFailure = { kind: 'transient' | 'conflict' | 'fatal'; retryAfterMs?: number };

/**
 * Whether the autosave keeps a save that failed this way (transient or
 * conflict). A save that takes its payload out of a ref before sending puts it
 * back then (under any edit typed since), so the kept save, run again, still
 * carries it; a payload refused for another reason is dropped as before.
 */
export function keepsFailedSave(error: unknown): boolean {
  return classifySaveFailure(error).kind !== 'fatal';
}

/** Waits before each automatic retry of a transient failure (bounded: three retries). */
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
  return { kind: 'fatal' };
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

export interface AutosaveHandle {
  /** See {@link AutosaveController.flush}. */
  flush: () => Promise<boolean>;
  /** See {@link AutosaveController.isBusy}. */
  isBusy: () => boolean;
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
   * save rejected (caller should abort the navigation to avoid losing the edit).
   */
  flush: () => Promise<boolean>;
  /** True when a save is pending (debouncing) or currently in flight. */
  isBusy: () => boolean;
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
 * A failed save is classified by {@link classifySaveFailure}: a transient one
 * is retried in place (status stays `saving`), a conflict or a transient one
 * that kept failing is reported and kept pending (`isBusy()` stays true, the
 * next flush or schedule sends it again), anything else is reported and
 * dropped. A kept save must be safe to run again: a caller that takes its
 * payload out of a ref before sending puts it back when the request fails.
 */
export default function useAutosave(options?: UseAutosaveOptions): AutosaveController {
  const delay = options?.delay ?? 700;
  const savedLingerMs = options?.savedLingerMs ?? 1500;
  const onError = options?.onError;
  const registry = options?.registry;

  const [status, setStatus] = useState<AutosaveStatus>('idle');

  const timerRef = useRef<number | null>(null);
  const savedTimerRef = useRef<number | null>(null);
  const pendingRef = useRef<null | (() => Promise<void>)>(null);
  // The pending save is one kept after a failure (not a new edit): a conflict on it again drops it.
  const keptRef = useRef(false);
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
      // Automatic retries of the current transient failure.
      let retries = 0;
      try {
        while (pendingRef.current) {
          const fn = pendingRef.current;
          const wasKept = keptRef.current;
          pendingRef.current = null;
          keptRef.current = false;
          setStatus('saving');
          const queue = queueRef.current;
          try {
            // Serialized with the sibling controllers when a queue is shared, so
            // two sections never PATCH the same entity concurrently.
            await (queue ? queue.run(fn) : fn());
            retries = 0;
          } catch (error) {
            const failure = classifySaveFailure(error);
            if (failure.kind === 'transient' && retries < AUTOSAVE_RETRY_DELAYS_MS.length) {
              // Try again shortly. A save scheduled meanwhile carries this one's
              // changes too (callers put a failed payload back), so it goes instead.
              if (!pendingRef.current) pendingRef.current = fn;
              const wait = failure.retryAfterMs ?? AUTOSAVE_RETRY_DELAYS_MS[retries];
              retries += 1;
              await new Promise((resolve) => window.setTimeout(resolve, wait));
              continue;
            }
            const keep = failure.kind === 'transient' || (failure.kind === 'conflict' && !wasKept);
            if (keep) {
              // Kept for the next flush or schedule: the change is not lost silently.
              if (!pendingRef.current) {
                pendingRef.current = fn;
                keptRef.current = true;
              }
            } else {
              // Drop the pending payload so a failing endpoint is not hammered; the
              // caller can reschedule. Status stays 'error' until the next schedule.
              pendingRef.current = null;
            }
            throw error;
          }
        }
        setStatus('saved');
        clearSavedTimer();
        savedTimerRef.current = window.setTimeout(() => {
          savedTimerRef.current = null;
          setStatus('idle');
        }, savedLingerMs);
      } catch (error) {
        setStatus('error');
        onError?.(error);
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
    keptRef.current = false;
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
        keptRef.current = false;
        setStatus('error');
        onError?.(error);
      }
    }, delay);
  }, [delay, drain, onError]);

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimer();
    if (pendingRef.current || drainingRef.current) {
      try {
        await drain();
      } catch {
        // Surfaced via status / onError. Report failure so callers can abort navigation.
        return false;
      }
    }
    return true;
  }, [drain]);

  const isBusy = useCallback(
    () => pendingRef.current != null || drainingRef.current != null,
    [],
  );

  // Stable handle over the latest closures, so registering/unregistering does
  // not churn every render.
  const latestHandleRef = useRef<AutosaveHandle>({ flush, isBusy });
  latestHandleRef.current = { flush, isBusy };
  const handleRef = useRef<AutosaveHandle | null>(null);
  if (!handleRef.current) {
    handleRef.current = {
      flush: () => latestHandleRef.current.flush(),
      isBusy: () => latestHandleRef.current.isBusy(),
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

  return { status, schedule, flush, isBusy };
}
