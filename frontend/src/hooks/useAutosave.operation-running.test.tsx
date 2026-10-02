import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import useAutosave from './useAutosave';

/**
 * 409 `operation_running` (backend `spend/budget-locks.ts`): a bulk budget
 * operation of the workspace (column copy or clear, allocation copy, CSV
 * import, freeze or unfreeze) is running. The user waits for it to finish:
 * the autosave never sends the save again by itself, unlike 409 `retry` and
 * 503 `busy`. It reports the error once and drops the save.
 */
function operationRunning() {
  return Object.assign(new Error('Request failed with status code 409'), {
    response: {
      status: 409,
      headers: {},
      data: {
        statusCode: 409,
        error: 'Conflict',
        code: 'operation_running',
        message: 'Another budget operation is running for this workspace. Try again when it has finished.',
      },
    },
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useAutosave and a 409 operation_running', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports it once and never retries the save by itself', async () => {
    const onError = vi.fn();
    const save = vi.fn(async () => {
      throw operationRunning();
    });
    const { result } = renderHook(() => useAutosave({ delay: 10, onError }));

    act(() => {
      result.current.schedule(save);
    });
    await advance(10);
    // Far beyond any automatic retry delay (1, 2 and 4 s, or a Retry-After).
    for (let i = 0; i < 10; i++) await advance(5_000);

    expect(save).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe('error');
    expect(result.current.isBusy()).toBe(false);
  });
});
