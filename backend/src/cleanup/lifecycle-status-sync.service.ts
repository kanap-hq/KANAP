import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { withSavepoint } from '../common/savepoint.util';
import { withTenant } from '../common/tenant-runner';

export const LIFECYCLE_STATUS_SYNC_TASK_NAME = 'lifecycle-status-sync';

/**
 * The tables whose `status` is derived from `disabled_at` (`common/status.ts`,
 * `resolveLifecycleState`): enabled while the end of validity is empty or still
 * ahead, disabled from that moment on. Every write stores the derived value, so
 * a row only goes stale when a future end of validity passes with no edit after
 * it. Table names are interpolated from this list only. A spec checks it against
 * the catalog (every `status_state` table with `disabled_at`).
 *
 * `applications` and `app_instances` also carry both columns and are left out:
 * an application's status is written directly (API, CSV) with no date, and an
 * instance follows its lifecycle first. Their `status` is text. `capex_items`
 * is left out too: dormant since lot Z1 (its lines are in `spend_items`), never
 * written again until lot Z2 drops it.
 */
export const LIFECYCLE_STATUS_TABLES = [
  'accounts',
  'analytics_axes',
  'analytics_categories',
  'business_processes',
  'companies',
  'contracts',
  'cost_centers',
  'departments',
  'spend_items',
  'suppliers',
  'working_day_profiles',
] as const;

export type LifecycleStatusTable = (typeof LIFECYCLE_STATUS_TABLES)[number];
export type LifecycleStatusCounts = { disabled: number; enabled: number };
export type LifecycleStatusChanges = Partial<Record<LifecycleStatusTable, LifecycleStatusCounts>>;

export type TenantLifecycleStatusResult = {
  changes: LifecycleStatusChanges;
  /** Tables left for the next run: a row they had to change was locked by an edit. */
  skipped: LifecycleStatusTable[];
  errors: string[];
};

export type LifecycleStatusSyncSummary = {
  tenantsProcessed: number;
  rowsChanged: number;
  changed: LifecycleStatusChanges;
  /** `<tenant id>/<table>` skipped on a row lock, retried on the next run. */
  skipped: string[];
  errors: string[];
};

// Below deadlock_timeout (1 s): whenever the task and an edit wait on each other,
// the task gives up first, so it never makes a user's save fail.
const LOCK_TIMEOUT = '500ms';

// clock_timestamp() is read when the row is checked, also when the statement had
// to wait for a row lock: an edit that just set the end of validity to "now" and
// committed during that wait is read with its own date, never as still ahead.
// The new value flips the stored one (status is NOT NULL, two values), so a row
// the filter selected always changes, whatever instant the SET is evaluated at.
const DERIVED_STATUS = `CASE WHEN disabled_at IS NOT NULL AND disabled_at <= clock_timestamp()
  THEN 'disabled'::status_state ELSE 'enabled'::status_state END`;

function isLockTimeout(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? (err as { driverError?: { code?: string } })?.driverError?.code;
  return code === '55P03';
}

/**
 * Sets the stored status of one table's rows of one tenant from their end of
 * validity, in the caller's transaction. Only `status` changes: `updated_at`
 * keeps the last real edit and no audit row is written, as this is a derivation
 * (like migration 1758803100000), not an edit. The AFTER UPDATE search index
 * triggers refresh the indexed status. spend_items (the lines of both natures
 * since lot Z1) has a BEFORE UPDATE trigger (`row_version`, migration 1853740000000) that ignores
 * `status` (and `updated_at`): this sync never bumps a line's freshness
 * counter, so a CSV export is not reported as changed because a date passed.
 */
