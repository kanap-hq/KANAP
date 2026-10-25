import { isoDateTimeInTimeZone } from '../common/csv-sheet';

/** A full ISO instant, with its zone: what tool results carry for a date-time value. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Writes every date-time value of a tool result in the user's zone, with the
 * zone's explicit offset (`2026-06-02T07:50:00+02:00`). The database hands the
 * tools UTC instants, and the assistant answers in the time the user sees; a
 * value read as UTC would be quoted as another hour. Date-only fields and every
 * other string stay as they are.
 *
 * The MCP server reads the dispatcher output directly, so it keeps the ISO UTC
 * values (`...Z`): an external client gets an unambiguous instant, not a zone.
 */
export function formatToolResultDateTimes(value: unknown, timeZone: string): unknown {
  if (value instanceof Date) {
    return isoDateTimeInTimeZone(value, timeZone) ?? value;
  }
  if (typeof value === 'string') {
    if (!ISO_TIMESTAMP.test(value)) return value;
    return isoDateTimeInTimeZone(value, timeZone) ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatToolResultDateTimes(entry, timeZone));
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return value;
  }
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    output[key] = formatToolResultDateTimes(entry, timeZone);
  }
  return output;
}
