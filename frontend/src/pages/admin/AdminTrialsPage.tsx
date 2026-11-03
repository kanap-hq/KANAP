import React from 'react';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import RefreshIcon from '@mui/icons-material/Refresh';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { KanapDialog, PropertyRow, StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { getDotColor } from '../../utils/statusColors';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { attentionDotSx, compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, inlineControlSx } from '../../theme/formSx';
import IncidentDateTimeField from '../it/workspace/IncidentDateTimeField';
import ForbiddenPage from '../ForbiddenPage';
import {
  DiscoveryCall,
  FunnelWeek,
  TRIAL_STATES,
  TrialFunnel,
  TrialFunnelRow,
  TrialState,
  listTrials,
  removeTrialDiscoveryCall,
  saveTrialDiscoveryCall,
} from '../../services/adminTrials';

const STATE_COLOR: Record<TrialState, string> = {
  awaiting_activation: 'default',
  trialing: 'info',
  ended: 'default',
  converted: 'success',
  internal: 'default',
};

const DAY_MS = 24 * 3600_000;

const cellSx = { whiteSpace: 'nowrap', fontSize: 13 } as const;
const tertiarySx = { color: 'kanap.text.tertiary' } as const;

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Back after `days`: the date, "No" once the window has passed, nothing before. */
function backCell(at: string | null, firstSignIn: string | null, days: number, locale: string, t: Translate) {
  if (at) return formatShortDate(at, locale);
  if (firstSignIn && Date.now() - new Date(firstSignIn).getTime() >= days * DAY_MS) {
    return <Box component="span" sx={tertiarySx}>{t('trials.values.no')}</Box>;
  }
  return null;
}

function pathText(row: TrialFunnelRow, t: Translate): string {
  if (!row.angle && !row.mode) return '';
  const angle = row.angle ? t(`common:onboarding.about.angles.${row.angle}`) : t('common:onboarding.about.angles.none');
  return row.mode ? `${angle} · ${t(`common:onboarding.about.modes.${row.mode}`)}` : angle;
}

function WeeklyFunnelTable({ weeks, locale, t }: { weeks: FunnelWeek[]; locale: string; t: Translate }) {
  const ordered = [...weeks].reverse();
  const lines: Array<{ key: keyof Omit<FunnelWeek, 'week'>; label: string }> = [
    { key: 'created', label: t('trials.weeks.created') },
    { key: 'activated', label: t('trials.weeks.activated') },
    { key: 'signed_in', label: t('trials.weeks.signedIn') },
    { key: 'converted', label: t('trials.weeks.converted') },
  ];
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" aria-label={t('trials.weeks.title')} sx={{ width: 'auto' }}>
        <TableHead>
          <TableRow>
            <TableCell sx={cellSx}>{t('trials.weeks.weekOf')}</TableCell>
            {ordered.map((week) => (
              <TableCell key={week.week} align="right" sx={cellSx}>{formatShortDate(`${week.week}T12:00:00Z`, locale)}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.key}>
              <TableCell sx={cellSx}>{line.label}</TableCell>
              {ordered.map((week) => (
                <TableCell key={week.week} align="right" sx={{ ...cellSx, fontVariantNumeric: 'tabular-nums', ...(week[line.key] ? {} : tertiarySx) }}>
                  {week[line.key]}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}

type CallDraft = { scheduled_at: string | null; status: DiscoveryCall['status']; note: string };

function DiscoveryCallDialog({ row, onClose }: { row: TrialFunnelRow | null; onClose: () => void }) {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const [draft, setDraft] = React.useState<CallDraft>({ scheduled_at: null, status: 'booked', note: '' });
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!row) return;
    const call = row.discovery_call;
    setDraft({ scheduled_at: call?.scheduled_at ?? null, status: call?.status ?? 'booked', note: call?.note ?? '' });
    setError(null);
  }, [row]);

  const done = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-trials'] });
    onClose();
  };
  const save = useMutation({
    mutationFn: () => saveTrialDiscoveryCall(row!.tenant_id!, {
      scheduled_at: draft.scheduled_at!,
      status: draft.status,
      note: draft.note.trim() || null,
    }),
    onSuccess: done,
    onError: (err) => setError(getApiErrorMessage(err, t, t('trials.call.saveFailed'))),
  });
  const remove = useMutation({
    mutationFn: () => removeTrialDiscoveryCall(row!.tenant_id!),
    onSuccess: done,
    onError: (err) => setError(getApiErrorMessage(err, t, t('trials.call.saveFailed'))),
  });

  return (
    <KanapDialog
      open={!!row}
      title={t('trials.call.title', { name: row?.name ?? '' })}
      onClose={onClose}
      onSave={() => save.mutate()}
      saveLabel={t('common:buttons.save')}
      saveDisabled={!draft.scheduled_at || remove.isPending}
      saveLoading={save.isPending}
      footerLeft={row?.discovery_call ? (
        <Button variant="action-danger" onClick={() => remove.mutate()} disabled={remove.isPending || save.isPending}>
          {t('trials.call.remove')}
        </Button>
      ) : undefined}
    >
      <Stack spacing={1.5}>
        {error && <Alert severity="error">{error}</Alert>}
        <PropertyRow label={t('trials.call.date')}>
          <IncidentDateTimeField value={draft.scheduled_at} onChange={(next) => setDraft((d) => ({ ...d, scheduled_at: next }))} />
        </PropertyRow>
        <PropertyRow label={t('trials.call.status')}>
          <Select
            variant="standard"
            value={draft.status}
            onChange={(event) => setDraft((d) => ({ ...d, status: event.target.value as DiscoveryCall['status'] }))}
            sx={drawerSelectSx}
            MenuProps={compactSelectMenuProps}
            inputProps={{ 'aria-label': t('trials.call.status') }}
          >
            <MenuItem value="booked" sx={drawerMenuItemSx}>{t('trials.call.statuses.booked')}</MenuItem>
            <MenuItem value="cancelled" sx={drawerMenuItemSx}>{t('trials.call.statuses.cancelled')}</MenuItem>
          </Select>
        </PropertyRow>
        <PropertyRow label={t('trials.call.note')}>
          <TextField
            variant="standard"
            value={draft.note}
            onChange={(event) => setDraft((d) => ({ ...d, note: event.target.value }))}
            multiline
            minRows={2}
            fullWidth
            inputProps={{ maxLength: 2000, 'aria-label': t('trials.call.note') }}
          />
        </PropertyRow>
        {row?.discovery_call?.source === 'calcom' && (
          <Typography variant="body2" sx={tertiarySx}>{t('trials.call.fromCalcom')}</Typography>
        )}
      </Stack>
    </KanapDialog>
  );
}

function CallCell({ row, locale, t, onEdit }: { row: TrialFunnelRow; locale: string; t: Translate; onEdit: () => void }) {
  const call = row.discovery_call;
  const text = call?.scheduled_at
    ? `${formatShortDateTime(call.scheduled_at, locale)}${call.status === 'cancelled' ? ` · ${t('trials.call.statuses.cancelled')}` : ''}`
    : null;
  if (!row.tenant_id) return null;
  return (
    <ButtonBase
      onClick={onEdit}
      aria-label={t('trials.call.edit', { name: row.name })}
      sx={{ font: 'inherit', borderRadius: '4px', px: 0.5, mx: -0.5, '&:hover': { bgcolor: 'action.hover' }, ...(text && call?.status === 'booked' ? {} : tertiarySx) }}
    >
      {text ?? t('trials.call.set')}
    </ButtonBase>
  );
}

export default function AdminTrialsPage() {
  const { claims } = useAuth();
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  const [state, setState] = React.useState<TrialState | 'all'>('all');
  const [editing, setEditing] = React.useState<TrialFunnelRow | null>(null);

  const query = useQuery<TrialFunnel>({
    queryKey: ['admin-trials', state],
    queryFn: () => listTrials(state === 'all' ? {} : { state }),
    placeholderData: keepPreviousData,
    enabled: !!claims?.isPlatformAdmin,
  });

  if (!claims?.isPlatformAdmin) return <ForbiddenPage />;

  const date = (value: string | null) => formatShortDate(value, locale);
  const dateTime = (value: string | null) => formatShortDateTime(value, locale);
  const funnel = query.data;
  const columns = [
    'workspace', 'state', 'signedUp', 'activated', 'firstSignIn', 'lastSignIn', 'path', 'steps', 'sampleData', 'firstRecord',
    'firstQuestion', 'firstImport', 'firstInvitation', 'backDay1', 'backDay7', 'trialEnd', 'converted', 'callClicked', 'call',
  ];

  return (
    <>
      <PageHeader
        title={t('trials.title')}
        actions={[
          <Tooltip key="refresh" title={t('trials.refresh')}>
            <span>
              <IconButton onClick={() => query.refetch()} disabled={query.isFetching} aria-label={t('trials.refresh')}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>,
        ]}
      />
      {query.isLoading ? (
        <Box display="flex" justifyContent="center" py={4}><CircularProgress size={28} /></Box>
      ) : query.isError ? (
        <Alert severity="error">{getApiErrorMessage(query.error, t, t('trials.loadFailed'))}</Alert>
      ) : funnel ? (
        <Stack spacing={3}>
          <WeeklyFunnelTable weeks={funnel.weeks} locale={locale} t={t} />

          <Stack spacing={1}>
            <Stack direction="row" alignItems="center" spacing={2} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
              <Select
                variant="standard"
                value={state}
                onChange={(event) => setState(event.target.value as TrialState | 'all')}
                sx={[drawerSelectSx, inlineControlSx, { width: 'auto', minWidth: 120 }]}
                MenuProps={compactSelectMenuProps}
                inputProps={{ 'aria-label': t('trials.filterState') }}
              >
                <MenuItem value="all" sx={drawerMenuItemSx}>{t('trials.states.all')}</MenuItem>
                {TRIAL_STATES.map((value) => (
                  <MenuItem key={value} value={value} sx={drawerMenuItemSx}>{t(`trials.states.${value}`)}</MenuItem>
                ))}
              </Select>
              {funnel.attention > 0 && (
                <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75, fontSize: 13 }}>
                  <Box component="span" sx={attentionDotSx} />
                  {t('trials.attention', { count: funnel.attention })}
                </Box>
              )}
            </Stack>

            {funnel.items.length === 0 ? (
              <Typography variant="body2" sx={{ ...tertiarySx, py: 2 }}>{t('trials.empty')}</Typography>
            ) : (
              <Box sx={{ overflowX: 'auto' }}>
                <Table size="small" aria-label={t('trials.title')}>
                  <TableHead>
                    <TableRow>
                      {columns.map((column) => <TableCell key={column} sx={cellSx}>{t(`trials.columns.${column}`)}</TableCell>)}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {funnel.items.map((row) => {
                      const color = row.needs_attention ? 'warning' : STATE_COLOR[row.state];
                      return (
                        <TableRow key={row.signup_id} hover>
                          <TableCell sx={cellSx}>
                            <Box>{row.name}</Box>
                            <Box sx={{ ...tertiarySx, fontSize: 12 }}>{[row.slug, row.contact_name].filter(Boolean).join(' · ')}</Box>
                          </TableCell>
                          <TableCell sx={cellSx}>
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                              <StatusDot color={getDotColor(color, mode)} />
                              {row.needs_attention ? t('trials.noSignIn') : t(`trials.states.${row.state}`)}
                            </Box>
                          </TableCell>
                          <TableCell sx={cellSx}>{dateTime(row.created_at)}</TableCell>
                          <TableCell sx={cellSx}>{dateTime(row.activated_at)}</TableCell>
                          <TableCell sx={cellSx}>{dateTime(row.first_sign_in_at)}</TableCell>
                          <TableCell sx={cellSx}>{dateTime(row.last_sign_in_at)}</TableCell>
                          <TableCell sx={cellSx}>{pathText(row, t)}</TableCell>
                          <TableCell sx={{ ...cellSx, fontVariantNumeric: 'tabular-nums' }}>
                            {row.steps_total ? `${row.steps_done ?? 0}/${row.steps_total}` : ''}
                          </TableCell>
                          <TableCell sx={cellSx}>{date(row.sample_data_loaded_at)}</TableCell>
                          <TableCell sx={cellSx}>{date(row.first_record_at)}</TableCell>
                          <TableCell sx={cellSx}>{date(row.first_plaid_question_at)}</TableCell>
                          <TableCell sx={cellSx}>{date(row.first_import_at)}</TableCell>
                          <TableCell sx={cellSx}>{date(row.first_invitation_at)}</TableCell>
                          <TableCell sx={cellSx}>{backCell(row.back_after_1_day_at, row.first_sign_in_at, 1, locale, t)}</TableCell>
                          <TableCell sx={cellSx}>{backCell(row.back_after_7_days_at, row.first_sign_in_at, 7, locale, t)}</TableCell>
                          <TableCell sx={cellSx}>{date(row.trial_end)}</TableCell>
                          <TableCell sx={cellSx}>{row.state === 'converted' ? date(row.converted_at) || t('trials.values.yes') : ''}</TableCell>
                          <TableCell sx={cellSx}>
                            {row.discovery_call_first_click && (
                              <Tooltip title={row.discovery_call_first_click.placement ? t(`trials.placements.${row.discovery_call_first_click.placement}`, { defaultValue: row.discovery_call_first_click.placement }) : ''}>
                                <span>{date(row.discovery_call_first_click.at)}</span>
                              </Tooltip>
                            )}
                          </TableCell>
                          <TableCell sx={cellSx}><CallCell row={row} locale={locale} t={t} onEdit={() => setEditing(row)} /></TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </Box>
            )}
          </Stack>
        </Stack>
      ) : null}
      <DiscoveryCallDialog row={editing} onClose={() => setEditing(null)} />
    </>
  );
}
