import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ColDef } from 'ag-grid-community';
import ServerDataGrid, { DATE_COLUMN_FILTER, DATE_COLUMN_FILTER_TWO_CONDITIONS, EnhancedColDef, StatusScope, gridSortModel } from '../../components/ServerDataGrid';
import PageHeader from '../../components/PageHeader';
import { Button, Chip, Stack, Typography } from '@mui/material';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import { withCostCenterGroups } from '../../components/grid/costCenterFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { isDataAccessLimited } from '../../auth/dataAccess';
import BudgetFileExportDialog from '../../components/finance/BudgetFileExportDialog';
import BudgetFileImportDialog from '../../components/finance/BudgetFileImportDialog';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { recordsInUseCheck } from '../../utils/deleteCheck';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { formatItemRef } from '../../utils/item-ref';
import { budgetTypeChipSx } from './budgetTypeChipSx';
import {
  amountColumnYear,
  buildAmountColumnDefs,
  buildFteColumnDefs,
  cellFxMissing,
  explicitSort,
  fteTotalsToRow,
  pendingAmountsField,
  totalsToVersions,
  SummaryVersions,
  visibleAmountFields,
  visibleFteFields,
} from '../../components/finance/amountColumns';
import { compactListSearchCached, filtersNeedContext, listFiltersOf, getWithListContext, parseListFilters } from '../../lib/listContext';
import { isReportView, markReportView, snapshotFilters, useSettledListSearch, writeListSnapshot } from '../../hooks/useListContextSearch';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { analyticsListColumns, useAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { readStoredBudgetListContext, writeStoredBudgetListContext } from './listContextStorage';
import { statusScopeParams } from '../../utils/statusScopeParams';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import ForbiddenPage from '../ForbiddenPage';
import { budgetListFieldPredicate } from './listFields';
import { useTenant } from '../../tenant/TenantContext';
import { migrateBudgetGridLayout, type BudgetNatureScope, natureScopeOf } from './listPreferences';
import BudgetTotalCell from './BudgetTotalCell';
import { statusColumnProps } from '../../components/grid/statusColumn';
import FxMissingNotice, { FxMissingMark } from '../../components/finance/FxMissingNotice';
import { ImportLabel } from '../../components/csv/importFiles';
import { allocationListLabel } from '../../utils/allocationLabels';

/** A cell amount in the line currency (its year has no exchange rate): secondary text, visited or not. */
const LOCAL_AMOUNT_LINK_SX = { color: 'kanap.text.secondary', '&:visited, &:hover': { color: 'kanap.text.secondary' } } as const;

/**
 * A line as the list reads it: the grid shape of `/budget-lines/summary` (`shape=grid`), which
 * carries these keys only (backend `gridRow`), plus `analytics_<axis id>` for the enabled
 * dimensions and the `fte_*` keys of the FTE columns shown.
 */
type SummaryRow = {
  id: string;
  item_number: number;
  nature: 'opex' | 'capex';
  product_name: string;
  description?: string | null;
  supplier_name?: string | null;
  currency: string;
  effective_start: string;
  disabled_at?: string | null;
  status: string;
  analytics_category_name?: string | null;
  cost_center_id?: string | null;
  cost_center_label?: string | null;
  cost_center_path?: string | null;
  budget_holder_name?: string | null;
  run_build?: 'run' | 'build' | null;
  /** 'yes' when the line declares FTE in some year and column, else null. */
  has_fte?: 'yes' | null;
  project_name?: string | null;
  notes?: string | null;
  created_at: string;
  updated_at?: string;
  versions?: SummaryVersions;
  latest_task?: { title?: string | null } | null;
  latest_contract_id?: string | null;
  latest_contract_name?: string | null;
  /** A limited person cannot read the contract: no id, no name, the label alone (spec §5.4). */
  contract_hidden?: boolean;
  allocation_method_label?: string | null;
  paying_company_name?: string | null;
  account_display?: string | null;
  account_warning?: string | null;
  owner_it_name?: string | null;
  owner_business_name?: string | null;
};

/** The query the footer totals follow: the list state without the sort, plus the amount and FTE columns shown. */
type TotalsQuery = { q: string; filters: string; statusScope: StatusScope; fte: string; amounts: string };

const TOTALS_QUERY_KEY = 'budget-summary-totals';
const ROWS_ENDPOINT = '/budget-lines/summary';
const TOTALS_ENDPOINT = '/budget-lines/summary/totals';
const VALUES_ENDPOINT = '/budget-lines/summary/filter-values';

/** The footer total keeps its previous amounts while newly shown columns load. */
function useListTotals(query: TotalsQuery | null) {
  return useQuery({
    queryKey: [TOTALS_QUERY_KEY, query],
    queryFn: async ({ signal }) => {
      const params: Record<string, any> = {};
      if (query!.q) params.q = query!.q;
      if (query!.filters) params.filters = query!.filters;
      Object.assign(params, statusScopeParams(query!.statusScope));
      if (query!.fte) params.fte = query!.fte;
      params.amounts = query!.amounts;
      const res = await getWithListContext(TOTALS_ENDPOINT, params, { signal });
      return res.data;
    },
    enabled: query != null,
    placeholderData: keepPreviousData,
    staleTime: 0,
    retry: false,
  });
}

/**
 * Parameters of the page requests: the lean grid rows, with the FTE keys of the FTE columns shown
 * (showing or hiding one reloads the rows).
 */
const pageParams = (state: Parameters<typeof visibleFteFields>[0]) => ({ shape: 'grid', fte: visibleFteFields(state).join(',') });

/**
 * The list, mounted afresh when the address enters or leaves a one-off view opened from a report
 * (`?from=report`): the menu's link to the list, followed from that view, then opens on the tab's own
 * list state instead of keeping the report's filters and Show scope on screen.
 */
export default function BudgetListPage() {
  const location = useLocation();
  const { profile } = useAuth();
  const { tenantSlug } = useTenant();
  return <BudgetListPageView key={`${tenantSlug}:${profile?.id}:${isReportView(location.search) ? 'report' : 'list'}`} />;
}

function BudgetListPageView() {
  const { hasLevel, profile, dataAccess } = useAuth();
  const { tenantSlug } = useTenant();
  // Run before ServerDataGrid reads its saved columns.
  useMemo(() => migrateBudgetGridLayout(tenantSlug, profile?.id), [tenantSlug, profile?.id]);
  const { t } = useTranslation(['ops', 'common']);
  const locale = useLocale();
  const budgetColumns = useBudgetColumns();
  const analyticsAxes = useAnalyticsAxes();
  const queryClient = useQueryClient();

  const navigate = useNavigate();
  const location = useLocation();
  // The nature the Type column's filter keeps: one nature, or 'all' (no filter, both, or none).
  // It picks what "New line" opens and the import's default nature.
  const [natureScope, setNatureScope] = useState<BudgetNatureScope>(
    () => natureScopeOf(parseListFilters(listFiltersOf(new URLSearchParams(location.search)))?.nature),
  );
  const Y = new Date().getFullYear();

  // `serverOrder`: the options keep the server's order (a dimension's values, in the dimension's
  // order) instead of their labels' alphabetical order; blank stays last.
  const getBudgetFilterValues = useCallback((field: string, opts?: { emptyLabel?: string; labelMap?: Record<string, string>; serverOrder?: boolean }) => {
    const emptyLabel = opts?.emptyLabel ?? t('shared.blank');
    const labelMap = opts?.labelMap;
    const serverOrder = !!opts?.serverOrder;
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
      const res = await getWithListContext(VALUES_ENDPOINT, params);
      const values = (res.data?.[field] || []) as Array<string | null>;
      const options = values.map((value) => {
        if (value == null) return { value, label: emptyLabel };
        const key = String(value);
        const label = labelMap && Object.prototype.hasOwnProperty.call(labelMap, key) ? labelMap[key] : key;
        return { value, label };
      });
      options.sort((a, b) => {
        if (a.value == null) return b.value == null ? 0 : 1;
        if (b.value == null) return -1;
        return serverOrder ? 0 : (a.label || '').localeCompare(b.label || '');
      });
      return options;
    };
  }, [t]);

  const RUN_BUILD_LABELS: Record<string, string> = useMemo(() => ({
    run: t('opex.runBuild.run'),
    build: t('opex.runBuild.build'),
  }), [t]);

  const FTE_DECLARED_LABELS: Record<string, string> = useMemo(() => ({ yes: t('shared.fteDeclaredYes') }), [t]);

  const gridApiRef = useRef<any>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [filteredCount, setFilteredCount] = useState<number | null>(null);
  const [selectedRows, setSelectedRows] = useState<SummaryRow[]>([]);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; filtersString: string; statusScope?: StatusScope } | null>(null);
  // A list opened from a report row is a one-off view (`?from=report`): it neither reads nor writes
  // the tab's stored list context, its state lives in its address only.
  const reportViewRef = useRef(isReportView(location.search));
  reportViewRef.current = isReportView(location.search);
  const storedContextRef = useRef(reportViewRef.current ? null : readStoredBudgetListContext());
  /** The tab's stored list context; none in a one-off view. */
  const storedContext = useCallback(() => {
    if (reportViewRef.current) return null;
    const stored = storedContextRef.current || readStoredBudgetListContext();
    if (stored && !storedContextRef.current) storedContextRef.current = stored;
    return stored;
  }, []);
  // The default sort and the shown columns come from the budget columns setting; callbacks
  // created once read them here.
  const budgetColumnsRef = useRef(budgetColumns);
  budgetColumnsRef.current = budgetColumns;
  // The dimension columns the list builds: a sort or filter on another dimension falls back like a hidden amount column.
  const isListField = useMemo(
    () => budgetListFieldPredicate(analyticsAxes.enabled.filter((axis) => !axis.is_default).map((axis) => axis.id)),
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
  // Filters saved as a context (`ctx`, too long for a URL) are read first; long ones go back as `ctx`.
  const readStored = storedContext;
  // The filters of a link were lost: the stored list context forgets its own too (the list opens
  // unfiltered, and the next settling of the address must not bring them back).
  const dropStoredFilters = useCallback(() => {
    const stored = storedContext();
    if (!stored) return;
    const { ctx: _ctx, ...rest } = stored;
    const next = { ...rest, filters: '' };
    storedContextRef.current = next;
    writeStoredBudgetListContext(next);
  }, [storedContext]);
  const settledSearch = useSettledListSearch({
    endpoint: ROWS_ENDPOINT,
    search: location.search,
    readStored,
    ready: budgetColumns.ready && analyticsAxes.ready,
    shown: budgetColumns.shown,
    defaultSort: budgetColumns.defaultSort,
    isListField,
    dropStoredFilters,
  });
  const currentSearch = new URLSearchParams(location.search).toString();
  useEffect(() => {
    if (settledSearch != null && settledSearch !== currentSearch) navigate({ search: settledSearch }, { replace: true });
  }, [settledSearch, currentSearch, navigate]);
  const [gridMounted, setGridMounted] = useState(false);
  const gridCanMount = gridMounted || (settledSearch != null && settledSearch === currentSearch);
  useEffect(() => { if (gridCanMount && !gridMounted) setGridMounted(true); }, [gridCanMount, gridMounted]);

  const initialGridState = useMemo(() => {
    if (!gridCanMount) return undefined;
    const raw = listFiltersOf(new URLSearchParams(location.search));
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
  // The footer follows the query the grid reports once it is ready (see onQueryStateChange), and
  // the FTE columns it shows: one request per distinct query, none on a sort (the key leaves it
  // out). The grid reports the same query several times while it starts (URL sync, initial sort,
  // grid ready); the key stays the same. A superseded request is cancelled through its signal.
  const [totalsQuery, setTotalsQuery] = useState<Omit<TotalsQuery, 'fte' | 'amounts'> | null>(null);
  const [columnFields, setColumnFields] = useState<{ fte: string; amounts: string } | null>(null);
  const followTotalsQuery = useCallback((next: Omit<TotalsQuery, 'fte' | 'amounts'>) => {
    setTotalsQuery((prev) => (prev && prev.q === next.q && prev.filters === next.filters && prev.statusScope === next.statusScope ? prev : next));
  }, []);
  // Showing or hiding an amount or FTE column refetches the footer with the columns now shown.
  const followColumns = useCallback((state: Parameters<typeof visibleFteFields>[0]) => {
    const fte = visibleFteFields(state).join(',');
    const amounts = visibleAmountFields(state).join(',');
    setColumnFields((prev) => (prev && prev.fte === fte && prev.amounts === amounts ? prev : { fte, amounts }));
  }, []);
  const totalsScope = natureScopeOf(parseListFilters(totalsQuery?.filters)?.nature);
  const footerQuery = totalsQuery && columnFields ? { ...totalsQuery, ...columnFields } : null;
  const totals = useListTotals(footerQuery);
  const pinnedTotals = useMemo(() => {
    if (!totals.data || totals.isError) return [];
    return [{
      id: '__budget_totals__',
      product_name: filteredCount == null ? t('shared.total') : t('budget.totalWithCount', { count: filteredCount }),
      ...(totalsScope === 'all' ? {} : { nature: totalsScope }),
      versions: totalsToVersions(totals.data),
      ...fteTotalsToRow(totals.data.fte),
      ...pendingAmountsField(totals.data, columnFields?.amounts),
    }];
  }, [totals.data, totals.isError, totalsScope, columnFields, filteredCount, t]);

  // A delete or an import changes the lines without changing the query: ask again for the same one.
  useEffect(() => {
    if (!refreshKey) return;
    queryClient.invalidateQueries({ queryKey: [TOTALS_QUERY_KEY] });
  }, [refreshKey, queryClient]);

  const lastCurrencyRef = useRef<string | null>(null);
  if (typeof totals.data?.reportingCurrency === 'string') lastCurrencyRef.current = totals.data.reportingCurrency;
  const reportingCurrency = lastCurrencyRef.current ?? 'EUR';
  // The amounts the footer totals leave out for lack of an exchange rate, named under the grid.
  const fxMissing = totals.isError ? undefined : totals.data?.fxMissing;

  const openNew = (nature: 'opex' | 'capex') => {
    const sp = buildGridSearch();
    sp.set('list', 'budget');
    navigate(`/ops/budget/new?nature=${nature}&${compactListSearchCached(sp.toString(), ROWS_ENDPOINT)}`);
  };

  const canCreate = hasLevel('budget', 'manager');
  const canAdmin = hasLevel('budget', 'admin');
  // Deleting lines is reserved to people with access to all data (spec §2.7): no selection either.
  const canDelete = canAdmin && !isDataAccessLimited(dataAccess);
  const actions = (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={() => openNew(natureScope === 'all' ? 'opex' : natureScope)}
        >
          {t('budget.newLine')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('opex.importCsv')} /></Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>}
      {canDelete && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/budget-lines/bulk"
          // Asked on click: a line with amounts in a frozen column is kept, with the column and year.
          checkDelete={(ids) => recordsInUseCheck('/budget-lines', ids)}
          itemLabels={{
            toDelete: (count) => t('budget.delete.toDelete', { count }),
            kept: (count) => t('budget.delete.kept', { count }),
            deleted: (count) => t('budget.delete.deleted', { count }),
          }}
          getItemId={(row) => row.id}
          getItemName={(row) => row.product_name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => {
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </Stack>
  );

  const buildGridSearch = useCallback(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const stored = storedContext();
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
    if (!filters) filters = snapshotFilters(stored);
    const sp = new URLSearchParams();
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters) sp.set('filters', filters);
    // Item links of a one-off view keep it, with its Show scope: the item page walks the same lines
    // and leaves the stored list context alone.
    if (reportViewRef.current) markReportView(sp, lastQueryRef.current?.statusScope);
    return sp;
  }, [storedContext]);

  // The list part of the cell links, built once per list state (each grid report replaces
  // lastQueryRef.current) rather than once per cell. Filters too long for a URL go as `ctx`, once
  // the list's page request has saved them (before any row shows); until then the link keeps them.
  const gridSearchCacheRef = useRef<{ state: unknown; search: string; final: boolean } | null>(null);
  const gridSearch = useCallback(() => {
    const state = lastQueryRef.current;
    const cached = gridSearchCacheRef.current;
    if (state && cached && cached.state === state && cached.final) return cached.search;
    const search = compactListSearchCached(buildGridSearch().toString(), ROWS_ENDPOINT);
    const sp = new URLSearchParams(search);
    if (state) gridSearchCacheRef.current = { state, search, final: !filtersNeedContext(sp.get('filters')) };
    return search;
  }, [buildGridSearch]);

  const getBudgetHref = useCallback((row: unknown, colId?: string) => {
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
    next.set('list', 'budget');
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
    const ref = item.item_number != null ? formatItemRef('budget', item.item_number) : item.id;
    return `/ops/budget/${ref}/${tab}?${next.toString()}`;
  }, [Y, gridSearch]);

  const defaultAnalyticsLabel = analyticsAxes.label(analyticsAxes.defaultAxis ?? { name: null });

  const columns: ColDef<SummaryRow>[] = useMemo(() => [
    {
      colId: 'item_number',
      headerName: t('opex.columns.reference'),
      // Room for the header and its filter text.
      width: 130,
      minWidth: 130,
      valueGetter: (p) => (p.data?.item_number != null ? formatItemRef('budget', p.data.item_number) : ''),
      cellStyle: {
        color: 'var(--kanap-text-secondary)',
        fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
        fontVariantNumeric: 'tabular-nums',
        fontSize: '12px',
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'product_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'nature',
      headerName: t('budget.type'),
      valueFormatter: (params) => params.value ? t(`budget.${params.value}`) : '',
      width: 110,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('nature', { labelMap: { opex: t('budget.opex'), capex: t('budget.capex') } }),
        searchable: false,
      },
      cellRenderer: (params: any) => params.node?.rowPinned || !params.value ? null : (
        <Chip
          size="small"
          label={t(`budget.${params.value}`)}
          sx={budgetTypeChipSx}
        />
      ),
    },
    {
      field: 'product_name',
      headerName: t('opex.columns.productName'),
      flex: 1,
      minWidth: 220,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'product_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'supplier_name',
      headerName: t('opex.columns.supplier'),
      valueGetter: (p) => p.data?.supplier_name ?? '',
      width: 180,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('supplier_name'),
        searchable: false,
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'supplier_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'paying_company_name',
      headerName: t('opex.columns.payingCompany'),
      width: 200,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('paying_company_name'),
        searchable: false,
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'paying_company_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'contract_name',
      headerName: t('opex.columns.contract'),
      valueGetter: (p) => (p.data?.contract_hidden ? t('contracts.outsideYourAccess') : p.data?.latest_contract_name || ''),
      width: 200,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'contract_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'account_display',
      headerName: t('opex.columns.account'),
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('account_display'),
        searchable: false,
      },
      // "6110 - Software", or the number alone for an account without a name (the server's text,
      // the one the filter values and the sort use).
      valueGetter: (p) => p.data?.account_display ?? '',
      width: 220,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'account_display')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    // The account by id, for a report link (a consolidation line opens the list on its accounts:
    // account names repeat across charts of accounts). Hidden and kept out of the column chooser, like
    // the link filters of the tasks list; the column has to exist, or the grid would drop the model.
    {
      colId: 'account_id',
      headerName: t('opex.columns.account'),
      hide: true,
      defaultHidden: true,
      suppressColumnsToolPanel: true,
      filter: CheckboxSetFilter,
      filterParams: { values: [] },
      sortable: false,
    },
    // Lines whose account belongs to another chart of accounts than the paying company's: the
    // filter the overview's data hygiene count opens the list with. Hidden by default.
    {
      colId: 'account_warning',
      headerName: t('shared.accountCheck'),
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: { values: [{ value: 'coa_mismatch', label: t('shared.accountOutsideChart') }], searchable: false },
      valueGetter: (p) => (p.data?.account_warning === 'coa_mismatch' ? t('shared.accountOutsideChart') : ''),
      width: 220,
      defaultHidden: true,
      sortable: false,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'account_display')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'allocation_label',
      headerName: t('opex.columns.allocation'),
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        // No label on the options: `labelFormatter` translates the checkbox, and the value
        // sent to the API stays the server's English constant.
        getValues: async (ctx: any) => {
          const options = await getBudgetFilterValues('allocation_label')(ctx);
          return options.map(({ value }) => ({ value }));
        },
        labelFormatter: (value: string | null) => (value ? allocationListLabel(t, value) : t('shared.blank')),
        sortComparator: (a: { value: string | null; label?: string }, b: { value: string | null; label?: string }) => {
          if (a.value == null) return b.value == null ? 0 : 1;
          if (b.value == null) return -1;
          return (a.label || '').localeCompare(b.label || '', locale);
        },
        searchable: false,
      },
      valueGetter: (p) => p.data?.allocation_method_label ?? '',
      valueFormatter: (p) => allocationListLabel(t, p.value == null ? '' : String(p.value)),
      tooltipValueGetter: (p) => allocationListLabel(t, p.data?.allocation_method_label),
      width: 180,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'allocation_label')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    ...buildAmountColumnDefs<SummaryRow>({
      t,
      currentYear: Y,
      locale,
      columns: budgetColumns,
      cellRenderer: (colId) => (params: any) => {
        // No exchange rate that year: the amount in the line currency, marked, left out of the totals.
        const missing = cellFxMissing(params.data, colId, Y);
        return (
          <LinkCellRenderer
            {...params}
            linkType="internal"
            getHref={(row) => getBudgetHref(row, colId)}
            onNavigate={(href) => navigate(href)}
            linkSx={missing ? LOCAL_AMOUNT_LINK_SX : undefined}
            endAdornment={missing ? <FxMissingMark currency={missing.currency} year={missing.year} /> : undefined}
          />
        );
      },
    }).map(({ cellRenderer, ...column }) => ({
      ...column,
      // ServerDataGrid suppresses cellRenderer on pinned rows; a selector preserves the footer.
      cellRendererSelector: (params: any) => params.node?.rowPinned ? {
        component: (props: any) => <BudgetTotalCell colId={column.colId!} nature={props.data?.nature}>{props.valueFormatted ?? props.value}</BudgetTotalCell>,
      } : { component: cellRenderer },
    })),
    ...buildFteColumnDefs<SummaryRow>({
      t,
      currentYear: Y,
      locale,
      columns: budgetColumns,
      cellRenderer: (colId) => (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, colId)}
          onNavigate={(href) => navigate(href)}
        />
      ),
    }).map((column) => {
      const selector = column.cellRendererSelector!;
      return { ...column, cellRendererSelector: (params: any) => {
        const selected = selector(params);
        if (!params.node?.rowPinned || !selected) return selected;
        const Total = selected.component;
        return { component: (props: any) => <BudgetTotalCell colId={column.colId!} nature={props.data?.nature}><Total {...props} /></BudgetTotalCell> };
      } };
    }),
    // Whether the line declares FTE in some year and column: the reports' "Items with FTE" filter.
    {
      colId: 'has_fte',
      headerName: t('shared.fteDeclared'),
      valueGetter: (p) => (p.data?.has_fte === 'yes' ? FTE_DECLARED_LABELS.yes : ''),
      width: 140,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('has_fte', { labelMap: FTE_DECLARED_LABELS, emptyLabel: t('shared.fteDeclaredNo') }),
        searchable: false,
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'has_fte')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'latest_task_text',
      headerName: t('opex.columns.task'),
      valueGetter: (p) => p.data?.latest_task?.title ?? '',
      tooltipValueGetter: (p) => (p.value ? String(p.value) : ''),
      flex: 1,
      minWidth: 220,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'latest_task_text')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'status',
      headerName: t('opex.columns.enabled'),
      width: 140,
      ...statusColumnProps(t),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'status')}
          onNavigate={(href) => navigate(href)}
        />
      ),
      defaultHidden: true,
    },
    {
      field: 'description',
      headerName: t('opex.columns.description'),
      width: 250,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'description')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'currency',
      headerName: t('opex.columns.currency'),
      width: 110,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('currency'),
        searchable: false,
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'currency')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'effective_start',
      headerName: t('opex.columns.effectiveStart'),
      ...DATE_COLUMN_FILTER,
      width: 150,
      defaultHidden: true,
      valueFormatter: (p) => formatShortDate(p.value as string | null, locale),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'effective_start')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'disabled_at',
      headerName: t('opex.columns.endOfValidity'),
      // Room for its filter in words: "Blank or after 31 Dec 2024" and the clear button.
      width: 260,
      defaultHidden: true,
      // Two conditions: a report link opens the list on "blank, or after 31 December" (its window).
      ...DATE_COLUMN_FILTER_TWO_CONDITIONS,
      // A timestamp: shown as the calendar day in the viewer's time zone, like the drawer.
      valueFormatter: (p) => formatShortDate(p.value ? new Date(p.value as string) : null, locale),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'disabled_at')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'owner_it_name',
      headerName: t('opex.columns.itOwner'),
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('owner_it_name'),
        searchable: false,
      },
      valueGetter: (p) => p.data?.owner_it_name ?? '',
      width: 200,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'owner_it_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      colId: 'owner_business_name',
      headerName: t('opex.columns.businessOwner'),
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('owner_business_name'),
        searchable: false,
      },
      valueGetter: (p) => p.data?.owner_business_name ?? '',
      width: 200,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'owner_business_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    // One column per enabled dimension, in dimension order. The default dimension keeps its column
    // id wherever it stands, so saved layouts, links and AI filters still find it. A dimension
    // required for OPEX lines shows by default (lot C1, decision 3); a saved layout still decides.
    ...analyticsListColumns(analyticsAxes, defaultAnalyticsLabel).map(({ field, label, required }): EnhancedColDef<SummaryRow> => ({
      colId: field,
      headerName: label,
      valueGetter: (p) => (p.data as Record<string, unknown> | undefined)?.[field] ?? '',
      width: 200,
      defaultHidden: !required,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues(field, { serverOrder: true }),
        searchable: false,
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, field)}
          onNavigate={(href) => navigate(href)}
        />
      ),
    })),
    {
      field: 'cost_center_label',
      headerName: t('opex.columns.costCenter'),
      width: 220,
      defaultHidden: true,
      tooltipValueGetter: (p) => p.data?.cost_center_path ?? '',
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: withCostCenterGroups(getBudgetFilterValues('cost_center_label'), queryClient),
        searchable: true,
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'cost_center_label')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'budget_holder_name',
      headerName: t('opex.columns.budgetHolder'),
      width: 200,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('budget_holder_name'),
        searchable: false,
      },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'budget_holder_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'run_build',
      headerName: t('opex.columns.runBuild'),
      width: 140,
      defaultHidden: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getBudgetFilterValues('run_build', { labelMap: RUN_BUILD_LABELS }),
        searchable: false,
      },
      valueFormatter: (p) => (p.value != null ? (RUN_BUILD_LABELS[String(p.value)] || String(p.value)) : ''),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'run_build')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'project_name',
      headerName: t('opex.columns.project'),
      width: 200,
      defaultHidden: true,
      tooltipValueGetter: (p) => p.data?.project_name ?? '',
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'project_name')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'notes',
      headerName: t('opex.columns.notes'),
      width: 250,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'notes')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'created_at',
      headerName: t('opex.columns.created'),
      ...DATE_COLUMN_FILTER,
      width: 200,
      valueFormatter: (p) => formatShortDateTime(p.value as string | null, locale),
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'created_at')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'updated_at',
      headerName: t('opex.columns.updated'),
      ...DATE_COLUMN_FILTER,
      width: 200,
      valueFormatter: (p) => formatShortDateTime(p.value as string | null, locale),
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getBudgetHref(row, 'updated_at')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
  ], [Y, analyticsAxes, budgetColumns, defaultAnalyticsLabel, getBudgetFilterValues, getBudgetHref, RUN_BUILD_LABELS, FTE_DECLARED_LABELS, locale, navigate, queryClient, t]);

  if (!hasLevel('budget', 'reader')) {
    return <ForbiddenPage resource="budget" level="reader" />;
  }

  return (
    <>
      <PageHeader title={t('budget.titleWithCurrency', { currency: reportingCurrency })} actions={actions} />
      {!gridCanMount && (
        // One line while the budget columns setting and the dimensions load: the grid waits for the
        // default sort and the dimension columns.
        <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary', py: 1 }}>{t('common:status.loading')}</Typography>
      )}
      {gridCanMount && <ServerDataGrid<SummaryRow>
        columns={columns}
        endpoint={ROWS_ENDPOINT}
        queryKey="budget-lines-summary"
        getRowId={(r) => r.id || '__budget_totals__'}
        enableSearch
        pinnedBottomRowData={pinnedTotals}
        defaultSort={gridDefaultSort}
        // A link's filter on a hidden column (the overview's hygiene counts) shows that column.
        showFilteredColumns
        // Next to the name, so they are on screen: the reason the list is narrowed.
        filteredColumnsAfter="product_name"
        statusScopeConfig={{ defaultScope: 'enabled' }}
        columnPreferencesKey="budget-summary"
        initialState={initialGridState}
        refreshKey={refreshKey}
        onGridApiReady={(gridApi) => {
          gridApiRef.current = gridApi;
          // The settled address carries the opening filters (a link's, or the stored list context's).
          setNatureScope(natureScopeOf(parseListFilters(listFiltersOf(new URLSearchParams(location.search)))?.nature));
          // The saved layout is applied by now; the first totals request follows the query state.
          followColumns(gridApi?.getColumnState?.());
        }}
        // A saved layout applied before the grid is ready only records the columns: the first
        // totals request comes with the query state, carrying the initial filter.
        onColumnStateChange={followColumns}
        pageParams={pageParams}
        // The engine honours "every value but these" on every column (decision Q3).
        setFilterExcludeMode
        onTotalChange={setFilteredCount}
        onQueryStateChange={(state) => {
          const normalizedSort = listSort(state.sort);
          const filtersObject = state.filterModel || {};
          if (gridApiRef.current) setNatureScope(natureScopeOf(filtersObject.nature));
          const filtersString = filtersObject && Object.keys(filtersObject).length > 0 ? JSON.stringify(filtersObject) : '';
          const scope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: normalizedSort, q: state.q || '', filters: filtersObject, filtersString, statusScope: scope };
          // A one-off view keeps its state in its address only (see reportViewRef).
          if (!reportViewRef.current) {
            const snapshot = { sort: normalizedSort, q: state.q || '', filters: filtersString, statusScope: scope };
            storedContextRef.current = snapshot;
            writeListSnapshot(ROWS_ENDPOINT, snapshot, readStoredBudgetListContext, writeStoredBudgetListContext);
          }
          // Before the grid is ready it reports its URL sync without the initial filter yet.
          if (gridApiRef.current) followTotalsQuery({ q: state.q || '', filters: filtersString, statusScope: scope });
        }}
        enableRowSelection={canDelete}
        onSelectionChanged={setSelectedRows}
        footer={fxMissing?.length ? <FxMissingNotice items={fxMissing} /> : undefined}
      />}
      <BudgetFileExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        scope="all"
        columnsReady={budgetColumns.ready}
        columns={budgetColumns.all.map((column) => ({ key: column.freezeKey, label: column.label, shown: column.enabled }))}
        filteredCount={filteredCount}
        list={{
          sort: lastQueryRef.current?.sort ?? '',
          q: lastQueryRef.current?.q ?? '',
          filters: lastQueryRef.current?.filtersString ?? '',
          statusScope: lastQueryRef.current?.statusScope ?? 'enabled',
        }}
      />
      <BudgetFileImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        scope={natureScope === 'capex' ? 'capex' : 'opex'}
        canCreateSuppliers={hasLevel('suppliers', 'member')}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
