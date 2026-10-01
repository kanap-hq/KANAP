import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { ScheduledTasksService } from '../../../admin/scheduled-tasks/scheduled-tasks.service';
import { withTenantExecution } from '../../../common/tenant-runner';
import {
  activityRetentionDaysForDefinition,
  retentionCutoff,
  runIdsSafeToPurge,
  TERMINAL_ACTION_STATUSES,
} from './ai-agent-activity-retention';

export const AI_AGENT_ACTIVITY_RETENTION_TASK_NAME = 'ai-agent-activity-retention-purge';

/** Rows deleted per statement. Keeps every delete short and lock-friendly. */
const PURGE_BATCH_SIZE = 500;
/** Hard stop per table and per agent, so one runaway tenant can't hold the cron. */
const PURGE_MAX_BATCHES = 200;

export type ActivityRetentionPurgeCounts = {
  auditEvents: number;
  actions: number;
  runs: number;
  runsKept: number;
};

export type ActivityRetentionPurgeSummary = ActivityRetentionPurgeCounts & {
  tenantsProcessed: number;
  agentsProcessed: number;
  errors: string[];
};

type QueryableManager = Pick<EntityManager, 'query'>;

function emptyCounts(): ActivityRetentionPurgeCounts {
  return { auditEvents: 0, actions: 0, runs: 0, runsKept: 0 };
}

function addCounts(target: ActivityRetentionPurgeCounts, source: ActivityRetentionPurgeCounts): void {
  target.auditEvents += source.auditEvents;
  target.actions += source.actions;
  target.runs += source.runs;
  target.runsKept += source.runsKept;
}

/**
 * Daily purge of agent activity history older than each agent's configured
 * retention (see `ai-agent-activity-retention.ts` for the setting itself).
 *
 * Scope, deliberately narrow — an agent's own timeline, nothing else:
 *   - `ai_agent_audit_events` of the agent, older than the cutoff;
 *   - `ai_action_requests` of the agent, older than the cutoff, and only in a
 *     terminal status (executed / rejected / dismissed / expired / failed /
 *     provider_error). Pending and approved-not-yet-executed proposals stay;
 *   - `ai_runs` of the agent, older than the cutoff, except any run still
 *     referenced by a non-terminal action request.
 *
 * Everything else follows the schema's own FKs: run steps and tool executions
 * cascade with the run, approvals cascade with the action request, evidence /
 * observations / recommendations / decisions / evaluations keep their rows with
 * a nulled link. Work items, target states and the definitions themselves are
 * never touched.
 *
 * Every statement is tenant-scoped in SQL on top of running inside
 * `withTenantExecution` (RLS), selects a bounded batch of ids, then deletes by
 * id — no N+1, no unbounded delete.
 */
@Injectable()
export class AiAgentActivityRetentionService implements OnModuleInit {
  private readonly logger = new Logger(AiAgentActivityRetentionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
  ) {}

  onModuleInit() {
    this.scheduledTasks.register({
      name: AI_AGENT_ACTIVITY_RETENTION_TASK_NAME,
      description: 'Deletes agent activity history older than each agent\'s configured retention',
      defaultCron: '25 3 * * *',
      handler: () => this.run() as unknown as Promise<Record<string, any>>,
    });
  }

  async run(opts?: { manager?: EntityManager; now?: Date }): Promise<ActivityRetentionPurgeSummary> {
    const now = opts?.now ?? new Date();
    const summary: ActivityRetentionPurgeSummary = {
      ...emptyCounts(),
      tenantsProcessed: 0,
      agentsProcessed: 0,
      errors: [],
    };
    const tenants: Array<{ id: string }> = opts?.manager
      ? await opts.manager.query('SELECT id FROM tenants ORDER BY id ASC')
      : await this.dataSource.query('SELECT id FROM tenants ORDER BY id ASC');

    for (const tenant of tenants) {
      try {
        const result = opts?.manager
          ? await this.purgeTenant(opts.manager, tenant.id, now)
          : await withTenantExecution(this.dataSource, tenant.id, (manager) => this.purgeTenant(manager, tenant.id, now));
        addCounts(summary, result.counts);
        summary.agentsProcessed += result.agentsProcessed;
        summary.tenantsProcessed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push(`${tenant.id}: ${message}`);
        this.logger.warn(`[${AI_AGENT_ACTIVITY_RETENTION_TASK_NAME}] tenant ${tenant.id} failed: ${message}`);
      }
    }
    this.logger.log(
      `[${AI_AGENT_ACTIVITY_RETENTION_TASK_NAME}] Done: ${summary.tenantsProcessed} tenants, `
      + `${summary.auditEvents} events, ${summary.actions} proposals, ${summary.runs} runs deleted `
      + `(${summary.runsKept} runs kept for open proposals)`,
    );
    return summary;
  }

  async purgeTenant(
    manager: QueryableManager,
    tenantId: string,
    now: Date,
  ): Promise<{ counts: ActivityRetentionPurgeCounts; agentsProcessed: number }> {
    const definitions: Array<{ id: string; queue_policy_json: Record<string, unknown> | null }> = await manager.query(
      'SELECT id, queue_policy_json FROM ai_agent_definitions WHERE tenant_id = $1 ORDER BY id ASC',
      [tenantId],
    );
    const counts = emptyCounts();
    for (const definition of definitions) {
      const days = activityRetentionDaysForDefinition(definition);
      addCounts(counts, await this.purgeAgentDefinition(manager, tenantId, definition.id, days, now));
    }
    return { counts, agentsProcessed: definitions.length };
  }

