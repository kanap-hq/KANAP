import type { AuditParentRule } from '../../audit-parent-rules';
import type { RecordHistoryRecord } from '../../record-history.inventory';
import type { HistoryFields } from '../field-rules';
import { hidden, hiddenChanged, shown } from '../field-rules';

/**
 * The Knowledge document (lot 2, family E): its page and right panel, its one audit label, its
 * attachment child and their allow-lists.
 *
 * The record entry is read by `record-history.inventory.ts`, the fields by `../fields.ts` and the
 * parent rule by `audit-parent-rules.ts`. The document family is read by code
 * (`record-history/families.ts`, `knowledge_document`): a restricted library and an incident review
 * cannot be decided by a predicate on the row.
 *
 * The versions (`document_versions`) and the comments (`document_activities`) never enter
 * `audit_log`: their screens already exist (the sidebar's versions and comments), and the data-access
 * inventory does not know them, so they are not exclusions here.
 */
export const documentsRecord = {
  table: 'documents',
  module: 'knowledge',
  level: 'reader',
  auditLabels: ['documents'],
  family: 'document',
  children: {
    // The attachment writer audits the stored row, which names the document in `document_id`.
    document_attachments: 'attachment',
  },
  explicitParentLabels: [],
  exclusions: [],
} as const satisfies RecordHistoryRecord;

/** A document, as its own audit rows record it. The body and its search artifacts stay out. */
const DOCUMENT_FIELDS: HistoryFields = {
  title: shown(),
  summary: shown(),
  status: shown(),
  folder_id: shown('document_folder'),
  library_id: shown('document_library'),
  document_type_id: shown('document_type'),
  template_document_id: shown('document'),
  review_due_at: shown(),
  last_reviewed_at: shown(),
  published_at: shown(),
  current_version_number: shown(),
  revision: shown(),
  // The value never leaves the API: the entry says that the content changed, and the versions keep
  // the text. The plain text and the vector are derived from the same body.
  content_markdown: hiddenChanged('document body: long content, kept by its versions', 'contentChanged'),
  content_plain: hidden('plain text derived from the document body: long content, kept by its versions'),
  search_vector: hidden('search index'),
  integrated_binding: hidden('technical binding to the source record; its module has its own history'),
  item_number: hidden('business reference, never a change'),
  created_by: hidden('write author, already the entry actor'),
  updated_by: hidden('write author, already the entry actor'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
  created_at: hidden('timestamp'),
  updated_at: hidden('timestamp'),
};

/** An attachment of a document: what it is, never where it is stored. */
const DOCUMENT_ATTACHMENT_FIELDS: HistoryFields = {
  original_filename: shown(),
  mime_type: shown(),
  size: shown(),
  document_id: hidden('parent document'),
  stored_filename: hidden('storage detail'),
  storage_path: hidden('storage detail'),
  source_field: hidden('technical source of the upload'),
  uploaded_by_id: hidden('upload author, already the entry actor'),
  uploaded_at: hidden('timestamp, already the entry date'),
  id: hidden('identity'),
  tenant_id: hidden('tenancy'),
};

/** The allow-lists of the document's audit labels: the document and its attachments. */
export const documentsFields: Readonly<Record<string, HistoryFields>> = {
  documents: DOCUMENT_FIELDS,
  document_attachments: DOCUMENT_ATTACHMENT_FIELDS,
};

/**
 * The attachment names its document in the payload (the stored row); its own id is `record_id`.
 * The migration `1855740000000-document-history-parent.ts` copies this rule in SQL
 * (`__tests__/document-history-parent-migration.integration.spec.ts` compares them).
 */
export const documentsParentRules: Readonly<Record<string, AuditParentRule>> = {
  document_attachments: { parentTable: 'documents', from: 'payload', keys: ['document_id'] },
};
