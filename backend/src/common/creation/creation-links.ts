import type { EntityManager } from 'typeorm';
import { creationCancelExpired } from './creation-token';

/**
 * The children of a record being created that another person may write without a row its history
 * reads (`countOtherAuthorsSinceCreation`), and that its delete would take with it (a foreign key
 * ON DELETE CASCADE): "Cancel" stops once one stands (403 `CREATION_CANCEL_EXPIRED`, decision P17).
 * "Cancel" is for a record created by mistake that nothing depends on yet; once another record
 * hangs on it, the ordinary delete, with its confirmation, is the gesture.
 *
 * - A row with no author (a link posted from the other record: a document's relation, a task's
 *   application, a connection's interface binding) refuses whoever set it, the creator included.
 * - A row with its author (`author`) refuses when another person wrote it; a row of the creator,
 *   or of nobody (a system entry), does not.
 * - `through`: a row that names a child of the record (a binding of the interface), not the record.
 * - `managedDocuments`: the relation row of a managed document of the record (its review, its
 *   purpose: `integrated_document_bindings`), provisioned with the record, does not refuse.
 * - Every family: a managed document of the record that holds a version of another person (its
 *   purpose, its review written by someone else); the creator's own versions are counted before
 *   Cancel (`countEditedManagedDocuments`).
 *
 * The cancel reads them under the record's lock (`assertCreatorAloneSinceCreation`): a child
 * inserted meanwhile waits on that lock through its foreign key, so the read after the lock sees
 * every committed child, and a child posted after it fails on the record gone (409 `parent_gone`).
 * The rows a `through` child and a managed document's version point to are locked too (`lock`),
 * since their insert takes the key of that row, not the record's.
 * `creation-links.inventory.ts` lists the cascade children left out, with their reason;
 * `__tests__/creation-links.inventory.integration.spec.ts` classifies every one against the
 * database.
 */

export type CreationLink = {
  /** The child table, which references the record (or the `through` row) ON DELETE CASCADE. */
  table: string;
  /** Its column that names the record, or the `through` row. */
  column: string;
  /** Its column that names the person who wrote the row, when it has one. */
  author?: string;
  /** The record's own child the row names: its table and its column that names the record. */
  through?: { table: string; column: string };
  managedDocuments?: true;
};

const documentLink = (table: string, column: string): CreationLink => ({ table, column, managedDocuments: true });
const link = (table: string, column: string): CreationLink => ({ table, column });
const activities = (column: string): CreationLink => ({ table: 'portfolio_activities', column, author: 'author_id' });

