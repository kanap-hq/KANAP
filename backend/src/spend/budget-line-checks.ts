/**
 * The data quality checks of a budget line, read as one field of the list, `to_check` (decision
 * D12): the names of the checks the line fails, in this table's order, null when it fails none.
 * One column of the list shows them, one filter offers a box per check, and the overview's data
 * hygiene counts open the list on one of them. A new check is one more entry here, then its SQL in
 * the list (`budget-list.config.ts`, `CHECK_SQL`) and its value on the rows
 * (`spend-summary.builder.ts`): never a field or a column of its own.
 *
 * - `quantity_price`: the line's account, or its consolidation account, expects quantity and price
 *   and one of its columns is not built so (`budget-line-entry-check.ts`);
 * - `coa_mismatch`: the line's account belongs to another chart of accounts than its paying
 *   company's (also the older field `account_warning`, kept for the API's readers).
 */
export const TO_CHECK_FIELD = 'to_check';

export const BUDGET_LINE_CHECKS = ['quantity_price', 'coa_mismatch'] as const;
export type BudgetLineCheck = (typeof BUDGET_LINE_CHECKS)[number];

const KNOWN = new Set<string>(BUDGET_LINE_CHECKS);

/**
 * The checks a filter model on `to_check` needs, when it needs only some: a set filter that keeps
 * lines by check names (include mode, no blank marker), the overview's link and a box of the
 * column. Null for any other model (blank, exclusion, a condition on the text): every check.
 * A statement whose only use of the field is such a filter evaluates those checks alone, so the
 * count of one check costs what it cost as a field of its own.
 */
export function checksNamedByFilter(model: unknown): BudgetLineCheck[] | null {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return null;
  const set = model as { filterType?: unknown; type?: unknown; values?: unknown; mode?: unknown; operator?: unknown };
  if (set.operator != null) return null;
  if ((set.filterType !== 'set' && set.type !== 'set') || !Array.isArray(set.values)) return null;
  if (set.mode != null && set.mode !== 'include') return null;
  if (!set.values.every((value) => typeof value === 'string' && KNOWN.has(value))) return null;
  return BUDGET_LINE_CHECKS.filter((check) => (set.values as unknown[]).includes(check));
}
