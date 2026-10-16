import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PortfolioProject, ProjectSchedulingMode, ProjectStatus } from '../portfolio-project.entity';
import { TeamMemberConfigService } from '../team-member-config.service';
import { PortfolioProjectsCrudService } from './portfolio-projects-crud.service';
import {
  RoadmapApplyDto,
  RoadmapImpactSummary,
  RoadmapItemRef,
  RoadmapGenerateDto,
  RoadmapResponse,
  RoadmapReservation,
  RoadmapReservationReason,
  ProjectExplanation,
  ExplanationContributorEntry,
  ExplanationReasonEntry,
  ScheduleConstraint,
  ScheduledProject,
  ScenarioWarning,
  TeamOccupationEntry,
  UnschedulableProject,
  OccupationEntry,
  OnHoldRange,
  parseRoadmapApply,
  parseRoadmapGenerate,
  BottleneckEntry,
  RoadmapText,
} from '../dto/roadmap.dto';
import { renderRoadmapText, roadmapText } from './roadmap-text';
import { Allocation, computeAutoAllocations } from '../utils/allocation-utils';

type ServiceOpts = { manager?: EntityManager };

type ProjectRow = {
  id: string;
  name: string;
  status: ProjectStatus;
  scheduling_mode: ProjectSchedulingMode;
  category_id: string | null;
  source_id: string | null;
  stream_id: string | null;
  priority_score: number | null;
  execution_progress: number | null;
  estimated_effort_it: number | null;
  estimated_effort_business: number | null;
  it_effort_allocation_mode: 'auto' | 'manual';
  business_effort_allocation_mode: 'auto' | 'manual';
  it_lead_id: string | null;
  business_lead_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  actual_start: string | null;
  actual_end: string | null;
};

type DependencyRow = {
  project_id: string;
  depends_on_project_id: string | null;
};

type ManualAllocationRow = {
  project_id: string;
  user_id: string;
  effort_type: 'it' | 'business';
  allocation_pct: number;
};

type TeamAssignmentRow = {
  project_id: string;
  user_id: string;
  role: 'it_team' | 'business_team';
};

type UserRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

type TeamMemberConfigRow = {
  config_id: string;
  user_id: string;
  team_id: string | null;
  team_name: string | null;
  project_availability: number | null;
  user_display_name: string | null;
  user_email: string | null;
  first_name: string | null;
  last_name: string | null;
};

type Person = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

type ContributorInfo = {
  id: string;
  name: string;
  teamId: string | null;
  teamName: string | null;
  monthlyCapacity: number;
  weeklyCapacity: number;
};

type ProjectComputation = {
  id: string;
  name: string;
  status: ProjectStatus;
  schedulingMode: ProjectSchedulingMode;
  constraint: ScheduleConstraint | null;
  categoryId: string | null;
  sourceId: string | null;
  streamId: string | null;
  priorityScore: number | null;
  executionProgress: number;
  remainingIt: number;
  remainingBusiness: number;
  remainingTotal: number;
  itContributorDays: Map<string, number>;
  businessContributorDays: Map<string, number>;
  contributorDays: Map<string, number>;
  blockers: string[];
  plannedStart: string | null;
  plannedEnd: string | null;
  actualStart: string | null;
  actualEnd: string | null;
};

type CapacityReservation = {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  schedulingMode: ProjectSchedulingMode;
  categoryId: string | null;
  sourceId: string | null;
  streamId: string | null;
  executionProgress: number;
  reason: RoadmapReservationReason;
  startDate: Date;
  endDate: Date;
  startWeek: Date;
  endWeek: Date;
  weeklyLoads: Map<string, Map<string, number>>;
};

type PreparedData = {
  options: RoadmapGenerateDto;
  contributors: Map<string, ContributorInfo>;
  candidates: Map<string, ProjectComputation>;
  projectRowsById: Map<string, ProjectRow>;
  relevantContributorIds: Set<string>;
  expiredFixedPlanProjectIds: Set<string>;
  blockersByProject: Map<string, string[]>;
  existingEndByProject: Map<string, Date>;
  preUnschedulable: Map<string, UnschedulableProject>;
  reservations: CapacityReservation[];
  projectNameById: Map<string, string>;
};

type CommittedLoadLedger = Map<string, Map<string, number>>;
type ActiveProjectsLedger = Map<string, Map<string, Set<string>>>;
type WeeklyProjectLoadLedger = Map<string, Map<string, Map<string, number>>>;

type SchedulerResult = {
  schedule: ScheduledProject[];
  reservations: RoadmapReservation[];
  unschedulable: UnschedulableProject[];
  explanations: ProjectExplanation[];
  scenarioWarnings: ScenarioWarning[];
  roadmapEndDate: string | null;
  weeklyProjectLoad: WeeklyProjectLoadLedger | null;
};

type CandidateRuntimeState = {
  project: ProjectComputation;
  remainingTotal: number;
  remainingByContributor: Map<string, number>;
  contributorTotals: Map<string, number>;
  historicalStart: Date | null;
  firstReadyWeek: Date | null;
  lastReadyWeek: Date | null;
  firstAllocatedWeek: Date | null;
  lastAllocatedWeek: Date | null;
  done: boolean;
  activeWeekKeys: Set<string>;
  contributorsWithHistory: Set<string>;
  everReady: boolean;
  blockageCounts: Map<RuntimeCapacityReason, number>;
  blockageDetails: Map<RuntimeCapacityReason, RoadmapText>;
  constraintConflict: string | null;
};

type RuntimeCapacityReason =
  | 'not_ready_within_horizon'
  | 'no_free_slot'
  | 'no_effective_capacity'
  | 'below_minimum_start_threshold'
  | 'unfinished_within_horizon'
  | 'insufficient_capacity';

const CAPACITY_CONSUMING_STATUSES: ProjectStatus[] = [
  'waiting_list',
  'planned',
  'in_progress',
  'in_testing',
];

const SLOT_OCCUPANCY_THRESHOLD_DAYS = 0.5;

const EPSILON = 0.0001;
const MAX_WEEKS_TO_SCAN = 520;
const MAX_WEEKS_TO_SCAN_HARD_CAP = 5200;
const WORK_DAYS_PER_WEEK = 5;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function toNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function cloneNumberMap(input: Map<string, number>): Map<string, number> {
  return new Map(input);
}

function sumPositiveDays(input: Map<string, number>): number {
  let total = 0;
  for (const value of input.values()) {
    if (value > EPSILON) total += value;
  }
  return total;
}

function parseYmdUtc(input: string): Date {
  const [y, m, d] = input.split('-').map((part) => Number(part));
  return new Date(Date.UTC(y, m - 1, d));
}

function toYmdUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toUtcDate(input: string | Date | null | undefined): Date | null {
  if (!input) return null;
  const dt = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(dt.getTime())) return null;
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate()));
}

function addDaysUtc(date: Date, days: number): Date {
  return new Date(date.getTime() + days * MS_PER_DAY);
}

function getWeekStartMondayUtc(date: Date): Date {
  const day = date.getUTCDay();
  const offset = (day + 6) % 7;
  return addDaysUtc(date, -offset);
}

function ceilToMondayUtc(date: Date): Date {
  const monday = getWeekStartMondayUtc(date);
  return monday.getTime() < date.getTime() ? addDaysUtc(monday, 7) : monday;
}

function compareNullableNumberDesc(a: number | null, b: number | null): number {
  return (b ?? Number.NEGATIVE_INFINITY) - (a ?? Number.NEGATIVE_INFINITY);
}

@Injectable()
export class PortfolioRoadmapService {
  constructor(
    @InjectRepository(PortfolioProject)
    private readonly projectRepo: Repository<PortfolioProject>,
    private readonly teamMemberConfigService: TeamMemberConfigService,
    private readonly projectsCrudService: PortfolioProjectsCrudService,
  ) {}

  async generateRoadmap(
    tenantId: string,
    input: RoadmapGenerateDto | unknown,
    svcOpts?: ServiceOpts,
  ): Promise<RoadmapResponse> {
    const startedAt = Date.now();
    const mg = svcOpts?.manager ?? this.projectRepo.manager;
    const now = new Date();
    const asOfDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    let options: RoadmapGenerateDto;
    try {
      options = parseRoadmapGenerate(input);
    } catch (error: any) {
      throw new BadRequestException(this.extractErrorMessage(error));
    }

    const prepared = await this.prepareData(tenantId, options, mg);
    const baseResult = this.runScheduler(prepared, null, true, asOfDate);

    const contributorsForSensitivity = Array.from(prepared.contributors.values())
      .filter((c) => c.monthlyCapacity > EPSILON && prepared.relevantContributorIds.has(c.id))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const sampledContributors = contributorsForSensitivity;

    const baseEndDate = baseResult.roadmapEndDate ? parseYmdUtc(baseResult.roadmapEndDate) : null;
    const bottlenecks: BottleneckEntry[] = [];

    for (const contributor of sampledContributors) {
      const overriddenMonthlyCap = new Map<string, number>([
        [contributor.id, contributor.monthlyCapacity * 1.2],
      ]);
      const rerun = this.runScheduler(prepared, overriddenMonthlyCap, false, asOfDate);
      const rerunEndDate = rerun.roadmapEndDate ? parseYmdUtc(rerun.roadmapEndDate) : null;
      let impactDays = 0;
      if (baseEndDate && rerunEndDate) {
        impactDays = Math.max(0, Math.round((baseEndDate.getTime() - rerunEndDate.getTime()) / MS_PER_DAY));
      }
      bottlenecks.push({
        contributorId: contributor.id,
        contributorName: contributor.name,
        impactDays,
      });
    }

    bottlenecks.sort((a, b) =>
      b.impactDays - a.impactDays
      || a.contributorName.localeCompare(b.contributorName)
      || a.contributorId.localeCompare(b.contributorId));

    // Attach on-hold ranges to scheduled projects via batched audit query.
    if (baseResult.schedule.length > 0) {
      const onHoldRangesByProject = await this.buildOnHoldRanges(
        tenantId,
        baseResult.schedule,
        mg,
      );
      for (const item of baseResult.schedule) {
        const ranges = onHoldRangesByProject.get(item.projectId);
        if (ranges && ranges.length > 0) {
          item.onHoldRanges = ranges;
        }
      }
    }

    const occupation = this.buildOccupation(
      baseResult.weeklyProjectLoad,
      prepared.contributors,
      prepared.projectNameById,
    );
    const teamOccupation = this.buildTeamOccupation(occupation);
    const reservationByReason = {
      not_recalculated: baseResult.reservations.filter((r) => r.reason === 'not_recalculated').length,
      external_blocker: baseResult.reservations.filter((r) => r.reason === 'external_blocker').length,
    };
    const impactSummary: RoadmapImpactSummary = {
      delayedProjects: 0,
      acceleratedProjects: 0,
      unchangedProjects: 0,
      newlyUnschedulableProjects: 0,
      newlyScheduledProjects: 0,
      roadmapEndDeltaDays: 0,
    };

    return {
      schedule: baseResult.schedule,
      reservations: baseResult.reservations,
      bottlenecks,
      occupation,
      teamOccupation,
      roadmapEndDate: baseResult.roadmapEndDate,
      unschedulable: baseResult.unschedulable,
      explanations: baseResult.explanations,
      scenarioWarnings: baseResult.scenarioWarnings,
      impactSummary,
      options,
      diagnostics: {
        modeLabel: options.optimizationMode,
        runDurationMs: Date.now() - startedAt,
        candidateProjects: prepared.candidates.size,
        scheduledProjects: baseResult.schedule.length,
        reservationProjects: baseResult.reservations.length,
        reservationByReason,
        hiddenCapacityProjects: 0,
        frozenProjects: baseResult.reservations.length,
        unschedulableProjects: baseResult.unschedulable.length,
        sensitivityReruns: sampledContributors.length,
        sensitivityTruncated: false,
      },
    };
  }

  async applyDates(
    tenantId: string,
    input: RoadmapApplyDto | unknown,
    userId: string | null,
    svcOpts?: ServiceOpts,
  ): Promise<{ updated: number }> {
    const mg = svcOpts?.manager ?? this.projectRepo.manager;
    let parsed: RoadmapApplyDto;
    try {
      parsed = parseRoadmapApply(input);
    } catch (error: any) {
      throw new BadRequestException({
        message: 'Roadmap apply failed',
        code: 'ROADMAP_APPLY_FAILED',
        details: [{ projectId: 'request', error: this.extractErrorMessage(error) }],
      });
    }

    let currentProjectId: string | null = null;
    try {
      await mg.transaction(async (trx) => {
        for (const project of parsed.projects) {
          currentProjectId = project.projectId;
          await this.projectsCrudService.update(
            project.projectId,
            ({
              planned_start: project.plannedStart,
              planned_end: project.plannedEnd,
            } as any),
            tenantId,
            userId,
            { manager: trx },
          );
        }
      });
    } catch (error: any) {
      throw new BadRequestException({
        message: 'Roadmap apply failed',
        code: 'ROADMAP_APPLY_FAILED',
        details: currentProjectId
          ? [{ projectId: currentProjectId, error: this.extractErrorMessage(error) }]
          : [],
      });
    }

    return { updated: parsed.projects.length };
  }

  private extractErrorMessage(error: any): string {
    if (Array.isArray(error?.issues)) {
      return error.issues.map((issue: any) => issue?.message).filter(Boolean).join(', ');
    }
    const response = error?.response;
    if (Array.isArray(response?.message)) {
      return response.message.join(', ');
    }
    if (typeof response?.message === 'string') {
      return response.message;
    }
    if (typeof response === 'string') {
      return response;
    }
    if (Array.isArray(error?.message)) {
      return error.message.join(', ');
    }
    if (typeof error?.message === 'string') {
      return error.message;
    }
    return 'Unknown error';
  }

