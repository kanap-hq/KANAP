import React, { useMemo, useState, useCallback, useRef } from 'react';
import { Button, Stack, Box, LinearProgress, Typography, RadioGroup, FormControlLabel, Radio, Tooltip } from '@mui/material';
import type { EnhancedColDef } from '../../components/ServerDataGrid';
import ServerDataGrid from '../../components/ServerDataGrid';
import { LinkCellRenderer } from '../../components/grid/renderers';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';
import type { ICellRendererParams } from 'ag-grid-community';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CsvExportDialogV2, CsvImportDialogV2 } from '../../components/csv';
import ForbiddenPage from '../ForbiddenPage';
import CheckboxSetFilter from '../../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../../components/CheckboxSetFloatingFilter';
import api from '../../api';
import { useGridScopePreference } from '../../hooks/useGridScopePreference';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { getDotColor, PROJECT_STATUS_COLORS } from '../../utils/statusColors';
import { useTheme } from '@mui/material/styles';
import { StatusDot } from '../../components/design';
import { setListFiltersParam, getWithListContext } from '../../lib/listContext';
import { useUrlFilterModel } from '../../hooks/useListContextSearch';

type ProjectRow = {
  id: string;
  name: string;
  purpose: string | null;
  status: string;
  origin: 'standard' | 'fast_track' | 'legacy';
  source_id: string | null;
  source_name: string | null;
  category_id: string | null;
  category_name: string | null;
  stream_id: string | null;
  stream_name: string | null;
  company_id: string | null;
  company?: { id: string; name: string } | null;
  priority_score: number | null;
  execution_progress: number;
  planned_start: string | null;
  planned_end: string | null;
  item_number: number;
  created_at: string;
  updated_at: string;
};

const STATUS_LABELS: Record<string, string> = {
  waiting_list: 'Waiting List',
  planned: 'Planned',
  in_progress: 'In Progress',
  in_testing: 'In Testing',
  on_hold: 'On Hold',
  done: 'Done',
  cancelled: 'Cancelled',
};

const ORIGIN_LABELS: Record<string, string> = {
  standard: 'Request',
  fast_track: 'Fast-track',
  legacy: 'Legacy',
};

const STATUS_ORDER = Object.keys(STATUS_LABELS);


function ProgressCellRenderer(props: any) {
  const value = Number(props.value) || 0;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, width: '100%', py: 1 }}>
      <LinearProgress
        variant="determinate"
        value={value}
        sx={{ flex: 1, height: 8, borderRadius: 4 }}
      />
      <Typography variant="caption" sx={{ minWidth: 35 }}>{value}%</Typography>
    </Box>
  );
}

