import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Drawer,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  Link,
  MenuItem,
  Paper,
  Select,
  SelectChangeEvent,
  Slider,
  Stack,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import ImageIcon from '@mui/icons-material/Image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../../api';
import { useAuth } from '../../../auth/AuthContext';
import { KanapDialog, StatusDot } from '../../../components/design';
import LightModeIsland from '../../../components/LightModeIsland';
import DateEUField from '../../../components/fields/DateEUField';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useLocale } from '../../../i18n/useLocale';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { PortfolioGantt } from './PortfolioGantt';
import { computeInactiveSegments } from './roadmap-inactive-segments';
import {
  buildExplanationTexts,
  formatReasonLabel,
  formatRoadmapConstraint,
  formatRoadmapDate,
  formatRoadmapDays,
  formatRoadmapText,
  type RoadmapText,
} from './roadmap-text';
import { getDotColor, PROJECT_STATUS_COLORS } from '../../../utils/statusColors';
import { kanapPalette, modeVal } from '../../tasks/theme/taskDetailTokens';
import ExportFormatButton from '../../../components/csv/ExportFormatButton';
import type { ExportFormat } from '../../../components/csv/exportFormat';
import { downloadServerExport } from '../../../components/csv/serverExport';
import {
  buildRoadmapOccupation,
  isoWeekParts,
  type ContributorOccupationGroup,
  type TeamOccupationRow,
} from '../roadmapOccupation';

type RoadmapTab = 'schedule' | 'bottlenecks' | 'occupation';
type OccupationView = 'contributor' | 'team';
type SchedulingMode = 'independent' | 'collaborative';
type CapacityConstraintMode = 'full' | 'it_only';
type GanttContributionVisibility = 'primary_only' | 'all';
type ScheduleConstraint =
  | { type: 'pin_start'; startWeek: string }
  | { type: 'pin_window'; startWeek: string; endWeek: string }
  | { type: 'not_before'; startWeek: string };

type OnHoldRange = {
  from: string;
  to: string;
};

type ScheduledProject = {
  projectId: string;
  projectName: string;
  status: string;
  schedulingMode: SchedulingMode;
  categoryId: string | null;
  sourceId: string | null;
  streamId: string | null;
  executionProgress: number;
  priorityScore: number | null;
  plannedStart: string;
  historicalStart: string | null;
  plannedEnd: string;
  durationWeeks: number;
  remainingEffortDays: number;
  blockerProjectIds: string[];
  contributorLoads: Array<{
    contributorId: string;
    contributorName: string;
    days: number;
  }>;
  activeWeekStarts: string[];
  onHoldRanges?: OnHoldRange[];
};

type ReservationReason = 'not_recalculated' | 'external_blocker';

type ReservationProject = {
  projectId: string;
  projectName: string;
  status: string;
  schedulingMode: SchedulingMode;
  categoryId: string | null;
  sourceId: string | null;
  streamId: string | null;
  executionProgress: number;
  plannedStart: string;
  plannedEnd: string;
  reason: ReservationReason;
  contributorLoads: Array<{
    contributorId: string;
    contributorName: string;
    days: number;
  }>;
};

type UnschedulableProject = {
  projectId: string;
  projectName: string;
  status: string;
  schedulingMode: SchedulingMode;
  reason: string;
  details?: string;
  detailsText?: RoadmapText;
};

type ScenarioProjectOverride = {
  projectId: string;
  schedulingMode?: SchedulingMode;
  constraint?: ScheduleConstraint | null;
};

type ScenarioDraftProject = {
  scenarioProjectId: string;
  sourceRequestId: string | null;
  name: string;
  status: 'planned';
  schedulingMode: SchedulingMode;
  priorityScore: number | null;
  estimatedEffortIt: number;
  estimatedEffortBusiness: number;
  executionProgress: number;
  categoryId: string | null;
  sourceId: string | null;
  streamId: string | null;
  blockerProjectIds: string[];
  itLeadId: string | null;
  businessLeadId: string | null;
  itAllocationMode: 'auto' | 'manual';
  businessAllocationMode: 'auto' | 'manual';
  itAllocations: Array<{ userId: string; allocationPct: number }>;
  businessAllocations: Array<{ userId: string; allocationPct: number }>;
  constraint?: ScheduleConstraint | null;
};

type RoadmapScenario = {
  projectOverrides: ScenarioProjectOverride[];
  scenarioProjects: ScenarioDraftProject[];
};

type RoadmapItemRef = {
  projectId: string | null;
  scenarioProjectId: string | null;
  sourceRequestId: string | null;
  isScenarioProject: boolean;
};

type ExplanationReasonEntry = {
  kind:
    | 'dependency'
    | 'reservation'
    | 'no_free_slot'
    | 'no_effective_capacity'
    | 'below_minimum_start_threshold'
    | 'constraint_conflict'
    | 'fixed_plan'
    | 'unschedulable_blocker';
  label: string;
  labelText: RoadmapText;
  projectId: string | null;
  scenarioProjectId: string | null;
  fromWeek: string | null;
  toWeek: string | null;
};

type ExplanationContributorEntry = {
  contributorId: string;
  contributorName: string;
  weeklyCapacity: number;
  reservedLoad: number | null;
  activeProjectCount: number | null;
  reason: 'slot' | 'capacity' | 'collaborative_bottleneck' | 'reservation';
};

type ProjectExplanation = {
  itemRef: RoadmapItemRef;
  summary: string;
  summaryText: RoadmapText;
  classification: 'scheduled' | 'reservation' | 'unschedulable';
  schedulingMode: SchedulingMode;
  earliestEligibleWeek: string | null;
  actualStartWeek: string | null;
  derivedFromConstraint: boolean;
  activeConstraint: ScheduleConstraint | null;
  startReason:
    | 'historical_start'
    | 'dependency_release'
    | 'capacity_available'
    | 'constraint_pin_start'
    | 'constraint_pin_window'
    | 'constraint_not_before'
    | 'fixed_reservation'
    | 'unscheduled';
  blockerReasons: ExplanationReasonEntry[];
  limitingContributors: ExplanationContributorEntry[];
  finalReason: string | null;
  finalReasonText: RoadmapText | null;
};

type ScenarioWarning = {
  severity: 'info' | 'warning' | 'error';
  code:
    | 'constraint_infeasible'
    | 'expired_fixed_plan'
    | 'scenario_project_incomplete'
    | 'scenario_project_missing_capacity'
    | 'hidden_business_only_project'
    | 'apply_skips_scenario_projects';
  itemRef: RoadmapItemRef | null;
  message: string;
  messageText: RoadmapText;
};

type RoadmapImpactSummary = {
  delayedProjects: number;
  acceleratedProjects: number;
  unchangedProjects: number;
  newlyUnschedulableProjects: number;
  newlyScheduledProjects: number;
  roadmapEndDeltaDays: number | null;
};

type BottleneckEntry = {
  contributorId: string;
  contributorName: string;
  impactDays: number;
};

type BottleneckProjectContribution = {
  projectId: string;
  projectName: string;
  plannedStart: string;
  plannedEnd: string;
  totalContributionDays: number;
  spentDays: number;
};

type OccupationEntry = {
  contributorId: string;
  contributorName: string;
  teamId: string | null;
  teamName: string | null;
  week: string;
  effortDays: number;
  capacityDays: number | null;
  occupationPct: number | null;
  projects: Array<{ projectId: string; projectName: string; days: number }>;
};

type TeamOccupationEntry = {
  teamId: string | null;
  teamName: string | null;
  week: string;
  effortDays: number;
  capacityDays: number | null;
  occupationPct: number | null;
};

type ContributorProjectWeekDetail = {
  week: string;
  projectDays: number;
  capacityDays: number | null;
  occupationPct: number | null;
  totalWeekEffortDays: number;
};

type ContributorProjectTimeline = {
  contributorId: string;
  contributorName: string;
  projectId: string;
  projectName: string;
  weekDetails: ContributorProjectWeekDetail[];
  totalProjectDays: number;
  activeWeekStarts: string[];
  activeStart: string;
  activeEnd: string;
  contributionShare: number | null;
  averageDaysPerWeek: number;
  significance: 'primary' | 'support';
};

type TeamProjectTimeline = {
  teamId: string;
  teamName: string;
  projectId: string;
  projectName: string;
  weekDetails: ContributorProjectWeekDetail[];
  totalProjectDays: number;
  activeWeekStarts: string[];
  activeStart: string;
  activeEnd: string;
  contributionShare: number | null;
  averageDaysPerWeek: number;
  significance: 'primary' | 'support';
};

type Category = {
  id: string;
  name: string;
};

type RoadmapResponse = {
  schedule: ScheduledProject[];
  reservations: ReservationProject[];
  unschedulable: UnschedulableProject[];
  explanations: ProjectExplanation[];
  scenarioWarnings: ScenarioWarning[];
  impactSummary: RoadmapImpactSummary | null;
  bottlenecks: BottleneckEntry[];
  occupation: OccupationEntry[];
  teamOccupation: TeamOccupationEntry[];
  roadmapEndDate: string | null;
  diagnostics: {
    modeLabel: string;
    runDurationMs: number;
    candidateProjects: number;
    scheduledProjects: number;
    reservationProjects: number;
    reservationByReason: {
      not_recalculated: number;
      external_blocker: number;
    };
    hiddenCapacityProjects: number;
    frozenProjects: number;
    unschedulableProjects: number;
    sensitivityReruns: number;
    sensitivityTruncated: boolean;
  };
};

const STATUS_OPTIONS = ['waiting_list', 'planned', 'in_progress', 'in_testing'];
const SCHEDULING_MODES: SchedulingMode[] = ['independent', 'collaborative'];

function SchedulingModeControl({
  value,
  disabled,
  canEdit,
  onChange,
}: {
  value: SchedulingMode;
  disabled: boolean;
  canEdit: boolean;
  onChange: (next: SchedulingMode) => void;
}) {
  const { t } = useTranslation('portfolio');
  if (!canEdit) {
    return <>{t(`planning.roadmap.schedulingModes.${value}`)}</>;
  }
  return (
    <Select
      size="small"
      value={value}
      onChange={(event) => onChange(event.target.value as SchedulingMode)}
      disabled={disabled}
      SelectDisplayProps={{ 'aria-label': t('planning.roadmap.columns.scheduling') }}
      sx={{ minWidth: 150 }}
    >
      {SCHEDULING_MODES.map((option) => (
        <MenuItem key={option} value={option}>
          {t(`planning.roadmap.schedulingModes.${option}`)}
        </MenuItem>
      ))}
    </Select>
  );
}

// Bar colors derive from the centralized status palette (utils/statusColors.ts).
// The canvas renders inside a LightModeIsland, so the light-mode hexes apply.
const GANTT_STATUS_COLORS: Record<string, string> = Object.fromEntries(
  Object.entries(PROJECT_STATUS_COLORS).map(([status, mui]) => [status, getDotColor(mui, 'light')]),
);

const CONTRIBUTOR_PRIMARY_MIN_TOTAL_DAYS = 5;
const CONTRIBUTOR_PRIMARY_MIN_SHARE = 0.15;
const CONTRIBUTOR_PRIMARY_MIN_WEEKS = 3;
const CONTRIBUTOR_PRIMARY_MIN_AVG_DAYS = 0.5;

const TEAM_PRIMARY_MIN_TOTAL_DAYS = 10;
const TEAM_PRIMARY_MIN_SHARE = 0.2;
const TEAM_PRIMARY_MIN_WEEKS = 3;
const TEAM_PRIMARY_MIN_AVG_DAYS = 1;

const getTodayYmd = (): string => {
  return new Date().toISOString().slice(0, 10);
};

const getExplanationKey = (itemRef: RoadmapItemRef): string | null => {
  return itemRef.projectId ?? itemRef.scenarioProjectId ?? itemRef.sourceRequestId;
};

