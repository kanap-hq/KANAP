import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack, TextField } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import { useAuth } from '../auth/AuthContext';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';

export default function DepartmentsPage() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const { hasLevel } = useAuth();

  if (!hasLevel('departments', 'reader')) {
    return <ForbiddenPage />;
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const gridApiRef = useRef<any>(null);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);

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

  const openWorkspace = useCallback((row: any, tab: 'overview' | 'details') => {
    if (!row?.id) return;
    const sp = buildWorkspaceSearch();
    navigate(`/master-data/departments/${row.id}/${tab}?${sp.toString()}`);
  }, [buildWorkspaceSearch, navigate]);

  const getWorkspaceHref = useCallback((row: any, tab: 'overview' | 'details') => {
    if (!row?.id) return null;
    const sp = buildWorkspaceSearch();
    return `/master-data/departments/${row.id}/${tab}?${sp.toString()}`;
  }, [buildWorkspaceSearch]);

  const columns: EnhancedColDef<any>[] = useMemo(() => [
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
      field: 'company_name',
      headerName: t('departments.columns.company'),
      width: 280,
      filter: 'agTextColumnFilter',
      filterParams: { suppressAndOrCondition: true },
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
      headerName: t('departments.columns.headcountYear', { year }),
      width: 180,
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
      field: 'created_at',
      headerName: t('shared.columns.created'),
      width: 200,
      valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
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
  ], [getWorkspaceHref, locale, navigate, year, t]);

  const canCreate = hasLevel('departments','manager');
  const canAdmin = hasLevel('departments','admin');
  const actions = (
    <Stack direction="row" spacing={1}>
      <TextField size="small" label={t('shared.fields.year')} type="number" value={year} onChange={(e) => setYear(Number(e.target.value) || currentYear)} sx={{ width: 120 }} />
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/master-data/departments/new/overview?${sp.toString()}`);
          }}
        >
          New
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('shared.labels.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/departments/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t("departments.title")} actions={actions} />
      <ServerDataGrid<any>
        columns={columns}
        endpoint="/departments"
        queryKey="departments"
        getRowId={(r) => r.id}
        enableSearch
        defaultSort={{ field: 'headcount_year', direction: 'DESC' }}
        refreshKey={refreshKey + ":" + year}
        extraParams={{ year }}
        columnPreferencesKey="departments"
        enableColumnChooser={true}
        statusScopeConfig={{ defaultScope: 'enabled' }}
        requiredColumns={['name']}
        defaultHiddenColumns={['created_at']}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        onQueryStateChange={(state) => {
          const scope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {}, statusScope: scope };
        }}
      />
      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/departments" title={t("departments.export")} flexibleFormat />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/departments"
        title={t("departments.import")}
        onImported={() => setRefreshKey((k) => k + 1)}
        flexibleFormat
      />
    </>
  );
}
