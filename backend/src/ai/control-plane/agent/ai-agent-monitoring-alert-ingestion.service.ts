import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ScheduledTasksService } from '../../../admin/scheduled-tasks/scheduled-tasks.service';
import { AiExecutionContextWithManager } from '../../ai.types';
import { withTenantExecution } from '../../../common/tenant-runner';
import { AiAgentControlService } from '../agent-control/ai-agent-control.service';
import { AiAgentBuiltinQuotaService } from './ai-agent-builtin-quota.service';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiAgentTargetState } from '../entities/ai-agent-target-state.entity';
import { AiAgentWorkItem } from '../entities/ai-agent-work-item.entity';
import { AiProviderRegistryService } from '../providers/provider-registry.service';
import { StripeConfigService } from '../../../billing/stripe/stripe.config';
import { Subscription } from '../../../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../../../billing/subscription-freeze.util';
import { MonitoringAlert } from '../providers/provider.types';
import {
  AiAgentWorkQueueService,
  failedWorkItemAttemptId,
  MONITORING_ALERT_DIAGNOSTIC_WORK_KIND,
  MonitoringIngestionConfig,
  monitoringAlertDedupKey,
  monitoringAlertTouchedForOccurrence,
} from './ai-agent-work-queue.service';
import {
  alertMatchesMonitoringTargeting,
  deriveMonitoringTargetingFetchConfig,
} from './monitoring-targeting';
import { requireMonitoringBinding } from './provider-binding';
import {
  checkIntervalMinutesForDefinition,
  scheduledCheckDue,
} from './ai-agent-check-interval';
import { isRecord } from '../../../common/object-guards';
import { codedForbidden } from '../../../auth/module-right-required';

export type MonitoringAlertIngestionPollSummary = {
  tenantId: string;
  agentDefinitionId?: string | null;
  agentKey?: string | null;
  status: 'disabled' | 'paused' | 'completed' | 'failed' | 'skipped';
  reason?: string | null;
  listed: number;
  enqueued: number;
  deduped: number;
  processed: number;
  errors: string[];
  agents?: MonitoringAlertIngestionPollSummary[];
};

export type MonitoringAlertIngestionRunSummary = {
  tenantsProcessed: number;
  tenantsSkipped: number;
  alertsListed: number;
  alertsEnqueued: number;
  alertsProcessed: number;
  errors: string[];
};

function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function workItemReady(item: AiAgentWorkItem, now: Date): boolean {
  if (!item.next_attempt_at) {
    return true;
  }
  const nextAttempt = item.next_attempt_at instanceof Date ? item.next_attempt_at : new Date(item.next_attempt_at);
  return !Number.isFinite(nextAttempt.getTime()) || nextAttempt.getTime() <= now.getTime();
}

const SCHEDULED_POLL_BACKOFF_BASE_MINUTES = 5;
const SCHEDULED_POLL_BACKOFF_MAX_MINUTES = 360;
const DEFAULT_MONITORING_PROCESS_BUDGET_MS = 210_000;
export const SRE_MONITORING_ALERT_INGESTION_TASK_NAME = 'ai-sre-monitoring-alert-ingestion';
// Distinct advisory-lock namespace from the helpdesk poller so the two
// ingestion families never serialize against each other on the same tenant.
const SRE_MONITORING_ALERT_INGESTION_LOCK_PREFIX = 'ai-sre-monitoring-ingestion';

// `manual` marks an operator-triggered "Check for alerts" (as opposed to the
// cron tick). It bypasses the failed-cycle backoff and lets an agent in Manual
// run mode — turned on, but not watching — run one cycle on demand. Off agents
// are still excluded upstream by the status filter in loadDefinitions.
type MonitoringAlertPollOptions = { manual: boolean };

type MonitoringDefinitionPollState = {
  definition: AiAgentDefinition;
  summary: MonitoringAlertIngestionPollSummary;
  config: MonitoringIngestionConfig | null;
  finalizeCycle: boolean;
  // Not due for a scheduled check yet: no detection this tick, but any work
  // already queued is still drained (see detectDefinition).
  detectionSkipped?: boolean;
};

