import React from 'react';
import { Alert, Box, Button, Chip, CircularProgress, Stack, TextField, Typography } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import {
  aiAgentControlApi,
  AI_AGENT_CONTROL_ACTIVITY_TYPES,
  type AiAgentControlActivityCheck,
  type AiAgentControlActivityDetail,
  type AiAgentControlActivityType,
} from '../../ai/aiApi';
import { EmptyState, formatDateTime, humanize, Section, StatusText, TargetLabel } from '../../components/agents/agentControlPrimitives';
import RunTraceDialog from '../../components/agents/RunTraceDialog';
import { useLocale } from '../../i18n/useLocale';

const ACTIVITY_PAGE_SIZE = 50;

// The type chips are a multi-select, all active by default except "Checks":
// a watcher writes one check row every few minutes and they drown the entries
// an operator actually reads. Turning the chip on brings them back.
const DEFAULT_ACTIVITY_TYPES: AiAgentControlActivityType[] = AI_AGENT_CONTROL_ACTIVITY_TYPES.filter(
  (type) => type !== 'check',
);

function parseSelectedTypes(
  typesParam: string | null,
  legacyTypeParam: string | null,
): AiAgentControlActivityType[] {
  const allowed = new Set<string>(AI_AGENT_CONTROL_ACTIVITY_TYPES);
  // `?type=` is the pre-multi-select deep link (one type). Honour it as a
  // single-chip selection so old links keep meaning what they meant.
  const raw = typesParam ?? (legacyTypeParam != null ? legacyTypeParam : null);
  if (raw == null) return DEFAULT_ACTIVITY_TYPES;
  const selected = new Set(raw.split(',').map((entry) => entry.trim()).filter((entry) => allowed.has(entry)));
  // Canonical chip order, not the order they appear in the URL.
  return AI_AGENT_CONTROL_ACTIVITY_TYPES.filter((type) => selected.has(type));
}

function hasInlineDetail(detail: AiAgentControlActivityDetail | null | undefined): detail is AiAgentControlActivityDetail {
  return !!detail && !!(
    detail.body
    || detail.reason
    || detail.rationale
    || detail.evidenceCount
    || detail.check
    || (detail.changes && detail.changes.length > 0)
  );
}

// One-line at-a-glance summary so the timeline shows what happened without expanding.
// Checks carry their summary in the row title already, so they get no preview line.
function DetailPreview({ detail }: { detail: AiAgentControlActivityDetail }) {
  const { t } = useTranslation(['agents']);
  let text: string | null = null;
  if (detail.check) {
    return null;
  }
  if (detail.changes && detail.changes.length > 0) {
    const change = detail.changes[0];
    const field = t(`activity.fields.${change.field}`, { defaultValue: humanize(change.field) });
    text = `${field}: ${change.from ? `${humanize(change.from)} → ` : ''}${humanize(change.to ?? '')}`;
    if (detail.changes.length > 1) text += ` (+${detail.changes.length - 1})`;
  } else if (detail.body) {
    text = detail.body.split('\n')[0];
  } else if (detail.rationale) {
    text = detail.rationale;
  } else if (detail.reason) {
    text = detail.reason;
  }
  if (!text) return null;
  return (
    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.25, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {text}
    </Typography>
  );
}

// What the watcher found on one pass, in the row title: "Ticket check: 3 new
// tickets, 1 error". The counts were already recorded, they were simply never
// shown.
function useCheckSummary() {
  const { t } = useTranslation(['agents']);
  return React.useCallback((check: AiAgentControlActivityCheck, isSre: boolean): string | null => {
    if (check.status && check.status !== 'completed') {
      const label = t(`activity.checkStatus.${check.status}`, { defaultValue: humanize(check.status) });
      return check.reason ? t('activity.statusWithReason', { status: label, reason: check.reason }) : label;
    }
    const parts: string[] = [];
    parts.push(check.enqueued > 0
      ? t(isSre ? 'activity.checkSummary.newAlerts' : 'activity.checkSummary.newTickets', { count: check.enqueued })
      : t(isSre ? 'activity.checkSummary.noAlerts' : 'activity.checkSummary.noTickets'));
    if (check.deduped > 0) parts.push(t('activity.checkSummary.duplicates', { count: check.deduped }));
    if (check.errorCount > 0) parts.push(t('activity.checkSummary.errors', { count: check.errorCount }));
    return parts.join(', ');
  }, [t]);
}

