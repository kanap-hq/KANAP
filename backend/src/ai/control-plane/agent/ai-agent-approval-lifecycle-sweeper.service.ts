import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ScheduledTasksService } from '../../../admin/scheduled-tasks/scheduled-tasks.service';
import { withTenantExecution } from '../../../common/tenant-runner';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiActionRequestService, agentActionWhere } from '../action-request/ai-action-request.service';
import { AiAgentControlService } from '../agent-control/ai-agent-control.service';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiAgentWorkQueueService } from './ai-agent-work-queue.service';
import { StripeConfigService } from '../../../billing/stripe/stripe.config';
import { Subscription } from '../../../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../../../billing/subscription-freeze.util';
import { isRecord } from '../../../common/object-guards';

const APPROVED_ACTION_EXECUTING_STATUS = 'executing';
const QUEUED_EXECUTION_MAX_ATTEMPTS = 5;
const QUEUED_EXECUTION_STALE_CLAIM_MS = 10 * 60 * 1000;
const QUEUED_EXECUTION_BACKOFF_MINUTES = [30, 60, 120, 240];

export type AgentApprovalLifecycleSweepSummary = {
  tenantId: string;
  expiredActions: number;
  claimsScanned: number;
  claimsReleased: number;
  claimActionsExpired: number;
  waitingApprovalScanned: number;
  waitingApprovalResolved: number;
  queuedExecutionsScanned: number;
  queuedExecutionsExecuted: number;
  queuedExecutionsNeedsReview: number;
  errors: string[];
};

function expiredAt(value: unknown, now: Date): boolean {
  if (!value) {
    return false;
  }
  const time = value instanceof Date ? value.getTime() : Date.parse(String(value));
  return Number.isFinite(time) && time <= now.getTime();
}

function actionAgentDefinitionId(action: AiActionRequest): string | null {
  const metadata = action.metadata_json;
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return null;
  }
  const value = (metadata as Record<string, unknown>).agent_definition_id;
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function metadataObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function numberFromMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function approvedBatchContext(action: AiActionRequest): Record<string, unknown> {
  const metadata = metadataObject(action.metadata_json);
  return metadataObject(metadata.approved_batch_context);
}

function withApprovedBatchContext(
  metadata: unknown,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const existing = metadataObject(metadata);
  const batch = metadataObject(existing.approved_batch_context);
  return {
    ...existing,
    approved_batch_context: {
      ...batch,
      ...patch,
    },
  };
}

function executionAttempts(action: AiActionRequest): number {
  return numberFromMetadata(approvedBatchContext(action).execution_attempts);
}

function dateFromMetadata(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

function lastExecutionAttemptAt(action: AiActionRequest): Date | null {
  return dateFromMetadata(approvedBatchContext(action).last_attempt_at);
}

function executionClaimedAt(action: AiActionRequest): Date | null {
  return dateFromMetadata(approvedBatchContext(action).execution_claimed_at)
    ?? dateFromMetadata(action.updated_at);
}

function queuedExecutionBackoffMs(attempts: number): number {
  if (attempts <= 0) {
    return 0;
  }
  const minutes = QUEUED_EXECUTION_BACKOFF_MINUTES[Math.min(attempts, QUEUED_EXECUTION_BACKOFF_MINUTES.length) - 1];
  return minutes * 60 * 1000;
}

function queuedExecutionBackoffActive(action: AiActionRequest, now: Date): boolean {
  const attempts = executionAttempts(action);
  const lastAttemptAt = lastExecutionAttemptAt(action);
  if (attempts <= 0 || !lastAttemptAt) {
    return false;
  }
  return lastAttemptAt.getTime() + queuedExecutionBackoffMs(attempts) > now.getTime();
}

function staleExecutingClaim(action: AiActionRequest, now: Date): boolean {
  if (action.status !== APPROVED_ACTION_EXECUTING_STATUS) {
    return false;
  }
  const claimedAt = executionClaimedAt(action);
  return !!claimedAt && claimedAt.getTime() + QUEUED_EXECUTION_STALE_CLAIM_MS <= now.getTime();
}

function queuedExecutionBatch(action: AiActionRequest): { batchId: string; actionRequestIds: string[] } | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const batch = isRecord(metadata?.approved_batch_context) ? metadata.approved_batch_context : null;
  if (!batch || batch.execution_queued !== true) {
    return null;
  }
  const ids = Array.isArray(batch.action_request_ids)
    ? batch.action_request_ids
      .map((id) => typeof id === 'string' ? id.trim() : '')
      .filter((id): id is string => id.length > 0)
    : [];
  const batchId = typeof batch.batch_id === 'string' && batch.batch_id.trim().length > 0
    ? batch.batch_id.trim()
    : action.id;
  return {
    batchId,
    actionRequestIds: ids.length > 0 ? Array.from(new Set(ids)).slice(0, 20) : [action.id],
  };
}

