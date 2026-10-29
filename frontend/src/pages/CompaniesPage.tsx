import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack } from '@mui/material';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope, type ListRequest } from '../components/ServerDataGrid';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { recordsInUseCheck } from '../utils/deleteCheck';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { getWithListContext } from '../lib/listContext';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';
import { metricValueFormatter } from '../components/grid/metricValueFormatter';
import FxMissingNotice, { FxMissingMark } from '../components/finance/FxMissingNotice';
import { companyTurnoverFxMissing, companyTurnoverFxNotice, type CompanyTurnoverFxMissing } from './companies/turnoverFxNotice';
import { companyListYear } from './companies/companyYear';
import ListYearField from '../components/navigation/ListYearField';
import { displayedCompanyCity } from './companies/companyCity';
import { ImportLabel } from '../components/csv/importFiles';

/** The pinned total, with the orange mark when some turnover was left out. */
function TurnoverTotalCell({ value, missing }: { value: React.ReactNode; missing: CompanyTurnoverFxMissing[] }) {
  const { t } = useTranslation(['master-data', 'ops']);
  const mark = missing.length === 1
    ? <FxMissingMark currency={missing[0].currency} year={missing[0].year} />
    : <FxMissingMark label={companyTurnoverFxNotice(t, missing)} />;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-end', width: '100%', fontVariantNumeric: 'tabular-nums' }}>
      {value}
      {mark}
    </Box>
  );
}

type CompanyRow = {
  id: string;
  name: string;
  country_iso: string;
  city?: string | null;
  postal_code?: string | null;
  address1?: string | null;
  address2?: string | null;
  state?: string | null;
  notes?: string | null;
  base_currency?: string | null;
  headcount_year?: number | null;
  it_users_year?: number | null;
  turnover_year?: number | null;
  status: string;
  created_at?: string;
};