const addDaysUtcYmd = (ymd: string, days: number): string => {
  const dt = new Date(`${ymd}T00:00:00Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
};

const classifyTimelineSignificance = (
  scope: 'contributor' | 'team',
  totalProjectDays: number,
  contributionShare: number | null,
  activeWeeks: number,
  averageDaysPerWeek: number,
): 'primary' | 'support' => {
  if (scope === 'contributor') {
    return (
      totalProjectDays >= CONTRIBUTOR_PRIMARY_MIN_TOTAL_DAYS
      || (contributionShare ?? 0) >= CONTRIBUTOR_PRIMARY_MIN_SHARE
      || (activeWeeks >= CONTRIBUTOR_PRIMARY_MIN_WEEKS && averageDaysPerWeek >= CONTRIBUTOR_PRIMARY_MIN_AVG_DAYS)
    )
      ? 'primary'
      : 'support';
  }

  return (
    totalProjectDays >= TEAM_PRIMARY_MIN_TOTAL_DAYS
    || (contributionShare ?? 0) >= TEAM_PRIMARY_MIN_SHARE
    || (activeWeeks >= TEAM_PRIMARY_MIN_WEEKS && averageDaysPerWeek >= TEAM_PRIMARY_MIN_AVG_DAYS)
  )
    ? 'primary'
    : 'support';
};

const hasContributorLoads = (
  project: ScheduledProject | ReservationProject | UnschedulableProject | null,
): project is ScheduledProject | ReservationProject => !!project && 'contributorLoads' in project;

const getOccupationCellBackground = (
  occupationPct: number | null | undefined,
  tone: 'contributor' | 'team',
): string | undefined => {
  if (occupationPct == null || !Number.isFinite(occupationPct)) return undefined;
  const intensity = Math.min(1, Math.max(0, occupationPct) / 120);
  if (tone === 'contributor') {
    return `rgba(255, 152, 0, ${0.08 + intensity * 0.22})`;
  }
  return `rgba(33, 150, 243, ${0.08 + intensity * 0.22})`;
};

const calcMonthsSpan = (schedule: Array<{ plannedEnd: string }>): number => {
  const now = new Date();
  if (schedule.length === 0) return 6;

  const endDates = schedule.map((p) => new Date(`${p.plannedEnd}T00:00:00`));
  const latestEnd = new Date(Math.max(...endDates.map((d) => d.getTime())));

  // Keep the same 25/75 past-future behavior as the main planning page (monthOffset=0),
  // while extending the visible window enough to include the latest scheduled completion.
  let months = 3;
  for (let i = 0; i < 240; i += 1) {
    const pastMonths = Math.max(0, Math.round(months * 0.25));
    const start = new Date(now);
    start.setMonth(start.getMonth() - pastMonths);
    start.setDate(1);

    const end = new Date(start);
    end.setMonth(end.getMonth() + months);
    end.setDate(0);
    if (end.getTime() >= latestEnd.getTime()) {
      return Math.max(3, months);
    }
    months += 1;
  }

  return 240;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

const parseYmdUtc = (value: string): Date => {
  const [year, month, day] = value.split('-').map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
};

const dayDiffUtc = (start: Date, end: Date): number => {
  return Math.round((end.getTime() - start.getTime()) / MS_PER_DAY);
};

const getMonthLabel = (date: Date, locale: string): string => {
  const month = date.toLocaleString(locale, { month: 'short', timeZone: 'UTC' });
  return `${month} ${date.getUTCFullYear()}`;
};

const drawRoundedRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) => {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
};

type GanttRoadmapItem = {
  projectId: string;
  projectName: string;
  status: string;
  executionProgress: number;
  plannedStart: string;
  plannedEnd: string;
  historicalStart?: string | null;
  isReservation?: boolean;
  reservationReason?: ReservationReason;
  activeWeekStarts?: string[];
  onHoldRanges?: OnHoldRange[];
};

const exportRoadmapGanttAsPng = async (
  projects: GanttRoadmapItem[],
  months: number,
  monthOffset: number,
  locale: string,
  fileName: string,
  projectHeader: string,
): Promise<void> => {
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const pastMonths = Math.max(0, Math.round(months * 0.25));
  const rangeStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + monthOffset - pastMonths, 1));
  const rangeEnd = new Date(Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth() + months, 0));
  const totalDays = Math.max(1, dayDiffUtc(rangeStart, rangeEnd) + 1);

  const rows = Math.max(1, projects.length);
  const headerHeight = 40;
  const rowHeight = 34;
  const leftWidth = 360;
  const chartWidthTarget = Math.min(2600, Math.max(900, totalDays * 3));
  const pxPerDay = chartWidthTarget / totalDays;
  const chartWidth = Math.round(totalDays * pxPerDay);
  const canvasWidth = leftWidth + chartWidth;
  const canvasHeight = headerHeight + (rows * rowHeight) + 1;

  const scale = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth * scale;
  canvas.height = canvasHeight * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.fillStyle = '#f7f8fb';
  ctx.fillRect(0, 0, leftWidth, canvasHeight);
  ctx.fillStyle = '#fafbff';
  ctx.fillRect(leftWidth, 0, chartWidth, headerHeight);

  ctx.strokeStyle = '#dfe3eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(leftWidth + 0.5, 0);
  ctx.lineTo(leftWidth + 0.5, canvasHeight);
  ctx.stroke();

  // Month header.
  ctx.font = '500 12px Arial, sans-serif';
  ctx.fillStyle = '#334155';
  for (let cursor = new Date(rangeStart); cursor.getTime() <= rangeEnd.getTime();) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1));
    const nextMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
    const monthEnd = new Date(Math.min(nextMonth.getTime() - MS_PER_DAY, rangeEnd.getTime()));

    const startOffset = dayDiffUtc(rangeStart, monthStart);
    const endOffset = dayDiffUtc(rangeStart, monthEnd) + 1;
    const startX = leftWidth + (Math.max(0, startOffset) * pxPerDay);
    const endX = leftWidth + (Math.min(totalDays, endOffset) * pxPerDay);
    if (endX > startX) {
      ctx.beginPath();
      ctx.moveTo(Math.round(startX) + 0.5, 0);
      ctx.lineTo(Math.round(startX) + 0.5, canvasHeight);
      ctx.strokeStyle = '#e6e9ef';
      ctx.stroke();

      const label = getMonthLabel(monthStart, locale);
      const textWidth = ctx.measureText(label).width;
      const centerX = startX + ((endX - startX) / 2);
      ctx.fillText(label, Math.round(centerX - (textWidth / 2)), 24);
    }

    cursor = nextMonth;
  }

  ctx.strokeStyle = '#dfe3eb';
  ctx.beginPath();
  ctx.moveTo(0, headerHeight + 0.5);
  ctx.lineTo(canvasWidth, headerHeight + 0.5);
  ctx.stroke();

  ctx.font = '500 12px Arial, sans-serif';
  ctx.fillStyle = '#1f2937';
  ctx.fillText(projectHeader, 12, 24);

  // Rows + bars.
  projects.forEach((project, index) => {
    const rowY = headerHeight + (index * rowHeight);
    const isOdd = index % 2 === 1;
    if (isOdd) {
      ctx.fillStyle = '#fcfdff';
      ctx.fillRect(leftWidth, rowY, chartWidth, rowHeight);
    }

    ctx.strokeStyle = '#edf0f4';
    ctx.beginPath();
    ctx.moveTo(0, rowY + rowHeight + 0.5);
    ctx.lineTo(canvasWidth, rowY + rowHeight + 0.5);
    ctx.stroke();

    // Project name cell text with simple clipping.
    ctx.save();
    ctx.beginPath();
    ctx.rect(10, rowY + 4, leftWidth - 20, rowHeight - 8);
    ctx.clip();
    ctx.font = '500 12px Arial, sans-serif';
    ctx.fillStyle = '#334155';
    ctx.fillText(project.projectName, 12, rowY + 21);
    ctx.restore();

    const start = parseYmdUtc(project.plannedStart);
    const end = parseYmdUtc(project.plannedEnd);
    const startDayRaw = dayDiffUtc(rangeStart, start);
    const startDay = Math.max(0, startDayRaw);
    const endDay = Math.min(totalDays - 1, dayDiffUtc(rangeStart, end));
    if (endDay < 0 || startDay >= totalDays || endDay < startDay) return;

    const barX = leftWidth + (startDay * pxPerDay) + 1;
    const barWidth = Math.max(3, ((endDay - startDay + 1) * pxPerDay) - 2);
    const barY = rowY + 7;
    const barHeight = rowHeight - 14;
    const isReservation = !!project.isReservation;
    const color = isReservation ? '#607d8b' : (GANTT_STATUS_COLORS[project.status] || GANTT_STATUS_COLORS.planned);
    const progressRatio = Math.max(0, Math.min(1, project.executionProgress / 100));
    const historicalStart = project.historicalStart ? parseYmdUtc(project.historicalStart) : null;
    const hasHistoricalLead = !isReservation && !!historicalStart && historicalStart.getTime() < start.getTime();

    if (hasHistoricalLead) {
      const historicalDayRaw = dayDiffUtc(rangeStart, historicalStart!);
      const leadStartX = leftWidth + (Math.max(0, Math.min(totalDays, historicalDayRaw)) * pxPerDay);
      const leadEndX = leftWidth + (Math.max(0, Math.min(totalDays, startDayRaw)) * pxPerDay);
      if (leadEndX > leadStartX + 0.5) {
        const leadY = rowY + (rowHeight / 2) + 0.5;
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(leadStartX, leadY);
        ctx.lineTo(leadEndX, leadY);
        ctx.stroke();
        ctx.setLineDash([]);
        if (historicalDayRaw >= 0 && historicalDayRaw < totalDays) {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(leadStartX, leadY, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }
    }

    if (isReservation) {
      ctx.fillStyle = '#eceff1';
      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 4);
      ctx.fill();
      ctx.save();
      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 4);
      ctx.clip();
      ctx.strokeStyle = '#cfd8dc';
      ctx.lineWidth = 1;
      for (let x = barX - barHeight; x < barX + barWidth + barHeight; x += 7) {
        ctx.beginPath();
        ctx.moveTo(x, barY + barHeight);
        ctx.lineTo(x + barHeight, barY);
        ctx.stroke();
      }
      ctx.restore();
      ctx.strokeStyle = '#90a4ae';
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 4);
      ctx.stroke();
    } else {
      ctx.fillStyle = `${color}55`;
      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 4);
      ctx.fill();
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 4);
      ctx.stroke();

      if (progressRatio > 0) {
        ctx.fillStyle = color;
        drawRoundedRect(ctx, barX, barY, barWidth * progressRatio, barHeight, 4);
        ctx.fill();
      }

      // Inactive segment overlays
      if (project.activeWeekStarts?.length) {
        const segments = computeInactiveSegments(
          project.plannedStart,
          project.plannedEnd,
          project.activeWeekStarts,
          project.onHoldRanges,
          project.historicalStart,
        );
        const barStartMs = start.getTime();
        const barEndMs = end.getTime();
        const barSpanMs = barEndMs - barStartMs;
        if (barSpanMs > 0) {
          for (const seg of segments) {
            const segStartMs = parseYmdUtc(seg.from).getTime();
            const segEndMs = parseYmdUtc(seg.to).getTime();
            const clippedStart = Math.max(segStartMs, barStartMs);
            const clippedEnd = Math.min(segEndMs, barEndMs);
            if (clippedEnd < clippedStart) continue;
            const segX = barX + (barWidth * (clippedStart - barStartMs) / barSpanMs);
            const segW = barWidth * (clippedEnd - clippedStart) / barSpanMs;
            if (segW < 1) continue;

            ctx.save();
            drawRoundedRect(ctx, barX, barY, barWidth, barHeight, 4);
            ctx.clip();

            if (seg.type === 'on_hold') {
              // Diagonal hatch pattern for on-hold
              ctx.fillStyle = 'rgba(158, 158, 158, 0.25)';
              ctx.fillRect(segX, barY, segW, barHeight);
              ctx.strokeStyle = 'rgba(158, 158, 158, 0.45)';
              ctx.lineWidth = 1;
              for (let hx = segX - barHeight; hx < segX + segW + barHeight; hx += 6) {
                ctx.beginPath();
                ctx.moveTo(hx, barY + barHeight);
                ctx.lineTo(hx + barHeight, barY);
                ctx.stroke();
              }
            } else {
              // Dotted/lighter pattern for gaps
              ctx.fillStyle = 'rgba(200, 200, 200, 0.35)';
              ctx.fillRect(segX, barY, segW, barHeight);
              ctx.setLineDash([3, 3]);
              ctx.strokeStyle = 'rgba(160, 160, 160, 0.5)';
              ctx.lineWidth = 1;
              ctx.strokeRect(segX, barY, segW, barHeight);
              ctx.setLineDash([]);
            }
            ctx.restore();
          }
        }
      }
    }

    if (barWidth > 26) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(barX + 4, barY + 2, Math.max(0, barWidth - 8), barHeight - 4);
      ctx.clip();
      ctx.font = '500 11px Arial, sans-serif';
      ctx.fillStyle = '#111827';
      ctx.fillText(project.projectName, barX + 6, barY + barHeight - 6);
      ctx.restore();
    }
  });

  // Today line (limited to task rows area).
  const todayOffset = dayDiffUtc(rangeStart, today);
  if (todayOffset >= 0 && todayOffset < totalDays) {
    const x = leftWidth + (todayOffset * pxPerDay) + 0.5;
    ctx.strokeStyle = modeVal(kanapPalette.teal, 'light');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, headerHeight);
    ctx.lineTo(x, headerHeight + (rows * rowHeight));
    ctx.stroke();
  }

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG generation failed'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `${fileName}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
};

type OccupationExportData = {
  weekKeys: string[];
  contributorGroups: ContributorOccupationGroup[];
  teamRows: TeamOccupationRow[];
  contributorAverages: Map<string, number | null>;
  teamAverages: Map<string, number | null>;
  labels: {
    team: string;
    contributor: string;
    contributors: string;
    teams: string;
    average: string;
    avg: string;
    week: (week: string) => string;
    weekYear: (week: string, year: number) => string;
  };
};

const exportOccupationAsPng = async (
  data: OccupationExportData,
  view: OccupationView,
): Promise<void> => {
  const { weekKeys, contributorGroups, teamRows, contributorAverages, teamAverages, labels } = data;

  const weekHeaders = weekKeys.map((weekKey) => {
    const parts = isoWeekParts(weekKey);
    return labels.week(String(parts.week).padStart(2, '0'));
  });

  type FlatRow = { labels: string[]; values: (number | null)[] };
  const rows: FlatRow[] = [];
  const labelColCount = view === 'contributor' ? 2 : 1;
  const tone: 'contributor' | 'team' = view === 'contributor' ? 'contributor' : 'team';
  const averages = view === 'contributor' ? contributorAverages : teamAverages;

  if (view === 'contributor') {
    for (const group of contributorGroups) {
      for (const row of group.rows) {
        rows.push({
          labels: [group.teamName, row.contributorName],
          values: weekKeys.map((wk) => row.weekOccupation.get(wk) ?? null),
        });
      }
    }
  } else {
    for (const row of teamRows) {
      rows.push({
        labels: [row.teamName],
        values: weekKeys.map((wk) => row.weekOccupation.get(wk) ?? null),
      });
    }
  }

  // Add average row
  rows.push({
    labels: view === 'contributor' ? [labels.avg, ''] : [labels.avg],
    values: weekKeys.map((wk) => averages.get(wk) ?? null),
  });

  const cellH = 30;
  const headerH = 36;
  const labelColWidths = view === 'contributor' ? [160, 200] : [200];
  const dataCellW = 64;
  const totalLabelW = labelColWidths.reduce((a, b) => a + b, 0);
  const totalDataW = weekHeaders.length * dataCellW;
  const canvasW = totalLabelW + totalDataW;
  const canvasH = headerH + rows.length * cellH + 1;

  const scale = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
  const canvas = document.createElement('canvas');
  canvas.width = canvasW * scale;
  canvas.height = canvasH * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas context unavailable');
  ctx.scale(scale, scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Header
  ctx.fillStyle = '#f7f8fb';
  ctx.fillRect(0, 0, canvasW, headerH);
  ctx.font = '500 11px Arial, sans-serif';
  ctx.fillStyle = '#334155';
  let headerX = 0;
  const headerLabels = view === 'contributor' ? [labels.team, labels.contributor] : [labels.team];
  for (let i = 0; i < headerLabels.length; i++) {
    ctx.fillText(headerLabels[i], headerX + 6, headerH - 10);
    headerX += labelColWidths[i];
  }
  for (let i = 0; i < weekHeaders.length; i++) {
    const x = totalLabelW + i * dataCellW;
    const textW = ctx.measureText(weekHeaders[i]).width;
    ctx.fillText(weekHeaders[i], x + (dataCellW - textW) / 2, headerH - 10);
  }

  // Grid lines
  ctx.strokeStyle = '#dfe3eb';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, headerH + 0.5);
  ctx.lineTo(canvasW, headerH + 0.5);
  ctx.stroke();

  // Data rows
  ctx.font = '400 11px Arial, sans-serif';
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const y = headerH + r * cellH;
    const isAvgRow = r === rows.length - 1;

    if (isAvgRow) {
      ctx.fillStyle = '#f0f0f0';
      ctx.fillRect(0, y, canvasW, cellH);
    } else if (r % 2 === 1) {
      ctx.fillStyle = '#fcfdff';
      ctx.fillRect(0, y, canvasW, cellH);
    }

    // Label cells
    let lx = 0;
    for (let c = 0; c < labelColCount; c++) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(lx + 4, y + 2, labelColWidths[c] - 8, cellH - 4);
      ctx.clip();
      ctx.fillStyle = '#334155';
      ctx.font = isAvgRow ? '500 11px Arial, sans-serif' : '400 11px Arial, sans-serif';
      ctx.fillText(row.labels[c] || '', lx + 6, y + cellH - 10);
      ctx.restore();
      lx += labelColWidths[c];
    }

    // Data cells
    for (let c = 0; c < row.values.length; c++) {
      const val = row.values[c];
      const x = totalLabelW + c * dataCellW;

      // Background
      const bg = getOccupationCellBackground(val, tone);
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(x, y, dataCellW, cellH);
      }

      // Text
      const text = val != null ? `${val}%` : '-';
      ctx.font = isAvgRow ? '500 11px Arial, sans-serif' : '400 11px Arial, sans-serif';
      ctx.fillStyle = '#334155';
      const textW = ctx.measureText(text).width;
      ctx.fillText(text, x + (dataCellW - textW) / 2, y + cellH - 10);
    }

    // Row border
    ctx.strokeStyle = '#edf0f4';
    ctx.beginPath();
    ctx.moveTo(0, y + cellH + 0.5);
    ctx.lineTo(canvasW, y + cellH + 0.5);
    ctx.stroke();
  }

  await new Promise<void>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('PNG generation failed'));
        return;
      }
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `roadmap-occupation-${view}-${getTodayYmd()}.png`;
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      resolve();
    }, 'image/png');
  });
};