function parsePositiveIntEnv(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function ingestionState(definition: AiAgentDefinition): Record<string, unknown> | null {
  const metadata = definition.metadata_json;
  return isRecord(metadata) && isRecord(metadata.monitoring_ingestion_state)
    ? metadata.monitoring_ingestion_state
    : null;
}

function failureStreak(definition: AiAgentDefinition): number {
  const state = ingestionState(definition);
  const streak = state?.failure_streak;
  return typeof streak === 'number' && Number.isFinite(streak) && streak > 0 ? Math.floor(streak) : 0;
}

function scheduledPollCooldownUntil(definition: AiAgentDefinition): number | null {
  const state = ingestionState(definition);
  if (!state || state.last_poll_status !== 'failed') {
    return null;
  }
  const lastPollMs = parseDateMs(state.last_poll_at);
  if (lastPollMs == null) {
    return null;
  }
  const streak = Math.max(failureStreak(definition), 1);
  const backoffMinutes = Math.min(
    SCHEDULED_POLL_BACKOFF_BASE_MINUTES * 2 ** (streak - 1),
    SCHEDULED_POLL_BACKOFF_MAX_MINUTES,
  );
  return lastPollMs + backoffMinutes * 60_000;
}

// Resolve the user the diagnosis should act as. A real operator context (manual
// cockpit poll) keeps its own scope; a scheduled/system context (empty userId)
// runs as the admin who configured the agent so user-scoped retrieval has a
// valid user to resolve.
function diagnosisContextForDefinition(
  context: AiExecutionContextWithManager,
  definition: AiAgentDefinition,
): AiExecutionContextWithManager {
  const currentUser = typeof context.userId === 'string' ? context.userId.trim() : '';
  if (currentUser) {
    return context;
  }
  const configuredBy = typeof definition.updated_by_user_id === 'string' ? definition.updated_by_user_id.trim() : '';
  if (!configuredBy) {
    return context;
  }
  return { ...context, userId: configuredBy };
}

@Injectable()
export class AiAgentMonitoringAlertIngestionService implements OnModuleInit {
  private readonly logger = new Logger(AiAgentMonitoringAlertIngestionService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly scheduledTasks: ScheduledTasksService,
    private readonly providers: AiProviderRegistryService,
    private readonly queue: AiAgentWorkQueueService,
    private readonly control: AiAgentControlService,
    private readonly builtinQuota?: AiAgentBuiltinQuotaService,
    private readonly stripeConfig?: StripeConfigService,
  ) {}

  /**
   * Frozen (non-payment) or trial-expired tenants must not run agents — a
   * diagnosis run consumes the built-in free-message quota, a direct operator
   * cost. Returns a skip reason when the tenant is barred, or null when it may
   * proceed. No-op when billing isn't configured (on-prem / single-tenant) or
   * in unit tests that construct the service without a Stripe config or a
   * repository-backed manager. (Own copy of the helpdesk poller pattern — the
   * helpdesk file carries concurrent in-flight edits and stays untouched.)
   */
  private async subscriptionSkipReason(context: AiExecutionContextWithManager): Promise<string | null> {
    if (!this.stripeConfig?.isConfigured()) return null;
    const manager = context.manager as { getRepository?: (entity: unknown) => any };
    if (typeof manager.getRepository !== 'function') return null;
    const subscription = await manager
      .getRepository(Subscription)
      .findOne({ where: { tenant_id: context.tenantId }, order: { created_at: 'DESC' } });
    const decision = evaluateSubscriptionAccess(subscription, Date.now(), true);
    if (decision.allowed) return null;
    return decision.reason === 'TRIAL_EXPIRED'
      ? 'Subscription trial expired; agent runs are paused until a plan is chosen.'
      : 'Subscription frozen for non-payment; agent runs are paused until it is resolved.';
  }

  onModuleInit() {
    this.scheduledTasks.register({
      name: SRE_MONITORING_ALERT_INGESTION_TASK_NAME,
      description: 'Watches the connected monitoring tool for new alerts and queues them for the SRE diagnosis agent',
      defaultCron: '*/5 * * * *',
      handler: () => this.run(),
    });
  }

  async run(opts?: { manager?: EntityManager }): Promise<MonitoringAlertIngestionRunSummary> {
    const summary: MonitoringAlertIngestionRunSummary = {
      tenantsProcessed: 0,
      tenantsSkipped: 0,
      alertsListed: 0,
      alertsEnqueued: 0,
      alertsProcessed: 0,
      errors: [],
    };
    const tenants: Array<{ id: string }> = opts?.manager
      ? await opts.manager.query('SELECT id FROM tenants ORDER BY id ASC')
      : await this.dataSource.query('SELECT id FROM tenants ORDER BY id ASC');

    for (const tenant of tenants) {
      try {
        const result = opts?.manager
          ? await this.runForTenantManager(opts.manager, tenant.id, { manual: false })
          : await withTenantExecution(this.dataSource, tenant.id, (manager) =>
            this.runForTenantManager(manager, tenant.id, { manual: false }),
          );
        if (result.status === 'disabled' || result.status === 'skipped') {
          summary.tenantsSkipped += 1;
        } else {
          summary.tenantsProcessed += 1;
        }
        summary.alertsListed += result.listed;
        summary.alertsEnqueued += result.enqueued;
        summary.alertsProcessed += result.processed;
        summary.errors.push(...result.errors.map((entry) => `Tenant ${tenant.id}: ${entry}`));
      } catch (error: any) {
        summary.errors.push(`Tenant ${tenant.id}: ${error?.message || String(error)}`);
      }
    }

    this.logger.log(
      `[${SRE_MONITORING_ALERT_INGESTION_TASK_NAME}] Done: ${summary.tenantsProcessed} tenants, ${summary.alertsEnqueued} enqueued, ${summary.alertsProcessed} processed`,
    );
    return summary;
  }

  async pollTenant(context: AiExecutionContextWithManager): Promise<MonitoringAlertIngestionPollSummary> {
    return this.pollTenantContext(context, { manual: true });
  }

  private async runForTenantManager(
    manager: EntityManager,
    tenantId: string,
    opts: MonitoringAlertPollOptions,
  ): Promise<MonitoringAlertIngestionPollSummary> {
    await manager.query('SELECT set_config(\'app.current_tenant\', $1, true)', [tenantId]);
    return this.pollTenantContext({
      tenantId,
      userId: '',
      isPlatformHost: false,
      surface: 'chat',
      authMethod: 'jwt',
      manager,
    } as AiExecutionContextWithManager, opts);
  }

  private async pollTenantContext(
    context: AiExecutionContextWithManager,
    opts: MonitoringAlertPollOptions,
  ): Promise<MonitoringAlertIngestionPollSummary> {
    const processingDeadlineMs = Date.now() + parsePositiveIntEnv(
      process.env.AI_AGENT_MONITORING_PROCESS_BUDGET_MS,
      DEFAULT_MONITORING_PROCESS_BUDGET_MS,
    );
    const summary: MonitoringAlertIngestionPollSummary = {
      tenantId: context.tenantId,
      status: 'completed',
      listed: 0,
      enqueued: 0,
      deduped: 0,
      processed: 0,
      errors: [],
    };
    // Frozen / trial-expired tenants get no agent runs (they would burn the
    // built-in free-message quota, a direct operator cost). Skip before any
    // provider or LLM work.
    const subscriptionSkip = await this.subscriptionSkipReason(context);
    if (subscriptionSkip) {
      summary.status = 'skipped';
      summary.reason = subscriptionSkip;
      return summary;
    }
    // Serialize polling per tenant: the scheduled cron and a manual cockpit
    // trigger (or a second backend instance) must not poll concurrently.
    // Transaction-scoped, so it releases automatically with the tenant tx.
    // In-memory test managers expose no raw query; real tenant managers do.
    const managerQuery = (context.manager as { query?: (sql: string, params?: unknown[]) => Promise<Array<{ locked: boolean }>> }).query;
    if (typeof managerQuery === 'function') {
      const lockRows = await managerQuery.call(
        context.manager,
        'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked',
        [`${SRE_MONITORING_ALERT_INGESTION_LOCK_PREFIX}:${context.tenantId}`],
      );
      if (!lockRows[0]?.locked) {
        summary.status = 'skipped';
        summary.reason = 'Another monitoring alert ingestion poll is already running for this tenant.';
        summary.errors.push(summary.reason);
        return summary;
      }
    }

    const definitions = await this.loadDefinitions(context);
    if (definitions.length === 0) {
      summary.status = 'disabled';
      summary.reason = 'No monitoring agent is turned on. Set an agent to Manual or Watching first.';
      return summary;
    }

    const pollStates: MonitoringDefinitionPollState[] = [];
    // Pass 1 is detection only and always runs for every definition before
    // inline diagnosis starts, keeping alert discovery/enqueue latency bounded
    // even when a previous definition has slow work waiting in the queue.
    for (const definition of definitions) {
      pollStates.push(await this.detectDefinition(context, definition, opts));
    }

    let processingBudgetReason: string | null = null;
    // Pass 2 processes queued diagnosis work under one shared per-cycle
    // deadline. When the deadline is reached, queued work is left for the next
    // cron tick and the cycle remains healthy because detection completed.
    for (let index = 0; index < pollStates.length; index += 1) {
      const state = pollStates[index];
      if (processingBudgetReason || !state.config || (!state.finalizeCycle && !state.detectionSkipped)) {
        continue;
      }
      try {
        const result = await this.processDefinitionReadyItems(
          context,
          state.definition,
          state.config,
          state.summary,
          processingDeadlineMs,
        );
        if (result.budgetReached) {
          const futureRemaining = await this.countReadyItemsForStates(context, pollStates.slice(index + 1));
          const remaining = result.remainingReadyItems
            + futureRemaining.reduce((sum, entry) => sum + entry.count, 0);
          processingBudgetReason = `Processing time budget reached; ${remaining} item(s) remain queued for the next cycle.`;
          if (result.remainingReadyItems > 0 && state.summary.status === 'completed') {
            state.summary.reason = processingBudgetReason;
          }
          for (const entry of futureRemaining) {
            if (entry.count > 0 && entry.state.summary.status === 'completed') {
              entry.state.summary.reason = processingBudgetReason;
            }
          }
        }
      } catch (error) {
        state.finalizeCycle = false;
        await this.failDefinitionPoll(context, state.definition, state.summary, error);
      }
    }

    for (const state of pollStates) {
      if (state.finalizeCycle) {
        await this.completeDefinitionPoll(context, state.definition, state.summary);
      }
    }

    const agentSummaries = pollStates.map((state) => state.summary);
    summary.agents = agentSummaries;
    summary.listed = agentSummaries.reduce((sum, entry) => sum + entry.listed, 0);
    summary.enqueued = agentSummaries.reduce((sum, entry) => sum + entry.enqueued, 0);
    summary.deduped = agentSummaries.reduce((sum, entry) => sum + entry.deduped, 0);
    summary.processed = agentSummaries.reduce((sum, entry) => sum + entry.processed, 0);
    summary.errors = pollStates.flatMap((state) =>
      state.summary.errors.map((entry) => `${state.definition.agent_key}: ${entry}`),
    );
    const activeSummaries = agentSummaries.filter((entry) => entry.status !== 'disabled' && entry.status !== 'skipped');
    if (activeSummaries.length === 0) {
      summary.status = agentSummaries.some((entry) => entry.status === 'skipped') ? 'skipped' : 'disabled';
      summary.reason = agentSummaries.map((entry) => entry.reason).filter(Boolean).join(' | ') || 'No SRE monitoring agent has alert watching enabled.';
    } else if (activeSummaries.some((entry) => entry.status === 'failed')) {
      summary.status = 'failed';
      summary.reason = activeSummaries.find((entry) => entry.status === 'failed')?.reason ?? null;
    } else if (activeSummaries.every((entry) => entry.status === 'paused')) {
      summary.status = 'paused';
      summary.reason = activeSummaries.map((entry) => entry.reason).filter(Boolean).join(' | ') || null;
    } else {
      summary.status = 'completed';
      summary.reason = processingBudgetReason;
    }
    return summary;
  }

  private async detectDefinition(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    opts: MonitoringAlertPollOptions,
  ): Promise<MonitoringDefinitionPollState> {
    const summary: MonitoringAlertIngestionPollSummary = {
      tenantId: context.tenantId,
      agentDefinitionId: definition.id,
      agentKey: definition.agent_key,
      status: 'completed',
      listed: 0,
      enqueued: 0,
      deduped: 0,
      processed: 0,
      errors: [],
    };
    // Unbound or misconfigured definitions are skipped with a summary reason,
    // never thrown: one broken agent must not take the tenant cycle down.
    let config: MonitoringIngestionConfig;
    try {
      this.queue.assertSreMonitoringDefinitionRunnable(definition);
      config = this.queue.resolveMonitoringScopeIngestionConfig(definition, {
        trigger: opts.manual ? 'manual' : 'scheduled',
      });
    } catch (error) {
      summary.status = 'disabled';
      summary.reason = error instanceof Error ? error.message : String(error);
      return { definition, summary, config: null, finalizeCycle: false };
    }

    // Scheduled polls back off after failed cycles (5 min doubling, capped at
    // 6 h) so a down monitoring tool is not hammered every cron tick. Manual
    // cockpit polls bypass the cooldown on purpose: an operator retry is an
    // explicit decision.
    if (!opts.manual) {
      const cooldownUntil = scheduledPollCooldownUntil(definition);
      if (cooldownUntil != null && Date.now() < cooldownUntil) {
        summary.status = 'skipped';
        summary.reason = `Scheduled polling is backing off after a failed cycle until ${new Date(cooldownUntil).toISOString()}.`;
        return { definition, summary, config: null, finalizeCycle: false };
      }
    }

    const pause = await this.queue.hasActiveEmergencyPause(context, definition.id);
    if (pause) {
      summary.status = 'paused';
      summary.reason = `An emergency pause is active: ${pause.reason}`;
      const event = await this.queue.recordAuditEvent(context, {
        agentDefinitionId: definition.id,
        eventType: 'poller_paused_by_emergency_pause',
        severity: 'warning',
        message: `Monitoring alert ingestion skipped because an emergency pause is active: ${pause.reason}`,
        metadata: { pause_id: pause.id },
      });
      await this.queue.updateMonitoringIngestionState(context, definition, {
        status: 'paused',
        reason: 'emergency_pause',
        last_poll_at: new Date().toISOString(),
        last_poll_status: 'paused',
        last_audit_event_id: event.id,
      });
      return { definition, summary, config: null, finalizeCycle: false };
    }

    try {
      await this.queue.assertDailyCapAvailable(context, definition);
    } catch (error) {
      summary.status = 'paused';
      summary.reason = error instanceof Error ? error.message : String(error);
      summary.errors.push(summary.reason);
      return { definition, summary, config: null, finalizeCycle: false };
    }

    // Placed after the pause and daily-cap guards on purpose: a not-due tick
    // still drains the queue, and must never do so past an emergency pause or
    // an exhausted daily budget.
    if (!opts.manual) {
      // Skip-until-due: the platform cron is the clock (every 5 minutes), the
      // agent's own "check every N minutes" is the schedule. A definition whose
      // interval has not elapsed since its last check is silently passed over —
      // no audit event, so the timeline stays a record of real checks.
      const intervalMinutes = checkIntervalMinutesForDefinition(definition);
      const due = scheduledCheckDue({
        lastPollAt: ingestionState(definition)?.last_poll_at,
        intervalMinutes,
        now: Date.now(),
      });
      if (!due.due) {
        summary.status = 'skipped';
        summary.reason = due.nextDueAt == null
          ? `The next check is not due yet (every ${intervalMinutes} minutes).`
          : `The next check is due at ${new Date(due.nextDueAt).toISOString()} (every ${intervalMinutes} minutes).`;
        // Detection waits, the queue does not: work enqueued by an earlier
        // cycle (or left behind by the processing budget) is still drained, so
        // a long interval never parks approved work for hours.
        return { definition, summary, config, finalizeCycle: false, detectionSkipped: true };
      }
    }

    const binding = requireMonitoringBinding(definition);
    try {
      const applicability = await this.providers.getApplicability(context, binding.providerKind, binding.providerKey);
      if (!applicability.available) {
        throw codedForbidden('AGENT_PROVIDER_UNAVAILABLE', `Monitoring provider is unavailable: ${applicability.message ?? applicability.reasonCode ?? 'not ready'}.`, { detail: applicability.message ?? applicability.reasonCode ?? 'not ready' });
      }
      const provider = await this.providers.monitoring(context, binding.providerKey);
      const maxResults = Math.min(config.maxAlertsPerCycle, config.maxProviderRequestsPerCycle);
      const scope = deriveMonitoringTargetingFetchConfig(config.targeting, { maxResults });
      const listed = await provider.listAlertsForScope(context, { scope });
      if (listed.ok === false) {
        throw new BadRequestException(listed.message);
      }
      if (!isRecord(listed.data) || !Array.isArray(listed.data.alerts)) {
        throw new BadRequestException('Alert list provider response was malformed.');
      }
      const listedAlerts: MonitoringAlert[] = listed.data.alerts;
      summary.listed = listedAlerts.length;

      // touched_by resolution source: sensors this agent already diagnosed
      // (agent_touched target states) — control-plane state, never a provider
      // query. Occurrence-scoped, not lifetime-scoped: the per-alert helper
      // only counts states whose recorded occurrence is still in progress and
      // matches the fetched alert's occurrence, so a sensor the agent handled
      // during a PAST outage becomes visible again on its next occurrence.
      const touchedStatesByRef = new Map((await context.manager.getRepository(AiAgentTargetState).find({
        where: {
          tenant_id: context.tenantId,
          agent_definition_id: definition.id,
          provider_kind: binding.providerKind,
          provider_key: binding.providerKey,
          target_type: 'sensor',
          agent_touched: true,
        },
      })).map((state) => [state.target_ref, state] as const));

      // Local re-filter is the authority over whatever the provider returned
      // for the pushed-down scope.
      const scopedAlerts = listedAlerts.filter((alert) =>
        alertMatchesMonitoringTargeting(alert, config.targeting, {
          touchedBySelf: monitoringAlertTouchedForOccurrence(
            touchedStatesByRef.get(String(alert.id ?? '').trim()),
            alert,
          ),
        }),
      );

      // The per-cycle cap bounds NEW work items, not considered alerts: a
      // deduped (already-diagnosed, still-open) occurrence must not consume a
      // slot, or alerts sorted behind it — e.g. a dead-lettered occurrence
      // waiting for its retry backoff — would starve indefinitely.
      let enqueuedThisCycle = 0;
      for (const alert of scopedAlerts) {
        if (enqueuedThisCycle >= config.maxAlertsPerCycle) {
          break;
        }
        const dedupKey = monitoringAlertDedupKey(binding.providerKey, alert.id, alert.occurrenceStartedAt);
        const readiness = await this.queue.monitoringOccurrenceReadiness(context, {
          definition,
          alert,
          dedupKey,
        });
        if (!readiness.ready) {
          summary.deduped += 1;
          continue;
        }
        const claim = await this.queue.acquireTargetClaim(context, {
          definition,
          providerKind: binding.providerKind,
          providerKey: binding.providerKey,
          targetType: 'sensor',
          targetRef: alert.id,
          metadata: {
            source: 'scheduled_poller',
            readiness_reason: readiness.reason,
            alert_occurrence_started_at: alert.occurrenceStartedAt ?? null,
          },
        });
        if (!claim.acquired) {
          summary.deduped += 1;
          continue;
        }
        const result = await this.queue.enqueueMonitoringScopedAlert(context, {
          definition,
          alert,
          dedupKey,
          trigger: opts.manual ? 'manual' : 'scheduled',
          providerKind: binding.providerKind,
          providerKey: binding.providerKey,
          metadata: {
            poller_enabled_at: config.enabledAt,
            target_readiness_reason: readiness.reason,
            target_claim_status: claim.status,
          },
        });
        await this.queue.acquireTargetClaim(context, {
          definition,
          providerKind: binding.providerKind,
          providerKey: binding.providerKey,
          targetType: 'sensor',
          targetRef: alert.id,
          workItemId: result.workItem.id,
          metadata: {
            source: 'scheduled_poller',
            work_item_id: result.workItem.id,
            target_readiness_reason: readiness.reason,
          },
        });
        if (result.created) {
          summary.enqueued += 1;
          enqueuedThisCycle += 1;
        } else {
          summary.deduped += 1;
        }
      }

      // Re-arm on clear (D4): occurrences whose alert vanished from an
      // untruncated fetch (or came back up) are cleared so the next non-up
      // occurrence is new work.
      await this.queue.reconcileMonitoringOccurrenceClearances(context, {
        definition,
        fetchedAlerts: listedAlerts.map((alert) => ({ id: alert.id, status: alert.status })),
        fetchTruncated: listedAlerts.length >= scope.maxResults,
      });

      return { definition, summary, config, finalizeCycle: true };
    } catch (error) {
      await this.failDefinitionPoll(context, definition, summary, error);
      return { definition, summary, config: null, finalizeCycle: false };
    }
  }

  private async processDefinitionReadyItems(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    config: MonitoringIngestionConfig,
    summary: MonitoringAlertIngestionPollSummary,
    processingDeadlineMs: number,
  ): Promise<{ budgetReached: boolean; remainingReadyItems: number }> {
    const readyItems = await this.listReadyItems(context, definition, config);

    const diagnosisContext = diagnosisContextForDefinition(context, definition);
    for (let index = 0; index < readyItems.length; index += 1) {
      const item = readyItems[index];
      if (Date.now() >= processingDeadlineMs) {
        return { budgetReached: true, remainingReadyItems: readyItems.length - index };
      }
      try {
        await this.queue.assertDailyCapAvailable(context, definition);
        // Non-consuming quota gate, same treatment as helpdesk: detection keeps
        // enqueueing (no LLM cost), queued items wait, and processing resumes
        // when the monthly volume resets. The skeleton itself makes no LLM
        // calls yet, but the gate keeps the poller final for IMPL-4.
        await this.builtinQuota?.assertQuotaAvailable(context);
      } catch (capError) {
        // Reaching a cap is a normal safety stop, not a cycle failure:
        // detection already completed, so scheduled watching keeps queuing new
        // alerts every cycle instead of being parked by the failure back-off.
        summary.status = 'paused';
        summary.reason = capError instanceof Error ? capError.message : 'Daily cap reached.';
        break;
      }
      try {
        // Isolate each diagnosis in a savepoint so one item's DB error rolls
        // back only that item, not the whole tenant cycle transaction.
        await this.runDiagnosisInSavepoint(context, diagnosisContext, item.id);
        summary.processed += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        summary.errors.push(`Work item ${item.id}: ${message}`);
        // The savepoint rollback restored a healthy transaction, so this audit write succeeds.
        await this.queue.recordAuditEvent(context, {
          agentDefinitionId: definition.id,
          workItemId: item.id,
          eventType: 'work_item_processing_failed',
          severity: 'error',
          message: 'Monitoring alert queued diagnosis failed.',
          metadata: { error: message },
        });
      }
    }
    return { budgetReached: false, remainingReadyItems: 0 };
  }

  private async listReadyItems(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    config: MonitoringIngestionConfig,
  ): Promise<AiAgentWorkItem[]> {
    // Narrowed to the active statuses so the fetch stays bounded by the
    // live queue depth instead of every work item ever processed.
    const now = new Date();
    const binding = requireMonitoringBinding(definition);
    return (await context.manager.getRepository(AiAgentWorkItem).find({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: definition.id,
        status: In(['queued', 'failed']),
        source_provider_kind: binding.providerKind,
        source_provider_key: binding.providerKey,
        source_object_type: 'sensor',
        work_kind: MONITORING_ALERT_DIAGNOSTIC_WORK_KIND,
      },
    }))
      .filter((item) => workItemReady(item, now))
      .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
      .slice(0, config.maxAlertsPerCycle);
  }

  private async countReadyItemsForStates(
    context: AiExecutionContextWithManager,
    states: MonitoringDefinitionPollState[],
  ): Promise<Array<{ state: MonitoringDefinitionPollState; count: number }>> {
    const counts: Array<{ state: MonitoringDefinitionPollState; count: number }> = [];
    for (const state of states) {
      if (!state.finalizeCycle || !state.config || state.summary.status !== 'completed') {
        continue;
      }
      counts.push({
        state,
        count: (await this.listReadyItems(context, state.definition, state.config)).length,
      });
    }
    return counts;
  }

  private async completeDefinitionPoll(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    summary: MonitoringAlertIngestionPollSummary,
  ): Promise<void> {
    const event = await this.queue.recordAuditEvent(context, {
      agentDefinitionId: definition.id,
      eventType: 'poller_cycle_completed',
      severity: 'info',
      message: 'Monitoring alert ingestion cycle completed.',
      metadata: summary,
    });
    await this.queue.updateMonitoringIngestionState(context, definition, {
      status: 'active',
      reason: null,
      failure_streak: 0,
      last_poll_at: new Date().toISOString(),
      last_poll_status: 'completed',
      last_audit_event_id: event.id,
      last_poll_summary: summary,
    });
  }

  private async failDefinitionPoll(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    summary: MonitoringAlertIngestionPollSummary,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    summary.status = 'failed';
    summary.reason = message;
    if (!summary.errors.includes(message)) {
      summary.errors.push(message);
    }
    const event = await this.queue.recordAuditEvent(context, {
      agentDefinitionId: definition.id,
      eventType: 'poller_cycle_failed',
      severity: 'error',
      message: 'Monitoring alert ingestion failed closed.',
      metadata: { error: message },
    });
    await this.queue.updateMonitoringIngestionState(context, definition, {
      status: 'paused',
      reason: 'poller_failure',
      failure_streak: failureStreak(definition) + 1,
      last_poll_at: new Date().toISOString(),
      last_poll_status: 'failed',
      last_audit_event_id: event.id,
      last_error: message,
    });
  }

  // Run one work-item diagnosis inside a SAVEPOINT so a failure rolls back only
  // that item and leaves the surrounding cycle transaction usable. Falls back
  // to a plain call when the manager exposes no raw query (e.g. the in-memory
  // test manager).
  private async runDiagnosisInSavepoint(
    context: AiExecutionContextWithManager,
    diagnosisContext: AiExecutionContextWithManager,
    workItemId: string,
  ): Promise<void> {
    const query = (context.manager as { query?: (sql: string) => Promise<unknown> }).query;
    if (typeof query !== 'function') {
      await this.control.runMonitoringDiagnosis(diagnosisContext, { work_item_id: workItemId });
      return;
    }
    const savepoint = `srediag_${workItemId.replace(/[^a-z0-9]/gi, '')}`;
    await query.call(context.manager, `SAVEPOINT ${savepoint}`);
    try {
      await this.control.runMonitoringDiagnosis(diagnosisContext, { work_item_id: workItemId });
      await query.call(context.manager, `RELEASE SAVEPOINT ${savepoint}`);
    } catch (error) {
      await query.call(context.manager, `ROLLBACK TO SAVEPOINT ${savepoint}`);
      // The rollback reverted the failed attempt's bookkeeping (lease +
      // attempt_count from acquireWorkItem AND the failed/dead_letter +
      // backoff transition failWorkItem already wrote) while the attempt's
      // external costs survived (detached built-in quota reservation, real
      // LLM tokens). Re-apply the failure bookkeeping in the restored
      // transaction — otherwise the item returns to 'queued' with a past
      // next_attempt_at and retries at full cost every cron tick forever,
      // with max_attempts/backoff/dead-letter reduced to dead code.
      await this.reapplyWorkItemFailureAfterRollback(context, workItemId, error);
      throw error;
    }
  }

  // Mirrors, in the restored transaction, what acquireWorkItem+failWorkItem
  // persisted inside the rolled-back savepoint: one consumed attempt and the
  // failed (or dead_letter) transition with retry backoff. Only runs when the
  // control service marked the error as a LEASED attempt failure — pre-lease
  // failures (e.g. a claim held by another agent) never consumed an attempt
  // and simply retry next cycle.
  private async reapplyWorkItemFailureAfterRollback(
    context: AiExecutionContextWithManager,
    workItemId: string,
    error: unknown,
  ): Promise<void> {
    try {
      const repo = context.manager.getRepository(AiAgentWorkItem);
      const workItem = await repo.findOne({ where: { id: workItemId, tenant_id: context.tenantId } });
      if (!workItem || workItem.status === 'completed' || workItem.status === 'dead_letter' || workItem.status === 'waiting_approval') {
        return;
      }
      const leasedAttempt = failedWorkItemAttemptId(error) === workItemId;
      if (leasedAttempt) {
        // Re-apply the increment the rolled-back acquireWorkItem made: the
        // attempt genuinely ran (and its quota reservation survived).
        workItem.attempt_count += 1;
      } else if (workItem.attempt_count < workItem.max_attempts) {
        return;
      }
      // failWorkItem dead-letters when attempt_count has reached max_attempts,
      // otherwise schedules the configured retry backoff.
      await this.queue.failWorkItem(context, workItem, error);
    } catch (bookkeepingError) {
      // Never mask the original failure: the poller's caller already records
      // it; a bookkeeping failure here only costs one extra retry cycle.
      this.logger.warn(
        `Could not re-apply failure bookkeeping for work item ${workItemId}: ${bookkeepingError instanceof Error ? bookkeepingError.message : String(bookkeepingError)}`,
      );
    }
  }

  private async loadDefinitions(
    context: AiExecutionContextWithManager,
  ): Promise<AiAgentDefinition[]> {
    // Only enabled SRE agents poll; drafts stay inert until an operator turns
    // monitoring diagnosis on deliberately. Unbound enabled agents surface as
    // per-agent 'disabled' summaries in detectDefinition — they are loaded here
    // so the skip reason is visible, not silently absent.
    return context.manager.getRepository(AiAgentDefinition).find({
      where: {
        tenant_id: context.tenantId,
        agent_type: 'sre',
        status: 'enabled',
      },
      order: { agent_key: 'ASC' },
    });
  }
}
