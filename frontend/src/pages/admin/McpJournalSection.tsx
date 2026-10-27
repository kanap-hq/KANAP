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
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowRightIcon from '@mui/icons-material/KeyboardArrowRight';
import { useTranslation } from 'react-i18next';
import {
  aiKeysApi,
  type McpJournalItem,
  type McpJournalPage,
  type McpJournalQuery,
} from '../../ai/aiApi';
import { PropertyRow, StatusDot } from '../../components/design';
import { MONO_FONT_FAMILY } from '../../config/ThemeContext';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor, MCP_CALL_RESULT_COLORS } from '../../utils/statusColors';
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

type Filters = { person: string; key: string; result: string; period: Period };
const DEFAULT_FILTERS: Filters = { person: '', key: '', result: '', period: 'week' };

const headSx = { fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', whiteSpace: 'nowrap' } as const;
const cellSx = { fontSize: 13, verticalAlign: 'top' } as const;
const tertiarySx = { color: 'kanap.text.tertiary' } as const;
const chevronSx = { fontSize: 16, color: 'kanap.text.tertiary', verticalAlign: 'middle' } as const;
const COLUMN_COUNT = 7;

/**
 * A key or connection as the MCP keys table names it: the label of a key, the client's name and
 * the host it redirects to for a connection (two "Claude" connections differ by their host).
 */
export function mcpCredentialName(credential: {
  kind: string | null;
  label: string;
  clientName: string | null;
  host: string | null;
}): string {
  if (credential.kind !== 'oauth') return credential.label;
  const name = clientDisplayName(credential.clientName) ?? credential.label;
  return credential.host ? `${name} · ${credential.host}` : name;
}

// What the server writes in place of a hidden or cut value (`mcpArgumentPreview`).
const REDACTED = '[REDACTED]';
const MORE_VALUES = /^\[(\d+) more\]$/;

function isTruncatedWhole(value: unknown): value is { truncated: true; preview: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2 && record.truncated === true && typeof record.preview === 'string';
}

function ArgumentValue({ value }: { value: unknown }) {
  const { t } = useTranslation('admin');
  if (value == null) return <Box component="span" sx={tertiarySx}>—</Box>;
  if (typeof value === 'string') {
    if (value === REDACTED) return <Box component="span" sx={tertiarySx}>{t('aiAdmin.journal.details.hidden')}</Box>;
    if (value === '[...]') return <Box component="span" sx={tertiarySx}>…</Box>;
    const more = MORE_VALUES.exec(value);
    if (more) return <Box component="span" sx={tertiarySx}>{t('aiAdmin.journal.details.more', { count: Number(more[1]) })}</Box>;
    return <>{value}</>;
  }
  if (typeof value !== 'object') return <>{String(value)}</>;
  if (Array.isArray(value)) {
    if (value.length === 0) return <Box component="span" sx={tertiarySx}>—</Box>;
    if (value.every((entry) => entry == null || typeof entry !== 'object')) {
      return (
        <>
          {value.map((entry, index) => (
            <React.Fragment key={index}>
              {index > 0 ? ', ' : null}
              <ArgumentValue value={entry} />
            </React.Fragment>
          ))}
        </>
      );
    }
    return (
      <Stack spacing={0.5}>
        {value.map((entry, index) => <Box key={index}><ArgumentValue value={entry} /></Box>)}
      </Stack>
    );
  }
  return <ArgumentList args={value as Record<string, unknown>} />;
}

/** The arguments of a call as name and value pairs, nested objects as nested lists. */
function ArgumentList({ args }: { args: Record<string, unknown> }) {
  const { t } = useTranslation('admin');
  const entries = Object.entries(args);
  if (entries.length === 0) {
    return <Box component="span" sx={tertiarySx}>{t('aiAdmin.journal.details.noArguments')}</Box>;
  }
  return (
    <Box
      component="dl"
      sx={{ m: 0, display: 'grid', gridTemplateColumns: 'max-content minmax(0, 1fr)', columnGap: 2, rowGap: 0.5 }}
    >
      {entries.map(([name, value]) => (
        <React.Fragment key={name}>
          <Box component="dt" sx={{ color: 'kanap.text.secondary', fontFamily: MONO_FONT_FAMILY, fontSize: 12, lineHeight: '20px' }}>
            {name === '[more]' ? '…' : name}
          </Box>
          <Box component="dd" sx={{ m: 0, minWidth: 0, fontSize: 13, lineHeight: '20px', overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
            {name === '[more]'
              ? <Box component="span" sx={tertiarySx}>{t('aiAdmin.journal.details.more', { count: Number(value) || 0 })}</Box>
              : <ArgumentValue value={value} />}
          </Box>
        </React.Fragment>
      ))}
    </Box>
  );
}

/** The detail of one call: its arguments (values as the server kept them) and the full cause. */
function CallDetails({ item }: { item: McpJournalItem }) {
  const { t } = useTranslation('admin');
  const args = item.input_summary?.arguments;
  const cause = item.result !== 'completed' ? item.error_message : null;
  return (
    <Box sx={{ display: 'grid', gap: 1.5, gridTemplateColumns: { xs: '1fr', md: cause ? 'minmax(0, 3fr) minmax(0, 2fr)' : '1fr' } }}>
      <PropertyRow label={t('aiAdmin.journal.details.arguments')} valueSx={{ maxWidth: 'none' }}>
        {args === undefined ? (
          <Box component="span" sx={tertiarySx}>{t('aiAdmin.journal.details.notRecorded')}</Box>
        ) : isTruncatedWhole(args) ? (
          <Box sx={{ fontFamily: MONO_FONT_FAMILY, fontSize: 12, overflowWrap: 'anywhere' }}>{args.preview}</Box>
        ) : args && typeof args === 'object' && !Array.isArray(args) ? (
          <ArgumentList args={args as Record<string, unknown>} />
        ) : (
          <ArgumentValue value={args} />
        )}
      </PropertyRow>
      {cause ? (
        <PropertyRow label={t('aiAdmin.journal.details.cause')} valueSx={{ maxWidth: 'none' }}>
          <Box sx={{ fontSize: 13, overflowWrap: 'anywhere' }}>{cause}</Box>
        </PropertyRow>
      ) : null}
    </Box>
  );
}

/**
 * Administration › Plaid: the MCP journal. Every tool call an MCP client made, completed, refused or
 * failed, with the person, the key or connection, the tool, the cause of a refusal in plain words
 * and the duration; filtered by person, key, result and period, a page at a time. A line opens on
 * the arguments of the call (as the server kept them: secrets hidden, long values cut) and the full
 * cause of a refusal.
 */
export default function McpJournalSection() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

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
  const people = facets?.people ?? [];
  const keys = facets?.keys ?? [];

  const setFilter = (name: keyof Filters, value: string) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
    if (name === 'period') setPeriodStart(Date.now());
    setOffset(0);
  };

  // Every MCP call is made with a key or a connection: a line without one outlived it (the key, or
  // its owner, was deleted). The person stays when the line still knows them.
  const itemKeyName = (item: McpJournalItem) => {
    if (!item.key_label) return <Box component="span" sx={tertiarySx}>{t('aiAdmin.journal.deletedKey')}</Box>;
    if (item.key_kind !== 'oauth') return item.key_label;
    const name = clientDisplayName(item.oauth_client_name) ?? item.key_label;
    return (
      <>
        {name}
        {item.oauth_redirect_host ? <Box component="span" sx={tertiarySx}>{` · ${item.oauth_redirect_host}`}</Box> : null}
      </>
    );
  };
  const itemPersonName = (item: McpJournalItem) =>
    item.user_name ?? <Box component="span" sx={tertiarySx}>{t('aiAdmin.journal.formerUser')}</Box>;

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
              people.map((person) => ({ value: person.id, label: person.name ?? t('aiAdmin.journal.formerUser') })),
              t('aiAdmin.journal.filters.all'),
            )}
            {filterSelect(
              'key',
              t('aiAdmin.journal.filters.key'),
              keys.map((key) => {
                const name = mcpCredentialName({
                  kind: key.credential_kind,
                  label: key.label,
                  clientName: key.oauth_client_name,
                  host: key.oauth_redirect_host,
                });
                return { value: key.id, label: key.revoked ? t('aiAdmin.journal.revokedOption', { name }) : name };
              }),
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
                      <TableCell sx={{ ...headSx, width: 24, pr: 0 }} aria-hidden />
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
                      const color = getDotColor(MCP_CALL_RESULT_COLORS[item.result] ?? 'default', mode);
                      const expanded = open.has(item.tool_execution_id);
                      return (
                        <React.Fragment key={item.tool_execution_id}>
                          <TableRow
                            data-testid="mcp-journal-row"
                            tabIndex={0}
                            aria-expanded={expanded}
                            onClick={() => toggle(item.tool_execution_id)}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key === 'Enter' || event.key === ' ') {
                                event.preventDefault();
                                toggle(item.tool_execution_id);
                              }
                            }}
                            sx={{
                              cursor: 'pointer',
                              '&:hover': { bgcolor: 'kanap.bg.hover' },
                              ...(expanded ? { '& > td': { borderBottom: 'none' } } : {}),
                            }}
                          >
                            <TableCell sx={{ ...cellSx, width: 24, pr: 0 }}>
                              {expanded ? <KeyboardArrowDownIcon sx={chevronSx} /> : <KeyboardArrowRightIcon sx={chevronSx} />}
                            </TableCell>
                            <TableCell sx={{ ...cellSx, whiteSpace: 'nowrap' }}>
                              {formatShortDateTime(item.tool_created_at, locale)}
                            </TableCell>
                            <TableCell sx={cellSx}>{itemPersonName(item)}</TableCell>
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
                              {item.duration_ms == null
                                ? <Box component="span" sx={tertiarySx}>—</Box>
                                : t('aiAdmin.journal.duration', { value: item.duration_ms })}
                            </TableCell>
                          </TableRow>
                          {expanded ? (
                            <TableRow data-testid="mcp-journal-details">
                              <TableCell colSpan={COLUMN_COUNT} sx={{ pt: 0, pb: 1.5, pl: 5 }}>
                                <CallDetails item={item} />
                              </TableCell>
                            </TableRow>
                          ) : null}
                        </React.Fragment>
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
