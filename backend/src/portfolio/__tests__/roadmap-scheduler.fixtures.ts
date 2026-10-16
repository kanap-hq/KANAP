import { PortfolioRoadmapService } from '../services/portfolio-roadmap.service';
import { parseRoadmapGenerate } from '../dto/roadmap.dto';

/**
 * Inputs for the scheduler specs: `runScheduler` runs on a prototype instance and a hand-built
 * prepared input, without a database (see roadmap-scheduler.characterisation.spec.ts).
 */

export const start = () => new Date('2026-01-05');

export function contributor(id: string, monthlyCapacity: number) {
  return {
    id,
    name: `Contributor ${id}`,
    teamId: null,
    teamName: null,
    monthlyCapacity,
    weeklyCapacity: (monthlyCapacity * 12) / 52,
  };
}

export function project(id: string, contributorDays: Map<string, number>, overrides: Record<string, unknown> = {}) {
  const total = [...contributorDays.values()].reduce((a, b) => a + b, 0);
  return {
    id,
    name: `Project ${id}`,
    status: 'planned',
    schedulingMode: 'independent',
    constraint: null,
    categoryId: null,
    sourceId: null,
    streamId: null,
    priorityScore: 100,
    executionProgress: 0,
    remainingIt: total,
    remainingBusiness: 0,
    remainingTotal: total,
    itContributorDays: new Map(contributorDays),
    businessContributorDays: new Map(),
    contributorDays: new Map(contributorDays),
    blockers: [],
    plannedStart: null,
    plannedEnd: null,
    actualStart: null,
    actualEnd: null,
    ...overrides,
  };
}

export function prepared(candidates: any[], contributors: any[]) {
  return {
    options: parseRoadmapGenerate({ startDate: '2026-01-05' }),
    contributors: new Map(contributors.map((c) => [c.id, c])),
    candidates: new Map(candidates.map((c) => [c.id, c])),
    projectRowsById: new Map(
      candidates.map((c) => [
        c.id,
        {
          id: c.id,
          name: c.name,
          status: c.status,
          scheduling_mode: c.schedulingMode,
          category_id: null,
          source_id: null,
          stream_id: null,
          priority_score: c.priorityScore,
          execution_progress: 0,
          estimated_effort_it: null,
          estimated_effort_business: null,
          it_effort_allocation_mode: 'auto',
          business_effort_allocation_mode: 'auto',
          it_lead_id: null,
          business_lead_id: null,
          planned_start: null,
          planned_end: null,
          actual_start: null,
          actual_end: null,
        },
      ]),
    ),
    relevantContributorIds: new Set(contributors.map((c) => c.id)),
    expiredFixedPlanProjectIds: new Set<string>(),
    blockersByProject: new Map<string, string[]>(),
    existingEndByProject: new Map<string, Date>(),
    preUnschedulable: new Map<string, unknown>(),
    reservations: [],
    projectNameById: new Map(candidates.map((c) => [c.id, c.name])),
  };
}

export function scheduler() {
  const svc: any = Object.create(PortfolioRoadmapService.prototype);
  return (preparedData: any, collectOccupation = false) =>
    svc.runScheduler(preparedData, null, collectOccupation, start());
}
