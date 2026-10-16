import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Checkbox,
  Dialog,
  FormControlLabel,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import ViewListIcon from '@mui/icons-material/ViewList';
import BarChartIcon from '@mui/icons-material/BarChart';
import CloseIcon from '@mui/icons-material/Close';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import ImageIcon from '@mui/icons-material/Image';
import { useTranslation } from 'react-i18next';
import { Gantt } from '@svar-ui/react-gantt';
import type { IApi } from '@svar-ui/react-gantt';
import '@svar-ui/react-gantt/style.css';
import api from '../../../api';
import LightModeIsland from '../../../components/LightModeIsland';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { useKanapDialogs } from '../../../components/design';
import { getDotColor, MILESTONE_STATUS_COLORS, PHASE_STATUS_COLORS } from '../../../utils/statusColors';
import { useLocale } from '../../../i18n/useLocale';
import { formatQuarterLabel, formatWeekLabel } from '../../../lib/isoWeek';
import { exportProjectTimelineGanttAsPng } from './project-timeline-png';

interface ProjectPhase {
  id: string;
  name: string;
  planned_start: string | null;
  planned_end: string | null;
  status: 'pending' | 'in_progress' | 'completed';
  sequence: number;
}

interface ProjectMilestone {
  id: string;
  name: string;
  target_date: string | null;
  status: string;
  phase_id: string | null;
}

type ZoomLevel = 'day' | 'week' | 'month' | 'quarter';

interface Props {
  projectId: string;
  phases: ProjectPhase[];
  milestones?: ProjectMilestone[];
  onUpdate: () => void;
  canManage: boolean;
  tableView: React.ReactNode; // The existing table view to render
}

// Bar colors derive from the centralized status palette (utils/statusColors.ts).
// The gantt renders inside a LightModeIsland, so the light-mode hexes apply.
const STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(PHASE_STATUS_COLORS).map(([status, mui]) => [status, getDotColor(mui, 'light')]),
);

const MILESTONE_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(MILESTONE_STATUS_COLORS).map(([status, mui]) => [status, getDotColor(mui, 'light')]),
);

// Shared chart container styling — used both inline and in the fullscreen dialog.
const GANTT_CONTAINER_SX = {
  height: '100%',
  minHeight: 0,
  overflow: 'hidden',
  // Constrain the SVAR Gantt root to the container so its internal chart area is
  // bounded and renders its own horizontal scrollbar (mirrors PortfolioGantt).
  '& .wx-gantt, & [class*="gantt"]': { height: '100%' },
  // Slightly smaller chart typography, matching the roadmap (PortfolioGantt) Gantt.
  '& .wx-table .wx-grid .wx-body .wx-cell': { fontSize: '12px' },
  '& .wx-table .wx-grid .wx-header .wx-cell': { fontSize: '11px' },
  '& .wx-scale .wx-cell': { fontSize: '12px' },
  '& .kanap-timeline-today-line': {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: '2px',
    backgroundColor: 'error.main',
    zIndex: 8,
    pointerEvents: 'none',
  },
  '& .today-highlight': {
    backgroundColor: 'rgba(66, 165, 245, 0.15)',
  },
  // Hide SVAR's default progress tooltip (shows "0", "0.5", etc.)
  '& .wx-gantt-tooltip': {
    display: 'none !important',
  },
} as const;

// Date formatting helpers — locale-aware via Intl
const formatMonthYear = (date: Date, locale: string): string =>
  date.toLocaleDateString(locale, { month: 'short', year: 'numeric' });

const formatMonthShort = (date: Date, locale: string): string =>
  date.toLocaleDateString(locale, { month: 'short' });

const formatYearOnly = (date: Date): string => String(date.getFullYear());

const formatDayNumber = (date: Date): string => String(date.getDate());

// Timezone-safe date formatting
const formatLocalDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Range-snapping helpers — snap to the top scale unit so the chart frames the data cleanly.
const startOfWeekMonday = (date: Date): Date => {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
};
const endOfWeekSunday = (date: Date): Date => {
  const d = startOfWeekMonday(date);
  d.setDate(d.getDate() + 6);
  return d;
};

