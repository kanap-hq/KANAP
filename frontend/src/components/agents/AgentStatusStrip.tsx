import React from 'react';
import { Stack, Typography } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { formatNumber, LifecycleText, statusLabel } from './agentControlPrimitives';
import { useAgentRunState } from './agentRunState';
import { formatEuro } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';

/**
 * Inline label·value fact (charter workspace metric strip: one lightweight line
 * of facts, not a grid of metric cards).
 */
export function StatusStripItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary, whiteSpace: 'nowrap' })}>
      {label}
      {' '}
      <Typography component="span" sx={(theme) => ({ fontSize: 12, fontWeight: 500, color: theme.palette.kanap.text.primary })}>
        {value}
      </Typography>
    </Typography>
  );
}

/**
 * The agent's read-only facts: what it watches, when it last looked and when it
 * looks next, what is queued, and today's usage against the daily caps.
 *
 * These used to sit in the transverse control bar next to the buttons, which
 * made the bar two things at once. The bar is now actions only and the facts
 * live at the top of the Monitor tab.
 */
export default function AgentStatusStrip({ agentKey }: { agentKey: string }) {
  const { t } = useTranslation(['agents']);
  const locale = useLocale();
  const state = useAgentRunState(agentKey);
  const lastPollAt = state.isSre ? state.sreLastPollAt : (state.summary?.ingestion.lastPollAt ?? '');
  const lastPollStatus = state.isSre ? state.sreLastPollStatus : (state.summary?.ingestion.lastPollStatus ?? '');
  const lastLookTime = lastPollAt
    ? new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(lastPollAt))
    : '';
  const lastLook = [lastLookTime, lastPollStatus ? statusLabel(lastPollStatus) : '']
    .filter(Boolean)
    .join(' ') || t('common.notSet');
  const nextLook = state.watching ? t('monitor.everyMinutes', { count: state.checkIntervalMinutes }) : t('common.notSet');
  const scope = state.watching
    ? (state.scopeFiltered
      ? t('monitor.filtered')
      : (state.isSre ? t('monitor.allAlerts') : t('monitor.allTickets')))
    : t('monitor.off');

  return (
    <Stack spacing={0.75} sx={{ px: 1.5, py: 1.25, minWidth: 0 }}>
      <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" alignItems="center">
        {state.lifecycleKey && <LifecycleText lifecycleKey={state.lifecycleKey} />}
        <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.secondary })}>
          {scope}
          {' · '}
          {t('monitor.lastCheck')} {lastLook}
          {' · '}
          {t('monitor.nextCheck')} {nextLook}
          {' · '}
          {t('monitor.queueSummary', { waiting: state.waitingCount, inProgress: state.inProgressCount })}
        </Typography>
        {state.failedCount > 0 && (
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'error.main', whiteSpace: 'nowrap' }}>
            {t('overview.failedCount', { count: state.failedCount })}
          </Typography>
        )}
      </Stack>
      {!state.isSre && state.daily && (
        <Stack direction="row" spacing={2.5} useFlexGap flexWrap="wrap" alignItems="center">
          <StatusStripItem label={t('monitor.runsToday')} value={`${state.daily.runs ?? 0} / ${state.daily.cap.maxRuns ?? '-'}`} />
          <StatusStripItem
            label={t('monitor.tokensToday')}
            value={`${formatNumber(state.daily.estimatedTokens ?? 0)} / ${formatNumber(state.daily.cap.maxTokens)}`}
          />
          <StatusStripItem
            label={t('monitor.costToday')}
            value={`${formatEuro(state.daily.estimatedCostEur ?? 0, locale, 4)} / ${state.daily.cap.maxCostEur == null ? '-' : formatEuro(state.daily.cap.maxCostEur, locale)}`}
          />
        </Stack>
      )}
    </Stack>
  );
}
