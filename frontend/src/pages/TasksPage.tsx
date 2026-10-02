import React, { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { Button, Stack, Box, RadioGroup, FormControlLabel, Radio, Tooltip, Typography } from '@mui/material';
import type { EnhancedColDef } from '../components/ServerDataGrid';
import ServerDataGrid from '../components/ServerDataGrid';
import { LinkCellRenderer } from '../components/grid/renderers';
import PageHeader from '../components/PageHeader';
import { useAuth } from '../auth/AuthContext';
import type { ICellRendererParams } from 'ag-grid-community';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import DeleteSelectedButton from '../components/DeleteSelectedButton';
import { CsvExportDialogV2, CsvImportDialogV2 } from '../components/csv';
import ForbiddenPage from './ForbiddenPage';
import api from '../api';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import { useGridScopePreference } from '../hooks/useGridScopePreference';
import { ACTIVE_TASK_STATUSES, TASK_STATUS_COLORS, TASK_STATUS_LABELS } from './tasks/task.constants';
import { useTranslation } from 'react-i18next';
import { useLocale } from '../i18n/useLocale';
import { formatShortDate } from '../lib/dateFormat';
import { getDotColor } from '../utils/statusColors';
import { useTheme } from '@mui/material/styles';
import { StatusDot } from '../components/design';
import { setListFiltersParam, withListContext } from '../lib/listContext';
import { useUrlFilterModel } from '../hooks/useListContextSearch';

type TaskRow = {
  id: string;
  tenant_id: string;
  title: string | null;
  description: string;
  status: string;
  task_type_id: string | null;
  task_type_name: string | null;
  priority_level: string;
  priority_score: number;
  due_date: string | null;
  start_date: string | null;
  created_at: string;
  updated_at: string;
  assignee_user_id: string | null;
  assignee_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  related_object_type: string | null;
  related_object_id: string | null;
  related_object_name: string | null;
  phase_id: string | null;
  phase_name: string | null;
  item_number: number;
  // Classification fields
  source_id: string | null;
  source_name: string | null;
  category_id: string | null;
  category_name: string | null;
  stream_id: string | null;
  stream_name: string | null;
  company_id: string | null;
  company_name: string | null;
};

const STATUS_LABEL_MAP: Record<string, string> = TASK_STATUS_LABELS as Record<string, string>;

const STATUS_COLOR_MAP: Record<string, 'default' | 'warning' | 'info' | 'secondary' | 'success' | 'error'> = TASK_STATUS_COLORS as Record<string, 'default' | 'warning' | 'info' | 'secondary' | 'success' | 'error'>;

const CONTEXT_LABEL_MAP: Record<string, string> = {
  project: 'Project',
  spend_item: 'OPEX',
  contract: 'Contract',
  capex_item: 'CAPEX',
  incident: 'Incident',
};

const PRIORITY_COLOR_MAP: Record<string, 'error' | 'warning' | 'default' | 'info' | 'success'> = {
  blocker: 'error',
  high: 'warning',
  normal: 'default',
  low: 'info',
  optional: 'success',
};

const PRIORITY_LABEL_MAP: Record<string, string> = {
  blocker: 'Blocker',
  high: 'High',
  normal: 'Medium',
  low: 'Low',
  optional: 'Optional',
};

function TaskTypeCellRenderer(props: any) {
  const typeName = props.value;
  if (!typeName) {
    return <Box component="span" sx={{ color: 'text.disabled' }}>-</Box>;
  }
  return (
    <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
      {typeName}
    </Box>
  );
}

function ScoreCellRenderer(props: any) {
  const score = props.value;
  if (score === null || score === undefined) {
    return <Box component="span" sx={{ color: 'text.disabled' }}>-</Box>;
  }
  return (
    <Box component="span" sx={{ color: 'text.primary', fontSize: '0.8125rem', fontWeight: 600 }}>
      {Math.round(score)}
    </Box>
  );
}

export default function TasksPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { hasLevel, profile } = useAuth();
  const { t } = useTranslation(['portfolio', 'common']);
  const locale = useLocale();
  const theme = useTheme();

  if (!hasLevel('tasks', 'reader')) {
    return <ForbiddenPage />;
  }

  // Read filters from URL to restore state when returning from workspace: inline, or the saved
  // filters its `ctx` stands for (filters too long for a URL), read before the grid mounts.
  const urlFilterState = useUrlFilterModel(location.search, '/tasks');
  const urlFilters = urlFilterState.model;

  // Use URL filters if present (backend already excludes done/cancelled by default)
  const defaultFilterModel = useMemo(() => ({
    status: { filterType: 'set', values: ACTIVE_TASK_STATUSES },
  }), []);

  const initialFilterModel = useMemo(() => {
    if (urlFilters && typeof urlFilters === 'object') {
      if (Object.prototype.hasOwnProperty.call(urlFilters, 'status')) {
        return urlFilters;
      }
      return { ...defaultFilterModel, ...urlFilters };
    }
    return defaultFilterModel;
  }, [urlFilters, defaultFilterModel]);

  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedRows, setSelectedRows] = useState<TaskRow[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const gridApiRef = useRef<any>(null);

  const statusLabelMap = useMemo(() => Object.fromEntries(
    Object.entries(STATUS_LABEL_MAP).map(([status, label]) => [
      status,
      t(`statuses.task.${status}`, { defaultValue: label }),
    ]),
  ) as Record<string, string>, [t]);

  const contextLabelMap = useMemo(() => Object.fromEntries(
    Object.entries(CONTEXT_LABEL_MAP).map(([context, label]) => [
      context,
      t(`context.${context}`, { defaultValue: label }),
    ]),
  ) as Record<string, string>, [t]);

  const renderStatusCell = useCallback((props: any) => {
    const status = String(props.value || '');
    const label = t(`statuses.task.${status}`, { defaultValue: STATUS_LABEL_MAP[status] || status });
    const colorKey = STATUS_COLOR_MAP[status] || 'default';
    return (
      <Box component="span" sx={(theme) => {
        const color = getDotColor(colorKey, theme.palette.mode);
        return {
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          fontSize: '0.8125rem', fontWeight: 500, color, lineHeight: 1,
        };
      }}>
        <StatusDot color={getDotColor(colorKey, theme.palette.mode)} />
        {label}
      </Box>
    );
  }, [t, theme.palette.mode]);

  const renderPriorityCell = useCallback((props: any) => {
    const priority = String(props.value || 'normal');
    const label = t(`priority.${priority}`, { defaultValue: PRIORITY_LABEL_MAP[priority] || PRIORITY_LABEL_MAP.normal });
    return (
      <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
        {label}
      </Box>
    );
  }, [t]);

  const renderTypeCell = useCallback((props: any) => {
    const type = props.value as string | null | undefined;
    const label = type
      ? t(`context.${type}`, { defaultValue: CONTEXT_LABEL_MAP[type] || type })
      : t('tasks.values.standalone');
    return (
      <Box component="span" sx={{ color: 'text.secondary', fontSize: '0.8125rem' }}>
        {label}
      </Box>
    );
  }, [t]);

  // Read taskScope from URL to restore state when returning from workspace
  const urlTaskScope = useMemo(() => {
    const params = new URLSearchParams(location.search);
    const scope = params.get('taskScope');
    if (scope === 'my' || scope === 'team' || scope === 'all') {
      return scope;
    }
    return null;
  }, [location.search]);

  const [taskScope, setTaskScope] = useGridScopePreference('tasks', urlTaskScope);

  const canCreate = hasLevel('tasks', 'member');
  const canAdmin = hasLevel('tasks', 'admin');

  // Fetch current user's team config
  const { data: myTeamConfig, isFetched: isTeamConfigFetched } = useQuery({
    queryKey: ['my-team-config', profile?.id],
    queryFn: async () => {
      const res = await api.get<{ id: string; team_id?: string | null }>(`/portfolio/team-members/by-user/${profile?.id}`);
      return res.data;
    },
    enabled: !!profile?.id,
  });

  const hasTeam = !!myTeamConfig?.team_id;

  const taskScopeRef = useRef(taskScope);
  const profileIdRef = useRef<string | null>(profile?.id ?? null);
  const hasTeamRef = useRef(hasTeam);
  const teamIdRef = useRef<string | null>(myTeamConfig?.team_id ?? null);

  useEffect(() => {
    taskScopeRef.current = taskScope;
  }, [taskScope]);

  useEffect(() => {
    profileIdRef.current = profile?.id ?? null;
  }, [profile?.id]);

  useEffect(() => {
    hasTeamRef.current = hasTeam;
  }, [hasTeam]);

  useEffect(() => {
    teamIdRef.current = myTeamConfig?.team_id ?? null;
  }, [myTeamConfig?.team_id]);

  useEffect(() => {
    if (taskScope === 'team' && isTeamConfigFetched && !hasTeam) {
      setTaskScope('my');
    }
  }, [taskScope, isTeamConfigFetched, hasTeam, setTaskScope]);

  // Filter extraParams based on scope selection
  const extraParams = useMemo(() => {
    if (taskScope === 'my') return { involvedUserId: profile?.id };
    if (taskScope === 'team' && hasTeam) return { teamId: myTeamConfig?.team_id };
    return {};
  }, [taskScope, profile?.id, hasTeam, myTeamConfig?.team_id]);

  // Task scope filter toolbar
  const taskScopeToolbar = (
    <Stack direction="row" spacing={0.5} alignItems="center">
      <Typography variant="body2">{t('common:labels.show')}:</Typography>
      <RadioGroup
        row
        value={taskScope}
        onChange={(e) => setTaskScope(e.target.value as 'my' | 'team' | 'all')}
        sx={{ '& .MuiFormControlLabel-root': { mr: 1 } }}
      >
        <FormControlLabel
          value="my"
          control={<Radio size="small" />}
          label={t('scope.my', { entity: t('tasks.entityName') })}
        />
        <Tooltip title={hasTeam ? '' : t('scope.teamUnavailable')}>
          <span>
            <FormControlLabel
              value="team"
              control={<Radio size="small" />}
              label={t('scope.myTeam', { entity: t('tasks.entityName') })}
              disabled={!hasTeam}
            />
          </span>
        </Tooltip>
        <FormControlLabel
          value="all"
          control={<Radio size="small" />}
          label={t('scope.all', { entity: t('tasks.entityName') })}
        />
      </RadioGroup>
    </Stack>
  );

  // Preserve list query context for workspace
  const lastQueryRef = useRef<{ sort: string; q: string; filters: any } | null>(null);
  const buildWorkspaceSearch = useCallback(() => {
    const sp = new URLSearchParams();
    const sort = lastQueryRef.current?.sort || 'priority_score:DESC';
    const q = lastQueryRef.current?.q || '';
    const filters = lastQueryRef.current?.filters || {};
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    setListFiltersParam(sp, '/tasks', filters);
    const scope = taskScopeRef.current;
    const profileId = profileIdRef.current;
    const hasTeamNow = hasTeamRef.current;
    const teamId = teamIdRef.current;
    // Include task scope and derived params for workspace navigation
    sp.set('taskScope', scope);
    if (scope === 'my' && profileId) {
      sp.set('involvedUserId', profileId);
    } else if (scope === 'team' && hasTeamNow && teamId) {
      sp.set('teamId', teamId);
    }
    return sp;
  }, [t]);

  const getTaskFilterValues = useCallback((field: string, opts?: { labelMap?: Record<string, string>; order?: Array<string | null>; emptyLabel?: string; searchable?: boolean }) => {
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
      const res = await api.get(`/tasks/filter-values`, { params: await withListContext(`/tasks/filter-values`, params) });
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

  // Keep renderer stable so AG Grid does not treat column defs as changed on URL sort updates.
  const clickableCellRenderer = useCallback((params: ICellRendererParams<TaskRow, any>) => (
    <LinkCellRenderer
      {...params}
      linkType="internal"
      getHref={(data) => {
        const sp = buildWorkspaceSearch();
        const ref = data?.item_number ? `T-${data.item_number}` : data?.id;
        if (!ref) return null;
        return `/portfolio/tasks/${ref}/overview?${sp.toString()}`;
      }}
      onNavigate={(href) => navigate(href)}
    />
  ), [buildWorkspaceSearch, navigate]);

  const columns: EnhancedColDef<TaskRow>[] = useMemo(() => [
    {
      field: 'item_number',
      headerName: '#',
      width: 90,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
      valueFormatter: (p: any) => p.value ? `T-${p.value}` : '',
      comparator: (a: number, b: number) => (a || 0) - (b || 0),
      cellStyle: { fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace", fontSize: '12px', color: 'var(--kanap-text-secondary)', fontVariantNumeric: 'tabular-nums' },
    },
    {
      field: 'title',
      headerName: t('tasks.columns.taskTitle'),
      flex: 1.5,
      minWidth: 200,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'task_type_name',
      headerName: t('tasks.columns.taskType'),
      width: 110,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getTaskFilterValues('task_type_name'),
        searchable: false,
      },
      cellRenderer: TaskTypeCellRenderer,
    },
    {
      field: 'related_object_type',
      headerName: t('tasks.columns.context'),
      width: 110,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getTaskFilterValues('related_object_type', {
          labelMap: contextLabelMap,
          order: [null, 'project', 'spend_item', 'capex_item', 'contract', 'incident'],
          emptyLabel: t('tasks.values.standalone'),
        }),
        searchable: false,
        emptyLabel: t('tasks.values.standalone'),
      },
      cellRenderer: renderTypeCell,
    },
    {
      field: 'related_object_name',
      headerName: t('tasks.columns.relatedEntry'),
      flex: 1.5,
      minWidth: 180,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    {
      field: 'phase_name',
      headerName: t('tasks.columns.phase'),
      width: 140,
      filter: 'agTextColumnFilter',
      valueFormatter: (params) => params.value || t('tasks.values.projectLevel'),
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    {
      field: 'status',
      headerName: t('tasks.columns.status'),
      width: 130,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getTaskFilterValues('status', {
          labelMap: statusLabelMap,
          order: ['open', 'in_progress', 'pending', 'in_testing', 'done', 'cancelled'],
        }),
        searchable: false,
      },
      cellRenderer: renderStatusCell,
    },
    {
      field: 'priority_level',
      headerName: t('tasks.columns.priority'),
      width: 110,
      filter: 'agTextColumnFilter',
      cellRenderer: renderPriorityCell,
      hide: true,
    },
    {
      field: 'priority_score',
      headerName: t('tasks.columns.score'),
      width: 90,
      sort: 'desc',
      cellRenderer: ScoreCellRenderer,
    },
    {
      field: 'assignee_name',
      headerName: t('tasks.columns.assignee'),
      flex: 1,
      minWidth: 140,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
    },
    // Carries the `assignee_user_id` filter the portfolio reports link with. It is never shown
    // and never offered in the column chooser: a user has no use for account identifiers. The
    // column has to exist all the same, or AG Grid would drop the model on the next filter change.
    {
      field: 'assignee_user_id',
      headerName: t('tasks.columns.assignee'),
      hide: true,
      defaultHidden: true,
      suppressColumnsToolPanel: true,
      filter: CheckboxSetFilter,
      filterParams: { values: [] },
      sortable: false,
    },
    // The project and the assignee's team, by id, for the portfolio reports narrowed to projects
    // or teams. Hidden and kept out of the column chooser for the same reason as above.
    {
      field: 'related_object_id',
      headerName: t('reports.weekly.filters.project'),
      hide: true,
      defaultHidden: true,
      suppressColumnsToolPanel: true,
      filter: CheckboxSetFilter,
      filterParams: { values: [] },
      sortable: false,
    },
    {
      colId: 'assignee_team_id',
      headerName: t('reports.weekly.filters.team'),
      hide: true,
      defaultHidden: true,
      suppressColumnsToolPanel: true,
      filter: CheckboxSetFilter,
      filterParams: { values: [] },
      sortable: false,
    },
    {
      field: 'creator_name',
      headerName: t('tasks.columns.requestor'),
      flex: 1,
      minWidth: 140,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    {
      field: 'due_date',
      headerName: t('tasks.columns.dueDate'),
      width: 120,
      filter: 'agDateColumnFilter',
      valueFormatter: (params) => formatShortDate(params.value, locale),
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    {
      field: 'created_at',
      headerName: t('tasks.columns.created'),
      width: 120,
      filter: 'agDateColumnFilter',
      valueFormatter: (params) => formatShortDate(params.value, locale),
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    {
      field: 'updated_at',
      headerName: t('tasks.columns.lastChanged'),
      width: 130,
      filter: 'agDateColumnFilter',
      valueFormatter: (params) => formatShortDate(params.value, locale),
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    {
      field: 'description',
      headerName: t('tasks.columns.description'),
      flex: 1.5,
      minWidth: 200,
      filter: 'agTextColumnFilter',
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    // Classification columns (hidden by default)
    {
      field: 'source_name',
      headerName: t('tasks.columns.source'),
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getTaskFilterValues('source_name'),
      },
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
    {
      field: 'category_name',
      headerName: t('tasks.columns.classification'),
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getTaskFilterValues('category_name'),
      },
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'stream_name',
      headerName: t('tasks.columns.stream'),
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getTaskFilterValues('stream_name'),
      },
      cellRenderer: clickableCellRenderer,
    },
    {
      field: 'company_name',
      headerName: t('tasks.columns.company'),
      width: 140,
      filter: CheckboxSetFilter,
      floatingFilterComponent: CheckboxSetFloatingFilter,
      filterParams: {
        getValues: getTaskFilterValues('company_name'),
      },
      cellRenderer: clickableCellRenderer,
      hide: true,
    },
  ], [clickableCellRenderer, contextLabelMap, getTaskFilterValues, locale, renderPriorityCell, renderStatusCell, renderTypeCell, statusLabelMap, t]);

  const actions = (
    <Stack direction="row" spacing={1}>
      {canCreate && (
        <Button
          variant="contained"
          onClick={() => {
            const sp = buildWorkspaceSearch();
            navigate(`/portfolio/tasks/new/overview?${sp.toString()}`);
          }}
        >
          {t('tasks.actions.new')}
        </Button>
      )}
      {canAdmin && <Button onClick={() => setImportOpen(true)}>{t('tasks.actions.importCsv')}</Button>}
      {canAdmin && <Button onClick={() => setExportOpen(true)}>{t('tasks.actions.exportCsv')}</Button>}
      {canAdmin && (
        <DeleteSelectedButton
          selectedRows={selectedRows}
          endpoint="/tasks/bulk"
          getItemId={(row) => row.id}
          getItemName={(row) => row.title || row.related_object_name || row.id}
          gridApi={gridApiRef.current}
          onDeleteSuccess={() => { setRefreshKey((k) => k + 1); }}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={t('tasks.title')} actions={actions} />
      {/* Waits for filters saved as a context (a reload, a link in a new tab). */}
      {urlFilterState.ready && (
        <ServerDataGrid<TaskRow>
          columns={columns}
          endpoint="/tasks"
          showRowCount
          queryKey="tasks"
          getRowId={(r) => r.id}
          enableSearch
          defaultSort={{ field: 'priority_score', direction: 'DESC' }}
          enableRowSelection={canAdmin}
          onSelectionChanged={(rows) => setSelectedRows(rows)}
          onGridApiReady={(api) => { gridApiRef.current = api; }}
          initialState={{
            filter: {
              filterModel: initialFilterModel
            }
          }}
          columnPreferencesKey="tasks"
          refreshKey={refreshKey}
          onQueryStateChange={(state) => {
            lastQueryRef.current = { sort: state.sort, q: state.q || '', filters: state.filterModel || {} };
          }}
          extraParams={extraParams}
          toolbarExtras={taskScopeToolbar}
        />
      )}
      <CsvExportDialogV2
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        endpoint="/tasks"
        title={t('tasks.csv.exportTitle')}
        presets={[{ name: 'enrichment', label: t('tasks.csv.presetEnrichment') }]}
      />
      <CsvImportDialogV2
        open={importOpen}
        onClose={() => setImportOpen(false)}
        endpoint="/tasks"
        title={t('tasks.csv.importTitle')}
        onImported={() => setRefreshKey((k) => k + 1)}
      />
    </>
  );
}
