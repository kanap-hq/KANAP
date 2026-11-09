import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope, type ListRequest } from '../components/ServerDataGrid';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { recordsInUseCheck } from '../utils/deleteCheck';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import CheckboxSetFilter, { type CheckboxSetFilterOption } from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import { BUSINESS_PROCESS_TYPES, fetchBusinessProcessTree, type BusinessProcessType } from '../hooks/useBusinessProcessTree';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';
import { ImportLabel } from '../components/csv/importFiles';

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
  process_type?: BusinessProcessType | null;
  parent_name?: string | null;
  depth?: number;
};

const DEFAULT_SORT = 'path:ASC';

function uniqueSorted(values: Array<string | null | undefined>): CheckboxSetFilterOption[] {
  const set = new Set<string>();
  for (const value of values) if (value) set.add(value);
  return [...set]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((value) => ({ value, label: value }));
}

export default function BusinessProcessesPage() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();

  if (!hasLevel('business_processes', 'reader')) {
    return <ForbiddenPage resource="business_processes" level="reader" />;
  }

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  // The list on screen: the CSV export follows it.
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [sortedByPath, setSortedByPath] = useState(true);
  const [selectedRows, setSelectedRows] = useState<BusinessProcessRow[]>([]);
  const gridApiRef = useRef<any>(null);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || DEFAULT_SORT;
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
        // Sorted by path, the name is indented by its depth in the tree.
        cellRenderer: (params: any) => (
          <Box sx={{ pl: sortedByPath ? Number(params.data?.depth ?? 0) * 2 : 0, minWidth: 0, width: '100%' }}>
            <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
          </Box>
        ),
      },
      {
        field: 'process_type',
        headerName: t('businessProcesses.columns.type'),
        width: 170,
        valueFormatter: (p: any) => (p.value ? t(`businessProcesses.types.${p.value}`) : ''),
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          // "No type" is a null value: the shared compiler turns it into IS NULL, alone or with the codes.
          values: [
            ...BUSINESS_PROCESS_TYPES.map((value) => ({ value, label: t(`businessProcesses.types.${value}`) })),
            { value: null, label: t('businessProcesses.filters.noType') },
          ],
          searchable: false,
        },
        cellRenderer: (params: any) => (
          <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
        ),
      },
      {
        field: 'parent_name',
        headerName: t('businessProcesses.columns.parent'),
        width: 220,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          // The processes that have sub-processes.
          getValues: async () => {
            const nodes = await fetchBusinessProcessTree(queryClient);
            const parents = new Set(nodes.map((node) => node.parent_id));
            return uniqueSorted(nodes.filter((node) => parents.has(node.id)).map((node) => node.name));
          },
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
        filter: 'agDateColumnFilter',
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
        cellRenderer: (params: any) => (
          <LinkCellRenderer {...params} linkType="internal" getHref={getBusinessProcessHref} onNavigate={(href) => navigate(href)} />
        ),
        defaultHidden: true,
      },
    ],
    [getBusinessProcessHref, locale, navigate, queryClient, sortedByPath, t],
  );

  const canCreate = hasLevel('business_processes', 'manager');
  const openNewBusinessProcess = () => navigate(`/master-data/business-processes/new/overview?${buildWorkspaceSearch().toString()}`);
  const canAdmin = hasLevel('business_processes', 'admin');

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={openNewBusinessProcess}
        >
          {t('shared.labels.new')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('shared.labels.importCsv')} /></Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/business-processes/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          // A process that applications or interfaces use is refused; the warning says what loses its link.
          checkDelete={(ids) => recordsInUseCheck('/business-processes', ids)}
          warning={t('businessProcesses.deleteWarning', { count: selectedRows.length })}
          itemLabels={{
            toDelete: (count) => t('businessProcesses.delete.toDelete', { count }),
            deleted: (count) => t('businessProcesses.delete.deleted', { count }),
            title: (count) => t('businessProcesses.delete.title', { count }),
          }}
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
        emptyState={(
          <Stack direction="row" spacing={1.5} alignItems="center" justifyContent="center" data-testid="business-processes-empty">
            <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('businessProcesses.empty')}</Typography>
            {canCreate && (
              <Button variant="contained" size="small" onClick={openNewBusinessProcess}>
                {t('businessProcesses.newBusinessProcess')}
              </Button>
            )}
          </Stack>
        )}
        onListRequestChange={setListRequest}
        columns={columns}
        endpoint="/business-processes"
        queryKey="business-processes"
        getRowId={(row) => row.id}
        enableSearch
        defaultSort={{ field: 'path', direction: 'ASC' }}
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
          setSortedByPath(!state.sort || state.sort.startsWith('path:'));
        }}
      />
      <CsvExportDialog listRequest={listRequest} entity="businessProcesses"
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/business-processes"
        title={t("businessProcesses.export")}
        flexibleFormat
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/business-processes"
        title={t("businessProcesses.import")}
        onImported={() => setRefreshKey((k) => k + 1)}
        flexibleFormat
      />
    </>
  );
}
