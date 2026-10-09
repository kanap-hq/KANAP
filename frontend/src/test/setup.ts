import '@testing-library/jest-dom';
import { afterAll } from 'vitest';

// React 18 uses this flag to decide whether async state updates should be
// validated under act() in the current test environment.
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

// A file ends while short timers it started are still pending. AG Grid is the known case: removing
// rows with animation schedules a clean-up 400 ms later, which runs even after the grid is gone and
// then queues the grid's events with `window.setTimeout`. If that clean-up falls due while Vitest
// tears this file's jsdom globals down, it runs without `window` and fails as an unhandled error
// (`window is not defined` in AG Grid's `flush`), which fails the run although every test passed.
// So each file ends by waiting, three seconds at most, for its pending timers of one second or less
// to run while its page still exists. Errors they raise are reported against this file as before.
// Longer timers (React Query's cache collection) are left alone: the worker is gone before they
// fall due.
const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
const SOON_MS = 1_000;
const DRAIN_LIMIT_MS = 3_000;
/** Due time of each pending real timer that falls due within SOON_MS of its start. */
const soonTimers = new Map<unknown, number>();

globalThis.setTimeout = ((handler: unknown, delay?: number, ...args: unknown[]) => {
  const ms = Number(delay) || 0;
  if (typeof handler !== 'function' || ms > SOON_MS) return realSetTimeout(handler as any, delay, ...args);
  const timer = realSetTimeout(
    (...callArgs: unknown[]) => {
      soonTimers.delete(timer);
      handler(...callArgs);
    },
    delay,
    ...args,
  );
  soonTimers.set(timer, Date.now() + ms);
  return timer;
}) as typeof setTimeout;

globalThis.clearTimeout = ((timer?: Parameters<typeof clearTimeout>[0]) => {
  if (typeof timer === 'number' || typeof timer === 'string') {
    // A timer cleared by its numeric id: Node's handle converts to that id.
    for (const pending of soonTimers.keys()) if (Number(pending) === Number(timer)) soonTimers.delete(pending);
  } else {
    soonTimers.delete(timer);
  }
  realClearTimeout(timer);
}) as typeof clearTimeout;

afterAll(async () => {
  const deadline = Date.now() + DRAIN_LIMIT_MS;
  while (soonTimers.size > 0 && Date.now() < deadline) {
    const untilLast = Math.max(...soonTimers.values()) - Date.now();
    // A busy event loop can wake this wait a little early: the loop then waits again.
    await new Promise((resolve) => realSetTimeout(resolve, Math.min(Math.max(untilLast, 0) + 1, DRAIN_LIMIT_MS)));
  }
});