/** By record table (the history inventory's, as the creation routes name it). */
export const CREATION_CANCEL_LINKS: Readonly<Record<string, readonly CreationLink[]>> = {
  applications: [
    documentLink('document_applications', 'application_id'),
    link('incident_applications', 'application_id'),
    link('task_applications', 'application_id'),
    link('interface_middleware_applications', 'application_id'),
  ],
  assets: [documentLink('document_assets', 'asset_id'), link('incident_assets', 'asset_id'), link('task_assets', 'asset_id')],
  business_processes: [link('portfolio_request_business_processes', 'business_process_id')],
  connections: [link('interface_connection_links', 'connection_id'), documentLink('document_connections', 'connection_id')],
  contacts: [
    link('application_support_contacts', 'contact_id'),
    link('asset_support_contacts', 'contact_id'),
    link('location_contacts', 'contact_id'),
    link('portfolio_project_contacts', 'contact_id'),
    link('portfolio_request_contacts', 'contact_id'),
    link('technology_support_contacts', 'contact_id'),
  ],
  departments: [link('application_departments', 'department_id')],
  documents: [
    // Comments and review requests of another person are no audit of the document.
    { table: 'document_activities', column: 'document_id', author: 'author_id' },
    { table: 'document_workflows', column: 'document_id', author: 'requested_by' },
  ],
  incidents: [
    documentLink('document_incidents', 'incident_id'),
    // The journal is no audit: a note of another person is no row of the incident's history.
    { table: 'incident_entries', column: 'incident_id', author: 'author_id' },
  ],
  interfaces: [
    documentLink('document_interfaces', 'interface_id'),
    { table: 'interface_connection_links', column: 'interface_binding_id', through: { table: 'interface_bindings', column: 'interface_id' } },
  ],
  locations: [documentLink('document_locations', 'location_id')],
  portfolio_projects: [documentLink('document_projects', 'project_id'), activities('project_id'), link('portfolio_request_dependencies', 'depends_on_project_id')],
  portfolio_requests: [documentLink('document_requests', 'request_id'), activities('request_id')],
  tasks: [documentLink('document_tasks', 'task_id'), activities('task_id')],
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifiers(...names: string[]): void {
  for (const name of names) if (!IDENTIFIER.test(name)) throw new Error(`Invalid creation link identifier: ${name}`);
}

function linkCondition(link: CreationLink): string {
  identifiers(link.table, link.column, link.author ?? 'author', link.through?.table ?? 'through', link.through?.column ?? 'through');
  const conditions = [`x.tenant_id = $1`];
  if (link.through) {
    conditions.push(`EXISTS (SELECT 1 FROM ${link.through.table} p
                              WHERE p.tenant_id = x.tenant_id AND p.id = x.${link.column} AND p.${link.through.column} = $2::uuid)`);
  } else {
    conditions.push(`x.${link.column} = $2::uuid`);
  }
  if (link.author) conditions.push(`x.${link.author} IS NOT NULL`, `lower(x.${link.author}::text) <> $3::text`);
  if (link.managedDocuments) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM integrated_document_bindings b
                                  WHERE b.tenant_id = x.tenant_id AND b.document_id = x.document_id AND b.source_entity_id = $2::uuid)`);
  }
  return `EXISTS (SELECT 1 FROM ${link.table} x WHERE ${conditions.join(' AND ')})`;
}

/** A managed document of the record (any family) holds a version written by another person. */
const MANAGED_EDITED_BY_OTHERS = `EXISTS (
  SELECT 1 FROM integrated_document_bindings b
    JOIN document_versions v ON v.tenant_id = b.tenant_id AND v.document_id = b.document_id
   WHERE b.tenant_id = $1 AND b.source_entity_id = $2::uuid
     AND v.created_by IS NOT NULL AND lower(v.created_by::text) <> $3::text)`;

/**
 * 403 `CREATION_CANCEL_EXPIRED` when a child of `CREATION_CANCEL_LINKS[table]` stands for `userId`,
 * or a managed document of the record holds another person's version. With `lock` (the cancel,
 * the record already locked), the `through` rows and the managed documents are locked first.
 */
export async function assertNoCreationLinks(
  manager: EntityManager,
  tenantId: string,
  table: string,
  recordId: string,
  userId: string,
  options: { lock?: boolean } = {},
): Promise<void> {
  const links = CREATION_CANCEL_LINKS[table] ?? [];
  if (options.lock) {
    for (const { through } of links) {
      if (!through) continue;
      identifiers(through.table, through.column);
      await manager.query(`SELECT 1 FROM ${through.table} WHERE tenant_id = $1 AND ${through.column} = $2 FOR UPDATE`, [tenantId, recordId]);
    }
    await manager.query(
      `SELECT 1 FROM documents d
        WHERE d.tenant_id = $1
          AND d.id IN (SELECT b.document_id FROM integrated_document_bindings b WHERE b.tenant_id = $1 AND b.source_entity_id = $2::uuid)
        FOR UPDATE`,
      [tenantId, recordId],
    );
  }
  const conditions = [...links.map(linkCondition), MANAGED_EDITED_BY_OTHERS];
  const [row]: Array<{ linked: boolean }> = await manager.query(
    `SELECT ${conditions.join(' OR ')} AS linked`,
    [tenantId, recordId, String(userId ?? '').toLowerCase()],
  );
  if (row?.linked) throw creationCancelExpired();
}
