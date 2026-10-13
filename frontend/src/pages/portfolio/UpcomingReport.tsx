import React, { useCallback, useId, useMemo, useState } from 'react';
import { Alert, Box, Collapse, Stack, Tab, Tabs, Typography, useTheme } from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef, ICellRendererParams } from 'ag-grid-community';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../../api';
import ReportLayout, { reportGridHeight, useFillViewportHeight } from '../../components/reports/ReportLayout';
import {
  idsFromParams,
  idsParam,
  ProjectFilter,
  TeamFilter,
  useReportFilterValues,
} from '../../components/reports/ProjectTeamFilters';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate } from '../../lib/dateFormat';
import { textTabSx, textTabsSx } from '../../theme/formSx';
import {
  getPriorityLabel,
  getProjectStatusLabel,
  getRequestStatusLabel,
  getTaskStatusLabel,
} from '../../utils/portfolioI18n';
import { PROJECT_STATUS_COLORS, REQUEST_STATUS_COLORS, TASK_STATUS_COLORS, getDotColor } from '../../utils/statusColors';
import {
  createdBetween,
  dateInRange,
  projectsPath,
  requestsPath,
  tasksPath,
} from './components/portfolioListLinks';

type ProjectLink = { ref: string; name: string; itemPath: string };

type RowCommon = { ref: string; itemPath: string; name: string; status: string };

export type UpcomingTaskRow = RowCommon & {
  taskTypeName: string | null;
  priorityLevel: string | null;
  assigneeName: string | null;
  dueDate: string;
  project: ProjectLink | null;
};

export type UpcomingProjectRow = RowCommon & {
  priority: number | null;
  plannedStart: string | null;
  plannedEnd: string | null;
  progress: number | null;
  itLeadName: string | null;
  businessLeadName: string | null;
};

export type UpcomingRequestRow = RowCommon & {
  sourceName: string | null;
  createdOn: string | null;
  targetDeliveryDate: string | null;
  requestorName: string | null;
};

type HorizonBlock<TRow> = { horizonDays: number; until: string; rows: TRow[] };

export type UpcomingReportData = {
  asOf: string;
  tasks: HorizonBlock<UpcomingTaskRow> & { overdueCount: number };
  projectEnds: HorizonBlock<UpcomingProjectRow> & { passedCount: number };
  projectStarts: HorizonBlock<UpcomingProjectRow>;
  pendingRequests: { thresholdDays: number; createdBefore: string; rows: UpcomingRequestRow[] };
  requestDeliveries: HorizonBlock<UpcomingRequestRow>;
};

type HorizonKey = 'taskDays' | 'projectDays' | 'requestDays';
type SectionKey = 'tasks' | 'projectEnds' | 'projectStarts' | 'pendingRequests' | 'requestDeliveries';

/** Horizons each selector offers, and the one it starts on. */
export const UPCOMING_HORIZONS: Record<HorizonKey, { options: number[]; fallback: number }> = {
  taskDays: { options: [7, 14, 30], fallback: 14 },
  projectDays: { options: [30, 60, 90], fallback: 30 },
  requestDays: { options: [14, 30, 60], fallback: 30 },
};

export const horizonStorageKey = (key: HorizonKey) => `kanap.portfolioReports.upcoming.${key}`;
export const collapsedStorageKey = (section: SectionKey) =>
  `kanap.portfolioReports.upcoming.collapsed.${section}`;

const readHorizon = (key: HorizonKey): number => {
  const { options, fallback } = UPCOMING_HORIZONS[key];
  try {
    const stored = Number(window.localStorage.getItem(horizonStorageKey(key)));
    if (options.includes(stored)) return stored;
  } catch {
    // A browser that refuses storage still gets the default horizon.
  }
  return fallback;
};

const storeHorizon = (key: HorizonKey, days: number) => {
  try {
    window.localStorage.setItem(horizonStorageKey(key), String(days));
  } catch {
    // Remembering the horizon is a convenience, never a requirement.
  }
};

