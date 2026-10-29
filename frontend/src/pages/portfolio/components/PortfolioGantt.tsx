import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gantt } from '@svar-ui/react-gantt';
import type { ITask, IApi } from '@svar-ui/react-gantt';
import { Box, Typography, useTheme } from '@mui/material';
import { useTranslation } from 'react-i18next';
import '@svar-ui/react-gantt/style.css';
import api from '../../../api';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { getDotColor, MILESTONE_STATUS_COLORS, PROJECT_STATUS_COLORS } from '../../../utils/statusColors';
import { computeInactiveSegments, formatInactiveTooltip } from './roadmap-inactive-segments';
import type { InactiveSegment } from './roadmap-inactive-segments';
import { useLocale } from '../../../i18n/useLocale';
import { formatQuarterLabel, formatWeekLabel } from '../../../lib/isoWeek';
import { useKanapDialogs } from '../../../components/design';

interface GanttProject {
  id: string;
  name: string;
  status: string;
  category_id: string | null;
  historical_start?: string | null;
  is_reservation?: boolean;
  reservation_reason?: 'not_recalculated' | 'external_blocker';
  planned_start: string | null;
  planned_end: string | null;
  execution_progress: number;
  active_week_starts?: string[];
  on_hold_ranges?: Array<{ from: string; to: string }>;
  full_planned_start?: string | null;
  full_planned_end?: string | null;
  focus_contributor_name?: string | null;
  focus_contributor_active_start?: string | null;
  focus_contributor_active_end?: string | null;
}

interface ProjectDependency {
  id: string;
  project_id: string;
  depends_on_project_id: string;
  dependency_type: string;
}

interface ProjectMilestone {
  id: string;
  project_id: string;
  name: string;
  target_date: string;
  status: string;
  project_name: string;
}

interface Props {
  projects: GanttProject[];
  dependencies: ProjectDependency[];
  milestones?: ProjectMilestone[];
  onUpdate?: () => void;
  onProjectClick?: (projectId: string) => void;
  onProjectPinStart?: (projectId: string, startWeek: string) => Promise<void> | void;
  months?: number;
  monthOffset?: number; // How many months to offset from current month (negative = past, positive = future)
  readOnly?: boolean;
  /** Double-click opens the project. The roadmap chart turns this off. Locking the dates does not. */
  openOnDoubleClick?: boolean;
}

// Bar colors derive from the centralized status palette (utils/statusColors.ts)
// so the gantt matches the status dots used everywhere else in the app.

// SVAR link types: e2s = end-to-start (finish-to-start)
const DEPENDENCY_TYPE_MAP: Record<string, 'e2s' | 's2s' | 'e2e' | 's2e'> = {
  blocks: 'e2s',
};

// Date formatting helpers — locale-aware via Intl
const formatMonthYear = (date: Date, locale: string): string => {
  return date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });
};

const formatMonthShort = (date: Date, locale: string): string => {
  return date.toLocaleDateString(locale, { month: 'short' });
};

const formatYearOnly = (date: Date): string => {
  return String(date.getFullYear());
};

const formatDayNumber = (date: Date): string => {
  return String(date.getDate());
};

