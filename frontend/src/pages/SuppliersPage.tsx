import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope, type ListRequest } from '../components/ServerDataGrid';
import { Button, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import { useAuth } from '../auth/AuthContext';
import { isDataAccessLimited } from '../auth/dataAccess';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { recordsInUseCheck } from '../utils/deleteCheck';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';
import { ImportLabel } from '../components/csv/importFiles';

export default function SuppliersPage() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const { hasLevel, dataAccess } = useAuth();

  if (!hasLevel('suppliers', 'reader')) {
    return <ForbiddenPage resource="suppliers" level="reader" />;
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  // The list on screen: the CSV export follows it.
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<any[]>([]);
  const gridApiRef = useRef<any>(null);

  // Track last query to preserve list context when opening workspace
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'name:ASC';
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
  const getSupplierHref = useCallback((row: any) => {
    const sp = buildWorkspaceSearch();
    return `/master-data/suppliers/${row.id}/overview?${sp.toString()}`;
  }, [buildWorkspaceSearch]);

  const columns: EnhancedColDef<any>[] = useMemo(() => [
    {
      field: 'name',
      headerName: t('shared.columns.name'),
      flex: 1,
      required: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getSupplierHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'erp_supplier_id',
      headerName: t('suppliers.columns.erpSupplierId'),
      width: 200,
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getSupplierHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'notes',
      headerName: t('shared.columns.notes'),
      width: 250,
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getSupplierHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'status',
      headerName: t('shared.columns.status'),
      width: 140,
      ...statusColumnProps(t),
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getSupplierHref} onNavigate={(href) => navigate(href)} />
      ),
    },
    {
      field: 'created_at',
      headerName: t('shared.columns.created'),
      width: 200,
      filter: 'agDateColumnFilter',
      valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
      defaultHidden: true,
      cellRenderer: (params: any) => (
        <LinkCellRenderer {...params} linkType="internal" getHref={getSupplierHref} onNavigate={(href) => navigate(href)} />
      ),
    },
  ], [getSupplierHref, locale, navigate, t]);

  const openNewSupplier = () => {
    const sp = buildWorkspaceSearch();
    navigate(`/master-data/suppliers/new/overview?${sp.toString()}`);
  };
  const canCreate = hasLevel('suppliers','manager');
  const canAdmin = hasLevel('suppliers','admin');
  // Importing over or deleting shared suppliers is reserved to people with access to all data (spec §2.7).
  const canChangeShared = canAdmin && !isDataAccessLimited(dataAccess);
  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button variant="action-primary" onClick={openNewSupplier}>
          {t('shared.labels.new')}
        </Button>
      )}
      {canChangeShared && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('shared.labels.importCsv')} /></Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>}
      {canChangeShared && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/suppliers/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          // Asked on click: those still in use are kept, with what uses them.
          checkDelete={(ids) => recordsInUseCheck('/suppliers', ids)}
          itemLabels={{
            toDelete: (count) => t('suppliers.delete.toDelete', { count }),
            kept: (count) => t('suppliers.delete.kept', { count }),
            deleted: (count) => t('suppliers.delete.deleted', { count }),
          }}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t("suppliers.title")} actions={actions} />
      <ServerDataGrid<any>
        onListRequestChange={setListRequest}
        columns={columns}
        endpoint="/suppliers"
        queryKey="suppliers"
        getRowId={(r) => r.id}
        enableSearch
        defaultSort={{ field: 'name', direction: 'ASC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="suppliers"
        enableColumnChooser={true}
        statusScopeConfig={{ defaultScope: 'enabled' }}
        requiredColumns={['name']}
        defaultHiddenColumns={['notes', 'created_at']}
        enableRowSelection={canChangeShared}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        onQueryStateChange={(state) => {
          const scope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {}, statusScope: scope };
        }}
        emptyState={(
          <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" data-testid="suppliers-empty">
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('suppliers.empty')}</Typography>
            {canCreate && (
              <Button variant="contained" size="small" onClick={openNewSupplier}>
                {t('suppliers.newSupplier')}
              </Button>
            )}
          </Stack>
        )}
      />
      <CsvExportDialog listRequest={listRequest} entity="suppliers"
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/suppliers"
        title={t("suppliers.export")}
        flexibleFormat
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/suppliers"
        title={t("suppliers.import")}
        hint={t('suppliers.importHint')}
        onImported={() => setRefreshKey((k) => k + 1)}
        flexibleFormat
      />
    </>
  );
}
