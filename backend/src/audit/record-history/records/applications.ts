import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The application (lot 2, linked records): its page, the audit labels of its own row and of its
 * children, their allow-lists and the parent rules of the children a rule can find.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. Three read shapes:
 * - the owner, company, department, contact, residency, suite, budget line, contract and project
 *   sets name the application in `record_id` (`childReads: 'record'`). From the other side (a line,
 *   a contract) the same labels name that object, and its own history reads them;
 * - the deployments, web links and attachments carry `application_id` in their payload, and an
 *   assignment names its deployment (`app_instance_id`), whose application is the parent: they are
 *   read by the parent columns, filled at write time and by the migration
 *   `1855910000000-audit-log-parent-applications.ts`;
 * - the business process and technology links name the process or the technology in `record_id`
 *   and the application in the payload (`application_id`), read by that key. Their allow-lists
 *   belong to `business_processes.ts` and `technologies.ts`. The technology links written before
 *   one row per application (`{ added: [ids] }`, `{ removed: [ids] }`) carry no application key and
 *   stay out of this history; the technology's history still reads them.
 */
export const applicationsRecord = {
  table: 'applications',
  module: 'applications',
  level: 'reader',
  auditLabels: ['applications'],
  family: 'application',
  children: {
    // `record_id` is the application.
    application_owners: 'owner',
    application_companies: 'set',
    application_departments: 'set',
    application_support_contacts: 'contact',
    application_data_residency: 'set',
    application_suites: 'set',
    application_spend_items: 'budget_line',
    application_capex_items: 'budget_line',
    application_contracts: 'contract',
    application_projects: 'project',
    // The parent columns: the payload names the application, or its deployment.
    app_instances: 'instance',
    application_links: 'link',
    application_attachments: 'attachment',
    app_asset_assignments: 'assignment',
    // `record_id` is the process or the technology, the payload names the application.
    application_business_processes: 'business_process',
    application_technologies: 'technology',
  },
  childReads: {
    application_owners: 'record',
    application_companies: 'record',
    application_departments: 'record',
    application_support_contacts: 'record',
    application_data_residency: 'record',
    application_suites: 'record',
    application_spend_items: 'record',
    application_capex_items: 'record',
    application_contracts: 'record',
    application_projects: 'record',
    application_business_processes: { payloadKey: 'application_id' },
    application_technologies: { payloadKey: 'application_id' },
  },
  explicitParentLabels: [],
  exclusions: [
    {
      table: 'incident_applications',
      reason: 'read from the incident by the incidents run',
    },
  ],
} as const satisfies RecordHistoryRecord;

