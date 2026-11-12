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

/**
 * The paths of `paths` that no attachment row of the tenant names any more, apart from the rows
 * `excludeIds` (the ones being deleted). A stored file may be named by several rows (a task's
 * attachment and its copy in the request made from the task, an inline image and its clone in a
 * managed document): it goes only with the last one.
 *
 * Every row of the tenant counts, those a person with limited data access cannot read included:
 * the check runs in the read-only window of `withFullDataAccess`, and returns only the paths the
 * caller passed. Runs with the rows' delete, so a failed check fails that delete and no file has
 * been touched yet.
 */
export async function unreferencedPaths(
  manager: EntityManager,
  tenantId: string,
  paths: string[],
  excludeIds: string[] = [],
): Promise<string[]> {
  if (paths.length === 0) return [];
  if (!tenantId) throw new Error('No tenant for the stored file reference check');
  const read = async (mg: EntityManager) => {
    const rows: Array<{ storage_path: string }> = await mg.query(
      ATTACHMENT_TABLES.map(
        (table) => `SELECT storage_path FROM ${table}
           WHERE tenant_id = $1 AND storage_path = ANY($2::text[]) AND id <> ALL($3::uuid[])`,
      ).join(' UNION '),
      [tenantId, paths, excludeIds],
    );
    return new Set(rows.map((r) => r.storage_path));
  };
  // Without a transaction no access is limited (`DataAccessTransactionRequiredError`).
  const referenced = manager.queryRunner?.isTransactionActive ? await withFullDataAccess(manager, read) : await read(manager);
  return paths.filter((path) => !referenced.has(path));
}

/** Whether an attachment row of the current tenant other than `excludeIds` names `storagePath` (see `unreferencedPaths`). */
export async function isStoragePathReferencedInAnyTable(
  manager: EntityManager,
  storagePath: string,
  excludeIds: string[] = [],
): Promise<boolean> {
  const [row] = await manager.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
  const tenantId = String(row?.tenant_id ?? '');
  return (await unreferencedPaths(manager, tenantId, [storagePath], excludeIds)).length === 0;
}
