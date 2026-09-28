import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Box, Button, Stack, Tooltip } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope } from '../components/ServerDataGrid';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { STATUS_VALUES } from '../constants/status';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import { ANALYTICS_AXES_QUERY_KEY, useAnalyticsAxes } from '../hooks/useAnalyticsAxes';
import { ANALYTICS_VALUES_ENDPOINT, isAnalyticsActive, type AnalyticsValue } from '../services/analytics';
import AnalyticsDimensionChipBar from './analytics/AnalyticsDimensionChipBar';
import { ANALYTICS_DIMENSIONS_PATH, ANALYTICS_LIST_PATH } from './analytics/analyticsFields';
import ForbiddenPage from './ForbiddenPage';

const DEFAULT_SORT = 'name:ASC';

export default function AnalyticsCategoriesPage() {
  const { hasLevel } = useAuth();
  if (!hasLevel('analytics', 'reader')) return <ForbiddenPage />;
  return <AnalyticsValuesList />;
}

function AnalyticsValuesList() {
  const { t } = useTranslation(['master-data', 'common']);
  const locale = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const axes = useAnalyticsAxes();

  const canCreate = hasLevel('analytics', 'member');
  const canAdmin = hasLevel('analytics', 'admin');

  // `?axis=` picks the dimension; absent or unknown, the default one.
  const requestedAxisId = searchParams.get('axis');
  const selectedAxis = (requestedAxisId ? axes.byId.get(requestedAxisId) : undefined)
    ?? axes.defaultAxis
    ?? axes.axes[0]
    ?? null;
  const selectedAxisId = selectedAxis?.id ?? null;

  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<AnalyticsValue[]>([]);
  const gridApiRef = useRef<any>(null);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);

  // A selection never spans two dimensions.
  useEffect(() => {
    setSelectedRows([]);
    gridApiRef.current?.deselectAll?.();
  }, [selectedAxisId]);

  const refresh = useCallback(() => {
    setRefreshKey((k) => k + 1);
    void queryClient.invalidateQueries({ queryKey: ['analytics-categories'] });
    void queryClient.invalidateQueries({ queryKey: ['analytics-ids'] });
    void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY });
  }, [queryClient]);

  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const state = lastQueryRef.current;
    sp.set('sort', state?.sort || DEFAULT_SORT);
    if (state?.q) sp.set('q', state.q);
    if (state?.filters && Object.keys(state.filters).length > 0) sp.set('filters', JSON.stringify(state.filters));
    // The grid's status scope and dimension, so prev/next in the workspace walks the same set.
    if (state?.statusScope) sp.set('scope', state.statusScope);
    if (selectedAxisId) sp.set('axis', selectedAxisId);
    return sp;
  }, [selectedAxisId]);

  const getWorkspaceHref = useCallback(
    (row: AnalyticsValue) => (row?.id ? `${ANALYTICS_LIST_PATH}/${row.id}/overview?${buildWorkspaceSearch().toString()}` : null),
    [buildWorkspaceSearch],
  );

  const selectAxis = useCallback((axisId: string) => {
    const next = new URLSearchParams(searchParams);
    next.set('axis', axisId);
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const columns = useMemo<EnhancedColDef<AnalyticsValue>[]>(() => {
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
        field: 'name',
        headerName: t('shared.columns.name'),
        flex: 1,
        minWidth: 200,
        required: true,
        cellRenderer: link,
      },
      {
        field: 'description',
        headerName: t('shared.columns.description'),
        flex: 1,
        cellRenderer: link,
      },
      {
        field: 'status',
        headerName: t('shared.columns.status'),
        width: 140,
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: {
          values: STATUS_VALUES.map((value) => ({ value, label: t(`common:statuses.${value}`) })),
          searchable: false,
        },
        valueFormatter: (p: any) => (p.value ? t(`common:statuses.${p.value}`) : ''),
        cellRenderer: link,
      },
      {
        field: 'updated_at',
        headerName: t('shared.columns.updated'),
        width: 200,
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
        cellRenderer: link,
      },
    ];
  }, [getWorkspaceHref, locale, navigate, t]);

  // A disabled dimension takes no new value; the button says why instead of opening a form on another one.
  const selectedDisabled = !!selectedAxis && !isAnalyticsActive(selectedAxis);
  const newValueButton = (
    <Button
      variant="contained"
      disabled={!axes.ready || selectedDisabled}
      onClick={() => navigate(`${ANALYTICS_LIST_PATH}/new/overview?${buildWorkspaceSearch().toString()}`)}
    >
      {t('analytics.newValue')}
    </Button>
  );

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (selectedDisabled ? (
        <Tooltip title={t('analytics.enableToAddValues')}>
          <Box component="span" sx={{ display: 'inline-flex' }}>{newValueButton}</Box>
        </Tooltip>
      ) : newValueButton)}
      {canAdmin && <Button onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button onClick={() => setExportOpen(true)}>{t('shared.labels.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint={`${ANALYTICS_VALUES_ENDPOINT}/bulk`}
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={refresh}
        />
      )}
    </Stack>
  );

  // A tenant without dimensions (never after the migration) still lists its values, unfiltered.
  const gridReady = axes.ready && !axes.isError && (!!selectedAxisId || axes.axes.length === 0);

  return (
    <>
      <PageHeader title={t('analytics.title')} actions={actions} />
      {axes.isError && (
        <Alert severity="error" sx={{ mb: 1.5 }}>{t('analytics.messages.dimensionsLoadFailed')}</Alert>
      )}
      {axes.ready && !axes.isError && (
        <AnalyticsDimensionChipBar
          axes={axes.axes}
          selectedAxisId={selectedAxisId}
          label={axes.label}
          onSelect={selectAxis}
          onEdit={(axisId) => navigate(`${ANALYTICS_DIMENSIONS_PATH}/${axisId}/overview`)}
          canEdit={canCreate}
          onCreate={canCreate ? () => navigate(`${ANALYTICS_DIMENSIONS_PATH}/new/overview`) : undefined}
        />
      )}
      {gridReady && (
        <ServerDataGrid<AnalyticsValue>
          columns={columns}
          endpoint={ANALYTICS_VALUES_ENDPOINT}
          queryKey="analytics-categories"
          extraParams={selectedAxisId ? { axis_id: selectedAxisId } : {}}
          getRowId={(row) => row.id}
          enableSearch
          defaultSort={{ field: 'name', direction: 'ASC' }}
          refreshKey={refreshKey}
          columnPreferencesKey="analytics-values"
          enableColumnChooser
          statusScopeConfig={{ defaultScope: 'enabled' }}
          requiredColumns={['name']}
          enableRowSelection={canAdmin}
          onSelectionChanged={setSelectedRows}
          onGridApiReady={(api) => { gridApiRef.current = api; }}
          onQueryStateChange={(state) => {
            lastQueryRef.current = {
              sort: state.sort,
              q: state.q || '',
              filters: state.filterModel || {},
              statusScope: state.statusScope ?? 'enabled',
            };
          }}
        />
      )}
      <CsvExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint={ANALYTICS_VALUES_ENDPOINT}
        title={t('analytics.export')}
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={ANALYTICS_VALUES_ENDPOINT}
        title={t('analytics.import')}
        onImported={refresh}
      />
    </>
  );
}
