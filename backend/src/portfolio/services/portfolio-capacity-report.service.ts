import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { PortfolioProject, ProjectStatus } from '../portfolio-project.entity';
import { TeamMemberConfigService } from '../team-member-config.service';
import {
  CapacityColorBand,
  CapacityGroupBy,
  CapacityHeatmapResponse,
  CapacityMode,
  ContributorCapacityRow,
  ProjectBreakdownRow,
  TeamCapacityRow,
  UnassignedProjectRow,
} from '../dto/capacity-heatmap.dto';
import { computeAutoAllocations, type Allocation } from '../utils/allocation-utils';

type TeamFilter = {
  isActive: boolean;
  teamIds: string[];
  includeNoTeam: boolean;
};

type UserInfo = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

const DEFAULT_STATUSES: ProjectStatus[] = [
  'waiting_list',
  'planned',
  'in_progress',
  'in_testing',
  'on_hold',
];

const NO_TEAM_ID = 'no-team';
/** The label a missing team sorts under, kept internal: the answer names it `null`, the screen and exports word it. */
const NO_TEAM_SORT_NAME = 'No team';

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function toNumber(value: any): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function colorBandFor(months: number | null): CapacityColorBand {
  if (months == null || !Number.isFinite(months)) return 'na';
  if (months <= 1) return 'green';
  if (months <= 3) return 'yellow';
  if (months <= 6) return 'orange';
  if (months <= 12) return 'red';
  return 'violet';
}

@Injectable()
export class PortfolioCapacityReportService {
  constructor(
    @InjectRepository(PortfolioProject)
    private readonly projectRepo: Repository<PortfolioProject>,
    private readonly teamMemberConfigService: TeamMemberConfigService,
  ) {}

  private buildTeamClause(filter: TeamFilter, alias: string, params: any[]): string | null {
    if (!filter.isActive) return null;
    const clauses: string[] = [];
    if (filter.teamIds.length > 0) {
      params.push(filter.teamIds);
      clauses.push(`${alias}.team_id = ANY($${params.length})`);
    }
    if (filter.includeNoTeam) {
      clauses.push(`${alias}.team_id IS NULL`);
    }
    if (!clauses.length) return null;
    return `(${clauses.join(' OR ')})`;
  }

  private normalizeStatuses(statuses?: ProjectStatus[]): ProjectStatus[] {
    if (!statuses || statuses.length === 0) return DEFAULT_STATUSES;
    return statuses;
  }