export default function ProjectsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel, profile } = useAuth();
  const { t } = useTranslation(['portfolio', 'common']);
  const locale = useLocale();
  const theme = useTheme();
  const [refreshKey, setRefreshKey] = useState(0);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const gridApiRef = useRef<any>(null);

  const canCreate = hasLevel('portfolio_projects', 'manager');
  const canAdmin = hasLevel('portfolio_projects', 'admin');

  const statusLabelMap = useMemo(() => Object.fromEntries(
    Object.entries(STATUS_LABELS).map(([status, label]) => [
      status,
      t(`statuses.project.${status}`, { defaultValue: label }),
    ]),
  ) as Record<string, string>, [t]);

  const originLabelMap = useMemo(() => Object.fromEntries(
    Object.entries(ORIGIN_LABELS).map(([origin, label]) => [
      origin,
      t(`origin.${origin}`, { defaultValue: label }),
    ]),
  ) as Record<string, string>, [t]);

  const renderStatusCell = useCallback((props: any) => {
    const status = props.value as string;
    const label = t(`statuses.project.${status}`, { defaultValue: STATUS_LABELS[status] || status });
    return (
      <Box component="span" sx={(theme) => {
        const color = getDotColor(PROJECT_STATUS_COLORS[status], theme.palette.mode);
        return { display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.8125rem', fontWeight: 500, color, lineHeight: 1 };
      }}>
        <StatusDot color={getDotColor(PROJECT_STATUS_COLORS[status], theme.palette.mode)} />
        {label}
      </Box>
    );
  }, [t, theme.palette.mode]);

  // Read filters from URL to restore state when returning from workspace: inline, or the saved
  // filters its `ctx` stands for (filters too long for a URL), read before the grid mounts.
  const urlFilterState = useUrlFilterModel(location.search, '/portfolio/projects');
  const urlFilters = urlFilterState.model;
  const urlProjectScope = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const scope = params.get('projectScope');
    if (scope === 'my' || scope === 'team' || scope === 'all') {
      return scope;
    }
    return null;
  }, [location.search]);
  const [projectScope, setProjectScope] = useGridScopePreference('projects', urlProjectScope);

  const { data: myTeamConfig, isFetched: isTeamConfigFetched } = useQuery({
    queryKey: ['my-team-config', profile?.id],
    queryFn: async () => {
      const res = await api.get<{ id: string; team_id?: string | null }>(`/portfolio/team-members/by-user/${profile?.id}`);
      return res.data;
    },
    enabled: !!profile?.id && hasLevel('portfolio_projects', 'reader'),
  });
  const hasTeam = !!myTeamConfig?.team_id;

  const projectScopeRef = useRef(projectScope);
  const profileIdRef = useRef<string | null>(profile?.id ?? null);
  const hasTeamRef = useRef(hasTeam);
  const teamIdRef = useRef<string | null>(myTeamConfig?.team_id ?? null);

  React.useEffect(() => {
    projectScopeRef.current = projectScope;
  }, [projectScope]);

  React.useEffect(() => {
    profileIdRef.current = profile?.id ?? null;
  }, [profile?.id]);

  React.useEffect(() => {
    hasTeamRef.current = hasTeam;
  }, [hasTeam]);

  React.useEffect(() => {
    teamIdRef.current = myTeamConfig?.team_id ?? null;
  }, [myTeamConfig?.team_id]);

  React.useEffect(() => {
    if (projectScope === 'team' && isTeamConfigFetched && !hasTeam) {
      setProjectScope('my');
    }
  }, [projectScope, isTeamConfigFetched, hasTeam]);

  // Default filter: exclude 'done' status
  const defaultStatusValues = useMemo(
    () => STATUS_ORDER.filter((status) => status !== 'done'),
    [],
  );
  const defaultFilterModel = useMemo(() => ({
    status: {
      filterType: 'set',
      values: defaultStatusValues,
    },
  }), [defaultStatusValues]);

  // Use URL filters if present, otherwise use default
  const initialFilterModel = useMemo(() => {
    return urlFilters || defaultFilterModel;
  }, [urlFilters, defaultFilterModel]);

  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'priority_score:DESC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    setListFiltersParam(sp, '/portfolio/projects', filters);
    const scope = projectScopeRef.current;
    const profileId = profileIdRef.current;
    const hasTeamNow = hasTeamRef.current;
    const teamId = teamIdRef.current;
    sp.set('projectScope', scope);
    if (scope === 'my' && profileId) {
      sp.set('involvedUserId', profileId);
    } else if (scope === 'team' && hasTeamNow && teamId) {
      sp.set('involvedTeamId', teamId);
      if (profileId) sp.set('involvedUserId', profileId);
    }
    return sp;
  }, [t]);

  const projectScopeToolbar = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography variant="body2">{t('common:labels.show')}:</Typography>
      <RadioGroup
        row
        value={projectScope}
        onChange={(e) => setProjectScope(e.target.value as 'my' | 'team' | 'all')}
        sx={{ '& .MuiFormControlLabel-root': { mr: 1 } }}
      >
        <FormControlLabel
          value="my"
          control={<Radio size="small" />}
          label={t('scope.my', { entity: t('projects.entityName') })}
        />
        <Tooltip title={hasTeam ? '' : t('scope.teamUnavailable')}>
          <span>
            <FormControlLabel
              value="team"
              control={<Radio size="small" />}
              label={t('scope.myTeam', { entity: t('projects.entityName') })}
              disabled={!hasTeam}
            />
          </span>
        </Tooltip>
        <FormControlLabel
          value="all"
          control={<Radio size="small" />}
          label={t('scope.all', { entity: t('projects.entityName') })}
        />
      </RadioGroup>
    </Stack>
  );

  const clickableCellRenderer = useCallback((params: ICellRendererParams<ProjectRow, any>) => (
    <LinkCellRenderer
      {...params}
      linkType="internal"
      getHref={(data) => {
        if (!data?.id) return null;
        const sp = buildWorkspaceSearch();
        const ref = data.item_number ? `PRJ-${data.item_number}` : data.id;
        return `/portfolio/projects/${ref}/summary?${sp.toString()}`;
      }}
      onNavigate={(href) => navigate(href)}
    />
  ), [buildWorkspaceSearch, navigate]);

  const getProjectFilterValues = useCallback((
    field: string,
    opts?: { labelMap?: Record<string, string>; order?: Array<string | null>; emptyLabel?: string; searchable?: boolean },
  ) => {
    const labelMap = opts?.labelMap;
    const order = opts?.order;
    const emptyLabel = opts?.emptyLabel ?? t('shared.blankValue');
    return async ({ context }: any) => {
      const queryState = context?.getQueryState?.() ?? {};
      const filters = { ...(queryState.filters || {}) };
      delete filters[field];
      const params: Record<string, any> = {
        fields: field,
        ...(queryState.extraParams || {}),
      };
      if (queryState.q) params.q = queryState.q;
      if (Object.keys(filters).length > 0) {
        params.filters = JSON.stringify(filters);
      }
      const res = await getWithListContext('/portfolio/projects/filter-values', params);
      const values = (res.data?.[field] || []) as Array<string | null>;
      let options = values.map((value) => {
        if (value == null) return { value, label: emptyLabel };
        const key = String(value);
        const label = labelMap && Object.prototype.hasOwnProperty.call(labelMap, key) ? labelMap[key] : key;
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

  const columns: EnhancedColDef<ProjectRow>[] = useMemo(() => [
    {
      field: 'item_number',
      headerName: '#',
      width: 90,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
      valueFormatter: (p: any) => p.value ? `PRJ-${p.value}` : '',
      comparator: (a: number, b: number) => (a || 0) - (b || 0),
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
    },
    {
      field: 'name',
      headerName: t('projects.columns.projectName'),
      flex: 1.5,
      minWidth: 220,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
    },
    // Carry the project and team filters the portfolio reports link with. Never shown and kept
    // out of the column chooser: the column only has to exist, or AG Grid would drop the model
    // on the next filter change.
    {
      field: 'id',
      headerName: t('reports.weekly.filters.project'),
      hide: true,
      defaultHidden: true,
      suppressColumnsToolPanel: true,
      filter: CheckboxSetFilter,
      filterParams: { values: [] },
      sortable: false,
    },
    {
      colId: 'involved_team_id',
      headerName: t('reports.weekly.filters.team'),
      hide: true,
      defaultHidden: true,
      suppressColumnsToolPanel: true,
      filter: CheckboxSetFilter,
      filterParams: { values: [] },
      sortable: false,
    },
    {
      field: 'priority_score',
      headerName: t('projects.columns.priority'),
      width: 100,
      filter: 'agNumberColumnFilter',
      valueFormatter: (params: any) => (params.value != null ? String(Math.round(params.value)) : ''),
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'status',
      headerName: t('projects.columns.status'),
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getProjectFilterValues('status', { labelMap: statusLabelMap, order: STATUS_ORDER }),
        searchable: false,
        treatAllAsUnfiltered: false,
      },
      cellRenderer: renderStatusCell,
    },
    {
      field: 'origin',
      headerName: t('projects.columns.origin'),
      width: 110,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getProjectFilterValues('origin', { labelMap: originLabelMap, order: ['standard', 'fast_track', 'legacy'] }),
        searchable: false,
      },
      valueFormatter: (params: any) => originLabelMap[params.value] || params.value,
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'execution_progress',
      headerName: t('projects.columns.progress'),
      width: 140,
      filter: 'agNumberColumnFilter',
      cellRenderer: ProgressCellRenderer,
    },
    {
      field: 'source_name',
      headerName: t('projects.columns.source'),
      width: 100,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getProjectFilterValues('source_name'),
        searchable: false,
      },
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'category_name',
      headerName: t('projects.columns.category'),
      width: 200,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getProjectFilterValues('category_name'),
        searchable: false,
      },
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'stream_name',
      headerName: t('projects.columns.stream'),
      width: 180,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getProjectFilterValues('stream_name'),
        searchable: false,
      },
      cellRenderer: clickableCellRenderer,
    },
    {
      colId: 'company_name',
      headerName: t('projects.columns.company'),
      width: 180,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getProjectFilterValues('company_name'),
        searchable: false,
      },
      valueGetter: (params: any) => params.data?.company?.name || '',
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'planned_start',
      headerName: t('projects.columns.start'),
      width: 110,
      filter: 'agDateColumnFilter',
      valueFormatter: (params: any) => formatShortDate(params.value, locale),
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'planned_end',
      headerName: t('projects.columns.end'),
      width: 110,
      filter: 'agDateColumnFilter',
      valueFormatter: (params: any) => formatShortDate(params.value, locale),
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'created_at',
      headerName: t('projects.columns.created'),
      width: 110,
      filter: 'agDateColumnFilter',
      valueFormatter: (params: any) => formatShortDate(params.value, locale),
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'updated_at',
      headerName: t('projects.columns.lastChanged'),
      width: 130,
      filter: 'agDateColumnFilter',
      valueFormatter: (params: any) => formatShortDate(params.value, locale),
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
  ], [clickableCellRenderer, getProjectFilterValues, locale, originLabelMap, renderStatusCell, statusLabelMap, t]);

  const extraParams = useMemo(() => {
    const params: Record<string, any> = {
      include: 'company,classification',
    };
    if (projectScope === 'my' && profile?.id) {
      params.involvedUserId = profile.id;
    } else if (projectScope === 'team' && hasTeam && myTeamConfig?.team_id) {
      params.involvedTeamId = myTeamConfig.team_id;
      if (profile?.id) params.involvedUserId = profile.id;
    }
    return params;
  }, [projectScope, profile?.id, hasTeam, myTeamConfig?.team_id]);

  // Use URL filters if present, otherwise use default filter
  const initialGridState = useMemo(() => ({
    filter: {
      filterModel: initialFilterModel,
    },
  }), [initialFilterModel]);

  if (!hasLevel('portfolio_projects', 'reader')) {
    return <ForbiddenPage />;
  }

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button
          variant="action-primary"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/portfolio/projects/new/summary?${sp.toString()}`);
          }}
        >
          {t('projects.actions.new')}
        </Button>
      )}
      {canAdmin && <Button variant="action" onClick={() => setImportOpen(true)}>{t('projects.actions.importCsv')}</Button>}
      {canAdmin && <Button variant="action" onClick={() => setExportOpen(true)}>{t('projects.actions.exportCsv')}</Button>}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('projects.title')} actions={actions} />
      {/* Waits for filters saved as a context (a reload, a link in a new tab). */}
      {urlFilterState.ready && (
        <ServerDataGrid<ProjectRow>
          columns={columns}
          endpoint="/portfolio/projects"
          showRowCount
          queryKey="portfolio-projects"
          getRowId={(r) => r.id}
          enableSearch
          defaultSort={{ field: 'priority_score', direction: 'DESC' }}
          extraParams={extraParams}
          columnPreferencesKey="portfolio-projects"
          initialState={initialGridState}
          refreshKey={refreshKey}
          onGridApiReady={(api) => { gridApiRef.current = api; }}
          onQueryStateChange={(state) => {
            lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
          }}
          toolbarExtras={projectScopeToolbar}
        />
      )}
      <CsvExportDialogV2
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/portfolio/projects"
        title={t('projects.csv.exportTitle')}
        presets={[{ name: 'enrichment', label: t('projects.csv.presetEnrichment') }]}
      />
      <CsvImportDialogV2
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/portfolio/projects"
        title={t('projects.csv.importTitle')}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
