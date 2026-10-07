import { BadRequestException, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { StorageService } from '../../common/storage/storage.service';
import { TENANT_PURGE_ATTACHMENT_TABLES } from './tenant-purge.inventory';

// Shared by the tenant deletion (AdminTenantsService.purgeTenantData) and the reset to the
// post-activation state (TenantResetService).

export type TenantPurgeReport = Array<{ table: string; deleted: number }>;

export type TenantTablesPurge = {
  /** Rows deleted per table, in the order the tables were purged. */
  report: TenantPurgeReport;
  /** Storage objects of the deleted attachment rows: delete them once the transaction has committed. */
  storagePaths: string[];
};

const logger = new Logger('TenantDataPurge');

/**
 * Deletes the current tenant's rows (`app.current_tenant`) from each table, in the given order,
 * inside the caller's transaction. Before an attachment table's rows go, their storage paths are
 * collected; the caller deletes the objects after the commit (deleteStorageObjects), so a purge
 * that fails and rolls back never leaves rows whose files are gone.
 */
export async function purgeTenantTables(
  manager: EntityManager,
  tablesInOrder: readonly string[],
): Promise<TenantTablesPurge> {
  const tenantTables = new Set<string>(
    (await manager.query(
      `SELECT table_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    )).map((row: { table_name: string }) => row.table_name),
  );
  const missingTenantId = tablesInOrder.filter((table) => !tenantTables.has(table));
  if (missingTenantId.length > 0) {
    throw new BadRequestException(
      `Tenant purge misconfigured: missing tenant_id on tables: ${missingTenantId.join(', ')}`,
    );
  }

  const attachmentTables = new Set<string>(TENANT_PURGE_ATTACHMENT_TABLES);
  const report: TenantPurgeReport = [];
  const storagePaths = new Set<string>();
  for (const table of tablesInOrder) {
    if (attachmentTables.has(table)) {
      const rows: Array<{ storage_path: string | null }> = await manager.query(
        `SELECT storage_path FROM ${table} WHERE tenant_id = app_current_tenant()`,
      );
      for (const row of rows) {
        if (row?.storage_path) storagePaths.add(row.storage_path);
      }
    }
    const res = await manager.query(
      `WITH deleted AS (
        DELETE FROM ${table}
        WHERE tenant_id = app_current_tenant()
        RETURNING 1
      )
      SELECT COUNT(*)::int AS count FROM deleted`,
    );
    report.push({ table, deleted: Number(res?.[0]?.count ?? 0) });
  }
  return { report, storagePaths: [...storagePaths] };
}

/**
 * Deletes storage objects one by one, after the commit that removed their rows. A failure is
 * logged and counted, never thrown: the orphaned attachment cleanup removes what is left.
 */
export async function deleteStorageObjects(
  storage: StorageService,
  paths: readonly string[],
  context: string,
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;
  for (const path of paths) {
    try {
      await storage.deleteObject(path);
      deleted += 1;
    } catch (error) {
      failed += 1;
      logger.warn(`${context}: storage object ${path} not deleted: ${(error as Error)?.message ?? error}`);
    }
  }
  return { deleted, failed };
}