  private async prepareData(
    tenantId: string,
    options: RoadmapGenerateDto,
    mg: EntityManager,
  ): Promise<PreparedData> {
    const projectRows: ProjectRow[] = await mg.query(
      `
      SELECT
        p.id,
        p.name,
        p.status,
        p.scheduling_mode,
        p.category_id,
        p.source_id,
        p.stream_id,
        p.priority_score,
        p.execution_progress,
        p.estimated_effort_it,
        p.estimated_effort_business,
        p.it_effort_allocation_mode,
        p.business_effort_allocation_mode,
        p.it_lead_id,
        p.business_lead_id,
        p.planned_start,
        p.planned_end,
        p.actual_start,
        p.actual_end
      FROM portfolio_projects p
      WHERE p.tenant_id = $1
        AND p.status <> 'cancelled'
      ORDER BY p.id ASC
    `,
      [tenantId],
    );

    const projectById = new Map<string, ProjectRow>();
    const projectNameById = new Map<string, string>();
    for (const row of projectRows) {
      projectById.set(row.id, row);
      projectNameById.set(row.id, row.name);
    }
    const excludedProjectIds = new Set<string>(options.excludedProjectIds ?? []);
    const candidateStatuses = new Set<ProjectStatus>(options.statuses as ProjectStatus[]);
    const projectOverridesById = new Map(
      (options.scenario?.projectOverrides ?? []).map((entry) => [entry.projectId, entry] as const),
    );

    const candidateIds = new Set<string>();
    for (const project of projectRows) {
      if (excludedProjectIds.has(project.id)) continue;
      const hasPlannedDates = !!project.planned_start && !!project.planned_end;
      const candidateByStatus = candidateStatuses.has(project.status);
      if (!candidateByStatus) continue;
      if (project.status === 'on_hold') continue;
      if (!options.includeAlreadyScheduled && hasPlannedDates) continue;
      candidateIds.add(project.id);
    }

    const reservationReasonByProject = new Map<string, RoadmapReservationReason>();
    for (const project of projectRows) {
      if (excludedProjectIds.has(project.id)) continue;
      const hasPlannedDates = !!project.planned_start && !!project.planned_end;
      if (!hasPlannedDates) continue;
      if (!CAPACITY_CONSUMING_STATUSES.includes(project.status)) continue;
      if (candidateIds.has(project.id)) continue;
      reservationReasonByProject.set(project.id, 'not_recalculated');
    }

    const dependencyRows: DependencyRow[] = candidateIds.size > 0
      ? await mg.query(
        `
        SELECT d.project_id, d.depends_on_project_id
        FROM portfolio_project_dependencies d
        WHERE d.tenant_id = $1
          AND d.project_id = ANY($2)
          AND d.dependency_type = 'blocks'
          AND d.depends_on_project_id IS NOT NULL
        ORDER BY d.project_id ASC, d.depends_on_project_id ASC
      `,
        [tenantId, Array.from(candidateIds)],
      )
      : [];

    const blockersByProject = new Map<string, string[]>();
    for (const dep of dependencyRows) {
      if (!dep.depends_on_project_id) continue;
      const blockers = blockersByProject.get(dep.project_id) ?? [];
      if (!blockers.includes(dep.depends_on_project_id)) {
        blockers.push(dep.depends_on_project_id);
      }
      blockersByProject.set(dep.project_id, blockers);
    }
    for (const [projectId, blockers] of blockersByProject.entries()) {
      blockers.sort((a, b) => a.localeCompare(b));
      blockersByProject.set(projectId, blockers);
    }

    // Ensure external blockers of candidates are treated as capacity reservations.
    for (const dep of dependencyRows) {
      if (!dep.depends_on_project_id) continue;
      const blocker = projectById.get(dep.depends_on_project_id);
      if (!blocker) continue;
      if (excludedProjectIds.has(blocker.id)) continue;
      const hasPlannedDates = !!blocker.planned_start && !!blocker.planned_end;
      if (!hasPlannedDates) continue;
      if (!CAPACITY_CONSUMING_STATUSES.includes(blocker.status)) continue;
      if (candidateIds.has(blocker.id)) continue;
      reservationReasonByProject.set(blocker.id, 'external_blocker');
    }

    const relevantProjectIds = Array.from(new Set([...candidateIds, ...reservationReasonByProject.keys()]))
      .sort((a, b) => a.localeCompare(b));

    const manualAllocationRows: ManualAllocationRow[] = relevantProjectIds.length > 0
      ? await mg.query(
        `
        SELECT project_id, user_id, effort_type, allocation_pct
        FROM portfolio_project_effort_allocations
        WHERE tenant_id = $1
          AND project_id = ANY($2)
      `,
        [tenantId, relevantProjectIds],
      )
      : [];

    const teamAssignmentRows: TeamAssignmentRow[] = relevantProjectIds.length > 0
      ? await mg.query(
        `
        SELECT project_id, user_id, role
        FROM portfolio_project_team
        WHERE tenant_id = $1
          AND project_id = ANY($2)
      `,
        [tenantId, relevantProjectIds],
      )
      : [];

    const userIds = new Set<string>();
    for (const row of manualAllocationRows) userIds.add(row.user_id);
    for (const row of teamAssignmentRows) userIds.add(row.user_id);
    for (const projectId of relevantProjectIds) {
      const row = projectById.get(projectId);
      if (!row) continue;
      if (row.it_lead_id) userIds.add(row.it_lead_id);
      if (row.business_lead_id) userIds.add(row.business_lead_id);
    }

    const users: UserRow[] = userIds.size > 0
      ? await mg.query(
        `SELECT id, first_name, last_name, email FROM users WHERE id = ANY($1)`,
        [Array.from(userIds)],
      )
      : [];
    const userById = new Map<string, Person>();
    for (const user of users) {
      userById.set(user.id, {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        email: user.email,
      });
    }

    const teamConfigs: TeamMemberConfigRow[] = await mg.query(
      `
      SELECT
        tmc.id AS config_id,
        tmc.user_id,
        tmc.team_id,
        tmc.project_availability,
        TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_display_name,
        u.email AS user_email,
        u.first_name,
        u.last_name,
        pt.name AS team_name
      FROM portfolio_team_member_configs tmc
      LEFT JOIN users u ON u.id = tmc.user_id
      LEFT JOIN portfolio_teams pt ON pt.id = tmc.team_id
      WHERE tmc.tenant_id = $1
      ORDER BY tmc.user_id ASC
    `,
      [tenantId],
    );

    const historicalStats = options.capacityMode === 'historical'
      ? (await this.teamMemberConfigService.getAllTimeStats(tenantId, { manager: mg })).stats
      : {};

    const contributors = new Map<string, ContributorInfo>();
    for (const config of teamConfigs) {
      const theoreticalCapacity = Math.max(0, toNumber(config.project_availability));
      const historicalCapacity = Math.max(0, toNumber(historicalStats?.[config.config_id]?.avgProjectDays));
      let monthlyCapacity = 0;
      if (options.capacityMode === 'historical') {
        monthlyCapacity = historicalCapacity > EPSILON
          ? historicalCapacity
          : theoreticalCapacity;
      } else {
        monthlyCapacity = theoreticalCapacity;
      }
      const weeklyCapacity = monthlyCapacity > EPSILON ? (monthlyCapacity * 12) / 52 : 0;

      const fallbackUser = userById.get(config.user_id);
      const displayName = (config.user_display_name || '').trim()
        || [fallbackUser?.first_name, fallbackUser?.last_name].filter(Boolean).join(' ').trim()
        || config.user_email
        || fallbackUser?.email
        || config.user_id;

      contributors.set(config.user_id, {
        id: config.user_id,
        name: displayName,
        teamId: config.team_id ?? null,
        teamName: config.team_name ?? null,
        monthlyCapacity: round2(monthlyCapacity),
        weeklyCapacity,
      });
    }

    const manualByKey = new Map<string, Allocation[]>();
    for (const row of manualAllocationRows) {
      const key = `${row.project_id}:${row.effort_type}`;
      const list = manualByKey.get(key) ?? [];
      list.push({ user_id: row.user_id, allocation_pct: toNumber(row.allocation_pct) });
      manualByKey.set(key, list);
    }
    for (const [key, list] of manualByKey.entries()) {
      list.sort((a, b) => a.user_id.localeCompare(b.user_id));
      manualByKey.set(key, list);
    }

    const teamByProject = new Map<string, { it: Person[]; business: Person[] }>();
    const personFor = (userId: string): Person => (
      userById.get(userId) ?? {
        id: userId,
        first_name: '',
        last_name: '',
        email: null,
      }
    );
    for (const row of teamAssignmentRows) {
      const entry = teamByProject.get(row.project_id) ?? { it: [], business: [] };
      const person = personFor(row.user_id);
      if (row.role === 'it_team') entry.it.push(person);
      if (row.role === 'business_team') entry.business.push(person);
      teamByProject.set(row.project_id, entry);
    }
    for (const entry of teamByProject.values()) {
      entry.it.sort((a, b) => a.id.localeCompare(b.id));
      entry.business.sort((a, b) => a.id.localeCompare(b.id));
    }

    const ensureContributor = (userId: string): void => {
      if (contributors.has(userId)) return;
      const person = personFor(userId);
      const displayName = [person.first_name, person.last_name].filter(Boolean).join(' ').trim()
        || person.email
        || userId;
      contributors.set(userId, {
        id: userId,
        name: displayName,
        teamId: null,
        teamName: null,
        monthlyCapacity: 0,
        weeklyCapacity: 0,
      });
    };

    const candidates = new Map<string, ProjectComputation>();
    const preUnschedulable = new Map<string, UnschedulableProject>();
    const expiredFixedPlanProjectIds = new Set<string>();

    const allRelevantProjects = new Map<string, ProjectComputation>();
    const firstWeekToPlan = ceilToMondayUtc(parseYmdUtc(options.startDate));
    for (const projectId of relevantProjectIds) {
      const row = projectById.get(projectId);
      if (!row) continue;

      const progress = Math.max(0, Math.min(100, toNumber(row.execution_progress)));
      const remainingIt = Math.max(0, toNumber(row.estimated_effort_it) * (1 - progress / 100));
      const remainingBusiness = Math.max(0, toNumber(row.estimated_effort_business) * (1 - progress / 100));

      const members = teamByProject.get(projectId) ?? { it: [], business: [] };
      const itLead = row.it_lead_id ? personFor(row.it_lead_id) : null;
      const businessLead = row.business_lead_id ? personFor(row.business_lead_id) : null;

      const itManual = manualByKey.get(`${projectId}:it`) ?? [];
      const businessManual = manualByKey.get(`${projectId}:business`) ?? [];

      const itAllocations = row.it_effort_allocation_mode === 'manual'
        ? itManual
        : (itManual.length > 0 ? itManual : computeAutoAllocations(itLead, members.it));
      const businessAllocations = row.business_effort_allocation_mode === 'manual'
        ? businessManual
        : (businessManual.length > 0 ? businessManual : computeAutoAllocations(businessLead, members.business));

      const itContributorDays = new Map<string, number>();
      const businessContributorDays = new Map<string, number>();
      for (const alloc of itAllocations) {
        if (!alloc.user_id) continue;
        const value = remainingIt * (toNumber(alloc.allocation_pct) / 100);
        itContributorDays.set(alloc.user_id, (itContributorDays.get(alloc.user_id) ?? 0) + value);
      }
      for (const alloc of businessAllocations) {
        if (!alloc.user_id) continue;
        const value = remainingBusiness * (toNumber(alloc.allocation_pct) / 100);
        businessContributorDays.set(alloc.user_id, (businessContributorDays.get(alloc.user_id) ?? 0) + value);
      }

      for (const [userId, days] of Array.from(itContributorDays.entries())) {
        if (days <= EPSILON) {
          itContributorDays.delete(userId);
          continue;
        }
        ensureContributor(userId);
      }
      for (const [userId, days] of Array.from(businessContributorDays.entries())) {
        if (days <= EPSILON) {
          businessContributorDays.delete(userId);
          continue;
        }
        ensureContributor(userId);
      }

      const contributorDays = cloneNumberMap(itContributorDays);
      if (options.capacityConstraintMode === 'full') {
        for (const [userId, days] of businessContributorDays.entries()) {
          contributorDays.set(userId, (contributorDays.get(userId) ?? 0) + days);
        }
      }
      const remainingTotal = sumPositiveDays(contributorDays);

      const blockers = (blockersByProject.get(projectId) ?? []).slice().sort((a, b) => a.localeCompare(b));
      const override = projectOverridesById.get(projectId) as (
        NonNullable<RoadmapGenerateDto['scenario']>['projectOverrides'][number] | undefined
      );
      const computation: ProjectComputation = {
        id: row.id,
        name: row.name,
        status: row.status,
        schedulingMode: override?.schedulingMode ?? row.scheduling_mode,
        constraint: (override?.constraint ?? null) as ScheduleConstraint | null,
        categoryId: row.category_id ?? null,
        sourceId: row.source_id ?? null,
        streamId: row.stream_id ?? null,
        priorityScore: row.priority_score != null ? toNumber(row.priority_score) : null,
        executionProgress: progress,
        remainingIt,
        remainingBusiness,
        remainingTotal,
        itContributorDays,
        businessContributorDays,
        contributorDays,
        blockers,
        plannedStart: row.planned_start,
        plannedEnd: row.planned_end,
        actualStart: row.actual_start,
        actualEnd: row.actual_end,
      };
      allRelevantProjects.set(projectId, computation);

      if (candidateIds.has(projectId)) {
        candidates.set(projectId, computation);
      }
    }

    for (const projectId of Array.from(candidates.keys()).sort((a, b) => a.localeCompare(b))) {
      const project = candidates.get(projectId)!;
      if (options.capacityConstraintMode === 'it_only' && project.remainingIt <= EPSILON) {
        candidates.delete(projectId);
        continue;
      }
      if (project.remainingTotal <= EPSILON) {
        preUnschedulable.set(projectId, {
          projectId: project.id,
          projectName: project.name,
          status: project.status,
          schedulingMode: project.schedulingMode,
          reason: 'zero_remaining_effort',
        });
        continue;
      }
      if (project.contributorDays.size === 0) {
        preUnschedulable.set(projectId, {
          projectId: project.id,
          projectName: project.name,
          status: project.status,
          schedulingMode: project.schedulingMode,
          reason: 'no_assigned_contributors',
        });
        continue;
      }
      const missingCapacityUsers = Array.from(project.contributorDays.keys())
        .filter((userId) => (contributors.get(userId)?.weeklyCapacity ?? 0) <= EPSILON);
      if (missingCapacityUsers.length > 0) {
        const names = missingCapacityUsers
          .map((userId) => contributors.get(userId)?.name ?? userId)
          .sort((a, b) => a.localeCompare(b));
        const detailsText = roadmapText('missing_contributor_capacity_for', { names });
        preUnschedulable.set(projectId, {
          projectId: project.id,
          projectName: project.name,
          status: project.status,
          schedulingMode: project.schedulingMode,
          reason: 'missing_contributor_capacity',
          details: renderRoadmapText(detailsText),
          detailsText,
        });
        continue;
      }
    }

    const existingEndByProject = new Map<string, Date>();
    for (const project of projectRows) {
      const preferredEnd = project.status === 'done'
        ? (project.actual_end || project.planned_end)
        : (project.planned_end || project.actual_end);
      const parsed = toUtcDate(preferredEnd);
      if (parsed) {
        existingEndByProject.set(project.id, parsed);
      }
    }

    const reservations: CapacityReservation[] = [];
    for (const projectId of Array.from(reservationReasonByProject.keys()).sort((a, b) => a.localeCompare(b))) {
      const row = projectById.get(projectId);
      if (!row || !row.planned_start || !row.planned_end) continue;
      const startDate = toUtcDate(row.planned_start);
      const endDate = toUtcDate(row.planned_end);
      if (!startDate || !endDate || endDate.getTime() < startDate.getTime()) continue;
      const reason = reservationReasonByProject.get(projectId);
      if (!reason) continue;
      if (row.status !== 'done' && endDate.getTime() < firstWeekToPlan.getTime()) {
        expiredFixedPlanProjectIds.add(projectId);
      }

      const project = allRelevantProjects.get(projectId);
      const startWeek = getWeekStartMondayUtc(startDate);
      const endWeek = getWeekStartMondayUtc(endDate);
      const reservationStartWeek = new Date(Math.max(startWeek.getTime(), firstWeekToPlan.getTime()));
      const weekKeys: string[] = [];
      for (
        let cursor = reservationStartWeek;
        cursor.getTime() <= endWeek.getTime();
        cursor = addDaysUtc(cursor, 7)
      ) {
        weekKeys.push(toYmdUtc(cursor));
      }

      const weeklyLoads = new Map<string, Map<string, number>>();
      if (project && project.contributorDays.size > 0 && weekKeys.length > 0) {
        for (const [userId, totalDays] of Array.from(project.contributorDays.entries())) {
          if (totalDays <= EPSILON) continue;
          const perWeekDays = totalDays / weekKeys.length;
          if (perWeekDays <= EPSILON) continue;
          for (const weekKey of weekKeys) {
            const byUser = weeklyLoads.get(weekKey) ?? new Map<string, number>();
            byUser.set(userId, (byUser.get(userId) ?? 0) + perWeekDays);
            weeklyLoads.set(weekKey, byUser);
          }
        }
      }
      if (weeklyLoads.size === 0) {
        continue;
      }

      reservations.push({
        projectId,
        projectName: row.name,
        status: row.status,
        schedulingMode: row.scheduling_mode,
        categoryId: row.category_id ?? null,
        sourceId: row.source_id ?? null,
        streamId: row.stream_id ?? null,
        executionProgress: round2(project?.executionProgress ?? toNumber(row.execution_progress ?? 0)),
        reason,
        startDate,
        endDate,
        startWeek,
        endWeek,
        weeklyLoads,
      });
    }

    const relevantContributorIds = new Set<string>();
    for (const project of candidates.values()) {
      for (const contributorId of project.contributorDays.keys()) {
        relevantContributorIds.add(contributorId);
      }
    }
    for (const reservation of reservations) {
      for (const weekLoads of reservation.weeklyLoads.values()) {
        for (const contributorId of weekLoads.keys()) {
          relevantContributorIds.add(contributorId);
        }
      }
    }

    return {
      options,
      contributors,
      candidates,
      projectRowsById: projectById,
      relevantContributorIds,
      expiredFixedPlanProjectIds,
      blockersByProject,
      existingEndByProject,
      preUnschedulable,
      reservations,
      projectNameById,
    };
  }

