import React, { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  Grid,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../../utils/statusColors';
import { KanapDialog, StatusDot } from '../../components/design';
import DateEUField from '../../components/fields/DateEUField';
import RefreshIcon from '@mui/icons-material/Refresh';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import LockIcon from '@mui/icons-material/Lock';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import useDebouncedValue from '../../hooks/useDebouncedValue';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  INTERNAL_PLAN_NAME,
  SUBSCRIPTION_STATUSES,
  SubscriptionStatus,
  TenantDetail,
  TenantSummary,
  TenantListResponse,
  deleteTenant,
  freezeTenant,
  getTenant,
  listTenants,
  markTenantInternal,
  unfreezeTenant,
  updateTenantPlan,
} from '../../services/adminTenants';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useLocale } from '../../i18n/useLocale';

const STATUS_OPTIONS = [
  { value: 'all' },
  { value: 'active' },
  { value: 'frozen' },
  { value: 'deleting' },
  { value: 'deleted' },
];

const STATUS_COLOR: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  active: 'success',
  frozen: 'info',
  deleting: 'warning',
  deleted: 'error',
};

type PlanDraft = {
  plan_name: string;
  /** Empty string means unlimited seats. */
  seat_limit: string;
  active_seats: number;
  subscription_type: 'monthly' | 'annual';
  payment_mode: 'card' | 'bank_transfer';
  next_payment_at: string;
  /** Empty string when the subscription has no status yet. */
  status: SubscriptionStatus | '';
  trial_end: string;
};

const toYmd = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');

