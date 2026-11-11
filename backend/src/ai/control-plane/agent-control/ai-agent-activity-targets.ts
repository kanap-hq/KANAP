import type { EntityManager } from 'typeorm';
import { AI_SEARCH_ENTITY_TYPES, BUDGET_LINE_INDEX_ENTITY_TYPES, aiSearchEntityTypeOfIndexRow } from '../../ai.types';
import { buildRef, isUuid } from '../../ai-entity-reference.util';

/**
 * What the Activity screen shows for the object an entry acts on. Kad's approved changes record the
 * object by its id (target_type `tasks`, target_ref the uuid); the screen shows its business
 * reference (T-15, PRJ-3, APP-4...) or, for a family without one, its name. The record keeps the id.
 * Ticket and alert targets already carry the number the person knows and are left alone.
 */

type ActivityTarget = { targetType: string | null; targetRef: string | null };

type IndexRow = {
  entity_type: string;
  entity_id: string;
  label: string | null;
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
  return reference ?? (row.label?.trim() || null);
}

/**
 * The display text of the targets that name an indexed record by id, in one query for the whole
 * page: key `activityTargetKey(type, id)`, value the reference or the name. A record that no longer
 * exists, or that the index does not hold, has no entry.
 */
export async function resolveActivityTargetDisplays(
  manager: Pick<EntityManager, 'query'>,
  tenantId: string,
  targets: ActivityTarget[],
): Promise<Map<string, string>> {
  const wanted = new Map<string, { family: string; id: string }>();
  for (const { targetType, targetRef } of targets) {
    if (!targetType || !targetRef || !SEARCHED_FAMILIES.has(targetType) || !isUuid(targetRef)) continue;
    wanted.set(activityTargetKey(targetType, targetRef.toLowerCase()), { family: targetType, id: targetRef.toLowerCase() });
  }
  const displays = new Map<string, string>();
  if (wanted.size === 0) return displays;

  const entityTypes = [...new Set([...wanted.values()].flatMap(({ family }) => indexEntityTypes(family)))];
  const ids = [...new Set([...wanted.values()].map(({ id }) => id))];
  const rows: IndexRow[] = await manager.query(
    `SELECT entity_type, entity_id, label, ref_number, extra_json
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
    const key = activityTargetKey(family, String(row.entity_id).toLowerCase());
    if (wanted.has(key)) displays.set(key, display);
  }
  return displays;
}
