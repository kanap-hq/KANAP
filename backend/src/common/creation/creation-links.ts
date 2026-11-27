import type { EntityManager } from 'typeorm';
import { creationCancelExpired } from './creation-token';

/**
 * The children of a record being created that another person may write without a row its history
 * reads (`countOtherAuthorsSinceCreation`), and that its delete would take with it (a foreign key
 * ON DELETE CASCADE): "Cancel" stops once one stands (403 `CREATION_CANCEL_EXPIRED`, decision P17),
 * so it never takes another person's work without a refusal.
 *
 * - A row with no author (a link posted from the other record: a document's relation, a
 *   connection's interface binding) refuses whoever set it, the creator included.
 * - A row with its author (`author`) refuses when another person wrote it; a row of the creator,
 *   or of nobody (a system entry), does not.
 * - `managedDocuments`: the relation row of a managed document of the record (its review, its
 *   purpose: `integrated_document_bindings`), provisioned with the record, does not refuse; its
 *   content is counted before Cancel (`countEditedManagedDocuments`).
 *
 * The cancel reads them under the record's lock (`assertCreatorAloneSinceCreation`): a child
 * inserted meanwhile waits on that lock through its foreign key, so the read after the lock sees
 * every committed child, and a child posted after it fails on the record gone (409 `parent_gone`).
 * `__tests__/creation-links.inventory.integration.spec.ts` checks the declarations against the
 * database: every document relation table of a record is declared.
 */

export type CreationLink = {
  /** The child table, which references the record ON DELETE CASCADE. */
  table: string;
  /** Its column that names the record. */
  column: string;
  /** Its column that names the person who wrote the row, when it has one. */
  author?: string;
  managedDocuments?: true;
};

const documentLink = (table: string, column: string): CreationLink => ({ table, column, managedDocuments: true });

/** By record table (the history inventory's, as the creation routes name it). */
export const CREATION_CANCEL_LINKS: Readonly<Record<string, readonly CreationLink[]>> = {
  applications: [documentLink('document_applications', 'application_id')],
  assets: [documentLink('document_assets', 'asset_id')],
  connections: [
    { table: 'interface_connection_links', column: 'connection_id' },
    documentLink('document_connections', 'connection_id'),
  ],
  incidents: [
    documentLink('document_incidents', 'incident_id'),
    // The journal is no audit: a note of another person is no row of the incident's history.
    { table: 'incident_entries', column: 'incident_id', author: 'author_id' },
  ],
  interfaces: [documentLink('document_interfaces', 'interface_id')],
  locations: [documentLink('document_locations', 'location_id')],
  portfolio_projects: [documentLink('document_projects', 'project_id')],
  portfolio_requests: [documentLink('document_requests', 'request_id')],
  tasks: [documentLink('document_tasks', 'task_id')],
};

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;

function linkCondition(link: CreationLink): string {
  for (const name of [link.table, link.column, link.author ?? 'author']) {
    if (!IDENTIFIER.test(name)) throw new Error(`Invalid creation link identifier: ${name}`);
  }
  const conditions = [`x.tenant_id = $1`, `x.${link.column} = $2::uuid`];
  if (link.author) conditions.push(`x.${link.author} IS NOT NULL`, `lower(x.${link.author}::text) <> $3::text`);
  if (link.managedDocuments) {
    conditions.push(`NOT EXISTS (SELECT 1 FROM integrated_document_bindings b
                                  WHERE b.tenant_id = x.tenant_id AND b.document_id = x.document_id AND b.source_entity_id = $2::uuid)`);
  }
  return `EXISTS (SELECT 1 FROM ${link.table} x WHERE ${conditions.join(' AND ')})`;
}

/** 403 `CREATION_CANCEL_EXPIRED` when a child of `CREATION_CANCEL_LINKS[table]` stands for `userId`. */
export async function assertNoCreationLinks(
  manager: EntityManager,
  tenantId: string,
  table: string,
  recordId: string,
  userId: string,
): Promise<void> {
  const links = CREATION_CANCEL_LINKS[table];
  if (!links?.length) return;
  // `$3` (the person) only when a link has an author: PostgreSQL refuses a parameter it cannot type.
  const params = [tenantId, recordId];
  if (links.some((link) => link.author)) params.push(String(userId ?? '').toLowerCase());
  const [row]: Array<{ linked: boolean }> = await manager.query(`SELECT ${links.map(linkCondition).join(' OR ')} AS linked`, params);
  if (row?.linked) throw creationCancelExpired();
}
