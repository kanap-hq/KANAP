import React from 'react';
import { Alert, Box, Button, CircularProgress, Divider, Stack, TextField, Tooltip, Typography } from '@mui/material';
import DoneOutlinedIcon from '@mui/icons-material/DoneOutlined';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import NotesOutlinedIcon from '@mui/icons-material/NotesOutlined';
import ManageSearchOutlinedIcon from '@mui/icons-material/ManageSearchOutlined';
import ReplayOutlinedIcon from '@mui/icons-material/ReplayOutlined';
import VisibilityOutlinedIcon from '@mui/icons-material/VisibilityOutlined';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyRow } from '../../components/design';
import {
  ActionButtons,
  actionAgentDefinitionId,
  actionAttentionMessage,
  actionBody,
  actionCanExecute,
  actionCanReject,
  executableActions,
  actionHasQueuedExecution,
  actionInProgress,
  actionIsTerminalStatus,
  actionLabel,
  actionNeedsAttention,
  actionUpdateSummary,
  buildTicketGroups,
  EmptyState,
  formatDateTime,
  humanize,
  INTERNAL_NOTE_CAPABILITY,
  isRecord,
  PUBLIC_REPLY_CAPABILITY,
  Section,
  StatusText,
  stringValue,
  TargetLabel,
  targetLabelText,
  type TicketWorkGroup,
  workItemAttentionMessage,
  workItemInProgress,
  workItemNeedsAttention,
} from '../../components/agents/agentControlPrimitives';
import {
  aiAgentControlApi,
  type AiAgentControlActionRequest,
  type AiAgentControlWorkItem,
} from '../../ai/aiApi';
import RunTraceDialog from '../../components/agents/RunTraceDialog';
import { useLocale } from '../../i18n/useLocale';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useAgentControlData } from './useAgentControlData';

const FINISHED_OPEN_STORAGE_KEY = 'kanap.agentsApprovals.finishedOpen';
const FINISHED_ROW_LIMIT = 30;
const FALLBACK_REASON_KEYS = new Set([
  'synthesis_error',
  'synthesis_disabled_by_env',
  'synthesis_projected_over_per_run_cap',
  'operating_context_leak',
  'invalid_or_ungrounded_synthesis',
]);

type TerminalApprovalRequest = {
  group: TicketWorkGroup;
  actions: AiAgentControlActionRequest[];
  mode: 'single' | 'bulk';
} | null;

type CompactRow = {
  id: string;
  status: string;
  capabilityLabel: string;
  targetType: string | null;
  targetRef: string | null;
  targetUrl: string | null;
  detail: string | null;
  time: string | null;
  caption?: string | null;
  traceRunId?: string | null;
  attention?: AttentionSubject | null;
};

// What a "Needs attention" row needs to be actionable: which record to
// acknowledge, and enough context to re-run the analysis that produced it.
type AttentionSubject = {
  kind: 'action' | 'work-item';
  agentDefinitionId: string | null;
  // false when the agent that produced the row was deleted since.
  agentExists: boolean | null;
  providerKind: string | null;
  providerKey: string | null;
  targetRef: string | null;
};

type AttentionRerun =
  | { kind: 'ticket'; providerKey: string; targetRef: string; agentDefinitionId: string }
  | { kind: 'alert'; agentDefinitionId: string; targetRef: string };

/**
 * Whether a row can be re-analysed, and how.
 *
 * Ticketing rows re-run the same "Test on a ticket" path (manual trigger) on the
 * row's ticket; monitoring rows re-run the alert diagnosis test. A row whose
 * provider, agent or target reference can no longer be resolved has no sensible
 * re-run — Acknowledge alone is the answer there.
 */
function attentionRerun(subject: AttentionSubject | null | undefined): AttentionRerun | null {
  if (!subject?.targetRef || subject.agentExists === false) return null;
  if (subject.providerKind === 'monitoring') {
    return subject.agentDefinitionId
      ? { kind: 'alert', agentDefinitionId: subject.agentDefinitionId, targetRef: subject.targetRef }
      : null;
  }
  if (subject.providerKind === 'ticketing' && subject.providerKey && subject.agentDefinitionId) {
    return {
      kind: 'ticket',
      providerKey: subject.providerKey,
      targetRef: subject.targetRef,
      agentDefinitionId: subject.agentDefinitionId,
    };
  }
  return null;
}

// The run trace opens in place, over the approvals list. A context rather than
// prop drilling: the trace button sits three component layers down, and the URL
// stays untouched so closing the dialog returns to the exact same context
// (filters, scroll, and — in the agent workspace — the current tab).
const OpenRunTraceContext = React.createContext<(runId: string) => void>(() => undefined);

function TraceButton({ runId, dense }: { runId: string; dense?: boolean }) {
  const { t } = useTranslation(['agents']);
  const openTrace = React.useContext(OpenRunTraceContext);
  return (
    <Button
      size="small"
      variant="text"
      startIcon={<VisibilityOutlinedIcon />}
      onClick={() => openTrace(runId)}
      sx={dense ? { minHeight: 24, py: 0 } : undefined}
    >
      {t('approvals.trace')}
    </Button>
  );
}

