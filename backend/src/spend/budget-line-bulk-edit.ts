import { BadRequestException, HttpException, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  BULK_MAX_ROWS,
  BULK_REFUSAL_NOT_FOUND,
  BulkEditField,
  BulkEditList,
  BulkEditResult,
  bulkTooMany,
  parseBulkChanges,
  parseBulkConfirmation,
  parseBulkSelection,
  runBulkEdit,
} from '../common/bulk-edit/bulk-edit';
import { DataAccessLimitedException, type DataAccessReason } from '../data-access/line-write-checks';
import { loadAnalyticsAxes } from '../analytics/analytics-axes.util';
import { BUDGET_NATURES, naturesAnd, type BudgetNature } from './budget-nature';
import { lockBudgetLinesOfBothNatures } from './budget-locks';
import { summaryTenantId } from './spend-summary.builder';
import {
  notApplicableDimensionMessage,
  notApplicableValueMessage,
  requiredDimensionMessage,
} from './item-analytics.util';
import { ACCOUNT_CHART_REFUSAL, accountNatureRefusal, RUN_BUILD_VALUES } from './item-write.util';

/**
 * "Change the selection" of the budget lines list (lot F1 of 26.11.8): one change on many lines of
 * both natures, through the update of one line (`BudgetLinesService.updateLine`, the PATCH's), so
 * every rule of that update holds for each line: the data access of a limited person, the chart of
 * accounts of the paying company, the type of an account, a dimension or a value, a required
 * dimension, the cost center rules, the line's row lock, its audit row (its history) and the search
 * index its triggers maintain. The contract is the common one (`common/bulk-edit/bulk-edit.ts`).
 *
 * The fields (rules of Fried, P10): cost center, account, paying company, supplier, IT owner,
 * business owner, run or build, dimension values. No amount. The paying company and the account
 * cannot be emptied (the line's screen requires both); the others can. A dimension may be emptied
 * in the body; a line holding a value on a dimension required for its type refuses it.
 *
 * A refused line is counted under a stable code (`BUDGET_LINE_BULK_REFUSALS`) and left as it is.
 * A chosen line the person cannot read and a line that is gone are both `not_found`: the count says
 * nothing of the lines outside the person's access. An error that is not a refusal of the line (a
 * value that names nothing, a disabled cost center or value) fails the whole request with the
 * update's own 400.
 */

export const BUDGET_LINE_BULK_FIELDS: readonly BulkEditField[] = [
  { name: 'cost_center_id', value: 'id', optional: true },
  { name: 'account_id', value: 'id', optional: false },
  { name: 'paying_company_id', value: 'id', optional: false },
  { name: 'supplier_id', value: 'id', optional: true },
  { name: 'owner_it_id', value: 'id', optional: true },
  { name: 'owner_business_id', value: 'id', optional: true },
  { name: 'run_build', value: 'enum', values: RUN_BUILD_VALUES, optional: true },
  // { [dimension id]: value id | null }, the body of the line's update.
  { name: 'analytics_values', value: 'id_map', optional: true },
];

/** The columns of `spend_items` the plain fields write, as the update of one line names them. */
const COLUMNS = BUDGET_LINE_BULK_FIELDS.filter((field) => field.value !== 'id_map').map((field) => field.name);

/** The codes of a refused line, which the screen and Kad word. */
export const BUDGET_LINE_BULK_REFUSALS = [
  BULK_REFUSAL_NOT_FOUND,
  'read_only',
  'placement',
  'leaves_access',
  'account_chart',
  'account_nature',
  'dimension_required',
  'dimension_not_applicable',
  'value_not_applicable',
] as const;
export type BudgetLineBulkRefusal = (typeof BUDGET_LINE_BULK_REFUSALS)[number];

const DATA_ACCESS_REFUSALS: Partial<Record<DataAccessReason, BudgetLineBulkRefusal>> = {
  outside: 'read_only',
  readOnlyLine: 'read_only',
  placement: 'placement',
  leavesAccess: 'leaves_access',
};

type LineRow = { id: string; nature: BudgetNature; values: Record<string, string | null>; dimensions: Map<string, string> };

export type BudgetLineBulkDeps = {
  manager: EntityManager;
  /** The ids of the list's filters, with the person's access (`BudgetLinesService.summaryIds`). */
  listIds: (filters: Record<string, unknown>) => Promise<{ ids: string[] }>;
  /** The update of one line (the PATCH's), on the request's manager. */
  updateLine: (line: { id: string; nature: BudgetNature }, body: Record<string, unknown>) => Promise<void>;
};

/**
 * The body of `POST /budget-lines/bulk-update`: the selection (`ids`, or `all` with `filters` and
 * `exclude_ids`), `changes`, and `dry_run`, or the `as_of` and `expected_rows` of the dry run.
 */
