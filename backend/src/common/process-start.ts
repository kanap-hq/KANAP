/**
 * Instant this API started, the instant the start-up report describes. A module constant is
 * deliberate: it is evaluated once, at first import, before any provider is constructed.
 *
 * In a cluster (`API_WORKERS` > 1) it is the primary's start, handed to every worker in
 * `KANAP_CLUSTER_STARTED_AT`, so every worker, including one forked again after a crash, reports
 * the same instant.
 */
function clusterStartedAt(): number | null {
  const value = Number(process.env.KANAP_CLUSTER_STARTED_AT);
  return Number.isSafeInteger(value) && value > 0 && value <= Date.now() ? value : null;
}

export const PROCESS_STARTED_AT = clusterStartedAt() ?? Date.now();
