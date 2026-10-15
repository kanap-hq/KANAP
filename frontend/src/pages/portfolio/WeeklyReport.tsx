import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  ListItemText,
  Link as MLink,
  ListSubheader,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ReportGrid from '../../components/reports/ReportGrid';
import type { ColDef, ICellRendererParams, ValueGetterParams } from 'ag-grid-community';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import ReportLayout, {
  ReportFilter,
  reportFilterMenuProps,
  reportFilterSelectSx,
} from '../../components/reports/ReportLayout';
import DateEUField from '../../components/fields/DateEUField';
import {
  idsFromParams,
  idsParam,
  ProjectFilter,
  TeamFilter,
  useReportFilterValues,
} from '../../components/reports/ProjectTeamFilters';
import { drawerDatePickerSx, drawerMenuItemSx } from '../../theme/formSx';
import api from '../../api';
import { Trans, useTranslation } from 'react-i18next';
import { useLocale } from '../../i18n/useLocale';
import { useTaskTypeLabel } from '../../hooks/useLocalizedTaskTypes';
import { formatShortDate } from '../../lib/dateFormat';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import {
  PROJECT_STATUS_COLORS,
  REQUEST_STATUS_COLORS,
  TASK_STATUS_COLORS,
  getDotColor,
} from '../../utils/statusColors';
import {
  getProjectStatusLabel,
  getProjectStatusOptions,
  getRequestStatusLabel,
  getRequestStatusOptions,
  getTaskStatusLabel,
  getTaskStatusOptions,
} from '../../utils/portfolioI18n';
import {
  formatChangeValue,
  getWeeklyFieldLabel,
  type WeeklyChangeKind,
  type WeeklyReportEntity,
} from './components/WeeklyReportChangeLabels';

type WeeklyFieldChange = {
  key: string;
  before: string | null;
  after: string | null;
  kind: WeeklyChangeKind;
};

type WeeklyChangeSummary = {
  /** Every status of the period in order, repeats merged. */
  statusChain: string[];
  fields: WeeklyFieldChange[];
};

type WeeklyProjectOrigin = {
  ref: string;
  name: string;
  itemPath: string;
};

type WeeklyRowCommon = {
  ref: string;
  itemPath: string;
  name: string;
  sourceId: string | null;
  sourceName: string | null;
  categoryId: string | null;
  categoryName: string | null;
  streamId: string | null;
  streamName: string | null;
  company: string | null;
  status: string;
  createdAt: string | null;
  eventAt: string | null;
  changes: WeeklyChangeSummary | null;
};

type WeeklyProjectRow = WeeklyRowCommon & {
  projectId: string;
  priority: number | null;
  progress: number | null;
  origin: WeeklyProjectOrigin | null;
  originValue: string | null;
};

type WeeklyTaskRow = WeeklyRowCommon & {
  taskId: string;
  taskTypeId: string | null;
  taskTypeName: string | null;
  /** The shipped type it started as, null for a tenant's own type. */
  taskTypeCode?: string | null;
  priority: number | null;
};

type WeeklyRequestRow = WeeklyRowCommon & {
  requestId: string;
};

type WeeklyLists<TRow> = {
  created: TRow[];
  modified: TRow[];
  closed: TRow[];
};

type WeeklyListKey = 'created' | 'modified' | 'closed';

type WeeklyLoggedDays = { project: number; other: number; total: number };

type WeeklyPersonLists = WeeklyLists<WeeklyTaskRow>;

type WeeklyPerson = WeeklyPersonLists & {
  userId: string;
  name: string;
  contributorRef: string | null;
  loggedDays: WeeklyLoggedDays;
};

type WeeklyTeamGroup = {
  teamId: string | null;
  teamName: string | null;
  members: WeeklyPerson[];
  totals: { created: number; modified: number; closed: number; loggedDays: number };
};

type WeeklyByPerson = {
  teams: WeeklyTeamGroup[];
  unassigned: WeeklyPersonLists;
};

type WeeklyGroupBy = 'type' | 'person';

type WeeklyReportResponse = {
  requests: WeeklyLists<WeeklyRequestRow>;
  projects: WeeklyLists<WeeklyProjectRow>;
  tasks: WeeklyLists<WeeklyTaskRow>;
  byPerson?: WeeklyByPerson;
};

type FilterValuesResponse = {
  sources: Array<{ id: string; name: string }>;
  categories: Array<{ id: string; name: string }>;
  streams: Array<{ id: string; name: string; categoryId: string | null }>;
  taskTypes: Array<{ id: string; name: string; code?: string | null }>;
};

const LIST_KEYS: WeeklyListKey[] = ['created', 'modified', 'closed'];

type WeeklySectionKey = 'requests' | 'projects' | 'tasks';

/** The objects of the "Type" filter, as the URL and the API name them, with their section. */
const ENTITY_SECTIONS: Array<{ entity: string; section: WeeklySectionKey }> = [
  { entity: 'request', section: 'requests' },
  { entity: 'project', section: 'projects' },
  { entity: 'task', section: 'tasks' },
];
const ALL_ENTITIES = ENTITY_SECTIONS.map((item) => item.entity);

const collapsedStorageKey = (section: WeeklySectionKey) =>
  `kanap.portfolioReports.weekly.collapsed.${section}`;

const readCollapsed = (section: WeeklySectionKey): boolean => {
  try {
    return window.localStorage.getItem(collapsedStorageKey(section)) === '1';
  } catch {
    return false;
  }
};

const writeCollapsed = (section: WeeklySectionKey, collapsed: boolean) => {
  try {
    window.localStorage.setItem(collapsedStorageKey(section), collapsed ? '1' : '0');
  } catch {
    /* private mode or blocked storage: the group simply stays open on the next visit. */
  }
};

export const COLLAPSED_PEOPLE_STORAGE_KEY = 'kanap.portfolioReports.weeklyCollapsedPeople';

/** Folded groups are remembered by key; everything is open until someone folds it. */
const readCollapsedPeople = (): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(COLLAPSED_PEOPLE_STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : [];
  } catch {
    return [];
  }
};

const writeCollapsedPeople = (keys: string[]) => {
  try {
    window.localStorage.setItem(COLLAPSED_PEOPLE_STORAGE_KEY, JSON.stringify(keys));
  } catch {
    /* Folded groups are a reading convenience; losing them is harmless. */
  }
};

const EMPTY_BY_PERSON: WeeklyByPerson = {
  teams: [],
  unassigned: { created: [], modified: [], closed: [] },
};

const EMPTY_REQUESTS: WeeklyLists<WeeklyRequestRow> = { created: [], modified: [], closed: [] };
const EMPTY_PROJECTS: WeeklyLists<WeeklyProjectRow> = { created: [], modified: [], closed: [] };
const EMPTY_TASKS: WeeklyLists<WeeklyTaskRow> = { created: [], modified: [], closed: [] };

/** Status colours per object: a value such as `in_progress` exists for projects and tasks alike. */
const STATUS_COLORS: Record<WeeklyReportEntity, Record<string, string>> = {
  request: REQUEST_STATUS_COLORS,
  project: PROJECT_STATUS_COLORS,
  task: TASK_STATUS_COLORS,
};

/** Fields the "Changes" cell spells out before folding the rest into "+n". */
const CHANGES_SHOWN = 2;

/** Hover card of the "Changes" cell: one line per status chain or field, never wider than 420px. */
const CHANGES_TOOLTIP_SLOT_PROPS = {
  tooltip: { sx: { maxWidth: 420 } },
} as const;

