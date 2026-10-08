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
import { AmountColumnKey, slotAmount, totalsToVersions, YearSlot, yearSlotLabel } from '../components/finance/amountColumns';
import { useBudgetColumns } from '../hooks/useBudgetColumns';
import type { BudgetScope } from '../services/budgetOperations';
import { buildItemPath, formatItemRef } from '../utils/item-ref';
import ItemScopeTabs, { useDefaultBudgetScope } from './operations/ItemScopeTabs';
import { BudgetSummaryRow, itemName, SUMMARY_ENDPOINT } from './reports/useReportScope';
import {
  type ColumnFilters,
  costCenterTotalsRequest,
  countRequest,
  keepValues,
  lineTotalRequest,
  nextYearField,
  readCostCenterTotals,
  readLineTotal,
  readTopIncreases,
  topIncreasesRequest,
} from './reports/reportAggregates';
import { ACTIVE_TASK_STATUSES } from './tasks/task.constants';
import { useBudgetAggregate, useBudgetAggregates } from './reports/useBudgetAggregate';

type ServerListResponse<T> = { items: T[]; total: number; page: number; limit: number };

/** A tile row that opens what it names: neutral text, the hover background only. */
const ROW_LINK_SX = { color: 'inherit', textDecoration: 'none', borderRadius: '5px', mx: -0.5, px: 0.5, '&:hover': { bgcolor: 'kanap.bg.hover' } } as const;

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

type MyTask = { id: string; item_number: number | null; title: string | null; due_date: string | null };

/**
 * The open tasks assigned to the user: their count (`total`) and the next five by due date. The
 * list sorts a missing due date last (PostgreSQL's default for an ascending sort), so the tasks
 * with a due date come first.
 */
