import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Box, Button, Link, Menu, MenuItem, Stack, useTheme } from '@mui/material';
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown';
import { useNavigate, useLocation } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import ServerDataGrid, { DATE_COLUMN_FILTER, EnhancedColDef, type ListRequest } from '../../components/ServerDataGrid';
import { ICellRendererParams } from 'ag-grid-community';
import { LinkCellRenderer, wholeCellLinkSx } from '../../components/grid/renderers';
import { getEnvDotColor } from '../../components/grid/renderers/StatusCellRenderer';
import { StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import DeleteSelectedButton from '../../components/DeleteSelectedButton';
import { assetsDeleteCheck } from '../../utils/deleteCheck';
import { CsvExportDialogV2, CsvImportDialogV2 } from '../../components/csv';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';

import { useTranslation } from 'react-i18next';
import { screenLanguage } from '../../components/csv/readings';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { setListFiltersParam, getWithListContext } from '../../lib/listContext';
import { countValueFormatter } from '../../components/grid/countValueFormatter';
import { useFeatures } from '../../config/FeaturesContext';
import ClusterMark from '../../components/workspace/ClusterMark';
import VulnerabilityCountCell from '../../components/vulnerabilities/VulnerabilityCountCell';
import {
  VULNERABILITIES_FIELD,
  vulnerabilityFilterFromSearch,
  vulnerabilityFilterOptions,
} from '../../components/vulnerabilities/vulnerabilityListColumn';
import { ImportLabel } from '../../components/csv/importFiles';
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
  admin_zone: string | null;
  assignments_count?: number;
  /** CVE still to review, and those critical or high (null for a retired asset or the feed off). */
  vulnerabilities_to_review?: number | null;
  vulnerabilities_severe?: number | null;
  created_at: string;
};

/** The vulnerabilities to review of an asset, a link to the Vulnerabilities page filtered on it. */
function VulnerabilitiesCell({ data }: ICellRendererParams<AssetRow, any>) {
  if (!data) return null;
  return (
    <VulnerabilityCountCell
      count={data.vulnerabilities_to_review}
      severe={data.vulnerabilities_severe}
      to={`/it/vulnerabilities?asset=${encodeURIComponent(data.asset_reference || data.id)}`}
    />
  );
}

const ENV_LABEL_KEYS: Record<string, string> = {
  prod: 'enums.environment.prod',
  pre_prod: 'enums.environment.preProd',
  qa: 'enums.environment.qa',
  test: 'enums.environment.test',
  dev: 'enums.environment.dev',
  sandbox: 'enums.environment.sandbox',
};

/** The server's filter value for "is a cluster" (`CLUSTER_FILTER_IS_CLUSTER`). */
const CLUSTER_FILTER_IS_CLUSTER = '__cluster__';
const ENV_ORDER = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'];

