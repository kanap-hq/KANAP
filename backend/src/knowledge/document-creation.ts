import { readCreationChanges, type CreationContext } from '../common/creation/creation-routes';
import { withChildCount, type CreationChanges } from '../common/creation/creation-changes';

/**
 * "Cancel" of a document being created (lot V4 of the creation frame): `POST /knowledge` hands its
 * creator a token of the family `documents` (`withCreationToken`); `GET` and
 * `DELETE /knowledge/:idOrRef/creation` read and use it. The delete is the document delete (`KnowledgeService.remove`: the library's write
 * rule, the refusal of a managed document, the audit entry). That delete reads no edit lock, so the
 * creator's own lock, taken right after the creation, does not stand in the way; the lock row goes
 * with the document (foreign key, ON DELETE CASCADE).
 */

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
export function readDocumentCreationChanges(documentId: string, token: unknown, ctx: CreationContext): Promise<{ changes: CreationChanges }> {
  return readCreationChanges('documents', documentId, token, ctx, {
    // The revision and the version number move with every save, beside the field it changed.
    ignoreFields: ['revision', 'current_version_number'],
    extra: async (changes, manager) => {
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
          [ctx.tenantId, documentId],
        );
      changes = withChildCount(changes, 'attachment', counts?.attachments ?? 0);
      changes = withChildCount(changes, 'document_version', counts?.versions ?? 0);
      changes = withChildCount(changes, 'relation', counts?.relations ?? 0);
      changes = withChildCount(changes, 'classification', counts?.classifications ?? 0);
      changes = withChildCount(changes, 'contributor', counts?.contributors ?? 0);
      return withChildCount(changes, 'comment', counts?.comments ?? 0);
    },
  });
}