  private runScheduler(
    prepared: PreparedData,
    monthlyCapacityOverride: Map<string, number> | null,
    collectOccupation: boolean,
    asOfDate: Date,
  ): SchedulerResult {
    const options = prepared.options;
    const startDate = parseYmdUtc(options.startDate);
    const firstWeekToPlan = ceilToMondayUtc(startDate);

    const weeklyCapacityByUser = new Map<string, number>();
    for (const contributor of prepared.contributors.values()) {
      const monthlyCapacity = monthlyCapacityOverride?.has(contributor.id)
        ? Math.max(0, toNumber(monthlyCapacityOverride.get(contributor.id)))
        : contributor.monthlyCapacity;
      const weeklyCapacity = monthlyCapacity > EPSILON ? (monthlyCapacity * 12) / 52 : 0;
      weeklyCapacityByUser.set(contributor.id, weeklyCapacity);
    }

    const committedLoad: CommittedLoadLedger = new Map();
    const activeProjects: ActiveProjectsLedger = new Map();
    const weeklyProjectLoad: WeeklyProjectLoadLedger | null = collectOccupation ? new Map() : null;

    for (const reservation of prepared.reservations) {
      const weeks = Array.from(reservation.weeklyLoads.keys()).sort((a, b) => a.localeCompare(b));
      for (const weekKey of weeks) {
        const loadsByUser = reservation.weeklyLoads.get(weekKey);
        if (!loadsByUser) continue;
        const users = Array.from(loadsByUser.keys()).sort((a, b) => a.localeCompare(b));
        for (const userId of users) {
          const days = loadsByUser.get(userId) ?? 0;
          if (days <= EPSILON) continue;
          this.addCommittedLoad(committedLoad, userId, weekKey, days);
          if (days > EPSILON) {
            this.addActiveProject(activeProjects, userId, weekKey, reservation.projectId);
          }
          if (weeklyProjectLoad) {
            this.addWeeklyProjectLoad(weeklyProjectLoad, userId, weekKey, reservation.projectId, days);
          }
        }
      }
    }

    const unschedulableMap = new Map<string, UnschedulableProject>();
    for (const [projectId, unsched] of prepared.preUnschedulable.entries()) {
      unschedulableMap.set(projectId, { ...unsched });
    }

    const knownEndByProject = new Map<string, Date>(prepared.existingEndByProject);
    for (const reservation of prepared.reservations) {
      knownEndByProject.set(reservation.projectId, reservation.endDate);
    }

    const candidateIds = new Set<string>(
      Array.from(prepared.candidates.keys())
        .filter((id) => !unschedulableMap.has(id)),
    );

    const setUnschedulable = (
      projectId: string,
      reason: UnschedulableProject['reason'],
      detailsText?: RoadmapText,
    ): void => {
      const project = prepared.candidates.get(projectId);
      if (!project) return;
      candidateIds.delete(projectId);
      unschedulableMap.set(projectId, {
        projectId: project.id,
        projectName: project.name,
        status: project.status,
        schedulingMode: project.schedulingMode,
        reason,
        ...(detailsText ? { details: renderRoadmapText(detailsText), detailsText } : {}),
      });
    };

    const pruneBlockedProjects = (): void => {
      let changed = true;
      while (changed) {
        changed = false;
        for (const projectId of Array.from(candidateIds).sort((a, b) => a.localeCompare(b))) {
          const blockers = prepared.blockersByProject.get(projectId) ?? [];
          let reason: UnschedulableProject['reason'] | null = null;
          let details: RoadmapText | undefined;
          for (const blockerId of blockers) {
            if (candidateIds.has(blockerId)) continue;
            const blockerRow = prepared.projectRowsById.get(blockerId);
            const blockerName = prepared.projectNameById.get(blockerId) || blockerId;
            const blockerUnschedulable = unschedulableMap.get(blockerId);
            if (blockerRow?.status === 'on_hold') {
              reason = 'blocker_on_hold';
              details = roadmapText('blocker_on_hold', { blocker: blockerName });
              break;
            }
            if (prepared.expiredFixedPlanProjectIds.has(blockerId)) {
              reason = 'expired_fixed_plan';
              details = roadmapText('blocker_fixed_plan_expired', { blocker: blockerName });
              break;
            }
            if (blockerUnschedulable && blockerRow?.status !== 'done') {
              reason = 'blocked_unfinished_project';
              details = roadmapText('blocker_cannot_be_scheduled', { blocker: blockerName, reason: blockerUnschedulable.reason });
              break;
            }
            if (!knownEndByProject.has(blockerId)) {
              reason = 'missing_blocker_date';
              details = roadmapText('missing_blocker_date_for', { blocker: blockerName });
              break;
            }
          }
          if (!reason) continue;
          setUnschedulable(projectId, reason, details);
          changed = true;
        }
      }
    };
    pruneBlockedProjects();

    const buildDependencyGraph = (ids: Set<string>): {
      indegree: Map<string, number>;
      dependents: Map<string, string[]>;
      internalBlockersByProject: Map<string, string[]>;
    } => {
      const indegree = new Map<string, number>();
      const dependents = new Map<string, string[]>();
      const internalBlockersByProject = new Map<string, string[]>();
      for (const projectId of Array.from(ids).sort((a, b) => a.localeCompare(b))) {
        const blockers = (prepared.blockersByProject.get(projectId) ?? [])
          .filter((blockerId) => ids.has(blockerId))
          .sort((a, b) => a.localeCompare(b));
        internalBlockersByProject.set(projectId, blockers);
        indegree.set(projectId, blockers.length);
        for (const blockerId of blockers) {
          const list = dependents.get(blockerId) ?? [];
          list.push(projectId);
          dependents.set(blockerId, list);
        }
      }
      for (const [projectId, list] of dependents.entries()) {
        list.sort((a, b) => a.localeCompare(b));
      }
      return { indegree, dependents, internalBlockersByProject };
    };

    let {
      dependents,
      internalBlockersByProject,
    } = buildDependencyGraph(candidateIds);

    const cycleProbe = buildDependencyGraph(candidateIds);
    const cycleQueue = Array.from(candidateIds)
      .filter((projectId) => (cycleProbe.indegree.get(projectId) ?? 0) === 0)
      .sort((a, b) => a.localeCompare(b));
    const cycleVisited = new Set<string>();
    while (cycleQueue.length > 0) {
      const projectId = cycleQueue.shift()!;
      if (cycleVisited.has(projectId)) continue;
      cycleVisited.add(projectId);
      const outgoing = cycleProbe.dependents.get(projectId) ?? [];
      for (const dependentId of outgoing) {
        if (!cycleProbe.indegree.has(dependentId)) continue;
        cycleProbe.indegree.set(dependentId, (cycleProbe.indegree.get(dependentId) ?? 0) - 1);
        if ((cycleProbe.indegree.get(dependentId) ?? 0) === 0) {
          cycleQueue.push(dependentId);
        }
      }
      cycleQueue.sort((a, b) => a.localeCompare(b));
    }
    for (const projectId of Array.from(candidateIds).sort((a, b) => a.localeCompare(b))) {
      if (cycleVisited.has(projectId)) continue;
      setUnschedulable(projectId, 'cyclic_dependency');
    }

    pruneBlockedProjects();
    ({
      dependents,
      internalBlockersByProject,
    } = buildDependencyGraph(candidateIds));

    const planningFloorWeek = new Date(
      Math.max(firstWeekToPlan.getTime(), ceilToMondayUtc(asOfDate).getTime()),
    );

    const getConstraintStartWeek = (constraint: ScheduleConstraint | null | undefined): Date | null => {
      if (!constraint) return null;
      switch (constraint.type) {
        case 'pin_start':
        case 'pin_window':
        case 'not_before':
          return ceilToMondayUtc(parseYmdUtc(constraint.startWeek));
        default:
          return null;
      }
    };

    const getEffectiveConstraintStartWeek = (
      constraint: ScheduleConstraint | null | undefined,
    ): Date | null => {
      const rawConstraintStartWeek = getConstraintStartWeek(constraint);
      if (!rawConstraintStartWeek) return null;
      return rawConstraintStartWeek.getTime() < planningFloorWeek.getTime()
        ? planningFloorWeek
        : rawConstraintStartWeek;
    };

    const getConstraintEndWeek = (constraint: ScheduleConstraint | null | undefined): Date | null => {
      if (!constraint || constraint.type !== 'pin_window') return null;
      return ceilToMondayUtc(parseYmdUtc(constraint.endWeek));
    };

    const applyConstraintEarliestWeek = (
      earliestWeek: Date,
      constraint: ScheduleConstraint | null | undefined,
    ): Date => {
      const constraintStartWeek = getEffectiveConstraintStartWeek(constraint);
      if (!constraintStartWeek) return earliestWeek;
      return constraintStartWeek.getTime() > earliestWeek.getTime()
        ? constraintStartWeek
        : earliestWeek;
    };

    const dependencyDepth = new Map<string, number>();
    const depthDfs = (projectId: string, visiting: Set<string>): number => {
      if (dependencyDepth.has(projectId)) return dependencyDepth.get(projectId)!;
      if (visiting.has(projectId)) return 0;
      visiting.add(projectId);
      const children = dependents.get(projectId) ?? [];
      let maxDepth = 0;
      for (const childId of children) {
        const depth = 1 + depthDfs(childId, visiting);
        if (depth > maxDepth) maxDepth = depth;
      }
      visiting.delete(projectId);
      dependencyDepth.set(projectId, maxDepth);
      return maxDepth;
    };
    for (const projectId of candidateIds) {
      depthDfs(projectId, new Set<string>());
    }

    const runtimeByProject = new Map<string, CandidateRuntimeState>();
    const externalEarliestWeekByProject = new Map<string, Date>();
    for (const projectId of Array.from(candidateIds).sort((a, b) => a.localeCompare(b))) {
      const project = prepared.candidates.get(projectId);
      if (!project) continue;
      const remainingByContributor = new Map(project.contributorDays);
      let remainingTotal = 0;
      for (const days of remainingByContributor.values()) {
        if (days > EPSILON) remainingTotal += days;
      }
      const historicalStart = this.resolveHistoricalStart(project, asOfDate);
      const contributorsWithHistory = new Set<string>();
      if (historicalStart) {
        for (const [contributorId, days] of remainingByContributor.entries()) {
          if (days > EPSILON) contributorsWithHistory.add(contributorId);
        }
      }

      runtimeByProject.set(projectId, {
        project,
        remainingTotal,
        remainingByContributor,
        contributorTotals: new Map<string, number>(),
        historicalStart,
        firstReadyWeek: null,
        lastReadyWeek: null,
        firstAllocatedWeek: null,
        lastAllocatedWeek: null,
        done: false,
        activeWeekKeys: new Set<string>(),
        contributorsWithHistory,
        everReady: false,
        blockageCounts: new Map<RuntimeCapacityReason, number>(),
        blockageDetails: new Map<RuntimeCapacityReason, RoadmapText>(),
        constraintConflict: null,
      });

      let earliestDate = startDate;
      const blockers = prepared.blockersByProject.get(projectId) ?? [];
      for (const blockerId of blockers) {
        if (candidateIds.has(blockerId)) continue;
        const blockerEnd = knownEndByProject.get(blockerId);
        if (!blockerEnd) continue;
        const nextDay = addDaysUtc(blockerEnd, 1);
        if (nextDay.getTime() > earliestDate.getTime()) {
          earliestDate = nextDay;
        }
      }
      externalEarliestWeekByProject.set(
        projectId,
        applyConstraintEarliestWeek(ceilToMondayUtc(earliestDate), project.constraint),
      );
    }

    const bottleneckWeeksByProject = new Map<string, number>();
    if (options.optimizationMode === 'completion_focused') {
      for (const projectId of candidateIds) {
        const project = prepared.candidates.get(projectId);
        if (!project) continue;
        bottleneckWeeksByProject.set(
          projectId,
          this.estimateBottleneckWeeks(project, weeklyCapacityByUser, options),
        );
      }
    }

    const waitWeeksByProject = new Map<string, number>();
    const scheduledEndByProject = new Map<string, Date>();
    const openProjectsByContributor = new Map<string, Set<string>>();
    let cursor = firstWeekToPlan;
    const contributorIds = Array.from(weeklyCapacityByUser.keys()).sort((a, b) => a.localeCompare(b));

    const contributorDemand = new Map<string, number>();
    for (const state of runtimeByProject.values()) {
      for (const [contributorId, days] of state.remainingByContributor.entries()) {
        contributorDemand.set(contributorId, (contributorDemand.get(contributorId) ?? 0) + days);
      }
    }
    const frozenCommittedDays = new Map<string, number>();
    for (const [contributorId, byWeek] of committedLoad.entries()) {
      let total = 0;
      for (const days of byWeek.values()) total += days;
      if (total > EPSILON) {
        frozenCommittedDays.set(contributorId, total);
      }
    }

    let horizonWeeks = MAX_WEEKS_TO_SCAN;
    let estimatedContributorWeeks = 0;
    for (const [contributorId, demandDays] of contributorDemand.entries()) {
      const weeklyBaseCapacity = weeklyCapacityByUser.get(contributorId) ?? 0;
      if (weeklyBaseCapacity <= EPSILON) continue;
      const effectiveCapacity = this.computeEffectiveWeeklyCapacity(weeklyBaseCapacity, 1, options);
      if (effectiveCapacity <= EPSILON) continue;
      const frozenDays = frozenCommittedDays.get(contributorId) ?? 0;
      const contributorWeeks = (demandDays + frozenDays) / effectiveCapacity;
      if (contributorWeeks > estimatedContributorWeeks) {
        estimatedContributorWeeks = contributorWeeks;
      }
    }
    if (estimatedContributorWeeks > 0) {
      const bufferedEstimate = Math.ceil(estimatedContributorWeeks * 1.5) + 52;
      horizonWeeks = Math.max(horizonWeeks, bufferedEstimate);
    }
    horizonWeeks = Math.min(MAX_WEEKS_TO_SCAN_HARD_CAP, horizonWeeks);

    const computeStartedWeek = (state: CandidateRuntimeState): Date | null => {
      if (state.firstAllocatedWeek) return state.firstAllocatedWeek;
      if (state.historicalStart) return getWeekStartMondayUtc(state.historicalStart);
      return null;
    };

    const isContinuingProject = (state: CandidateRuntimeState): boolean => computeStartedWeek(state) !== null;

    const getConstraintPriority = (state: CandidateRuntimeState): number => {
      const constraint = state.project.constraint;
      if (!constraint) return 0;
      const startWeek = getEffectiveConstraintStartWeek(constraint);
      if (!startWeek || startWeek.getTime() > cursor.getTime()) return 0;
      switch (constraint.type) {
        case 'pin_start':
          return 3;
        case 'pin_window':
          return 2;
        case 'not_before':
          return 1;
        default:
          return 0;
      }
    };

    const getOpenProjectSet = (contributorId: string): Set<string> => {
      const existing = openProjectsByContributor.get(contributorId);
      if (existing) return existing;
      const created = new Set<string>();
      openProjectsByContributor.set(contributorId, created);
      return created;
    };

    const markProjectOpenForContributor = (contributorId: string, projectId: string): void => {
      getOpenProjectSet(contributorId).add(projectId);
    };

    const closeProjectForContributor = (contributorId: string, projectId: string): void => {
      getOpenProjectSet(contributorId).delete(projectId);
    };

    const computeEffectivePriority = (projectId: string): number => {
      const state = runtimeByProject.get(projectId);
      const project = prepared.candidates.get(projectId);
      const raw = project?.priorityScore ?? 0;
      if (!state) return raw;
      const startedWeek = computeStartedWeek(state);
      if (startedWeek) {
        const weeksSinceStart = Math.max(0, Math.floor(
          (cursor.getTime() - startedWeek.getTime()) / (7 * MS_PER_DAY),
        ));
        return Math.min(100, raw + 5 * weeksSinceStart);
      }
      const weeksWaiting = waitWeeksByProject.get(projectId) ?? 0;
      if (weeksWaiting > 0) {
        return Math.min(90, raw + weeksWaiting);
      }
      return raw;
    };

    const rankProjects = (leftId: string, rightId: string): number => {
      const leftConstraintPriority = getConstraintPriority(runtimeByProject.get(leftId)!);
      const rightConstraintPriority = getConstraintPriority(runtimeByProject.get(rightId)!);
      if (leftConstraintPriority !== rightConstraintPriority) {
        return rightConstraintPriority - leftConstraintPriority;
      }
      const leftContinuing = isContinuingProject(runtimeByProject.get(leftId)!);
      const rightContinuing = isContinuingProject(runtimeByProject.get(rightId)!);
      if (leftContinuing !== rightContinuing) return leftContinuing ? -1 : 1;
      if (options.optimizationMode === 'priority_focused') {
        const leftEP = computeEffectivePriority(leftId);
        const rightEP = computeEffectivePriority(rightId);
        if (leftEP !== rightEP) return rightEP - leftEP;
      } else {
        const leftBottleneck = bottleneckWeeksByProject.get(leftId) ?? Number.POSITIVE_INFINITY;
        const rightBottleneck = bottleneckWeeksByProject.get(rightId) ?? Number.POSITIVE_INFINITY;
        if (leftBottleneck !== rightBottleneck) return leftBottleneck - rightBottleneck;
        const leftProject = prepared.candidates.get(leftId)!;
        const rightProject = prepared.candidates.get(rightId)!;
        const byPriority = compareNullableNumberDesc(leftProject.priorityScore, rightProject.priorityScore);
        if (byPriority !== 0) return byPriority;
      }
      const leftDepth = dependencyDepth.get(leftId) ?? 0;
      const rightDepth = dependencyDepth.get(rightId) ?? 0;
      if (leftDepth !== rightDepth) return rightDepth - leftDepth;
      return leftId.localeCompare(rightId);
    };

    const recordBlockage = (
      state: CandidateRuntimeState,
      reason: RuntimeCapacityReason,
      details: RoadmapText,
    ): void => {
      state.blockageCounts.set(reason, (state.blockageCounts.get(reason) ?? 0) + 1);
      state.blockageDetails.set(reason, details);
    };

    const describeContributors = (contributorIds: string[]): RoadmapText[] => contributorIds
      .map((contributorId) => roadmapText('contributor_capacity', {
        name: prepared.contributors.get(contributorId)?.name ?? contributorId,
        weeklyCapacity: round2(weeklyCapacityByUser.get(contributorId) ?? 0),
      }));

    const describeLargestRemainingLoads = (state: CandidateRuntimeState): RoadmapText[] => {
      return Array.from(state.remainingByContributor.entries())
        .filter(([, days]) => days > EPSILON)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([contributorId, days]) => roadmapText('contributor_remaining_load', {
          name: prepared.contributors.get(contributorId)?.name ?? contributorId,
          remainingDays: round2(days),
          weeklyCapacity: round2(weeklyCapacityByUser.get(contributorId) ?? 0),
        }));
    };