function proposalIcon(capabilityName: string) {
  if (capabilityName === PUBLIC_REPLY_CAPABILITY) return <ForumOutlinedIcon fontSize="small" color="action" />;
  if (capabilityName === INTERNAL_NOTE_CAPABILITY) return <NotesOutlinedIcon fontSize="small" color="action" />;
  return <ManageSearchOutlinedIcon fontSize="small" color="action" />;
}

function proposalBody(action: AiAgentControlActionRequest): string | null {
  if (action.capability_name === INTERNAL_NOTE_CAPABILITY || action.capability_name === PUBLIC_REPLY_CAPABILITY) {
    return actionBody(action);
  }
  return actionUpdateSummary(action);
}

function actionFinishedTime(action: AiAgentControlActionRequest): string | null {
  return action.executed_at
    ?? action.rejected_at
    ?? action.approved_at
    ?? action.updated_at
    ?? action.created_at
    ?? null;
}

function formatRelativeTime(value: string | null | undefined, locale: string, justNow: string): string {
  if (!value) return justNow;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return justNow;
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (abs < 45) return justNow;
  if (abs < 45 * 60) return rtf.format(Math.round(seconds / 60), 'minute');
  if (abs < 36 * 60 * 60) return rtf.format(Math.round(seconds / 3600), 'hour');
  if (abs < 30 * 24 * 60 * 60) return rtf.format(Math.round(seconds / 86400), 'day');
  return formatDateTime(value, locale);
}

function splitFallbackReason(raw: string | null): { key: string; detail: string | null } {
  if (!raw) return { key: 'unknown', detail: null };
  const separatorIndex = raw.indexOf(':');
  if (separatorIndex === -1) return { key: raw, detail: null };
  return {
    key: raw.slice(0, separatorIndex),
    detail: raw.slice(separatorIndex + 1).trim() || null,
  };
}

function synthesisFallbackInfo(action: AiAgentControlActionRequest, t: ReturnType<typeof useTranslation>['t']): { label: string; detail: string | null } | null {
  if (action.capability_name !== INTERNAL_NOTE_CAPABILITY && action.capability_name !== PUBLIC_REPLY_CAPABILITY) return null;
  const metadata = isRecord(action.metadata_json) ? action.metadata_json : null;
  if (metadata?.synthesis_usable !== false) return null;
  const { key, detail } = splitFallbackReason(stringValue(metadata.synthesis_fallback_reason));
  // 'synthesis_not_attempted' means the planner deliberately did not commission a sourced
  // answer (administrative reply or internal escalation) — nothing failed, so no warning.
  // Genuine failures carry their own reasons (synthesis_error:…, *_over_per_run_cap, …).
  if (key === 'synthesis_not_attempted') return null;
  const known = FALLBACK_REASON_KEYS.has(key);
  return {
    label: t(`approvals.fallbackReasons.${known ? key : 'unknown'}`, {
      reason: humanize(key),
      defaultValue: known ? humanize(key) : t('approvals.fallbackReasons.unknown', { reason: humanize(key) }),
    }),
    detail,
  };
}

function FallbackNote({ label, detail }: { label: string; detail: string | null }) {
  const { t } = useTranslation(['agents']);
  const [open, setOpen] = React.useState(false);
  return (
    <Typography sx={(theme) => ({ color: theme.palette.kanap.orange, fontSize: 12, fontWeight: 400, lineHeight: 1.45, mt: 0.75 })}>
      {t('approvals.fallbackNote')}
      {(label || detail) && (
        <>
          {' '}
          <Button
            size="small"
            variant="text"
            onClick={() => setOpen((current) => !current)}
            sx={{ minWidth: 0, px: 0.5, py: 0, fontSize: 12, fontWeight: 400, color: 'kanap.text.tertiary', textTransform: 'none' }}
          >
            {t('approvals.fallbackShowDetails')}
          </Button>
        </>
      )}
      {open && (
        <Box component="span" sx={(theme) => ({ display: 'block', color: theme.palette.kanap.text.tertiary, mt: 0.25 })}>
          {label}
          {detail ? ` — ${detail}` : ''}
        </Box>
      )}
    </Typography>
  );
}

function ProposalRow({
  action,
  busy,
  onApprove,
  onReject,
  onDismiss,
  emptyLabel,
}: {
  action: AiAgentControlActionRequest;
  busy: boolean;
  onApprove: (action: AiAgentControlActionRequest) => void;
  onReject: (action: AiAgentControlActionRequest) => void;
  onDismiss: (action: AiAgentControlActionRequest) => void;
  emptyLabel: string;
}) {
  const body = proposalBody(action);
  const { t } = useTranslation(['agents']);
  const terminal = actionIsTerminalStatus(action);
  const fallback = synthesisFallbackInfo(action, t);
  return (
    <Box sx={{ border: '1px solid', borderColor: 'kanap.border.default', borderRadius: 1, p: 1.25 }}>
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" flexWrap="wrap" useFlexGap sx={{ mb: 0.75 }}>
        <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
          {proposalIcon(action.capability_name)}
          <Typography sx={(theme) => ({ color: terminal ? theme.palette.kanap.danger : theme.palette.kanap.text.primary, fontSize: 13, fontWeight: 500 })}>
            {actionLabel(action)}
          </Typography>
          <StatusText status={action.status} />
        </Stack>
        <ActionButtons action={action} busy={busy} onApprove={onApprove} onReject={onReject} onDismiss={onDismiss} />
      </Stack>
      <Box sx={{ maxHeight: 170, overflow: 'auto', border: '1px solid', borderColor: 'kanap.border.soft', borderRadius: 1, bgcolor: 'kanap.bg.composer', px: 1, py: 0.85 }}>
        {body ? (
          <Typography component="pre" sx={{ m: 0, fontFamily: 'inherit', fontSize: 13, lineHeight: 1.45, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{body}</Typography>
        ) : (
          <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 13 })}>{emptyLabel}</Typography>
        )}
      </Box>
      {fallback && (
        <FallbackNote label={fallback.label} detail={fallback.detail} />
      )}
    </Box>
  );
}

