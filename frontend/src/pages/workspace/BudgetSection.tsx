import { Fragment, useCallback, useMemo, useState } from 'react';
import { Box, Typography, Stack, Button, Divider, Table, TableBody, TableCell, TableContainer, TableHead, TableRow } from '@mui/material';
import { useTheme, type Theme } from '@mui/material/styles';
import SettingsIcon from '@mui/icons-material/Settings';
import BudgetDashboardSettingsModal from './settings/BudgetDashboardSettingsModal';
import { useBudgetDashboardConfig } from './hooks/useBudgetDashboardConfig';
import AddIcon from '@mui/icons-material/Add';
import { getDotColor } from '../../utils/statusColors';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import { formatCompactAmount, formatThousandsAmount } from '../../i18n/formatters';
import { useLocale } from '../../i18n/useLocale';
import DashboardTile from './tiles/DashboardTile';
import { AmountColumnKey, amountFieldKey, slotYear, YearSlot, yearSlotLabel } from '../../components/finance/amountColumns';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { BudgetOperationScope as NatureScope } from '../../services/budgetOperations';
import { buildItemPath, formatItemRef } from '../../utils/item-ref';
import ItemScopeTabs from '../operations/ItemScopeTabs';
import type { BudgetSummaryRow } from '../reports/useReportScope';
import {
  type ColumnFilters,
  type BudgetScope,
  costCenterTotalsRequest,
  countRequest,
  currentYearField,
  keepValues,
  lineTotalRequest,
  nextYearField,
  readCostCenterTotals,
  readLineTotal,
  readTopIncreases,
  topIncreasesRequest,
} from '../reports/reportAggregates';
import { ACTIVE_TASK_STATUSES } from '../tasks/task.constants';
import { useBudgetAggregate, useBudgetAggregates } from '../reports/useBudgetAggregate';
import FxMissingNotice, { FxMissingMark } from '../../components/finance/FxMissingNotice';
import { mergeFxMissing, type FxMissing } from '../../components/finance/fxMissing';

type ServerListResponse<T> = { items: T[]; total: number; page: number; limit: number };

/** The header actions, styled as the main dashboard's quick actions. */
const QUICK_ACTION_SX = { height: 30, borderRadius: '5px' } as const;

// Small tiles fill the end of a row before a wide Budget tile, preserving the saved visual order.
const tileLayoutSx = (wide = false) => (theme: Theme) => ({
  minWidth: 0,
  flexGrow: wide ? 0 : 1,
  flexShrink: 0,
  flexBasis: {
    xs: '100%',
    md: wide ? '100%' : `calc((100% - ${theme.spacing(3)}) / 2)`,
    lg: wide ? `calc((100% - ${theme.spacing(6)}) * 2 / 3 + ${theme.spacing(3)})` : `calc((100% - ${theme.spacing(6)}) / 3)`,
  },
});

/** A tile row that opens what it names: neutral text, the hover background only. */
const ROW_LINK_SX = { color: 'inherit', textDecoration: 'none', borderRadius: '5px', mx: -0.5, px: 0.5, '&:hover': { bgcolor: 'kanap.bg.hover' } } as const;

type SnapshotTotals = {
  [amount: string]: number | FxMissing[] | string | null | undefined;
  fxMissing?: FxMissing[];
  reportingCurrency?: string | null;
};

/** The reporting currency a totals or aggregate answer names. Null when it names none: never a guessed code. */
function reportingCurrencyOf(data: { reportingCurrency?: unknown } | null | undefined): string | null {
  const code = data?.reportingCurrency;
  return typeof code === 'string' && code.trim() ? code.trim() : null;
}

/**
 * Every year and column from each list's totals; the combined total comes from the server. The
 * amounts left out for lack of an exchange rate: the three answers' entries together. The reporting
 * currency is the combined total's, else either nature's: the three name the same tenant currency.
 */