/** The cell text is cut with an ellipsis; the "+n" after it always stays visible. */
const CHANGES_CELL_SX = { display: 'flex', alignItems: 'center', minWidth: 0, width: '100%' } as const;
const CHANGES_TEXT_SX = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;
const CHANGES_MORE_SX = { flexShrink: 0, ml: 0.75, color: 'kanap.text.secondary' } as const;

/** Charter card: 8px radius, hairline border, no shadow. */
const SECTION_SX = {
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  bgcolor: 'kanap.bg.primary',
  p: 2,
} as const;

/** Object heading inside the status menu: a section label, not a choice. */
const STATUS_GROUP_SX = {
  fontSize: 12,
  fontWeight: 500,
  lineHeight: '28px',
  color: 'kanap.text.tertiary',
  // Not sticky, so it can stay transparent and take the menu's own surface in both themes.
  bgcolor: 'transparent',
} as const;

const SECTION_TITLE_SX = {
  fontSize: 16,
  fontWeight: 500,
  color: 'kanap.text.primary',
  mb: 1.5,
} as const;

/**
 * AG Grid reserves 150px for an auto-height grid so its "no rows" overlay fits. The report
 * never shows an empty grid, so that floor only adds dead space under short lists.
 */
const AUTO_HEIGHT_GRID_SX = {
  width: '100%',
  '& .ag-layout-auto-height .ag-center-cols-viewport': { minHeight: 'unset' },
} as const;

const MONO_CELL_STYLE = {
  fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace",
  fontSize: '12px',
  color: 'var(--kanap-text-secondary)',
  fontVariantNumeric: 'tabular-nums',
} as const;

const toIsoDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDefaultStartDate = (): string => {
  const date = new Date();
  date.setDate(date.getDate() - 7);
  return toIsoDate(date);
};

/** True for a real `YYYY-MM-DD` day: `2026-02-31` has the right shape but does not exist. */
const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/**
 * A day handed over in the URL, when it is a real one. The flow report links here with the
 * bounds of a week, and any other caller can do the same; anything unusable falls back to the
 * report's own default rather than sending a broken period to the API.
 */
const dayFromParams = (params: URLSearchParams, key: string, fallback: string): string => {
  const raw = String(params.get(key) || '').trim();
  return isCalendarDate(raw) ? raw : fallback;
};

const humanize = (value: string): string =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

const parseFilename = (contentDisposition: string | undefined, fallback: string): string => {
  if (!contentDisposition) return fallback;
  const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utfMatch?.[1]) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return utfMatch[1];
    }
  }

  const asciiMatch = contentDisposition.match(/filename="?([^";]+)"?/i);
  if (asciiMatch?.[1]) return asciiMatch[1];
  return fallback;
};

const buildParams = (args: {
  startDate: string;
  endDate: string;
  sourceIds?: string[];
  categoryIds?: string[];
  streamIds?: string[];
  taskTypeIds?: string[];
  statuses?: string[];
  projectIds?: string[];
  teamIds?: string[];
  entities?: string[];
  groupBy: WeeklyGroupBy;
}) => {
  const params: Record<string, string> = {
    startDate: args.startDate,
    endDate: args.endDate,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    groupBy: args.groupBy,
  };

  if (args.sourceIds && args.sourceIds.length > 0) params.sourceIds = args.sourceIds.join(',');
  if (args.categoryIds && args.categoryIds.length > 0) params.categoryIds = args.categoryIds.join(',');
  if (args.streamIds && args.streamIds.length > 0) params.streamIds = args.streamIds.join(',');
  if (args.taskTypeIds && args.taskTypeIds.length > 0) params.taskTypeIds = args.taskTypeIds.join(',');
  if (args.statuses && args.statuses.length > 0) params.statuses = args.statuses.join(',');
  if (args.projectIds && args.projectIds.length > 0) params.projectIds = args.projectIds.join(',');
  if (args.teamIds && args.teamIds.length > 0) params.teamIds = args.teamIds.join(',');
  if (args.entities && args.entities.length > 0) params.entities = args.entities.join(',');

  return params;
};

type SubSectionProps<TRow> = {
  heading: string;
  rows: TRow[];
  columns: ColDef<TRow>[];
};

/**
 * One list inside a section: a counted sub-heading, then a grid. An empty list is its heading
 * alone: "Created (0)" already says there is nothing.
 */
function WeeklyReportSubSection<TRow extends { ref: string }>({
  heading,
  rows,
  columns,
}: SubSectionProps<TRow>) {
  return (
    <Box>
      <Typography
        component="div"
        sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.secondary', mb: rows.length > 0 ? 0.75 : 0 }}
      >
        {heading}
      </Typography>
      {rows.length > 0 && (
        <ReportGrid<TRow>
          wrapperSx={AUTO_HEIGHT_GRID_SX}
          rowData={rows}
          columnDefs={columns}
          defaultColDef={{ sortable: true, resizable: true, suppressMenu: true }}
          animateRows
          suppressCellFocus
          domLayout="autoHeight"
          getRowId={(params) => params.data.ref}
        />
      )}
    </Box>
  );
}

type SectionProps = {
  title: string;
  counts: string;
  collapsed: boolean;
  onToggle: () => void;
  /** Nothing in any of the three lists: the group is its title and its counts, on one line. */
  empty?: boolean;
  children: React.ReactNode;
};

/**
 * One entity group: a title row that folds the group away, then its three lists. The
 * counts follow the title while the group is folded, so navigation stays informative.
 * Print keeps every group open: a folded group is a reading convenience, not a filter.
 * An empty group has nothing to unfold: it stays a single line.
 */
function WeeklyReportSection({ title, counts, collapsed: collapsedByUser, onToggle, empty = false, children }: SectionProps) {
  const contentId = useId();
  const collapsed = collapsedByUser || empty;
  const toggle = empty ? () => undefined : onToggle;

  return (
    <Box sx={SECTION_SX}>
      <Stack
        direction="row"
        alignItems="center"
        spacing={1}
        onClick={toggle}
        sx={{ cursor: empty ? 'default' : 'pointer', userSelect: 'none', mb: collapsed ? 0 : 1.5 }}
      >
        <Typography component="h2" sx={{ ...SECTION_TITLE_SX, mb: 0 }}>
          <Box
            component="button"
            type="button"
            aria-expanded={empty ? undefined : !collapsed}
            aria-controls={empty ? undefined : contentId}
            disabled={empty}
            onClick={(event: React.MouseEvent) => {
              event.stopPropagation();
              toggle();
            }}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              p: 0,
              border: 0,
              bgcolor: 'transparent',
              color: 'inherit',
              font: 'inherit',
              cursor: empty ? 'default' : 'pointer',
            }}
          >
            <ExpandMoreIcon
              sx={{
                fontSize: 18,
                color: 'kanap.text.secondary',
                visibility: empty ? 'hidden' : 'visible',
                transform: collapsed ? 'rotate(-90deg)' : 'none',
                transition: 'transform 160ms ease',
              }}
            />
            {title}
          </Box>
        </Typography>
        {collapsed && (
          <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>
            {counts}
          </Typography>
        )}
      </Stack>
      {!empty && (
      <Collapse
        in={!collapsed}
        timeout={160}
        id={contentId}
        sx={{
          '@media print': {
            height: 'auto !important',
            overflow: 'visible !important',
            visibility: 'visible !important',
          },
        }}
      >
        <Stack spacing={1.5}>{children}</Stack>
      </Collapse>
      )}
    </Box>
  );
}