/** An application, as its own audit rows record it. */
const APPLICATION_FIELDS: HistoryFields = {
  name: shown(),
  // The source of the Overview document (Markdown): the entry says that it changed, never its text.
  description: hiddenChanged('application description: long content', 'descriptionChanged'),
  editor: shown(),
  supplier_id: shown('supplier'),
  category: shown(),
  version: shown(),
  lifecycle: shown(),
  status: shown(),
  disabled_at: shown(),
  go_live_date: shown(),
  end_of_support_date: shown(),
  retired_date: shown(),
  predecessor_id: shown('application'),
  is_suite: shown(),
  criticality: shown(),
  cyber_criticality: shown(),
  data_class: shown(),
  contains_pii: shown(),
  recovery_wave: shown(),
  rto_minutes: shown(),
  rpo_minutes: shown(),
  last_dr_test: shown(),
  classification_justification: shown(),
  // Marking the classification as reviewed stamps who and when: the entry's author and date say it.
  classification_review: hiddenChanged('review stamp: the entry author and date are the reviewer and the date', 'classificationReviewed'),
  classification_revision: hidden('edit counter of the classification, no field of the page'),
  hosting_model: shown(),
  environment: shown(),
  external_facing: shown(),
  access_methods: shown(),
  sso_enabled: shown(),
  mfa_supported: shown(),
  etl_enabled: shown(),
  users_mode: shown(),
  users_year: shown(),
  users_override: shown(),
  licensing: shown(),
  // Long free text, as the contract's notes: the entry says that they changed.
  notes: hiddenChanged('application notes: long content', 'notesChanged'),
  support_notes: hiddenChanged('application support notes: long content', 'supportNotesChanged'),
  sequential_id: hidden('business reference, the page header shows it'),
  // The read state of the classification is derived from the fields above at each read.
  classification_review_state: hidden('derived from the classification fields at each read'),
  classification_review_reason: hidden('derived from the classification fields at each read'),
  classification_reviewed_at: hidden('derived from the review stamp'),
  classification_reviewer_name: hidden('derived from the review stamp'),
  derived_total_users: hidden('derived from the user counts at each read'),
  // The page's read model puts the child sets beside the row; each child label carries its change.
  _owners: hidden('owner set snapshot, the owner rows carry the change'),
  owners: hidden('owner set snapshot, the owner rows carry the change'),
  companies: hidden('company set snapshot, the company rows carry the change'),
  departments: hidden('department set snapshot, the department rows carry the change'),
  links: hidden('web link snapshot, the link rows carry the change'),
  attachments: hidden('attachment snapshot, the attachment rows carry the change'),
  data_residency: hidden('residency snapshot, the residency rows carry the change'),
  // A conversion to a technology deletes the application: its page no longer opens.
  converted_to_technology: hidden('conversion summary, the technology history keeps it'),
  reference: hidden('business reference snapshot of a conversion'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An owner of the application; the write lists `"<type>:<user_id>"` strings. */
const APPLICATION_OWNER_FIELDS: HistoryFields = {
  user_id: shown('user'),
  owner_type: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A company using the application; the write lists the company ids. */
const APPLICATION_COMPANY_FIELDS: HistoryFields = {
  company_id: shown('company'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A department using the application; the write lists the department ids. */
const APPLICATION_DEPARTMENT_FIELDS: HistoryFields = {
  department_id: shown('department'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A support contact of the application; the write lists `"<contact_id>:<role>"` strings. */
const APPLICATION_SUPPORT_CONTACT_FIELDS: HistoryFields = {
  contact_id: shown('contact'),
  role: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A country where the application's data resides; the write lists the country codes. */
const APPLICATION_DATA_RESIDENCY_FIELDS: HistoryFields = {
  country_iso: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A suite the application belongs to; the write lists the suite ids. */
const APPLICATION_SUITE_FIELDS: HistoryFields = {
  suite_id: shown('application'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** An OPEX budget line linked to the application, from the application's side. */
const APPLICATION_SPEND_ITEM_FIELDS: HistoryFields = {
  spend_item_id: shown('budget_line'),
  // The lines a limited person cannot read stayed linked: the count is the writer's, not a field.
  hidden_kept: hidden('count of the lines the writer could not read'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A CAPEX budget line linked to the application, from the application's side. */
const APPLICATION_CAPEX_ITEM_FIELDS: HistoryFields = {
  capex_item_id: shown('budget_line'),
  hidden_kept: hidden('count of the lines the writer could not read'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A contract linked to the application, from the application's side. */
const APPLICATION_CONTRACT_FIELDS: HistoryFields = {
  contract_id: shown('contract'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A project linked to the application, from the application's side. */
const APPLICATION_PROJECT_FIELDS: HistoryFields = {
  project_id: shown('project'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** A deployment of the application (an environment). */
const APP_INSTANCE_FIELDS: HistoryFields = {
  environment: shown(),
  lifecycle: shown(),
  status: shown(),
  disabled_at: shown(),
  base_url: shown(),
  region: shown(),
  zone: shown(),
  sso_enabled: shown(),
  mfa_supported: shown(),
  notes: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A server of a deployment: the asset, its role and since when. */
const APP_ASSET_ASSIGNMENT_FIELDS: HistoryFields = {
  asset_id: shown('asset'),
  role: shown(),
  since_date: shown(),
  notes: shown(),
  app_instance_id: hidden('the deployment, named by its environment in the entry title'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** A web link of the application. */
const APPLICATION_LINK_FIELDS: HistoryFields = {
  url: shown(),
  description: shown(),
  purpose: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  created_at: hidden('timestamp'),
};

/** An attachment of the application. */
const APPLICATION_ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  application_id: hidden('the application, the record itself'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  uploaded_at: hidden('timestamp'),
};

/**
 * The allow-lists of the application's audit labels: the record, then its children. The process
 * and technology links keep theirs in `business_processes.ts` and `technologies.ts`.
 */
export const applicationsFields: Readonly<Record<string, HistoryFields>> = {
  applications: APPLICATION_FIELDS,
  application_owners: APPLICATION_OWNER_FIELDS,
  application_companies: APPLICATION_COMPANY_FIELDS,
  application_departments: APPLICATION_DEPARTMENT_FIELDS,
  application_support_contacts: APPLICATION_SUPPORT_CONTACT_FIELDS,
  application_data_residency: APPLICATION_DATA_RESIDENCY_FIELDS,
  application_suites: APPLICATION_SUITE_FIELDS,
  application_spend_items: APPLICATION_SPEND_ITEM_FIELDS,
  application_capex_items: APPLICATION_CAPEX_ITEM_FIELDS,
  application_contracts: APPLICATION_CONTRACT_FIELDS,
  application_projects: APPLICATION_PROJECT_FIELDS,
  app_instances: APP_INSTANCE_FIELDS,
  app_asset_assignments: APP_ASSET_ASSIGNMENT_FIELDS,
  application_links: APPLICATION_LINK_FIELDS,
  application_attachments: APPLICATION_ATTACHMENT_FIELDS,
};

/**
 * The application children an audit rule finds: the deployments, web links and attachments by
 * their payload's `application_id`, an assignment through its deployment (`app_instance_id`, then
 * `app_instances.application_id`). The sets named in `record_id` keep `parent_*` NULL.
 *
 * `1855910000000-audit-log-parent-applications.ts` copies these rules in SQL on purpose: a
 * migration is frozen and must not import this module.
 */
export const applicationsParentRules: Readonly<Record<string, AuditParentRule>> = {
  app_instances: { parentTable: 'applications', from: 'payload', keys: ['application_id'] },
  application_links: { parentTable: 'applications', from: 'payload', keys: ['application_id'] },
  application_attachments: { parentTable: 'applications', from: 'payload', keys: ['application_id'] },
  app_asset_assignments: { parentTable: 'applications', from: 'instance', keys: ['app_instance_id'] },
};
