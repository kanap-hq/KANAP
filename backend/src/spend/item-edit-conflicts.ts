import { EntityManager } from 'typeorm';
import { EditBase, EditConflict, EditedField, assertNoEditConflicts, hasBase, sameFieldValue } from '../common/edit-conflicts';
import { ItemAnalyticsChange, ItemAnalyticsValue } from './item-analytics.util';
import { ItemWriteScope, itemFieldColumn, itemWritableColumns } from './item-write.util';
import { auditTableOf } from './budget-nature';

/**
 * The edit conflicts of an OPEX or CAPEX line update (plan planning/perf-scale,
 * lot 3C; contract in `common/edit-conflicts.ts`), checked by
 * `updateItemUnderLock` on the locked row, after `resolveItemWrite` and before
 * the UPDATE.
 *
 * Fields compared, when the request changes them and its `base` names them:
 * - every writable column of the line (`itemWritableColumns`): description,
 *   notes, supplier, company, account, owners, dates, enums…;
 * - `disabled_at`, the end of validity, when the request changes it (or the
 *   status, which sets it); `status` itself is derived from it and never
 *   compared;
 * - each analytics dimension of `analytics_values`, on its own: field
 *   `analytics_values.<dimension id>` (two people setting two different
 *   dimensions never conflict).
 * The requested value is the resolved one (an id lower-cased, a run or build
 * read, a date parsed), so a request that sets the stored value is no conflict.
 * A currency compares without case: the screen shows it in capitals, while a
 * line imported or written by the AI may store it in small letters.
 */

/** The audit label of a line of each nature (`auditTableOf`): the history the conflicts read. */
const TABLES: Record<ItemWriteScope, string> = { opex: auditTableOf('opex', 'spend_items'), capex: auditTableOf('capex', 'spend_items') };

export const ANALYTICS_FIELD_PREFIX = 'analytics_values.';

type LockedLine = Record<string, any> & { row_version?: number | null; updated_at?: Date | string | null; disabled_at?: Date | string | null };

const LIFECYCLE_INPUTS = ['disabled_at', 'status', 'effective_end'];

/** Columns whose values are codes compared without case (`eur` and `EUR` are one currency). */
const CASE_INSENSITIVE_COLUMNS = new Set(['currency']);
const upper = (value: unknown) => (typeof value === 'string' ? value.toUpperCase() : value);
const sameCode = (left: unknown, right: unknown) => sameFieldValue(upper(left), upper(right));

/** The fields of the request that carry a base, with their stored and requested values. */
export function itemEditedFields(
  scope: ItemWriteScope,
  base: EditBase,
  changes: Record<string, unknown>,
  resolved: {
    before: LockedLine;
    analyticsBefore: ItemAnalyticsValue[];
    values: Record<string, unknown>;
    disabledAt: Date | null;
    analytics: ItemAnalyticsChange[];
  },
): EditedField[] {
  const supplied = (key: string) => Object.prototype.hasOwnProperty.call(changes, key) && changes[key] !== undefined;
  const fields: EditedField[] = [];
  // By API field (`description` for a CAPEX title, as the screen and the CAPEX audit rows name it), read on its column.
  for (const field of itemWritableColumns(scope)) {
    const column = itemFieldColumn(scope, field);
    if (!supplied(field) || !(column in resolved.values) || !hasBase(base, field)) continue;
    fields.push({
      field,
      base: base[field],
      current: resolved.before[column] ?? null,
      mine: resolved.values[column],
      auditPath: [field],
      ...(CASE_INSENSITIVE_COLUMNS.has(field) ? { same: sameCode } : {}),
    });
  }
  if (hasBase(base, 'disabled_at') && LIFECYCLE_INPUTS.some(supplied)) {
    fields.push({
      field: 'disabled_at', base: base.disabled_at, current: resolved.before.disabled_at ?? null, mine: resolved.disabledAt, auditPath: ['disabled_at'],
    });
  }
  const analyticsBase = base.analytics_values;
  if (analyticsBase && typeof analyticsBase === 'object' && !Array.isArray(analyticsBase)) {
    const baseByAxis = new Map(Object.entries(analyticsBase as Record<string, unknown>).map(([axisId, value]) => [axisId.toLowerCase(), value]));
    for (const change of resolved.analytics) {
      const axisId = change.axis_id.toLowerCase();
      if (!baseByAxis.has(axisId) || baseByAxis.get(axisId) === undefined) continue;
      const current = resolved.analyticsBefore.find((value) => value.axis_id.toLowerCase() === axisId)?.category_id ?? null;
      fields.push({
        field: `${ANALYTICS_FIELD_PREFIX}${axisId}`,
        base: baseByAxis.get(axisId),
        current,
        mine: change.category_id,
        auditPath: ['analytics_values', axisId],
      });
    }
  }
  return fields;
}