const PRINT_OPEN_SX = {
  '@media print': {
    height: 'auto !important',
    overflow: 'visible !important',
    visibility: 'visible !important',
  },
} as const;

type CollapsibleGroupProps = {
  label: string;
  /** Rendered right after the name: the contributor reference of a person. */
  after?: React.ReactNode;
  meta: string;
  collapsed: boolean;
  onToggle: () => void;
  level: 'team' | 'person';
  /** Nothing to unfold (no task at all): the group is its header line alone. */
  children?: React.ReactNode;
};

/**
 * One folded group of the by-person view: a team, or a person inside a team. The counts stay
 * next to the name open or closed; they are the reading itself, not a hint about what is
 * hidden. Print keeps every group open.
 */
function WeeklyCollapsibleGroup({
  label,
  after,
  meta,
  collapsed,
  onToggle,
  level,
  children,
}: CollapsibleGroupProps) {
  const contentId = useId();
  const isTeam = level === 'team';
  const hasBody = children != null && children !== false;

  return (
    <Box>
      <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap" sx={{ rowGap: 0.25 }}>
        {/*
          The name carries the row's baseline: the chevron is centred on its own, so the button's
          baseline is the text's and the counts after it sit on the same line.
        */}
        <Box
          component={hasBody ? 'button' : 'div'}
          type={hasBody ? 'button' : undefined}
          aria-expanded={hasBody ? !collapsed : undefined}
          aria-controls={hasBody ? contentId : undefined}
          onClick={hasBody ? onToggle : undefined}
          sx={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 0.5,
            p: 0,
            border: 0,
            bgcolor: 'transparent',
            color: 'kanap.text.primary',
            font: 'inherit',
            fontSize: isTeam ? 16 : 13,
            fontWeight: 500,
            cursor: hasBody ? 'pointer' : 'default',
            textAlign: 'left',
          }}
        >
          <ExpandMoreIcon
            sx={{
              alignSelf: 'center',
              fontSize: 18,
              color: 'kanap.text.secondary',
              // Kept in place, hidden, on a group with no body: names stay aligned.
              visibility: hasBody ? 'visible' : 'hidden',
              transform: collapsed ? 'rotate(-90deg)' : 'none',
              transition: 'transform 160ms ease',
            }}
          />
          <span>{label}</span>
        </Box>
        {after}
        <Typography component="div" sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>
          {meta}
        </Typography>
      </Stack>
      {hasBody && (
        <Collapse in={!collapsed} timeout={160} id={contentId} sx={PRINT_OPEN_SX}>
          <Stack spacing={1.5} sx={{ mt: 1.25, pl: isTeam ? 2 : 2.75 }}>
            {children}
          </Stack>
        </Collapse>
      )}
    </Box>
  );
}