@Injectable()
export class AiAgentApprovalLifecycleSweeperService implements OnModuleInit {
  private readonly logger = new Logger(AiAgentApprovalLifecycleSweeperService.name);

  constructor(
    @Optional() private readonly dataSource: DataSource | null,
    @Optional() private readonly scheduledTasks: ScheduledTasksService | null,
    private readonly queue: AiAgentWorkQueueService,
    private readonly actions: AiActionRequestService,
    @Optional() private readonly control: AiAgentControlService | null = null,
    @Optional() private readonly stripeConfig: StripeConfigService | null = null,
  ) {}

  /**
   * True when the tenant's subscription is frozen/trial-expired and must not have
   * queued approved actions executed (they produce external side-effects and burn
   * quota). No-op when billing isn't configured or the manager can't load a repo.
   */
  private async subscriptionBarsExecution(context: AiExecutionContextWithManager): Promise<boolean> {
    if (!this.stripeConfig?.isConfigured()) return false;
    const manager = context.manager as { getRepository?: (entity: unknown) => any };
    if (typeof manager.getRepository !== 'function') return false;
    const subscription = await manager
      .getRepository(Subscription)
      .findOne({ where: { tenant_id: context.tenantId }, order: { created_at: 'DESC' } });
    return !evaluateSubscriptionAccess(subscription, Date.now(), true).allowed;
  }

  onModuleInit() {
    if (!this.scheduledTasks) {
      return;
    }
    this.scheduledTasks.register({
      name: 'ai-agent-approval-lifecycle-sweeper',
      description: 'Expires lapsed agent proposals, reconciles service-desk target claims, and resumes queued approved executions',
      defaultCron: '*/10 * * * *',
      handler: () => this.run(),
    });
  }

