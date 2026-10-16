import type { EntityManager } from 'typeorm';
import { writeAuditLog } from '../audit/audit.service';

/**
 * The table of each source record type a managed document can be bound to
 * (`integrated_document_bindings.source_entity_type`, CHECK of the table). A type missing here is
 * never treated as orphaned.
 */
export const MANAGED_DOCUMENT_SOURCE_TABLES: Readonly<Record<string, string>> = {
  applications: 'applications',
  interfaces: 'interfaces',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  incidents: 'incidents',
  assets: 'assets',
  locations: 'locations',
  connections: 'connections',
};

export type ReleasedManagedDocument = {
  document_id: string;
  item_number: number | null;
  title: string;
  source_entity_type: string;
  source_entity_id: string;
  slot_key: string;
};

/**
 * Managed documents whose source record is gone (left behind by a delete that did not remove them,
 * as the application delete did not before it called deleteForEntity) are released, never
 * deleted: they hold text users wrote, and nobody asked for it to go. Each one is unbound, so
 * Knowledge treats it as an ordinary document an administrator may move or delete, and moved to
 * the unfiled documents of its library (Managed Docs), where it stays visible; its attachment
 * files are left alone. One audit entry per document records the release (source `system`, with
 * the former binding). Runs in the caller's transaction, with `app.current_tenant` set to
 * `tenantId`. With `dryRun`, finds them and changes nothing. With `only`, releases the documents
 * of that one record (gone) and audits them under `userId`.
 */
export async function releaseOrphanedManagedDocuments(
  manager: EntityManager,
  tenantId: string,
  opts: { dryRun?: boolean; sourceRef?: string; only?: { type: string; id: string }; userId?: string | null } = {},
): Promise<ReleasedManagedDocument[]> {
  const released: ReleasedManagedDocument[] = [];
  for (const [type, table] of Object.entries(MANAGED_DOCUMENT_SOURCE_TABLES)) {
    if (opts.only && opts.only.type !== type) continue;
    const params: unknown[] = [tenantId, type];
    if (opts.only) params.push(opts.only.id);
    const orphans: Array<ReleasedManagedDocument & { binding_id: string; folder_id: string | null }> = await manager.query(
      `SELECT b.id AS binding_id, b.document_id, b.source_entity_type, b.source_entity_id, b.slot_key,
              d.item_number, d.title, d.folder_id
         FROM integrated_document_bindings b
         JOIN documents d ON d.tenant_id = b.tenant_id AND d.id = b.document_id
        WHERE b.tenant_id = $1 AND b.source_entity_type = $2
          AND NOT EXISTS (SELECT 1 FROM ${table} s WHERE s.tenant_id = $1 AND s.id = b.source_entity_id)${opts.only ? ' AND b.source_entity_id = $3' : ''}
        ORDER BY d.item_number, b.id`,
      params,
    );
    for (const orphan of orphans) {
      const { binding_id: bindingId, folder_id: folderId, ...document } = orphan;
      if (!opts.dryRun) {
        await manager.query(`DELETE FROM integrated_document_bindings WHERE tenant_id = $1 AND id = $2`, [tenantId, bindingId]);
        await manager.query(`UPDATE documents SET folder_id = NULL, updated_at = now() WHERE tenant_id = $1 AND id = $2`, [
          tenantId,
          document.document_id,
        ]);
        await writeAuditLog(manager, {
          table: 'documents',
          recordId: document.document_id,
          action: 'update',
          before: {
            folder_id: folderId,
            integrated_binding: { source_entity_type: type, source_entity_id: document.source_entity_id, slot_key: document.slot_key },
          },
          after: { folder_id: null, integrated_binding: null },
          userId: opts.userId ?? null,
          source: 'system',
          sourceRef: opts.sourceRef ?? null,
        });
      }
      released.push(document);
    }
  }
  return released;
}
