import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import PageHeader from '../../components/PageHeader';
import { useLocale } from '../../i18n/useLocale';
import { aiAdminApi } from '../../ai/aiApi';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

function formatNumber(value: number | null | undefined, locale: string): string {
  if (value == null) return '0';
  return value.toLocaleString(locale);
}

function formatCostEur(value: number | null | undefined, locale: string): string {
  const amount = value ?? 0;
  return `${amount.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: amount > 0 && amount < 0.01 ? 4 : 2 })} €`;
}

function MetricCard(props: { label: string; value: string; caption?: string }) {
  return (
    <Card variant="outlined">
      <CardContent>
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            {props.label}
          </Typography>
          <Typography variant="h5">{props.value}</Typography>
          {props.caption ? (
            <Typography variant="caption" color="text.secondary">
              {props.caption}
            </Typography>
          ) : null}
        </Stack>
      </CardContent>
    </Card>
  );
}

// A note only when the chat cost is not exact: partly estimated, or 0 because the model is free.
function chatCostCaption(
  costs: { current_month: { chat_eur: number }; chat_priced: boolean; chat_estimated: boolean },
  t: (key: string) => string,
): string | undefined {
  if (costs.chat_estimated) return t('aiUsage.costs.chatEstimatedNote');
  if (costs.current_month.chat_eur === 0 && !costs.chat_priced) return t('aiUsage.costs.chatFreeNote');
  return undefined;
}