function CompactStatusLine({
  action,
  locale,
}: {
  action: AiAgentControlActionRequest;
  locale: string;
}) {
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
      <StatusText status={action.status} />
      <Typography sx={(theme) => ({ color: theme.palette.kanap.text.primary, fontSize: 13, fontWeight: 400 })}>
        {actionLabel(action)}
      </Typography>
      <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 400 })}>
        {formatDateTime(actionFinishedTime(action), locale)}
      </Typography>
    </Stack>
  );
}

/**
 * The two ways out of a "Needs attention" row: re-run the analysis that failed,
 * or acknowledge it so it stops coming back. Without them the section was a
 * read-only list of dead ends.
 */
function AttentionRowActions({
  row,
  rerunning,
  onAcknowledge,
  onRerun,
}: {
  row: CompactRow;
  rerunning: boolean;
  onAcknowledge: (row: CompactRow) => void;
  onRerun: (row: CompactRow, rerun: AttentionRerun) => void;
}) {
  const { t } = useTranslation(['agents']);
  const rerun = attentionRerun(row.attention);
  return (
    <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
      {row.attention?.agentExists === false && (
        <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 400, px: 0.5 })}>
          {t('approvals.agentRemoved')}
        </Typography>
      )}
      {rerun && (
        <Tooltip title={rerunning ? t('approvals.rerunRunning') : t('approvals.rerunHint')}>
          <span>
            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={rerunning ? <CircularProgress size={12} /> : <ReplayOutlinedIcon />}
              disabled={rerunning}
              sx={{ minHeight: 24, py: 0 }}
              onClick={() => onRerun(row, rerun)}
            >
              {t('approvals.rerun')}
            </Button>
          </span>
        </Tooltip>
      )}
      <Tooltip title={t('approvals.acknowledgeHint')}>
        <span>
          <Button
            size="small"
            variant="text"
            color="inherit"
            startIcon={<DoneOutlinedIcon />}
            sx={{ minHeight: 24, py: 0 }}
            onClick={() => onAcknowledge(row)}
          >
            {t('approvals.acknowledge')}
          </Button>
        </span>
      </Tooltip>
    </Stack>
  );
}

function CompactLifecycleRow({
  row,
  locale,
  timeMode = 'relative',
  actions,
}: {
  row: CompactRow;
  locale: string;
  timeMode?: 'relative' | 'absolute';
  actions?: React.ReactNode;
}) {
  const { t } = useTranslation(['agents']);
  const displayedTime = timeMode === 'absolute'
    ? formatDateTime(row.time, locale)
    : formatRelativeTime(row.time, locale, t('approvals.justNow'));
  return (
    <Box sx={{ px: 1.5, py: 0.55, minWidth: 0 }}>
      <Stack direction="row" spacing={0.85} alignItems="center" flexWrap="wrap" useFlexGap sx={{ minWidth: 0 }}>
        <StatusText status={row.status} />
        <Typography sx={(theme) => ({ color: theme.palette.kanap.text.primary, fontSize: 13, fontWeight: 400 })}>
          {row.capabilityLabel}
        </Typography>
        <TargetLabel targetType={row.targetType} targetRef={row.targetRef} size="dense" href={row.targetUrl} />
        {row.detail && (
          <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 13, fontWeight: 400 })}>
            {row.detail}
          </Typography>
        )}
        <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 400 })}>
          {displayedTime}
        </Typography>
        {row.traceRunId && <TraceButton runId={row.traceRunId} dense />}
        {actions}
      </Stack>
      {row.caption && (
        <Typography sx={(theme) => ({ color: theme.palette.kanap.danger, fontSize: 12, fontWeight: 400, lineHeight: 1.35, mt: 0.2 })}>
          {row.caption}
        </Typography>
      )}
    </Box>
  );
}

function groupTargetText(group: TicketWorkGroup): string {
  return targetLabelText(group.targetType, group.targetRef);
}

