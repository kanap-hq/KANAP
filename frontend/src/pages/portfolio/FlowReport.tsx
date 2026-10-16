import React, { useCallback, useMemo, useState } from 'react';
import { Alert, Box, Checkbox, ListItemText, MenuItem, Stack, TextField, Typography, useTheme } from '@mui/material';
import PrintableChart from '../../components/reports/PrintableChart';
import { PRINT_CONTENT_WIDTH, useReportPrinting, useReportTheme } from '../../components/reports/reportPrint';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef, ColGroupDef, ICellRendererParams } from 'ag-grid-community';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import ReportLayout, {
  ReportFilter,
  reportFilterMenuProps,
  reportFilterSelectSx,
  reportGridHeight,
  useFillViewportHeight,
} from '../../components/reports/ReportLayout';
import { drawerMenuItemSx } from '../../theme/formSx';
import { formatShortDate } from '../../lib/dateFormat';
import { useLocale } from '../../i18n/useLocale';
import { useTaskTypeLabel } from '../../hooks/useLocalizedTaskTypes';
import {
  idsFromParams,
  idsParam,
  ProjectFilter,
  TeamFilter,
  useReportFilterValues,
} from '../../components/reports/ProjectTeamFilters';
import {
  BLANK,
  createdBetween,
  FilterModel,
  ProjectTeamScope,
  projectsPath,
  requestsPath,
  tasksPath,
} from './components/portfolioListLinks';

/* ------------------------------------------------------------------ */
/*  Contract                                                          */
/* ------------------------------------------------------------------ */

type FlowPeriod = { periodStart: string; periodEnd: string; created: number; closed: number; openAtEnd: number };
type FlowSeries = { granularity: 'week' | 'month'; periods: FlowPeriod[]; openNow: number };
type AgeBucket = 'upTo7' | 'from8To30' | 'from31To90' | 'over90';
type AgeRow = {
  taskTypeId: string | null;
  taskTypeName: string | null;
  taskTypeCode?: string | null;
  buckets: Record<AgeBucket, number>;
  total: number;
};
type MonthBucket = 'underOneMonth' | 'oneToThreeMonths' | 'threeToSixMonths' | 'overSixMonths';
/** Open items of one status, spread over how long ago they were created. */
type CreatedAgeRow = { status: string; buckets: Record<MonthBucket, number>; total: number };
type CreatedAgeTable = { rows: CreatedAgeRow[]; total: CreatedAgeRow };
/** One open item that has not left its status for longer than the entity's threshold. */
type StuckItem = {
  id: string;
  ref: string;
  itemPath: string;
  name: string;
  status: string;
  statusSince: string;
  plannedEnd?: string | null;
  plannedEndPassed?: boolean;
};
type ByStatusRow = { status: string; open: number; stuck: number; plannedEndPassed?: number };
type ByStatusTable = {
  thresholdDays: number;
  rows: ByStatusRow[];
  total: ByStatusRow;
  items: StuckItem[];
};
type LeadTime = { closedCount: number; measuredCount: number; medianDays: number | null };
type LeadTimeByType = { taskTypeId: string | null; taskTypeName: string | null; taskTypeCode?: string | null } & LeadTime;
type ProjectDoneLeadTime = LeadTime & { withPlannedEnd: number; medianOverrunDays: number | null };

type FlowReportResponse = {
  weeks: number;
  months: number;
  startDate: string;
  monthsStartDate: string;
  endDate: string;
  timeZone: string;
  sourceIds: string[];
  categoryIds: string[];
  asOf: string;
  flow: { tasks: FlowSeries; requests: FlowSeries; projects: FlowSeries };
  age: {
    tasks: { rows: AgeRow[]; total: AgeRow };
    requests: CreatedAgeTable;
    projects: CreatedAgeTable;
  };
  byStatus: { tasks: ByStatusTable; requests: ByStatusTable; projects: ByStatusTable };
  leadTime: {
    tasks: LeadTime;
    tasksByType: LeadTimeByType[];
    requests: LeadTime & { converted: LeadTime; rejected: LeadTime };
    projects: LeadTime & { done: ProjectDoneLeadTime };
  };
};

/** The classification values the weekly report already publishes, reused as is. */
type FilterOption = { id: string; name: string };
type FilterValuesResponse = { sources: FilterOption[]; categories: FilterOption[] };

type EntityKey = 'tasks' | 'requests' | 'projects';
/** The two entities read month by month and broken down by the status they sit in. */
type MonthlyKey = 'requests' | 'projects';

const ENTITY_KEYS: EntityKey[] = ['tasks', 'requests', 'projects'];
const MONTH_BUCKETS: MonthBucket[] = ['underOneMonth', 'oneToThreeMonths', 'threeToSixMonths', 'overSixMonths'];

export const FLOW_PERIODS = [8, 13, 26];
export const FLOW_MONTH_PERIODS = [6, 12, 24];
export const FLOW_WEEKS_STORAGE_KEY = 'kanap.portfolioReports.flowWeeks';
export const FLOW_MONTHS_STORAGE_KEY = 'kanap.portfolioReports.flowMonths';

/* ------------------------------------------------------------------ */
/*  Charter surfaces                                                  */
/* ------------------------------------------------------------------ */

const SECTION_SX = {
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  bgcolor: 'kanap.bg.primary',
  p: 2,
} as const;

const SECTION_TITLE_SX = { fontSize: 16, fontWeight: 500, color: 'kanap.text.primary', mb: 1.5 } as const;

const SUB_TITLE_SX = { fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 0.75 } as const;

const TILE_SX = {
  flex: 1,
  minWidth: 180,
  bgcolor: 'kanap.bg.drawer',
  border: '1px solid',
  borderColor: 'kanap.border.soft',
  borderRadius: '8px',
  px: 2,
  py: 1.25,
} as const;

/**
 * Three grids share a row from `md`, so a column is narrow: the header sentence wraps over
 * as many lines as it needs instead of ending in an ellipsis nobody can read.
 */
const DENSE_COL_DEF = {
  sortable: false,
  resizable: true,
  suppressMenu: true,
  wrapHeaderText: true,
  autoHeaderHeight: true,
} as const;

const LINK_SX = {
  color: 'inherit',
  textDecoration: 'none',
  '&:hover': { textDecoration: 'underline' },
} as const;

/** A text button: the charter's only teal affordance outside fields and primary buttons. */
const TEXT_BUTTON_SX = {
  fontSize: 12,
  fontWeight: 400,
  color: 'kanap.teal',
  border: 0,
  p: 0,
  bgcolor: 'transparent',
  cursor: 'pointer',
  fontFamily: 'inherit',
  '&:hover': { textDecoration: 'underline' },
} as const;

/**
 * Series colours, slots 1 and 2 of the data-viz palette, stepped per mode. They clear the
 * lightness band, the chroma floor, the colour-vision separation and the 3:1 contrast against
 * the chart surface in both modes; the charter's blue/green pair does not in dark mode.
 */
/** Two chart tiles per printed row: half the page minus the grid gap and the tile padding. */
const FLOW_TILE_PRINT_WIDTH = Math.floor((PRINT_CONTENT_WIDTH - 12) / 2) - 24;

const SERIES_COLORS = {
  light: { created: '#2a78d6', closed: '#eb6834' },
  dark: { created: '#3987e5', closed: '#d95926' },
} as const;

