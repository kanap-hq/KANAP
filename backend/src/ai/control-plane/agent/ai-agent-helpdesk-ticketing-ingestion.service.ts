import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { ScheduledTasksService } from '../../../admin/scheduled-tasks/scheduled-tasks.service';
import { AiExecutionContextWithManager } from '../../ai.types';
import { withTenantExecution } from '../../../common/tenant-runner';
import { AiAgentControlService } from '../agent-control/ai-agent-control.service';
import { AiAgentBuiltinQuotaService } from './ai-agent-builtin-quota.service';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiAgentWorkItem } from '../entities/ai-agent-work-item.entity';
import { AiProviderRegistryService } from '../providers/provider-registry.service';
import { StripeConfigService } from '../../../billing/stripe/stripe.config';
import { Subscription } from '../../../billing/subscription.entity';
import { evaluateSubscriptionAccess } from '../../../billing/subscription-freeze.util';
import { TicketRecord } from '../providers/provider.types';
import {
  AiAgentWorkQueueService,
  HELP_DESK_TICKETING_TRIAGE_WORK_KIND,
  HelpdeskNewTicketsIngestionConfig,
} from './ai-agent-work-queue.service';
import {
  OPEN_TICKET_STATUS_VALUES,
  ReferenceSubtreeResolver,
  createProviderSubtreeResolver,
  expandServiceDeskTargetingSubtrees,
  normalizeServiceDeskTargeting,
  ticketMatchesServiceDeskTargeting,
} from './service-desk-targeting';
import { requireTicketingBinding } from './ticketing-binding';
import {
  checkIntervalMinutesForDefinition,
  scheduledCheckDue,
} from './ai-agent-check-interval';
import { isRecord } from '../../../common/object-guards';
import { codedForbidden } from '../../../auth/module-right-required';

export type HelpdeskTicketingIngestionPollSummary = {
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
  agents?: HelpdeskTicketingIngestionPollSummary[];
};

export type HelpdeskTicketingIngestionRunSummary = {
  tenantsProcessed: number;
  tenantsSkipped: number;
  ticketsListed: number;
  ticketsEnqueued: number;
  ticketsProcessed: number;
  errors: string[];
};

function parseDateMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizedStatusSet(values: string[] | undefined): Set<string> {
  const source = values && values.length > 0 ? values : OPEN_TICKET_STATUS_VALUES;
  return new Set(source.map((value) => String(value).trim().toLowerCase()).filter(Boolean));
}

type ScopeSubtreeSets = {
  entityIds: Set<string> | null;
  categoryIds: Set<string> | null;
};

