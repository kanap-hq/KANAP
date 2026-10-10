import React from 'react';
import { Box, Button, IconButton, Link as MuiLink, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../design/KanapDialog';
import { type AutosaveStatus } from '../../hooks/useAutosave';
import {
  type AiAgentControlActionRequest,
  type AiAgentControlAgentDefinition,
  type AiAgentControlHelpdeskSummary,
  type AiAgentControlQueueOverview,
  type AiAgentControlTargetState,
  type AiAgentControlWorkItem,
} from '../../ai/aiApi';
import i18n from '../../i18n';
import { getDotColor } from '../../utils/statusColors';
import { StatusDot } from '../design';

export const LEGACY_GLPI_TICKETING_PROVIDER_KEY = 'glpi';
export const INTERNAL_NOTE_CAPABILITY = 'ticketing.ticket.internal_note.add_approved';
export const PUBLIC_REPLY_CAPABILITY = 'ticketing.ticket.public_reply.add_approved';
export const CLASSIFICATION_UPDATE_CAPABILITY = 'ticketing.ticket.classification_update.approved';
export const STATUS_UPDATE_CAPABILITY = 'ticketing.ticket.status_update.approved';
export const ASSIGNMENT_UPDATE_CAPABILITY = 'ticketing.ticket.assignment_update.approved';
export const PARTICIPANT_UPDATE_CAPABILITY = 'ticketing.ticket.participant_update.approved';

const STATUS_COLORS: Record<string, string> = {
  approved: 'success',
  completed: 'success',
  dead_letter: 'error',
  dismissed: 'default',
  executing: 'info',
  executed: 'success',
  failed: 'error',
  leased: 'info',
  pending: 'warning',
  provider_error: 'warning',
  queued: 'info',
  ready: 'success',
  rejected: 'error',
  running: 'info',
  skipped: 'default',
  unavailable: 'warning',
  warning: 'warning',
  waiting_approval: 'warning',
};

// Agent lifecycle (see lifecycleStatusKey) → status palette slot. Keyed on the
// lifecycle KEY, never on the translated label: looking a colour up by the
// display string silently degraded every agent to grey in non-English UIs (and
// in English too, since the labels never matched the enum keys).
const LIFECYCLE_COLORS: Record<string, string> = {
  watchingAutomatic: 'success',
  watchingAskFirst: 'success',
  testing: 'info',
  paused: 'error',
  failed: 'error',
  off: 'default',
  notStarted: 'default',
  archived: 'default',
};

export function lifecycleColor(lifecycleKey: string | null | undefined): string {
  return LIFECYCLE_COLORS[lifecycleKey ?? ''] ?? 'default';
}

export type TicketWorkGroupLifecycle = 'needs_decision' | 'in_progress' | 'needs_attention' | 'finished';

export type TicketWorkGroup = {
  key: string;
  providerKind: string | null;
  providerKey: string | null;
  targetType: string | null;
  targetRef: string;
  targetUrl: string | null;
  workItem: AiAgentControlWorkItem | null;
  workItems: AiAgentControlWorkItem[];
  historyWorkItems: AiAgentControlWorkItem[];
  targetState: AiAgentControlTargetState | null;
  pendingActions: AiAgentControlActionRequest[];
  latestRunId: string | null;
  queueStatus: string;
  updatedAt: string | null;
  lifecycle: TicketWorkGroupLifecycle;
};

export type TicketGroupBuildResult = {
  groups: TicketWorkGroup[];
  orphanActions: AiAgentControlActionRequest[];
};

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// The agent a proposal belongs to, read from its execution metadata (same key the
// backend scopes activity/evaluation by). Null when an action carries no agent tag.
export function actionAgentDefinitionId(action: AiAgentControlActionRequest): string | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  const id = metadata?.agent_definition_id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

function agentText(key: string, defaultValue: string, options?: Record<string, unknown>): string {
  return String(i18n.t(`agents:${key}`, { defaultValue, ...(options ?? {}) }));
}

export function humanize(value: string | null | undefined): string {
  if (!value) return agentText('common.notSet', 'Not set');
  return value.replace(/_/g, ' ');
}

// Plain-language label for an internal status enum. Falls back to a de-underscored
// rendering for any status without a dedicated translation, so primary surfaces never
// show raw enums like "waiting_approval" or "dead_letter".
export function statusLabel(status: string | null | undefined): string {
  if (!status) return agentText('common.notSet', 'Not set');
  return agentText(`status.${status}`, humanize(status));
}

export function targetTypeLabel(targetType: string | null | undefined): string {
  if (!targetType) return agentText('common.notSet', 'Not set');
  return agentText(`targetTypes.${targetType}`, humanize(targetType));
}

export function targetRefLabel(targetRef: string | null | undefined): string {
  const trimmed = typeof targetRef === 'string' ? targetRef.trim() : '';
  return trimmed ? `#${trimmed}` : agentText('common.notSet', 'Not set');
}

export function targetLabelText(targetType: string | null | undefined, targetRef: string | null | undefined): string {
  return `${targetTypeLabel(targetType)} ${targetRefLabel(targetRef)}`;
}

export function TargetLabel({
  targetType,
  targetRef,
  size = 'normal',
  href = null,
}: {
  targetType: string | null | undefined;
  targetRef: string | null | undefined;
  size?: 'normal' | 'dense';
  href?: string | null;
}) {
  const ref = targetRefLabel(targetRef);
  const refSx = (theme: Theme) => ({
    color: theme.palette.kanap.text.secondary,
    fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
    fontSize: size === 'dense' ? 11 : 12,
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 400,
    whiteSpace: 'nowrap',
  });
  return (
    <Stack direction="row" spacing={0.5} alignItems="baseline" sx={{ minWidth: 0 }}>
      <Typography
        component="span"
        sx={(theme) => ({
          color: theme.palette.kanap.text.secondary,
          fontSize: size === 'dense' ? 13 : 14,
          fontWeight: 400,
          minWidth: 0,
        })}
      >
        {targetTypeLabel(targetType)}
      </Typography>
      {href ? (
        <Tooltip title={agentText('targetLink.open', 'Open in your ticketing tool')}>
          <MuiLink
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            underline="hover"
            onClick={(event) => event.stopPropagation()}
            sx={(theme) => ({
              ...refSx(theme),
              display: 'inline-flex',
              alignItems: 'center',
              gap: '3px',
              '&.MuiLink-root': { color: theme.palette.kanap.text.secondary },
              '&.MuiLink-root:hover': { color: theme.palette.kanap.teal },
            })}
          >
            {ref}
            <OpenInNewIcon sx={{ fontSize: size === 'dense' ? 11 : 12 }} />
          </MuiLink>
        </Tooltip>
      ) : (
        <Typography component="span" sx={refSx}>
          {ref}
        </Typography>
      )}
    </Stack>
  );
}

// Shared lifecycle-state key for an agent (fleet card + monitor header), resolved to a
// plain-language string by the caller via t(`lifecycle.${key}`).
export function lifecycleStatusKey(
  status: string,
  watching: boolean,
  automaticCount: number,
  paused: boolean,
): string {
  if (paused) return 'paused';
  if (status === 'draft') return 'notStarted';
  if (status === 'disabled') return 'off';
  if (status === 'archived') return 'archived';
  if (!watching) return 'testing';
  return automaticCount > 0 ? 'watchingAutomatic' : 'watchingAskFirst';
}

// Resolve the per-agent helpdesk evaluation summary for the agent currently in
// view. Both the Monitor and Performance tabs MUST go through this so they never
// drift onto the singular `helpdesk.summary` (which the backend always binds to
// the built-in triage agent, not the agent being viewed). See agentic-control-plane issue #1.
export function resolveAgentSummary(
  overview: AiAgentControlQueueOverview | null | undefined,
  agentKey: string | null | undefined,
): AiAgentControlHelpdeskSummary | null {
  if (!overview || !agentKey) return null;
  const definition = overview.definitions?.find((item) => item.agent_key === agentKey) ?? null;
  if (!definition) return null;
  const summaries = overview.helpdesk?.summaries ?? [];
  return summaries.find((item) => item.agentDefinitionId === definition.id)
    ?? (overview.helpdesk?.summary?.agentDefinitionId === definition.id ? overview.helpdesk.summary : null);
}

export function formatDateTime(value: string | null | undefined, locale: string): string {
  if (!value) return agentText('common.notSet', 'Not set');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return agentText('common.notSet', 'Not set');
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

export function formatPercent(value: number | null | undefined): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return agentText('common.notEnoughData', 'Not enough data');
  return `${Math.round(value * 100)}%`;
}

export function formatNumber(value: number | null | undefined, maximumFractionDigits = 0): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return agentText('common.notSet', 'Not set');
  return new Intl.NumberFormat(undefined, { maximumFractionDigits }).format(value);
}

