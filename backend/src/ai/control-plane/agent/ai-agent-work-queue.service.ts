import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { In, Not } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiSettings } from '../../ai-settings.entity';
import {
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_PREPARE_CAPABILITY,
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
} from '../capability/capability-contract';
import { AiActionRequest } from '../entities/ai-action-request.entity';
import { AiAgentAuditEvent } from '../entities/ai-agent-audit-event.entity';
import { AiAgentDefinition } from '../entities/ai-agent-definition.entity';
import { AiAgentTargetState } from '../entities/ai-agent-target-state.entity';
import { AiAgentTrigger } from '../entities/ai-agent-trigger.entity';
import { AiAgentWorkItem } from '../entities/ai-agent-work-item.entity';
import { AiEmergencyPause } from '../entities/ai-emergency-pause.entity';
import { AiObservation } from '../entities/ai-observation.entity';
import { AiRun } from '../entities/ai-run.entity';
import { hashStableJson } from '../evidence/ai-evidence.service';
import { AiAdapterConfig } from '../providers/adapter-config.entity';
import { LEGACY_GLPI_TICKETING_PROVIDER_KEY } from '../providers/provider-constants';
import {
  deriveServiceDeskTargetingFetchConfig,
  normalizeServiceDeskScopePolicy,
  normalizeServiceDeskTargeting,
  OPEN_TICKET_STATUS_VALUES,
  TargetingPreviewSummary,
  ticketMatchesServiceDeskTargeting,
} from './service-desk-targeting';
import { MONITORING_SEVERITY_VALUES } from '../providers/provider-constants';
import { MonitoringTargetingModel, normalizeMonitoringTargeting } from './monitoring-targeting';
import { requireMonitoringBinding, resolveMonitoringBinding } from './provider-binding';
import { requireTicketingBinding, resolveTicketingBinding } from './ticketing-binding';
import {
  HELP_DESK_ALLOWED_CAPABILITIES,
  HELP_DESK_FORBIDDEN_CAPABILITIES,
  SRE_MONITORING_ALLOWED_CAPABILITIES,
  SRE_MONITORING_FORBIDDEN_CAPABILITIES,
} from './agent-definition-defaults';
import { isRecord } from '../../../common/object-guards';
import { actionClassForCapabilityName } from './ai-agent-autonomy';
import { codedForbidden } from '../../../auth/module-right-required';

export {
  HELP_DESK_ALLOWED_CAPABILITIES,
  HELP_DESK_FORBIDDEN_CAPABILITIES,
  SRE_MONITORING_ALLOWED_CAPABILITIES,
  SRE_MONITORING_FORBIDDEN_CAPABILITIES,
};

export const HELP_DESK_TICKETING_TRIAGE_AGENT_KEY = 'helpdesk.glpi.triage';

export const SRE_MONITORING_DIAGNOSIS_AGENT_KEY = 'sre.monitoring.diagnosis';

export const HELP_DESK_TICKETING_TRIAGE_MANUAL_TRIGGER_KEY = 'manual.safe_target';
export const HELP_DESK_TICKETING_TRIAGE_NEW_TICKETS_TRIGGER_KEY = 'scheduled.new_tickets_only';
export const HELP_DESK_TICKETING_TRIAGE_WORK_KIND = 'ticket_triage';
// EXACT value allowed by the phase-10 CHECK constraint on ai_agent_work_items
// for monitoring work — any other monitoring work kind needs a migration.
export const MONITORING_ALERT_DIAGNOSTIC_WORK_KIND = 'monitoring_alert_diagnostic';
// D4 occurrence identity tolerance: providers may report the same occurrence
// start with sub-minute jitter between fetches (PRTG rounds to the minute),
// so occurrence timestamps within this window are the SAME occurrence.
export const MONITORING_OCCURRENCE_TOLERANCE_MS = 60_000;

// Occurrence bucket for work-item dedup keys, rounded down to the minute so
// sub-minute provider jitter cannot mint a second key for the same occurrence.
export function monitoringAlertOccurrenceBucket(occurrenceStartedAt: string | null | undefined): string {
  const parsed = typeof occurrenceStartedAt === 'string' && occurrenceStartedAt.trim()
    ? Date.parse(occurrenceStartedAt)
    : NaN;
  if (!Number.isFinite(parsed)) {
    return 'none';
  }
  return new Date(Math.floor(parsed / 60_000) * 60_000).toISOString().slice(0, 16);
}

// Monitoring work-item dedup key (D4): provider + object + occurrence bucket.
// A clear-then-refire produces a new occurrence bucket and therefore a new key.
export function monitoringAlertDedupKey(
  providerKey: string,
  alertId: string,
  occurrenceStartedAt?: string | null,
): string {
  return `monitoring:${providerKey}:${alertId}:${monitoringAlertOccurrenceBucket(occurrenceStartedAt)}`;
}

// D4 occurrence-in-progress marker on monitoring target states. Providers may
// legitimately report NO occurrence timestamp for an active alarm state (PRTG
// tracks no "down since" for warning/unusual sensors), so "an occurrence is
// recorded" must never be inferred from the timestamp alone — a
// null-timestamp occurrence would read as first_occurrence on every poll and
// be re-diagnosed (and re-billed) every cycle. The explicit flag records that
// an occurrence is in progress; the timestamp (when known) still drives
// new-occurrence detection. Rows written before the flag existed carry only
// the timestamp, hence the fallback.
export function monitoringOccurrenceOpen(stateJson: Record<string, unknown>): boolean {
  if (stateJson.occurrence_open === true) {
    return true;
  }
  if (stateJson.occurrence_open === false) {
    return false;
  }
  return typeof stateJson.occurrence_started_at === 'string' && stateJson.occurrence_started_at.trim().length > 0;
}

// touched_by is occurrence-scoped (plan 37 §4.2 "skip alerts the agent already
// handled this occurrence"): the lifetime agent_touched flag alone must not
// hide a sensor forever. The agent counts as having touched an alert only
// when its recorded occurrence is still in progress AND the fetched alert
// does not prove a NEW occurrence (both timestamps known and apart beyond the
// jitter tolerance — the same same-occurrence rule monitoringOccurrenceReadiness
// applies). A recovered-and-refired sensor is therefore visible again.
export function monitoringAlertTouchedForOccurrence(
  state: AiAgentTargetState | null | undefined,
  alert: { occurrenceStartedAt?: string | null },
): boolean {
  if (!state?.agent_touched) {
    return false;
  }
  const stateJson = policyObject(state.state_json);
  if (!monitoringOccurrenceOpen(stateJson)) {
    return false;
  }
  const recordedMs = dateFromUnknown(stringFromPolicy(stateJson.occurrence_started_at))?.getTime() ?? null;
  const fetchedMs = dateFromUnknown(alert.occurrenceStartedAt ?? null)?.getTime() ?? null;
  if (recordedMs != null && fetchedMs != null && Math.abs(fetchedMs - recordedMs) > MONITORING_OCCURRENCE_TOLERANCE_MS) {
    return false;
  }
  return true;
}

// Failed-attempt marker for savepoint-wrapped callers (the monitoring poller):
// a ROLLBACK TO SAVEPOINT reverts EVERYTHING the failed attempt wrote —
// acquireWorkItem's attempt_count increment AND failWorkItem's
// failed/dead_letter + backoff bookkeeping — while the attempt's externalized
// costs (detached built-in quota reservation, real LLM tokens) survive. The
// control service stamps the error when a leased attempt failed; the caller
// re-applies the failure bookkeeping after its rollback so retry backoff and
// dead-lettering keep working. Without it a deterministically failing
// diagnosis would return to 'queued' with a past next_attempt_at and retry at
// full cost on every cron tick, forever.
const FAILED_WORK_ITEM_ATTEMPT_MARKER = 'kanapFailedWorkItemAttemptId';

export function markWorkItemAttemptFailure(error: unknown, workItemId: string): void {
  if (error && typeof error === 'object') {
    (error as Record<string, unknown>)[FAILED_WORK_ITEM_ATTEMPT_MARKER] = workItemId;
  }
}

export function failedWorkItemAttemptId(error: unknown): string | null {
  if (!error || typeof error !== 'object') {
    return null;
  }
  const id = (error as Record<string, unknown>)[FAILED_WORK_ITEM_ATTEMPT_MARKER];
  return typeof id === 'string' && id.trim().length > 0 ? id : null;
}

const ACTIVE_WORK_ITEM_STATUSES = new Set(['queued', 'leased', 'running', 'waiting_approval', 'failed']);
// How long a dead-lettered monitoring diagnosis waits before its still-open
// occurrence becomes eligible for a fresh work item (see
// monitoringOccurrenceReadiness).
export const MONITORING_DEAD_LETTER_RETRY_BACKOFF_MS = 60 * 60 * 1000;
const TERMINAL_WORK_ITEM_STATUSES = new Set(['completed', 'dead_letter']);
const RETRYABLE_WORK_ITEM_STATUSES = new Set(['queued', 'leased', 'running', 'failed']);
// Every status write on a work item goes through applyWorkItemTransition; a from→to pair
// outside this map is logged as a warning (never blocked — several writers run inside
// error-recovery paths where throwing would mask the original failure).
const WORK_ITEM_ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  queued: new Set(['leased', 'failed', 'dead_letter']),
  leased: new Set(['running', 'waiting_approval', 'completed', 'failed', 'dead_letter']),
  running: new Set(['waiting_approval', 'completed', 'failed', 'dead_letter']),
  waiting_approval: new Set(['completed', 'failed', 'dead_letter']),
  failed: new Set(['leased', 'failed', 'dead_letter']),
  completed: new Set(),
  dead_letter: new Set(),
};
const WORK_ITEM_FAILURE_HISTORY_LIMIT = 10;
const DEFAULT_LEASE_TTL_SECONDS = 5 * 60;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_COOLDOWN_SECONDS = 60;
const DEFAULT_NEW_TICKET_MAX_PER_CYCLE = 5;
const DEFAULT_NEW_TICKET_RATE_LIMIT_PER_CYCLE = 10;
const DEFAULT_MONITORING_ALERTS_PER_CYCLE = 5;
const DEFAULT_MONITORING_REQUESTS_PER_CYCLE = 10;
const DEFAULT_BACKFILL_HORIZON_HOURS = 24;
const DEFAULT_PER_RUN_TOKEN_CAP = 40_000;
const DEFAULT_PER_RUN_COST_CAP_EUR = 1;
const DEFAULT_DAILY_RUN_CAP = 25;
const DEFAULT_DAILY_TOKEN_CAP = 500_000;
const DEFAULT_DAILY_COST_CAP_EUR = 10;
const DEFAULT_REVIEW_COOLDOWN_SECONDS = 24 * 60 * 60;
const DEFAULT_TARGET_CLAIM_LEASE_SECONDS = 10 * 60;
// A single approval window applies to every proposal an agent prepares, so all proposals for
// one ticket (prepared in the same run) become applicable together and expire together. There
// is no per-action-class TTL: a status change to closed/solved is ordinary routine work and
// shares the same window as any reply or note.
export const DEFAULT_APPROVAL_TTL_SECONDS = 24 * 60 * 60;
export const MIN_APPROVAL_TTL_SECONDS = 60;
export const MAX_APPROVAL_TTL_SECONDS = 30 * 24 * 60 * 60;

// Assignment and classification are deliberately optional: only the planner selects
// these writes, when the capability pair is granted and the provider supports them.
const REQUIRED_HELPDESK_TRIAGE_CAPABILITIES = [
  'ticketing.ticket.get',
  'search_knowledge',
  'get_document',
  TICKETING_INTERNAL_NOTE_PREPARE_CAPABILITY,
  TICKETING_PUBLIC_REPLY_PREPARE_CAPABILITY,
  TICKETING_STATUS_UPDATE_PREPARE_CAPABILITY,
] as const;

// Capability lists live in agent-definition-defaults.ts and are re-exported above.

const REQUIRED_SRE_DIAGNOSIS_CAPABILITIES = [
  'monitoring.alert.get',
  'monitoring.sensor.history',
] as const;

const HELPDESK_REVIEW_ACTION_CAPABILITIES = [
  TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY,
  TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY,
  TICKETING_CLASSIFICATION_UPDATE_APPROVED_CAPABILITY,
  TICKETING_STATUS_UPDATE_APPROVED_CAPABILITY,
  TICKETING_ASSIGNMENT_UPDATE_APPROVED_CAPABILITY,
  TICKETING_PARTICIPANT_UPDATE_APPROVED_CAPABILITY,
];

export type AgentQueueLiveTargetLike = {
  id: string;
  provider_kind: string;
  provider_key: string;
  environment: string;
  target_kind: string;
  target_key: string;
  external_ref: string;
  allowed_effect: string;
  safety_label: string;
  enabled: boolean;
};

export type TargetReviewReadiness = {
  state: AiAgentTargetState;
  ready: boolean;
  changed: boolean;
  due: boolean;
  reason: 'first_review' | 'changed' | 'scheduled' | 'not_due' | 'pending_proposal';
};

export type TargetClaimAcquireResult = {
  acquired: boolean;
  status: 'claimed' | 'deferred' | 'superseded';
  state: AiAgentTargetState | null;
  ownerAgentDefinitionId?: string | null;
  ownerPriority?: number | null;
  ownerWorkItemId?: string | null;
  claimExpiresAt?: string | null;
  reason?: string | null;
};

// Which trigger is asking for the ingestion scope. 'scheduled' (the default) is
// the cron tick and requires the agent to be watching; 'manual' is an operator
// pressing "Check now" and only requires the agent to be turned on.
export type ScopeIngestionResolveOptions = { trigger?: 'scheduled' | 'manual' };

export type AgentQueueOverview = {
  definitions: AiAgentDefinition[];
  workItems: AiAgentWorkItem[];
  targetStates: AiAgentTargetState[];
  counts: Record<string, number>;
  helpdesk: {
    summary: HelpdeskTicketingAgentSummary | null;
    summaries: HelpdeskTicketingAgentSummary[];
    fleet: HelpdeskTicketingAgentSummary['evaluation'] | null;
    auditEvents: AiAgentAuditEvent[];
  };
  // Latest stored diagnosis per watched monitoring target — the list-level
  // "dossier card" (check/device names, one-line conclusion). Read-time join
  // over ai_observations so historical rows need no backfill.
  monitoringDiagnoses: MonitoringDiagnosisCard[];
};

export type MonitoringDiagnosisCard = {
  target_ref: string;
  observation_id: string;
  run_id: string | null;
  observed_at: string | null;
  check_name: string | null;
  device_name: string | null;
  severity: string | null;
  status_at_diagnosis: string | null;
  brief_summary: string | null;
  brief_confidence: string | null;
  needs_human_review: boolean;
  synthesis_fallback: boolean;
  occurrence_started_at: string | null;
  source_uri: string | null;
};

export type MonitoringIngestionConfig = {
  enabled: true;
  enabledAt: string;
  maxAlertsPerCycle: number;
  maxProviderRequestsPerCycle: number;
  targeting: MonitoringTargetingModel;
};

// Compact alert view the queue persists on monitoring work items and target
// states. Deliberately excludes the alert message: provider text is untrusted
// external evidence and oversized queue payloads burn run caps (PR #95).
export type MonitoringAlertSnapshotInput = {
  id: string;
  status?: string | null;
  severity?: string | null;
  deviceName?: string | null;
  occurrenceStartedAt?: string | null;
  observedAt?: string | null;
  sourceUri?: string | null;
};

export type MonitoringOccurrenceReadiness = {
  state: AiAgentTargetState | null;
  ready: boolean;
  reason: 'first_occurrence' | 'new_occurrence' | 'escalated' | 'active_work_item' | 'duplicate_occurrence' | 'retry_after_dead_letter';
};

export type HelpdeskScopeMode = 'new_tickets_only' | 'all_open' | 'agent_involved';

export type HelpdeskNewTicketsIngestionConfig = {
  enabled: true;
  mode: HelpdeskScopeMode;
  enabledAt: string;
  // new_tickets_only: created-after horizon. null for the other modes.
  createdAfter: string | null;
  // all_open / agent_involved: only tickets unchanged since this cutoff (stale).
  lastChangedBefore?: string | null;
  statusValues: string[];
  entityId?: string | null;
  categoryId?: string | null;
  maxTicketsPerCycle: number;
  maxProviderRequestsPerCycle: number;
};

