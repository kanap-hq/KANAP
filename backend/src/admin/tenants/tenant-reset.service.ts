import { BadRequestException, ConflictException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { throwNotAvailableInMode } from '../../common/feature-gates';
import { StorageService } from '../../common/storage/storage.service';
import { withTenant } from '../../common/tenant-runner';
import { Features } from '../../config/features';
import { catalogToMetadata, DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { TenantBaselineService } from '../../tenants/tenant-baseline.service';
import { TenantStatus } from '../../tenants/tenant.entity';
import { deleteStorageObjects, purgeTenantTables, TenantPurgeReport } from './tenant-data-purge';
import {
  assertTenantResetConfiguration,
  TENANT_RESET_PURGE_TABLES,
  TENANT_RESET_USER_TABLES,
} from './tenant-reset.inventory';

/** The code of the 409 a reset gets while another reset of the same tenant runs. */
export const TENANT_RESET_RUNNING_CODE = 'tenant_reset_running';

export const TENANT_RESET_RUNNING = 'A reset of this workspace is already running. Try again when it has finished.';

/**
 * The advisory lock namespace of the tenant reset lock ("TRST"): the two-key form, a key space
 * of its own, apart from the single-key locks and the budget-operations namespace.
 */
const TENANT_RESET_LOCK_NAMESPACE = 0x54525354;

/** The source reference of the audit entry a reset writes. */
export const TENANT_RESET_AUDIT_SOURCE_REF = 'demo-reset';

export type TenantResetOutcome = {
  purged: TenantPurgeReport;
  demoUsersRemoved: number;
  /** Storage objects of the purged attachments, deleted after the commit. */
  storagePaths: string[];
};

export type TenantResetResult = {
  purged: TenantPurgeReport;
  demoUsersRemoved: number;
  storageObjectsDeleted: number;
  storageObjectsFailed: number;
};

/**
 * The tenant's reset lock: a transaction advisory lock held until the reset's transaction ends.
 * A second reset does not wait: it is refused with a 409.
 */
export async function lockTenantReset(manager: EntityManager, tenantId: string): Promise<void> {
  const [row] = await manager.query(
    `SELECT pg_try_advisory_xact_lock($1::int, hashtext($2)) AS locked`,
    [TENANT_RESET_LOCK_NAMESPACE, `tenant-reset:${tenantId}`],
  );
  if (!row?.locked) {
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code: TENANT_RESET_RUNNING_CODE,
      message: TENANT_RESET_RUNNING,
    });
  }
}

/**
 * Brings a cloud tenant back to its state right after trial activation: every tenant table is
 * purged except the kept ones (tenant-reset.inventory.ts), the sample data users (`*.example`
 * e-mails) are removed, the tenant metadata goes back to its defaults, and the starting state
 * is created again (TenantBaselineService). The tenant row (name, address, branding, sign-in,
 * billing, status), the real users, the subscription, the AI settings and the history stay.
 * One transaction; the attachments' storage objects are deleted after it commits.
 */
@Injectable()
export class TenantResetService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly baseline: TenantBaselineService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async reset(tenantId: string, actorId: string | null): Promise<TenantResetResult> {
    const outcome = await withTenant(this.dataSource, tenantId, (manager) =>
      this.resetWithManager(manager, tenantId, actorId),
    );
    const storage = await deleteStorageObjects(this.storage, outcome.storagePaths, `tenant reset ${tenantId}`);
    return {
      purged: outcome.purged,
      demoUsersRemoved: outcome.demoUsersRemoved,
      storageObjectsDeleted: storage.deleted,
      storageObjectsFailed: storage.failed,
    };
  }

  /**
   * The reset inside the caller's transaction. Deletes no storage object: the caller deletes
   * `storagePaths` once the transaction has committed.
   */
  async resetWithManager(manager: EntityManager, tenantId: string, actorId: string | null): Promise<TenantResetOutcome> {
    await lockTenantReset(manager, tenantId);

    if (Features.SINGLE_TENANT) throwNotAvailableInMode();
    const [tenant]: Array<{ id: string; slug: string; name: string; status: string; is_system_tenant: boolean | null }> =
      await manager.query(
        `SELECT id, slug, name, status, is_system_tenant FROM tenants WHERE id = $1 FOR UPDATE`,
        [tenantId],
      );
    if (!tenant) throw new NotFoundException('Tenant not found');
    if (tenant.is_system_tenant) throw new BadRequestException('System tenants cannot be modified');
    if (tenant.status === TenantStatus.DELETED || tenant.status === TenantStatus.DELETING) {
      throw new BadRequestException('Tenant already deleted');
    }

    assertTenantResetConfiguration();
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    const { report, storagePaths } = await purgeTenantTables(manager, TENANT_RESET_PURGE_TABLES);
    const demoUsersRemoved = await this.removeDemoUsers(manager, tenantId, actorId);
    // The kept users' search entries went with the purge of search_index: write them again.
    await manager.query(`SELECT search_index_refresh_users($1, NULL)`, [tenantId]);
    await this.resetMetadata(manager, tenantId);

    const company = await this.baseline.resolveStartingCompany(manager, tenant);
    await this.baseline.ensureBaseline(manager, tenantId, { ...company, actorId });

    await this.audit.log(
      {
        table: 'tenants_admin',
        recordId: tenantId,
        action: 'update',
        sourceRef: TENANT_RESET_AUDIT_SOURCE_REF,
        userId: actorId,
        after: {
          purged_rows: report.reduce((sum, entry) => sum + entry.deleted, 0),
          purged_tables: Object.fromEntries(report.filter((entry) => entry.deleted > 0).map((entry) => [entry.table, entry.deleted])),
          demo_users_removed: demoUsersRemoved,
          storage_objects: storagePaths.length,
        },
      },
      { manager },
    );

    return { purged: report, demoUsersRemoved, storagePaths };
  }

  /**
   * Removes the sample data accounts (e-mail ending with `.example`, any case), never the acting
   * user: first their rows in the kept user tables, then the accounts. Their rows in the purged
   * tables are already gone.
   */
  private async removeDemoUsers(manager: EntityManager, tenantId: string, actorId: string | null): Promise<number> {
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM users
        WHERE tenant_id = $1
          AND lower(email) LIKE '%.example'
          AND ($2::uuid IS NULL OR id <> $2::uuid)`,
      [tenantId, actorId],
    );
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return 0;
    for (const table of TENANT_RESET_USER_TABLES) {
      const extra = table === 'ai_api_keys' ? ' OR created_by_user_id = ANY($2::uuid[])' : '';
      await manager.query(
        `DELETE FROM ${table} WHERE tenant_id = $1 AND (user_id = ANY($2::uuid[])${extra})`,
        [tenantId, ids],
      );
    }
    await manager.query(`DELETE FROM users WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, ids]);
    return ids.length;
  }

  /**
   * The metadata a tenant gets at creation, plus the stored `demo` key when there is one. One
   * statement on the column alone: the other columns of the row are never written back.
   */
  private async resetMetadata(manager: EntityManager, tenantId: string) {
    await manager.query(
      `UPDATE tenants
          SET metadata = jsonb_build_object('it_ops', $2::jsonb)
            || CASE WHEN jsonb_typeof(metadata) = 'object' AND metadata ? 'demo'
                    THEN jsonb_build_object('demo', metadata->'demo')
                    ELSE '{}'::jsonb END
        WHERE id = $1`,
      [tenantId, JSON.stringify(catalogToMetadata(DEFAULT_CLASSIFICATION_CATALOG))],
    );
  }
}
