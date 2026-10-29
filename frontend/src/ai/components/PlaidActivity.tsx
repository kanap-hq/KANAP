import React, { useMemo, useState } from 'react';
import { Box, CircularProgress, Collapse, Stack, Typography } from '@mui/material';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useTranslation } from 'react-i18next';
import {
  AiMutationPreview,
  ChatActivityPhase,
  ChatActivityEntry,
  ChatContextBudget,
  ChatContextItem,
  ChatContextSummary,
  ChatDebugTraceEntry,
  ChatMessage,
} from '../aiTypes';
import { getToolResultSummary } from './ToolResultRenderer';

type PlaidActivityProps = {
  message: ChatMessage;
  previousUserMessage?: ChatMessage | null;
  previews: AiMutationPreview[];
};

const SHOW_PLAID_DEBUG_DETAILS = import.meta.env.DEV;

const ENTITY_TYPE_FROM_URL_PREFIX: Array<{ prefix: string; entityType: string }> = [
  { prefix: '/knowledge/', entityType: 'documents' },
  { prefix: '/portfolio/tasks/', entityType: 'tasks' },
  { prefix: '/portfolio/projects/', entityType: 'projects' },
  { prefix: '/portfolio/requests/', entityType: 'requests' },
  { prefix: '/it/applications/', entityType: 'applications' },
  { prefix: '/it/assets/', entityType: 'assets' },
  { prefix: '/it/technologies/', entityType: 'technologies' },
  { prefix: '/it/connections/', entityType: 'connections' },
  { prefix: '/it/interfaces/', entityType: 'interfaces' },
  { prefix: '/it/locations/', entityType: 'locations' },
  { prefix: '/ops/contracts/', entityType: 'contracts' },
  { prefix: '/it/incidents/', entityType: 'incidents' },
  { prefix: '/master-data/companies/', entityType: 'companies' },
  { prefix: '/master-data/contacts/', entityType: 'contacts' },
  { prefix: '/master-data/departments/', entityType: 'departments' },
  { prefix: '/master-data/suppliers/', entityType: 'suppliers' },
  { prefix: '/master-data/business-processes/', entityType: 'business_processes' },
];

function contextItemKey(item: ChatContextItem): string {
  if (item.ref) {
    return [item.kind, item.entity_type || '', item.ref].join('\u0000');
  }
  return [
    item.kind,
    item.entity_type || '',
    item.ref || '',
    item.label || '',
    item.detail || '',
    item.status || '',
  ].join('\u0000');
}

function mergeItems(...groups: Array<ChatContextItem[] | undefined>): ChatContextItem[] {
  const items: ChatContextItem[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group || []) {
      if (!item?.label) continue;
      const key = contextItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(item);
    }
  }
  return items;
}

function isMoreItem(item: ChatContextItem): boolean {
  return typeof item.count === 'number' || /^\d+\s+more$/i.test(item.label);
}

function displayContextItems(items: ChatContextItem[], maxItems = 8): ChatContextItem[] {
  const regular = items.filter((item) => !isMoreItem(item));
  const more = items.filter(isMoreItem);
  const regularLimit = Math.max(0, maxItems - more.length);
  const selectedRegular = regular.slice(0, regularLimit);
  return [...selectedRegular, ...more.slice(0, Math.max(0, maxItems - selectedRegular.length))];
}

function inferEntityTypeFromUrl(url: string): string | null {
  // Neutral budget links carry no nature. The server resolves their context before displaying it.
  if (url.startsWith('/ops/budget/')) return null;
  return ENTITY_TYPE_FROM_URL_PREFIX.find((entry) => url.startsWith(entry.prefix))?.entityType ?? null;
}

function extractMentions(text: string): ChatContextItem[] {
  const items: ChatContextItem[] = [];
  const linkRe = /\[([^\]]{1,160})\]\((\/[^)\s]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text || '')) != null) {
    const label = String(match[1] || '').replace(/\s+/g, ' ').trim();
    const entityType = inferEntityTypeFromUrl(String(match[2] || ''));
    if (!label || !entityType) continue;
    items.push({
      kind: 'mention',
      label,
      entity_type: entityType,
      ref: /^[A-Z]+-\d+$/.test(label) ? label : null,
    });
  }
  return items;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size >= 1024 * 1024) return `${Math.round((size / (1024 * 1024)) * 10) / 10} MB`;
  if (size >= 1024) return `${Math.round(size / 1024)} KB`;
  return `${size} B`;
}

