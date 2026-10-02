import type { WindowStats, AuthStats, RouteLatency, ErrorEntry, ProcessMetrics } from '../ops-metrics.store';
import type { DbMetricsSnapshot } from '../db-metrics.service';
import type { OpsHealth } from '../ops-health';
import type { OpsAggregate, ProcessSummary } from '../ops-snapshot.service';

export interface OpsSnapshotDto {
  windows: {
    '1m': WindowStats;
    '5m': WindowStats;
    '15m': WindowStats;
  };
  auth: AuthStats;
  topRoutes: RouteLatency[];
  recentErrors: ErrorEntry[];
  process: ProcessMetrics;
  db: DbMetricsSnapshot;
  collectedSince: number;
  totalEntriesInMemory: number;
  /** The process that answered (`api`, or `worker 2/4`). */
  processLabel: string;
  /** Status against the documented thresholds (ops-health.ts), on the aggregate when several processes run. */
  health: OpsHealth;
  /** Several API processes only: each live process, as it last published (every 15 s). */
  processes?: ProcessSummary[];
  /** Several API processes only: all of them together. */
  aggregate?: OpsAggregate;
  generatedAt: number;
}