  async run(opts: { manager?: EntityManager; limit?: number; now?: Date } = {}) {
    const summary = {
      tenantsProcessed: 0,
      expiredActions: 0,
      claimsReleased: 0,
      waitingApprovalResolved: 0,
      queuedExecutionsExecuted: 0,
      queuedExecutionsNeedsReview: 0,
      errors: [] as string[],
    };
    if (!this.dataSource && !opts.manager) {
      summary.errors.push('No data source is available for lifecycle sweeping.');
      return summary;
    }
    const tenants: Array<{ id: string }> = opts.manager
      ? await opts.manager.query('SELECT id FROM tenants ORDER BY id ASC')
      : await this.dataSource!.query('SELECT id FROM tenants ORDER BY id ASC');
    for (const tenant of tenants) {
      try {
        const result = opts.manager
          ? await this.sweepTenant({
            tenantId: tenant.id,
            userId: '',
            isPlatformHost: false,
            surface: 'chat',
            authMethod: 'jwt',
            manager: opts.manager,
          } as AiExecutionContextWithManager, { limit: opts.limit, now: opts.now })
          : await withTenantExecution(this.dataSource!, tenant.id, (manager) =>
            this.sweepTenant({
              tenantId: tenant.id,
              userId: '',
              isPlatformHost: false,
              surface: 'chat',
              authMethod: 'jwt',
              manager,
            } as AiExecutionContextWithManager, { limit: opts.limit, now: opts.now }),
          );
        summary.tenantsProcessed += 1;
        summary.expiredActions += result.expiredActions;
        summary.claimsReleased += result.claimsReleased;
        summary.waitingApprovalResolved += result.waitingApprovalResolved;
        summary.queuedExecutionsExecuted += result.queuedExecutionsExecuted;
        summary.queuedExecutionsNeedsReview += result.queuedExecutionsNeedsReview;
        summary.errors.push(...result.errors.map((entry) => `Tenant ${tenant.id}: ${entry}`));
      } catch (error) {
        summary.errors.push(`Tenant ${tenant.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    this.logger.log(
      `[ai-agent-approval-lifecycle-sweeper] Done: ${summary.tenantsProcessed} tenants, ${summary.expiredActions} expired, ${summary.claimsReleased} claims released, ${summary.waitingApprovalResolved} waiting approvals resolved, ${summary.queuedExecutionsExecuted} queued executions completed`,
    );
    return summary;
  }

  async sweepTenant(
    context: AiExecutionContextWithManager,
    opts: { limit?: number; now?: Date } = {},
  ): Promise<AgentApprovalLifecycleSweepSummary> {
    const now = opts.now ?? new Date();
    const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? 100), 500));
    const summary: AgentApprovalLifecycleSweepSummary = {
      tenantId: context.tenantId,
      expiredActions: 0,
      claimsScanned: 0,
      claimsReleased: 0,
      claimActionsExpired: 0,
      waitingApprovalScanned: 0,
      waitingApprovalResolved: 0,
      queuedExecutionsScanned: 0,
      queuedExecutionsExecuted: 0,
      queuedExecutionsNeedsReview: 0,
      errors: [],
    };
    const tenantPause = await this.queue.hasActiveEmergencyPause(context, null);
    if (tenantPause) {
      return summary;
    }
    const actionRepo = context.manager.getRepository(AiActionRequest);
    const reviewable = await actionRepo.find({
      where: {
        tenant_id: context.tenantId,
        status: In(['pending', 'approved']),
      },
      order: { expires_at: 'ASC' },
      take: limit,
    });
    const expiredCandidates = reviewable.filter((candidate) => expiredAt(candidate.expires_at, now));
    const blockedAgentDefinitionIds = await this.queue.lifecycleBlockedAgentDefinitionIds(
      context,
      expiredCandidates.map((action) => actionAgentDefinitionId(action)).filter((id): id is string => !!id),
      { now },
    );
    for (const action of expiredCandidates) {
      const agentDefinitionId = actionAgentDefinitionId(action);
      if (agentDefinitionId && blockedAgentDefinitionIds.has(agentDefinitionId)) {
        continue;
      }
      try {
        await this.actions.markExpired(
          context,
          action,
          action.status === 'approved'
            ? 'Approved action request expired before execution.'
            : 'Action request expired before review.',
        );
        summary.expiredActions += 1;
      } catch (error) {
        summary.errors.push(`Action ${action.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    try {
      const claims = await this.queue.reconcileTargetClaims(context, { limit, now });
      summary.claimsScanned = claims.scanned;
      summary.claimsReleased = claims.released;
      summary.claimActionsExpired = claims.expiredActions;
    } catch (error) {
      summary.errors.push(`Claims: ${error instanceof Error ? error.message : String(error)}`);
    }

    try {
      const waitingApproval = await this.queue.reconcileWaitingApprovalWorkItems(context, { limit });
      summary.waitingApprovalScanned = waitingApproval.scanned;
      summary.waitingApprovalResolved = waitingApproval.resolved;
    } catch (error) {
      summary.errors.push(`Waiting approval: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Housekeeping above (expiring lapsed proposals, releasing stale claims) is
    // harmless and still runs for frozen tenants; executing queued approved
    // actions is not — it produces external side-effects and burns quota, so a
    // frozen / trial-expired subscription bars it.
    try {
      if (await this.subscriptionBarsExecution(context)) {
        summary.errors.push('Queued executions: subscription frozen/expired; approved actions are held until it is resolved.');
      } else {
        const queuedExecutions = await this.executeQueuedApprovedActions(context, { limit, now });
        summary.queuedExecutionsScanned = queuedExecutions.scanned;
        summary.queuedExecutionsExecuted = queuedExecutions.executed;
        summary.queuedExecutionsNeedsReview = queuedExecutions.needsReview;
      }
    } catch (error) {
      summary.errors.push(`Queued executions: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (
      summary.expiredActions > 0
      || summary.claimsReleased > 0
      || summary.claimActionsExpired > 0
      || summary.waitingApprovalResolved > 0
      || summary.queuedExecutionsExecuted > 0
      || summary.queuedExecutionsNeedsReview > 0
    ) {
      await this.queue.recordAuditEvent(context, {
        eventType: 'approval_lifecycle_swept',
        severity: summary.errors.length > 0 ? 'warning' : 'info',
        message: 'Agent approval lifecycle sweeper expired lapsed proposals, reconciled claims, resolved completed approval waits, and resumed queued executions.',
        metadata: {
          expired_actions: summary.expiredActions,
          claims_scanned: summary.claimsScanned,
          claims_released: summary.claimsReleased,
          claim_actions_expired: summary.claimActionsExpired,
          waiting_approval_scanned: summary.waitingApprovalScanned,
          waiting_approval_resolved: summary.waitingApprovalResolved,
          queued_executions_scanned: summary.queuedExecutionsScanned,
          queued_executions_executed: summary.queuedExecutionsExecuted,
          queued_executions_needs_review: summary.queuedExecutionsNeedsReview,
          errors: summary.errors,
        },
      });
    }
    return summary;
  }

  private async executeQueuedApprovedActions(
    context: AiExecutionContextWithManager,
    opts: { limit: number; now: Date },
  ): Promise<{ scanned: number; executed: number; needsReview: number }> {
    if (!this.control) {
      return { scanned: 0, executed: 0, needsReview: 0 };
    }
    const now = opts.now;
    const repo = context.manager.getRepository(AiActionRequest);
    // Queued executions are the agents' own: a conversation preview runs from its conversation.
    const candidates = await context.manager.getRepository(AiActionRequest).find({
      where: {
        tenant_id: context.tenantId,
        status: In(['approved', APPROVED_ACTION_EXECUTING_STATUS]),
        ...agentActionWhere(),
      },
      order: { updated_at: 'ASC', created_at: 'ASC' },
      take: Math.max(opts.limit, Math.min(opts.limit * 5, 500)),
    });
    let needsReview = 0;
    for (const candidate of candidates) {
      if (candidate.status !== APPROVED_ACTION_EXECUTING_STATUS) {
        continue;
      }
      if (!staleExecutingClaim(candidate, now)) {
        continue;
      }
      candidate.status = 'approved';
      candidate.error_message = 'Queued execution claim was abandoned before completion.';
      candidate.metadata_json = withApprovedBatchContext(candidate.metadata_json, {
        execution_attempts: executionAttempts(candidate) + 1,
        last_attempt_at: now.toISOString(),
        last_execution_error: candidate.error_message,
        execution_claim_id: null,
        execution_claimed_at: null,
      });
      candidate.updated_at = now;
      if (executionAttempts(candidate) >= QUEUED_EXECUTION_MAX_ATTEMPTS) {
        await this.deadLetterQueuedExecution(context, candidate, executionAttempts(candidate), now);
        needsReview += 1;
      } else {
        await repo.save(candidate);
      }
    }

    const batches = new Map<string, string[]>();
    for (const candidate of candidates) {
      if (candidate.status !== 'approved') {
        continue;
      }
      if (executionAttempts(candidate) >= QUEUED_EXECUTION_MAX_ATTEMPTS) {
        await this.deadLetterQueuedExecution(context, candidate, executionAttempts(candidate), now);
        needsReview += 1;
        continue;
      }
      if (queuedExecutionBackoffActive(candidate, now)) {
        continue;
      }
      const batch = queuedExecutionBatch(candidate);
      if (!batch || batches.has(batch.batchId)) {
        continue;
      }
      batches.set(batch.batchId, batch.actionRequestIds);
      if (batches.size >= opts.limit) {
        break;
      }
    }

    const batchActionIds = Array.from(new Set(Array.from(batches.values()).flat()));
    const batchActions = batchActionIds.length > 0
      ? await repo.find({
        where: {
          tenant_id: context.tenantId,
          id: In(batchActionIds),
        },
      })
      : [];
    const actionById = new Map(batchActions.map((action) => [action.id, action]));
    // A paused agent's queued executions are frozen, not attempted: letting them
    // reach the dispatcher's pause gate would burn retry attempts and dead-letter
    // approved work during an incident pause.
    const pausedAgentIds = new Map<string, boolean>();
    let executed = 0;
    for (const actionRequestIds of batches.values()) {
      const batchActionsForIds = actionRequestIds
        .map((id) => actionById.get(id))
        .filter((action): action is AiActionRequest => !!action);
      const hasQueuedApprovedAction = batchActionsForIds.some((action) => action.status === 'approved');
      if (!hasQueuedApprovedAction) {
        continue;
      }
      const blocked = batchActionsForIds.some((action) => {
        if (action.status === APPROVED_ACTION_EXECUTING_STATUS) {
          return true;
        }
        return action.status === 'approved'
          && (executionAttempts(action) >= QUEUED_EXECUTION_MAX_ATTEMPTS || queuedExecutionBackoffActive(action, now));
      });
      if (blocked) {
        continue;
      }
      let agentPaused = false;
      for (const action of batchActionsForIds) {
        const agentDefinitionId = actionAgentDefinitionId(action);
        if (!agentDefinitionId) continue;
        if (!pausedAgentIds.has(agentDefinitionId)) {
          pausedAgentIds.set(agentDefinitionId, !!(await this.queue.hasActiveEmergencyPause(context, agentDefinitionId)));
        }
        if (pausedAgentIds.get(agentDefinitionId)) {
          agentPaused = true;
          break;
        }
      }
      if (agentPaused) {
        continue;
      }
      const result = await this.control.executeApprovedActionRequestsBulk(context, { action_request_ids: actionRequestIds });
      executed += result.summary.executed;
      needsReview += result.summary.needs_review;
    }
    return {
      scanned: candidates.length,
      executed,
      needsReview,
    };
  }

  private async deadLetterQueuedExecution(
    context: AiExecutionContextWithManager,
    action: AiActionRequest,
    attempts: number,
    now: Date,
  ): Promise<void> {
    if (action.status === 'expired') {
      return;
    }
    action.metadata_json = withApprovedBatchContext(action.metadata_json, {
      execution_attempts: attempts,
      last_attempt_at: now.toISOString(),
      last_execution_error: approvedBatchContext(action).last_execution_error ?? 'Queued execution retry limit reached.',
      execution_claim_id: null,
      execution_claimed_at: null,
      dead_lettered_at: now.toISOString(),
      dead_letter_reason: 'queued_execution_dead_letter',
    });
    action.updated_at = now;
    await this.actions.markExpired(context, action, 'queued_execution_dead_letter');
    await this.queue.recordAuditEvent(context, {
      agentDefinitionId: actionAgentDefinitionId(action),
      eventType: 'queued_execution_dead_letter',
      severity: 'error',
      message: 'Queued approved action execution reached the retry limit and was expired.',
      metadata: {
        action_request_id: action.id,
        execution_attempts: attempts,
        reason: 'queued_execution_dead_letter',
      },
    });
  }
}
