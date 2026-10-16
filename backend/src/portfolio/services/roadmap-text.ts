import {
  RoadmapText,
  RoadmapTextCode,
  RoadmapTextParam,
  ScheduleConstraint,
  UnschedulableProject,
} from '../dto/roadmap.dto';

/**
 * The roadmap's sentences: each one is built as a code and its parameters, and its English text
 * is written from them here. The response carries both, so API and AI readers keep the English
 * text and the web app writes the same sentence in the reader's language.
 */

type Reason = UnschedulableProject['reason'];

export const roadmapText = (
  code: RoadmapTextCode,
  params: Record<string, RoadmapTextParam> = {},
): RoadmapText => ({ code, params });

const REASON_LABELS: Record<Reason, string> = {
  zero_remaining_effort: 'No remaining effort',
  no_assigned_contributors: 'No assigned contributors',
  missing_blocker_date: 'Missing blocker date',
  blocker_on_hold: 'Blocker on hold',
  blocked_unfinished_project: 'Blocked by unfinished project',
  expired_fixed_plan: 'Expired fixed plan',
  cyclic_dependency: 'Cyclic dependency',
  not_ready_within_horizon: 'Not ready within horizon',
  no_free_slot: 'No free slot',
  no_effective_capacity: 'No effective capacity',
  below_minimum_start_threshold: 'Below minimum start threshold',
  unfinished_within_horizon: 'Unfinished within horizon',
  insufficient_capacity: 'Insufficient capacity',
  missing_contributor_capacity: 'Missing contributor capacity',
};

const BLOCKED_REASON_LABELS: Record<Reason, string> = {
  zero_remaining_effort: 'no remaining effort',
  no_assigned_contributors: 'no assigned contributors',
  missing_blocker_date: 'missing blocker date',
  blocker_on_hold: 'blocker on hold',
  blocked_unfinished_project: 'blocked unfinished project',
  expired_fixed_plan: 'expired fixed plan',
  cyclic_dependency: 'cyclic dependency',
  not_ready_within_horizon: 'not ready within horizon',
  no_free_slot: 'no free slot',
  no_effective_capacity: 'no effective capacity',
  below_minimum_start_threshold: 'below minimum start threshold',
  unfinished_within_horizon: 'unfinished within horizon',
  insufficient_capacity: 'insufficient capacity',
  missing_contributor_capacity: 'missing contributor capacity',
};

export const reasonLabel = (reason: string): string => REASON_LABELS[reason as Reason] ?? reason;

const constraintLabel = (constraint: ScheduleConstraint | null): string => {
  switch (constraint?.type) {
    case 'pin_start':
      return `pin start ${constraint.startWeek}`;
    case 'pin_window':
      return `pin window ${constraint.startWeek} to ${constraint.endWeek}`;
    case 'not_before':
      return `not-before ${constraint.startWeek}`;
    default:
      return 'scenario constraint';
  }
};

