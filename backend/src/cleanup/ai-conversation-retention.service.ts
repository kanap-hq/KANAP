import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../admin/scheduled-tasks/scheduled-tasks.service';
import { withTenantExecution } from '../common/tenant-runner';

const DEFAULT_PURGE_GRACE_DAYS = 30;

function resolvePurgeGraceDays(): number {
  const raw = process.env.AI_RETENTION_PURGE_GRACE_DAYS;
  if (!raw) return DEFAULT_PURGE_GRACE_DAYS;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PURGE_GRACE_DAYS;
}

function toCount(value: unknown): number {
  if (value == null) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type AiConversationRetentionSummary = {
  tenantsProcessed: number;
  archived: number;
  purged_conversations: number;
  purged_messages: number;
  errors: string[];
};

@Injectable()
export class AiConversationRetentionService implements OnModuleInit {
  private readonly logger = new Logger(AiConversationRetentionService.name);
  private readonly purgeGraceDays = resolvePurgeGraceDays();

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: 'ai-conversation-retention',
      description: 'Archives and purges AI conversations according to tenant retention settings',
      defaultCron: '0 2 * * *',
      handler: () => this.run(),
    });
  }

  async run(opts?: { manager?: EntityManager }): Promise<AiConversationRetentionSummary> {
    const summary: AiConversationRetentionSummary = {
      tenantsProcessed: 0,
      archived: 0,
      purged_conversations: 0,
      purged_messages: 0,
      errors: [],
    };

    const tenants: Array<{ id: string }> = opts?.manager
      ? await opts.manager.query(
        `
        SELECT id
        FROM tenants
        ORDER BY id ASC
        `,
      )
      : await this.dataSource.query(
        `
        SELECT id
        FROM tenants
        ORDER BY id ASC
        `,
      );

    for (const tenant of tenants) {
      try {
        const processed = opts?.manager
          ? await this.runForTenant(opts.manager, tenant.id, summary)
          : await withTenantExecution(this.dataSource, tenant.id, async (tenantManager) => {
            return this.runForTenant(tenantManager, tenant.id, summary);
          });

        if (processed) {
          summary.tenantsProcessed += 1;
        }
      } catch (error: any) {
        summary.errors.push(`Tenant ${tenant.id}: ${error?.message || String(error)}`);
      }
    }

    this.logger.log(
      `[ai-conversation-retention] Done: ${summary.tenantsProcessed} tenants, ${summary.archived} archived, ${summary.purged_conversations} purged conversations, ${summary.purged_messages} purged messages` +
        (this.purgeGraceDays ? ` (grace=${this.purgeGraceDays}d)` : ''),
    );

    return summary;
  }

  private async runForTenant(
    manager: EntityManager,
    tenantId: string,
    summary: AiConversationRetentionSummary,
  ): Promise<boolean> {
    await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    const settingsRows: Array<Record<string, unknown>> = await manager.query(
      `
      SELECT conversation_retention_days
      FROM ai_settings
      WHERE tenant_id = $1
        AND conversation_retention_days IS NOT NULL
      LIMIT 1
      `,
      [tenantId],
    );
    const retentionDays = toCount(settingsRows[0]?.conversation_retention_days);
    if (retentionDays <= 0) {
      return false;
    }

    const archivedRows: Array<{ id: string }> = await manager.query(
      `
      UPDATE ai_conversations
      SET archived_at = now()
      WHERE tenant_id = $2
        AND archived_at IS NULL
        AND updated_at < now() - ($1 * interval '1 day')
      RETURNING id
      `,
      [retentionDays, tenantId],
    );
    summary.archived += archivedRows.length;

    const purgeRows: Array<{ id: string }> = await manager.query(
      `
      SELECT id
      FROM ai_conversations
      WHERE tenant_id = $2
        AND archived_at IS NOT NULL
        AND archived_at < now() - ($1 * interval '1 day')
      ORDER BY archived_at ASC, id ASC
      `,
      [this.purgeGraceDays, tenantId],
    );

    if (purgeRows.length > 0) {
      const purgeIds = purgeRows.map((row) => row.id);
      const messageCountRows: Array<{ count: string }> = await manager.query(
        `
        SELECT COUNT(*)::bigint AS count
        FROM ai_messages
        WHERE tenant_id = $1
          AND conversation_id = ANY($2::uuid[])
        `,
        [tenantId, purgeIds],
      );

      await manager.query(
        `
        DELETE FROM ai_messages
        WHERE tenant_id = $1
          AND conversation_id = ANY($2::uuid[])
        `,
        [tenantId, purgeIds],
      );
      // An action request reaches its conversation twice: conversation_id
      // directly and preview_id through the previews that CASCADE with it, both
      // SET NULL. Unlink the second path first so the DELETE does not depend on
      // the order PostgreSQL fires the FK triggers (trigger-name order, which
      // differs between a migrated and a pg_restore'd database).
      await manager.query(
        `
        UPDATE ai_action_requests
        SET preview_id = NULL
        WHERE tenant_id = $1
          AND preview_id IN (
            SELECT id FROM ai_mutation_previews WHERE tenant_id = $1 AND conversation_id = ANY($2::uuid[])
          )
        `,
        [tenantId, purgeIds],
      );
      await manager.query(
        `
        DELETE FROM ai_conversations
        WHERE tenant_id = $1
          AND id = ANY($2::uuid[])
        `,
        [tenantId, purgeIds],
      );

      summary.purged_messages += toCount(messageCountRows[0]?.count);
      summary.purged_conversations += purgeIds.length;
    }

    return true;
  }
}
