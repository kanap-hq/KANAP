import React, { useMemo, useRef, useState, useCallback } from 'react';
import { Button, Link, Stack, useTheme } from '@mui/material';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ICellRendererParams } from 'ag-grid-community';
import PageHeader from '../../components/PageHeader';
import { CsvExportDialogV2, CsvImportDialogV2 } from '../../components/csv';
import ServerDataGrid, { EnhancedColDef } from '../../components/ServerDataGrid';
import { LinkCellRenderer } from '../../components/grid/renderers';
import { StatusDot } from '../../components/design';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDateTime } from '../../lib/dateFormat';
import { formatItemRef } from '../../utils/item-ref';
import { getDotColor, INCIDENT_SEVERITY_COLORS, INCIDENT_STATUS_COLORS } from '../../utils/statusColors';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, type IncidentRow } from '../../api/endpoints/incidents';
import { setListFiltersParam, getWithListContext } from '../../lib/listContext';

const DEFAULT_SORT = 'detected_at:DESC';

const refCellStyle = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: '12px',
  color: 'var(--kanap-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
};

export default function IncidentsPage() {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel } = useAuth();
  const { labelFor } = useItOpsEnumOptions();
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  // Read filters from URL to restore state when returning from the workspace
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

  const initialGridState = useMemo(() => {
    if (urlFilters && Object.keys(urlFilters).length > 0) {
      return { filter: { filterModel: urlFilters } };
    }
    return undefined;
  }, [urlFilters]);

  const severityLabel = useCallback(
    (value?: string | null) => (value ? t(`enums.incidentSeverity.${value}`, { defaultValue: value }) : ''),
    [t],
  );
  const statusLabel = useCallback(
    (value?: string | null) => (value ? t(`enums.incidentStatus.${value}`, { defaultValue: value }) : ''),
    [t],
  );
  const categoryLabel = useCallback(
    (value?: string | null) => labelFor('incidentCategories', value) || (value || ''),
    [labelFor],
  );

  // Factory for checkbox set filter values - fetches scoped values from the backend
  const getIncidentFilterValues = useCallback((
    field: string,
    opts?: {
      labelFn?: (code: string) => string;
      order?: Array<string | null>;
      emptyLabel?: string;
    },
  ) => {
    const labelFn = opts?.labelFn;
    const order = opts?.order;
    const emptyLabel = opts?.emptyLabel ?? t('pages.incidents.filters.blank');
    return async ({ context }: any) => {
      const queryState = context?.getQueryState?.() ?? {};
      const filters = { ...(queryState.filters || {}) };
      delete filters[field];
      const params: Record<string, any> = { fields: field };
      if (queryState.q) params.q = queryState.q;
      if (Object.keys(filters).length > 0) {
        params.filters = JSON.stringify(filters);
      }
      const res = await getWithListContext('/incidents/filter-values', params);
      const values = (res.data?.[field] || []) as Array<string | null>;
      const options = values.map((value) => {
        if (value == null) return { value, label: emptyLabel };
        const key = String(value);
        return { value, label: (labelFn ? labelFn(key) : '') || key };
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
  }, [t]);

  // List context preservation for prev/next navigation
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || DEFAULT_SORT;
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    setListFiltersParam(sp, '/incidents', filters);
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

  const getIncidentHref = useCallback((row: IncidentRow) => {
    const sp = buildWorkspaceSearch();
    const ref = row.item_number != null ? formatItemRef('incident', row.item_number) : row.id;
    return `/it/incidents/${ref}/overview?${sp.toString()}`;
  }, [buildWorkspaceSearch]);

  const handleInternalNavigate = useCallback((event: React.MouseEvent, href: string) => {
    if (!isPlainLeftClick(event)) return;
    event.preventDefault();
    navigate(href);
  }, [isPlainLeftClick, navigate]);

  const ClickToWorkspace = useMemo(() => {
    const Cell: React.FC<ICellRendererParams<IncidentRow, any>> = (params) => (
      <LinkCellRenderer
        {...params}
        linkType="internal"
        getHref={getIncidentHref}
        onNavigate={(href) => navigate(href)}
      />
    );
    return Cell;
  }, [getIncidentHref, navigate]);

  // Colored dot + neutral label (grid cells inherit text color) that still opens the workspace
  const makeDotCell = useCallback((
    colorMap: Record<string, string>,
    labelOf: (value?: string | null) => string,
  ) => {
    const mode = theme.palette.mode;
    const Cell: React.FC<ICellRendererParams<IncidentRow, any>> = (params) => {
      const value = params.value as string | null | undefined;
      if (!value || !params.data) return null;
      const href = getIncidentHref(params.data);
      return (
        <Link
          href={href}
          onClick={(event) => handleInternalNavigate(event, href)}
          sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px', cursor: 'pointer', textDecoration: 'none', color: 'text.primary', '&:hover': { textDecoration: 'none' } }}
        >
          <StatusDot color={getDotColor(colorMap[value] ?? 'default', mode)} />
          {labelOf(value)}
        </Link>
      );
    };
    return Cell;
  }, [getIncidentHref, handleInternalNavigate, theme.palette.mode]);

  const SeverityCell = useMemo(() => makeDotCell(INCIDENT_SEVERITY_COLORS, severityLabel), [makeDotCell, severityLabel]);
  const StatusCell = useMemo(() => makeDotCell(INCIDENT_STATUS_COLORS, statusLabel), [makeDotCell, statusLabel]);

  const columns: EnhancedColDef<IncidentRow>[] = useMemo(() => [
    {
      field: 'item_number',
      headerName: t('pages.incidents.columns.reference'),
      width: 96,
      filter: false,
      valueGetter: (p) => (p.data?.item_number != null ? formatItemRef('incident', p.data.item_number) : ''),
      cellStyle: refCellStyle,
      cellRenderer: ClickToWorkspace,
    },
    { headerName: t('pages.incidents.columns.title'), field: 'title', minWidth: 240, flex: 1, cellRenderer: ClickToWorkspace },
    {
      headerName: t('pages.incidents.columns.category'),
      field: 'category',
      width: 150,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getIncidentFilterValues('category', { labelFn: categoryLabel, emptyLabel: t('pages.incidents.filters.noCategory') }),
        searchable: false,
      },
      valueFormatter: (p) => categoryLabel(p.value),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.severity'),
      field: 'severity',
      width: 120,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getIncidentFilterValues('severity', { labelFn: severityLabel, order: INCIDENT_SEVERITIES }),
        searchable: false,
      },
      valueFormatter: (p) => severityLabel(p.value),
      cellRenderer: SeverityCell,
    },
    {
      headerName: t('pages.incidents.columns.status'),
      field: 'status',
      width: 130,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getIncidentFilterValues('status', { labelFn: statusLabel, order: INCIDENT_STATUSES }),
        searchable: false,
      },
      valueFormatter: (p) => statusLabel(p.value),
      cellRenderer: StatusCell,
    },
    {
      headerName: t('pages.incidents.columns.detected'),
      field: 'detected_at',
      width: 170,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => formatShortDateTime(p.value, locale),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.resolved'),
      field: 'resolved_at',
      width: 170,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => formatShortDateTime(p.value, locale),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.closed'),
      field: 'closed_at',
      width: 170,
      hide: true,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => formatShortDateTime(p.value, locale),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.owner'),
      field: 'owner_name',
      width: 160,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getIncidentFilterValues('owner_name', { emptyLabel: t('pages.incidents.filters.noOwner') }),
        searchable: true,
      },
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.access'),
      field: 'confidential',
      width: 120,
      hide: true,
      filter: false,
      valueFormatter: (p) => (p.value ? t('workspace.incident.metadata.restricted') : ''),
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.assets'),
      field: 'asset_count',
      width: 100,
      sortable: false,
      filter: false,
      valueFormatter: (p) => p.value ?? 0,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.applications'),
      field: 'application_count',
      width: 120,
      hide: true,
      sortable: false,
      filter: false,
      valueFormatter: (p) => p.value ?? 0,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.tasks'),
      field: 'task_count',
      width: 100,
      sortable: false,
      filter: false,
      valueFormatter: (p) => p.value ?? 0,
      cellRenderer: ClickToWorkspace,
    },
    {
      headerName: t('pages.incidents.columns.created'),
      field: 'created_at',
      width: 170,
      hide: true,
      filter: 'agDateColumnFilter',
      valueFormatter: (p) => formatShortDateTime(p.value, locale),
      cellRenderer: ClickToWorkspace,
    },
  ], [ClickToWorkspace, SeverityCell, StatusCell, categoryLabel, getIncidentFilterValues, locale, severityLabel, statusLabel, t]);

  if (!hasLevel('incidents', 'reader')) {
    return <ForbiddenPage />;
  }

  const actions = (
    <Stack direction="row" spacing={1}>
      {hasLevel('incidents', 'contributor') && (
        <Button variant="contained" onClick={() => {
          const sp = buildWorkspaceSearch();
          navigate(`/it/incidents/new?${sp.toString()}`);
        }}>
          {t('pages.incidents.newIncident')}
        </Button>
      )}
      {hasLevel('incidents', 'contributor') && (
        <Button onClick={() => setImportOpen(true)}>{t('pages.incidents.importCsv')}</Button>
      )}
      <Button onClick={() => setExportOpen(true)}>{t('pages.incidents.exportCsv')}</Button>
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('pages.incidents.title')} actions={actions} />
      <ServerDataGrid<IncidentRow>
        columns={columns}
        endpoint="/incidents"
        showRowCount
        queryKey="incidents"
        defaultSort={{ field: 'detected_at', direction: 'DESC' }}
        enableColumnChooser
        enableSearch
        columnPreferencesKey="kanap.incidents.columns"
        refreshKey={refreshKey}
        initialState={initialGridState}
        onQueryStateChange={(state) => {
          lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
        }}
      />
      <CsvExportDialogV2
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/incidents"
        title={t('pages.incidents.exportTitle')}
      />
      <CsvImportDialogV2
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/incidents"
        title={t('pages.incidents.importTitle')}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