const formatDateShort = (date: Date): string => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}`;
};

// CSS class for weekends and today
const dayStyle = (date: Date): string => {
  const today = new Date();
  const isToday = date.getDate() === today.getDate() &&
    date.getMonth() === today.getMonth() &&
    date.getFullYear() === today.getFullYear();

  if (isToday) return 'today-cell';

  const day = date.getDay();
  return day === 0 || day === 6 ? 'weekend-day' : '';
};

// Timezone-safe date formatting
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getWeekStartMondayLocal = (date: Date): Date => {
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  const day = monday.getDay();
  const offset = (day + 6) % 7;
  monday.setDate(monday.getDate() - offset);
  return monday;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function PortfolioGantt({
  projects,
  dependencies,
  milestones = [],
  onUpdate,
  onProjectClick,
  onProjectPinStart,
  months = 3,
  monthOffset = 0,
  readOnly = false,
  openOnDoubleClick = true,
}: Props) {
  const { t } = useTranslation(['portfolio', 'errors']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const mode = useTheme().palette.mode;
  const projectStatusHex = useCallback(
    (status: string) => getDotColor(PROJECT_STATUS_COLORS[status] ?? 'default', mode),
    [mode],
  );
  const milestoneStatusHex = useCallback(
    (status: string) => getDotColor(MILESTONE_STATUS_COLORS[status] ?? MILESTONE_STATUS_COLORS.pending, mode),
    [mode],
  );
  const navigate = useNavigate();
  const apiRef = useRef<IApi | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [chartVersion, setChartVersion] = useState(0);
  const pinStartMode = readOnly && !!onProjectPinStart;
  const ganttReadOnly = readOnly && !pinStartMode;

  const resetRenderedChart = useCallback(() => {
    setChartVersion((current) => current + 1);
  }, []);

  // Calculate date range based on months and offset
  const { startDate, endDate } = useMemo(() => {
    const now = new Date();
    const pastMonths = Math.max(0, Math.round(months * 0.25));
    const start = new Date(now);
    // Keep roughly 25% of the range in the past around "today" when offset is 0.
    start.setMonth(start.getMonth() + monthOffset - pastMonths);
    start.setDate(1); // Start of month

    const end = new Date(start);
    // Exact window length: selected number of months
    end.setMonth(end.getMonth() + months);
    end.setDate(0); // End of previous month = last day of target month

    return { startDate: start, endDate: end };
  }, [months, monthOffset]);

  // Transform projects to SVAR Gantt format
  const tasks = useMemo(() => {
    const projectIds = new Set(projects.filter((p) => p.planned_start && p.planned_end).map(p => p.id));

    // Build set of project IDs that actually have milestones
    const projectsWithMilestones = new Set(
      milestones
        .filter((m) => projectIds.has(m.project_id))
        .map((m) => m.project_id)
    );

    const projectTasks = projects
      .filter((p) => p.planned_start && p.planned_end)
      .map((p) => {
        const start = new Date(p.planned_start!);
        const end = new Date(p.planned_end!);
        const isReservation = !!p.is_reservation;
        const historicalStart = p.historical_start ? new Date(p.historical_start) : null;
        const hasSleepLead = !isReservation && !!historicalStart && historicalStart.getTime() < start.getTime();
        const sleepLeadDays = hasSleepLead
          ? Math.max(0, Math.round((start.getTime() - historicalStart!.getTime()) / MS_PER_DAY))
          : 0;
        const activeSpanDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / MS_PER_DAY) + 1);

        const inactiveSegments = !isReservation && p.active_week_starts?.length
          ? computeInactiveSegments(
            p.planned_start!,
            p.planned_end!,
            p.active_week_starts,
            p.on_hold_ranges,
            p.historical_start,
          )
          : [];

        return {
          id: p.id,
          text: p.name,
          start,
          end,
          progress: (p.execution_progress || 0) / 100,
          type: 'task' as const,
          // Only expand projects that actually have milestones as children
          open: projectsWithMilestones.has(p.id),
          _status: p.status,
          _statusLabel: t(`statuses.project.${p.status}`, { defaultValue: p.status }),
          _progress: p.execution_progress || 0,
          _isProject: true,
          _isReservation: isReservation,
          _reservationReason: p.reservation_reason || null,
          _historicalStart: p.historical_start,
          _sleepLeadDays: sleepLeadDays,
          _activeSpanDays: activeSpanDays,
          _inactiveSegments: inactiveSegments,
          _fullPlannedStart: p.full_planned_start ?? p.planned_start,
          _fullPlannedEnd: p.full_planned_end ?? p.planned_end,
          _focusContributorName: p.focus_contributor_name ?? null,
          _focusContributorActiveStart: p.focus_contributor_active_start ?? null,
          _focusContributorActiveEnd: p.focus_contributor_active_end ?? null,
        };
      });

    // Only add milestones if there are any (to avoid SVAR tree parsing issues)
    if (milestones.length === 0) {
      return projectTasks;
    }

    // Add milestones as milestone-type tasks, grouped under their parent projects
    const milestoneTasks = milestones
      .filter((m) => projectIds.has(m.project_id)) // Only include milestones for visible projects
      .map((m) => ({
        id: `milestone-${m.id}`,
        text: m.name,
        start: new Date(m.target_date),
        end: new Date(m.target_date),
        progress: m.status === 'achieved' ? 1 : 0,
        type: 'milestone' as const,
        parent: m.project_id, // Group under parent project
        _status: m.status,
        _statusLabel: t(`planning.gantt.milestoneStatuses.${m.status}`, { defaultValue: m.status.charAt(0).toUpperCase() + m.status.slice(1) }),
        _progress: m.status === 'achieved' ? 100 : 0,
        _isProject: false,
        _projectId: m.project_id,
        _projectName: m.project_name,
      }));

    return [...projectTasks, ...milestoneTasks];
  }, [projects, milestones]);

  // Transform dependencies to SVAR Gantt links format
  const links = useMemo(() => {
    const taskIds = new Set(tasks.filter(t => t._isProject).map(t => t.id));
    return dependencies
      .filter(d => taskIds.has(d.project_id) && taskIds.has(d.depends_on_project_id))
      .map((d) => ({
        id: d.id,
        source: d.depends_on_project_id,
        target: d.project_id,
        type: DEPENDENCY_TYPE_MAP[d.dependency_type] ?? 'e2s',
      }));
  }, [dependencies, tasks]);

  // Dynamic scales based on time range
  const scales = useMemo(() => {
    if (months <= 1) {
      return [
        { unit: 'week', step: 1, format: (date: Date) => formatWeekLabel(t, date) },
        { unit: 'day', step: 1, format: formatDayNumber, css: dayStyle },
      ];
    }

    if (months <= 3) {
      return [
        { unit: 'month', step: 1, format: (date: Date) => formatMonthYear(date, locale) },
        { unit: 'week', step: 1, format: (date: Date) => formatWeekLabel(t, date) },
      ];
    }

    if (months <= 6) {
      return [
        { unit: 'quarter', step: 1, format: (date: Date) => formatQuarterLabel(t, date) },
        { unit: 'month', step: 1, format: (date: Date) => formatMonthShort(date, locale) },
      ];
    }

    return [
      { unit: 'year', step: 1, format: formatYearOnly },
      { unit: 'month', step: 1, format: (date: Date) => formatMonthShort(date, locale) },
    ];
  }, [locale, months, t]);

  // Use wider month cells at 6 months and denser month cells at 12 months.
  const cellWidth = useMemo(() => {
    if (months <= 1) return 30;
    if (months <= 3) return 40;
    if (months <= 6) return 84;
    return 56;
  }, [months]);

  // Columns configuration
  const columns = useMemo(() => [
    { id: 'text', header: t('planning.gantt.columnProject'), width: 320, resize: true, sort: true },
  ], [t]);

  // Compute today's pixel position on the chart timeline.
  // This is independent from SVAR markers so it works in week-scale mode too.
  const getTodayChartPosition = useCallback(() => {
    const root = containerRef.current;
    const chart = root?.querySelector('.wx-chart') as HTMLDivElement | null;
    const area = root?.querySelector('.wx-area') as HTMLDivElement | null;
    if (!chart || !area) return null;

    // Use selected range props as source of truth for ratio when time range changes.
    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    const totalMs = endMs - startMs;
    if (!Number.isFinite(totalMs) || totalMs <= 0) return null;

    const state = apiRef.current?.getState();
    const totalWidth = area.scrollWidth || chart.scrollWidth || state?._scales?.width || 0;
    if (!Number.isFinite(totalWidth) || totalWidth <= 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rawRatio = (today.getTime() - startMs) / totalMs;
    const ratio = Math.min(1, Math.max(0, rawRatio));

    return {
      chart,
      area,
      x: ratio * totalWidth,
      totalWidth,
      inRange: rawRatio >= 0 && rawRatio <= 1,
    };
  }, [startDate, endDate]);

  // Render/update a custom "today" line overlay in the chart DOM.
  const syncTodayLine = useCallback(() => {
    const root = containerRef.current;
    const chart = root?.querySelector('.wx-chart') as HTMLDivElement | null;
    const area = root?.querySelector('.wx-area') as HTMLDivElement | null;
    if (!chart || !area) return;

    // Cleanup stale line that may have been attached to the chart in older renders.
    const staleLine = chart.querySelector('.portfolio-today-line');
    if (staleLine) staleLine.remove();

    let line = area.querySelector('.portfolio-today-line') as HTMLDivElement | null;
    if (!line) {
      line = document.createElement('div');
      line.className = 'portfolio-today-line';
      area.appendChild(line);
    }

    // Remove legacy label if present to avoid overlapping scale headers.
    const label = chart.querySelector('.portfolio-today-label') as HTMLDivElement | null;
    if (label) label.remove();

    const position = getTodayChartPosition();
    if (!position || !position.inRange) {
      line.style.display = 'none';
      return;
    }

    const x = Math.round(position.x);
    line.style.display = 'block';
    line.style.left = `${x}px`;
  }, [getTodayChartPosition]);

  // Place today marker around 25% from the left side of the visible chart area
  const scrollTodayIntoView = useCallback(() => {
    const ganttApi = apiRef.current;
    if (!ganttApi) return;

    const position = getTodayChartPosition();
    if (!position) return;

    const { chart, x, totalWidth } = position;
    const viewportWidth = chart.clientWidth || 0;
    if (totalWidth <= 0 || viewportWidth <= 0) return;

    const targetLeft = Math.min(
      Math.max(0, x - viewportWidth * 0.25),
      Math.max(0, totalWidth - viewportWidth)
    );

    chart.scrollLeft = targetLeft;
    void ganttApi.exec('scroll-chart', { left: targetLeft });
    syncTodayLine();
  }, [getTodayChartPosition, syncTodayLine]);

  // Highlight today in scale cells
  const highlightTime = useCallback((date: Date, unit: 'day' | 'hour') => {
    if (unit !== 'day') return '';
    const today = new Date();
    const isToday = date.getDate() === today.getDate() &&
      date.getMonth() === today.getMonth() &&
      date.getFullYear() === today.getFullYear();
    return isToday ? 'today-highlight' : '';
  }, []);

  // Ref for storing onUpdate callback (to avoid stale closure in init)
  const onUpdateRef = useRef(onUpdate || (() => {}));
  onUpdateRef.current = onUpdate || (() => {});
  const onProjectPinStartRef = useRef(onProjectPinStart);
  onProjectPinStartRef.current = onProjectPinStart;
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const pinStartModeRef = useRef(pinStartMode);
  pinStartModeRef.current = pinStartMode;
  const openOnDoubleClickRef = useRef(openOnDoubleClick);
  openOnDoubleClickRef.current = openOnDoubleClick;

  // Init callback to set up all event handlers
  const handleInit = useCallback((ganttApi: IApi) => {
    apiRef.current = ganttApi;

    // Double-click opens the project. Pin-start mode stays on the roadmap chart.
    // A date lock (readOnly) does not block that opening.
    ganttApi.intercept('show-editor', (ev: { id: string | number }) => {
      if (!openOnDoubleClickRef.current || pinStartModeRef.current) return false;
      if (ev?.id) {
        const taskId = String(ev.id);
        // Check if it's a milestone or project
        if (taskId.startsWith('milestone-')) {
          const task = tasksRef.current.find(t => t.id === taskId) as any;
          if (task && task._projectId) {
            navigate(`/portfolio/projects/${task._projectId}/timeline`);
          }
        } else {
          navigate(`/portfolio/projects/${taskId}/summary`);
        }
      }
      return false; // Prevent default editor
    });

    // Handle task update (after drag) - use api.on for reliable event handling
    ganttApi.on('update-task', async (ev: { id: string | number; task: Partial<ITask>; inProgress?: boolean }) => {
      // Only process when drag is complete
      if (ev.inProgress) return;

      const taskId = String(ev.id);
      const currentTask = tasksRef.current.find((taskEntry) => String(taskEntry.id) === taskId) as (typeof tasks[number] | undefined);
      const isReservation = !!(currentTask && '_isReservation' in currentTask && currentTask._isReservation);
      const { task } = ev;

      // Don't allow milestone editing
      if (taskId.startsWith('milestone-')) {
        if (pinStartModeRef.current) resetRenderedChart();
        return;
      }

      if (!task.start) {
        if (pinStartModeRef.current) resetRenderedChart();
        return;
      }

      if (pinStartModeRef.current) {
        const pinStartHandler = onProjectPinStartRef.current;
        if (isReservation || !pinStartHandler) {
          resetRenderedChart();
          return;
        }
        const startWeek = formatLocalDate(getWeekStartMondayLocal(new Date(task.start)));
        const currentStartWeek = currentTask?.start
          ? formatLocalDate(getWeekStartMondayLocal(new Date(currentTask.start)))
          : null;
        if (currentStartWeek === startWeek) {
          resetRenderedChart();
          return;
        }
        try {
          await pinStartHandler(taskId, startWeek);
        } catch {
          resetRenderedChart();
        }
        return;
      }

      if (readOnlyRef.current || !task.end) return;

      // Validate end >= start
      if (new Date(task.end) < new Date(task.start)) {
        await dialogs.alert(t('workspace.project.timeline.messages.invalidDateRange'));
        onUpdateRef.current?.();
        return;
      }

      try {
        await api.patch(`/portfolio/projects/${taskId}`, {
          planned_start: formatLocalDate(new Date(task.start)),
          planned_end: formatLocalDate(new Date(task.end)),
        });
        onUpdateRef.current?.();
      } catch (e: any) {
        await dialogs.alert({
          message: getApiErrorMessage(e, t, t('workspace.project.timeline.messages.updatePhaseFailed')),
          intent: 'danger',
        });
        onUpdateRef.current?.();
      }
    });
    // Ensure line is drawn after chart mounts.
    window.setTimeout(syncTodayLine, 0);
    window.setTimeout(syncTodayLine, 140);

    // Initial positioning: keep today visible by default when monthOffset points to current period
    if (monthOffset === 0) {
      window.setTimeout(scrollTodayIntoView, 0);
      window.setTimeout(scrollTodayIntoView, 140);
    }
  }, [
    monthOffset,
    dialogs,
    navigate,
    resetRenderedChart,
    scrollTodayIntoView,
    syncTodayLine,
  ]);

  // Keep line synchronized when the chart reflows (resize / range changes / data changes).
  useEffect(() => {
    const timers: number[] = [];
    const passes = [80, 220, 420];
    passes.forEach((delay) => {
      timers.push(window.setTimeout(syncTodayLine, delay));
      if (monthOffset === 0 && apiRef.current) {
        timers.push(window.setTimeout(scrollTodayIntoView, delay + 30));
      }
    });

    const root = containerRef.current;
    const chart = root?.querySelector('.wx-chart') as HTMLDivElement | null;
    const area = root?.querySelector('.wx-area') as HTMLDivElement | null;
    const observer = typeof ResizeObserver !== 'undefined' && chart && area
      ? new ResizeObserver(() => syncTodayLine())
      : null;

    if (observer && chart && area) {
      observer.observe(chart);
      observer.observe(area);
    }

    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      observer?.disconnect();
    };
  }, [monthOffset, months, tasks.length, scrollTodayIntoView, syncTodayLine]);

  // Custom task template with progress bar and status colors
  const taskTemplate = useCallback(({ data }: { data: any }) => {
    if (!data) return null;

    const status = data._status || 'planned';
    const isReservationTask = !!data._isReservation;
    const color = data.type === 'milestone'
      ? milestoneStatusHex(status)
      : (isReservationTask ? '#607d8b' : projectStatusHex(status));
    const progress = Math.round((data.progress || 0) * 100);

    const na = t('planning.gantt.tooltip.na');

    if (data.type === 'milestone') {
      const tooltip = `${data.text}\n${t('planning.gantt.tooltip.project')}: ${data._projectName || na}\n${t('planning.gantt.tooltip.status')}: ${data._statusLabel || data._status}\n${t('planning.gantt.tooltip.date')}: ${data.start ? formatDateShort(new Date(data.start)) : na}`;
      return (
        <div
          title={tooltip}
          style={{
            width: '16px',
            height: '16px',
            backgroundColor: color,
            transform: 'rotate(45deg)',
            margin: '0 auto',
          }}
        />
      );
    }

    const startStr = data.start ? formatDateShort(new Date(data.start)) : na;
    const endStr = data.end ? formatDateShort(new Date(data.end)) : na;
    const isReservation = !!data._isReservation;
    const sleepLeadDays = Number(data._sleepLeadDays || 0);
    const activeSpanDays = Math.max(1, Number(data._activeSpanDays || 1));
    const hasSleepLead = !isReservation && sleepLeadDays > 0;
    const leadRatio = hasSleepLead ? Math.min(3, sleepLeadDays / activeSpanDays) : 0;
    const leadPct = hasSleepLead ? Math.max(8, leadRatio * 100) : 0;
    const historicalStartStr = data._historicalStart
      ? formatDateShort(new Date(data._historicalStart))
      : null;
    const reservationReason = data._reservationReason
      ? t(`planning.gantt.reservationReasons.${data._reservationReason}`, { defaultValue: data._reservationReason })
      : null;
    const sleepWeeks = hasSleepLead ? Math.max(1, Math.round(sleepLeadDays / 7)) : 0;
    const inactiveSegments: InactiveSegment[] = data._inactiveSegments || [];
    const inactiveTooltipPart = inactiveSegments.length > 0 ? `\n${formatInactiveTooltip(inactiveSegments)}` : '';
    const fullStartStr = data._fullPlannedStart ? formatDateShort(new Date(data._fullPlannedStart)) : null;
    const fullEndStr = data._fullPlannedEnd ? formatDateShort(new Date(data._fullPlannedEnd)) : null;
    const contributorWindowPart = data._focusContributorName && data._focusContributorActiveStart && data._focusContributorActiveEnd
      ? `\n${t('planning.gantt.tooltip.contributor')}: ${data._focusContributorName}\n${t('planning.gantt.tooltip.contributorActive')}: ${formatDateShort(new Date(data._focusContributorActiveStart))} - ${formatDateShort(new Date(data._focusContributorActiveEnd))}${fullStartStr && fullEndStr && (fullStartStr !== startStr || fullEndStr !== endStr) ? `\n${t('planning.gantt.tooltip.projectWindow')}: ${fullStartStr} - ${fullEndStr}` : ''}`
      : '';
    const interactionHint = [
      pinStartMode && !isReservation ? t('planning.gantt.tooltip.dragToPin') : null,
      !isReservation && onProjectClick ? t('planning.gantt.tooltip.clickForExplanation') : null,
    ]
      .filter((value): value is string => !!value)
      .map((value) => `\n${value}`)
      .join('');
    const tooltip = `${data.text}\n${t('planning.gantt.tooltip.status')}: ${data._statusLabel || data._status}\n${t('planning.gantt.tooltip.progress')}: ${progress}%\n${t('planning.gantt.tooltip.start')}: ${startStr}\n${t('planning.gantt.tooltip.end')}: ${endStr}${contributorWindowPart}${isReservation ? `\n${t('planning.gantt.tooltip.typeCapacityReservation')}${reservationReason ? `\n${t('planning.gantt.tooltip.reason')}: ${reservationReason}` : ''}` : ''}${hasSleepLead && historicalStartStr ? `\n${t('planning.gantt.tooltip.historicalStart')}: ${historicalStartStr}\n${t('planning.gantt.tooltip.paused', { count: sleepWeeks })}` : ''}${inactiveTooltipPart}${interactionHint}`;

    // Compute overlay positions for inactive segments as percentages of the bar
    const barStartMs = data.start ? new Date(data.start).getTime() : 0;
    const barEndMs = data.end ? new Date(data.end).getTime() : 0;
    const barSpanMs = barEndMs - barStartMs;
    const segmentOverlays = !isReservation && barSpanMs > 0 ? inactiveSegments.map((seg, idx) => {
      const segStart = new Date(`${seg.from}T00:00:00Z`).getTime();
      const segEnd = new Date(`${seg.to}T00:00:00Z`).getTime();
      const clippedStart = Math.max(segStart, barStartMs);
      const clippedEnd = Math.min(segEnd, barEndMs);
      if (clippedEnd < clippedStart) return null;
      const leftPct = ((clippedStart - barStartMs) / barSpanMs) * 100;
      const widthPct = ((clippedEnd - clippedStart) / barSpanMs) * 100;
      return { type: seg.type, leftPct, widthPct, key: idx };
    }).filter(Boolean) as Array<{ type: 'gap' | 'on_hold'; leftPct: number; widthPct: number; key: number }> : [];

    return (
      <div
        title={tooltip}
        onClick={(event) => {
          if (!data._isProject || isReservation || !onProjectClick) return;
          event.stopPropagation();
          onProjectClick(String(data.id));
        }}
        style={{
          position: 'relative',
          height: '100%',
          overflow: 'visible',
          cursor: data._isProject && !isReservation && pinStartMode
            ? 'grab'
            : (data._isProject && onProjectClick ? 'pointer' : 'default'),
        }}
      >
        {hasSleepLead && (
          <>
            <div
              style={{
                position: 'absolute',
                left: `-${leadPct}%`,
                top: '50%',
                width: `${leadPct}%`,
                borderTop: `1px dashed ${color}`,
                opacity: 0.45,
                transform: 'translateY(-50%)',
                pointerEvents: 'none',
              }}
            />
            <div
              style={{
                position: 'absolute',
                left: `-${leadPct}%`,
                top: '50%',
                width: '6px',
                height: '6px',
                borderRadius: '50%',
                backgroundColor: color,
                opacity: 0.55,
                transform: 'translate(-50%, -50%)',
                pointerEvents: 'none',
              }}
            />
          </>
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            borderRadius: '4px',
            background: isReservation
              ? 'repeating-linear-gradient(135deg, rgba(96, 125, 139, 0.18) 0, rgba(96, 125, 139, 0.18) 6px, rgba(96, 125, 139, 0.08) 6px, rgba(96, 125, 139, 0.08) 12px)'
              : `${color}40`,
            overflow: 'hidden',
            border: isReservation ? '1px dashed #78909c' : `1px solid ${color}`,
          }}
        >
          {!isReservation && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${progress}%`,
                backgroundColor: color,
              }}
            />
          )}
          {/* Inactive segment overlays */}
          {segmentOverlays.map((overlay) => (
            <div
              key={overlay.key}
              style={{
                position: 'absolute',
                left: `${overlay.leftPct}%`,
                top: 0,
                bottom: 0,
                width: `${overlay.widthPct}%`,
                background: overlay.type === 'gap'
                  ? `repeating-linear-gradient(90deg, rgba(200,200,200,0.35) 0, rgba(200,200,200,0.35) 3px, transparent 3px, transparent 6px)`
                  : `repeating-linear-gradient(135deg, rgba(158,158,158,0.4) 0, rgba(158,158,158,0.4) 4px, rgba(158,158,158,0.15) 4px, rgba(158,158,158,0.15) 8px)`,
                pointerEvents: 'none',
              }}
            />
          ))}
          {/* Text overlay */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              height: '100%',
              paddingLeft: '8px',
              color: '#333',
              fontSize: '11px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              textShadow: '0 0 3px #fff, 0 0 3px #fff',
            }}
          >
            {data.text}
          </div>
        </div>
      </div>
    );
  }, [onProjectClick, pinStartMode, milestoneStatusHex, projectStatusHex]);

  // Empty state
  if (tasks.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
        <Typography variant="h6">{t('workspace.project.timeline.states.noPlannedProjects')}</Typography>
        <Typography variant="body2">
          {t('workspace.project.timeline.states.noPlannedProjectsHelp')}
        </Typography>
      </Box>
    );
  }

  return (
    <Box
      ref={containerRef}
      sx={{
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        '& .wx-gantt, & [class*="gantt"]': { height: '100%' },
        '& .wx-table .wx-grid .wx-body .wx-cell': {
          fontSize: '12px',
        },
        '& .wx-table .wx-grid .wx-header .wx-cell': {
          fontSize: '11px',
        },
        // Header cells are all divs: `:first-of-type` is `:first-child` without Emotion's warning.
        '& .wx-table .wx-grid .wx-header .wx-cell:first-of-type': {
          fontSize: '12px',
          fontWeight: 500,
        },
        '& .wx-scale .wx-cell': {
          fontSize: '12px',
        },
        // Weekend day styling
        '& .weekend-day': {
          backgroundColor: 'rgba(0, 0, 0, 0.04)',
        },
        // Today cell styling (for day view)
        '& .today-cell': {
          backgroundColor: 'rgba(66, 165, 245, 0.15)',
          borderLeft: '2px solid #42a5f5',
        },
        // Today highlight styling (from highlightTime)
        '& .today-highlight': {
          backgroundColor: 'rgba(66, 165, 245, 0.15)',
        },
        '& .portfolio-today-line': {
          position: 'absolute',
          top: 0,
          bottom: 0,
          width: '2px',
          backgroundColor: 'error.main',
          zIndex: 8,
          pointerEvents: 'none',
        },
        // Hide SVAR's default progress tooltip (shows "0", "0.5", etc.)
        '& .wx-gantt-tooltip': {
          display: 'none !important',
        },
        ...(pinStartMode ? {
          '& .wx-progress-marker, & .wx-link, & .wx-delete-button': {
            display: 'none !important',
          },
        } : {}),
        // The chart sets a resize cursor on the bar. A date lock keeps the arrow.
        ...(ganttReadOnly ? {
          '& .wx-bar': { cursor: 'default !important' },
        } : {}),
      }}
    >
      <Gantt
        key={chartVersion}
        tasks={tasks}
        links={links}
        readonly={ganttReadOnly}
        scales={scales}
        start={startDate}
        end={endDate}
        cellWidth={cellWidth}
        cellHeight={38}
        columns={columns}
        autoScale={false}
        highlightTime={highlightTime}
        taskTemplate={taskTemplate}
        init={handleInit}
      />
    </Box>
  );
}
