import { isUUID } from 'class-validator';
import { AuditService } from '../audit/audit.service';
import { lockBudgetLinesOfBothNatures } from '../spend/budget-locks';
import { auditTableOf, BUDGET_NATURES, type BudgetNature } from '../spend/budget-nature';
import { itemAnalyticsAuditFields, ItemAnalyticsValue, loadItemAnalyticsValues } from '../spend/item-analytics.util';
import { AnalyticsContext } from './analytics-context';

/**
 * Forced deletes of analytics values: a dimension with its values, or a value in use. The links
 * of the budget lines to the values are deleted first, then the values (and the caller deletes
 * the dimension), in the caller's transaction under the tenant. Without `force` the routes keep
 * their refusals; the AI and the CSV import never delete a dimension or a value.
 *
 * Locks, in the order every other writer takes them, so a forced delete never deadlocks with a
 * line write, a value write or a reorder:
 *   1. the lines holding one of the values, both natures, FOR NO KEY UPDATE in id order
 *      (`lockLinesUsing`; a line write holds its line before it reads a value FOR KEY SHARE);
 *   2. the values FOR UPDATE in id order (a value write locks its value before its dimension);
 *   3. the dimension FOR UPDATE (a dimension delete only).
 * A line linked to one of the values after step 1 (committed before step 2 got the value) is
 * locked under step 2 by `deleteValuesAndLinks`: rare, and a writer holding such a line while it
 * waits for one of the values ends in a deadlock, answered 409 `retry` like the other known
 * exceptions of `budget-locks.ts`.
 *
 * The statement triggers of `spend_item_analytics_values` bump each line's `row_version` once and
 * refresh its search entry (migration 1853940000000): this needs `app.current_tenant`, which the
 * request transaction carries.
 *
 * Audit: one `update` row per line (its `row_version` and analytics values before and after, the
 * operation that removed them), one `delete` row per value (with its line counts), and the
 * caller's row for the dimension (with the totals).
 */

const LINKS = 'spend_item_analytics_values';

/** The values a forced delete removes: every value of a dimension, or the values named. */
export type ForcedDeleteScope = { axisId: string } | { valueIds: string[] };

/** Line counts of a forced delete: distinct lines of each nature (a line holds one value per dimension). */
export interface ForcedDeleteCounts {
  values: number;
  lines: number;
  opex_lines: number;
  capex_lines: number;
}

/** `force=true` (query string) or `force: true` (body); anything else is an ordinary delete. */
export function isForced(raw: unknown): boolean {
  return raw === true || String(raw ?? '').trim().toLowerCase() === 'true';
}

function scopeCondition(scope: ForcedDeleteScope): { sql: string; param: string | string[] } {
  return 'axisId' in scope
    ? { sql: 'v.axis_id = $2::uuid', param: scope.axisId }
    : { sql: 'v.category_id = ANY($2::uuid[])', param: scope.valueIds.filter((id) => isUUID(String(id))) };
}

/** Step 1: the lines holding one of the scope's values, locked in id order (both natures). */
export async function lockLinesUsing(ctx: AnalyticsContext, scope: ForcedDeleteScope): Promise<void> {
  const { sql, param } = scopeCondition(scope);
  if (Array.isArray(param) && param.length === 0) return;
  const rows: Array<{ item_id: string }> = await ctx.manager.query(
    `SELECT DISTINCT v.item_id::text AS item_id FROM ${LINKS} v WHERE v.tenant_id = $1 AND ${sql}`,
    [ctx.tenantId, param],
  );
  await lockBudgetLinesOfBothNatures(ctx.manager, ctx.tenantId, rows.map((row) => row.item_id));
}