function useMyTasksSummary(userId: string | null | undefined, enabled: boolean) {
  return useQuery({
    enabled: enabled && !!userId,
    queryKey: ['dashboard', 'my-tasks', userId],
    queryFn: async () => {
      const params: Record<string, any> = {
        limit: 5,
        sort: 'due_date:ASC',
        assigneeUserId: userId,
        filters: JSON.stringify({ status: { filterType: 'set', values: ACTIVE_TASK_STATUSES } }),
      };
      const res = await api.get<ServerListResponse<MyTask>>('/tasks', { params });
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

/** Today as `YYYY-MM-DD`, in the user's time zone. */
function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** The five contracts whose cancellation deadline comes next, today included (the server filters and sorts). */
function useNextContractRenewal(enabled: boolean) {
  const today = localToday();
  return useQuery({
    queryKey: ['dashboard', 'next-contract-renewal', today],
    enabled,
    queryFn: async () => {
      const filters = {
        cancellation_deadline: { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: today },
      };
      const params: Record<string, any> = {
        limit: 5,
        sort: 'cancellation_deadline:ASC',
        filters: JSON.stringify(filters),
      };
      const res = await api.get<ServerListResponse<{ id: string; name: string; cancellation_deadline?: string }>>('/contracts', { params });
      return res.data;
    },
    staleTime: 60 * 1000,
  });
}

/**
 * The hygiene checks. One filter, keyed by column ids of the OPEX and CAPEX lists, drives both the
 * count and the link to the list, so the number on the tile is the number of rows the list shows.
 */
type HygieneKey = 'noItOwner' | 'noBusinessOwner' | 'noPayingCompany' | 'noCostCenter' | 'noBudgetNextYear' | 'accountOutsideChart';
type HygieneCheck = { key: HygieneKey; tone: 'warning' | 'error'; filter: ColumnFilters };

/**
 * Next year's default column is zero: a line without a version that year reads 0 (an amount is
 * never blank), so one number condition covers "no amount" and "zero".
 */
const ZERO_AMOUNT = { filterType: 'number', type: 'equals', filter: 0 };

function hygieneChecks(metric: AmountColumnKey): HygieneCheck[] {
  return [
    { key: 'noItOwner', tone: 'warning', filter: { owner_it_name: keepValues([null]) } },
    { key: 'noBusinessOwner', tone: 'warning', filter: { owner_business_name: keepValues([null]) } },
    { key: 'noPayingCompany', tone: 'warning', filter: { paying_company_name: keepValues([null]) } },
    { key: 'noCostCenter', tone: 'warning', filter: { cost_center_label: keepValues([null]) } },
    { key: 'noBudgetNextYear', tone: 'warning', filter: { [nextYearField(metric)]: ZERO_AMOUNT } },
    { key: 'accountOutsideChart', tone: 'error', filter: { account_warning: keepValues(['coa_mismatch']) } },
  ];
}

/** The OPEX or CAPEX list opened on exactly these filters (the list restores no stored search over them). */
function listHref(scope: BudgetScope, filters: ColumnFilters): string {
  return `/ops/${scope}?${new URLSearchParams({ filters: JSON.stringify(filters) }).toString()}`;
}

/** The hygiene counts of one type: Enabled lines (not ended before 1 January, the list's default) passing each check, no row built. */
function useHygieneCounts(scope: BudgetScope, checks: readonly HygieneCheck[] | null, enabled: boolean) {
  // The lines the list shows by default: Enabled, not ended before 1 January of this year.
  const requests = useMemo(() => (checks ? checks.map((check) => countRequest(check.filter, 'enabled')) : null), [checks]);
  const counts = useBudgetAggregates(scope, requests, { enabled });
  const data = useMemo(
    () => (counts.data && checks ? Object.fromEntries(checks.map((check, i) => [check.key, counts.data![i].total.count])) as Record<HygieneKey, number> : undefined),
    [counts.data, checks],
  );
  return { data, isLoading: enabled && (counts.isLoading || !checks), isError: counts.isError, refetch: counts.refetch };
}

type MyBudgetRole = 'itOwner' | 'businessOwner' | 'budgetHolder';
type ProfileName = { email?: string | null; first_name?: string | null; last_name?: string | null } | null | undefined;

/**
 * The user's name as the lists show it in the owner columns (server `displayNameSql`): first and
 * last names trimmed, joined by one space, else the email.
 */
function ownerDisplayName(profile: ProfileName): string {
  return [profile?.first_name?.trim(), profile?.last_name?.trim()].filter(Boolean).join(' ') || profile?.email || '';
}

/**
 * The user's name as the lists show it in the budget holder column (the cost center tree's
 * `owner_name`: `TRIM(CONCAT(first, ' ', last))`, PostgreSQL trimming spaces only), else the email.
 */
function holderDisplayName(profile: ProfileName): string {
  return `${profile?.first_name ?? ''} ${profile?.last_name ?? ''}`.replace(/^ +| +$/g, '') || profile?.email || '';
}

/** One filter per role, on the list's name columns: the link opens the list on the same filter. */
function myBudgetFilters(profile: ProfileName): Array<{ role: MyBudgetRole; filter: ColumnFilters }> | null {
  const owner = ownerDisplayName(profile);
  const holder = holderDisplayName(profile);
  if (!owner || !holder) return null;
  return [
    { role: 'itOwner', filter: { owner_it_name: keepValues([owner]) } },
    { role: 'businessOwner', filter: { owner_business_name: keepValues([owner]) } },
    { role: 'budgetHolder', filter: { budget_holder_name: keepValues([holder]) } },
  ];
}

/** Per role: the Enabled lines (not ended before 1 January) in the user's name and their sum of this year's default column. */
function useMyBudget(scope: BudgetScope, profile: ProfileName, metric: AmountColumnKey, enabled: boolean) {
  const roles = useMemo(() => myBudgetFilters(profile), [profile]);
  const requests = useMemo(() => (roles ? roles.map((role) => lineTotalRequest(role.filter, metric)) : null), [roles, metric]);
  const query = useBudgetAggregates(scope, requests, { enabled });
  const rows = useMemo(
    () => (roles && query.data ? roles.map((role, i) => ({ ...role, ...readLineTotal(query.data![i]) })) : []),
    [roles, query.data],
  );
  return { rows, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

/** This year's default column by cost center, the five largest (lines without one in the ranking too). */
function useCostCenterTotals(scope: BudgetScope, metric: AmountColumnKey, enabled: boolean) {
  const request = useMemo(() => costCenterTotalsRequest(metric, 5), [metric]);
  const query = useBudgetAggregate(scope, request, { enabled });
  const rows = useMemo(() => readCostCenterTotals(query.data), [query.data]);
  return { rows, isLoading: enabled && query.isLoading, isError: query.isError, refetch: query.refetch };
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

// Mini-reports: top items and top increases, both on the tenant's default column.
function getColumnValueFromRow(row: any, year: 'y' | 'yMinus1' | 'yPlus1', column: AmountColumnKey) {
  const slot = (row?.versions?.[year]) || {};
  const reporting = slot?.reporting || {};
  const totals = slot?.totals || {};
  const v = Number(reporting[column] ?? totals[column] ?? 0);
  return Number.isFinite(v) ? v : 0;
}

function useTopItemsCurrentYear(scope: BudgetScope, enabled: boolean, column: AmountColumnKey, sort: string, limit: number = 5) {
  const Y = new Date().getFullYear();
  return useQuery({
    queryKey: ['dashboard', 'top-items', scope, Y, column, limit],
    enabled,
    queryFn: async () => {
      const params = { limit, sort, years: [Y - 1, Y].join(',') } as Record<string, any>;
      const res = await api.get<ServerListResponse<BudgetSummaryRow>>(SUMMARY_ENDPOINT[scope], { params });
      const items = res.data.items || [];
      return items.map((row) => ({
        id: row.id,
        path: buildItemPath(scope, row.item_number != null ? formatItemRef(scope, row.item_number) : row.id),
        name: itemName(scope, row) || '\u2014',
        y: getColumnValueFromRow(row, 'y', column),
        yMinus1: getColumnValueFromRow(row, 'yMinus1', column),
      }));
    },
    staleTime: 60 * 1000,
  });
}

/** Lines whose default column grew from Y-1 to Y, largest first, over every line of the type's window (one aggregate). */
function useTopIncreases(scope: BudgetScope, enabled: boolean, column: AmountColumnKey, columnReady: boolean, limit: number = 5) {
  const request = useMemo(() => (columnReady ? topIncreasesRequest(scope, column, limit) : null), [scope, column, columnReady, limit]);
  const query = useBudgetAggregate(scope, request, { enabled });
  const items = useMemo(() => readTopIncreases(query.data).map((row) => ({
    ...row,
    name: row.name || '\u2014',
    // The line's reference; its id only when it has none (the page opens either).
    path: buildItemPath(scope, row.itemNumber != null ? formatItemRef(scope, row.itemNumber) : row.id),
  })), [query.data, scope]);
  return { items, isLoading: enabled && (query.isLoading || !columnReady) };
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
  const canTasks = hasLevel('tasks', 'reader');
  const canContracts = hasLevel('contracts', 'reader');
  const { data: myTasks, isLoading: tasksLoading } = useMyTasksSummary(profile?.id, canTasks);
  const { data: nextContract, isLoading: contractsLoading } = useNextContractRenewal(canContracts);
  const readableScopes = (['opex', 'capex'] as const).filter((scope) => (scope === 'opex' ? canOpex : canCapex));
  const scopeLabel = (scope: BudgetScope) => t(`ops:operations.scope.${scope}`);
  const budgetColumns = useBudgetColumns();
  const defaultColumn = budgetColumns.defaultColumn;

  // Next year's check names the default column: the checks wait for the setting.
  const checks = useMemo(() => (budgetColumns.ready ? hygieneChecks(defaultColumn.key) : null), [budgetColumns.ready, defaultColumn.key]);
  const hygieneByScope = {
    opex: useHygieneCounts('opex', checks, canOpex),
    capex: useHygieneCounts('capex', checks, canCapex),
  };
  const hygieneLoading = readableScopes.some((scope) => hygieneByScope[scope].isLoading);
  const hygieneError = readableScopes.some((scope) => hygieneByScope[scope].isError);

  const recentOpex = useRecentUpdates('opex', canOpex);
  const recentCapex = useRecentUpdates('capex', canCapex);
  const recentUpdates = useMemo(() => [...(recentOpex.data ?? []), ...(recentCapex.data ?? [])]
    .sort((a, b) => (b.at ?? '').localeCompare(a.at ?? ''))
    .slice(0, 5), [recentOpex.data, recentCapex.data]);

  const [topScope, setTopScope] = useTileScope('topItems');
  // Both tiles wait for the default column so the list is not fetched twice.
  const { data: topItems, isLoading: topQueryLoading } = useTopItemsCurrentYear(
    topScope,
    readableScopes.length > 0 && budgetColumns.ready,
    defaultColumn.key,
    budgetColumns.defaultSort,
    5,
  );
  const topLoading = topQueryLoading || (readableScopes.length > 0 && !budgetColumns.ready);
  const [increaseScope, setIncreaseScope] = useTileScope('topIncreases');
  const { items: topIncreases, isLoading: increasesLoading } = useTopIncreases(increaseScope, readableScopes.length > 0, defaultColumn.key, budgetColumns.ready, 5);

  const [myBudgetScope, setMyBudgetScope] = useTileScope('myBudget');
  const myBudget = useMyBudget(myBudgetScope, profile, defaultColumn.key, readableScopes.length > 0 && budgetColumns.ready);
  const myBudgetLoading = myBudget.isLoading || (readableScopes.length > 0 && !budgetColumns.ready);
  const [costCenterScope, setCostCenterScope] = useTileScope('byCostCenter');
  const costCenters = useCostCenterTotals(costCenterScope, defaultColumn.key, readableScopes.length > 0 && budgetColumns.ready);
  const costCentersLoading = costCenters.isLoading || (readableScopes.length > 0 && !budgetColumns.ready);
  const largestCostCenter = Math.max(0, ...costCenters.rows.map((r) => r.value));

  const openTasks = myTasks?.total ?? 0;
  const taskItems = myTasks?.items || [];

  const upcomingRenewals = nextContract?.items || [];

  // Budget snapshot: one row per year, every shown column read from the totals key of the same name.
  const snapshotSlots: readonly YearSlot[] = ['yMinus1', 'y', 'yPlus1'];
  const buildSnapshot = (totals: Record<string, unknown> | undefined) => {
    const versions = totalsToVersions(totals, snapshotSlots);
    const rows = snapshotSlots.map((slot) => ({
      slot,
      label: yearSlotLabel(t, slot, Y),
      values: Object.fromEntries(budgetColumns.shown.map((c) => [c.key, slotAmount(versions[slot], c.key)])) as Record<AmountColumnKey, number>,
    }));
    const columns = budgetColumns.shown.filter((c) => rows.some((r) => r.values[c.key] !== 0)).map((c) => c.key);
    return { rows, columns };
  };

  const opexSnapshot = buildSnapshot(opexTotals);
  const capexSnapshot = buildSnapshot(capexTotals);
  // Tenant names, the same as the lists and the budget tab.
  const snapshotColumnLabels = Object.fromEntries(budgetColumns.shown.map((c) => [c.key, c.label])) as Record<AmountColumnKey, string>;
  const unionCols = budgetColumns.shown.map((c) => c.key).filter((c) => opexSnapshot.columns.includes(c) || capexSnapshot.columns.includes(c));

  const SnapshotTable = ({ rows, columns }: { rows: Array<{ slot: YearSlot; label: string; values: Record<AmountColumnKey, number> }>; columns: ReadonlyArray<AmountColumnKey> }) => (
      <TableContainer>
        <Table size="small" sx={{ '& th, & td': { py: 0.75 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: 120, fontWeight: 500 }} align="left">{t('labels.year')}</TableCell>
              {columns.map((c) => (
                <TableCell key={`h-${c}`} align="center" sx={{ fontWeight: 500, minWidth: 76 }}>
                  {snapshotColumnLabels[c]}
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

        {/* My budget: the lines in the user's name, per role, each opening the list on that role */}
        {readableScopes.length > 0 && (
          <Grid item xs={12} md={6} lg={4}>
            <DashboardTile
              icon="VerifiedUser"
              title={t('dashboard.myBudget.title', { column: defaultColumn.label })}
              isLoading={myBudgetLoading}
              isError={myBudget.isError}
              onRetry={myBudget.refetch}
              action={<ItemScopeTabs value={myBudgetScope} onChange={setMyBudgetScope} />}
            >
              {myBudget.rows.every((r) => r.count === 0) ? (
                <Typography variant="body1" color="text.secondary" sx={{ mt: 1 }}>{t('dashboard.myBudget.none')}</Typography>
              ) : (
                <Stack spacing={0.5} sx={{ mt: 1 }}>
                  {myBudget.rows.map((r) => {
                    const label = t(`dashboard.myBudget.roles.${r.role}`);
                    const lines = t('dashboard.myBudget.lineCount', { count: r.count });
                    const cells = (
                      <>
                        <Typography variant="body1" noWrap sx={{ flex: 1, color: 'inherit' }}>{label}</Typography>
                        <Typography variant="body2" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>{lines}</Typography>
                        <Typography variant="body1" sx={{ minWidth: 72, textAlign: 'right', color: 'inherit' }}>{formatThousandsK(r.value)}</Typography>
                      </>
                    );
                    // No line in that role: plain text, nothing to open.
                    return r.count ? (
                      <Stack key={r.role} component={RouterLink} to={listHref(myBudgetScope, r.filter)} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
                        {cells}
                      </Stack>
                    ) : (
                      <Stack key={r.role} direction="row" spacing={1} alignItems="center" sx={{ color: 'text.secondary', mx: -0.5, px: 0.5 }}>
                        {cells}
                      </Stack>
                    );
                  })}
                </Stack>
              )}
            </DashboardTile>
          </Grid>
        )}

        {/* My tasks: the open tasks assigned to the user, the next ones by due date */}
        {canTasks && (
          <Grid item xs={12} md={6} lg={4}>
            <DashboardTile icon="Assignment" title={t('dashboard.myTasks')} isLoading={tasksLoading} action={<Button size="small" onClick={() => navigate('/portfolio/tasks?taskScope=my')}>{t('buttons.viewAll')}</Button>}>
              <Typography variant="h5">{openTasks}</Typography>
              <Stack spacing={0.5} sx={{ mt: 1.5 }}>
                {taskItems.map((tk) => {
                  const due = tk.due_date ? new Date(tk.due_date) : null;
                  const today = new Date();
                  const overdue = due ? due < new Date(today.getFullYear(), today.getMonth(), today.getDate()) : false;
                  return (
                    <Stack
                      key={tk.id}
                      component={RouterLink}
                      to={buildItemPath('task', tk.item_number != null ? formatItemRef('task', tk.item_number) : tk.id)}
                      direction="row"
                      spacing={1}
                      alignItems="center"
                      sx={ROW_LINK_SX}
                    >
                      <Typography variant="body2" sx={{ color: overdue ? getDotColor('error', mode) : 'text.secondary', fontWeight: 500, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{due ? due.toLocaleDateString(locale) : '\u2014'}</Typography>
                      <Typography variant="body1" noWrap sx={{ flex: 1 }}>{tk.title || t('labels.task')}</Typography>
                    </Stack>
                  );
                })}
                {(!tasksLoading && taskItems.length === 0) && (
                  <Typography variant="body1" color="text.secondary">{t('dashboard.tiles.noTasksAssigned')}</Typography>
                )}
              </Stack>
            </DashboardTile>
          </Grid>
        )}

        {/* Next contract renewals */}
        {canContracts && (
          <Grid item xs={12} md={6} lg={4}>
            <DashboardTile icon="EventAvailable" title={t('dashboard.nextRenewals')} isLoading={contractsLoading} action={<Button size="small" onClick={() => navigate('/ops/contracts')}>{t('buttons.viewAll')}</Button>}>
              <Stack spacing={0.5}>
                {upcomingRenewals.map((r) => (
                  <Stack key={r.id} component={RouterLink} to={`/ops/contracts/${r.id}/overview`} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
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
        )}

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
                {(checks ?? []).map((check) => {
                  // Next year's check names the tenant's default column.
                  const name = check.key === 'noBudgetNextYear'
                    ? t('dashboard.hygiene.noBudgetNextYear', { column: defaultColumn.label })
                    : t(`dashboard.hygiene.${check.key}`);
                  return (
                    <Fragment key={check.key}>
                      <Typography variant="body2">{name}</Typography>
                      {readableScopes.map((scope) => {
                        const count = hygieneByScope[scope].data?.[check.key] ?? 0;
                        const label = `${name}, ${scopeLabel(scope)}: ${count}`;
                        // A count opens the list filtered to exactly the lines it counts; none, nothing to open.
                        return count ? (
                          <Typography
                            key={scope}
                            component={RouterLink}
                            to={listHref(scope, check.filter)}
                            variant="body2"
                            aria-label={label}
                            sx={{ textAlign: 'right', fontWeight: 500, textDecoration: 'none', color: getDotColor(check.tone, mode), borderRadius: '5px', '&:hover': { bgcolor: 'kanap.bg.hover' } }}
                          >
                            {count}
                          </Typography>
                        ) : (
                          <Typography key={scope} variant="body2" aria-label={label} sx={{ textAlign: 'right', fontWeight: 500, color: 'text.secondary' }}>
                            {count}
                          </Typography>
                        );
                      })}
                    </Fragment>
                  );
                })}
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
                        sx={ROW_LINK_SX}
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
              title={t('dashboard.topItemsY', { column: defaultColumn.label })}
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
                  <Stack key={r.id} component={RouterLink} to={r.path} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
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
              title={t('dashboard.topIncreasesYvsYminus1', { column: defaultColumn.label })}
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
                  <Stack key={r.id} component={RouterLink} to={r.path} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
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

        {/* This year by cost center: the five largest, each opening the list on that cost center */}
        {readableScopes.length > 0 && (
          <Grid item xs={12} md={6} lg={4}>
            <DashboardTile
              icon="Groups"
              title={t('dashboard.byCostCenterY', { column: defaultColumn.label })}
              isLoading={costCentersLoading}
              isError={costCenters.isError}
              onRetry={costCenters.refetch}
              action={<ItemScopeTabs value={costCenterScope} onChange={setCostCenterScope} />}
            >
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {costCenters.rows.map((r) => (
                  <Stack
                    key={r.label ?? ''}
                    component={RouterLink}
                    to={listHref(costCenterScope, { cost_center_label: keepValues([r.label]) })}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={ROW_LINK_SX}
                  >
                    <Typography variant="body1" noWrap title={r.label ?? undefined} sx={{ flex: '0 1 45%', minWidth: 0, color: r.label ? 'inherit' : 'text.secondary' }}>
                      {r.label ?? t('dashboard.noCostCenter')}
                    </Typography>
                    <Box sx={{ flex: 1, minWidth: 24, height: 4, borderRadius: '2px', bgcolor: 'kanap.sliderTrack', overflow: 'hidden' }}>
                      <Box sx={{ height: '100%', borderRadius: '2px', bgcolor: 'kanap.teal', width: `${largestCostCenter > 0 ? (r.value / largestCostCenter) * 100 : 0}%` }} />
                    </Box>
                    <Typography variant="body1" sx={{ minWidth: 72, textAlign: 'right' }}>{formatThousandsK(r.value)}</Typography>
                  </Stack>
                ))}
                {costCenters.rows.length === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
                )}
              </Stack>
            </DashboardTile>
          </Grid>
        )}
      </Grid>
    </Box>
  );
}
