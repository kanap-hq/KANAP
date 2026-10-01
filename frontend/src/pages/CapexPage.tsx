import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { DATE_COLUMN_FILTER, StatusScope, gridSortModel } from '../components/ServerDataGrid';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Stack, Typography } from '@mui/material';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import api from '../api';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { formatItemRef } from '../utils/item-ref';
import { readStoredCapexListContext, writeStoredCapexListContext } from './capex/listContextStorage';
import { statusScopeParams } from '../utils/statusScopeParams';
import ForbiddenPage from './ForbiddenPage';
import {
  amountColumnYear,
  buildAmountColumnDefs,
  buildFteColumnDefs,
  dimensionFieldPredicate,
  settleListSearch,
  explicitSort,
  fteTotalsToRow,
  SummaryVersions,
  totalsToVersions,
  visibleFteFields,
} from '../components/finance/amountColumns';
import { useBudgetColumns } from '../hooks/useBudgetColumns';
import { useAnalyticsAxes } from '../hooks/useAnalyticsAxes';
import { analyticsFieldKey } from '../services/analytics';
import { useLocale } from '../i18n/useLocale';
import { formatShortDate, formatShortDateTime } from '../lib/dateFormat';
import { statusColumnProps } from '../components/grid/statusColumn';
// import StatusSwitch from '../components/fields/StatusSwitch';

type SummaryRow = {
  id: string;
  item_number: number;
  description: string;
  supplier?: { id: string; name: string } | null;
  supplier_name?: string | null;
  paying_company_id?: string | null;
  paying_company_name?: string | null;
  account?: { id: string; account_number: number; account_name: string } | null;
  account_display?: string | null;
  owner_it_id?: string | null;
  owner_business_id?: string | null;
  owner_it_name?: string | null;
  owner_business_name?: string | null;
  analytics_category_id?: string | null;
  analytics_category_name?: string | null;
  analytics_value_ids?: Record<string, string> | null;
  cost_center_id?: string | null;
  cost_center_code?: string | null;
  cost_center_name?: string | null;
  cost_center_label?: string | null;
  cost_center_path?: string | null;
  budget_holder_id?: string | null;
  budget_holder_name?: string | null;
  run_build?: 'run' | 'build' | null;
  ppe_type: 'hardware' | 'software';
  investment_type: 'replacement' | 'capacity' | 'productivity' | 'security' | 'conformity' | 'business_growth' | 'other';
  priority: 'mandatory' | 'high' | 'medium' | 'low';
  currency: string;
  effective_start: string;
  disabled_at?: string | null;
  status: string;
  notes?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  versions?: SummaryVersions;
  latest_task?: { id: string; title?: string } | null;
  latest_contract_id?: string | null;
  latest_contract_name?: string | null;
  project_name?: string | null;
  spread_mode_for_y?: 'flat' | 'manual' | null;
  allocation_method_label?: string | null;
  next_year_allocation_method_label?: string | null;
  allocation_warning?: string | null;
};

/** The query the footer totals follow: the list state without the sort, plus the FTE columns shown. */
type TotalsQuery = { q: string; filters: string; statusScope: StatusScope; fte: string };

const TOTALS_QUERY_KEY = 'capex-summary-totals';

