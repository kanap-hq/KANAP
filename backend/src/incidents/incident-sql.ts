/**
 * The SQL definitions the incident reads share between the service (list, filter values, export)
 * and the AI registry (groups and metrics), so both answer the same thing.
 *
 * A `timestamptz` is written in UTC whatever the database session time zone: an incident stored
 * on 31 October at 23:30 UTC stays in October even when the session runs in Paris. The person's
 * own zone is applied by the screens and by Plaid when it quotes or converts a date-time, never
 * by these definitions.
 */
function inUtc(column: string): string {
  return `(${column} AT TIME ZONE 'UTC')`;
}

/** The `YYYY-MM` month of a date-time column, in UTC. */
function monthSql(column: string): string {
  return `to_char(${inUtc(column)}, 'YYYY-MM')`;
}

/** The `YYYY-MM-DD` day of a date-time column, in UTC, as the date metrics of every registry. */
export function incidentDaySql(column: string): string {
  return `to_char(${inUtc(column)}, 'YYYY-MM-DD')`;
}

/** The month the incident was detected, in UTC. */
export const INCIDENT_DETECTED_MONTH_SQL = monthSql('i.detected_at');

/**
 * The month service was restored, in UTC, only for an incident whose status says it was restored
 * (`resolved` or `closed`): an incident still open with a hand-entered `resolved_at` has no
 * resolution month, as it has no resolution delay.
 */
export const INCIDENT_RESOLVED_MONTH_SQL = `CASE
    WHEN i.status IN ('resolved', 'closed') AND i.resolved_at IS NOT NULL
    THEN ${monthSql('i.resolved_at')}
  END`;

/**
 * Hours from detection to resolution, exact (the aggregate rounds it to one decimal), on the
 * `incidents` alias `i`. Cancelled incidents, incidents not resolved or closed, incidents without
 * a resolution date and delays below zero (hand-entered dates) are null, so they never enter an
 * average. The AI registry reads the same definition.
 */
export const INCIDENT_RESOLUTION_HOURS_SQL = `CASE
    WHEN i.status IN ('resolved', 'closed')
      AND i.resolved_at IS NOT NULL
      AND i.resolved_at >= i.detected_at
    THEN EXTRACT(EPOCH FROM (i.resolved_at - i.detected_at)) / 3600.0
  END`;
