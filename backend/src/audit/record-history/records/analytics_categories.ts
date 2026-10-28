import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The analytics value: the value's own record page. Its audit label is also the dimension's child
 * label (`analytics_axes.ts`): the value reads it by `record_id`, the dimension by its parent rule,
 * and the inventory's rule against one label being both the record's own and a child stays inside
 * one entry, so this is allowed across two.
 */
export const analyticsCategoriesRecord = {
  table: 'analytics_categories',
  module: 'analytics',
  level: 'reader',
  auditLabels: ['analytics_categories'],
  family: 'analytics_category',
  children: {},
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/**
 * A value, as its page shows it. The dimension it belongs to is named for an analytics reader; a
 * forced deletion adds the line counts, shown, and its marker, hidden.
 */
const ANALYTICS_CATEGORY_FIELDS: HistoryFields = {
  name: shown(),
  description: shown(),
  status: shown(),
  disabled_at: shown(),
  axis_id: shown('analytics_axis'),
  applies_to: shown(),
  sort_order: shown(),
  opex_lines: shown(),
  capex_lines: shown(),
  lines: hidden('the OPEX and CAPEX counts carry the total'),
  forced: hidden('forced-delete marker, the counts carry the effect'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-list of the value. */
export const analyticsCategoriesFields: Readonly<Record<string, HistoryFields>> = {
  analytics_categories: ANALYTICS_CATEGORY_FIELDS,
};
