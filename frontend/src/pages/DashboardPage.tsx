import { Fragment, useCallback, useMemo, useState } from 'react';
import { Box, Grid, Typography, Stack, Button, Skeleton, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../utils/statusColors';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { useLocale } from '../i18n/useLocale';
import DashboardTile from './workspace/tiles/DashboardTile';
import { AMOUNT_COLUMNS, AmountColumnKey, slotAmount, totalsToVersions, YearSlot, yearSlotLabel } from '../components/finance/amountColumns';
import type { BudgetScope } from '../services/budgetOperations';
import { buildItemPath, formatItemRef } from '../utils/item-ref';
import ItemScopeTabs, { useDefaultBudgetScope } from './operations/ItemScopeTabs';
import { BudgetSummaryRow, itemName, SUMMARY_ENDPOINT, useBudgetSummaryAll } from './reports/useBudgetSummaryAll';

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

function useOpexTotals(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'opex-totals'],
    enabled,
    queryFn: async () => {
      const res = await api.get('/spend-items/summary/totals');
      return res.data as Record<string, number>;
    },
    staleTime: 5 * 60 * 1000,
  });
}

function useCapexTotals(enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'capex-totals'],
    enabled,
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

const HYGIENE_CHECKS = [
  { key: 'noItOwner', tone: 'warning', filter: { owner_it_id: { filterType: 'text', type: 'blank' } } },
  { key: 'noBusinessOwner', tone: 'warning', filter: { owner_business_id: { filterType: 'text', type: 'blank' } } },
  { key: 'noPayingCompany', tone: 'warning', filter: { paying_company_id: { filterType: 'text', type: 'blank' } } },
  { key: 'accountOutsideChart', tone: 'error', filter: { account_warning: { filterType: 'text', type: 'notBlank' } } },
] as const;
type HygieneKey = (typeof HYGIENE_CHECKS)[number]['key'];

function useHygieneCounts(scope: BudgetScope, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'hygiene', scope],
    enabled,
    queryFn: async () => {
      const counts = await Promise.all(HYGIENE_CHECKS.map((check) => fetchCount(SUMMARY_ENDPOINT[scope], check.filter)));
      return Object.fromEntries(HYGIENE_CHECKS.map((check, i) => [check.key, counts[i]])) as Record<HygieneKey, number>;
    },
    staleTime: 2 * 60 * 1000,
  });
}

type RecentUpdate = { scope: BudgetScope; id: string; ref: string; name: string; at: string | null };

function useRecentUpdates(scope: BudgetScope, enabled: boolean) {
  return useQuery({
    queryKey: ['dashboard', 'recent-updates', scope],
    enabled,
    queryFn: async (): Promise<RecentUpdate[]> => {
      const params = { limit: 5, sort: 'updated_at:DESC' };
      const res = await api.get<ServerListResponse<BudgetSummaryRow>>(SUMMARY_ENDPOINT[scope], { params });
      return (res.data.items || []).map((row) => ({
        scope,
        id: row.id,
        ref: row.item_number != null ? formatItemRef(scope, row.item_number) : row.id,
        name: itemName(scope, row),
        at: row.updated_at || row.created_at || null,
      }));
    },
    staleTime: 60 * 1000,
  });
}