function inScope(ticket: TicketRecord, config: HelpdeskNewTicketsIngestionConfig, subtrees?: ScopeSubtreeSets): boolean {
  const statusSet = normalizedStatusSet(config.statusValues);
  if (!statusSet.has(String(ticket.status ?? '').trim().toLowerCase())) {
    return false;
  }
  if (config.mode === 'all_open' || config.mode === 'agent_involved') {
    const cutoff = parseDateMs(config.lastChangedBefore);
    if (cutoff != null) {
      const changed = parseDateMs(ticket.updatedAt);
      if (changed == null || changed > cutoff) {
        return false;
      }
    }
  } else {
    const createdAt = parseDateMs(ticket.createdAt);
    const horizon = parseDateMs(config.createdAfter);
    if (createdAt == null || horizon == null || createdAt < horizon) {
      return false;
    }
  }
  if (config.entityId) {
    const entityOk = subtrees?.entityIds
      ? subtrees.entityIds.has(ticket.scope?.entityId ?? '')
      : ticket.scope?.entityId === config.entityId;
    if (!entityOk) {
      return false;
    }
  }
  if (config.categoryId) {
    const categoryOk = subtrees?.categoryIds
      ? subtrees.categoryIds.has(ticket.scope?.categoryId ?? '')
      : ticket.scope?.categoryId === config.categoryId;
    if (!categoryOk) {
      return false;
    }
  }
  return true;
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
const DEFAULT_INGESTION_PROCESS_BUDGET_MS = 210_000;
export const HELP_DESK_TICKETING_INGESTION_TASK_NAME = 'ai-helpdesk-glpi-new-ticket-ingestion';
const HELP_DESK_TICKETING_INGESTION_LOCK_PREFIX = 'ai-helpdesk-glpi-ingestion';

// `manual` marks an operator-triggered "Check now" (as opposed to the cron
// tick). It bypasses the failed-cycle backoff and lets an agent in Manual run
// mode — turned on, but not watching — run one cycle on demand.
type HelpdeskTicketingPollOptions = { manual: boolean };

type HelpdeskTicketingDefinitionPollState = {
  definition: AiAgentDefinition;
  summary: HelpdeskTicketingIngestionPollSummary;
  config: HelpdeskNewTicketsIngestionConfig | null;
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
  return isRecord(metadata) && isRecord(metadata.helpdesk_ingestion_state)
    ? metadata.helpdesk_ingestion_state
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

// Resolve the user the triage should act as. A real operator context (manual cockpit poll)
// keeps its own scope; a scheduled/system context (empty userId) runs as the admin who
// configured the agent so user-scoped knowledge search has a valid user to resolve.
function triageContextForDefinition(
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
export class AiAgentHelpdeskTicketingIngestionService implements OnModuleInit {
  private readonly logger = new Logger(AiAgentHelpdeskTicketingIngestionService.name);

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
   * Frozen (non-payment) or trial-expired tenants must not run agents — a triage
   * run consumes the built-in free-message quota, a direct operator cost. Returns
   * a skip reason when the tenant is barred, or null when it may proceed. No-op
   * when billing isn't configured (on-prem / single-tenant) or in unit tests that
   * construct the service without a Stripe config or a repository-backed manager.
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
      name: HELP_DESK_TICKETING_INGESTION_TASK_NAME,
      description: 'Polls explicitly scoped ticketing new-ticket queues for the Helpdesk shadow-mode agent',
      defaultCron: '*/5 * * * *',
      handler: () => this.run(),
    });
  }

  async run(opts?: { manager?: EntityManager }): Promise<HelpdeskTicketingIngestionRunSummary> {
    const summary: HelpdeskTicketingIngestionRunSummary = {
      tenantsProcessed: 0,
      tenantsSkipped: 0,
      ticketsListed: 0,
      ticketsEnqueued: 0,
      ticketsProcessed: 0,
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
        summary.ticketsListed += result.listed;
        summary.ticketsEnqueued += result.enqueued;
        summary.ticketsProcessed += result.processed;
        summary.errors.push(...result.errors.map((entry) => `Tenant ${tenant.id}: ${entry}`));
      } catch (error: any) {
        summary.errors.push(`Tenant ${tenant.id}: ${error?.message || String(error)}`);
      }
    }

    this.logger.log(
      `[${HELP_DESK_TICKETING_INGESTION_TASK_NAME}] Done: ${summary.tenantsProcessed} tenants, ${summary.ticketsEnqueued} enqueued, ${summary.ticketsProcessed} processed`,
    );
    return summary;
  }

  async pollTenant(context: AiExecutionContextWithManager): Promise<HelpdeskTicketingIngestionPollSummary> {
    return this.pollTenantContext(context, { manual: true });
  }

  private async runForTenantManager(
    manager: EntityManager,
    tenantId: string,
    opts: HelpdeskTicketingPollOptions,
  ): Promise<HelpdeskTicketingIngestionPollSummary> {
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
    opts: HelpdeskTicketingPollOptions,
  ): Promise<HelpdeskTicketingIngestionPollSummary> {
    const processingDeadlineMs = Date.now() + parsePositiveIntEnv(
      process.env.AI_AGENT_INGESTION_PROCESS_BUDGET_MS,
      DEFAULT_INGESTION_PROCESS_BUDGET_MS,
    );
    const summary: HelpdeskTicketingIngestionPollSummary = {
      tenantId: context.tenantId,
      status: 'completed',
      listed: 0,
      enqueued: 0,
      deduped: 0,
      processed: 0,
      errors: [],
    };
    // Frozen / trial-expired tenants get no agent runs (they would burn the
    // built-in free-message quota, a direct operator cost). Skip before any work.
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
        [`${HELP_DESK_TICKETING_INGESTION_LOCK_PREFIX}:${context.tenantId}`],
      );
      if (!lockRows[0]?.locked) {
        summary.status = 'skipped';
        summary.reason = 'Another helpdesk ticket ingestion poll is already running for this tenant.';
        summary.errors.push(summary.reason);
        return summary;
      }
    }

    const definitions = await this.loadDefinitions(context);
    if (definitions.length === 0) {
      summary.status = 'disabled';
      summary.reason = 'No helpdesk ticket triage agent definitions exist yet for this tenant.';
      return summary;
    }

    const pollStates: HelpdeskTicketingDefinitionPollState[] = [];
    // Pass 1 is detection only and always runs for every definition before
    // inline triage starts. This keeps ticket discovery/enqueue latency bounded
    // even when a previous definition has slow LLM work waiting in the queue.
    for (const definition of definitions) {
      pollStates.push(await this.detectDefinition(context, definition, opts));
    }

    let processingBudgetReason: string | null = null;
    // Pass 2 processes queued triage work under one shared per-cycle deadline.
    // When the deadline is reached, queued work is left for the next cron tick
    // and the cycle remains healthy because detection already completed.
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
      summary.reason = agentSummaries.map((entry) => entry.reason).filter(Boolean).join(' | ') || 'No helpdesk ticket agent has watching enabled.';
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
    opts: HelpdeskTicketingPollOptions,
  ): Promise<HelpdeskTicketingDefinitionPollState> {
    const summary: HelpdeskTicketingIngestionPollSummary = {
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
    let config: HelpdeskNewTicketsIngestionConfig;
    try {
      this.queue.assertHelpdeskTicketingDefinitionRunnable(definition, null);
      config = this.queue.resolveScopeIngestionConfig(definition, {
        trigger: opts.manual ? 'manual' : 'scheduled',
      });
    } catch (error) {
      summary.status = 'disabled';
      summary.reason = error instanceof Error ? error.message : String(error);
      return { definition, summary, config: null, finalizeCycle: false };
    }

    // Scheduled polls back off after failed cycles (5 min doubling, capped at
    // 6 h) so a down ticketing provider is not hammered every cron tick.
    // Manual cockpit polls bypass the cooldown on purpose: an operator retry is
    // an explicit decision.
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
        message: `Helpdesk ticket ingestion skipped because an emergency pause is active: ${pause.reason}`,
        metadata: { pause_id: pause.id },
      });
      await this.queue.updateHelpdeskIngestionState(context, definition, {
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

    const binding = requireTicketingBinding(definition);
    try {
      const applicability = await this.providers.getApplicability(context, binding.providerKind, binding.providerKey);
      if (!applicability.available) {
        throw codedForbidden('AGENT_PROVIDER_UNAVAILABLE', `Ticketing provider is unavailable: ${applicability.message ?? applicability.reasonCode ?? 'not ready'}.`, { detail: applicability.message ?? applicability.reasonCode ?? 'not ready' });
      }
      const provider = await this.providers.ticketing(context, binding.providerKey);
      const subtreeResolver: ReferenceSubtreeResolver = createProviderSubtreeResolver(provider, context, (kind, ids, message) => {
        this.logger.warn(`Recursive ${kind} expansion failed for agent ${definition.agent_key} (${ids.join(',')}): ${message}; falling back to exact-id matching.`);
      });
      const scopeEntityIds = config.entityId ? await subtreeResolver('entity', [config.entityId]) : null;
      const scopeCategoryIds = config.categoryId ? await subtreeResolver('category', [config.categoryId]) : null;
      const subtreeSets: ScopeSubtreeSets = {
        entityIds: scopeEntityIds && scopeEntityIds.length > 0 ? new Set(scopeEntityIds) : null,
        categoryIds: scopeCategoryIds && scopeCategoryIds.length > 0 ? new Set(scopeCategoryIds) : null,
      };
      const maxResults = Math.min(config.maxTicketsPerCycle, config.maxProviderRequestsPerCycle);
      let listedTickets: TicketRecord[];
      if (config.mode === 'agent_involved') {
        // Tickets this agent previously acted on (control-plane state), refetched live.
        const refs = await this.queue.listAgentTouchedTicketRefs(context, definition, maxResults);
        listedTickets = [];
        for (const ref of refs) {
          const fetched = await provider.getTicket(context, { ticketId: ref });
          if (fetched.ok !== false) {
            listedTickets.push(fetched.data);
          }
        }
      } else {
        const scope = config.mode === 'all_open'
          ? {
            mode: 'all_open' as const,
            maxResults,
            statusValues: config.statusValues,
            entityId: config.entityId ?? null,
            categoryId: config.categoryId ?? null,
            entityIds: scopeEntityIds,
            categoryIds: scopeCategoryIds,
            lastChangedBefore: config.lastChangedBefore ?? null,
          }
          : {
            mode: 'new_tickets_only' as const,
            createdAfter: config.createdAfter ?? '',
            maxResults,
            statusValues: config.statusValues,
            entityId: config.entityId ?? null,
            categoryId: config.categoryId ?? null,
            entityIds: scopeEntityIds,
            categoryIds: scopeCategoryIds,
          };
        const listed = await provider.listTicketsForScope(context, { scope });
        if (listed.ok === false) {
          throw new BadRequestException(listed.message);
        }
        if (!isRecord(listed.data) || !Array.isArray(listed.data.tickets)) {
          throw new BadRequestException('Ticket list provider response was malformed.');
        }
        listedTickets = listed.data.tickets;
      }
      const targeting = await expandServiceDeskTargetingSubtrees(
        normalizeServiceDeskTargeting(definition.scope_policy_json),
        subtreeResolver,
      );
      const scopedTickets = listedTickets.filter((ticket) =>
        inScope(ticket, config, subtreeSets)
        && ticketMatchesServiceDeskTargeting(ticket, targeting, {
          agentTouched: config.mode === 'agent_involved',
        }),
      );
      summary.listed = listedTickets.length;
      const cycleTickets = scopedTickets.slice(0, config.maxTicketsPerCycle);
      const liveByRef = await this.queue.listLivePendingActionsForTargets(context, {
        definition,
        targetRefs: cycleTickets.map((ticket) => ticket.id),
      });
      for (const ticket of cycleTickets) {
        const readiness = await this.queue.targetReviewReadiness(context, {
          definition,
          ticket,
          livePendingActions: liveByRef.get(ticket.id) ?? [],
        });
        if (!readiness.ready) {
          summary.deduped += 1;
          continue;
        }
        const claim = await this.queue.acquireTargetClaim(context, {
          definition,
          targetRef: ticket.id,
          metadata: {
            source: 'scheduled_poller',
            readiness_reason: readiness.reason,
            ticket_updated_at: ticket.updatedAt ?? null,
          },
        });
        if (!claim.acquired) {
          summary.deduped += 1;
          continue;
        }
        const result = await this.queue.enqueueTicketingScopedTicket(context, {
          definition,
          ticket,
          trigger: opts.manual ? 'manual' : 'scheduled',
          providerKind: binding.providerKind,
          providerKey: binding.providerKey,
          metadata: {
            poller_created_after: config.createdAfter,
            poller_enabled_at: config.enabledAt,
            target_readiness_reason: readiness.reason,
            target_claim_status: claim.status,
          },
        });
        await this.queue.acquireTargetClaim(context, {
          definition,
          targetRef: ticket.id,
          workItemId: result.workItem.id,
          metadata: {
            source: 'scheduled_poller',
            work_item_id: result.workItem.id,
            target_readiness_reason: readiness.reason,
          },
        });
        if (result.created) {
          summary.enqueued += 1;
        } else {
          summary.deduped += 1;
        }
      }
      return { definition, summary, config, finalizeCycle: true };
    } catch (error) {
      await this.failDefinitionPoll(context, definition, summary, error);
      return { definition, summary, config: null, finalizeCycle: false };
    }
  }

  private async processDefinitionReadyItems(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    config: HelpdeskNewTicketsIngestionConfig,
    summary: HelpdeskTicketingIngestionPollSummary,
    processingDeadlineMs: number,
  ): Promise<{ budgetReached: boolean; remainingReadyItems: number }> {
    const readyItems = await this.listReadyItems(context, definition, config);

    // Scheduled/system polls carry no operator user, so triage (which scopes knowledge
    // search by the acting user) must run as a real user or its user lookup fails on an
    // empty id and aborts the whole tenant transaction. Use the admin who configured the
    // agent; a manual cockpit poll keeps the operator's own scope.
    const triageContext = triageContextForDefinition(context, definition);
    for (let index = 0; index < readyItems.length; index += 1) {
      const item = readyItems[index];
      if (Date.now() >= processingDeadlineMs) {
        return { budgetReached: true, remainingReadyItems: readyItems.length - index };
      }
      try {
        await this.queue.assertDailyCapAvailable(context, definition);
        // Same treatment for an exhausted built-in free-message quota: detection keeps
        // enqueueing (no LLM cost), queued items wait, and processing resumes when the
        // monthly volume resets. Gated here (not at cycle setup) on purpose.
        await this.builtinQuota?.assertQuotaAvailable(context);
      } catch (capError) {
        // Reaching the daily cap is a normal safety stop, not a cycle failure. Stop
        // processing but keep the cycle healthy: detection (list + enqueue in pass 1) has
        // already run, so scheduled watching keeps queuing new tickets every cycle
        // instead of being parked for hours by the failure back-off. Processing
        // resumes automatically when the daily window resets at midnight UTC.
        summary.status = 'paused';
        summary.reason = capError instanceof Error ? capError.message : 'Daily cap reached.';
        break;
      }
      try {
        // Isolate each triage in a savepoint so one item's DB error rolls back only that
        // item, not the whole cycle. Without this, a single failed triage aborts the
        // tenant transaction and takes the ticket detection (enqueue in pass 1) and the
        // cycle's own audit/state writes down with it.
        await this.runTriageInSavepoint(context, triageContext, item.id);
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
          message: 'Helpdesk ticket queued triage failed.',
          metadata: { error: message },
        });
      }
    }
    return { budgetReached: false, remainingReadyItems: 0 };
  }

  private async listReadyItems(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    config: HelpdeskNewTicketsIngestionConfig,
  ): Promise<AiAgentWorkItem[]> {
    // Narrowed to the active statuses so the fetch stays bounded by the
    // live queue depth instead of every work item ever processed.
    const now = new Date();
    const binding = requireTicketingBinding(definition);
    return (await context.manager.getRepository(AiAgentWorkItem).find({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: definition.id,
        status: In(['queued', 'failed']),
        source_provider_kind: binding.providerKind,
        source_provider_key: binding.providerKey,
        source_object_type: 'ticket',
        work_kind: HELP_DESK_TICKETING_TRIAGE_WORK_KIND,
      },
    }))
      .filter((item) => workItemReady(item, now))
      .sort((a, b) => new Date(a.created_at ?? 0).getTime() - new Date(b.created_at ?? 0).getTime())
      .slice(0, config.maxTicketsPerCycle);
  }

  private async countReadyItemsForStates(
    context: AiExecutionContextWithManager,
    states: HelpdeskTicketingDefinitionPollState[],
  ): Promise<Array<{ state: HelpdeskTicketingDefinitionPollState; count: number }>> {
    const counts: Array<{ state: HelpdeskTicketingDefinitionPollState; count: number }> = [];
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
    summary: HelpdeskTicketingIngestionPollSummary,
  ): Promise<void> {
    const event = await this.queue.recordAuditEvent(context, {
      agentDefinitionId: definition.id,
      eventType: 'poller_cycle_completed',
      severity: 'info',
      message: 'Helpdesk ticket new-ticket ingestion cycle completed.',
      metadata: summary,
    });
    await this.queue.updateHelpdeskIngestionState(context, definition, {
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
    summary: HelpdeskTicketingIngestionPollSummary,
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
      message: 'Helpdesk ticket new-ticket ingestion failed closed.',
      metadata: { error: message },
    });
    await this.queue.updateHelpdeskIngestionState(context, definition, {
      status: 'paused',
      reason: 'poller_failure',
      failure_streak: failureStreak(definition) + 1,
      last_poll_at: new Date().toISOString(),
      last_poll_status: 'failed',
      last_audit_event_id: event.id,
      last_error: message,
    });
  }

  // Run one work-item triage inside a SAVEPOINT so a failure rolls back only that item and
  // leaves the surrounding cycle transaction usable. Falls back to a plain call when the
  // manager exposes no raw query (e.g. the in-memory test manager).
  private async runTriageInSavepoint(
    context: AiExecutionContextWithManager,
    triageContext: AiExecutionContextWithManager,
    workItemId: string,
  ): Promise<void> {
    const query = (context.manager as { query?: (sql: string) => Promise<unknown> }).query;
    if (typeof query !== 'function') {
      await this.control.runTicketingTriage(triageContext, { work_item_id: workItemId });
      return;
    }
    const savepoint = `triage_${workItemId.replace(/[^a-z0-9]/gi, '')}`;
    await query.call(context.manager, `SAVEPOINT ${savepoint}`);
    try {
      await this.control.runTicketingTriage(triageContext, { work_item_id: workItemId });
      await query.call(context.manager, `RELEASE SAVEPOINT ${savepoint}`);
    } catch (error) {
      await query.call(context.manager, `ROLLBACK TO SAVEPOINT ${savepoint}`);
      throw error;
    }
  }

  private async loadDefinitions(
    context: AiExecutionContextWithManager,
  ): Promise<AiAgentDefinition[]> {
    return context.manager.getRepository(AiAgentDefinition).find({
      where: {
        tenant_id: context.tenantId,
        agent_type: 'helpdesk',
      },
      order: { agent_key: 'ASC' },
    });
  }
}
