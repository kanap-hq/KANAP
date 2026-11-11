import React from 'react';
import { Alert, Box, Button, CircularProgress, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../design/KanapDialog';
import { aiAgentControlApi, type AiAgentControlRunDetail } from '../../ai/aiApi';
import { capabilityLabelFromName, formatDateTime, humanize, StatusText } from './agentControlPrimitives';
import { useLocale } from '../../i18n/useLocale';

function JsonPreview({ value, emptyLabel }: { value: unknown; emptyLabel: string }) {
  if (!value) return <Typography variant="body2" color="text.secondary">{emptyLabel}</Typography>;
  return (
    <Box component="pre" sx={{ m: 0, maxHeight: 260, overflow: 'auto', p: 1, borderRadius: 1, bgcolor: 'kanap.bg.composer', border: '1px solid', borderColor: 'divider', fontFamily: 'monospace', fontSize: '0.75rem', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {JSON.stringify(value, null, 2)}
    </Box>
  );
}

/** Elapsed time between two timestamps, or null when either is missing. */
function durationMs(startedAt: string | null, completedAt: string | null): number | null {
  if (!startedAt || !completedAt) return null;
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return end - start;
}

/** Compact, readable durations: 840 ms, 3.2 s, 1 min 12 s. */
function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)} s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds - minutes * 60);
  return rest > 0 ? `${minutes} min ${rest} s` : `${minutes} min`;
}

/**
 * Readable technical trace (when it ran → steps → tool calls → evidence), with
 * the raw JSON kept one layer down per the IA spec — never the default view.
 */
export function RunAuditDetail({ detail }: { detail: AiAgentControlRunDetail }) {
  const { t } = useTranslation(['agents']);
  const locale = useLocale();
  const [rawOpen, setRawOpen] = React.useState(false);
  const steps = detail.run_steps ?? [];
  const tools = detail.tool_executions ?? [];
  const evidence = detail.evidence ?? [];
  const runDuration = formatDuration(durationMs(detail.run.started_at, detail.run.completed_at));
  return (
    <Stack spacing={1.5}>
      <Stack spacing={0.25}>
        <Typography variant="body2">{t('activity.runStatus', { status: detail.run.status })}</Typography>
        <Typography variant="caption" color="text.secondary">
          {t('activity.runStarted', { value: formatDateTime(detail.run.started_at ?? detail.run.created_at, locale) })}
          {detail.run.completed_at
            ? ` · ${t('activity.runCompleted', { value: formatDateTime(detail.run.completed_at, locale) })}`
            : ''}
          {runDuration ? ` · ${t('activity.runDuration', { value: runDuration })}` : ''}
        </Typography>
      </Stack>
      {steps.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{t('activity.steps')}</Typography>
          <Stack spacing={0.5}>
            {steps.map((step) => {
              const stepDuration = formatDuration(durationMs(step.started_at, step.completed_at));
              return (
                <Stack key={step.id} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="caption">
                    {step.step_index}. {capabilityLabelFromName(step.capability_name ?? step.kind)}
                    {stepDuration ? ` · ${stepDuration}` : ''}
                  </Typography>
                  <StatusText status={step.status} />
                </Stack>
              );
            })}
          </Stack>
        </Box>
      )}
      {tools.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{t('activity.tools')}</Typography>
          <Stack spacing={0.5}>
            {tools.map((tool) => {
              const toolDuration = formatDuration(tool.duration_ms ?? durationMs(tool.started_at, tool.completed_at));
              return (
                <Stack key={tool.id} direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                  <Typography variant="caption">{capabilityLabelFromName(tool.capability_name)}{toolDuration ? ` · ${toolDuration}` : ''}</Typography>
                  <StatusText status={tool.status} />
                </Stack>
              );
            })}
          </Stack>
        </Box>
      )}
      {evidence.length > 0 && (
        <Box>
          <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>{t('activity.evidence')}</Typography>
          <Stack spacing={0.5}>
            {evidence.map((item) => (
              <Typography key={item.id} variant="caption" color="text.secondary">
                {item.summary ? `${item.summary} · ${humanize(item.source_object_type)}` : humanize(item.source_object_type)}
              </Typography>
            ))}
          </Stack>
        </Box>
      )}
      <Box>
        <Button size="small" variant="text" onClick={() => setRawOpen((open) => !open)}>
          {rawOpen ? t('activity.hideRaw') : t('activity.showRaw')}
        </Button>
        {rawOpen && <JsonPreview value={detail} emptyLabel={t('common.notSet')} />}
      </Box>
    </Stack>
  );
}

/**
 * The run trace, opened in place. Driven by local state on purpose: the pages
 * that show it (approvals, activity, the agent workspace) all live under their
 * own search params, and closing the dialog must land the operator exactly
 * where they were — not on a reloaded page.
 */
export default function RunTraceDialog({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { t } = useTranslation(['agents']);
  const runQuery = useQuery({
    queryKey: ['ai-agent-control-run', runId],
    queryFn: () => aiAgentControlApi.getRun(runId as string),
    enabled: !!runId,
  });
  return (
    <KanapDialog
      open={!!runId}
      title={t('activity.technicalTrace')}
      onClose={onClose}
      onSave={onClose}
      saveLabel={t('activity.closeTrace')}
      showCancel={false}
    >
      {runQuery.isLoading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
      ) : runQuery.isError || !runQuery.data ? (
        <Alert severity="error">{t('activity.traceFailed')}</Alert>
      ) : (
        <RunAuditDetail detail={runQuery.data} />
      )}
    </KanapDialog>
  );
}
