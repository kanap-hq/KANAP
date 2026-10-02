/**
 * Where this API process stands among the processes serving the same database.
 *
 * `API_WORKERS` (default 1) is the number of API processes the operator asks for. With 1, the
 * entrypoint runs the API in its own process, as before. With more, the entrypoint becomes a
 * Node cluster primary (`cluster-primary.ts`): it runs the migrations once, then forks that many
 * workers, each one a full API process with its own database pool, and hands every worker
 * `KANAP_WORKER_ID` (1 to N), `KANAP_WORKER_COUNT` (N) and `KANAP_CLUSTER_STARTED_AT`.
 *
 * Code that must happen once per start (the startup tasks, the startup checks) runs in the lead
 * process: the single process, or worker 1.
 */

export const MAX_API_WORKERS = 16;

/** `API_WORKERS` as a whole number between 1 and 16; anything else is 1. */
export function parseApiWorkers(raw: string | undefined): number {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return 1;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, MAX_API_WORKERS);
}

/** 1-based id of this worker, or null when the API runs as a single process. */
export function clusterWorkerId(env: NodeJS.ProcessEnv = process.env): number | null {
  const id = Number(env.KANAP_WORKER_ID);
  return Number.isSafeInteger(id) && id >= 1 ? id : null;
}

/** How many API processes serve: N in a cluster worker, 1 otherwise. */
export function apiProcessCount(env: NodeJS.ProcessEnv = process.env): number {
  if (clusterWorkerId(env) === null) return 1;
  return parseApiWorkers(env.KANAP_WORKER_COUNT);
}

/** Whether this process does the once-per-start work: the single process, or worker 1. */
export function isLeadProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  const id = clusterWorkerId(env);
  return id === null || id === 1;
}

/** Short label for log lines and metrics: `api` for a single process, `worker 2/4` in a cluster. */
export function processLabel(env: NodeJS.ProcessEnv = process.env): string {
  const id = clusterWorkerId(env);
  return id === null ? 'api' : `worker ${id}/${apiProcessCount(env)}`;
}