    const chooseDominantBlockage = (
      state: CandidateRuntimeState,
    ): { reason: RuntimeCapacityReason; details: RoadmapText } | null => {
      const priority: RuntimeCapacityReason[] = [
        'no_free_slot',
        'no_effective_capacity',
        'below_minimum_start_threshold',
        'insufficient_capacity',
      ];
      let bestReason: RuntimeCapacityReason | null = null;
      let bestCount = -1;
      for (const reason of priority) {
        const count = state.blockageCounts.get(reason) ?? 0;
        if (count > bestCount) {
          bestReason = reason;
          bestCount = count;
        }
      }
      if (!bestReason || bestCount <= 0) return null;
      return {
        reason: bestReason,
        details: state.blockageDetails.get(bestReason) ?? roadmapText('capacity_prevented_scheduling'),
      };
    };

    const buildItemRef = (projectId: string): RoadmapItemRef => ({
      projectId,
      scenarioProjectId: null,
      sourceRequestId: null,
      isScenarioProject: false,
    });

    const mapRuntimeReasonToExplanationKind = (
      reason: RuntimeCapacityReason,
    ): ExplanationReasonEntry['kind'] => {
      switch (reason) {
        case 'no_free_slot':
          return 'no_free_slot';
        case 'below_minimum_start_threshold':
          return 'below_minimum_start_threshold';
        case 'no_effective_capacity':
        case 'not_ready_within_horizon':
        case 'unfinished_within_horizon':
        case 'insufficient_capacity':
        default:
          return 'no_effective_capacity';
      }
    };

    const mapUnschedulableReasonToExplanationKind = (
      reason: UnschedulableProject['reason'],
    ): ExplanationReasonEntry['kind'] => {
      switch (reason) {
        case 'missing_blocker_date':
          return 'dependency';
        case 'blocker_on_hold':
        case 'blocked_unfinished_project':
        case 'cyclic_dependency':
          return 'unschedulable_blocker';
        case 'expired_fixed_plan':
          return 'fixed_plan';
        case 'no_free_slot':
          return 'no_free_slot';
        case 'below_minimum_start_threshold':
          return 'below_minimum_start_threshold';
        case 'no_effective_capacity':
        case 'unfinished_within_horizon':
        case 'insufficient_capacity':
        case 'missing_contributor_capacity':
        case 'no_assigned_contributors':
        case 'zero_remaining_effort':
        case 'not_ready_within_horizon':
        default:
          return 'no_effective_capacity';
      }
    };

    const buildDependencyReasonEntries = (projectId: string): ExplanationReasonEntry[] => {
      const blockers = prepared.blockersByProject.get(projectId) ?? [];
      return blockers
        .map((blockerId) => {
          const blockerName = prepared.projectNameById.get(blockerId) || blockerId;
          const blockerRow = prepared.projectRowsById.get(blockerId);
          const blockerUnschedulable = unschedulableMap.get(blockerId);
          let kind: ExplanationReasonEntry['kind'] = 'dependency';
          let labelText = roadmapText('waiting_for', { blocker: blockerName });
          let toWeek: string | null = null;

          if (blockerRow?.status === 'on_hold') {
            kind = 'unschedulable_blocker';
            labelText = roadmapText('blocker_is_on_hold', { blocker: blockerName });
          } else if (prepared.expiredFixedPlanProjectIds.has(blockerId)) {
            kind = 'fixed_plan';
            labelText = roadmapText('blocker_has_expired_fixed_plan', { blocker: blockerName });
          } else if (blockerUnschedulable && blockerRow?.status !== 'done') {
            kind = 'unschedulable_blocker';
            labelText = roadmapText('blocker_is_unschedulable', { blocker: blockerName, reason: blockerUnschedulable.reason });
          } else {
            const blockerEnd = scheduledEndByProject.get(blockerId) ?? knownEndByProject.get(blockerId) ?? null;
            if (blockerEnd) {
              const releaseWeek = ceilToMondayUtc(addDaysUtc(blockerEnd, 1));
              toWeek = toYmdUtc(releaseWeek);
              labelText = roadmapText('waiting_for_until', { blocker: blockerName, week: toWeek });
            }
          }

          return {
            kind,
            label: renderRoadmapText(labelText),
            labelText,
            projectId: blockerId,
            scenarioProjectId: null,
            fromWeek: toYmdUtc(firstWeekToPlan),
            toWeek,
          };
        })
        .sort((a, b) =>
          (a.toWeek ?? '').localeCompare(b.toWeek ?? '')
          || (a.projectId ?? '').localeCompare(b.projectId ?? ''));
    };

    const buildDominantBlockageEntries = (state: CandidateRuntimeState): ExplanationReasonEntry[] => {
      return Array.from(state.blockageCounts.entries())
        .filter(([, count]) => count > 0)
        .sort((a, b) =>
          b[1] - a[1]
          || a[0].localeCompare(b[0]))
        .slice(0, 3)
        .map(([reason]) => {
          const labelText = state.blockageDetails.get(reason) ?? roadmapText('reason', { reason });
          return {
            kind: mapRuntimeReasonToExplanationKind(reason),
            label: renderRoadmapText(labelText),
            labelText,
            projectId: null,
            scenarioProjectId: null,
            fromWeek: state.firstReadyWeek ? toYmdUtc(state.firstReadyWeek) : null,
            toWeek: state.lastReadyWeek ? toYmdUtc(state.lastReadyWeek) : null,
          };
        });
    };

