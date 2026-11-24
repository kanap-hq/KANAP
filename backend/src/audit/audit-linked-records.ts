import type { EntityManager } from 'typeorm';

/**
 * The links of a budget line to applications and technologies store a bare array of ids, written
 * from either side: the line's side lists applications or technologies, the application's or
 * technology's side lists budget lines. The audit log detail names them, so it reads every id of
 * the entry against both kinds, in one query per kind.
 */
export type AuditLinkedRecord = { ref: string | null; name: string };

/** The audit labels of those links, and the record kinds their ids may name. */
const LINK_TABLES: Record<string, ReadonlyArray<'applications' | 'technologies' | 'spend_items'>> = {
  application_spend_items: ['applications', 'spend_items'],
  application_capex_items: ['applications', 'spend_items'],
  technology_spend_items: ['technologies', 'spend_items'],
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Each kind's reference and name, scoped by tenant. */
const QUERIES: Record<'applications' | 'technologies' | 'spend_items', string> = {
  applications: `SELECT id::text AS id, sequential_id AS ref, name FROM applications
    WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
  technologies: `SELECT id::text AS id, 'TEC-' || item_number AS ref, name FROM technologies
    WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
  spend_items: `SELECT id::text AS id, 'BL-' || item_number AS ref, product_name AS name FROM spend_items
    WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND nature IN ('opex', 'capex')`,
};

/** The ids an audit entry of a link label holds, both sides together; none for any other entry. */
export function auditLinkedIds(entry: { table_name: string; before_json: unknown; after_json: unknown }): string[] {
  if (!LINK_TABLES[entry.table_name]) return [];
  const ids = new Set<string>();
  for (const side of [entry.before_json, entry.after_json]) {
    if (!Array.isArray(side)) continue;
    for (const value of side) {
      if (typeof value === 'string' && UUID_PATTERN.test(value)) ids.add(value.toLowerCase());
    }
  }
  return Array.from(ids).sort();
}

/** The name and reference of each id the entry links that still exists; a missing id is left out. */
export async function loadAuditLinkedRecords(
  manager: EntityManager,
  tenantId: string,
  entry: { table_name: string; before_json: unknown; after_json: unknown },
): Promise<Record<string, AuditLinkedRecord> | undefined> {
  const kinds = LINK_TABLES[entry.table_name];
  if (!kinds) return undefined;
  const ids = auditLinkedIds(entry);
  const records: Record<string, AuditLinkedRecord> = {};
  if (ids.length === 0) return records;
  for (const kind of kinds) {
    const rows: Array<{ id: string; ref: string | null; name: string | null }> = await manager.query(QUERIES[kind], [tenantId, ids]);
    for (const row of rows) {
      records[row.id.toLowerCase()] = { ref: row.ref || null, name: (row.name ?? '').trim() };
    }
  }
  return records;
}