export default function AssetsPage() {
  const { t, i18n } = useTranslation(['it', 'common']);
  const locale = useLocale();
  const listLanguage = useMemo(
    () => ({ language: screenLanguage(i18n.resolvedLanguage || i18n.language) }),
    [i18n.language, i18n.resolvedLanguage],
  );
  const theme = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel } = useAuth();
  const { config, isLoading: featuresLoading } = useFeatures();
  const vulnerabilityFeed = config.features.vulnerabilityFeed === true;
  const gridApiRef = useRef<any>(null);
  const [selectedRows, setSelectedRows] = useState<AssetRow[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const listRequestRef = useRef<ListRequest | null>(null);
  const [exportScope, setExportScope] = useState<{ params: Record<string, unknown>; summary: string }>({ params: {}, summary: '' });
  const [importOpen, setImportOpen] = useState(false);
  const [addMenu, setAddMenu] = useState<HTMLElement | null>(null);
  const { labelFor } = useItOpsEnumOptions();
  const envLabelMap = useMemo(
    () => Object.fromEntries(Object.entries(ENV_LABEL_KEYS).map(([code, key]) => [code, t(key)])) as Record<string, string>,
    [t],
  );
  const envLabel = useCallback((v?: string) => (v ? envLabelMap[v] || v : ''), [envLabelMap]);

  // Read filters from URL to restore state when returning from workspace, and
  // `?vulnerabilities=severe|any|none` (a link from the home page) on the Vulnerabilities column.
  const vulnerabilityUrlFilter = useMemo(() => vulnerabilityFilterFromSearch(location.search), [location.search]);
  const urlFilters = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const filtersParam = params.get('filters');
    let parsed: Record<string, unknown> | null = null;
    if (filtersParam) {
      try {
        parsed = JSON.parse(filtersParam);
      } catch {
        parsed = null;
      }
    }
    return vulnerabilityUrlFilter ? { ...(parsed || {}), ...vulnerabilityUrlFilter } : parsed;
  }, [location.search, vulnerabilityUrlFilter]);

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
      /** Values listed after the others, in this order (the server's own order for them). */
      trailing?: Array<string | null>;
      emptyLabel?: string;
    },
  ) => {
    const labelMap = opts?.labelMap;
    const labelFn = opts?.labelFn;
    const order = opts?.order;
    const trailing = opts?.trailing;
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
      if (trailing && trailing.length > 0) {
        const rank = (value: string | null) => trailing.indexOf(value);
        options.sort((a, b) => {
          const ra = rank(a.value);
          const rb = rank(b.value);
          if (ra !== -1 || rb !== -1) return ra - rb;
          return (a.label || '').localeCompare(b.label || '');
        });
      } else if (order && order.length > 0) {
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
    return <ForbiddenPage resource="infrastructure" level="reader" />;
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
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', textDecoration: 'none', color: 'text.primary', '&:hover': { textDecoration: 'none' }, ...wholeCellLinkSx }}
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
      const value = params.data?.cluster;
      const isCluster = params.data?.is_cluster;
      const data = params.data;
      if (!data) return null;
      const href = getAssetHref(data);
      return (
        <Link
          href={href}
          onClick={(event) => handleInternalNavigate(event, href)}
          sx={{ cursor: 'pointer', ...wholeCellLinkSx }}
          underline="none"
          color="inherit"
        >
          {isCluster ? (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center' }}><ClusterMark /></Box>
          ) : (
            value || null
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
      width: 80,
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
    { headerName: t('common.name'), field: 'name', flex: 1, minWidth: 150, cellRenderer: ClickToWorkspace },
    // Hidden while the vulnerability feed is off: the counts are null then.
    ...(vulnerabilityFeed
      ? [{
        headerName: t('pages.technologies.columns.vulnerabilitiesShort'),
        field: VULNERABILITIES_FIELD as keyof AssetRow,
        width: 130,
        headerTooltip: t('pages.technologies.columns.vulnerabilities'),
        filter: CheckboxSetFilter,
        floatingFilterComponent: CheckboxSetFloatingFilter,
        filterParams: { getValues: async () => vulnerabilityFilterOptions(t), searchable: false },
        cellRenderer: VulnerabilitiesCell,
      }]
      : []),
    {
      headerName: t('pages.assets.columns.assetType'),
      field: 'kind',
      width: 110,
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
      width: 120,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('cluster', {
          emptyLabel: t('pages.assets.filters.noCluster'),
          labelFn: (v) => (v === CLUSTER_FILTER_IS_CLUSTER ? t('pages.assets.filters.isCluster') : v),
          trailing: [CLUSTER_FILTER_IS_CLUSTER, null],
        }),
        searchable: false,
      },
      valueFormatter: (p) => (p.data?.is_cluster ? t('pages.assets.columns.cluster') : p.value || ''),
      cellRenderer: ClusterCell,
    },
    {
      headerName: t('pages.assets.columns.environment'),
      field: 'environment',
      width: 110,
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
      width: 130,
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
      width: 140,
      defaultHidden: true,
      initialHide: true,
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
      width: 110,
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
      width: 110,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('operating_system'),
        searchable: true,
      },
      valueFormatter: (p) => p.value || '',
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.networkZone'),
      field: 'network_segment',
      width: 120,
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
      headerName: t('pages.assets.columns.adminZone'),
      field: 'admin_zone',
      width: 150,
      defaultHidden: true,
      initialHide: true,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getAssetFilterValues('admin_zone', { labelFn: (v) => labelFor('adminZone', v), emptyLabel: t('pages.assets.filters.blank') }),
        searchable: false,
      },
      valueFormatter: (p) => labelFor('adminZone', p.value) || p.value || '',
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('common.lifecycle'),
      field: 'status',
      width: 110,
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
      // The date menu, not the text box: a typed date in that box never became a date filter.
      ...DATE_COLUMN_FILTER,
      width: 170,
      defaultHidden: true,
      initialHide: true,
      valueFormatter: (p: any) => formatShortDate(p.value as string | null, locale, { year: 'always' }),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.endOfLife'),
      field: 'end_of_life_date',
      ...DATE_COLUMN_FILTER,
      width: 170,
      defaultHidden: true,
      initialHide: true,
      valueFormatter: (p: any) => formatShortDate(p.value as string | null, locale, { year: 'always' }),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.assets.columns.assignments'),
      field: 'assignments_count',
      width: 100,
      sortable: false,
      filter: false,
      valueFormatter: (p) => countValueFormatter({ value: p.value ?? 0 }),
      cellRenderer: ClickToWorkspace,
    },
    { headerName: t('pages.assets.columns.created'), field: 'created_at', width: 160, ...DATE_COLUMN_FILTER, valueFormatter: (p: any) => formatShortDateTime(p.value as string | null, locale), cellRenderer: ClickToWorkspace },
  ], [ClickToWorkspace, ClusterCell, EnvironmentCell, envLabel, envLabelMap, getAssetFilterValues, labelFor, lifecycleLabel, t, vulnerabilityFeed]);

  // A new cluster opens the creation with the Cluster switch already on.
  const openNew = (cluster: boolean) => {
    setAddMenu(null);
    const sp = buildWorkspaceSearch();
    if (cluster) sp.set('cluster', '1');
    navigate(`/it/assets/new/overview?${sp.toString()}`);
  };

  // The export holds what the list shows: its filters, quick search and scope.
  const openExport = useCallback(() => {
    const request = listRequestRef.current;
    const params = { ...(request?.params ?? {}) };
    let summary = '';
    if (request) {
      const filtered = !!params.q || (typeof params.filters === 'string' && params.filters !== '{}' && params.filters !== '');
      summary = filtered
        ? t('pages.assets.exportScope', { count: request.total })
        : t('pages.assets.exportScopeAll', { count: request.total });
    }
    setExportScope({ params, summary });
    setExportOpen(true);
  }, [t]);

  const actions = (
    <Stack direction="row" spacing={1}>
      {hasLevel('infrastructure', 'member') && (
        <Button
          variant="action-primary"
          endIcon={<ArrowDropDownIcon />}
          aria-haspopup="menu"
          onClick={(event) => setAddMenu(event.currentTarget)}
        >
          {t('pages.assets.addAsset')}
        </Button>
      )}
      {hasLevel('infrastructure', 'admin') && <Button variant="action" onClick={() => setImportOpen(true)}><ImportLabel csv={t('pages.assets.importCsv')} /></Button>}
      {hasLevel('infrastructure', 'admin') && <Button variant="action" onClick={openExport}>{t('common:export.button')}</Button>}
      {hasLevel('infrastructure', 'admin') && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/assets/bulk"
          getItemId={(row) => row.id}
          // The reference tells apart assets that share a name.
          getItemName={(row) => (row.asset_reference ? `${row.asset_reference} ${row.name}` : row.name)}
          gridApi={gridApiRef.current}
          // Asked on click: those still in use are kept, with what uses them.
          checkDelete={(ids) => assetsDeleteCheck(ids, t, locale)}
          itemLabels={{
            toDelete: (count) => t('pages.assets.delete.toDelete', { count }),
            kept: (count) => t('pages.assets.delete.kept', { count }),
            deleted: (count) => t('pages.assets.delete.deleted', { count }),
            title: (count) => t('pages.assets.delete.title', { count }),
            titleCountsDeleted: true,
            keptDone: (count) => t('pages.assets.delete.keptDone', { count }),
            keptReason: ({ usages, count }) => t('pages.assets.delete.keptReason', { usages, count }),
          }}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.assets.title')} actions={actions} />
      {/* A filter on the Vulnerabilities column waits for the column: the grid drops a filter on a column it does not have. */}
      {!(vulnerabilityUrlFilter && featuresLoading) && (
      <ServerDataGrid<AssetRow>
        columns={columns}
        endpoint="/assets"
        showRowCount
        queryKey="assets"
        defaultSort={{ field: 'created_at', direction: 'DESC' }}
        enableColumnChooser
        enableSearch
        columnPreferencesKey="it-assets"
        columnLayoutVersion={1}
        extraParams={listLanguage}
        enableRowSelection={hasLevel('infrastructure', 'admin')}
        onSelectionChanged={setSelectedRows}
        onGridApiReady={(api) => { gridApiRef.current = api; }}
        refreshKey={refreshKey}
        initialState={initialGridState}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
        onListRequestChange={(request) => { listRequestRef.current = request; }}
      />
      )}
      <Menu
        anchorEl={addMenu}
        open={!!addMenu}
        onClose={() => setAddMenu(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <MenuItem sx={{ fontSize: 13 }} onClick={() => openNew(false)}>{t('pages.assets.addAsset')}</MenuItem>
        <MenuItem sx={{ fontSize: 13 }} onClick={() => openNew(true)}>{t('pages.assets.addCluster')}</MenuItem>
      </Menu>
      <CsvExportDialogV2
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/assets"
        title={t('pages.assets.exportTitle')}
        params={exportScope.params}
        scopeSummary={exportScope.summary}
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