const readCollapsed = (section: SectionKey): boolean => {
  try {
    return window.localStorage.getItem(collapsedStorageKey(section)) === '1';
  } catch {
    return false;
  }
};

const storeCollapsed = (section: SectionKey, collapsed: boolean) => {
  try {
    window.localStorage.setItem(collapsedStorageKey(section), collapsed ? '1' : '0');
  } catch {
    // Folded sections are a reading convenience; losing them is harmless.
  }
};

const viewerTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** Charter card: 8px radius, hairline border, no shadow. */
const SECTION_SX = {
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  bgcolor: 'kanap.bg.primary',
  p: 2,
} as const;

const linkSx = {
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
} as const;

/** AG Grid keeps a floor for its "no rows" overlay; a section never shows an empty grid. */
const GRID_SX = {
  width: '100%',
  '& .ag-center-cols-viewport': { minHeight: 'unset' },
} as const;

const MONO_CELL_STYLE = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: '12px',
  color: 'var(--kanap-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
} as const;

const PRINT_OPEN_SX = {
  '@media print': {
    height: 'auto !important',
    overflow: 'visible !important',
    visibility: 'visible !important',
  },
} as const;

/** A figure that opens the list it counts; a zero opens nothing, there would be nothing to read. */
function Figure({
  count,
  label,
  to,
  tone = 'neutral',
}: {
  count: number;
  label: string;
  to: string;
  tone?: 'neutral' | 'attention';
}) {
  if (count === 0) {
    return <Typography component="span" sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{label}</Typography>;
  }
  return (
    <Typography
      component={RouterLink}
      to={to}
      sx={{ ...linkSx, fontSize: 13, color: tone === 'attention' ? 'warning.main' : 'kanap.text.primary' }}
    >
      {label}
    </Typography>
  );
}

/** A dot between two phrases of the details line. */
const Dot = () => (
  <Typography component="span" aria-hidden sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>
    ·
  </Typography>
);

type SectionProps = {
  section: SectionKey;
  title: string;
  count: number;
  countTo: string;
  horizon: { value: number; options: number[]; onChange: (days: number) => void };
  /** The window in words, and the late line when the block has one. */
  details: React.ReactNode;
  empty: string;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
};

/**
 * One block: a title that folds it away, the figure that opens the matching list, the horizon
 * on the right, then the window in words and the grid. The figure stays next to the title while
 * the block is folded. Print keeps every block open.
 */
function UpcomingSection({
  section,
  title,
  count,
  countTo,
  horizon,
  details,
  empty,
  collapsed,
  onToggle,
  children,
}: SectionProps) {
  const { t } = useTranslation('portfolio');
  const contentId = useId();

  return (
    <Box component="section" sx={SECTION_SX} data-testid={`upcoming-${section}`}>
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography component="h2" sx={{ fontSize: 16, fontWeight: 500, color: 'kanap.text.primary' }}>
          <Box
            component="button"
            type="button"
            aria-expanded={!collapsed}
            aria-controls={contentId}
            onClick={onToggle}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              p: 0,
              border: 0,
              bgcolor: 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: 'pointer',
            }}
          >
            <ExpandMoreIcon
              sx={{
                fontSize: 18,
                color: 'kanap.text.secondary',
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 160ms ease',
              }}
            />
            {title}
          </Box>
        </Typography>
        <Box data-testid={`upcoming-${section}-count`} sx={{ fontVariantNumeric: 'tabular-nums' }}>
          <Figure count={count} label={String(count)} to={countTo} />
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tabs
          value={horizon.value}
          onChange={(_, next) => {
            if (typeof next === 'number') horizon.onChange(next);
          }}
          aria-label={t('reports.upcoming.horizonLabel', { title })}
          sx={textTabsSx}
        >
          {horizon.options.map((option) => (
            <Tab
              key={option}
              value={option}
              label={t('reports.upcoming.days', { count: option })}
              sx={textTabSx(horizon.value === option)}
            />
          ))}
        </Tabs>
      </Stack>
      <Collapse in={!collapsed} timeout={160} id={contentId} sx={PRINT_OPEN_SX}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            columnGap: 1,
            mt: 0.5,
            mb: count > 0 ? 1.25 : 0,
            fontSize: 13,
            color: 'kanap.text.secondary',
          }}
        >
          {details}
          {count === 0 ? (
            <>
              <Dot />
              <span>{empty}</span>
            </>
          ) : null}
        </Box>
        {/* An empty block is its one line of text: no grid. */}
        {count > 0 ? children : null}
      </Collapse>
    </Box>
  );
}

