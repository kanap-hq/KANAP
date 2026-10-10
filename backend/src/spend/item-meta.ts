import { EntityManager } from 'typeorm';
import { AuthorColumns, RecordChange, RecordMeta, counterWriterSql, recordChange } from '../common/record-meta';
import type { ItemWriteScope } from './item-write.util';
import { assertScopeNatures, auditTableOf, natureAnd, type BudgetNature } from './budget-nature';

/**
 * The meta of an OPEX or CAPEX line (plan planning/perf-scale, lot 3G; contract
 * in `common/record-meta.ts`): what its workspace polls every 30 seconds to
 * learn that someone else changed the line or its budget.
 *
 * - The line: `row_version` (every exported column and the analytics values,
 *   lot 3B), and who wrote it: the audit row of the line that recorded it.
 * - Each version, by year: `budget_rev` (amounts, round inputs, costed lines,
 *   allocations, method and driver), and when it last moved
 *   (`budget_changed_at`, migration 1853840000000). Who: the first audit row
 *   written at or after that moment about the version (amounts, allocations,
 *   the version itself), one of its round inputs, or a column copy or clear of
 *   its year on the line. Every budget writer holds the line's lock and logs
 *   after it writes, so that row is the change's own when the change was
 *   logged; a change nothing logs (an item CSV import's totals, a script)
 *   names nobody, unless a logged write that changed nothing came after it.
 *   A version untouched since that migration has no moment: nobody, no time.
 * One statement, every part on an index and bounded whatever the line's
 * history: the line by its key, its versions by `(tenant_id, item,
 * budget_year)`, the round inputs by `(tenant_id, version_id, measure)`, each
 * audit lookup on `idx_audit_log_tenant_record_created`: the line's writer
 * among its newest rows (`COUNTER_WRITER_WINDOW`), the version's and its round
 * inputs' first row since the moment (one entry each), and a column operation
 * among the first `OPERATION_WINDOW` rows of the line since the moment.
 */

/**
 * How many of the line's audit rows written at or after a version's moment are searched for the
 * column copy or clear that made it: that operation holds the line and logs right after its write,
 * so its row comes first; the rows after it are later edits of the line (thousands on a line
 * edited often since its budget last changed).
 */
export const OPERATION_WINDOW = 10;

export type BudgetVersionMeta = RecordChange & {
  id: string;
  budget_year: number;
  budget_rev: number;
};

export type BudgetLineMeta = RecordMeta & {
  versions: BudgetVersionMeta[];
};

// `audit`: the audit label of the line's rows, by nature (`auditTableOf`); `nature`: the scope's lines in `spend_items` (`budget-nature.ts`).
const TABLES: Record<ItemWriteScope, { items: string; audit: string; versions: string; itemFk: string; rounds: string; nature?: BudgetNature }> = {
  opex: { items: 'spend_items', audit: auditTableOf('opex', 'spend_items'), versions: 'spend_versions', itemFk: 'spend_item_id', rounds: 'spend_round_inputs', nature: 'opex' },
  capex: { items: 'spend_items', audit: auditTableOf('capex', 'spend_items'), versions: 'spend_versions', itemFk: 'spend_item_id', rounds: 'spend_round_inputs', nature: 'capex' },
};
assertScopeNatures('item-meta', TABLES, (t) => t.items);

/** The audit rows that may explain a version's last change, written at or after it; the first one wins. */
function versionWriterSql(t: (typeof TABLES)[ItemWriteScope]): string {
  const since = `a.created_at >= v.budget_changed_at`;
  return `SELECT c.user_id FROM (
            (SELECT a.user_id, a.created_at
               FROM audit_log a
              WHERE a.tenant_id = $1 AND a.record_id = v.id AND ${since}
              ORDER BY a.created_at LIMIT 1)
            UNION ALL
            (SELECT a.user_id, a.created_at
               FROM ${t.rounds} r
               CROSS JOIN LATERAL (
                 SELECT a.user_id, a.created_at
                   FROM audit_log a
                  WHERE a.tenant_id = $1 AND a.record_id = r.id AND ${since}
                  ORDER BY a.created_at LIMIT 1
               ) a
              WHERE r.tenant_id = $1 AND r.version_id = v.id)
            UNION ALL
            (SELECT o.user_id, o.created_at
               FROM (
                 SELECT a.user_id, a.created_at, a.table_name, a.after_json
                   FROM audit_log a
                  WHERE a.tenant_id = $1 AND a.record_id = i.id AND ${since}
                  ORDER BY a.created_at
                  LIMIT ${OPERATION_WINDOW}
               ) o
              WHERE o.table_name = '${t.audit}' AND o.after_json->>'operation' IS NOT NULL
                AND COALESCE(o.after_json->>'destinationYear', o.after_json->>'year') = v.budget_year::text
              ORDER BY o.created_at LIMIT 1)
          ) c
          ORDER BY c.created_at
          LIMIT 1`;
}

type VersionRow = AuthorColumns & { id: string; budget_year: number | string; budget_rev: number | string; changed_at: string | null };
type LineRow = AuthorColumns & { id: string; row_version: number | string; created_at: Date | string | null; versions: VersionRow[] | string | null };

/** The line's meta, or null when the line is not in the tenant or has another nature than the scope's. */
export async function readBudgetLineMeta(manager: EntityManager, scope: ItemWriteScope, tenantId: string, itemId: string): Promise<BudgetLineMeta | null> {
  const t = TABLES[scope];
  const [row]: LineRow[] = await manager.query(
    `SELECT i.id::text AS id, i.row_version,
            u.id::text AS author_id, w.created_at, u.first_name, u.last_name,
            COALESCE((
              SELECT json_agg(json_build_object(
                       'id', v.id, 'budget_year', v.budget_year, 'budget_rev', v.budget_rev, 'changed_at', v.budget_changed_at,
                       'author_id', vu.id, 'first_name', vu.first_name, 'last_name', vu.last_name
                     ) ORDER BY v.budget_year)
                FROM ${t.versions} v
                LEFT JOIN LATERAL (${versionWriterSql(t)}) vw ON true
                LEFT JOIN users vu ON vu.tenant_id = $1 AND vu.id = vw.user_id
               WHERE v.tenant_id = $1 AND v.${t.itemFk} = i.id
            ), '[]'::json) AS versions
       FROM ${t.items} i
       LEFT JOIN LATERAL (${counterWriterSql({ tenant: '$1', table: t.audit, recordId: 'i.id', counter: 'i.row_version' })}) w ON true
       LEFT JOIN users u ON u.tenant_id = $1 AND u.id = w.user_id
      WHERE i.tenant_id = $1 AND i.id = $2${natureAnd('i', t.nature)}`,
    [tenantId, itemId],
  );
  if (!row) return null;
  const versions: VersionRow[] = typeof row.versions === 'string' ? JSON.parse(row.versions) : row.versions ?? [];
  return {
    id: row.id,
    row_version: Number(row.row_version),
    ...recordChange(row, row.created_at),
    versions: versions.map((version) => ({
      id: version.id,
      budget_year: Number(version.budget_year),
      budget_rev: Number(version.budget_rev),
      ...recordChange(version, version.changed_at),
    })),
  };
}
