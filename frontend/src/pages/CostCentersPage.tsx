import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import { useAuth } from '../auth/AuthContext';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { LinkCellRenderer } from '../components/grid/renderers';
import CheckboxSetFilter, { type CheckboxSetFilterOption } from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import { COST_CENTER_TREE_QUERY_KEY, useCostCenterTree } from '../hooks/useCostCenterTree';
import {
  COST_CENTERS_ENDPOINT,
  getCostCenterTree,
  type CostCenterListRow,
} from '../services/costCenters';
import { COST_CENTER_KINDS } from './cost-centers/costCenterFields';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';
import { setListFiltersParam } from '../lib/listContext';

const DEFAULT_SORT = 'path:ASC';

const CODE_CELL_STYLE = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: '12px',
  color: 'var(--kanap-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
};

function uniqueSorted(values: Array<string | null | undefined>): CheckboxSetFilterOption[] {
  const set = new Set<string>();
  for (const value of values) if (value) set.add(value);
  return [...set]
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map((value) => ({ value, label: value }));
}

export default function CostCentersPage() {
  const { hasLevel } = useAuth();
  if (!hasLevel('cost_centers', 'reader')) return <ForbiddenPage />;
  return <CostCentersList />;
}

function CostCentersList() {
  const { t } = useTranslation(['master-data', 'common']);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const tree = useCostCenterTree();

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<CostCenterListRow[]>([]);
  const [sortedByPath, setSortedByPath] = useState(true);
  const gridApiRef = useRef<any>(null);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);

  const canCreate = hasLevel('cost_centers', 'member');
  const canAdmin = hasLevel('cost_centers', 'admin');

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void queryClient.invalidateQueries({ queryKey: ['cost-centers'] });
  }, [queryClient]);

  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const state = lastQueryRef.current;
    sp.set('sort', state?.sort || DEFAULT_SORT);
    if (state?.q) sp.set('q', state.q);
    setListFiltersParam(sp, COST_CENTERS_ENDPOINT, state?.filters);
    // The grid's status scope, so prev/next in the workspace walks the same set.
    if (state?.statusScope) sp.set('scope', state.statusScope);
    return sp;
  }, []);

  const getWorkspaceHref = useCallback(
    (row: CostCenterListRow) => (row?.id ? `/master-data/cost-centers/${row.id}/overview?${buildWorkspaceSearch().toString()}` : null),
    [buildWorkspaceSearch],
  );

  // Set filter values come from the tree, which every reader of this page can load.
  const loadTreeNodes = useCallback(
    () => queryClient.ensureQueryData({ queryKey: COST_CENTER_TREE_QUERY_KEY, queryFn: getCostCenterTree }),
    [queryClient],
  );

  const columns: EnhancedColDef<CostCenterListRow>[] = useMemo(() => {
    const link = (params: any) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={getWorkspaceHref}
        onNavigate={(href) => navigate(href)}
      />
    );
    return [
      {
        field: 'code',
        headerName: t('costCenters.columns.code'),
        width: 140,
        required: true,
        // Code, name and path are searched by the quick search; the server filters sets only.
        filter: false,
        cellStyle: CODE_CELL_STYLE,
        cellRenderer: link,
      },
      {
        field: 'name',
        headerName: t('costCenters.columns.name'),
        flex: 1,
        minWidth: 220,
        required: true,
        filter: false,
        cellRenderer: (params: any) => (
          <Box sx={{ pl: sortedByPath ? Number(params.data?.depth ?? 0) * 2 : 0, minWidth: 0, width: '100%' }}>
            {link(params)}
          </Box>
        ),
      },
      {
        field: 'kind',
        headerName: t('costCenters.columns.type'),
        width: 150,
        valueFormatter: (p: any) => (p.value ? t(`costCenters.kinds.${p.value}`) : ''),
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          values: COST_CENTER_KINDS.map((value) => ({ value, label: t(`costCenters.kinds.${value}`) })),
          searchable: false,
        },
        cellRenderer: link,
      },
      {
        field: 'parent_name',
        headerName: t('costCenters.columns.parent'),
        width: 200,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          getValues: async () => uniqueSorted((await loadTreeNodes()).filter((n) => n.kind === 'group').map((n) => n.name)),
        },
        cellRenderer: link,
      },
      {
        field: 'company_name',
        headerName: t('costCenters.columns.company'),
        width: 220,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          getValues: async () => uniqueSorted((await loadTreeNodes()).map((n) => n.company_name)),
        },
        cellRenderer: link,
      },
      {
        field: 'owner_name',
        headerName: t('costCenters.columns.owner'),
        width: 200,
        filter: false,
        cellRenderer: link,
      },
      {
        field: 'status',
        headerName: t('costCenters.columns.status'),
        width: 140,
        ...statusColumnProps(t),
        defaultHidden: true,
        cellRenderer: link,
      },
    ];
  }, [getWorkspaceHref, loadTreeNodes, navigate, sortedByPath, t]);

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={() => navigate(`/master-data/cost-centers/new/overview?${buildWorkspaceSearch().toString()}`)}
        >
          {t('shared.labels.new')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('shared.labels.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint={`${COST_CENTERS_ENDPOINT}/bulk`}
          getItemId={(row) => row.id}
          getItemName={(row) => row.code}
          gridApi={gridApiRef.current}
          onDeleteSuccess={refresh}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('costCenters.title')} actions={actions} />
      {tree.ready && !tree.isError && !tree.hasAny && (
        <Typography data-testid="cost-centers-empty" sx={{ fontSize: 13, color: 'kanap.text.tertiary', mt: -1, mb: 1.5 }}>
          {t('costCenters.emptyExplainer')}
        </Typography>
      )}
      <ServerDataGrid<CostCenterListRow>
        columns={columns}
        endpoint={COST_CENTERS_ENDPOINT}
        queryKey="cost-centers"
        getRowId={(r) => r.id}
        enableSearch
        defaultSort={{ field: 'path', direction: 'ASC' }}
        refreshKey={refreshKey}
        columnPreferencesKey="cost-centers"
        enableColumnChooser
        statusScopeConfig={{ defaultScope: 'enabled' }}
        requiredColumns={['code', 'name']}
        enableRowSelection={canAdmin}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        onQueryStateChange={(state) => {
          const scope = state.statusScope ?? 'enabled';
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {}, statusScope: scope };
          setSortedByPath(!state.sort || state.sort.startsWith('path:'));
        }}
      />
      <CsvExportDialog open={exportOpen} onClose={() => setExportOpen(false)} endpoint={COST_CENTERS_ENDPOINT} title={t('costCenters.export')} flexibleFormat />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={COST_CENTERS_ENDPOINT}
        title={t('costCenters.import')}
        onImported={refresh}
        flexibleFormat
      />
    </>
  );
}