export default function WeeklyReport() {
  const navigate = useNavigate();
  const { t } = useTranslation(['portfolio', 'errors']);
  const locale = useLocale();
  const typeLabel = useTaskTypeLabel();
  const theme = useTheme();
  const mode = theme.palette.mode;
  const today = useMemo(() => toIsoDate(new Date()), []);

  const [searchParams] = useSearchParams();
  const [startDate, setStartDate] = useState<string>(() =>
    dayFromParams(searchParams, 'startDate', getDefaultStartDate()),
  );
  const [endDate, setEndDate] = useState<string>(() => dayFromParams(searchParams, 'endDate', today));

  const initialSourceIds = useMemo(() => idsFromParams(searchParams, 'sourceIds'), [searchParams]);
  const initialCategoryIds = useMemo(() => idsFromParams(searchParams, 'categoryIds'), [searchParams]);
  const [sourceAll, setSourceAll] = useState(initialSourceIds.length === 0);
  const [sourceIds, setSourceIds] = useState<string[]>(initialSourceIds);
  const [categoryAll, setCategoryAll] = useState(initialCategoryIds.length === 0);
  const [categoryIds, setCategoryIds] = useState<string[]>(initialCategoryIds);
  // Every filter the page offers can come from a link: the by-person page links back here
  // with the same period and the same filters.
  const initialStreamIds = useMemo(() => idsFromParams(searchParams, 'streamIds'), [searchParams]);
  const initialTaskTypeIds = useMemo(() => idsFromParams(searchParams, 'taskTypeIds'), [searchParams]);
  const [streamAll, setStreamAll] = useState(initialStreamIds.length === 0);
  const [streamIds, setStreamIds] = useState<string[]>(initialStreamIds);
  const [taskTypeAll, setTaskTypeAll] = useState(initialTaskTypeIds.length === 0);
  const [taskTypeIds, setTaskTypeIds] = useState<string[]>(initialTaskTypeIds);
  // Type: the objects the by-type view covers. Nothing selected, or all three, is every object.
  const [entities, setEntities] = useState<string[]>(() => {
    const picked = idsFromParams(searchParams, 'entities').filter((entity) => ALL_ENTITIES.includes(entity));
    const unique = Array.from(new Set(picked));
    return unique.length === ALL_ENTITIES.length ? [] : unique;
  });
  // Projects and teams: every option is offered, not only the ones present in the period, and
  // nothing is remembered. Empty means every value.
  const [projectIds, setProjectIds] = useState<string[]>(() => idsFromParams(searchParams, 'projectIds'));
  const [teamIds, setTeamIds] = useState<string[]>(() => idsFromParams(searchParams, 'teamIds'));
  const { data: projectTeamValues } = useReportFilterValues();

  /** Status reached options, one group per object, in each object's own order. */
  const statusGroups = useMemo(
    () => [
      { key: 'requests', label: t('reports.weekly.sections.requests'), options: getRequestStatusOptions(t) },
      { key: 'projects', label: t('reports.weekly.sections.projects'), options: getProjectStatusOptions(t) },
      { key: 'tasks', label: t('reports.weekly.sections.tasks'), options: getTaskStatusOptions(t) },
    ],
    [t],
  );
  // A status shared by two objects (done, on hold) is one value: it narrows both lists at once.
  const allStatusValues = useMemo(
    () => Array.from(new Set<string>(statusGroups.flatMap((group) => group.options.map((option) => option.value)))),
    [statusGroups],
  );
  const initialStatuses = useMemo(() => {
    const known = new Set(allStatusValues);
    return idsFromParams(searchParams, 'statuses').filter((status) => known.has(status));
  }, [allStatusValues, searchParams]);
  const [statusAll, setStatusAll] = useState(initialStatuses.length === 0);
  const [statuses, setStatuses] = useState<string[]>(initialStatuses);

  const [collapsedSections, setCollapsedSections] = useState<Record<WeeklySectionKey, boolean>>(() => ({
    requests: readCollapsed('requests'),
    projects: readCollapsed('projects'),
    tasks: readCollapsed('tasks'),
  }));

  const { hasLevel } = useAuth();
  const canOpenContributor = hasLevel('portfolio_settings', 'reader');

  // Two reports on one page: the hub cards decide which (`?groupBy=person` for "Activity by
  // person", nothing for the period review). The URL alone says it; the page offers no switch.
  const groupBy: WeeklyGroupBy = searchParams.get('groupBy') === 'person' ? 'person' : 'type';
  const [collapsedPeople, setCollapsedPeople] = useState<string[]>(readCollapsedPeople);

  const togglePersonGroup = useCallback((key: string) => {
    setCollapsedPeople((previous) => {
      const next = previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key];
      writeCollapsedPeople(next);
      return next;
    });
  }, []);

  const toggleSection = useCallback((section: WeeklySectionKey) => {
    setCollapsedSections((previous) => {
      const next = !previous[section];
      writeCollapsed(section, next);
      return { ...previous, [section]: next };
    });
  }, []);

  const [exportError, setExportError] = useState<string | null>(null);
  const [exportingFormat, setExportingFormat] = useState<'csv' | 'xlsx' | null>(null);

  const isValidPeriod = Boolean(startDate && endDate && startDate <= endDate);

  const { data: filterValuesData } = useQuery<FilterValuesResponse>({
    queryKey: ['portfolio-weekly-report-filter-values'],
    queryFn: async () => {
      const res = await api.get('/portfolio/reports/weekly/filter-values');
      return res.data as FilterValuesResponse;
    },
  });

  const effectiveSourceIds = sourceAll ? [] : sourceIds;
  const effectiveCategoryIds = categoryAll ? [] : categoryIds;
  const effectiveStreamIds = streamAll ? [] : streamIds;
  const effectiveTaskTypeIds = taskTypeAll ? [] : taskTypeIds;
  const effectiveStatuses = statusAll ? [] : statuses;
  // The by-person view reads tasks only: the Type filter does not exist there.
  const effectiveEntities = groupBy === 'type' ? entities : [];
  // What the summary and the sections cover: the objects picked, or the tasks alone by person.
  const shows = (section: WeeklySectionKey) => {
    if (groupBy === 'person') return section === 'tasks';
    return (
      effectiveEntities.length === 0 ||
      ENTITY_SECTIONS.some((item) => item.section === section && effectiveEntities.includes(item.entity))
    );
  };

  const {
    data: reportData,
    isLoading,
    isFetching,
    error,
  } = useQuery<WeeklyReportResponse>({
    queryKey: [
      'portfolio-weekly-report',
      startDate,
      endDate,
      sourceAll,
      sourceIds,
      categoryAll,
      categoryIds,
      streamAll,
      streamIds,
      taskTypeAll,
      taskTypeIds,
      statusAll,
      statuses,
      projectIds,
      teamIds,
      effectiveEntities,
      groupBy,
    ],
    queryFn: async () => {
      const params = buildParams({
        startDate,
        endDate,
        sourceIds: effectiveSourceIds,
        categoryIds: effectiveCategoryIds,
        streamIds: effectiveStreamIds,
        taskTypeIds: effectiveTaskTypeIds,
        statuses: effectiveStatuses,
        projectIds,
        teamIds,
        entities: effectiveEntities,
        groupBy,
      });
      const res = await api.get('/portfolio/reports/weekly', { params });
      return res.data as WeeklyReportResponse;
    },
    enabled: isValidPeriod,
    placeholderData: keepPreviousData,
  });

  const sourceBaseOptions = filterValuesData?.sources ?? [];
  const categoryBaseOptions = filterValuesData?.categories ?? [];
  const streamBaseOptions = filterValuesData?.streams ?? [];
  const taskTypeBaseOptions = filterValuesData?.taskTypes ?? [];

  const requests = reportData?.requests ?? EMPTY_REQUESTS;
  const projects = reportData?.projects ?? EMPTY_PROJECTS;
  const tasks = reportData?.tasks ?? EMPTY_TASKS;
  const byPerson = reportData?.byPerson ?? EMPTY_BY_PERSON;

  const allRows = useMemo<WeeklyRowCommon[]>(
    () =>
      LIST_KEYS.flatMap((key) => [
        ...(requests[key] as WeeklyRowCommon[]),
        ...(projects[key] as WeeklyRowCommon[]),
        ...(tasks[key] as WeeklyRowCommon[]),
      ]),
    [requests, projects, tasks],
  );

  const totalRows = allRows.length;

  /** The label of a status for the object of the row: the same value can mean two things. */
  const getStatusLabel = useCallback((entity: WeeklyReportEntity, status: string) => {
    if (entity === 'task') return getTaskStatusLabel(t, status);
    if (entity === 'project') return getProjectStatusLabel(t, status);
    return getRequestStatusLabel(t, status);
  }, [t]);

  // The options are every active value of the tenant, never the values of the rows on screen:
  // a value unticked keeps its place in the list and can be ticked again. Only the streams
  // depend on another filter, and on the catalogue alone: a stream belongs to a category.
  const sourceOptions = sourceBaseOptions;
  const categoryOptions = categoryBaseOptions;
  const taskTypeOptions = useMemo(
    () => taskTypeBaseOptions.map((option) => ({ ...option, name: typeLabel(option.name, option.code) })),
    [taskTypeBaseOptions, typeLabel],
  );

  const streamOptions = useMemo(() => {
    if (categoryAll) return streamBaseOptions;
    const selectedCategorySet = new Set(categoryIds);
    return streamBaseOptions.filter((stream) => stream.categoryId != null && selectedCategorySet.has(stream.categoryId));
  }, [categoryAll, categoryIds, streamBaseOptions]);

  // A stream picked under a category the user then unticks is no longer offered: it leaves the
  // selection with it. Read on the catalogue only, once it is loaded.
  useEffect(() => {
    if (streamAll || !filterValuesData) return;
    const allowed = new Set(streamOptions.map((option) => option.id));
    const next = streamIds.filter((id) => allowed.has(id));
    if (next.length === 0) {
      setStreamAll(true);
      setStreamIds([]);
      return;
    }
    if (next.length !== streamIds.length) {
      setStreamIds(next);
    }
  }, [filterValuesData, streamAll, streamIds, streamOptions]);

  /* -------------------------------------------------------------- */
  /*  Shared cell renderers and columns                             */
  /* -------------------------------------------------------------- */

  const NameCell = useCallback(
    (params: ICellRendererParams<WeeklyRowCommon, string>) => (
      <Box
        component="span"
        sx={{ cursor: 'pointer' }}
        onClick={() => {
          if (!params.data?.itemPath) return;
          navigate(params.data.itemPath);
        }}
      >
        {params.value ?? ''}
      </Box>
    ),
    [navigate],
  );

  const StatusCell = useCallback(
    (params: ICellRendererParams<WeeklyRowCommon, string> & { entity: WeeklyReportEntity }) => {
      const status = String(params.value || '');
      if (!status) return null;
      const colorKey = STATUS_COLORS[params.entity][status];
      return (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
          <Box
            sx={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              flexShrink: 0,
              bgcolor: getDotColor(colorKey, mode),
            }}
          />
          <Box component="span" sx={{ color: getDotColor(colorKey, mode), fontWeight: 500 }}>
            {getStatusLabel(params.entity, status)}
          </Box>
        </Box>
      );
    },
    [getStatusLabel, mode],
  );

  const refColumn = useCallback(
    <TRow extends WeeklyRowCommon>(): ColDef<TRow> => ({
      field: 'ref' as any,
      headerName: t('reports.weekly.columns.reference'),
      width: 100,
      cellStyle: MONO_CELL_STYLE as any,
    }),
    [t],
  );

  const nameColumn = useCallback(
    <TRow extends WeeklyRowCommon>(headerName: string): ColDef<TRow> => ({
      field: 'name' as any,
      headerName,
      flex: 1.4,
      minWidth: 220,
      cellRenderer: NameCell,
    }),
    [NameCell],
  );

  const statusColumn = useCallback(
    <TRow extends WeeklyRowCommon>(entity: WeeklyReportEntity): ColDef<TRow> => ({
      field: 'status' as any,
      headerName: t('reports.weekly.columns.status'),
      width: 150,
      cellRenderer: StatusCell,
      cellRendererParams: { entity },
    }),
    [StatusCell, t],
  );

  const dateColumn = useCallback(
    <TRow extends WeeklyRowCommon>(listKey: WeeklyListKey): ColDef<TRow> => ({
      field: 'eventAt' as any,
      headerName: t(`reports.weekly.columns.date.${listKey}`),
      width: 130,
      valueFormatter: (params) => formatShortDate(params.value || null, locale),
    }),
    [locale, t],
  );

  /** Creation day of the item, shown next to the closing day in the closed lists. */
  const createdOnColumn = useCallback(
    <TRow extends WeeklyRowCommon>(): ColDef<TRow> => ({
      field: 'createdAt' as any,
      headerName: t('reports.weekly.columns.date.created'),
      width: 130,
      valueFormatter: (params) => formatShortDate(params.value || null, locale),
    }),
    [locale, t],
  );

  const priorityColumn = useCallback(
    <TRow extends WeeklyRowCommon & { priority: number | null }>(): ColDef<TRow> => ({
      field: 'priority' as any,
      headerName: t('reports.weekly.columns.priority'),
      width: 100,
      type: 'rightAligned',
      sort: 'desc',
      comparator: (a: number | null, b: number | null) => {
        const left = typeof a === 'number' ? a : Number.NEGATIVE_INFINITY;
        const right = typeof b === 'number' ? b : Number.NEGATIVE_INFINITY;
        return left - right;
      },
      valueFormatter: (params) => (params.value == null ? '' : String(Math.round(Number(params.value)))),
    }),
    [t],
  );

  /**
   * What changed, in words: the status chain when the status moved, then one
   * "Label: before → after" per field. The export writes the same thing on the server.
   */
  const describeChanges = useCallback(
    (entity: WeeklyReportEntity, changes: WeeklyChangeSummary | null) => {
      if (!changes) return { chain: '', fields: [] as string[] };
      const chain =
        changes.statusChain.length > 1
          ? changes.statusChain.map((status) => getStatusLabel(entity, status)).join(' → ')
          : '';
      const fields = changes.fields.map((field) => {
        const before = formatChangeValue(field.kind, field.before, t, locale);
        const after = formatChangeValue(field.kind, field.after, t, locale);
        return `${getWeeklyFieldLabel(t, entity, field.key)}${t('reports.weekly.changes.labelSeparator')}${before} → ${after}`;
      });
      return { chain, fields };
    },
    [getStatusLabel, locale, t],
  );

  /** The chain and the first two fields, "+n" for the rest; the hover card lists everything. */
  const ChangesCell = useCallback(
    (params: ICellRendererParams<WeeklyRowCommon, string> & { entity: WeeklyReportEntity }) => {
      const { chain, fields } = describeChanges(params.entity, params.data?.changes ?? null);
      const lines = [chain, ...fields].filter(Boolean);
      if (lines.length === 0) return null;
      const shown = [chain, ...fields.slice(0, CHANGES_SHOWN)].filter(Boolean).join('; ');
      const more = fields.length - Math.min(fields.length, CHANGES_SHOWN);
      return (
        <Tooltip
          enterDelay={300}
          placement="bottom-start"
          slotProps={CHANGES_TOOLTIP_SLOT_PROPS}
          title={
            <Box data-testid="weekly-changes-tooltip">
              {lines.map((line, index) => (
                <Box key={index}>{line}</Box>
              ))}
            </Box>
          }
        >
          <Box component="span" sx={CHANGES_CELL_SX}>
            <Box component="span" sx={CHANGES_TEXT_SX}>
              {shown}
            </Box>
            {more > 0 && (
              <Box component="span" sx={CHANGES_MORE_SX}>
                +{more}
              </Box>
            )}
          </Box>
        </Tooltip>
      );
    },
    [describeChanges],
  );

  const changesColumn = useCallback(
    <TRow extends WeeklyRowCommon>(entity: WeeklyReportEntity): ColDef<TRow> => ({
      colId: 'changes',
      headerName: t('reports.weekly.columns.changes'),
      flex: 1.2,
      minWidth: 220,
      valueGetter: (params: ValueGetterParams<TRow>) => {
        const { chain, fields } = describeChanges(entity, params.data?.changes ?? null);
        return [chain, ...fields].filter(Boolean).join('; ');
      },
      cellRenderer: ChangesCell,
      cellRendererParams: { entity },
    }),
    [ChangesCell, describeChanges, t],
  );

  const classificationColumns = useCallback(
    <TRow extends WeeklyRowCommon>(): ColDef<TRow>[] => [
      { field: 'sourceName' as any, headerName: t('reports.weekly.columns.source'), width: 150 },
      { field: 'categoryName' as any, headerName: t('reports.weekly.columns.category'), width: 160 },
      { field: 'streamName' as any, headerName: t('reports.weekly.columns.stream'), width: 160 },
      { field: 'company' as any, headerName: t('reports.weekly.columns.company'), width: 160 },
    ],
    [t],
  );

  /** The request a project was converted from, or the KANAP label of its own origin. */
  const originLabel = useCallback(
    (row?: WeeklyProjectRow | null): string => {
      if (!row) return '';
      if (row.origin) return `${row.origin.ref} ${row.origin.name}`.trim();
      if (!row.originValue) return '';
      return t(`origin.${row.originValue}`, { defaultValue: humanize(row.originValue) });
    },
    [t],
  );

  const OriginCell = useCallback(
    (params: ICellRendererParams<WeeklyProjectRow, unknown>) => {
      const origin = params.data?.origin ?? null;
      if (!origin) {
        return (
          <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>
            {originLabel(params.data)}
          </Box>
        );
      }
      return (
        <Box
          component="span"
          sx={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px' }}
          onClick={() => navigate(origin.itemPath)}
        >
          <Box component="span" sx={MONO_CELL_STYLE}>
            {origin.ref}
          </Box>
          <Box component="span">{origin.name}</Box>
        </Box>
      );
    },
    [navigate, originLabel],
  );

  /* -------------------------------------------------------------- */
  /*  Column sets                                                   */
  /* -------------------------------------------------------------- */

  const requestColumns = useMemo<Record<WeeklyListKey, ColDef<WeeklyRequestRow>[]>>(() => {
    const build = (listKey: WeeklyListKey): ColDef<WeeklyRequestRow>[] => [
      refColumn<WeeklyRequestRow>(),
      nameColumn<WeeklyRequestRow>(t('reports.weekly.columns.requestName')),
      ...classificationColumns<WeeklyRequestRow>(),
      statusColumn<WeeklyRequestRow>('request'),
      ...(listKey === 'closed' ? [createdOnColumn<WeeklyRequestRow>()] : []),
      dateColumn<WeeklyRequestRow>(listKey),
      ...(listKey === 'modified' ? [changesColumn<WeeklyRequestRow>('request')] : []),
    ];
    return { created: build('created'), modified: build('modified'), closed: build('closed') };
  }, [
    changesColumn,
    classificationColumns,
    createdOnColumn,
    dateColumn,
    nameColumn,
    refColumn,
    statusColumn,
    t,
  ]);

  const projectColumns = useMemo<Record<WeeklyListKey, ColDef<WeeklyProjectRow>[]>>(() => {
    const build = (listKey: WeeklyListKey): ColDef<WeeklyProjectRow>[] => [
      refColumn<WeeklyProjectRow>(),
      nameColumn<WeeklyProjectRow>(t('reports.weekly.columns.projectName')),
      ...(listKey === 'created'
        ? [{
            colId: 'origin',
            headerName: t('reports.weekly.columns.origin'),
            flex: 1,
            minWidth: 200,
            valueGetter: (params: ValueGetterParams<WeeklyProjectRow>) => originLabel(params.data),
            cellRenderer: OriginCell,
          } as ColDef<WeeklyProjectRow>]
        : []),
      priorityColumn<WeeklyProjectRow>(),
      ...classificationColumns<WeeklyProjectRow>(),
      {
        field: 'progress',
        headerName: t('reports.weekly.columns.progress'),
        width: 110,
        type: 'rightAligned',
        valueFormatter: (params) => (params.value == null ? '' : `${Math.round(Number(params.value))}%`),
      },
      statusColumn<WeeklyProjectRow>('project'),
      ...(listKey === 'closed' ? [createdOnColumn<WeeklyProjectRow>()] : []),
      dateColumn<WeeklyProjectRow>(listKey),
      ...(listKey === 'modified' ? [changesColumn<WeeklyProjectRow>('project')] : []),
    ];
    return { created: build('created'), modified: build('modified'), closed: build('closed') };
  }, [
    OriginCell,
    changesColumn,
    classificationColumns,
    createdOnColumn,
    dateColumn,
    originLabel,
    nameColumn,
    priorityColumn,
    refColumn,
    statusColumn,
    t,
  ]);

  const taskColumns = useMemo<Record<WeeklyListKey, ColDef<WeeklyTaskRow>[]>>(() => {
    const build = (listKey: WeeklyListKey): ColDef<WeeklyTaskRow>[] => [
      refColumn<WeeklyTaskRow>(),
      nameColumn<WeeklyTaskRow>(t('reports.weekly.columns.taskName')),
      {
        field: 'taskTypeName',
        headerName: t('reports.weekly.columns.taskType'),
        width: 150,
        valueFormatter: (params) => typeLabel(params.value ? String(params.value) : '', params.data?.taskTypeCode) ?? '',
      },
      priorityColumn<WeeklyTaskRow>(),
      ...classificationColumns<WeeklyTaskRow>(),
      statusColumn<WeeklyTaskRow>('task'),
      ...(listKey === 'closed' ? [createdOnColumn<WeeklyTaskRow>()] : []),
      dateColumn<WeeklyTaskRow>(listKey),
      ...(listKey === 'modified' ? [changesColumn<WeeklyTaskRow>('task')] : []),
    ];
    return { created: build('created'), modified: build('modified'), closed: build('closed') };
  }, [
    changesColumn,
    classificationColumns,
    createdOnColumn,
    dateColumn,
    nameColumn,
    priorityColumn,
    refColumn,
    statusColumn,
    t,
    typeLabel,
  ]);

  const handleDownload = async (format: 'csv' | 'xlsx') => {
    if (!isValidPeriod) return;

    try {
      setExportError(null);
      setExportingFormat(format);

      const params = buildParams({
        startDate,
        endDate,
        sourceIds: effectiveSourceIds,
        categoryIds: effectiveCategoryIds,
        streamIds: effectiveStreamIds,
        taskTypeIds: effectiveTaskTypeIds,
        statuses: effectiveStatuses,
        projectIds,
        teamIds,
        entities: effectiveEntities,
        groupBy,
      }) as Record<string, string>;
      params.format = format;

      const res = await api.get('/portfolio/reports/weekly/export', {
        params,
        responseType: 'blob',
      });

      const fallbackName = `weekly-report.${format}`;
      const filename = parseFilename(res.headers?.['content-disposition'], fallbackName);
      const blob = new Blob([res.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e: any) {
      setExportError(getApiErrorMessage(e, t, t('reports.weekly.messages.exportFailed')));
    } finally {
      setExportingFormat(null);
    }
  };

  const reportErrorMessage = error
    ? getApiErrorMessage(error, t, t('reports.weekly.messages.loadFailed'))
    : null;

  const countsFor = useCallback(
    (lists: WeeklyLists<unknown>) =>
      [
        t('reports.weekly.summary.created', { count: lists.created.length }),
        t('reports.weekly.summary.modified', { count: lists.modified.length }),
        t('reports.weekly.summary.closed', { count: lists.closed.length }),
      ].join(' · '),
    [t],
  );

  const summaryFor = useCallback(
    (entityLabel: string, lists: WeeklyLists<unknown>) => `${entityLabel} ${countsFor(lists)}`,
    [countsFor],
  );

  const subHeading = useCallback(
    (listKey: WeeklyListKey, count: number) => `${t(`reports.weekly.lists.${listKey}`)} (${count})`,
    [t],
  );

  /** Always one decimal, in the reader's locale: 3,5 in French, 3.5 in English. */
  const formatDays = useCallback(
    (value: number) =>
      Number(value || 0).toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    [locale],
  );

  /** The counts that follow a name: created, modified, closed, then the days logged. */
  const personMeta = useCallback(
    (counts: { created: number; modified: number; closed: number }, days: number) => {
      const parts = [
        t('reports.weekly.summary.created', { count: counts.created }),
        t('reports.weekly.summary.modified', { count: counts.modified }),
        t('reports.weekly.summary.closed', { count: counts.closed }),
      ];
      // No "0.0 days logged": the mention appears only when someone logged time.
      if (days > 0) parts.push(t('reports.weekly.byPerson.days', { count: days, value: formatDays(days) }));
      return parts.join(' · ');
    },
    [formatDays, t],
  );

  const personTimeLine = useCallback(
    (logged: WeeklyLoggedDays) =>
      t('reports.weekly.byPerson.timeLogged', {
        total: formatDays(logged.total),
        project: formatDays(logged.project),
        other: formatDays(logged.other),
      }),
    [formatDays, t],
  );

  /**
   * The counts that follow a person's name: created, modified, closed, then the time logged
   * detail (only when they logged time at all — no "0 days logged" mention).
   */
  const personSummaryMeta = useCallback(
    (counts: { created: number; modified: number; closed: number }, logged: WeeklyLoggedDays) => {
      const parts = [
        t('reports.weekly.summary.created', { count: counts.created }),
        t('reports.weekly.summary.modified', { count: counts.modified }),
        t('reports.weekly.summary.closed', { count: counts.closed }),
      ];
      if (logged.total > 0) {
        parts.push(personTimeLine(logged));
      }
      return parts.join(' · ');
    },
    [personTimeLine, t],
  );

  /**
   * The three lists of one person. Someone who carried nothing has no body at all: the header
   * line with its 0 · 0 · 0 already says it.
   */
  const personLists = useCallback(
    (lists: WeeklyPersonLists, keyPrefix: string) => {
      const isEmpty = LIST_KEYS.every((listKey) => lists[listKey].length === 0);
      if (isEmpty) return null;
      return LIST_KEYS.map((listKey) => (
        <WeeklyReportSubSection<WeeklyTaskRow>
          key={`${keyPrefix}-${listKey}`}
          heading={subHeading(listKey, lists[listKey].length)}
          rows={lists[listKey]}
          columns={taskColumns[listKey]}
        />
      ));
    },
    [subHeading, taskColumns],
  );

  const hasPersonRows =
    byPerson.teams.length > 0 ||
    LIST_KEYS.some((listKey) => byPerson.unassigned[listKey].length > 0);

  const byPersonView = groupBy === 'person';

  /**
   * The period review on the same period and the same filters: the query string this page
   * reads, without `groupBy`.
   */
  const periodReviewPath = (() => {
    const query = new URLSearchParams({ startDate, endDate });
    const pairs: Array<[string, string | undefined]> = [
      ['sourceIds', idsParam(effectiveSourceIds)],
      ['categoryIds', idsParam(effectiveCategoryIds)],
      ['streamIds', idsParam(effectiveStreamIds)],
      ['taskTypeIds', idsParam(effectiveTaskTypeIds)],
      ['statuses', idsParam(effectiveStatuses)],
      ['projectIds', idsParam(projectIds)],
      ['teamIds', idsParam(teamIds)],
    ];
    pairs.forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    return `/portfolio/reports/weekly?${query.toString()}`;
  })();

  return (
    <ReportLayout
      title={byPersonView ? t('reports.cards.byPerson.title') : t('reports.weekly.title')}
      subtitle={byPersonView ? t('reports.cards.byPerson.description') : t('reports.weekly.subtitle')}
      filters={(
        <>
          <DateEUField
            label={t('reports.weekly.filters.startDate')}
            valueYmd={startDate}
            onChangeYmd={setStartDate}
            sx={{ width: 160 }}
            textFieldSx={drawerDatePickerSx}
          />
          <DateEUField
            label={t('reports.weekly.filters.endDate')}
            valueYmd={endDate}
            onChangeYmd={setEndDate}
            sx={{ width: 160 }}
            textFieldSx={drawerDatePickerSx}
          />
          {!byPersonView && (
            <ReportFilter label={t('reports.weekly.filters.type')} width={180}>
              <TextField
                select
                size="small"
                value={entities.length === 0 ? ALL_ENTITIES : entities}
                SelectProps={{
                  multiple: true,
                  displayEmpty: true,
                  MenuProps: reportFilterMenuProps,
                  renderValue: () => {
                    if (entities.length === 0) return t('reports.weekly.filters.allTypes');
                    return entities
                      .map((entity) => t(`reports.weekly.sections.${ENTITY_SECTIONS.find((item) => item.entity === entity)!.section}`))
                      .join(', ');
                  },
                }}
                onChange={(e) => {
                  const next = e.target.value as unknown as string[];
                  const values = Array.isArray(next) ? next : [next];
                  // None or all three ticked is the same report: every object.
                  setEntities(values.length === ALL_ENTITIES.length ? [] : ALL_ENTITIES.filter((entity) => values.includes(entity)));
                }}
                sx={reportFilterSelectSx}
              >
                {ENTITY_SECTIONS.map((item) => (
                  <MenuItem key={item.entity} value={item.entity} sx={drawerMenuItemSx}>
                    <Checkbox size="small" checked={entities.length === 0 || entities.includes(item.entity)} />
                    <ListItemText
                      primary={t(`reports.weekly.sections.${item.section}`)}
                      primaryTypographyProps={{ fontSize: 13 }}
                    />
                  </MenuItem>
                ))}
              </TextField>
            </ReportFilter>
          )}
          <ReportFilter label={t('reports.weekly.filters.source')}>
            <TextField
              select
              size="small"
              value={sourceAll ? sourceOptions.map((option) => option.id) : sourceIds}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                MenuProps: reportFilterMenuProps,
                renderValue: () => {
                  if (sourceAll) return t('reports.weekly.filters.allSources');
                  return t('reports.weekly.filters.selectedCount', { count: sourceIds.length });
                },
              }}
              onChange={(e) => {
                const next = e.target.value as unknown as string[];
                const values = Array.isArray(next) ? next : [next];
                if (values.length === 0 || values.length === sourceOptions.length) {
                  setSourceAll(true);
                  setSourceIds([]);
                  return;
                }
                setSourceAll(false);
                setSourceIds(values);
              }}
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
                renderValue: () => {
                  if (categoryAll) return t('reports.weekly.filters.allCategories');
                  return t('reports.weekly.filters.selectedCount', { count: categoryIds.length });
                },
              }}
              onChange={(e) => {
                const next = e.target.value as unknown as string[];
                const values = Array.isArray(next) ? next : [next];
                if (values.length === 0 || values.length === categoryOptions.length) {
                  setCategoryAll(true);
                  setCategoryIds([]);
                  return;
                }
                setCategoryAll(false);
                setCategoryIds(values);
              }}
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
          <ReportFilter label={t('reports.weekly.filters.stream')}>
            <TextField
              select
              size="small"
              value={streamAll ? streamOptions.map((option) => option.id) : streamIds}
              disabled={streamOptions.length === 0}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                MenuProps: reportFilterMenuProps,
                renderValue: () => {
                  if (streamAll) return t('reports.weekly.filters.allStreams');
                  return t('reports.weekly.filters.selectedCount', { count: streamIds.length });
                },
              }}
              onChange={(e) => {
                const next = e.target.value as unknown as string[];
                const values = Array.isArray(next) ? next : [next];
                if (values.length === 0 || values.length === streamOptions.length) {
                  setStreamAll(true);
                  setStreamIds([]);
                  return;
                }
                setStreamAll(false);
                setStreamIds(values);
              }}
              sx={reportFilterSelectSx}
            >
              {streamOptions.map((option) => (
                <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>
                  <Checkbox size="small" checked={streamAll || streamIds.includes(option.id)} />
                  <ListItemText primary={option.name} primaryTypographyProps={{ fontSize: 13 }} />
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
          <ReportFilter label={t('reports.weekly.filters.statusReached')} width={200}>
            <TextField
              select
              size="small"
              value={statusAll ? allStatusValues : statuses}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                MenuProps: reportFilterMenuProps,
                renderValue: () => {
                  if (statusAll) return t('reports.weekly.filters.allStatuses');
                  return t('reports.weekly.filters.selectedCount', { count: statuses.length });
                },
              }}
              onChange={(e) => {
                const next = e.target.value as unknown as string[];
                const values = Array.from(new Set(Array.isArray(next) ? next : [next]));
                if (values.length === 0 || values.length === allStatusValues.length) {
                  setStatusAll(true);
                  setStatuses([]);
                  return;
                }
                setStatusAll(false);
                setStatuses(values);
              }}
              sx={reportFilterSelectSx}
            >
              {statusGroups.flatMap((group) => [
                <ListSubheader key={`group-${group.key}`} disableSticky sx={STATUS_GROUP_SX}>
                  {group.label}
                </ListSubheader>,
                ...group.options.map((option) => (
                  <MenuItem key={`${group.key}-${option.value}`} value={option.value} sx={drawerMenuItemSx}>
                    <Checkbox size="small" checked={statusAll || statuses.includes(option.value)} />
                    <ListItemText primary={option.label} primaryTypographyProps={{ fontSize: 13 }} />
                  </MenuItem>
                )),
              ])}
            </TextField>
          </ReportFilter>
          <ProjectFilter options={projectTeamValues?.projects ?? []} value={projectIds} onChange={setProjectIds} />
          <TeamFilter options={projectTeamValues?.teams ?? []} value={teamIds} onChange={setTeamIds} />
          <ReportFilter label={t('reports.weekly.filters.taskTypes')} width={240}>
            <TextField
              select
              size="small"
              value={taskTypeAll ? taskTypeOptions.map((option) => option.id) : taskTypeIds}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                MenuProps: reportFilterMenuProps,
                renderValue: () => {
                  if (taskTypeAll) return t('reports.weekly.filters.allTaskTypes');
                  return t('reports.weekly.filters.selectedCount', { count: taskTypeIds.length });
                },
              }}
              onChange={(e) => {
                const next = e.target.value as unknown as string[];
                const values = Array.isArray(next) ? next : [next];
                if (values.length === 0 || values.length === taskTypeOptions.length) {
                  setTaskTypeAll(true);
                  setTaskTypeIds([]);
                  return;
                }
                setTaskTypeAll(false);
                setTaskTypeIds(values);
              }}
              sx={reportFilterSelectSx}
            >
              {taskTypeOptions.map((option) => (
                <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>
                  <Checkbox size="small" checked={taskTypeAll || taskTypeIds.includes(option.id)} />
                  <ListItemText primary={option.name} primaryTypographyProps={{ fontSize: 13 }} />
                </MenuItem>
              ))}
            </TextField>
          </ReportFilter>
        </>
      )}
      actions={(
        <>
          <Button
            size="small"
            variant="action"
            sx={{ whiteSpace: 'nowrap' }}
            onClick={() => handleDownload('csv')}
            disabled={!isValidPeriod || totalRows === 0 || exportingFormat !== null}
          >
            {exportingFormat === 'csv' ? t('reports.weekly.actions.exporting') : t('reports.weekly.actions.exportCsv')}
          </Button>
          <Button
            size="small"
            variant="action"
            sx={{ whiteSpace: 'nowrap' }}
            onClick={() => handleDownload('xlsx')}
            disabled={!isValidPeriod || totalRows === 0 || exportingFormat !== null}
          >
            {exportingFormat === 'xlsx' ? t('reports.weekly.actions.exporting') : t('reports.weekly.actions.exportXlsx')}
          </Button>
        </>
      )}
    >
      <Stack spacing={1.5}>
        {!isValidPeriod && (
          <Alert severity="warning">{t('reports.weekly.messages.invalidPeriod')}</Alert>
        )}
        {reportErrorMessage && (
          <Alert severity="error">
            {reportErrorMessage}
          </Alert>
        )}
        {exportError && (
          <Alert severity="error">{exportError}</Alert>
        )}

        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography sx={{ fontSize: 12, fontWeight: 400, color: 'kanap.text.secondary' }}>
            {[
              shows('requests') ? summaryFor(t('reports.weekly.sections.requests'), requests) : null,
              shows('projects') ? summaryFor(t('reports.weekly.sections.projects'), projects) : null,
              shows('tasks') ? summaryFor(t('reports.weekly.sections.tasks'), tasks) : null,
            ]
              .filter(Boolean)
              .join('  |  ')}
          </Typography>
          {(isLoading || isFetching) && <CircularProgress size={14} />}
        </Stack>

        {groupBy === 'person' ? (
          <>
            <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
              <Trans
                t={t}
                i18nKey="reports.weekly.byPerson.note"
                components={{
                  link: (
                    <MLink component={RouterLink} to={periodReviewPath}>
                      {t('reports.weekly.title')}
                    </MLink>
                  ),
                }}
              />
            </Typography>

            {!hasPersonRows && (
              <Box sx={SECTION_SX}>
                <Typography sx={{ fontSize: 13, fontWeight: 400, color: 'kanap.text.secondary' }}>
                  {t('reports.weekly.byPerson.empty')}
                </Typography>
              </Box>
            )}

            {byPerson.teams.map((team) => {
              const teamGroupKey = `team:${team.teamId ?? 'no-team'}`;
              return (
                <Box key={teamGroupKey} sx={SECTION_SX}>
                  <WeeklyCollapsibleGroup
                    level="team"
                    label={team.teamName ?? t('reports.weekly.byPerson.noTeam')}
                    meta={personMeta(team.totals, team.totals.loggedDays)}
                    collapsed={collapsedPeople.includes(teamGroupKey)}
                    onToggle={() => togglePersonGroup(teamGroupKey)}
                  >
                    {team.members.map((member) => {
                      const personGroupKey = `person:${member.userId}`;
                      return (
                        <WeeklyCollapsibleGroup
                          key={personGroupKey}
                          level="person"
                          label={member.name}
                          after={
                            member.contributorRef && canOpenContributor ? (
                              <Typography
                                component={RouterLink}
                                to={`/portfolio/contributors/${member.contributorRef}`}
                                sx={{
                                  ...MONO_CELL_STYLE,
                                  color: 'kanap.text.tertiary',
                                  textDecoration: 'none',
                                  fontSize: 11,
                                  '&:hover': { textDecoration: 'underline' },
                                }}
                              >
                                {member.contributorRef}
                              </Typography>
                            ) : null
                          }
                          meta={personSummaryMeta(
                            {
                              created: member.created.length,
                              modified: member.modified.length,
                              closed: member.closed.length,
                            },
                            member.loggedDays,
                          )}
                          collapsed={collapsedPeople.includes(personGroupKey)}
                          onToggle={() => togglePersonGroup(personGroupKey)}
                        >
                          {personLists(member, personGroupKey)}
                        </WeeklyCollapsibleGroup>
                      );
                    })}
                  </WeeklyCollapsibleGroup>
                </Box>
              );
            })}

            <Box sx={SECTION_SX}>
              <WeeklyCollapsibleGroup
                level="team"
                label={t('reports.weekly.byPerson.unassigned')}
                meta={countsFor(byPerson.unassigned)}
                collapsed={collapsedPeople.includes('unassigned')}
                onToggle={() => togglePersonGroup('unassigned')}
              >
                {personLists(byPerson.unassigned, 'unassigned')}
              </WeeklyCollapsibleGroup>
            </Box>
          </>
        ) : (
          <>
        {shows('requests') && (
        <WeeklyReportSection
          title={t('reports.weekly.sections.requests')}
          counts={countsFor(requests)}
          collapsed={collapsedSections.requests}
          onToggle={() => toggleSection('requests')}
          empty={LIST_KEYS.every((listKey) => requests[listKey].length === 0)}
        >
          {LIST_KEYS.map((listKey) => (
            <WeeklyReportSubSection<WeeklyRequestRow>
              key={listKey}
              heading={subHeading(listKey, requests[listKey].length)}
              rows={requests[listKey]}
              columns={requestColumns[listKey]}
            />
          ))}
        </WeeklyReportSection>
        )}

        {shows('projects') && (
        <WeeklyReportSection
          title={t('reports.weekly.sections.projects')}
          counts={countsFor(projects)}
          collapsed={collapsedSections.projects}
          onToggle={() => toggleSection('projects')}
          empty={LIST_KEYS.every((listKey) => projects[listKey].length === 0)}
        >
          {LIST_KEYS.map((listKey) => (
            <WeeklyReportSubSection<WeeklyProjectRow>
              key={listKey}
              heading={subHeading(listKey, projects[listKey].length)}
              rows={projects[listKey]}
              columns={projectColumns[listKey]}
            />
          ))}
        </WeeklyReportSection>
        )}

        {shows('tasks') && (
        <WeeklyReportSection
          title={t('reports.weekly.sections.tasks')}
          counts={countsFor(tasks)}
          collapsed={collapsedSections.tasks}
          onToggle={() => toggleSection('tasks')}
          empty={LIST_KEYS.every((listKey) => tasks[listKey].length === 0)}
        >
          {LIST_KEYS.map((listKey) => (
            <WeeklyReportSubSection<WeeklyTaskRow>
              key={listKey}
              heading={subHeading(listKey, tasks[listKey].length)}
              rows={tasks[listKey]}
              columns={taskColumns[listKey]}
            />
          ))}
        </WeeklyReportSection>
        )}
          </>
        )}
      </Stack>
    </ReportLayout>
  );
}