export function ProjectTimeline({ projectId, phases, milestones = [], onUpdate, canManage, tableView }: Props) {
  const { t } = useTranslation(['portfolio', 'errors']);
  const dialogs = useKanapDialogs();
  const locale = useLocale();
  const [viewMode, setViewMode] = useState<'table' | 'gantt'>('table');
  const [zoom, setZoom] = useState<ZoomLevel>('week');
  const [showMilestones, setShowMilestones] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const apiRef = useRef<IApi | null>(null);

  // Resolve a usable date for each milestone: explicit target_date, else linked phase end.
  const milestoneItems = useMemo(() => (milestones
    .map((m) => {
      const dateStr = m.target_date || phases.find((p) => p.id === m.phase_id)?.planned_end || null;
      return dateStr ? { id: m.id, name: m.name, status: m.status, date: new Date(dateStr) } : null;
    })
    .filter(Boolean) as Array<{ id: string; name: string; status: string; date: Date }>),
  [milestones, phases]);

  // Transform phases (+ optional milestones) to Gantt format.
  const ganttTasks = useMemo(() => {
    const phaseTasks = phases
      .filter((p) => p.planned_start && p.planned_end)
      .sort((a, b) => a.sequence - b.sequence)
      .map((p) => ({
        id: p.id,
        text: p.name,
        start: new Date(p.planned_start!),
        end: new Date(p.planned_end!),
        progress: p.status === 'completed' ? 1 : p.status === 'in_progress' ? 0.5 : 0,
        type: 'task' as const,
        _status: p.status,
      }));

    if (!showMilestones || milestoneItems.length === 0) return phaseTasks;

    const milestoneTasks = milestoneItems.map((m) => ({
      id: `milestone-${m.id}`,
      text: m.name,
      start: m.date,
      end: m.date,
      progress: m.status === 'achieved' ? 1 : 0,
      type: 'milestone' as const,
      _status: m.status,
    }));

    return [...phaseTasks, ...milestoneTasks];
  }, [phases, milestoneItems, showMilestones]);

  // Controls (toggle, zoom, milestone checkbox) appear whenever there is anything plottable at all.
  const hasPlannablePhases = useMemo(
    () => phases.some((p) => p.planned_start && p.planned_end),
    [phases],
  );
  const hasContent = hasPlannablePhases || milestoneItems.length > 0;

  // Dynamic scales + cell width based on zoom level (ported from PortfolioGantt).
  const { scales, cellWidth } = useMemo(() => {
    switch (zoom) {
      case 'day':
        return {
          scales: [
            { unit: 'week', step: 1, format: (date: Date) => formatWeekLabel(t, date) },
            { unit: 'day', step: 1, format: formatDayNumber },
          ],
          cellWidth: 30,
        };
      case 'week':
        return {
          scales: [
            { unit: 'month', step: 1, format: (date: Date) => formatMonthYear(date, locale) },
            { unit: 'week', step: 1, format: (date: Date) => formatWeekLabel(t, date) },
          ],
          cellWidth: 40,
        };
      case 'month':
        return {
          scales: [
            { unit: 'quarter', step: 1, format: (date: Date) => formatQuarterLabel(t, date) },
            { unit: 'month', step: 1, format: (date: Date) => formatMonthShort(date, locale) },
          ],
          cellWidth: 84,
        };
      case 'quarter':
      default:
        return {
          scales: [
            { unit: 'year', step: 1, format: formatYearOnly },
            { unit: 'month', step: 1, format: (date: Date) => formatMonthShort(date, locale) },
          ],
          cellWidth: 56,
        };
    }
  }, [zoom, locale, t]);

  // Derive the visible range from phase + milestone dates, always folding in "today"
  // so the today marker is in range even for fully past/future-dated projects.
  const { startDate, endDate } = useMemo(() => {
    const times: number[] = [];
    phases.forEach((p) => {
      if (p.planned_start) times.push(new Date(p.planned_start).getTime());
      if (p.planned_end) times.push(new Date(p.planned_end).getTime());
    });
    if (showMilestones) milestoneItems.forEach((m) => times.push(m.date.getTime()));
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    times.push(today.getTime());

    const min = new Date(Math.min(...times));
    const max = new Date(Math.max(...times));

    let start: Date;
    let end: Date;
    switch (zoom) {
      case 'day':
        start = startOfWeekMonday(min);
        end = endOfWeekSunday(max);
        break;
      case 'week':
        start = new Date(min.getFullYear(), min.getMonth(), 1);
        end = new Date(max.getFullYear(), max.getMonth() + 1, 0);
        break;
      case 'month': {
        const sq = Math.floor(min.getMonth() / 3) * 3;
        const eq = Math.floor(max.getMonth() / 3) * 3;
        start = new Date(min.getFullYear(), sq, 1);
        end = new Date(max.getFullYear(), eq + 3, 0);
        break;
      }
      case 'quarter':
      default:
        start = new Date(min.getFullYear(), 0, 1);
        end = new Date(max.getFullYear(), 11, 31);
        break;
    }
    return { startDate: start, endDate: end };
  }, [phases, milestoneItems, showMilestones, zoom]);

  // Handle task update in Gantt (after drag ends) — single update path.
  const handleGanttUpdate = useCallback(async (ev: {
    id: string | number;
    task: { start?: Date; end?: Date };
    inProgress?: boolean;
  }) => {
    // Only process when drag is complete
    if (ev.inProgress || !canManage) return;

    const { id, task } = ev;
    // Milestone diamonds are display-only.
    if (String(id).startsWith('milestone-')) return;
    if (!task.start || !task.end) return;

    // Validate end >= start
    if (task.end < task.start) {
      await dialogs.alert(t('workspace.project.timeline.messages.invalidDateRange'));
      onUpdate();
      return;
    }
    try {
      await api.patch(`/portfolio/projects/${projectId}/phases/${id}`, {
        planned_start: formatLocalDate(task.start),
        planned_end: formatLocalDate(task.end),
      });
      onUpdate();
    } catch (e: any) {
      await dialogs.alert({
        message: getApiErrorMessage(e, t, t('workspace.project.timeline.messages.updatePhaseFailed')),
        intent: 'danger',
      });
      onUpdate();
    }
  }, [canManage, dialogs, onUpdate, projectId, t]);

  // --- Today marker (overlay line + scale highlight), ported from PortfolioGantt ---
  const getTodayChartPosition = useCallback(() => {
    const root = containerRef.current;
    const chart = root?.querySelector('.wx-chart') as HTMLDivElement | null;
    const area = root?.querySelector('.wx-area') as HTMLDivElement | null;
    if (!chart || !area) return null;

    const startMs = startDate.getTime();
    const endMs = endDate.getTime();
    const totalMs = endMs - startMs;
    if (!Number.isFinite(totalMs) || totalMs <= 0) return null;

    const state = apiRef.current?.getState();
    const totalWidth = area.scrollWidth || chart.scrollWidth || (state as any)?._scales?.width || 0;
    if (!Number.isFinite(totalWidth) || totalWidth <= 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const rawRatio = (today.getTime() - startMs) / totalMs;
    const ratio = Math.min(1, Math.max(0, rawRatio));

    return { chart, area, x: ratio * totalWidth, totalWidth, inRange: rawRatio >= 0 && rawRatio <= 1 };
  }, [startDate, endDate]);

  const syncTodayLine = useCallback(() => {
    const root = containerRef.current;
    const area = root?.querySelector('.wx-area') as HTMLDivElement | null;
    if (!area) return;

    let line = area.querySelector('.kanap-timeline-today-line') as HTMLDivElement | null;
    if (!line) {
      line = document.createElement('div');
      line.className = 'kanap-timeline-today-line';
      area.appendChild(line);
    }

    const position = getTodayChartPosition();
    if (!position || !position.inRange) {
      line.style.display = 'none';
      return;
    }
    line.style.display = 'block';
    line.style.left = `${Math.round(position.x)}px`;
  }, [getTodayChartPosition]);

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
      Math.max(0, totalWidth - viewportWidth),
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

  // init only captures the api ref and primes the today marker — no update logic here.
  const handleInit = useCallback((ganttApi: IApi) => {
    apiRef.current = ganttApi;
    window.setTimeout(syncTodayLine, 0);
    window.setTimeout(syncTodayLine, 140);
    window.setTimeout(scrollTodayIntoView, 0);
    window.setTimeout(scrollTodayIntoView, 140);
  }, [scrollTodayIntoView, syncTodayLine]);

  // Keep the line synchronized on reflow (zoom / data / resize changes).
  useEffect(() => {
    if (viewMode !== 'gantt') return undefined;
    const timers: number[] = [];
    [80, 220, 420].forEach((delay) => {
      timers.push(window.setTimeout(syncTodayLine, delay));
      if (apiRef.current) timers.push(window.setTimeout(scrollTodayIntoView, delay + 30));
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
      timers.forEach((timer) => window.clearTimeout(timer));
      observer?.disconnect();
    };
  }, [viewMode, zoom, ganttTasks.length, scrollTodayIntoView, syncTodayLine]);

  // Custom task template for phase bars (status colors) and milestone diamonds.
  const taskTemplate = useCallback(({ data }: { data: any }) => {
    if (!data) return null;

    if (data.type === 'milestone') {
      const color = MILESTONE_COLORS[data._status] || MILESTONE_COLORS.pending;
      return (
        <div
          title={data.text}
          style={{ width: '16px', height: '16px', backgroundColor: color, transform: 'rotate(45deg)', margin: '0 auto' }}
        />
      );
    }

    const status = data._status || 'pending';
    const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
    return (
      <div
        style={{
          backgroundColor: color,
          height: '100%',
          borderRadius: '4px',
          display: 'flex',
          alignItems: 'center',
          paddingLeft: '8px',
          color: '#fff',
          fontSize: '11px',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {data.text}
      </div>
    );
  }, []);

  // Export the chart as PNG by redrawing the current rows over the displayed
  // range (period + milestone setting), independent of the on-screen viewport.
  const handleExportPng = useCallback(async () => {
    if (ganttTasks.length === 0) return;
    const rows = ganttTasks.map((task) => ({
      id: String(task.id),
      text: task.text,
      start: task.start,
      end: task.end,
      type: task.type,
      color: task.type === 'milestone'
        ? (MILESTONE_COLORS[(task as any)._status] || MILESTONE_COLORS.pending)
        : (STATUS_COLORS[(task as any)._status] || STATUS_COLORS.pending),
    }));
    try {
      await exportProjectTimelineGanttAsPng({
        rows,
        rangeStart: startDate,
        rangeEnd: endDate,
        locale,
        fileName: 'project-timeline',
      });
    } catch (e: any) {
      await dialogs.alert({
        message: getApiErrorMessage(e, t, t('workspace.project.timeline.messages.exportFailed', { defaultValue: 'Failed to export the chart.' })),
        intent: 'danger',
      });
    }
  }, [ganttTasks, startDate, endDate, locale, dialogs, t]);

  const renderGanttSurface = (attachRef: boolean) => {
    if (ganttTasks.length === 0) {
      return (
        <Box sx={{ p: 4, textAlign: 'center', color: 'text.secondary' }}>
          <Typography variant="body1">{t('workspace.project.timeline.states.noPlannedPhases')}</Typography>
          <Typography variant="body2">
            {t('workspace.project.timeline.states.noPlannedPhasesHelp')}
          </Typography>
        </Box>
      );
    }
    return (
      <Box ref={attachRef ? containerRef : undefined} sx={GANTT_CONTAINER_SX}>
        <Gantt
          tasks={ganttTasks}
          scales={scales}
          start={startDate}
          end={endDate}
          cellWidth={cellWidth}
          cellHeight={38}
          autoScale={false}
          columns={[
            // No flexgrow: a growing grid column squeezes the chart to a sliver and
            // hides its horizontal scroll. Fixed width keeps the chart usable (mirrors
            // PortfolioGantt).
            { id: 'text', header: t('workspace.project.fields.phase'), width: 200 },
          ]}
          highlightTime={highlightTime}
          taskTemplate={taskTemplate}
          readonly={!canManage}
          onupdatetask={handleGanttUpdate}
          init={handleInit}
        />
      </Box>
    );
  };

  return (
    <Box>
      {/* Controls — visible whenever there is anything plottable */}
      {hasContent && (
        <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <ToggleButtonGroup
            value={viewMode}
            exclusive
            onChange={(_, v) => v && setViewMode(v)}
            size="small"
          >
            <ToggleButton value="table">
              <ViewListIcon sx={{ mr: 0.5 }} fontSize="small" />
              {t('workspace.project.timeline.views.table')}
            </ToggleButton>
            <ToggleButton value="gantt">
              <BarChartIcon sx={{ mr: 0.5 }} fontSize="small" />
              {t('workspace.project.timeline.views.gantt')}
            </ToggleButton>
          </ToggleButtonGroup>

          {viewMode === 'gantt' && (
            <>
              <ToggleButtonGroup
                value={zoom}
                exclusive
                onChange={(_, v) => v && setZoom(v)}
                size="small"
              >
                <ToggleButton value="day">{t('workspace.project.timeline.zoom.day', { defaultValue: 'Day' })}</ToggleButton>
                <ToggleButton value="week">{t('workspace.project.timeline.zoom.week', { defaultValue: 'Week' })}</ToggleButton>
                <ToggleButton value="month">{t('workspace.project.timeline.zoom.month', { defaultValue: 'Month' })}</ToggleButton>
                <ToggleButton value="quarter">{t('workspace.project.timeline.zoom.quarter', { defaultValue: 'Quarter' })}</ToggleButton>
              </ToggleButtonGroup>

              <FormControlLabel
                control={(
                  <Checkbox
                    size="small"
                    checked={showMilestones}
                    onChange={(e) => setShowMilestones(e.target.checked)}
                  />
                )}
                label={t('workspace.project.timeline.actions.showMilestones', { defaultValue: 'Show milestones' })}
                sx={{ '& .MuiFormControlLabel-label': { fontSize: 13 } }}
              />

              {ganttTasks.length > 0 && (
                <Box sx={{ ml: 'auto', display: 'flex', gap: 0.5 }}>
                  <Tooltip title={t('workspace.project.timeline.actions.exportPng', { defaultValue: 'Export as image' })}>
                    <IconButton size="small" onClick={handleExportPng}>
                      <ImageIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                  <Tooltip title={t('workspace.project.timeline.actions.fullscreen', { defaultValue: 'Fullscreen' })}>
                    <IconButton size="small" onClick={() => setFullscreen(true)}>
                      <FullscreenIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}
            </>
          )}
        </Box>
      )}

      {/* Table View */}
      {viewMode === 'table' && tableView}

      {/* Gantt View */}
      {viewMode === 'gantt' && (
        <LightModeIsland sx={{ p: 0 }}>
          <Box sx={{ height: 400 }}>
            {renderGanttSurface(!fullscreen)}
          </Box>
        </LightModeIsland>
      )}

      {/* Fullscreen Gantt — same chart at the current period and display settings. */}
      <Dialog open={fullscreen} onClose={() => setFullscreen(false)} fullScreen>
        <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
          <Box sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 2,
            py: 1,
            borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
          })}
          >
            <Typography sx={{ fontSize: 16, fontWeight: 500, flex: 1 }}>
              {t('workspace.project.timeline.views.gantt')}
            </Typography>
            <Tooltip title={t('workspace.project.timeline.actions.exportPng', { defaultValue: 'Export as image' })}>
              <IconButton size="small" onClick={handleExportPng}>
                <ImageIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('common:buttons.close', { defaultValue: 'Close' })}>
              <IconButton size="small" onClick={() => setFullscreen(false)}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <LightModeIsland sx={{ p: 0, flex: 1, minHeight: 0 }}>
            <Box sx={{ height: '100%' }}>
              {renderGanttSurface(fullscreen)}
            </Box>
          </LightModeIsland>
        </Box>
      </Dialog>
    </Box>
  );
}
