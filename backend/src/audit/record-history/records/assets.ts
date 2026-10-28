import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The asset (lot 2, family D): its page, the audit labels of its own row and of its children,
 * their allow-lists and the parent rules of the children a rule can find.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. The children written with the asset in `record_id` are
 * read by that id (`childReads`); the children whose audit row carries the asset in its payload
 * (`asset_id`) are read by that key, which the migration `1855730000000-audit-log-parent-record-
 * family-d.ts` indexes and backfills.
 *
 * `asset_projects` is written by the asset's Relations tab exactly as `asset_contracts` is
 * (`setOwnedLink`, `recordId` the asset, `{ ids }` before and after), so its changes belong to the
 * asset even though the brief's first list predates that writer.
 */
export const assetsRecord = {
  table: 'assets',
  module: 'infrastructure',
  level: 'reader',
  auditLabels: ['assets'],
  family: 'asset',
  children: {
    // Relations between assets, a cluster's members and the asset's links to other modules. The
    // audit row names the asset in `record_id`.
    asset_relations: 'relation',
    asset_cluster_members: 'member',
    asset_contracts: 'contract',
    asset_projects: 'project',
    asset_spend_items: 'budget_line',
    asset_capex_items: 'budget_line',
    // The children whose audit row names the asset in `asset_id`.
    asset_hardware_info: 'hardware',
    asset_support_info: 'support',
    // Written only by the assistant's relation writer; its rows name the asset in `record_id`.
    asset_support_contacts: 'contact',
    asset_links: 'link',
    asset_attachments: 'attachment',
    // Installed technologies: `record_id` is the technology, the payload names the asset. The
    // technology's own history reads the same rows by `record_id`.
    asset_technologies: 'technology',
  },
  childReads: {
    asset_relations: 'record',
    asset_cluster_members: 'record',
    asset_contracts: 'record',
    asset_projects: 'record',
    asset_spend_items: 'record',
    asset_capex_items: 'record',
    asset_hardware_info: { payloadKey: 'asset_id' },
    asset_support_info: { payloadKey: 'asset_id' },
    asset_support_contacts: 'record',
    asset_links: { payloadKey: 'asset_id' },
    asset_attachments: { payloadKey: 'asset_id' },
    asset_technologies: { payloadKey: 'asset_id' },
  },
  explicitParentLabels: [],
  exclusions: [
    {
      table: 'app_asset_assignments',
      reason: 'linked by the applications run (instance to application path), not by this one',
    },
    {
      table: 'incident_assets',
      reason: 'read from the incident by the incidents run',
    },
  ],
} as const satisfies RecordHistoryRecord;