function ApprovalReasonField({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation(['agents']);
  return (
    <PropertyRow label={t('approvals.reasonLabel')}>
      <TextField
        fullWidth
        multiline
        minRows={2}
        maxRows={4}
        size="small"
        variant="standard"
        value={value}
        placeholder={t('approvals.reasonPlaceholder')}
        inputProps={{ maxLength: 500 }}
        sx={{
            width: '100%',
            '& .MuiInputBase-input': {
              fontSize: 13,
              lineHeight: 1.45,
            },
          }}
        onChange={(event) => onChange(event.target.value)}
      />
    </PropertyRow>
  );
}

function DecisionGroup({
  group,
  locale,
  busyTicketKey,
  busyActionId,
  onApprove,
  onReject,
  onDismiss,
  onApproveAll,
  onRejectAll,
  onDismissAll,
}: {
  group: TicketWorkGroup;
  locale: string;
  busyTicketKey: string | null;
  busyActionId: string | null;
  onApprove: (action: AiAgentControlActionRequest, group: TicketWorkGroup) => void;
  onReject: (action: AiAgentControlActionRequest) => void;
  onDismiss: (action: AiAgentControlActionRequest) => void;
  onApproveAll: (group: TicketWorkGroup) => void;
  onRejectAll: (group: TicketWorkGroup) => void;
  onDismissAll: (group: TicketWorkGroup) => void;
}) {
  const { t } = useTranslation(['agents']);
  const pendingActions = group.pendingActions.filter((action) => action.status === 'pending');
  const decidedActions = group.pendingActions.filter((action) => action.status !== 'pending');
  const executableCount = group.pendingActions.filter(actionCanExecute).length;
  const rejectableCount = group.pendingActions.filter(actionCanReject).length;
  const dismissableCount = group.pendingActions.filter(actionCanReject).length;
  return (
    <Box sx={{ p: 1.5 }}>
      <Stack spacing={1.25}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} justifyContent="space-between" alignItems={{ md: 'center' }}>
          <Box sx={{ minWidth: 0 }}>
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
              <TargetLabel targetType={group.targetType} targetRef={group.targetRef} href={group.targetUrl} />
              <StatusText status={group.queueStatus} />
              <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 500 })}>
                {t('approvals.proposalCount', { count: pendingActions.length })}
              </Typography>
            </Stack>
            <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 12, fontWeight: 400, mt: 0.25 })}>
              {t('approvals.updated', { value: formatDateTime(group.updatedAt, locale) })}
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.75} alignItems="center" flexWrap="wrap" useFlexGap>
            {executableCount > 1 && (
              <Button size="small" variant="contained" disabled={busyTicketKey === group.key} onClick={() => onApproveAll(group)}>
                {t('approvals.approveAll')}
              </Button>
            )}
            {rejectableCount > 1 && (
              <Button size="small" variant="outlined" color="error" disabled={busyTicketKey === group.key} onClick={() => onRejectAll(group)}>
                {t('approvals.rejectAll')}
              </Button>
            )}
            {dismissableCount > 1 && (
              <Button size="small" variant="outlined" color="inherit" disabled={busyTicketKey === group.key} onClick={() => onDismissAll(group)}>
                {t('approvals.dismissAll')}
              </Button>
            )}
            {group.latestRunId && <TraceButton runId={group.latestRunId} />}
          </Stack>
        </Stack>
        <Stack spacing={1}>
          {pendingActions.map((action) => (
            <ProposalRow
              key={action.id}
              action={action}
              busy={busyActionId === action.id}
              onApprove={(next) => onApprove(next, group)}
              onReject={onReject}
              onDismiss={onDismiss}
              emptyLabel={t('approvals.noActiveProposal')}
            />
          ))}
          {decidedActions.length > 0 && (
            <Stack spacing={0.35}>
              {decidedActions.map((action) => (
                <CompactStatusLine key={action.id} action={action} locale={locale} />
              ))}
            </Stack>
          )}
        </Stack>
      </Stack>
    </Box>
  );
}

function buildInProgressRows(groups: TicketWorkGroup[], t: ReturnType<typeof useTranslation>['t']): CompactRow[] {
  return groups.flatMap((group) => {
    const actionRows = group.pendingActions
      .filter(actionInProgress)
      .map((action) => ({
        id: action.id,
        status: actionHasQueuedExecution(action) ? 'queued' : action.status,
        capabilityLabel: actionLabel(action),
        targetType: action.target_type ?? group.targetType,
        targetRef: action.target_ref ?? group.targetRef,
        targetUrl: group.targetUrl,
        detail: t('approvals.executing'),
        time: action.updated_at ?? action.approved_at ?? action.created_at,
      }));
    const workRows = group.workItems
      .filter(workItemInProgress)
      .map((workItem) => ({
        id: workItem.id,
        status: workItem.status,
        capabilityLabel: t('approvals.agentCheck'),
        targetType: workItem.source_object_type ?? group.targetType,
        targetRef: workItem.source_object_ref ?? group.targetRef,
        targetUrl: group.targetUrl,
        // "Agent working…" only when the agent actually holds the item; a queued item's
        // status chip already reads "Waiting to start" and must not be contradicted.
        detail: ['leased', 'running'].includes(workItem.status) ? t('approvals.agentWorking') : null,
        time: workItem.updated_at ?? workItem.created_at,
      }));
    return [...actionRows, ...workRows];
  });
}

