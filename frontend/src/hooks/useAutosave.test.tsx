import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAutosave, {
  AUTOSAVE_RETRY_DELAYS_MS,
  classifySaveFailure,
  createAutosaveQueue,
  createAutosaveRegistry,
  keepsFailedSave,
  type AutosaveQueue,
  type AutosaveRegistry,
} from './useAutosave';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (error: unknown) => void };

function deferred(): Deferred {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (the save promises) settle inside act(). */
async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
  });
}

describe('useAutosave', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('lands in error — never stranded in pending — when the save rejects', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAutosave({ delay: 10, onError }));

    act(() => {
      result.current.schedule(async () => {
        throw new Error('boom');
      });
    });
    expect(result.current.status).toBe('pending');

    await advance(10);

    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isBusy()).toBe(false);
  });

  it('lands in error when the save throws synchronously before returning a promise', async () => {
    const onError = vi.fn();
    const { result } = renderHook(() => useAutosave({ delay: 10, onError }));

    act(() => {
      result.current.schedule((() => {
        throw new Error('sync boom');
      }) as unknown as () => Promise<void>);
    });
    await advance(10);

    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('re-arms after a failure so re-editing retries the save', async () => {
    const { result } = renderHook(() => useAutosave({ delay: 10 }));
    act(() => {
      result.current.schedule(async () => {
        throw new Error('boom');
      });
    });
    await advance(10);
    expect(result.current.status).toBe('error');

    const retry = vi.fn(async () => {});
    act(() => result.current.schedule(retry));
    await advance(10);

    expect(retry).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
  });

  it('flush() drains pending work without waiting for the debounce', async () => {
    const save = vi.fn(async () => {});
    const { result } = renderHook(() => useAutosave({ delay: 5_000 }));

    act(() => result.current.schedule(save));
    expect(save).not.toHaveBeenCalled();

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(save).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(true);
    expect(result.current.status).toBe('saved');
    expect(result.current.isBusy()).toBe(false);
  });

  it('flush() reports false when the save fails, so the caller can abort the navigation', async () => {
    const { result } = renderHook(() => useAutosave({ delay: 5_000 }));
    act(() => {
      result.current.schedule(async () => {
        throw new Error('boom');
      });
    });

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(flushed).toBe(false);
    expect(result.current.status).toBe('error');
  });

  it('flush() awaits an in-flight save and the work scheduled behind it', async () => {
    const first = deferred();
    const order: string[] = [];
    const { result } = renderHook(() => useAutosave({ delay: 10 }));

    act(() => result.current.schedule(async () => {
      order.push('first');
      await first.promise;
    }));
    await advance(10);
    act(() => result.current.schedule(async () => {
      order.push('second');
    }));

    let flushed: Promise<boolean> | undefined;
    act(() => {
      flushed = result.current.flush();
    });
    first.resolve();
    let done: boolean | undefined;
    await act(async () => {
      done = await flushed;
    });

    expect(order).toEqual(['first', 'second']);
    expect(done).toBe(true);
  });

  /**
   * save1 in flight, save2 scheduled behind it (arming a new debounce), save1
   * resolves and the loop runs save2 before that debounce fires on an empty queue.
   */
  async function runStrandingSequence(result: { current: ReturnType<typeof useAutosave> }) {
    const first = deferred();
    const save1 = vi.fn(() => first.promise);
    const save2 = vi.fn(async () => {});
    act(() => result.current.schedule(save1));
    await advance(10);
    expect(save1).toHaveBeenCalledTimes(1);
    act(() => result.current.schedule(save2));
    first.resolve();
    await settle();
    expect(save2).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
    // The debounce armed by schedule(save2) now fires on an empty queue.
    await advance(10);
  }

  it('treats a debounce firing on an empty queue as a no-op', async () => {
    const { result } = renderHook(() => useAutosave({ delay: 10, savedLingerMs: 100 }));
    await runStrandingSequence(result);

    expect(result.current.status).toBe('saved');
    expect(result.current.isBusy()).toBe(false);
    await advance(100);
    expect(result.current.status).toBe('idle');
  });

  it('keeps saving after a debounce fired on an empty queue', async () => {
    const { result } = renderHook(() => useAutosave({ delay: 10, savedLingerMs: 100 }));
    await runStrandingSequence(result);

    const save3 = vi.fn(async () => {});
    act(() => result.current.schedule(save3));
    expect(result.current.status).toBe('pending');
    await advance(10);

    expect(save3).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
    expect(result.current.isBusy()).toBe(false);
    await advance(100);
    expect(result.current.status).toBe('idle');
  });

  it('flush() still runs the save after a debounce fired on an empty queue', async () => {
    const { result } = renderHook(() => useAutosave({ delay: 10 }));
    await runStrandingSequence(result);

    const save3 = vi.fn(async () => {});
    act(() => result.current.schedule(save3));
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });

    expect(save3).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(true);
    expect(result.current.status).toBe('saved');
    expect(result.current.isBusy()).toBe(false);
  });

  it('keeps saving after a save threw synchronously', async () => {
    const { result } = renderHook(() => useAutosave({ delay: 10 }));
    act(() => {
      result.current.schedule((() => {
        throw new Error('sync boom');
      }) as unknown as () => Promise<void>);
    });
    await advance(10);
    expect(result.current.status).toBe('error');
    expect(result.current.isBusy()).toBe(false);

    const next = vi.fn(async () => {});
    act(() => result.current.schedule(next));
    await advance(10);

    expect(next).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
  });

  it('runs the pending save on an uncontrolled unmount instead of dropping it', async () => {
    const save = vi.fn(async () => {});
    const { result, unmount } = renderHook(() => useAutosave({ delay: 5_000 }));

    act(() => result.current.schedule(save));
    unmount();
    await settle();

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe('createAutosaveQueue', () => {
  it('never lets two saves overlap, whichever controller scheduled them', async () => {
    vi.useFakeTimers();
    const queue: AutosaveQueue = createAutosaveQueue();
    const first = deferred();
    const second = deferred();
    let active = 0;
    let maxActive = 0;
    const started: string[] = [];
    const task = (name: string, gate: Deferred) => async () => {
      started.push(name);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
    };

    const a = renderHook(() => useAutosave({ delay: 10, queue }));
    const b = renderHook(() => useAutosave({ delay: 10, queue }));

    act(() => {
      a.result.current.schedule(task('a', first));
      b.result.current.schedule(task('b', second));
    });
    await advance(10);

    expect(started).toEqual(['a']);
    expect(maxActive).toBe(1);

    first.resolve();
    await settle();
    expect(started).toEqual(['a', 'b']);
    expect(maxActive).toBe(1);

    second.resolve();
    await settle();
    expect(a.result.current.status).toBe('saved');
    expect(b.result.current.status).toBe('saved');
    vi.useRealTimers();
  });

  it('keeps running the next save after one rejects', async () => {
    const queue = createAutosaveQueue();
    const ran: string[] = [];
    const failing = queue.run(async () => {
      ran.push('failing');
      throw new Error('boom');
    });
    const next = queue.run(async () => {
      ran.push('next');
    });

    await expect(failing).rejects.toThrow('boom');
    await expect(next).resolves.toBeUndefined();
    expect(ran).toEqual(['failing', 'next']);
  });
});

describe('createAutosaveRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('flushes every registered controller and reports the overall outcome', async () => {
    const registry: AutosaveRegistry = createAutosaveRegistry();
    const good = vi.fn(async () => {});
    const bad = vi.fn(async () => {
      throw new Error('boom');
    });
    const a = renderHook(() => useAutosave({ delay: 5_000, registry }));
    const b = renderHook(() => useAutosave({ delay: 5_000, registry }));

    expect(registry.isBusy()).toBe(false);
    act(() => {
      a.result.current.schedule(good);
      b.result.current.schedule(bad);
    });
    expect(registry.isBusy()).toBe(true);

    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await registry.flushAll();
    });

    expect(good).toHaveBeenCalledTimes(1);
    expect(bad).toHaveBeenCalledTimes(1);
    expect(flushed).toBe(false);
    expect(registry.isBusy()).toBe(false);
    expect(a.result.current.status).toBe('saved');
    expect(b.result.current.status).toBe('error');
  });

  it('drops a controller from the registry when it unmounts', async () => {
    const registry = createAutosaveRegistry();
    const a = renderHook(() => useAutosave({ delay: 5_000, registry }));

    act(() => a.result.current.schedule(async () => {}));
    expect(registry.isBusy()).toBe(true);

    a.unmount();
    await settle();

    expect(registry.isBusy()).toBe(false);
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await registry.flushAll();
    });
    expect(flushed).toBe(true);
  });
});

