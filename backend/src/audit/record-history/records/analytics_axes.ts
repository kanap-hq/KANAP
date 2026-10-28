import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The analytics dimension: its page, its own audit label and its values as a child.
 *
 * A value row names its dimension in the payload (`axis_id`), so a parent rule finds it at write
 * time and the migration `1855700000000` fills the rows written before it. The same label
 * (`analytics_categories`) is the value's own record (`analytics_categories.ts`): the value's
 * history reads it by `record_id`, the dimension's history by `parent_id`.
 */
export const analyticsAxesRecord = {
  table: 'analytics_axes',
  module: 'analytics',
  level: 'reader',
  auditLabels: ['analytics_axes'],
  family: 'analytics_axis',
  children: {
    analytics_categories: 'value',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/**
 * A dimension, as its page shows it. A forced deletion adds the counts of what went with it
 * (`values`, `lines`, `opex_lines`, `capex_lines`): the counts are shown, the marker is not.
 */
const ANALYTICS_AXIS_FIELDS: HistoryFields = {
  code: shown(),
  name: shown(),
  description: shown(),
  sort_order: shown(),
  is_default: shown(),
  status: shown(),
  disabled_at: shown(),
  applies_to: shown(),
  required: shown(),
  open_values: shown(),
  values: shown(),
  opex_lines: shown(),
  capex_lines: shown(),
  lines: hidden('the OPEX and CAPEX counts carry the total'),
  forced: hidden('forced-delete marker, the counts carry the effect'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-list of the dimension; its values' label is owned by `analytics_categories.ts`. */
export const analyticsAxesFields: Readonly<Record<string, HistoryFields>> = {
  analytics_axes: ANALYTICS_AXIS_FIELDS,
};

/** The audit labels that carry a dimension, and how to find it (a value names its `axis_id`). */
export const analyticsAxesParentRules: Readonly<Record<string, AuditParentRule>> = {
  analytics_categories: { parentTable: 'analytics_axes', from: 'payload', keys: ['axis_id'] },
};
