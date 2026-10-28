import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The site (lot 2, family C): its page, its four children, their allow-lists and their parent
 * rules.
 *
 * Every child write keeps the child's own id in `record_id` and names the site in its payload
 * (`location_id`), so the parent rule reads that key. The sub-location reorder writes the site in
 * `record_id` with no payload key: its writer hands the site as an explicit parent.
 */
export const locationsRecord = {
  table: 'locations',
  module: 'locations',
  level: 'reader',
  auditLabels: ['locations'],
  family: 'location',
  children: {
    location_user_contacts: 'person',
    location_contacts: 'contact',
    location_links: 'link',
    location_sub_items: 'sub_item',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A site, as its screen names it. */
const LOCATION_FIELDS: HistoryFields = {
  location_reference: shown(),
  name: shown(),
  hosting_type: shown(),
  operating_company_id: shown('company'),
  country_iso: shown(),
  city: shown(),
  provider: shown(),
  region: shown(),
  additional_info: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An internal contact: a named person of the tenant, never an email. */
const LOCATION_USER_CONTACT_FIELDS: HistoryFields = {
  user_id: shown('user'),
  role: shown(),
  location_id: hidden('site link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An external contact link: the contact is a record of its own module. */
const LOCATION_CONTACT_FIELDS: HistoryFields = {
  contact_id: shown('contact'),
  role: shown(),
  location_id: hidden('site link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A web link: its label and address are short and shown on the screen. */
const LOCATION_LINK_FIELDS: HistoryFields = {
  url: shown(),
  description: shown(),
  location_id: hidden('site link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A sub-location; its external synchronization identity is technical. */
const LOCATION_SUB_ITEM_FIELDS: HistoryFields = {
  name: shown(),
  description: shown(),
  display_order: hidden('display order'),
  external_source: hidden('external synchronization identity'),
  external_id: hidden('external synchronization identity'),
  external_url: hidden('external synchronization link'),
  ordered_ids: hidden('the order change names no field'),
  location_id: hidden('site link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the site's audit labels: the site and its four children. */
export const locationsFields: Readonly<Record<string, HistoryFields>> = {
  locations: LOCATION_FIELDS,
  location_user_contacts: LOCATION_USER_CONTACT_FIELDS,
  location_contacts: LOCATION_CONTACT_FIELDS,
  location_links: LOCATION_LINK_FIELDS,
  location_sub_items: LOCATION_SUB_ITEM_FIELDS,
};

/**
 * The audit labels that carry a site. The migration `1855720000000` copies these labels in SQL on
 * purpose: a migration is frozen and must not import this module
 * (`__tests__/record-history-family-c-migration.spec.ts` compares them).
 */
export const locationsParentRules: Readonly<Record<string, AuditParentRule>> = {
  location_user_contacts: { parentTable: 'locations', from: 'payload', keys: ['location_id'] },
  location_contacts: { parentTable: 'locations', from: 'payload', keys: ['location_id'] },
  location_links: { parentTable: 'locations', from: 'payload', keys: ['location_id'] },
  location_sub_items: { parentTable: 'locations', from: 'payload', keys: ['location_id'] },
};