    const buildLimitingContributors = (
      state: CandidateRuntimeState,
      probeWeek: Date | null,
    ): ExplanationContributorEntry[] => {
      const probeWeekKey = probeWeek ? toYmdUtc(probeWeek) : null;
      type RankedExplanationContributorEntry = ExplanationContributorEntry & { sortDemand: number };
      return Array.from(state.project.contributorDays.entries())
        .filter(([, days]) => days > EPSILON)
        .map(([contributorId, demandDays]): RankedExplanationContributorEntry => {
          const contributor = prepared.contributors.get(contributorId);
          const reservedLoad = probeWeekKey
            ? round2(this.getCommittedLoad(committedLoad, contributorId, probeWeekKey))
            : null;
	          const activeProjectCount = probeWeekKey
	            ? this.getActiveCount(activeProjects, contributorId, probeWeekKey)
	            : null;
	          let reason: ExplanationContributorEntry['reason'] = 'capacity';
	          if ((reservedLoad ?? 0) > EPSILON) {
	            reason = 'reservation';
	          } else if ((activeProjectCount ?? 0) >= options.parallelizationLimit) {
	            reason = 'slot';
	          } else if (state.project.schedulingMode === 'collaborative' && ((reservedLoad ?? 0) > EPSILON || (activeProjectCount ?? 0) > 0)) {
	            reason = 'collaborative_bottleneck';
	          }
          return {
            contributorId,
            contributorName: contributor?.name ?? contributorId,
            weeklyCapacity: round2(weeklyCapacityByUser.get(contributorId) ?? 0),
            reservedLoad,
            activeProjectCount,
            reason,
            sortDemand: demandDays,
          };
        })
        .sort((a, b) =>
          (b.reservedLoad ?? 0) - (a.reservedLoad ?? 0)
          || (b.activeProjectCount ?? 0) - (a.activeProjectCount ?? 0)
          || b.sortDemand - a.sortDemand
          || a.contributorName.localeCompare(b.contributorName)
          || a.contributorId.localeCompare(b.contributorId))
        .slice(0, 3)
        .map(({ sortDemand, ...entry }) => entry);
    };

    const getConstraintConflictMessage = (
      constraint: ScheduleConstraint | null | undefined,
      actualStartWeek: string | null,
      actualEndWeek: string | null,
    ): RoadmapText | null => {
      if (!constraint) return null;
      const effectiveConstraintStartWeek = getEffectiveConstraintStartWeek(constraint);
      const effectiveConstraintStartWeekYmd = effectiveConstraintStartWeek
        ? toYmdUtc(effectiveConstraintStartWeek)
        : null;
      switch (constraint.type) {
        case 'pin_start':
          if (!actualStartWeek) {
            return roadmapText('conflict_pin_start_unsatisfied', { week: constraint.startWeek });
          }
          if (effectiveConstraintStartWeekYmd && actualStartWeek !== effectiveConstraintStartWeekYmd) {
            if (effectiveConstraintStartWeekYmd !== constraint.startWeek) {
              return roadmapText('conflict_pin_start_normalized', {
                week: constraint.startWeek,
                normalized: effectiveConstraintStartWeekYmd,
                actual: actualStartWeek,
              });
            }
            return roadmapText('conflict_pin_start_slipped', { week: constraint.startWeek, actual: actualStartWeek });
          }
          return null;
        case 'pin_window':
          if (!actualStartWeek) {
            return roadmapText('conflict_pin_window_unsatisfied', { start: constraint.startWeek, end: constraint.endWeek });
          }
          if (
            (effectiveConstraintStartWeekYmd != null && actualStartWeek < effectiveConstraintStartWeekYmd)
            || actualStartWeek > constraint.endWeek
            || (actualEndWeek != null && actualEndWeek > constraint.endWeek)
          ) {
            return roadmapText('conflict_pin_window_missed', {
              start: constraint.startWeek,
              end: constraint.endWeek,
              actualStart: actualStartWeek,
              actualEnd: actualEndWeek ?? actualStartWeek,
            });
          }
          return null;
        case 'not_before':
          if (effectiveConstraintStartWeekYmd && actualStartWeek && actualStartWeek < effectiveConstraintStartWeekYmd) {
            return roadmapText('conflict_not_before_violated', { week: constraint.startWeek, actual: actualStartWeek });
          }
          return null;
        default:
          return null;
      }
    };

    const buildExplanation = (
      projectId: string,
      classification: ProjectExplanation['classification'],
      actualStartWeek: string | null,
      fallbackUnschedulable?: UnschedulableProject,
    ): ProjectExplanation | null => {
      const state = runtimeByProject.get(projectId);
      const project = state?.project ?? prepared.candidates.get(projectId);
      const unschedulable = fallbackUnschedulable ?? unschedulableMap.get(projectId);
      const schedulingMode = project?.schedulingMode ?? unschedulable?.schedulingMode;
      if (!schedulingMode) return null;
      const activeConstraint = project?.constraint ?? null;

      const earliestEligibleDate = activeConstraint
        ? (state?.firstReadyWeek ?? externalEarliestWeekByProject.get(projectId) ?? null)
        : (state?.historicalStart
          ? getWeekStartMondayUtc(state.historicalStart)
          : (state?.firstReadyWeek ?? externalEarliestWeekByProject.get(projectId) ?? null));
      const earliestEligibleWeek = earliestEligibleDate ? toYmdUtc(earliestEligibleDate) : null;
      const dependencyReasons = buildDependencyReasonEntries(projectId);
      const dominantBlockages = state ? buildDominantBlockageEntries(state) : [];
      const blockerReasons = Array.from(
        new Map(
          [...dependencyReasons, ...dominantBlockages]
            .map((entry) => [`${entry.kind}:${entry.projectId ?? ''}:${entry.label}`, entry]),
        ).values(),
      );
      const constraintConflictMessage = getConstraintConflictMessage(
        activeConstraint,
        actualStartWeek,
        classification === 'scheduled'
          ? schedule.find((item) => item.projectId === projectId)?.plannedEnd ?? null
          : null,
      );
      if (constraintConflictMessage) {
        const effectiveConstraintStartWeek = getEffectiveConstraintStartWeek(activeConstraint);
        blockerReasons.unshift({
          kind: 'constraint_conflict',
          label: renderRoadmapText(constraintConflictMessage),
          labelText: constraintConflictMessage,
          projectId: projectId,
          scenarioProjectId: null,
          fromWeek: effectiveConstraintStartWeek ? toYmdUtc(effectiveConstraintStartWeek) : null,
          toWeek: activeConstraint?.type === 'pin_window' ? activeConstraint.endWeek : actualStartWeek,
        });
      }
      const delayedByCapacity = !!state
        && !!state.firstReadyWeek
        && !!state.firstAllocatedWeek
        && state.firstAllocatedWeek.getTime() > state.firstReadyWeek.getTime();
      const probeWeek = state?.firstAllocatedWeek && delayedByCapacity
        ? addDaysUtc(state.firstAllocatedWeek, -7)
        : (state?.lastReadyWeek ?? null);
      const limitingContributors = state ? buildLimitingContributors(state, probeWeek) : [];

      let startReason: ProjectExplanation['startReason'] = 'unscheduled';
      if (classification === 'scheduled' && state) {
        if (activeConstraint?.type === 'pin_start') {
          startReason = 'constraint_pin_start';
        } else if (activeConstraint?.type === 'pin_window') {
          startReason = 'constraint_pin_window';
        } else if (activeConstraint?.type === 'not_before') {
          startReason = 'constraint_not_before';
        } else if (state.historicalStart) {
          startReason = 'historical_start';
        } else if (dependencyReasons.length > 0 && state.firstReadyWeek && state.firstAllocatedWeek
          && state.firstReadyWeek.getTime() === state.firstAllocatedWeek.getTime()) {
          startReason = 'dependency_release';
        } else {
          startReason = 'capacity_available';
        }
      }

      const unschedulableReasonText = unschedulable?.detailsText
        ?? roadmapText('reason', { reason: unschedulable?.reason ?? 'insufficient_capacity' });
      const finalReasonText: RoadmapText | null = classification === 'unschedulable'
        ? (constraintConflictMessage ?? unschedulableReasonText)
        : (
          constraintConflictMessage
            ? constraintConflictMessage
            : (delayedByCapacity && earliestEligibleWeek && actualStartWeek
            ? roadmapText('final_capacity', { eligible: earliestEligibleWeek, week: actualStartWeek })
            : (dependencyReasons.length > 0 && actualStartWeek
              ? roadmapText('final_blockers', { week: actualStartWeek })
              : (actualStartWeek ? roadmapText('final_started', { week: actualStartWeek }) : null)))
        );

      const projectName = project?.name ?? projectId;
      const summaryText = classification === 'unschedulable'
        ? roadmapText('summary_unschedulable', {
          project: project?.name ?? unschedulable?.projectName ?? projectId,
          reason: finalReasonText ?? unschedulableReasonText,
        })
        : (
          startReason === 'historical_start'
            ? roadmapText('summary_historical', { project: projectName, week: actualStartWeek })
            : (activeConstraint && actualStartWeek
              ? (constraintConflictMessage
                ? roadmapText('summary_constraint_conflict', {
                  project: projectName,
                  week: actualStartWeek,
                  constraint: activeConstraint,
                  conflict: constraintConflictMessage,
                })
                : roadmapText('summary_constraint', { project: projectName, week: actualStartWeek, constraint: activeConstraint }))
              : (delayedByCapacity && earliestEligibleWeek && actualStartWeek
                ? roadmapText('summary_capacity', { project: projectName, eligible: earliestEligibleWeek, week: actualStartWeek })
                : (dependencyReasons.length > 0 && actualStartWeek
                  ? roadmapText('summary_blockers', { project: projectName, week: actualStartWeek })
                  : roadmapText('summary_schedulable', { project: projectName, week: actualStartWeek }))))
        );

      const reasons = blockerReasons.length > 0
        ? blockerReasons
        : (classification === 'unschedulable' && unschedulable
          ? [{
            kind: mapUnschedulableReasonToExplanationKind(unschedulable.reason),
            label: renderRoadmapText(unschedulableReasonText),
            labelText: unschedulableReasonText,
            projectId: null,
            scenarioProjectId: null,
            fromWeek: state?.firstReadyWeek ? toYmdUtc(state.firstReadyWeek) : null,
            toWeek: state?.lastReadyWeek ? toYmdUtc(state.lastReadyWeek) : null,
          }]
          : []);

      return {
        itemRef: buildItemRef(projectId),
        summary: renderRoadmapText(summaryText),
        summaryText,
        classification,
        schedulingMode,
        earliestEligibleWeek,
        actualStartWeek,
        derivedFromConstraint: !!activeConstraint && !constraintConflictMessage && !state?.historicalStart,
        activeConstraint,
        startReason,
        blockerReasons: reasons,
        limitingContributors,
        finalReason: finalReasonText ? renderRoadmapText(finalReasonText) : null,
        finalReasonText,
      };
    };

    const lastWeekWithinHorizon = addDaysUtc(firstWeekToPlan, 7 * Math.max(0, horizonWeeks - 1));

