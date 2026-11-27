/**
 * A record's lock (`SELECT 1 FROM <table> WHERE ... FOR <mode>`, one record) that also returns the
 * instant the lock is held: `clock_timestamp()` is read over the locked row, so after any wait for an
 * earlier holder. One row `{ locked_at }` (the timestamp as text, so that its microseconds survive
 * the round trip; the same session casts it back), none when the record is gone or out of reach.
 * `dateRecordMarkedMeanwhile` (`linked-ends.ts`) reads the History entries written since that instant.
 */
export function withLockedAt(lock: string): string {
  return `WITH locked AS MATERIALIZED (${lock}) SELECT clock_timestamp()::text AS locked_at FROM locked`;
}