export default function AdminTenantsPage() {
  const { claims } = useAuth();
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;
  if (!claims?.isPlatformAdmin) {
    return <ForbiddenPage />;
  }

  const queryClient = useQueryClient();
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const debouncedSearch = useDebouncedValue(search, 300);

  const listQuery = useQuery<TenantListResponse, Error>({
    queryKey: ['admin-tenants', { page, rowsPerPage, q: debouncedSearch, status }],
    queryFn: () =>
      listTenants({
        page: page + 1,
        limit: rowsPerPage,
        q: debouncedSearch ? debouncedSearch : undefined,
        status: status === 'all' ? undefined : status,
      }),
    placeholderData: keepPreviousData,
  });

  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSummary, setSelectedSummary] = useState<TenantSummary | null>(null);

  const detailQuery = useQuery<TenantDetail>({
    queryKey: ['admin-tenant', selectedId],
    queryFn: () => getTenant(selectedId!),
    enabled: !!selectedId,
  });

  useEffect(() => {
    if (detailQuery.data) {
      setSelectedSummary(detailQuery.data);
    }
  }, [detailQuery.data]);

  const effectiveDetail: TenantDetail | TenantSummary | null = useMemo(() => {
    return detailQuery.data ?? selectedSummary;
  }, [detailQuery.data, selectedSummary]);

  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  useEffect(() => {
    if (!effectiveDetail || !('plan' in effectiveDetail)) return;
    const plan = effectiveDetail.plan;
    if (!plan) {
      setPlanDraft(null);
      return;
    }
    setPlanDraft({
      plan_name: plan.plan_name ?? '',
      seat_limit: plan.seat_limit == null ? '' : String(plan.seat_limit),
      active_seats: plan.active_seats ?? plan.seats_used ?? 0,
      subscription_type: plan.subscription_type ?? 'monthly',
      payment_mode: plan.payment_mode ?? 'card',
      next_payment_at: toYmd(plan.next_payment_at),
      status: (plan.status as SubscriptionStatus | null | undefined) ?? '',
      trial_end: toYmd(plan.trial_end),
    });
  }, [effectiveDetail]);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [purgeReport, setPurgeReport] = useState<Array<{ table: string; deleted: number }> | null>(null);

  const getStatusLabel = useMemo(
    () => (value: string) => t(`tenants.statuses.${value}`, { defaultValue: value }),
    [t],
  );

  const invalidateTenants = () => {
    queryClient.invalidateQueries({ queryKey: ['admin-tenants'] }).catch(() => {});
    if (selectedId) {
      queryClient.invalidateQueries({ queryKey: ['admin-tenant', selectedId] }).catch(() => {});
    }
  };

  const freezeMutation = useMutation<TenantDetail, unknown, { reason?: string }>({
    mutationFn: (payload: { reason?: string }) => freezeTenant(selectedId!, payload),
    onSuccess: (data: TenantDetail) => {
      setSelectedSummary(data);
      setSuccessMessage(t('tenants.messages.frozen'));
      invalidateTenants();
    },
    onError: (err: any) => setErrorMessage(getApiErrorMessage(err, t, t('tenants.messages.freezeFailed'))),
  });

  const unfreezeMutation = useMutation<TenantDetail>({
    mutationFn: () => unfreezeTenant(selectedId!),
    onSuccess: (data: TenantDetail) => {
      setSelectedSummary(data);
      setSuccessMessage(t('tenants.messages.unfrozen'));
      invalidateTenants();
    },
    onError: (err: any) => setErrorMessage(getApiErrorMessage(err, t, t('tenants.messages.unfreezeFailed'))),
  });

  const planMutation = useMutation<TenantDetail, unknown, PlanDraft>({
    mutationFn: (draft: PlanDraft) => {
      const current = effectiveDetail?.plan ?? null;
      return updateTenantPlan(selectedId!, {
        plan_name: draft.plan_name,
        seat_limit: draft.seat_limit.trim() === '' ? null : Number(draft.seat_limit),
        active_seats: Number(draft.active_seats),
        subscription_type: draft.subscription_type,
        payment_mode: draft.payment_mode,
        next_payment_at: draft.next_payment_at ? new Date(draft.next_payment_at).toISOString() : null,
        // Status and trial end are sent only when edited, so saving other fields never rewrites them.
        ...(draft.status && draft.status !== (current?.status ?? '') ? { status: draft.status } : {}),
        ...(draft.trial_end !== toYmd(current?.trial_end)
          ? { trial_end: draft.trial_end ? new Date(draft.trial_end).toISOString() : null }
          : {}),
      });
    },
    onSuccess: (data: TenantDetail) => {
      setSelectedSummary(data);
      setSuccessMessage(t('tenants.messages.planUpdated'));
      invalidateTenants();
    },
    onError: (err: any) => setErrorMessage(getApiErrorMessage(err, t, t('tenants.messages.updatePlanFailed'))),
  });

  const [markInternalOpen, setMarkInternalOpen] = useState(false);
  const markInternalMutation = useMutation<TenantDetail>({
    mutationFn: () => markTenantInternal(selectedId!),
    onSuccess: (data: TenantDetail) => {
      setMarkInternalOpen(false);
      setSelectedSummary(data);
      setSuccessMessage(t('tenants.messages.markedInternal'));
      invalidateTenants();
    },
    onError: (err: any) => {
      setMarkInternalOpen(false);
      setErrorMessage(getApiErrorMessage(err, t, t('tenants.messages.markInternalFailed')));
    },
  });

  const deleteMutation = useMutation<{ tenant: TenantDetail; purgeReport: { table: string; deleted: number }[] }, unknown, { confirmSlug: string; reason?: string | null }>({
    mutationFn: (payload: { confirmSlug: string; reason?: string | null }) => deleteTenant(selectedId!, payload),
    onSuccess: ({ tenant, purgeReport: report }: { tenant: TenantDetail; purgeReport: { table: string; deleted: number }[] }) => {
      setSelectedSummary(tenant);
      setPurgeReport(report);
      setSuccessMessage(t('tenants.messages.deleted'));
      invalidateTenants();
    },
    onError: (err: any) => setErrorMessage(getApiErrorMessage(err, t, t('tenants.messages.deleteFailed'))),
  });

  const handleOpenDetail = (tenant: TenantSummary) => {
    setSelectedId(tenant.id);
    setSelectedSummary(tenant);
    setDetailOpen(true);
    setSuccessMessage(null);
    setErrorMessage(null);
    setDeleteConfirm('');
    setDeleteReason('');
    setPurgeReport(null);
  };

  const handleCloseDetail = () => {
    setDetailOpen(false);
    setSelectedId(null);
    setSelectedSummary(null);
    setPlanDraft(null);
    setDeleteConfirm('');
    setDeleteReason('');
    setPurgeReport(null);
  };

  const isDetailLoading = detailQuery.isLoading && !detailQuery.data;
  const isDeleted = effectiveDetail && 'status' in effectiveDetail ? effectiveDetail.status === 'deleted' : false;

  const canFreeze = effectiveDetail && 'status' in effectiveDetail && effectiveDetail.status === 'active';
  const canUnfreeze = effectiveDetail && 'status' in effectiveDetail && effectiveDetail.status === 'frozen';
  const currentPlan = effectiveDetail?.plan ?? null;
  const isSystemTenant = !!effectiveDetail?.is_system_tenant;
  const isInternal = currentPlan?.plan_name === INTERNAL_PLAN_NAME;
  const hasStripeSubscription = !!currentPlan?.stripe_subscription_id;
  const isDeletedOrDeleting = isDeleted || effectiveDetail?.status === 'deleting';
  const canMarkInternal = !!selectedId && !isSystemTenant && !isDeletedOrDeleting && !isInternal && !hasStripeSubscription;
  const confirmMatches = effectiveDetail && 'slug' in effectiveDetail
    ? deleteConfirm.trim() === effectiveDetail.slug
    : false;