export function statusColor(status: string | null | undefined): string {
  return STATUS_COLORS[status ?? ''] ?? 'default';
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

// Keep in sync with the backend resolution in
// backend/src/ai/control-plane/agent/ticketing-binding.ts (resolveTicketingBinding):
// same fallback chain (provider_bindings_json.ticketing -> scope_policy_json)
// and same guards, or the UI enables actions the backend will reject with 400.
export function ticketingProviderKeyForDefinition(
  definition: Pick<AiAgentControlAgentDefinition, 'provider_bindings_json' | 'scope_policy_json'> | null | undefined,
): string | null {
  const bindings = recordValue(definition?.provider_bindings_json);
  const ticketing = recordValue(bindings?.ticketing);
  const boundProviderKind = nonEmptyString(ticketing?.provider_kind) ?? 'ticketing';
  const boundProviderKey = nonEmptyString(ticketing?.provider_key);
  if (boundProviderKind === 'ticketing' && boundProviderKey) {
    return boundProviderKey;
  }

  const scope = recordValue(definition?.scope_policy_json);
  const scopeProviderKind = nonEmptyString(scope?.provider_kind) ?? 'ticketing';
  const scopeProviderKey = nonEmptyString(scope?.provider_key);
  const scopeTargetKind = nonEmptyString(scope?.target_kind);
  if (scopeProviderKind !== 'ticketing' || (scopeTargetKind && scopeTargetKind !== 'ticket')) {
    return null;
  }
  return scopeProviderKey;
}

// Keep in sync with the backend resolution in
// backend/src/ai/control-plane/agent/provider-binding.ts (resolveProviderBinding):
// a binding only resolves when provider_bindings_json[kind] carries a matching
// provider_kind and a non-empty provider_key — missing or malformed bindings fail
// closed, with no scope_policy fallback. Ticketing callers keep using
// ticketingProviderKeyForDefinition above for its legacy fallback chain.
export function providerBindingForDefinition(
  definition: Pick<AiAgentControlAgentDefinition, 'provider_bindings_json'> | null | undefined,
  kind: string,
): { providerKind: string; providerKey: string } | null {
  const bindings = recordValue(definition?.provider_bindings_json);
  const binding = recordValue(bindings ? bindings[kind] : null);
  const boundProviderKind = nonEmptyString(binding?.provider_kind) ?? kind;
  const boundProviderKey = nonEmptyString(binding?.provider_key);
  if (boundProviderKind === kind && boundProviderKey) {
    return { providerKind: boundProviderKind, providerKey: boundProviderKey };
  }
  return null;
}

// A terminal status proposal (close/solve) — a destructive cleanup action that
// must be surfaced distinctly from an ordinary status move and always approved.
export function actionIsTerminalStatus(action: AiAgentControlActionRequest): boolean {
  if (!action.capability_name.includes('status_update')) return false;
  const payload = isRecord(action.action_payload_json) ? action.action_payload_json : null;
  const meta = isRecord(action.metadata_json) ? action.metadata_json : null;
  if (payload?.terminal === true || meta?.terminal === true) return true;
  const target = String(payload?.targetStatus ?? payload?.transitionKey ?? '').toLowerCase();
  return target === 'closed' || target === 'solved';
}

export function capabilityLabelFromName(name: string | null | undefined): string {
  if (!name) return agentText('common.notSet', 'Not set');
  // Dispatch on the exact action-class segment (`ticketing.ticket.<class>.<verb>`):
  // substring matching mislabeled read-only `*_context.get` lookups as write actions.
  const segments = name.split('.').filter(Boolean);
  const actionClass = segments.length >= 2 ? segments[segments.length - 2] : '';
  switch (actionClass) {
    case 'internal_note': return agentText('actions.internalNote', 'Internal note');
    case 'public_reply': return agentText('actions.requesterReply', 'Requester reply');
    case 'classification_update': return agentText('actions.classification', 'Classification');
    case 'status_update': return agentText('actions.status', 'Status');
    case 'assignment_update': return agentText('actions.assignment', 'Assignment');
    case 'participant_update': return agentText('actions.participants', 'Participants');
    default: {
      const fallback = humanize(segments.slice(-2).join(' '));
      return fallback.charAt(0).toUpperCase() + fallback.slice(1);
    }
  }
}

export function actionLabel(action: AiAgentControlActionRequest): string {
  if (actionIsTerminalStatus(action)) {
    const target = String((isRecord(action.action_payload_json) ? action.action_payload_json.targetStatus : '') ?? '').toLowerCase();
    return target === 'solved' ? agentText('actions.solveTicket', 'Solve ticket') : agentText('actions.closeTicket', 'Close ticket');
  }
  return capabilityLabelFromName(action.capability_name);
}

export function actionBody(action: AiAgentControlActionRequest | null | undefined): string | null {
  const payload = isRecord(action?.action_payload_json) ? action.action_payload_json : null;
  const fields = action?.capability_name === INTERNAL_NOTE_CAPABILITY
    ? ['note_body', 'body']
    : action?.capability_name === PUBLIC_REPLY_CAPABILITY
      ? ['reply_body', 'body']
      : ['body', 'note_body', 'reply_body'];
  const body = fields
    .map((field) => {
      const value = payload?.[field];
      return typeof value === 'string' ? value.trim() : null;
    })
    .find((candidate): candidate is string => !!candidate && candidate.length > 0) ?? null;
  return body && body.length > 0 ? body : null;
}

export function actionUpdateSummary(action: AiAgentControlActionRequest): string | null {
  const payload = isRecord(action.action_payload_json) ? action.action_payload_json : null;
  if (!payload) return null;
  const reason = typeof payload.reason === 'string' && payload.reason.trim().length > 0
    ? payload.reason.trim()
    : null;
  const current = isRecord(payload.current) ? payload.current : null;
  if (action.capability_name === CLASSIFICATION_UPDATE_CAPABILITY) {
    const proposed = isRecord(payload.proposed) ? payload.proposed : null;
    const lines = Object.entries(proposed ?? {})
      .filter(([key, value]) => key !== 'categoryKey' && typeof value === 'string' && value.trim().length > 0)
      .map(([key, value]) => {
        const label = agentText(`actions.classificationFields.${key}`, humanize(key));
        const before = String(current?.[key] ?? agentText('common.notSet', 'Not set'));
        const after = String(value);
        return `- ${label}: ${key === 'category' ? before : humanize(before)} -> ${key === 'category' ? after : humanize(after)}`;
      });
    return lines.length > 0
      ? [agentText('actions.classificationUpdate', 'Classification update'), ...lines, reason ? `${agentText('actions.reason', 'Reason')}: ${reason}` : null].filter(Boolean).join('\n')
      : null;
  }
  if (action.capability_name === STATUS_UPDATE_CAPABILITY) {
    const currentStatus = String(current?.statusLabel ?? current?.status ?? agentText('common.notSet', 'Not set'));
    const target = String(payload.targetStatusLabel ?? payload.targetStatus ?? payload.transitionKey ?? agentText('common.notSet', 'Not set'));
    return [agentText('actions.statusUpdate', 'Status update'), `- ${agentText('actions.status', 'Status')}: ${humanize(currentStatus)} -> ${humanize(target)}`, reason ? `${agentText('actions.reason', 'Reason')}: ${reason}` : null].filter(Boolean).join('\n');
  }
  if (action.capability_name === ASSIGNMENT_UPDATE_CAPABILITY) {
    const target = isRecord(payload.target) ? payload.target : null;
    const targetLabel = typeof target?.label === 'string' && target.label.trim().length > 0 ? target.label : agentText('common.notSet', 'Not set');
    if (target?.kind === 'group') {
      // Group routing is additive: show what is on the ticket today and the group being added.
      const currentGroups = Array.isArray(current?.assignedGroups)
        ? current.assignedGroups.filter(isRecord).map((group) => String(group.label ?? group.key ?? '')).filter(Boolean)
        : typeof current?.group === 'string' && current.group.trim().length > 0 ? [current.group] : [];
      const currentLine = currentGroups.length > 0
        ? currentGroups.join(', ')
        : agentText('actions.noGroupAssigned', 'No group assigned');
      return [
        agentText('actions.assignmentUpdate', 'Assignment update'),
        `- ${agentText('actions.assignToGroup', 'Assign to group')}: ${targetLabel}`,
        `- ${agentText('actions.currentGroups', 'Currently assigned')}: ${currentLine}`,
        reason ? `${agentText('actions.reason', 'Reason')}: ${reason}` : null,
      ].filter(Boolean).join('\n');
    }
    if (target?.kind === 'user') {
      // Technician routing is additive too: show who is on the ticket today and who is being added.
      const currentUsers = Array.isArray(current?.assignedUsers)
        ? current.assignedUsers.filter(isRecord).map((user) => String(user.label ?? user.key ?? '')).filter(Boolean)
        : typeof current?.assignee === 'string' && current.assignee.trim().length > 0 ? [current.assignee] : [];
      const currentLine = currentUsers.length > 0
        ? currentUsers.join(', ')
        : agentText('actions.noTechnicianAssigned', 'No technician assigned');
      return [
        agentText('actions.assignmentUpdate', 'Assignment update'),
        `- ${agentText('actions.assignToTechnician', 'Assign to technician')}: ${targetLabel}`,
        `- ${agentText('actions.currentTechnicians', 'Currently assigned')}: ${currentLine}`,
        reason ? `${agentText('actions.reason', 'Reason')}: ${reason}` : null,
      ].filter(Boolean).join('\n');
    }
    const currentAssignee = typeof current?.assignee === 'string' && current.assignee.trim().length > 0
      ? current.assignee
      : agentText('actions.unassigned', 'Unassigned');
    return [agentText('actions.assignmentUpdate', 'Assignment update'), `- ${agentText('actions.assignee', 'Assignee')}: ${currentAssignee} -> ${targetLabel}`, reason ? `${agentText('actions.reason', 'Reason')}: ${reason}` : null].filter(Boolean).join('\n');
  }
  if (action.capability_name === PARTICIPANT_UPDATE_CAPABILITY) {
    const participants = Array.isArray(payload.participants)
      ? payload.participants
          .filter(isRecord)
          .map((entry) => (typeof entry.label === 'string' ? entry.label : null))
          .filter((label): label is string => !!label)
          .join(', ')
      : null;
    return [agentText('actions.participantUpdate', 'Participant update'), participants ? `- ${agentText('actions.participants', 'Participants')}: ${participants}` : null, reason ? `${agentText('actions.reason', 'Reason')}: ${reason}` : null].filter(Boolean).join('\n');
  }
  return null;
}

export function actionUpdatesBody(actions: AiAgentControlActionRequest[]): string | null {
  const body = actions.map(actionUpdateSummary).filter((entry): entry is string => !!entry).join('\n\n');
  return body.length > 0 ? body : null;
}

export function actionCanReject(action: AiAgentControlActionRequest): boolean {
  if (action.status === 'executing') return false;
  return action.execution_readiness?.can_reject ?? (action.status === 'pending' || action.status === 'approved');
}

export function actionCanExecute(action: AiAgentControlActionRequest): boolean {
  if (action.status === 'executing') return false;
  return action.execution_readiness?.can_execute ?? (action.status === 'pending' || action.status === 'approved');
}

export function executableActions(actions: AiAgentControlActionRequest[]): AiAgentControlActionRequest[] {
  return actions.filter(actionCanExecute);
}

export function executableTerminalActions(actions: AiAgentControlActionRequest[]): AiAgentControlActionRequest[] {
  return actions.filter((action) => actionCanExecute(action) && actionIsTerminalStatus(action));
}

export function actionBlockedReason(action: AiAgentControlActionRequest): string | null {
  return action.execution_readiness?.blocked_reason ?? null;
}

function actionTargetRef(action: AiAgentControlActionRequest): string {
  return action.target_ref ?? action.target_id ?? action.id;
}

function targetGroupKeyFromParts(
  providerKind: string | null | undefined,
  providerKey: string | null | undefined,
  targetType: string | null | undefined,
  targetRef: string | null | undefined,
): string {
  return `${providerKind ?? 'unknown'}:${providerKey ?? 'unknown'}:${targetType ?? 'unknown'}:${targetRef ?? 'unknown'}`;
}

function targetGroupKeyFromWorkItem(workItem: AiAgentControlWorkItem): string {
  return targetGroupKeyFromParts(
    workItem.source_provider_kind,
    workItem.source_provider_key,
    workItem.source_object_type,
    workItem.source_object_ref,
  );
}

function targetGroupKeyFromTargetState(state: AiAgentControlTargetState): string {
  return targetGroupKeyFromParts(
    state.provider_kind,
    state.provider_key,
    state.target_type,
    state.target_ref,
  );
}

function targetGroupKeyFromAction(action: AiAgentControlActionRequest): string {
  return targetGroupKeyFromParts(
    action.provider_kind,
    action.provider_key,
    action.target_type,
    actionTargetRef(action),
  );
}

export function workItemInProgress(workItem: AiAgentControlWorkItem): boolean {
  return ['queued', 'leased', 'running'].includes(workItem.status);
}

function actionPendingNonExpired(action: AiAgentControlActionRequest, nowMs: number): boolean {
  if (action.status !== 'pending') return false;
  if (!action.expires_at) return true;
  const expiresAt = Date.parse(action.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > nowMs;
}

export function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

export function approvedBatchContext(action: AiAgentControlActionRequest): Record<string, unknown> | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  return isRecord(metadata?.approved_batch_context) ? metadata.approved_batch_context : null;
}

export function actionHasQueuedExecution(action: AiAgentControlActionRequest): boolean {
  return action.status === 'approved'
    && approvedBatchContext(action)?.execution_queued === true
    && !action.executed_at;
}

export function actionInProgress(action: AiAgentControlActionRequest): boolean {
  return action.status === 'executing' || actionHasQueuedExecution(action);
}

export function actionAttentionMessage(action: AiAgentControlActionRequest): string | null {
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : {};
  const batch = approvedBatchContext(action);
  return action.error_message
    ?? stringValue(batch?.dead_letter_reason)
    ?? stringValue(batch?.last_execution_error)
    ?? stringValue(metadata.last_execution_error)
    ?? null;
}

// When an operator acknowledges a "Needs attention" row, the backend stamps the
// record's own metadata (zero migration). The row then stops needing attention
// for good, on every device and after any refresh.
export function attentionAcknowledgedAt(metadataJson: unknown): string | null {
  const metadata = isRecord(metadataJson) ? metadataJson : null;
  const acknowledged = isRecord(metadata?.attention_acknowledged) ? metadata.attention_acknowledged : null;
  return stringValue(acknowledged?.at);
}

export function actionNeedsAttention(action: AiAgentControlActionRequest): boolean {
  if (attentionAcknowledgedAt(action.metadata_json)) return false;
  return !!actionAttentionMessage(action) && ['approved', 'expired', 'failed', 'dead_letter'].includes(action.status);
}

export function workItemNeedsAttention(workItem: AiAgentControlWorkItem): boolean {
  if (attentionAcknowledgedAt(workItem.metadata_json)) return false;
  return ['failed', 'dead_letter'].includes(workItem.status);
}

export function workItemAttentionMessage(workItem: AiAgentControlWorkItem): string | null {
  const metadata = isRecord(workItem.metadata_json) ? workItem.metadata_json : {};
  return workItem.last_error
    ?? stringValue(metadata.dead_letter_reason)
    ?? stringValue(metadata.last_execution_error)
    ?? null;
}

function groupLifecycle(
  workItems: AiAgentControlWorkItem[],
  actions: AiAgentControlActionRequest[],
  nowMs: number,
): TicketWorkGroupLifecycle {
  if (actions.some((action) => actionPendingNonExpired(action, nowMs))) return 'needs_decision';
  if (actions.some(actionInProgress) || workItems.some(workItemInProgress)) return 'in_progress';
  if (actions.some(actionNeedsAttention) || workItems.some(workItemNeedsAttention)) {
    return 'needs_attention';
  }
  return 'finished';
}

function workItemSortWeight(status: string | null | undefined): number {
  const weight: Record<string, number> = {
    waiting_approval: 0,
    failed: 1,
    dead_letter: 2,
    running: 3,
    leased: 4,
    queued: 5,
    completed: 6,
  };
  return weight[status ?? ''] ?? 20;
}

function workItemSortTime(workItem: AiAgentControlWorkItem): number {
  const value = Date.parse(workItem.updated_at ?? workItem.created_at ?? '');
  return Number.isFinite(value) ? value : 0;
}

export function buildTicketGroups(
  overview: AiAgentControlQueueOverview | null,
  actionRequests: AiAgentControlActionRequest[],
  agentDefinitionId: string | null,
  nowMs: number,
): TicketGroupBuildResult {
  // Agent scoping: a ticket touched by several agents must not bleed one agent's
  // proposals into another's view. Keep only this agent's work items, and drop
  // actions explicitly tagged for a different agent. See agentic-control-plane #1 (Approvals).
  const scopedActions = agentDefinitionId
    ? actionRequests.filter((action) => {
      const owner = actionAgentDefinitionId(action);
      return owner == null || owner === agentDefinitionId;
    })
    : actionRequests;

  const actionById = new Map(scopedActions.map((action) => [action.id, action]));
  const targetUrlByKey = new Map<string, string>();
  for (const link of overview?.target_links ?? []) {
    targetUrlByKey.set(`${link.provider_kind}::${link.provider_key}::${link.target_ref}`, link.url);
  }
  const usedActionIds = new Set<string>();
  const drafts = new Map<string, {
    key: string;
    providerKind: string | null;
    providerKey: string | null;
    targetType: string | null;
    targetRef: string;
    workItems: AiAgentControlWorkItem[];
    targetState: AiAgentControlTargetState | null;
  }>();

  const ensureDraft = (
    key: string,
    targetRef: string,
    providerKind: string | null | undefined,
    providerKey: string | null | undefined,
    targetType: string | null | undefined,
  ) => {
    const existing = drafts.get(key);
    if (existing) return existing;
    const draft = {
      key,
      providerKind: providerKind ?? null,
      providerKey: providerKey ?? null,
      targetType: targetType ?? null,
      targetRef,
      workItems: [],
      targetState: null,
    };
    drafts.set(key, draft);
    return draft;
  };

  for (const workItem of overview?.work_items ?? []) {
    if (agentDefinitionId && workItem.agent_definition_id !== agentDefinitionId) continue;
    ensureDraft(
      targetGroupKeyFromWorkItem(workItem),
      workItem.source_object_ref,
      workItem.source_provider_kind,
      workItem.source_provider_key,
      workItem.source_object_type,
    ).workItems.push(workItem);
  }

  for (const state of overview?.target_states ?? []) {
    if (agentDefinitionId && state.agent_definition_id !== agentDefinitionId) continue;
    const draft = ensureDraft(
      targetGroupKeyFromTargetState(state),
      state.target_ref,
      state.provider_kind,
      state.provider_key,
      state.target_type,
    );
    draft.targetState = state;
  }

  for (const action of scopedActions) {
    ensureDraft(
      targetGroupKeyFromAction(action),
      actionTargetRef(action),
      action.provider_kind,
      action.provider_key,
      action.target_type,
    );
  }

  const groups: TicketWorkGroup[] = [];
  for (const draft of drafts.values()) {
    const sortedWorkItems = [...draft.workItems].sort((left, right) => {
      const statusDiff = workItemSortWeight(left.status) - workItemSortWeight(right.status);
      if (statusDiff !== 0) return statusDiff;
      return workItemSortTime(right) - workItemSortTime(left);
    });
    const workItem = sortedWorkItems[0] ?? null;
    const targetState = draft.targetState;
    const targetRef = workItem?.source_object_ref ?? targetState?.target_ref ?? draft.targetRef;
    const latestRunId = workItem?.last_run_id ?? targetState?.last_run_id ?? null;
    const stateJson = isRecord(targetState?.state_json) ? targetState.state_json : null;
    const stateActionIds = Array.isArray(stateJson?.latest_action_request_ids)
      ? stateJson.latest_action_request_ids.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : [];
    const claimActionIds = targetState?.claim_owner_action_request_ids ?? [];
    const actionIds = new Set<string>();
    const actions: AiAgentControlActionRequest[] = [];
    const addAction = (action: AiAgentControlActionRequest) => {
      if (actionIds.has(action.id) || usedActionIds.has(action.id)) return;
      actions.push(action);
      actionIds.add(action.id);
      usedActionIds.add(action.id);
    };

    for (const id of [
      ...(workItem?.last_action_request_ids ?? []),
      ...sortedWorkItems.flatMap((item) => item.id === workItem?.id ? [] : item.last_action_request_ids ?? []),
      ...stateActionIds,
      ...claimActionIds,
    ]) {
      const action = actionById.get(id);
      if (action) addAction(action);
    }

    for (const action of scopedActions) {
      if (targetGroupKeyFromAction(action) === draft.key) addAction(action);
    }

    if (sortedWorkItems.length === 0 && !targetState && actions.length === 0) continue;

    const providerKind = workItem?.source_provider_kind ?? targetState?.provider_kind ?? draft.providerKind;
    const providerKey = workItem?.source_provider_key ?? targetState?.provider_key ?? draft.providerKey;
    groups.push({
      key: draft.key,
      providerKind,
      providerKey,
      targetType: workItem?.source_object_type ?? targetState?.target_type ?? draft.targetType,
      targetRef,
      targetUrl: providerKind && providerKey
        ? targetUrlByKey.get(`${providerKind}::${providerKey}::${targetRef}`) ?? null
        : null,
      workItem,
      workItems: sortedWorkItems,
      historyWorkItems: workItem ? sortedWorkItems.filter((item) => item.id !== workItem.id) : sortedWorkItems,
      targetState,
      pendingActions: actions,
      latestRunId: latestRunId ?? actions[0]?.run_id ?? null,
      queueStatus: workItem?.status ?? 'unknown',
      updatedAt: workItem?.updated_at ?? targetState?.updated_at ?? actions[0]?.updated_at ?? actions[0]?.created_at ?? null,
      lifecycle: groupLifecycle(sortedWorkItems, actions, nowMs),
    });
  }

  const sortedGroups = groups.sort((left, right) => {
    const statusDiff = workItemSortWeight(left.queueStatus) - workItemSortWeight(right.queueStatus);
    if (statusDiff !== 0) return statusDiff;
    const leftTime = Date.parse(left.updatedAt ?? '');
    const rightTime = Date.parse(right.updatedAt ?? '');
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
  return { groups: sortedGroups, orphanActions: [] };
}

export function StatusText({ status }: { status: string }) {
  const theme = useTheme();
  const dotColor = getDotColor(statusColor(status), theme.palette.mode);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <StatusDot color={dotColor} />
      <Typography sx={{ color: dotColor, fontSize: 13, fontWeight: 500, lineHeight: 1.35, minWidth: 0 }}>
        {statusLabel(status)}
      </Typography>
    </Stack>
  );
}

// Same sober dot + text treatment as StatusText, but for the agent lifecycle:
// the colour comes from the lifecycle key and only the label is translated.
export function LifecycleText({ lifecycleKey, size = 'normal' }: { lifecycleKey: string; size?: 'normal' | 'dense' }) {
  const theme = useTheme();
  const { t } = useTranslation(['agents']);
  const dotColor = getDotColor(lifecycleColor(lifecycleKey), theme.palette.mode);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <StatusDot color={dotColor} />
      <Typography sx={{ color: dotColor, fontSize: size === 'dense' ? 12 : 13, fontWeight: 500, lineHeight: 1.35, minWidth: 0 }}>
        {t(`lifecycle.${lifecycleKey}`)}
      </Typography>
    </Stack>
  );
}

export function Section({
  title,
  info,
  actions,
  children,
  id,
  caption,
  collapsible = false,
  open = true,
  onToggle,
  count,
}: {
  title: string;
  info?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
  id?: string;
  caption?: React.ReactNode;
  collapsible?: boolean;
  open?: boolean;
  onToggle?: () => void;
  count?: number;
}) {
  const header = (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ gap: 1, minWidth: 0, width: '100%' }}>
      <Stack direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
        {collapsible && (
          <IconButton
            aria-label={open ? agentText('approvals.collapseSection', 'Collapse section') : agentText('approvals.expandSection', 'Expand section')}
            size="small"
            onClick={(event) => {
              event.stopPropagation();
              onToggle?.();
            }}
            sx={{ p: 0.25, color: 'kanap.text.secondary' }}
          >
            {open ? <KeyboardArrowDownIcon sx={{ fontSize: 17 }} /> : <KeyboardArrowRightIcon sx={{ fontSize: 17 }} />}
          </IconButton>
        )}
        <Typography sx={(theme) => ({ color: theme.palette.kanap.text.primary, fontSize: 16, fontWeight: 500, lineHeight: 1.35 })}>
          {title}
        </Typography>
        {info && (
          <Tooltip title={info} placement="top">
            <InfoOutlinedIcon sx={{ fontSize: 13, color: 'kanap.text.tertiary', alignSelf: 'center' }} />
          </Tooltip>
        )}
        {typeof count === 'number' && (
          <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 500, lineHeight: 1.35 })}>
            {count}
          </Typography>
        )}
        {caption ? (
          <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 500, lineHeight: 1.35 })}>
            {caption}
          </Typography>
        ) : null}
      </Stack>
      {actions}
    </Stack>
  );
  return (
    <Box id={id} sx={{ border: '1px solid', borderColor: 'kanap.border.default', borderRadius: 1, bgcolor: 'kanap.bg.primary', minWidth: 0 }}>
      {collapsible ? (
        <Box
          role="button"
          tabIndex={0}
          onClick={onToggle}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              onToggle?.();
            }
          }}
          sx={{
            px: 1.5,
            py: 0.8,
            borderBottom: open ? '1px solid' : 'none',
            borderColor: 'kanap.border.default',
            borderRadius: open ? '6px 6px 0 0' : '6px',
            cursor: 'pointer',
            '&:hover': { bgcolor: 'kanap.bg.hover' },
          }}
        >
          {header}
        </Box>
      ) : (
        <Box sx={{ px: 1.5, py: 1, borderBottom: '1px solid', borderColor: 'kanap.border.default' }}>
          {header}
        </Box>
      )}
      {open && <Box sx={{ minWidth: 0 }}>{children}</Box>}
    </Box>
  );
}

