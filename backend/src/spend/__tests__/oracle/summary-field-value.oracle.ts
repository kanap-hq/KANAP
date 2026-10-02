import { parseAnalyticsFieldKey } from '../../../analytics/analytics-axes.util';
import {
  PROJECT_LIST_FIELDS,
  resolveAmountField,
  resolveFteField,
  SlotMetric,
  summaryRowProjectNames,
} from '../../spend-summary.builder';

/**
 * How the in-memory list engine and the former AI aggregates read one field
 * of a built row. They left the runtime (lot 2B: the list engine in PR C,
 * the AI aggregates in PR D, both now SQL); the list engine's oracles keep
 * them, unchanged: moved here from `spend-summary.builder.ts` as they were.
 */

function slotValue(row: any, slotKey: string, metric: SlotMetric): number {
  const slot = row?.versions?.[slotKey];
  if (!slot) return 0;
  if (slot.reporting && typeof slot.reporting[metric] === 'number') return slot.reporting[metric];
  if (slot.totals && typeof slot.totals[metric] === 'number') return slot.totals[metric];
  return 0;
}

/**
 * The value of `field` on a built row, as the list shows it (the AI
 * aggregates group and measure with it; the list engine's oracle sorts and
 * filters on it): an amount field is the slot's reporting total (item
 * currency when there is no reporting), an FTE field its number or null
 * (unknown), a derived field its row value, anything else the item column.
 * Blank derived text reads as null so blanks sort last ascending.
 */
export function getSummaryFieldValue(row: any, field: string): any {
  const amount = resolveAmountField(field);
  if (amount) return slotValue(row, amount.slot, amount.column.key);
  if (resolveFteField(field)) return typeof row?.[field] === 'number' ? row[field] : null;
  const blankToNull = (value: unknown) => (value == null || value === '' ? null : value);
  switch (field) {
    case 'supplier_name':
      return blankToNull(row?.supplier_name ?? row?.supplier?.name);
    case 'paying_company_name':
      return blankToNull(row?.paying_company_name ?? row?.company_name);
    case 'company_name':
      return blankToNull(row?.company_name ?? row?.paying_company_name);
    case 'account_display':
    case 'account_name':
    case 'account_number':
    case 'owner_it_name':
    case 'owner_business_name':
    case 'analytics_category_name':
    case 'cost_center_code':
    case 'cost_center_name':
    case 'cost_center_label':
    case 'cost_center_path':
    case 'budget_holder_name':
    case 'project_name':
    case 'project_stream_name':
    case 'project_category_name':
    case 'account_warning':
      return blankToNull(row?.[field]);
    case 'contract_name':
      return blankToNull(row?.latest_contract_name);
    case 'allocation_label':
    case 'allocation_method_label':
      return blankToNull(row?.allocation_method_label);
    case 'latest_task_text':
      return blankToNull(row?.latest_task?.title);
    default: {
      // A key the row does not hold itself (`constructor`, `__proto__`…) reads as missing, never as an inherited member.
      const own = row != null && Object.prototype.hasOwnProperty.call(row, field) ? row[field] : undefined;
      // A dimension's value name (`analytics_<axis id>`) is derived text like the names above.
      return parseAnalyticsFieldKey(field) ? blankToNull(own) : own;
    }
  }
}

/** Every value a row holds for `field`: each linked name for the project fields, else the one field value. */
export function summaryFieldValues(row: any, field: string): unknown[] {
  return PROJECT_LIST_FIELDS.includes(field) ? summaryRowProjectNames(row, field) : [getSummaryFieldValue(row, field)];
}