export async function bulkUpdateBudgetLines(body: unknown, deps: BudgetLineBulkDeps): Promise<BulkEditResult> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('A body is required.');
  const input = body as Record<string, unknown>;
  const selection = parseBulkSelection(input);
  const changes = parseBulkChanges(input.changes, BUDGET_LINE_BULK_FIELDS);
  const confirmation = parseBulkConfirmation(input, selection.all);
  const { manager } = deps;
  const tenantId = await summaryTenantId(manager);
  const columns = COLUMNS.filter((column) => column in changes);
  const dimensions = (changes.analytics_values ?? {}) as Record<string, string | null>;
  const axisIds = Object.keys(dimensions);
  const refusals = await refusalMessages(manager, tenantId, dimensions);

  const list: BulkEditList<LineRow> = {
    async reach(chosen, asOf) {
      let ids = chosen.ids;
      if (chosen.all) {
        const excluded = new Set(chosen.excluded);
        ids = (await deps.listIds(chosen.filters)).ids.filter((id) => !excluded.has(id.toLowerCase()));
        // Neither locked nor read past the cap.
        if (ids.length > BULK_MAX_ROWS) throw bulkTooMany(ids.length);
      }
      if (ids.length === 0) return [];
      // The lines the person may modify, in id order (the lock order of the budget writers), before
      // their values are read; a line the person only reads is not locked and refuses its update.
      await lockBudgetLinesOfBothNatures(manager, tenantId, ids);
      const params: unknown[] = [tenantId, ids];
      let created = '';
      if (asOf) {
        params.push(asOf);
        created = ` AND i.created_at <= $${params.length}::timestamptz`;
      }
      const rows: Array<Record<string, string | null> & { id: string; nature: BudgetNature }> = await manager.query(
        `SELECT i.id::text AS id, i.nature, ${COLUMNS.map((column) => `i.${column}::text AS ${column}`).join(', ')}
           FROM spend_items i
          WHERE i.tenant_id = $1${naturesAnd('i', BUDGET_NATURES)} AND i.id = ANY($2::uuid[])${created}
          ORDER BY i.id`,
        params,
      );
      const held = new Map<string, Map<string, string>>();
      if (axisIds.length > 0 && rows.length > 0) {
        const values: Array<{ item_id: string; axis_id: string; category_id: string }> = await manager.query(
          `SELECT item_id::text AS item_id, axis_id::text AS axis_id, category_id::text AS category_id
             FROM spend_item_analytics_values
            WHERE tenant_id = $1 AND item_id = ANY($2::uuid[]) AND axis_id = ANY($3::uuid[])`,
          [tenantId, rows.map((row) => row.id), axisIds],
        );
        for (const value of values) {
          const line = held.get(value.item_id) ?? new Map<string, string>();
          line.set(value.axis_id, value.category_id);
          held.set(value.item_id, line);
        }
      }
      return rows.map((row) => ({
        id: row.id,
        nature: row.nature,
        values: Object.fromEntries(COLUMNS.map((column) => [column, row[column] ?? null])),
        dimensions: held.get(row.id) ?? new Map(),
      }));
    },

    async apply(line) {
      const same = columns.every((column) => line.values[column] === changes[column])
        && axisIds.every((axisId) => (line.dimensions.get(axisId) ?? null) === dimensions[axisId]);
      if (same) return 'unchanged';
      const update: Record<string, unknown> = {};
      for (const column of columns) update[column] = changes[column];
      if (axisIds.length > 0) update.analytics_values = dimensions;
      await deps.updateLine(line, update);
      return 'changed';
    },

    refusal(error, line) {
      if (error instanceof DataAccessLimitedException) {
        const reason = (error.getResponse() as { reason?: DataAccessReason }).reason;
        return (reason && DATA_ACCESS_REFUSALS[reason]) || null;
      }
      // The line's lock found nothing: gone since it was reached, or hidden from the person.
      if (error instanceof NotFoundException) return BULK_REFUSAL_NOT_FOUND;
      if (!(error instanceof BadRequestException)) return null;
      const message = (error as HttpException).message;
      if (message === ACCOUNT_CHART_REFUSAL) return 'account_chart';
      if (message === accountNatureRefusal(line.nature)) return 'account_nature';
      if (refusals.required.has(message)) return 'dimension_required';
      if (refusals.dimensionNotApplicable.has(message)) return 'dimension_not_applicable';
      if (refusals.valueNotApplicable.has(message)) return 'value_not_applicable';
      return null;
    },
  };
  return runBulkEdit(manager, list, selection, confirmation);
}

/**
 * The messages of the update of one line that refuse a line for a dimension of the change, as that
 * update words them (`item-analytics.util.ts`): a required dimension emptied, a dimension or a value
 * of the other type of line.
 */
async function refusalMessages(manager: EntityManager, tenantId: string, dimensions: Record<string, string | null>) {
  const required = new Set<string>();
  const dimensionNotApplicable = new Set<string>();
  const valueNotApplicable = new Set<string>();
  const axisIds = Object.keys(dimensions);
  if (axisIds.length > 0) {
    for (const axis of (await loadAnalyticsAxes(manager, tenantId)).filter((a) => axisIds.includes(a.id))) {
      required.add(requiredDimensionMessage(axis));
      if (axis.applies_to) dimensionNotApplicable.add(notApplicableDimensionMessage(axis));
    }
    const valueIds = Object.values(dimensions).filter((id): id is string => !!id);
    if (valueIds.length > 0) {
      const values: Array<{ name: string; applies_to: string | null }> = await manager.query(
        `SELECT name, applies_to FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [tenantId, valueIds],
      );
      for (const value of values.filter((v) => v.applies_to)) {
        for (const nature of BUDGET_NATURES) valueNotApplicable.add(notApplicableValueMessage(value, nature));
      }
    }
  }
  return { required, dimensionNotApplicable, valueNotApplicable };
}
