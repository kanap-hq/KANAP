/**
 * Work a request starts and does not await (event notifications, the login FX refresh): the
 * response is gone while it still runs. A stop waits for it (graceful-shutdown.ts, main.ts),
 * bounded by the drain time, before it closes the database pool.
 */
const pending = new Set<Promise<unknown>>();

/** Registers `promise` until it settles; returns it unchanged. */
export function trackBackgroundWork<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  const forget = () => { pending.delete(promise); };
  promise.then(forget, forget);
  return promise;
}

export function backgroundWorkCount(): number {
  return pending.size;
}

/**
 * Waits until no tracked work is left (work started meanwhile included) or `deadlineAt` passes.
 * Returns how many are still running.
 */
export async function waitForBackgroundWork(deadlineAt: number): Promise<number> {
  while (pending.size > 0) {
    const left = deadlineAt - Date.now();
    if (left <= 0) break;
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise<void>((resolve) => { timer = setTimeout(resolve, left); }),
    ]);
    if (timer) clearTimeout(timer);
  }
  return pending.size;
}
