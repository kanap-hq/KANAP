import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The technology (lot 2, family D): its page, the audit labels of its own row and of its children,
 * their allow-lists and the parent rules of the children a rule can find.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. Most children name the technology in `record_id` (a
 * version, an owner, an application or asset link, a contract, project or budget line); the web
 * links, attachments and vulnerability rows carry it in their payload (`technology_id`), and the
 * migration `1855730000000-audit-log-parent-record-family-d.ts` indexes and backfills those.
 *
 * The catalog and synchronization writers set `source = 'system'`, which the history's author
 * already reads as "System". A synchronization row carries only `catalog_sync`; the presenter turns
 * its counts into words, so the entry is a real change instead of an invisible technical marker.
 */
export const technologiesRecord = {
  table: 'technologies',
  module: 'infrastructure',
  level: 'reader',
  auditLabels: ['technologies'],
  family: 'technology',
  children: {
    // `record_id` is the technology.
    technology_versions: 'technology_version',
    technology_owners: 'owner',
    technology_support_contacts: 'contact',
    application_technologies: 'application',
    asset_technologies: 'asset',
    technology_contracts: 'contract',
    technology_projects: 'project',
    technology_spend_items: 'budget_line',
    // The payload names the technology (the audit row names the child).
    technology_links: 'link',
    technology_attachments: 'attachment',
    technology_vulnerabilities: 'vulnerability',
  },
  childReads: {
    technology_versions: 'record',
    technology_owners: 'record',
    technology_support_contacts: 'record',
    application_technologies: 'record',
    asset_technologies: 'record',
    technology_contracts: 'record',
    technology_projects: 'record',
    technology_spend_items: 'record',
    technology_links: { payloadKey: 'technology_id' },
    technology_attachments: { payloadKey: 'technology_id' },
    technology_vulnerabilities: { payloadKey: 'technology_id' },
  },
  explicitParentLabels: [],
  exclusions: [
    {
      table: 'incident_technologies',
      reason: 'read from the incident by the incidents run',
    },
  ],
} as const satisfies RecordHistoryRecord;

