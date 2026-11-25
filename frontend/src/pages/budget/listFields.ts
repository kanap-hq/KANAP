import { dimensionFieldPredicate, type ListFieldPredicate } from '../../components/finance/amountColumns';

/**
 * Fields the budget list no longer has: the PP&E type, investment type and priority are dimension
 * columns since lot C1; the account check (`account_warning`) and the quantity and price check
 * (`entry_check`) are values of the one "To check" column since D12. A saved or linked sort or
 * filter on one falls back like one on a hidden column, in the list and on a line's page (its
 * prev/next walks the list); a saved layout drops their columns.
 */
export const RETIRED_LIST_FIELDS: ReadonlySet<string> = new Set(['ppe_type', 'investment_type', 'priority', 'account_warning', 'entry_check']);

/**
 * The fields the budget list builds: no retired field, and a dimension field only for the given
 * dimensions (the enabled ones besides the default).
 */
export function budgetListFieldPredicate(columnDimensionIds: Iterable<string>): ListFieldPredicate {
  const isDimensionField = dimensionFieldPredicate(columnDimensionIds);
  return (colId) => !RETIRED_LIST_FIELDS.has(colId) && isDimensionField(colId);
}