const readStored = (key: string, allowed: number[], fallback: number): number => {
  try {
    const stored = Number(window.localStorage.getItem(key));
    if (allowed.includes(stored)) return stored;
  } catch {
    // A browser that refuses storage still gets the default period.
  }
  return fallback;
};

const store = (key: string, value: number) => {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // Remembering the period is a convenience, never a requirement.
  }
};

const viewerTimeZone = (): string => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
};

/** `day` shifted by a whole number of calendar days, both sides `YYYY-MM-DD`. */
const shiftDay = (day: string, offset: number): string => {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
};

/**
 * The weekly report, narrowed to one period of the window and to the report's own
 * classification: the weekly page reads both from the URL, so the two totals agree.
 */
const weeklyPath = (from: string, to: string, filterQuery = '') =>
  `/portfolio/reports/weekly?startDate=${from}&endDate=${to}${filterQuery}`;

/** The list of one entity, on the report's open scope, narrowed by whatever the figure counted. */
const entityListPath = (key: EntityKey, extra: FilterModel = {}, scope: ProjectTeamScope = {}): string =>
  key === 'tasks'
    ? tasksPath(extra, scope)
    : key === 'requests'
      ? requestsPath(extra, scope)
      : projectsPath(extra, scope);

/* ------------------------------------------------------------------ */
/*  Stat tile                                                         */
/* ------------------------------------------------------------------ */

/**
 * The open stock of the last periods, as a bare 12-point line. It carries the shape of the
 * trend, never a value: the figures live in the tile, the chart and the table below.
 */
function Sparkline({ points, label }: { points: number[]; label: string }) {
  const theme = useTheme();
  const width = 96;
  const height = 22;
  if (points.length < 2) return <Box sx={{ height, width }} />;

  const max = Math.max(...points);
  const min = Math.min(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((value, index) => ({
    x: index * step,
    y: height - 3 - ((value - min) / span) * (height - 6),
  }));
  const path = coords.map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' ');
  const last = coords[coords.length - 1];
  const dark = theme.palette.mode === 'dark';

  return (
    <Box
      component="svg"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      sx={{ width, height, display: 'block', overflow: 'visible' }}
    >
      <path d={path} fill="none" stroke={theme.palette.kanap.border.default} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last.x} cy={last.y} r={4} fill={dark ? SERIES_COLORS.dark.created : SERIES_COLORS.light.created} stroke={theme.palette.kanap.bg.drawer} strokeWidth={2} />
    </Box>
  );
}

function StatTile({
  label,
  value,
  to,
  caption,
  delta,
  trend,
  trendLabel,
}: {
  label: string;
  value: string;
  to: string | null;
  caption: string;
  delta: string;
  trend: number[];
  trendLabel: string;
}) {
  return (
    <Box sx={TILE_SX}>
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{label}</Typography>
      <Stack direction="row" alignItems="flex-end" justifyContent="space-between" spacing={1.5}>
        <Box sx={{ minWidth: 0 }}>
          <Stack direction="row" alignItems="baseline" spacing={0.75}>
            {to ? (
              <Typography component={RouterLink} to={to} sx={{ ...LINK_SX, fontSize: 22, fontWeight: 500, color: 'kanap.text.primary' }}>
                {value}
              </Typography>
            ) : (
              <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'kanap.text.primary' }}>{value}</Typography>
            )}
            <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>{caption}</Typography>
          </Stack>
          <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.tertiary' }}>{delta}</Typography>
        </Box>
        <Sparkline points={trend} label={trendLabel} />
      </Stack>
    </Box>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */

/** Which stuck cell of a by-status grid opened the list below it. */
type StuckPanel = { entity: EntityKey; status: string | null };

