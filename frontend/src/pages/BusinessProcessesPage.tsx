import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import { Button, Stack } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import BusinessProcessCategoryManagerDialog from './business-processes/BusinessProcessCategoryManagerDialog';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';

type BusinessProcessRow = {
  id: string;
  name: string;
  description?: string | null;
  owner_user_id?: string | null;
  it_owner_user_id?: string | null;
  owner_name?: string | null;
  notes?: string | null;
  status: string;
  disabled_at?: string | null;
  updated_at?: string;
  categories?: Array<{ id: string; name: string; is_active: boolean }>;
  primary_category_name?: string | null;
};

export default function BusinessProcessesPage() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const { hasLevel } = useAuth();

  if (!hasLevel('business_processes', 'reader')) {
    return <ForbiddenPage />;
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<BusinessProcessRow[]>([]);
  const gridApiRef = useRef<any>(null);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'primary_category_name:ASC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters && Object.keys(filters).length > 0) sp.set('filters', JSON.stringify(filters));
    // The grid's status scope, so prev/next in the workspace walks the same set.
    const statusScope = lastQueryRef.current?.statusScope;
    if (statusScope) sp.set('scope', statusScope);
    return sp;
  }, []);
  const getBusinessProcessHref = useCallback((row: BusinessProcessRow) => {
    const sp = buildWorkspaceSearch();
    return `/master-data/business-processes/${row.id}/overview?${sp.toString()}`;
  }, [buildWorkspaceSearch]);

  const columns: EnhancedColDef<BusinessProcessRow>[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: t('shared.columns.name'),
        flex: 1,
        required: true,
        cellRenderer: (params: any) => (
          <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
        ),
      },
      {
        field: 'primary_category_name',
        headerName: t('businessProcesses.columns.categories'),
        flex: 1,
        valueFormatter: (p: any) => {
          const cats: Array<{ name: string }> = Array.isArray(p.data?.categories) ? p.data.categories : [];
          if (!cats.length) return '';
          const names = cats.map((c) => c.name);
          return names.join(', ');
        },
        cellRenderer: (params: any) => (
          <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
        ),
      },
      {
        field: 'owner_name',
        headerName: t('businessProcesses.columns.processOwner'),
        width: 220,
        valueGetter: (p: any) => p.data?.owner_name || '',
        cellRenderer: (params: any) => (
          <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
        ),
      },
      {
        field: 'status',
        headerName: t('shared.columns.status'),
        width: 140,
        ...statusColumnProps(t),
        defaultHidden: true,
        cellRenderer: (params: any) => (
          <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
        ),
      },
      {
        field: 'updated_at',
        headerName: t('shared.columns.updated'),
        width: 200,
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
        cellRenderer: (params: any) => (
          <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
        ),
        defaultHidden: true,
      },
    ],
    [getBusinessProcessHref, locale, navigate, t],
  );

  const canCreate = hasLevel('business_processes', 'manager');
  const canAdmin = hasLevel('business_processes', 'admin');
  const canManageCategories = hasLevel('business_processes', 'manager');

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button
          variant="contained"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/master-data/business-processes/new/overview?${sp.toString()}`);
          }}
        >
          {t('shared.labels.new')}
        </Button>
      )}
      {canManageCategories && (
        <Button onClick={() => setCategoryManagerOpen(true)}>
          {t('businessProcesses.manageCategories')}
        </Button>
      )}
      {canAdmin && <Button onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button onClick={() => setExportOpen(true)}>{t('shared.labels.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/business-processes/bulk"
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

  return (
    <>
      <PageHeader title={t("businessProcesses.title")} actions={actions} />
      <ServerDataGrid<BusinessProcessRow>
        columns={columns}
        endpoint="/business-processes"
        queryKey="business-processes"
        getRowId={(row) => row.id}
        enableSearch
        defaultSort={{ field: 'primary_category_name', direction: 'ASC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="business-processes"
        enableColumnChooser
        statusScopeConfig={{ defaultScope: 'enabled' }}
        requiredColumns={['name']}
        defaultHiddenColumns={['updated_at']}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => {
          gridApiRef.current = api;
        }}
        onQueryStateChange={(state) => {
          const scope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {}, statusScope: scope };
        }}
      />
      <CsvExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/business-processes"
        title={t("businessProcesses.export")}
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/business-processes"
        title={t("businessProcesses.import")}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
      <BusinessProcessCategoryManagerDialog
        open={categoryManagerOpen}
        onClose={() => setCategoryManagerOpen(false)}
        onUpdated={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
