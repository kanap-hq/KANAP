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

/**
 * The id one element of a link set names: a bare id, or the assistant's relation item
 * (`{ key, label, payload: { <target>_id } }`, `ai-relation-mutation-support.service.ts`), read by
 * its `key` or its single `<x>_id` payload id. Never its stored `label`: the writer's rights made it.
 */
function linkSetEntryId(entry: unknown): string | null {
  if (isUuid(entry)) return entry;
  if (!isPlainObject(entry)) return null;
  if (isUuid(entry.key)) return entry.key;
  if (!isPlainObject(entry.payload)) return null;
  const ids = Object.entries(entry.payload)
    .filter(([key, value]) => key.endsWith('_id') && isUuid(value))
    .map(([, value]) => value as string);
  return ids.length === 1 ? ids[0] : null;
}

/**
 * The ids of a link-set payload: an array of ids or of the assistant's relation items, or `{ ids }`
 * as the writers and `auditedLinkSet` shape it.
 */
export function linkSetIds(value: unknown): string[] {
  const list: unknown[] = Array.isArray(value) ? value : isPlainObject(value) && Array.isArray(value.ids) ? value.ids : [];
  const ids: string[] = [];
  for (const entry of list) {
    const id = linkSetEntryId(entry);
    if (id) ids.push(id.toLowerCase());
  }
  return ids;
}

/**
 * The contact ids of a payload that writes them as `"<contact_id>:<role>"` strings, as bare ids,
 * or as the assistant's relation items (`{ key, label, payload: { contact_id, role } }`).
 */
export function contactIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry === 'string') {
      ids.push(entry.split(':')[0]);
      continue;
    }
    if (!isPlainObject(entry)) continue;
    const payload = isPlainObject(entry.payload) ? entry.payload : entry;
    if (isUuid(payload.contact_id)) ids.push(payload.contact_id);
    else if (isUuid(entry.key)) ids.push(entry.key);
  }
  return Array.from(new Set(ids.filter(isUuid).map((id) => id.toLowerCase())));
}