    for (let weekIndex = 0; weekIndex < horizonWeeks; weekIndex += 1) {
      const weekKey = toYmdUtc(cursor);
      const remainingProjects = Array.from(runtimeByProject.entries())
        .filter(([, state]) => !state.done && state.remainingTotal > EPSILON)
        .map(([projectId]) => projectId);
      if (remainingProjects.length === 0) {
        break;
      }

      const readyProjects = remainingProjects.filter((projectId) => {
        const state = runtimeByProject.get(projectId);
        if (!state || state.done) return false;
        const earliestWeek = externalEarliestWeekByProject.get(projectId) ?? firstWeekToPlan;
        if (cursor.getTime() < earliestWeek.getTime()) return false;
        const latestConstraintStartWeek = getConstraintEndWeek(state.project.constraint);
        if (!computeStartedWeek(state)
          && latestConstraintStartWeek
          && cursor.getTime() > latestConstraintStartWeek.getTime()) {
          return false;
        }

        const blockers = internalBlockersByProject.get(projectId) ?? [];
        for (const blockerId of blockers) {
          const blockerEnd = scheduledEndByProject.get(blockerId);
          if (!blockerEnd) return false;
          const nextWeek = ceilToMondayUtc(addDaysUtc(blockerEnd, 1));
          if (cursor.getTime() < nextWeek.getTime()) return false;
        }
        return true;
      }).sort(rankProjects);
      for (const projectId of readyProjects) {
        const state = runtimeByProject.get(projectId)!;
        state.everReady = true;
        if (!state.firstReadyWeek) state.firstReadyWeek = cursor;
        state.lastReadyWeek = cursor;
      }

      const allocatedProjectsThisWeek = new Set<string>();
      if (readyProjects.length > 0) {
        const rankIndexByProject = new Map<string, number>();
        readyProjects.forEach((projectId, index) => rankIndexByProject.set(projectId, index));

        const reservedSlotsByContributor = new Map<string, number>();
        const reservedLoadByContributor = new Map<string, number>();
        const candidateSlotBudgetByContributor = new Map<string, number>();
        const activeCandidateProjectsByContributor = new Map<string, Set<string>>();
        for (const contributorId of contributorIds) {
          const reservedSlots = this.getActiveCount(activeProjects, contributorId, weekKey);
          const reservedLoad = this.getCommittedLoad(committedLoad, contributorId, weekKey);
          reservedSlotsByContributor.set(contributorId, reservedSlots);
          reservedLoadByContributor.set(contributorId, reservedLoad);
          candidateSlotBudgetByContributor.set(
            contributorId,
            Math.max(0, options.parallelizationLimit - reservedSlots),
          );
          activeCandidateProjectsByContributor.set(contributorId, new Set<string>());
        }

        const selectedCollaborativeProjects = new Set<string>();
        const selectedIndependentProjects = new Set<string>();

        const getRequiredContributors = (state: CandidateRuntimeState): string[] => Array.from(
          state.remainingByContributor.entries(),
        )
          .filter(([, days]) => days > EPSILON)
          .map(([contributorId]) => contributorId)
          .sort((a, b) => a.localeCompare(b));

        const getContributorActiveSet = (contributorId: string): Set<string> => {
          const existing = activeCandidateProjectsByContributor.get(contributorId);
          if (existing) return existing;
          const created = new Set<string>();
          activeCandidateProjectsByContributor.set(contributorId, created);
          return created;
        };

        const getEffectiveOpenProjectCount = (contributorId: string): number => {
          const openSet = getOpenProjectSet(contributorId);
          const activeSet = getContributorActiveSet(contributorId);
          let count = openSet.size;
          for (const projectId of activeSet) {
            if (!openSet.has(projectId)) count += 1;
          }
          return count;
        };

        const getProjectedOpenProjectCount = (contributorId: string, projectId: string): number => {
          const openSet = getOpenProjectSet(contributorId);
          const activeSet = getContributorActiveSet(contributorId);
          if (openSet.has(projectId) || activeSet.has(projectId)) {
            return getEffectiveOpenProjectCount(contributorId);
          }
          return getEffectiveOpenProjectCount(contributorId) + 1;
        };

        const contributorCanAddProject = (contributorId: string, projectId: string): boolean => {
          const activeSet = getContributorActiveSet(contributorId);
          if (activeSet.has(projectId)) return true;
          const openSet = getOpenProjectSet(contributorId);
          if (openSet.has(projectId)) return true;
          return getEffectiveOpenProjectCount(contributorId) < (candidateSlotBudgetByContributor.get(contributorId) ?? 0);
        };

        const addProjectToContributor = (contributorId: string, projectId: string): boolean => {
          const activeSet = getContributorActiveSet(contributorId);
          if (activeSet.has(projectId)) return true;
          const openSet = getOpenProjectSet(contributorId);
          if (!openSet.has(projectId)
            && getEffectiveOpenProjectCount(contributorId) >= (candidateSlotBudgetByContributor.get(contributorId) ?? 0)) {
            return false;
          }
          activeSet.add(projectId);
          return true;
        };

        const removeProjectFromContributor = (contributorId: string, projectId: string): void => {
          getContributorActiveSet(contributorId).delete(projectId);
        };

        const getProjectedCandidateCapacity = (
          contributorId: string,
          projectId: string,
          projectedActiveCount: number,
        ): number => {
          if (projectedActiveCount <= 0) return 0;
          const weeklyBaseCapacity = weeklyCapacityByUser.get(contributorId) ?? 0;
          if (weeklyBaseCapacity <= EPSILON) return 0;
          const totalContextCount = (reservedSlotsByContributor.get(contributorId) ?? 0)
            + getProjectedOpenProjectCount(contributorId, projectId);
          const effectiveCapacity = this.computeEffectiveWeeklyCapacity(
            weeklyBaseCapacity,
            totalContextCount,
            options,
          );
          const reservedLoad = reservedLoadByContributor.get(contributorId) ?? 0;
          return Math.max(0, effectiveCapacity - reservedLoad);
        };

        const estimateCollaborativeStartBurn = (projectId: string, contributorsToAdd: string[]): number => {
          const state = runtimeByProject.get(projectId);
          if (!state || state.remainingTotal <= EPSILON) return 0;
          const totalBefore = state.remainingTotal;
          let projectBurnCap = Number.POSITIVE_INFINITY;
          for (const contributorId of contributorsToAdd) {
            const demand = state.remainingByContributor.get(contributorId) ?? 0;
            if (demand <= EPSILON) return 0;
            const currentActiveCount = getContributorActiveSet(contributorId).size;
            const projectedActiveCount = currentActiveCount + (getContributorActiveSet(contributorId).has(projectId) ? 0 : 1);
            const candidateCapacity = getProjectedCandidateCapacity(contributorId, projectId, projectedActiveCount);
            const provisionalBudget = projectedActiveCount > 0 ? candidateCapacity / projectedActiveCount : 0;
            const weight = demand / totalBefore;
            if (provisionalBudget <= EPSILON || weight <= EPSILON) return 0;
            projectBurnCap = Math.min(projectBurnCap, provisionalBudget / weight);
          }
          if (!Number.isFinite(projectBurnCap)) return 0;
          return Math.min(totalBefore, projectBurnCap);
        };

        const getIndependentContributorOrder = (state: CandidateRuntimeState): string[] => Array.from(
          state.remainingByContributor.entries(),
        )
          .filter(([, days]) => days > EPSILON)
          .sort((leftEntry, rightEntry) => {
            const leftHasHistory = state.contributorsWithHistory.has(leftEntry[0]) ? 1 : 0;
            const rightHasHistory = state.contributorsWithHistory.has(rightEntry[0]) ? 1 : 0;
            if (leftHasHistory !== rightHasHistory) return rightHasHistory - leftHasHistory;
            return leftEntry[0].localeCompare(rightEntry[0]);
          })
          .map(([contributorId]) => contributorId);

        const estimateIndependentSelection = (projectId: string): { contributors: string[]; expectedBurn: number } => {
          const state = runtimeByProject.get(projectId);
          if (!state || state.remainingTotal <= EPSILON) {
            return { contributors: [], expectedBurn: 0 };
          }
          const contributors: string[] = [];
          let expectedBurn = 0;
          for (const contributorId of getIndependentContributorOrder(state)) {
            const demand = state.remainingByContributor.get(contributorId) ?? 0;
            if (demand <= EPSILON) continue;
            if (!contributorCanAddProject(contributorId, projectId)) continue;
            const currentActiveCount = getContributorActiveSet(contributorId).size;
            const projectedActiveCount = currentActiveCount + (getContributorActiveSet(contributorId).has(projectId) ? 0 : 1);
            const candidateCapacity = getProjectedCandidateCapacity(contributorId, projectId, projectedActiveCount);
            const provisionalBudget = projectedActiveCount > 0 ? candidateCapacity / projectedActiveCount : 0;
            const contribution = Math.min(demand, provisionalBudget);
            if (contribution <= EPSILON) continue;
            contributors.push(contributorId);
            expectedBurn += contribution;
          }
          return { contributors, expectedBurn };
        };

        const removeCollaborativeProject = (projectId: string): void => {
          const state = runtimeByProject.get(projectId);
          if (!state) return;
          selectedCollaborativeProjects.delete(projectId);
          for (const contributorId of getRequiredContributors(state)) {
            removeProjectFromContributor(contributorId, projectId);
          }
        };

        const removeIndependentProject = (projectId: string): void => {
          selectedIndependentProjects.delete(projectId);
          for (const contributorId of contributorIds) {
            removeProjectFromContributor(contributorId, projectId);
          }
        };

        const computeContributorBudgets = (): {
          activeCountByContributor: Map<string, number>;
          candidateCapacityByContributor: Map<string, number>;
          perProjectBudgetByContributor: Map<string, number>;
        } => {
          const activeCountByContributor = new Map<string, number>();
          const candidateCapacityByContributor = new Map<string, number>();
          const perProjectBudgetByContributor = new Map<string, number>();
          for (const contributorId of contributorIds) {
            const activeCount = getContributorActiveSet(contributorId).size;
            activeCountByContributor.set(contributorId, activeCount);
            if (activeCount <= 0) {
              candidateCapacityByContributor.set(contributorId, 0);
              perProjectBudgetByContributor.set(contributorId, 0);
              continue;
            }
            const weeklyBaseCapacity = weeklyCapacityByUser.get(contributorId) ?? 0;
            if (weeklyBaseCapacity <= EPSILON) {
              candidateCapacityByContributor.set(contributorId, 0);
              perProjectBudgetByContributor.set(contributorId, 0);
              continue;
            }
            const totalContextCount = (reservedSlotsByContributor.get(contributorId) ?? 0)
              + getEffectiveOpenProjectCount(contributorId);
            const effectiveCapacity = this.computeEffectiveWeeklyCapacity(
              weeklyBaseCapacity,
              totalContextCount,
              options,
            );
            const reservedLoad = reservedLoadByContributor.get(contributorId) ?? 0;
            const candidateCapacity = Math.max(0, effectiveCapacity - reservedLoad);
            candidateCapacityByContributor.set(contributorId, candidateCapacity);
            perProjectBudgetByContributor.set(
              contributorId,
              candidateCapacity > EPSILON ? candidateCapacity / activeCount : 0,
            );
          }
          return {
            activeCountByContributor,
            candidateCapacityByContributor,
            perProjectBudgetByContributor,
          };
        };

        const minimumRequiredBurn = (state: CandidateRuntimeState): number => (
          isContinuingProject(state) ? EPSILON : SLOT_OCCUPANCY_THRESHOLD_DAYS
        );

        const computeSelectedCollaborativeExpectedBurn = (
          projectId: string,
          perProjectBudgetByContributor: Map<string, number>,
        ): number => {
          const state = runtimeByProject.get(projectId);
          if (!state || state.remainingTotal <= EPSILON) return 0;
          const neededContributors = getRequiredContributors(state)
            .filter((contributorId) => getContributorActiveSet(contributorId).has(projectId));
          if (neededContributors.length === 0) return 0;
          const totalBefore = state.remainingTotal;
          let projectBurnCap = Number.POSITIVE_INFINITY;
          for (const contributorId of neededContributors) {
            const demand = state.remainingByContributor.get(contributorId) ?? 0;
            const budget = perProjectBudgetByContributor.get(contributorId) ?? 0;
            const weight = demand / totalBefore;
            if (demand <= EPSILON || budget <= EPSILON || weight <= EPSILON) {
              projectBurnCap = 0;
              break;
            }
            projectBurnCap = Math.min(projectBurnCap, budget / weight);
          }
          if (!Number.isFinite(projectBurnCap)) return 0;
          return Math.min(totalBefore, projectBurnCap);
        };

        const computeSelectedIndependentExpectedBurn = (
          projectId: string,
          perProjectBudgetByContributor: Map<string, number>,
        ): number => {
          const state = runtimeByProject.get(projectId);
          if (!state || state.remainingTotal <= EPSILON) return 0;
          let expectedBurn = 0;
          for (const contributorId of getIndependentContributorOrder(state)) {
            if (!getContributorActiveSet(contributorId).has(projectId)) continue;
            const demand = state.remainingByContributor.get(contributorId) ?? 0;
            const budget = perProjectBudgetByContributor.get(contributorId) ?? 0;
            if (demand <= EPSILON || budget <= EPSILON) continue;
            expectedBurn += Math.min(demand, budget);
          }
          return expectedBurn;
        };

        const selectedProjectsMeetMinimums = (): boolean => {
          const { perProjectBudgetByContributor } = computeContributorBudgets();
          for (const projectId of selectedCollaborativeProjects) {
            const state = runtimeByProject.get(projectId);
            if (!state) continue;
            const expectedBurn = computeSelectedCollaborativeExpectedBurn(projectId, perProjectBudgetByContributor);
            if (expectedBurn < minimumRequiredBurn(state)) return false;
          }
          for (const projectId of selectedIndependentProjects) {
            const state = runtimeByProject.get(projectId);
            if (!state) continue;
            const expectedBurn = computeSelectedIndependentExpectedBurn(projectId, perProjectBudgetByContributor);
            if (expectedBurn < minimumRequiredBurn(state)) return false;
          }
          return true;
        };

        for (const projectId of readyProjects) {
          const state = runtimeByProject.get(projectId);
          if (!state || state.done || state.remainingTotal <= EPSILON) continue;
          if (state.project.schedulingMode === 'collaborative') {
            const neededContributors = getRequiredContributors(state);
            if (neededContributors.length === 0) continue;
            if (!neededContributors.every((contributorId) => contributorCanAddProject(contributorId, projectId))) {
              continue;
            }
            const expectedBurn = estimateCollaborativeStartBurn(projectId, neededContributors);
            if (expectedBurn < minimumRequiredBurn(state)) continue;

            let added = true;
            for (const contributorId of neededContributors) {
              added = addProjectToContributor(contributorId, projectId) && added;
            }
            if (!added) {
              removeCollaborativeProject(projectId);
              continue;
            }
            selectedCollaborativeProjects.add(projectId);
            if (!selectedProjectsMeetMinimums()) {
              removeCollaborativeProject(projectId);
            }
            continue;
          }

          const { contributors, expectedBurn } = estimateIndependentSelection(projectId);
          if (contributors.length === 0 || expectedBurn < minimumRequiredBurn(state)) continue;

          let addedAny = false;
          for (const contributorId of contributors) {
            if (addProjectToContributor(contributorId, projectId)) {
              addedAny = true;
            }
          }
          if (!addedAny) {
            removeIndependentProject(projectId);
            continue;
          }
          selectedIndependentProjects.add(projectId);
          if (!selectedProjectsMeetMinimums()) {
            removeIndependentProject(projectId);
          }
        }

        const {
          candidateCapacityByContributor,
          perProjectBudgetByContributor,
        } = computeContributorBudgets();

        const burnByProject = new Map<string, Map<string, number>>();
        const totalBurnByContributor = new Map<string, number>();
        const addBurn = (projectId: string, contributorId: string, days: number): void => {
          if (days <= EPSILON) return;
          const byContributor = burnByProject.get(projectId) ?? new Map<string, number>();
          byContributor.set(contributorId, (byContributor.get(contributorId) ?? 0) + days);
          burnByProject.set(projectId, byContributor);
          totalBurnByContributor.set(
            contributorId,
            (totalBurnByContributor.get(contributorId) ?? 0) + days,
          );
        };

        for (const projectId of readyProjects) {
          if (!selectedCollaborativeProjects.has(projectId)) continue;
          const state = runtimeByProject.get(projectId);
          if (!state || state.remainingTotal <= EPSILON) continue;
          const neededContributors = getRequiredContributors(state)
            .filter((contributorId) => getContributorActiveSet(contributorId).has(projectId));
          if (neededContributors.length === 0) continue;
          const totalBefore = state.remainingTotal;
          let projectBurnCap = Number.POSITIVE_INFINITY;
          for (const contributorId of neededContributors) {
            const demand = state.remainingByContributor.get(contributorId) ?? 0;
            const budget = perProjectBudgetByContributor.get(contributorId) ?? 0;
            const weight = demand / totalBefore;
            if (demand <= EPSILON || budget <= EPSILON || weight <= EPSILON) {
              projectBurnCap = 0;
              break;
            }
            projectBurnCap = Math.min(projectBurnCap, budget / weight);
          }
          const burn = Math.min(totalBefore, projectBurnCap);
          if (!Number.isFinite(burn) || burn <= EPSILON) continue;
          for (const contributorId of neededContributors) {
            const demand = state.remainingByContributor.get(contributorId) ?? 0;
            if (demand <= EPSILON) continue;
            const weight = demand / totalBefore;
            const consumed = Math.min(demand, burn * weight);
            addBurn(projectId, contributorId, consumed);
          }
        }

        for (const contributorId of contributorIds) {
          const budget = perProjectBudgetByContributor.get(contributorId) ?? 0;
          if (budget <= EPSILON) continue;
          const projectIds = Array.from(getContributorActiveSet(contributorId))
            .filter((projectId) => runtimeByProject.get(projectId)?.project.schedulingMode === 'independent')
            .sort((leftId, rightId) =>
              (rankIndexByProject.get(leftId) ?? Number.MAX_SAFE_INTEGER)
              - (rankIndexByProject.get(rightId) ?? Number.MAX_SAFE_INTEGER));
          for (const projectId of projectIds) {
            const state = runtimeByProject.get(projectId);
            if (!state) continue;
            const alreadyBurned = burnByProject.get(projectId)?.get(contributorId) ?? 0;
            const remainingDemand = Math.max(0, (state.remainingByContributor.get(contributorId) ?? 0) - alreadyBurned);
            const consumed = Math.min(remainingDemand, budget);
            addBurn(projectId, contributorId, consumed);
          }
        }

        for (const contributorId of contributorIds) {
          let leftover = Math.max(
            0,
            (candidateCapacityByContributor.get(contributorId) ?? 0) - (totalBurnByContributor.get(contributorId) ?? 0),
          );
          if (leftover <= EPSILON) continue;
          const projectIds = Array.from(getContributorActiveSet(contributorId))
            .filter((projectId) => runtimeByProject.get(projectId)?.project.schedulingMode === 'independent')
            .sort((leftId, rightId) =>
              (rankIndexByProject.get(leftId) ?? Number.MAX_SAFE_INTEGER)
              - (rankIndexByProject.get(rightId) ?? Number.MAX_SAFE_INTEGER));
          for (const projectId of projectIds) {
            if (leftover <= EPSILON) break;
            const state = runtimeByProject.get(projectId);
            if (!state) continue;
            const alreadyBurned = burnByProject.get(projectId)?.get(contributorId) ?? 0;
            const remainingDemand = Math.max(0, (state.remainingByContributor.get(contributorId) ?? 0) - alreadyBurned);
            const extra = Math.min(remainingDemand, leftover);
            addBurn(projectId, contributorId, extra);
            leftover -= extra;
          }
        }

        for (const [projectId, byContributor] of burnByProject.entries()) {
          const state = runtimeByProject.get(projectId);
          if (!state) continue;
          let projectBurn = 0;
          for (const [contributorId, requestedBurn] of byContributor.entries()) {
            const remainingBefore = state.remainingByContributor.get(contributorId) ?? 0;
            const consumed = Math.min(remainingBefore, requestedBurn);
            if (consumed <= EPSILON) continue;
            state.remainingByContributor.set(contributorId, Math.max(0, remainingBefore - consumed));
            state.contributorTotals.set(
              contributorId,
              (state.contributorTotals.get(contributorId) ?? 0) + consumed,
            );
            state.contributorsWithHistory.add(contributorId);
            markProjectOpenForContributor(contributorId, projectId);
            projectBurn += consumed;
            this.addActiveProject(activeProjects, contributorId, weekKey, projectId);
            if (weeklyProjectLoad) {
              this.addWeeklyProjectLoad(weeklyProjectLoad, contributorId, weekKey, projectId, consumed);
            }
            if ((state.remainingByContributor.get(contributorId) ?? 0) <= EPSILON) {
              closeProjectForContributor(contributorId, projectId);
            }
          }
          if (projectBurn <= EPSILON) continue;
          state.remainingTotal = Math.max(0, state.remainingTotal - projectBurn);
          if (!state.firstAllocatedWeek) state.firstAllocatedWeek = cursor;
          state.lastAllocatedWeek = cursor;
          state.activeWeekKeys.add(weekKey);
          allocatedProjectsThisWeek.add(projectId);
        }

        const classifyUnallocatedReadyProject = (
          projectId: string,
        ): { reason: RuntimeCapacityReason; details: RoadmapText } => {
          const state = runtimeByProject.get(projectId)!;
          const demandedContributors = getRequiredContributors(state);
          const slotBlockedContributors = demandedContributors.filter((contributorId) => {
            const activeSet = getContributorActiveSet(contributorId);
            const openSet = getOpenProjectSet(contributorId);
            return !activeSet.has(projectId)
              && !openSet.has(projectId)
              && getEffectiveOpenProjectCount(contributorId) >= (candidateSlotBudgetByContributor.get(contributorId) ?? 0);
          });

          if (state.project.schedulingMode === 'collaborative') {
            if (!selectedCollaborativeProjects.has(projectId) && slotBlockedContributors.length > 0) {
              return {
                reason: 'no_free_slot',
                details: roadmapText('no_free_slot_for', { contributors: describeContributors(slotBlockedContributors) }),
              };
            }

            const expectedBurn = estimateCollaborativeStartBurn(projectId, demandedContributors);
            if (expectedBurn <= EPSILON) {
              return {
                reason: 'no_effective_capacity',
                details: roadmapText('no_allocable_capacity_for', { contributors: describeContributors(demandedContributors) }),
              };
            }
            if (!selectedCollaborativeProjects.has(projectId) && expectedBurn < SLOT_OCCUPANCY_THRESHOLD_DAYS) {
              return {
                reason: 'below_minimum_start_threshold',
                details: roadmapText('collaborative_burn_below_threshold', {
                  burn: round2(expectedBurn),
                  threshold: SLOT_OCCUPANCY_THRESHOLD_DAYS,
                }),
              };
            }
            return {
              reason: 'no_effective_capacity',
              details: roadmapText('collaborative_burn_stalled_for', { contributors: describeContributors(demandedContributors) }),
            };
          }

          const { contributors, expectedBurn } = estimateIndependentSelection(projectId);
          if (!selectedIndependentProjects.has(projectId)) {
            if (slotBlockedContributors.length === demandedContributors.length && demandedContributors.length > 0) {
              return {
                reason: 'no_free_slot',
                details: roadmapText('no_free_slot_for', { contributors: describeContributors(slotBlockedContributors) }),
              };
            }
            if (contributors.length === 0 || expectedBurn <= EPSILON) {
              return {
                reason: 'no_effective_capacity',
                details: roadmapText('no_allocable_capacity_for', { contributors: describeContributors(demandedContributors) }),
              };
            }
            if (expectedBurn < SLOT_OCCUPANCY_THRESHOLD_DAYS) {
              return {
                reason: 'below_minimum_start_threshold',
                details: roadmapText('independent_burn_below_threshold', {
                  burn: round2(expectedBurn),
                  threshold: SLOT_OCCUPANCY_THRESHOLD_DAYS,
                }),
              };
            }
          }

          return {
            reason: 'no_effective_capacity',
            details: roadmapText('no_capacity_remained_for', { contributors: describeContributors(demandedContributors) }),
          };
        };

        for (const projectId of readyProjects) {
          if (allocatedProjectsThisWeek.has(projectId)) continue;
          const state = runtimeByProject.get(projectId);
          if (!state || state.done || state.remainingTotal <= EPSILON) continue;
          const blockage = classifyUnallocatedReadyProject(projectId);
          recordBlockage(state, blockage.reason, blockage.details);
        }
      }

      for (const projectId of readyProjects) {
        const state = runtimeByProject.get(projectId);
        if (!state || state.done || state.remainingTotal <= EPSILON) continue;
        if (allocatedProjectsThisWeek.has(projectId)) {
          waitWeeksByProject.set(projectId, 0);
        } else {
          waitWeeksByProject.set(projectId, (waitWeeksByProject.get(projectId) ?? 0) + 1);
        }
      }

      for (const [projectId, state] of runtimeByProject.entries()) {
        if (state.done || state.remainingTotal > EPSILON) continue;
        state.done = true;
        if (!state.lastAllocatedWeek) continue;
        const computedEnd = addDaysUtc(state.lastAllocatedWeek, 4);
        scheduledEndByProject.set(projectId, computedEnd);
        knownEndByProject.set(projectId, computedEnd);
      }

      cursor = addDaysUtc(cursor, 7);
    }