/** The table each id field names, and the label the pickers show for it. Expressions are constants. */
const LABEL_SOURCES: Record<string, { table: string; label: string }> = {
  supplier_id: { table: 'suppliers', label: 'name' },
  paying_company_id: { table: 'companies', label: 'name' },
  account_id: { table: 'accounts', label: `'[' || account_number || '] ' || account_name` },
  owner_it_id: { table: 'users', label: `COALESCE(NULLIF(trim(concat_ws(' ', NULLIF(trim(first_name), ''), NULLIF(trim(last_name), ''))), ''), email)` },
  owner_business_id: { table: 'users', label: `COALESCE(NULLIF(trim(concat_ws(' ', NULLIF(trim(first_name), ''), NULLIF(trim(last_name), ''))), ''), email)` },
  project_id: { table: 'portfolio_projects', label: 'name' },
  contract_id: { table: 'contracts', label: 'name' },
  cost_center_id: { table: 'cost_centers', label: `code || ' · ' || name` },
  [ANALYTICS_FIELD_PREFIX]: { table: 'analytics_categories', label: 'name' },
};

function labelSource(field: string) {
  return LABEL_SOURCES[field.startsWith(ANALYTICS_FIELD_PREFIX) ? ANALYTICS_FIELD_PREFIX : field];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The names of the id values of the conflicting fields (base, current and requested), in one query. */
export async function itemConflictLabels(manager: EntityManager, tenantId: string, conflicts: EditedField[]): Promise<Map<string, EditConflict['labels']>> {
  const idsBySource = new Map<string, { table: string; label: string; ids: Set<string> }>();
  const idOf = (value: unknown) => (typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : null);
  for (const conflict of conflicts) {
    const source = labelSource(conflict.field);
    if (!source) continue;
    const key = `${source.table}:${source.label}`;
    const entry = idsBySource.get(key) ?? { ...source, ids: new Set<string>() };
    for (const value of [conflict.base, conflict.current, conflict.mine]) {
      const id = idOf(value);
      if (id) entry.ids.add(id);
    }
    idsBySource.set(key, entry);
  }
  const names = new Map<string, string>();
  const sources = Array.from(idsBySource.values()).filter((source) => source.ids.size > 0);
  if (sources.length > 0) {
    const params: unknown[] = [tenantId];
    const selects = sources.map((source) => {
      params.push(Array.from(source.ids));
      // Tables and expressions come from LABEL_SOURCES only.
      return `SELECT '${source.table}' AS tbl, id::text AS id, (${source.label})::text AS label FROM ${source.table} WHERE tenant_id = $1 AND id = ANY($${params.length}::uuid[])`;
    });
    const rows: Array<{ tbl: string; id: string; label: string | null }> = await manager.query(selects.join(' UNION ALL '), params);
    for (const row of rows) if (row.label) names.set(`${row.tbl}:${row.id}`, row.label);
  }
  const result = new Map<string, EditConflict['labels']>();
  for (const conflict of conflicts) {
    const source = labelSource(conflict.field);
    const name = (value: unknown) => {
      const id = idOf(value);
      return source && id ? names.get(`${source.table}:${id}`) ?? null : null;
    };
    result.set(conflict.field, { base: name(conflict.base), current: name(conflict.current), mine: name(conflict.mine) });
  }
  return result;
}

/**
 * Refuses the update with 409 `edit_conflict` when a field it changes was
 * changed by someone else since the user's screen read it. Nothing to compare
 * without a base.
 */
export async function assertNoItemEditConflicts(
  manager: EntityManager,
  scope: ItemWriteScope,
  tenantId: string,
  itemId: string,
  base: EditBase | null,
  changes: Record<string, unknown>,
  resolved: Parameters<typeof itemEditedFields>[3],
): Promise<void> {
  if (!base) return;
  const fields = itemEditedFields(scope, base, changes, resolved);
  if (fields.length === 0) return;
  await assertNoEditConflicts(manager, {
    tenantId,
    table: TABLES[scope],
    recordId: itemId,
    fields,
    rowVersion: resolved.before.row_version ?? null,
    fallbackAt: resolved.before.updated_at ?? null,
    labelsFor: (conflicts) => itemConflictLabels(manager, tenantId, conflicts),
  });
}