/** The English text of a roadmap sentence, as the API has always written it. */
export const renderRoadmapText = (text: RoadmapText): string => {
  const p = text.params;
  const s = (name: string): string => (p[name] == null ? 'n/a' : String(p[name]));
  const list = (name: string): string => ((p[name] as Array<string | RoadmapText> | undefined) ?? [])
    .map((item) => (typeof item === 'string' ? item : renderRoadmapText(item)))
    .join(', ');
  const nested = (name: string): string => renderRoadmapText(p[name] as RoadmapText);

  switch (text.code) {
    case 'missing_contributor_capacity_for':
      return `No contributor capacity configured for: ${list('names')}`;
    case 'blocker_on_hold':
      return `Blocker ${s('blocker')} is on hold`;
    case 'blocker_fixed_plan_expired':
      return `Blocker ${s('blocker')} is not finished and its fixed plan ended before the roadmap start`;
    case 'blocker_cannot_be_scheduled':
      return `Blocker ${s('blocker')} is not finished and cannot be scheduled (${BLOCKED_REASON_LABELS[p.reason as Reason] ?? 'insufficient capacity'})`;
    case 'missing_blocker_date_for':
      return `Missing blocker date for ${s('blocker')}`;
    case 'no_free_slot_for':
      return `No free parallel slot for: ${list('contributors')}`;
    case 'no_allocable_capacity_for':
      return `No allocable weekly capacity for: ${list('contributors')}`;
    case 'collaborative_burn_below_threshold':
      return `Projected collaborative start burn is ${s('burn')}d, below the ${s('threshold')}d threshold`;
    case 'collaborative_burn_stalled_for':
      return `Collaborative burn stalled for: ${list('contributors')}`;
    case 'independent_burn_below_threshold':
      return `Projected independent start burn is ${s('burn')}d, below the ${s('threshold')}d threshold`;
    case 'no_capacity_remained_for':
      return `No effective weekly capacity remained for: ${list('contributors')}`;
    case 'capacity_prevented_scheduling':
      return 'Capacity constraints prevented scheduling';
    case 'waiting_on_blockers':
      return `Still waiting on blockers: ${list('blockers')}`;
    case 'earliest_start_beyond_horizon':
      return `Earliest possible start is ${s('week')}, beyond the ${s('horizonWeeks')}-week horizon`;
    case 'never_ready_within_horizon':
      return 'Project never became ready within the scheduling horizon';
    case 'remaining_after_horizon':
      return `Remaining ${s('remainingDays')}d after ${s('horizonWeeks')} weeks. Biggest unresolved loads: ${list('loads') || 'n/a'}`;
    case 'no_allocable_week':
      return 'No allocable week found under current capacity constraints';
    case 'reason':
      return reasonLabel(s('reason'));
    case 'contributor_capacity':
      return `${s('name')} (${s('weeklyCapacity')}d/week)`;
    case 'contributor_remaining_load':
      return `${s('name')} ${s('remainingDays')}d remaining at ${s('weeklyCapacity')}d/week`;
    case 'waiting_for':
      return `Waiting for ${s('blocker')}`;
    case 'waiting_for_until':
      return `Waiting for ${s('blocker')} until ${s('week')}`;
    case 'blocker_is_on_hold':
      return `${s('blocker')} is on hold`;
    case 'blocker_has_expired_fixed_plan':
      return `${s('blocker')} has an expired fixed plan`;
    case 'blocker_is_unschedulable':
      return `${s('blocker')} is unschedulable (${reasonLabel(s('reason'))})`;
    case 'conflict_pin_start_unsatisfied':
      return `Pinned start ${s('week')} could not be satisfied.`;
    case 'conflict_pin_start_normalized':
      return `Pinned start ${s('week')} was normalized to ${s('normalized')} and slipped to ${s('actual')}.`;
    case 'conflict_pin_start_slipped':
      return `Pinned start ${s('week')} slipped to ${s('actual')}.`;
    case 'conflict_pin_window_unsatisfied':
      return `Pinned window ${s('start')} to ${s('end')} could not be satisfied.`;
    case 'conflict_pin_window_missed':
      return `Pinned window ${s('start')} to ${s('end')} was missed; actual schedule is ${s('actualStart')} to ${s('actualEnd')}.`;
    case 'conflict_not_before_violated':
      return `Not-before constraint ${s('week')} was violated by start ${s('actual')}.`;
    case 'final_capacity':
      return `Eligible from ${s('eligible')} and started in ${s('week')} when capacity opened up`;
    case 'final_blockers':
      return `Started in ${s('week')} once blockers released it`;
    case 'final_started':
      return `Started in ${s('week')}`;
    case 'summary_unschedulable':
      return `${s('project')} could not be scheduled: ${nested('reason')}`;
    case 'summary_historical':
      return `${s('project')} continued from historical work and appears in the roadmap from ${s('week')}.`;
    case 'summary_constraint':
      return `${s('project')} started in ${s('week')} under ${constraintLabel(p.constraint as ScheduleConstraint)}.`;
    case 'summary_constraint_conflict':
      return `${s('project')} started in ${s('week')} under ${constraintLabel(p.constraint as ScheduleConstraint)}, with a conflict: ${nested('conflict')}`;
    case 'summary_capacity':
      return `${s('project')} was eligible from ${s('eligible')} and started in ${s('week')} when capacity became available.`;
    case 'summary_blockers':
      return `${s('project')} started in ${s('week')} after its blockers released it.`;
    case 'summary_schedulable':
      return `${s('project')} started in ${s('week')} when it became schedulable.`;
    case 'warning_constraint_conflict':
      return `${s('project')}: ${nested('conflict')}`;
    default:
      return text.code;
  }
};