const renderStatCard = (label: string, value: React.ReactNode) => (
  <Grid item xs={12} sm={6} md={4} key={label}>
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="h6">{value}</Typography>
    </Paper>
  </Grid>
);

  const tenantRows: TenantSummary[] = listQuery.data?.items ?? [];
  const totalRows = listQuery.data?.total ?? 0;

  return (
    <>
      <PageHeader
        title={t('tenants.title')}
        actions={[
          <Tooltip key="refresh" title={t('tenants.actions.refresh')}>
            <span>
              <IconButton onClick={() => listQuery.refetch()} disabled={listQuery.isFetching}>
                <RefreshIcon />
              </IconButton>
            </span>
          </Tooltip>,
        ]}
      />
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ xs: 'stretch', sm: 'center' }}>
          <TextField
            label={t('tenants.filters.searchLabel')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('tenants.filters.searchPlaceholder')}
            size="small"
            sx={{ minWidth: { xs: '100%', sm: 240 } }}
          />
          <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}>
            <InputLabel id="tenant-status-label">{t('tenants.filters.status')}</InputLabel>
            <Select
              labelId="tenant-status-label"
              label={t('tenants.filters.status')}
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              {STATUS_OPTIONS.map((opt) => (
                <MenuItem key={opt.value} value={opt.value}>{getStatusLabel(opt.value)}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Stack>

        {listQuery.isLoading ? (
          <Box display="flex" justifyContent="center" alignItems="center" minHeight={200}>
            <CircularProgress />
          </Box>
        ) : tenantRows.length === 0 ? (
          <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
            <Typography variant="body1">{t('tenants.empty')}</Typography>
          </Paper>
        ) : (
          <Paper variant="outlined">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{t('tenants.columns.tenant')}</TableCell>
                    <TableCell>{t('tenants.columns.status')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.companies')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.headcount')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.departments')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.suppliers')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.opex')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.capex')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.users')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.seats')}</TableCell>
                    <TableCell align="right">{t('tenants.columns.actions')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tenantRows.map((tenant: TenantSummary) => (
                    <TableRow key={tenant.id} hover>
                      <TableCell>
                        <Stack spacing={0.5}>
                          <Typography variant="subtitle2">{tenant.slug}</Typography>
                          <Typography variant="body2" color="text.secondary">{tenant.name}</Typography>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <StatusDot color={getDotColor(STATUS_COLOR[tenant.status] ?? 'default', mode)} />
                          <Typography variant="body2" sx={{ color: getDotColor(STATUS_COLOR[tenant.status] ?? 'default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{getStatusLabel(tenant.status)}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell align="right">{tenant.stats.companies}</TableCell>
                      <TableCell align="right">{tenant.stats.headcount}</TableCell>
                      <TableCell align="right">{tenant.stats.departments}</TableCell>
                      <TableCell align="right">{tenant.stats.suppliers}</TableCell>
                      <TableCell align="right">{tenant.stats.opexEntries}</TableCell>
                      <TableCell align="right">{tenant.stats.capexEntries}</TableCell>
                      <TableCell align="right">{tenant.stats.users.enabled}/{tenant.stats.users.total}</TableCell>
                      <TableCell align="right">
                        {tenant.plan ? (
                          <Typography variant="body2">{tenant.plan.seats_used}/{tenant.plan.seat_limit ?? '∞'}</Typography>
                        ) : (
                          <Typography variant="body2" color="text.secondary">{t('tenants.shared.none')}</Typography>
                        )}
                      </TableCell>
                      <TableCell align="right">
                        <Stack spacing={1} direction="row" justifyContent="flex-end">
                          <Button
                            size="small"
                            variant="outlined"
                            onClick={() => handleOpenDetail(tenant)}
                          >
                            {t('tenants.actions.view')}
                          </Button>
                        </Stack>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
            <TablePagination
              component="div"
              count={totalRows}
              page={page}
              onPageChange={(_, next) => setPage(next)}
              rowsPerPage={rowsPerPage}
              onRowsPerPageChange={(e) => {
                setRowsPerPage(parseInt(e.target.value, 10));
                setPage(0);
              }}
              rowsPerPageOptions={[10, 20, 50]}
            />
          </Paper>
        )}
      </Stack>

      <Dialog open={detailOpen} onClose={handleCloseDetail} maxWidth="lg" fullWidth>
        <DialogTitle>
          {t('tenants.detail.title')}
        </DialogTitle>
        <DialogContent dividers>
          {isDetailLoading && (
            <Box display="flex" justifyContent="center" alignItems="center" minHeight={160}>
              <CircularProgress />
            </Box>
          )}
          {!isDetailLoading && effectiveDetail && (
            <Stack spacing={3}>
              {(successMessage || errorMessage) && (
                <Stack spacing={1}>
                  {successMessage && <Alert severity="success" onClose={() => setSuccessMessage(null)}>{successMessage}</Alert>}
                  {errorMessage && <Alert severity="error" onClose={() => setErrorMessage(null)}>{errorMessage}</Alert>}
                </Stack>
              )}

              {'status' in effectiveDetail && (
                <Stack spacing={0.5}>
                  <Typography variant="h6">{effectiveDetail.name}</Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                      <StatusDot color={getDotColor(STATUS_COLOR[effectiveDetail.status] ?? 'default', mode)} />
                      <Typography variant="body2" sx={{ color: getDotColor(STATUS_COLOR[effectiveDetail.status] ?? 'default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{getStatusLabel(effectiveDetail.status)}</Typography>
                    </Box>
                    <Typography variant="body2" color="text.secondary">{t('tenants.detail.slug', { slug: effectiveDetail.slug })}</Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {t('tenants.detail.timestamps', {
                      createdAt: new Date(effectiveDetail.created_at).toLocaleString(locale),
                      updatedAt: new Date(effectiveDetail.updated_at).toLocaleString(locale),
                    })}
                  </Typography>
                  {detailQuery.data?.deletion_reason && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      {t('tenants.detail.deletionReason', { reason: detailQuery.data?.deletion_reason })}
                    </Alert>
                  )}
                  {effectiveDetail.status === 'deleting' && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      {t('tenants.detail.deletionInProgress')}
                    </Alert>
                  )}
                  {effectiveDetail.status === 'deleted' && (
                    <Alert severity="info" sx={{ mt: 1 }}>
                      {t('tenants.detail.deletedAt', {
                        value: effectiveDetail.deleted_at ? new Date(effectiveDetail.deleted_at).toLocaleString(locale) : t('tenants.shared.none'),
                      })}
                    </Alert>
                  )}
                </Stack>
              )}

              {'stats' in effectiveDetail && (
                <Box>
                  <Typography variant="subtitle1" sx={{ mb: 1 }}>{t('tenants.sections.statistics')}</Typography>
                  <Grid container spacing={2}>
                    {renderStatCard(t('tenants.stats.companies'), effectiveDetail.stats.companies)}
                    {renderStatCard(t('tenants.stats.headcount'), effectiveDetail.stats.headcount)}
                    {renderStatCard(t('tenants.stats.departments'), effectiveDetail.stats.departments)}
                    {renderStatCard(t('tenants.stats.suppliers'), effectiveDetail.stats.suppliers)}
                    {renderStatCard(t('tenants.stats.opexEntries'), effectiveDetail.stats.opexEntries)}
                    {renderStatCard(t('tenants.stats.capexEntries'), effectiveDetail.stats.capexEntries)}
                    {renderStatCard(t('tenants.stats.usersEnabledTotal'), `${effectiveDetail.stats.users.enabled}/${effectiveDetail.stats.users.total}`)}
                  </Grid>
                </Box>
              )}

              <Divider />

              <Box>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle1">{t('tenants.sections.lifecycle')}</Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<LockIcon />}
                      onClick={() => freezeMutation.mutate({})}
                      disabled={!canFreeze || freezeMutation.isPending || isDeleted || !selectedId}
                    >
                      {t('tenants.actions.freeze')}
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<LockOpenIcon />}
                      onClick={() => unfreezeMutation.mutate()}
                      disabled={!canUnfreeze || unfreezeMutation.isPending || isDeleted || !selectedId}
                    >
                      {t('tenants.actions.unfreeze')}
                    </Button>
                  </Stack>
                </Stack>
                <Stack spacing={0.5}>
                  <Typography variant="body2">{t('tenants.lifecycle.frozenAt', { value: effectiveDetail.frozen_at ? new Date(effectiveDetail.frozen_at).toLocaleString(locale) : t('tenants.shared.none') })}</Typography>
                  <Typography variant="body2">{t('tenants.lifecycle.deletionRequested', { value: effectiveDetail.deletion_requested_at ? new Date(effectiveDetail.deletion_requested_at).toLocaleString(locale) : t('tenants.shared.none') })}</Typography>
                  <Typography variant="body2">{t('tenants.lifecycle.deletionConfirmed', { value: effectiveDetail.deletion_confirmed_at ? new Date(effectiveDetail.deletion_confirmed_at).toLocaleString(locale) : t('tenants.shared.none') })}</Typography>
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ mb: 1 }}>
                  <Typography variant="subtitle1">{t('tenants.sections.plan')}</Typography>
                  {canMarkInternal ? (
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => setMarkInternalOpen(true)}
                      disabled={markInternalMutation.isPending}
                    >
                      {t('tenants.actions.markInternal')}
                    </Button>
                  ) : !isSystemTenant && !isDeletedOrDeleting && (isInternal || hasStripeSubscription) ? (
                    <Typography variant="body2" color="text.secondary">
                      {isInternal ? t('tenants.internal.alreadyInternal') : t('tenants.internal.stripeLinked')}
                    </Typography>
                  ) : null}
                </Stack>
                {planDraft ? (
                  <Grid container spacing={2}>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label={t('tenants.plan.fields.planName')}
                        value={planDraft.plan_name}
                        onChange={(e) => setPlanDraft({ ...planDraft, plan_name: e.target.value })}
                        fullWidth
                        disabled={planMutation.isPending || isDeleted}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label={t('tenants.plan.fields.seatLimit')}
                        type="number"
                        inputProps={{ min: 0 }}
                        value={planDraft.seat_limit}
                        onChange={(e) => setPlanDraft({ ...planDraft, seat_limit: e.target.value })}
                        helperText={t('tenants.plan.seatLimitHelper')}
                        fullWidth
                        disabled={planMutation.isPending || isDeleted}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        label={t('tenants.plan.fields.activeSeats')}
                        type="number"
                        inputProps={{ min: 0 }}
                        value={planDraft.active_seats}
                        onChange={(e) => setPlanDraft({ ...planDraft, active_seats: Number(e.target.value) })}
                        fullWidth
                        disabled={planMutation.isPending || isDeleted}
                      />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                        <InputLabel id="subscription-type-label">{t('tenants.plan.fields.subscription')}</InputLabel>
                        <Select
                          labelId="subscription-type-label"
                          label={t('tenants.plan.fields.subscription')}
                          value={planDraft.subscription_type}
                          onChange={(e) => setPlanDraft({ ...planDraft, subscription_type: e.target.value as PlanDraft['subscription_type'] })}
                          disabled={planMutation.isPending || isDeleted}
                        >
                          <MenuItem value="monthly">{t('tenants.plan.values.monthly')}</MenuItem>
                          <MenuItem value="annual">{t('tenants.plan.values.annual')}</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <FormControl fullWidth>
                        <InputLabel id="payment-mode-label">{t('tenants.plan.fields.paymentMode')}</InputLabel>
                        <Select
                          labelId="payment-mode-label"
                          label={t('tenants.plan.fields.paymentMode')}
                          value={planDraft.payment_mode}
                          onChange={(e) => setPlanDraft({ ...planDraft, payment_mode: e.target.value as PlanDraft['payment_mode'] })}
                          disabled={planMutation.isPending || isDeleted}
                        >
                          <MenuItem value="card">{t('tenants.plan.values.card')}</MenuItem>
                          <MenuItem value="bank_transfer">{t('tenants.plan.values.bankTransfer')}</MenuItem>
                        </Select>
                      </FormControl>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <DateEUField label={t('tenants.plan.fields.nextPaymentDate')} valueYmd={planDraft.next_payment_at || ''} onChangeYmd={(v) => setPlanDraft({ ...planDraft, next_payment_at: v })} />
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <TextField
                        select
                        label={t('tenants.plan.fields.status')}
                        value={planDraft.status}
                        onChange={(e) => setPlanDraft({ ...planDraft, status: e.target.value as SubscriptionStatus })}
                        fullWidth
                        disabled={planMutation.isPending || isDeleted}
                      >
                        {SUBSCRIPTION_STATUSES.map((value) => (
                          <MenuItem key={value} value={value}>{t(`tenants.plan.statuses.${value}`)}</MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <DateEUField label={t('tenants.plan.fields.trialEnd')} valueYmd={planDraft.trial_end || ''} onChangeYmd={(v) => setPlanDraft({ ...planDraft, trial_end: v })} disabled={planMutation.isPending || isDeleted} />
                    </Grid>
                    <Grid item xs={12}>
                      <Stack direction="row" spacing={1}>
                        <Button
                          variant="contained"
                          onClick={() => planDraft && planMutation.mutate(planDraft)}
                          disabled={planMutation.isPending || isDeleted || !selectedId || !planDraft}
                        >
                          {planMutation.isPending ? t('common:status.saving') : t('tenants.actions.savePlan')}
                        </Button>
                        <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'center' }}>
                          {t('tenants.plan.seatsUsed', { count: effectiveDetail?.plan?.seats_used ?? 0 })}
                        </Typography>
                      </Stack>
                    </Grid>
                  </Grid>
                ) : (
                  <Typography variant="body2" color="text.secondary">{t('tenants.plan.empty')}</Typography>
                )}
              </Box>

              <Divider />

              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                  <DeleteForeverIcon color="error" />
                  <Typography variant="subtitle1">{t('tenants.sections.deleteTenant')}</Typography>
                </Stack>
                <Alert severity="error" sx={{ mb: 2 }}>
                  {t('tenants.delete.warning')}
                </Alert>
                <Stack spacing={2} maxWidth={360}>
                  <TextField
                    label={t('tenants.delete.confirmSlug')}
                    value={deleteConfirm}
                    onChange={(e) => setDeleteConfirm(e.target.value)}
                    disabled={deleteMutation.isPending || isDeleted}
                    helperText={effectiveDetail ? t('tenants.delete.slugHelper', { slug: effectiveDetail.slug }) : ''}
                  />
                  <TextField
                    label={t('tenants.delete.reasonOptional')}
                    value={deleteReason}
                    onChange={(e) => setDeleteReason(e.target.value)}
                    disabled={deleteMutation.isPending || isDeleted}
                    multiline
                    minRows={2}
                  />
                  <Stack direction="row" spacing={1}>
                    <Button
                      variant="contained"
                      color="error"
                      onClick={() => {
                        if (!confirmMatches || !selectedId) return;
                        deleteMutation.mutate({ confirmSlug: deleteConfirm.trim(), reason: deleteReason ? deleteReason : null });
                      }}
                      disabled={deleteMutation.isPending || isDeleted || !selectedId || !confirmMatches}
                    >
                      {deleteMutation.isPending ? t('common:status.deleting') : t('tenants.actions.deleteTenant')}
                    </Button>
                    <Button onClick={() => { setDeleteConfirm(''); setDeleteReason(''); }} disabled={deleteMutation.isPending || isDeleted}>{t('tenants.actions.clear')}</Button>
                  </Stack>
                </Stack>
                {purgeReport && (
                  <Paper variant="outlined" sx={{ mt: 2, p: 2 }}>
                    <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('tenants.delete.summaryTitle')}</Typography>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('tenants.delete.columns.table')}</TableCell>
                          <TableCell align="right">{t('tenants.delete.columns.rowsDeleted')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {purgeReport.map((row) => (
                          <TableRow key={row.table}>
                            <TableCell>{row.table}</TableCell>
                            <TableCell align="right">{row.deleted}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Paper>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={handleCloseDetail}>{t('common:buttons.close')}</Button>
        </DialogActions>
      </Dialog>

      <KanapDialog
        open={markInternalOpen}
        title={t('tenants.internal.confirmTitle')}
        onClose={() => { if (!markInternalMutation.isPending) setMarkInternalOpen(false); }}
        onSave={() => markInternalMutation.mutate()}
        saveLabel={t('tenants.internal.confirm')}
        saveLoading={markInternalMutation.isPending}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2">{t('tenants.internal.confirmBody')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('tenants.internal.confirmNote')}</Typography>
        </Stack>
      </KanapDialog>
    </>
  );
}