export default function CompaniesPage() {
  const { t } = useTranslation(['master-data', 'common', 'ops']);
  const locale = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasLevel } = useAuth();

  if (!hasLevel('companies', 'reader')) {
    return <ForbiddenPage resource="companies" level="reader" />;
  }

  const currentYear = new Date().getFullYear();
  const initialYear = companyListYear(searchParams.get('year') ?? '') ?? currentYear;
  const [year, setYear] = useState<number>(initialYear);
  // The field may hold a partial year. Requests stay on `year` until it is complete.
  const [yearDraft, setYearDraft] = useState(String(initialYear));

  // Follows the address bar (back and forward). Depends on the parameter alone:
  // the year this page writes is already that parameter, and running again when
  // `year` changes requests the year a second time.
  useEffect(() => {
    const parsed = companyListYear(searchParams.get('year') ?? '');
    if (parsed == null || parsed === year) return;
    setYear(parsed);
    setYearDraft(String(parsed));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `year` is compared; re-running when it changes fights the write
  }, [searchParams]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  // The list on screen: the CSV export follows it.
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<CompanyRow[]>([]);
  const gridApiRef = useRef<any>(null);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
  const totalsKeyRef = useRef('');
  const totalsGen = useRef(0);
  const [pinnedTotals, setPinnedTotals] = useState<any[]>([]);

  const updateSearchYear = useCallback((nextYear: number) => {
    setYear(nextYear);
    const next = new URLSearchParams(searchParams);
    next.set('year', String(nextYear));
    setSearchParams(next, { replace: true });
    setRefreshKey((k) => k + 1);
  }, [searchParams, setSearchParams]);

  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'headcount_year:DESC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters && Object.keys(filters).length > 0) sp.set('filters', JSON.stringify(filters));
    // The grid's status scope, so prev/next in the workspace walks the same set.
    const statusScope = lastQueryRef.current?.statusScope;
    if (statusScope) sp.set('scope', statusScope);
    sp.set('year', String(year));
    return sp;
  }, [year]);

  const openWorkspace = useCallback((row: CompanyRow, tab: 'overview' | 'details') => {
    if (!row?.id) return;
    const sp = buildWorkspaceSearch();
    navigate(`/master-data/companies/${row.id}/${tab}?${sp.toString()}`);
  }, [buildWorkspaceSearch, navigate]);

  const handleMetricClick = useCallback((row: CompanyRow) => {
    openWorkspace(row, 'details');
  }, [openWorkspace]);

  const getWorkspaceHref = useCallback((row: unknown, tab: 'overview' | 'details') => {
    const company = row as CompanyRow | null | undefined;
    if (!company?.id) return null;
    const sp = buildWorkspaceSearch();
    return `/master-data/companies/${company.id}/${tab}?${sp.toString()}`;
  }, [buildWorkspaceSearch]);

  const columns: EnhancedColDef<CompanyRow>[] = useMemo(() => [
    {
      field: 'name',
      headerName: t('shared.columns.name'),
      flex: 1,
      required: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'country_iso',
      headerName: t('shared.columns.country'),
      width: 120,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'city',
      headerName: t('companies.columns.city'),
      width: 140,
      defaultHidden: true,
      valueFormatter: (params: { value?: string | null }) => displayedCompanyCity(params.value),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'postal_code',
      headerName: t('companies.columns.postalCode'),
      width: 150,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'address1',
      headerName: t('companies.columns.address1'),
      width: 220,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'address2',
      headerName: t('companies.columns.address2'),
      width: 220,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'state',
      headerName: t('companies.columns.state'),
      width: 140,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'notes',
      headerName: t('shared.columns.notes'),
      width: 260,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'base_currency',
      headerName: t('companies.columns.currency'),
      width: 110,
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'headcount_year',
      valueFormatter: metricValueFormatter('count'),
      headerName: t('companies.columns.headcountYear', { year }),
      width: 150,
      filter: 'agNumberColumnFilter',
      filterParams: { suppressAndOrCondition: true },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'details')}
          onNavigate={(href) => navigate(href)}
          linkSx={{
            color: 'inherit',
            textDecoration: 'none',
            '&:visited': { color: 'inherit' },
            '&:hover': { color: 'inherit' },
          }}
        />
      ),
    },
    {
      field: 'it_users_year',
      valueFormatter: metricValueFormatter('count'),
      headerName: t('companies.columns.itUsersYear', { year }),
      width: 150,
      filter: 'agNumberColumnFilter',
      filterParams: { suppressAndOrCondition: true },
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'details')}
          onNavigate={(href) => navigate(href)}
          linkSx={{
            color: 'inherit',
            textDecoration: 'none',
            '&:visited': { color: 'inherit' },
            '&:hover': { color: 'inherit' },
          }}
        />
      ),
    },
    {
      field: 'turnover_year',
      // Each row in millions of its base currency; the Total in the reporting currency.
      valueFormatter: (params: any) => {
        const value = metricValueFormatter('decimal')(params);
        const currency = params.node?.rowPinned ? params.data?.turnover_currency : params.data?.base_currency;
        if (params.value == null || !currency) return value;
        return t('ops:shared.turnoverMillions', { value, currency });
      },
      headerName: t('companies.columns.turnoverYear', { year }),
      width: 170,
      filter: 'agNumberColumnFilter',
      filterParams: { suppressAndOrCondition: true },
      // ServerDataGrid drops cellRenderer on a pinned row. The selector keeps the mark on the total.
      cellRendererSelector: (params: any) => {
        if (params.node?.rowPinned) {
          const missing = companyTurnoverFxMissing(params.data?.turnover_fx_missing);
          if (!missing.length) return undefined;
          return {
            component: (props: any) => <TurnoverTotalCell value={props.valueFormatted ?? props.value} missing={missing} />,
          };
        }
        return {
          component: (props: any) => (
            <LinkCellRenderer
              {...props}
              linkType="internal"
              getHref={(row) => getWorkspaceHref(row, 'details')}
              onNavigate={(href) => navigate(href)}
              linkSx={{
                color: 'inherit',
                textDecoration: 'none',
                '&:visited': { color: 'inherit' },
                '&:hover': { color: 'inherit' },
              }}
            />
          ),
        };
      },
    },
    {
      field: 'status',
      headerName: t('shared.columns.status'),
      width: 140,
      ...statusColumnProps(t),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
    {
      field: 'created_at',
      filter: 'agDateColumnFilter',
      headerName: t('shared.columns.created'),
      width: 200,
      defaultHidden: true,
      valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
      cellRenderer: (params: any) => (
        <LinkCellRenderer
          {...params}
          linkType="internal"
          getHref={(row) => getWorkspaceHref(row, 'overview')}
          onNavigate={(href) => navigate(href)}
        />
      ),
    },
  ], [getWorkspaceHref, locale, navigate, year, t]);

  const updateTotals = useCallback(async ({ q, filterModel, statusScope }: { q: string; filterModel: any; statusScope?: StatusScope }) => {
    const key = JSON.stringify({
      year,
      refreshKey,
      q: q || '',
      filters: filterModel || {},
      statusScope: statusScope ?? 'enabled',
    });
    if (key === totalsKeyRef.current) return;
    totalsKeyRef.current = key;
    const gen = ++totalsGen.current;
    try {
      const params: Record<string, any> = { year };
      if (q) params.q = q;
      if (filterModel && Object.keys(filterModel).length > 0) params.filters = JSON.stringify(filterModel);
      if (statusScope === 'enabled' || statusScope === 'disabled') {
        params.status = statusScope;
      } else if (statusScope === 'all') {
        params.includeDisabled = '1';
      }
      // Filters too long for a URL go as a saved list context, like the grid's own requests.
      const res = await getWithListContext('/companies/totals', params);
      if (gen !== totalsGen.current) return;
      const totals = res.data || {};
      const pinned = {
        name: t('companies.pinnedTotal'),
        // Null when the year has no figure. `Number(x || 0)` would paint a zero.
        headcount_year: totals.headcount == null ? null : Number(totals.headcount),
        it_users_year: totals.it_users == null ? null : Number(totals.it_users),
        turnover_year: totals.turnover == null ? null : Number(totals.turnover),
        turnover_currency: totals.turnover_currency ?? null,
        turnover_fx_missing: companyTurnoverFxMissing(totals.turnover_fx_missing),
      } as Partial<CompanyRow>;
      setPinnedTotals([pinned]);
    } catch (err) {
      if (totalsKeyRef.current === key) totalsKeyRef.current = '';
      if (gen !== totalsGen.current) return;
      setPinnedTotals([]);
    }
  }, [refreshKey, t, year]);

  const canCreate = hasLevel('companies', 'manager');
  const canAdmin = hasLevel('companies', 'admin');

  const actions = (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <ListYearField
        draft={yearDraft}
        year={year}
        onChange={(text) => {
          setYearDraft(text);
          const next = companyListYear(text);
          if (next != null && next !== year) updateSearchYear(next);
        }}
      />
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/master-data/companies/new/overview?${sp.toString()}`);
          }}
        >
          {t('shared.labels.new')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('shared.labels.importCsv')} /></Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/companies/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          // Asked on click: those still in use are kept, with what uses them.
          checkDelete={(ids) => recordsInUseCheck('/companies', ids)}
          itemLabels={{
            toDelete: (count) => t('companies.delete.toDelete', { count }),
            kept: (count) => t('companies.delete.kept', { count }),
            deleted: (count) => t('companies.delete.deleted', { count }),
            title: (count) => t('companies.delete.title', { count }),
            keptDone: (count) => t('companies.delete.keptDone', { count }),
          }}
          onDeleteSuccess={() => {
            setRefreshKey((k) => k + 1);
          }}
        />
      )}
    </Stack>
  );

  useEffect(() => {
    // Recompute totals on year/refresh changes using latest known query state
    let fm = lastQueryRef.current?.filters || (gridApiRef.current?.getFilterModel?.() || {});
    const q = lastQueryRef.current?.q || '';
    const statusScope = lastQueryRef.current?.statusScope ?? 'enabled';
    updateTotals({ q, filterModel: fm, statusScope });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, refreshKey]);

  const turnoverFxMissing = companyTurnoverFxMissing(pinnedTotals[0]?.turnover_fx_missing);

  return (
    <>
      <PageHeader title={t('companies.title')} actions={actions} />
      <ServerDataGrid<CompanyRow>
        onListRequestChange={setListRequest}
        columns={columns}
        endpoint="/companies"
        queryKey="companies"
        getRowId={(r) => r.id}
        enableSearch
        pinnedBottomRowData={pinnedTotals}
        defaultSort={{ field: 'headcount_year', direction: 'DESC' }}
        refreshKey={`${refreshKey}:${year}`}
        extraParams={{ year }}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        columnPreferencesKey="companies"
        enableColumnChooser
        requiredColumns={['name']}
        defaultHiddenColumns={['city', 'postal_code', 'address1', 'address2', 'state', 'notes', 'created_at']}
        statusScopeConfig={{ defaultScope: 'enabled' }}
        // In the grid's measured footer, as on the contracts list: below the grid it fell off a 1080 px screen.
        footer={turnoverFxMissing.length > 0 ? (
          <FxMissingNotice
            message={companyTurnoverFxNotice(t, turnoverFxMissing)}
            items={turnoverFxMissing.map((item) => ({ currency: item.currency, year: item.year, lines: item.companies }))}
            wrap
          />
        ) : undefined}
        onQueryStateChange={(state) => {
          const statusScope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {}, statusScope };
          updateTotals({ q: state.q || '', filterModel: state.filterModel || {}, statusScope });
        }}
      />

      <CsvExportDialog listRequest={listRequest} entity="companies"
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/companies"
        title={t('companies.export')}
        params={{ year }}
        flexibleFormat
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/companies"
        title={t('companies.import')}
        onImported={() => setRefreshKey((k) => k + 1)}
        params={{ year }}
        flexibleFormat
        hint={t('companies.importHint', { years: `${year - 1}, ${year}, ${year + 1}` })}
      />
    </>
  );
}
