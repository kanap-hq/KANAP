import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert, Box, Button, Tooltip } from '@mui/material';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../api';
import PageHeader from '../components/PageHeader';
import ServerDataGrid, { EnhancedColDef, StatusScope, type ListRequest } from '../components/ServerDataGrid';
import CsvExportDialog from '../components/csv/CsvExportDialog';
import CsvImportDialog from '../components/csv/CsvImportDialog';
import DeleteSelectedButton, { type DeleteCheck } from '../components/DeleteSelectedButton';
import { ChipToggleContextLine } from '../components/ChipToggleBar';
import { useAuth } from '../auth/AuthContext';
import { LinkCellRenderer } from '../components/grid/renderers';
import { useLocale } from '../i18n/useLocale';
import { formatShortDateTime } from '../lib/dateFormat';
import { ANALYTICS_AXES_QUERY_KEY, useAnalyticsAxes } from '../hooks/useAnalyticsAxes';
import { ANALYTICS_VALUE_ORDER_SORT, ANALYTICS_VALUES_ENDPOINT, isAnalyticsActive, type AnalyticsValue, type RecommendedDimensionResult } from '../services/analytics';
import AnalyticsDimensionChipBar from './analytics/AnalyticsDimensionChipBar';
import AnalyticsValueOrderDialog from './analytics/AnalyticsValueOrderDialog';
import { ANALYTICS_DIMENSIONS_PATH, ANALYTICS_LIST_PATH, valuesInUseMessage } from './analytics/analyticsFields';
import ForbiddenPage from './ForbiddenPage';
import { statusColumnProps } from '../components/grid/statusColumn';
import { lineTypeUsageColumnProps } from '../components/grid/lineTypeUsageColumn';

// The dimension's own order (position, then name), as pickers and filters offer the values.
const DEFAULT_SORT = ANALYTICS_VALUE_ORDER_SORT;
const DEFAULT_SORT_SPEC = { field: 'sort_order', direction: 'ASC' } as const;


/**
 * The check before a values delete (`POST /analytics-categories/delete-check`): nothing is refused,
 * and the values budget lines use (`forced`, counted per nature) make the delete a forced one.
 */