function useBudgetSnapshot(enabled: boolean) {
  return useQuery({
    queryKey: ['budget-lines-summary', 'dashboard', 'snapshot'],
    enabled,
    queryFn: async ({ signal }) => {
      const endpoints = [
        ['opex', '/spend-items/summary/totals'],
        ['capex', '/capex-items/summary/totals'],
        ['all', '/budget-lines/summary/totals'],
      ] as const;
      const totals = await Promise.all(endpoints.map(async ([scope, endpoint]) => {
        const res = await api.get<SnapshotTotals>(endpoint, { signal });
        return [scope, res.data] as const;
      }));
      const byScope = Object.fromEntries(totals) as Record<BudgetScope, SnapshotTotals>;
      return {
        totals: byScope as unknown as Record<BudgetScope, Record<string, number>>,
        fxMissing: mergeFxMissing(...totals.map(([, data]) => data?.fxMissing)),
        reportingCurrency: reportingCurrencyOf(byScope.all) ?? reportingCurrencyOf(byScope.opex) ?? reportingCurrencyOf(byScope.capex),
      };
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

/**
 * The five contracts due next, today included (the server filters and sorts): a renewing contract on
 * its next cancellation deadline, any other on its end (`next_due_date`, the contract list's order).
 * A contract that stops before its deadline shows its end, not that deadline.
 */
function useNextContractRenewal(enabled: boolean) {
  const today = localToday();
  return useQuery({
    queryKey: ['dashboard', 'next-contract-renewal', today],
    enabled,
    queryFn: async () => {
      const filters = {
        next_due_date: { filterType: 'date', type: 'greaterThanOrEqual', dateFrom: today },
      };
      const params: Record<string, any> = {
        limit: 5,
        sort: 'next_due_date:ASC',
        filters: JSON.stringify(filters),
      };
      const res = await api.get<ServerListResponse<{ id: string; name: string; next_due_date?: string | null }>>('/contracts', { params });
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

/** The unified list opened on exactly these filters (the list restores no stored search over them). */
function listHref(scope: BudgetScope, filters: ColumnFilters): string {
  return `/ops/budget?${new URLSearchParams({ filters: JSON.stringify(scope === 'all' ? filters : { ...filters, nature: keepValues([scope]) }) }).toString()}`;
}

/** The hygiene counts of one type: Enabled lines (not ended before 1 January, the list's default) passing each check, no row built. */
function useHygieneCounts(scope: NatureScope, checks: readonly HygieneCheck[] | null, enabled: boolean) {
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

const MY_TOP_LINES = 3;

type MyLine = { id: string; ref: string | null; path: string; name: string; value: number };

/**
 * Per role: the Enabled lines (not ended before 1 January) in the user's name and their sum of this
 * year's default column (the total covers every line), plus the role's three largest lines on that
 * column. A line in the top three of all roles together is in the top three of each role it holds,
 * so the three requests give the user's top lines without a request of their own.
 */
function useMyBudget(scope: BudgetScope, profile: ProfileName, metric: AmountColumnKey, enabled: boolean) {
  const roles = useMemo(() => myBudgetFilters(profile), [profile]);
  // On the unified list, the type as a filter: there `item_number` is the line's BL number.
  const requests = useMemo(() => (roles ? roles.map((role) => {
    const request = lineTotalRequest(scope === 'all' ? role.filter : { ...role.filter, nature: keepValues([scope]) }, metric);
    request.spec = {
      ...request.spec,
      groupBy: ['id', 'product_name', 'item_number'],
      order: [{ by: 'measure', id: 'value', dir: 'DESC' }],
      limit: MY_TOP_LINES,
    };
    return request;
  }) : null), [roles, metric, scope]);
  const query = useBudgetAggregates('all', requests, { enabled });
  const rows = useMemo(
    () => (roles && query.data ? roles.map((role, i) => ({ ...role, ...readLineTotal(query.data![i]) })) : []),
    [roles, query.data],
  );
  const topLines = useMemo(() => {
    const byId = new Map<string, MyLine>();
    for (const result of query.data ?? []) {
      for (const group of result.groups ?? []) {
        const id = group.keys[0] ?? '';
        const itemNumber = group.keys[2] != null && group.keys[2] !== '' ? Number(group.keys[2]) : null;
        const ref = itemNumber != null && Number.isFinite(itemNumber) ? formatItemRef('budget', itemNumber) : null;
        byId.set(id, { id, ref, path: buildItemPath('budget', ref ?? id), name: group.keys[1] || '\u2014', value: group.values.value ?? 0 });
      }
    }
    return [...byId.values()].sort((a, b) => b.value - a.value).slice(0, MY_TOP_LINES);
  }, [query.data]);
  const reportingCurrency = (query.data ?? []).reduce<string | null>((found, result) => found ?? reportingCurrencyOf(result), null);
  return { rows, topLines, fxMissing: query.fxMissing, reportingCurrency, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}

/** This year's default column by cost center, the five largest (lines without one in the ranking too). */
function useCostCenterTotals(scope: BudgetScope, metric: AmountColumnKey, enabled: boolean) {
  const request = useMemo(() => costCenterTotalsRequest(metric, 5), [metric]);
  const query = useBudgetAggregate(scope, request, { enabled });
  const rows = useMemo(() => readCostCenterTotals(query.data), [query.data]);
  return { rows, fxMissing: query.data?.fxMissing, reportingCurrency: reportingCurrencyOf(query.data), isLoading: enabled && query.isLoading, isError: query.isError, refetch: query.refetch };
}

type RecentUpdate = { scope: NatureScope; id: string; ref: string; name: string; at: string | null };

function useRecentUpdates(enabled: boolean) {
  return useQuery({
    queryKey: ['budget-lines-summary', 'dashboard', 'recent-updates'],
    enabled,
    queryFn: async (): Promise<RecentUpdate[]> => {
      const params = { limit: 5, sort: 'updated_at:DESC' };
      const res = await api.get<ServerListResponse<BudgetSummaryRow & { nature: NatureScope }>>('/budget-lines/summary', { params });
      return (res.data.items || []).map((row) => ({
        scope: row.nature,
        id: row.id,
        ref: row.item_number != null ? formatItemRef('budget', row.item_number) : row.id,
        name: row.product_name ?? '',
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

/**
 * This year's slot without an exchange rate for the line currency (the full row shape): its amount
 * stays in that currency, named and marked, never as a reporting amount. Null when it has a rate.
 */
function missingRateOfRow(row: any, column: AmountColumnKey, year: number): { currency: string; year: number } | null {
  const reporting = row?.versions?.y?.reporting;
  if (reporting?.fx_source !== 'missing' || reporting?.[column] != null) return null;
  const currency = reporting.currency || row?.currency;
  return currency ? { currency, year: row?.versions?.y?.year ?? year } : null;
}

function useTopItemsCurrentYear(scope: BudgetScope, enabled: boolean, column: AmountColumnKey, sort: string, limit: number = 5) {
  const Y = new Date().getFullYear();
  return useQuery({
    queryKey: ['budget-lines-summary', 'dashboard', 'top-items', scope, Y, column, limit],
    enabled,
    queryFn: async () => {
      const filters = scope === 'all' ? undefined : JSON.stringify({ nature: keepValues([scope]) });
      const params = { limit, sort, years: [Y - 1, Y].join(','), ...(filters ? { filters } : {}) };
      // A line without a rate sorts last, so it can miss this list. The totals name every such line.
      const [res, totals] = await Promise.all([
        api.get<ServerListResponse<BudgetSummaryRow & { nature: NatureScope }>>('/budget-lines/summary', { params }),
        api.get<{ fxMissing?: FxMissing[]; reportingCurrency?: string | null }>('/budget-lines/summary/totals', {
          params: { amounts: currentYearField(column), ...(filters ? { filters } : {}) },
        }),
      ]);
      const items = (res.data.items || []).map((row) => ({
        id: row.id,
        path: buildItemPath('budget', row.item_number != null ? formatItemRef('budget', row.item_number) : row.id),
        name: row.product_name || '\u2014',
        y: getColumnValueFromRow(row, 'y', column),
        yMinus1: getColumnValueFromRow(row, 'yMinus1', column),
        yMissingRate: missingRateOfRow(row, column, Y),
      }));
      const fxMissing = (totals.data?.fxMissing ?? []).filter((item) => item?.currency && item.year === Y);
      return { items, fxMissing, reportingCurrency: reportingCurrencyOf(totals.data) };
    },
    staleTime: 60 * 1000,
  });
}

/** Lines whose default column grew from Y-1 to Y, largest first, over every line of the type's window (one aggregate). */
function useTopIncreases(scope: BudgetScope, enabled: boolean, column: AmountColumnKey, columnReady: boolean, limit: number = 5) {
  const request = useMemo(() => {
    if (!columnReady) return null;
    const request = topIncreasesRequest('all', column, limit);
    if (scope !== 'all') request.query.filters = { nature: keepValues([scope]) };
    return request;
  }, [scope, column, columnReady, limit]);
  const query = useBudgetAggregate('all', request, { enabled });
  const items = useMemo(() => readTopIncreases(query.data).map((row) => ({
    ...row,
    name: row.name || '\u2014',
    // The line's reference; its id only when it has none (the page opens either).
    path: buildItemPath('budget', row.itemNumber != null ? formatItemRef('budget', row.itemNumber) : row.id),
  })), [query.data]);
  return { items, fxMissing: query.data?.fxMissing, reportingCurrency: reportingCurrencyOf(query.data), isLoading: enabled && (query.isLoading || !columnReady) };
}

/** All / OPEX / CAPEX choice of a dashboard tile, remembered per tile; a type the user cannot read falls back to the default. */
function useTileScope(tile: string): [BudgetScope, (next: BudgetScope) => void] {
  const { hasLevel } = useAuth();
  const fallback = 'all';
  const storageKey = `kanap.dashboard.${tile}.scope`;
  const [stored, setStored] = useState<BudgetScope | null>(() => {
    try {
      const value = window.localStorage.getItem(storageKey);
      return value === 'all' || value === 'opex' || value === 'capex' ? value : null;
    } catch {
      return null;
    }
  });
  const scope = stored && hasLevel('budget', 'reader') ? stored : fallback;
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

/** The home page's My tasks tile already lists the person's tasks. */
const ON_HOME_PAGE_ALREADY = new Set(['my-tasks']);

/**
 * The budget tiles of the home page, with their quick actions and their settings. `leading`
 * comes first in the row (the first steps, when the budget section heads the home page).
 */
export default function BudgetSection({ leading }: { leading?: React.ReactNode }) {
  const navigate = useNavigate();
  const { hasLevel, profile } = useAuth();
  const { t } = useTranslation('common');
  const locale = useLocale();
  const Y = new Date().getFullYear();

  const dashboardSettings = useBudgetDashboardConfig();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const tileEnabled = (id: string) => !dashboardSettings.isLoading && dashboardSettings.config.tiles.some((tile) => tile.id === id && tile.enabled);

  const mode = useTheme().palette.mode;
  // One right for both types of budget line (lot R).
  const canOpex = hasLevel('budget', 'reader');
  const canCapex = canOpex;
  const canTasks = hasLevel('tasks', 'reader');
  const canContracts = hasLevel('contracts', 'reader');
  // The creation rights of the budget and contract lists.
  const canCreateLines = hasLevel('budget', 'manager');
  const canCreateContracts = hasLevel('contracts', 'manager');
  const { data: myTasks, isLoading: tasksLoading } = useMyTasksSummary(profile?.id, canTasks && tileEnabled('my-tasks'));
  const { data: nextContract, isLoading: contractsLoading } = useNextContractRenewal(canContracts && tileEnabled('renewals'));
  const readableScopes = (['opex', 'capex'] as const).filter((scope) => (scope === 'opex' ? canOpex : canCapex));
  const scopeLabel = (scope: NatureScope) => t(`ops:operations.scope.${scope}`);
  const budgetColumns = useBudgetColumns();
  const defaultColumn = budgetColumns.defaultColumn;
  const snapshot = useBudgetSnapshot(canOpex && tileEnabled('budget'));

  // Next year's check names the default column: the checks wait for the setting.
  const checks = useMemo(() => (budgetColumns.ready ? hygieneChecks(defaultColumn.key) : null), [budgetColumns.ready, defaultColumn.key]);
  const hygieneByScope = {
    opex: useHygieneCounts('opex', checks, canOpex && tileEnabled('hygiene')),
    capex: useHygieneCounts('capex', checks, canCapex && tileEnabled('hygiene')),
  };
  const hygieneLoading = readableScopes.some((scope) => hygieneByScope[scope].isLoading);
  const hygieneError = readableScopes.some((scope) => hygieneByScope[scope].isError);

  const { data: recentUpdates = [] } = useRecentUpdates(canOpex && tileEnabled('recent-updates'));

  const [topScope, setTopScope] = useTileScope('topItems');
  // Both tiles wait for the default column so the list is not fetched twice.
  const { data: topItemsResult, isLoading: topQueryLoading } = useTopItemsCurrentYear(
    topScope,
    readableScopes.length > 0 && tileEnabled('top-lines') && budgetColumns.ready,
    defaultColumn.key,
    budgetColumns.defaultSort,
    5,
  );
  const topItems = topItemsResult?.items;
  const topFxMissing = topItemsResult?.fxMissing;
  const topLoading = topQueryLoading || (readableScopes.length > 0 && !budgetColumns.ready);
  const [increaseScope, setIncreaseScope] = useTileScope('topIncreases');
  const { items: topIncreases, fxMissing: increasesFxMissing, reportingCurrency: increasesCurrency, isLoading: increasesLoading } = useTopIncreases(increaseScope, readableScopes.length > 0 && tileEnabled('top-increases'), defaultColumn.key, budgetColumns.ready, 5);

  const [myBudgetScope, setMyBudgetScope] = useTileScope('myBudget');
  const myBudget = useMyBudget(myBudgetScope, profile, defaultColumn.key, readableScopes.length > 0 && tileEnabled('my-budget') && budgetColumns.ready);
  const myBudgetLoading = myBudget.isLoading || (readableScopes.length > 0 && !budgetColumns.ready);
  const [costCenterScope, setCostCenterScope] = useTileScope('byCostCenter');
  const costCenters = useCostCenterTotals(costCenterScope, defaultColumn.key, readableScopes.length > 0 && tileEnabled('cost-centers') && budgetColumns.ready);
  const costCentersLoading = costCenters.isLoading || (readableScopes.length > 0 && !budgetColumns.ready);
  const largestCostCenter = Math.max(0, ...costCenters.rows.map((r) => r.value));

  // The tiles on this year's default column name it under their title.
  const columnY = t('dashboard.columnY', { column: defaultColumn.label });

  const openTasks = myTasks?.total ?? 0;
  const taskItems = myTasks?.items || [];

  const upcomingRenewals = nextContract?.items || [];

  const snapshotSlots: readonly YearSlot[] = ['yMinus1', 'y', 'yPlus1'];
  const snapshotRows = snapshotSlots.flatMap((slot) => (['opex', 'capex', 'all'] as const).map((scope) => ({
    slot,
    scope,
    year: yearSlotLabel(t, slot, Y),
    label: scope === 'all' ? t('ops:shared.total') : scopeLabel(scope),
    values: Object.fromEntries(budgetColumns.shown.map((column) => {
      const field = amountFieldKey(slot, column);
      return [column.key, snapshot.data?.totals[scope][field] ?? 0];
    })) as Record<AmountColumnKey, number>,
  })));
  // Keep a column if either nature has a value, even when the combined total is zero.
  const chosenColumns = dashboardSettings.config.tiles.find((tile) => tile.id === 'budget')?.config.columns as AmountColumnKey[] | null | undefined;
  // The tile shows Y-1 to Y+1: the amounts left out of those years only.
  const snapshotYears = new Set(snapshotSlots.map((slot) => slotYear(slot, Y)));
  const snapshotFxMissing = (snapshot.data?.fxMissing ?? []).filter((entry) => snapshotYears.has(entry.year));
  const snapshotColumns = budgetColumns.shown.filter((column) => chosenColumns == null || chosenColumns.includes(column.key)).filter((column) => snapshotRows.some((row) => row.values[column.key] !== 0));

  const canViewTile = (id: string) => id === 'my-tasks' ? canTasks : id === 'renewals' ? canContracts : canOpex;
  const tiles: Record<string, React.ReactNode> = {
    'budget': (canOpex) ? (
          <Box key="budget" sx={tileLayoutSx(true)}>
            <DashboardTile
              icon="AccountBalanceWallet"
              title={t('dashboard.budgetSnapshot')}
              currency={snapshot.data?.reportingCurrency ?? undefined}
              action={<Button size="small" onClick={() => navigate(listHref('all', {}))}>{t('buttons.view')}</Button>}
              isLoading={snapshot.isLoading || !budgetColumns.ready}
              isError={snapshot.isError}
              onRetry={snapshot.refetch}
            >
              {snapshotColumns.length === 0 ? (
                <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
              ) : (
                <TableContainer>
                  <Table size="small" sx={{ '& th, & td': { py: 0.75, whiteSpace: 'nowrap' }, '& td[rowspan]': { verticalAlign: 'top' } }}>
                    <TableHead>
                      <TableRow>
                        <TableCell sx={{ fontWeight: 500 }}>{t('labels.year')}</TableCell>
                        <TableCell sx={{ fontWeight: 500 }}>{t('ops:budget.type')}</TableCell>
                        {snapshotColumns.map((column) => (
                          <TableCell key={column.key} align="right" sx={{ fontWeight: 500, minWidth: 76 }}>{column.label}</TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {snapshotRows.map((row, index) => (
                        <TableRow key={`${row.slot}-${row.scope}`}>
                          {index % 3 === 0 && <TableCell rowSpan={3}>{row.year}</TableCell>}
                          <TableCell sx={{ fontWeight: row.scope === 'all' ? 500 : 400 }}>{row.label}</TableCell>
                          {snapshotColumns.map((column) => (
                            <TableCell key={column.key} align="right">
                              <Box component={RouterLink} to={listHref(row.scope, {})} sx={ROW_LINK_SX}>
                                {formatThousandsAmount(row.values[column.key], locale)}
                              </Box>
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              <FxMissingNotice items={snapshotFxMissing} sx={{ mt: 1 }} />
            </DashboardTile>
          </Box>
    ) : null,
    'hygiene': (readableScopes.length > 0) ? (
          <Box key="hygiene" sx={tileLayoutSx()}>
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
          </Box>
    ) : null,
    'my-budget': (readableScopes.length > 0) ? (
          <Box key="my-budget" sx={tileLayoutSx()}>
            <DashboardTile
              icon="VerifiedUser"
              title={t('dashboard.myBudget.title')}
              subtitle={columnY}
              currency={myBudget.reportingCurrency ?? undefined}
              isLoading={myBudgetLoading}
              isError={myBudget.isError}
              onRetry={myBudget.refetch}
              action={<ItemScopeTabs allowAll value={myBudgetScope} onChange={setMyBudgetScope} />}
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
                        <Typography variant="body1" sx={{ minWidth: 72, textAlign: 'right', color: 'inherit' }}>{formatThousandsAmount(r.value, locale)}</Typography>
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
                  {/* The user's three largest lines, whatever the role */}
                  {myBudget.topLines.length > 0 && (
                    <>
                      <Divider sx={{ my: 0.5 }} />
                      <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary' }}>{t('dashboard.myBudget.myLines')}</Typography>
                      {myBudget.topLines.map((line) => (
                        <Stack key={line.id} component={RouterLink} to={line.path} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
                          {line.ref && (
                            <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}>{line.ref}</Typography>
                          )}
                          <Typography variant="body1" noWrap title={line.name} sx={{ flex: 1, minWidth: 0 }}>{line.name}</Typography>
                          <Typography variant="body1" sx={{ minWidth: 72, textAlign: 'right' }}>{formatThousandsAmount(line.value, locale)}</Typography>
                        </Stack>
                      ))}
                    </>
                  )}
                  <FxMissingNotice items={myBudget.fxMissing} sx={{ pt: 0.5 }} />
                </Stack>
              )}
            </DashboardTile>
          </Box>
    ) : null,
    'my-tasks': (canTasks) ? (
          <Box key="my-tasks" sx={tileLayoutSx()}>
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
          </Box>
    ) : null,
    'renewals': (canContracts) ? (
          <Box key="renewals" sx={tileLayoutSx()}>
            <DashboardTile icon="EventAvailable" title={t('dashboard.nextRenewals')} isLoading={contractsLoading} action={<Button size="small" onClick={() => navigate('/ops/contracts')}>{t('buttons.viewAll')}</Button>}>
              <Stack spacing={0.5}>
                {upcomingRenewals.map((r) => (
                  <Stack key={r.id} component={RouterLink} to={`/ops/contracts/${r.id}/overview`} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{r.next_due_date ? new Date(r.next_due_date).toLocaleDateString(locale) : '\u2014'}</Typography>
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                  </Stack>
                ))}
                {upcomingRenewals.length === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('dashboard.noUpcomingRenewals')}</Typography>
                )}
              </Stack>
            </DashboardTile>
          </Box>
    ) : null,
    'top-lines': (readableScopes.length > 0) ? (
          <Box key="top-lines" sx={tileLayoutSx()}>
            <DashboardTile
              icon="Leaderboard"
              title={t('dashboard.topItems')}
              subtitle={columnY}
              currency={topItemsResult?.reportingCurrency ?? undefined}
              isLoading={topLoading}
              action={(
                <Stack direction="row" alignItems="center">
                  <ItemScopeTabs allowAll value={topScope} onChange={setTopScope} />
                  <Button size="small" onClick={() => navigate(`/ops/reports/top-opex?scope=${topScope}`)}>{t('buttons.open')}</Button>
                </Stack>
              )}
            >
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {(topItems || []).map((r) => (
                  <Stack key={r.id} component={RouterLink} to={r.path} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                    {r.yMissingRate ? (
                      // No exchange rate this year: the amount in the line currency, marked.
                      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minWidth: 90, justifyContent: 'flex-end' }}>
                        <Typography variant="body1" sx={{ color: 'kanap.text.secondary', whiteSpace: 'nowrap' }}>
                          {t('ops:shared.fxMissing.localAmount', { amount: formatThousandsAmount(r.y, locale), currency: r.yMissingRate.currency })}
                        </Typography>
                        <FxMissingMark currency={r.yMissingRate.currency} year={r.yMissingRate.year} />
                      </Stack>
                    ) : (
                      <Typography variant="body1" sx={{ minWidth: 90, textAlign: 'right' }}>{formatThousandsAmount(r.y, locale)}</Typography>
                    )}
                  </Stack>
                ))}
                {(topItems?.length || 0) === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
                )}
                <FxMissingNotice items={topFxMissing} sx={{ pt: 0.5 }} />
              </Stack>
            </DashboardTile>
          </Box>
    ) : null,
    'top-increases': (readableScopes.length > 0) ? (
          <Box key="top-increases" sx={tileLayoutSx()}>
            <DashboardTile
              icon="TrendingUp"
              title={t('dashboard.topIncreases')}
              subtitle={t('dashboard.columnYvsYminus1', { column: defaultColumn.label })}
              currency={increasesCurrency ?? undefined}
              isLoading={increasesLoading}
              action={(
                <Stack direction="row" alignItems="center">
                  <ItemScopeTabs allowAll value={increaseScope} onChange={setIncreaseScope} />
                  <Button size="small" onClick={() => navigate(`/ops/reports/opex-delta?scope=${increaseScope}`)}>{t('buttons.open')}</Button>
                </Stack>
              )}
            >
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {topIncreases.map((r) => (
                  <Stack key={r.id} component={RouterLink} to={r.path} direction="row" spacing={1} alignItems="center" sx={ROW_LINK_SX}>
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                    <Typography variant="body1" sx={{ minWidth: 90, textAlign: 'right' }}>+{formatCompactAmount(r.delta, locale)}</Typography>
                  </Stack>
                ))}
                {topIncreases.length === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('dashboard.noIncreases')}</Typography>
                )}
                <FxMissingNotice items={increasesFxMissing} sx={{ pt: 0.5 }} />
              </Stack>
            </DashboardTile>
          </Box>
    ) : null,
    'cost-centers': (readableScopes.length > 0) ? (
          <Box key="cost-centers" sx={tileLayoutSx()}>
            <DashboardTile
              icon="Groups"
              title={t('dashboard.byCostCenter')}
              subtitle={columnY}
              currency={costCenters.reportingCurrency ?? undefined}
              isLoading={costCentersLoading}
              isError={costCenters.isError}
              onRetry={costCenters.refetch}
              action={<ItemScopeTabs allowAll value={costCenterScope} onChange={setCostCenterScope} />}
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
                    <Typography variant="body1" sx={{ minWidth: 72, textAlign: 'right' }}>{formatThousandsAmount(r.value, locale)}</Typography>
                  </Stack>
                ))}
                {costCenters.rows.length === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('labels.noData')}</Typography>
                )}
                <FxMissingNotice items={costCenters.fxMissing} sx={{ pt: 0.5 }} />
              </Stack>
            </DashboardTile>
          </Box>
    ) : null,
    'recent-updates': (readableScopes.length > 0) ? (
          <Box key="recent-updates" sx={tileLayoutSx()}>
            <DashboardTile icon="Update" title={t('dashboard.recentUpdates')}>
              <Stack spacing={0.5} sx={{ mt: 1 }}>
                {recentUpdates.map((r) => (
                  <Stack
                    key={`${r.scope}-${r.id}`}
                    component={RouterLink}
                    to={buildItemPath('budget', r.ref)}
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={ROW_LINK_SX}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 500, fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>{r.at ? new Date(r.at).toLocaleDateString(locale) : '\u2014'}</Typography>
                    <Typography sx={{ fontFamily: 'monospace', fontSize: 11, color: 'kanap.text.tertiary' }}>{r.ref.startsWith('BL-') ? r.ref : ''}</Typography>
                    <Typography variant="body1" noWrap sx={{ flex: 1 }}>{r.name}</Typography>
                    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', whiteSpace: 'nowrap' }}>{scopeLabel(r.scope)}</Typography>
                  </Stack>
                ))}
                {recentUpdates.length === 0 && (
                  <Typography variant="body1" color="text.secondary">{t('dashboard.noRecentUpdates')}</Typography>
                )}
              </Stack>
            </DashboardTile>
          </Box>
    ) : null,
  };

  const shownTiles = dashboardSettings.config.tiles
    .filter((tile) => tile.enabled && !ON_HOME_PAGE_ALREADY.has(tile.id) && tiles[tile.id])
    .slice()
    .sort((a, b) => a.order - b.order);
  // Nothing of the budget for this person: no section at all.
  if (!canOpex && !canContracts) return null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1.5} useFlexGap flexWrap="wrap">
        <Typography component="h2" sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary', mr: 0.5 }}>
          {t('nav:workspaces.budgetManagement')}
        </Typography>
        {canCreateLines && (
          <Button variant="outlined" size="small" startIcon={<AddIcon />} sx={QUICK_ACTION_SX} onClick={() => navigate('/ops/budget/new?nature=opex')}>
            {t('dashboard.newOpexLine')}
          </Button>
        )}
        {canCreateLines && (
          <Button variant="outlined" size="small" startIcon={<AddIcon />} sx={QUICK_ACTION_SX} onClick={() => navigate('/ops/budget/new?nature=capex')}>
            {t('dashboard.newCapexLine')}
          </Button>
        )}
        {canCreateContracts && (
          <Button variant="outlined" size="small" startIcon={<AddIcon />} sx={QUICK_ACTION_SX} onClick={() => navigate('/ops/contracts/new/overview')}>
            {t('dashboard.newContract')}
          </Button>
        )}
        <Box sx={{ flex: 1 }} />
        <Button variant="action" size="small" startIcon={<SettingsIcon />} onClick={() => setSettingsOpen(true)} disabled={dashboardSettings.isLoading}>
          {t('dashboard.budgetSettings.customize')}
        </Button>
      </Stack>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'start' }}>
        {leading ? <Box sx={tileLayoutSx()}>{leading}</Box> : null}
        {shownTiles.map((tile) => tiles[tile.id])}
      </Box>
      <BudgetDashboardSettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} settings={dashboardSettings} columns={budgetColumns} canViewTile={canViewTile} />
    </Box>
  );
}