/** An API error as axios rejects it. */
function apiError(status: number, code?: string, headers: Record<string, string> = {}) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: code ? { code, message: code } : {}, headers } });
}

describe('classifySaveFailure', () => {
  it('retries the busy and retry answers, keeps the conflicts, drops the rest', () => {
    expect(classifySaveFailure(apiError(503, 'busy'))).toEqual({ kind: 'transient', retryAfterMs: undefined });
    expect(classifySaveFailure(apiError(409, 'retry'))).toEqual({ kind: 'transient', retryAfterMs: undefined });
    expect(classifySaveFailure(apiError(503, 'busy', { 'retry-after': '3' }))).toEqual({ kind: 'transient', retryAfterMs: 3_000 });
    expect(classifySaveFailure(apiError(503, 'busy', { 'retry-after': '600' })).retryAfterMs).toBe(10_000);
    expect(classifySaveFailure(apiError(503, 'busy', { 'retry-after': 'soon' })).retryAfterMs).toBeUndefined();
    for (const code of ['duplicate', 'parent_gone', 'in_use']) {
      expect(classifySaveFailure(apiError(409, code))).toEqual({ kind: 'conflict' });
    }
    expect(classifySaveFailure(apiError(503))).toEqual({ kind: 'fatal' });
    expect(classifySaveFailure(apiError(503, 'TENANT_NOT_READY'))).toEqual({ kind: 'fatal' });
    expect(classifySaveFailure(apiError(409, 'busy'))).toEqual({ kind: 'fatal' });
    expect(classifySaveFailure(apiError(400, 'duplicate'))).toEqual({ kind: 'fatal' });
    expect(classifySaveFailure(apiError(500))).toEqual({ kind: 'fatal' });
    expect(classifySaveFailure(new Error('network'))).toEqual({ kind: 'fatal' });
    expect(keepsFailedSave(apiError(503, 'busy'))).toBe(true);
    expect(keepsFailedSave(apiError(409, 'parent_gone'))).toBe(true);
    expect(keepsFailedSave(apiError(400))).toBe(false);
  });
});

