import { EntityManager } from 'typeorm';
import { withFullDataAccess } from '../data-access/full-data-access';

// `capex_attachments` is dormant since lot Z1 (its rows are in `spend_attachments`, same paths):
// it no longer says whether a file is in use.
// Every other table of TENANT_PURGE_ATTACHMENT_TABLES belongs here (storage-path-refs.spec.ts).
const ATTACHMENT_TABLES = [
  'portfolio_project_attachments',
  'portfolio_request_attachments',
  'task_attachments',
  'document_attachments',
  'application_attachments',
  'technology_attachments',
  'interface_attachments',
  'contract_attachments',
  'spend_attachments',
  'asset_attachments',
  'incident_attachments',
  'ai_message_attachments',
] as const;

export { ATTACHMENT_TABLES };

/** Content columns that may show inline images by their address (the attachment's id). */
export const CONTENT_SOURCES = [
  { table: 'portfolio_requests', columns: ['current_situation', 'expected_benefits'] },
  { table: 'portfolio_activities', columns: ['content'] },
  { table: 'tasks', columns: ['description'] },
  { table: 'documents', columns: ['content_markdown'] },
  // Stored versions render their own images: an attachment dropped from the
  // current body but still present in a kept version is alive, not an orphan.
  // Without this the cron would delete the illustrations of a frozen incident
  // review the moment the body moved on.
  { table: 'document_versions', columns: ['content_markdown'] },
  { table: 'document_activities', columns: ['content'] },
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Reads with every row of the tenant counted, those a person with limited data access cannot read
 * included: the read-only window of `withFullDataAccess`. Its callers return only what the caller
 * passed (paths, a yes or no). Without a transaction no access is limited
 * (`DataAccessTransactionRequiredError`).
 */
function readEveryRow<T>(manager: EntityManager, read: (mg: EntityManager) => Promise<T>): Promise<T> {
  return manager.queryRunner?.isTransactionActive ? withFullDataAccess(manager, read) : read(manager);
}

/**
 * Serializes, per stored file, the copy of an attachment row with the delete of the rows naming the
 * file, until the transaction ends. A copy takes it before it reads the rows it copies; a delete
 * takes it (in `unreferencedPaths`) once its rows are gone, before its check. Whichever comes
 * second waits for the other to commit, then sees what it did. One path at a time, in order, so
 * two holders of several paths never wait on each other.
 */
export async function lockStoragePaths(manager: EntityManager, paths: string[]): Promise<void> {
  for (const path of [...new Set(paths.filter(Boolean))].sort()) {
    await manager.query(`SELECT pg_advisory_xact_lock(hashtext('attachment-file:' || $1))`, [path]);
  }
}

/**
 * The paths of `paths` that no attachment row of the tenant names any more, apart from the rows
 * `excludeIds`. A stored file may be named by several rows (a task's attachment and its copy in
 * the request made from the task, an inline image and its clone in a managed document): it goes
 * only with the last one.
 *
 * Callers delete their rows first, then ask, then delete the files: the row delete and
 * `lockStoragePaths` make a copy running at the same time either wait or be seen. Every row of the
 * tenant counts (`readEveryRow`). A failed check fails the delete before any file is touched.
 */
export async function unreferencedPaths(
  manager: EntityManager,
  tenantId: string,
  paths: string[],
  excludeIds: string[] = [],
): Promise<string[]> {
  if (paths.length === 0) return [];
  if (!tenantId) throw new Error('No tenant for the stored file reference check');
  await lockStoragePaths(manager, paths);
  const referenced = await readEveryRow(manager, async (mg) => {
    const rows: Array<{ storage_path: string }> = await mg.query(
      ATTACHMENT_TABLES.map(
        (table) => `SELECT storage_path FROM ${table}
           WHERE tenant_id = $1 AND storage_path = ANY($2::text[]) AND id <> ALL($3::uuid[])`,
      ).join(' UNION '),
      [tenantId, paths, excludeIds],
    );
    return new Set(rows.map((r) => r.storage_path));
  });
  return paths.filter((path) => !referenced.has(path));
}

async function currentTenant(manager: EntityManager): Promise<string> {
  const [row] = await manager.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
  return String(row?.tenant_id ?? '');
}

/** Whether an attachment row of the current tenant other than `excludeIds` names `storagePath` (see `unreferencedPaths`). */
export async function isStoragePathReferencedInAnyTable(
  manager: EntityManager,
  storagePath: string,
  excludeIds: string[] = [],
): Promise<boolean> {
  return (await unreferencedPaths(manager, await currentTenant(manager), [storagePath], excludeIds)).length === 0;
}

/**
 * Whether a content of the current tenant (`CONTENT_SOURCES`) still shows the inline attachment
 * `attachmentId` by its address, apart from the row `exclude`: a task's image shown by the request
 * made from the task, for instance. Such an attachment is not cleaned up with the text it left;
 * the weekly sweep removes it once no content shows it. Every row counts (`readEveryRow`).
 */
export async function isInlineAttachmentShownInContent(
  manager: EntityManager,
  attachmentId: string,
  exclude?: { table: (typeof CONTENT_SOURCES)[number]['table']; id: string },
): Promise<boolean> {
  const id = String(attachmentId || '').trim();
  if (!UUID_RE.test(id)) return false;
  const tenantId = await currentTenant(manager);
  if (!tenantId) throw new Error('No tenant for the inline image reference check');
  return readEveryRow(manager, async (mg) => {
    const params: unknown[] = exclude ? [tenantId, `%${id}%`, exclude.id] : [tenantId, `%${id}%`];
    const branches = CONTENT_SOURCES.flatMap((src) => src.columns.map((col) => (
      `SELECT 1 FROM ${src.table} WHERE tenant_id = $1 AND ${col} LIKE $2${exclude && src.table === exclude.table ? ' AND id <> $3::uuid' : ''}`
    )));
    const rows = await mg.query(`SELECT 1 FROM (${branches.join(' UNION ALL ')}) shown LIMIT 1`, params);
    return rows.length > 0;
  });
}
