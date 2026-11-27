import type { EntityManager } from 'typeorm';
import { recordHistoryEntry } from '../../audit/record-history.inventory';
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
 * - `live`: a row that refuses only until the time in that column (an edit lock).
 * - `afterRecord`: a row that refuses only when written after the record's creation (a document's
 *   relations: those of the creation share its transaction, so its `now()`).
 * - Every family: a managed document of the record that another person wrote (a row of its
 *   history, a version), commented, or holds open in the editor (a live edit lock); the creator's
 *   own versions are counted before Cancel (`countEditedManagedDocuments`).
 *
 * A link table with two columns towards the family (a dependency, a relation between two assets)
 * is audited on the record whose page writes it: the other column is declared here, since another
 * person's record names the new one there without a row of its history.
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
  /** Its column that ends the row's validity: the row refuses only before that time. */
  live?: string;
  afterRecord?: true;
};

const documentLink = (table: string, column: string): CreationLink => ({ table, column, managedDocuments: true });
const link = (table: string, column: string): CreationLink => ({ table, column });
const activities = (column: string): CreationLink => ({ table: 'portfolio_activities', column, author: 'author_id' });
/** A relation of the document set after its creation (from the other record's Knowledge panel). */
const laterRelation = (table: string): CreationLink => ({ table, column: 'document_id', afterRecord: true });

/** By record table (the history inventory's, as the creation routes name it). */
export const CREATION_CANCEL_LINKS: Readonly<Record<string, readonly CreationLink[]>> = {
  applications: [
    documentLink('document_applications', 'application_id'),
    link('incident_applications', 'application_id'),
    link('task_applications', 'application_id'),
    link('interface_middleware_applications', 'application_id'),
    // Another application names the new one as its suite (audited on that application).
    link('application_suites', 'suite_id'),
  ],
  assets: [
    documentLink('document_assets', 'asset_id'),
    link('incident_assets', 'asset_id'),
    link('task_assets', 'asset_id'),
    // Another asset's cluster or relation names the new one (audited on that asset).
    link('asset_cluster_members', 'asset_id'),
    link('asset_relations', 'related_asset_id'),
  ],
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
    // Another person's editor open on it: their text is not saved yet.
    { table: 'document_edit_locks', column: 'document_id', author: 'holder_user_id', live: 'expires_at' },
    // Another document cites it.
    link('document_references', 'target_document_id'),
    ...['document_applications', 'document_assets', 'document_connections', 'document_incidents', 'document_interfaces',
      'document_locations', 'document_projects', 'document_requests', 'document_tasks'].map(laterRelation),
  ],
  incidents: [
    documentLink('document_incidents', 'incident_id'),
    // The journal is no audit: a note of another person is no row of the incident's history.
    { table: 'incident_entries', column: 'incident_id', author: 'author_id' },
  ],
  interfaces: [
    documentLink('document_interfaces', 'interface_id'),
    { table: 'interface_connection_links', column: 'interface_binding_id', through: { table: 'interface_bindings', column: 'interface_id' } },
    link('interface_dependencies', 'related_interface_id'),
  ],
  locations: [documentLink('document_locations', 'location_id')],
  portfolio_projects: [
    documentLink('document_projects', 'project_id'),
    activities('project_id'),
    link('portfolio_request_dependencies', 'depends_on_project_id'),
    link('portfolio_project_dependencies', 'depends_on_project_id'),
  ],
  portfolio_requests: [documentLink('document_requests', 'request_id'), activities('request_id'), link('portfolio_request_dependencies', 'depends_on_request_id')],
  tasks: [documentLink('document_tasks', 'task_id'), activities('task_id')],
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function identifiers(...names: string[]): void {
  for (const name of names) if (!IDENTIFIER.test(name)) throw new Error(`Invalid creation link identifier: ${name}`);
}

