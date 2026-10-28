import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The account (lot 2 pilot): its page, its one audit label and its allow-list.
 *
 * The entry is read by `record-history.inventory.ts`; the fields by `../fields.ts`. A child label
 * joins the entry's `children` and adds its own allow-list below; the data-access exclusions follow
 * the same rule (`record-history.inventory.ts`).
 */
export const accountsRecord = {
  table: 'accounts',
  module: 'accounts',
  level: 'reader',
  auditLabels: ['accounts'],
  family: 'account',
  children: {},
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A chart of accounts, named as its screen names it (`accounts.fields.chartOfAccounts`). */
const ACCOUNT_FIELDS: HistoryFields = {
  account_number: shown(),
  account_name: shown(),
  native_name: shown(),
  description: shown(),
  status: shown(),
  disabled_at: shown(),
  nature: shown(),
  consolidation_account_number: shown(),
  consolidation_account_name: shown(),
  consolidation_account_description: shown(),
  coa_id: shown('chart_of_accounts'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the account's audit labels: the record itself, no child. */
export const accountsFields: Readonly<Record<string, HistoryFields>> = {
  accounts: ACCOUNT_FIELDS,
};
