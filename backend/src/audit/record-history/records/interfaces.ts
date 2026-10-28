import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, shown } from '../field-rules';

/**
 * The interface (lot 2, family C): its page, the sets its writers replace as a whole, the rows
 * whose own id is `record_id`, its bindings, mapping sets and attachments, and the allow-list of
 * every label.
 *
 * Two shapes of child:
 * - the sets (`interface_legs`, `interface_owners`, `interface_companies`,
 *   `interface_dependencies`, `interface_key_identifiers`, `interface_data_residency`) and the
 *   whole-set replacement of `interface_links` keep the interface in `record_id`: `childReads`
 *   declares `record`. The single-row link writes keep the link id in `record_id` and name the
 *   interface in their payload: the parent rule reads `interface_id`, and the label is also
 *   declared `record`.
 * - `interface_bindings`, `interface_mapping_sets` and `interface_attachments` keep their own id
 *   in `record_id` and name the interface in their payload; the parent rule reads `interface_id`.
 *
 * The page is closed to a Business Contributor whose applications access is limited: the reference
 * family carries that rule (`closedToScope`), so the record check answers 404 as the page does.
 */
export const interfacesRecord = {
  table: 'interfaces',
  module: 'applications',
  level: 'reader',
  auditLabels: ['interfaces'],
  family: 'interface',
  children: {
    interface_legs: 'set',
    interface_owners: 'set',
    interface_companies: 'set',
    interface_dependencies: 'set',
    interface_key_identifiers: 'set',
    interface_data_residency: 'set',
    interface_links: 'set',
    interface_bindings: 'binding',
    interface_mapping_sets: 'set',
    interface_attachments: 'attachment',
  },
  childReads: {
    interface_legs: 'record',
    interface_owners: 'record',
    interface_companies: 'record',
    interface_dependencies: 'record',
    interface_key_identifiers: 'record',
    interface_data_residency: 'record',
    // The whole-set replacement names the interface in `record_id`; the single-row writes name it
    // in the payload and are read by their parent columns.
    interface_links: 'record',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/**
 * An interface, as its screen names it. The long free-text blocks (rules, use cases, typical data,
 * security notes) stay out: they change rarely and would put a page of prose in one history line.
 * The `*_name` keys beside an id are never copied: the id resolves with the reader's rights.
 */
const INTERFACE_FIELDS: HistoryFields = {
  interface_reference: shown(),
  interface_id: shown(),
  name: shown(),
  business_process_id: shown('business_process'),
  business_purpose: shown(),
  source_application_id: shown('application'),
  target_application_id: shown('application'),
  data_category: shown(),
  integration_route_type: shown(),
  lifecycle: shown(),
  criticality: shown(),
  data_class: shown(),
  contains_pii: shown(),
  classification_incomplete: shown(),
  // An id list written by older writers; presented as added or removed applications.
  middleware_application_ids: shown('application'),
  overview_notes: hidden('long free text, read on the overview'),
  impact_of_failure: hidden('long free text, read on the overview'),
  business_objects: hidden('structured list, read on the overview'),
  main_use_cases: hidden('long free text, read on the overview'),
  functional_rules: hidden('long free text, read on the overview'),
  core_transformations_summary: hidden('long free text, read on the overview'),
  error_handling_summary: hidden('long free text, read on the overview'),
  pii_description: hidden('long free text, read on the overview'),
  typical_data: hidden('long free text, read on the overview'),
  audit_logging: hidden('long free text, read on the overview'),
  security_controls_summary: hidden('long free text, read on the overview'),
  // The names beside the ids: the reference resolves with the reader's rights, never a copy.
  source_application_name: hidden('neighbour name of an id: the reference resolves with the reader\'s rights'),
  target_application_name: hidden('neighbour name of an id: the reference resolves with the reader\'s rights'),
  business_process_name: hidden('neighbour name of an id: the reference resolves with the reader\'s rights'),
  middleware_application_names: hidden('neighbour name of an id: the reference resolves with the reader\'s rights'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A flow leg, changed through the whole-set replacement of the Flow tab. */
const INTERFACE_LEG_FIELDS: HistoryFields = {
  leg_type: shown(),
  from_role: shown(),
  to_role: shown(),
  trigger_type: shown(),
  integration_pattern: shown(),
  data_format: shown(),
  job_name: shown(),
  order_index: shown(),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An owner: a named person of the tenant, with the role they hold on the interface. */
const INTERFACE_OWNER_FIELDS: HistoryFields = {
  user_id: shown('user'),
  owner_type: shown(),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
};

/** A company the interface serves. */
const INTERFACE_COMPANY_FIELDS: HistoryFields = {
  company_id: shown('company'),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
};

/** An upstream or downstream interface. */
const INTERFACE_DEPENDENCY_FIELDS: HistoryFields = {
  related_interface_id: shown('interface'),
  direction: shown(),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
};

/** A key identifier pair of the data mapping. */
const INTERFACE_KEY_IDENTIFIER_FIELDS: HistoryFields = {
  source_identifier: shown(),
  destination_identifier: shown(),
  identifier_notes: shown(),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
};

/** A country where the interface's data resides. */
const INTERFACE_DATA_RESIDENCY_FIELDS: HistoryFields = {
  country_iso: shown(),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
};

/** A web link of the interface. */
const INTERFACE_LINK_FIELDS: HistoryFields = {
  kind: shown(),
  description: shown(),
  url: shown(),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
};

/**
 * A binding of one flow leg to one environment. The Environments screen shows the endpoints,
 * triggers, job name, authentication, monitoring address and notes, so the history shows them too;
 * the leg and instance ids are technical links the screen names by their own labels.
 */
const INTERFACE_BINDING_FIELDS: HistoryFields = {
  environment: shown(),
  status: shown(),
  source_endpoint: shown(),
  target_endpoint: shown(),
  trigger_details: shown(),
  env_job_name: shown(),
  authentication_mode: shown(),
  monitoring_url: shown(),
  env_notes: shown(),
  integration_tool_application_id: shown('application'),
  interface_leg_id: hidden('leg link, named by the Environments screen'),
  source_instance_id: hidden('deployment link, named by the Environments screen'),
  target_instance_id: hidden('deployment link, named by the Environments screen'),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A data-mapping set, switched as a whole from the Data mapping tab. */
const INTERFACE_MAPPING_SET_FIELDS: HistoryFields = {
  name: shown(),
  description: shown(),
  is_default: shown(),
  revision_number: hidden('revision counter'),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An attachment: its name, type and size; its storage keys never come out. */
const INTERFACE_ATTACHMENT_FIELDS: HistoryFields = {
  kind: shown(),
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  uploaded_at: hidden('timestamp'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  interface_id: hidden('interface link'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
};

/** The allow-lists of the interface's audit labels. */
export const interfacesFields: Readonly<Record<string, HistoryFields>> = {
  interfaces: INTERFACE_FIELDS,
  interface_legs: INTERFACE_LEG_FIELDS,
  interface_owners: INTERFACE_OWNER_FIELDS,
  interface_companies: INTERFACE_COMPANY_FIELDS,
  interface_dependencies: INTERFACE_DEPENDENCY_FIELDS,
  interface_key_identifiers: INTERFACE_KEY_IDENTIFIER_FIELDS,
  interface_data_residency: INTERFACE_DATA_RESIDENCY_FIELDS,
  interface_links: INTERFACE_LINK_FIELDS,
  interface_bindings: INTERFACE_BINDING_FIELDS,
  interface_mapping_sets: INTERFACE_MAPPING_SET_FIELDS,
  interface_attachments: INTERFACE_ATTACHMENT_FIELDS,
};

/**
 * The audit labels that carry an interface. The migration `1855720000000` copies these labels in
 * SQL on purpose: a migration is frozen and must not import this module
 * (`__tests__/record-history-family-c-migration.integration.spec.ts` compares them).
 *
 * The set labels have no rule: they name the interface in `record_id`. `interface_links` carries
 * the link in `record_id` for a whole-set replacement and the interface in its payload for a
 * single-row write, so the rule only fills the latter.
 */
export const interfacesParentRules: Readonly<Record<string, AuditParentRule>> = {
  interface_links: { parentTable: 'interfaces', from: 'payload', keys: ['interface_id'] },
  interface_bindings: { parentTable: 'interfaces', from: 'payload', keys: ['interface_id'] },
  interface_mapping_sets: { parentTable: 'interfaces', from: 'payload', keys: ['interface_id'] },
  interface_attachments: { parentTable: 'interfaces', from: 'payload', keys: ['interface_id'] },
};
