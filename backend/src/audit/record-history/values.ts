/**
 * The small value helpers the record history shares between its page loader and its presentation:
 * a uuid, a payload object, two values that did not change, and the ids a link or contact payload
 * names. Pure, so both sides read a write the same way.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The ids of a link-set payload: an array of ids, or `{ ids }` as the writers and `auditedLinkSet` shape it. */
export function linkSetIds(value: unknown): string[] {
  const list = Array.isArray(value) ? value : isPlainObject(value) && Array.isArray(value.ids) ? value.ids : [];
  return list.filter(isUuid).map((id) => id.toLowerCase());
}

/** The contact ids of a payload that writes them as `"<contact_id>:<role>"` strings or as bare ids. */
export function contactIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.split(':')[0])
    .filter(isUuid)
    .map((entry) => entry.toLowerCase());
}