describe('useAutosave on busy and conflicting answers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('retries a busy save by itself, still "saving", and reports nothing once it goes through', async () => {
    const onError = vi.fn();
    let calls = 0;
    const save = vi.fn(async () => {
      calls += 1;
      if (calls <= 2) throw apiError(503, 'busy');
    });
    const { result } = renderHook(() => useAutosave({ delay: 10, onError }));
    act(() => result.current.schedule(save));
    await advance(10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saving');

    await advance(AUTOSAVE_RETRY_DELAYS_MS[0]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saving');
    await advance(AUTOSAVE_RETRY_DELAYS_MS[1]);
    await settle();

    expect(save).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe('saved');
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.isBusy()).toBe(false);
  });

  it('waits as long as the server asks in Retry-After', async () => {
    let calls = 0;
    const save = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw apiError(409, 'retry', { 'retry-after': '3' });
    });
    const { result } = renderHook(() => useAutosave({ delay: 10 }));
    act(() => result.current.schedule(save));
    await advance(10);
    await advance(2_999);
    expect(save).toHaveBeenCalledTimes(1);
    await advance(1);
    await settle();
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('saved');
  });

  it('stops retrying after a bounded number of attempts, reports once and keeps the save', async () => {
    const onError = vi.fn();
    let busy = true;
    const save = vi.fn(async (): Promise<void> => {
      if (busy) throw apiError(503, 'busy');
    });
    const { result } = renderHook(() => useAutosave({ delay: 10, onError }));
    act(() => result.current.schedule(save));
    await advance(10);
    for (const wait of AUTOSAVE_RETRY_DELAYS_MS) await advance(wait);
    await settle();

    expect(save).toHaveBeenCalledTimes(AUTOSAVE_RETRY_DELAYS_MS.length + 1);
    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.isBusy()).toBe(true);

    // The kept save goes again on the next flush, and lands once the server answers.
    busy = false;
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe(true);
    expect(save).toHaveBeenCalledTimes(AUTOSAVE_RETRY_DELAYS_MS.length + 2);
    expect(result.current.status).toBe('saved');
    expect(result.current.isBusy()).toBe(false);
  });

  it('runs the save scheduled during a retry wait instead of the failed one', async () => {
    const failing = vi.fn(async () => {
      throw apiError(503, 'busy');
    });
    const newer = vi.fn(async () => {});
    const { result } = renderHook(() => useAutosave({ delay: 10 }));
    act(() => result.current.schedule(failing));
    await advance(10);
    expect(failing).toHaveBeenCalledTimes(1);

    act(() => result.current.schedule(newer));
    await advance(AUTOSAVE_RETRY_DELAYS_MS[0]);
    await settle();

    expect(failing).toHaveBeenCalledTimes(1);
    expect(newer).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('saved');
  });

  it('reports a conflict at once and keeps the save for one more attempt', async () => {
    const onError = vi.fn();
    const conflict = apiError(409, 'parent_gone');
    const save = vi.fn(async () => {
      throw conflict;
    });
    const { result } = renderHook(() => useAutosave({ delay: 10, onError }));
    act(() => result.current.schedule(save));
    await advance(10);

    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    expect(onError).toHaveBeenCalledWith(conflict);
    expect(result.current.isBusy()).toBe(true);

    // A flush sends it again; refused the same way, it is dropped: the next flush lets the user go.
    let flushed: boolean | undefined;
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(flushed).toBe(false);
    expect(onError).toHaveBeenCalledTimes(2);
    expect(result.current.isBusy()).toBe(false);
    await act(async () => {
      flushed = await result.current.flush();
    });
    expect(flushed).toBe(true);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('keeps a conflicting save again when it comes from a new edit', async () => {
    const save = vi.fn(async () => {
      throw apiError(409, 'duplicate');
    });
    const { result } = renderHook(() => useAutosave({ delay: 10 }));
    act(() => result.current.schedule(save));
    await advance(10);
    expect(result.current.isBusy()).toBe(true);

    act(() => result.current.schedule(save));
    await advance(10);
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.current.status).toBe('error');
    expect(result.current.isBusy()).toBe(true);
  });

  it('still drops a save refused for another reason', async () => {
    const save = vi.fn(async () => {
      throw apiError(400, 'VALIDATION');
    });
    const { result } = renderHook(() => useAutosave({ delay: 10 }));
    act(() => result.current.schedule(save));
    await advance(10);
    expect(save).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    expect(result.current.isBusy()).toBe(false);
  });
});