async function valuesDeleteCheck(t: TFunction, ids: string[]): Promise<DeleteCheck> {
  type Forced = { usages?: Array<{ type: string; total: number }> };
  const res = await api.post<{ refused?: DeleteCheck['refused']; forced?: Forced[] }>(`${ANALYTICS_VALUES_ENDPOINT}/delete-check`, { ids });
  const total = (value: Forced, type: string) => value.usages?.find((usage) => usage.type === type)?.total ?? 0;
  const message = valuesInUseMessage(t, (res.data?.forced ?? []).map((value) => ({
    opex_count: total(value, 'opex_lines'),
    capex_count: total(value, 'capex_lines'),
  })));
  return {
    refused: res.data?.refused ?? [],
    ...(message ? { warning: message, confirmLabel: t('analytics.forceDelete.confirmAnyway'), forceKey: 'force' } : {}),
  };
}

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
  // The list on screen: the CSV export follows it.
  const [listRequest, setListRequest] = useState<ListRequest | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  const [selectedRows, setSelectedRows] = useState<AnalyticsValue[]>([]);
  /** What the last "Add recommended dimensions" created, until dismissed. */
  const [recommendedMessage, setRecommendedMessage] = useState<string | null>(null);
  /** The grid's row count (its filters and status scope apply), once a page has loaded. */
  const [valueTotal, setValueTotal] = useState<number | null>(null);
  const gridApiRef = useRef<any>(null);
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any; statusScope?: StatusScope } | null>(null);

  // The selected values used by budget lines (the list rows carry their counts): the delete asks "Delete anyway".
  const forceDeleteMessage = useMemo(() => valuesInUseMessage(t, selectedRows), [selectedRows, t]);

  // A selection never spans two dimensions.
  useEffect(() => {
    setSelectedRows([]);
    setValueTotal(null);
    gridApiRef.current?.deselectAll?.();
  }, [selectedAxisId]);

  // Every value of the dimension, disabled ones included: Reorder needs two.
  const { data: dimensionValueCount } = useQuery({
    queryKey: ['analytics-categories', 'count', selectedAxisId],
    queryFn: async () => {
      const res = await api.get<{ total: number }>(ANALYTICS_VALUES_ENDPOINT, {
        params: { axis_id: selectedAxisId, includeDisabled: '1', limit: 1 },
      });
      return Number(res.data?.total ?? 0);
    },
    enabled: canCreate && !!selectedAxisId,
  });

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

  const onRecommendedAdded = useCallback((result: { created: RecommendedDimensionResult[] }) => {
    const names = result.created.map((item) => item.name).filter(Boolean).join(', ');
    setRecommendedMessage(result.created.length > 0
      ? t('analytics.recommended.created', { count: result.created.length, names })
      : t('analytics.recommended.nothingCreated'));
  }, [t]);

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
        // The value's position in its dimension.
        field: 'sort_order',
        headerName: t('analytics.fields.order'),
        width: 90,
        filter: false,
        cellRenderer: link,
      },
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
        ...statusColumnProps(t),
        cellRenderer: link,
      },
      {
        // The lines that may choose the value; blank is OPEX and CAPEX.
        field: 'applies_to',
        headerName: t('shared.lineTypeUsage.label'),
        width: 150,
        ...lineTypeUsageColumnProps(t),
        cellRenderer: link,
      },
      {
        field: 'updated_at',
        headerName: t('shared.columns.updated'),
        width: 200,
        filter: 'agDateColumnFilter',
        valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale),
        cellRenderer: link,
      },
    ];
  }, [getWorkspaceHref, locale, navigate, t]);

  // A disabled dimension takes no new value; the button says why instead of opening a form on another one.
  const selectedDisabled = !!selectedAxis && !isAnalyticsActive(selectedAxis);
  const newValueButton = (
    <Button
      variant="action-primary"
      disabled={!axes.ready || selectedDisabled}
      onClick={() => navigate(`${ANALYTICS_LIST_PATH}/new/overview?${buildWorkspaceSearch().toString()}`)}
    >
      {t('analytics.newValue')}
    </Button>
  );

  const actions = (canCreate || canAdmin) && (
    <>
      {canCreate && (selectedDisabled ? (
        <Tooltip title={t('analytics.enableToAddValues')}>
          <Box component="span" sx={{ display: 'inline-flex' }}>{newValueButton}</Box>
        </Tooltip>
      ) : newValueButton)}
      {canCreate && selectedAxisId && (
        <Button
          variant="action"
          disabled={(dimensionValueCount ?? 0) < 2}
          onClick={() => setReorderOpen(true)}
        >
          {t('analytics.reorder.action')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}>{t('shared.labels.importCsv')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('common:export.button')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint={`${ANALYTICS_VALUES_ENDPOINT}/bulk`}
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={refresh}
          // Asked on click: the values lines use go too once confirmed, the lines lose them.
          checkDelete={(ids) => valuesDeleteCheck(t, ids)}
          itemLabels={{
            toDelete: (count) => t('analytics.delete.toDelete', { count }),
            kept: (count) => t('analytics.delete.kept', { count }),
            deleted: (count) => t('analytics.delete.deleted', { count }),
            title: (count) => t('analytics.delete.title', { count }),
            keptDone: (count) => t('analytics.delete.keptDone', { count }),
          }}
          // Without an answer from the check: the counts the list rows carry.
          forceOption={forceDeleteMessage ? {
            message: forceDeleteMessage,
            confirmLabel: t('analytics.forceDelete.confirmAnyway'),
            apiKey: 'force',
          } : undefined}
        />
      )}
    </>
  );

  // A tenant without dimensions (never after the migration) still lists its values, unfiltered.
  const gridReady = axes.ready && !axes.isError && (!!selectedAxisId || axes.axes.length === 0);
  const contextTitle = gridReady
    ? [
      selectedAxis ? axes.label(selectedAxis) : null,
      valueTotal != null ? t('analytics.usage.values', { count: valueTotal }) : null,
    ].filter(Boolean).join(' · ')
    : null;

  return (
    <>
      <PageHeader title={t('analytics.title')} />
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
          onRecommendedAdded={canAdmin ? onRecommendedAdded : undefined}
        />
      )}
      {recommendedMessage && (
        <Alert severity="success" role="status" onClose={() => setRecommendedMessage(null)} sx={{ mb: 1.5 }}>
          {recommendedMessage}
        </Alert>
      )}
      {(contextTitle || actions) && (
        <ChipToggleContextLine testId="analytics-context" title={contextTitle} actions={actions} sx={{ mb: 2 }} />
      )}
      {gridReady && (
        <ServerDataGrid<AnalyticsValue>
          onListRequestChange={setListRequest}
          columns={columns}
          endpoint={ANALYTICS_VALUES_ENDPOINT}
          queryKey="analytics-categories"
          extraParams={selectedAxisId ? { axis_id: selectedAxisId } : {}}
          getRowId={(row) => row.id}
          enableSearch
          defaultSort={DEFAULT_SORT_SPEC}
          refreshKey={refreshKey}
          columnPreferencesKey="analytics-values"
          enableColumnChooser
          statusScopeConfig={{ defaultScope: 'enabled' }}
          requiredColumns={['name']}
          enableRowSelection={canAdmin}
          onSelectionChanged={setSelectedRows}
          onTotalChange={setValueTotal}
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
      {canCreate && selectedAxis && (
        <AnalyticsValueOrderDialog
          open={reorderOpen}
          axisId={selectedAxis.id}
          axisLabel={axes.label(selectedAxis)}
          onClose={() => setReorderOpen(false)}
          onSaved={refresh}
        />
      )}
      <CsvExportDialog listRequest={listRequest} entity="analyticsValues"
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint={ANALYTICS_VALUES_ENDPOINT}
        title={t('analytics.export')}
        flexibleFormat
      />
      <CsvImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint={ANALYTICS_VALUES_ENDPOINT}
        title={t('analytics.import')}
        onImported={refresh}
        flexibleFormat
      />
    </>
  );
}