function attachmentItems(message?: ChatMessage | null): ChatContextItem[] {
  return (message?.attachments || []).map((attachment, index) => ({
    kind: 'attachment',
    label: attachment.kind === 'image' ? `Image ${index + 1}` : attachment.kind || `Attachment ${index + 1}`,
    detail: formatBytes(attachment.size) || attachment.mime_type,
  }));
}

function previewItems(previews: AiMutationPreview[]): ChatContextItem[] {
  return previews.map((preview) => ({
    kind: 'artifact',
    label: preview.target?.ref || preview.target?.title || preview.summary || preview.tool_name,
    detail: preview.tool_name.replace(/_/g, ' '),
    entity_type: preview.target?.entity_type ?? null,
    ref: preview.target?.ref ?? null,
    status: preview.status,
  }));
}

function entityItemFromResult(item: any, kind: ChatContextItem['kind']): ChatContextItem | null {
  if (!item || typeof item !== 'object') return null;
  const entityType = typeof item.type === 'string'
    ? item.type
    : typeof item.entity_type === 'string'
      ? item.entity_type
      : null;
  const label = String(item.ref || item.title || item.label || item.name || item.id || '').trim();
  if (!label) return null;
  return {
    kind: entityType === 'documents' ? 'document' : kind,
    label,
    detail: String(item.title || item.label || item.summary || entityType || '').trim() || null,
    entity_type: entityType,
    ref: typeof item.ref === 'string' ? item.ref : null,
    status: typeof item.status === 'string' ? item.status : null,
  };
}

function injectedItemsFromToolResults(message: ChatMessage): ChatContextItem[] {
  const items: ChatContextItem[] = [];
  for (const toolResult of message.toolResults || []) {
    const data = toolResult.result as any;
    if (!data || typeof data !== 'object') continue;
    if (toolResult.name === 'get_document') {
      const label = String(data.ref || data.title || '').trim();
      if (label) {
        items.push({
          kind: 'document',
          label,
          detail: String(data.title || data.summary || '').trim() || null,
          entity_type: 'documents',
          ref: typeof data.ref === 'string' ? data.ref : null,
          status: typeof data.status === 'string' ? data.status : null,
        });
      }
      continue;
    }
    const leadingItems = data.entity && typeof data.entity === 'object' ? [data.entity] : [];
    const rawItems = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.related)
        ? data.related.flatMap((group: any) => Array.isArray(group?.items) ? group.items : [])
        : [];
    const kind: ChatContextItem['kind'] = toolResult.name === 'search_knowledge' ? 'document' : 'entity';
    for (const raw of [...leadingItems, ...rawItems].slice(0, 8)) {
      const item = entityItemFromResult(raw, kind);
      if (item) items.push(item);
    }
  }
  return items;
}

function getCurrentActivity(activity: ChatActivityEntry[] | undefined, isStreaming?: boolean): ChatActivityEntry | null {
  if (!activity?.length) return null;
  if (isStreaming) {
    return [...activity].reverse().find((entry) => entry.status === 'running') || activity[activity.length - 1];
  }
  return activity[activity.length - 1];
}

function toolActivityPhase(toolName: string): ChatActivityPhase {
  if ([
    'search_all',
    'query_entities',
    'aggregate_entities',
    'describe_entity_filters',
    'get_filter_values',
  ].includes(toolName)) {
    return 'searching_entities';
  }
  if (['get_entity_detail', 'get_entity_context', 'get_entity_comments', 'get_record_history'].includes(toolName)) {
    return 'reading_context';
  }
  if (toolName === 'search_knowledge') return 'searching_knowledge';
  if (toolName === 'get_document') return 'reading_document';
  if (toolName === 'web_search') return 'searching_web';
  if (
    toolName === 'undo_preview'
    || toolName === 'prepare_mutation_plan'
    || toolName.startsWith('create_')
    || toolName.startsWith('update_')
    || toolName.startsWith('add_')
    || toolName.startsWith('import_')
    || toolName.startsWith('write_')
  ) {
    return 'preparing_change';
  }
  return 'using_tool';
}

type ActivityRow =
  | { kind: 'phase'; key: string; entry: ChatActivityEntry }
  | {
      kind: 'tool';
      key: string;
      phase: ChatActivityPhase;
      toolCall: NonNullable<ChatMessage['toolCalls']>[number];
      result?: unknown;
      status: ChatActivityEntry['status'];
      /** A failed call that a later call of the same tool repaired, as the server says: not shown as a failure. */
      recovered?: boolean;
    };