/**
 * What comes next and what is waiting: planned project ends and starts, requests awaiting review
 * for too long, requested deliveries, then tasks falling due. Every figure opens the list
 * that shows exactly the rows it counts, with the same project and team filters.
 */
export default function UpcomingReport() {
  const { t } = useTranslation('portfolio');
  const locale = useLocale();
  const navigate = useNavigate();
  const mode = useTheme().palette.mode;
  const [horizons, setHorizons] = useState<Record<HorizonKey, number>>(() => ({
    taskDays: readHorizon('taskDays'),
    projectDays: readHorizon('projectDays'),
    requestDays: readHorizon('requestDays'),
  }));
  const [collapsed, setCollapsed] = useState<Record<SectionKey, boolean>>(() => ({
    tasks: readCollapsed('tasks'),
    projectEnds: readCollapsed('projectEnds'),
    projectStarts: readCollapsed('projectStarts'),
    pendingRequests: readCollapsed('pendingRequests'),
    requestDeliveries: readCollapsed('requestDeliveries'),
  }));
  // Projects and teams can come from a link; unlike the horizons they are never remembered.
  const [searchParams] = useSearchParams();
  const [projectIds, setProjectIds] = useState<string[]>(() => idsFromParams(searchParams, 'projectIds'));
  const [teamIds, setTeamIds] = useState<string[]>(() => idsFromParams(searchParams, 'teamIds'));
  const { data: projectTeamValues } = useReportFilterValues();
  const projectParam = idsParam(projectIds);
  const teamParam = idsParam(teamIds);
  const { ref: fillRef, height: fillHeight } = useFillViewportHeight();

  const { data, isError } = useQuery({
    queryKey: ['portfolio-upcoming-report', horizons.taskDays, horizons.projectDays, horizons.requestDays, projectParam ?? '', teamParam ?? ''],
    queryFn: async () =>
      (
        await api.get<UpcomingReportData>('/portfolio/reports/upcoming', {
          params: {
            taskDays: horizons.taskDays,
            projectDays: horizons.projectDays,
            requestDays: horizons.requestDays,
            tz: viewerTimeZone(),
            ...(projectParam ? { projectIds: projectParam } : {}),
            ...(teamParam ? { teamIds: teamParam } : {}),
          },
        })
      ).data,
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000,
  });

  const changeHorizon = useCallback((key: HorizonKey, days: number) => {
    setHorizons((previous) => ({ ...previous, [key]: days }));
    storeHorizon(key, days);
  }, []);

  const toggle = useCallback((section: SectionKey) => {
    setCollapsed((previous) => {
      const next = !previous[section];
      storeCollapsed(section, next);
      return { ...previous, [section]: next };
    });
  }, []);

  const horizonProps = (key: HorizonKey) => ({
    value: horizons[key],
    options: UPCOMING_HORIZONS[key].options,
    onChange: (days: number) => changeHorizon(key, days),
  });

  const links = useMemo(() => {
    if (!data) return null;
    // Every link carries the project and team filters, which each list applies with the
    // report's own rules, and inclusive date bounds: the figure and its list count the same rows.
    const scope = { projectIds, teamIds };
    const flowParams = new URLSearchParams();
    if (projectParam) flowParams.set('projectIds', projectParam);
    if (teamParam) flowParams.set('teamIds', teamParam);
    const flowQuery = flowParams.toString();
    return {
      tasks: tasksPath({ due_date: dateInRange(data.asOf, data.tasks.until) }, scope),
      overdue: tasksPath({ due_date: { filterType: 'date', type: 'lessThan', dateFrom: data.asOf } }, scope),
      projectEnds: projectsPath({ planned_end: dateInRange(data.asOf, data.projectEnds.until) }, scope),
      // The passed ends stay in the flow report, where the open projects are read by status.
      passedEnds: `/portfolio/reports/flow${flowQuery ? `?${flowQuery}` : ''}`,
      projectStarts: projectsPath(
        {
          status: { filterType: 'set', values: ['waiting_list', 'planned'] },
          planned_start: dateInRange(data.asOf, data.projectStarts.until),
        },
        scope,
      ),
      pendingRequests: requestsPath(
        {
          status: { filterType: 'set', values: ['pending_review'] },
          created_at: createdBetween(null, data.pendingRequests.createdBefore),
        },
        scope,
      ),
      requestDeliveries: requestsPath(
        { target_delivery_date: dateInRange(data.asOf, data.requestDeliveries.until) },
        scope,
      ),
    };
  }, [data, projectIds, projectParam, teamIds, teamParam]);

  /* -------------------------------------------------------------- */
  /*  Cells and columns                                             */
  /* -------------------------------------------------------------- */

  const NameCell = useCallback(
    (params: ICellRendererParams<RowCommon, string>) => (
      <Box component="span" sx={{ cursor: 'pointer' }} onClick={() => params.data?.itemPath && navigate(params.data.itemPath)}>
        {params.value ?? ''}
      </Box>
    ),
    [navigate],
  );

  const ProjectCell = useCallback(
    (params: ICellRendererParams<UpcomingTaskRow>) => {
      const project = params.data?.project;
      if (!project) return null;
      return (
        <Box
          component="span"
          sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          onClick={() => navigate(project.itemPath)}
        >
          <Box component="span" sx={MONO_CELL_STYLE}>
            {project.ref}
          </Box>
          <Box component="span">{project.name}</Box>
        </Box>
      );
    },
    [navigate],
  );

  const statusCell = useCallback(
    (colors: Record<string, string>, label: (status: string) => string) =>
      (params: ICellRendererParams<RowCommon, string>) => {
        const status = String(params.value || '');
        if (!status) return null;
        const color = getDotColor(colors[status], mode);
        return (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, bgcolor: color }} />
            <Box component="span" sx={{ color, fontWeight: 500 }}>
              {label(status)}
            </Box>
          </Box>
        );
      },
    [mode],
  );

  const columns = useMemo(() => {
    const ref = <TRow,>(): ColDef<TRow> => ({
      field: 'ref' as any,
      headerName: t('reports.upcoming.columns.reference'),
      width: 100,
      cellStyle: MONO_CELL_STYLE as any,
    });
    const name = <TRow,>(headerName: string): ColDef<TRow> => ({
      field: 'name' as any,
      headerName,
      flex: 1.4,
      minWidth: 220,
      cellRenderer: NameCell,
    });
    const date = <TRow,>(field: string, headerName: string): ColDef<TRow> => ({
      field: field as any,
      headerName,
      width: 160,
      sort: 'asc',
      valueFormatter: (params) => formatShortDate(params.value || null, locale),
    });
    const person = <TRow,>(field: string, headerName: string): ColDef<TRow> => ({
      field: field as any,
      headerName,
      flex: 0.8,
      minWidth: 150,
      valueFormatter: (params) => String(params.value || ''),
    });
    const projectStatus = statusCell(PROJECT_STATUS_COLORS, (status) => getProjectStatusLabel(t, status));
    const requestStatus = statusCell(REQUEST_STATUS_COLORS, (status) => getRequestStatusLabel(t, status));
    const taskStatus = statusCell(TASK_STATUS_COLORS, (status) => getTaskStatusLabel(t, status));

    const tasks: ColDef<UpcomingTaskRow>[] = [
      ref<UpcomingTaskRow>(),
      name<UpcomingTaskRow>(t('reports.upcoming.columns.task')),
      { field: 'taskTypeName', headerName: t('reports.upcoming.columns.type'), width: 140, valueFormatter: (p) => String(p.value || '') },
      {
        field: 'priorityLevel',
        headerName: t('reports.upcoming.columns.priority'),
        width: 110,
        valueFormatter: (p) => (p.value ? getPriorityLabel(t, String(p.value)) : ''),
      },
      { field: 'status', headerName: t('reports.upcoming.columns.status'), width: 170, cellRenderer: taskStatus },
      person<UpcomingTaskRow>('assigneeName', t('reports.upcoming.columns.assignee')),
      date<UpcomingTaskRow>('dueDate', t('reports.upcoming.columns.dueDate')),
      {
        colId: 'project',
        headerName: t('reports.upcoming.columns.project'),
        flex: 1,
        minWidth: 200,
        valueGetter: (p) => (p.data?.project ? `${p.data.project.ref} ${p.data.project.name}` : ''),
        cellRenderer: ProjectCell,
      },
    ];

    const projects = (dateField: 'plannedEnd' | 'plannedStart'): ColDef<UpcomingProjectRow>[] => [
      ref<UpcomingProjectRow>(),
      name<UpcomingProjectRow>(t('reports.upcoming.columns.project')),
      { field: 'status', headerName: t('reports.upcoming.columns.status'), width: 170, cellRenderer: projectStatus },
      {
        field: 'priority',
        headerName: t('reports.upcoming.columns.priority'),
        width: 100,
        type: 'rightAligned',
        valueFormatter: (p) => (p.value == null ? '' : String(Math.round(Number(p.value)))),
      },
      date<UpcomingProjectRow>(
        dateField,
        t(dateField === 'plannedEnd' ? 'reports.upcoming.columns.plannedEnd' : 'reports.upcoming.columns.plannedStart'),
      ),
      {
        field: 'progress',
        headerName: t('reports.upcoming.columns.progress'),
        width: 110,
        type: 'rightAligned',
        valueFormatter: (p) => (p.value == null ? '' : `${Math.round(Number(p.value))}%`),
      },
      person<UpcomingProjectRow>('itLeadName', t('reports.upcoming.columns.itLead')),
      person<UpcomingProjectRow>('businessLeadName', t('reports.upcoming.columns.businessLead')),
    ];

    const requests = (dateField: 'createdOn' | 'targetDeliveryDate'): ColDef<UpcomingRequestRow>[] => [
      ref<UpcomingRequestRow>(),
      name<UpcomingRequestRow>(t('reports.upcoming.columns.request')),
      { field: 'status', headerName: t('reports.upcoming.columns.status'), width: 170, cellRenderer: requestStatus },
      { field: 'sourceName', headerName: t('reports.upcoming.columns.source'), width: 150, valueFormatter: (p) => String(p.value || '') },
      date<UpcomingRequestRow>(
        dateField,
        t(dateField === 'createdOn' ? 'reports.upcoming.columns.createdOn' : 'reports.upcoming.columns.targetDelivery'),
      ),
      person<UpcomingRequestRow>('requestorName', t('reports.upcoming.columns.requestor')),
    ];

    return {
      tasks,
      projectEnds: projects('plannedEnd'),
      projectStarts: projects('plannedStart'),
      pendingRequests: requests('createdOn'),
      requestDeliveries: requests('targetDeliveryDate'),
    };
  }, [NameCell, ProjectCell, locale, statusCell, t]);

  const grid = <TRow extends { ref: string }>(rows: TRow[], columnDefs: ColDef<TRow>[]) => (
    // As tall as the rows need, never taller than the screen below the filter bar.
    <ReportGrid<TRow>
      wrapperSx={{ ...GRID_SX, height: reportGridHeight(fillHeight, rows.length, 0) }}
      rowData={rows}
      columnDefs={columnDefs}
      defaultColDef={{ sortable: true, resizable: true, suppressMenu: true }}
      suppressCellFocus
      getRowId={(params) => params.data.ref}
    />
  );

  const within = (days: number) => t('reports.upcoming.within', { count: days });

  return (
    <ReportLayout
      title={t('reports.upcoming.title')}
      subtitle={t('reports.upcoming.subtitle')}
      filters={(
        <>
          <ProjectFilter options={projectTeamValues?.projects ?? []} value={projectIds} onChange={setProjectIds} />
          <TeamFilter options={projectTeamValues?.teams ?? []} value={teamIds} onChange={setTeamIds} />
        </>
      )}
    >
      {isError && <Alert severity="error">{t('reports.upcoming.loadFailed')}</Alert>}

      <Stack spacing={1.5} ref={fillRef}>
        {data && links && (
          <>
            <UpcomingSection
              section="projectEnds"
              title={t('reports.upcoming.sections.projectEnds')}
              count={data.projectEnds.rows.length}
              countTo={links.projectEnds}
              horizon={horizonProps('projectDays')}
              details={(
                <>
                  <span>{within(data.projectEnds.horizonDays)}</span>
                  <Dot />
                  <Figure
                    count={data.projectEnds.passedCount}
                    label={t('reports.upcoming.passed', { count: data.projectEnds.passedCount })}
                    to={links.passedEnds}
                    tone="attention"
                  />
                </>
              )}
              empty={t('reports.upcoming.empty.projectEnds')}
              collapsed={collapsed.projectEnds}
              onToggle={() => toggle('projectEnds')}
            >
              {grid(data.projectEnds.rows, columns.projectEnds)}
            </UpcomingSection>

            <UpcomingSection
              section="projectStarts"
              title={t('reports.upcoming.sections.projectStarts')}
              count={data.projectStarts.rows.length}
              countTo={links.projectStarts}
              horizon={horizonProps('projectDays')}
              details={<span>{within(data.projectStarts.horizonDays)}</span>}
              empty={t('reports.upcoming.empty.projectStarts')}
              collapsed={collapsed.projectStarts}
              onToggle={() => toggle('projectStarts')}
            >
              {grid(data.projectStarts.rows, columns.projectStarts)}
            </UpcomingSection>

            <UpcomingSection
              section="pendingRequests"
              title={t('reports.upcoming.sections.pendingRequests')}
              count={data.pendingRequests.rows.length}
              countTo={links.pendingRequests}
              horizon={horizonProps('requestDays')}
              details={<span>{t('reports.upcoming.olderThan', { count: data.pendingRequests.thresholdDays })}</span>}
              empty={t('reports.upcoming.empty.pendingRequests')}
              collapsed={collapsed.pendingRequests}
              onToggle={() => toggle('pendingRequests')}
            >
              {grid(data.pendingRequests.rows, columns.pendingRequests)}
            </UpcomingSection>

            <UpcomingSection
              section="requestDeliveries"
              title={t('reports.upcoming.sections.requestDeliveries')}
              count={data.requestDeliveries.rows.length}
              countTo={links.requestDeliveries}
              horizon={horizonProps('projectDays')}
              details={<span>{within(data.requestDeliveries.horizonDays)}</span>}
              empty={t('reports.upcoming.empty.requestDeliveries')}
              collapsed={collapsed.requestDeliveries}
              onToggle={() => toggle('requestDeliveries')}
            >
              {grid(data.requestDeliveries.rows, columns.requestDeliveries)}
            </UpcomingSection>

            <UpcomingSection
              section="tasks"
              title={t('reports.upcoming.sections.tasks')}
              count={data.tasks.rows.length}
              countTo={links.tasks}
              horizon={horizonProps('taskDays')}
              details={(
                <>
                  <span>{within(data.tasks.horizonDays)}</span>
                  <Dot />
                  <Figure
                    count={data.tasks.overdueCount}
                    label={t('reports.upcoming.overdue', { count: data.tasks.overdueCount })}
                    to={links.overdue}
                    tone="attention"
                  />
                </>
              )}
              empty={t('reports.upcoming.empty.tasks')}
              collapsed={collapsed.tasks}
              onToggle={() => toggle('tasks')}
            >
              {grid(data.tasks.rows, columns.tasks)}
            </UpcomingSection>
          </>
        )}
      </Stack>
    </ReportLayout>
  );
}
