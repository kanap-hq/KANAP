import type { EntityManager } from 'typeorm';
import { creationCancelExpired, issueCreationToken, verifyCreationToken } from '../common/creation/creation-token';
import { countChangesSinceCreation, withChildCount, type CreationChanges } from '../common/creation/creation-changes';

/**
 * "Cancel" of a document being created (lot V4 of the creation frame): `POST /knowledge` hands its
 * creator a token of the family `documents`; `GET` and `DELETE /knowledge/:idOrRef/creation` read
 * and use it. The delete is the document delete (`KnowledgeService.remove`: the library's write
 * rule, the refusal of a managed document, the audit entry). That delete reads no edit lock, so the
 * creator's own lock, taken right after the creation, does not stand in the way; the lock row goes
 * with the document (foreign key, ON DELETE CASCADE).
 */

export const DOCUMENT_CREATION_FAMILY = 'documents';

type Subject = { tenantId: string; userId: string };

/** The created document with the token of its creator. */
export function withDocumentCreationToken<T extends { id: string }>(created: T, subject: Subject): T & { creation_token: string } {
  const creation_token = issueCreationToken({ ...subject, family: DOCUMENT_CREATION_FAMILY, recordId: created.id });
  return Object.assign(created, { creation_token });
}

/** The token of `POST /knowledge` for this document, tenant and person, still valid; a 403 otherwise. */
export function assertDocumentCreationToken(documentId: string, token: unknown, subject: Subject): void {
  const valid = verifyCreationToken(token, { ...subject, family: DOCUMENT_CREATION_FAMILY, recordId: String(documentId ?? '') });
  if (!valid) throw creationCancelExpired();
}

/** The link tables of a document to another record (`knowledge.service.ts`, relations). */
const RELATION_TABLES = [
  'document_applications',
  'document_assets',
  'document_projects',
  'document_requests',
  'document_tasks',
  'document_incidents',
  'document_interfaces',
  'document_locations',
  'document_connections',
];

/**
 * Before "Cancel": what was written on the document since its creation. Its history's audit rows
 * give its fields (the body included: an autosave of new content counts, the template's content
 * given at the creation does not) and its attachments; the rest is no audit and is read directly:
 * - the versions, relations, classifications and contributors written after the creation (a row
 *   of the creation itself, such as the owner, the relations of the address or the template's
 *   classifications, carries the creation's time; a replaced set is written anew and counts);
 * - the attachments as they stand, and the comments.
 * Nothing is written.
 */
export async function documentCreationChanges(manager: EntityManager, tenantId: string, documentId: string): Promise<CreationChanges> {
  const later = (table: string) =>
    `(SELECT count(*)::int FROM ${table} x WHERE x.tenant_id = d.tenant_id AND x.document_id = d.id AND x.created_at > d.created_at)`;
  const [counts]: Array<{ versions: number; relations: number; classifications: number; contributors: number; attachments: number; comments: number }> =
    await manager.query(
      `SELECT ${later('document_versions')} AS versions,
              ${RELATION_TABLES.map(later).join(' + ')} AS relations,
              ${later('document_classifications')} AS classifications,
              ${later('document_contributors')} AS contributors,
              (SELECT count(*)::int FROM document_attachments x WHERE x.tenant_id = d.tenant_id AND x.document_id = d.id) AS attachments,
              (SELECT count(*)::int FROM document_activities x WHERE x.tenant_id = d.tenant_id AND x.document_id = d.id AND x.type = 'comment') AS comments
         FROM documents d
        WHERE d.tenant_id = $1 AND d.id = $2`,
      [tenantId, documentId],
    );
  // The revision and the version number move with every save, beside the field it changed.
  let changes = await countChangesSinceCreation(manager, tenantId, 'documents', documentId, { ignoreFields: ['revision', 'current_version_number'] });
  changes = withChildCount(changes, 'attachment', counts?.attachments ?? 0);
  changes = withChildCount(changes, 'document_version', counts?.versions ?? 0);
  changes = withChildCount(changes, 'relation', counts?.relations ?? 0);
  changes = withChildCount(changes, 'classification', counts?.classifications ?? 0);
  changes = withChildCount(changes, 'contributor', counts?.contributors ?? 0);
  return withChildCount(changes, 'comment', counts?.comments ?? 0);
}