export function MetricBlock({ label, value, status }: { label: string; value: React.ReactNode; status?: string }) {
  return (
    <Box sx={{ minWidth: 0, border: '1px solid', borderColor: 'divider', borderRadius: 1, bgcolor: 'background.paper', px: 1.25, py: 0.9 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
        {status ? <StatusText status={status} /> : null}
      </Stack>
      <Typography variant="h6" sx={{ mt: 0.25, lineHeight: 1.25 }}>{value}</Typography>
    </Box>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <Typography variant="body2" color="text.secondary" sx={{ p: 1.5 }}>{children}</Typography>;
}

export function ActionButtons({
  action,
  busy,
  onApprove,
  onReject,
  onDismiss,
}: {
  action: AiAgentControlActionRequest;
  busy: boolean;
  onApprove: (action: AiAgentControlActionRequest) => void;
  onReject: (action: AiAgentControlActionRequest) => void;
  onDismiss: (action: AiAgentControlActionRequest) => void;
}) {
  const { t } = useTranslation(['agents']);
  const canExecute = actionCanExecute(action);
  const canReject = actionCanReject(action);
  const blockedReason = actionBlockedReason(action);
  const executeLabel = action.status === 'approved' ? t('actions.execute') : t('actions.approve');
  return (
    <Stack direction="row" justifyContent="flex-end" spacing={0.75} flexWrap="wrap" useFlexGap>
      {/* Per-proposal decisions are peers, not the primary call to action —
          "Approve all" on the ticket group carries the contained treatment. */}
      <Tooltip title={blockedReason ?? executeLabel}>
        <span>
          <Button size="small" variant="outlined" color="inherit" disabled={busy || !canExecute} onClick={(event) => { event.stopPropagation(); onApprove(action); }}>
            {executeLabel}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={t('actions.reject')}>
        <span>
          <Button size="small" variant="outlined" color="inherit" disabled={busy || !canReject} onClick={(event) => { event.stopPropagation(); onReject(action); }}>
            {t('actions.reject')}
          </Button>
        </span>
      </Tooltip>
      <Tooltip title={t('actions.dismissHint')}>
        <span>
          <Button size="small" variant="text" color="inherit" disabled={busy || !canReject} onClick={(event) => { event.stopPropagation(); onDismiss(action); }}>
            {t('actions.dismiss')}
          </Button>
        </span>
      </Tooltip>
    </Stack>
  );
}

// Reason-capture confirmation dialog (replaces window.prompt for emergency pause).
// Uses KanapDialog so it respects tenant branding and the design system.
export function ReasonDialog({
  open,
  title,
  description,
  label,
  placeholder,
  busy,
  saveLabel,
  saveColor = 'error',
  onClose,
  onSubmit,
}: {
  open: boolean;
  title: string;
  description?: string;
  label: string;
  placeholder?: string;
  busy?: boolean;
  saveLabel: string;
  saveColor?: 'error' | 'primary';
  onClose: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = React.useState('');
  React.useEffect(() => {
    if (open) setReason('');
  }, [open]);
  return (
    <KanapDialog
      open={open}
      title={title}
      onClose={onClose}
      onSave={() => {
        const trimmed = reason.trim();
        if (trimmed) onSubmit(trimmed);
      }}
      saveLabel={saveLabel}
      saveVariant={saveColor === 'error' ? 'action-danger' : 'action-primary'}
      saveDisabled={!reason.trim() || !!busy}
      saveLoading={!!busy}
    >
      <Stack spacing={1.5}>
        {description ? <Typography variant="body2" color="text.secondary">{description}</Typography> : null}
        <SettingsField label={label}>
          <TextField
            multiline
            minRows={2}
            fullWidth
            size="small"
            value={reason}
            placeholder={placeholder}
            onChange={(event) => setReason(event.target.value)}
          />
        </SettingsField>
      </Stack>
    </KanapDialog>
  );
}

// Subtle per-section autosave indicator for a Section header `actions` slot:
// "Saving…" while the debounced PATCH is pending/in flight, "Saved" for ~1.5s
// after success, then hidden. Replaces explicit Save buttons (KANAP charter).
export function SaveIndicator({ status }: { status: AutosaveStatus }) {
  const { t } = useTranslation(['agents']);
  if (status === 'idle') return null;
  const label = status === 'error'
    ? t('settings.saveFailed')
    : status === 'saved'
      ? t('settings.saved')
      : t('settings.saving');
  return (
    <Typography variant="caption" color={status === 'error' ? 'error' : 'text.secondary'} aria-live="polite">
      {label}
    </Typography>
  );
}

export function SettingsField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.25 }}>{label}</Typography>
      {children}
      {hint && <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 0.25, opacity: 0.85 }}>{hint}</Typography>}
    </Box>
  );
}