function isToolError(result: unknown): boolean {
  return !!result && typeof result === 'object' && 'error' in result;
}

/** The ids of the failed calls that a later call repaired, as the server named them (`repairs`). */
export function repairedToolCallIds(toolResults: ChatMessage['toolResults']): Set<string> {
  return new Set((toolResults || []).flatMap((item) => (Array.isArray(item.repairs) ? item.repairs : [])));
}

/**
 * A failed tool call that a later call of the same tool repaired in the same turn (a reference the
 * write refused, then the same write by name; a missing field, then added) is part of the work, not
 * a failure for the person. The server decides it (`ai-tool-repairs.ts`: an input error, the same
 * tool on the same target): a failure on another record, a refused right or a server error stays shown.
 */
export function markRecoveredToolFailures<T extends {
  kind: string;
  toolCall?: { id?: string; name: string };
  result?: unknown;
  recovered?: boolean;
}>(rows: T[], repairedIds: ReadonlySet<string>): T[] {
  return rows.map((row) => (
    row.kind === 'tool' && row.toolCall?.id && isToolError(row.result) && repairedIds.has(row.toolCall.id)
      ? { ...row, recovered: true }
      : row
  ));
}

function buildActivityRows(message: ChatMessage): ActivityRow[] {
  const rows: ActivityRow[] = [];
  const consumedToolIds = new Set<string>();
  const seenGenericPhases = new Set<string>();
  const toolCalls = message.toolCalls || [];
  const toolResults = message.toolResults || [];

  for (const entry of message.activity || []) {
    if (entry.tool_name) {
      const toolCall = toolCalls.find((candidate) =>
        !consumedToolIds.has(candidate.id) && candidate.name === entry.tool_name,
      ) || toolCalls.find((candidate) => !consumedToolIds.has(candidate.id));
      if (toolCall) {
        const result = toolResults.find((item) => item.id === toolCall.id);
        consumedToolIds.add(toolCall.id);
        rows.push({
          kind: 'tool',
          key: `tool-${toolCall.id || rows.length}`,
          phase: toolActivityPhase(toolCall.name),
          toolCall,
          result: result?.result,
          status: result ? 'completed' : message.isStreaming ? 'running' : entry.status,
        });
      } else if (entry.status === 'running') {
        rows.push({ kind: 'phase', key: `phase-${entry.phase}-${rows.length}`, entry });
      }
      continue;
    }

    const dedupeKey = entry.phase;
    if (entry.phase === 'analyzing' && seenGenericPhases.has(dedupeKey)) {
      continue;
    }
    seenGenericPhases.add(dedupeKey);
    rows.push({ kind: 'phase', key: `phase-${entry.phase}-${rows.length}`, entry });
  }

  for (const toolCall of toolCalls) {
    if (consumedToolIds.has(toolCall.id)) continue;
    const result = toolResults.find((item) => item.id === toolCall.id);
    rows.push({
      kind: 'tool',
      key: `tool-${toolCall.id || rows.length}`,
      phase: toolActivityPhase(toolCall.name),
      toolCall,
      result: result?.result,
      status: result ? 'completed' : message.isStreaming ? 'running' : 'completed',
    });
  }

  return markRecoveredToolFailures(rows, repairedToolCallIds(toolResults)).slice(-14);
}

function activityCount(message: ChatMessage): number {
  return buildActivityRows(message).filter((row) =>
    row.kind === 'tool' || row.entry.phase !== 'finalizing',
  ).length;
}

function calledToolCount(message: ChatMessage): number {
  const toolCalls = message.toolCalls || [];
  if (toolCalls.length > 0) {
    return toolCalls.length;
  }
  return new Set((message.activity || []).map((entry) => entry.tool_name).filter(Boolean)).size;
}