function buildAttentionRows(
  groups: TicketWorkGroup[],
  t: ReturnType<typeof useTranslation>['t'],
  fallbackAgentDefinitionId: string | null,
): CompactRow[] {
  return groups.flatMap((group) => {
    const actionRows = group.pendingActions
      .filter(actionNeedsAttention)
      .map((action) => ({
        id: action.id,
        status: action.status,
        capabilityLabel: actionLabel(action),
        targetType: action.target_type ?? group.targetType,
        targetRef: action.target_ref ?? group.targetRef,
        targetUrl: group.targetUrl,
        detail: null,
        time: action.updated_at ?? action.created_at,
        caption: actionAttentionMessage(action),
        traceRunId: action.run_id ?? group.latestRunId,
        attention: {
          kind: 'action' as const,
          agentDefinitionId: action.agent_exists === false
            ? null
            : actionAgentDefinitionId(action) ?? fallbackAgentDefinitionId,
          agentExists: action.agent_exists ?? null,
          providerKind: action.provider_kind ?? group.providerKind,
          providerKey: action.provider_key ?? group.providerKey,
          targetRef: action.target_ref ?? group.targetRef,
        },
      }));
    const workRows = group.workItems
      .filter(workItemNeedsAttention)
      .map((workItem) => ({
        id: workItem.id,
        status: workItem.status,
        capabilityLabel: t('approvals.agentCheck'),
        targetType: workItem.source_object_type ?? group.targetType,
        targetRef: workItem.source_object_ref ?? group.targetRef,
        targetUrl: group.targetUrl,
        detail: null,
        time: workItem.updated_at ?? workItem.created_at,
        caption: workItemAttentionMessage(workItem),
        traceRunId: workItem.last_run_id ?? group.latestRunId,
        attention: {
          kind: 'work-item' as const,
          agentDefinitionId: workItem.agent_definition_id ?? fallbackAgentDefinitionId,
          agentExists: true,
          providerKind: workItem.source_provider_kind ?? group.providerKind,
          providerKey: workItem.source_provider_key ?? group.providerKey,
          targetRef: workItem.source_object_ref ?? group.targetRef,
        },
      }));
    return [...actionRows, ...workRows];
  });
}

function buildFinishedRows(groups: TicketWorkGroup[], t: ReturnType<typeof useTranslation>['t']): CompactRow[] {
  const rows = groups.flatMap((group) => {
    const actionRows = group.pendingActions.map((action) => ({
      id: action.id,
      status: action.status,
      capabilityLabel: actionLabel(action),
      targetType: action.target_type ?? group.targetType,
      targetRef: action.target_ref ?? group.targetRef,
      targetUrl: group.targetUrl,
      detail: null,
      time: actionFinishedTime(action),
    }));
    if (actionRows.length > 0) return actionRows;
    return group.workItems
      .filter((workItem) => ['completed', 'skipped'].includes(workItem.status))
      .map((workItem) => ({
        id: workItem.id,
        status: workItem.status,
        capabilityLabel: t('approvals.agentCheck'),
        targetType: workItem.source_object_type ?? group.targetType,
        targetRef: workItem.source_object_ref ?? group.targetRef,
        targetUrl: group.targetUrl,
        detail: null,
        time: workItem.updated_at ?? workItem.created_at,
      }));
  });
  return rows.sort((left, right) => {
    const leftTime = Date.parse(left.time ?? '');
    const rightTime = Date.parse(right.time ?? '');
    return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
  });
}

