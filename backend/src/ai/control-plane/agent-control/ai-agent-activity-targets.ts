import type { EntityManager } from 'typeorm';
import { AI_SEARCH_ENTITY_TYPES, BUDGET_LINE_INDEX_ENTITY_TYPES, aiSearchEntityTypeOfIndexRow } from '../../ai.types';
import { buildRef, isUuid } from '../../ai-entity-reference.util';

/**
 * What the Activity screen shows for the object an entry acts on. Kad's approved changes record the
 * object by its id (target_type `tasks`, target_ref the uuid); the screen shows its business
 * reference (T-15, PRJ-3, APP-4...). A family without one shows its type alone: a name is read
 * under the rights of its module, which this screen does not check. The record keeps the id.
 * Ticket and alert targets already carry the number the person knows and are left alone.
 */

type ActivityTarget = { targetType: string | null; targetRef: string | null };

type IndexRow = {
  entity_type: string;
  entity_id: string;
  ref_number: number | null;
  extra_json: Record<string, unknown> | null;
};

const SEARCHED_FAMILIES: ReadonlySet<string> = new Set(AI_SEARCH_ENTITY_TYPES);

export function activityTargetKey(targetType: string, targetRef: string): string {
  return `${targetType}\u0000${targetRef}`;
}

function indexEntityTypes(family: string): string[] {
  return family === 'budget_lines' ? [...BUDGET_LINE_INDEX_ENTITY_TYPES] : [family];
}

function displayOf(row: IndexRow): string | null {
  const family = aiSearchEntityTypeOfIndexRow(row.entity_type);
  if (!family) return null;
  const itemRef = family === 'applications' || family === 'assets' ? row.extra_json?.item_ref : null;
  const reference = typeof itemRef === 'string' && itemRef.trim() ? itemRef.trim() : buildRef(family, row.ref_number);
  return reference ?? null;
}

/**
 * The display text of the targets that name an indexed record by id, in one query for the whole
 * page: key `activityTargetKey(type, id)`, value the reference. A record without a reference, one
 * that no longer exists, or one the index does not hold, has no entry.
 */
export async function resolveActivityTargetDisplays(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  targets: ActivityTarget[],
): Promise<Map<string, string>> {
  // Keyed by family and id; the value keeps the keys of the entries as recorded. A budget line is
  // recorded under its table (`spend_items`) and read as the family `budget_lines`.
  const wanted = new Map<string, { family: string; id: string; keys: Set<string> }>();
  for (const { targetType, targetRef } of targets) {
    if (!targetType || !targetRef || !isUuid(targetRef)) continue;
    const family = aiSearchEntityTypeOfIndexRow(targetType) ?? targetType;
    if (!SEARCHED_FAMILIES.has(family)) continue;
    const id = targetRef.toLowerCase();
    const entry = wanted.get(activityTargetKey(family, id)) ?? { family, id, keys: new Set<string>() };
    entry.keys.add(activityTargetKey(targetType, id));
    wanted.set(activityTargetKey(family, id), entry);
  }
  const displays = new Map<string, string>();
  if (wanted.size === 0) return displays;

  const entityTypes = [...new Set([...wanted.values()].flatMap(({ family }) => indexEntityTypes(family)))];
  const ids = [...new Set([...wanted.values()].map(({ id }) => id))];
  const rows: IndexRow[] = await manager.query(
    `SELECT entity_type, entity_id, ref_number, extra_json
       FROM search_index
      WHERE tenant_id = $1
        AND entity_type = ANY($2::text[])
        AND entity_id = ANY($3::uuid[])`,
    [tenantId, entityTypes, ids],
  );
  for (const row of rows) {
    const family = aiSearchEntityTypeOfIndexRow(row.entity_type);
    const display = displayOf(row);
    if (!family || !display) continue;
    for (const key of wanted.get(activityTargetKey(family, String(row.entity_id).toLowerCase()))?.keys ?? []) {
      displays.set(key, display);
    }
  }
  return displays;
}