  async purgeAgentDefinition(
    manager: QueryableManager,
    tenantId: string,
    agentDefinitionId: string,
    retentionDays: number,
    now: Date,
  ): Promise<ActivityRetentionPurgeCounts> {
    const cutoff = retentionCutoff(now, retentionDays);
    const counts = emptyCounts();
    counts.auditEvents = await this.purgeAuditEvents(manager, tenantId, agentDefinitionId, cutoff);
    // Order does not decide which runs are purgeable: runIdsSafeToPurge only
    // holds a run back for a non-terminal proposal.
    counts.actions = await this.purgeTerminalActions(manager, tenantId, agentDefinitionId, cutoff);
    const runs = await this.purgeRuns(manager, tenantId, agentDefinitionId, cutoff);
    counts.runs = runs.deleted;
    counts.runsKept = runs.kept;
    return counts;
  }

  private async purgeAuditEvents(
    manager: QueryableManager,
    tenantId: string,
    agentDefinitionId: string,
    cutoff: Date,
  ): Promise<number> {
    let deleted = 0;
    for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT id FROM ai_agent_audit_events
          WHERE tenant_id = $1 AND agent_definition_id = $2 AND created_at < $3
          ORDER BY created_at ASC
          LIMIT $4`,
        [tenantId, agentDefinitionId, cutoff.toISOString(), PURGE_BATCH_SIZE],
      );
      if (rows.length === 0) break;
      await manager.query(
        'DELETE FROM ai_agent_audit_events WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, rows.map((row) => row.id)],
      );
      deleted += rows.length;
      if (rows.length < PURGE_BATCH_SIZE) break;
    }
    return deleted;
  }

  private async purgeTerminalActions(
    manager: QueryableManager,
    tenantId: string,
    agentDefinitionId: string,
    cutoff: Date,
  ): Promise<number> {
    let deleted = 0;
    for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT id FROM ai_action_requests
          WHERE tenant_id = $1
            AND metadata_json ->> 'agent_definition_id' = $2
            AND created_at < $3
            AND status = ANY($4::text[])
          ORDER BY created_at ASC
          LIMIT $5`,
        [tenantId, agentDefinitionId, cutoff.toISOString(), [...TERMINAL_ACTION_STATUSES], PURGE_BATCH_SIZE],
      );
      if (rows.length === 0) break;
      const actionIds = rows.map((row) => row.id);
      // A tool execution reaches its proposal twice: action_request_id directly,
      // approval_id through the approval that CASCADEs with it, both SET NULL.
      // Unlink the second path first so the DELETE does not depend on the order
      // PostgreSQL fires the FK triggers (trigger-name order, which differs
      // between a migrated and a pg_restore'd database).
      await manager.query(
        `UPDATE ai_tool_executions SET approval_id = NULL
          WHERE tenant_id = $1
            AND approval_id IN (SELECT id FROM ai_approvals WHERE tenant_id = $1 AND action_request_id = ANY($2::uuid[]))`,
        [tenantId, actionIds],
      );
      await manager.query(
        'DELETE FROM ai_action_requests WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
        [tenantId, actionIds],
      );
      deleted += rows.length;
      if (rows.length < PURGE_BATCH_SIZE) break;
    }
    return deleted;
  }

  private async purgeRuns(
    manager: QueryableManager,
    tenantId: string,
    agentDefinitionId: string,
    cutoff: Date,
  ): Promise<{ deleted: number; kept: number }> {
    let deleted = 0;
    let kept = 0;
    // Runs held back by an open proposal stay at the head of the ordering, so
    // the offset advances past them instead of re-reading them forever.
    let offset = 0;
    for (let batch = 0; batch < PURGE_MAX_BATCHES; batch += 1) {
      const rows: Array<{ id: string }> = await manager.query(
        `SELECT id FROM ai_runs
          WHERE tenant_id = $1
            AND metadata_json ->> 'agent_definition_id' = $2
            AND created_at < $3
          ORDER BY created_at ASC
          LIMIT $4 OFFSET $5`,
        [tenantId, agentDefinitionId, cutoff.toISOString(), PURGE_BATCH_SIZE, offset],
      );
      if (rows.length === 0) break;
      const candidateIds = rows.map((row) => row.id);
      const references: Array<{ run_id: string | null; status: string | null }> = await manager.query(
        `SELECT run_id, status FROM ai_action_requests
          WHERE tenant_id = $1 AND run_id = ANY($2::uuid[])`,
        [tenantId, candidateIds],
      );
      const purgeable = runIdsSafeToPurge(candidateIds, references);
      if (purgeable.length > 0) {
        // Evidence and action requests reach a run twice: run_id directly and
        // tool_execution_id through the tool executions that CASCADE with it,
        // both SET NULL. On a pg_restore'd database the run_id action fires
        // first and re-checks tool_execution_id against a row the same DELETE
        // removed (the evidence row is rewritten earlier in this transaction
        // when its terminal proposal is purged). Unlink the second path first.
        for (const table of ['ai_evidence', 'ai_action_requests']) {
          await manager.query(
            `UPDATE ${table} SET tool_execution_id = NULL
              WHERE tenant_id = $1
                AND tool_execution_id IN (SELECT id FROM ai_tool_executions WHERE tenant_id = $1 AND run_id = ANY($2::uuid[]))`,
            [tenantId, purgeable],
          );
        }
        await manager.query(
          'DELETE FROM ai_runs WHERE tenant_id = $1 AND id = ANY($2::uuid[])',
          [tenantId, purgeable],
        );
      }
      deleted += purgeable.length;
      const blocked = candidateIds.length - purgeable.length;
      kept += blocked;
      offset += blocked;
      if (rows.length < PURGE_BATCH_SIZE) break;
    }
    return { deleted, kept };
  }
}