// Mini-reports: top items and top increases
function getBudgetValueFromRow(row: any, year: 'y' | 'yMinus1' | 'yPlus1') {
  const slot = (row?.versions?.[year]) || {};
  const reporting = slot?.reporting || {};
  const totals = slot?.totals || {};
  const v = Number(reporting.budget ?? totals.budget ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function useTopItemsCurrentYear(scope: BudgetScope, enabled: boolean, limit: number = 5) {
  const Y = new Date().getFullYear();
  return useQuery({
    queryKey: ['dashboard', 'top-items', scope, Y, limit],
    enabled,
    queryFn: async () => {
      const params = { limit, sort: 'yBudget:DESC', years: [Y - 1, Y].join(',') } as Record<string, any>;
      const res = await api.get<ServerListResponse<BudgetSummaryRow>>(SUMMARY_ENDPOINT[scope], { params });
      const items = res.data.items || [];
      return items.map((row) => ({
        id: row.id,
        name: itemName(scope, row) || '\u2014',
        y: getBudgetValueFromRow(row, 'y'),
        yMinus1: getBudgetValueFromRow(row, 'yMinus1'),
      }));
    },
    staleTime: 60 * 1000,
  });
}

/** Lines whose budget grew from Y-1 to Y, largest first, computed over every line of the type. */
function useTopIncreases(scope: BudgetScope, enabled: boolean, limit: number = 5) {
  // No years: the fixed Y-1 and Y slots are always there, and the reports use the same cache entry.
  const query = useBudgetSummaryAll(scope, undefined, { enabled });
  const items = useMemo(() => (query.data ?? [])
    .map((row) => {
      const y = getBudgetValueFromRow(row, 'y');
      const yMinus1 = getBudgetValueFromRow(row, 'yMinus1');
      return { id: row.id, name: itemName(scope, row) || '\u2014', y, yMinus1, delta: y - yMinus1 };
    })
    .filter((row) => row.delta > 0)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, limit), [query.data, scope, limit]);
  return { items, isLoading: enabled && query.isLoading };
}

/** OPEX / CAPEX choice of a dashboard tile, remembered per tile; a type the user cannot read falls back to the default. */
function useTileScope(tile: string): [BudgetScope, (next: BudgetScope) => void] {
  const { hasLevel } = useAuth();
  const fallback = useDefaultBudgetScope();
  const storageKey = `kanap.dashboard.${tile}.scope`;
  const [stored, setStored] = useState<BudgetScope | null>(() => {
    try {
      const value = window.localStorage.getItem(storageKey);
      return value === 'opex' || value === 'capex' ? value : null;
    } catch {
      return null;
    }
  });
  const scope = stored && hasLevel(stored, 'reader') ? stored : fallback;
  const setScope = useCallback((next: BudgetScope) => {
    setStored(next);
    try {
      window.localStorage.setItem(storageKey, next);
    } catch {
      // Remembering the choice is a convenience; the tile works without storage.
    }
  }, [storageKey]);
  return [scope, setScope];
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const { hasLevel, profile } = useAuth();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const Y = new Date().getFullYear();

  const mode = useTheme().palette.mode;
  const canOpex = hasLevel('opex', 'reader');
  const canCapex = hasLevel('capex', 'reader');
  const { data: opexTotals, isLoading: opexLoading } = useOpexTotals(canOpex);
  const { data: capexTotals, isLoading: capexLoading } = useCapexTotals(canCapex);
  const { data: myTasks, isLoading: tasksLoading } = useMyTasksSummary(profile?.id);
  const { data: nextContract, isLoading: contractsLoading } = useNextContractRenewal();
  const readableScopes = (['opex', 'capex'] as const).filter((scope) => (scope === 'opex' ? canOpex : canCapex));
  const scopeLabel = (scope: BudgetScope) => t(`ops:operations.scope.${scope}`);

  const hygieneByScope = {
    opex: useHygieneCounts('opex', canOpex),
    capex: useHygieneCounts('capex', canCapex),
  };
  const hygieneLoading = readableScopes.some((scope) => hygieneByScope[scope].isLoading);
  const hygieneError = readableScopes.some((scope) => hygieneByScope[scope].isError);

  const recentOpex = useRecentUpdates('opex', canOpex);
  const recentCapex = useRecentUpdates('capex', canCapex);
  const recentUpdates = useMemo(() => [...(recentOpex.data ?? []), ...(recentCapex.data ?? [])]
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, 5), [recentOpex.data, recentCapex.data]);

  const [topScope, setTopScope] = useTileScope('topItems');
  const { data: topItems, isLoading: topLoading } = useTopItemsCurrentYear(topScope, readableScopes.length > 0, 5);
  const [increaseScope, setIncreaseScope] = useTileScope('topIncreases');
  const { items: topIncreases, isLoading: increasesLoading } = useTopIncreases(increaseScope, readableScopes.length > 0, 5);

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
        {/* OPEX snapshot, for users who read OPEX */}
        {canOpex && (
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
        )}

        {/* CAPEX snapshot, for users who read CAPEX */}
        {canCapex && (
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
        )}

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

        {/* Data hygiene: the same four checks for each type the user reads */}
        {readableScopes.length > 0 && (
          <Grid item xs={12} md={6} lg={4}>
            <DashboardTile
              icon="ReportProblemOutlined"
              title={t('dashboard.dataHygiene')}
              isLoading={hygieneLoading}
              isError={hygieneError}
              onRetry={() => readableScopes.forEach((scope) => { void hygieneByScope[scope].refetch(); })}
            >
              <Box sx={{ display: 'grid', gridTemplateColumns: `1fr repeat(${readableScopes.length}, 56px)`, columnGap: 1, rowGap: 0.5, alignItems: 'baseline', mt: 1 }}>
                <span />
                {readableScopes.map((scope) => (
                  <Typography key={scope} sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', textAlign: 'right' }}>{scopeLabel(scope)}</Typography>
                ))}
                {HYGIENE_CHECKS.map((check) => (
                  <Fragment key={check.key}>
                    <Typography variant="body2">{t(`dashboard.hygiene.${check.key}`)}</Typography>
                    {readableScopes.map((scope) => {
                      const count = hygieneByScope[scope].data?.[check.key] ?? 0;
                      return (
                        <Typography
                          key={scope}
                          component={RouterLink}
                          to={`/ops/${scope}`}
                          variant="body2"
                          aria-label={`${t(`dashboard.hygiene.${check.key}`)}, ${scopeLabel(scope)}: ${count}`}
                          sx={{ textAlign: 'right', fontWeight: 500, textDecoration: 'none', color: count ? getDotColor(check.tone, mode) : 'text.secondary' }}
                        >
                          {count}
                        </Typography>
                      );
                    })}
                  </Fragment>
                ))}
              </Box>
            </DashboardTile>
          </Grid>
        )}

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
              {readableScopes.length > 0 && (
                <>
                  <Divider sx={{ my: 1 }} />
                  <Typography variant="subtitle2">{t('dashboard.recentUpdates')}</Typography>
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    {recentUpdates.map((r) => (
                      <Stack
                        key={`${r.scope}-${r.id}`}
                        component={RouterLink}
                        to={buildItemPath(r.scope, r.ref)}
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        sx={{ color: 'inherit', textDecoration: 'none', borderRadius: '5px', mx: -0.5, px: 0.5, '&:hover': { bgcolor: 'kanap.bg.hover' } }}
                      >
                        <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{r.at ? new Date(r.at).toLocaleDateString(locale) : '\u2014'}</Typography>
                        <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', whiteSpace: 'nowrap' }}>{scopeLabel(r.scope)}</Typography>
                      </Stack>
                    ))}
                    {recentUpdates.length === 0 && (
                      <Typography variant="body1" color="text.secondary">{t('dashboard.noRecentUpdates')}</Typography>
                    )}
                  </Stack>
                </>
              )}
          </DashboardTile>
        </Grid>

        {/* Insights: top items and top increases, OPEX or CAPEX per tile */}
        {readableScopes.length > 0 && (
          <Grid item xs={12} md={6} lg={4}>
            <DashboardTile
              icon="Leaderboard"
              title={t('dashboard.topItemsY')}
              isLoading={topLoading}
              action={(
                <Stack direction="row" alignItems="center">
                  <ItemScopeTabs value={topScope} onChange={setTopScope} />
                  <Button size="small" onClick={() => navigate(`/ops/reports/top-opex?scope=${topScope}`)}>{t('buttons.open')}</Button>
                </Stack>
              )}
            >
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {(topItems || []).map((r) => (
                  <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                    <Typography variant="body1" sx={{ minWidth: 90, textAlign: 'right' }}>{formatThousandsK(r.y)}</Typography>
                  </Stack>
                ))}
                {(topItems?.length || 0) === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
                )}
              </Stack>
            </DashboardTile>
          </Grid>
        )}

        {readableScopes.length > 0 && (
          <Grid item xs={12} md={6} lg={4}>
            <DashboardTile
              icon="TrendingUp"
              title={t('dashboard.topIncreasesYvsYminus1')}
              isLoading={increasesLoading}
              action={(
                <Stack direction="row" alignItems="center">
                  <ItemScopeTabs value={increaseScope} onChange={setIncreaseScope} />
                  <Button size="small" onClick={() => navigate(`/ops/reports/opex-delta?scope=${increaseScope}`)}>{t('buttons.open')}</Button>
                </Stack>
              )}
            >
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {topIncreases.map((r) => (
                  <Stack key={r.id} direction="row" spacing={1} alignItems="center">
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                    <Typography variant="body1" sx={{ minWidth: 90, textAlign: 'right' }}>+{formatCompact(r.delta)}</Typography>
                  </Stack>
                ))}
                {topIncreases.length === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('dashboard.noIncreases')}</Typography>
                )}
              </Stack>
            </DashboardTile>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
