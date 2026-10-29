import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The incident (lot 2, linked records): its page, the audit labels of its own row and of its
 * children, their allow-lists and the parent rule of its attachments.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rules by `audit-parent-rules.ts`. The family `incident` applies the register's
 * confidentiality rule, so a confidential incident's history is not found for a reader outside it,
 * and its tasks (`tasks`, type `incident`, shared rule in `audit-parent-rules.ts`) are reached only
 * through it. The asset, application and technology links are written with the incident in
 * `record_id` (`incident-relations.service.ts`, id arrays before and after) and read by it. The
 * attachments name the incident in their payload (`incident_id`); the migration
 * `1855900000000-audit-log-parent-contracts-incidents.ts` backfills their parent and the tasks'.
 */
export const incidentsRecord = {
  table: 'incidents',
  module: 'incidents',
  level: 'reader',
  auditLabels: ['incidents'],
  family: 'incident',
  children: {
    // The payload names the incident (`incident_id`).
    incident_attachments: 'attachment',
    // The incident's tasks: the saved task names it (`related_object_type` = 'incident').
    tasks: 'task',
    // `record_id` is the incident: the link sets of its Relations tab.
    incident_assets: 'asset',
    incident_applications: 'application',
    incident_technologies: 'technology',
  },
  childReads: {
    incident_assets: 'record',
    incident_applications: 'record',
    incident_technologies: 'record',
  },
  explicitParentLabels: [],
  exclusions: [
    {
      table: 'incident_entries',
      reason: 'the Journal tab, which keeps its own entries and is not audit',
    },
    {
      table: 'document_incidents',
      reason: 'the review document has its own history',
    },
  ],
} as const satisfies RecordHistoryRecord;

/** An incident, as its own audit rows record it. */
const INCIDENT_FIELDS: HistoryFields = {
  title: shown(),
  category: shown(),
  severity: shown(),
  status: shown(),
  started_at: shown(),
  detected_at: shown(),
  resolved_at: shown(),
  closed_at: shown(),
  reporter_user_id: shown('user'),
  owner_user_id: shown('user'),
  source_ref: shown(),
  confidential: shown(),
  personal_data_affected: shown(),
  authority_notification_required: shown(),
  authority_notified_at: shown(),
  notified_parties: shown(),
  // Rich text: the entry says that the description changed, never its content.
  description: hiddenChanged('incident description: long content', 'descriptionChanged'),
  item_number: hidden('business reference, never a change'),
  created_by: hidden('write author, already the entry actor'),
  updated_by: hidden('write author, already the entry actor'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An attachment of an incident: what it is, never where it is stored. A removal sets `deleted_at`. */
const INCIDENT_ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  incident_id: hidden('the incident, the record itself'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  uploaded_by: hidden('upload author, already the entry actor'),
  uploaded_at: hidden('timestamp, already the entry date'),
  deleted_at: hidden('the removal, read as the entry event'),
};

/** The allow-lists of the incident's audit labels: the incident and its attachments. */
export const incidentsFields: Readonly<Record<string, HistoryFields>> = {
  incidents: INCIDENT_FIELDS,
  incident_attachments: INCIDENT_ATTACHMENT_FIELDS,
};

/**
 * The attachment names its incident in the payload (the stored row). The incident's tasks use the
 * shared task rule of `audit-parent-rules.ts`.
 *
 * `1855900000000-audit-log-parent-contracts-incidents.ts` copies this rule in SQL on purpose.
 */
export const incidentsParentRules: Readonly<Record<string, AuditParentRule>> = {
  incident_attachments: { parentTable: 'incidents', from: 'payload', keys: ['incident_id'] },
};
