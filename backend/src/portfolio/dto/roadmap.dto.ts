import { z } from 'zod';
import { ProjectSchedulingMode, ProjectStatus } from '../portfolio-project.entity';

const DATE_YMD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** A ceiling on every collection a roadmap request carries, so a huge body fails once. */
const MAX_ROADMAP_COLLECTION = 10_000;

function isValidYmd(value: string): boolean {
  if (!DATE_YMD_REGEX.test(value)) return false;
  const [y, m, d] = value.split('-').map((part) => Number(part));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && (dt.getUTCMonth() + 1) === m && dt.getUTCDate() === d;
}

const YmdDateSchema = z.string()
  .regex(DATE_YMD_REGEX, 'Date must be in YYYY-MM-DD format')
  .refine(isValidYmd, 'Invalid calendar date');

const RoadmapCandidateStatuses = ['waiting_list', 'planned', 'in_progress', 'in_testing'] as const;
const SchedulingModes = ['independent', 'collaborative'] as const;
const AllocationModes = ['auto', 'manual'] as const;

const GenerateStatusesSchema = z.array(z.enum(RoadmapCandidateStatuses))
  .min(1)
  .max(4)
  .default(['waiting_list', 'planned', 'in_progress', 'in_testing']);

const ScheduleConstraintSchema = z.union([
  z.object({
    type: z.literal('pin_start'),
    startWeek: YmdDateSchema,
  }),
  z.object({
    type: z.literal('pin_window'),
    startWeek: YmdDateSchema,
    endWeek: YmdDateSchema,
  }).superRefine((val, ctx) => {
    if (val.endWeek < val.startWeek) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'pin_window.endWeek must be after or equal to pin_window.startWeek',
        path: ['endWeek'],
      });
    }
  }),
  z.object({
    type: z.literal('not_before'),
    startWeek: YmdDateSchema,
  }),
]);

const ScenarioProjectOverrideSchema = z.object({
  projectId: z.string().uuid(),
  schedulingMode: z.enum(SchedulingModes).optional(),
  constraint: ScheduleConstraintSchema.nullable().optional(),
});

const ScenarioAllocationSchema = z.object({
  userId: z.string().uuid(),
  allocationPct: z.number().min(0).max(100),
});

