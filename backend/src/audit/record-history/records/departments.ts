import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The department: its page, its own audit label, its headcount child and their allow-lists.
 *
 * A metric row names its department in the payload (`department_id`), so a parent rule finds it at
 * write time and the migration `1855700000000` fills the rows written before it. The department's
 * own rows name it in `record_id` and keep `parent_*` NULL.
 */
export const departmentsRecord = {
  table: 'departments',
  module: 'departments',
  level: 'reader',
  auditLabels: ['departments'],
  family: 'department',
  children: {
    department_metrics: 'metrics',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A department, as its page shows it; the company is named only for a companies reader. */
const DEPARTMENT_FIELDS: HistoryFields = {
  name: shown(),
  description: shown(),
  status: shown(),
  disabled_at: shown(),
  company_id: shown('company'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The yearly headcount of a department: the entry's title carries the year, the fields the values. */
const DEPARTMENT_METRIC_FIELDS: HistoryFields = {
  headcount: shown(),
  is_frozen: shown(),
  department_id: hidden('the entry is already the department'),
  fiscal_year: hidden('the entry title names the year'),
  frozen_at: hidden('the frozen state and its date are shown by the headcount tab'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the department and its metrics. */
export const departmentsFields: Readonly<Record<string, HistoryFields>> = {
  departments: DEPARTMENT_FIELDS,
  department_metrics: DEPARTMENT_METRIC_FIELDS,
};

/** The audit labels that carry a department, and how to find it. */
export const departmentsParentRules: Readonly<Record<string, AuditParentRule>> = {
  department_metrics: { parentTable: 'departments', from: 'payload', keys: ['department_id'] },
};