export default function FlowReport() {
  const { t } = useTranslation('portfolio');
  const locale = useLocale();
  const typeLabel = useTaskTypeLabel();
  const theme = useReportTheme();
  const printing = useReportPrinting();
  const navigate = useNavigate();
  const dark = theme.palette.mode === 'dark';

  const [weeks, setWeeks] = useState<number>(() => readStored(FLOW_WEEKS_STORAGE_KEY, FLOW_PERIODS, 13));
  const [months, setMonths] = useState<number>(() => readStored(FLOW_MONTHS_STORAGE_KEY, FLOW_MONTH_PERIODS, 12));
  const [tableOpen, setTableOpen] = useState(false);
  const [panel, setPanel] = useState<StuckPanel | null>(null);
  // The classification is a reading of the moment, not a habit: unlike the two horizons it is
  // never remembered from one visit to the next.
  const [sourceAll, setSourceAll] = useState(true);
  const [sourceIds, setSourceIds] = useState<string[]>([]);
  const [categoryAll, setCategoryAll] = useState(true);
  const [categoryIds, setCategoryIds] = useState<string[]>([]);
  // Projects and teams can come from a link (`projectIds`, `teamIds`); like the classification
  // they are never remembered. Empty means every value.
  const [searchParams] = useSearchParams();
  const [projectIds, setProjectIds] = useState<string[]>(() => idsFromParams(searchParams, 'projectIds'));
  const [teamIds, setTeamIds] = useState<string[]>(() => idsFromParams(searchParams, 'teamIds'));
  const { data: projectTeamValues } = useReportFilterValues();

  const { data: filterValuesData } = useQuery<FilterValuesResponse>({
    queryKey: ['portfolio-weekly-report-filter-values'],
    queryFn: async () => (await api.get<FilterValuesResponse>('/portfolio/reports/weekly/filter-values')).data,
  });

  const sourceOptions = filterValuesData?.sources ?? [];
  const categoryOptions = filterValuesData?.categories ?? [];
  const sourceParam = idsParam(sourceIds, sourceAll);
  const categoryParam = idsParam(categoryIds, categoryAll);
  const projectParam = idsParam(projectIds);
  const teamParam = idsParam(teamIds);

  const { data, isError } = useQuery<FlowReportResponse>({
    queryKey: [
      'portfolio-flow-report',
      weeks,
      months,
      sourceParam ?? '',
      categoryParam ?? '',
      projectParam ?? '',
      teamParam ?? '',
    ],
    queryFn: async () =>
      (
        await api.get<FlowReportResponse>('/portfolio/reports/flow', {
          params: {
            weeks,
            months,
            tz: viewerTimeZone(),
            ...(sourceParam ? { sourceIds: sourceParam } : {}),
            ...(categoryParam ? { categoryIds: categoryParam } : {}),
            ...(projectParam ? { projectIds: projectParam } : {}),
            ...(teamParam ? { teamIds: teamParam } : {}),
          },
        })
      ).data,
    placeholderData: keepPreviousData,
    staleTime: 2 * 60 * 1000,
  });

  /**
   * The same narrowing, in the two shapes the destinations read it in: the lists filter on the
   * value names, the weekly report on the identifiers. A figure and the page it opens therefore
   * always count the same population.
   */
  const listFilter = useMemo<FilterModel>(() => {
    const names = (options: FilterOption[], ids: string[]) =>
      options.filter((option) => ids.includes(option.id)).map((option) => option.name);
    const model: FilterModel = {};
    const sources = sourceParam ? names(sourceOptions, sourceIds) : [];
    const categories = categoryParam ? names(categoryOptions, categoryIds) : [];
    if (sources.length > 0) model.source_name = { filterType: 'set', values: sources };
    if (categories.length > 0) model.category_name = { filterType: 'set', values: categories };
    return model;
  }, [categoryIds, categoryOptions, categoryParam, sourceIds, sourceOptions, sourceParam]);

  const weeklyQuery = useMemo(
    () =>
      [
        sourceParam ? `&sourceIds=${encodeURIComponent(sourceParam)}` : '',
        categoryParam ? `&categoryIds=${encodeURIComponent(categoryParam)}` : '',
        projectParam ? `&projectIds=${encodeURIComponent(projectParam)}` : '',
        teamParam ? `&teamIds=${encodeURIComponent(teamParam)}` : '',
      ].join(''),
    [categoryParam, projectParam, sourceParam, teamParam],
  );

  /** The weekly report for one period, carrying the filter the figure was read under. */
  const weeklyLink = useCallback(
    (from: string, to: string) => weeklyPath(from, to, weeklyQuery),
    [weeklyQuery],
  );

  /**
   * One entity's list, on the report's open scope, its own narrowing and the page filter. The
   * report reads a task's source and category the way the task list does — the task's own
   * value, falling back to its project's — so a figure and the list it opens always agree.
   */
  const listScope = useMemo<ProjectTeamScope>(() => ({ projectIds, teamIds }), [projectIds, teamIds]);
  const listLink = useCallback(
    (key: EntityKey, extra: FilterModel = {}): string =>
      entityListPath(key, { ...extra, ...listFilter }, listScope),
    [listFilter, listScope],
  );

  const changeWeeks = (next: number) => {
    setWeeks(next);
    store(FLOW_WEEKS_STORAGE_KEY, next);
  };

  const changeMonths = (next: number) => {
    setMonths(next);
    store(FLOW_MONTHS_STORAGE_KEY, next);
    setPanel(null);
  };

  /**
   * A multi-select that reads "all" rather than "none": an empty choice, or one that covers
   * every option, is the whole portfolio and sends no parameter at all.
   */
  const changeSelection = (
    value: unknown,
    options: FilterOption[],
    setAll: (all: boolean) => void,
    setIds: (ids: string[]) => void,
  ) => {
    const values = Array.isArray(value) ? (value as string[]) : [String(value)];
    setPanel(null);
    if (values.length === 0 || values.length === options.length) {
      setAll(true);
      setIds([]);
      return;
    }
    setAll(false);
    setIds(values);
  };

  const day = useCallback((value: string) => formatShortDate(value, locale), [locale]);

  /**
   * A month column label: the short month on its own, plus the year when the window changes
   * year, so a 24-month axis never shows two identical labels.
   */
  const monthLabel = useCallback(
    (periodStart: string, previousStart?: string) => {
      const date = new Date(`${periodStart}T00:00:00`);
      const short = new Intl.DateTimeFormat(locale, { month: 'short' }).format(date);
      const sameYear = previousStart != null && previousStart.slice(0, 4) === periodStart.slice(0, 4);
      return sameYear ? short : `${short} ${periodStart.slice(0, 4)}`;
    },
    [locale],
  );

  /** The label of a period, whichever grain it belongs to. */
  const periodLabel = useCallback(
    (series: FlowSeries, index: number) =>
      series.granularity === 'month'
        ? monthLabel(series.periods[index].periodStart, series.periods[index - 1]?.periodStart)
        : day(series.periods[index].periodStart),
    [day, monthLabel],
  );

  const statusLabel = useCallback(
    (entity: EntityKey, status: string) =>
      t(`statuses.${entity === 'tasks' ? 'task' : entity === 'requests' ? 'request' : 'project'}.${status}`, {
        defaultValue: status,
      }),
    [t],
  );

  const bucketLabel = useCallback((bucket: MonthBucket) => t(`reports.flow.columns.${bucket}`), [t]);

  /* ---------------------------------------------------------------- */
  /*  Charts                                                          */
  /* ---------------------------------------------------------------- */

  const colors = dark ? SERIES_COLORS.dark : SERIES_COLORS.light;

  const chartFor = useCallback(
    (key: EntityKey, series: FlowSeries) => {
      const rows = series.periods.map((period, index) => ({
        label: periodLabel(series, index),
        created: period.created,
        closed: period.closed,
        openAtEnd: period.openAtEnd,
        periodStart: period.periodStart,
        periodEnd: period.periodEnd,
      }));

      const openLabel =
        series.granularity === 'month'
          ? t('reports.flow.charts.openAtEndMonth')
          : t('reports.flow.charts.openAtEnd');

      const tooltip = {
        renderer: (params: any) => {
          const row = params.datum;
          return {
            title: t('reports.flow.charts.periodRange', { from: day(row.periodStart), to: day(row.periodEnd) }),
            content: [
              `${t('reports.flow.charts.created')}: ${row.created}`,
              `${t('reports.flow.charts.closed')}: ${row.closed}`,
              `${openLabel}: ${row.openAtEnd}`,
            ].join('<br/>'),
          };
        },
      };

      const bar = (yKey: 'created' | 'closed', name: string, fill: string) => ({
        type: 'bar' as const,
        xKey: 'label',
        yKey,
        yName: name,
        fill,
        stroke: fill,
        cornerRadius: 4,
        tooltip,
      });

      return {
        key,
        granularity: series.granularity,
        options: {
          theme: dark ? 'ag-default-dark' : 'ag-default',
          background: { fill: 'transparent' },
          data: rows,
          series: [
            bar('created', t('reports.flow.charts.created'), colors.created),
            bar('closed', t('reports.flow.charts.closed'), colors.closed),
          ],
          axes: [
            {
              type: 'category',
              position: 'bottom',
              // Leftover band width is the gutter: the marks stay thin and never touch.
              paddingInner: 0.35,
              groupPaddingInner: 0.15,
              label: { color: theme.palette.kanap.text.tertiary, fontSize: 11 },
              line: { stroke: theme.palette.kanap.border.soft },
              gridLine: { enabled: false },
            },
            {
              type: 'number',
              position: 'left',
              label: { color: theme.palette.kanap.text.tertiary, fontSize: 11 },
              line: { enabled: false },
              gridLine: { style: [{ stroke: theme.palette.kanap.border.soft, lineDash: [] }] },
            },
          ],
          legend: {
            enabled: true,
            position: 'bottom' as const,
            item: { label: { color: theme.palette.kanap.text.secondary, fontSize: 11 } },
          },
          // The first month label is centred under the first band and reaches past it: without
          // room on the left, "Oct 2025" is cut off by the edge of the chart.
          padding: { top: 8, right: 12, bottom: 4, left: 16 },
          animation: { enabled: false },
          listeners: {
            seriesNodeClick: (event: any) => {
              const row = event?.datum;
              if (row?.periodStart && row?.periodEnd) navigate(weeklyLink(row.periodStart, row.periodEnd));
            },
          },
        },
      };
    },
    [colors, dark, day, navigate, periodLabel, t, theme, weeklyLink],
  );

  const charts = useMemo(
    () => (data ? ENTITY_KEYS.map((key) => chartFor(key, data.flow[key])) : []),
    [chartFor, data],
  );

  /* ---------------------------------------------------------------- */
  /*  Flow tables                                                     */
  /* ---------------------------------------------------------------- */

  type WeekTableRow = FlowPeriod;
  type MonthTableRow = FlowPeriod & { label: string; requests: FlowPeriod; projects: FlowPeriod };

  const weekRows = useMemo<WeekTableRow[]>(() => data?.flow.tasks.periods ?? [], [data]);

  const monthRows = useMemo<MonthTableRow[]>(() => {
    if (!data) return [];
    const series = data.flow.requests;
    return series.periods.map((period, index) => ({
      ...period,
      label: periodLabel(series, index),
      requests: period,
      projects: data.flow.projects.periods[index],
    }));
  }, [data, periodLabel]);

  /** A created/closed count that opens the weekly report for its own period. */
  const periodCountCell =
    (read: (row: any) => { value: number; from: string; to: string }) =>
    (params: ICellRendererParams<any>) => {
      if (!params.data) return null;
      const { value, from, to } = read(params.data);
      if (value === 0) return <span>0</span>;
      return (
        <RouterLink to={weeklyLink(from, to)} style={{ color: 'inherit' }}>
          {value}
        </RouterLink>
      );
    };

  const weekColumns = useMemo<ColDef<WeekTableRow>[]>(
    () => [
      {
        headerName: t('reports.flow.columns.week'),
        width: 120,
        valueGetter: (params) => (params.data ? day(params.data.periodStart) : ''),
      },
      {
        headerName: t('reports.flow.columns.tasksCreated'),
        width: 140,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.created ?? 0,
        cellRenderer: periodCountCell((row: WeekTableRow) => ({
          value: row.created,
          from: row.periodStart,
          to: row.periodEnd,
        })),
      },
      {
        headerName: t('reports.flow.columns.tasksClosed'),
        width: 140,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.closed ?? 0,
        cellRenderer: periodCountCell((row: WeekTableRow) => ({
          value: row.closed,
          from: row.periodStart,
          to: row.periodEnd,
        })),
      },
      // The stock at the end of a past period is a computed state: no list holds exactly it.
      {
        headerName: t('reports.flow.columns.tasksOpen'),
        width: 130,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.openAtEnd ?? 0,
      },
    ],
    // `periodCountCell` closes over the weekly link, so the columns are rebuilt when the
    // filter changes: a cell rendered once would keep opening the unfiltered weekly report.
    [day, t, weeklyLink],
  );

  const monthColumns = useMemo<ColDef<MonthTableRow>[]>(() => {
    const trio = (key: MonthlyKey): ColDef<MonthTableRow>[] => [
      {
        headerName: t(`reports.flow.columns.${key}Created`),
        width: 150,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.[key].created ?? 0,
        cellRenderer: periodCountCell((row: MonthTableRow) => ({
          value: row[key].created,
          from: row.periodStart,
          to: row.periodEnd,
        })),
      },
      {
        headerName: t(`reports.flow.columns.${key}Closed`),
        width: 150,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.[key].closed ?? 0,
        cellRenderer: periodCountCell((row: MonthTableRow) => ({
          value: row[key].closed,
          from: row.periodStart,
          to: row.periodEnd,
        })),
      },
      {
        headerName: t(`reports.flow.columns.${key}Open`),
        width: 140,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.[key].openAtEnd ?? 0,
      },
    ];

    return [
      {
        headerName: t('reports.flow.columns.month'),
        width: 120,
        valueGetter: (params) => params.data?.label ?? '',
      },
      ...trio('requests'),
      ...trio('projects'),
    ];
  }, [t, weeklyLink]);

  /* ---------------------------------------------------------------- */
  /*  Age of open tasks                                               */
  /* ---------------------------------------------------------------- */

  type AgeTableRow = AgeRow & { isTotal: boolean };

  const ageRows = useMemo<AgeTableRow[]>(() => {
    if (!data) return [];
    const rows: AgeTableRow[] = data.age.tasks.rows.map((row) => ({ ...row, isTotal: false }));
    if (rows.length === 0) return rows;
    return [...rows, { ...data.age.tasks.total, isTotal: true }];
  }, [data]);

  const ageColumns = useMemo<Array<ColDef<AgeTableRow> | ColGroupDef<AgeTableRow>>>(() => {
    const today = data?.endDate ?? '';

    /** The `created_at` window of a bracket, read against the report's own "today". */
    const bracketFilter = (bucket: AgeBucket): FilterModel => {
      if (bucket === 'upTo7') return { created_at: createdBetween(shiftDay(today, -7), null) };
      if (bucket === 'from8To30') return { created_at: createdBetween(shiftDay(today, -30), shiftDay(today, -8)) };
      if (bucket === 'from31To90') return { created_at: createdBetween(shiftDay(today, -90), shiftDay(today, -31)) };
      return { created_at: createdBetween(null, shiftDay(today, -90)) };
    };

    const typeFilter = (row: AgeTableRow): FilterModel => {
      if (row.isTotal) return {};
      if (!row.taskTypeName) return { task_type_name: BLANK };
      return { task_type_name: { filterType: 'set', values: [row.taskTypeName] } };
    };

    const cell =
      (bucket: AgeBucket | null) =>
      (params: ICellRendererParams<AgeTableRow>) => {
        const row = params.data;
        if (!row) return null;
        const value = bucket ? row.buckets[bucket] : row.total;
        const weight = row.isTotal ? 500 : 400;
        const to = listLink('tasks', { ...typeFilter(row), ...(bucket ? bracketFilter(bucket) : {}) });
        if (value === 0 || !today) return <span style={{ fontWeight: weight }}>{value}</span>;
        return (
          <RouterLink to={to} style={{ color: 'inherit', fontWeight: weight }}>
            {value}
          </RouterLink>
        );
      };

    const bucketColumn = (bucket: AgeBucket): ColDef<AgeTableRow> => ({
      headerName: t(`reports.flow.columns.${bucket}`),
      flex: 1,
      minWidth: 56,
      type: 'numericColumn',
      valueGetter: (params) => params.data?.buckets[bucket] ?? 0,
      cellRenderer: cell(bucket),
    });

    return [
      {
        headerName: t('reports.flow.columns.taskType'),
        flex: 1.6,
        minWidth: 80,
        valueGetter: (params) => {
          if (!params.data) return '';
          if (params.data.isTotal) return t('reports.flow.rows.total');
          return typeLabel(params.data.taskTypeName, params.data.taskTypeCode) ?? t('reports.flow.rows.noType');
        },
        cellStyle: (params) => (params.data?.isTotal ? { fontWeight: 500 } : null),
      },
      // The brackets sit under one word, so the row reads "3 bugs, created 31 to 90 days ago".
      {
        headerName: t('reports.flow.groups.tasks'),
        marryChildren: true,
        children: [
          bucketColumn('upTo7'),
          bucketColumn('from8To30'),
          bucketColumn('from31To90'),
          bucketColumn('over90'),
        ],
      },
      {
        headerName: t('reports.flow.columns.total'),
        flex: 0.8,
        minWidth: 52,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.total ?? 0,
        cellRenderer: cell(null),
      },
    ];
  }, [data, listLink, t, typeLabel]);

  /* ---------------------------------------------------------------- */
  /*  Age of the open requests and projects                           */
  /* ---------------------------------------------------------------- */

  type CreatedAgeTableRow = CreatedAgeRow & { isTotal: boolean };

  const createdAgeRows = useCallback(
    (key: MonthlyKey): CreatedAgeTableRow[] => {
      const table = data?.age[key];
      if (!table) return [];
      return [
        ...table.rows.map((row) => ({ ...row, isTotal: false })),
        { ...table.total, isTotal: true },
      ];
    },
    [data],
  );

  const createdAgeColumns = useCallback(
    (key: MonthlyKey): Array<ColDef<CreatedAgeTableRow> | ColGroupDef<CreatedAgeTableRow>> => {
      const today = data?.endDate ?? '';
      const statusScope = (row: CreatedAgeTableRow): FilterModel =>
        row.isTotal ? {} : { status: { filterType: 'set', values: [row.status] } };

      /** The `created_at` window of a bracket, read against the report's own "today". */
      const bracketFilter = (bucket: MonthBucket): FilterModel => {
        if (bucket === 'underOneMonth') return { created_at: createdBetween(shiftDay(today, -29), null) };
        if (bucket === 'oneToThreeMonths') {
          return { created_at: createdBetween(shiftDay(today, -91), shiftDay(today, -30)) };
        }
        if (bucket === 'threeToSixMonths') {
          return { created_at: createdBetween(shiftDay(today, -182), shiftDay(today, -92)) };
        }
        return { created_at: createdBetween(null, shiftDay(today, -182)) };
      };

      const cell =
        (bucket: MonthBucket | null) =>
        (params: ICellRendererParams<CreatedAgeTableRow>) => {
          const row = params.data;
          if (!row) return null;
          const value = bucket ? row.buckets[bucket] : row.total;
          const weight = row.isTotal ? 500 : 400;
          const to = listLink(key, { ...statusScope(row), ...(bucket ? bracketFilter(bucket) : {}) });
          if (value === 0 || !today) return <span style={{ fontWeight: weight }}>{value}</span>;
          return (
            <RouterLink to={to} style={{ color: 'inherit', fontWeight: weight }}>
              {value}
            </RouterLink>
          );
        };

      return [
        {
          headerName: t('reports.flow.columns.status'),
          flex: 1.6,
          minWidth: 80,
          // A status is a sentence ("Waiting list", "En attente de revue"): it wraps rather
          // than ending in an ellipsis that hides which status the row is.
          wrapText: true,
          autoHeight: true,
          valueGetter: (params) => {
            if (!params.data) return '';
            return params.data.isTotal
              ? t('reports.flow.rows.total')
              : statusLabel(key, params.data.status);
          },
          cellStyle: (params) => (params.data?.isTotal ? { fontWeight: 500 } : null),
        },
        {
          headerName: t(`reports.flow.groups.${key}`),
          marryChildren: true,
          children: MONTH_BUCKETS.map<ColDef<CreatedAgeTableRow>>((bucket) => ({
            headerName: bucketLabel(bucket),
            flex: 1,
            minWidth: 58,
            type: 'numericColumn',
            valueGetter: (params) => params.data?.buckets[bucket] ?? 0,
            cellRenderer: cell(bucket),
          })),
        },
        {
          headerName: t('reports.flow.columns.total'),
          flex: 0.7,
          minWidth: 52,
          type: 'numericColumn',
          valueGetter: (params) => params.data?.total ?? 0,
          cellRenderer: cell(null),
        },
      ];
    },
    [bucketLabel, data, listLink, statusLabel, t],
  );

  /* ---------------------------------------------------------------- */
  /*  Where the open work sits                                        */
  /* ---------------------------------------------------------------- */

  type ByStatusTableRow = ByStatusRow & { isTotal: boolean };

  const byStatusRows = useCallback(
    (key: EntityKey): ByStatusTableRow[] => {
      const table = data?.byStatus[key];
      if (!table) return [];
      return [
        ...table.rows.map((row) => ({ ...row, isTotal: false })),
        { ...table.total, isTotal: true },
      ];
    },
    [data],
  );

  /** The items behind one stuck cell: the list the report opens is that very list. */
  const panelItems = useMemo<StuckItem[]>(() => {
    if (!panel || !data) return [];
    return data.byStatus[panel.entity].items.filter(
      (item) => panel.status == null || item.status === panel.status,
    );
  }, [data, panel]);

  const byStatusColumns = useCallback(
    (key: EntityKey): ColDef<ByStatusTableRow>[] => {
      const today = data?.endDate ?? '';
      const statusScope = (row: ByStatusTableRow): FilterModel =>
        row.isTotal ? {} : { status: { filterType: 'set', values: [row.status] } };

      const openCell = (params: ICellRendererParams<ByStatusTableRow>) => {
        const row = params.data;
        if (!row) return null;
        const weight = row.isTotal ? 500 : 400;
        const to = listLink(key, statusScope(row));
        if (row.open === 0) return <span style={{ fontWeight: weight }}>{row.open}</span>;
        return (
          <RouterLink to={to} style={{ color: 'inherit', fontWeight: weight }}>
            {row.open}
          </RouterLink>
        );
      };

      // Time in a status is not a column of any list, so the figure opens the report's own
      // list, built from the very items the figure counted.
      const stuckCell = (params: ICellRendererParams<ByStatusTableRow>) => {
        const row = params.data;
        if (!row) return null;
        const weight = row.isTotal ? 500 : 400;
        if (row.stuck === 0) return <span style={{ fontWeight: weight }}>{row.stuck}</span>;
        const status = row.isTotal ? null : row.status;
        const active = panel?.entity === key && panel.status === status;
        return (
          <Box
            component="button"
            type="button"
            onClick={() => setPanel(active ? null : { entity: key, status })}
            sx={{
              border: 0,
              p: 0,
              bgcolor: 'transparent',
              font: 'inherit',
              fontWeight: weight,
              color: 'inherit',
              cursor: 'pointer',
              textDecoration: active ? 'underline' : 'none',
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            {row.stuck}
          </Box>
        );
      };

      const plannedEndCell = (params: ICellRendererParams<ByStatusTableRow>) => {
        const row = params.data;
        if (!row) return null;
        const value = row.plannedEndPassed ?? 0;
        const weight = row.isTotal ? 500 : 400;
        if (value === 0 || !today) return <span style={{ fontWeight: weight }}>{value}</span>;
        const to = listLink('projects', {
          ...statusScope(row),
          planned_end: { filterType: 'date', type: 'lessThan', dateFrom: today },
        });
        return (
          <RouterLink to={to} style={{ color: 'inherit', fontWeight: weight }}>
            {value}
          </RouterLink>
        );
      };

      const columns: ColDef<ByStatusTableRow>[] = [
        {
          headerName: t('reports.flow.columns.status'),
          flex: 1.6,
          minWidth: 80,
          wrapText: true,
          autoHeight: true,
          valueGetter: (params) => {
            if (!params.data) return '';
            return params.data.isTotal
              ? t('reports.flow.rows.total')
              : statusLabel(key, params.data.status);
          },
          cellStyle: (params) => (params.data?.isTotal ? { fontWeight: 500 } : null),
        },
        {
          headerName: t(`reports.flow.columns.open.${key}`),
          flex: 0.8,
          minWidth: 58,
          type: 'numericColumn',
          valueGetter: (params) => params.data?.open ?? 0,
          cellRenderer: openCell,
        },
        {
          headerName: t(`reports.flow.columns.stuck.${key}`),
          flex: 1.6,
          minWidth: 76,
          type: 'numericColumn',
          valueGetter: (params) => params.data?.stuck ?? 0,
          cellRenderer: stuckCell,
        },
      ];

      if (key === 'projects') {
        columns.push({
          headerName: t('reports.flow.columns.plannedEndPassed'),
          flex: 1.2,
          minWidth: 76,
          type: 'numericColumn',
          valueGetter: (params) => params.data?.plannedEndPassed ?? 0,
          cellRenderer: plannedEndCell,
        });
      }

      return columns;
    },
    [data, listLink, panel, statusLabel, t],
  );

  /* ---------------------------------------------------------------- */
  /*  Median time to close                                            */
  /* ---------------------------------------------------------------- */

  const medianText = useCallback(
    (value: number | null) =>
      value == null ? t('reports.flow.tiles.noValue') : t('reports.flow.tiles.days', { count: value }),
    [t],
  );

  const leadColumns = useMemo<ColDef<LeadTimeByType>[]>(
    () => [
      {
        headerName: t('reports.flow.columns.taskType'),
        flex: 1.4,
        minWidth: 100,
        valueGetter: (params) => typeLabel(params.data?.taskTypeName, params.data?.taskTypeCode) ?? t('reports.flow.rows.noType'),
      },
      {
        headerName: t('reports.flow.columns.closedCount'),
        flex: 1,
        minWidth: 76,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.closedCount ?? 0,
      },
      {
        headerName: t('reports.flow.columns.medianDays'),
        flex: 1,
        minWidth: 84,
        type: 'numericColumn',
        valueGetter: (params) => medianText(params.data?.medianDays ?? null),
      },
    ],
    [medianText, t, typeLabel],
  );

  type OutcomeRow = LeadTime & { outcome: 'converted' | 'rejected' };

  const outcomeRows = useMemo<OutcomeRow[]>(() => {
    if (!data) return [];
    return [
      { outcome: 'converted', ...data.leadTime.requests.converted },
      { outcome: 'rejected', ...data.leadTime.requests.rejected },
    ];
  }, [data]);

  const outcomeColumns = useMemo<ColDef<OutcomeRow>[]>(
    () => [
      {
        headerName: t('reports.flow.columns.outcome'),
        flex: 1.4,
        minWidth: 100,
        valueGetter: (params) => (params.data ? t(`reports.flow.rows.${params.data.outcome}`) : ''),
      },
      {
        headerName: t('reports.flow.columns.closedCount'),
        flex: 1,
        minWidth: 76,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.closedCount ?? 0,
      },
      {
        headerName: t('reports.flow.columns.medianDays'),
        flex: 1,
        minWidth: 84,
        type: 'numericColumn',
        valueGetter: (params) => medianText(params.data?.medianDays ?? null),
      },
    ],
    [medianText, t],
  );

  type DoneRow = ProjectDoneLeadTime;

  const doneRows = useMemo<DoneRow[]>(() => (data ? [data.leadTime.projects.done] : []), [data]);

  const doneColumns = useMemo<ColDef<DoneRow>[]>(
    () => [
      {
        headerName: t('reports.flow.columns.completed'),
        flex: 0.8,
        minWidth: 70,
        type: 'numericColumn',
        valueGetter: (params) => params.data?.closedCount ?? 0,
      },
      {
        headerName: t('reports.flow.columns.medianDuration'),
        flex: 1,
        minWidth: 84,
        type: 'numericColumn',
        valueGetter: (params) => medianText(params.data?.medianDays ?? null),
      },
      {
        headerName: t('reports.flow.columns.medianGap'),
        flex: 2,
        minWidth: 130,
        type: 'numericColumn',
        valueGetter: (params) => {
          const row = params.data;
          if (!row || row.withPlannedEnd === 0 || row.medianOverrunDays == null) {
            return t('reports.flow.tiles.noValue');
          }
          return t('reports.flow.rows.gapOver', {
            gap: t('reports.flow.tiles.days', { count: row.medianOverrunDays }),
            count: row.withPlannedEnd,
          });
        },
      },
    ],
    [medianText, t],
  );

  const { ref: flowTableRef, height: flowTableFill } = useFillViewportHeight();

  /* ---------------------------------------------------------------- */
  /*  Tiles                                                           */
  /* ---------------------------------------------------------------- */

  const tiles = ENTITY_KEYS.map((key) => {
    const series = data?.flow[key];
    const openNow = series?.openNow ?? 0;
    const opening = series?.periods[0]?.openAtEnd ?? 0;
    const delta = openNow - opening;
    const first = series?.periods[0];
    const since = !first
      ? ''
      : series!.granularity === 'month'
        ? monthLabel(first.periodStart)
        : day(first.periodStart);
    return {
      key,
      label: t(`reports.flow.tiles.${key}`),
      value: String(openNow),
      to: listLink(key),
      caption: t(`reports.flow.tiles.openNow.${key}`),
      delta:
        delta === 0
          ? t('reports.flow.tiles.steady', { date: since })
          : t('reports.flow.tiles.deltaSince', { delta: delta > 0 ? `+${delta}` : String(delta), date: since }),
      trend: (series?.periods ?? []).slice(-12).map((period) => period.openAtEnd),
      trendLabel:
        series?.granularity === 'month'
          ? t('reports.flow.tiles.trendLabelMonths')
          : t('reports.flow.tiles.trendLabel'),
    };
  });

  const leadTiles = ENTITY_KEYS.map((key) => {
    const lead: LeadTime = data?.leadTime[key] ?? { closedCount: 0, measuredCount: 0, medianDays: null };
    const monthly = key !== 'tasks';
    // Items imported already closed are counted as closings but never measured: the median
    // would otherwise sit at zero for a portfolio that has just been taken over.
    const alreadyClosed = Math.max(lead.closedCount - lead.measuredCount, 0);
    const window = monthly
      ? t('reports.flow.tiles.closedOverMonths', { count: lead.measuredCount, months })
      : t('reports.flow.tiles.closedOver', { count: lead.measuredCount });
    return {
      key,
      label: t(`reports.flow.tiles.${key}`),
      lead,
      windowFrom: monthly ? data?.monthsStartDate : data?.startDate,
      caption:
        alreadyClosed === 0
          ? window
          : `${window} · ${t(`reports.flow.tiles.alreadyClosed.${key}`, { count: alreadyClosed })}`,
      // The weekly report holds every closing of the window. Once some of them are left out of
      // the median, its total no longer matches the figure, so the caption stops being a link.
      linked: alreadyClosed === 0,
    };
  });

  const ageGrids: Array<{ key: MonthlyKey; title: string; empty: string }> = [
    { key: 'requests', title: t('reports.flow.subsections.openRequests'), empty: t('reports.flow.empty.openRequests') },
    { key: 'projects', title: t('reports.flow.subsections.openProjects'), empty: t('reports.flow.empty.openProjects') },
  ];

  const statusGrids: Array<{ key: EntityKey; title: string }> = ENTITY_KEYS.map((key) => ({
    key,
    title: t(`reports.flow.subsections.${key}ByStatus`),
  }));

  return (
    <ReportLayout
      title={t('reports.flow.title')}
      subtitle={t('reports.flow.subtitle')}
      filters={(
        <>
          <ReportFilter label={t('reports.flow.filters.tasks')} width={170}>
            <TextField
              select
              size="small"
              value={weeks}
              onChange={(event) => changeWeeks(Number(event.target.value))}
              SelectProps={{ MenuProps: reportFilterMenuProps }}
              sx={reportFilterSelectSx}
            >
              {FLOW_PERIODS.map((option) => (
                <MenuItem key={option} value={option} sx={drawerMenuItemSx}>
                  {t('reports.flow.filters.periodOption', { count: option })}
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.flow.filters.requestsProjects')} width={200}>
            <TextField
              select
              size="small"
              value={months}
              onChange={(event) => changeMonths(Number(event.target.value))}
              SelectProps={{ MenuProps: reportFilterMenuProps }}
              sx={reportFilterSelectSx}
            >
              {FLOW_MONTH_PERIODS.map((option) => (
                <MenuItem key={option} value={option} sx={drawerMenuItemSx}>
                  {t('reports.flow.filters.monthOption', { count: option })}
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.weekly.filters.source')}>
            <TextField
              select
              size="small"
              value={sourceAll ? sourceOptions.map((option) => option.id) : sourceIds}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                MenuProps: reportFilterMenuProps,
                renderValue: () =>
                  sourceAll
                    ? t('reports.weekly.filters.allSources')
                    : t('reports.weekly.filters.selectedCount', { count: sourceIds.length }),
              }}
              onChange={(event) => changeSelection(event.target.value, sourceOptions, setSourceAll, setSourceIds)}
              sx={reportFilterSelectSx}
            >
              {sourceOptions.map((option) => (
                <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>
                  <Checkbox size="small" checked={sourceAll || sourceIds.includes(option.id)} />
                  <ListItemText primary={option.name} primaryTypographyProps={{ fontSize: 13 }} />
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.weekly.filters.category')} width={230}>
            <TextField
              select
              size="small"
              value={categoryAll ? categoryOptions.map((option) => option.id) : categoryIds}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                MenuProps: reportFilterMenuProps,
                renderValue: () =>
                  categoryAll
                    ? t('reports.weekly.filters.allCategories')
                    : t('reports.weekly.filters.selectedCount', { count: categoryIds.length }),
              }}
              onChange={(event) => changeSelection(event.target.value, categoryOptions, setCategoryAll, setCategoryIds)}
              sx={reportFilterSelectSx}
            >
              {categoryOptions.map((option) => (
                <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>
                  <Checkbox size="small" checked={categoryAll || categoryIds.includes(option.id)} />
                  <ListItemText primary={option.name} primaryTypographyProps={{ fontSize: 13 }} />
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ProjectFilter options={projectTeamValues?.projects ?? []} value={projectIds} onChange={setProjectIds} />
          <TeamFilter options={projectTeamValues?.teams ?? []} value={teamIds} onChange={setTeamIds} />
        </>
      )}
    >
      {isError && <Alert severity="error">{t('reports.flow.messages.loadFailed')}</Alert>}

      {/* 1. Flow -------------------------------------------------------- */}
      <Box sx={SECTION_SX}>
        <Typography component="h2" sx={SECTION_TITLE_SX}>
          {t('reports.flow.sections.flow')}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          {tiles.map((tile) => (
            <StatTile
              key={tile.key}
              label={tile.label}
              value={tile.value}
              to={tile.to}
              caption={tile.caption}
              delta={tile.delta}
              trend={tile.trend}
              trendLabel={tile.trendLabel}
            />
          ))}
        </Stack>

        <Box
          sx={{
            display: 'grid',
            // Two tiles per row on paper, each chart redrawn at half the page width.
            gridTemplateColumns: printing ? 'repeat(2, minmax(0, 1fr))' : { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' },
            gap: 1.5,
          }}
        >
          {charts.map((chart) => (
            <Box
              key={chart.key}
              sx={{
                bgcolor: 'kanap.bg.drawer',
                border: '1px solid',
                borderColor: 'kanap.border.soft',
                borderRadius: '8px',
                p: 1.5,
              }}
            >
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary', mb: 0.5 }}>
                {t(`reports.flow.tiles.${chart.key}`)}
                <Box component="span" sx={{ color: 'kanap.text.tertiary', fontWeight: 400 }}>
                  {' · '}
                  {chart.granularity === 'month'
                    ? t('reports.flow.charts.byMonth')
                    : t('reports.flow.charts.byWeek')}
                </Box>
              </Typography>
              <PrintableChart options={chart.options as any} height={260} label={t(`reports.flow.tiles.${chart.key}`)} printWidth={FLOW_TILE_PRINT_WIDTH} />
            </Box>
          ))}
        </Box>

        <Box sx={{ mt: 1.5 }} className="report-print-hide">
          <Typography
            component="button"
            type="button"
            onClick={() => setTableOpen((open) => !open)}
            aria-expanded={tableOpen}
            sx={TEXT_BUTTON_SX}
          >
            {tableOpen ? t('reports.flow.actions.hideTable') : t('reports.flow.actions.showTable')}
          </Typography>
        </Box>

        {tableOpen && (
          <Box ref={flowTableRef} sx={{ mt: 1, display: 'grid', gap: 2 }}>
            <Box>
              <Typography sx={SUB_TITLE_SX}>{t('reports.flow.subsections.tasksByWeek')}</Typography>
              <ReportGrid<WeekTableRow>
                wrapperSx={{ width: '100%', height: reportGridHeight(Math.round(flowTableFill / 2), weekRows.length) }}
                rowData={weekRows}
                columnDefs={weekColumns}
                defaultColDef={{ sortable: false, resizable: true, suppressMenu: true }}
                suppressCellFocus
                getRowId={(params) => params.data.periodStart}
              />
            </Box>
            <Box>
              <Typography sx={SUB_TITLE_SX}>{t('reports.flow.subsections.itemsByMonth')}</Typography>
              <ReportGrid<MonthTableRow>
                wrapperClassName="kanap-dense-grid"
                wrapperSx={{ width: '100%' }}
                rowData={monthRows}
                columnDefs={monthColumns}
                defaultColDef={{ sortable: false, resizable: true, suppressMenu: true }}
                suppressCellFocus
                domLayout="autoHeight"
                getRowId={(params) => params.data.periodStart}
              />
            </Box>
          </Box>
        )}
      </Box>

      {/* 2. Age of what is open ---------------------------------------- */}
      <Box sx={SECTION_SX}>
        <Typography component="h2" sx={SECTION_TITLE_SX}>
          {t('reports.flow.sections.age')}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            // The three grids only fit side by side on a wide screen; below that they stack
            // full width rather than hiding their last columns behind a scrollbar. The
            // projects grid carries one column more than the other two, so it gets the room.
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.35fr)' },
            gap: 1.5,
            alignItems: 'start',
          }}
        >
          <Box>
            <Typography sx={SUB_TITLE_SX}>{t('reports.flow.subsections.openTasks')}</Typography>
            {ageRows.length === 0 ? (
              <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
                {t('reports.flow.empty.age')}
              </Typography>
            ) : (
              <ReportGrid<AgeTableRow>
                wrapperClassName="kanap-dense-grid"
                wrapperSx={{ width: '100%' }}
                rowData={ageRows}
                columnDefs={ageColumns}
                defaultColDef={DENSE_COL_DEF}
                suppressCellFocus
                domLayout="autoHeight"
                getRowId={(params) => (params.data.isTotal ? 'total' : params.data.taskTypeId ?? 'none')}
              />
            )}
          </Box>

          {ageGrids.map((grid) => {
            const rows = createdAgeRows(grid.key);
            return (
              <Box key={grid.key}>
                <Typography sx={SUB_TITLE_SX}>{grid.title}</Typography>
                {rows.length === 0 ? (
                  <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
                    {grid.empty}
                  </Typography>
                ) : (
                  <ReportGrid<CreatedAgeTableRow>
                    wrapperClassName="kanap-dense-grid"
                    wrapperSx={{ width: '100%' }}
                    rowData={rows}
                    columnDefs={createdAgeColumns(grid.key)}
                    defaultColDef={DENSE_COL_DEF}
                    suppressCellFocus
                    domLayout="autoHeight"
                    getRowId={(params) => (params.data.isTotal ? 'total' : params.data.status)}
                  />
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* 2b. Where the open work sits ---------------------------------- */}
      <Box sx={SECTION_SX}>
        <Typography component="h2" sx={SECTION_TITLE_SX}>
          {t('reports.flow.sections.byStatus')}
        </Typography>
        <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary', mt: -1, mb: 1.5 }}>
          {t('reports.flow.sections.byStatusHint')}
        </Typography>

        <Box
          sx={{
            display: 'grid',
            // The projects grid carries one column more than the other two, so it gets the room.
            gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.35fr)' },
            gap: 1.5,
            alignItems: 'start',
          }}
        >
          {statusGrids.map((grid) => (
            <Box key={grid.key}>
              <Typography sx={SUB_TITLE_SX}>{grid.title}</Typography>
              <ReportGrid<ByStatusTableRow>
                wrapperClassName="kanap-dense-grid"
                wrapperSx={{ width: '100%' }}
                rowData={byStatusRows(grid.key)}
                columnDefs={byStatusColumns(grid.key)}
                defaultColDef={DENSE_COL_DEF}
                suppressCellFocus
                domLayout="autoHeight"
                getRowId={(params) => (params.data.isTotal ? 'total' : params.data.status)}
              />
            </Box>
          ))}
        </Box>

        {panel && (
          <Box
            sx={{
              mt: 1.5,
              border: '1px solid',
              borderColor: 'kanap.border.soft',
              borderRadius: '8px',
              bgcolor: 'kanap.bg.drawer',
              px: 2,
              py: 1.25,
            }}
          >
            <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1.5} sx={{ mb: 1 }}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.secondary' }}>
                {[
                  panel.status == null
                    ? t(`reports.flow.tiles.${panel.entity}`)
                    : statusLabel(panel.entity, panel.status),
                  t(`reports.flow.list.stuck.${panel.entity}`),
                  String(panelItems.length),
                ].join(' · ')}
              </Typography>
              <Typography component="button" type="button" onClick={() => setPanel(null)} sx={TEXT_BUTTON_SX}>
                {t('reports.flow.actions.closeList')}
              </Typography>
            </Stack>

            <Stack spacing={0.5}>
              {panelItems.map((item) => (
                <Stack
                  key={item.id}
                  direction={{ xs: 'column', sm: 'row' }}
                  alignItems={{ xs: 'flex-start', sm: 'baseline' }}
                  spacing={{ xs: 0, sm: 1.5 }}
                  sx={{
                    py: 0.5,
                    borderTop: '1px solid',
                    borderColor: 'kanap.border.soft',
                    '&:first-of-type': { borderTop: 0 },
                  }}
                >
                  <Typography
                    component={RouterLink}
                    to={item.itemPath}
                    sx={{
                      ...LINK_SX,
                      fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
                      fontSize: 12,
                      fontVariantNumeric: 'tabular-nums',
                      color: 'kanap.text.secondary',
                      minWidth: 62,
                    }}
                  >
                    {item.ref}
                  </Typography>
                  <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.primary', flex: 1, minWidth: 0 }}>
                    {item.name}
                  </Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>
                    {statusLabel(panel.entity, item.status)}
                  </Typography>
                  <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.tertiary' }}>
                    {t('reports.flow.list.since', { date: day(item.statusSince) })}
                  </Typography>
                  {panel.entity === 'projects' && item.plannedEnd && (
                    <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.tertiary' }}>
                      {t('reports.flow.list.plannedEnd', { date: day(item.plannedEnd) })}
                      {item.plannedEndPassed ? ` · ${t('reports.flow.list.overdue')}` : ''}
                    </Typography>
                  )}
                </Stack>
              ))}
            </Stack>
          </Box>
        )}
      </Box>

      {/* 3. Median time to close --------------------------------------- */}
      <Box sx={SECTION_SX}>
        <Typography component="h2" sx={SECTION_TITLE_SX}>
          {t('reports.flow.sections.leadTime')}
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
          {leadTiles.map((tile) => (
            <Box key={tile.key} sx={TILE_SX}>
              <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>{tile.label}</Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'kanap.text.primary' }}>
                {medianText(tile.lead.medianDays)}
              </Typography>
              {tile.lead.closedCount === 0 || !data || !tile.windowFrom ? (
                <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.tertiary' }}>
                  {t('reports.flow.tiles.noClosing')}
                </Typography>
              ) : !tile.linked ? (
                <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>
                  {tile.caption}
                </Typography>
              ) : (
                <Typography
                  component={RouterLink}
                  to={weeklyLink(tile.windowFrom, data.endDate)}
                  sx={{ ...LINK_SX, fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary', display: 'inline-block' }}
                >
                  {tile.caption}
                </Typography>
              )}
            </Box>
          ))}
        </Stack>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' },
            gap: 1.5,
            alignItems: 'start',
          }}
        >
          <Box>
            <Typography sx={SUB_TITLE_SX}>{t('reports.flow.subsections.tasksByType')}</Typography>
            {(data?.leadTime.tasksByType ?? []).length === 0 ? (
              <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
                {t('reports.flow.empty.leadTimeByType')}
              </Typography>
            ) : (
              <ReportGrid<LeadTimeByType>
                wrapperClassName="kanap-dense-grid"
                wrapperSx={{ width: '100%' }}
                rowData={data?.leadTime.tasksByType ?? []}
                columnDefs={leadColumns}
                defaultColDef={DENSE_COL_DEF}
                suppressCellFocus
                domLayout="autoHeight"
                getRowId={(params) => params.data.taskTypeId ?? 'none'}
              />
            )}
          </Box>

          <Box>
            <Typography sx={SUB_TITLE_SX}>{t('reports.flow.subsections.requestOutcomes')}</Typography>
            <ReportGrid<OutcomeRow>
              wrapperClassName="kanap-dense-grid"
              wrapperSx={{ width: '100%' }}
              rowData={outcomeRows}
              columnDefs={outcomeColumns}
              defaultColDef={DENSE_COL_DEF}
              suppressCellFocus
              domLayout="autoHeight"
              getRowId={(params) => params.data.outcome}
            />
          </Box>

          <Box>
            <Typography sx={SUB_TITLE_SX}>{t('reports.flow.subsections.projectCompletion')}</Typography>
            <ReportGrid<DoneRow>
              wrapperClassName="kanap-dense-grid"
              wrapperSx={{ width: '100%' }}
              rowData={doneRows}
              columnDefs={doneColumns}
              defaultColDef={DENSE_COL_DEF}
              suppressCellFocus
              domLayout="autoHeight"
              getRowId={() => 'done'}
            />
          </Box>
        </Box>
      </Box>
    </ReportLayout>
  );
}