type Props = {
  onApplied?: () => void;
};

export default function RoadmapGenerator({ onApplied }: Props) {
  const mode = useTheme().palette.mode;
  const locale = useLocale();
  const { hasLevel } = useAuth();
  const canEditProjectDates = hasLevel('portfolio_projects', 'contributor');
  const { t } = useTranslation(['portfolio', 'common', 'ops']);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RoadmapTab>('schedule');
  const [occupationView, setOccupationView] = useState<OccupationView>('contributor');
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [startDate, setStartDate] = useState<string>(getTodayYmd());
  const [statuses, setStatuses] = useState<string[]>(['waiting_list', 'planned', 'in_progress', 'in_testing']);
  const [capacityMode, setCapacityMode] = useState<'theoretical' | 'historical'>('theoretical');
  const [capacityConstraintMode, setCapacityConstraintMode] = useState<CapacityConstraintMode>('full');
  const [parallelizationLimit, setParallelizationLimit] = useState<number>(1);
  const [optimizationMode, setOptimizationMode] = useState<'priority_focused' | 'completion_focused'>('priority_focused');
  const [includeAlreadyScheduled, setIncludeAlreadyScheduled] = useState(true);
  const [contextSwitchPenaltyPct, setContextSwitchPenaltyPct] = useState<number>(0.05);
  const [contextSwitchGrace, setContextSwitchGrace] = useState<number>(1);
  const [ganttCategoryId, setGanttCategoryId] = useState<string>('');
  const [showReservations, setShowReservations] = useState(true);
  const [expandedBottleneckIds, setExpandedBottleneckIds] = useState<Set<string>>(new Set());
  const [panelExpanded, setPanelExpanded] = useState(true);
  const [ganttContributorId, setGanttContributorId] = useState<string>('');
  const [ganttTeamId, setGanttTeamId] = useState<string>('');
  const [ganttSourceId, setGanttSourceId] = useState<string>('');
  const [ganttStreamId, setGanttStreamId] = useState<string>('');
  const [ganttContributionVisibility, setGanttContributionVisibility] = useState<GanttContributionVisibility>('primary_only');

  const [roadmapScenario, setRoadmapScenario] = useState<RoadmapScenario>({
    projectOverrides: [],
    scenarioProjects: [],
  });
  const [pinDialogProjectId, setPinDialogProjectId] = useState<string | null>(null);
  const [pinDialogProjectName, setPinDialogProjectName] = useState<string>('');
  const [pinDialogWeek, setPinDialogWeek] = useState<string>(startDate);
  const [response, setResponse] = useState<RoadmapResponse | null>(null);
  // The payload of the generation on screen: the occupation export sends it again, so the file holds the same tables.
  const responsePayloadRef = useRef<unknown>(null);
  const [selectedExplanationKey, setSelectedExplanationKey] = useState<string | null>(null);
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(new Set());
  const [scheduleSelectionPool, setScheduleSelectionPool] = useState<ScheduledProject[]>([]);
  const [savingSchedulingModeProjectIds, setSavingSchedulingModeProjectIds] = useState<Set<string>>(new Set());

  const { data: categories } = useQuery({
    queryKey: ['portfolio-categories'],
    queryFn: async () => {
      const res = await api.get('/portfolio/classification/categories');
      return (res.data || []) as Category[];
    },
  });

  const { data: sources } = useQuery({
    queryKey: ['portfolio-sources'],
    queryFn: async () => {
      const res = await api.get('/portfolio/classification/sources');
      return (res.data || []) as Category[];
    },
  });

  const { data: streams } = useQuery({
    queryKey: ['portfolio-streams'],
    queryFn: async () => {
      const res = await api.get('/portfolio/classification/streams');
      return (res.data || []) as Category[];
    },
  });

  const scheduledProjects = response?.schedule ?? [];
  const reservationProjects = response?.reservations ?? [];
  const filteredScheduledProjects = useMemo(
    () => (ganttCategoryId
      ? scheduledProjects.filter((project) => project.categoryId === ganttCategoryId)
      : scheduledProjects),
    [scheduledProjects, ganttCategoryId],
  );
  const filteredReservationProjects = useMemo(
    () => (ganttCategoryId
      ? reservationProjects.filter((project) => project.categoryId === ganttCategoryId)
      : reservationProjects),
    [reservationProjects, ganttCategoryId],
  );
  const scheduleRows = scheduleSelectionPool.length > 0 ? scheduleSelectionPool : scheduledProjects;
  const filteredProjectIds = useMemo(
    () => filteredScheduledProjects.map((project) => project.projectId),
    [filteredScheduledProjects],
  );
  const selectedVisibleScheduledProjects = useMemo(
    () => filteredScheduledProjects.filter((project) => selectedProjectIds.has(project.projectId)),
    [filteredScheduledProjects, selectedProjectIds],
  );
  const selectedSchedulableCount = selectedVisibleScheduledProjects.length;
  const scheduleRowsById = useMemo(
    () => new Map(scheduledProjects.map((project) => [project.projectId, project])),
    [scheduledProjects],
  );
  const reservationRowsById = useMemo(
    () => new Map(reservationProjects.map((project) => [project.projectId, project])),
    [reservationProjects],
  );
  const explanationByKey = useMemo(
    () => new Map(
      (response?.explanations ?? [])
        .map((explanation) => [getExplanationKey(explanation.itemRef), explanation] as const)
        .filter((entry): entry is [string, ProjectExplanation] => !!entry[0]),
    ),
    [response?.explanations],
  );
  const projectOverrideById = useMemo(
    () => new Map(roadmapScenario.projectOverrides.map((override) => [override.projectId, override] as const)),
    [roadmapScenario.projectOverrides],
  );
  const scenarioWarningsByProjectId = useMemo(() => {
    const map = new Map<string, ScenarioWarning[]>();
    for (const warning of response?.scenarioWarnings ?? []) {
      const key = getExplanationKey(warning.itemRef ?? {
        projectId: null,
        scenarioProjectId: null,
        sourceRequestId: null,
        isScenarioProject: false,
      });
      if (!key) continue;
      const list = map.get(key) ?? [];
      list.push(warning);
      map.set(key, list);
    }
    return map;
  }, [response?.scenarioWarnings]);
  const explanationSubjectByKey = useMemo(() => {
    const entries = [
      ...scheduledProjects.map((project) => [project.projectId, project.projectName] as const),
      ...reservationProjects.map((project) => [project.projectId, project.projectName] as const),
      ...(response?.unschedulable ?? []).map((project) => [project.projectId, project.projectName] as const),
    ];
    return new Map(entries);
  }, [reservationProjects, response?.unschedulable, scheduledProjects]);
  const selectedExplanation = selectedExplanationKey
    ? (explanationByKey.get(selectedExplanationKey) ?? null)
    : null;
  const selectedExplanationProject = selectedExplanationKey
    ? (
      scheduleRowsById.get(selectedExplanationKey)
      ?? reservationProjects.find((project) => project.projectId === selectedExplanationKey)
      ?? response?.unschedulable.find((project) => project.projectId === selectedExplanationKey)
      ?? null
    )
    : null;
  const selectedExplanationTitle = selectedExplanation
    ? (explanationSubjectByKey.get(getExplanationKey(selectedExplanation.itemRef) || '') ?? t('planning.roadmap.explain.overline'))
    : t('planning.roadmap.explain.overline');
  const selectedExplanationTexts = selectedExplanation
    ? buildExplanationTexts(t, locale, selectedExplanation)
    : null;
  const formatWarning = (warning: ScenarioWarning): string => formatRoadmapText(t, locale, warning.messageText);
  const allRowsSelected = filteredProjectIds.length > 0
    && filteredProjectIds.every((projectId) => selectedProjectIds.has(projectId));

  const ganttCategoryOptions = useMemo(() => {
    const categoryNameById = new Map((categories ?? []).map((category) => [category.id, category.name]));
    const options = Array.from(
      new Set(
        scheduledProjects
          .map((project) => project.categoryId)
          .concat(reservationProjects.map((project) => project.categoryId))
          .filter((categoryId): categoryId is string => !!categoryId),
      ),
    )
      .sort((left, right) => {
        const leftLabel = categoryNameById.get(left) || left;
        const rightLabel = categoryNameById.get(right) || right;
        return leftLabel.localeCompare(rightLabel);
      })
      .map((categoryId) => ({
        id: categoryId,
        name: categoryNameById.get(categoryId) || categoryId,
      }));
    if (ganttCategoryId && !options.some((option) => option.id === ganttCategoryId)) {
      options.unshift({
        id: ganttCategoryId,
        name: categoryNameById.get(ganttCategoryId) || ganttCategoryId,
      });
    }
    return options;
  }, [categories, ganttCategoryId, reservationProjects, scheduledProjects]);

  const ganttContributorOptions = useMemo(() => {
    const contributorNameById = new Map<string, string>();
    const allProjects = [...scheduledProjects, ...reservationProjects];
    for (const project of allProjects) {
      for (const load of project.contributorLoads) {
        contributorNameById.set(load.contributorId, load.contributorName);
      }
    }
    return Array.from(contributorNameById.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [reservationProjects, scheduledProjects]);
  const ganttContributorNameById = useMemo(
    () => new Map(ganttContributorOptions.map((option) => [option.id, option.name])),
    [ganttContributorOptions],
  );

  const contributorProjectTimelines = useMemo(() => {
    const byContributor = new Map<string, Map<string, ContributorProjectTimeline>>();
    const getProjectTotalDays = (projectId: string): number => {
      const scheduled = scheduleRowsById.get(projectId);
      if (scheduled) {
        return scheduled.contributorLoads.reduce((sum, load) => sum + load.days, 0);
      }
      const reservation = reservationRowsById.get(projectId);
      if (reservation) {
        return reservation.contributorLoads.reduce((sum, load) => sum + load.days, 0);
      }
      return 0;
    };

    for (const entry of response?.occupation ?? []) {
      const byProject = byContributor.get(entry.contributorId) ?? new Map<string, ContributorProjectTimeline>();
      for (const project of entry.projects) {
        if ((project.days ?? 0) <= 0) continue;
        const existing = byProject.get(project.projectId) ?? {
          contributorId: entry.contributorId,
          contributorName: entry.contributorName,
          projectId: project.projectId,
          projectName: project.projectName,
          weekDetails: [],
          totalProjectDays: 0,
          activeWeekStarts: [],
          activeStart: entry.week,
          activeEnd: addDaysUtcYmd(entry.week, 4),
          contributionShare: null,
          averageDaysPerWeek: 0,
          significance: 'primary',
        };
        existing.weekDetails.push({
          week: entry.week,
          projectDays: project.days,
          capacityDays: entry.capacityDays,
          occupationPct: entry.occupationPct,
          totalWeekEffortDays: entry.effortDays,
        });
        existing.totalProjectDays += project.days;
        byProject.set(project.projectId, existing);
      }
      byContributor.set(entry.contributorId, byProject);
    }

    for (const byProject of byContributor.values()) {
      for (const timeline of byProject.values()) {
        timeline.weekDetails.sort((a, b) => a.week.localeCompare(b.week));
        timeline.activeWeekStarts = timeline.weekDetails.map((detail) => detail.week);
        timeline.activeStart = timeline.activeWeekStarts[0];
        timeline.activeEnd = addDaysUtcYmd(timeline.activeWeekStarts[timeline.activeWeekStarts.length - 1], 4);
        timeline.averageDaysPerWeek = timeline.activeWeekStarts.length > 0
          ? timeline.totalProjectDays / timeline.activeWeekStarts.length
          : 0;
        const projectTotalDays = getProjectTotalDays(timeline.projectId);
        timeline.contributionShare = projectTotalDays > 0
          ? timeline.totalProjectDays / projectTotalDays
          : null;
        timeline.significance = classifyTimelineSignificance(
          'contributor',
          timeline.totalProjectDays,
          timeline.contributionShare,
          timeline.activeWeekStarts.length,
          timeline.averageDaysPerWeek,
        );
      }
    }

    return byContributor;
  }, [reservationRowsById, response?.occupation, scheduleRowsById]);

  const contributorFilteredScheduled = useMemo(
    () => (ganttContributorId
      ? filteredScheduledProjects.filter((project) =>
        project.contributorLoads.some((load) => load.contributorId === ganttContributorId))
      : filteredScheduledProjects),
    [filteredScheduledProjects, ganttContributorId],
  );
  const contributorFilteredReservations = useMemo(
    () => (ganttContributorId
      ? filteredReservationProjects.filter((project) =>
        project.contributorLoads.some((load) => load.contributorId === ganttContributorId))
      : filteredReservationProjects),
    [filteredReservationProjects, ganttContributorId],
  );

  const contributorTeamMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const entry of response?.occupation ?? []) {
      if (entry.teamId) map.set(entry.contributorId, entry.teamId);
    }
    return map;
  }, [response?.occupation]);

  const ganttTeamOptions = useMemo(() => {
    const teamNameById = new Map<string, string>();
    for (const entry of response?.occupation ?? []) {
      if (entry.teamId) teamNameById.set(entry.teamId, entry.teamName || entry.teamId);
    }
    return Array.from(teamNameById.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [response?.occupation]);
  const ganttTeamNameById = useMemo(
    () => new Map(ganttTeamOptions.map((option) => [option.id, option.name])),
    [ganttTeamOptions],
  );
  const teamProjectTimelines = useMemo(() => {
    const byTeam = new Map<string, Map<string, TeamProjectTimeline>>();
    const getProjectTotalDays = (projectId: string): number => {
      const scheduled = scheduleRowsById.get(projectId);
      if (scheduled) {
        return scheduled.contributorLoads.reduce((sum, load) => sum + load.days, 0);
      }
      const reservation = reservationRowsById.get(projectId);
      if (reservation) {
        return reservation.contributorLoads.reduce((sum, load) => sum + load.days, 0);
      }
      return 0;
    };

    for (const entry of response?.occupation ?? []) {
      if (!entry.teamId) continue;
      const byProject = byTeam.get(entry.teamId) ?? new Map<string, TeamProjectTimeline>();
      for (const project of entry.projects) {
        if ((project.days ?? 0) <= 0) continue;
        const existing = byProject.get(project.projectId) ?? {
          teamId: entry.teamId,
          teamName: entry.teamName || t('planning.roadmap.occupation.noTeam'),
          projectId: project.projectId,
          projectName: project.projectName,
          weekDetails: [],
          totalProjectDays: 0,
          activeWeekStarts: [],
          activeStart: entry.week,
          activeEnd: addDaysUtcYmd(entry.week, 4),
          contributionShare: null,
          averageDaysPerWeek: 0,
          significance: 'primary',
        };
        const weekDetail = existing.weekDetails.find((detail) => detail.week === entry.week);
        if (weekDetail) {
          weekDetail.projectDays += project.days;
          weekDetail.capacityDays = (weekDetail.capacityDays ?? 0) + (entry.capacityDays ?? 0);
          weekDetail.totalWeekEffortDays += entry.effortDays;
          weekDetail.occupationPct = weekDetail.capacityDays && weekDetail.capacityDays > 0
            ? (weekDetail.totalWeekEffortDays / weekDetail.capacityDays) * 100
            : null;
        } else {
          existing.weekDetails.push({
            week: entry.week,
            projectDays: project.days,
            capacityDays: entry.capacityDays,
            occupationPct: entry.occupationPct,
            totalWeekEffortDays: entry.effortDays,
          });
        }
        existing.totalProjectDays += project.days;
        byProject.set(project.projectId, existing);
      }
      byTeam.set(entry.teamId, byProject);
    }

    for (const byProject of byTeam.values()) {
      for (const timeline of byProject.values()) {
        timeline.weekDetails.sort((a, b) => a.week.localeCompare(b.week));
        timeline.activeWeekStarts = timeline.weekDetails.map((detail) => detail.week);
        timeline.activeStart = timeline.activeWeekStarts[0];
        timeline.activeEnd = addDaysUtcYmd(timeline.activeWeekStarts[timeline.activeWeekStarts.length - 1], 4);
        timeline.averageDaysPerWeek = timeline.activeWeekStarts.length > 0
          ? timeline.totalProjectDays / timeline.activeWeekStarts.length
          : 0;
        const projectTotalDays = getProjectTotalDays(timeline.projectId);
        timeline.contributionShare = projectTotalDays > 0
          ? timeline.totalProjectDays / projectTotalDays
          : null;
        timeline.significance = classifyTimelineSignificance(
          'team',
          timeline.totalProjectDays,
          timeline.contributionShare,
          timeline.activeWeekStarts.length,
          timeline.averageDaysPerWeek,
        );
      }
    }

    return byTeam;
  }, [reservationRowsById, response?.occupation, scheduleRowsById]);
  const activeGanttFocusScope = ganttContributorId
    ? 'contributor'
    : (ganttTeamId ? 'team' : null);
  const activeGanttFocusTimelines = useMemo(() => {
    if (ganttContributorId) {
      return contributorProjectTimelines.get(ganttContributorId) ?? new Map<string, ContributorProjectTimeline>();
    }
    if (ganttTeamId) {
      return teamProjectTimelines.get(ganttTeamId) ?? new Map<string, TeamProjectTimeline>();
    }
    return null;
  }, [contributorProjectTimelines, ganttContributorId, ganttTeamId, teamProjectTimelines]);
  const selectedContributorTimeline = selectedExplanationKey && ganttContributorId
    ? (contributorProjectTimelines.get(ganttContributorId)?.get(selectedExplanationKey) ?? null)
    : null;
  const selectedTeamTimeline = selectedExplanationKey && !ganttContributorId && ganttTeamId
    ? (teamProjectTimelines.get(ganttTeamId)?.get(selectedExplanationKey) ?? null)
    : null;
  const selectedFocusTimeline = selectedContributorTimeline ?? selectedTeamTimeline;
  const activeConstraintOverrides = useMemo(
    () => roadmapScenario.projectOverrides.filter((override) => !!override.constraint),
    [roadmapScenario.projectOverrides],
  );
  const selectedExplanationWarnings = useMemo(
    () => (selectedExplanationKey ? (scenarioWarningsByProjectId.get(selectedExplanationKey) ?? []) : []),
    [scenarioWarningsByProjectId, selectedExplanationKey],
  );

  const teamFilteredScheduled = useMemo(
    () => (ganttTeamId
      ? contributorFilteredScheduled.filter((project) =>
        project.contributorLoads.some((load) => contributorTeamMap.get(load.contributorId) === ganttTeamId))
      : contributorFilteredScheduled),
    [contributorFilteredScheduled, ganttTeamId, contributorTeamMap],
  );
  const teamFilteredReservations = useMemo(
    () => (ganttTeamId
      ? contributorFilteredReservations.filter((project) =>
        project.contributorLoads.some((load) => contributorTeamMap.get(load.contributorId) === ganttTeamId))
      : contributorFilteredReservations),
    [contributorFilteredReservations, ganttTeamId, contributorTeamMap],
  );

  const ganttSourceOptions = useMemo(() => {
    const sourceNameById = new Map((sources ?? []).map((s) => [s.id, s.name]));
    const options = Array.from(
      new Set(
        scheduledProjects
          .map((p) => p.sourceId)
          .concat(reservationProjects.map((p) => p.sourceId))
          .filter((id): id is string => !!id),
      ),
    )
      .sort((a, b) => {
        const la = sourceNameById.get(a) || a;
        const lb = sourceNameById.get(b) || b;
        return la.localeCompare(lb);
      })
      .map((id) => ({ id, name: sourceNameById.get(id) || id }));
    return options;
  }, [sources, scheduledProjects, reservationProjects]);

  const sourceFilteredScheduled = useMemo(
    () => (ganttSourceId
      ? teamFilteredScheduled.filter((p) => p.sourceId === ganttSourceId)
      : teamFilteredScheduled),
    [teamFilteredScheduled, ganttSourceId],
  );
  const sourceFilteredReservations = useMemo(
    () => (ganttSourceId
      ? teamFilteredReservations.filter((p) => p.sourceId === ganttSourceId)
      : teamFilteredReservations),
    [teamFilteredReservations, ganttSourceId],
  );

  const ganttStreamOptions = useMemo(() => {
    const streamNameById = new Map((streams ?? []).map((s) => [s.id, s.name]));
    const options = Array.from(
      new Set(
        scheduledProjects
          .map((p) => p.streamId)
          .concat(reservationProjects.map((p) => p.streamId))
          .filter((id): id is string => !!id),
      ),
    )
      .sort((a, b) => {
        const la = streamNameById.get(a) || a;
        const lb = streamNameById.get(b) || b;
        return la.localeCompare(lb);
      })
      .map((id) => ({ id, name: streamNameById.get(id) || id }));
    return options;
  }, [streams, scheduledProjects, reservationProjects]);

  const streamFilteredScheduled = useMemo(
    () => (ganttStreamId
      ? sourceFilteredScheduled.filter((p) => p.streamId === ganttStreamId)
      : sourceFilteredScheduled),
    [sourceFilteredScheduled, ganttStreamId],
  );
  const streamFilteredReservations = useMemo(
    () => (ganttStreamId
      ? sourceFilteredReservations.filter((p) => p.streamId === ganttStreamId)
      : sourceFilteredReservations),
    [sourceFilteredReservations, ganttStreamId],
  );
  const visibleScheduledForGantt = useMemo(
    () => {
      if (!activeGanttFocusTimelines || ganttContributionVisibility === 'all') return streamFilteredScheduled;
      return streamFilteredScheduled.filter((project) =>
        (activeGanttFocusTimelines.get(project.projectId)?.significance ?? 'primary') === 'primary');
    },
    [activeGanttFocusTimelines, ganttContributionVisibility, streamFilteredScheduled],
  );
  const visibleReservationsForGantt = useMemo(
    () => {
      if (!activeGanttFocusTimelines || ganttContributionVisibility === 'all') return streamFilteredReservations;
      return streamFilteredReservations.filter((project) =>
        (activeGanttFocusTimelines.get(project.projectId)?.significance ?? 'primary') === 'primary');
    },
    [activeGanttFocusTimelines, ganttContributionVisibility, streamFilteredReservations],
  );
  const hiddenSupportSummary = useMemo(() => {
    if (!activeGanttFocusTimelines || ganttContributionVisibility !== 'primary_only') return null;
    const hiddenItems = [...streamFilteredScheduled, ...streamFilteredReservations]
      .map((project) => activeGanttFocusTimelines.get(project.projectId))
      .filter((timeline): timeline is ContributorProjectTimeline | TeamProjectTimeline =>
        !!timeline && timeline.significance === 'support');
    if (hiddenItems.length === 0) return null;
    const totalDays = hiddenItems.reduce((sum, item) => sum + item.totalProjectDays, 0);
    return {
      count: hiddenItems.length,
      totalDays,
    };
  }, [activeGanttFocusTimelines, ganttContributionVisibility, streamFilteredReservations, streamFilteredScheduled]);

  const ganttProjects = useMemo(() => {
    const selectedFocusName = ganttContributorId
      ? (ganttContributorNameById.get(ganttContributorId) ?? null)
      : (ganttTeamId ? (ganttTeamNameById.get(ganttTeamId) ?? null) : null);
    const scheduledRows = visibleScheduledForGantt.map((project) => ({
      id: project.projectId,
      name: project.projectName,
      status: project.status,
      category_id: project.categoryId,
      planned_start: activeGanttFocusTimelines?.get(project.projectId)?.activeStart ?? project.plannedStart,
      historical_start: activeGanttFocusTimelines ? null : project.historicalStart,
      planned_end: activeGanttFocusTimelines?.get(project.projectId)?.activeEnd ?? project.plannedEnd,
      execution_progress: project.executionProgress || 0,
      active_week_starts: activeGanttFocusTimelines?.get(project.projectId)?.activeWeekStarts ?? project.activeWeekStarts,
      on_hold_ranges: project.onHoldRanges,
      full_planned_start: project.plannedStart,
      full_planned_end: project.plannedEnd,
      focus_contributor_name: selectedFocusName,
      focus_contributor_active_start: activeGanttFocusTimelines?.get(project.projectId)?.activeStart ?? null,
      focus_contributor_active_end: activeGanttFocusTimelines?.get(project.projectId)?.activeEnd ?? null,
    }));
    if (!showReservations) return scheduledRows;

    const reservationRows = visibleReservationsForGantt.map((project) => ({
      id: project.projectId,
      name: project.projectName,
      status: project.status,
      category_id: project.categoryId,
      planned_start: activeGanttFocusTimelines?.get(project.projectId)?.activeStart ?? project.plannedStart,
      historical_start: null,
      planned_end: activeGanttFocusTimelines?.get(project.projectId)?.activeEnd ?? project.plannedEnd,
      execution_progress: project.executionProgress || 0,
      is_reservation: true,
      reservation_reason: project.reason,
      full_planned_start: project.plannedStart,
      full_planned_end: project.plannedEnd,
      focus_contributor_name: selectedFocusName,
      focus_contributor_active_start: activeGanttFocusTimelines?.get(project.projectId)?.activeStart ?? null,
      focus_contributor_active_end: activeGanttFocusTimelines?.get(project.projectId)?.activeEnd ?? null,
    }));

    return [...scheduledRows, ...reservationRows];
  }, [
    activeGanttFocusTimelines,
    ganttContributorId,
    ganttContributorNameById,
    ganttTeamId,
    ganttTeamNameById,
    showReservations,
    visibleReservationsForGantt,
    visibleScheduledForGantt,
  ]);

  const ganttExportRows = useMemo<GanttRoadmapItem[]>(() => {
    const scheduledRows = visibleScheduledForGantt.map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      status: project.status,
      executionProgress: project.executionProgress || 0,
      plannedStart: activeGanttFocusTimelines?.get(project.projectId)?.activeStart ?? project.plannedStart,
      plannedEnd: activeGanttFocusTimelines?.get(project.projectId)?.activeEnd ?? project.plannedEnd,
      historicalStart: activeGanttFocusTimelines ? null : project.historicalStart,
      isReservation: false,
      activeWeekStarts: activeGanttFocusTimelines?.get(project.projectId)?.activeWeekStarts ?? project.activeWeekStarts,
      onHoldRanges: project.onHoldRanges,
    }));
    if (!showReservations) return scheduledRows;
    const reservationRows = visibleReservationsForGantt.map((project) => ({
      projectId: project.projectId,
      projectName: project.projectName,
      status: project.status,
      executionProgress: project.executionProgress || 0,
      plannedStart: activeGanttFocusTimelines?.get(project.projectId)?.activeStart ?? project.plannedStart,
      plannedEnd: activeGanttFocusTimelines?.get(project.projectId)?.activeEnd ?? project.plannedEnd,
      historicalStart: null,
      isReservation: true,
      reservationReason: project.reason,
    }));
    return [...scheduledRows, ...reservationRows];
  }, [
    activeGanttFocusTimelines,
    showReservations,
    visibleReservationsForGantt,
    visibleScheduledForGantt,
  ]);

  const ganttDependencies = useMemo(() => {
    const visibleIds = new Set<string>([
      ...visibleScheduledForGantt.map((p) => p.projectId),
      ...(showReservations ? visibleReservationsForGantt.map((p) => p.projectId) : []),
    ]);
    const links: Array<{
      id: string;
      project_id: string;
      depends_on_project_id: string;
      dependency_type: string;
    }> = [];
    for (const project of scheduledProjects) {
      if (!visibleIds.has(project.projectId)) continue;
      for (const blockerId of project.blockerProjectIds) {
        if (!visibleIds.has(blockerId)) continue;
        links.push({
          id: `${blockerId}:${project.projectId}`,
          project_id: project.projectId,
          depends_on_project_id: blockerId,
          dependency_type: 'blocks',
        });
      }
    }
    return links;
  }, [scheduledProjects, showReservations, visibleReservationsForGantt, visibleScheduledForGantt]);

  const monthsForGantt = useMemo(() => {
    const allRows = ganttExportRows.map((item) => ({ plannedEnd: item.plannedEnd }));
    return calcMonthsSpan(allRows);
  }, [ganttExportRows]);
  const monthOffsetForGantt = 0;
  const ganttHeight = useMemo(
    () => Math.max(420, (ganttProjects.length * 38) + 180),
    [ganttProjects.length],
  );

  const bottleneckMaxImpact = useMemo(() => {
    const impacts = (response?.bottlenecks ?? []).map((item) => item.impactDays);
    return impacts.length ? Math.max(...impacts) : 0;
  }, [response?.bottlenecks]);

  const bottleneckProjectsByContributor = useMemo(() => {
    const rowsByContributor = new Map<string, BottleneckProjectContribution[]>();

    for (const project of scheduledProjects) {
      const progress = Math.max(0, Math.min(100, project.executionProgress || 0));
      const progressRatio = progress / 100;

      for (const load of project.contributorLoads) {
        const remainingDays = Math.max(0, load.days || 0);
        const divisor = 1 - progressRatio;
        const totalContributionDays = divisor > 0.0001
          ? remainingDays / divisor
          : remainingDays;
        const spentDays = Math.max(0, totalContributionDays - remainingDays);

        const rows = rowsByContributor.get(load.contributorId) ?? [];
        rows.push({
          projectId: project.projectId,
          projectName: project.projectName,
          plannedStart: project.plannedStart,
          plannedEnd: project.plannedEnd,
          totalContributionDays,
          spentDays,
        });
        rowsByContributor.set(load.contributorId, rows);
      }
    }

    for (const [contributorId, rows] of rowsByContributor.entries()) {
      rows.sort((a, b) =>
        a.plannedStart.localeCompare(b.plannedStart)
        || a.projectName.localeCompare(b.projectName)
        || a.projectId.localeCompare(b.projectId));
      rowsByContributor.set(contributorId, rows);
    }

    return rowsByContributor;
  }, [scheduledProjects]);

  // The occupation tables come from `roadmapOccupation.ts`, which the API's export runs too; names
  // ordered in the screen language, as the export orders them (`new Intl.Collator(language)` on the server).
  const occupationTables = useMemo(() => buildRoadmapOccupation(
    response?.occupation ?? [],
    response?.teamOccupation ?? [],
    { noTeam: t('planning.roadmap.occupation.noTeam') },
    new Intl.Collator(locale).compare,
  ), [locale, response?.occupation, response?.teamOccupation, t]);
  const {
    weekKeys: occupationWeekKeys,
    contributorGroups: contributorOccupationGroups,
    teamRows: teamOccupationRows,
    contributorAverages: contributorOccupationAverages,
    teamAverages: teamOccupationAverages,
  } = occupationTables;

  const toggleBottleneckExpansion = (contributorId: string) => {
    setExpandedBottleneckIds((prev) => {
      const next = new Set(prev);
      if (next.has(contributorId)) next.delete(contributorId);
      else next.add(contributorId);
      return next;
    });
  };

  const openExplanation = (projectId: string) => {
    if (!explanationByKey.has(projectId)) return;
    setSelectedExplanationKey(projectId);
  };

  const closeExplanation = () => {
    setSelectedExplanationKey(null);
  };

  const buildExcludedProjectIds = (
    selection: Set<string> = selectedProjectIds,
    rows: ScheduledProject[] = scheduleRows,
  ): string[] => rows
    .map((project) => project.projectId)
    .filter((projectId) => !selection.has(projectId));

  const runGenerate = async (
    excludedProjectIds: string[],
    options?: { resetSelectionPool?: boolean; scenario?: RoadmapScenario },
  ) => {
    setLoading(true);
    setError(null);
    setSuccess(null);
    setApplyError(null);
    const isFirstGeneration = !response;
    try {
      const nextScenario = options?.scenario ?? roadmapScenario;
      const scenarioPayload = nextScenario.projectOverrides.length > 0
        || nextScenario.scenarioProjects.length > 0
        ? nextScenario
        : undefined;
      const payload = {
        startDate,
        statuses,
        capacityMode,
        capacityConstraintMode,
        parallelizationLimit,
        optimizationMode,
        includeAlreadyScheduled,
        excludedProjectIds,
        contextSwitchPenaltyPct,
        contextSwitchGrace,
        scenario: scenarioPayload,
      };
      const res = await api.post('/portfolio/reports/roadmap/generate', payload);
      const nextResponse = res.data as RoadmapResponse;
      setResponse(nextResponse);
      responsePayloadRef.current = payload;

      if (options?.resetSelectionPool) {
        const oldPoolIds = new Set(scheduleSelectionPool.map((p) => p.projectId));
        const newPoolIds = new Set(nextResponse.schedule.map((p) => p.projectId));

        if (oldPoolIds.size === 0) {
          // First generation: select all
          setSelectedProjectIds(new Set(newPoolIds));
        } else {
          // Re-generate: preserve deselections, auto-select new projects
          const nextSelected = new Set<string>();
          for (const id of newPoolIds) {
            if (!oldPoolIds.has(id)) {
              // New project: auto-select
              nextSelected.add(id);
            } else if (selectedProjectIds.has(id)) {
              // Existing project that was selected: keep selected
              nextSelected.add(id);
            }
            // Existing project that was deselected: stays deselected
          }
          setSelectedProjectIds(nextSelected);
        }
        setScheduleSelectionPool(nextResponse.schedule);
      }

      // Only force schedule tab on first successful generation
      if (isFirstGeneration) {
        setTab('schedule');
      }
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('planning.roadmap.messages.generateFailed')));
    } finally {
      setLoading(false);
    }
  };

  const recalculateForSelection = async (nextSelection: Set<string>) => {
    if (scheduleRows.length === 0) return;
    setSelectedProjectIds(nextSelection);
    await runGenerate(buildExcludedProjectIds(nextSelection));
  };

  const toggleProjectSelection = (projectId: string) => {
    const next = new Set(selectedProjectIds);
    if (next.has(projectId)) next.delete(projectId);
    else next.add(projectId);
    void recalculateForSelection(next);
  };

  const toggleSelectAll = () => {
    const next = new Set(selectedProjectIds);
    if (allRowsSelected) {
      filteredProjectIds.forEach((projectId) => next.delete(projectId));
    } else {
      filteredProjectIds.forEach((projectId) => next.add(projectId));
    }
    void recalculateForSelection(next);
  };

  const handleGenerate = async () => {
    await runGenerate([], { resetSelectionPool: true });
  };

  const setScenarioPinStart = async (projectId: string, startWeek: string) => {
    const currentOverride = projectOverrideById.get(projectId);
    if (
      currentOverride?.constraint?.type === 'pin_start'
      && currentOverride.constraint.startWeek === startWeek
    ) {
      return;
    }
    const nextOverrides = roadmapScenario.projectOverrides
      .filter((override) => override.projectId !== projectId);
    nextOverrides.push({
      projectId,
      schedulingMode: currentOverride?.schedulingMode,
      constraint: { type: 'pin_start', startWeek },
    });
    const nextScenario = {
      ...roadmapScenario,
      projectOverrides: nextOverrides,
    };
    setRoadmapScenario(nextScenario);
    if (response) {
      await runGenerate(buildExcludedProjectIds(), { resetSelectionPool: true, scenario: nextScenario });
    }
  };

  const clearScenarioOverride = async (projectId: string) => {
    const currentOverride = projectOverrideById.get(projectId);
    if (!currentOverride) return;
    const nextOverrides = roadmapScenario.projectOverrides
      .filter((override) => override.projectId !== projectId);
    if (currentOverride.schedulingMode) {
      nextOverrides.push({
        projectId,
        schedulingMode: currentOverride.schedulingMode,
        constraint: null,
      });
    }
    const nextScenario = {
      ...roadmapScenario,
      projectOverrides: nextOverrides,
    };
    setRoadmapScenario(nextScenario);
    if (response) {
      await runGenerate(buildExcludedProjectIds(), { resetSelectionPool: true, scenario: nextScenario });
    }
  };

  const clearAllScenarioOverrides = async () => {
    if (roadmapScenario.projectOverrides.length === 0) return;
    const nextScenario = {
      ...roadmapScenario,
      projectOverrides: [],
    };
    setRoadmapScenario(nextScenario);
    if (response) {
      await runGenerate(buildExcludedProjectIds(), { resetSelectionPool: true, scenario: nextScenario });
    }
  };

  const openPinDialog = (
    projectId: string,
    projectName: string,
    fallbackWeek?: string | null,
  ) => {
    const existingConstraint = projectOverrideById.get(projectId)?.constraint;
    const initialWeek = existingConstraint?.type === 'pin_start'
      ? existingConstraint.startWeek
      : (fallbackWeek || startDate);
    setPinDialogProjectId(projectId);
    setPinDialogProjectName(projectName);
    setPinDialogWeek(initialWeek);
  };

  const closePinDialog = () => {
    setPinDialogProjectId(null);
    setPinDialogProjectName('');
    setPinDialogWeek(startDate);
  };

  const handleSavePinDialog = async () => {
    if (!pinDialogProjectId || !pinDialogWeek) return;
    await setScenarioPinStart(pinDialogProjectId, pinDialogWeek);
    closePinDialog();
  };

  const handleClearPinDialog = async () => {
    if (!pinDialogProjectId) return;
    await clearScenarioOverride(pinDialogProjectId);
    closePinDialog();
  };

  const handleApply = async () => {
    if (!canEditProjectDates || !response) return;
    const selectedProjects = selectedVisibleScheduledProjects
      .map((project) => ({
        projectId: project.projectId,
        plannedStart: project.plannedStart,
        plannedEnd: project.plannedEnd,
      }));

    if (selectedProjects.length === 0) {
      setConfirmOpen(false);
      return;
    }

    setApplying(true);
    setApplyError(null);
    setSuccess(null);

    try {
      await api.post('/portfolio/projects/planning/roadmap/apply', {
        projects: selectedProjects,
      });
      setConfirmOpen(false);
      setSuccess(t('planning.roadmap.messages.applied', { count: selectedProjects.length }));
      await queryClient.invalidateQueries({ queryKey: ['portfolio-timeline'] });
      onApplied?.();
    } catch (e: any) {
      const details = e?.response?.data?.details;
      if (Array.isArray(details) && details.length > 0) {
        const first = details[0];
        setApplyError(t('planning.roadmap.messages.applyFailedFor', { project: first?.projectId || t('planning.roadmap.columns.project'), error: first?.error || t('planning.roadmap.messages.applyFailed') }));
      } else {
        setApplyError(getApiErrorMessage(e, t, t('planning.roadmap.messages.applyFailed')));
      }
    } finally {
      setApplying(false);
    }
  };

  const handleSchedulingModeChange = async (
    projectId: string,
    currentMode: SchedulingMode,
    nextMode: SchedulingMode,
  ) => {
    if (!canEditProjectDates || currentMode === nextMode) return;
    setError(null);
    setApplyError(null);
    setSuccess(null);
    setSavingSchedulingModeProjectIds((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    try {
      await api.patch(`/portfolio/projects/${projectId}`, {
        scheduling_mode: nextMode,
      });
      await queryClient.invalidateQueries({ queryKey: ['portfolio-projects'] });
      await queryClient.invalidateQueries({ queryKey: ['portfolio-timeline'] });
      await runGenerate(buildExcludedProjectIds(), { resetSelectionPool: true });
      setSuccess(t('planning.roadmap.messages.schedulingModeUpdated', { mode: t(`planning.roadmap.schedulingModes.${nextMode}`) }));
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('planning.roadmap.messages.schedulingModeFailed')));
    } finally {
      setSavingSchedulingModeProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      });
    }
  };

  const handleStatusChange = (event: SelectChangeEvent<string[]>) => {
    const value = event.target.value;
    const next = typeof value === 'string' ? value.split(',') : value;
    setStatuses(next);
  };

  const handleExportGanttPng = async () => {
    try {
      await exportRoadmapGanttAsPng(
        ganttExportRows,
        monthsForGantt,
        monthOffsetForGantt,
        locale,
        `roadmap-gantt-${getTodayYmd()}`,
        t('planning.roadmap.columns.project'),
      );
    } catch (error: any) {
      console.error(error);
      setError(t('planning.roadmap.messages.exportGanttFailed'));
    }
  };

  const occupationExportData = useMemo<OccupationExportData | null>(() => {
    if (occupationWeekKeys.length === 0) return null;
    return {
      weekKeys: occupationWeekKeys,
      contributorGroups: contributorOccupationGroups,
      teamRows: teamOccupationRows,
      contributorAverages: contributorOccupationAverages,
      teamAverages: teamOccupationAverages,
      labels: {
        team: t('planning.roadmap.occupation.team'),
        contributor: t('planning.roadmap.occupation.contributor'),
        contributors: t('planning.roadmap.occupation.contributors'),
        teams: t('planning.roadmap.occupation.teams'),
        average: t('planning.roadmap.occupation.average'),
        avg: t('planning.roadmap.occupation.avg'),
        week: (week) => t('planning.roadmap.occupation.week', { week }),
        weekYear: (week, year) => t('planning.roadmap.occupation.weekYear', { week, year }),
      },
    };
  }, [occupationWeekKeys, contributorOccupationGroups, teamOccupationRows, contributorOccupationAverages, teamOccupationAverages, t]);

  const handleExportOccupation = async (format: ExportFormat) => {
    if (!responsePayloadRef.current) return;
    try {
      await downloadServerExport({
        url: '/portfolio/reports/roadmap/occupation/export',
        format,
        language: locale,
        // The table of a CSV is the view on screen; the workbook holds both.
        params: { table: occupationView === 'team' ? 'teams' : 'contributors' },
        body: responsePayloadRef.current,
        fileBase: 'roadmap-occupation',
      });
    } catch (err: any) {
      console.error(err);
      setError(t('ops:reports.shared.exportFailed'));
    }
  };

  const handleExportOccupationPng = async () => {
    if (!occupationExportData) return;
    try {
      await exportOccupationAsPng(occupationExportData, occupationView);
    } catch (err: any) {
      console.error(err);
      setError(t('planning.roadmap.messages.exportOccupationPngFailed'));
    }
  };

  const hasResponse = !!response;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
            {t('planning.roadmap.title')}
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap">
            <DateEUField
              label={t('planning.roadmap.fields.startDate')}
              valueYmd={startDate}
              onChangeYmd={setStartDate}
              required
              sx={{ minWidth: 180 }}
            />

            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>{t('planning.roadmap.fields.statuses')}</InputLabel>
              <Select
                multiple
                value={statuses}
                label={t('planning.roadmap.fields.statuses')}
                onChange={handleStatusChange}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((status) => (
                      <Box key={status} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                        <StatusDot color={getDotColor(PROJECT_STATUS_COLORS[status] ?? 'default', mode)} />
                        <Typography variant="body2" sx={{ color: getDotColor(PROJECT_STATUS_COLORS[status] ?? 'default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t(`statuses.project.${status}`, { defaultValue: status })}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              >
                {STATUS_OPTIONS.map((option) => (
                  <MenuItem key={option} value={option}>
                    {t(`statuses.project.${option}`, { defaultValue: option })}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>{t('planning.roadmap.fields.capacityMode')}</InputLabel>
              <Select
                value={capacityMode}
                label={t('planning.roadmap.fields.capacityMode')}
                onChange={(e) => setCapacityMode(e.target.value as 'theoretical' | 'historical')}
              >
                <MenuItem value="theoretical">{t('planning.roadmap.capacityModes.theoretical')}</MenuItem>
                <MenuItem value="historical">{t('planning.roadmap.capacityModes.historical')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>{t('planning.roadmap.fields.constraintScope')}</InputLabel>
              <Select
                value={capacityConstraintMode}
                label={t('planning.roadmap.fields.constraintScope')}
                onChange={(e) => setCapacityConstraintMode(e.target.value as CapacityConstraintMode)}
              >
                <MenuItem value="full">{t('planning.roadmap.constraintScopes.full')}</MenuItem>
                <MenuItem value="it_only">{t('planning.roadmap.constraintScopes.itOnly')}</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>{t('planning.roadmap.fields.parallelLimit')}</InputLabel>
              <Select
                value={String(parallelizationLimit)}
                label={t('planning.roadmap.fields.parallelLimit')}
                onChange={(e) => setParallelizationLimit(Number(e.target.value))}
              >
                <MenuItem value="1">1</MenuItem>
                <MenuItem value="2">2</MenuItem>
                <MenuItem value="3">3</MenuItem>
                <MenuItem value="4">4</MenuItem>
                <MenuItem value="5">5</MenuItem>
              </Select>
            </FormControl>
          </Stack>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ xs: 'stretch', md: 'center' }}>
            <ToggleButtonGroup
              size="small"
              value={optimizationMode}
              exclusive
              onChange={(_, value) => {
                if (value) setOptimizationMode(value);
              }}
            >
              <ToggleButton value="priority_focused">{t('planning.roadmap.optimization.priorityFocused')}</ToggleButton>
              <ToggleButton value="completion_focused">{t('planning.roadmap.optimization.completionFocused')}</ToggleButton>
            </ToggleButtonGroup>

            <FormControlLabel
              control={
                <Checkbox
                  checked={includeAlreadyScheduled}
                  onChange={(e) => setIncludeAlreadyScheduled(e.target.checked)}
                />
              }
              label={t('planning.roadmap.fields.recalculateScheduled')}
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            {t('planning.roadmap.help.recalculate')}
            {capacityConstraintMode === 'it_only' && (
              <>
                {' '}
                {t('planning.roadmap.help.itOnly')}
              </>
            )}
          </Typography>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Box sx={{ minWidth: 280 }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                {t('planning.roadmap.fields.contextSwitchPenalty', { value: (contextSwitchPenaltyPct * 100).toFixed(0) })}
              </Typography>
              <Slider
                min={0}
                max={0.5}
                step={0.05}
                value={contextSwitchPenaltyPct}
                onChange={(_, value) => setContextSwitchPenaltyPct(value as number)}
                valueLabelDisplay="auto"
                valueLabelFormat={(value) => `${Math.round(value * 100)}%`}
              />
            </Box>

            {/* Label above the field, like the slider beside it: inside a narrow field it was cut. */}
            <Box>
              <Typography id="roadmap-context-switch-grace" variant="body2" sx={{ mb: 0.5 }}>
                {t('planning.roadmap.fields.contextSwitchGrace')}
              </Typography>
              <TextField
                type="number"
                size="small"
                value={contextSwitchGrace}
                onChange={(e) => setContextSwitchGrace(Math.max(0, Number(e.target.value || '0')))}
                inputProps={{ min: 0, max: 10, 'aria-labelledby': 'roadmap-context-switch-grace' }}
                sx={{ width: 120 }}
              />
            </Box>

            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              onClick={handleGenerate}
              disabled={loading || statuses.length === 0 || !startDate}
            >
              {loading ? t('planning.roadmap.actions.generating') : t('planning.roadmap.actions.generate')}
            </Button>
          </Stack>
        </Stack>
      </Paper>

      {loading && <LinearProgress />}
      {error && <Alert severity="error">{error}</Alert>}
      {applyError && <Alert severity="error">{applyError}</Alert>}
      {success && <Alert severity="success">{success}</Alert>}
      {hasResponse && (response?.scenarioWarnings?.length ?? 0) > 0 && (
        <Stack spacing={1}>
          {response?.scenarioWarnings.map((warning, index) => (
            <Alert key={`${warning.code}:${getExplanationKey(warning.itemRef ?? {
              projectId: null,
              scenarioProjectId: null,
              sourceRequestId: null,
              isScenarioProject: false,
            }) ?? 'global'}:${index}`} severity={warning.severity}>
              {formatWarning(warning)}
            </Alert>
          ))}
        </Stack>
      )}

      {!hasResponse && !loading && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            {t('planning.roadmap.states.empty')}
          </Typography>
        </Paper>
      )}

      {hasResponse && response && (
        <>
          {activeConstraintOverrides.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                  {t('planning.roadmap.overrides.title')}
                </Typography>
                <Button size="small" color="inherit" onClick={() => { void clearAllScenarioOverrides(); }}>
                  {t('planning.roadmap.overrides.resetAll')}
                </Button>
              </Stack>
              <Stack spacing={1} sx={{ mt: 1.5 }}>
                {activeConstraintOverrides.map((override) => {
                  const warningCount = scenarioWarningsByProjectId.get(override.projectId)?.length ?? 0;
                  return (
                    <Paper key={override.projectId} variant="outlined" sx={{ p: 1.25 }}>
                      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }} justifyContent="space-between">
                        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                          <Typography variant="body2" sx={{ fontWeight: 500 }}>
                            {explanationSubjectByKey.get(override.projectId) || scheduleRowsById.get(override.projectId)?.projectName || override.projectId}
                          </Typography>
                          <Box component="span" sx={{ color: getDotColor('info', mode), fontSize: '0.8125rem' }}>{formatRoadmapConstraint(t, locale, override.constraint)}</Box>
                          {warningCount > 0 && (
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                              <StatusDot color={getDotColor('warning', mode)} />
                              <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('planning.roadmap.chips.conflict', { count: warningCount })}</Typography>
                            </Box>
                          )}
                        </Stack>
                        <Stack direction="row" spacing={1}>
                          <Button
                            size="small"
                            color="inherit"
                            onClick={() => openPinDialog(
                              override.projectId,
                              explanationSubjectByKey.get(override.projectId) || scheduleRowsById.get(override.projectId)?.projectName || override.projectId,
                              override.constraint?.type === 'pin_start' ? override.constraint.startWeek : null,
                            )}
                          >
                            {t('planning.roadmap.actions.editPin')}
                          </Button>
                          <Button size="small" color="inherit" onClick={() => { void clearScenarioOverride(override.projectId); }}>
                            {t('common:buttons.reset')}
                          </Button>
                        </Stack>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            </Paper>
          )}

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} flexWrap="wrap" useFlexGap>
              <Typography variant="body2" color="text.secondary">{t('planning.roadmap.summary.scheduled', { count: response.schedule.length })}</Typography>
              <Typography variant="body2" color="text.secondary">{t('planning.roadmap.summary.reservations', { count: response.reservations.length })}</Typography>
              <Typography variant="body2" color="text.secondary">{t('planning.roadmap.summary.externalBlockers', { count: response.diagnostics.reservationByReason?.external_blocker ?? 0 })}</Typography>
              <Typography variant="body2" color="text.secondary">{t('planning.roadmap.summary.unschedulable', { count: response.unschedulable.length })}</Typography>
              <Typography variant="body2" color="text.secondary">{t('planning.roadmap.summary.roadmapEnd', { date: formatRoadmapDate(t, locale, response.roadmapEndDate) })}</Typography>
              <Typography variant="body2" color="text.secondary">{t('planning.roadmap.summary.run', { ms: response.diagnostics.runDurationMs })}</Typography>
              <Typography variant="body2" color="text.secondary">{t('planning.roadmap.summary.sensitivityReruns', { count: response.diagnostics.sensitivityReruns })}</Typography>
              {response.diagnostics.sensitivityTruncated && (
                <Typography variant="body2" sx={{ color: getDotColor('warning', mode) }}>{t('planning.roadmap.summary.sensitivityTruncated')}</Typography>
              )}
            </Stack>
          </Paper>

          <Paper variant="outlined" sx={{ p: 0 }}>
            <Box
              role="button"
              tabIndex={0}
              aria-expanded={panelExpanded}
              aria-controls="roadmap-panel-content"
              onClick={() => setPanelExpanded((prev) => !prev)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setPanelExpanded((prev) => !prev);
                }
              }}
              sx={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                px: 2,
                py: 1,
                cursor: 'pointer',
                userSelect: 'none',
                '&:hover': { backgroundColor: 'action.hover' },
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                {t('planning.roadmap.panel.title')}
              </Typography>
              {panelExpanded
                ? <KeyboardArrowUpIcon fontSize="small" />
                : <KeyboardArrowDownIcon fontSize="small" />}
            </Box>
            <Collapse in={panelExpanded} id="roadmap-panel-content">
            <Tabs
              value={tab}
              onChange={(_, value) => setTab(value)}
              variant="scrollable"
              scrollButtons="auto"
            >
              <Tab value="schedule" label={t('planning.roadmap.tabs.schedule')} />
              <Tab value="bottlenecks" label={t('planning.roadmap.tabs.bottlenecks')} />
              <Tab value="occupation" label={t('planning.roadmap.tabs.occupation')} />
            </Tabs>

            <Box sx={{ p: 2 }}>
              {tab === 'schedule' && (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <Button
                      size="small"
                      onClick={toggleSelectAll}
                      disabled={filteredProjectIds.length === 0}
                    >
                      {allRowsSelected ? t('planning.roadmap.selection.clearVisible') : t('planning.roadmap.selection.selectVisible')}
                    </Button>
                    <Typography variant="body2" color="text.secondary">
                      {t('planning.roadmap.selection.selectedInGantt', { count: selectedSchedulableCount })}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {t('planning.roadmap.selection.excludedHelp')}
                  </Typography>

                  <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox" />
                          <TableCell>{t('planning.roadmap.columns.project')}</TableCell>
                          <TableCell>{t('planning.roadmap.columns.status')}</TableCell>
                          <TableCell>{t('planning.roadmap.columns.scheduling')}</TableCell>
                          <TableCell>{t('planning.roadmap.columns.scenario')}</TableCell>
                          <TableCell>{t('planning.roadmap.columns.start')}</TableCell>
                          <TableCell>{t('planning.roadmap.columns.end')}</TableCell>
                          <TableCell>{t('planning.roadmap.columns.weeks')}</TableCell>
                          <TableCell align="right">{t('planning.roadmap.columns.priority')}</TableCell>
                          <TableCell align="right">{t('planning.roadmap.columns.explain')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {scheduleRows.map((project) => {
                          const scenarioProject = scheduleRowsById.get(project.projectId);
                          const isExcluded = !selectedProjectIds.has(project.projectId);
                          const status = scenarioProject?.status || project.status;
                          const schedulingMode = scenarioProject?.schedulingMode || project.schedulingMode;
                          const priority = scenarioProject?.priorityScore ?? project.priorityScore;
                          const isSavingSchedulingMode = savingSchedulingModeProjectIds.has(project.projectId);
                          const override = projectOverrideById.get(project.projectId);
                          const pinStartValue = override?.constraint?.type === 'pin_start'
                            ? override.constraint.startWeek
                            : '';
                          const projectWarnings = scenarioWarningsByProjectId.get(project.projectId) ?? [];
                          const hasConstraintConflict = projectWarnings.some((warning) => warning.code === 'constraint_infeasible');
                          return (
                            <TableRow key={project.projectId} hover sx={isExcluded ? { opacity: 0.55 } : undefined}>
                              <TableCell padding="checkbox">
                                <Checkbox
                                  checked={selectedProjectIds.has(project.projectId)}
                                  onChange={() => toggleProjectSelection(project.projectId)}
                                />
                              </TableCell>
                              <TableCell>
                                <Link
                                  component={RouterLink}
                                  to={`/portfolio/projects/${project.projectId}/effort`}
                                  underline="hover"
                                  color="inherit"
                                >
                                  {scenarioProject?.projectName || project.projectName}
                                </Link>
                                <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }} flexWrap="wrap" useFlexGap>
                                  {pinStartValue && (
                                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                      <StatusDot color={getDotColor('info', mode)} />
                                      <Typography variant="body2" sx={{ color: getDotColor('info', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('planning.roadmap.chips.pinned')}</Typography>
                                    </Box>
                                  )}
                                  {hasConstraintConflict && (
                                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                      <StatusDot color={getDotColor('warning', mode)} />
                                      <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('planning.roadmap.chips.conflict', { count: 1 })}</Typography>
                                    </Box>
                                  )}
                                </Stack>
                              </TableCell>
                              <TableCell>{t(`statuses.project.${status}`, { defaultValue: status })}</TableCell>
                              <TableCell>
                                <SchedulingModeControl
                                  value={schedulingMode}
                                  disabled={loading || isSavingSchedulingMode}
                                  canEdit={canEditProjectDates}
                                  onChange={(next) => {
                                    void handleSchedulingModeChange(project.projectId, schedulingMode, next);
                                  }}
                                />
                              </TableCell>
                              <TableCell>
                                <Stack spacing={0.75} alignItems="flex-start">
                                  {pinStartValue ? (
                                    <Typography variant="caption" color="text.secondary">
                                      {t('planning.roadmap.values.pinStart', { week: formatRoadmapDate(t, locale, pinStartValue) })}
                                    </Typography>
                                  ) : (
                                    <Typography variant="caption" color="text.secondary">
                                      {t('planning.roadmap.values.noConstraint')}
                                    </Typography>
                                  )}
                                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} alignItems={{ xs: 'stretch', sm: 'center' }}>
                                    <Button
                                      size="small"
                                      onClick={() => openPinDialog(
                                        project.projectId,
                                        scenarioProject?.projectName || project.projectName,
                                        scenarioProject?.plannedStart || project.plannedStart,
                                      )}
                                    >
                                      {pinStartValue ? t('planning.roadmap.actions.editPin') : t('planning.roadmap.actions.pinStart')}
                                    </Button>
                                    <Button
                                      size="small"
                                      color="inherit"
                                      disabled={!pinStartValue}
                                      onClick={() => { void clearScenarioOverride(project.projectId); }}
                                    >
                                      {t('common:buttons.clear')}
                                    </Button>
                                  </Stack>
                                </Stack>
                              </TableCell>
                              <TableCell>{scenarioProject?.plannedStart ? formatRoadmapDate(t, locale, scenarioProject.plannedStart) : t('planning.roadmap.values.excluded')}</TableCell>
                              <TableCell>{scenarioProject?.plannedEnd ? formatRoadmapDate(t, locale, scenarioProject.plannedEnd) : t('planning.roadmap.values.excluded')}</TableCell>
                              <TableCell>{scenarioProject?.durationWeeks ?? t('planning.roadmap.values.excluded')}</TableCell>
                              <TableCell align="right">
                                {priority != null ? formatRoadmapDays(locale, priority, 1) : t('planning.roadmap.values.na')}
                              </TableCell>
                              <TableCell align="right">
                                <Button
                                  size="small"
                                  onClick={() => openExplanation(project.projectId)}
                                  disabled={!explanationByKey.has(project.projectId)}
                                >
                                  {t('planning.roadmap.actions.why')}
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </Paper>

                  {response.unschedulable.length > 0 && (
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {t('planning.roadmap.unschedulable.title')}
                      </Typography>
                      <Stack spacing={0.75}>
                        {response.unschedulable.map((item) => (
                          (() => {
                            const override = projectOverrideById.get(item.projectId);
                            const pinStartValue = override?.constraint?.type === 'pin_start'
                              ? override.constraint.startWeek
                              : '';
                            const projectWarnings = scenarioWarningsByProjectId.get(item.projectId) ?? [];
                            const hasConstraintConflict = projectWarnings.some((warning) => warning.code === 'constraint_infeasible');
                            return (
                          <Stack
                            key={item.projectId}
                            direction="row"
                            spacing={1}
                            alignItems="center"
                            justifyContent="space-between"
                          >
                            <Stack spacing={0.5} sx={{ flex: 1 }}>
                              <Tooltip title={item.detailsText ? formatRoadmapText(t, locale, item.detailsText) : ''} placement="top-start">
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                  {t('planning.roadmap.unschedulable.item', { project: item.projectName, mode: t(`planning.roadmap.schedulingModes.${item.schedulingMode}`), reason: t(`planning.roadmap.reasons.${item.reason}`, { defaultValue: item.reason }) })}
                                </Typography>
                              </Tooltip>
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {pinStartValue && (
                                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                    <StatusDot color={getDotColor('info', mode)} />
                                    <Typography variant="body2" sx={{ color: getDotColor('info', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('planning.roadmap.chips.pinned')}</Typography>
                                  </Box>
                                )}
                                {hasConstraintConflict && (
                                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                    <StatusDot color={getDotColor('warning', mode)} />
                                    <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('planning.roadmap.chips.conflict', { count: 1 })}</Typography>
                                  </Box>
                                )}
                              </Stack>
                            </Stack>
                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.75} alignItems={{ xs: 'stretch', sm: 'center' }}>
                              <Button
                                size="small"
                                onClick={() => openPinDialog(
                                  item.projectId,
                                  item.projectName,
                                  pinStartValue || startDate,
                                )}
                              >
                                {pinStartValue ? t('planning.roadmap.actions.editPin') : t('planning.roadmap.actions.pinStart')}
                              </Button>
                              <Button
                                size="small"
                                color="inherit"
                                disabled={!pinStartValue}
                                onClick={() => { void clearScenarioOverride(item.projectId); }}
                              >
                                {t('common:buttons.clear')}
                              </Button>
                              <Button
                                size="small"
                                onClick={() => openExplanation(item.projectId)}
                                disabled={!explanationByKey.has(item.projectId)}
                              >
                                {t('planning.roadmap.actions.why')}
                              </Button>
                            </Stack>
                          </Stack>
                            );
                          })()
                        ))}
                      </Stack>
                    </Paper>
                  )}

                  {filteredReservationProjects.length > 0 && (
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="subtitle2" sx={{ mb: 1 }}>
                        {t('planning.roadmap.reservations.title')}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        {t('planning.roadmap.reservations.help')}
                      </Typography>
                      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>{t('planning.roadmap.columns.project')}</TableCell>
                              <TableCell>{t('planning.roadmap.columns.reason')}</TableCell>
                              <TableCell>{t('planning.roadmap.columns.status')}</TableCell>
                              <TableCell>{t('planning.roadmap.columns.scheduling')}</TableCell>
                              <TableCell>{t('planning.roadmap.columns.start')}</TableCell>
                              <TableCell>{t('planning.roadmap.columns.end')}</TableCell>
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {filteredReservationProjects.map((project) => {
                              const isSavingSchedulingMode = savingSchedulingModeProjectIds.has(project.projectId);
                              return (
                                <TableRow key={`reservation:${project.projectId}`} hover>
                                  <TableCell>
                                    <Link
                                      component={RouterLink}
                                      to={`/portfolio/projects/${project.projectId}/effort`}
                                      underline="hover"
                                      color="inherit"
                                    >
                                      {project.projectName}
                                    </Link>
                                  </TableCell>
                                  <TableCell>{t(`planning.roadmap.reservationReasons.${project.reason}`)}</TableCell>
                                  <TableCell>{t(`statuses.project.${project.status}`, { defaultValue: project.status })}</TableCell>
                                  <TableCell>
                                    <SchedulingModeControl
                                      value={project.schedulingMode}
                                      disabled={loading || isSavingSchedulingMode}
                                      canEdit={canEditProjectDates}
                                      onChange={(next) => {
                                        void handleSchedulingModeChange(project.projectId, project.schedulingMode, next);
                                      }}
                                    />
                                  </TableCell>
                                  <TableCell>{formatRoadmapDate(t, locale, project.plannedStart)}</TableCell>
                                  <TableCell>{formatRoadmapDate(t, locale, project.plannedEnd)}</TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </Paper>
                    </Paper>
                  )}
                </Stack>
              )}

              {tab === 'bottlenecks' && (
                <Stack spacing={1.5}>
                  {response.bottlenecks.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t('planning.roadmap.bottlenecks.empty')}
                    </Typography>
                  )}
                  {response.bottlenecks.map((item) => {
                    const widthPct = bottleneckMaxImpact > 0 ? (item.impactDays / bottleneckMaxImpact) * 100 : 0;
                    const isExpanded = expandedBottleneckIds.has(item.contributorId);
                    const contributorRows = bottleneckProjectsByContributor.get(item.contributorId) ?? [];
                    return (
                      <Paper key={item.contributorId} variant="outlined" sx={{ p: 1.5 }}>
                        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 0.75 }}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <IconButton
                              size="small"
                              onClick={() => toggleBottleneckExpansion(item.contributorId)}
                              aria-label={isExpanded ? t('planning.roadmap.bottlenecks.collapse') : t('planning.roadmap.bottlenecks.expand')}
                            >
                              {isExpanded ? (
                                <KeyboardArrowUpIcon fontSize="small" />
                              ) : (
                                <KeyboardArrowDownIcon fontSize="small" />
                              )}
                            </IconButton>
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>
                              {item.contributorName}
                            </Typography>
                          </Stack>
                          <Typography variant="body2" color="text.secondary">
                            {t('planning.roadmap.bottlenecks.days', { count: item.impactDays })}
                          </Typography>
                        </Stack>
                        <LinearProgress
                          variant="determinate"
                          value={widthPct}
                          sx={{ height: 8, borderRadius: 5 }}
                        />
                        <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                          <Paper variant="outlined" sx={{ mt: 1.5, overflowX: 'auto' }}>
                            <Table size="small">
                              <TableHead>
                                <TableRow>
                                  <TableCell>{t('planning.roadmap.bottlenecks.columns.projectName')}</TableCell>
                                  <TableCell>{t('planning.roadmap.bottlenecks.columns.start')}</TableCell>
                                  <TableCell>{t('planning.roadmap.bottlenecks.columns.end')}</TableCell>
                                  <TableCell align="right">{t('planning.roadmap.bottlenecks.columns.totalContribution')}</TableCell>
                                  <TableCell align="right">{t('planning.roadmap.bottlenecks.columns.spent')}</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {contributorRows.length === 0 && (
                                  <TableRow>
                                    <TableCell colSpan={5}>
                                      <Typography variant="body2" color="text.secondary">
                                        {t('planning.roadmap.bottlenecks.noProjects')}
                                      </Typography>
                                    </TableCell>
                                  </TableRow>
                                )}
                                {contributorRows.map((row) => (
                                  <TableRow key={`${item.contributorId}:${row.projectId}`} hover>
                                    <TableCell>
                                      <Link
                                        component={RouterLink}
                                        to={`/portfolio/projects/${row.projectId}/effort`}
                                        underline="hover"
                                        color="inherit"
                                      >
                                        {row.projectName}
                                      </Link>
                                    </TableCell>
                                    <TableCell>{formatRoadmapDate(t, locale, row.plannedStart)}</TableCell>
                                    <TableCell>{formatRoadmapDate(t, locale, row.plannedEnd)}</TableCell>
                                    <TableCell align="right">{formatRoadmapDays(locale, row.totalContributionDays, 1)}</TableCell>
                                    <TableCell align="right">{formatRoadmapDays(locale, row.spentDays, 1)}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </Paper>
                        </Collapse>
                      </Paper>
                    );
                  })}
                </Stack>
              )}

              {tab === 'occupation' && (
                <Stack spacing={2}>
                  <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                    <ToggleButtonGroup
                      size="small"
                      value={occupationView}
                      exclusive
                      onChange={(_, value) => {
                        if (value) setOccupationView(value);
                      }}
                    >
                      <ToggleButton value="contributor">{t('planning.roadmap.occupation.contributors')}</ToggleButton>
                      <ToggleButton value="team">{t('planning.roadmap.occupation.teams')}</ToggleButton>
                    </ToggleButtonGroup>
                    <ExportFormatButton
                      label={t('ops:reports.shared.exportTable')}
                      size="small"
                      onExport={handleExportOccupation}
                      disabled={!occupationExportData}
                    />
                    <Tooltip title={t('planning.roadmap.occupation.exportPng')}>
                      <span>
                        <IconButton
                          size="small"
                          onClick={handleExportOccupationPng}
                          disabled={!occupationExportData}
                          aria-label={t('planning.roadmap.occupation.exportPng')}
                        >
                          <ImageIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Stack>

                  {occupationView === 'contributor' && (
                    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                      {contributorOccupationGroups.length === 0 || occupationWeekKeys.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                          {t('planning.roadmap.occupation.noContributorData')}
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ minWidth: 160 }}>{t('planning.roadmap.occupation.team')}</TableCell>
                              <TableCell sx={{ minWidth: 220 }}>{t('planning.roadmap.occupation.contributor')}</TableCell>
                              {occupationWeekKeys.map((weekKey) => {
                                const isoWeek = isoWeekParts(weekKey);
                                return (
                                  <TableCell key={`contributor-week:${weekKey}`} align="center" sx={{ minWidth: 74 }}>
                                    <Stack spacing={0} alignItems="center">
                                      <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                        {t('planning.roadmap.occupation.week', { week: String(isoWeek.week).padStart(2, '0') })}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {isoWeek.year}
                                      </Typography>
                                    </Stack>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {contributorOccupationGroups.map((group) => (
                              group.rows.map((row, rowIndex) => (
                                <TableRow key={`${group.teamId || 'no-team'}:${row.contributorId}`} hover>
                                  {rowIndex === 0 && (
                                    <TableCell
                                      rowSpan={group.rows.length}
                                      sx={{ fontWeight: 500, verticalAlign: 'top', backgroundColor: 'action.hover' }}
                                    >
                                      {group.teamName}
                                    </TableCell>
                                  )}
                                  <TableCell>{row.contributorName}</TableCell>
                                  {occupationWeekKeys.map((weekKey) => {
                                    const occupationPct = row.weekOccupation.get(weekKey) ?? null;
                                    return (
                                      <TableCell
                                        key={`${row.contributorId}:${weekKey}`}
                                        align="center"
                                        sx={{ backgroundColor: getOccupationCellBackground(occupationPct, 'contributor') }}
                                      >
                                        {occupationPct != null ? `${occupationPct}%` : '-'}
                                      </TableCell>
                                    );
                                  })}
                                </TableRow>
                              ))
                            ))}
                          </TableBody>
                          <TableFooter>
                            <TableRow sx={{ backgroundColor: 'action.hover' }}>
                              <TableCell colSpan={2} sx={{ fontWeight: 500 }}>{t('planning.roadmap.occupation.avg')}</TableCell>
                              {occupationWeekKeys.map((weekKey) => {
                                const avg = contributorOccupationAverages.get(weekKey) ?? null;
                                return (
                                  <TableCell
                                    key={`contributor-avg:${weekKey}`}
                                    align="center"
                                    sx={{
                                      fontWeight: 500,
                                      backgroundColor: getOccupationCellBackground(avg, 'contributor'),
                                    }}
                                  >
                                    {avg != null ? `${avg}%` : '-'}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          </TableFooter>
                        </Table>
                      )}
                    </Paper>
                  )}

                  {occupationView === 'team' && (
                    <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                      {teamOccupationRows.length === 0 || occupationWeekKeys.length === 0 ? (
                        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
                          {t('planning.roadmap.occupation.noTeamData')}
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ minWidth: 220 }}>{t('planning.roadmap.occupation.team')}</TableCell>
                              {occupationWeekKeys.map((weekKey) => {
                                const isoWeek = isoWeekParts(weekKey);
                                return (
                                  <TableCell key={`team-week:${weekKey}`} align="center" sx={{ minWidth: 74 }}>
                                    <Stack spacing={0} alignItems="center">
                                      <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                        {t('planning.roadmap.occupation.week', { week: String(isoWeek.week).padStart(2, '0') })}
                                      </Typography>
                                      <Typography variant="caption" color="text.secondary">
                                        {isoWeek.year}
                                      </Typography>
                                    </Stack>
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          </TableHead>
                          <TableBody>
                            {teamOccupationRows.map((row) => (
                              <TableRow key={row.teamId || 'no-team'} hover>
                                <TableCell sx={{ fontWeight: 500 }}>{row.teamName}</TableCell>
                                {occupationWeekKeys.map((weekKey) => {
                                  const occupationPct = row.weekOccupation.get(weekKey) ?? null;
                                  return (
                                    <TableCell
                                      key={`${row.teamId || 'no-team'}:${weekKey}`}
                                      align="center"
                                      sx={{ backgroundColor: getOccupationCellBackground(occupationPct, 'team') }}
                                    >
                                      {occupationPct != null ? `${occupationPct}%` : '-'}
                                    </TableCell>
                                  );
                                })}
                              </TableRow>
                            ))}
                          </TableBody>
                          <TableFooter>
                            <TableRow sx={{ backgroundColor: 'action.hover' }}>
                              <TableCell sx={{ fontWeight: 500 }}>{t('planning.roadmap.occupation.avg')}</TableCell>
                              {occupationWeekKeys.map((weekKey) => {
                                const avg = teamOccupationAverages.get(weekKey) ?? null;
                                return (
                                  <TableCell
                                    key={`team-avg:${weekKey}`}
                                    align="center"
                                    sx={{
                                      fontWeight: 500,
                                      backgroundColor: getOccupationCellBackground(avg, 'team'),
                                    }}
                                  >
                                    {avg != null ? `${avg}%` : '-'}
                                  </TableCell>
                                );
                              })}
                            </TableRow>
                          </TableFooter>
                        </Table>
                      )}
                    </Paper>
                  )}
                </Stack>
              )}
            </Box>
            </Collapse>
          </Paper>

          <Paper variant="outlined" sx={{ p: 1 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              alignItems={{ xs: 'stretch', sm: 'center' }}
              sx={{ px: 1, py: 0.5 }}
            >
              <Typography variant="subtitle2" sx={{ flex: 1, fontWeight: 500 }}>
                {t('planning.roadmap.gantt.title')}
              </Typography>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                {activeGanttFocusScope && (
                  <ToggleButtonGroup
                    size="small"
                    value={ganttContributionVisibility}
                    exclusive
                    onChange={(_, value: GanttContributionVisibility | null) => {
                      if (value) setGanttContributionVisibility(value);
                    }}
                  >
                    <ToggleButton value="primary_only">{t('planning.roadmap.gantt.primaryOnly')}</ToggleButton>
                    <ToggleButton value="all">{t('planning.roadmap.gantt.all')}</ToggleButton>
                  </ToggleButtonGroup>
                )}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={showReservations}
                      onChange={(event) => setShowReservations(event.target.checked)}
                    />
                  }
                  label={t('planning.roadmap.gantt.showReservations')}
                />
                <Tooltip title={t('planning.roadmap.gantt.exportPng')}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleExportGanttPng}
                      disabled={ganttProjects.length === 0}
                      aria-label={t('planning.roadmap.gantt.exportPng')}
                    >
                      <ImageIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
            {activeGanttFocusScope && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, pb: 0.5 }} flexWrap="wrap" useFlexGap>
                <Typography variant="body2" color="text.secondary">{activeGanttFocusScope === 'contributor' ? t('planning.roadmap.gantt.contributorView') : t('planning.roadmap.gantt.teamView')}</Typography>
                {hiddenSupportSummary && (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                    <StatusDot color={getDotColor('warning', mode)} />
                    <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('planning.roadmap.gantt.hiddenSupport', { count: hiddenSupportSummary.count, days: formatRoadmapDays(locale, hiddenSupportSummary.totalDays, 1) })}</Typography>
                  </Box>
                )}
              </Stack>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ px: 1, py: 0.5 }} useFlexGap flexWrap="wrap">
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
                <InputLabel>{t('planning.filters.category')}</InputLabel>
                <Select
                  value={ganttCategoryId}
                  label={t('planning.filters.category')}
                  onChange={(event) => setGanttCategoryId(event.target.value)}
                >
                  <MenuItem value="">{t('planning.filters.allCategories')}</MenuItem>
                  {ganttCategoryOptions.map((category) => (
                    <MenuItem key={category.id} value={category.id}>
                      {category.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
                <InputLabel>{t('reports.weekly.filters.stream')}</InputLabel>
                <Select
                  value={ganttStreamId}
                  label={t('reports.weekly.filters.stream')}
                  onChange={(event) => setGanttStreamId(event.target.value)}
                >
                  <MenuItem value="">{t('reports.weekly.filters.allStreams')}</MenuItem>
                  {ganttStreamOptions.map((stream) => (
                    <MenuItem key={stream.id} value={stream.id}>
                      {stream.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
                <InputLabel>{t('planning.roadmap.occupation.contributor')}</InputLabel>
                <Select
                  value={ganttContributorId}
                  label={t('planning.roadmap.occupation.contributor')}
                  onChange={(event) => setGanttContributorId(event.target.value)}
                >
                  <MenuItem value="">{t('planning.roadmap.filters.allContributors')}</MenuItem>
                  {ganttContributorOptions.map((contributor) => (
                    <MenuItem key={contributor.id} value={contributor.id}>
                      {contributor.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}>
                <InputLabel>{t('planning.roadmap.occupation.team')}</InputLabel>
                <Select
                  value={ganttTeamId}
                  label={t('planning.roadmap.occupation.team')}
                  onChange={(event) => setGanttTeamId(event.target.value)}
                >
                  <MenuItem value="">{t('planning.roadmap.filters.allTeams')}</MenuItem>
                  {ganttTeamOptions.map((team) => (
                    <MenuItem key={team.id} value={team.id}>
                      {team.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}>
                <InputLabel>{t('reports.weekly.filters.source')}</InputLabel>
                <Select
                  value={ganttSourceId}
                  label={t('reports.weekly.filters.source')}
                  onChange={(event) => setGanttSourceId(event.target.value)}
                >
                  <MenuItem value="">{t('planning.roadmap.filters.allSources')}</MenuItem>
                  {ganttSourceOptions.map((source) => (
                    <MenuItem key={source.id} value={source.id}>
                      {source.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ px: 1, pb: 0.5, display: 'block' }}>
              {t('planning.roadmap.gantt.legend')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ px: 1, pb: 1, display: 'block' }}>
              {t('planning.roadmap.gantt.dragHelp')}
            </Typography>
            <LightModeIsland sx={{ p: 1 }}>
              <Box sx={{ height: `${ganttHeight}px` }}>
                <PortfolioGantt
                  projects={ganttProjects}
                  dependencies={ganttDependencies}
                  milestones={[]}
                  onProjectClick={openExplanation}
                  onProjectPinStart={loading ? undefined : (projectId, startWeek) => setScenarioPinStart(projectId, startWeek)}
                  readOnly
                  openOnDoubleClick={false}
                  months={monthsForGantt}
                  monthOffset={monthOffsetForGantt}
                />
              </Box>
            </LightModeIsland>
          </Paper>

          {canEditProjectDates && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Typography variant="body2" color="text.secondary">
                  {t('planning.roadmap.apply.summary', { count: selectedSchedulableCount })}
                </Typography>
                <Button
                  variant="contained"
                  color="primary"
                  disabled={selectedSchedulableCount === 0 || applying}
                  onClick={() => setConfirmOpen(true)}
                  startIcon={applying ? <CircularProgress size={16} /> : undefined}
                >
                  {applying ? t('planning.roadmap.apply.applying') : t('planning.roadmap.apply.button')}
                </Button>
              </Stack>
            </Paper>
          )}
        </>
      )}

      <Drawer
        anchor="right"
        open={!!selectedExplanation}
        onClose={closeExplanation}
        ModalProps={{ keepMounted: true }}
        PaperProps={{
          sx: {
            top: { xs: 56, sm: 64 },
            height: { xs: 'calc(100% - 56px)', sm: 'calc(100% - 64px)' },
          },
        }}
      >
        <Box sx={{ width: { xs: '100vw', sm: 420 }, p: 2, pb: 3, overflowY: 'auto' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
            <Box>
              <Typography variant="overline" color="text.secondary">
                {t('planning.roadmap.explain.overline')}
              </Typography>
              <Typography variant="h6">{selectedExplanationTitle}</Typography>
            </Box>
            <Button size="small" onClick={closeExplanation}>{t('common:buttons.close')}</Button>
          </Stack>

          {selectedExplanation && (
            <Stack spacing={2} sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="body2" color="text.secondary">{t(`planning.roadmap.classifications.${selectedExplanation.classification}`)}</Typography>
                <Typography variant="body2" color="text.secondary">{t(`planning.roadmap.schedulingModes.${selectedExplanation.schedulingMode}`)}</Typography>
              </Stack>

              <Box>
                <Typography variant="body2">{selectedExplanationTexts?.summary}</Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  {t('planning.roadmap.explain.whyStart')}
                </Typography>
                <Stack spacing={0.5}>
                  <Typography variant="body2">
                    {t('planning.roadmap.explain.startReason', { reason: t(`planning.roadmap.startReasons.${selectedExplanation.startReason}`) })}
                  </Typography>
                  <Typography variant="body2">
                    {t('planning.roadmap.explain.earliestWeek', { week: formatRoadmapDate(t, locale, selectedExplanation.earliestEligibleWeek) })}
                  </Typography>
                  <Typography variant="body2">
                    {t('planning.roadmap.explain.actualWeek', { week: selectedExplanation.actualStartWeek ? formatRoadmapDate(t, locale, selectedExplanation.actualStartWeek) : t('planning.roadmap.explain.notScheduled') })}
                  </Typography>
                  {selectedExplanationTexts?.finalReason && (
                    <Typography variant="body2" color="text.secondary">
                      {selectedExplanationTexts.finalReason}
                    </Typography>
                  )}
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  {t('planning.roadmap.explain.whyNotEarlier')}
                </Typography>
                <Stack spacing={1}>
                  {selectedExplanation.blockerReasons.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t('planning.roadmap.explain.noBlockers')}
                    </Typography>
                  )}
                  {selectedExplanation.blockerReasons.map((reason, index) => (
                    <Paper key={`${reason.kind}:${reason.projectId || 'none'}:${index}`} variant="outlined" sx={{ p: 1.25 }}>
                      <Typography variant="body2">{formatReasonLabel(t, locale, reason)}</Typography>
                      {(reason.fromWeek || reason.toWeek) && (
                        <Typography variant="caption" color="text.secondary">
                          {t('planning.roadmap.explain.range', { from: reason.fromWeek ? formatRoadmapDate(t, locale, reason.fromWeek) : t('planning.roadmap.explain.unknown'), to: reason.toWeek ? formatRoadmapDate(t, locale, reason.toWeek) : t('planning.roadmap.explain.unknown') })}
                        </Typography>
                      )}
                    </Paper>
                  ))}
                </Stack>
              </Box>

              <Divider />

              {selectedFocusTimeline && activeGanttFocusScope && (
                <>
                  <Box>
                    <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                      {activeGanttFocusScope === 'contributor' ? t('planning.roadmap.explain.contributorTimeline') : t('planning.roadmap.explain.teamTimeline')}
                    </Typography>
                    <Stack spacing={1}>
                      <Typography variant="body2">
                        {t('planning.roadmap.explain.focusWindow', {
                          name: 'contributorName' in selectedFocusTimeline
                            ? selectedFocusTimeline.contributorName
                            : selectedFocusTimeline.teamName,
                          start: formatRoadmapDate(t, locale, selectedFocusTimeline.activeStart),
                          end: formatRoadmapDate(t, locale, selectedFocusTimeline.activeEnd),
                        })}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {t('planning.roadmap.explain.plannedContribution', { days: formatRoadmapDays(locale, selectedFocusTimeline.totalProjectDays), count: selectedFocusTimeline.weekDetails.length })}
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <StatusDot color={getDotColor(selectedFocusTimeline.significance === 'primary' ? 'success' : 'warning', mode)} />
                          <Typography variant="body2" sx={{ color: getDotColor(selectedFocusTimeline.significance === 'primary' ? 'success' : 'warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>
                            {selectedFocusTimeline.significance === 'primary' ? t('planning.roadmap.explain.primaryWork') : t('planning.roadmap.explain.supportWork')}
                          </Typography>
                        </Box>
                        {selectedFocusTimeline.contributionShare != null && (
                          <Typography variant="body2" color="text.secondary">{t('planning.roadmap.explain.shareOfEffort', { percent: Math.round(selectedFocusTimeline.contributionShare * 100) })}</Typography>
                        )}
                        <Typography variant="body2" color="text.secondary">{t('planning.roadmap.explain.avgPerWeek', { days: formatRoadmapDays(locale, selectedFocusTimeline.averageDaysPerWeek) })}</Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {selectedFocusTimeline.significance === 'primary'
                          ? t('planning.roadmap.explain.primaryHelp')
                          : t('planning.roadmap.explain.supportHelp')}
                      </Typography>
                      {selectedFocusTimeline.weekDetails.map((detail) => (
                        <Paper key={`${selectedFocusTimeline.projectId}:${detail.week}`} variant="outlined" sx={{ p: 1.25 }}>
                          <Typography variant="body2">{t('planning.roadmap.explain.weekOf', { week: formatRoadmapDate(t, locale, detail.week) })}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {t('planning.roadmap.explain.projectLoad', { days: formatRoadmapDays(locale, detail.projectDays) })}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {t('planning.roadmap.explain.weeklyCapacity', { value: detail.capacityDays != null ? t('planning.roadmap.values.days', { days: formatRoadmapDays(locale, detail.capacityDays) }) : t('planning.roadmap.values.na') })}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {t('planning.roadmap.explain.totalAssigned', { days: formatRoadmapDays(locale, detail.totalWeekEffortDays) })}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            {t('planning.roadmap.explain.weeklyOccupation', { value: detail.occupationPct != null ? t('planning.roadmap.values.percent', { value: Math.round(detail.occupationPct) }) : t('planning.roadmap.values.na') })}
                          </Typography>
                        </Paper>
                      ))}
                    </Stack>
                  </Box>

                  <Divider />
                </>
              )}

              {hasContributorLoads(selectedExplanationProject) && (
                <Box>
                  <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                    {t('planning.roadmap.explain.projectContributors')}
                  </Typography>
                  <Stack spacing={1}>
                    {selectedExplanationProject.plannedStart && (
                      <Typography variant="body2" color="text.secondary">
                        {t('planning.roadmap.explain.scheduledWindow', { start: formatRoadmapDate(t, locale, selectedExplanationProject.plannedStart), end: formatRoadmapDate(t, locale, selectedExplanationProject.plannedEnd) })}
                      </Typography>
                    )}
                    {selectedExplanationProject.contributorLoads.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {t('planning.roadmap.explain.noLoads')}
                      </Typography>
                    )}
                    {selectedExplanationProject.contributorLoads.map((load) => (
                      <Paper key={load.contributorId} variant="outlined" sx={{ p: 1.25 }}>
                        <Typography variant="body2">{load.contributorName}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {t('planning.roadmap.explain.plannedLoad', { days: formatRoadmapDays(locale, load.days) })}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          {t('planning.roadmap.explain.weeklyCapacity', {
                            value: t('planning.roadmap.values.days', {
                              days: formatRoadmapDays(
                                locale,
                                selectedExplanation.limitingContributors.find((item) => item.contributorId === load.contributorId)?.weeklyCapacity
                                ?? 0,
                              ),
                            }),
                          })}
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              )}

              {hasContributorLoads(selectedExplanationProject) && <Divider />}

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  {t('planning.roadmap.explain.limiting')}
                </Typography>
                <Stack spacing={1}>
                  {selectedExplanation.limitingContributors.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t('planning.roadmap.explain.noLimiting')}
                    </Typography>
                  )}
                  {selectedExplanation.limitingContributors.map((contributor) => (
                    <Paper key={contributor.contributorId} variant="outlined" sx={{ p: 1.25 }}>
                      <Typography variant="body2">{contributor.contributorName}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {t(`planning.roadmap.contributorReasons.${contributor.reason}`)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {t('planning.roadmap.explain.weeklyCapacity', { value: t('planning.roadmap.values.days', { days: formatRoadmapDays(locale, contributor.weeklyCapacity) }) })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {t('planning.roadmap.explain.reservedLoad', { value: contributor.reservedLoad != null ? t('planning.roadmap.values.days', { days: formatRoadmapDays(locale, contributor.reservedLoad) }) : t('planning.roadmap.values.na') })}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {t('planning.roadmap.explain.activeProjects', { value: contributor.activeProjectCount != null ? contributor.activeProjectCount : t('planning.roadmap.values.na') })}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  {t('planning.roadmap.explain.activeOverrides')}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedExplanation.activeConstraint
                    ? formatRoadmapConstraint(t, locale, selectedExplanation.activeConstraint)
                    : t('planning.roadmap.explain.noOverrides')}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  {t('planning.roadmap.explain.finalWarnings')}
                </Typography>
                <Stack spacing={1}>
                  {selectedExplanationWarnings.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      {t('planning.roadmap.explain.noWarnings')}
                    </Typography>
                  )}
                  {selectedExplanationWarnings.map((warning, index) => (
                    <Alert key={`${warning.code}:${index}`} severity={warning.severity}>
                      {formatWarning(warning)}
                    </Alert>
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}
        </Box>
      </Drawer>

      <Dialog open={!!pinDialogProjectId} onClose={() => !loading && closePinDialog()} maxWidth="xs" fullWidth>
        <DialogTitle>{t('planning.roadmap.actions.pinStart')}</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <DialogContentText>
              {t('planning.roadmap.pinDialog.description', { project: pinDialogProjectName || t('planning.roadmap.pinDialog.thisProject') })}
            </DialogContentText>
            <DateEUField
              label={t('planning.roadmap.pinDialog.startWeek')}
              valueYmd={pinDialogWeek}
              onChangeYmd={setPinDialogWeek}
              required
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={closePinDialog} disabled={loading}>
            {t('common:buttons.cancel')}
          </Button>
          <Button variant="action"
            onClick={() => { void handleClearPinDialog(); }}
            disabled={loading || !(pinDialogProjectId && projectOverrideById.get(pinDialogProjectId)?.constraint)}
          >
            {t('common:buttons.clear')}
          </Button>
          <Button
            variant="action-primary"
            onClick={() => { void handleSavePinDialog(); }}
            disabled={loading || !pinDialogProjectId || !pinDialogWeek}
          >
            {t('planning.roadmap.pinDialog.save')}
          </Button>
        </DialogActions>
      </Dialog>

      <KanapDialog
        open={confirmOpen}
        title={t('planning.roadmap.apply.dialogTitle')}
        onClose={() => { if (!applying) setConfirmOpen(false); }}
        onSave={handleApply}
        saveLabel={t('planning.roadmap.apply.button')}
        saveDisabled={selectedSchedulableCount === 0}
        saveLoading={applying}
      >
        <Typography sx={{ fontSize: 13.5, color: 'kanap.text.primary' }}>
          {t('planning.roadmap.apply.confirm', { count: selectedSchedulableCount })}
        </Typography>
      </KanapDialog>
    </Stack>
  );
}