function ContextSection({
  title,
  items,
}: {
  title: string;
  items: ChatContextItem[];
}) {
  if (!items.length) return null;
  const visibleItems = displayContextItems(items);
  return (
    <Stack spacing={0.35}>
      <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
        {title}
      </Typography>
      <Stack spacing={0.25}>
        {visibleItems.map((item, index) => (
          <Stack
            key={`${contextItemKey(item)}-${index}`}
            direction="row"
            spacing={0.75}
            alignItems="baseline"
            sx={{ minWidth: 0 }}
          >
            <Box
              sx={{
                width: 4,
                height: 4,
                borderRadius: '50%',
                bgcolor: 'kanap.text.tertiary',
                flexShrink: 0,
                mt: '7px',
              }}
            />
            <Typography
              component="span"
              sx={{
                fontSize: 12,
                color: 'kanap.text.secondary',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                minWidth: 0,
              }}
            >
              {item.label}
            </Typography>
            {item.detail && item.detail !== item.label && (
              <Typography
                component="span"
                sx={{
                  fontSize: 11,
                  color: 'kanap.text.tertiary',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  minWidth: 0,
                }}
              >
                {item.detail}
              </Typography>
            )}
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function formatToolArgs(
  t: ReturnType<typeof useTranslation>['t'],
  args?: Record<string, unknown>,
): string {
  if (!args) return '';
  const parts: string[] = [];
  const entityType = typeof args.entity_type === 'string' ? args.entity_type : null;
  const scope = typeof args.scope === 'string' ? args.scope : null;
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  const fields = Array.isArray(args.fields)
    ? args.fields.filter((field): field is string => typeof field === 'string')
    : [];
  const filters = args.filters && typeof args.filters === 'object' && !Array.isArray(args.filters)
    ? Object.keys(args.filters as Record<string, unknown>)
    : [];

  if (entityType) parts.push(entityType);
  if (scope) parts.push(scope);
  if (filters.length > 0) parts.push(t('activity.toolTrace.filters', { count: filters.length }));
  if (fields.length > 0) parts.push(fields.slice(0, 3).join(', '));
  if (query) parts.push(query.length > 36 ? `${query.slice(0, 33)}...` : query);

  return parts.join(' · ');
}

function formatToolResult(
  t: ReturnType<typeof useTranslation>['t'],
  toolName: string,
  result: unknown,
  status: ChatActivityEntry['status'],
  recovered = false,
): string {
  if (status === 'running' && result === undefined) return t('activity.toolTrace.running');
  if (recovered) return '';
  if (isToolError(result)) return t('activity.toolTrace.failed');
  const summary = getToolResultSummary(toolName, result);
  if (!summary) return status === 'failed' ? t('activity.toolTrace.failed') : '';
  if (summary.count === 0) return t('messageList.toolCallNoResult');
  return t('messageList.toolCallResults', { count: summary.count });
}

function ActivitySteps({ message }: { message: ChatMessage }) {
  const { t } = useTranslation(['ai']);
  const steps = buildActivityRows(message);
  if (steps.length === 0) return null;
  return (
    <Stack spacing={0.35}>
      <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
        {t('activity.sections.steps')}
      </Typography>
      <Stack spacing={0.25}>
        {steps.map((row) => {
          const phase = row.kind === 'phase' ? row.entry.phase : row.phase;
          const status = row.kind === 'phase' ? row.entry.status : row.status;
          const toolName = row.kind === 'tool' ? t(`toolResults.toolNames.${row.toolCall.name}`, {
            defaultValue: row.toolCall.name.replace(/_/g, ' '),
          }) : null;
          const argsHint = row.kind === 'tool' ? formatToolArgs(t, row.toolCall.arguments) : '';
          const resultHint = row.kind === 'tool'
            ? formatToolResult(t, row.toolCall.name, row.result, row.status, row.recovered)
            : '';
          return (
            <Stack key={row.key} direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <Box
                sx={{
                  width: 5,
                  height: 5,
                  borderRadius: '50%',
                  bgcolor: status === 'failed' ? 'error.main' : status === 'running' ? 'kanap.text.secondary' : 'kanap.text.tertiary',
                  flexShrink: 0,
                }}
              />
              <Typography
                component="span"
                sx={{
                  fontSize: 12,
                  color: 'kanap.text.secondary',
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {row.kind === 'tool'
                  ? [t(`activity.phases.${phase}`), toolName, argsHint].filter(Boolean).join(' · ')
                  : t(`activity.phases.${phase}`)}
              </Typography>
              {resultHint && (
                <Typography
                  component="span"
                  sx={{ fontSize: 11, color: 'kanap.text.tertiary', whiteSpace: 'nowrap', flexShrink: 0 }}
                >
                  {resultHint}
                </Typography>
              )}
            </Stack>
          );
        })}
      </Stack>
    </Stack>
  );
}

function formatBudgetSize(value: number | null | undefined): string {
  const size = Number(value ?? 0);
  return Number.isFinite(size) ? String(Math.max(0, Math.round(size))) : '0';
}

function formatDurationMs(value: number | null | undefined): string {
  const ms = Number(value ?? 0);
  if (!Number.isFinite(ms) || ms <= 0) return '0 ms';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 10000) return `${Math.round(ms / 100) / 10} s`;
  return `${Math.round(ms / 1000)} s`;
}

function sortedDebugTrace(entries: ChatDebugTraceEntry[] | undefined): ChatDebugTraceEntry[] {
  return [...(entries || [])]
    .filter((entry) => Number.isFinite(Number(entry.elapsed_ms)))
    .sort((left, right) => Number(left.elapsed_ms) - Number(right.elapsed_ms));
}

function firstTrace(
  entries: ChatDebugTraceEntry[],
  names: ChatDebugTraceEntry['name'][],
  opts: { iteration?: number | null; afterMs?: number } = {},
): ChatDebugTraceEntry | null {
  return entries.find((entry) => (
    names.includes(entry.name)
    && (opts.iteration == null || entry.iteration === opts.iteration)
    && (opts.afterMs == null || Number(entry.elapsed_ms) >= opts.afterMs)
  )) || null;
}

function traceDelta(start: ChatDebugTraceEntry | null, end: ChatDebugTraceEntry | null): string | null {
  if (!start || !end) return null;
  return formatDurationMs(Math.max(0, Number(end.elapsed_ms) - Number(start.elapsed_ms)));
}

function traceOffset(entry: ChatDebugTraceEntry | null): string | null {
  if (!entry) return null;
  return formatDurationMs(Number(entry.elapsed_ms));
}

function buildDebugTraceSegments(
  t: ReturnType<typeof useTranslation>['t'],
  rawEntries: ChatDebugTraceEntry[] | undefined,
): Array<{ key: string; label: string; value: string; detail?: string | null }> {
  const entries = sortedDebugTrace(rawEntries);
  if (entries.length === 0) return [];

  const segments: Array<{ key: string; label: string; value: string; detail?: string | null }> = [];
  const contextPrepared = firstTrace(entries, ['context_prepared']);
  const contextValue = traceOffset(contextPrepared);
  if (contextValue) {
    segments.push({
      key: 'context',
      label: t('activity.debugTrace.segments.contextPreparation'),
      value: contextValue,
    });
  }

  const iterations = Array.from(new Set(
    entries
      .map((entry) => entry.iteration)
      .filter((iteration): iteration is number => typeof iteration === 'number' && Number.isFinite(iteration)),
  )).sort((left, right) => left - right);

  for (const iteration of iterations) {
    const requestStarted = firstTrace(entries, ['provider_request_started'], { iteration });
    const firstAction = firstTrace(entries, ['provider_first_tool_delta', 'provider_first_text_delta'], { iteration });
    const waitValue = traceDelta(requestStarted, firstAction);
    if (waitValue) {
      segments.push({
        key: `model-wait-${iteration}`,
        label: t('activity.debugTrace.segments.modelWait'),
        value: waitValue,
        detail: t('activity.debugTrace.iteration', { count: iteration }),
      });
    }

    const firstTool = firstTrace(entries, ['provider_first_tool_delta'], { iteration });
    const toolCompleted = firstTrace(entries, ['provider_tool_call_completed'], {
      iteration,
      afterMs: firstTool ? Number(firstTool.elapsed_ms) : undefined,
    });
    const toolGenerationValue = traceDelta(firstTool, toolCompleted);
    if (toolGenerationValue) {
      segments.push({
        key: `tool-generation-${iteration}`,
        label: t('activity.debugTrace.segments.toolGeneration'),
        value: toolGenerationValue,
        detail: toolCompleted?.tool_name
          ? t(`toolResults.toolNames.${toolCompleted.tool_name}`, {
            defaultValue: toolCompleted.tool_name.replace(/_/g, ' '),
          })
          : t('activity.debugTrace.iteration', { count: iteration }),
      });
    }
  }

  entries
    .filter((entry) => entry.name === 'tool_execution_started')
    .forEach((started, index) => {
      const completed = firstTrace(entries, ['tool_execution_completed'], {
        iteration: started.iteration ?? null,
        afterMs: Number(started.elapsed_ms),
      });
      const value = traceDelta(started, completed);
      if (!value) return;
      segments.push({
        key: `tool-exec-${index}`,
        label: t('activity.debugTrace.segments.toolExecution'),
        value,
        detail: started.tool_name
          ? t(`toolResults.toolNames.${started.tool_name}`, {
            defaultValue: started.tool_name.replace(/_/g, ' '),
          })
          : null,
      });
    });

  const firstVisibleAnswer = firstTrace(entries, ['assistant_text_started']);
  const firstVisibleAnswerValue = traceOffset(firstVisibleAnswer);
  if (firstVisibleAnswerValue) {
    segments.push({
      key: 'first-visible-answer',
      label: t('activity.debugTrace.segments.firstVisibleAnswer'),
      value: firstVisibleAnswerValue,
    });
  }

  return segments.slice(0, 16);
}

function DebugTraceSection({ entries }: { entries?: ChatDebugTraceEntry[] }) {
  const { t } = useTranslation(['ai']);
  const sortedEntries = sortedDebugTrace(entries);
  if (sortedEntries.length === 0) return null;

  const segments = buildDebugTraceSegments(t, sortedEntries);
  const visibleMilestones = sortedEntries.slice(-18);

  return (
    <Stack spacing={0.55}>
      <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
        {t('activity.sections.debugTrace')}
      </Typography>
      {segments.length > 0 && (
        <Stack spacing={0.25}>
          {segments.map((segment) => (
            <Stack key={segment.key} direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', flex: 1, minWidth: 0 }}>
                {segment.label}
              </Typography>
              {segment.detail && (
                <Typography
                  sx={{
                    fontSize: 11,
                    color: 'kanap.text.tertiary',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    minWidth: 0,
                    maxWidth: '42%',
                  }}
                >
                  {segment.detail}
                </Typography>
              )}
              <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary', flexShrink: 0 }}>
                {segment.value}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
      <Stack spacing={0.2} sx={{ pt: segments.length > 0 ? 0.25 : 0 }}>
        {visibleMilestones.map((entry, index) => (
          <Stack
            key={`${entry.name}-${entry.iteration ?? 'turn'}-${entry.elapsed_ms}-${index}`}
            direction="row"
            spacing={1}
            alignItems="baseline"
            sx={{ minWidth: 0 }}
          >
            <Typography
              sx={{
                fontSize: 11,
                color: 'kanap.text.tertiary',
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {[
                t(`activity.debugTrace.names.${entry.name}`),
                entry.iteration ? t('activity.debugTrace.iteration', { count: entry.iteration }) : null,
                entry.tool_name
                  ? t(`toolResults.toolNames.${entry.tool_name}`, {
                    defaultValue: entry.tool_name.replace(/_/g, ' '),
                  })
                  : null,
              ].filter(Boolean).join(' · ')}
            </Typography>
            <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', flexShrink: 0 }}>
              {formatDurationMs(entry.elapsed_ms)}
            </Typography>
          </Stack>
        ))}
      </Stack>
    </Stack>
  );
}

function BudgetBreakdown({ budget }: { budget?: ChatContextBudget | null }) {
  const { t } = useTranslation(['ai']);
  const breakdown = budget?.breakdown;
  if (!breakdown) return null;

  const roleRows = [
    { label: t('activity.metrics.userMessages'), size: breakdown.message_roles.user },
    { label: t('activity.metrics.assistantMessages'), size: breakdown.message_roles.assistant },
    { label: t('activity.metrics.toolMessages'), size: breakdown.message_roles.tool },
  ].filter((row) => row.size > 0);

  const systemSections = [...(breakdown.system_prompt_sections || [])]
    .filter((section) => section.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 12);
  const toolSchemas = breakdown.tool_schemas;
  const largestToolSchemas = [...(toolSchemas?.tools || [])]
    .filter((tool) => tool.size > 0)
    .sort((a, b) => b.size - a.size)
    .slice(0, 8);

  const rows = [
    { label: t('activity.metrics.systemPrompt'), size: breakdown.system_prompt },
    ...(toolSchemas && toolSchemas.total > 0
      ? [{ label: t('activity.metrics.toolSchemas'), size: toolSchemas.total }]
      : []),
    { label: t('activity.metrics.messages'), size: breakdown.messages },
    ...roleRows,
    ...(breakdown.tool_call_metadata > 0
      ? [{ label: t('activity.metrics.toolCallMetadata'), size: breakdown.tool_call_metadata }]
      : []),
    { label: t('activity.metrics.protocolOverhead'), size: breakdown.protocol_overhead },
  ];

  return (
    <Stack spacing={0.35} sx={{ pt: 0.25 }}>
      <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
        {t('activity.metrics.breakdown')}
      </Typography>
      <Stack spacing={0.25}>
        {rows.map((row) => (
          <Stack key={row.label} direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', flex: 1, minWidth: 0 }}>
              {row.label}
            </Typography>
            <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary', flexShrink: 0 }}>
              {formatBudgetSize(row.size)}
            </Typography>
          </Stack>
        ))}
      </Stack>
      {systemSections.length > 0 && (
        <Stack spacing={0.25} sx={{ pt: 0.25 }}>
          <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
            {t('activity.metrics.systemPromptSections')}
          </Typography>
          {systemSections.map((section) => (
            <Stack key={section.key} direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 12,
                  color: 'kanap.text.secondary',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {section.label}
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>
                {formatBudgetSize(section.size)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
      {largestToolSchemas.length > 0 && (
        <Stack spacing={0.25} sx={{ pt: 0.25 }}>
          <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
            {t('activity.metrics.toolSchemaDetail')}
          </Typography>
          {largestToolSchemas.map((tool) => (
            <Stack key={tool.name} direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
              <Typography
                sx={{
                  fontSize: 12,
                  color: 'kanap.text.secondary',
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {t(`toolResults.toolNames.${tool.name}`, { defaultValue: tool.name.replace(/_/g, ' ') })}
              </Typography>
              <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>
                {formatBudgetSize(tool.size)}
              </Typography>
            </Stack>
          ))}
        </Stack>
      )}
    </Stack>
  );
}

function ContextMetrics({
  context,
  showDebugDetails,
}: {
  context?: ChatContextSummary;
  showDebugDetails: boolean;
}) {
  const { t } = useTranslation(['ai']);
  const rows: Array<{ label: string; value: string }> = [];
  if (showDebugDetails && context?.history) {
    rows.push({
      label: t('activity.metrics.history'),
      value: t('activity.metrics.historyValue', {
        messages: context.history.message_count,
        attachments: context.history.attachment_count,
      }),
    });
  }
  if (showDebugDetails && context?.tools) {
    const selected = context.tools.selected_count;
    rows.push({
      label: t('activity.metrics.tools'),
      value: selected == null
        ? t('activity.metrics.toolsValue', {
          tools: context.tools.available_count,
          writable: context.tools.writable_count,
          types: context.tools.readable_entity_types.length,
        })
        : t('activity.metrics.toolsSelectedValue', {
          selected,
          tools: context.tools.available_count,
          writable: context.tools.writable_count,
          types: context.tools.readable_entity_types.length,
          profile: context.tools.context_profile || t('activity.metrics.noProfile'),
        }),
    });
  }
  if (context?.timings) {
    const timingParts = [
      context.timings.total_ms != null
        ? t('activity.metrics.timingTotal', { duration: formatDurationMs(context.timings.total_ms) })
        : null,
      context.timings.first_token_ms != null
        ? t('activity.metrics.timingFirstToken', { duration: formatDurationMs(context.timings.first_token_ms) })
        : null,
      context.timings.tool_execution_ms && context.timings.tool_execution_ms > 0
        ? t('activity.metrics.timingTools', { duration: formatDurationMs(context.timings.tool_execution_ms) })
        : null,
    ].filter(Boolean);
    if (timingParts.length > 0) {
      rows.push({
        label: t('activity.metrics.timing'),
        value: timingParts.join(', '),
      });
    }
  }
  if (context?.budget) {
    rows.push({
      label: t('activity.metrics.budget'),
      value: t('activity.metrics.budgetValue', {
        size: context.budget.estimated_request_size,
        budget: context.budget.budget ?? t('activity.metrics.noBudget'),
      }),
    });
  }
  if (!rows.length) return null;
  return (
    <Stack spacing={0.35}>
      <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
        {t('activity.sections.runtime')}
      </Typography>
      {rows.map((row) => (
        <Stack key={row.label} direction="row" spacing={1} alignItems="baseline" sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary', flexShrink: 0 }}>
            {row.label}
          </Typography>
          <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {row.value}
          </Typography>
        </Stack>
      ))}
      {showDebugDetails && <BudgetBreakdown budget={context?.budget} />}
    </Stack>
  );
}

export default function PlaidActivity({ message, previousUserMessage, previews }: PlaidActivityProps) {
  const { t } = useTranslation(['ai']);
  const [expanded, setExpanded] = useState(false);
  const currentActivity = getCurrentActivity(message.activity, message.isStreaming);

  const context = useMemo((): ChatContextSummary => ({
    ...message.context,
    mentions: mergeItems(message.context?.mentions, previousUserMessage ? extractMentions(previousUserMessage.content) : undefined),
    attachments: mergeItems(message.context?.attachments, attachmentItems(previousUserMessage)),
    injected: mergeItems(message.context?.injected, injectedItemsFromToolResults(message)),
    previews: mergeItems(message.context?.previews, previewItems(previews).filter((item) => item.kind === 'preview')),
    artifacts: mergeItems(message.context?.artifacts, previewItems(previews).filter((item) => item.kind === 'artifact')),
  }), [message, previousUserMessage, previews]);

  const contextCount = [
    context.mentions,
    context.attachments,
    context.injected,
    context.previews,
    context.artifacts,
  ].reduce((count, items) => count + (items?.length || 0), 0);
  const steps = activityCount(message);
  const toolCount = calledToolCount(message);
  const hasVisibleRuntime = !!(context.timings || context.budget);
  const hasDebugRuntime = SHOW_PLAID_DEBUG_DETAILS && !!(context.history || context.tools);
  const hasDebugContext = SHOW_PLAID_DEBUG_DETAILS && contextCount > 0;
  const hasDebugTrace = SHOW_PLAID_DEBUG_DETAILS && !!message.debugTrace?.length;
  const hasDetails = steps > 0 || hasVisibleRuntime || hasDebugRuntime || hasDebugContext || hasDebugTrace;

  const phase = currentActivity?.phase || (message.isStreaming ? 'analyzing' : 'finalizing');
  const summary = t('activity.summaryWithTools', { count: toolCount });

  return (
    <Box
      sx={(theme) => ({
        border: `1px solid ${theme.palette.kanap.border.soft}`,
        borderRadius: '8px',
        overflow: 'hidden',
        bgcolor: 'transparent',
      })}
    >
      <Box
        component="button"
        type="button"
        onClick={() => hasDetails && setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        sx={(theme) => ({
          width: '100%',
          minHeight: 30,
          px: 1,
          py: 0.625,
          border: 0,
          bgcolor: 'transparent',
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          cursor: hasDetails ? 'pointer' : 'default',
          fontFamily: theme.typography.fontFamily,
          textAlign: 'left',
          color: theme.palette.kanap.text.secondary,
          '&:hover': hasDetails ? { bgcolor: theme.palette.kanap.bg.hover } : undefined,
          '&:focus-visible': {
            outline: 'none',
            boxShadow: `inset 0 0 0 2px ${theme.palette.primary.main}`,
          },
        })}
      >
        {message.isStreaming ? (
          <CircularProgress size={10} thickness={5} sx={{ color: 'kanap.text.tertiary', flexShrink: 0 }} />
        ) : (
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              bgcolor: currentActivity?.status === 'failed' ? 'error.main' : 'kanap.text.tertiary',
              flexShrink: 0,
            }}
          />
        )}
        <Typography
          component="span"
          sx={{
            fontSize: 12,
            color: 'kanap.text.secondary',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            minWidth: 0,
          }}
        >
          {t(`activity.phases.${phase}`)}
        </Typography>
        <Typography
          component="span"
          sx={{
            ml: 'auto',
            fontSize: 11,
            color: 'kanap.text.tertiary',
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}
        >
          {summary}
        </Typography>
        {hasDetails && (
          <KeyboardArrowRightIcon
            sx={{
              fontSize: 16,
              color: 'kanap.text.tertiary',
              transform: expanded ? 'rotate(90deg)' : 'none',
              transition: 'transform 120ms ease',
              flexShrink: 0,
            }}
          />
        )}
      </Box>

      {hasDetails && (
        <Collapse in={expanded} unmountOnExit>
          <Stack
            spacing={1}
            sx={(theme) => ({
              px: 1.25,
              pb: 1,
              pt: 0.25,
              borderTop: `1px solid ${theme.palette.kanap.border.soft}`,
            })}
          >
            <ActivitySteps message={message} />
            {SHOW_PLAID_DEBUG_DETAILS && <DebugTraceSection entries={message.debugTrace} />}
            {SHOW_PLAID_DEBUG_DETAILS && (
              <>
                <ContextSection title={t('activity.sections.mentions')} items={context.mentions || []} />
                <ContextSection title={t('activity.sections.attachments')} items={context.attachments || []} />
                <ContextSection title={t('activity.sections.injected')} items={context.injected || []} />
                <ContextSection title={t('activity.sections.previews')} items={mergeItems(context.previews, context.artifacts)} />
              </>
            )}
            <ContextMetrics context={context} showDebugDetails={SHOW_PLAID_DEBUG_DETAILS} />
          </Stack>
        </Collapse>
      )}
    </Box>
  );
}