export default function CapexPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(["ops", "common"]);
  const locale = useLocale();
  const budgetColumns = useBudgetColumns();
  const analyticsAxes = useAnalyticsAxes();
  const queryClient = useQueryClient();

  const Y = new Date().getFullYear();
  const [refreshKey, setRefreshKey] = useState(0);
  const navigate = useNavigate();
  const location = useLocation();
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<SummaryRow[]>([]);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; filtersString: string; statusScope?: StatusScope } | null>(null);
  const gridApiRef = useRef<any>(null);
  const storedContextRef = useRef(readStoredCapexListContext());
  // The default sort and the shown columns come from the budget columns setting; callbacks
  // created once read them here.
  const budgetColumnsRef = useRef(budgetColumns);
  budgetColumnsRef.current = budgetColumns;
  // The dimension columns the list builds: a sort or filter on another dimension falls back like a hidden amount column.
  const isListField = useMemo(
    () => dimensionFieldPredicate(analyticsAxes.enabled.filter((axis) => !axis.is_default).map((axis) => axis.id)),
    [analyticsAxes],
  );
  const isListFieldRef = useRef(isListField);
  isListFieldRef.current = isListField;
  // The sort to keep in the URL and the list context: '' for the default, which then follows a default change.
  const listSort = useCallback(
    (sort?: string | null) => explicitSort(sort, budgetColumnsRef.current.shown, budgetColumnsRef.current.defaultSort, isListFieldRef.current),
    [],
  );
  const gridDefaultSort = useMemo(
    () => ({ field: budgetColumns.defaultSort.split(':')[0], direction: 'DESC' as const }),
    [budgetColumns.defaultSort],
  );

  // The URL once the stored list context has filled it and a sort or filter on a hidden column
  // has fallen back; null until the setting and the dimensions are loaded. The grid mounts on that
  // URL only, so the first request already uses the tenant's default sort, and a saved layout
  // (applied at mount only) finds the dimension columns.
  const settledSearch = useMemo(() => {
    if (!budgetColumns.ready || !analyticsAxes.ready) return null;
    const stored = storedContextRef.current || readStoredCapexListContext();
    if (stored && !storedContextRef.current) storedContextRef.current = stored;
    return settleListSearch(location.search, stored, budgetColumns.shown, budgetColumns.defaultSort, isListField);
  }, [budgetColumns.ready, budgetColumns.shown, budgetColumns.defaultSort, analyticsAxes.ready, isListField, location.search]);
  const currentSearch = new URLSearchParams(location.search).toString();
  useEffect(() => {
    if (settledSearch != null && settledSearch !== currentSearch) navigate({ search: settledSearch }, { replace: true });
  }, [settledSearch, currentSearch, navigate]);
  const [gridMounted, setGridMounted] = useState(false);
  const gridCanMount = gridMounted || (settledSearch != null && settledSearch === currentSearch);
  useEffect(() => { if (gridCanMount && !gridMounted) setGridMounted(true); }, [gridCanMount, gridMounted]);

  const initialGridState = useMemo(() => {
    if (!gridCanMount) return undefined;
    const raw = new URLSearchParams(location.search).get('filters') || '';
    if (!raw) return undefined;
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && Object.keys(parsed).length > 0) {
        return { filter: { filterModel: parsed } };
      }
    } catch {}
    return undefined;
    // Read once, when the grid mounts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gridCanMount]);

  const getCapexFilterValues = useCallback((field: string, opts?: { emptyLabel?: string; labelMap?: Record<string, string> }) => {
    const emptyLabel = opts?.emptyLabel ?? t('shared.blank');
    const labelMap = opts?.labelMap;
    return async ({ context }: any) => {
      const queryState = context?.getQueryState?.() ?? {};
      const filters = { ...(queryState.filters || {}) };
      delete filters[field];
      const params: Record<string, any> = {
        fields: field,
        ...(queryState.extraParams || {}),
      };
      if (queryState.q) params.q = queryState.q;
      if (Object.keys(filters).length > 0) params.filters = JSON.stringify(filters);
      Object.assign(params, statusScopeParams(queryState.statusScope));
      const res = await api.get('/capex-items/summary/filter-values', { params });
      const values = (res.data?.[field] || []) as Array<string | null>;
      const options = values.map((value) => {
        if (value == null) return { value, label: emptyLabel };
        const key = String(value);
        const label = labelMap && Object.prototype.hasOwnProperty.call(labelMap, key) ? labelMap[key] : key;
        return { value, label };
      });
      options.sort((a, b) => {
        if (a.value == null) return 1;
        if (b.value == null) return -1;
        return (a.label || '').localeCompare(b.label || '');
      });
      return options;
    };
  }, [t]);

  const PPE_LABELS: Record<string, string> = useMemo(() => ({
    hardware: t('capex.ppeTypes.hardware'),
    software: t('capex.ppeTypes.software'),
  }), [t]);

  const INVESTMENT_LABELS: Record<string, string> = useMemo(() => ({
    replacement: t('capex.investmentTypes.replacement'),
    capacity: t('capex.investmentTypes.capacity'),
    productivity: t('capex.investmentTypes.productivity'),
    security: t('capex.investmentTypes.security'),
    conformity: t('capex.investmentTypes.conformity'),
    business_growth: t('capex.investmentTypes.business_growth'),
    other: t('capex.investmentTypes.other'),
  }), [t]);

  const PRIORITY_LABELS: Record<string, string> = useMemo(() => ({
    mandatory: t('capex.priorityTypes.mandatory'),
    high: t('capex.priorityTypes.high'),
    medium: t('capex.priorityTypes.medium'),
    low: t('capex.priorityTypes.low'),
  }), [t]);

  const RUN_BUILD_LABELS: Record<string, string> = useMemo(() => ({
    run: t('capex.runBuild.run'),
    build: t('capex.runBuild.build'),
  }), [t]);

  // The footer follows the query the grid reports once it is ready (see onQueryStateChange), and
  // the FTE columns it shows: one request per distinct query, none on a sort (the key leaves it
  // out). The grid reports the same query several times while it starts (URL sync, initial sort,
  // grid ready); the key stays the same. A superseded request is cancelled through its signal.
  const [totalsQuery, setTotalsQuery] = useState<Omit<TotalsQuery, 'fte'> | null>(null);
  const [fteFields, setFteFields] = useState('');
  const followTotalsQuery = useCallback((next: Omit<TotalsQuery, 'fte'>) => {
    setTotalsQuery((prev) => (prev && prev.q === next.q && prev.filters === next.filters && prev.statusScope === next.statusScope ? prev : next));
  }, []);
  // Showing or hiding an FTE column refetches the footer with the FTE columns now shown.
  const followFteColumns = useCallback((state: Parameters<typeof visibleFteFields>[0]) => {
    setFteFields(visibleFteFields(state).join(','));
  }, []);
  const totals = useQuery({
    queryKey: [TOTALS_QUERY_KEY, totalsQuery ? { ...totalsQuery, fte: fteFields } : null],
    queryFn: async ({ signal }) => {
      const params: Record<string, any> = {};
      if (totalsQuery!.q) params.q = totalsQuery!.q;
      if (totalsQuery!.filters) params.filters = totalsQuery!.filters;
      Object.assign(params, statusScopeParams(totalsQuery!.statusScope));
      if (fteFields) params.fte = fteFields;
      const res = await api.get('/capex-items/summary/totals', { params, signal });
      return res.data || {};
    },
    enabled: totalsQuery != null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
  const pinnedTotals = useMemo(() => {
    if (!totals.data || totals.isError) return [];
    return [{
      id: '__capex_totals__',
      description: t('shared.total'),
      versions: totalsToVersions(totals.data),
      ...fteTotalsToRow(totals.data.fte),
    }];
  }, [totals.data, totals.isError, t]);
  const reportingCurrency = typeof totals.data?.reportingCurrency === 'string' ? totals.data.reportingCurrency : 'EUR';

  // A delete or an import changes the lines without changing the query: ask again for the same one.
  useEffect(() => {
    if (!refreshKey) return;
    queryClient.invalidateQueries({ queryKey: [TOTALS_QUERY_KEY] });
  }, [refreshKey, queryClient]);

  const buildGridSearch = useCallback(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stored = storedContextRef.current || readStoredCapexListContext();
    if (stored && !storedContextRef.current) storedContextRef.current = stored;
    const fallbackSort = listSort(lastQueryRef.current?.sort || urlParams.get('sort') || stored?.sort);
    const primarySort = gridApiRef.current ? gridSortModel(gridApiRef.current)[0] : undefined;
    let sort = fallbackSort;
    if (primarySort?.colId) {
      const direction = primarySort.sort === 'asc' ? 'ASC' : 'DESC';
      sort = listSort(`${primarySort.colId}:${direction}`);
    }
    const q = lastQueryRef.current?.q ?? urlParams.get('q') ?? stored?.q ?? '';
    const gridFilterModel = gridApiRef.current?.getFilterModel?.() || lastQueryRef.current?.filters || {};
    let filters = gridFilterModel && Object.keys(gridFilterModel).length > 0 ? JSON.stringify(gridFilterModel) : '';
    if (!filters && lastQueryRef.current?.filtersString) filters = lastQueryRef.current.filtersString;
    if (!filters && stored?.filters) filters = stored.filters;
    const sp = new URLSearchParams();
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters) sp.set('filters', filters);
    return sp;
  }, []);

  // The list part of the cell links, built once per list state (each grid report replaces
  // lastQueryRef.current) rather than once per cell.
  const gridSearchCacheRef = useRef<{ state: unknown; search: string } | null>(null);
  const gridSearch = useCallback(() => {
    const state = lastQueryRef.current;
    const cached = gridSearchCacheRef.current;
    if (state && cached && cached.state === state) return cached.search;
    const search = buildGridSearch().toString();
    if (state) gridSearchCacheRef.current = { state, search };
    return search;
  }, [buildGridSearch]);

  const getCapexHref = useCallback((row: unknown, colId?: string) => {
    const item = row as SummaryRow | null | undefined;
    if (!item?.id) return null;
    if (colId === 'contract_name') {
      const contractId = item.latest_contract_id;
      return contractId ? `/ops/contracts/${contractId}/overview` : null;
    }
    if (colId === 'cost_center_label') {
      return item.cost_center_id ? `/master-data/cost-centers/${item.cost_center_id}/overview` : null;
    }
    const next = new URLSearchParams(gridSearch());
    let tab = 'overview';
    const amountYear = amountColumnYear(colId, Y);
    if (colId === 'allocation_label') {
      tab = 'allocations';
      next.set('year', String(Y));
    } else if (amountYear != null) {
      tab = 'budget';
      next.set('year', String(amountYear));
    } else if (colId === 'latest_task_text') {
      tab = 'overview'; // tasks now live in the overview tab
    }
    const ref = item.item_number != null ? formatItemRef('capex', item.item_number) : item.id;
    return `/ops/capex/${ref}/${tab}?${next.toString()}`;
  }, [Y, gridSearch]);

  const defaultAnalyticsLabel = analyticsAxes.label(analyticsAxes.defaultAxis ?? { name: null });

  const columns = useMemo(() => {
    const linkCell = (colId: string) => (params: any) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={(row) => getCapexHref(row, colId)}
        onNavigate={(href) => navigate(href)}
      />
    );
    const accountGetter = (p: any) => {
      const d: any = p.data || {};
      const a = d?.account;
      if (a && (a.account_number != null || a.account_name != null)) {
        return [a.account_number != null ? String(a.account_number) : '', a.account_name != null ? String(a.account_name) : ''].filter(Boolean).join(' - ');
      }
      return d.account_display || '';
    };
    return [
      {
        colId: 'item_number',
        headerName: t('capex.columns.reference', 'Ref'),
        width: 96,
        valueGetter: (p: any) => (p.data?.item_number != null ? formatItemRef('capex', p.data.item_number) : ''),
        cellStyle: {
          color: 'var(--kanap-text-secondary)',
          fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
          fontVariantNumeric: 'tabular-nums',
          fontSize: '12px',
        },
        cellRenderer: linkCell('description'),
      },
      {
        field: 'description',
        headerName: t('capex.columns.description'),
        flex: 1,
        minWidth: 220,
        required: true,
        cellRenderer: linkCell('description'),
      },
      {
        colId: 'supplier_name',
        headerName: t('capex.columns.supplier'),
        valueGetter: (p: any) => p.data?.supplier?.name ?? p.data?.supplier_name ?? '',
        width: 180,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('supplier_name'), searchable: false },
        cellRenderer: linkCell('supplier_name'),
      },
      {
        field: 'paying_company_name',
        headerName: t('capex.columns.payingCompany'),
        width: 200,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('paying_company_name'), searchable: false },
        cellRenderer: linkCell('paying_company_name'),
      },
      {
        colId: 'contract_name',
        headerName: t('capex.columns.contract'),
        valueGetter: (p: any) => p.data?.latest_contract_name || '',
        width: 200,
        cellRenderer: linkCell('contract_name'),
      },
      {
        colId: 'account_display',
        headerName: t('capex.columns.account'),
        valueGetter: accountGetter,
        width: 220,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('account_display'), searchable: false },
        cellRenderer: linkCell('account_display'),
      },
      {
        field: 'ppe_type',
        headerName: t('capex.columns.ppeType'),
        width: 140,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('ppe_type', { labelMap: PPE_LABELS }), searchable: false },
        valueFormatter: (p: any) => p.value != null ? (PPE_LABELS[String(p.value)] || String(p.value)) : '',
        cellRenderer: linkCell('ppe_type'),
      },
      {
        field: 'investment_type',
        headerName: t('capex.columns.investmentType'),
        width: 170,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('investment_type', { labelMap: INVESTMENT_LABELS }), searchable: false },
        valueFormatter: (p: any) => p.value != null ? (INVESTMENT_LABELS[String(p.value)] || String(p.value)) : '',
        cellRenderer: linkCell('investment_type'),
      },
      {
        field: 'priority',
        headerName: t('capex.columns.priority'),
        width: 120,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('priority', { labelMap: PRIORITY_LABELS }), searchable: false },
        valueFormatter: (p: any) => p.value != null ? (PRIORITY_LABELS[String(p.value)] || String(p.value)) : '',
        cellRenderer: linkCell('priority'),
      },
      {
        colId: 'allocation_label',
        headerName: t('capex.columns.allocation'),
        valueGetter: (p: any) => p.data?.allocation_method_label ?? '',
        tooltipValueGetter: (p: any) => p.data?.allocation_method_label ?? '',
        width: 180,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('allocation_label'), searchable: false },
        cellRenderer: linkCell('allocation_label'),
      },
      ...buildAmountColumnDefs<SummaryRow>({ t, currentYear: Y, cellRenderer: linkCell, columns: budgetColumns }),
      ...buildFteColumnDefs<SummaryRow>({ t, currentYear: Y, locale, cellRenderer: linkCell, columns: budgetColumns }),
      {
        field: 'currency',
        headerName: t('capex.columns.currency'),
        width: 110,
        defaultHidden: true,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('currency'), searchable: false },
        cellRenderer: linkCell('currency'),
      },
      {
        field: 'effective_start',
        headerName: t('capex.columns.effectiveStart'),
        ...DATE_COLUMN_FILTER,
        width: 150,
        defaultHidden: true,
        valueFormatter: (p: any) => formatShortDate(p.value as string | null, locale),
        cellRenderer: linkCell('effective_start'),
      },
      {
        field: 'disabled_at',
        headerName: t('capex.columns.endOfValidity'),
        width: 150,
        defaultHidden: true,
        ...DATE_COLUMN_FILTER,
        // A timestamp: shown as the calendar day in the viewer's time zone, like the drawer.
        valueFormatter: (p: any) => formatShortDate(p.value ? new Date(p.value as string) : null, locale),
        cellRenderer: linkCell('disabled_at'),
      },
      {
        colId: 'owner_it_name',
        headerName: t('capex.columns.itOwner'),
        valueGetter: (p: any) => p.data?.owner_it_name ?? '',
        width: 200,
        defaultHidden: true,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('owner_it_name'), searchable: false },
        cellRenderer: linkCell('owner_it_name'),
      },
      {
        colId: 'owner_business_name',
        headerName: t('capex.columns.businessOwner'),
        valueGetter: (p: any) => p.data?.owner_business_name ?? '',
        width: 200,
        defaultHidden: true,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('owner_business_name'), searchable: false },
        cellRenderer: linkCell('owner_business_name'),
      },
      // The default dimension keeps its column id, so saved layouts, links and AI filters still find it;
      // every other enabled dimension follows it, in dimension order.
      ...[
        { field: 'analytics_category_name', label: defaultAnalyticsLabel },
        ...analyticsAxes.enabled
          .filter((axis) => !axis.is_default)
          .map((axis) => ({ field: analyticsFieldKey(axis.id), label: analyticsAxes.label(axis) })),
      ].map(({ field, label }) => ({
        field,
        headerName: label,
        width: 200,
        defaultHidden: true,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues(field), searchable: false },
        cellRenderer: linkCell(field),
      })),
      {
        field: 'cost_center_label',
        headerName: t('capex.columns.costCenter'),
        width: 220,
        defaultHidden: true,
        tooltipValueGetter: (p: any) => p.data?.cost_center_path ?? '',
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('cost_center_label'), searchable: true },
        cellRenderer: linkCell('cost_center_label'),
      },
      {
        field: 'budget_holder_name',
        headerName: t('capex.columns.budgetHolder'),
        width: 200,
        defaultHidden: true,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('budget_holder_name'), searchable: false },
        cellRenderer: linkCell('budget_holder_name'),
      },
      {
        field: 'run_build',
        headerName: t('capex.columns.runBuild'),
        width: 140,
        defaultHidden: true,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: getCapexFilterValues('run_build', { labelMap: RUN_BUILD_LABELS }), searchable: false },
        valueFormatter: (p: any) => (p.value != null ? (RUN_BUILD_LABELS[String(p.value)] || String(p.value)) : ''),
        cellRenderer: linkCell('run_build'),
      },
      {
        field: 'project_name',
        headerName: t('capex.columns.project'),
        width: 200,
        defaultHidden: true,
        tooltipValueGetter: (p: any) => p.data?.project_name ?? '',
        cellRenderer: linkCell('project_name'),
      },
      {
        field: 'notes',
        headerName: t('capex.columns.notes'),
        width: 250,
        defaultHidden: true,
        cellRenderer: linkCell('notes'),
      },
      {
        colId: 'latest_task_text',
        headerName: t('capex.columns.task'),
        valueGetter: (p: any) => p.data?.latest_task?.title ?? '',
        tooltipValueGetter: (p: any) => (p.value ? String(p.value) : ''),
        flex: 1,
        minWidth: 220,
        cellRenderer: linkCell('latest_task_text'),
      },
      {
        field: 'status',
        headerName: t('capex.columns.enabled'),
        width: 140,
        ...statusColumnProps(t),
        defaultHidden: true,
        cellRenderer: linkCell('status'),
      },
      {
        field: 'created_at',
        headerName: t('capex.columns.created'),
        ...DATE_COLUMN_FILTER,
        width: 200,
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
        defaultHidden: true,
        cellRenderer: linkCell('created_at'),
      },
      {
        field: 'updated_at',
        headerName: t('capex.columns.updated'),
        ...DATE_COLUMN_FILTER,
        width: 200,
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
        defaultHidden: true,
        cellRenderer: linkCell('updated_at'),
      },
    ];
  }, [Y, analyticsAxes, budgetColumns, defaultAnalyticsLabel, getCapexFilterValues, getCapexHref, INVESTMENT_LABELS, PPE_LABELS, PRIORITY_LABELS, RUN_BUILD_LABELS, locale, navigate, t]);

  const canCreate = hasLevel('capex','manager');
  const canAdmin = hasLevel('capex','admin');

  const actions = (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {canCreate && (
        <Button
          variant="contained"
          onClick={() => {
            const urlParams = new URLSearchParams(window.location.search);
            const stored = storedContextRef.current || readStoredCapexListContext();
            if (stored && !storedContextRef.current) storedContextRef.current = stored;
            const sort = listSort(urlParams.get('sort') || stored?.sort);
            const q = urlParams.get('q') || stored?.q || '';
            const filters = urlParams.get('filters') || stored?.filters || '';
            const sp = new URLSearchParams();
            if (sort) sp.set('sort', sort);
            if (q) sp.set('q', q);
            if (filters) sp.set('filters', filters);
            navigate(`/ops/capex/new?${sp.toString()}`);
          }}
        >{t('capex.newButton')}</Button>
      )}
      {canAdmin && <Button onClick={() => setImportOpen(true)}>{t('capex.importCsv')}</Button>}
      {canAdmin && <Button onClick={() => setExportOpen(true)}>{t('capex.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/capex-items/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.description}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => {
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </Stack>
  );

  if (!hasLevel('capex', 'reader')) {
    return <ForbiddenPage />;
  }

  return (
    <>
      <PageHeader title={t('capex.titleWithCurrency', { currency: reportingCurrency })} actions={actions} />
      {!gridCanMount && (
        // One line while the budget columns setting and the dimensions load: the grid waits for the
        // default sort and the dimension columns.
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: 1 }}>{t('common:status.loading')}</Typography>
      )}
      {gridCanMount && <ServerDataGrid<SummaryRow>
        columns={columns as any}
        endpoint="/capex-items/summary"
        queryKey="capex-summary"
        getRowId={(r) => r.id || '__capex_totals__'}
        enableSearch
        pinnedBottomRowData={pinnedTotals}
        defaultSort={gridDefaultSort}
        statusScopeConfig={{ defaultScope: 'enabled' }}
        columnPreferencesKey="capex-summary"
        initialState={initialGridState}
        refreshKey={refreshKey}
        onGridApiReady={(gridApi) => {
          gridApiRef.current = gridApi;
          // The saved layout is applied by now; the first totals request follows the query state.
          followFteColumns(gridApi?.getColumnState?.());
        }}
        // A saved layout applied before the grid is ready only records the FTE columns: the first
        // totals request comes with the query state, carrying the initial filter.
        onColumnStateChange={followFteColumns}
        onQueryStateChange={(state) => {
          const normalizedSort = listSort(state.sort);
          const filtersObject = state.filterModel || {};
          const filtersString = filtersObject && Object.keys(filtersObject).length > 0 ? JSON.stringify(filtersObject) : '';
          const scope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: normalizedSort, q: state.q || '', filters: filtersObject, filtersString, statusScope: scope };
          const snapshot = { sort: normalizedSort, q: state.q || '', filters: filtersString, statusScope: scope };
          storedContextRef.current = snapshot;
          writeStoredCapexListContext(snapshot);
          // Before the grid is ready it reports its URL sync without the initial filter yet.
          if (gridApiRef.current) followTotalsQuery({ q: state.q || '', filters: filtersString, statusScope: scope });
        }}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
      />}
      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/capex-items" title={t("capex.exportTitle")} />
      <CsvImportDialog open={importOpen} onClose={() => setImportOpen(false)} endpoint="/capex-items" title={t("capex.importTitle")} onImported={() => setRefreshKey((k) => k + 1)} />
    </>
  );
}
