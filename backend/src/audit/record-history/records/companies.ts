import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The company: its page, its own audit label, its metrics child and their allow-lists.
 *
 * A metric row names its company in the payload (`company_id`), so a parent rule finds it at write
 * time and the migration `1855700000000` fills the rows written before it. The company's own rows
 * name it in `record_id` and keep `parent_*` NULL.
 */
export const companiesRecord = {
  table: 'companies',
  module: 'companies',
  level: 'reader',
  auditLabels: ['companies'],
  family: 'company',
  children: {
    company_metrics: 'metrics',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A company, as its page shows it; the chart of accounts is named only for an accounts reader. */
const COMPANY_FIELDS: HistoryFields = {
  name: shown(),
  country_iso: shown(),
  city: shown(),
  address1: shown(),
  address2: shown(),
  postal_code: shown(),
  state: shown(),
  reg_number: shown(),
  vat_number: shown(),
  base_currency: shown(),
  status: shown(),
  disabled_at: shown(),
  notes: shown(),
  coa_id: shown('chart_of_accounts'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The yearly metrics of a company: the entry's title carries the year, the fields the values. */
const COMPANY_METRIC_FIELDS: HistoryFields = {
  headcount: shown(),
  it_users: shown(),
  turnover: shown(),
  is_frozen: shown(),
  company_id: hidden('the entry is already the company'),
  fiscal_year: hidden('the entry title names the year'),
  frozen_at: hidden('the frozen state and its date are shown by the metrics tab'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the company and its metrics. */
export const companiesFields: Readonly<Record<string, HistoryFields>> = {
  companies: COMPANY_FIELDS,
  company_metrics: COMPANY_METRIC_FIELDS,
};

/**
 * The audit labels that carry a company, and how to find it. A metric names it in the payload,
 * after or before (a frozen-year write, a deletion has no metric writer).
 */
export const companiesParentRules: Readonly<Record<string, AuditParentRule>> = {
  company_metrics: { parentTable: 'companies', from: 'payload', keys: ['company_id'] },
};