  async getHeatmap(
    tenantId: string,
    opts: {
      teamFilter?: TeamFilter;
      statuses?: ProjectStatus[];
      capacityMode?: CapacityMode;
      groupBy?: CapacityGroupBy;
    },
    svcOpts?: { manager?: EntityManager },
  ): Promise<CapacityHeatmapResponse> {
    const mg = svcOpts?.manager ?? this.projectRepo.manager;
    const teamFilter = opts.teamFilter ?? { isActive: false, teamIds: [], includeNoTeam: false };
    const statuses = this.normalizeStatuses(opts.statuses);
    const capacityMode: CapacityMode = opts.capacityMode === 'theoretical' ? 'theoretical' : 'historical';
    const groupBy: CapacityGroupBy = opts.groupBy === 'team' ? 'team' : 'contributor';

    // Contributors + teams
    const contributorParams: any[] = [tenantId];
    const contributorWhere: string[] = ['tmc.tenant_id = $1'];
    const teamClause = this.buildTeamClause(teamFilter, 'tmc', contributorParams);
    if (teamClause) contributorWhere.push(teamClause);

    const contributorsRaw = await mg.query(
      `
      SELECT
        tmc.id AS config_id,
        tmc.user_id,
        tmc.team_id,
        tmc.project_availability,
        TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) as user_display_name,
        u.email as user_email,
        pt.name as team_name
      FROM portfolio_team_member_configs tmc
      LEFT JOIN users u ON u.id = tmc.user_id AND u.tenant_id = tmc.tenant_id
      LEFT JOIN portfolio_teams pt ON pt.id = tmc.team_id AND pt.tenant_id = tmc.tenant_id
      WHERE ${contributorWhere.join(' AND ')}
      ORDER BY u.first_name ASC, u.last_name ASC, u.email ASC
    `,
      contributorParams,
    );

    const contributorUserIds: string[] = contributorsRaw.map((row: any) => row.user_id);
    const contributorSet = new Set(contributorUserIds);

    const allocationsByUser = new Map<string, number>();
    // Load carried by people staffed on a project who have no contributor profile. It used to be
    // dropped without reaching any row nor the unassigned total, which hid it from the report.
    const profilelessLoadByUser = new Map<string, number>();
    const profilelessNameByUser = new Map<string, string>();
    const showProfileless = !teamFilter.isActive || teamFilter.includeNoTeam;
    const unassignedProjects: UnassignedProjectRow[] = [];
    let totalUnallocatedDays = 0;

    const projectRows = await mg.query(
      `
      SELECT
        p.id,
        p.name,
        p.status,
        p.execution_progress,
        p.estimated_effort_it,
        p.estimated_effort_business,
        p.it_effort_allocation_mode,
        p.business_effort_allocation_mode,
        p.it_lead_id,
        p.business_lead_id
      FROM portfolio_projects p
      WHERE p.tenant_id = $1
        AND p.status = ANY($2)
    `,
      [tenantId, statuses],
    );

    if (projectRows.length > 0) {
      const projectIds = projectRows.map((p: any) => p.id);
      const manualAllocRows = await mg.query(
        `
        SELECT project_id, user_id, effort_type, allocation_pct
        FROM portfolio_project_effort_allocations
        WHERE tenant_id = $1
          AND project_id = ANY($2)
      `,
        [tenantId, projectIds],
      );

      const teamRows = await mg.query(
        `
        SELECT project_id, user_id, role
        FROM portfolio_project_team
        WHERE tenant_id = $1
          AND project_id = ANY($2)
      `,
        [tenantId, projectIds],
      );

      const leadIds = new Set<string>();
      for (const p of projectRows) {
        if (p.it_lead_id) leadIds.add(p.it_lead_id);
        if (p.business_lead_id) leadIds.add(p.business_lead_id);
      }

      const userIds = new Set<string>();
      for (const row of manualAllocRows) userIds.add(row.user_id);
      for (const row of teamRows) userIds.add(row.user_id);
      for (const id of leadIds) userIds.add(id);

      const userRows = userIds.size > 0
        ? await mg.query(
          `SELECT id, first_name, last_name, email FROM users WHERE tenant_id = $1 AND id = ANY($2)`,
          [tenantId, Array.from(userIds)],
        )
        : [];

      const userById = new Map<string, UserInfo>();
      for (const row of userRows) {
        userById.set(row.id, {
          id: row.id,
          first_name: row.first_name,
          last_name: row.last_name,
          email: row.email,
        });
      }
      const getUser = (id: string): UserInfo => userById.get(id) ?? { id, first_name: '', last_name: '', email: '' };

      const teamMembersByProject = new Map<string, { it: UserInfo[]; business: UserInfo[] }>();
      for (const row of teamRows) {
        const entry = teamMembersByProject.get(row.project_id) ?? { it: [], business: [] };
        const member = getUser(row.user_id);
        if (row.role === 'it_team') entry.it.push(member);
        if (row.role === 'business_team') entry.business.push(member);
        teamMembersByProject.set(row.project_id, entry);
      }

      const manualAllocByKey = new Map<string, Allocation[]>();
      for (const row of manualAllocRows) {
        const key = `${row.project_id}:${row.effort_type}`;
        const list = manualAllocByKey.get(key) ?? [];
        list.push({ user_id: row.user_id, allocation_pct: Number(row.allocation_pct || 0) });
        manualAllocByKey.set(key, list);
      }

      const eligibleUserIds = new Set<string>();
      for (const project of projectRows) {
        if (project.it_lead_id) eligibleUserIds.add(project.it_lead_id);
        if (project.business_lead_id) eligibleUserIds.add(project.business_lead_id);
        const members = teamMembersByProject.get(project.id);
        if (members) {
          for (const m of members.it) eligibleUserIds.add(m.id);
          for (const m of members.business) eligibleUserIds.add(m.id);
        }
      }
      for (const row of manualAllocRows) eligibleUserIds.add(row.user_id);

      // With a team filter, contributorSet only holds the filtered teams: someone outside it may
      // still have a profile in another team.
      const profiledUserIds = new Set(contributorUserIds);
      const teamByUserId = new Map<string, string | null>();
      if (teamFilter.isActive && eligibleUserIds.size > 0) {
        const teamConfigRows = await mg.query(
          `SELECT user_id, team_id FROM portfolio_team_member_configs WHERE tenant_id = $1 AND user_id = ANY($2)`,
          [tenantId, Array.from(eligibleUserIds)],
        );
        for (const row of teamConfigRows) {
          teamByUserId.set(row.user_id, row.team_id ?? null);
          profiledUserIds.add(row.user_id);
        }
        for (const id of eligibleUserIds) {
          if (!teamByUserId.has(id)) teamByUserId.set(id, null);
        }
      }
      const teamIdSet = new Set(teamFilter.teamIds);

      for (const project of projectRows) {
        const remainingIt = Number(project.estimated_effort_it || 0) * (1 - Number(project.execution_progress || 0) / 100.0);
        const remainingBusiness = Number(project.estimated_effort_business || 0) * (1 - Number(project.execution_progress || 0) / 100.0);
        const remainingTotal = remainingIt + remainingBusiness;

        const members = teamMembersByProject.get(project.id) ?? { it: [], business: [] };
        const itLead = project.it_lead_id ? getUser(project.it_lead_id) : null;
        const businessLead = project.business_lead_id ? getUser(project.business_lead_id) : null;

        const itKey = `${project.id}:it`;
        const businessKey = `${project.id}:business`;

        const itManual = manualAllocByKey.get(itKey) ?? [];
        const businessManual = manualAllocByKey.get(businessKey) ?? [];
        const itAllocations = project.it_effort_allocation_mode === 'manual'
          ? itManual
          : (itManual.length > 0 ? itManual : computeAutoAllocations(itLead, members.it));
        const businessAllocations = project.business_effort_allocation_mode === 'manual'
          ? businessManual
          : (businessManual.length > 0 ? businessManual : computeAutoAllocations(businessLead, members.business));

        const addLoad = (userId: string, days: number) => {
          if (contributorSet.has(userId)) {
            allocationsByUser.set(userId, (allocationsByUser.get(userId) ?? 0) + days);
          } else if (showProfileless && !profiledUserIds.has(userId)) {
            profilelessLoadByUser.set(userId, (profilelessLoadByUser.get(userId) ?? 0) + days);
          }
        };
        for (const alloc of itAllocations) {
          addLoad(alloc.user_id, remainingIt * (alloc.allocation_pct / 100.0));
        }
        for (const alloc of businessAllocations) {
          addLoad(alloc.user_id, remainingBusiness * (alloc.allocation_pct / 100.0));
        }

        if (remainingTotal <= 0) continue;

        let inScope = true;
        if (teamFilter.isActive) {
          const eligible = new Set<string>();
          if (project.it_lead_id) eligible.add(project.it_lead_id);
          if (project.business_lead_id) eligible.add(project.business_lead_id);
          for (const m of members.it) eligible.add(m.id);
          for (const m of members.business) eligible.add(m.id);
          for (const alloc of itAllocations) eligible.add(alloc.user_id);
          for (const alloc of businessAllocations) eligible.add(alloc.user_id);

          if (eligible.size === 0) {
            inScope = teamFilter.includeNoTeam;
          } else {
            inScope = false;
            for (const id of eligible) {
              const teamId = teamByUserId.get(id) ?? null;
              if (teamId && teamIdSet.has(teamId)) {
                inScope = true;
                break;
              }
              if (!teamId && teamFilter.includeNoTeam) {
                inScope = true;
                break;
              }
            }
          }
        }

        if (!inScope) continue;

        const totalItPct = itAllocations.reduce((sum, a) => sum + a.allocation_pct, 0);
        const totalBusinessPct = businessAllocations.reduce((sum, a) => sum + a.allocation_pct, 0);
        const unallocatedIt = remainingIt * Math.max(0, 1 - totalItPct / 100.0);
        const unallocatedBusiness = remainingBusiness * Math.max(0, 1 - totalBusinessPct / 100.0);
        const unallocatedDays = unallocatedIt + unallocatedBusiness;
        if (unallocatedDays <= 0.0001) continue;

        const estimatedEffort = Number(project.estimated_effort_it || 0) + Number(project.estimated_effort_business || 0);
        const unallocatedPct = remainingTotal > 0 ? (unallocatedDays / remainingTotal) * 100 : 0;
        unassignedProjects.push({
          projectId: project.id,
          projectName: project.name,
          status: project.status,
          estimatedEffort: round1(estimatedEffort),
          remainingEffort: round1(remainingTotal),
          unallocatedPct: round1(unallocatedPct),
          unallocatedDays: round1(unallocatedDays),
        });
        totalUnallocatedDays += unallocatedDays;
      }

      for (const userId of profilelessLoadByUser.keys()) {
        const user = getUser(userId);
        const displayName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
        profilelessNameByUser.set(userId, displayName || user.email || 'Unknown user');
      }
    }

    const stats = capacityMode === 'historical'
      ? (await this.teamMemberConfigService.getAllTimeStats(tenantId, { manager: mg })).stats
      : {};

    const contributors: ContributorCapacityRow[] = contributorsRaw.map((row: any) => {
      const displayName = (row.user_display_name || '').trim();
      const name = displayName || row.user_email || 'Unknown user';
      const remaining = allocationsByUser.get(row.user_id) ?? 0;
      const theoretical = toNumber(row.project_availability);
      const historical = stats?.[row.config_id]?.avgProjectDays ?? null;

      let capacityDays: number | null = null;
      let capacitySource: CapacityMode | null = null;
      if (capacityMode === 'historical') {
        if (historical && historical > 0) {
          capacityDays = historical;
          capacitySource = 'historical';
        } else if (theoretical && theoretical > 0) {
          capacityDays = theoretical;
          capacitySource = 'theoretical';
        }
      } else if (theoretical && theoretical > 0) {
        capacityDays = theoretical;
        capacitySource = 'theoretical';
      }

      const monthsOfWork = capacityDays && capacityDays > 0 ? round1(remaining / capacityDays) : null;
      return {
        contributorId: row.user_id,
        contributorName: name,
        teamId: row.team_id ?? null,
        teamName: row.team_name ?? null,
        remainingDays: round1(remaining),
        capacityDaysPerMonth: capacityDays != null ? round1(capacityDays) : null,
        capacitySource,
        monthsOfWork,
        colorBand: colorBandFor(monthsOfWork),
        hasContributorProfile: true,
      };
    });

    const profilelessEntries = Array.from(profilelessLoadByUser.entries()).sort((a, b) =>
      (profilelessNameByUser.get(a[0]) ?? '').localeCompare(profilelessNameByUser.get(b[0]) ?? ''),
    );
    for (const [userId, remaining] of profilelessEntries) {
      if (remaining <= 0.0001) continue;
      contributors.push({
        contributorId: userId,
        contributorName: profilelessNameByUser.get(userId) ?? 'Unknown user',
        teamId: null,
        teamName: null,
        remainingDays: round1(remaining),
        capacityDaysPerMonth: null,
        capacitySource: null,
        monthsOfWork: null,
        colorBand: 'na',
        hasContributorProfile: false,
      });
    }

    const teamMap = new Map<string, TeamCapacityRow>();
    for (const row of contributors) {
      const teamId = row.teamId ?? NO_TEAM_ID;
      const teamName = row.teamName;
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, {
          teamId,
          teamName,
          memberCount: 0,
          remainingDays: 0,
          capacityDaysPerMonth: null,
          monthsOfWork: null,
          colorBand: 'na',
        });
      }
      const team = teamMap.get(teamId)!;
      team.memberCount += 1;
      team.remainingDays += row.remainingDays;
      if (row.capacityDaysPerMonth != null) {
        const current = team.capacityDaysPerMonth ?? 0;
        team.capacityDaysPerMonth = current + row.capacityDaysPerMonth;
      }
    }

    for (const team of teamMap.values()) {
      team.remainingDays = round1(team.remainingDays);
      if (team.capacityDaysPerMonth && team.capacityDaysPerMonth > 0) {
        team.capacityDaysPerMonth = round1(team.capacityDaysPerMonth);
        team.monthsOfWork = round1(team.remainingDays / team.capacityDaysPerMonth);
        team.colorBand = colorBandFor(team.monthsOfWork);
      } else {
        team.monthsOfWork = null;
        team.capacityDaysPerMonth = null;
        team.colorBand = 'na';
      }
    }

    const teams = Array.from(teamMap.values()).sort((a, b) =>
      (a.teamName ?? NO_TEAM_SORT_NAME).localeCompare(b.teamName ?? NO_TEAM_SORT_NAME));

    unassignedProjects.sort((a, b) => b.unallocatedDays - a.unallocatedDays || a.projectName.localeCompare(b.projectName));

    return {
      contributors,
      teams,
      unassignedSummary: {
        totalProjects: unassignedProjects.length,
        totalUnallocatedDays: round1(totalUnallocatedDays),
      },
      unassignedProjects,
      filters: {
        teamIds: teamFilter.isActive ? [...teamFilter.teamIds, ...(teamFilter.includeNoTeam ? [NO_TEAM_ID] : [])] : [],
        statuses,
        capacityMode,
        groupBy,
      },
    };
  }

  async getContributorBreakdown(
    tenantId: string,
    contributorId: string,
    statuses?: ProjectStatus[],
    svcOpts?: { manager?: EntityManager },
  ): Promise<{ projects: ProjectBreakdownRow[] }> {
    const mg = svcOpts?.manager ?? this.projectRepo.manager;
    const finalStatuses = this.normalizeStatuses(statuses);

    const projectRows = await mg.query(
      `
      SELECT DISTINCT
        p.id,
        p.name,
        p.status,
        p.execution_progress,
        p.estimated_effort_it,
        p.estimated_effort_business,
        p.it_effort_allocation_mode,
        p.business_effort_allocation_mode,
        p.it_lead_id,
        p.business_lead_id
      FROM portfolio_projects p
      LEFT JOIN portfolio_project_team ppt
        ON ppt.project_id = p.id
       AND ppt.tenant_id = p.tenant_id
       AND ppt.user_id = $2
      LEFT JOIN portfolio_project_effort_allocations ea
        ON ea.project_id = p.id
       AND ea.tenant_id = p.tenant_id
       AND ea.user_id = $2
      WHERE p.tenant_id = $1
        AND p.status = ANY($3)
        AND (
          p.it_lead_id = $2
          OR p.business_lead_id = $2
          OR ppt.user_id IS NOT NULL
          OR ea.user_id IS NOT NULL
        )
      ORDER BY p.name ASC
    `,
      [tenantId, contributorId, finalStatuses],
    );

    if (projectRows.length === 0) {
      return { projects: [] };
    }

    const projectIds = projectRows.map((p: any) => p.id);
    const manualAllocRows = await mg.query(
      `
      SELECT project_id, user_id, effort_type, allocation_pct
      FROM portfolio_project_effort_allocations
      WHERE tenant_id = $1
        AND project_id = ANY($2)
    `,
      [tenantId, projectIds],
    );

    const teamRows = await mg.query(
      `
      SELECT project_id, user_id, role
      FROM portfolio_project_team
      WHERE tenant_id = $1
        AND project_id = ANY($2)
    `,
      [tenantId, projectIds],
    );

    const leadIds = new Set<string>();
    for (const p of projectRows) {
      if (p.it_lead_id) leadIds.add(p.it_lead_id);
      if (p.business_lead_id) leadIds.add(p.business_lead_id);
    }

    const userIds = new Set<string>();
    for (const row of manualAllocRows) userIds.add(row.user_id);
    for (const row of teamRows) userIds.add(row.user_id);
    for (const id of leadIds) userIds.add(id);

    const userRows = userIds.size > 0
      ? await mg.query(
        `SELECT id, first_name, last_name, email FROM users WHERE tenant_id = $1 AND id = ANY($2)`,
        [tenantId, Array.from(userIds)],
      )
      : [];

    const userById = new Map<string, UserInfo>();
    for (const row of userRows) {
      userById.set(row.id, {
        id: row.id,
        first_name: row.first_name,
        last_name: row.last_name,
        email: row.email,
      });
    }
    const getUser = (id: string): UserInfo => userById.get(id) ?? { id, first_name: '', last_name: '', email: '' };

    const teamMembersByProject = new Map<string, { it: UserInfo[]; business: UserInfo[] }>();
    for (const row of teamRows) {
      const entry = teamMembersByProject.get(row.project_id) ?? { it: [], business: [] };
      const member = getUser(row.user_id);
      if (row.role === 'it_team') entry.it.push(member);
      if (row.role === 'business_team') entry.business.push(member);
      teamMembersByProject.set(row.project_id, entry);
    }

    const manualAllocByKey = new Map<string, Allocation[]>();
    for (const row of manualAllocRows) {
      const key = `${row.project_id}:${row.effort_type}`;
      const list = manualAllocByKey.get(key) ?? [];
      list.push({ user_id: row.user_id, allocation_pct: Number(row.allocation_pct || 0) });
      manualAllocByKey.set(key, list);
    }

    const projects: ProjectBreakdownRow[] = [];
    for (const row of projectRows) {
      const progress = Number(row.execution_progress || 0);
      const remainingIt = Number(row.estimated_effort_it || 0) * (1 - progress / 100.0);
      const remainingBusiness = Number(row.estimated_effort_business || 0) * (1 - progress / 100.0);
      const remainingTotal = remainingIt + remainingBusiness;
      if (remainingTotal <= 0) continue;

      const members = teamMembersByProject.get(row.id) ?? { it: [], business: [] };
      const itLead = row.it_lead_id ? getUser(row.it_lead_id) : null;
      const businessLead = row.business_lead_id ? getUser(row.business_lead_id) : null;
      const itKey = `${row.id}:it`;
      const businessKey = `${row.id}:business`;

      const itManual = manualAllocByKey.get(itKey) ?? [];
      const businessManual = manualAllocByKey.get(businessKey) ?? [];
      const itAllocations = row.it_effort_allocation_mode === 'manual'
        ? itManual
        : (itManual.length > 0 ? itManual : computeAutoAllocations(itLead, members.it));
      const businessAllocations = row.business_effort_allocation_mode === 'manual'
        ? businessManual
        : (businessManual.length > 0 ? businessManual : computeAutoAllocations(businessLead, members.business));

      const itAllocPct = itAllocations.find((a) => a.user_id === contributorId)?.allocation_pct ?? 0;
      const businessAllocPct = businessAllocations.find((a) => a.user_id === contributorId)?.allocation_pct ?? 0;
      const contributorDays = remainingIt * (itAllocPct / 100.0) + remainingBusiness * (businessAllocPct / 100.0);
      if (contributorDays <= 0.0001) continue;

      const allocationPct = remainingTotal > 0 ? (contributorDays / remainingTotal) * 100 : 0;
      const estimatedEffort = Number(row.estimated_effort_it || 0) + Number(row.estimated_effort_business || 0);

      projects.push({
        projectId: row.id,
        projectName: row.name,
        status: row.status,
        estimatedEffort: round1(estimatedEffort),
        executionProgress: round1(progress),
        remainingEffort: round1(remainingTotal),
        allocationPct: round1(allocationPct),
        contributorDays: round1(contributorDays),
      });
    }

    return { projects };
  }
}