function linkCondition(link: CreationLink, recordTable: string): string {
  identifiers(recordTable, link.table, link.column, link.author ?? 'author', link.through?.table ?? 'through', link.through?.column ?? 'through', link.live ?? 'live');
  const conditions = [`x.tenant_id = $1`];
  if (link.through) {
    conditions.push(`EXISTS (SELECT 1 FROM ${link.through.table} p
                              WHERE p.tenant_id = x.tenant_id AND p.id = x.${link.column} AND p.${link.through.column} = $2::uuid)`);
  } else {
    conditions.push(`x.${link.column} = $2::uuid`);
  }
  if (link.author) conditions.push(`x.${link.author} IS NOT NULL`, `lower(x.${link.author}::text) <> $3::text`);
  if (link.live) conditions.push(`x.${link.live} > now()`);
  if (link.afterRecord) {
    conditions.push(`x.created_at > (SELECT r.created_at FROM ${recordTable} r WHERE r.tenant_id = $1 AND r.id = $2::uuid)`);
  }
  if (link.managedDocuments) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM integrated_document_bindings b
                                  WHERE b.tenant_id = x.tenant_id AND b.document_id = x.document_id AND b.source_entity_id = $2::uuid)`);
  }
  return `EXISTS (SELECT 1 FROM ${link.table} x WHERE ${conditions.join(' AND ')})`;
}

/**
 * A managed document of the record (any family) that another person wrote, commented, or holds open
 * in the editor. "Wrote" reads the document's own history: every save of a managed document writes
 * an `update` row under its author (`KnowledgeService.update`, `updateManagedDocument`, so the
 * source routes, the import and Kad), and a revert writes a version. `updated_by` keeps only the
 * last writer, so it is not read. The rows of the document's provisioning do not count: its
 * `create` row, its first version and its "created" activity carry whoever opened the record first.
 * A row of nobody (a title synced by the system) or of the creator does not count either.
 */
function managedEditedByOthers(recordTable: string): string {
  const since = `(SELECT r.created_at FROM ${recordTable} r WHERE r.tenant_id = $1 AND r.id = $2::uuid)`;
  return `EXISTS (
  SELECT 1 FROM integrated_document_bindings b
    JOIN documents d ON d.tenant_id = b.tenant_id AND d.id = b.document_id
   WHERE b.tenant_id = $1 AND b.source_entity_id = $2::uuid
     AND (EXISTS (SELECT 1 FROM audit_log h
                   WHERE h.tenant_id = d.tenant_id AND h.table_name = 'documents' AND h.record_id = d.id
                     AND h.action = 'update' AND h.created_at >= ${since}
                     AND h.user_id IS NOT NULL AND lower(h.user_id::text) <> $3::text)
       OR EXISTS (SELECT 1 FROM document_versions v
                   WHERE v.tenant_id = d.tenant_id AND v.document_id = d.id AND v.created_at > d.created_at
                     AND v.created_by IS NOT NULL AND lower(v.created_by::text) <> $3::text)
       OR EXISTS (SELECT 1 FROM document_activities a
                   WHERE a.tenant_id = d.tenant_id AND a.document_id = d.id AND a.type = 'comment'
                     AND a.author_id IS NOT NULL AND lower(a.author_id::text) <> $3::text)
       OR EXISTS (SELECT 1 FROM document_edit_locks l
                   WHERE l.tenant_id = d.tenant_id AND l.document_id = d.id
                     AND lower(l.holder_user_id::text) <> $3::text AND l.expires_at > now())))`;
}

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
  const recordTable = recordHistoryEntry(table)?.table ?? table;
  identifiers(recordTable);
  const conditions = [...links.map((link) => linkCondition(link, recordTable)), managedEditedByOthers(recordTable)];
  const [row]: Array<{ linked: boolean }> = await manager.query(
    `SELECT ${conditions.join(' OR ')} AS linked`,
    [tenantId, recordId, String(userId ?? '').toLowerCase()],
  );
  if (row?.linked) throw creationCancelExpired();
}
