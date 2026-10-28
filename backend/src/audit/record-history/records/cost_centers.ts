import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The cost center (lot 2 pilot): its page, its one audit label and its allow-list.
 *
 * The entry is read by `record-history.inventory.ts`; the fields by `../fields.ts`.
 */
export const costCentersRecord = {
  table: 'cost_centers',
  module: 'cost_centers',
  level: 'reader',
  auditLabels: ['cost_centers'],
  family: 'cost_center',
  children: {},
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A cost center, named as its screen names it. */
const COST_CENTER_FIELDS: HistoryFields = {
  code: shown(),
  kind: shown(),
  name: shown(),
  description: shown(),
  parent_id: shown('cost_center'),
  company_id: shown('company'),
  owner_user_id: shown('user'),
  status: shown(),
  disabled_at: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  sort_order: hidden('display order'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the cost center's audit labels: the record itself, no child. */
export const costCentersFields: Readonly<Record<string, HistoryFields>> = {
  cost_centers: COST_CENTER_FIELDS,
};
