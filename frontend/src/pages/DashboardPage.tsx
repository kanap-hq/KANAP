import { useMemo } from 'react';
import { Box, Grid, Typography, Stack, Button, Skeleton, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../utils/statusColors';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/useLocale';
import DashboardTile from './workspace/tiles/DashboardTile';
import { AMOUNT_COLUMNS, AmountColumnKey, slotAmount, totalsToVersions, YearSlot, yearSlotLabel } from '../components/finance/amountColumns';

type ServerListResponse<T> = { items: T[]; total: number; page: number; limit: number };

function formatNumber(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '\u2014';
  const i = Math.round(n);
  return i.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

function formatCompact(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '\u2014';
  try {
    return new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  } catch {
    const abs = Math.abs(n);
    if (abs >= 1_000_000) return `${Math.round(n / 100_000) / 10}M`;
    if (abs >= 1_000) return `${Math.round(n / 100) / 10}k`;
    return String(Math.round(n));
  }
}

function formatThousandsK(v: any) {
  const n = Number(v ?? 0);
  if (!isFinite(n)) return '\u2014';
  const thousands = Math.round(n / 1000);
  const abs = Math.abs(thousands);
  const formatted = formatNumber(abs);
  const sign = thousands < 0 ? '-' : '';
  return `${sign}${formatted}k`;
}

function useOpexTotals() {
  return useQuery({
    queryKey: ['dashboard', 'opex-totals'],
    queryFn: async () => {
      const res = await api.get('/spend-items/summary/totals');
      return res.data as Record<string, number>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useCapexTotals() {
  return useQuery({
    queryKey: ['dashboard', 'capex-totals'],
    queryFn: async () => {
      const res = await api.get('/capex-items/summary/totals');
      return res.data as Record<string, number>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useMyTasksSummary(userId?: string | null) {
  return useQuery({
    enabled: !!userId,
    queryKey: ['dashboard', 'my-tasks', userId],
    queryFn: async () => {
      const filters = {
        status: { filterType: 'text', type: 'notContains', filter: 'done' },
        assignee_user_id: userId ? { filterType: 'text', type: 'equals', filter: userId } : undefined,
        due_date: { filterType: 'text', type: 'notBlank' },
      } as any;
      const params: Record<string, any> = {
        limit: 5,
        sort: 'due_date:ASC',
        filters: JSON.stringify(filters),
      };
      const res = await api.get<ServerListResponse<{ id: string; title: string | null; due_date: string | null }>>('/tasks', { params });
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

function useNextContractRenewal() {
  return useQuery({
    queryKey: ['dashboard', 'next-contract-renewal'],
    queryFn: async () => {
      const filters = {
        cancellation_deadline: { filterType: 'text', type: 'notBlank' },
      };
      const params: Record<string, any> = {
        limit: 10, // fetch a few and filter client-side to drop overdue
        sort: 'cancellation_deadline:ASC',
        filters: JSON.stringify(filters),
      };
      const res = await api.get<ServerListResponse<{ id: string; name: string; cancellation_deadline?: string }>>('/contracts', { params });
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

async function fetchCount(endpoint: string, filterModel: any): Promise<number> {
  const params: Record<string, any> = { limit: 1 };
  if (filterModel && Object.keys(filterModel).length > 0) params.filters = JSON.stringify(filterModel);
  const res = await api.get<ServerListResponse<any>>(endpoint, { params });
  return res.data?.total ?? 0;
}

function useHygieneCounts() {
  const queries = {
    noItOwner: useQuery({
      queryKey: ['dashboard', 'hygiene', 'noItOwner'],
      queryFn: () => fetchCount('/spend-items/summary', { owner_it_id: { filterType: 'text', type: 'blank' } }),
      staleTime: 2 * 60 * 1000,
    }),
    noBizOwner: useQuery({
      queryKey: ['dashboard', 'hygiene', 'noBizOwner'],
      queryFn: () => fetchCount('/spend-items/summary', { owner_business_id: { filterType: 'text', type: 'blank' } }),
      staleTime: 2 * 60 * 1000,
    }),
    noPayingCompany: useQuery({
      queryKey: ['dashboard', 'hygiene', 'noPayingCompany'],
      queryFn: () => fetchCount('/spend-items/summary', { paying_company_id: { filterType: 'text', type: 'blank' } }),
      staleTime: 2 * 60 * 1000,
    }),
    accountWarning: useQuery({
      queryKey: ['dashboard', 'hygiene', 'accountWarning'],
      queryFn: () => fetchCount('/spend-items/summary', { account_warning: { filterType: 'text', type: 'notBlank' } }),
      staleTime: 2 * 60 * 1000,
    }),
  } as const;

  const loading =
    queries.noItOwner.isLoading ||
    queries.noBizOwner.isLoading ||
    queries.noPayingCompany.isLoading ||
    queries.accountWarning.isLoading;
  const error =
    queries.noItOwner.error ||
    queries.noBizOwner.error ||
    queries.noPayingCompany.error ||
    queries.accountWarning.error;
  const counts = {
    noItOwner: queries.noItOwner.data ?? 0,
    noBizOwner: queries.noBizOwner.data ?? 0,
    noPayingCompany: queries.noPayingCompany.data ?? 0,
    accountWarning: queries.accountWarning.data ?? 0,
  };
  return { loading, error, counts };
}

// Recent OPEX updates
function useRecentOpexUpdates() {
  return useQuery({
    queryKey: ['dashboard', 'recent-opex'],
    queryFn: async () => {
      const params = { limit: 5, sort: 'updated_at:DESC' };
      const res = await api.get<ServerListResponse<{ id: string; product_name: string; updated_at?: string; created_at?: string }>>('/spend-items/summary', { params });
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

// Mini-reports: Top OPEX and Top increases
function getBudgetValueFromRow(row: any, year: 'y' | 'yMinus1' | 'yPlus1') {
  const slot = (row?.versions?.[year]) || {};
  const reporting = slot?.reporting || {};
  const totals = slot?.totals || {};
  const v = Number(reporting.budget ?? totals.budget ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function useTopOpexCurrentYear(limit: number = 5) {
  const Y = new Date().getFullYear();
  return useQuery({
    queryKey: ['dashboard', 'top-opex', Y, limit],
    queryFn: async () => {
      const params = { limit, sort: 'yBudget:DESC', years: [Y - 1, Y].join(',') } as Record<string, any>;
      const res = await api.get<ServerListResponse<any>>('/spend-items/summary', { params });
      const items = res.data.items || [];
      return items.map((row: any) => ({
        id: row.id,
        name: row.product_name || row.name || '\u2014',
        y: getBudgetValueFromRow(row, 'y'),
        yMinus1: getBudgetValueFromRow(row, 'yMinus1'),
      }));
    },
    staleTime: 60 * 1000,
  });
}

function useTopOpexIncrease(limit: number = 5) {
  const Y = new Date().getFullYear();
  return useQuery({
    queryKey: ['dashboard', 'top-opex-increase', Y, limit],
    queryFn: async () => {
      const params = { limit: 1000000, sort: 'created_at:DESC', years: [Y - 1, Y].join(',') } as Record<string, any>;
      const res = await api.get<ServerListResponse<any>>('/spend-items/summary', { params });
      const items = (res.data.items || []).map((row: any) => {
        const y = getBudgetValueFromRow(row, 'y');
        const yMinus1 = getBudgetValueFromRow(row, 'yMinus1');
        const delta = y - yMinus1;
        return { id: row.id, name: row.product_name || '\u2014', y, yMinus1, delta };
      });
      const sorted = items.sort((a, b) => b.delta - a.delta);
      return sorted.slice(0, limit);
    },
    staleTime: 60 * 1000,
  });
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { hasLevel, profile } = useAuth();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const Y = new Date().getFullYear();

  const mode = useTheme().palette.mode;
  const { data: opexTotals, isLoading: opexLoading } = useOpexTotals();
  const { data: capexTotals, isLoading: capexLoading } = useCapexTotals();
  const { data: myTasks, isLoading: tasksLoading } = useMyTasksSummary(profile?.id);
  const { data: nextContract, isLoading: contractsLoading } = useNextContractRenewal();
  const hygiene = useHygieneCounts();
  const { data: recentOpex } = useRecentOpexUpdates();
  const { data: topOpex } = useTopOpexCurrentYear(5);
  const { data: topIncreases } = useTopOpexIncrease(5);

  const openTasks = myTasks?.total ?? 0;
  const taskItems = myTasks?.items || [];

  const upcomingRenewals = useMemo(() => {
    const now = new Date();
    const items = (nextContract?.items || []).filter((c) => {
      const dateStr = c?.cancellation_deadline;
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }).slice(0, 5);
    return items;
  }, [nextContract]);

  // Budget snapshot: one row per year, every column read from the totals key of the same name.
  const snapshotSlots: readonly YearSlot[] = ['yMinus1', 'y', 'yPlus1'];
  const buildSnapshot = (totals: Record<string, unknown> | undefined) => {
    const versions = totalsToVersions(totals, snapshotSlots);
    const rows = snapshotSlots.map((slot) => ({
      slot,
      label: yearSlotLabel(t, slot, Y),
      values: Object.fromEntries(AMOUNT_COLUMNS.map((c) => [c.key, slotAmount(versions[slot], c.key)])) as Record<AmountColumnKey, number>,
    }));
    const columns = AMOUNT_COLUMNS.filter((c) => rows.some((r) => r.values[c.key] !== 0)).map((c) => c.key);
    return { rows, columns };
  };

  const opexSnapshot = buildSnapshot(opexTotals);
  const capexSnapshot = buildSnapshot(capexTotals);
  // Same labels as the budget tab of OPEX and CAPEX items.
  const snapshotColumnLabelKeys = Object.fromEntries(AMOUNT_COLUMNS.map((c) => [c.key, c.labelKey])) as Record<AmountColumnKey, string>;
  const unionCols = AMOUNT_COLUMNS.map((c) => c.key).filter((c) => opexSnapshot.columns.includes(c) || capexSnapshot.columns.includes(c));

  const SnapshotTable = ({ rows, columns }: { rows: Array<{ slot: YearSlot; label: string; values: Record<AmountColumnKey, number> }>; columns: ReadonlyArray<AmountColumnKey> }) => (
      <TableContainer>
        <Table size="small" sx={{ '& th, & td': { py: 0.75 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 120, fontWeight: 600 }} align="left">{t('labels.year')}</TableCell>
              {columns.map((c) => (
                <TableCell key={`h-${c}`} align="center" sx={{ fontWeight: 600, minWidth: 76 }}>
                  {t(snapshotColumnLabelKeys[c])}
                </TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.slot}>
                <TableCell align="left" sx={{ fontWeight: 500 }}>{r.label}</TableCell>
                {columns.map((c) => (
                  <TableCell key={`${r.slot}-${c}`} align="center" sx={{ minWidth: 76 }}>{formatThousandsK(r.values[c])}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <PageHeader title={t('dashboard.overview')} />
      <Grid container spacing={3}>
        {/* OPEX Snapshot */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="AccountBalanceWallet" title={t('dashboard.opexSnapshot')} action={<Button size="small" onClick={() => navigate('/ops/opex')}>{t('buttons.view')}</Button>}>
            {opexLoading ? (
              <Skeleton variant="rounded" width="100%" height={80} />
            ) : (
              opexSnapshot.columns.length === 0 || unionCols.length === 0 ? (
                <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
              ) : (
                <SnapshotTable rows={opexSnapshot.rows} columns={unionCols} />
              )
            )}
          </DashboardTile>
        </Grid>

        {/* CAPEX Snapshot */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="AccountBalance" title={t('dashboard.capexSnapshot')} action={<Button size="small" onClick={() => navigate('/ops/capex')}>{t('buttons.view')}</Button>}>
            {capexLoading ? (
              <Skeleton variant="rounded" width="100%" height={80} />
            ) : (
              capexSnapshot.columns.length === 0 || unionCols.length === 0 ? (
                <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
              ) : (
                <SnapshotTable rows={capexSnapshot.rows} columns={unionCols} />
              )
            )}
          </DashboardTile>
        </Grid>

        {/* My Tasks */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="Assignment" title={t('dashboard.myTasks')} isLoading={tasksLoading} action={<Button size="small" onClick={() => navigate('/portfolio/tasks')}>{t('buttons.viewAll')}</Button>}>
            <Typography variant="h5">{openTasks}</Typography>
            <Stack spacing={0.75} sx={{ mt: 1.5 }}>
              {taskItems.map((tk) => {
                const due = tk.due_date ? new Date(tk.due_date) : null;
                const today = new Date();
                const overdue = due ? due < new Date(today.getFullYear(), today.getMonth(), today.getDate()) : false;
                return (
                  <Stack key={tk.id} direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" sx={{ color: overdue ? getDotColor('error', mode) : 'text.secondary', fontWeight: 500, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{due ? new Date(due).toLocaleDateString(locale) : '\u2014'}</Typography>
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{tk.title || t('labels.task')}</Typography>
                  </Stack>
                );
              })}
              {(!tasksLoading && taskItems.length === 0) && (
                <Typography variant="body1" color="text.secondary">{t('dashboard.noTasksWithDueDate')}</Typography>
              )}
            </Stack>
          </DashboardTile>
        </Grid>

        {/* Next Contract Renewal */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="EventAvailable" title={t('dashboard.nextRenewals')} isLoading={contractsLoading} action={<Button size="small" onClick={() => navigate('/ops/contracts')}>{t('buttons.viewAll')}</Button>}>
            <Stack spacing={0.75}>
              {upcomingRenewals.map((r) => (
                <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                  <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{r.cancellation_deadline ? new Date(r.cancellation_deadline).toLocaleDateString(locale) : '\u2014'}</Typography>
                  <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                </Stack>
              ))}
              {upcomingRenewals.length === 0 && (
                <Typography variant="body1" color="text.secondary">{t('dashboard.noUpcomingRenewals')}</Typography>
              )}
            </Stack>
          </DashboardTile>
        </Grid>

        {/* Data Hygiene */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="ReportProblemOutlined" title={t('dashboard.dataHygieneOpex')} isLoading={hygiene.loading} action={<Button size="small" onClick={() => navigate('/ops/opex')}>{t('buttons.view')}</Button>}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
              <Typography variant="body2" sx={{ color: hygiene.counts.noItOwner ? getDotColor('warning', mode) : 'text.secondary', fontWeight: 500, cursor: 'pointer' }} onClick={() => navigate('/ops/opex')}>{t('dashboard.noItOwner', { count: hygiene.counts.noItOwner })}</Typography>
              <Typography variant="body2" sx={{ color: hygiene.counts.noBizOwner ? getDotColor('warning', mode) : 'text.secondary', fontWeight: 500, cursor: 'pointer' }} onClick={() => navigate('/ops/opex')}>{t('dashboard.noBizOwner', { count: hygiene.counts.noBizOwner })}</Typography>
              <Typography variant="body2" sx={{ color: hygiene.counts.noPayingCompany ? getDotColor('warning', mode) : 'text.secondary', fontWeight: 500, cursor: 'pointer' }} onClick={() => navigate('/ops/opex')}>{t('dashboard.noPayingCompany', { count: hygiene.counts.noPayingCompany })}</Typography>
              <Typography variant="body2" sx={{ color: hygiene.counts.accountWarning ? getDotColor('error', mode) : 'text.secondary', fontWeight: 500, cursor: 'pointer' }} onClick={() => navigate('/ops/opex')}>{t('dashboard.coaMismatches', { count: hygiene.counts.accountWarning })}</Typography>
            </Stack>
          </DashboardTile>
        </Grid>

        {/* Quick Actions */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="Assignment" title={t('dashboard.quickActions')}>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }} useFlexGap flexWrap="wrap">
                {hasLevel('opex', 'manager') && (
                  <Button variant="contained" size="small" onClick={() => navigate('/ops/opex/new')}>{t('dashboard.newOpex')}</Button>
                )}
                {hasLevel('capex', 'manager') && (
                  <Button variant="outlined" size="small" onClick={() => navigate('/ops/capex/new')}>{t('dashboard.newCapex')}</Button>
                )}
              </Stack>
              <Divider sx={{ my: 1 }} />
              <Typography variant="subtitle2">{t('dashboard.recentOpexUpdates')}</Typography>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {(recentOpex?.items || []).map((r) => (
                  <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{new Date((r.updated_at || r.created_at || '')).toLocaleDateString(locale)}</Typography>
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.product_name}</Typography>
                  </Stack>
                ))}
                {(recentOpex?.items?.length || 0) === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('dashboard.noRecentUpdates')}</Typography>
                )}
            </Stack>
          </DashboardTile>
        </Grid>

        {/* Insights — Top OPEX */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="Leaderboard" title={t('dashboard.topOpexY')} action={<Button size="small" onClick={() => navigate('/ops/reports/top-opex')}>{t('buttons.open')}</Button>}>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {(topOpex || []).map((r) => (
                <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                  <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                  <Typography variant="body1" sx={{ minWidth: 90, textAlign: 'right' }}>{formatThousandsK(r.y)}</Typography>
                </Stack>
              ))}
              {(topOpex?.length || 0) === 0 && (
                <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
              )}
            </Stack>
          </DashboardTile>
        </Grid>

        {/* Insights — Top increases */}
        <Grid item xs={12} md={6} lg={4}>
          <DashboardTile icon="TrendingUp" title={t('dashboard.topIncreasesYvsYminus1')} action={<Button size="small" onClick={() => navigate('/ops/reports/opex-delta')}>{t('buttons.open')}</Button>}>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {(topIncreases || []).map((r) => (
                <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                  <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                  <Typography variant="body1" sx={{ minWidth: 90, textAlign: 'right' }}>+{formatThousandsK(Math.abs(r.delta))}</Typography>
                </Stack>
              ))}
              {(topIncreases?.length || 0) === 0 && (
                <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
              )}
            </Stack>
          </DashboardTile>
        </Grid>
      </Grid>
    </Box>
  );
}