    const schedule: ScheduledProject[] = [];
    for (const projectId of Array.from(candidateIds).sort((a, b) => a.localeCompare(b))) {
      const state = runtimeByProject.get(projectId);
      if (!state) continue;
      const project = state.project;

      if (state.remainingTotal > EPSILON || !state.firstAllocatedWeek || !state.lastAllocatedWeek) {
        let reason: RuntimeCapacityReason = 'insufficient_capacity';
        let details = roadmapText('capacity_prevented_scheduling');

        if (!state.everReady) {
          const unresolvedInternalBlockers = (internalBlockersByProject.get(projectId) ?? [])
            .filter((blockerId) => {
              const blockerState = runtimeByProject.get(blockerId);
              return blockerState ? !blockerState.done : !scheduledEndByProject.has(blockerId);
            })
            .map((blockerId) => prepared.projectNameById.get(blockerId) || blockerId);

          if (unresolvedInternalBlockers.length > 0) {
            details = roadmapText('waiting_on_blockers', { blockers: unresolvedInternalBlockers });
          } else {
            const earliestWeek = externalEarliestWeekByProject.get(projectId);
            details = earliestWeek && earliestWeek.getTime() > lastWeekWithinHorizon.getTime()
              ? roadmapText('earliest_start_beyond_horizon', { week: toYmdUtc(earliestWeek), horizonWeeks })
              : roadmapText('never_ready_within_horizon');
          }
          reason = 'not_ready_within_horizon';
        } else if (state.firstAllocatedWeek || state.historicalStart) {
          details = roadmapText('remaining_after_horizon', {
            remainingDays: round2(state.remainingTotal),
            horizonWeeks,
            loads: describeLargestRemainingLoads(state),
          });
          reason = 'unfinished_within_horizon';
        } else {
          const dominantBlockage = chooseDominantBlockage(state);
          if (dominantBlockage) {
            reason = dominantBlockage.reason;
            details = dominantBlockage.details;
          } else {
            details = roadmapText('no_allocable_week');
          }
        }

        unschedulableMap.set(projectId, {
          projectId: project.id,
          projectName: project.name,
          status: project.status,
          schedulingMode: project.schedulingMode,
          reason,
          details: renderRoadmapText(details),
          detailsText: details,
        });
        continue;
      }

      const computedStart = state.firstAllocatedWeek;
      const computedEnd = addDaysUtc(state.lastAllocatedWeek, 4);
      const historicalLeadStart = state.historicalStart
        && state.historicalStart.getTime() < computedStart.getTime()
        ? state.historicalStart
        : null;

      const contributorLoads = Array.from(state.contributorTotals.entries())
        .map(([contributorId, days]) => ({
          contributorId,
          contributorName: prepared.contributors.get(contributorId)?.name ?? contributorId,
          days: round2(days),
        }))
        .sort((a, b) =>
          b.days - a.days
          || a.contributorName.localeCompare(b.contributorName)
          || a.contributorId.localeCompare(b.contributorId));

      const durationWeeks = Math.max(
        1,
        Math.round(
          (getWeekStartMondayUtc(computedEnd).getTime() - getWeekStartMondayUtc(computedStart).getTime())
          / (7 * MS_PER_DAY),
        ) + 1,
      );
      const activeWeekStarts = Array.from(state.activeWeekKeys).sort((a, b) => a.localeCompare(b));

      schedule.push({
        projectId: project.id,
        projectName: project.name,
        status: project.status,
        schedulingMode: project.schedulingMode,
        categoryId: project.categoryId,
        sourceId: project.sourceId,
        streamId: project.streamId,
        executionProgress: round2(project.executionProgress),
        priorityScore: project.priorityScore,
        plannedStart: toYmdUtc(computedStart),
        historicalStart: historicalLeadStart ? toYmdUtc(historicalLeadStart) : null,
        plannedEnd: toYmdUtc(computedEnd),
        durationWeeks,
        remainingEffortDays: round2(project.remainingTotal),
        blockerProjectIds: (prepared.blockersByProject.get(project.id) ?? []).slice(),
        contributorLoads,
        activeWeekStarts,
      });
    }

    const reservations: RoadmapReservation[] = prepared.reservations.map((reservation) => {
      const contributorTotals = new Map<string, number>();
      for (const byUser of reservation.weeklyLoads.values()) {
        for (const [contributorId, days] of byUser.entries()) {
          contributorTotals.set(contributorId, (contributorTotals.get(contributorId) ?? 0) + days);
        }
      }
      const contributorLoads = Array.from(contributorTotals.entries())
        .map(([contributorId, days]) => ({
          contributorId,
          contributorName: prepared.contributors.get(contributorId)?.name ?? contributorId,
          days: round2(days),
        }))
        .sort((a, b) =>
          b.days - a.days
          || a.contributorName.localeCompare(b.contributorName)
          || a.contributorId.localeCompare(b.contributorId));

      return {
        projectId: reservation.projectId,
        projectName: reservation.projectName,
        status: reservation.status,
        schedulingMode: reservation.schedulingMode,
        categoryId: reservation.categoryId,
        sourceId: reservation.sourceId,
        streamId: reservation.streamId,
        executionProgress: reservation.executionProgress,
        plannedStart: toYmdUtc(reservation.startDate),
        plannedEnd: toYmdUtc(reservation.endDate),
        reason: reservation.reason,
        contributorLoads,
      };
    });

    let maxRoadmapEnd: Date | null = null;
    for (const reservation of prepared.reservations) {
      if (!maxRoadmapEnd || reservation.endDate.getTime() > maxRoadmapEnd.getTime()) {
        maxRoadmapEnd = reservation.endDate;
      }
    }
    for (const item of schedule) {
      const end = parseYmdUtc(item.plannedEnd);
      if (!maxRoadmapEnd || end.getTime() > maxRoadmapEnd.getTime()) {
        maxRoadmapEnd = end;
      }
    }

    schedule.sort((a, b) =>
      a.plannedStart.localeCompare(b.plannedStart)
      || compareNullableNumberDesc(a.priorityScore, b.priorityScore)
      || a.projectId.localeCompare(b.projectId));
    reservations.sort((a, b) =>
      a.plannedStart.localeCompare(b.plannedStart)
      || a.projectName.localeCompare(b.projectName)
      || a.projectId.localeCompare(b.projectId));