function CheckDetail({ check }: { check: AiAgentControlActivityCheck }) {
  const { t } = useTranslation(['agents']);
  return (
    <Stack spacing={0.5}>
      <Typography variant="body2">
        {t('activity.checkNarrative', {
          listed: check.listed,
          enqueued: check.enqueued,
          deduped: check.deduped,
        })}
      </Typography>
      {check.reason && (
        <Typography variant="body2">
          <Box component="span" sx={{ color: 'text.secondary' }}>{t('activity.reason')}: </Box>
          {check.reason}
        </Typography>
      )}
      {check.errors.map((error, index) => (
        <Typography key={`${error}-${index}`} variant="caption" color="error">{error}</Typography>
      ))}
    </Stack>
  );
}

// Full plain-language detail of a single timeline entry (proposed message, field
// changes, the reason and the reviewer's note, sources cited).
function ActivityDetail({ detail }: { detail: AiAgentControlActivityDetail }) {
  const { t } = useTranslation(['agents']);
  return (
    <Stack spacing={1} sx={{ mt: 1, p: 1.25, borderRadius: 1, bgcolor: 'kanap.bg.composer', border: '1px solid', borderColor: 'divider' }}>
      {detail.check && <CheckDetail check={detail.check} />}
      {detail.changes && detail.changes.length > 0 && (
        <Stack spacing={0.25}>
          {detail.changes.map((change, index) => {
            const field = t(`activity.fields.${change.field}`, { defaultValue: humanize(change.field) });
            return (
              <Typography key={`${change.field}-${index}`} variant="body2">
                <Box component="span" sx={{ color: 'text.secondary' }}>{field}: </Box>
                {change.from ? `${humanize(change.from)} → ` : ''}{humanize(change.to ?? '')}
              </Typography>
            );
          })}
        </Stack>
      )}
      {detail.body && (
        <Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.25 }}>{t('activity.proposedMessage')}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{detail.body}</Typography>
        </Box>
      )}
      {detail.reason && (
        <Typography variant="body2">
          <Box component="span" sx={{ color: 'text.secondary' }}>{t('activity.reason')}: </Box>
          {detail.reason}
        </Typography>
      )}
      {detail.rationale && (
        <Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.25 }}>{t('activity.reviewerNote')}</Typography>
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{detail.rationale}</Typography>
        </Box>
      )}
      {!!detail.evidenceCount && (
        <Typography variant="caption" color="text.secondary">{t('activity.evidenceCount', { n: detail.evidenceCount })}</Typography>
      )}
    </Stack>
  );
}

const COMPACT_ACTIVITY_LIMIT = 10;

