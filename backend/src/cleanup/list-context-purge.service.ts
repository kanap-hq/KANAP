import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { withSavepoint } from '../common/savepoint.util';
import { withTenant } from '../common/tenant-runner';
import { LIST_CONTEXT_RETENTION_DAYS } from '../common/list-context/list-context';
import { purgeListContexts } from '../common/list-context/list-contexts.service';

export const LIST_CONTEXT_PURGE_TASK_NAME = 'list-context-purge';

export type ListContextPurgeSummary = { tenantsProcessed: number; purged: number; errors: string[] };

/**
 * Daily: deletes the saved list states (`list_contexts`) nobody used for 90
 * days. A link still holding such an id then asks the user to set the filters
 * again. One short transaction per tenant, under its row-level security; same
 * behaviour in both deployment modes.
 */
@Injectable()
export class ListContextPurgeService implements OnModuleInit {
  private readonly logger = new Logger(ListContextPurgeService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: LIST_CONTEXT_PURGE_TASK_NAME,
      description: `Deletes the saved list filters nobody used for ${LIST_CONTEXT_RETENTION_DAYS} days`,
      defaultCron: '30 3 * * *',
      handler: () => this.run(),
    });
  }

  /** Every tenant. `manager`: the caller's transaction instead (specs), one savepoint per tenant. */
  async run(opts?: { manager?: EntityManager; days?: number }): Promise<ListContextPurgeSummary> {
    const summary: ListContextPurgeSummary = { tenantsProcessed: 0, purged: 0, errors: [] };
    const days = opts?.days ?? LIST_CONTEXT_RETENTION_DAYS;
    const tenants: Array<{ id: string }> = await (opts?.manager ?? this.dataSource).query(
      `SELECT id FROM tenants WHERE deleted_at IS NULL ORDER BY id ASC`,
    );
    for (const tenant of tenants) {
      try {
        const manager = opts?.manager;
        summary.purged += manager
          ? await withSavepoint(manager, async () => {
            await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant.id]);
            return purgeListContexts(manager, tenant.id, days);
          })
          : await withTenant(this.dataSource, tenant.id, (tx) => purgeListContexts(tx, tenant.id, days));
        summary.tenantsProcessed += 1;
      } catch (error: any) {
        summary.errors.push(`Tenant ${tenant.id}: ${error?.message || String(error)}`);
      }
    }
    if (summary.purged > 0 || summary.errors.length > 0) {
      const line = `[${LIST_CONTEXT_PURGE_TASK_NAME}] ${summary.purged} saved list state(s) purged`
        + (summary.errors.length ? `; ${summary.errors.length} failure(s): ${summary.errors.join(' | ')}` : '');
      if (summary.errors.length) this.logger.warn(line);
      else this.logger.log(line);
    }
    return summary;
  }
}
