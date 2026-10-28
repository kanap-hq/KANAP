/**
 * Hours from detection to resolution, one decimal, on the `incidents` alias `i`. Cancelled
 * incidents, incidents without a resolution date and delays below zero (hand-entered dates) are
 * null, so they never enter an average. The AI registry reads the same definition.
 */
export const INCIDENT_RESOLUTION_HOURS_SQL = `CASE
    WHEN i.status <> 'cancelled'
      AND i.resolved_at IS NOT NULL
      AND i.resolved_at >= i.detected_at
    THEN ROUND(EXTRACT(EPOCH FROM (i.resolved_at - i.detected_at)) / 3600.0, 1)
  END`;
