import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Box, Button, Link, Stack, Typography, useTheme } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import { ICellRendererParams } from 'ag-grid-community';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { getEnvDotColor } from '../../components/grid/renderers/StatusCellRenderer';
import { StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { CsvExportDialogV2, CsvImportDialogV2 } from '../../components/csv';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';

import { useTranslation } from 'react-i18next';
import { setListFiltersParam, getWithListContext } from '../../lib/listContext';
type AssetRow = {
  id: string;
  asset_reference: string | null;
  name: string;
  kind: string;
  provider: string;
  environment: string;
  cluster: string | null;
  is_cluster: boolean;
  status: string;
  go_live_date: string | null;
  end_of_life_date: string | null;
  location_id: string | null;
  location_name: string | null;
  sub_location_name: string | null;
  hosting_type: string | null;
  operating_system: string | null;
  network_segment: string | null;
  assignments_count?: number;
  created_at: string;
};

const ENV_LABEL_KEYS: Record<string, string> = {
  prod: 'enums.environment.prod',
  pre_prod: 'enums.environment.preProd',
  qa: 'enums.environment.qa',
  test: 'enums.environment.test',
  dev: 'enums.environment.dev',
  sandbox: 'enums.environment.sandbox',
};

const ENV_ORDER = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'];

export default function AssetsPage() {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel } = useAuth();
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<AssetRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const { labelFor } = useItOpsEnumOptions();
  const envLabelMap = useMemo(
    () => Object.fromEntries(Object.entries(ENV_LABEL_KEYS).map(([code, key]) => [code, t(key)])) as Record<string, string>,
    [t],
  );
  const envLabel = useCallback((v?: string) => (v ? envLabelMap[v] || v : ''), [envLabelMap]);

  // Read filters from URL to restore state when returning from workspace
  const urlFilters = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const filtersParam = params.get('filters');
    if (filtersParam) {
      try {
        return JSON.parse(filtersParam);
      } catch {
        return null;
      }
    }
    return null;
  }, [location.search]);

  // Use URL filters if present (no default filter for assets)
  const initialGridState = useMemo(() => {
    if (urlFilters && Object.keys(urlFilters).length > 0) {
      return {
        filter: {
          filterModel: urlFilters,
        },
      };
    }
    return undefined;
  }, [urlFilters]);
  const lifecycleLabel = React.useCallback(
    (value?: string) => labelFor('lifecycleStatus', value) || (value || ''),
    [labelFor],
  );

  // Factory for checkbox set filter values - fetches scoped values from backend
  const getAssetFilterValues = useCallback((
    field: string,
    opts?: {
      labelMap?: Record<string, string>;
      labelFn?: (code: string) => string;
      order?: Array<string | null>;
      emptyLabel?: string;
    },
  ) => {
    const labelMap = opts?.labelMap;
    const labelFn = opts?.labelFn;
    const order = opts?.order;
    const emptyLabel = opts?.emptyLabel ?? t('pages.assets.filters.blank');
    return async ({ context }: any) => {
      const queryState = context?.getQueryState?.() ?? {};
      const filters = { ...(queryState.filters || {}) };
      delete filters[field];
      const params: Record<string, any> = { fields: field };
      if (queryState.q) params.q = queryState.q;
      if (Object.keys(filters).length > 0) {
        params.filters = JSON.stringify(filters);
      }
      const res = await getWithListContext('/assets/filter-values', params);
      const values = (res.data?.[field] || []) as Array<string | null>;
      let options = values.map((value) => {
        if (value == null) return { value, label: emptyLabel };
        const key = String(value);
        let label: string;
        if (labelFn) {
          label = labelFn(key) || key;
        } else if (labelMap && Object.prototype.hasOwnProperty.call(labelMap, key)) {
          label = labelMap[key];
        } else {
          label = key;
        }
        return { value, label };
      });
      if (order && order.length > 0) {
        const orderMap = new Map(order.map((val, index) => [val, index]));
        options.sort((a, b) => {
          const aIndex = orderMap.has(a.value) ? (orderMap.get(a.value) as number) : Number.MAX_SAFE_INTEGER;
          const bIndex = orderMap.has(b.value) ? (orderMap.get(b.value) as number) : Number.MAX_SAFE_INTEGER;
          if (aIndex !== bIndex) return aIndex - bIndex;
          return (a.label || '').localeCompare(b.label || '');
        });
      } else {
        options.sort((a, b) => (a.label || '').localeCompare(b.label || ''));
      }
      return options;
    };
  }, []);

  // List context preservation for prev/next navigation
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'created_at:DESC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    setListFiltersParam(sp, '/assets', filters);
    return sp;
  }, []);

  const isPlainLeftClick = useCallback((event: React.MouseEvent) => {
    return (
      event.button === 0
      && !event.metaKey
      && !event.ctrlKey
      && !event.shiftKey
      && !event.altKey
    );
  }, []);

  const getAssetHref = useCallback((row: AssetRow) => {
    const sp = buildWorkspaceSearch();
    return `/it/assets/${row.asset_reference || row.id}/overview?${sp.toString()}`;
  }, [buildWorkspaceSearch]);

  const handleInternalNavigate = useCallback((event: React.MouseEvent, href: string) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    navigate(href);
  }, [isPlainLeftClick, navigate]);

  if (!hasLevel('infrastructure', 'reader')) {
    return <ForbiddenPage />;
  }

  const ClickToWorkspace = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<AssetRow, any>> = (params) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={getAssetHref}
        onNavigate={(href) => navigate(href)}
      />
    );
    return Cell;
  }, [getAssetHref, navigate]);

  const EnvironmentCell = useMemo(() => {
    const mode = theme.palette.mode;
    const Cell: React.FC<ICellRendererParams<AssetRow, any>> = (params) => {
      const env = params.data?.environment;
      if (!env) return null;
      const href = getAssetHref(params.data as AssetRow);
      return (
        <Link
          href={href}
          onClick={(event) => handleInternalNavigate(event, href)}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', textDecoration: 'none', color: 'text.primary', '&:hover': { textDecoration: 'none' } }}
        >
          <StatusDot color={getEnvDotColor(env, mode)} />
          {envLabel(env)}
        </Link>
      );
    };
    return Cell;
  }, [envLabel, getAssetHref, handleInternalNavigate, theme.palette.mode]);

  const ClusterCell = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<AssetRow, any>> = (params) => {
      const id = params.data?.id;
      const value = params.data?.cluster;
      const isCluster = params.data?.is_cluster;
      const data = params.data;
      if (!data) return null;
      const href = getAssetHref(data);
      return (
        <Link
          href={href}
          onClick={(event) => handleInternalNavigate(event, href)}
          sx={{ cursor: 'pointer' }}
          underline="none"
          color="inherit"
        >
          {isCluster ? (
            <Typography variant="body2" color="text.secondary">{t('pages.assets.columns.cluster')}</Typography>
          ) : value ? (
            value
          ) : (
            '—'
          )}
        </Link>
      );
    };
    return Cell;
  }, [getAssetHref, handleInternalNavigate, t]);

  const columns: EnhancedColDef<AssetRow>[] = useMemo(() => [
    {
      field: 'asset_reference',
      headerName: '#',
      width: 90,
      valueGetter: (p) => p.data?.asset_reference || '',
      cellStyle: {
        fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
        fontSize: '12px',
        color: 'var(--kanap-text-secondary)',
        fontVariantNumeric: 'tabular-nums',
      },
      comparator: (a, b) => {
        const na = parseInt(String(a || '').replace(/^AST-/i, ''), 10) || 0;
        const nb = parseInt(String(b || '').replace(/^AST-/i, ''), 10) || 0;
        return na - nb;
      },
      cellRenderer: ClickToWorkspace,
    },
    { headerName: t('common.name'), field: 'name', minWidth: 180, cellRenderer: ClickToWorkspace },
    {
      headerName: t('pages.assets.columns.assetType'),
      field: 'kind',
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('kind', { labelFn: (v) => labelFor('serverKind', v) }),
        searchable: false,
      },
      valueFormatter: (p) => labelFor('serverKind', p.value) || p.value,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.cluster'),
      field: 'cluster',
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('cluster', { emptyLabel: t('pages.assets.filters.noCluster') }),
        searchable: false,
      },
      valueFormatter: (p) => (p.data?.is_cluster ? t('pages.assets.columns.cluster') : p.value || '—'),
      cellRenderer: ClusterCell,
    },
    {
      headerName: t('pages.assets.columns.environment'),
      field: 'environment',
      width: 130,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('environment', { labelMap: envLabelMap, order: ENV_ORDER }),
        searchable: false,
      },
      valueFormatter: (p) => envLabel(p.value),
      cellRenderer: EnvironmentCell,
    },
    {
      headerName: t('pages.assets.columns.location'),
      field: 'location_name',
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('location_name', { emptyLabel: t('pages.assets.filters.noLocation') }),
        searchable: false,
      },
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.subLocation'),
      field: 'sub_location_name',
      width: 160,
      hide: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('sub_location_name', { emptyLabel: t('pages.assets.filters.noSubLocation') }),
        searchable: false,
      },
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.hosting'),
      field: 'hosting_type',
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('hosting_type', { labelFn: (v) => labelFor('hostingType', v) }),
        searchable: false,
      },
      valueFormatter: (p) => labelFor('hostingType', p.value) || p.value,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.os'),
      field: 'operating_system',
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('operating_system', { labelFn: (v) => labelFor('operatingSystem', v) }),
        searchable: false,
      },
      valueFormatter: (p) => labelFor('operatingSystem', p.value) || p.value,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.networkZone'),
      field: 'network_segment',
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('network_segment', { labelFn: (v) => labelFor('networkSegment', v) }),
        searchable: false,
      },
      valueFormatter: (p) => labelFor('networkSegment', p.value) || p.value,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('common.lifecycle'),
      field: 'status',
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('status', { labelFn: (v) => labelFor('lifecycleStatus', v) }),
        searchable: false,
      },
      valueFormatter: (p) => lifecycleLabel(p.value),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.goLive'),
      field: 'go_live_date',
      width: 120,
      hide: true,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.endOfLife'),
      field: 'end_of_life_date',
      width: 120,
      hide: true,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.assignments'),
      field: 'assignments_count',
      width: 140,
      sortable: false,
      filter: false,
      valueFormatter: (p) => p.value ?? 0,
      cellRenderer: ClickToWorkspace,
    },
    { headerName: t('pages.assets.columns.created'), field: 'created_at', width: 180, cellRenderer: ClickToWorkspace },
  ], [ClickToWorkspace, ClusterCell, EnvironmentCell, envLabel, envLabelMap, getAssetFilterValues, labelFor, lifecycleLabel, t]);

  const actions = (
    <Stack direction="row" spacing={1}>
      {hasLevel('infrastructure', 'member') && (
        <Button variant="contained" onClick={() => {
          const sp = buildWorkspaceSearch();
          navigate(`/it/assets/new/overview?${sp.toString()}`);
        }}>
          {t('pages.assets.addAsset')}
        </Button>
      )}
      {hasLevel('infrastructure', 'admin') && <Button onClick={() => setImportOpen(true)}>{t('pages.assets.importCsv')}</Button>}
      {hasLevel('infrastructure', 'admin') && <Button onClick={() => setExportOpen(true)}>{t('pages.assets.exportCsv')}</Button>}
      {hasLevel('infrastructure', 'admin') && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/assets/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.name}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
          label={t('pages.assets.deleteAsset')}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.assets.title')} actions={actions} />
      <ServerDataGrid<AssetRow>
        columns={columns}
        endpoint="/assets"
        showRowCount
        queryKey="assets"
        defaultSort={{ field: 'created_at', direction: 'DESC' }}
        enableColumnChooser
        enableSearch
        columnPreferencesKey="it-assets"
        enableRowSelection={hasLevel('infrastructure', 'admin')}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        refreshKey={refreshKey}
        initialState={initialGridState}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
      />
      <CsvExportDialogV2
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/assets"
        title={t('pages.assets.exportTitle')}
        presets={[{ name: 'enrichment', label: t('pages.assets.dataEnrichment') }]}
      />
      <CsvImportDialogV2
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/assets"
        title={t('pages.assets.importTitle')}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
