import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button, Stack, TextField } from '@mui/material';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { getWithListContext } from '../lib/listContext';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';

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
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { hasLevel } = useAuth();

  if (!hasLevel('companies', 'reader')) {
    return <ForbiddenPage />;
  }

  const currentYear = new Date().getFullYear();
  const initialYearParam = searchParams.get('year');
  const initialYear = initialYearParam && !Number.isNaN(Number(initialYearParam))
    ? Number(initialYearParam)
    : currentYear;
  const [year, setYear] = useState<number>(initialYear);

  useEffect(() => {
    const paramYear = searchParams.get('year');
    if (!paramYear) return;
    const parsed = Number(paramYear);
    if (!Number.isNaN(parsed) && parsed !== year) {
      setYear(parsed);
    }
  }, [searchParams, year]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<CompanyRow[]>([]);
  const gridApiRef = useRef<any>(null);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
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
      headerName: t('companies.columns.turnoverYear', { year }),
      width: 170,
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
      const totals = res.data || {};
      const pinned = {
        name: t('companies.pinnedTotal'),
        headcount_year: Number(totals.headcount || 0),
        it_users_year: Number(totals.it_users || 0),
        turnover_year: Number(totals.turnover || 0),
      } as Partial<CompanyRow>;
      setPinnedTotals([pinned]);
    } catch (err) {
      setPinnedTotals([]);
    }
  }, [year]);

  const canCreate = hasLevel('companies', 'manager');
  const canAdmin = hasLevel('companies', 'admin');

  const actions = (
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <TextField
        size="small"
        label={t('shared.fields.year')}
        type="number"
        value={year}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (!Number.isNaN(next)) updateSearchYear(next);
        }}
        sx={{ width: 120 }}
      />
      {canCreate && (
        <Button
          variant="contained"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/master-data/companies/new/overview?${sp.toString()}`);
          }}
        >
          {t('shared.labels.new')}
        </Button>
      )}
      {canAdmin && <Button onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button onClick={() => setExportOpen(true)}>{t('shared.labels.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/companies/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
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

  return (
    <>
      <PageHeader title={t('companies.title')} actions={actions} />
      <ServerDataGrid<CompanyRow>
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
        onQueryStateChange={(state) => {
          const statusScope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {}, statusScope };
          updateTotals({ q: state.q || '', filterModel: state.filterModel || {}, statusScope });
        }}
      />

      <CsvExportDialog
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
      />
    </>
  );
}