export type HelpdeskTicketingIngestionSettingsView = {
  agentDefinitionId: string;
  ingestion: {
    enabled: boolean;
    enabledAt: string | null;
    entityId: string | null;
    categoryId: string | null;
    maxTicketsPerCycle: number | null;
    maxProviderRequestsPerCycle: number | null;
    hardBackfillHorizonHours: number;
    ready: boolean;
    readyReason: string | null;
    effectiveCreatedAfter: string | null;
  };
  guardrails: {
    configured: boolean;
    perRun: { maxEstimatedTokens: number | null; maxEstimatedCostEur: number | null };
    daily: { maxAgentRuns: number | null; maxEstimatedTokens: number | null; maxEstimatedCostEur: number | null };
  };
};

export type HelpdeskDailyUsageSummary = {
  windowStart: string;
  windowEnd: string;
  runs: number;
  estimatedTokens: number;
  estimatedCostEur: number;
  cap: {
    maxRuns: number;
    maxTokens: number;
    maxCostEur: number;
  };
  reached: boolean;
  reachedReasons: string[];
};

export type HelpdeskRunGuardrailSummary = {
  maxEstimatedTokens: number;
  maxEstimatedCostEur: number;
};

export type HelpdeskEmergencyPauseSummary = {
  id: string;
  active: boolean;
  scope: string | null;
  agent_definition_id: string | null;
  reason: string;
  created_at: string | null;
  expires_at: string | null;
};

export type HelpdeskTicketingAgentSummary = {
  agentDefinitionId: string;
  ingestion: {
    enabled: boolean;
    mode: 'disabled' | HelpdeskScopeMode;
    paused: boolean;
    pauseReason: string | null;
    enabledAt: string | null;
    createdAfter: string | null;
    entityId: string | null;
    categoryId: string | null;
    maxTicketsPerCycle: number | null;
    maxProviderRequestsPerCycle: number | null;
    lastPollAt: string | null;
    lastPollStatus: string | null;
    lastAuditEventId: string | null;
  };
  guardrails: {
    configured: boolean;
    perRun: HelpdeskRunGuardrailSummary | null;
    daily: HelpdeskDailyUsageSummary | null;
  };
  emergencyPause: HelpdeskEmergencyPauseSummary | null;
  evaluation: {
    windowStart: string;
    windowEnd: string;
    proposalsByActionClass: Record<string, number>;
    terminalByStatus: Record<string, number>;
    acceptanceRate: number | null;
    dismissRate: number | null;
    rejectionReasons: Record<string, number>;
    medianApprovalLatencySeconds: number | null;
    runsPerTicket: number | null;
    tokensPerTicket: number | null;
    costPerTicketEur: number | null;
    kbHitRate: number | null;
  };
};

function numberFromPolicy(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function jsonArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function capabilityEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (isRecord(value) && Array.isArray(value.capabilities)) {
    return value.capabilities;
  }
  return [];
}

function capabilityEntryName(entry: unknown): string | null {
  if (typeof entry === 'string' && entry.trim()) {
    return entry.trim();
  }
  if (isRecord(entry) && typeof entry.name === 'string' && entry.name.trim()) {
    return entry.name.trim();
  }
  return null;
}

function capabilityNames(value: unknown): Set<string> {
  const names = new Set<string>();
  const entries = capabilityEntries(value);
  for (const entry of entries) {
    const name = capabilityEntryName(entry);
    if (name) {
      names.add(name);
    }
  }
  return names;
}

function policyObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function monitoringDiagnosisCardFromObservation(observation: AiObservation): MonitoringDiagnosisCard {
  const metadata = policyObject(observation.metadata_json);
  const alert = policyObject(metadata.alert);
  const text = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
  const observedAt = observation.observed_at instanceof Date
    ? observation.observed_at.toISOString()
    : (observation.observed_at ? String(observation.observed_at) : null);
  return {
    target_ref: observation.source_object_id ?? '',
    observation_id: observation.id,
    run_id: observation.run_id ?? null,
    observed_at: observedAt,
    check_name: text(alert.check_name),
    device_name: text(alert.device_name),
    severity: text(observation.severity),
    status_at_diagnosis: text(alert.status),
    brief_summary: text(metadata.brief_summary)?.slice(0, 240) ?? null,
    brief_confidence: text(metadata.brief_confidence),
    needs_human_review: metadata.needs_human_review === true,
    synthesis_fallback: metadata.synthesis_fallback === true,
    occurrence_started_at: text(alert.occurrence_started_at),
    source_uri: text(alert.source_uri),
  };
}

function nestedPolicy(value: unknown, key: string): Record<string, unknown> {
  const record = policyObject(value);
  return policyObject(record[key]);
}

function hasEnabledFlag(value: unknown, key: string): boolean {
  const record = policyObject(value);
  const direct = record[key];
  if (isRecord(direct)) {
    return direct.enabled === true;
  }
  return direct === true;
}

