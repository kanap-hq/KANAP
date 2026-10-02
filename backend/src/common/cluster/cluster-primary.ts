import type { Cluster, Worker } from 'node:cluster';
import { readDrainTimeoutMs } from '../graceful-shutdown';

// The typings only declare a default export, but the CommonJS module is the cluster object
// itself (and this project compiles without esModuleInterop).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const cluster: Cluster = require('node:cluster');

/**
 * Node cluster primary for `API_WORKERS` > 1 (see process-role.ts). The entrypoint
 * (`scripts/migrate-and-start.js`) calls it after the migrations, so they ran exactly once
 * before any worker starts. The primary serves no request and opens no database connection:
 * it forks the workers, gives each one its slot id, forks a worker again when one dies, and
 * forwards a stop.
 *
 * Connections are spread by the cluster module (round robin on Linux): the primary accepts on
 * the API port and hands each connection to a worker. A request stays on the worker that got
 * its connection; behind a reverse proxy that opens one connection per request (the host
 * nginx configurations of this repository), requests spread evenly.
 *
 * Stop (SIGTERM from `docker stop`, or SIGINT): every worker gets SIGTERM, stops accepting,
 * finishes its in-flight requests (`graceful-shutdown.ts`) and exits; a worker still running
 * after its drain time plus 5 s is killed. Then the primary exits.
 */
export type ClusterPrimaryOptions = {
  workers: number;
  /** Script each worker runs (`dist/main.js`). */
  exec: string;
  /** How long a stop waits for the workers before killing them. Default: drain time + 5 s. */
  stopTimeoutMs?: number;
  /** Delay before a worker that died is forked again. */
  restartDelayMs?: number;
  /** This many worker exits within `crashWindowMs` stop the cluster with exit code 1, so the container's restart policy takes over. */
  crashLimit?: number;
  crashWindowMs?: number;
  log?: (line: string) => void;
  /** Called with the exit code once every worker is gone. Default: process.exit. */
  exit?: (code: number) => void;
  /** Install the SIGTERM / SIGINT handlers (default true). */
  handleSignals?: boolean;
};

export type ClusterPrimaryHandle = {
  stop: (reason: string) => void;
  /** Slot ids of the live workers. */
  slots: () => number[];
};

export function runClusterPrimary(options: ClusterPrimaryOptions): ClusterPrimaryHandle {
  const workers = options.workers;
  const stopTimeoutMs = options.stopTimeoutMs ?? readDrainTimeoutMs() + 5_000;
  const restartDelayMs = options.restartDelayMs ?? 1_000;
  const crashLimit = options.crashLimit ?? 5;
  const crashWindowMs = options.crashWindowMs ?? 60_000;
  // eslint-disable-next-line no-console
  const log = options.log ?? ((line: string) => console.log(line));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const startedAt = Date.now();

  const live = new Map<number, Worker>();
  const exits: number[] = [];
  let stopping = false;
  let finished = false;
  let exitCode = 0;
  let killTimer: NodeJS.Timeout | null = null;

  cluster.setupPrimary({ exec: options.exec });

  const finish = () => {
    if (finished) return;
    finished = true;
    if (killTimer) clearTimeout(killTimer);
    log(`[cluster] all workers stopped`);
    exit(exitCode);
  };

  const fork = (slot: number) => {
    const worker = cluster.fork({
      KANAP_WORKER_ID: String(slot),
      KANAP_WORKER_COUNT: String(workers),
      KANAP_CLUSTER_STARTED_AT: String(startedAt),
    });
    live.set(slot, worker);
    worker.on('exit', (code, signal) => {
      if (live.get(slot) === worker) live.delete(slot);
      if (stopping) {
        if (live.size === 0) finish();
        return;
      }
      log(`[cluster] worker ${slot} (pid ${worker.process.pid}) exited (${signal ?? `code ${code}`})`);
      const now = Date.now();
      exits.push(now);
      while (exits.length > 0 && now - exits[0] > crashWindowMs) exits.shift();
      if (exits.length >= crashLimit) {
        log(`[cluster] ${exits.length} worker exits within ${Math.round(crashWindowMs / 1000)} s: stopping, the container restart policy takes over`);
        exitCode = 1;
        stop('crash loop');
        return;
      }
      setTimeout(() => {
        if (!stopping) fork(slot);
      }, restartDelayMs);
    });
  };

  const stop = (reason: string) => {
    if (stopping) return;
    stopping = true;
    log(`[cluster] ${reason}: stopping ${live.size} worker(s), up to ${Math.round(stopTimeoutMs / 1000)} s for their in-flight requests`);
    if (live.size === 0) {
      finish();
      return;
    }
    for (const worker of live.values()) {
      try { worker.process.kill('SIGTERM'); } catch { /* already gone */ }
    }
    killTimer = setTimeout(() => {
      for (const [slot, worker] of live) {
        log(`[cluster] worker ${slot} still running after ${Math.round(stopTimeoutMs / 1000)} s: killed`);
        try { worker.process.kill('SIGKILL'); } catch { /* already gone */ }
      }
    }, stopTimeoutMs);
  };

  if (options.handleSignals !== false) {
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  }

  log(`[cluster] primary pid ${process.pid}: starting ${workers} API workers`);
  for (let slot = 1; slot <= workers; slot += 1) fork(slot);

  return { stop, slots: () => [...live.keys()].sort((a, b) => a - b) };
}
