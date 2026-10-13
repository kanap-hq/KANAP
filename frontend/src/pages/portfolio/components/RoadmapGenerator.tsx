import { useMemo, useState } from 'react';
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
import FileDownloadIcon from '@mui/icons-material/FileDownload';
import ImageIcon from '@mui/icons-material/Image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import api from '../../../api';
import { KanapDialog, StatusDot } from '../../../components/design';
import LightModeIsland from '../../../components/LightModeIsland';
import { useLocale } from '../../../i18n/useLocale';
import { PortfolioGantt } from './PortfolioGantt';
import { computeInactiveSegments } from './roadmap-inactive-segments';
import { getDotColor, PROJECT_STATUS_COLORS } from '../../../utils/statusColors';
import { kanapPalette, modeVal } from '../../tasks/theme/taskDetailTokens';
import { downloadXlsxWorkbook } from '../../../lib/simpleXlsx';

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

type ContributorOccupationRow = {
  contributorId: string;
  contributorName: string;
  teamId: string | null;
  teamName: string;
  weekOccupation: Map<string, number | null>;
};

type ContributorOccupationGroup = {
  teamId: string | null;
  teamName: string;
  rows: ContributorOccupationRow[];
};

type TeamOccupationRow = {
  teamId: string | null;
  teamName: string;
  weekOccupation: Map<string, number | null>;
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

const STATUS_OPTIONS = [
  { value: 'waiting_list', label: 'Waiting List' },
  { value: 'planned', label: 'Planned' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_testing', label: 'In Testing' },
];

const STATUS_LABELS = Object.fromEntries(STATUS_OPTIONS.map((s) => [s.value, s.label]));
const SCHEDULING_MODE_OPTIONS: Array<{ value: SchedulingMode; label: string }> = [
  { value: 'independent', label: 'Independent' },
  { value: 'collaborative', label: 'Collaborative' },
];
const SCHEDULING_MODE_LABELS: Record<SchedulingMode, string> = Object.fromEntries(
  SCHEDULING_MODE_OPTIONS.map((option) => [option.value, option.label]),
) as Record<SchedulingMode, string>;

const REASON_LABELS: Record<string, string> = {
  zero_remaining_effort: 'No Remaining Effort',
  no_assigned_contributors: 'No Contributors',
  missing_blocker_date: 'Missing Blocker Date',
  blocker_on_hold: 'Blocker On Hold',
  blocked_unfinished_project: 'Blocked Unfinished Project',
  expired_fixed_plan: 'Expired Fixed Plan',
  cyclic_dependency: 'Cyclic Dependency',
  not_ready_within_horizon: 'Blocked Beyond Horizon',
  no_free_slot: 'No Free Slot',
  no_effective_capacity: 'No Effective Capacity',
  below_minimum_start_threshold: 'Below Minimum Start Threshold',
  unfinished_within_horizon: 'Started But Not Finished',
  insufficient_capacity: 'Insufficient Capacity',
  missing_contributor_capacity: 'Missing Contributor Capacity',
};

const RESERVATION_REASON_LABELS: Record<ReservationReason, string> = {
  not_recalculated: 'Not Recalculated',
  external_blocker: 'External Blocker',
};

const START_REASON_LABELS: Record<ProjectExplanation['startReason'], string> = {
  historical_start: 'Historical start',
  dependency_release: 'Dependency release',
  capacity_available: 'Capacity became available',
  constraint_pin_start: 'Pinned start',
  constraint_pin_window: 'Pinned window',
  constraint_not_before: 'Not before constraint',
  fixed_reservation: 'Fixed reservation',
  unscheduled: 'Unscheduled',
};

const CONTRIBUTOR_REASON_LABELS: Record<ExplanationContributorEntry['reason'], string> = {
  slot: 'Parallel slot limit',
  capacity: 'Capacity pressure',
  collaborative_bottleneck: 'Collaborative bottleneck',
  reservation: 'Reservation pressure',
};

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

const formatConstraint = (constraint: ScheduleConstraint | null | undefined): string => {
  if (!constraint) return 'None';
  switch (constraint.type) {
    case 'pin_start':
      return `Pin start: ${constraint.startWeek}`;
    case 'pin_window':
      return `Pin window: ${constraint.startWeek} to ${constraint.endWeek}`;
    case 'not_before':
      return `Not before: ${constraint.startWeek}`;
    default:
      return 'None';
  }
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

const getIsoWeekParts = (weekStartYmd: string): { week: number; year: number } => {
  const base = new Date(`${weekStartYmd}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return { week: 0, year: 0 };
  const date = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return { week, year };
};

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
  ctx.fillText('Project', 12, 24);

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
};

const exportOccupationAsExcel = (data: OccupationExportData): void => {
  const { weekKeys, contributorGroups, teamRows, contributorAverages, teamAverages } = data;
  const weekHeaders = weekKeys.map((weekKey) => {
    const parts = getIsoWeekParts(weekKey);
    return `W${String(parts.week).padStart(2, '0')} ${parts.year}`;
  });

  // Contributors sheet
  const contributorSheetRows: (string | number | null)[][] = [];
  contributorSheetRows.push(['Team', 'Contributor', ...weekHeaders, 'Average']);
  for (const group of contributorGroups) {
    for (const row of group.rows) {
      const weekValues = weekKeys.map((wk) => row.weekOccupation.get(wk) ?? null);
      const nonNull = weekValues.filter((v): v is number => v != null);
      const avg = nonNull.length > 0 ? Math.round(nonNull.reduce((a, b) => a + b, 0) / nonNull.length) : null;
      contributorSheetRows.push([group.teamName, row.contributorName, ...weekValues, avg]);
    }
  }
  const contributorAvgRow: (string | number | null)[] = ['Avg', ''];
  for (const wk of weekKeys) contributorAvgRow.push(contributorAverages.get(wk) ?? null);
  const allContribNonNull = weekKeys.map((wk) => contributorAverages.get(wk)).filter((v): v is number => v != null);
  contributorAvgRow.push(allContribNonNull.length > 0 ? Math.round(allContribNonNull.reduce((a, b) => a + b, 0) / allContribNonNull.length) : null);
  contributorSheetRows.push(contributorAvgRow);

  // Teams sheet
  const teamSheetRows: (string | number | null)[][] = [];
  teamSheetRows.push(['Team', ...weekHeaders, 'Average']);
  for (const row of teamRows) {
    const weekValues = weekKeys.map((wk) => row.weekOccupation.get(wk) ?? null);
    const nonNull = weekValues.filter((v): v is number => v != null);
    const avg = nonNull.length > 0 ? Math.round(nonNull.reduce((a, b) => a + b, 0) / nonNull.length) : null;
    teamSheetRows.push([row.teamName, ...weekValues, avg]);
  }
  const teamAvgRow: (string | number | null)[] = ['Avg'];
  for (const wk of weekKeys) teamAvgRow.push(teamAverages.get(wk) ?? null);
  const allTeamNonNull = weekKeys.map((wk) => teamAverages.get(wk)).filter((v): v is number => v != null);
  teamAvgRow.push(allTeamNonNull.length > 0 ? Math.round(allTeamNonNull.reduce((a, b) => a + b, 0) / allTeamNonNull.length) : null);
  teamSheetRows.push(teamAvgRow);

  downloadXlsxWorkbook(`roadmap-occupation-${getTodayYmd()}.xlsx`, [
    { name: 'Contributors', rows: contributorSheetRows },
    { name: 'Teams', rows: teamSheetRows },
  ]);
};

const exportOccupationAsPng = async (
  data: OccupationExportData,
  view: OccupationView,
): Promise<void> => {
  const { weekKeys, contributorGroups, teamRows, contributorAverages, teamAverages } = data;

  const weekHeaders = weekKeys.map((weekKey) => {
    const parts = getIsoWeekParts(weekKey);
    return `W${String(parts.week).padStart(2, '0')}`;
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
    labels: view === 'contributor' ? ['Avg', ''] : ['Avg'],
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
  const headerLabels = view === 'contributor' ? ['Team', 'Contributor'] : ['Team'];
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
    ? (explanationSubjectByKey.get(getExplanationKey(selectedExplanation.itemRef) || '') ?? 'Explanation')
    : 'Explanation';
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
          teamName: entry.teamName || 'No team',
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

  const occupationWeekKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const entry of response?.occupation ?? []) keys.add(entry.week);
    for (const entry of response?.teamOccupation ?? []) keys.add(entry.week);
    return Array.from(keys).sort((a, b) => a.localeCompare(b));
  }, [response?.occupation, response?.teamOccupation]);

  const contributorOccupationGroups = useMemo(() => {
    const rowsByContributor = new Map<string, ContributorOccupationRow>();
    for (const entry of response?.occupation ?? []) {
      const existing = rowsByContributor.get(entry.contributorId) ?? {
        contributorId: entry.contributorId,
        contributorName: entry.contributorName,
        teamId: entry.teamId,
        teamName: entry.teamName || 'No team',
        weekOccupation: new Map<string, number | null>(),
      };
      existing.weekOccupation.set(
        entry.week,
        entry.occupationPct == null ? null : Math.round(entry.occupationPct),
      );
      rowsByContributor.set(entry.contributorId, existing);
    }

    const groupsByTeam = new Map<string, ContributorOccupationGroup>();
    for (const row of rowsByContributor.values()) {
      const teamKey = row.teamId || 'no-team';
      const existing = groupsByTeam.get(teamKey) ?? {
        teamId: row.teamId,
        teamName: row.teamName || 'No team',
        rows: [],
      };
      existing.rows.push(row);
      groupsByTeam.set(teamKey, existing);
    }

    const groups = Array.from(groupsByTeam.values());
    groups.sort((a, b) =>
      a.teamName.localeCompare(b.teamName)
      || (a.teamId || '').localeCompare(b.teamId || ''));
    for (const group of groups) {
      group.rows.sort((a, b) =>
        a.contributorName.localeCompare(b.contributorName)
        || a.contributorId.localeCompare(b.contributorId));
    }
    return groups;
  }, [response?.occupation]);

  const teamOccupationRows = useMemo(() => {
    const rowsByTeam = new Map<string, TeamOccupationRow>();
    for (const entry of response?.teamOccupation ?? []) {
      const teamKey = entry.teamId || 'no-team';
      const existing = rowsByTeam.get(teamKey) ?? {
        teamId: entry.teamId,
        teamName: entry.teamName || 'No team',
        weekOccupation: new Map<string, number | null>(),
      };
      existing.weekOccupation.set(
        entry.week,
        entry.occupationPct == null ? null : Math.round(entry.occupationPct),
      );
      rowsByTeam.set(teamKey, existing);
    }

    return Array.from(rowsByTeam.values())
      .sort((a, b) =>
        a.teamName.localeCompare(b.teamName)
        || (a.teamId || '').localeCompare(b.teamId || ''));
  }, [response?.teamOccupation]);

  const contributorOccupationAverages = useMemo(() => {
    const averages = new Map<string, number | null>();
    for (const weekKey of occupationWeekKeys) {
      const values: number[] = [];
      for (const group of contributorOccupationGroups) {
        for (const row of group.rows) {
          const pct = row.weekOccupation.get(weekKey);
          if (pct != null) values.push(pct);
        }
      }
      averages.set(weekKey, values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
    }
    return averages;
  }, [contributorOccupationGroups, occupationWeekKeys]);

  const teamOccupationAverages = useMemo(() => {
    const averages = new Map<string, number | null>();
    for (const weekKey of occupationWeekKeys) {
      const values: number[] = [];
      for (const row of teamOccupationRows) {
        const pct = row.weekOccupation.get(weekKey);
        if (pct != null) values.push(pct);
      }
      averages.set(weekKey, values.length > 0 ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null);
    }
    return averages;
  }, [teamOccupationRows, occupationWeekKeys]);

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
      setError(e?.response?.data?.message || 'Failed to generate roadmap');
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
    if (!response) return;
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
      setSuccess(`Applied roadmap dates to ${selectedProjects.length} project(s).`);
      await queryClient.invalidateQueries({ queryKey: ['portfolio-timeline'] });
      onApplied?.();
    } catch (e: any) {
      const details = e?.response?.data?.details;
      if (Array.isArray(details) && details.length > 0) {
        const first = details[0];
        setApplyError(`${first?.projectId || 'Project'}: ${first?.error || 'Failed to apply roadmap dates'}`);
      } else {
        setApplyError(e?.response?.data?.message || 'Failed to apply roadmap dates');
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
    if (currentMode === nextMode) return;
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
      setSuccess(`Updated scheduling mode to ${SCHEDULING_MODE_LABELS[nextMode]}.`);
    } catch (e: any) {
      setError(e?.response?.data?.message || 'Failed to update scheduling mode');
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
      );
    } catch (error: any) {
      setError(error?.message ? `Failed to export Gantt as PNG: ${error.message}` : 'Failed to export Gantt as PNG');
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
    };
  }, [occupationWeekKeys, contributorOccupationGroups, teamOccupationRows, contributorOccupationAverages, teamOccupationAverages]);

  const handleExportOccupationExcel = () => {
    if (!occupationExportData) return;
    try {
      exportOccupationAsExcel(occupationExportData);
    } catch (err: any) {
      setError(err?.message ? `Failed to export occupation as Excel: ${err.message}` : 'Failed to export occupation as Excel');
    }
  };

  const handleExportOccupationPng = async () => {
    if (!occupationExportData) return;
    try {
      await exportOccupationAsPng(occupationExportData, occupationView);
    } catch (err: any) {
      setError(err?.message ? `Failed to export occupation as PNG: ${err.message}` : 'Failed to export occupation as PNG');
    }
  };

  const hasResponse = !!response;

  return (
    <Stack spacing={2}>
      <Paper variant="outlined" sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
            Roadmap Generator
          </Typography>
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} flexWrap="wrap">
            <TextField
              label="Start Date"
              type="date"
              size="small"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              InputLabelProps={{ shrink: true }}
              sx={{ minWidth: 180 }}
            />

            <FormControl size="small" sx={{ minWidth: 220 }}>
              <InputLabel>Statuses</InputLabel>
              <Select
                multiple
                value={statuses}
                label="Statuses"
                onChange={handleStatusChange}
                renderValue={(selected) => (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {selected.map((status) => (
                      <Box key={status} component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                        <StatusDot color={getDotColor(PROJECT_STATUS_COLORS[status] ?? 'default', mode)} />
                        <Typography variant="body2" sx={{ color: getDotColor(PROJECT_STATUS_COLORS[status] ?? 'default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{STATUS_LABELS[status] || status}</Typography>
                      </Box>
                    ))}
                  </Box>
                )}
              >
                {STATUS_OPTIONS.map((option) => (
                  <MenuItem key={option.value} value={option.value}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Capacity Mode</InputLabel>
              <Select
                value={capacityMode}
                label="Capacity Mode"
                onChange={(e) => setCapacityMode(e.target.value as 'theoretical' | 'historical')}
              >
                <MenuItem value="theoretical">Theoretical</MenuItem>
                <MenuItem value="historical">Historical</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 200 }}>
              <InputLabel>Constraint Scope</InputLabel>
              <Select
                value={capacityConstraintMode}
                label="Constraint Scope"
                onChange={(e) => setCapacityConstraintMode(e.target.value as CapacityConstraintMode)}
              >
                <MenuItem value="full">Full Portfolio</MenuItem>
                <MenuItem value="it_only">IT Only</MenuItem>
              </Select>
            </FormControl>

            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel>Parallel Limit</InputLabel>
              <Select
                value={String(parallelizationLimit)}
                label="Parallel Limit"
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
              <ToggleButton value="priority_focused">Priority Focused</ToggleButton>
              <ToggleButton value="completion_focused">Completion Focused</ToggleButton>
            </ToggleButtonGroup>

            <FormControlLabel
              control={
                <Checkbox
                  checked={includeAlreadyScheduled}
                  onChange={(e) => setIncludeAlreadyScheduled(e.target.checked)}
                />
              }
              label="Recalculate already scheduled projects"
            />
          </Stack>

          <Typography variant="caption" color="text.secondary">
            When enabled, projects that already have planned dates are recalculated and may move.
            {capacityConstraintMode === 'it_only'
              ? ' IT-only hides business capacity, occupation, and pure business projects from the generated roadmap.'
              : ''}
          </Typography>

          <Stack direction={{ xs: 'column', md: 'row' }} spacing={3} alignItems={{ xs: 'stretch', md: 'center' }}>
            <Box sx={{ minWidth: 280 }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                Context-switch penalty: {(contextSwitchPenaltyPct * 100).toFixed(0)}%
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

            <TextField
              label="Context-switch grace"
              type="number"
              size="small"
              value={contextSwitchGrace}
              onChange={(e) => setContextSwitchGrace(Math.max(0, Number(e.target.value || '0')))}
              inputProps={{ min: 0, max: 10 }}
              sx={{ width: 180 }}
            />

            <Box sx={{ flex: 1 }} />
            <Button
              variant="contained"
              onClick={handleGenerate}
              disabled={loading || statuses.length === 0 || !startDate}
            >
              {loading ? 'Generating...' : 'Generate'}
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
              {warning.message}
            </Alert>
          ))}
        </Stack>
      )}

      {!hasResponse && !loading && (
        <Paper variant="outlined" sx={{ p: 3 }}>
          <Typography variant="body2" color="text.secondary">
            Generate a roadmap to preview proposed dates, bottlenecks, and contributor occupation.
          </Typography>
        </Paper>
      )}

      {hasResponse && response && (
        <>
          {activeConstraintOverrides.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2 }}>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 500 }}>
                  Scenario Overrides
                </Typography>
                <Button size="small" color="inherit" onClick={() => { void clearAllScenarioOverrides(); }}>
                  Reset All Overrides
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
                          <Box component="span" sx={{ color: getDotColor('info', mode), fontSize: '0.8125rem' }}>{formatConstraint(override.constraint)}</Box>
                          {warningCount > 0 && (
                            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                              <StatusDot color={getDotColor('warning', mode)} />
                              <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{`Conflict${warningCount > 1 ? 's' : ''}`}</Typography>
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
                            Edit Pin
                          </Button>
                          <Button size="small" color="inherit" onClick={() => { void clearScenarioOverride(override.projectId); }}>
                            Reset
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
              <Typography variant="body2" color="text.secondary">{`Scheduled: ${response.schedule.length}`}</Typography>
              <Typography variant="body2" color="text.secondary">{`Reservations: ${response.reservations.length}`}</Typography>
              <Typography variant="body2" color="text.secondary">{`External blockers: ${response.diagnostics.reservationByReason?.external_blocker ?? 0}`}</Typography>
              <Typography variant="body2" color="text.secondary">{`Unschedulable: ${response.unschedulable.length}`}</Typography>
              <Typography variant="body2" color="text.secondary">{`Roadmap end: ${response.roadmapEndDate || 'N/A'}`}</Typography>
              <Typography variant="body2" color="text.secondary">{`Run: ${response.diagnostics.runDurationMs} ms`}</Typography>
              <Typography variant="body2" color="text.secondary">{`Sensitivity reruns: ${response.diagnostics.sensitivityReruns}`}</Typography>
              {response.diagnostics.sensitivityTruncated && (
                <Typography variant="body2" sx={{ color: getDotColor('warning', mode) }}>Sensitivity sampled (truncated)</Typography>
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
                Schedule / Bottlenecks / Occupation
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
              <Tab value="schedule" label="Schedule" />
              <Tab value="bottlenecks" label="Bottlenecks" />
              <Tab value="occupation" label="Occupation" />
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
                      {allRowsSelected ? 'Clear Visible Selection' : 'Select Visible'}
                    </Button>
                    <Typography variant="body2" color="text.secondary">
                      {selectedSchedulableCount} selected in Gantt preview
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    Unchecked projects are excluded from the scenario and do not consume capacity.
                  </Typography>

                  <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell padding="checkbox" />
                          <TableCell>Project</TableCell>
                          <TableCell>Status</TableCell>
                          <TableCell>Scheduling</TableCell>
                          <TableCell>Scenario</TableCell>
                          <TableCell>Start</TableCell>
                          <TableCell>End</TableCell>
                          <TableCell>Weeks</TableCell>
                          <TableCell align="right">Priority</TableCell>
                          <TableCell align="right">Explain</TableCell>
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
                                      <Typography variant="body2" sx={{ color: getDotColor('info', mode), fontWeight: 500, fontSize: '0.8125rem' }}>Pinned</Typography>
                                    </Box>
                                  )}
                                  {hasConstraintConflict && (
                                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                      <StatusDot color={getDotColor('warning', mode)} />
                                      <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>Conflict</Typography>
                                    </Box>
                                  )}
                                </Stack>
                              </TableCell>
                              <TableCell>{STATUS_LABELS[status] || status}</TableCell>
                              <TableCell>
                                <Select
                                  size="small"
                                  value={schedulingMode}
                                  onChange={(event) => {
                                    void handleSchedulingModeChange(
                                      project.projectId,
                                      schedulingMode,
                                      event.target.value as SchedulingMode,
                                    );
                                  }}
                                  disabled={loading || isSavingSchedulingMode}
                                  sx={{ minWidth: 150 }}
                                >
                                  {SCHEDULING_MODE_OPTIONS.map((option) => (
                                    <MenuItem key={option.value} value={option.value}>
                                      {option.label}
                                    </MenuItem>
                                  ))}
                                </Select>
                              </TableCell>
                              <TableCell>
                                <Stack spacing={0.75} alignItems="flex-start">
                                  {pinStartValue ? (
                                    <Typography variant="caption" color="text.secondary">
                                      Pin start: {pinStartValue}
                                    </Typography>
                                  ) : (
                                    <Typography variant="caption" color="text.secondary">
                                      No scenario constraint
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
                                      {pinStartValue ? 'Edit Pin' : 'Pin Start'}
                                    </Button>
                                    <Button
                                      size="small"
                                      color="inherit"
                                      disabled={!pinStartValue}
                                      onClick={() => { void clearScenarioOverride(project.projectId); }}
                                    >
                                      Clear
                                    </Button>
                                  </Stack>
                                </Stack>
                              </TableCell>
                              <TableCell>{scenarioProject?.plannedStart || 'Excluded'}</TableCell>
                              <TableCell>{scenarioProject?.plannedEnd || 'Excluded'}</TableCell>
                              <TableCell>{scenarioProject?.durationWeeks ?? 'Excluded'}</TableCell>
                              <TableCell align="right">
                                {priority != null ? priority.toFixed(1) : 'N/A'}
                              </TableCell>
                              <TableCell align="right">
                                <Button
                                  size="small"
                                  onClick={() => openExplanation(project.projectId)}
                                  disabled={!explanationByKey.has(project.projectId)}
                                >
                                  Why?
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
                        Unschedulable Projects
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
                              <Tooltip title={item.details || ''} placement="top-start">
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                  {item.projectName} ({SCHEDULING_MODE_LABELS[item.schedulingMode]}): {REASON_LABELS[item.reason] || item.reason}
                                </Typography>
                              </Tooltip>
                              <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                                {pinStartValue && (
                                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                    <StatusDot color={getDotColor('info', mode)} />
                                    <Typography variant="body2" sx={{ color: getDotColor('info', mode), fontWeight: 500, fontSize: '0.8125rem' }}>Pinned</Typography>
                                  </Box>
                                )}
                                {hasConstraintConflict && (
                                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                    <StatusDot color={getDotColor('warning', mode)} />
                                    <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>Conflict</Typography>
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
                                {pinStartValue ? 'Edit Pin' : 'Pin Start'}
                              </Button>
                              <Button
                                size="small"
                                color="inherit"
                                disabled={!pinStartValue}
                                onClick={() => { void clearScenarioOverride(item.projectId); }}
                              >
                                Clear
                              </Button>
                              <Button
                                size="small"
                                onClick={() => openExplanation(item.projectId)}
                                disabled={!explanationByKey.has(item.projectId)}
                              >
                                Why?
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
                        Capacity Reservations
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                        These projects are not recalculated but still reserve contributor capacity.
                      </Typography>
                      <Paper variant="outlined" sx={{ overflowX: 'auto' }}>
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell>Project</TableCell>
                              <TableCell>Reason</TableCell>
                              <TableCell>Status</TableCell>
                              <TableCell>Scheduling</TableCell>
                              <TableCell>Start</TableCell>
                              <TableCell>End</TableCell>
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
                                  <TableCell>{RESERVATION_REASON_LABELS[project.reason]}</TableCell>
                                  <TableCell>{STATUS_LABELS[project.status] || project.status}</TableCell>
                                  <TableCell>
                                    <Select
                                      size="small"
                                      value={project.schedulingMode}
                                      onChange={(event) => {
                                        void handleSchedulingModeChange(
                                          project.projectId,
                                          project.schedulingMode,
                                          event.target.value as SchedulingMode,
                                        );
                                      }}
                                      disabled={loading || isSavingSchedulingMode}
                                      sx={{ minWidth: 150 }}
                                    >
                                      {SCHEDULING_MODE_OPTIONS.map((option) => (
                                        <MenuItem key={option.value} value={option.value}>
                                          {option.label}
                                        </MenuItem>
                                      ))}
                                    </Select>
                                  </TableCell>
                                  <TableCell>{project.plannedStart}</TableCell>
                                  <TableCell>{project.plannedEnd}</TableCell>
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
                      No bottleneck data available.
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
                              aria-label={isExpanded ? 'Collapse contributor projects' : 'Expand contributor projects'}
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
                            {item.impactDays} day(s)
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
                                  <TableCell>Project name</TableCell>
                                  <TableCell>Project start date</TableCell>
                                  <TableCell>Project end date</TableCell>
                                  <TableCell align="right">Total Contribution (days)</TableCell>
                                  <TableCell align="right">Time already spent (days)</TableCell>
                                </TableRow>
                              </TableHead>
                              <TableBody>
                                {contributorRows.length === 0 && (
                                  <TableRow>
                                    <TableCell colSpan={5}>
                                      <Typography variant="body2" color="text.secondary">
                                        No scheduled projects for this contributor in the current scenario.
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
                                    <TableCell>{row.plannedStart}</TableCell>
                                    <TableCell>{row.plannedEnd}</TableCell>
                                    <TableCell align="right">{row.totalContributionDays.toFixed(1)}</TableCell>
                                    <TableCell align="right">{row.spentDays.toFixed(1)}</TableCell>
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
                      <ToggleButton value="contributor">Contributors</ToggleButton>
                      <ToggleButton value="team">Teams</ToggleButton>
                    </ToggleButtonGroup>
                    <Tooltip title="Export occupation as Excel">
                      <span>
                        <IconButton
                          size="small"
                          onClick={handleExportOccupationExcel}
                          disabled={!occupationExportData}
                          aria-label="Export occupation as Excel"
                        >
                          <FileDownloadIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Export occupation as PNG">
                      <span>
                        <IconButton
                          size="small"
                          onClick={handleExportOccupationPng}
                          disabled={!occupationExportData}
                          aria-label="Export occupation as PNG"
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
                          No contributor occupation data available.
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ minWidth: 160 }}>Team</TableCell>
                              <TableCell sx={{ minWidth: 220 }}>Contributor</TableCell>
                              {occupationWeekKeys.map((weekKey) => {
                                const isoWeek = getIsoWeekParts(weekKey);
                                return (
                                  <TableCell key={`contributor-week:${weekKey}`} align="center" sx={{ minWidth: 74 }}>
                                    <Stack spacing={0} alignItems="center">
                                      <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                        W{String(isoWeek.week).padStart(2, '0')}
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
                              <TableCell colSpan={2} sx={{ fontWeight: 500 }}>Avg</TableCell>
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
                          No team occupation data available.
                        </Typography>
                      ) : (
                        <Table size="small">
                          <TableHead>
                            <TableRow>
                              <TableCell sx={{ minWidth: 220 }}>Team</TableCell>
                              {occupationWeekKeys.map((weekKey) => {
                                const isoWeek = getIsoWeekParts(weekKey);
                                return (
                                  <TableCell key={`team-week:${weekKey}`} align="center" sx={{ minWidth: 74 }}>
                                    <Stack spacing={0} alignItems="center">
                                      <Typography variant="caption" sx={{ fontWeight: 500 }}>
                                        W{String(isoWeek.week).padStart(2, '0')}
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
                              <TableCell sx={{ fontWeight: 500 }}>Avg</TableCell>
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
                Read-only Gantt
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
                    <ToggleButton value="primary_only">Primary Only</ToggleButton>
                    <ToggleButton value="all">All</ToggleButton>
                  </ToggleButtonGroup>
                )}
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={showReservations}
                      onChange={(event) => setShowReservations(event.target.checked)}
                    />
                  }
                  label="Show reservations"
                />
                <Tooltip title="Export Gantt as PNG">
                  <span>
                    <IconButton
                      size="small"
                      onClick={handleExportGanttPng}
                      disabled={ganttProjects.length === 0}
                      aria-label="Export Gantt as PNG"
                    >
                      <ImageIcon fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
              </Stack>
            </Stack>
            {activeGanttFocusScope && (
              <Stack direction="row" spacing={1} alignItems="center" sx={{ px: 1, pb: 0.5 }} flexWrap="wrap" useFlexGap>
                <Typography variant="body2" color="text.secondary">{activeGanttFocusScope === 'contributor' ? 'Contributor Significance View' : 'Team Significance View'}</Typography>
                {hiddenSupportSummary && (
                  <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                    <StatusDot color={getDotColor('warning', mode)} />
                    <Typography variant="body2" sx={{ color: getDotColor('warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{`Hidden support work: ${hiddenSupportSummary.count} project(s), ${hiddenSupportSummary.totalDays.toFixed(1)}d`}</Typography>
                  </Box>
                )}
              </Stack>
            )}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'stretch', sm: 'center' }} sx={{ px: 1, py: 0.5 }} useFlexGap flexWrap="wrap">
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
                <InputLabel>Category</InputLabel>
                <Select
                  value={ganttCategoryId}
                  label="Category"
                  onChange={(event) => setGanttCategoryId(event.target.value)}
                >
                  <MenuItem value="">All Categories</MenuItem>
                  {ganttCategoryOptions.map((category) => (
                    <MenuItem key={category.id} value={category.id}>
                      {category.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
                <InputLabel>Stream</InputLabel>
                <Select
                  value={ganttStreamId}
                  label="Stream"
                  onChange={(event) => setGanttStreamId(event.target.value)}
                >
                  <MenuItem value="">All Streams</MenuItem>
                  {ganttStreamOptions.map((stream) => (
                    <MenuItem key={stream.id} value={stream.id}>
                      {stream.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 200 } }}>
                <InputLabel>Contributor</InputLabel>
                <Select
                  value={ganttContributorId}
                  label="Contributor"
                  onChange={(event) => setGanttContributorId(event.target.value)}
                >
                  <MenuItem value="">All Contributors</MenuItem>
                  {ganttContributorOptions.map((contributor) => (
                    <MenuItem key={contributor.id} value={contributor.id}>
                      {contributor.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}>
                <InputLabel>Team</InputLabel>
                <Select
                  value={ganttTeamId}
                  label="Team"
                  onChange={(event) => setGanttTeamId(event.target.value)}
                >
                  <MenuItem value="">All Teams</MenuItem>
                  {ganttTeamOptions.map((team) => (
                    <MenuItem key={team.id} value={team.id}>
                      {team.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl size="small" sx={{ minWidth: { xs: '100%', sm: 180 } }}>
                <InputLabel>Source</InputLabel>
                <Select
                  value={ganttSourceId}
                  label="Source"
                  onChange={(event) => setGanttSourceId(event.target.value)}
                >
                  <MenuItem value="">All Sources</MenuItem>
                  {ganttSourceOptions.map((source) => (
                    <MenuItem key={source.id} value={source.id}>
                      {source.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ px: 1, pb: 0.5, display: 'block' }}>
              Solid bar shows active scheduled work. Dashed lead-in marks earlier historical start with pause before resumed work. Hatched bars are capacity reservations. Dotted overlay marks scheduling gaps; diagonal gray overlay marks on-hold periods.
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ px: 1, pb: 1, display: 'block' }}>
              Drag a project bar to create or update a scenario-only pinned start. Click a project bar to open its explanation.
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
                  months={monthsForGantt}
                  monthOffset={monthOffsetForGantt}
                />
              </Box>
            </LightModeIsland>
          </Paper>

          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} justifyContent="space-between" alignItems={{ xs: 'stretch', sm: 'center' }}>
              <Typography variant="body2" color="text.secondary">
                Apply dates to {selectedSchedulableCount} selected visible project(s)
              </Typography>
              <Button
                variant="contained"
                color="primary"
                disabled={selectedSchedulableCount === 0 || applying}
                onClick={() => setConfirmOpen(true)}
                startIcon={applying ? <CircularProgress size={16} /> : undefined}
              >
                {applying ? 'Applying...' : 'Apply Dates'}
              </Button>
            </Stack>
          </Paper>
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
                Explainability
              </Typography>
              <Typography variant="h6">{selectedExplanationTitle}</Typography>
            </Box>
            <Button size="small" onClick={closeExplanation}>Close</Button>
          </Stack>

          {selectedExplanation && (
            <Stack spacing={2} sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Typography variant="body2" color="text.secondary">{selectedExplanation.classification}</Typography>
                <Typography variant="body2" color="text.secondary">{SCHEDULING_MODE_LABELS[selectedExplanation.schedulingMode]}</Typography>
              </Stack>

              <Box>
                <Typography variant="body2">{selectedExplanation.summary}</Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  Why this start week
                </Typography>
                <Stack spacing={0.5}>
                  <Typography variant="body2">
                    Start reason: {START_REASON_LABELS[selectedExplanation.startReason]}
                  </Typography>
                  <Typography variant="body2">
                    Earliest eligible week: {selectedExplanation.earliestEligibleWeek || 'N/A'}
                  </Typography>
                  <Typography variant="body2">
                    Actual start week: {selectedExplanation.actualStartWeek || 'Not scheduled'}
                  </Typography>
                  {selectedExplanation.finalReason && (
                    <Typography variant="body2" color="text.secondary">
                      {selectedExplanation.finalReason}
                    </Typography>
                  )}
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  Why not earlier
                </Typography>
                <Stack spacing={1}>
                  {selectedExplanation.blockerReasons.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No additional blocking details were recorded for this item.
                    </Typography>
                  )}
                  {selectedExplanation.blockerReasons.map((reason, index) => (
                    <Paper key={`${reason.kind}:${reason.projectId || 'none'}:${index}`} variant="outlined" sx={{ p: 1.25 }}>
                      <Typography variant="body2">{reason.label}</Typography>
                      {(reason.fromWeek || reason.toWeek) && (
                        <Typography variant="caption" color="text.secondary">
                          {reason.fromWeek || 'Unknown'} to {reason.toWeek || 'Unknown'}
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
                      {activeGanttFocusScope === 'contributor' ? 'Selected Contributor Timeline' : 'Selected Team Timeline'}
                    </Typography>
                    <Stack spacing={1}>
                      <Typography variant="body2">
                        {'contributorName' in selectedFocusTimeline
                          ? selectedFocusTimeline.contributorName
                          : selectedFocusTimeline.teamName}
                        : {selectedFocusTimeline.activeStart} to {selectedFocusTimeline.activeEnd}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        Planned contribution: {selectedFocusTimeline.totalProjectDays.toFixed(2)}d across {selectedFocusTimeline.weekDetails.length} active week(s)
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <StatusDot color={getDotColor(selectedFocusTimeline.significance === 'primary' ? 'success' : 'warning', mode)} />
                          <Typography variant="body2" sx={{ color: getDotColor(selectedFocusTimeline.significance === 'primary' ? 'success' : 'warning', mode), fontWeight: 500, fontSize: '0.8125rem' }}>
                            {selectedFocusTimeline.significance === 'primary' ? 'Primary roadmap work' : 'Support work'}
                          </Typography>
                        </Box>
                        {selectedFocusTimeline.contributionShare != null && (
                          <Typography variant="body2" color="text.secondary">{`${Math.round(selectedFocusTimeline.contributionShare * 100)}% of project effort`}</Typography>
                        )}
                        <Typography variant="body2" color="text.secondary">{`${selectedFocusTimeline.averageDaysPerWeek.toFixed(2)}d/week avg`}</Typography>
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        {selectedFocusTimeline.significance === 'primary'
                          ? 'This project is shown in the primary roadmap view for the selected focus.'
                          : 'This project is treated as support work and is hidden when the Gantt is set to Primary Only.'}
                      </Typography>
                      {selectedFocusTimeline.weekDetails.map((detail) => (
                        <Paper key={`${selectedFocusTimeline.projectId}:${detail.week}`} variant="outlined" sx={{ p: 1.25 }}>
                          <Typography variant="body2">Week of {detail.week}</Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Project load: {detail.projectDays.toFixed(2)}d
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Weekly capacity: {detail.capacityDays != null ? `${detail.capacityDays.toFixed(2)}d` : 'N/A'}
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Total assigned effort that week: {detail.totalWeekEffortDays.toFixed(2)}d
                          </Typography>
                          <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                            Weekly occupation: {detail.occupationPct != null ? `${Math.round(detail.occupationPct)}%` : 'N/A'}
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
                    Project contributors
                  </Typography>
                  <Stack spacing={1}>
                    {selectedExplanationProject.plannedStart && (
                      <Typography variant="body2" color="text.secondary">
                        Scheduled window: {selectedExplanationProject.plannedStart} to {selectedExplanationProject.plannedEnd}
                      </Typography>
                    )}
                    {selectedExplanationProject.contributorLoads.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        No contributor load details are available for this item.
                      </Typography>
                    )}
                    {selectedExplanationProject.contributorLoads.map((load) => (
                      <Paper key={load.contributorId} variant="outlined" sx={{ p: 1.25 }}>
                        <Typography variant="body2">{load.contributorName}</Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Planned load: {load.days.toFixed(2)}d
                        </Typography>
                        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                          Weekly capacity: {(
                            selectedExplanation.limitingContributors.find((item) => item.contributorId === load.contributorId)?.weeklyCapacity
                            ?? 0
                          ).toFixed(2)}d
                        </Typography>
                      </Paper>
                    ))}
                  </Stack>
                </Box>
              )}

              {hasContributorLoads(selectedExplanationProject) && <Divider />}

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  Limiting contributors
                </Typography>
                <Stack spacing={1}>
                  {selectedExplanation.limitingContributors.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No specific limiting contributors were recorded for this item.
                    </Typography>
                  )}
                  {selectedExplanation.limitingContributors.map((contributor) => (
                    <Paper key={contributor.contributorId} variant="outlined" sx={{ p: 1.25 }}>
                      <Typography variant="body2">{contributor.contributorName}</Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {CONTRIBUTOR_REASON_LABELS[contributor.reason]}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Weekly capacity: {contributor.weeklyCapacity.toFixed(2)}d
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Reserved load: {contributor.reservedLoad != null ? `${contributor.reservedLoad.toFixed(2)}d` : 'N/A'}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        Active projects: {contributor.activeProjectCount != null ? contributor.activeProjectCount : 'N/A'}
                      </Typography>
                    </Paper>
                  ))}
                </Stack>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  Active scenario overrides
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {selectedExplanation.activeConstraint
                    ? formatConstraint(selectedExplanation.activeConstraint)
                    : 'No active scenario overrides for this item.'}
                </Typography>
              </Box>

              <Divider />

              <Box>
                <Typography variant="subtitle2" sx={{ mb: 0.75 }}>
                  Final warnings
                </Typography>
                <Stack spacing={1}>
                  {selectedExplanationWarnings.length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No scenario warnings were recorded for this item.
                    </Typography>
                  )}
                  {selectedExplanationWarnings.map((warning, index) => (
                    <Alert key={`${warning.code}:${index}`} severity={warning.severity}>
                      {warning.message}
                    </Alert>
                  ))}
                </Stack>
              </Box>
            </Stack>
          )}
        </Box>
      </Drawer>

      <Dialog open={!!pinDialogProjectId} onClose={() => !loading && closePinDialog()} maxWidth="xs" fullWidth>
        <DialogTitle>Pin Start</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 0.5 }}>
            <DialogContentText>
              Create or update a scenario-only pin-start constraint for {pinDialogProjectName || 'this project'}.
            </DialogContentText>
            <TextField
              label="Start week"
              type="date"
              size="small"
              value={pinDialogWeek}
              onChange={(event) => setPinDialogWeek(event.target.value)}
              InputLabelProps={{ shrink: true }}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={closePinDialog} disabled={loading}>
            Cancel
          </Button>
          <Button variant="action"
            onClick={() => { void handleClearPinDialog(); }}
            disabled={loading || !(pinDialogProjectId && projectOverrideById.get(pinDialogProjectId)?.constraint)}
          >
            Clear
          </Button>
          <Button
            variant="action-primary"
            onClick={() => { void handleSavePinDialog(); }}
            disabled={loading || !pinDialogProjectId || !pinDialogWeek}
          >
            Save Pin
          </Button>
        </DialogActions>
      </Dialog>

      <KanapDialog
        open={confirmOpen}
        title="Apply roadmap dates"
        onClose={() => { if (!applying) setConfirmOpen(false); }}
        onSave={handleApply}
        saveLabel="Apply dates"
        saveDisabled={selectedSchedulableCount === 0}
        saveLoading={applying}
      >
        <Typography sx={{ fontSize: 13.5, color: 'kanap.text.primary' }}>
          This will update planned start/end dates for {selectedSchedulableCount} selected visible project(s). The change is transactional:
          if one project fails validation, no dates will be applied.
        </Typography>
      </KanapDialog>
    </Stack>
  );
}