function stringFromPolicy(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function isoFromPolicy(value: unknown): string | null {
  const text = stringFromPolicy(value);
  if (!text) {
    return null;
  }
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function numberPolicyOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
}

function positivePolicyNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function defaultEconomicGuardrails(): Record<string, unknown> {
  return {
    configured: true,
    per_run: {
      max_estimated_tokens: DEFAULT_PER_RUN_TOKEN_CAP,
      max_estimated_cost_eur: DEFAULT_PER_RUN_COST_CAP_EUR,
    },
    daily: {
      max_agent_runs: DEFAULT_DAILY_RUN_CAP,
      max_estimated_tokens: DEFAULT_DAILY_TOKEN_CAP,
      max_estimated_cost_eur: DEFAULT_DAILY_COST_CAP_EUR,
    },
  };
}

function mergeEconomicGuardrails(current: unknown): Record<string, unknown> {
  const currentRecord = policyObject(current);
  const defaults = defaultEconomicGuardrails();
  return {
    ...defaults,
    ...currentRecord,
    per_run: {
      ...policyObject(defaults.per_run),
      ...policyObject(currentRecord.per_run),
    },
    daily: {
      ...policyObject(defaults.daily),
      ...policyObject(currentRecord.daily),
    },
  };
}

function runGuardrailsFromDefinition(definition: AiAgentDefinition): HelpdeskRunGuardrailSummary | null {
  const guardrails = nestedPolicy(definition.queue_policy_json, 'economic_guardrails');
  const perRun = policyObject(guardrails.per_run);
  if (guardrails.configured !== true) {
    return null;
  }
  const maxEstimatedTokens = positivePolicyNumber(perRun.max_estimated_tokens);
  const maxEstimatedCostEur = positivePolicyNumber(perRun.max_estimated_cost_eur);
  if (!maxEstimatedTokens || !maxEstimatedCostEur) {
    return null;
  }
  return { maxEstimatedTokens, maxEstimatedCostEur };
}

function dailyGuardrailCapsFromDefinition(definition: AiAgentDefinition): HelpdeskDailyUsageSummary['cap'] | null {
  const guardrails = nestedPolicy(definition.queue_policy_json, 'economic_guardrails');
  const daily = policyObject(guardrails.daily);
  if (guardrails.configured !== true) {
    return null;
  }
  const maxRuns = positivePolicyNumber(daily.max_agent_runs);
  const maxTokens = positivePolicyNumber(daily.max_estimated_tokens);
  const maxCostEur = positivePolicyNumber(daily.max_estimated_cost_eur);
  if (!maxRuns || !maxTokens || !maxCostEur) {
    return null;
  }
  return { maxRuns, maxTokens, maxCostEur };
}

function numericMetadata(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function addEstimatedUsage(acc: { tokens: number; cost: number }, run: AiRun): void {
  const usage = policyObject(run.usage_json);
  const cost = policyObject(run.cost_json);
  acc.tokens += numericMetadata(usage.estimated_tokens ?? usage.total_tokens);
  acc.cost += numericMetadata(cost.estimated_cost_eur ?? cost.total_cost_eur ?? cost.total_cost);
}

function incrementCounter(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

function median(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function secondsBetween(start: unknown, end: unknown): number | null {
  const startDate = dateFromUnknown(start);
  const endDate = dateFromUnknown(end);
  if (!startDate || !endDate) {
    return null;
  }
  return Math.max(0, Math.round((endDate.getTime() - startDate.getTime()) / 1000));
}

function midnightUtc(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}

function isWithinWindow(date: unknown, start: Date, end: Date): boolean {
  const candidate = date instanceof Date ? date : typeof date === 'string' ? new Date(date) : null;
  if (!candidate || !Number.isFinite(candidate.getTime())) {
    return false;
  }
  return candidate.getTime() >= start.getTime() && candidate.getTime() < end.getTime();
}

function definitionIdFromMetadata(value: unknown): string | null {
  const metadata = policyObject(value);
  return stringFromPolicy(metadata.agent_definition_id);
}

/**
 * Audit-event links are real FKs guarded by a fail-closed tenant trigger, but
 * callers often carry the agent id from metadata (no FK), which survives the
 * agent's deletion. Resolve both links against the tenant before writing so an
 * audit row never fails the operator action it records; the original id is
 * kept in the event metadata for traceability.
 */
export async function resolveAuditEventLinks(
  manager: AiExecutionContextWithManager['manager'],
  tenantId: string,
  links: { agentDefinitionId?: string | null; workItemId?: string | null },
): Promise<{ agentDefinitionId: string | null; workItemId: string | null; orphaned: Record<string, string> }> {
  const orphaned: Record<string, string> = {};
  let agentDefinitionId = links.agentDefinitionId ?? null;
  if (agentDefinitionId) {
    const definition = await manager.getRepository(AiAgentDefinition).findOne({
      where: { id: agentDefinitionId, tenant_id: tenantId },
    });
    if (!definition) {
      orphaned.orphaned_agent_definition_id = agentDefinitionId;
      agentDefinitionId = null;
    }
  }
  let workItemId = links.workItemId ?? null;
  if (workItemId) {
    const workItem = await manager.getRepository(AiAgentWorkItem).findOne({
      where: { id: workItemId, tenant_id: tenantId },
    });
    if (!workItem) {
      orphaned.orphaned_work_item_id = workItemId;
      workItemId = null;
    }
  }
  return { agentDefinitionId, workItemId, orphaned };
}

export function withOrphanedAuditLinks(
  metadata: Record<string, unknown> | null | undefined,
  orphaned: Record<string, string>,
): Record<string, unknown> | null {
  if (Object.keys(orphaned).length === 0) {
    return metadata ?? null;
  }
  return { ...(metadata ?? {}), ...orphaned };
}

function normalizedTargetRef(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes('*')) {
    throw new BadRequestException('Safe target external reference is invalid.');
  }
  if (['all', 'any', 'everyone', 'unrestricted', 'all_tickets', 'all-tickets'].includes(normalized.toLowerCase())) {
    throw new BadRequestException('Broad safe target references are not allowed for agent work items.');
  }
  return normalized;
}

function activePendingAction(action: AiActionRequest, now = Date.now()): boolean {
  if (action.status !== 'pending' && action.status !== 'approved') {
    return false;
  }
  if (!action.expires_at) {
    return true;
  }
  const expiresAt = action.expires_at instanceof Date ? action.expires_at.getTime() : Date.parse(String(action.expires_at));
  return Number.isFinite(expiresAt) && expiresAt > now;
}

function sameNullableTime(left: unknown, right: unknown): boolean {
  const leftDate = dateFromUnknown(left);
  const rightDate = dateFromUnknown(right);
  if (!leftDate && !rightDate) {
    return true;
  }
  return !!leftDate && !!rightDate && leftDate.getTime() === rightDate.getTime();
}

function sameStringSet(left: unknown, right: unknown): boolean {
  const normalize = (value: unknown) => Array.isArray(value)
    ? value.filter((entry) => typeof entry === 'string' && entry.trim().length > 0).sort()
    : [];
  const leftValues = normalize(left);
  const rightValues = normalize(right);
  return leftValues.length === rightValues.length
    && leftValues.every((value, index) => value === rightValues[index]);
}

function dateFromUnknown(value: unknown): Date | null {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function toIsoDate(value: unknown): string | null {
  const date = dateFromUnknown(value);
  return date ? date.toISOString() : null;
}

function clampApprovalTtlSeconds(value: number): number {
  return Math.max(MIN_APPROVAL_TTL_SECONDS, Math.min(MAX_APPROVAL_TTL_SECONDS, Math.floor(value)));
}

// Resolve the agent's single approval window from queue policy. Prefers the new
// approval_ttl_seconds; falls back to the longest entry of the legacy per-action-class map
// (so migrating an existing agent never shortens any proposal's window); else the default.
function normalizeApprovalTtlSeconds(queuePolicy: unknown): number {
  const policy = isRecord(queuePolicy) ? queuePolicy : {};
  const direct = typeof policy.approval_ttl_seconds === 'number'
    ? policy.approval_ttl_seconds
    : Number(policy.approval_ttl_seconds);
  if (Number.isFinite(direct) && direct > 0) {
    return clampApprovalTtlSeconds(direct);
  }
  const legacy = policy.approval_ttl_seconds_by_action_class;
  if (isRecord(legacy)) {
    const seconds = Object.values(legacy)
      .map((raw) => (typeof raw === 'number' ? raw : Number(raw)))
      .filter((raw): raw is number => Number.isFinite(raw) && raw > 0);
    if (seconds.length > 0) {
      return clampApprovalTtlSeconds(Math.max(...seconds));
    }
  }
  return DEFAULT_APPROVAL_TTL_SECONDS;
}

function actionBodyHash(action: AiActionRequest | null): string | null {
  const payload = isRecord(action?.action_payload_json) ? action.action_payload_json : null;
  const body = typeof payload?.body === 'string' ? payload.body.replace(/\r\n/g, '\n').trim() : null;
  return body ? hashStableJson({ body }) : null;
}

const MONITORING_SEVERITY_LADDER = MONITORING_SEVERITY_VALUES as readonly string[];

function monitoringSeverityRank(value: unknown): number {
  return MONITORING_SEVERITY_LADDER.indexOf(String(value ?? '').trim().toLowerCase());
}

// Status classes for the D4 escalation rule: a warning-class alert crossing
// into the down class is new work even inside the same occurrence.
function monitoringStatusClass(value: unknown): 'down' | 'warning' | 'other' {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'down' || status === 'down_partial') {
    return 'down';
  }
  if (status === 'warning' || status === 'unusual') {
    return 'warning';
  }
  return 'other';
}

function monitoringOccurrenceEscalated(
  recordedStatus: unknown,
  recordedSeverity: unknown,
  alert: MonitoringAlertSnapshotInput,
): boolean {
  const recordedRank = monitoringSeverityRank(recordedSeverity);
  const alertRank = monitoringSeverityRank(alert.severity);
  if (recordedRank >= 0 && alertRank > recordedRank) {
    return true;
  }
  return monitoringStatusClass(recordedStatus) === 'warning' && monitoringStatusClass(alert.status) === 'down';
}

@Injectable()
export class AiAgentWorkQueueService {
  private readonly logger = new Logger(AiAgentWorkQueueService.name);

  private definitionRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiAgentDefinition);
  }

  private triggerRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiAgentTrigger);
  }

  private workItemRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiAgentWorkItem);
  }

  private targetStateRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiAgentTargetState);
  }

  private actionRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiActionRequest);
  }

  private runRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiRun);
  }

  private auditRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiAgentAuditEvent);
  }

  private pauseRepo(context: AiExecutionContextWithManager) {
    return context.manager.getRepository(AiEmergencyPause);
  }

  async defaultTicketingProviderKeyForNewDefinition(context: AiExecutionContextWithManager): Promise<string> {
    try {
      // Legacy GLPI settings are the authoritative signal for existing tenants:
      // a tenant with working glpi_* credentials must seed a GLPI-bound agent
      // even when an unrelated ticketing adapter config (e.g. a mock UAT row)
      // also exists. Same predicate as the import-tool gate in ai-tool.registry.
      const settings = await context.manager.getRepository(AiSettings).findOne({
        where: { tenant_id: context.tenantId },
      });
      if (settings?.glpi_enabled === true && settings.glpi_url && settings.glpi_user_token_encrypted) {
        return LEGACY_GLPI_TICKETING_PROVIDER_KEY;
      }
      const configs = await context.manager.getRepository(AiAdapterConfig).find({
        where: {
          tenant_id: context.tenantId,
          provider_kind: 'ticketing',
          enabled: true,
        },
      });
      const providerKeys = Array.from(new Set(configs
        .map((config) => typeof config.provider_key === 'string' ? config.provider_key.trim() : '')
        .filter(Boolean)));
      return providerKeys.length === 1 ? providerKeys[0] : LEGACY_GLPI_TICKETING_PROVIDER_KEY;
    } catch (error) {
      this.logger.warn(
        `Ticketing provider lookup failed while seeding a helpdesk definition; falling back to the legacy default: ${error instanceof Error ? error.message : String(error)}`,
      );
      return LEGACY_GLPI_TICKETING_PROVIDER_KEY;
    }
  }

  assertHelpdeskTicketingDefinitionRunnable(definition: AiAgentDefinition, trigger?: AiAgentTrigger | null): void {
    if (definition.status !== 'enabled') {
      throw codedForbidden('AGENT_TURNED_OFF', 'This agent is turned off. Set its run mode to Manual or Watching first.');
    }
    if (definition.agent_type !== 'helpdesk') {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket triage agent definition has an invalid type.');
    }
    if (!['sandbox', 'lab', 'mock', 'staging'].includes(definition.environment)) {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Helpdesk ticket triage is limited to non-production environments in Phase 11.');
    }
    if (definition.max_autonomy_level !== 'A2' && definition.max_autonomy_level !== 'A3') {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Helpdesk ticket triage cannot widen autonomy beyond A3 in Phase 11.');
    }

    const binding = resolveTicketingBinding(definition);
    if (!binding) {
      throw codedForbidden('AGENT_PROVIDER_REQUIRED', 'Helpdesk ticket triage requires a ticketing provider binding.');
    }

    const triggerPolicy = policyObject(definition.trigger_policy_json);
    const scopePolicy = policyObject(definition.scope_policy_json);
    const queuePolicy = policyObject(definition.queue_policy_json);
    if (queuePolicy.enabled === false) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket triage queue policy is disabled.');
    }
    if (!hasEnabledFlag(triggerPolicy, 'manual_safe_target')) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket triage requires the manual safe-target trigger.');
    }
    if (hasEnabledFlag(triggerPolicy, 'provider_webhook') || hasEnabledFlag(triggerPolicy, 'ticket_update')) {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Provider webhook and ticket-update triggers are not enabled in Phase 11.');
    }
    if (triggerPolicy.automatic_writes_enabled === true) {
      throw codedForbidden('AGENT_AUTOMATIC_WRITES_NOT_ALLOWED', 'Automatic writes are out of scope for Phase 11.');
    }
    if (hasEnabledFlag(scopePolicy, 'all_matching') || scopePolicy.freeform_live_object_ids === true) {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'Broad or free-form live object scopes are not allowed in Phase 11.');
    }
    if (scopePolicy.mode !== 'manual_safe_target' && !jsonArray(scopePolicy.allowed_modes).includes('manual_safe_target')) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket triage scope must allow manual safe targets.');
    }
    if (scopePolicy.provider_kind !== binding.providerKind || scopePolicy.provider_key !== binding.providerKey || scopePolicy.target_kind !== 'ticket') {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket triage scope must target the bound ticketing provider.');
    }
    if (hasEnabledFlag(triggerPolicy, 'scheduled_poll')) {
      this.resolveScopeIngestionConfig(definition);
    } else if (triggerPolicy.production_polling_enabled === true) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Production polling requires a bounded scheduled-poll scope.');
    }

    const allowed = capabilityNames(definition.allowed_capabilities_json);
    const forbidden = capabilityNames(definition.forbidden_capabilities_json);
    for (const required of REQUIRED_HELPDESK_TRIAGE_CAPABILITIES) {
      if (!allowed.has(required)) {
        throw codedForbidden('AGENT_CAPABILITY_NOT_ALLOWED', `Helpdesk ticket triage definition does not allow required capability ${required}.`);
      }
      if (forbidden.has(required) || forbidden.has('*')) {
        throw codedForbidden('AGENT_CAPABILITY_NOT_ALLOWED', `Helpdesk ticket triage definition forbids required capability ${required}.`);
      }
    }

    if (trigger) {
      if (trigger.trigger_kind !== 'manual' || trigger.enabled !== true || trigger.status !== 'enabled') {
        throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket triage manual trigger is not enabled.');
      }
      const triggerScope = policyObject(trigger.scope_policy_json);
      if (triggerScope.provider_kind !== binding.providerKind || triggerScope.provider_key !== binding.providerKey || triggerScope.target_kind !== 'ticket') {
        throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket triage manual trigger scope is invalid.');
      }
    }
  }

  assertSreMonitoringDefinitionRunnable(definition: AiAgentDefinition): void {
    if (definition.status !== 'enabled') {
      throw codedForbidden('AGENT_TURNED_OFF', 'This agent is turned off. Set its run mode to Manual or Watching first.');
    }
    if (definition.agent_type !== 'sre') {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'SRE monitoring diagnosis agent definition has an invalid type.');
    }
    if (!['sandbox', 'lab', 'mock', 'staging'].includes(definition.environment)) {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', 'SRE monitoring diagnosis is limited to non-production environments in Phase 15.A.');
    }
    if (!['A1', 'A2', 'A3'].includes(definition.max_autonomy_level)) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'SRE monitoring diagnosis requires an autonomy ceiling between A1 and A3.');
    }
    if (!resolveMonitoringBinding(definition)) {
      throw codedForbidden('AGENT_PROVIDER_REQUIRED', 'SRE monitoring diagnosis requires a monitoring provider binding.');
    }
    const queuePolicy = policyObject(definition.queue_policy_json);
    if (queuePolicy.enabled === false) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'SRE monitoring diagnosis queue policy is disabled.');
    }
    const triggerPolicy = policyObject(definition.trigger_policy_json);
    if (triggerPolicy.automatic_writes_enabled === true) {
      throw codedForbidden('AGENT_AUTOMATIC_WRITES_NOT_ALLOWED', 'Automatic writes are out of scope for SRE monitoring diagnosis in Phase 15.A.');
    }
    const allowed = capabilityNames(definition.allowed_capabilities_json);
    const forbidden = capabilityNames(definition.forbidden_capabilities_json);
    for (const required of REQUIRED_SRE_DIAGNOSIS_CAPABILITIES) {
      if (!allowed.has(required)) {
        throw codedForbidden('AGENT_CAPABILITY_NOT_ALLOWED', `SRE monitoring diagnosis definition does not allow required capability ${required}.`);
      }
      if (forbidden.has(required) || forbidden.has('*')) {
        throw codedForbidden('AGENT_CAPABILITY_NOT_ALLOWED', `SRE monitoring diagnosis definition forbids required capability ${required}.`);
      }
    }
  }

  // Resolve the alert-selection scope for an SRE agent. Monitoring is
  // greenfield: canonical targeting predicates are the only selection model
  // (no legacy mode blocks); the optional scope_policy_json.ingestion block
  // carries the per-cycle caps.
  resolveMonitoringScopeIngestionConfig(
    definition: AiAgentDefinition,
    opts: ScopeIngestionResolveOptions = {},
  ): MonitoringIngestionConfig {
    const triggerPolicy = policyObject(definition.trigger_policy_json);
    const scopePolicy = policyObject(definition.scope_policy_json);
    // Run modes: Off (status disabled) does nothing, Manual runs on an explicit
    // "Check for alerts" only, Watching adds the scheduled cron. Only the
    // scheduled trigger requires scheduled_poll; a manual check is the operator
    // asking for one cycle right now. Off is still blocked upstream, by the
    // status filter in the poller's loadDefinitions and by the runnable assert.
    if (opts.trigger !== 'manual' && !hasEnabledFlag(triggerPolicy, 'scheduled_poll')) {
      throw codedForbidden('AGENT_WATCHING_OFF', 'Automatic alert watching is turned off. Enable it in the agent settings.');
    }
    if (triggerPolicy.automatic_writes_enabled === true) {
      throw codedForbidden('AGENT_AUTOMATIC_WRITES_NOT_ALLOWED', 'Monitoring alert ingestion cannot run with automatic writes enabled.');
    }
    if (!runGuardrailsFromDefinition(definition) || !dailyGuardrailCapsFromDefinition(definition)) {
      throw codedForbidden('AGENT_GUARDRAILS_MISSING', 'Monitoring alert ingestion requires configured economic guardrails.');
    }
    // Fail-closed predicate validation: a bad predicate rejects the whole cycle.
    const targeting = normalizeMonitoringTargeting(scopePolicy);
    const ingestion = nestedPolicy(scopePolicy, 'ingestion');
    return {
      enabled: true,
      enabledAt: isoFromPolicy(ingestion.enabled_at) ?? new Date().toISOString(),
      maxAlertsPerCycle: numberPolicyOrNull(ingestion.max_alerts_per_cycle, 1, 20)
        ?? DEFAULT_MONITORING_ALERTS_PER_CYCLE,
      maxProviderRequestsPerCycle: numberPolicyOrNull(ingestion.max_provider_requests_per_cycle, 1, 100)
        ?? DEFAULT_MONITORING_REQUESTS_PER_CYCLE,
      targeting,
    };
  }

  resolveNewTicketsIngestionConfig(definition: AiAgentDefinition): HelpdeskNewTicketsIngestionConfig {
    const config = this.resolveScopeIngestionConfig(definition);
    if (config.mode !== 'new_tickets_only') {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket new-ticket ingestion requires a created-at targeting predicate.');
    }
    return config;
  }

  // Resolve the configured ticket-selection scope for an agent. Canonical
  // targeting predicates are the source of truth; legacy mode blocks remain as
  // compatibility storage for enablement timestamps, per-cycle caps, and older
  // agents. The provider fetch is still bounded and every candidate is locally
  // rechecked against the complete predicate set after listing.
  resolveScopeIngestionConfig(
    definition: AiAgentDefinition,
    opts: ScopeIngestionResolveOptions = {},
  ): HelpdeskNewTicketsIngestionConfig {
    const triggerPolicy = policyObject(definition.trigger_policy_json);
    const rawScopePolicy = policyObject(definition.scope_policy_json);
    const scopePolicy = policyObject(normalizeServiceDeskScopePolicy(rawScopePolicy));
    const targeting = normalizeServiceDeskTargeting(scopePolicy);
    const derivedScope = deriveServiceDeskTargetingFetchConfig(targeting);
    const rawHasTargeting = isRecord(rawScopePolicy.targeting) && Array.isArray(rawScopePolicy.targeting.predicates);

    // See resolveMonitoringScopeIngestionConfig: only the scheduled trigger
    // requires watching to be on. A manual "Check now" is allowed in Manual run
    // mode (definition enabled, scheduled poll off) and blocked when the agent
    // is Off by assertHelpdeskTicketingDefinitionRunnable's status check.
    if (opts.trigger !== 'manual' && !hasEnabledFlag(triggerPolicy, 'scheduled_poll')) {
      throw codedForbidden('AGENT_WATCHING_OFF', 'Automatic ticket watching is turned off. Enable it in the agent settings.');
    }
    if (triggerPolicy.automatic_writes_enabled === true) {
      throw codedForbidden('AGENT_AUTOMATIC_WRITES_NOT_ALLOWED', 'Helpdesk ticket ingestion cannot run with automatic writes enabled.');
    }
    if (hasEnabledFlag(scopePolicy, 'all_matching') || scopePolicy.freeform_live_object_ids === true) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Helpdesk ticket ingestion requires a bounded scope.');
    }

    const mode = derivedScope.mode;
    const modeBlock = nestedPolicy(scopePolicy, mode);
    const legacyMode = stringFromPolicy(scopePolicy.mode);
    const legacyBlock = legacyMode ? nestedPolicy(scopePolicy, legacyMode) : {};
    const newTicketsOnly = nestedPolicy(scopePolicy, 'new_tickets_only');
    const allOpen = nestedPolicy(scopePolicy, 'all_open');
    const agentInvolved = nestedPolicy(scopePolicy, 'agent_involved');
    const candidateBlocks = [modeBlock, legacyBlock, newTicketsOnly, allOpen, agentInvolved];
    const configBlock = candidateBlocks.find((block) =>
      block.enabled === true
      || block.max_tickets_per_cycle != null
      || block.max_provider_requests_per_cycle != null,
    ) ?? {};
    const explicitActiveBlock = [modeBlock, legacyBlock].find((block) => block.enabled === true);
    if (
      explicitActiveBlock
      && (
        !numberPolicyOrNull(explicitActiveBlock.max_tickets_per_cycle, 1, 20)
        || !numberPolicyOrNull(explicitActiveBlock.max_provider_requests_per_cycle, 1, 100)
      )
    ) {
      throw codedForbidden('AGENT_GUARDRAILS_MISSING', 'This ticket-selection mode requires explicit per-cycle ticket and provider-request limits.');
    }
    const enabledAt = isoFromPolicy(configBlock.enabled_at)
      ?? isoFromPolicy(newTicketsOnly.enabled_at)
      ?? isoFromPolicy(allOpen.enabled_at)
      ?? isoFromPolicy(agentInvolved.enabled_at)
      ?? new Date().toISOString();
    const maxTicketsPerCycle = numberPolicyOrNull(configBlock.max_tickets_per_cycle, 1, 20)
      ?? DEFAULT_NEW_TICKET_MAX_PER_CYCLE;
    const maxProviderRequestsPerCycle = numberPolicyOrNull(configBlock.max_provider_requests_per_cycle, 1, 100)
      ?? DEFAULT_NEW_TICKET_RATE_LIMIT_PER_CYCLE;
    if (!runGuardrailsFromDefinition(definition) || !dailyGuardrailCapsFromDefinition(definition)) {
      throw codedForbidden('AGENT_GUARDRAILS_MISSING', 'Helpdesk ticket ingestion requires configured economic guardrails.');
    }

    const horizonHours = derivedScope.createdAfterRelativeHours
      ?? numberPolicyOrNull(newTicketsOnly.hard_backfill_horizon_hours, 1, 24 * 30)
      ?? DEFAULT_BACKFILL_HORIZON_HOURS;
    const createdAfter = mode === 'new_tickets_only'
      ? derivedScope.createdAfter ?? new Date(Date.now() - horizonHours * 60 * 60 * 1000).toISOString()
      : null;
    const lastChangedBefore = derivedScope.lastChangedBefore;
    const entityId = derivedScope.entityId
      ?? (!rawHasTargeting ? stringFromPolicy(configBlock.entity_id ?? configBlock.entityId) : null);
    const categoryId = derivedScope.categoryId
      ?? (!rawHasTargeting ? stringFromPolicy(configBlock.category_id ?? configBlock.categoryId) : null);

    return {
      enabled: true,
      mode,
      enabledAt,
      createdAfter,
      lastChangedBefore,
      statusValues: derivedScope.statusValues,
      entityId,
      categoryId,
      maxTicketsPerCycle,
      maxProviderRequestsPerCycle,
    };
  }

  // Ticket refs this agent previously acted on (agent_touched target states),
  // oldest-updated first. Backs the `agent_involved` scope mode — control-plane
  // state, kept out of ticketing providers.
  async listAgentTouchedTicketRefs(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    limit: number,
  ): Promise<string[]> {
    const binding = requireTicketingBinding(definition);
    const rows = await this.targetStateRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: definition.id,
        provider_kind: binding.providerKind,
        provider_key: binding.providerKey,
        target_type: 'ticket',
        agent_touched: true,
      },
      order: { updated_at: 'ASC' },
      take: Math.max(1, Math.min(Math.floor(limit), 20)),
    });
    return rows
      .map((row) => row.target_ref)
      .filter((ref): ref is string => typeof ref === 'string' && ref.trim().length > 0);
  }

  runGuardrails(definition: AiAgentDefinition): HelpdeskRunGuardrailSummary {
    const guardrails = runGuardrailsFromDefinition(definition);
    if (!guardrails) {
      throw codedForbidden('AGENT_GUARDRAILS_MISSING', 'Helpdesk ticket triage run guardrails are not configured.');
    }
    return guardrails;
  }

  private buildIngestionSettingsView(definition: AiAgentDefinition): HelpdeskTicketingIngestionSettingsView {
    const triggerPolicy = policyObject(definition.trigger_policy_json);
    const scopePolicy = policyObject(normalizeServiceDeskScopePolicy(definition.scope_policy_json));
    const queuePolicy = policyObject(definition.queue_policy_json);
    const ingestion = nestedPolicy(scopePolicy, 'new_tickets_only');
    const guardrails = nestedPolicy(queuePolicy, 'economic_guardrails');
    const perRun = policyObject(guardrails.per_run);
    const daily = policyObject(guardrails.daily);

    let ready = true;
    let readyReason: string | null = null;
    let effectiveCreatedAfter: string | null = null;
    try {
      this.assertHelpdeskTicketingDefinitionRunnable(definition, null);
      const config = this.resolveScopeIngestionConfig(definition);
      effectiveCreatedAfter = config.createdAfter;
    } catch (error) {
      ready = false;
      readyReason = error instanceof Error ? error.message : String(error);
    }

    return {
      agentDefinitionId: definition.id,
      ingestion: {
        enabled: hasEnabledFlag(triggerPolicy, 'scheduled_poll') && ingestion.enabled === true,
        enabledAt: isoFromPolicy(ingestion.enabled_at),
        entityId: stringFromPolicy(ingestion.entity_id ?? ingestion.entityId),
        categoryId: stringFromPolicy(ingestion.category_id ?? ingestion.categoryId),
        maxTicketsPerCycle: numberPolicyOrNull(ingestion.max_tickets_per_cycle, 1, 20),
        maxProviderRequestsPerCycle: numberPolicyOrNull(ingestion.max_provider_requests_per_cycle, 1, 100),
        hardBackfillHorizonHours: numberPolicyOrNull(ingestion.hard_backfill_horizon_hours, 1, 24 * 30)
          ?? DEFAULT_BACKFILL_HORIZON_HOURS,
        ready,
        readyReason,
        effectiveCreatedAfter,
      },
      guardrails: {
        configured: guardrails.configured === true,
        perRun: {
          maxEstimatedTokens: positivePolicyNumber(perRun.max_estimated_tokens),
          maxEstimatedCostEur: positivePolicyNumber(perRun.max_estimated_cost_eur),
        },
        daily: {
          maxAgentRuns: positivePolicyNumber(daily.max_agent_runs),
          maxEstimatedTokens: positivePolicyNumber(daily.max_estimated_tokens),
          maxEstimatedCostEur: positivePolicyNumber(daily.max_estimated_cost_eur),
        },
      },
    };
  }

  workItemDedupKey(input: {
    agentDefinitionId: string;
    providerKind: string;
    providerKey: string;
    objectType: string;
    objectRef: string;
    workKind: string;
  }): string {
    return hashStableJson({
      agent_definition_id: input.agentDefinitionId,
      provider_kind: input.providerKind,
      provider_key: input.providerKey,
      object_type: input.objectType,
      object_ref: input.objectRef,
      work_kind: input.workKind,
    });
  }

  private queuePolicyNumber(definition: AiAgentDefinition, key: string, fallback: number, min: number, max: number): number {
    return numberFromPolicy(policyObject(definition.queue_policy_json)[key], fallback, min, max);
  }

  agentPriority(definition: AiAgentDefinition): number {
    return numberFromPolicy(definition.agent_priority, 100, 0, 1000);
  }

  reviewCooldownSeconds(definition: AiAgentDefinition): number {
    return this.queuePolicyNumber(definition, 'review_cooldown_seconds', DEFAULT_REVIEW_COOLDOWN_SECONDS, 60, 30 * 24 * 60 * 60);
  }

  private targetClaimLeaseSeconds(definition: AiAgentDefinition): number {
    return this.queuePolicyNumber(definition, 'claim_lease_seconds', DEFAULT_TARGET_CLAIM_LEASE_SECONDS, 30, 24 * 60 * 60);
  }

  private onConflict(definition: AiAgentDefinition): 'defer' | 'supersede' {
    return policyObject(definition.queue_policy_json).on_conflict === 'supersede' ? 'supersede' : 'defer';
  }

  scheduleNextReviewAt(definition: AiAgentDefinition, now = new Date()): Date {
    return new Date(now.getTime() + this.reviewCooldownSeconds(definition) * 1000);
  }

  private retryCooldownSeconds(definition: AiAgentDefinition, attemptCount: number): number {
    const policy = policyObject(definition.queue_policy_json);
    const backoff = jsonArray(policy.retry_backoff_seconds)
      .map((entry) => typeof entry === 'number' && Number.isFinite(entry) ? Math.max(1, Math.floor(entry)) : null)
      .filter((entry): entry is number => entry !== null);
    return backoff[Math.max(0, attemptCount - 1)]
      ?? numberFromPolicy(policy.cooldown_seconds, DEFAULT_COOLDOWN_SECONDS, 1, 86_400);
  }

  private async refreshResolvedWaitingApproval(
    context: AiExecutionContextWithManager,
    workItem: AiAgentWorkItem,
  ): Promise<AiAgentWorkItem | null> {
    if (workItem.status !== 'waiting_approval') {
      return workItem;
    }
    const actionIds = (workItem.last_action_request_ids ?? []).filter((id) => typeof id === 'string' && id.length > 0);
    if (actionIds.length === 0) {
      await this.completeWorkItem(context, workItem);
      await this.releaseWorkItemTargetClaim(context, workItem, 'waiting_approval_without_actions_resolved');
      return null;
    }
    const linked = await this.actionRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        id: In(actionIds),
      },
    });
    if (linked.length === actionIds.length && linked.every((action) => !activePendingAction(action))) {
      await this.completeWorkItem(context, workItem);
      await this.releaseWorkItemTargetClaim(context, workItem, 'waiting_approval_actions_terminal');
      return null;
    }
    return workItem;
  }

  async resolveWaitingApprovalForActionRequest(
    context: AiExecutionContextWithManager,
    actionRequestId: string,
  ): Promise<AiAgentWorkItem | null> {
    const action = await this.actionRepo(context).findOne({
      where: {
        tenant_id: context.tenantId,
        id: actionRequestId,
      },
    });
    const metadata = action && isRecord(action.metadata_json) ? action.metadata_json : {};
    const workItemId = typeof metadata.agent_work_item_id === 'string' ? metadata.agent_work_item_id : null;
    if (!workItemId) {
      return null;
    }
    const workItem = await this.workItemRepo(context).findOne({
      where: {
        tenant_id: context.tenantId,
        id: workItemId,
      },
    });
    if (!workItem) {
      return null;
    }
    return this.refreshResolvedWaitingApproval(context, workItem);
  }

  async reconcileWaitingApprovalWorkItems(
    context: AiExecutionContextWithManager,
    opts: { limit?: number } = {},
  ): Promise<{ scanned: number; resolved: number }> {
    const limit = Math.max(1, Math.min(Math.floor(opts.limit ?? 100), 500));
    const workItems = await this.workItemRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        status: 'waiting_approval',
      },
      order: { updated_at: 'ASC' },
      take: limit,
    });
    let resolved = 0;
    for (const workItem of workItems) {
      const refreshed = await this.refreshResolvedWaitingApproval(context, workItem);
      if (refreshed === null) {
        resolved += 1;
      }
    }
    return { scanned: workItems.length, resolved };
  }

  private async findActiveWorkItem(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    dedupKey: string,
  ): Promise<AiAgentWorkItem | null> {
    const rows = await this.workItemRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: definition.id,
      },
    });
    const existing = rows
      .filter((row) => row.dedup_key === dedupKey && ACTIVE_WORK_ITEM_STATUSES.has(row.status))
      .sort((left, right) => {
        const leftTime = left.updated_at instanceof Date ? left.updated_at.getTime() : Date.parse(String(left.updated_at ?? ''));
        const rightTime = right.updated_at instanceof Date ? right.updated_at.getTime() : Date.parse(String(right.updated_at ?? ''));
        return rightTime - leftTime;
      })[0] ?? null;
    return existing ? this.refreshResolvedWaitingApproval(context, existing) : null;
  }

  async enqueueTicketingScopedTicket(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      ticket: {
        id: string;
        updatedAt?: string | null;
        updated_at?: string | null;
        createdAt?: string | null;
        scope?: {
          entityId?: string | null;
          categoryId?: string | null;
        } | null;
      };
      providerKind?: string | null;
      providerKey?: string | null;
      metadata?: Record<string, unknown> | null;
      // Defaults to the cron trigger. Operator-driven enqueues (a manual check,
      // a test run, an approved-write follow-up) pass 'manual' so an agent in
      // Manual run mode — on, but not watching — can still be queued.
      trigger?: 'scheduled' | 'manual';
    },
  ): Promise<{ workItem: AiAgentWorkItem; created: boolean }> {
    this.assertHelpdeskTicketingDefinitionRunnable(input.definition, null);
    this.resolveScopeIngestionConfig(input.definition, { trigger: input.trigger });
    const binding = requireTicketingBinding(input.definition);
    const providerKind = input.providerKind ?? binding.providerKind;
    const providerKey = input.providerKey ?? binding.providerKey;
    if (providerKind !== binding.providerKind || providerKey !== binding.providerKey) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Ticketing work item source must match the bound ticketing provider.');
    }
    const targetRef = normalizedTargetRef(input.ticket.id);
    const dedupKey = this.workItemDedupKey({
      agentDefinitionId: input.definition.id,
      providerKind,
      providerKey,
      objectType: 'ticket',
      objectRef: targetRef,
      workKind: HELP_DESK_TICKETING_TRIAGE_WORK_KIND,
    });
    const existing = await this.findActiveWorkItem(context, input.definition, dedupKey);
    if (existing) {
      return { workItem: existing, created: false };
    }

    const repo = this.workItemRepo(context);
    const now = new Date();
    const workItem = await repo.save(repo.create({
      tenant_id: context.tenantId,
      agent_definition_id: input.definition.id,
      trigger_id: null,
      source_provider_kind: providerKind,
      source_provider_key: providerKey,
      source_object_type: 'ticket',
      source_object_ref: targetRef,
      source_object_updated_at: dateFromUnknown(input.ticket.updatedAt ?? input.ticket.updated_at ?? input.ticket.createdAt),
      work_kind: HELP_DESK_TICKETING_TRIAGE_WORK_KIND,
      status: 'queued',
      priority: 100,
      dedup_key: dedupKey,
      lease_owner: null,
      leased_until: null,
      attempt_count: 0,
      max_attempts: this.queuePolicyNumber(input.definition, 'max_attempts', DEFAULT_MAX_ATTEMPTS, 1, 20),
      next_attempt_at: now,
      last_run_id: null,
      last_action_request_ids: null,
      last_error: null,
      metadata_json: {
        source: 'scheduled_new_tickets_only',
        poller_scope: {
          entity_id: input.ticket.scope?.entityId ?? null,
          category_id: input.ticket.scope?.categoryId ?? null,
        },
        ticket_created_at: input.ticket.createdAt ?? null,
        ticket_updated_at: input.ticket.updatedAt ?? input.ticket.updated_at ?? null,
        ...(input.metadata ?? {}),
      },
      created_at: now,
      updated_at: now,
    }));

    return { workItem, created: true };
  }

  // Occurrence-level dedup gate (D4): a fetched alert is NEW WORK only when no
  // active work item exists for its occurrence dedup key AND the target state
  // has no recorded occurrence (or a different/escalated one). The ±1 minute
  // tolerance absorbs provider-side occurrence-timestamp jitter (IMPL-2).
  async monitoringOccurrenceReadiness(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      alert: MonitoringAlertSnapshotInput;
      dedupKey: string;
      now?: Date;
    },
  ): Promise<MonitoringOccurrenceReadiness> {
    const binding = requireMonitoringBinding(input.definition);
    const targetRef = normalizedTargetRef(input.alert.id);
    const state = await this.targetStateRepo(context).findOne({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: input.definition.id,
        provider_kind: binding.providerKind,
        provider_key: binding.providerKey,
        target_type: 'sensor',
        target_ref: targetRef,
      },
    });
    const activeItem = await this.findActiveWorkItem(context, input.definition, input.dedupKey);
    if (activeItem) {
      return { state: state ?? null, ready: false, reason: 'active_work_item' };
    }
    const stateJson = policyObject(state?.state_json);
    const recordedOccurrence = stringFromPolicy(stateJson.occurrence_started_at);
    // "No occurrence in progress" is the open marker's call, NOT the
    // timestamp's: a provider that exposes no occurrence timestamp for an
    // active alarm (nullable by contract) must still dedup as the same
    // occurrence on later polls instead of re-entering first_occurrence.
    if (!state || !monitoringOccurrenceOpen(stateJson)) {
      return { state: state ?? null, ready: true, reason: 'first_occurrence' };
    }
    const recordedMs = dateFromUnknown(recordedOccurrence)?.getTime() ?? null;
    const fetchedMs = dateFromUnknown(input.alert.occurrenceStartedAt)?.getTime() ?? null;
    if (recordedMs != null && fetchedMs != null && Math.abs(fetchedMs - recordedMs) > MONITORING_OCCURRENCE_TOLERANCE_MS) {
      return { state, ready: true, reason: 'new_occurrence' };
    }
    if (monitoringOccurrenceEscalated(stateJson.last_status, stateJson.last_severity, input.alert)) {
      return { state, ready: true, reason: 'escalated' };
    }
    // A dead-lettered diagnosis for a STILL-OPEN occurrence retries on a slow
    // backoff: the failure cause may have been transient or fixed since (e.g.
    // a raised provider timeout), and an open incident without a stored
    // diagnosis is exactly what the agent exists to explain. The dedup key is
    // occurrence-scoped, so past occurrences can never be replayed, and the
    // backoff keeps a persistently failing occurrence from burning a work
    // item every cycle.
    const latest = await this.findLatestWorkItemForDedupKey(context, input.definition, input.dedupKey);
    if (latest?.status === 'dead_letter') {
      const nowMs = (input.now ?? new Date()).getTime();
      const latestMs = latest.updated_at instanceof Date
        ? latest.updated_at.getTime()
        : Date.parse(String(latest.updated_at ?? ''));
      if (Number.isFinite(latestMs) && nowMs - latestMs >= MONITORING_DEAD_LETTER_RETRY_BACKOFF_MS) {
        return { state, ready: true, reason: 'retry_after_dead_letter' };
      }
    }
    return { state, ready: false, reason: 'duplicate_occurrence' };
  }

  private async findLatestWorkItemForDedupKey(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    dedupKey: string,
  ): Promise<AiAgentWorkItem | null> {
    const rows = await this.workItemRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: definition.id,
      },
    });
    const matching = rows
      .filter((row) => row.dedup_key === dedupKey)
      .sort((left, right) => {
        const leftTime = left.updated_at instanceof Date ? left.updated_at.getTime() : Date.parse(String(left.updated_at ?? ''));
        const rightTime = right.updated_at instanceof Date ? right.updated_at.getTime() : Date.parse(String(right.updated_at ?? ''));
        return rightTime - leftTime;
      });
    return matching[0] ?? null;
  }

  async enqueueMonitoringScopedAlert(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      alert: MonitoringAlertSnapshotInput;
      dedupKey: string;
      providerKind?: string | null;
      providerKey?: string | null;
      priority?: number | null;
      metadata?: Record<string, unknown> | null;
      // See enqueueTicketingScopedTicket: 'manual' lets an operator-driven
      // enqueue run while the scheduled poll is off.
      trigger?: 'scheduled' | 'manual';
    },
  ): Promise<{ workItem: AiAgentWorkItem; created: boolean }> {
    this.assertSreMonitoringDefinitionRunnable(input.definition);
    this.resolveMonitoringScopeIngestionConfig(input.definition, { trigger: input.trigger });
    const binding = requireMonitoringBinding(input.definition);
    const providerKind = input.providerKind ?? binding.providerKind;
    const providerKey = input.providerKey ?? binding.providerKey;
    if (providerKind !== binding.providerKind || providerKey !== binding.providerKey) {
      throw codedForbidden('AGENT_SETTINGS_INVALID', 'Monitoring work item source must match the bound monitoring provider.');
    }
    const targetRef = normalizedTargetRef(input.alert.id);
    const dedupKey = typeof input.dedupKey === 'string' ? input.dedupKey.trim() : '';
    if (!dedupKey) {
      throw new BadRequestException('Monitoring work items require an occurrence dedup key.');
    }
    const existing = await this.findActiveWorkItem(context, input.definition, dedupKey);
    if (existing) {
      return { workItem: existing, created: false };
    }

    const repo = this.workItemRepo(context);
    const now = new Date();
    const workItem = await repo.save(repo.create({
      tenant_id: context.tenantId,
      agent_definition_id: input.definition.id,
      trigger_id: null,
      source_provider_kind: providerKind,
      source_provider_key: providerKey,
      source_object_type: 'sensor',
      source_object_ref: targetRef,
      source_object_updated_at: dateFromUnknown(input.alert.observedAt ?? input.alert.occurrenceStartedAt),
      work_kind: MONITORING_ALERT_DIAGNOSTIC_WORK_KIND,
      status: 'queued',
      priority: typeof input.priority === 'number' ? numberFromPolicy(input.priority, 100, 0, 1000) : 100,
      dedup_key: dedupKey,
      lease_owner: null,
      leased_until: null,
      attempt_count: 0,
      max_attempts: this.queuePolicyNumber(input.definition, 'max_attempts', DEFAULT_MAX_ATTEMPTS, 1, 20),
      next_attempt_at: now,
      last_run_id: null,
      last_action_request_ids: null,
      last_error: null,
      metadata_json: {
        source: 'scheduled_monitoring_alerts',
        // Compact snapshot only — the alert message is untrusted provider text
        // and never persisted on queue rows.
        alert: {
          status: stringFromPolicy(input.alert.status),
          severity: stringFromPolicy(input.alert.severity),
          device_name: stringFromPolicy(input.alert.deviceName),
          occurrence_started_at: stringFromPolicy(input.alert.occurrenceStartedAt),
          source_uri: stringFromPolicy(input.alert.sourceUri),
        },
        ...(input.metadata ?? {}),
      },
      created_at: now,
      updated_at: now,
    }));

    // Record the occurrence at enqueue time (not completion): a dead-lettered
    // item must not re-enqueue the same occurrence forever, and a fresh
    // occurrence clears any prior re-arm marker.
    await this.upsertTargetState(context, {
      agentDefinitionId: input.definition.id,
      providerKind,
      providerKey,
      targetType: 'sensor',
      targetRef,
      lastSeenExternalUpdatedAt: input.alert.observedAt ?? input.alert.occurrenceStartedAt ?? null,
      state: {
        occurrence_started_at: stringFromPolicy(input.alert.occurrenceStartedAt),
        // Occurrence in progress even when the provider exposes no timestamp
        // for it — the open marker is what later readiness checks consult.
        occurrence_open: true,
        last_status: stringFromPolicy(input.alert.status),
        last_severity: stringFromPolicy(input.alert.severity),
        cleared_at: null,
        latest_enqueued_work_item_id: workItem.id,
      },
    });

    return { workItem, created: true };
  }

  // Re-arm on clear (D4): an alert absent from a fetch that covered it — or
  // present with status up — has ended its occurrence, so the next non-up
  // occurrence becomes new work. A truncated fetch proves nothing about
  // absence, so clearances are only recorded for untruncated fetches.
  async reconcileMonitoringOccurrenceClearances(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      fetchedAlerts: Array<{ id: string; status?: string | null }>;
      fetchTruncated: boolean;
      now?: Date;
    },
  ): Promise<{ rearmed: number }> {
    if (input.fetchTruncated) {
      return { rearmed: 0 };
    }
    const binding = requireMonitoringBinding(input.definition);
    const now = input.now ?? new Date();
    const states = await this.targetStateRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: input.definition.id,
        provider_kind: binding.providerKind,
        provider_key: binding.providerKey,
        target_type: 'sensor',
      },
    });
    const fetchedById = new Map(input.fetchedAlerts
      .map((alert) => [String(alert.id ?? '').trim(), alert] as const)
      .filter(([id]) => id.length > 0));
    let rearmed = 0;
    for (const state of states) {
      const stateJson = policyObject(state.state_json);
      // Open marker, not timestamp: occurrences recorded without a provider
      // occurrence timestamp must re-arm on clearance too.
      if (!monitoringOccurrenceOpen(stateJson)) {
        continue;
      }
      const fetched = fetchedById.get(state.target_ref) ?? null;
      const fetchedStatus = fetched ? String(fetched.status ?? '').trim().toLowerCase() : null;
      if (fetched && fetchedStatus !== 'up') {
        continue;
      }
      await this.upsertTargetState(context, {
        agentDefinitionId: input.definition.id,
        providerKind: binding.providerKind,
        providerKey: binding.providerKey,
        targetType: 'sensor',
        targetRef: state.target_ref,
        state: {
          occurrence_started_at: null,
          occurrence_open: false,
          last_status: fetchedStatus ?? 'up',
          cleared_at: now.toISOString(),
        },
      });
      rearmed += 1;
    }
    return { rearmed };
  }

  // Monitoring sibling of recordManualTicketingTriageOutcome for the
  // recommendation-free diagnosis skeleton: no action requests, so the work
  // item always completes and the whole-target claim is released.
  async recordMonitoringDiagnosisOutcome(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      workItem: AiAgentWorkItem;
      runId: string | null;
      alert: MonitoringAlertSnapshotInput;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<{ workItem: AiAgentWorkItem; targetState: AiAgentTargetState }> {
    const externalUpdatedAt = input.alert.observedAt ?? input.alert.occurrenceStartedAt ?? null;
    const targetState = await this.upsertTargetState(context, {
      agentDefinitionId: input.definition.id,
      providerKind: input.workItem.source_provider_kind,
      providerKey: input.workItem.source_provider_key,
      targetType: input.workItem.source_object_type,
      targetRef: input.workItem.source_object_ref,
      lastSeenExternalUpdatedAt: externalUpdatedAt,
      lastProcessedExternalUpdatedAt: externalUpdatedAt,
      nextReviewAt: this.scheduleNextReviewAt(input.definition),
      lastRunId: input.runId,
      agentTouched: true,
      needsFollowup: false,
      state: {
        occurrence_started_at: stringFromPolicy(input.alert.occurrenceStartedAt),
        // Occurrence stays in progress until the alert is back up (the
        // alert-cleared escape reports status 'up'); the flag — not the
        // nullable timestamp — is what dedup and touched_by consult.
        occurrence_open: (stringFromPolicy(input.alert.status)?.toLowerCase() ?? '') !== 'up',
        last_status: stringFromPolicy(input.alert.status),
        last_severity: stringFromPolicy(input.alert.severity),
        last_diagnosis_at: new Date().toISOString(),
        latest_work_item_id: input.workItem.id,
        ...(input.metadata ?? {}),
      },
    });

    const workItem = await this.completeWorkItem(context, input.workItem, {
      runId: input.runId,
      actionRequestIds: [],
      metadata: {
        latest_target_state_id: targetState.id,
        ...(input.metadata ?? {}),
      },
    });
    await this.releaseWorkItemTargetClaim(context, workItem, 'diagnosis_completed_without_pending_proposals');
    return { workItem, targetState };
  }

  async acquireWorkItem(
    context: AiExecutionContextWithManager,
    workItemId: string,
    options: { leaseOwner: string; now?: Date } = { leaseOwner: 'agent-control-center' },
  ): Promise<AiAgentWorkItem> {
    const repo = this.workItemRepo(context);
    const workItem = await repo.findOne({ where: { id: workItemId, tenant_id: context.tenantId } });
    if (!workItem) {
      throw new NotFoundException('Agent work item not found.');
    }
    if (TERMINAL_WORK_ITEM_STATUSES.has(workItem.status) || workItem.status === 'waiting_approval') {
      throw codedForbidden('AGENT_WORK_ITEM_NOT_RUNNABLE', 'Agent work item is not runnable.');
    }
    if (!RETRYABLE_WORK_ITEM_STATUSES.has(workItem.status)) {
      throw codedForbidden('AGENT_WORK_ITEM_NOT_RUNNABLE', 'Agent work item is not in a leaseable state.');
    }

    const now = options.now ?? new Date();
    const leaseExpiry = dateFromUnknown(workItem.leased_until);
    if ((workItem.status === 'leased' || workItem.status === 'running') && leaseExpiry && leaseExpiry.getTime() > now.getTime()) {
      throw codedForbidden('AGENT_WORK_ITEM_BUSY', 'Agent work item is already leased.');
    }
    const nextAttempt = dateFromUnknown(workItem.next_attempt_at);
    if (nextAttempt && nextAttempt.getTime() > now.getTime()) {
      throw codedForbidden('AGENT_WORK_ITEM_BUSY', 'Agent work item is cooling down before retry.');
    }
    if (workItem.attempt_count >= workItem.max_attempts) {
      this.applyWorkItemTransition(workItem, 'dead_letter', now);
      workItem.lease_owner = null;
      workItem.leased_until = null;
      workItem.last_error = workItem.last_error ?? 'Maximum attempts reached.';
      await repo.save(workItem);
      await this.recordAuditEvent(context, {
        agentDefinitionId: workItem.agent_definition_id,
        workItemId: workItem.id,
        eventType: 'work_item_dead_letter',
        severity: 'error',
        message: workItem.last_error ?? 'Maximum attempts reached.',
        metadata: {
          attempt_count: workItem.attempt_count,
          max_attempts: workItem.max_attempts,
          work_kind: workItem.work_kind,
          source_object_ref: workItem.source_object_ref,
        },
      });
      throw codedForbidden('AGENT_WORK_ITEM_NOT_RUNNABLE', 'Agent work item exceeded its maximum attempts.');
    }

    const definition = await this.definitionRepo(context).findOne({
      where: {
        id: workItem.agent_definition_id,
        tenant_id: context.tenantId,
      },
    });
    if (!definition) {
      throw codedForbidden('AGENT_WORK_ITEM_NOT_RUNNABLE', 'Agent work item has no tenant-scoped definition.');
    }
    // Whole-target claim integration: ticketing tickets and monitoring sensors
    // share the same claim key machinery (tenant + provider kind/key + target
    // type/ref) with unchanged collision semantics.
    const claimEligible = !!workItem.source_provider_key
      && !!workItem.source_object_ref
      && (
        (workItem.source_provider_kind === 'ticketing' && workItem.source_object_type === 'ticket')
        || (workItem.source_provider_kind === 'monitoring' && workItem.source_object_type === 'sensor')
      );
    if (claimEligible) {
      const claim = await this.acquireTargetClaim(context, {
        definition,
        providerKind: workItem.source_provider_kind,
        providerKey: workItem.source_provider_key,
        targetType: workItem.source_object_type,
        targetRef: workItem.source_object_ref,
        workItemId: workItem.id,
        metadata: {
          source: 'work_item_acquire',
          lease_owner: options.leaseOwner,
        },
        now,
      });
      if (!claim.acquired) {
        // Deliberately does not burn an attempt: a deferral is not a failure of this item,
        // so claim-deferred items show status 'failed' with attempt_count still at 0.
        this.applyWorkItemTransition(workItem, 'failed', now);
        workItem.last_error = `Target deferred by active claim: ${claim.reason ?? 'claim_conflict'}`;
        workItem.next_attempt_at = (claim.claimExpiresAt ? dateFromUnknown(claim.claimExpiresAt) : null)
          ?? new Date(now.getTime() + DEFAULT_COOLDOWN_SECONDS * 1000);
        await repo.save(workItem);
        throw codedForbidden('AGENT_WORK_ITEM_BUSY', 'Agent work item target is currently claimed by another agent.');
      }
    }

    const ttlSeconds = this.queuePolicyNumber(definition, 'lease_ttl_seconds', DEFAULT_LEASE_TTL_SECONDS, 30, 86_400);
    this.applyWorkItemTransition(workItem, 'leased', now);
    workItem.lease_owner = options.leaseOwner;
    workItem.leased_until = new Date(now.getTime() + ttlSeconds * 1000);
    workItem.attempt_count += 1;
    return repo.save(workItem);
  }

  private applyWorkItemTransition(workItem: AiAgentWorkItem, to: string, now = new Date()): void {
    const from = workItem.status;
    if (!WORK_ITEM_ALLOWED_TRANSITIONS[from]?.has(to)) {
      this.logger.warn(`Unexpected agent work item transition ${from} -> ${to} (work item ${workItem.id}, kind ${workItem.work_kind}).`);
    }
    workItem.status = to;
    workItem.updated_at = now;
  }

  async markRunning(
    context: AiExecutionContextWithManager,
    workItem: AiAgentWorkItem,
    runId?: string | null,
  ): Promise<AiAgentWorkItem> {
    this.applyWorkItemTransition(workItem, 'running');
    if (runId) {
      workItem.last_run_id = runId;
    }
    return this.workItemRepo(context).save(workItem);
  }

  async markWaitingApproval(
    context: AiExecutionContextWithManager,
    workItem: AiAgentWorkItem,
    input: {
      runId: string;
      actionRequestIds: string[];
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<AiAgentWorkItem> {
    this.applyWorkItemTransition(workItem, 'waiting_approval');
    workItem.last_run_id = input.runId;
    workItem.last_action_request_ids = Array.from(new Set(input.actionRequestIds));
    workItem.lease_owner = null;
    workItem.leased_until = null;
    workItem.last_error = null;
    workItem.metadata_json = {
      ...(isRecord(workItem.metadata_json) ? workItem.metadata_json : {}),
      ...(input.metadata ?? {}),
    };
    return this.workItemRepo(context).save(workItem);
  }

  async completeWorkItem(
    context: AiExecutionContextWithManager,
    workItem: AiAgentWorkItem,
    input: {
      runId?: string | null;
      actionRequestIds?: string[] | null;
      metadata?: Record<string, unknown> | null;
    } = {},
  ): Promise<AiAgentWorkItem> {
    this.applyWorkItemTransition(workItem, 'completed');
    workItem.last_run_id = input.runId ?? workItem.last_run_id ?? null;
    workItem.last_action_request_ids = input.actionRequestIds ?? workItem.last_action_request_ids ?? null;
    workItem.lease_owner = null;
    workItem.leased_until = null;
    workItem.last_error = null;
    workItem.metadata_json = {
      ...(isRecord(workItem.metadata_json) ? workItem.metadata_json : {}),
      ...(input.metadata ?? {}),
    };
    return this.workItemRepo(context).save(workItem);
  }

  async failWorkItem(
    context: AiExecutionContextWithManager,
    workItem: AiAgentWorkItem,
    error: unknown,
  ): Promise<AiAgentWorkItem> {
    const repo = this.workItemRepo(context);
    const definition = await this.definitionRepo(context).findOne({
      where: { id: workItem.agent_definition_id, tenant_id: context.tenantId },
    });
    const now = new Date();
    const message = error instanceof Error ? error.message : String(error || 'Agent work item failed.');
    workItem.lease_owner = null;
    workItem.leased_until = null;
    workItem.last_error = message.slice(0, 2000);
    this.appendWorkItemFailure(workItem, message, now);
    const deadLettered = workItem.attempt_count >= workItem.max_attempts;
    if (deadLettered) {
      this.applyWorkItemTransition(workItem, 'dead_letter', now);
      workItem.next_attempt_at = now;
    } else {
      this.applyWorkItemTransition(workItem, 'failed', now);
      const cooldownSeconds = definition
        ? this.retryCooldownSeconds(definition, workItem.attempt_count)
        : DEFAULT_COOLDOWN_SECONDS;
      workItem.next_attempt_at = new Date(now.getTime() + cooldownSeconds * 1000);
    }
    const saved = await repo.save(workItem);
    await this.recordAuditEvent(context, {
      agentDefinitionId: workItem.agent_definition_id,
      workItemId: workItem.id,
      eventType: deadLettered ? 'work_item_dead_letter' : 'work_item_failed',
      severity: deadLettered ? 'error' : 'warning',
      message: workItem.last_error ?? message.slice(0, 2000),
      metadata: {
        attempt_count: workItem.attempt_count,
        max_attempts: workItem.max_attempts,
        next_attempt_at: workItem.next_attempt_at?.toISOString?.() ?? null,
        work_kind: workItem.work_kind,
        source_object_ref: workItem.source_object_ref,
      },
    });
    return saved;
  }

  // Keeps the error of every attempt (last_error only ever shows the final one), so a
  // dead-lettered item still tells the operator how attempt 1 differed from attempt 3.
  private appendWorkItemFailure(workItem: AiAgentWorkItem, message: string, now: Date): void {
    const metadata = isRecord(workItem.metadata_json) ? workItem.metadata_json : {};
    const history = Array.isArray(metadata.failure_history) ? metadata.failure_history : [];
    workItem.metadata_json = {
      ...metadata,
      failure_history: [
        ...history.slice(-(WORK_ITEM_FAILURE_HISTORY_LIMIT - 1)),
        {
          attempt: workItem.attempt_count,
          at: now.toISOString(),
          message: message.slice(0, 500),
        },
      ],
    };
  }

  async upsertTargetState(
    context: AiExecutionContextWithManager,
    input: {
      agentDefinitionId: string;
      providerKind: string;
      providerKey: string;
      targetType: string;
      targetRef: string;
      lastSeenExternalUpdatedAt?: Date | string | null;
      lastProcessedExternalUpdatedAt?: Date | string | null;
      nextReviewAt?: Date | string | null;
      lastRunId?: string | null;
      internalNoteHash?: string | null;
      publicReplyHash?: string | null;
      agentTouched?: boolean;
      needsFollowup?: boolean;
      claimStatus?: 'none' | 'claimed' | null;
      claimExpiresAt?: Date | string | null;
      claimAcquiredAt?: Date | string | null;
      claimOwnerWorkItemId?: string | null;
      claimOwnerRunId?: string | null;
      claimOwnerPriority?: number | null;
      claimOwnerActionRequestIds?: string[] | null;
      claimMetadata?: Record<string, unknown> | null;
      state?: Record<string, unknown> | null;
    },
  ): Promise<AiAgentTargetState> {
    const repo = this.targetStateRepo(context);
    const targetRef = normalizedTargetRef(input.targetRef);
    let state = await repo.findOne({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: input.agentDefinitionId,
        provider_kind: input.providerKind,
        provider_key: input.providerKey,
        target_type: input.targetType,
        target_ref: targetRef,
      },
    });
    const now = new Date();
    if (!state) {
      const defaults = {
        tenant_id: context.tenantId,
        agent_definition_id: input.agentDefinitionId,
        provider_kind: input.providerKind,
        provider_key: input.providerKey,
        target_type: input.targetType,
        target_ref: targetRef,
        last_seen_external_updated_at: null,
        last_processed_external_updated_at: null,
        next_review_at: null,
        last_run_id: null,
        last_public_reply_hash: null,
        last_internal_note_hash: null,
        last_classification_hash: null,
        last_assignment_hash: null,
        agent_touched: false,
        needs_followup: false,
        claim_status: 'none' as const,
        claim_expires_at: null,
        claim_acquired_at: null,
        claim_owner_work_item_id: null,
        claim_owner_run_id: null,
        claim_owner_priority: null,
        claim_owner_action_request_ids: null,
        claim_metadata_json: null,
        state_json: null,
        created_at: now,
        updated_at: now,
      };
      // Insert with ON CONFLICT DO NOTHING, then re-read: a long poll cycle can
      // race the inline run that creates the same target state, and a plain
      // insert would abort the surrounding transaction and fail the cycle
      // closed. (Test stubs without an insert query builder use plain create.)
      const insertBuilder = repo.createQueryBuilder?.('target_state') as { insert?: () => any } | undefined;
      if (typeof insertBuilder?.insert === 'function') {
        await insertBuilder.insert().values(defaults).orIgnore().execute();
        state = await repo.findOne({
          where: {
            tenant_id: context.tenantId,
            agent_definition_id: input.agentDefinitionId,
            provider_kind: input.providerKind,
            provider_key: input.providerKey,
            target_type: input.targetType,
            target_ref: targetRef,
          },
        });
        if (!state) {
          throw new Error(`Failed to create agent target state for ${input.providerKind}/${input.providerKey}/${targetRef}`);
        }
      } else {
        state = repo.create(defaults);
      }
    }

    state.last_seen_external_updated_at = dateFromUnknown(input.lastSeenExternalUpdatedAt) ?? state.last_seen_external_updated_at;
    state.last_processed_external_updated_at = dateFromUnknown(input.lastProcessedExternalUpdatedAt) ?? state.last_processed_external_updated_at;
    if (Object.prototype.hasOwnProperty.call(input, 'nextReviewAt')) {
      state.next_review_at = dateFromUnknown(input.nextReviewAt) ?? null;
    }
    state.last_run_id = input.lastRunId ?? state.last_run_id ?? null;
    state.last_internal_note_hash = input.internalNoteHash ?? state.last_internal_note_hash ?? null;
    state.last_public_reply_hash = input.publicReplyHash ?? state.last_public_reply_hash ?? null;
    state.agent_touched = input.agentTouched ?? state.agent_touched;
    state.needs_followup = input.needsFollowup ?? state.needs_followup;
    if (input.claimStatus === 'none') {
      state.claim_status = 'none';
      state.claim_expires_at = null;
      state.claim_acquired_at = null;
      state.claim_owner_work_item_id = null;
      state.claim_owner_run_id = null;
      state.claim_owner_priority = null;
      state.claim_owner_action_request_ids = null;
      state.claim_metadata_json = input.claimMetadata ?? null;
    } else if (input.claimStatus === 'claimed') {
      state.claim_status = 'claimed';
      state.claim_expires_at = dateFromUnknown(input.claimExpiresAt) ?? state.claim_expires_at;
      state.claim_acquired_at = dateFromUnknown(input.claimAcquiredAt) ?? state.claim_acquired_at ?? now;
      state.claim_owner_work_item_id = input.claimOwnerWorkItemId ?? state.claim_owner_work_item_id ?? null;
      state.claim_owner_run_id = input.claimOwnerRunId ?? state.claim_owner_run_id ?? null;
      state.claim_owner_priority = typeof input.claimOwnerPriority === 'number'
        ? numberFromPolicy(input.claimOwnerPriority, 100, 0, 1000)
        : state.claim_owner_priority;
      if (Array.isArray(input.claimOwnerActionRequestIds)) {
        state.claim_owner_action_request_ids = Array.from(new Set(input.claimOwnerActionRequestIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));
      }
      state.claim_metadata_json = {
        ...(isRecord(state.claim_metadata_json) ? state.claim_metadata_json : {}),
        ...(input.claimMetadata ?? {}),
      };
    }
    state.state_json = {
      ...(isRecord(state.state_json) ? state.state_json : {}),
      ...(input.state ?? {}),
    };
    state.updated_at = now;
    return repo.save(state);
  }

  async listLivePendingActionsForTargets(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      targetRefs: string[];
      now?: Date;
    },
  ): Promise<Map<string, AiActionRequest[]>> {
    const byRef = new Map<string, AiActionRequest[]>();
    const refs = Array.from(new Set(input.targetRefs
      .map((ref) => {
        try {
          return normalizedTargetRef(ref);
        } catch {
          return null;
        }
      })
      .filter((ref): ref is string => !!ref)));
    if (refs.length === 0) {
      return byRef;
    }
    const binding = requireTicketingBinding(input.definition);
    const nowMs = (input.now ?? new Date()).getTime();
    const rows = await this.actionRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: binding.providerKind,
        provider_key: binding.providerKey,
        target_type: 'ticket',
        target_ref: In(refs),
        status: In(['pending', 'approved']),
      },
    });
    for (const action of rows) {
      if (definitionIdFromMetadata(action.metadata_json) !== input.definition.id) {
        continue;
      }
      if (!activePendingAction(action, nowMs)) {
        continue;
      }
      const ref = action.target_ref;
      if (!ref) {
        continue;
      }
      const existing = byRef.get(ref) ?? [];
      existing.push(action);
      byRef.set(ref, existing);
    }
    return byRef;
  }

  async targetReviewReadiness(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      ticket: { id: string; updatedAt?: string | null; updated_at?: string | null; createdAt?: string | null };
      now?: Date;
      livePendingActions?: AiActionRequest[];
    },
  ): Promise<TargetReviewReadiness> {
    const now = input.now ?? new Date();
    const binding = requireTicketingBinding(input.definition);
    const targetRef = normalizedTargetRef(input.ticket.id);
    const repo = this.targetStateRepo(context);
    const existing = await repo.findOne({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: input.definition.id,
        provider_kind: binding.providerKind,
        provider_key: binding.providerKey,
        target_type: 'ticket',
        target_ref: targetRef,
      },
    });
    const externalUpdatedAt = dateFromUnknown(input.ticket.updatedAt ?? input.ticket.updated_at ?? input.ticket.createdAt);
    const processedAt = dateFromUnknown(existing?.last_processed_external_updated_at);
    const nextReviewAt = dateFromUnknown(existing?.next_review_at);
    const changed = !!externalUpdatedAt && (!processedAt || externalUpdatedAt.getTime() > processedAt.getTime());
    const due = !nextReviewAt || nextReviewAt.getTime() <= now.getTime();
    const livePending = input.livePendingActions
      ?? (await this.listLivePendingActionsForTargets(context, {
        definition: input.definition,
        targetRefs: [targetRef],
        now,
      })).get(targetRef)
      ?? [];
    const occupied = livePending.some((action) => activePendingAction(action, now.getTime()));
    const ready = !existing || changed || (due && !occupied);
    const reason: TargetReviewReadiness['reason'] = !existing
      ? 'first_review'
      : changed
        ? 'changed'
        : occupied
          ? 'pending_proposal'
          : due
            ? 'scheduled'
            : 'not_due';
    const state = await this.upsertTargetState(context, {
      agentDefinitionId: input.definition.id,
      providerKind: binding.providerKind,
      providerKey: binding.providerKey,
      targetType: 'ticket',
      targetRef,
      lastSeenExternalUpdatedAt: externalUpdatedAt,
      state: {
        latest_readiness_checked_at: now.toISOString(),
        latest_readiness_reason: reason,
      },
    });
    return {
      state,
      ready,
      changed,
      due,
      reason,
    };
  }

  private claimActive(state: AiAgentTargetState, now = new Date()): boolean {
    if (state.claim_status !== 'claimed') {
      return false;
    }
    const expiresAt = dateFromUnknown(state.claim_expires_at);
    return !expiresAt || expiresAt.getTime() > now.getTime();
  }

  private async activeClaimsForTarget(
    context: AiExecutionContextWithManager,
    input: {
      providerKind: string;
      providerKey: string;
      targetType: string;
      targetRef: string;
      now?: Date;
    },
  ): Promise<AiAgentTargetState[]> {
    const now = input.now ?? new Date();
    const rows = await this.targetStateRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        provider_kind: input.providerKind,
        provider_key: input.providerKey,
        target_type: input.targetType,
        target_ref: normalizedTargetRef(input.targetRef),
        claim_status: 'claimed',
      },
    });
    return rows.filter((row) => this.claimActive(row, now));
  }

  private async expireClaimOwnerActions(
    context: AiExecutionContextWithManager,
    state: AiAgentTargetState,
    reason: string,
    now = new Date(),
    knownActions?: AiActionRequest[],
  ): Promise<number> {
    const ids = Array.isArray(state.claim_owner_action_request_ids)
      ? state.claim_owner_action_request_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [];
    if (ids.length === 0) {
      return 0;
    }
    const actions = knownActions ?? await this.actionRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        id: In(Array.from(new Set(ids))),
      },
    });
    const toSave: AiActionRequest[] = [];
    for (const action of actions) {
      if (!activePendingAction(action, now.getTime())) {
        continue;
      }
      action.status = 'expired';
      action.error_message = reason;
      action.updated_at = now;
      action.metadata_json = {
        ...(isRecord(action.metadata_json) ? action.metadata_json : {}),
        expired_reason: reason,
        expired_at: now.toISOString(),
        claim_state_id: state.id,
      };
      toSave.push(action);
    }
    if (toSave.length > 0) {
      await this.actionRepo(context).save(toSave);
    }
    return toSave.length;
  }

  async releaseTargetClaim(
    context: AiExecutionContextWithManager,
    input: {
      agentDefinitionId: string;
      providerKind: string;
      providerKey: string;
      targetType: string;
      targetRef: string;
      reason: string;
      onlyWorkItemId?: string | null;
      expectedClaimExpiresAt?: Date | string | null;
      expectedClaimOwnerActionRequestIds?: string[] | null;
      now?: Date;
    },
  ): Promise<AiAgentTargetState | null> {
    const repo = this.targetStateRepo(context);
    const targetRef = normalizedTargetRef(input.targetRef);
    const state = await repo.findOne({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: input.agentDefinitionId,
        provider_kind: input.providerKind,
        provider_key: input.providerKey,
        target_type: input.targetType,
        target_ref: targetRef,
      },
    });
    if (!state || state.claim_status !== 'claimed') {
      return state;
    }
    if (input.onlyWorkItemId && state.claim_owner_work_item_id && state.claim_owner_work_item_id !== input.onlyWorkItemId) {
      return state;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'expectedClaimExpiresAt')
      && !sameNullableTime(state.claim_expires_at, input.expectedClaimExpiresAt)) {
      return state;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'expectedClaimOwnerActionRequestIds')
      && !sameStringSet(state.claim_owner_action_request_ids, input.expectedClaimOwnerActionRequestIds)) {
      return state;
    }
    state.claim_status = 'none';
    state.claim_expires_at = null;
    state.claim_acquired_at = null;
    state.claim_owner_work_item_id = null;
    state.claim_owner_run_id = null;
    state.claim_owner_priority = null;
    state.claim_owner_action_request_ids = null;
    state.claim_metadata_json = {
      ...(isRecord(state.claim_metadata_json) ? state.claim_metadata_json : {}),
      released_reason: input.reason,
      released_at: (input.now ?? new Date()).toISOString(),
    };
    state.updated_at = input.now ?? new Date();
    return repo.save(state);
  }

  async releaseWorkItemTargetClaim(
    context: AiExecutionContextWithManager,
    workItem: AiAgentWorkItem,
    reason: string,
  ): Promise<AiAgentTargetState | null> {
    if (!workItem.source_provider_kind || !workItem.source_provider_key || !workItem.source_object_type || !workItem.source_object_ref) {
      return null;
    }
    return this.releaseTargetClaim(context, {
      agentDefinitionId: workItem.agent_definition_id,
      providerKind: workItem.source_provider_kind,
      providerKey: workItem.source_provider_key,
      targetType: workItem.source_object_type,
      targetRef: workItem.source_object_ref,
      reason,
      onlyWorkItemId: workItem.id,
    });
  }

  async reconcileTargetClaims(
    context: AiExecutionContextWithManager,
    input: {
      limit?: number;
      now?: Date;
      providerKind?: string;
      providerKey?: string;
      targetType?: string;
      targetRef?: string;
    } = {},
  ): Promise<{ scanned: number; released: number; expiredActions: number }> {
    const now = input.now ?? new Date();
    const repo = this.targetStateRepo(context);
    const rows = (await repo.find({
      where: {
        tenant_id: context.tenantId,
        ...(input.providerKind ? { provider_kind: input.providerKind } : {}),
        ...(input.providerKey ? { provider_key: input.providerKey } : {}),
        ...(input.targetType ? { target_type: input.targetType } : {}),
        ...(input.targetRef ? { target_ref: normalizedTargetRef(input.targetRef) } : {}),
        claim_status: 'claimed',
      },
      order: { updated_at: 'ASC' },
      take: Math.max(1, Math.min(Math.floor(input.limit ?? 100), 500)),
    }));
    const blockedAgentDefinitionIds = await this.lifecycleBlockedAgentDefinitionIds(
      context,
      rows.map((state) => state.agent_definition_id),
      { now },
    );
    const allActionIds = Array.from(new Set(rows.flatMap((state) => Array.isArray(state.claim_owner_action_request_ids)
      ? state.claim_owner_action_request_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
      : [])));
    const actionsById = new Map<string, AiActionRequest>();
    if (allActionIds.length > 0) {
      const actions = await this.actionRepo(context).find({
        where: { tenant_id: context.tenantId, id: In(allActionIds) },
      });
      for (const action of actions) {
        actionsById.set(action.id, action);
      }
    }
    const workItemIds = Array.from(new Set(rows
      .map((state) => state.claim_owner_work_item_id)
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)));
    const workItemsById = new Map<string, AiAgentWorkItem>();
    if (workItemIds.length > 0) {
      const workItems = await this.workItemRepo(context).find({
        where: { tenant_id: context.tenantId, id: In(workItemIds) },
      });
      for (const workItem of workItems) {
        workItemsById.set(workItem.id, workItem);
      }
    }
    let released = 0;
    let expiredActions = 0;
    for (const state of rows) {
      if (blockedAgentDefinitionIds.has(state.agent_definition_id)) {
        continue;
      }
      let releaseReason: string | null = null;
      const expiresAt = dateFromUnknown(state.claim_expires_at);
      if (expiresAt && expiresAt.getTime() <= now.getTime()) {
        releaseReason = 'claim_lease_expired';
      }

      const actionIds = Array.isArray(state.claim_owner_action_request_ids)
        ? state.claim_owner_action_request_ids.filter((id) => typeof id === 'string' && id.trim().length > 0)
        : [];
      const ownerActions = actionIds.map((id) => actionsById.get(id)).filter((action): action is AiActionRequest => !!action);
      if (!releaseReason && actionIds.length > 0) {
        if (ownerActions.length === 0 || ownerActions.every((action) => !activePendingAction(action, now.getTime()))) {
          releaseReason = 'claim_owner_actions_terminal';
        }
      }

      if (!releaseReason && state.claim_owner_work_item_id) {
        const workItem = workItemsById.get(state.claim_owner_work_item_id) ?? null;
        if (workItem && TERMINAL_WORK_ITEM_STATUSES.has(workItem.status)) {
          releaseReason = 'claim_owner_work_item_terminal';
        }
      }

      if (!releaseReason) {
        continue;
      }
      // Approval window owns proposal lifetime. A lapsed claim lease only
      // means "I am no longer working this ticket right now" — it must not
      // expire a pending/approved proposal that is still inside its window.
      // expireClaimOwnerActions stays for foreign supersede only.
      const releasedState = await this.releaseTargetClaim(context, {
        agentDefinitionId: state.agent_definition_id,
        providerKind: state.provider_kind,
        providerKey: state.provider_key,
        targetType: state.target_type,
        targetRef: state.target_ref,
        reason: releaseReason,
        expectedClaimExpiresAt: state.claim_expires_at,
        expectedClaimOwnerActionRequestIds: state.claim_owner_action_request_ids,
        now,
      });
      if (releasedState?.claim_status === 'none') {
        released += 1;
      }
    }
    return { scanned: rows.length, released, expiredActions };
  }

  async acquireTargetClaim(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      providerKind?: string;
      providerKey?: string;
      targetType?: string;
      targetRef: string;
      workItemId?: string | null;
      runId?: string | null;
      metadata?: Record<string, unknown> | null;
      now?: Date;
    },
  ): Promise<TargetClaimAcquireResult> {
    const now = input.now ?? new Date();
    const fallbackBinding = !input.providerKind || !input.providerKey
      ? requireTicketingBinding(input.definition)
      : null;
    const providerKind = input.providerKind ?? fallbackBinding?.providerKind ?? 'ticketing';
    const providerKey = input.providerKey ?? fallbackBinding?.providerKey;
    if (!providerKey) {
      throw new BadRequestException('Target claim requires a provider key.');
    }
    const targetType = input.targetType ?? 'ticket';
    const targetRef = normalizedTargetRef(input.targetRef);
    await this.reconcileTargetClaims(context, {
      providerKind,
      providerKey,
      targetType,
      targetRef,
      now,
      limit: 50,
    });

    const newPriority = this.agentPriority(input.definition);
    const activeClaims = await this.activeClaimsForTarget(context, {
      providerKind,
      providerKey,
      targetType,
      targetRef,
      now,
    });
    const ownClaim = activeClaims.find((claim) => claim.agent_definition_id === input.definition.id) ?? null;
    const foreignClaims = activeClaims.filter((claim) => claim.agent_definition_id !== input.definition.id);
    if (foreignClaims.length > 0) {
      const strongest = [...foreignClaims].sort((left, right) => (right.claim_owner_priority ?? 100) - (left.claim_owner_priority ?? 100))[0];
      const ownerPriority = strongest.claim_owner_priority ?? 100;
      const shouldSupersede = newPriority > ownerPriority || (newPriority === ownerPriority && this.onConflict(input.definition) === 'supersede');
      if (!shouldSupersede) {
        return {
          acquired: false,
          status: 'deferred',
          state: strongest,
          ownerAgentDefinitionId: strongest.agent_definition_id,
          ownerPriority,
          ownerWorkItemId: strongest.claim_owner_work_item_id,
          claimExpiresAt: toIsoDate(strongest.claim_expires_at),
          reason: newPriority < ownerPriority ? 'lower_priority_claim_active' : 'equal_priority_claim_active',
        };
      }
      for (const claim of foreignClaims) {
        await this.expireClaimOwnerActions(context, claim, 'Claim was superseded by a higher-priority or superseding agent.', now);
        await this.releaseTargetClaim(context, {
          agentDefinitionId: claim.agent_definition_id,
          providerKind,
          providerKey,
          targetType,
          targetRef,
          reason: 'claim_superseded',
          now,
        });
      }
    }

    try {
      const leaseExpiry = new Date(now.getTime() + this.targetClaimLeaseSeconds(input.definition) * 1000);
      const existingHold = dateFromUnknown(ownClaim?.claim_expires_at);
      const claimExpiresAt = existingHold && existingHold.getTime() > leaseExpiry.getTime()
        ? existingHold
        : leaseExpiry;
      const state = await this.upsertTargetState(context, {
        agentDefinitionId: input.definition.id,
        providerKind,
        providerKey,
        targetType,
        targetRef,
        claimStatus: 'claimed',
        claimExpiresAt,
        claimAcquiredAt: ownClaim?.claim_acquired_at ?? now,
        claimOwnerWorkItemId: input.workItemId ?? ownClaim?.claim_owner_work_item_id ?? null,
        claimOwnerRunId: input.runId ?? ownClaim?.claim_owner_run_id ?? null,
        claimOwnerPriority: newPriority,
        claimMetadata: {
          ...(input.metadata ?? {}),
          acquired_at: now.toISOString(),
        },
      });
      return {
        acquired: true,
        status: foreignClaims.length > 0 ? 'superseded' : 'claimed',
        state,
        ownerAgentDefinitionId: input.definition.id,
        ownerPriority: newPriority,
        ownerWorkItemId: input.workItemId ?? null,
        claimExpiresAt: toIsoDate(state.claim_expires_at),
      };
    } catch (error) {
      const code = (error as { code?: string; driverError?: { code?: string } })?.code
        ?? (error as { driverError?: { code?: string } })?.driverError?.code;
      if (code !== '23505') {
        throw error;
      }
      const claims = await this.activeClaimsForTarget(context, {
        providerKind,
        providerKey,
        targetType,
        targetRef,
        now,
      });
      const owner = claims.find((claim) => claim.agent_definition_id !== input.definition.id) ?? claims[0] ?? null;
      return {
        acquired: false,
        status: 'deferred',
        state: owner,
        ownerAgentDefinitionId: owner?.agent_definition_id ?? null,
        ownerPriority: owner?.claim_owner_priority ?? null,
        ownerWorkItemId: owner?.claim_owner_work_item_id ?? null,
        claimExpiresAt: owner ? toIsoDate(owner.claim_expires_at) : null,
        reason: 'concurrent_claim_conflict',
      };
    }
  }

  async holdTargetClaimForPendingProposals(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      workItem: AiAgentWorkItem;
      actionRequestIds: string[];
      runId?: string | null;
      now?: Date;
    },
  ): Promise<AiAgentTargetState | null> {
    const ids = Array.from(new Set(input.actionRequestIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));
    if (!input.workItem.source_object_ref) {
      return null;
    }
    const now = input.now ?? new Date();
    const actions = ids.length > 0
      ? await this.actionRepo(context).find({
        where: {
          tenant_id: context.tenantId,
          id: In(ids),
        },
      })
      : [];
    const active = actions.filter((action) => activePendingAction(action, now.getTime()));
    const maxExpiry = active
      .map((action) => dateFromUnknown(action.expires_at))
      .filter((date): date is Date => !!date)
      .sort((left, right) => right.getTime() - left.getTime())[0] ?? null;
    const claimExpiry = maxExpiry ?? new Date(now.getTime() + this.reviewCooldownSeconds(input.definition) * 1000);
    return this.upsertTargetState(context, {
      agentDefinitionId: input.definition.id,
      providerKind: input.workItem.source_provider_kind,
      providerKey: input.workItem.source_provider_key,
      targetType: input.workItem.source_object_type,
      targetRef: input.workItem.source_object_ref,
      claimStatus: 'claimed',
      claimExpiresAt: claimExpiry,
      claimOwnerWorkItemId: input.workItem.id,
      claimOwnerRunId: input.runId ?? input.workItem.last_run_id ?? null,
      claimOwnerPriority: this.agentPriority(input.definition),
      claimOwnerActionRequestIds: active.map((action) => action.id),
      claimMetadata: {
        held_for_pending_proposals_at: now.toISOString(),
        pending_action_count: active.length,
      },
    });
  }

  async recordManualTicketingTriageOutcome(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      workItem: AiAgentWorkItem;
      runId: string;
      actionRequestIds: string[];
      ticket: {
        id: string;
        updatedAt?: string | null;
        updated_at?: string | null;
      };
      knowledgeResultCount: number;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<{ workItem: AiAgentWorkItem; targetState: AiAgentTargetState }> {
    const uniqueActionIds = Array.from(new Set(input.actionRequestIds));
    const actions = uniqueActionIds.length > 0
      ? await this.actionRepo(context).find({
        where: {
          tenant_id: context.tenantId,
          id: In(uniqueActionIds),
        },
      })
      : [];
    const internalAction = actions.find((action) => action.capability_name === TICKETING_INTERNAL_NOTE_ADD_APPROVED_CAPABILITY) ?? null;
    const publicAction = actions.find((action) => action.capability_name === TICKETING_PUBLIC_REPLY_ADD_APPROVED_CAPABILITY) ?? null;
    const externalUpdatedAt = input.ticket.updatedAt ?? input.ticket.updated_at ?? null;

    const targetState = await this.upsertTargetState(context, {
      agentDefinitionId: input.definition.id,
      providerKind: input.workItem.source_provider_kind,
      providerKey: input.workItem.source_provider_key,
      targetType: input.workItem.source_object_type,
      targetRef: input.workItem.source_object_ref,
      lastSeenExternalUpdatedAt: externalUpdatedAt,
      lastProcessedExternalUpdatedAt: externalUpdatedAt,
      nextReviewAt: this.scheduleNextReviewAt(input.definition),
      lastRunId: input.runId,
      internalNoteHash: actionBodyHash(internalAction),
      publicReplyHash: actionBodyHash(publicAction),
      agentTouched: actions.length > 0 ? true : undefined,
      needsFollowup: actions.some(activePendingAction),
      state: {
        latest_work_item_id: input.workItem.id,
        latest_action_request_ids: uniqueActionIds,
        knowledge_result_count: input.knowledgeResultCount,
        last_triage_at: new Date().toISOString(),
        ...(input.metadata ?? {}),
      },
    });

    const thisRunLive = actions.filter((action) => activePendingAction(action));
    const outcomeMetadata = {
      latest_target_state_id: targetState.id,
      knowledge_result_count: input.knowledgeResultCount,
      ...(input.metadata ?? {}),
    };
    if (thisRunLive.length > 0) {
      const workItem = await this.markWaitingApproval(context, input.workItem, {
        runId: input.runId,
        actionRequestIds: uniqueActionIds,
        metadata: outcomeMetadata,
      });
      await this.holdTargetClaimForPendingProposals(context, {
        definition: input.definition,
        workItem,
        actionRequestIds: uniqueActionIds,
        runId: input.runId,
      });
      return { workItem, targetState };
    }

    const priorTargetRef = input.workItem.source_object_ref;
    const priorLive = priorTargetRef
      ? (await this.listLivePendingActionsForTargets(context, {
        definition: input.definition,
        targetRefs: [priorTargetRef],
      })).get(normalizedTargetRef(priorTargetRef)) ?? []
      : [];
    if (priorLive.length === 0) {
      const workItem = await this.completeWorkItem(context, input.workItem, {
        runId: input.runId,
        actionRequestIds: [],
        metadata: outcomeMetadata,
      });
      await this.releaseWorkItemTargetClaim(context, workItem, 'review_completed_without_pending_proposals');
      return { workItem, targetState };
    }

    const priorLiveIds = new Set(priorLive.map((action) => action.id));
    const olderWaiting = await this.findOlderWaitingWorkItemForActions(context, {
      definition: input.definition,
      workItem: input.workItem,
      actionIds: priorLiveIds,
    });
    const holdOwner = olderWaiting ?? await this.markWaitingApproval(context, input.workItem, {
      runId: input.runId,
      actionRequestIds: Array.from(priorLiveIds),
      metadata: outcomeMetadata,
    });
    const workItem = olderWaiting
      ? await this.completeWorkItem(context, input.workItem, {
        runId: input.runId,
        actionRequestIds: [],
        metadata: {
          ...outcomeMetadata,
          empty_run_prior_work_item_id: olderWaiting.id,
        },
      })
      : holdOwner;
    await this.holdTargetClaimForPendingProposals(context, {
      definition: input.definition,
      workItem: holdOwner,
      actionRequestIds: Array.from(priorLiveIds),
      runId: input.runId,
    });
    return { workItem, targetState };
  }

  private async findOlderWaitingWorkItemForActions(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      workItem: AiAgentWorkItem;
      actionIds: Set<string>;
    },
  ): Promise<AiAgentWorkItem | null> {
    if (!input.workItem.source_object_ref || input.actionIds.size === 0) {
      return null;
    }
    const candidates = await this.workItemRepo(context).find({
      where: {
        tenant_id: context.tenantId,
        agent_definition_id: input.definition.id,
        source_object_ref: input.workItem.source_object_ref,
        status: 'waiting_approval',
      },
    });
    return candidates.find((item) => {
      if (item.id === input.workItem.id) {
        return false;
      }
      const ids = item.last_action_request_ids ?? [];
      return ids.some((id) => input.actionIds.has(id));
    }) ?? null;
  }

  async recordManualGlpiTriageOutcome(
    context: AiExecutionContextWithManager,
    input: {
      definition: AiAgentDefinition;
      workItem: AiAgentWorkItem;
      runId: string;
      actionRequestIds: string[];
      ticket: {
        id: string;
        updatedAt?: string | null;
        updated_at?: string | null;
      };
      knowledgeResultCount: number;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<{ workItem: AiAgentWorkItem; targetState: AiAgentTargetState }> {
    return this.recordManualTicketingTriageOutcome(context, input);
  }

  async recordAuditEvent(
    context: AiExecutionContextWithManager,
    input: {
      agentDefinitionId?: string | null;
      workItemId?: string | null;
      eventType: string;
      severity?: string | null;
      message: string;
      metadata?: Record<string, unknown> | null;
    },
  ): Promise<AiAgentAuditEvent> {
    const repo = this.auditRepo(context);
    const links = await resolveAuditEventLinks(context.manager, context.tenantId, input);
    return repo.save(repo.create({
      tenant_id: context.tenantId,
      agent_definition_id: links.agentDefinitionId,
      work_item_id: links.workItemId,
      event_type: input.eventType,
      severity: input.severity ?? 'info',
      message: input.message,
      metadata_json: withOrphanedAuditLinks(input.metadata, links.orphaned),
      created_at: new Date(),
    }));
  }

  async hasActiveEmergencyPause(
    context: AiExecutionContextWithManager,
    agentDefinitionId: string | null = null,
  ): Promise<AiEmergencyPause | null> {
    const query = this.pauseRepo(context).createQueryBuilder('pause')
      .where('(pause.tenant_id = :tenantId OR pause.tenant_id IS NULL)', { tenantId: context.tenantId })
      .andWhere('pause.active = true')
      .orderBy('pause.created_at', 'DESC');
    if (agentDefinitionId) {
      query.andWhere('(pause.agent_definition_id IS NULL OR pause.agent_definition_id = :agentDefinitionId)', { agentDefinitionId });
    } else {
      query.andWhere('pause.agent_definition_id IS NULL');
    }
    const pauses = await query.getMany();
    const now = Date.now();
    return pauses.find((pause) => {
      const expiresAt = dateFromUnknown(pause.expires_at);
      return !expiresAt || expiresAt.getTime() > now;
    }) ?? null;
  }

  async dailyUsageSummary(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    now = new Date(),
  ): Promise<HelpdeskDailyUsageSummary> {
    const caps = dailyGuardrailCapsFromDefinition(definition);
    if (!caps) {
      throw codedForbidden('AGENT_GUARDRAILS_MISSING', 'Helpdesk ticket daily guardrails are not configured.');
    }
    const windowStart = midnightUtc(now);
    const windowEnd = new Date(windowStart.getTime() + 24 * 60 * 60 * 1000);
    const rows = await this.runRepo(context).find({
      where: {
        tenant_id: context.tenantId,
      },
    });
    const usage = { tokens: 0, cost: 0 };
    const runs = rows.filter((run) =>
      definitionIdFromMetadata(run.metadata_json) === definition.id
      && isWithinWindow(run.created_at ?? run.started_at, windowStart, windowEnd),
    );
    for (const run of runs) {
      addEstimatedUsage(usage, run);
    }
    const reachedReasons: string[] = [];
    if (runs.length >= caps.maxRuns) {
      reachedReasons.push('daily_run_cap');
    }
    if (usage.tokens >= caps.maxTokens) {
      reachedReasons.push('daily_token_cap');
    }
    if (usage.cost >= caps.maxCostEur) {
      reachedReasons.push('daily_cost_cap');
    }
    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      runs: runs.length,
      estimatedTokens: usage.tokens,
      estimatedCostEur: Number(usage.cost.toFixed(6)),
      cap: caps,
      reached: reachedReasons.length > 0,
      reachedReasons,
    };
  }

  async lifecycleBlockedAgentDefinitionIds(
    context: AiExecutionContextWithManager,
    agentDefinitionIds: string[],
    opts: { now?: Date } = {},
  ): Promise<Set<string>> {
    const ids = Array.from(new Set(agentDefinitionIds.filter((id) => typeof id === 'string' && id.trim().length > 0)));
    const blocked = new Set<string>();
    if (ids.length === 0) {
      return blocked;
    }
    const definitions = await this.definitionRepo(context).find({
      where: { tenant_id: context.tenantId, id: In(ids) },
    });
    for (const definition of definitions) {
      const pause = await this.hasActiveEmergencyPause(context, definition.id);
      if (pause) {
        blocked.add(definition.id);
        continue;
      }
      try {
        const daily = await this.dailyUsageSummary(context, definition, opts.now ?? new Date());
        if (daily.reached) {
          blocked.add(definition.id);
        }
      } catch {
        // Missing guardrails means there is no configured daily cap to honor for
        // no-provider lifecycle cleanup; ingestion still enforces guardrails.
      }
    }
    return blocked;
  }

  async assertDailyCapAvailable(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
  ): Promise<HelpdeskDailyUsageSummary> {
    const summary = await this.dailyUsageSummary(context, definition);
    if (summary.reached) {
      await this.recordAuditEvent(context, {
        agentDefinitionId: definition.id,
        eventType: 'daily_cap_reached',
        severity: 'warning',
        message: 'Agent ingestion paused because the tenant daily agent run cap was reached.',
        metadata: {
          daily_usage: summary,
        },
      });
      const pauseState = {
        status: 'paused',
        reason: summary.reachedReasons.join(','),
        daily_usage: summary,
      };
      if (definition.agent_type === 'sre') {
        await this.updateMonitoringIngestionState(context, definition, pauseState);
      } else {
        await this.updateHelpdeskIngestionState(context, definition, pauseState);
      }
      throw codedForbidden('AGENT_DAILY_CAP_REACHED', 'Agent ingestion is paused because the tenant daily cap has been reached.');
    }
    return summary;
  }

  async updateHelpdeskIngestionState(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    state: Record<string, unknown>,
  ): Promise<AiAgentDefinition> {
    return this.updateAgentIngestionState(context, definition, 'helpdesk_ingestion_state', state);
  }

  async updateMonitoringIngestionState(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    state: Record<string, unknown>,
  ): Promise<AiAgentDefinition> {
    return this.updateAgentIngestionState(context, definition, 'monitoring_ingestion_state', state);
  }

  private async updateAgentIngestionState(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    stateKey: 'helpdesk_ingestion_state' | 'monitoring_ingestion_state',
    state: Record<string, unknown>,
  ): Promise<AiAgentDefinition> {
    definition.metadata_json = {
      ...(isRecord(definition.metadata_json) ? definition.metadata_json : {}),
      [stateKey]: {
        ...(isRecord(definition.metadata_json?.[stateKey]) ? definition.metadata_json[stateKey] : {}),
        ...state,
        updated_at: new Date().toISOString(),
      },
    };
    definition.updated_at = new Date();
    return this.definitionRepo(context).save(definition);
  }

  private async helpdeskEvaluationSummary(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
    now = new Date(),
  ): Promise<HelpdeskTicketingAgentSummary['evaluation']> {
    return this.computeHelpdeskEvaluation(context, [definition.id], now);
  }

  // Pooled evaluation metrics across one or more agent definitions. Per-agent
  // callers pass a single id; the fleet header passes every helpdesk agent id so
  // acceptance and cost-per-ticket are pooled from raw data, not averaged ratios.
  private async computeHelpdeskEvaluation(
    context: AiExecutionContextWithManager,
    definitionIds: string[],
    now = new Date(),
  ): Promise<HelpdeskTicketingAgentSummary['evaluation']> {
    const idSet = new Set(definitionIds);
    const inScope = (id: string | null): boolean => id != null && idSet.has(id);
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    // One after the other: the request's single connection runs its queries in turn anyway.
    const actions = await this.actionRepo(context).find({
        where: {
          tenant_id: context.tenantId,
          provider_kind: 'ticketing',
        },
      });
    const runs = await this.runRepo(context).find({
        where: {
          tenant_id: context.tenantId,
        },
      });
    const targetStates = definitionIds.length > 0
      ? await this.targetStateRepo(context).find({
        where: {
          tenant_id: context.tenantId,
          agent_definition_id: In(definitionIds),
        },
      })
      : [];
    const relevantActions = actions.filter((action) =>
      HELPDESK_REVIEW_ACTION_CAPABILITIES.includes(action.capability_name)
      && inScope(definitionIdFromMetadata(action.metadata_json))
      && isWithinWindow(action.created_at, windowStart, windowEnd),
    );
    const proposalsByActionClass: Record<string, number> = {};
    const terminalByStatus: Record<string, number> = {};
    const rejectionReasons: Record<string, number> = {};
    const approvalLatencies: number[] = [];
    let accepted = 0;
    let terminalReviewed = 0;
    let dismissed = 0;

    for (const action of relevantActions) {
      incrementCounter(proposalsByActionClass, actionClassForCapabilityName(action.capability_name));
      if (['executed', 'rejected', 'expired', 'failed', 'dismissed'].includes(action.status)) {
        incrementCounter(terminalByStatus, action.status);
      }
      if (action.status === 'executed') {
        accepted += 1;
        terminalReviewed += 1;
        const latency = secondsBetween(action.created_at, action.approved_at ?? action.executed_at);
        if (latency !== null) {
          approvalLatencies.push(latency);
        }
      } else if (action.status === 'rejected') {
        terminalReviewed += 1;
        incrementCounter(rejectionReasons, action.error_message?.trim() || 'rejected_without_reason');
      } else if (action.status === 'dismissed') {
        dismissed += 1;
      }
    }

    const relevantRuns = runs.filter((run) =>
      inScope(definitionIdFromMetadata(run.metadata_json))
      && isWithinWindow(run.created_at ?? run.started_at, windowStart, windowEnd),
    );
    const usage = { tokens: 0, cost: 0 };
    for (const run of relevantRuns) {
      addEstimatedUsage(usage, run);
    }
    const ticketRefs = new Set(targetStates
      .filter((state) => isWithinWindow(state.updated_at, windowStart, windowEnd))
      .map((state) => state.target_ref));
    const ticketCount = Math.max(1, ticketRefs.size);
    const kbHits = targetStates.filter((state) => {
      if (!isWithinWindow(state.updated_at, windowStart, windowEnd)) {
        return false;
      }
      const stateJson = policyObject(state.state_json);
      return numericMetadata(stateJson.knowledge_result_count) > 0;
    }).length;

    return {
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
      proposalsByActionClass,
      terminalByStatus,
      acceptanceRate: terminalReviewed > 0 ? Number((accepted / terminalReviewed).toFixed(4)) : null,
      dismissRate: (terminalReviewed + dismissed) > 0 ? Number((dismissed / (terminalReviewed + dismissed)).toFixed(4)) : null,
      rejectionReasons,
      medianApprovalLatencySeconds: median(approvalLatencies),
      runsPerTicket: ticketRefs.size > 0 ? Number((relevantRuns.length / ticketCount).toFixed(4)) : null,
      tokensPerTicket: ticketRefs.size > 0 ? Number((usage.tokens / ticketCount).toFixed(2)) : null,
      costPerTicketEur: ticketRefs.size > 0 ? Number((usage.cost / ticketCount).toFixed(6)) : null,
      kbHitRate: ticketRefs.size > 0 ? Number((kbHits / ticketCount).toFixed(4)) : null,
    };
  }

  private async helpdeskSummary(
    context: AiExecutionContextWithManager,
    definition: AiAgentDefinition,
  ): Promise<HelpdeskTicketingAgentSummary> {
    let ingestionConfig: HelpdeskNewTicketsIngestionConfig | null = null;
    try {
      ingestionConfig = this.resolveScopeIngestionConfig(definition);
    } catch {
      ingestionConfig = null;
    }
    const ingestionState = policyObject(policyObject(definition.metadata_json).helpdesk_ingestion_state);
    const metadataPauseReason = stringFromPolicy(ingestionState.reason);
    const activePause = await this.hasActiveEmergencyPause(context, definition.id);
    const daily = dailyGuardrailCapsFromDefinition(definition)
      ? await this.dailyUsageSummary(context, definition)
      : null;
    const emergencyPause = activePause ? {
      id: activePause.id,
      active: activePause.active,
      scope: activePause.scope ?? null,
      agent_definition_id: activePause.agent_definition_id ?? null,
      reason: activePause.reason,
      created_at: activePause.created_at ? new Date(activePause.created_at).toISOString() : null,
      expires_at: activePause.expires_at ? new Date(activePause.expires_at).toISOString() : null,
    } : null;
    return {
      agentDefinitionId: definition.id,
      ingestion: {
        enabled: !!ingestionConfig,
        mode: ingestionConfig ? ingestionConfig.mode : 'disabled',
        paused: stringFromPolicy(ingestionState.status) === 'paused' || !!emergencyPause,
        pauseReason: emergencyPause?.reason ?? metadataPauseReason,
        enabledAt: ingestionConfig?.enabledAt ?? null,
        createdAfter: ingestionConfig?.createdAfter ?? null,
        entityId: ingestionConfig?.entityId ?? null,
        categoryId: ingestionConfig?.categoryId ?? null,
        maxTicketsPerCycle: ingestionConfig?.maxTicketsPerCycle ?? null,
        maxProviderRequestsPerCycle: ingestionConfig?.maxProviderRequestsPerCycle ?? null,
        lastPollAt: isoFromPolicy(ingestionState.last_poll_at),
        lastPollStatus: stringFromPolicy(ingestionState.last_poll_status),
        lastAuditEventId: stringFromPolicy(ingestionState.last_audit_event_id),
      },
      guardrails: {
        configured: !!runGuardrailsFromDefinition(definition) && !!dailyGuardrailCapsFromDefinition(definition),
        perRun: runGuardrailsFromDefinition(definition),
        daily,
      },
      emergencyPause,
      evaluation: await this.helpdeskEvaluationSummary(context, definition),
    };
  }

  async listOverview(
    context: AiExecutionContextWithManager,
    options: { limit?: number } = {},
  ): Promise<AgentQueueOverview> {
    const limit = Math.max(1, Math.min(100, Math.floor(options.limit ?? 50)));
    const definitions = (await this.definitionRepo(context).find({ where: { tenant_id: context.tenantId } }))
      .sort((left, right) => left.agent_key.localeCompare(right.agent_key));
    const refreshedWorkItems: AiAgentWorkItem[] = [];
    for (const workItem of await this.workItemRepo(context).find({ where: { tenant_id: context.tenantId } })) {
      refreshedWorkItems.push(await this.refreshResolvedWaitingApproval(context, workItem) ?? workItem);
    }
    const workItems = refreshedWorkItems
      .sort((left, right) => {
        const leftTime = left.updated_at instanceof Date ? left.updated_at.getTime() : Date.parse(String(left.updated_at ?? ''));
        const rightTime = right.updated_at instanceof Date ? right.updated_at.getTime() : Date.parse(String(right.updated_at ?? ''));
        return rightTime - leftTime;
      })
      .slice(0, limit);
    const targetStates = (await this.targetStateRepo(context).find({ where: { tenant_id: context.tenantId } }))
      .sort((left, right) => {
        const leftTime = left.updated_at instanceof Date ? left.updated_at.getTime() : Date.parse(String(left.updated_at ?? ''));
        const rightTime = right.updated_at instanceof Date ? right.updated_at.getTime() : Date.parse(String(right.updated_at ?? ''));
        return rightTime - leftTime;
      })
      .slice(0, limit);
    const counts = workItems.reduce<Record<string, number>>((acc, item) => {
      acc[item.status] = (acc[item.status] ?? 0) + 1;
      return acc;
    }, {});
    const helpdeskDefinitions = definitions.filter((definition) => definition.agent_type === 'helpdesk');
    const helpdeskDefinition = helpdeskDefinitions[0] ?? null;
    const helpdeskDefinitionIds = helpdeskDefinitions.map((definition) => definition.id);
    // Monitoring inclusion: SRE agents flow through the generic definitions /
    // work items / target states lists above; audit events cover them too so
    // the Monitor tab shows poller cycles for both agent families.
    const sreDefinitionIds = definitions
      .filter((definition) => definition.agent_type === 'sre')
      .map((definition) => definition.id);
    const auditDefinitionIds = [...helpdeskDefinitionIds, ...sreDefinitionIds];
    // Scope, order, and limit in SQL instead of loading every tenant audit event and
    // filtering/sorting in memory (which scaled with total history, not the 20 returned).
    const auditEvents = auditDefinitionIds.length === 0
      ? []
      : await this.auditRepo(context).find({
        where: { tenant_id: context.tenantId, agent_definition_id: In(auditDefinitionIds) },
        order: { created_at: 'DESC' },
        take: 20,
      });
    // One after the other: each summary reads on the request's connection.
    const helpdeskSummaries: HelpdeskTicketingAgentSummary[] = [];
    for (const definition of helpdeskDefinitions) {
      helpdeskSummaries.push(await this.helpdeskSummary(context, definition));
    }
    // Fleet header aggregate: pooled across every helpdesk agent so it represents
    // the whole fleet, not the built-in agent's summary used as a proxy.
    const fleet = helpdeskDefinitionIds.length > 0
      ? await this.computeHelpdeskEvaluation(context, helpdeskDefinitionIds)
      : null;
    const monitoringTargetRefs = Array.from(new Set([
      ...targetStates.filter((state) => state.provider_kind === 'monitoring').map((state) => state.target_ref),
      ...workItems.filter((item) => item.source_provider_kind === 'monitoring').map((item) => item.source_object_ref),
    ].filter((ref): ref is string => typeof ref === 'string' && ref.length > 0)));
    const monitoringDiagnoses = await this.latestMonitoringDiagnosisCards(context, monitoringTargetRefs);
    return {
      definitions,
      workItems,
      targetStates,
      counts,
      monitoringDiagnoses,
      helpdesk: {
        summary: helpdeskDefinition
          ? helpdeskSummaries.find((summary) => summary.agentDefinitionId === helpdeskDefinition.id) ?? null
          : null,
        summaries: helpdeskSummaries,
        fleet,
        auditEvents,
      },
    };
  }

  // One batched query for the whole overview (never per-row), tenant-scoped
  // explicitly on top of RLS. DISTINCT ON keeps the newest diagnosis per
  // target ref.
  private async latestMonitoringDiagnosisCards(
    context: AiExecutionContextWithManager,
    targetRefs: string[],
  ): Promise<MonitoringDiagnosisCard[]> {
    if (targetRefs.length === 0) {
      return [];
    }
    const observations = await context.manager.getRepository(AiObservation)
      .createQueryBuilder('observation')
      .where('observation.tenant_id = :tenantId', { tenantId: context.tenantId })
      .andWhere('observation.observation_type = :observationType', { observationType: 'monitoring_alert_diagnostic' })
      .andWhere('observation.source_object_id IN (:...targetRefs)', { targetRefs })
      .distinctOn(['observation.source_object_id'])
      .orderBy('observation.source_object_id', 'ASC')
      .addOrderBy('observation.created_at', 'DESC')
      .getMany();
    return observations.map((observation) => monitoringDiagnosisCardFromObservation(observation));
  }

  agentExecutionMetadata(definition: AiAgentDefinition, workItem: AiAgentWorkItem): Record<string, unknown> {
    const queuePolicy = policyObject(definition.queue_policy_json);
    return {
      agent_definition_id: definition.id,
      agent_key: definition.agent_key,
      agent_type: definition.agent_type,
      agent_environment: definition.environment,
      agent_config_version: definition.config_version ?? 1,
      agent_updated_by_user_id: definition.updated_by_user_id ?? null,
      agent_priority: this.agentPriority(definition),
      review_cooldown_seconds: this.reviewCooldownSeconds(definition),
      on_conflict: this.onConflict(definition),
      approval_ttl_seconds: normalizeApprovalTtlSeconds(queuePolicy),
      on_stale_by_action_class: isRecord(queuePolicy.on_stale_by_action_class)
        ? queuePolicy.on_stale_by_action_class
        : null,
      agent_work_item_id: workItem.id,
      agent_work_kind: workItem.work_kind,
      agent_work_status: workItem.status,
      agent_dedup_key: workItem.dedup_key,
    };
  }
}
