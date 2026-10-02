import type { IncomingMessage, Server, ServerResponse } from 'node:http';

/**
 * Stop of an API process (SIGTERM from `docker stop` or from the cluster primary, SIGINT from a
 * terminal), within the drain time (`SHUTDOWN_DRAIN_TIMEOUT_MS`, default 20 s):
 * 1. no new connection; the requests in flight finish;
 * 2. a short grace (1.5 s after the last response): work a request started without awaiting it
 *    (a notification chain) gets going;
 * 3. `close(deadlineAt)` (main.ts): the work after the responses (tracked notification chains,
 *    running scheduled tasks, the email queue) finishes or is given up at `deadlineAt`, 2 s before
 *    the end of the drain time; then the application closes (database pool) and the process
 *    exits 0. Past the drain time it exits 1, whatever is left.
 *
 * Keep-alive connections must not hold the stop, and must not be cut while a response is still
 * being written: Node counts a connection as idle once its response has ended, while a large
 * body can still sit in the process's write buffer, and closing it then truncates the body.
 * So the connections idle at the signal are closed (`server.close()` does it), a response not
 * started yet goes out with `Connection: close` (Node closes the socket once it is written), and
 * a response already started with keep-alive closes its connection half a second after it is
 * written (the keep-alive timeout, lowered).
 *
 * The container gives the process 30 s (`stop_grace_period` in the compose files) before it
 * kills it; the drain time stays under it. Before this, the image started Node through
 * `sh -lc`, which did not pass SIGTERM on: every stop waited 10 s and killed requests mid-way.
 */
export const DEFAULT_DRAIN_TIMEOUT_MS = 20_000;
const MAX_DRAIN_TIMEOUT_MS = 120_000;
/** Keep-alive timeout while draining: a connection whose response went out closes this long after. */
const KEEP_ALIVE_WHILE_DRAINING_MS = 500;
/** Time after the last response for the work it started without awaiting to get going. */
export const AFTER_RESPONSE_GRACE_MS = 1_500;
/** Kept at the end of the drain time for closing the application (pool, hooks). */
const CLOSE_RESERVE_MS = 2_000;

export function readDrainTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.SHUTDOWN_DRAIN_TIMEOUT_MS);
  if (!Number.isFinite(raw) || raw < 0 || String(env.SHUTDOWN_DRAIN_TIMEOUT_MS ?? '').trim() === '') {
    return DEFAULT_DRAIN_TIMEOUT_MS;
  }
  return Math.min(Math.floor(raw), MAX_DRAIN_TIMEOUT_MS);
}

export type GracefulShutdownOptions = {
  server: Server;
  /**
   * Once no request is left: lets the work after the responses finish (until `deadlineAt`, a
   * timestamp in ms), then closes the application (Nest `app.close()`).
   */
  close: (deadlineAt: number) => Promise<void>;
  /** Runs first, at the signal: stop starting new background work (cron jobs). */
  beforeDrain?: () => void;
  drainTimeoutMs?: number;
  /** Grace after the last response (default AFTER_RESPONSE_GRACE_MS). */
  graceMs?: number;
  log?: (line: string) => void;
  exit?: (code: number) => void;
  /** Signals to handle (default SIGTERM and SIGINT). Empty: none, call `shutdown` yourself. */
  signals?: NodeJS.Signals[];
  label?: string;
};

export function installGracefulShutdown(options: GracefulShutdownOptions): { shutdown: (reason: string) => Promise<void>; inFlight: () => number } {
  const { server } = options;
  const drainTimeoutMs = options.drainTimeoutMs ?? readDrainTimeoutMs();
  // eslint-disable-next-line no-console
  const log = options.log ?? ((line: string) => console.log(line));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const label = options.label ? `${options.label} ` : '';
  const graceMs = options.graceMs ?? AFTER_RESPONSE_GRACE_MS;
  const responses = new Set<ServerResponse>();
  let draining = false;
  let lastResponseAt = 0;
  let started: Promise<void> | null = null;

  server.on('request', (_req: IncomingMessage, res: ServerResponse) => {
    responses.add(res);
    if (draining) res.shouldKeepAlive = false;
    res.once('close', () => {
      responses.delete(res);
      lastResponseAt = Date.now();
    });
  });

  const shutdown = (reason: string): Promise<void> => {
    if (started) return started;
    started = (async () => {
      const t0 = Date.now();
      log(`[shutdown] ${label}${reason}: no new connections, ${responses.size} request(s) in flight, up to ${Math.round(drainTimeoutMs / 1000)} s to finish`);
      const force = setTimeout(() => {
        log(`[shutdown] ${label}${responses.size} request(s) still running after ${Math.round(drainTimeoutMs / 1000)} s: exiting`);
        exit(1);
      }, drainTimeoutMs);
      try {
        options.beforeDrain?.();
      } catch (error) {
        log(`[shutdown] ${label}could not stop the background work: ${(error as Error)?.message ?? error}`);
      }
      draining = true;
      for (const res of responses) {
        if (!res.headersSent) res.shouldKeepAlive = false;
      }
      server.keepAliveTimeout = Math.min(server.keepAliveTimeout || KEEP_ALIVE_WHILE_DRAINING_MS, KEEP_ALIVE_WHILE_DRAINING_MS);
      try {
        // Stops accepting, closes the connections idle now, calls back once every connection ended.
        await new Promise<void>((resolve) => server.close(() => resolve()));
        const deadlineAt = t0 + Math.max(0, drainTimeoutMs - CLOSE_RESERVE_MS);
        const graceLeft = Math.min(lastResponseAt + graceMs, deadlineAt) - Date.now();
        if (graceLeft > 0) await new Promise((resolve) => setTimeout(resolve, graceLeft));
        await options.close(deadlineAt);
        clearTimeout(force);
        log(`[shutdown] ${label}stopped in ${Date.now() - t0} ms`);
        exit(0);
      } catch (error) {
        clearTimeout(force);
        log(`[shutdown] ${label}stop failed: ${(error as Error)?.message ?? error}`);
        exit(1);
      }
    })();
    return started;
  };

  for (const signal of options.signals ?? (['SIGTERM', 'SIGINT'] as NodeJS.Signals[])) {
    process.on(signal, () => { void shutdown(signal); });
  }
  return { shutdown, inFlight: () => responses.size };
}
