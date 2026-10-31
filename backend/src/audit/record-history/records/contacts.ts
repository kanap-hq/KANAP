import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The contact: its page has a single overview tab and a History button in the header. Its own
 * audit label is `contacts`; its history also reads the three link labels that carry it, each by
 * the `contact_id` key of its payload (the link row's `record_id` is the link, and its parent
 * belongs to another record):
 * - `supplier_contacts`: the link to a supplier (read by `supplier_id` from the supplier's page);
 * - `contract_contacts`: the link to a contract, shown as a contract;
 * - `spend_item_contacts` / `capex_item_contacts`: the contact of a budget line of either nature,
 *   shown as a budget line.
 *
 * The entry is read by `record-history.inventory.ts`; the fields by `../fields.ts`. The two
 * budget-line labels keep their allow-list in `records/spend_items.ts` (lot 1): the same physical
 * link is the line's child there, so one file owns it.
 */
export const contactsRecord = {
  table: 'contacts',
  module: 'contacts',
  level: 'reader',
  auditLabels: ['contacts'],
  family: 'contact',
  children: {
    supplier_contacts: 'supplier',
    contract_contacts: 'contract',
    spend_item_contacts: 'budget_line',
    capex_item_contacts: 'budget_line',
  },
  // The contact is in the payload, the link's own id in `record_id`: one branch per key, all four
  // labels under the same `contact_id` index (`1855710000000`).
  childReads: {
    supplier_contacts: { payloadKey: 'contact_id' },
    contract_contacts: { payloadKey: 'contact_id' },
    spend_item_contacts: { payloadKey: 'contact_id' },
    capex_item_contacts: { payloadKey: 'contact_id' },
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/**
 * The contact itself. The e-mail, the phone, the mobile and the notes are personal data: the
 * history says that the field changed and never copies the value. `supplier_role` has no column
 * of its own: the contact writer adds it to the payload from the supplier link.
 */
const CONTACT_FIELDS: HistoryFields = {
  first_name: shown(),
  last_name: shown(),
  job_title: shown(),
  country: shown(),
  active: shown(),
  // The supplier link row (`supplier_contacts`) already reads as "Supplier added: ..." with its
  // role: the contact's own payload repeats both, so neither becomes a second entry.
  supplier_id: hidden('the supplier link row carries the supplier'),
  supplier_role: hidden('the supplier link row carries the role'),
  email: hiddenChanged('personal data: the history names the change, never the address', 'emailChanged'),
  phone: hiddenChanged('personal data: the history names the change, never the number', 'phoneChanged'),
  mobile: hiddenChanged('personal data: the history names the change, never the number', 'mobileChanged'),
  notes: hiddenChanged('free text of a person\'s record, which may hold contact details', 'notesChanged'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A contract contact link, read from the contact's side: the contract, the role and its origin. */
const CONTRACT_CONTACT_FIELDS: HistoryFields = {
  contract_id: shown('contract'),
  contact_id: shown('contact'),
  role: shown(),
  origin: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/**
 * The allow-lists of the contact's audit labels. `spend_item_contacts` and `capex_item_contacts`
 * come from `records/spend_items.ts`, which owns the budget-line link.
 */
export const contactsFields: Readonly<Record<string, HistoryFields>> = {
  contacts: CONTACT_FIELDS,
  contract_contacts: CONTRACT_CONTACT_FIELDS,
};