/** A technology, as its own audit rows record it. */
const TECHNOLOGY_FIELDS: HistoryFields = {
  item_number: shown(),
  name: shown(),
  editor: shown(),
  family: shown(),
  hosting_type: shown(),
  lifecycle: shown(),
  description: shown(),
  notes: shown(),
  support_notes: shown(),
  cpe_products: shown(),
  replaced_by_id: shown('technology'),
  cyber_criticality: shown(),
  recovery_wave: shown(),
  rto_minutes: shown(),
  rpo_minutes: shown(),
  admin_zone: shown(),
  vulnerability_alerts: shown(),
  // A catalogue synchronization writes its counts here; the presenter reads them as changes.
  catalog_sync: hidden('structured synchronization summary, read as its counts'),
  versions_added: shown(),
  versions_updated: shown(),
  versions_attached: shown(),
  cpe_products_added: shown(),
  cpe_products_removed: shown(),
  cve_names_added: shown(),
  cve_names_removed: shown(),
  description_filled: shown(),
  description_updated: shown(),
  // A conversion summary names the application; the application's own run keeps that event.
  converted_from_application: hidden('conversion summary, the application run follows it'),
  moved: hidden('conversion counts, no readable field'),
  catalog_key: hidden('catalogue entry key, an internal identifier'),
  catalog_state: hidden('catalogue synchronization state, internal'),
  cve_names: hidden('structured vendor and product list, the vulnerability rows carry the changes'),
  mode: hidden('replaced by the hosting type, kept in old payloads'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A version of a technology. */
const TECHNOLOGY_VERSION_FIELDS: HistoryFields = {
  label: shown(),
  cpe_version: shown(),
  build_prefixes: shown(),
  standard_support_end: shown(),
  extended_support_end: shown(),
  notes: shown(),
  vulnerability_alerts: shown(),
  vulnerability_alerts_effective: hidden('derived from the technology and the version setting'),
  versions_added: hidden('catalogue creation count, the entry title says it'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  catalog_key: hidden('catalogue entry key, an internal identifier'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A technology owner; the write lists `"<type>:<user_id>"` strings in the payload. */
const TECHNOLOGY_OWNER_FIELDS: HistoryFields = {
  user_id: shown('user'),
  owner_type: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  created_at: hidden('timestamp'),
};

/** A support contact of a technology; the write lists `"<contact_id>:<role>"` strings. */
const TECHNOLOGY_SUPPORT_CONTACT_FIELDS: HistoryFields = {
  contact_id: shown('contact'),
  role: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  created_at: hidden('timestamp'),
};

/** A link between an application and a technology. */
const APPLICATION_TECHNOLOGY_FIELDS: HistoryFields = {
  application_id: shown('application'),
  notes: shown(),
  added: hidden('link set additions, presented by the application events'),
  removed: hidden('link set removals, presented by the application events'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  technology_version_id: hidden('version detail, not a record of its own'),
  source: hidden('link provenance'),
  source_ref: hidden('link provenance'),
  observed_at: hidden('link provenance'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A link between an asset and a technology. */
const ASSET_TECHNOLOGY_FIELDS: HistoryFields = {
  asset_id: shown('asset'),
  is_operating_system: shown(),
  notes: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  technology_version_id: hidden('version detail, not a record of its own'),
  source: hidden('link provenance'),
  source_ref: hidden('link provenance'),
  observed_at: hidden('link provenance'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A contract linked to a technology. */
const TECHNOLOGY_CONTRACT_FIELDS: HistoryFields = {
  contract_id: shown('contract'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  created_at: hidden('timestamp'),
};

/** A project linked to a technology. */
const TECHNOLOGY_PROJECT_FIELDS: HistoryFields = {
  project_id: shown('project'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  created_at: hidden('timestamp'),
};

/** A budget line linked to a technology. */
const TECHNOLOGY_SPEND_ITEM_FIELDS: HistoryFields = {
  spend_item_id: shown('budget_line'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  created_at: hidden('timestamp'),
};

/** A web link of a technology. */
const TECHNOLOGY_LINK_FIELDS: HistoryFields = {
  url: shown(),
  description: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  created_at: hidden('timestamp'),
};

/** An attachment of a technology. */
const TECHNOLOGY_ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  uploaded_at: hidden('timestamp'),
};

/** A vulnerability row of a technology. */
const TECHNOLOGY_VULNERABILITY_FIELDS: HistoryFields = {
  cve_id: shown(),
  state: shown(),
  note: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  technology_id: hidden('the technology, the record itself'),
  technology_version_id: hidden('version detail, not a record of its own'),
  state_changed_by: hidden('audit detail, the entry author is the person'),
  state_changed_at: hidden('audit detail, the entry date is the change date'),
  match_basis: hidden('matching detail'),
  matching: hidden('matching detail'),
  detected_at: hidden('matching detail'),
  match_sources: hidden('matching detail'),
  updated_at: hidden('timestamp'),
};

/** The allow-lists of the technology's audit labels: the record, then its children. */
export const technologiesFields: Readonly<Record<string, HistoryFields>> = {
  technologies: TECHNOLOGY_FIELDS,
  technology_versions: TECHNOLOGY_VERSION_FIELDS,
  technology_owners: TECHNOLOGY_OWNER_FIELDS,
  technology_support_contacts: TECHNOLOGY_SUPPORT_CONTACT_FIELDS,
  application_technologies: APPLICATION_TECHNOLOGY_FIELDS,
  asset_technologies: ASSET_TECHNOLOGY_FIELDS,
  technology_contracts: TECHNOLOGY_CONTRACT_FIELDS,
  technology_projects: TECHNOLOGY_PROJECT_FIELDS,
  technology_spend_items: TECHNOLOGY_SPEND_ITEM_FIELDS,
  technology_links: TECHNOLOGY_LINK_FIELDS,
  technology_attachments: TECHNOLOGY_ATTACHMENT_FIELDS,
  technology_vulnerabilities: TECHNOLOGY_VULNERABILITY_FIELDS,
};

/**
 * The technology children an audit rule finds in its payload (`technology_id`). The versions,
 * owners, contacts, application and asset links, contracts, projects and budget lines name the
 * technology in `record_id` and keep `parent_*` NULL.
 *
 * `1855730000000-audit-log-parent-record-family-d.ts` copies these rules in SQL on purpose.
 */
export const technologiesParentRules: Readonly<Record<string, AuditParentRule>> = {
  technology_links: { parentTable: 'technologies', from: 'payload', keys: ['technology_id'] },
  technology_attachments: { parentTable: 'technologies', from: 'payload', keys: ['technology_id'] },
  technology_vulnerabilities: { parentTable: 'technologies', from: 'payload', keys: ['technology_id'] },
};