    const unschedulable = Array.from(unschedulableMap.values())
      .sort((a, b) => a.projectName.localeCompare(b.projectName) || a.projectId.localeCompare(b.projectId));
    const explanations = [
      ...schedule
        .map((item) => buildExplanation(item.projectId, 'scheduled', item.plannedStart))
        .filter((item): item is ProjectExplanation => !!item),
      ...unschedulable
        .map((item) => buildExplanation(item.projectId, 'unschedulable', null, item))
        .filter((item): item is ProjectExplanation => !!item),
    ].sort((a, b) =>
      (a.actualStartWeek ?? a.earliestEligibleWeek ?? '').localeCompare(b.actualStartWeek ?? b.earliestEligibleWeek ?? '')
      || (a.itemRef.projectId ?? '').localeCompare(b.itemRef.projectId ?? ''));
    const scheduleByProjectId = new Map(schedule.map((item) => [item.projectId, item] as const));
    const scenarioWarnings = Array.from(prepared.candidates.values())
      .map<ScenarioWarning | null>((project) => {
        const projectId = project.id;
        const state = runtimeByProject.get(projectId) ?? null;
        const constraint = project.constraint ?? null;
        if (!constraint) return null;
        const scheduledItem = scheduleByProjectId.get(projectId) ?? null;
        const conflictMessage = getConstraintConflictMessage(
          constraint,
          scheduledItem?.plannedStart ?? null,
          scheduledItem?.plannedEnd ?? null,
        );
        if (!conflictMessage) return null;
        const messageText = roadmapText('warning_constraint_conflict', { project: project.name, conflict: conflictMessage });
        return {
          severity: scheduledItem ? 'warning' : 'error',
          code: 'constraint_infeasible',
          itemRef: buildItemRef(projectId),
          message: renderRoadmapText(messageText),
          messageText,
        } as ScenarioWarning;
      })
      .filter((warning) => !!warning)
      .sort((a, b) =>
        (a.itemRef?.projectId ?? '').localeCompare(b.itemRef?.projectId ?? '')
        || a.message.localeCompare(b.message));

    return {
      schedule,
      reservations,
      unschedulable,
      explanations,
      scenarioWarnings,
      roadmapEndDate: maxRoadmapEnd ? toYmdUtc(maxRoadmapEnd) : null,
      weeklyProjectLoad,
    };
  }

  private resolveHistoricalStart(
    project: ProjectComputation,
    asOfDate: Date,
  ): Date | null {
    const actualStart = toUtcDate(project.actualStart);
    const plannedStart = toUtcDate(project.plannedStart);

    const startedByStatus = project.status === 'in_progress'
      || project.status === 'in_testing'
      || project.status === 'on_hold';
    const startedByProgress = project.executionProgress > EPSILON;

    const candidate = actualStart
      ?? ((startedByStatus || startedByProgress) ? plannedStart : null);
    if (!candidate) return null;
    if (candidate.getTime() >= asOfDate.getTime()) return null;
    return candidate;
  }

  private estimateBottleneckWeeks(
    project: ProjectComputation,
    weeklyCapacityByUser: Map<string, number>,
    options: RoadmapGenerateDto,
  ): number {
    let maxWeeks = 0;
    for (const [userId, demandDays] of project.contributorDays.entries()) {
      const weeklyCap = weeklyCapacityByUser.get(userId) ?? 0;
      if (weeklyCap <= EPSILON) return Number.POSITIVE_INFINITY;
      const effective = this.computeEffectiveWeeklyCapacity(weeklyCap, 1, options);
      if (effective <= EPSILON) return Number.POSITIVE_INFINITY;
      maxWeeks = Math.max(maxWeeks, demandDays / effective);
    }
    return maxWeeks;
  }

  private computeEffectiveWeeklyCapacity(
    weeklyBaseCapacity: number,
    concurrency: number,
    options: RoadmapGenerateDto,
  ): number {
    if (weeklyBaseCapacity <= EPSILON) return 0;
    const overload = Math.max(0, concurrency - options.contextSwitchGrace);
    const factor = 1 - (options.contextSwitchPenaltyPct * overload);
    return Math.max(0.05, weeklyBaseCapacity * factor);
  }

  private getCommittedLoad(
    ledger: CommittedLoadLedger,
    userId: string,
    weekKey: string,
  ): number {
    return ledger.get(userId)?.get(weekKey) ?? 0;
  }

  private addCommittedLoad(
    ledger: CommittedLoadLedger,
    userId: string,
    weekKey: string,
    days: number,
  ): void {
    const byWeek = ledger.get(userId) ?? new Map<string, number>();
    byWeek.set(weekKey, (byWeek.get(weekKey) ?? 0) + days);
    ledger.set(userId, byWeek);
  }

  private getActiveCount(
    ledger: ActiveProjectsLedger,
    userId: string,
    weekKey: string,
  ): number {
    return ledger.get(userId)?.get(weekKey)?.size ?? 0;
  }

  private addActiveProject(
    ledger: ActiveProjectsLedger,
    userId: string,
    weekKey: string,
    projectId: string,
  ): void {
    const byWeek = ledger.get(userId) ?? new Map<string, Set<string>>();
    const projects = byWeek.get(weekKey) ?? new Set<string>();
    projects.add(projectId);
    byWeek.set(weekKey, projects);
    ledger.set(userId, byWeek);
  }

  private addWeeklyProjectLoad(
    ledger: WeeklyProjectLoadLedger,
    userId: string,
    weekKey: string,
    projectId: string,
    days: number,
  ): void {
    const byWeek = ledger.get(userId) ?? new Map<string, Map<string, number>>();
    const byProject = byWeek.get(weekKey) ?? new Map<string, number>();
    byProject.set(projectId, (byProject.get(projectId) ?? 0) + days);
    byWeek.set(weekKey, byProject);
    ledger.set(userId, byWeek);
  }

  private buildOccupation(
    weeklyProjectLoad: WeeklyProjectLoadLedger | null,
    contributors: Map<string, ContributorInfo>,
    projectNames: Map<string, string>,
  ): OccupationEntry[] {
    if (!weeklyProjectLoad) return [];

    const entries: OccupationEntry[] = [];
    const contributorIds = Array.from(weeklyProjectLoad.keys())
      .sort((a, b) => {
        const nameA = contributors.get(a)?.name ?? a;
        const nameB = contributors.get(b)?.name ?? b;
        return nameA.localeCompare(nameB) || a.localeCompare(b);
      });

    for (const contributorId of contributorIds) {
      const contributor = contributors.get(contributorId) ?? {
        id: contributorId,
        name: contributorId,
        teamId: null,
        teamName: null,
        monthlyCapacity: 0,
        weeklyCapacity: 0,
      };
      const byWeek = weeklyProjectLoad.get(contributorId);
      if (!byWeek) continue;
      const weeks = Array.from(byWeek.keys()).sort((a, b) => a.localeCompare(b));

      for (const week of weeks) {
        const projectLoads = byWeek.get(week);
        if (!projectLoads) continue;

        let effortRaw = 0;
        for (const weekDays of projectLoads.values()) {
          if (weekDays <= EPSILON) continue;
          effortRaw += weekDays;
        }
        const effortDays = round2(effortRaw);
        const capacityDays = contributor.weeklyCapacity > EPSILON ? round2(contributor.weeklyCapacity) : null;
        const occupationPct = capacityDays && capacityDays > 0
          ? Math.round((effortDays / capacityDays) * 100)
          : null;

        const projects = Array.from(projectLoads.entries())
          .filter(([, days]) => days > EPSILON)
          .map(([projectId, days]) => ({
            projectId,
            projectName: projectNames.get(projectId) || projectId,
            days: round2(days),
          }))
          .sort((a, b) =>
            b.days - a.days
            || a.projectName.localeCompare(b.projectName)
            || a.projectId.localeCompare(b.projectId));

        entries.push({
          contributorId,
          contributorName: contributor.name,
          teamId: contributor.teamId,
          teamName: contributor.teamName,
          week,
          effortDays,
          capacityDays,
          occupationPct,
          projects,
        });
      }
    }

    return entries;
  }

  private buildTeamOccupation(occupation: OccupationEntry[]): TeamOccupationEntry[] {
    const byTeamWeek = new Map<string, TeamOccupationEntry>();
    for (const entry of occupation) {
      const teamKey = entry.teamId ?? 'no-team';
      const key = `${teamKey}:${entry.week}`;
      const existing = byTeamWeek.get(key) ?? {
        teamId: entry.teamId,
        teamName: entry.teamName ?? 'No team',
        week: entry.week,
        effortDays: 0,
        capacityDays: null,
        occupationPct: null,
      };
      existing.effortDays += entry.effortDays;
      if (entry.capacityDays != null) {
        existing.capacityDays = (existing.capacityDays ?? 0) + entry.capacityDays;
      }
      byTeamWeek.set(key, existing);
    }

    const result = Array.from(byTeamWeek.values()).map((entry) => {
      const effortDays = round2(entry.effortDays);
      const capacityDays = entry.capacityDays != null ? round2(entry.capacityDays) : null;
      const occupationPct = capacityDays && capacityDays > 0
        ? Math.round((effortDays / capacityDays) * 100)
        : null;
      return {
        ...entry,
        effortDays,
        capacityDays,
        occupationPct,
      };
    });

    result.sort((a, b) =>
      (a.teamName ?? '').localeCompare(b.teamName ?? '')
      || (a.teamId ?? '').localeCompare(b.teamId ?? '')
      || a.week.localeCompare(b.week));

    return result;
  }

  /**
   * Build on-hold date ranges for scheduled projects from audit_log history.
   * Single batched query, tenant-scoped. No N+1 loops.
   */
  private async buildOnHoldRanges(
    tenantId: string,
    schedule: ScheduledProject[],
    mg: EntityManager,
  ): Promise<Map<string, OnHoldRange[]>> {
    const projectIds = schedule.map((p) => p.projectId);
    const projectInfoById = new Map(
      schedule.map((p) => [p.projectId, {
        plannedStart: p.plannedStart,
        plannedEnd: p.plannedEnd,
        historicalStart: p.historicalStart,
        currentStatus: p.status,
      }]),
    );

    // Batched query: fetch all status-change audit rows for scheduled projects.
    const auditRows: Array<{
      record_id: string;
      before_json: any;
      after_json: any;
      created_at: Date;
      id: string;
    }> = await mg.query(
      `
      SELECT a.record_id, a.before_json, a.after_json, a.created_at, a.id
      FROM audit_log a
      WHERE a.tenant_id = $1
        AND a.table_name = 'portfolio_projects'
        AND a.record_id = ANY($2)
        AND a.action = 'update'
      ORDER BY a.record_id ASC, a.created_at ASC, a.id ASC
      `,
      [tenantId, projectIds],
    );

    // Group by project and filter to status changes only
    const statusChangesByProject = new Map<string, Array<{ oldStatus: string; newStatus: string; at: Date }>>();
    for (const row of auditRows) {
      const beforeStatus = row.before_json?.status;
      const afterStatus = row.after_json?.status;
      if (!beforeStatus || !afterStatus || beforeStatus === afterStatus) continue;

      const list = statusChangesByProject.get(row.record_id) ?? [];
      list.push({
        oldStatus: String(beforeStatus),
        newStatus: String(afterStatus),
        at: new Date(row.created_at),
      });
      statusChangesByProject.set(row.record_id, list);
    }

    const result = new Map<string, OnHoldRange[]>();

    for (const projectId of projectIds) {
      const info = projectInfoById.get(projectId);
      if (!info) continue;

      const windowStart = info.historicalStart ?? info.plannedStart;
      const windowEnd = info.plannedEnd;
      const windowStartDate = parseYmdUtc(windowStart);
      const windowEndDate = parseYmdUtc(windowEnd);

      const changes = statusChangesByProject.get(projectId);

      // Edge case: project currently on_hold with no audit records at all
      if (!changes || changes.length === 0) {
        if (info.currentStatus === 'on_hold') {
          result.set(projectId, [{
            from: toYmdUtc(windowStartDate),
            to: toYmdUtc(windowEndDate),
          }]);
        }
        continue;
      }

      // Build on-hold intervals from status transitions
      const rawIntervals: Array<{ from: Date; to: Date }> = [];
      let onHoldStart: Date | null = null;

      for (const change of changes) {
        if (change.newStatus === 'on_hold') {
          // Enter on-hold
          if (!onHoldStart) {
            onHoldStart = change.at;
          }
        } else if (change.oldStatus === 'on_hold') {
          // Exit on-hold
          if (onHoldStart) {
            rawIntervals.push({ from: onHoldStart, to: change.at });
            onHoldStart = null;
          } else {
            // Exit without prior enter in history window: backfill from window start
            rawIntervals.push({ from: windowStartDate, to: change.at });
          }
        }
      }

      // If still on-hold at end of history, close at window end
      if (onHoldStart) {
        rawIntervals.push({ from: onHoldStart, to: windowEndDate });
      }

      // Clip intervals to window, convert to YMD, merge overlapping/adjacent
      const clipped: Array<{ from: Date; to: Date }> = [];
      for (const interval of rawIntervals) {
        const clippedFrom = new Date(Math.max(interval.from.getTime(), windowStartDate.getTime()));
        const clippedTo = new Date(Math.min(interval.to.getTime(), windowEndDate.getTime()));
        if (clippedFrom.getTime() <= clippedTo.getTime()) {
          clipped.push({ from: clippedFrom, to: clippedTo });
        }
      }

      // Sort and merge overlapping/adjacent
      clipped.sort((a, b) => a.from.getTime() - b.from.getTime());
      const merged: Array<{ from: Date; to: Date }> = [];
      for (const interval of clipped) {
        const last = merged[merged.length - 1];
        if (last && interval.from.getTime() <= last.to.getTime() + MS_PER_DAY) {
          last.to = new Date(Math.max(last.to.getTime(), interval.to.getTime()));
        } else {
          merged.push({ from: new Date(interval.from), to: new Date(interval.to) });
        }
      }

      if (merged.length > 0) {
        result.set(
          projectId,
          merged.map((interval) => ({
            from: toYmdUtc(interval.from),
            to: toYmdUtc(interval.to),
          })),
        );
      }
    }

    return result;
  }
}
