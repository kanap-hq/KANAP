import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope, type ListRequest } from '../components/ServerDataGrid';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import { useAuth } from '../auth/AuthContext';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { recordsInUseCheck } from '../utils/deleteCheck';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';
import { countValueFormatter } from '../components/grid/countValueFormatter';
import { companyListYear } from './companies/companyYear';
import ListYearField from '../components/navigation/ListYearField';
import { ImportLabel } from '../components/csv/importFiles';

export default function DepartmentsPage() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const { hasLevel } = useAuth();

  if (!hasLevel('departments', 'reader')) {
    return <ForbiddenPage resource="departments" level="reader" />;
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  // The list on screen: the CSV export follows it.
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const gridApiRef = useRef<any>(null);
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState<number>(currentYear);
  // The field may hold a partial year. Requests stay on `year` until it is complete.
  const [yearDraft, setYearDraft] = useState(String(currentYear));
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
      valueFormatter: countValueFormatter,
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
      filter: 'agDateColumnFilter',
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
    <Stack direction="row" spacing={1} alignItems="center" useFlexGap flexWrap="wrap">
      <ListYearField
        draft={yearDraft}
        year={year}
        onChange={(text) => {
          setYearDraft(text);
          const next = companyListYear(text);
          if (next != null && next !== year) setYear(next);
        }}
      />
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/master-data/departments/new/overview?${sp.toString()}`);
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
          endpoint="/departments/bulk"
          // Asked on click: a department budget allocations use is kept, with why.
          checkDelete={(ids) => recordsInUseCheck('/departments', ids)}
          itemLabels={{
            toDelete: (count) => t('departments.delete.toDelete', { count }),
            kept: (count) => t('departments.delete.kept', { count }),
            deleted: (count) => t('departments.delete.deleted', { count }),
          }}
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
        onListRequestChange={setListRequest}
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
      <CsvExportDialog listRequest={listRequest} entity="departments" open={exportOpen} onClose={() => setExportOpen(false)} endpoint="/departments" title={t("departments.export")} flexibleFormat />
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