export default function AgentsApprovalsPage({ agentKey }: { agentKey?: string }) {
  const { t } = useTranslation(['agents']);
  const locale = useLocale();
  const data = useAgentControlData();
  const [rejectGroup, setRejectGroup] = React.useState<TicketWorkGroup | null>(null);
  const [dismissGroup, setDismissGroup] = React.useState<TicketWorkGroup | null>(null);
  const [rejectReason, setRejectReason] = React.useState('');
  const [terminalApproval, setTerminalApproval] = React.useState<TerminalApprovalRequest>(null);
  const [terminalApprovalReason, setTerminalApprovalReason] = React.useState('');
  const [traceRunId, setTraceRunId] = React.useState<string | null>(null);
  const [acknowledgedIds, setAcknowledgedIds] = React.useState<Set<string>>(() => new Set());
  const [rerunningRowId, setRerunningRowId] = React.useState<string | null>(null);
  const [acknowledgeAllOpen, setAcknowledgeAllOpen] = React.useState(false);
  const [finishedOpen, setFinishedOpen] = React.useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(FINISHED_OPEN_STORAGE_KEY) === 'true';
  });

  React.useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(FINISHED_OPEN_STORAGE_KEY, String(finishedOpen));
    }
  }, [finishedOpen]);
  React.useEffect(() => {
    if (rejectGroup) setRejectReason('');
  }, [rejectGroup]);
  React.useEffect(() => {
    if (terminalApproval) setTerminalApprovalReason('');
  }, [terminalApproval]);

  const agentDefinition = React.useMemo(() => (
    agentKey ? data.queueQuery.data?.definitions.find((definition) => definition.agent_key === agentKey) ?? null : null
  ), [agentKey, data.queueQuery.data]);
  const grouped = React.useMemo(
    () => buildTicketGroups(data.queueQuery.data ?? null, data.actionPool, agentDefinition?.id ?? null, Date.now()),
    [agentDefinition?.id, data.actionPool, data.queueQuery.data],
  );

  const needsDecisionGroups = React.useMemo(() => grouped.groups.filter((group) => group.lifecycle === 'needs_decision'), [grouped.groups]);
  const inProgressRows = React.useMemo(() => buildInProgressRows(grouped.groups.filter((group) => group.lifecycle === 'in_progress'), t), [grouped.groups, t]);
  const allAttentionRows = React.useMemo(
    () => buildAttentionRows(grouped.groups.filter((group) => group.lifecycle === 'needs_attention'), t, agentDefinition?.id ?? null),
    [agentDefinition?.id, grouped.groups, t],
  );
  // Acknowledged rows leave the list immediately; the server-side stamp keeps
  // them gone once the queue refetches, so this set is only the optimistic gap.
  const attentionRows = React.useMemo(
    () => allAttentionRows.filter((row) => !acknowledgedIds.has(row.id)),
    [acknowledgedIds, allAttentionRows],
  );
  // The queue only fetches its first 100 rows; the section count and the bulk
  // acknowledgement speak for the whole backlog, so ask the server for it.
  const attentionScopeId = agentDefinition?.id ?? null;
  const attentionSummaryQuery = useQuery({
    queryKey: ['ai-agent-control-attention-summary', attentionScopeId],
    queryFn: () => aiAgentControlApi.getAttentionSummary({ agent_definition_id: attentionScopeId }),
    enabled: !agentKey || !!agentDefinition,
    staleTime: 15_000,
  });
  const attentionTotal = attentionSummaryQuery.data?.total ?? null;
  const attentionCount = attentionTotal ?? attentionRows.length;
  const attentionHiddenCount = attentionTotal === null ? 0 : Math.max(0, attentionTotal - attentionRows.length);
  const finishedRows = React.useMemo(() => buildFinishedRows(grouped.groups.filter((group) => group.lifecycle === 'finished'), t), [grouped.groups, t]);
  const visibleFinishedRows = finishedRows.slice(0, FINISHED_ROW_LIMIT);
  const hiddenFinishedCount = Math.max(0, finishedRows.length - visibleFinishedRows.length);
  const loading = data.queueQuery.isLoading || data.actionsQuery.isLoading;

  const acknowledgeMutation = useMutation({
    mutationFn: (row: CompactRow) => {
      if (!row.attention) throw new Error(t('approvals.acknowledgeFailed'));
      return aiAgentControlApi.acknowledgeAttention(row.attention.kind, row.id);
    },
    onMutate: (row: CompactRow) => {
      data.setError(null);
      data.setMessage(null);
      setAcknowledgedIds((current) => new Set(current).add(row.id));
    },
    onSuccess: async () => {
      data.setMessage(t('approvals.acknowledgeDone'));
      await data.invalidate();
    },
    onError: (error, row) => {
      // Put the row back: an acknowledgement that did not persist must not look
      // like it did.
      setAcknowledgedIds((current) => {
        const next = new Set(current);
        next.delete(row.id);
        return next;
      });
      data.setError(getApiErrorMessage(error, t, t('approvals.acknowledgeFailed')));
    },
  });

  // "Re-run analysis" is the very same path as "Test on a ticket/alert" in the
  // Monitor tab (manual trigger), aimed at the row's own target.
  const rerunMutation = useMutation({
    mutationFn: async ({ rerun }: { row: CompactRow; rerun: AttentionRerun }): Promise<void> => {
      if (rerun.kind === 'alert') {
        await aiAgentControlApi.testAgentMonitoringDiagnosis(rerun.agentDefinitionId, { alert_id: rerun.targetRef });
        return;
      }
      await aiAgentControlApi.runTicketingTriage({
        provider_key: rerun.providerKey,
        target_key: rerun.targetRef,
        agent_definition_id: rerun.agentDefinitionId,
      });
    },
    onMutate: ({ row }) => {
      data.setError(null);
      data.setMessage(null);
      setRerunningRowId(row.id);
    },
    onSuccess: async (_result, { rerun }) => {
      data.setMessage(t('approvals.rerunStarted', { target: rerun.targetRef }));
      await data.invalidate();
    },
    onError: (error) => data.setError(getApiErrorMessage(error, t, t('approvals.rerunFailed'))),
    onSettled: () => setRerunningRowId(null),
  });

  const acknowledgeAllMutation = useMutation({
    mutationFn: () => aiAgentControlApi.acknowledgeAllAttention({ agent_definition_id: attentionScopeId }),
    onMutate: () => {
      data.setError(null);
      data.setMessage(null);
    },
    onSuccess: async (result) => {
      setAcknowledgeAllOpen(false);
      setAcknowledgedIds(new Set());
      data.setMessage(t('approvals.acknowledgeAllDone', { count: result.total }));
      await data.invalidate();
    },
    onError: (error) => data.setError(getApiErrorMessage(error, t, t('approvals.acknowledgeAllFailed'))),
  });

  const approveAll = (group: TicketWorkGroup, reason?: string | null) => {
    data.approveAllMutation.mutate({ key: group.key, actions: executableActions(group.pendingActions), reason });
  };
  const rejectAll = (group: TicketWorkGroup, reason?: string | null) => {
    data.rejectAllMutation.mutate({ key: group.key, actions: group.pendingActions, reason }, {
      onSettled: () => setRejectGroup(null),
    });
  };
  const dismissAll = (group: TicketWorkGroup) => {
    data.dismissAllMutation.mutate({ key: group.key, actions: group.pendingActions }, {
      onSettled: () => setDismissGroup(null),
    });
  };
  const handleApprove = (action: AiAgentControlActionRequest, group: TicketWorkGroup) => {
    if (actionIsTerminalStatus(action)) {
      setTerminalApproval({ group, actions: [action], mode: 'single' });
      return;
    }
    data.approveMutation.mutate({ action });
  };
  const handleApproveAll = (group: TicketWorkGroup) => {
    const executable = executableActions(group.pendingActions);
    if (executable.some(actionIsTerminalStatus)) {
      setTerminalApproval({ group, actions: executable, mode: 'bulk' });
      return;
    }
    approveAll(group);
  };
  const confirmTerminalApproval = () => {
    if (!terminalApproval) return;
    if (terminalApproval.mode === 'single') {
      const [action] = terminalApproval.actions;
      if (action) {
        data.approveMutation.mutate({ action, reason: terminalApprovalReason }, { onSettled: () => setTerminalApproval(null) });
      }
      return;
    }
    data.approveAllMutation.mutate({ key: terminalApproval.group.key, actions: terminalApproval.actions, reason: terminalApprovalReason }, {
      onSettled: () => setTerminalApproval(null),
    });
  };

  // The dialog approves every action in terminalApproval.actions, so the disclosure
  // must cover the full set — not just the terminal ones that triggered it.
  const approvalActions = terminalApproval?.actions ?? [];
  const terminalBusy = terminalApproval?.mode === 'bulk'
    ? data.busyTicketKey === terminalApproval.group.key
    : !!terminalApproval?.actions[0] && data.busyActionId === terminalApproval.actions[0].id;

  return (
    <OpenRunTraceContext.Provider value={setTraceRunId}>
    <Box sx={{ p: agentKey ? 0 : 2 }}>
      {!agentKey && (
        <>
          <PageHeader title={t('approvals.title')} />
          <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 13, fontWeight: 400, mb: 2 })}>{t('approvals.subtitle')}</Typography>
        </>
      )}
      <Stack spacing={2}>
        {data.error && <Alert severity="error" onClose={() => data.setError(null)}>{data.error}</Alert>}
        {data.message && <Alert severity="success" onClose={() => data.setMessage(null)}>{data.message}</Alert>}

        <Section title={t('approvals.needsDecision')} count={needsDecisionGroups.length}>
          {loading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
          ) : needsDecisionGroups.length === 0 ? (
            <EmptyState>{t('approvals.emptyDecision')}</EmptyState>
          ) : (
            <Stack spacing={2} divider={<Divider flexItem sx={{ borderColor: 'kanap.border.default' }} />}>
              {needsDecisionGroups.map((group) => (
                <DecisionGroup
                  key={group.key}
                  group={group}
                  locale={locale}
                  busyTicketKey={data.busyTicketKey}
                  busyActionId={data.busyActionId}
                  onApprove={handleApprove}
                  onReject={(action) => data.rejectMutation.mutate({ action })}
                  onDismiss={(action) => data.dismissMutation.mutate({ action })}
                  onApproveAll={handleApproveAll}
                  onRejectAll={setRejectGroup}
                  onDismissAll={setDismissGroup}
                />
              ))}
            </Stack>
          )}
        </Section>

        {/* The workspace control bar already states whether anything is running,
            so this section no longer carries its own status framing: it appears
            only when there are rows to show. */}
        {!agentKey && !loading && inProgressRows.length > 0 && (
          <Section title={t('approvals.inProgress')}>
            <Stack>
              {inProgressRows.map((row) => <CompactLifecycleRow key={row.id} row={row} locale={locale} />)}
            </Stack>
          </Section>
        )}

        {(attentionRows.length > 0 || attentionCount > 0) && (
          <Section
            title={t('approvals.needsAttention')}
            count={attentionCount}
            caption={attentionHiddenCount > 0
              ? t('approvals.attentionShowing', { shown: attentionRows.length, total: attentionCount })
              : undefined}
            actions={attentionCount > 0 ? (
              <Button variant="action" onClick={() => setAcknowledgeAllOpen(true)}>
                {t('approvals.acknowledgeAll')}
              </Button>
            ) : null}
          >
            <Stack>
              {attentionRows.map((row) => (
                <CompactLifecycleRow
                  key={row.id}
                  row={row}
                  locale={locale}
                  actions={row.attention ? (
                    <AttentionRowActions
                      row={row}
                      rerunning={rerunningRowId === row.id}
                      onAcknowledge={(next) => acknowledgeMutation.mutate(next)}
                      onRerun={(next, rerun) => rerunMutation.mutate({ row: next, rerun })}
                    />
                  ) : null}
                />
              ))}
            </Stack>
          </Section>
        )}

        {finishedRows.length > 0 && (
          <Section
            title={t('approvals.recentlyFinished')}
            count={finishedRows.length}
            collapsible
            open={finishedOpen}
            onToggle={() => setFinishedOpen((current) => !current)}
          >
            <Stack>
              {visibleFinishedRows.map((row) => <CompactLifecycleRow key={row.id} row={row} locale={locale} timeMode="absolute" />)}
              {hiddenFinishedCount > 0 && (
                <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 400, px: 1.5, py: 0.75 })}>
                  {t('approvals.moreFinished', { count: hiddenFinishedCount })}
                </Typography>
              )}
            </Stack>
          </Section>
        )}

        <KanapDialog
          open={acknowledgeAllOpen}
          title={t('approvals.acknowledgeAllTitle')}
          onClose={() => setAcknowledgeAllOpen(false)}
          onSave={() => acknowledgeAllMutation.mutate()}
          saveLabel={t('approvals.acknowledgeAll')}
          saveLoading={acknowledgeAllMutation.isPending}
        >
          <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 13, fontWeight: 400 })}>
            {t('approvals.acknowledgeAllBody', { count: attentionCount })}
          </Typography>
        </KanapDialog>

        <KanapDialog
          open={!!rejectGroup}
          title={t('approvals.rejectAllTitle')}
          onClose={() => setRejectGroup(null)}
          onSave={() => { if (rejectGroup) rejectAll(rejectGroup, rejectReason); }}
          saveLabel={t('approvals.rejectAll')}
          saveVariant="action-danger"
          saveLoading={!!rejectGroup && data.busyTicketKey === rejectGroup.key}
        >
          <Stack spacing={1.25}>
            <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 13, fontWeight: 400 })}>
              {t('approvals.rejectAllConfirm', {
                count: rejectGroup?.pendingActions.filter(actionCanReject).length ?? 0,
                target: rejectGroup ? groupTargetText(rejectGroup) : '',
              })}
            </Typography>
            <ApprovalReasonField value={rejectReason} onChange={setRejectReason} />
          </Stack>
        </KanapDialog>

        <KanapDialog
          open={!!dismissGroup}
          title={t('approvals.dismissAllTitle')}
          onClose={() => setDismissGroup(null)}
          onSave={() => { if (dismissGroup) dismissAll(dismissGroup); }}
          saveLabel={t('approvals.dismissAll')}
          saveLoading={!!dismissGroup && data.busyTicketKey === dismissGroup.key}
        >
          <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 13, fontWeight: 400 })}>
            {t('approvals.dismissAllConfirm', {
              count: dismissGroup?.pendingActions.filter(actionCanReject).length ?? 0,
              target: dismissGroup ? groupTargetText(dismissGroup) : '',
            })}
          </Typography>
        </KanapDialog>

        <KanapDialog
          open={!!terminalApproval}
          title={approvalActions.length > 1
            ? t('approvals.terminalConfirmTitleMany')
            : t('approvals.terminalConfirmTitle', { action: approvalActions[0] ? actionLabel(approvalActions[0]) : '' })}
          onClose={() => setTerminalApproval(null)}
          onSave={confirmTerminalApproval}
          saveLabel={approvalActions.length === 1 && approvalActions[0] ? actionLabel(approvalActions[0]) : t('approvals.approveAll')}
          saveVariant="action-danger"
          saveLoading={terminalBusy}
        >
          <Stack spacing={1.25}>
            <Typography sx={(theme) => ({ color: theme.palette.kanap.text.secondary, fontSize: 13, fontWeight: 400 })}>
              {approvalActions.length > 1
                ? t('approvals.terminalConfirmBodyMany', {
                  count: approvalActions.length,
                  target: terminalApproval ? groupTargetText(terminalApproval.group) : '',
                })
                : t('approvals.terminalConfirmBody', {
                  action: approvalActions[0] ? actionLabel(approvalActions[0]) : '',
                  target: terminalApproval ? groupTargetText(terminalApproval.group) : '',
                })}
            </Typography>
            {approvalActions.length > 1 && (
              <Stack spacing={0.5}>
                <Typography sx={(theme) => ({ color: theme.palette.kanap.text.tertiary, fontSize: 12, fontWeight: 500 })}>
                  {t('approvals.terminalActionList')}
                </Typography>
                {approvalActions.map((action) => (
                  <Typography
                    key={action.id}
                    sx={(theme) => ({
                      color: actionIsTerminalStatus(action) ? theme.palette.kanap.danger : theme.palette.kanap.text.primary,
                      fontSize: 13,
                      fontWeight: 400,
                    })}
                  >
                    {actionLabel(action)}
                  </Typography>
                ))}
              </Stack>
            )}
            <ApprovalReasonField value={terminalApprovalReason} onChange={setTerminalApprovalReason} />
          </Stack>
        </KanapDialog>

        <RunTraceDialog runId={traceRunId} onClose={() => setTraceRunId(null)} />
      </Stack>
    </Box>
    </OpenRunTraceContext.Provider>
  );
}