const ScenarioDraftProjectSchema = z.object({
  scenarioProjectId: z.string().min(1),
  sourceRequestId: z.string().uuid().nullable(),
  name: z.string().min(1),
  status: z.literal('planned'),
  schedulingMode: z.enum(SchedulingModes),
  priorityScore: z.number().nullable(),
  estimatedEffortIt: z.number().min(0),
  estimatedEffortBusiness: z.number().min(0),
  executionProgress: z.number().min(0).max(100),
  categoryId: z.string().uuid().nullable(),
  sourceId: z.string().uuid().nullable(),
  streamId: z.string().uuid().nullable(),
  blockerProjectIds: z.array(z.string().uuid()).max(MAX_ROADMAP_COLLECTION).default([]),
  itLeadId: z.string().uuid().nullable(),
  businessLeadId: z.string().uuid().nullable(),
  itAllocationMode: z.enum(AllocationModes),
  businessAllocationMode: z.enum(AllocationModes),
  itAllocations: z.array(ScenarioAllocationSchema).max(MAX_ROADMAP_COLLECTION).default([]),
  businessAllocations: z.array(ScenarioAllocationSchema).max(MAX_ROADMAP_COLLECTION).default([]),
  constraint: ScheduleConstraintSchema.nullable().optional(),
}).superRefine((val, ctx) => {
  const validateManualAllocations = (
    allocations: Array<{ userId?: string; allocationPct?: number }>,
    field: 'itAllocations' | 'businessAllocations',
  ): void => {
    const total = allocations.reduce((sum, allocation) => sum + (allocation.allocationPct ?? 0), 0);
    if (Math.abs(total - 100) > 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} must sum to 100 when allocation mode is manual`,
        path: [field],
      });
    }
  };

  if (val.itAllocationMode === 'manual') {
    validateManualAllocations(val.itAllocations, 'itAllocations');
  }
  if (val.businessAllocationMode === 'manual') {
    validateManualAllocations(val.businessAllocations, 'businessAllocations');
  }
});

const RoadmapScenarioSchema = z.object({
  projectOverrides: z.array(ScenarioProjectOverrideSchema)
    .max(MAX_ROADMAP_COLLECTION)
    .default([])
    .superRefine((overrides, ctx) => {
      const seen = new Set<string>();
      overrides.forEach((entry, index) => {
        if (seen.has(entry.projectId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate projectOverride projectId '${entry.projectId}'`,
            path: [index, 'projectId'],
          });
          return;
        }
        seen.add(entry.projectId);
      });
    }),
  scenarioProjects: z.array(ScenarioDraftProjectSchema)
    .max(MAX_ROADMAP_COLLECTION)
    .default([])
    .superRefine((projects, ctx) => {
      const seen = new Set<string>();
      projects.forEach((project, index) => {
        if (seen.has(project.scenarioProjectId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate scenarioProjectId '${project.scenarioProjectId}'`,
            path: [index, 'scenarioProjectId'],
          });
          return;
        }
        seen.add(project.scenarioProjectId);
      });
    }),
});

export const RoadmapGenerateSchema = z.object({
  startDate: YmdDateSchema,
  statuses: GenerateStatusesSchema,
  capacityMode: z.enum(['theoretical', 'historical']).default('theoretical'),
  capacityConstraintMode: z.enum(['full', 'it_only']).default('full'),
  parallelizationLimit: z.number().int().min(1).max(5).default(1),
  optimizationMode: z.enum(['priority_focused', 'completion_focused']).default('priority_focused'),
  includeAlreadyScheduled: z.boolean().default(true),
  excludedProjectIds: z.array(z.string().uuid()).max(MAX_ROADMAP_COLLECTION).default([]),
  contextSwitchPenaltyPct: z.number().min(0).max(0.5).default(0.05),
  contextSwitchGrace: z.number().int().min(0).max(10).default(1),
  scenario: RoadmapScenarioSchema.optional(),
});

export type RoadmapGenerateInput = z.input<typeof RoadmapGenerateSchema>;
export type RoadmapGenerateDto = z.output<typeof RoadmapGenerateSchema>;

export const RoadmapApplyProjectSchema = z.object({
  projectId: z.string().uuid(),
  plannedStart: YmdDateSchema,
  plannedEnd: YmdDateSchema,
}).superRefine((val, ctx) => {
  if (val.plannedStart > val.plannedEnd) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'plannedStart must be before or equal to plannedEnd',
      path: ['plannedEnd'],
    });
  }
});

export const RoadmapApplySchema = z.object({
  projects: z.array(RoadmapApplyProjectSchema)
    .min(1, 'At least one project is required')
    .max(MAX_ROADMAP_COLLECTION)
    .superRefine((projects, ctx) => {
      const seen = new Set<string>();
      projects.forEach((project, index) => {
        if (seen.has(project.projectId)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `Duplicate projectId '${project.projectId}'`,
            path: [index, 'projectId'],
          });
          return;
        }
        seen.add(project.projectId);
      });
    }),
});

export type RoadmapApplyInput = z.input<typeof RoadmapApplySchema>;
export type RoadmapApplyDto = z.output<typeof RoadmapApplySchema>;

export interface ScheduledProjectContributorLoad {
  contributorId: string;
  contributorName: string;
  days: number;
}

export interface OnHoldRange {
  from: string;
  to: string;
}

export interface ScheduledProject {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  schedulingMode: ProjectSchedulingMode;
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
  contributorLoads: ScheduledProjectContributorLoad[];
  activeWeekStarts: string[];
  onHoldRanges?: OnHoldRange[];
}

export type RoadmapReservationReason = 'not_recalculated' | 'external_blocker';

/**
 * Every sentence the roadmap writes, as a code. The response carries each English text (kept for
 * API and AI readers) next to its code and parameters, so a client writes it in the reader's
 * language. Dates are `YYYY-MM-DD`, day amounts are numbers rounded to two decimals.
 */
export type RoadmapTextCode =
  // Details of an unschedulable project.
  | 'missing_contributor_capacity_for'
  | 'blocker_on_hold'
  | 'blocker_fixed_plan_expired'
  | 'blocker_cannot_be_scheduled'
  | 'missing_blocker_date_for'
  | 'no_free_slot_for'
  | 'no_allocable_capacity_for'
  | 'collaborative_burn_below_threshold'
  | 'collaborative_burn_stalled_for'
  | 'independent_burn_below_threshold'
  | 'no_capacity_remained_for'
  | 'capacity_prevented_scheduling'
  | 'waiting_on_blockers'
  | 'earliest_start_beyond_horizon'
  | 'never_ready_within_horizon'
  | 'remaining_after_horizon'
  | 'no_allocable_week'
  | 'reason'
  // Parts of a list.
  | 'contributor_capacity'
  | 'contributor_remaining_load'
  // Why a project did not start earlier.
  | 'waiting_for'
  | 'waiting_for_until'
  | 'blocker_is_on_hold'
  | 'blocker_has_expired_fixed_plan'
  | 'blocker_is_unschedulable'
  // A constraint the schedule could not honour.
  | 'conflict_pin_start_unsatisfied'
  | 'conflict_pin_start_normalized'
  | 'conflict_pin_start_slipped'
  | 'conflict_pin_window_unsatisfied'
  | 'conflict_pin_window_missed'
  | 'conflict_not_before_violated'
  // Final reason and summary of an explanation, scenario warning.
  | 'final_capacity'
  | 'final_blockers'
  | 'final_started'
  | 'summary_unschedulable'
  | 'summary_historical'
  | 'summary_constraint'
  | 'summary_constraint_conflict'
  | 'summary_capacity'
  | 'summary_blockers'
  | 'summary_schedulable'
  | 'warning_constraint_conflict';

export type RoadmapTextParam =
  | string
  | number
  | null
  | string[]
  | ScheduleConstraint
  | RoadmapText
  | RoadmapText[];

export interface RoadmapText {
  code: RoadmapTextCode;
  params: { [name: string]: RoadmapTextParam };
}

export interface RoadmapReservation {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  schedulingMode: ProjectSchedulingMode;
  categoryId: string | null;
  sourceId: string | null;
  streamId: string | null;
  executionProgress: number;
  plannedStart: string;
  plannedEnd: string;
  reason: RoadmapReservationReason;
  contributorLoads: ScheduledProjectContributorLoad[];
}

export interface UnschedulableProject {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  schedulingMode: ProjectSchedulingMode;
  reason:
    | 'zero_remaining_effort'
    | 'no_assigned_contributors'
    | 'missing_blocker_date'
    | 'blocker_on_hold'
    | 'blocked_unfinished_project'
    | 'expired_fixed_plan'
    | 'cyclic_dependency'
    | 'not_ready_within_horizon'
    | 'no_free_slot'
    | 'no_effective_capacity'
    | 'below_minimum_start_threshold'
    | 'unfinished_within_horizon'
    | 'insufficient_capacity'
    | 'missing_contributor_capacity';
  details?: string;
  detailsText?: RoadmapText;
}

export type ScheduleConstraint =
  | { type: 'pin_start'; startWeek: string }
  | { type: 'pin_window'; startWeek: string; endWeek: string }
  | { type: 'not_before'; startWeek: string };

export interface ScenarioProjectOverrideDto {
  projectId: string;
  schedulingMode?: ProjectSchedulingMode;
  constraint?: ScheduleConstraint | null;
}

export interface ScenarioDraftProjectAllocationDto {
  userId: string;
  allocationPct: number;
}

export interface ScenarioDraftProjectDto {
  scenarioProjectId: string;
  sourceRequestId: string | null;
  name: string;
  status: 'planned';
  schedulingMode: ProjectSchedulingMode;
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
  itAllocations: ScenarioDraftProjectAllocationDto[];
  businessAllocations: ScenarioDraftProjectAllocationDto[];
  constraint?: ScheduleConstraint | null;
}

export interface RoadmapScenarioDto {
  projectOverrides: ScenarioProjectOverrideDto[];
  scenarioProjects: ScenarioDraftProjectDto[];
}

export interface RoadmapItemRef {
  projectId: string | null;
  scenarioProjectId: string | null;
  sourceRequestId: string | null;
  isScenarioProject: boolean;
}

export interface ExplanationReasonEntry {
  kind:
    | 'dependency'
    | 'reservation'
    | 'no_free_slot'
    | 'no_effective_capacity'
    | 'below_minimum_start_threshold'
    | 'constraint_conflict'
    | 'fixed_plan'
    | 'unschedulable_blocker'
    | 'zero_remaining_effort'
    | 'no_assigned_contributors'
    | 'missing_contributor_capacity'
    | 'missing_blocker_date'
    | 'blocker_on_hold'
    | 'cyclic_dependency'
    | 'not_ready_within_horizon'
    | 'unfinished_within_horizon'
    | 'insufficient_capacity';
  label: string;
  labelText: RoadmapText;
  projectId: string | null;
  scenarioProjectId: string | null;
  fromWeek: string | null;
  toWeek: string | null;
}

export interface ExplanationContributorEntry {
  contributorId: string;
  contributorName: string;
  weeklyCapacity: number;
  reservedLoad: number | null;
  activeProjectCount: number | null;
  reason: 'slot' | 'capacity' | 'collaborative_bottleneck' | 'reservation';
}

export interface ProjectExplanation {
  itemRef: RoadmapItemRef;
  summary: string;
  summaryText: RoadmapText;
  classification: 'scheduled' | 'reservation' | 'unschedulable';
  schedulingMode: ProjectSchedulingMode;
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
}

export interface ScenarioWarning {
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
}

export interface RoadmapImpactSummary {
  delayedProjects: number;
  acceleratedProjects: number;
  unchangedProjects: number;
  newlyUnschedulableProjects: number;
  newlyScheduledProjects: number;
  roadmapEndDeltaDays: number | null;
}

export interface BottleneckEntry {
  contributorId: string;
  contributorName: string;
  impactDays: number;
}

export interface OccupationProjectBreakdown {
  projectId: string;
  projectName: string;
  days: number;
}

export interface OccupationEntry {
  contributorId: string;
  contributorName: string;
  teamId: string | null;
  teamName: string | null;
  week: string;
  effortDays: number;
  capacityDays: number | null;
  occupationPct: number | null;
  projects: OccupationProjectBreakdown[];
}

export interface TeamOccupationEntry {
  teamId: string | null;
  teamName: string | null;
  week: string;
  effortDays: number;
  capacityDays: number | null;
  occupationPct: number | null;
}

export interface RoadmapDiagnostics {
  modeLabel: 'priority_focused' | 'completion_focused';
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
}

export interface RoadmapResponse {
  schedule: ScheduledProject[];
  reservations: RoadmapReservation[];
  bottlenecks: BottleneckEntry[];
  occupation: OccupationEntry[];
  teamOccupation: TeamOccupationEntry[];
  roadmapEndDate: string | null;
  unschedulable: UnschedulableProject[];
  explanations: ProjectExplanation[];
  scenarioWarnings: ScenarioWarning[];
  impactSummary: RoadmapImpactSummary | null;
  options: RoadmapGenerateDto;
  diagnostics: RoadmapDiagnostics;
}

export function parseRoadmapGenerate(input: unknown): RoadmapGenerateDto {
  return RoadmapGenerateSchema.parse(input);
}

export function parseRoadmapApply(input: unknown): RoadmapApplyDto {
  return RoadmapApplySchema.parse(input);
}
