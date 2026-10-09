import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { AUTH_EVENT_RETENTION_DAYS, AUTH_EVENT_TABLE } from '../audit/security-events';
import { withSavepoint } from '../common/savepoint.util';
import { withTenant } from '../common/tenant-runner';

export const AUTH_EVENT_RETENTION_TASK_NAME = 'auth-event-retention';

export type AuthEventRetentionSummary = { tenantsProcessed: number; purged: number; errors: string[] };

/** Deletes the tenant's sign-in and session events (`audit_log`, `table_name = 'auth'`) older than `days` days. */
export async function purgeAuthEvents(manager: EntityManager, tenantId: string, days = AUTH_EVENT_RETENTION_DAYS): Promise<number> {
  const rows: Array<{ n: number }> = await manager.query(
    `WITH gone AS (
       DELETE FROM audit_log
        WHERE tenant_id = $1 AND table_name = $2 AND created_at < now() - make_interval(days => $3::int)
       RETURNING 1
     )
     SELECT count(*)::int AS n FROM gone`,
    [tenantId, AUTH_EVENT_TABLE, days],
  );
  return Number(rows[0]?.n ?? 0);
}

/**
 * Daily: deletes the sign-in and session events (audit/security-events.ts) older than 365
 * days. The rest of the audit log is kept as it is. One short transaction per tenant, under its
 * row-level security; same behaviour in both deployment modes. A tick runs in one API process
 * only (ScheduledTasksService).
 */
@Injectable()
export class AuthEventRetentionService implements OnModuleInit {
  private readonly logger = new Logger(AuthEventRetentionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: AUTH_EVENT_RETENTION_TASK_NAME,
      description: `Deletes sign-in events older than ${AUTH_EVENT_RETENTION_DAYS} days from the audit log`,
      defaultCron: '40 3 * * *',
      handler: () => this.run(),
    });
  }

  /** Every tenant. `manager`: the caller's transaction instead (specs), one savepoint per tenant. */
  async run(opts?: { manager?: EntityManager; days?: number }): Promise<AuthEventRetentionSummary> {
    const summary: AuthEventRetentionSummary = { tenantsProcessed: 0, purged: 0, errors: [] };
    const days = opts?.days ?? AUTH_EVENT_RETENTION_DAYS;
    const tenants: Array<{ id: string }> = await (opts?.manager ?? this.dataSource).query(
      `SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id ASC`,
    );
    for (const tenant of tenants) {
      try {
        const manager = opts?.manager;
        summary.purged += manager
          ? await withSavepoint(manager, async () => {
            await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
            return purgeAuthEvents(manager, tenant.id, days);
          })
          : await withTenant(this.dataSource, tenant.id, (tx) => purgeAuthEvents(tx, tenant.id, days));
        summary.tenantsProcessed += 1;
      } catch (error: any) {
        summary.errors.push(`Tenant ${tenant.id}: ${error?.message || String(error)}`);
      }
    }
    if (summary.purged > 0 || summary.errors.length > 0) {
      const line = `[${AUTH_EVENT_RETENTION_TASK_NAME}] ${summary.purged} sign-in event(s) purged`
        + (summary.errors.length ? `; ${summary.errors.length} failure(s): ${summary.errors.join(' | ')}` : '');
      if (summary.errors.length) this.logger.warn(line);
      else this.logger.log(line);
    }
    return summary;
  }
}