// Cross-cutting usage view: today the admin token totals and per-agent message
// counts; real per-model cost reporting lands with the cost engine (registry PR 2).
export default function AdminAiUsagePage() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();

  const overviewQuery = useQuery({
    queryKey: ['ai-admin-overview'],
    queryFn: () => aiAdminApi.getOverview(),
  });

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader title={t('aiUsage.title')} />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('aiUsage.subtitle')}</Typography>
      {overviewQuery.isLoading ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress size={28} />
        </Box>
      ) : overviewQuery.isError ? (
        <Alert severity="error">
          {getApiErrorMessage(overviewQuery.error, t, t('aiAdmin.messages.loadOverviewFailed'))}
        </Alert>
      ) : overviewQuery.data ? (
        <Stack spacing={2.5}>
          <Stack spacing={1}>
            <Typography variant="subtitle1">{t('aiUsage.costs.title')}</Typography>
            <Box
              sx={{
                display: 'grid',
                gap: 2,
                gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(4, minmax(0, 1fr))' },
              }}
            >
              <MetricCard
                label={t('aiUsage.costs.totalMonth')}
                value={formatCostEur(overviewQuery.data.costs.current_month.total_eur, locale)}
                caption={`${t('aiAdmin.overview.windows.last30Days')}: ${formatCostEur(overviewQuery.data.costs.last_30_days.total_eur, locale)}`}
              />
              <MetricCard
                label={t('aiUsage.costs.agentsMonth')}
                value={formatCostEur(overviewQuery.data.costs.current_month.agents_eur, locale)}
                caption={`${t('aiAdmin.overview.windows.last30Days')}: ${formatCostEur(overviewQuery.data.costs.last_30_days.agents_eur, locale)}`}
              />
              <MetricCard
                label={t('aiUsage.costs.chatMonth')}
                value={formatCostEur(overviewQuery.data.costs.current_month.chat_eur, locale)}
                caption={chatCostCaption(overviewQuery.data.costs, t)}
              />
            </Box>
            {(overviewQuery.data.costs.by_agent.length > 0 || overviewQuery.data.costs.by_model.length > 0) && (
              <Box sx={{ display: 'grid', gap: 2.5, gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' } }}>
                {overviewQuery.data.costs.by_agent.length > 0 && (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('aiUsage.costs.byAgent')}</TableCell>
                        <TableCell align="right">{t('aiAdmin.overview.windows.currentMonth')}</TableCell>
                        <TableCell align="right">{t('aiAdmin.overview.windows.last30Days')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {overviewQuery.data.costs.by_agent.map((row) => (
                        <TableRow key={row.agent_definition_id}>
                          <TableCell>{row.name}</TableCell>
                          <TableCell align="right">{formatCostEur(row.cost_current_month_eur, locale)}</TableCell>
                          <TableCell align="right">{formatCostEur(row.cost_last_30_days_eur, locale)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
                {overviewQuery.data.costs.by_model.length > 0 && (
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t('aiUsage.costs.byModel')}</TableCell>
                        <TableCell align="right">{t('aiAdmin.overview.windows.currentMonth')}</TableCell>
                        <TableCell align="right">{t('aiAdmin.overview.windows.last30Days')}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {overviewQuery.data.costs.by_model.map((row) => (
                        <TableRow key={row.model ?? 'unknown'}>
                          <TableCell sx={{ fontFamily: 'monospace', fontSize: 12 }}>
                            {row.model ?? t('aiUsage.costs.unknownModel')}
                          </TableCell>
                          <TableCell align="right">{formatCostEur(row.cost_current_month_eur, locale)}</TableCell>
                          <TableCell align="right">{formatCostEur(row.cost_last_30_days_eur, locale)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </Box>
            )}
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(2, minmax(0, 1fr))',
                lg: 'repeat(4, minmax(0, 1fr))',
              },
            }}
          >
            <MetricCard
              label={t('aiAdmin.overview.metrics.allConversations')}
              value={formatNumber(overviewQuery.data.totals.conversations_all, locale)}
            />
            <MetricCard
              label={t('aiAdmin.overview.metrics.activeConversations7d')}
              value={formatNumber(overviewQuery.data.totals.conversations_7d, locale)}
            />
            <MetricCard
              label={t('aiAdmin.overview.metrics.activeConversations30d')}
              value={formatNumber(overviewQuery.data.totals.conversations_30d, locale)}
            />
            <MetricCard
              label={t('aiAdmin.overview.metrics.activeUsers30d')}
              value={formatNumber(overviewQuery.data.totals.active_users_30d, locale)}
            />
          </Box>

          <Stack spacing={1}>
            <Typography variant="subtitle1">{t('aiAdmin.overview.tokenUsage')}</Typography>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('aiAdmin.overview.columns.window')}</TableCell>
                  <TableCell align="right">{t('aiAdmin.overview.columns.inputTokens')}</TableCell>
                  <TableCell align="right">{t('aiAdmin.overview.columns.outputTokens')}</TableCell>
                  <TableCell align="right">{t('aiAdmin.overview.columns.totalTokens')}</TableCell>
                  <TableCell align="right">{t('aiAdmin.overview.columns.messages')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                <TableRow>
                  <TableCell>{t('aiAdmin.overview.windows.currentMonth')}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.current_month.input_tokens, locale)}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.current_month.output_tokens, locale)}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.current_month.total_tokens, locale)}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.current_month.message_count, locale)}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>{t('aiAdmin.overview.windows.last30Days')}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.last_30_days.input_tokens, locale)}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.last_30_days.output_tokens, locale)}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.last_30_days.total_tokens, locale)}</TableCell>
                  <TableCell align="right">{formatNumber(overviewQuery.data.usage.last_30_days.message_count, locale)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </Stack>

          {(overviewQuery.data.agents ?? []).length > 0 && (
            <Stack spacing={1}>
              <Typography variant="subtitle1">{t('aiAdmin.overview.agentMessages')}</Typography>
              <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
                <MetricCard
                  label={t('aiAdmin.overview.agentsTotal')}
                  value={formatNumber(overviewQuery.data.agents.reduce((sum, agent) => sum + agent.messages_current_month, 0), locale)}
                  caption={`${t('aiAdmin.overview.windows.last30Days')}: ${formatNumber(overviewQuery.data.agents.reduce((sum, agent) => sum + agent.messages_last_30_days, 0), locale)}`}
                />
                {overviewQuery.data.agents.map((agent) => (
                  <MetricCard
                    key={agent.agent_definition_id}
                    label={agent.name}
                    value={formatNumber(agent.messages_current_month, locale)}
                    caption={`${t('aiAdmin.overview.windows.last30Days')}: ${formatNumber(agent.messages_last_30_days, locale)}`}
                  />
                ))}
              </Box>
            </Stack>
          )}
        </Stack>
      ) : null}
    </Box>
  );
}
