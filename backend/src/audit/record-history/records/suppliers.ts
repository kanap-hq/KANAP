import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The supplier: its page (overview and contacts tabs), its one audit label, the contact links it
 * shows as its children, their allow-lists and their parent rule.
 *
 * The entry is read by `record-history.inventory.ts`; the fields by `../fields.ts` and the rule by
 * `audit-parent-rules.ts`. `supplier_contacts` belongs to two histories: the supplier reads it by
 * its parent (this file), the contact reads it by its payload key (`records/contacts.ts`), so the
 * label's allow-list is declared here once.
 */
export const suppliersRecord = {
  table: 'suppliers',
  module: 'suppliers',
  level: 'reader',
  auditLabels: ['suppliers'],
  family: 'supplier',
  children: {
    // The contact links of the supplier: a role and a primary flag, never the contact's own fields.
    supplier_contacts: 'contact',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** The supplier itself (its screen's fields). */
const SUPPLIER_FIELDS: HistoryFields = {
  name: shown(),
  erp_supplier_id: shown(),
  notes: shown(),
  status: shown(),
  disabled_at: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/**
 * A supplier contact link: the contact (kind `contact` from the supplier, `supplier` from the
 * contact's own history), its role and whether it is the supplier's primary contact. `origin` is
 * not an entry of its own: the link's creation already says it came from the supplier or a person.
 */
const SUPPLIER_CONTACT_FIELDS: HistoryFields = {
  supplier_id: shown('supplier'),
  contact_id: shown('contact'),
  role: shown(),
  is_primary: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the supplier's audit labels: the record itself and its contact links. */
export const suppliersFields: Readonly<Record<string, HistoryFields>> = {
  suppliers: SUPPLIER_FIELDS,
  supplier_contacts: SUPPLIER_CONTACT_FIELDS,
};

/**
 * The supplier a contact link belongs to. Every writer of the label stores the link row, before or
 * after, with `supplier_id`; the link's `record_id` is the link itself, so no `record_id` fallback
 * would be safe. The contact's own history reads the same label the other way, by `contact_id`
 * (`records/contacts.ts`, a payload-key branch, no parent rule).
 */
export const suppliersParentRules: Readonly<Record<string, AuditParentRule>> = {
  supplier_contacts: { parentTable: 'suppliers', from: 'payload', keys: ['supplier_id'] },
};