/** Step 2: the values, FOR UPDATE in id order; unknown ids are absent. */
export async function lockValueRows<T extends { id: string }>(ctx: AnalyticsContext, ids: string[]): Promise<T[]> {
  const valid = ids.filter((id) => isUUID(String(id)));
  if (valid.length === 0) return [];
  return ctx.manager.query(
    `SELECT * FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [ctx.tenantId, valid],
  );
}

/** The ids of every value of a dimension. */
export async function dimensionValueIds(ctx: AnalyticsContext, axisId: string): Promise<string[]> {
  const rows: Array<{ id: string }> = await ctx.manager.query(
    `SELECT id::text AS id FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2::uuid`,
    [ctx.tenantId, axisId],
  );
  return rows.map((row) => row.id);
}

/**
 * Once the lines and `values` are locked (steps 1 and 2): deletes the scope's links, then the
 * values, and writes the audit rows of the lines and of the values. `values` are the scope's
 * values as locked (every value of the dimension, or the values named that exist). `details`
 * goes into each line's audit row (`operation`, and what was deleted).
 */
export async function deleteValuesAndLinks(
  ctx: AnalyticsContext,
  audit: AuditService,
  scope: ForcedDeleteScope,
  values: Array<{ id: string }>,
  details: Record<string, unknown> & { operation: string },
): Promise<ForcedDeleteCounts> {
  const { manager, tenantId } = ctx;
  const { sql, param } = scopeCondition(scope);
  const entry = { userId: ctx.userId ?? null, source: ctx.audit?.source, sourceRef: ctx.audit?.sourceRef ?? null };

  // The links as they stand under the value locks: no line can link one of these values any more.
  const links: Array<{ item_id: string; category_id: string; nature: BudgetNature; row_version: string | number }> =
    Array.isArray(param) && param.length === 0
      ? []
      : await manager.query(
        `SELECT v.item_id::text AS item_id, v.category_id::text AS category_id, si.nature, si.row_version
           FROM ${LINKS} v
           JOIN spend_items si ON si.tenant_id = v.tenant_id AND si.id = v.item_id AND si.nature = ANY($3::text[])
          WHERE v.tenant_id = $1 AND ${sql}`,
        [tenantId, param, BUDGET_NATURES],
      );
  const lines = new Map<string, { nature: BudgetNature; rowVersion: number }>();
  const linesByValue = new Map<string, { opex: number; capex: number }>();
  for (const link of links) {
    lines.set(link.item_id, { nature: link.nature, rowVersion: Number(link.row_version) });
    const counts = linesByValue.get(link.category_id) ?? { opex: 0, capex: 0 };
    counts[link.nature] += 1;
    linesByValue.set(link.category_id, counts);
  }
  const lineIds = Array.from(lines.keys());

  let before = new Map<string, ItemAnalyticsValue[]>();
  if (lineIds.length > 0) {
    // Lines linked between step 1 and the value locks: held by nobody now, locked before the delete.
    await lockBudgetLinesOfBothNatures(manager, tenantId, lineIds);
    before = await loadItemAnalyticsValues(manager, 'opex', tenantId, lineIds);
    await manager.query(`DELETE FROM ${LINKS} v WHERE v.tenant_id = $1 AND ${sql}`, [tenantId, param]);
  }

  const valueIds = values.map((value) => value.id);
  if (valueIds.length > 0) {
    await manager.query(
      `DELETE FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, valueIds],
    );
  }

  if (lineIds.length > 0) {
    // After every delete: `row_version` as the triggers (and any `ON DELETE SET NULL`) left it.
    const after = await loadItemAnalyticsValues(manager, 'opex', tenantId, lineIds);
    const versions: Array<{ id: string; row_version: string | number }> = await manager.query(
      `SELECT id::text AS id, row_version FROM spend_items WHERE tenant_id = $1 AND id = ANY($2::uuid[]) AND nature = ANY($3::text[])`,
      [tenantId, lineIds, BUDGET_NATURES],
    );
    const versionById = new Map(versions.map((row) => [row.id, Number(row.row_version)]));
    for (const lineId of [...lineIds].sort()) {
      const line = lines.get(lineId)!;
      await audit.log(
        {
          table: auditTableOf(line.nature, 'spend_items'),
          recordId: lineId,
          action: 'update',
          before: { row_version: line.rowVersion, ...itemAnalyticsAuditFields(before.get(lineId) ?? []) },
          after: { row_version: versionById.get(lineId) ?? line.rowVersion, ...itemAnalyticsAuditFields(after.get(lineId) ?? []), ...details },
          ...entry,
        },
        { manager },
      );
    }
  }

  for (const value of values) {
    const counts = linesByValue.get(value.id) ?? { opex: 0, capex: 0 };
    await audit.log(
      {
        table: 'analytics_categories',
        recordId: value.id,
        action: 'delete',
        before: value,
        after: { forced: true, lines: counts.opex + counts.capex, opex_lines: counts.opex, capex_lines: counts.capex },
        ...entry,
      },
      { manager },
    );
  }

  const natures = Array.from(lines.values());
  const opex = natures.filter((line) => line.nature === 'opex').length;
  return { values: values.length, lines: lines.size, opex_lines: opex, capex_lines: lines.size - opex };
}
