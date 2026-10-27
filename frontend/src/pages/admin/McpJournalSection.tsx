import React, { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import {
  aiKeysApi,
  type McpJournalItem,
  type McpJournalPage,
  type McpJournalQuery,
  type McpJournalResult,
} from '../../ai/aiApi';
import { PropertyRow, StatusDot } from '../../components/design';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import { clientDisplayName } from '../oauth/clientName';

export const MCP_JOURNAL_PAGE_SIZE = 25;

const PERIODS = ['day', 'week', 'month', 'all'] as const;
type Period = typeof PERIODS[number];
const PERIOD_MS: Record<Exclude<Period, 'all'>, number> = {
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};
const RESULTS = ['completed', 'refused', 'failed'] as const;
const KNOWN_REASONS = new Set([
  'unknown_tool', 'read_only', 'key_policy', 'permission', 'disabled', 'invalid_input',
  'key_revoked', 'key_expired', 'owner_not_allowed', 'not_found', 'error',
]);
const RESULT_COLOR: Record<McpJournalResult, string> = {
  completed: 'success',
  refused: 'warning',
  failed: 'error',
  running: 'default',
};

type Filters = { person: string; key: string; result: string; period: Period };
const DEFAULT_FILTERS: Filters = { person: '', key: '', result: '', period: 'week' };

const headSx = { fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', whiteSpace: 'nowrap' } as const;
const cellSx = { fontSize: 13, verticalAlign: 'top' } as const;
const tertiarySx = { color: 'kanap.text.tertiary' } as const;

/**
 * Administration › Plaid: the MCP journal. Every tool call an MCP client made, completed, refused or
 * failed, with the person, the key or connection, the tool, the cause of a refusal in plain words
 * and the duration; filtered by person, key, result and period, a page at a time.
 */
export default function McpJournalSection() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [offset, setOffset] = useState(0);

  // The period starts at the moment it is chosen, so that paging keeps the same window.
  const [periodStart, setPeriodStart] = useState(() => Date.now());
  const from = filters.period === 'all' ? null : new Date(periodStart - PERIOD_MS[filters.period]).toISOString();

  const journal = useQuery<McpJournalPage>({
    queryKey: ['admin-mcp-journal', filters.person, filters.key, filters.result, from, offset],
    queryFn: () => aiKeysApi.adminMcpJournal({
      limit: MCP_JOURNAL_PAGE_SIZE,
      offset,
      user_id: filters.person || null,
      api_key_id: filters.key || null,
      result: (filters.result || null) as McpJournalQuery['result'],
      from,
    }),
    placeholderData: keepPreviousData,
  });

  const facets = journal.data?.facets;
  const keyName = (key: { label: string; credential_kind: string; oauth_client_name: string | null }) =>
    key.credential_kind === 'oauth' ? clientDisplayName(key.oauth_client_name) ?? key.label : key.label;
  const people = facets?.people ?? [];
  const keys = facets?.keys ?? [];

  const setFilter = (name: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
    if (name === 'period') setPeriodStart(Date.now());
    setOffset(0);
  };

  const itemKeyName = (item: McpJournalItem) => {
    if (!item.ai_api_key_id) return t('aiAdmin.journal.noKey');
    if (!item.key_label) return t('aiAdmin.journal.deletedKey');
    return item.key_kind === 'oauth' ? clientDisplayName(item.oauth_client_name) ?? item.key_label : item.key_label;
  };

  const resultText = (item: McpJournalItem) => t(`aiAdmin.journal.results.${item.result}`);
  const reasonText = (item: McpJournalItem) =>
    item.reason && item.result !== 'completed' && KNOWN_REASONS.has(item.reason)
      ? t(`aiAdmin.journal.reasons.${item.reason}`)
      : null;

  const filterSelect = (
    name: keyof Filters,
    label: string,
    options: Array<{ value: string; label: string }>,
    allLabel: string | null,
  ) => (
    <PropertyRow label={label} sx={{ minWidth: 0 }}>
      <Select
        variant="standard"
        value={filters[name]}
        onChange={(event) => setFilter(name, String(event.target.value))}
        displayEmpty
        sx={drawerSelectSx}
        SelectDisplayProps={{ 'aria-label': label } as React.HTMLAttributes<HTMLDivElement>}
      >
        {allLabel != null ? <MenuItem value="" sx={drawerMenuItemSx}>{allLabel}</MenuItem> : null}
        {options.map((option) => (
          <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>{option.label}</MenuItem>
        ))}
      </Select>
    </PropertyRow>
  );

  const items = journal.data?.items ?? [];
  const pageStart = offset + 1;
  const pageEnd = offset + items.length;

  return (
    <Card>
      <CardContent>
        <Stack spacing={2}>
          <Typography variant="h6">{t('aiAdmin.journal.title')}</Typography>

          <Box
            sx={{
              display: 'grid',
              gap: 2,
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' },
            }}
          >
            {filterSelect(
              'person',
              t('aiAdmin.journal.filters.person'),
              people.map((person) => ({ value: person.id, label: person.name ?? t('aiAdmin.journal.unknownPerson') })),
              t('aiAdmin.journal.filters.all'),
            )}
            {filterSelect(
              'key',
              t('aiAdmin.journal.filters.key'),
              keys.map((key) => ({ value: key.id, label: keyName(key) })),
              t('aiAdmin.journal.filters.all'),
            )}
            {filterSelect(
              'result',
              t('aiAdmin.journal.filters.result'),
              RESULTS.map((result) => ({ value: result, label: t(`aiAdmin.journal.results.${result}`) })),
              t('aiAdmin.journal.filters.all'),
            )}
            {filterSelect(
              'period',
              t('aiAdmin.journal.filters.period'),
              PERIODS.map((period) => ({ value: period, label: t(`aiAdmin.journal.periods.${period}`) })),
              null,
            )}
          </Box>

          {journal.isLoading ? (
            <Box display="flex" justifyContent="center" py={3}>
              <CircularProgress size={24} />
            </Box>
          ) : journal.isError ? (
            <Alert severity="error">{getApiErrorMessage(journal.error, t, t('aiAdmin.journal.loadFailed'))}</Alert>
          ) : items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">{t('aiAdmin.journal.empty')}</Typography>
          ) : (
            <>
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label={t('aiAdmin.journal.title')}>
                  <TableHead>
                    <TableRow>
                      <TableCell sx={headSx}>{t('aiAdmin.journal.columns.date')}</TableCell>
                      <TableCell sx={headSx}>{t('aiAdmin.journal.columns.person')}</TableCell>
                      <TableCell sx={headSx}>{t('aiAdmin.journal.columns.key')}</TableCell>
                      <TableCell sx={headSx}>{t('aiAdmin.journal.columns.tool')}</TableCell>
                      <TableCell sx={headSx}>{t('aiAdmin.journal.columns.result')}</TableCell>
                      <TableCell sx={headSx} align="right">{t('aiAdmin.journal.columns.duration')}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {items.map((item) => {
                      const reason = reasonText(item);
                      const color = getDotColor(RESULT_COLOR[item.result] ?? 'default', mode);
                      return (
                        <TableRow key={item.tool_execution_id} data-testid="mcp-journal-row">
                          <TableCell sx={{ ...cellSx, whiteSpace: 'nowrap' }}>
                            {formatShortDateTime(item.tool_created_at, locale)}
                          </TableCell>
                          <TableCell sx={cellSx}>{item.user_name ?? t('aiAdmin.journal.unknownPerson')}</TableCell>
                          <TableCell sx={cellSx}>{itemKeyName(item)}</TableCell>
                          <TableCell sx={{ ...cellSx, fontFamily: MONO_FONT_FAMILY, fontSize: 12, overflowWrap: 'anywhere' }}>
                            {item.capability_name}
                          </TableCell>
                          <TableCell sx={cellSx}>
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                              <StatusDot color={color} />
                              <Box component="span" sx={{ color, fontWeight: 500 }}>{resultText(item)}</Box>
                            </Box>
                            {reason ? <Box sx={{ ...tertiarySx, fontSize: 12 }}>{reason}</Box> : null}
                          </TableCell>
                          <TableCell sx={{ ...cellSx, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }} align="right">
                            {item.duration_ms == null ? '' : t('aiAdmin.journal.duration', { value: item.duration_ms })}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
                <Typography variant="body2" sx={{ ...tertiarySx, fontSize: 12, mr: 1 }}>
                  {t('aiAdmin.journal.range', { from: pageStart, to: pageEnd })}
                </Typography>
                <Button
                  variant="action"
                  disabled={offset === 0 || journal.isFetching}
                  onClick={() => setOffset(Math.max(0, offset - MCP_JOURNAL_PAGE_SIZE))}
                >
                  {t('aiAdmin.journal.previous')}
                </Button>
                <Button
                  variant="action"
                  disabled={!journal.data?.has_more || journal.isFetching}
                  onClick={() => setOffset(offset + MCP_JOURNAL_PAGE_SIZE)}
                >
                  {t('aiAdmin.journal.next')}
                </Button>
              </Stack>
            </>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
}
