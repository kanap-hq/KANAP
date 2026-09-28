import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAutosave, {
  createAutosaveQueue,
  createAutosaveRegistry,
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