export default function AgentsActivityPage({ agentKey, compact = false }: { agentKey?: string; compact?: boolean }) {
  const { t } = useTranslation(['agents']);
  const locale = useLocale();
  const [searchParams, setSearchParams] = useSearchParams();
  const [targetRef, setTargetRef] = React.useState(searchParams.get('targetRef') ?? '');
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());
  // The trace opens in place. Seeded from ?runId= so old deep links still work,
  // then owned by local state so closing it never navigates the page away.
  const [traceRunId, setTraceRunId] = React.useState<string | null>(() => searchParams.get('runId'));
  const selectedTypes = React.useMemo(
    () => parseSelectedTypes(searchParams.get('types'), searchParams.get('type')),
    [searchParams],
  );
  const checkSummary = useCheckSummary();

  const toggleType = React.useCallback((type: AiAgentControlActivityType) => {
    const next = selectedTypes.includes(type)
      ? selectedTypes.filter((entry) => entry !== type)
      : AI_AGENT_CONTROL_ACTIVITY_TYPES.filter((entry) => entry === type || selectedTypes.includes(entry));
    const params = new URLSearchParams(searchParams);
    params.delete('type');
    params.set('types', next.join(','));
    setSearchParams(params);
  }, [searchParams, selectedTypes, setSearchParams]);

  const closeTrace = React.useCallback(() => {
    setTraceRunId(null);
    setSearchParams((current) => {
      if (!current.get('runId')) return current;
      const next = new URLSearchParams(current);
      next.delete('runId');
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const queueQuery = useQuery({
    queryKey: ['ai-agent-control-queue'],
    queryFn: () => aiAgentControlApi.getQueueOverview({ limit: 100 }),
    staleTime: 30_000,
  });
  const agentDefinition = React.useMemo(() => (
    agentKey ? queueQuery.data?.definitions.find((definition) => definition.agent_key === agentKey) ?? null : null
  ), [agentKey, queueQuery.data]);
  const agentNameByKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const definition of queueQuery.data?.definitions ?? []) map.set(definition.agent_key, definition.name);
    return map;
  }, [queueQuery.data]);
  // SRE entries use alert-flavored titles where one exists (`<key>_sre`),
  // falling back to the shared ticket-flavored title. Resolved at render time
  // so historical entries are relabeled too.
  const agentTypeByKey = React.useMemo(() => {
    const map = new Map<string, string>();
    for (const definition of queueQuery.data?.definitions ?? []) map.set(definition.agent_key, definition.agent_type ?? 'helpdesk');
    return map;
  }, [queueQuery.data]);
  const activityTitle = React.useCallback((entry: {
    agentKey?: string | null;
    titleKey: string;
    detail?: AiAgentControlActivityDetail | null;
  }) => {
    const isSre = !!entry.agentKey && agentTypeByKey.get(entry.agentKey) === 'sre';
    const fallback = t(`activity.titles.${entry.titleKey}`, { defaultValue: humanize(entry.titleKey) });
    const base = isSre ? t(`activity.titles.${entry.titleKey}_sre`, { defaultValue: fallback }) : fallback;
    const summary = entry.detail?.check ? checkSummary(entry.detail.check, isSre) : null;
    return summary ? t('activity.titleWithSummary', { title: base, summary }) : base;
  }, [agentTypeByKey, checkSummary, t]);

  // Keyset pagination: the query key stays stable (no offset/cursor in the URL),
  // react-query keeps the loaded pages, and "load more" walks the cursor.
  const activityQuery = useInfiniteQuery({
    queryKey: ['ai-agent-control-activity', agentDefinition?.id ?? null, searchParams.toString()],
    queryFn: ({ pageParam }) => aiAgentControlApi.listActivity({
      agentDefinitionId: agentDefinition?.id ?? null,
      targetRef: searchParams.get('targetRef'),
      // The selection is always sent explicitly — the server's "no param means
      // every type" default would otherwise silently re-add the Checks rows.
      types: selectedTypes,
      limit: ACTIVITY_PAGE_SIZE,
      cursor: pageParam ?? null,
    }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: (!agentKey || !!agentDefinition) && selectedTypes.length > 0,
    refetchInterval: 60_000,
  });
  const items = React.useMemo(
    () => {
      const all = (activityQuery.data?.pages ?? []).flatMap((page) => page.items);
      return compact ? all.slice(0, COMPACT_ACTIVITY_LIMIT) : all;
    },
    [activityQuery.data, compact],
  );
  const total = activityQuery.data?.pages?.[0]?.total ?? null;

  const applySearch = () => {
    const next = new URLSearchParams(searchParams);
    if (targetRef.trim()) next.set('targetRef', targetRef.trim());
    else next.delete('targetRef');
    setSearchParams(next);
  };

  return (
    <Box sx={{ p: agentKey ? 0 : 2 }}>
      {!agentKey && (
        <>
          <PageHeader title={t('activity.title')} />
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('activity.subtitle')}</Typography>
        </>
      )}
      <Stack spacing={2}>
        {!compact && (
        <Section title={t('activity.filters')}>
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 1.5 }} alignItems={{ xs: 'stretch', sm: 'center' }} flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              value={targetRef}
              onChange={(event) => setTargetRef(event.target.value)}
              placeholder={t('activity.ticketSearch')}
              onKeyDown={(event) => { if (event.key === 'Enter') applySearch(); }}
            />
            <Button size="small" variant="outlined" startIcon={<SearchIcon />} onClick={applySearch}>{t('activity.search')}</Button>
            {AI_AGENT_CONTROL_ACTIVITY_TYPES.map((type) => {
              const active = selectedTypes.includes(type);
              return (
                <Chip
                  key={type}
                  clickable
                  size="small"
                  color={active ? 'primary' : 'default'}
                  variant={active ? 'filled' : 'outlined'}
                  aria-pressed={active}
                  label={t(`activity.types.${type}`)}
                  onClick={() => toggleType(type)}
                />
              );
            })}
          </Stack>
        </Section>
        )}

        <Section title={t('activity.timeline')}>
          {selectedTypes.length === 0 ? (
            <EmptyState>{t('activity.noTypesSelected')}</EmptyState>
          ) : activityQuery.isLoading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
          ) : activityQuery.isError ? (
            <Alert severity="error">{t('activity.loadFailed')}</Alert>
          ) : items.length === 0 ? (
            <EmptyState>{t('activity.empty')}</EmptyState>
          ) : (
            <>
              <Stack divider={<Box sx={{ borderTop: '1px solid', borderColor: 'divider' }} />}>
                {items.map((entry) => {
                  const detailAvailable = hasInlineDetail(entry.detail);
                  const isExpanded = expanded.has(entry.id);
                  return (
                    <Box key={entry.id} sx={{ p: 1.5 }}>
                      <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" spacing={1}>
                        <Box sx={{ minWidth: 0 }}>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap alignItems="center">
                            <Chip size="small" label={t(`activity.types.${entry.type}`)} />
                            {entry.actionClass && <Chip size="small" variant="outlined" label={t(`settings.actionClasses.${entry.actionClass}`, { defaultValue: humanize(entry.actionClass) })} />}
                            {entry.status && <StatusText status={entry.status} />}
                            {entry.agentKey && <Chip size="small" variant="outlined" label={agentNameByKey.get(entry.agentKey) ?? entry.agentKey} />}
                            {entry.targetRef && <TargetLabel targetType={entry.targetType} targetRef={entry.targetRef} size="dense" />}
                          </Stack>
                          <Typography variant="body2" sx={{ mt: 0.75 }}>
                            {activityTitle(entry)}
                          </Typography>
                          {detailAvailable && !isExpanded && <DetailPreview detail={entry.detail!} />}
                          {entry.errorMessage && <Typography variant="caption" color="error" component="div">{entry.errorMessage}</Typography>}
                          {detailAvailable && isExpanded && <ActivityDetail detail={entry.detail!} />}
                        </Box>
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
                          <Typography variant="caption" color="text.secondary">{formatDateTime(entry.at, locale)}</Typography>
                          {detailAvailable && (
                            <Button size="small" variant="text" onClick={() => toggleExpanded(entry.id)}>
                              {isExpanded ? t('activity.detailsHide') : t('activity.detailsShow')}
                            </Button>
                          )}
                          {entry.runId && (
                            <Button size="small" variant="text" onClick={() => setTraceRunId(entry.runId as string)}>
                              {t('activity.trace')}
                            </Button>
                          )}
                        </Stack>
                      </Stack>
                    </Box>
                  );
                })}
              </Stack>
              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}
              >
                <Typography variant="caption" color="text.secondary" sx={{ flex: 1, minWidth: 0 }}>
                  {total != null
                    ? t('activity.shownOfTotal', { shown: items.length, total })
                    : t('activity.shown', { shown: items.length })}
                </Typography>
                {!compact && activityQuery.hasNextPage && (
                  <Button
                    size="small"
                    variant="action"
                    disabled={activityQuery.isFetchingNextPage}
                    startIcon={activityQuery.isFetchingNextPage ? <CircularProgress size={14} /> : undefined}
                    onClick={() => { void activityQuery.fetchNextPage(); }}
                  >
                    {t('activity.loadMore')}
                  </Button>
                )}
              </Stack>
            </>
          )}
        </Section>

        <RunTraceDialog runId={traceRunId} onClose={closeTrace} />
      </Stack>
    </Box>
  );
}
