import { ProjectStatus } from '../portfolio-project.entity';

export type CapacityColorBand = 'green' | 'yellow' | 'orange' | 'red' | 'violet' | 'na';
export type CapacityMode = 'historical' | 'theoretical';
export type CapacityGroupBy = 'contributor' | 'team';

export interface ContributorCapacityRow {
  contributorId: string;
  contributorName: string;
  teamId: string | null;
  teamName: string | null;
  remainingDays: number;
  capacityDaysPerMonth: number | null;
  capacitySource: CapacityMode | null;
  monthsOfWork: number | null;
  colorBand: CapacityColorBand;
  /** False for someone staffed on projects who has no contributor profile, hence no capacity. */
  hasContributorProfile: boolean;
}

export interface TeamCapacityRow {
  /** `no-team` for the people without a team. */
  teamId: string;
  /** Null for the people without a team: the screen and the exports write their own label. */
  teamName: string | null;
  memberCount: number;
  remainingDays: number;
  capacityDaysPerMonth: number | null;
  monthsOfWork: number | null;
  colorBand: CapacityColorBand;
}

export interface ProjectBreakdownRow {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  estimatedEffort: number;
  executionProgress: number;
  remainingEffort: number;
  allocationPct: number;
  contributorDays: number;
}

export interface UnassignedProjectRow {
  projectId: string;
  projectName: string;
  status: ProjectStatus;
  estimatedEffort: number;
  remainingEffort: number;
  unallocatedPct: number;
  unallocatedDays: number;
}

export interface CapacityHeatmapResponse {
  contributors: ContributorCapacityRow[];
  teams: TeamCapacityRow[];
  unassignedSummary: { totalProjects: number; totalUnallocatedDays: number };
  unassignedProjects: UnassignedProjectRow[];
  filters: { teamIds: string[]; statuses: ProjectStatus[]; capacityMode: CapacityMode; groupBy: CapacityGroupBy };
}