export async function syncTableLifecycleStatus(
  manager: EntityManager,
  tenantId: string,
  table: LifecycleStatusTable,
): Promise<LifecycleStatusCounts> {
  await manager.query(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  // withTenant has already set the tenant; set again for a caller's own transaction (specs).
  await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const [row] = await manager.query(
    `WITH changed AS (
       UPDATE ${table}
          SET status = CASE WHEN status = 'enabled' THEN 'disabled'::status_state ELSE 'enabled'::status_state END
        WHERE tenant_id = $1
          AND status IS DISTINCT FROM ${DERIVED_STATUS}
      RETURNING status
     )
     SELECT count(*) FILTER (WHERE status = 'disabled')::int AS disabled,
            count(*) FILTER (WHERE status = 'enabled')::int AS enabled
       FROM changed`,
    [tenantId],
  );
  return { disabled: Number(row?.disabled ?? 0), enabled: Number(row?.enabled ?? 0) };
}

function describeChanges(changes: LifecycleStatusChanges): string {
  return Object.entries(changes)
    .map(([table, counts]) => {
      const parts: string[] = [];
      if (counts!.disabled > 0) parts.push(`${counts!.disabled} disabled`);
      if (counts!.enabled > 0) parts.push(`${counts!.enabled} enabled`);
      return `${table} ${parts.join(', ')}`;
    })
    .join('; ');
}

/**
 * Hourly, and once when the API server starts: keeps the stored status in line
 * with the end of validity, so rows, sorts, workspaces and exports read the right
 * value. Bare-day ends of validity fall at noon UTC, so the run on the hour
 * catches them at once. Every tenant still in use is processed, frozen ones
 * included: this is no AI feature, only data kept consistent. Same behaviour in
 * both deployment modes (on-premise has one tenant).
 */
@Injectable()
export class LifecycleStatusSyncService implements OnModuleInit {
  private readonly logger = new Logger(LifecycleStatusSyncService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: LIFECYCLE_STATUS_SYNC_TASK_NAME,
      description: 'Keeps the status of master data, contracts, OPEX and CAPEX lines in line with their end of validity',
      defaultCron: '0 * * * *',
      runOnStartup: true,
      handler: () => this.run(),
    });
  }

  /**
   * One tenant, one short transaction per table, so no row lock is held across
   * tables and a failure on one table leaves the others done. A table whose row
   * stays locked past the lock timeout is skipped until the next run. `manager`:
   * the caller's transaction instead (specs), one savepoint per table.
   */
  async syncTenant(tenantId: string, opts?: { manager?: EntityManager }): Promise<TenantLifecycleStatusResult> {
    const result: TenantLifecycleStatusResult = { changes: {}, skipped: [], errors: [] };
    for (const table of LIFECYCLE_STATUS_TABLES) {
      try {
        const manager = opts?.manager;
        const counts = manager
          ? await withSavepoint(manager, () => syncTableLifecycleStatus(manager, tenantId, table))
          : await withTenant(this.dataSource, tenantId, (tx) => syncTableLifecycleStatus(tx, tenantId, table));
        if (counts.disabled > 0 || counts.enabled > 0) result.changes[table] = counts;
      } catch (error: any) {
        if (isLockTimeout(error)) result.skipped.push(table);
        else result.errors.push(`${table}: ${error?.message || String(error)}`);
      }
    }
    return result;
  }

  /** Every tenant in use. `manager`: the caller's transaction (specs). */
  async run(opts?: { manager?: EntityManager }): Promise<LifecycleStatusSyncSummary> {
    const summary: LifecycleStatusSyncSummary = { tenantsProcessed: 0, rowsChanged: 0, changed: {}, skipped: [], errors: [] };
    const tenants: Array<{ id: string }> = await (opts?.manager ?? this.dataSource).query(
      `SELECT id FROM tenants WHERE status IN ('active', 'frozen') AND deleted_at IS NULL ORDER BY id ASC`,
    );

    for (const tenant of tenants) {
      const result = await this.syncTenant(tenant.id, opts);
      for (const [table, counts] of Object.entries(result.changes) as Array<[LifecycleStatusTable, LifecycleStatusCounts]>) {
        const total = summary.changed[table] ?? { disabled: 0, enabled: 0 };
        total.disabled += counts.disabled;
        total.enabled += counts.enabled;
        summary.changed[table] = total;
        summary.rowsChanged += counts.disabled + counts.enabled;
      }
      summary.skipped.push(...result.skipped.map((table) => `${tenant.id}/${table}`));
      summary.errors.push(...result.errors.map((error) => `Tenant ${tenant.id}, ${error}`));
      summary.tenantsProcessed += 1;
    }

    const parts: string[] = [];
    if (summary.rowsChanged > 0) parts.push(`Status set from the end of validity: ${describeChanges(summary.changed)}`);
    if (summary.skipped.length > 0) parts.push(`Skipped on a row lock, retried next run: ${summary.skipped.join(', ')}`);
    if (summary.errors.length > 0) parts.push(`${summary.errors.length} failure(s): ${summary.errors.join(' | ')}`);
    if (parts.length > 0) {
      const line = `[${LIFECYCLE_STATUS_SYNC_TASK_NAME}] ${parts.join('. ')}`;
      if (summary.skipped.length > 0 || summary.errors.length > 0) this.logger.warn(line);
      else this.logger.log(line);
    }
    return summary;
  }
}
