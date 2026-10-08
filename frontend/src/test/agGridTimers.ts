/**
 * Lets AG Grid's pending timers run while the jsdom window still exists.
 *
 * A grid queues work on 0 ms timers and animation frames (its state service
 * init, the debounced `stateUpdated` event, the async event queue). When a
 * test file ends right after a grid was created or unmounted, those timers
 * can fire after Vitest tore the environment down and throw
 * "window is not defined". Destroy or unmount the grids first, then await this
 * in `afterEach`.
 */
export async function flushAgGridTimers(): Promise<void> {
  const macrotask = () => new Promise<void>((resolve) => { setTimeout(resolve, 0); });
  for (let i = 0; i < 3; i += 1) await macrotask();
  await new Promise<void>((resolve) => { window.requestAnimationFrame(() => resolve()); });
  await macrotask();
}