/** An asset, as its own audit rows record it. */
const ASSET_FIELDS: HistoryFields = {
  name: shown(),
  asset_reference: shown(),
  kind: shown(),
  provider: shown(),
  environment: shown(),
  region: shown(),
  zone: shown(),
  hostname: shown(),
  domain: shown(),
  fqdn: shown(),
  aliases: shown(),
  admin_zone: shown(),
  is_cluster: shown(),
  status: shown(),
  go_live_date: shown(),
  end_of_life_date: shown(),
  location_id: shown('location'),
  sub_location_id: shown('sub_location'),
  notes: shown(),
  // The marked technology link is the operating system; its own child row carries the change.
  operating_system: hidden('derived from the marked technology link'),
  // The delete entry lists what the cascade removes; a deleted record has no page to read it.
  members: hidden('delete cascade detail, the cluster member rows carry the change'),
  relations: hidden('delete cascade detail, the asset relation rows carry the change'),
  external_links: hidden('external inventory provenance, not an asset field'),
  // The screen shows the addresses, the history has no readable form for the structured list.
  ip_addresses: hidden('structured network address list'),
  cluster: hidden('legacy cluster text, the cluster member rows carry the membership'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A relation between two assets, as the source asset's write records it. */
const ASSET_RELATION_FIELDS: HistoryFields = {
  related_asset_id: shown('asset'),
  relation_type: shown(),
  notes: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the source asset, the record itself'),
  created_at: hidden('timestamp'),
};

/** A cluster member; the cluster's write lists the member ids in `members`. */
const ASSET_CLUSTER_MEMBER_FIELDS: HistoryFields = {
  asset_id: shown('asset'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  cluster_id: hidden('the cluster, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The hardware sheet of an asset. */
const ASSET_HARDWARE_FIELDS: HistoryFields = {
  serial_number: shown(),
  manufacturer: shown(),
  model: shown(),
  purchase_date: shown(),
  rack_location: shown(),
  rack_unit: shown(),
  notes: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the asset, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** The support sheet of an asset. */
const ASSET_SUPPORT_FIELDS: HistoryFields = {
  vendor_id: shown('supplier'),
  support_contract_id: shown('contract'),
  support_tier: shown(),
  support_expiry: shown(),
  notes: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the asset, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A support contact of an asset, written by the assistant's relation writer. */
const ASSET_SUPPORT_CONTACT_FIELDS: HistoryFields = {
  contact_id: shown('contact'),
  role: shown(),
  asset_id: hidden('the asset, the record itself'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A web link of an asset. */
const ASSET_LINK_FIELDS: HistoryFields = {
  url: shown(),
  description: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the asset, the record itself'),
  created_at: hidden('timestamp'),
};

/** An attachment of an asset. */
const ASSET_ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the asset, the record itself'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  uploaded_at: hidden('timestamp'),
};

/** A contract linked to an asset. */
const ASSET_CONTRACT_FIELDS: HistoryFields = {
  contract_id: shown('contract'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the asset, the record itself'),
  created_at: hidden('timestamp'),
};

/** A project linked to an asset. */
const ASSET_PROJECT_FIELDS: HistoryFields = {
  project_id: shown('project'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the asset, the record itself'),
  created_at: hidden('timestamp'),
};

/** A budget line linked to an asset, of either nature. */
const ASSET_SPEND_ITEM_FIELDS: HistoryFields = {
  spend_item_id: shown('budget_line'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  asset_id: hidden('the asset, the record itself'),
  created_at: hidden('timestamp'),
};

/** The allow-lists of the asset's audit labels: the record, then its children. */
export const assetsFields: Readonly<Record<string, HistoryFields>> = {
  assets: ASSET_FIELDS,
  asset_relations: ASSET_RELATION_FIELDS,
  asset_cluster_members: ASSET_CLUSTER_MEMBER_FIELDS,
  asset_hardware_info: ASSET_HARDWARE_FIELDS,
  asset_support_info: ASSET_SUPPORT_FIELDS,
  asset_support_contacts: ASSET_SUPPORT_CONTACT_FIELDS,
  asset_links: ASSET_LINK_FIELDS,
  asset_attachments: ASSET_ATTACHMENT_FIELDS,
  asset_contracts: ASSET_CONTRACT_FIELDS,
  asset_projects: ASSET_PROJECT_FIELDS,
  asset_spend_items: ASSET_SPEND_ITEM_FIELDS,
  asset_capex_items: ASSET_SPEND_ITEM_FIELDS,
};

/**
 * The asset children an audit rule finds in the payload (`asset_id`). The relation, cluster,
 * contract, project and line links name the asset in `record_id` and keep `parent_*` NULL.
 *
 * `1855730000000-audit-log-parent-record-family-d.ts` copies these rules in SQL on purpose: a
 * migration is frozen and must not import this module.
 */
export const assetsParentRules: Readonly<Record<string, AuditParentRule>> = {
  asset_hardware_info: { parentTable: 'assets', from: 'payload', keys: ['asset_id'] },
  asset_support_info: { parentTable: 'assets', from: 'payload', keys: ['asset_id'] },
  asset_links: { parentTable: 'assets', from: 'payload', keys: ['asset_id'] },
  asset_attachments: { parentTable: 'assets', from: 'payload', keys: ['asset_id'] },
  // Written from the asset as well as the technology: the payload names the asset, the record_id
  // names the technology. The rule only gives the asset side its parent.
  asset_technologies: { parentTable: 'assets', from: 'payload', keys: ['asset_id'] },
};
