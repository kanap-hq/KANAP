import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { normalizeReportTimeZone } from '../../common/report-period';
import {
  TIME_LOGGED_DEFAULT_MONTHS,
  TIME_LOGGED_MONTHS,
  TimeLoggedCell,
  TimeLoggedMember,
  TimeLoggedReportResponse,
  TimeLoggedTeam,
} from '../dto/time-logged-report.dto';
import { buildMonths, todayIn } from './portfolio-flow-report.service';
import {
  normalizeIdList,
  ProjectTeamFilters,
  teamMembersSql,
  timeEntryProjectTeamFilters,
} from './portfolio-report-filters';

type HoursRow = { user_id: string | null; month: string; is_project: boolean; hours: number | string | null };
type PersonRow = {
  user_id: string;
  name: string | null;
  item_number: number | string | null;
  team_id: string | null;
  team_name: string | null;
  team_order: number | string | null;
  is_contributor: boolean;
};

/** Project and other hours of one month. */
type Hours = { project: number; other: number };

/** Days from hours, one decimal, the rule of the period review: always applied to a sum of hours. */
const hoursToDays = (hours: number): number => Math.round((hours / 8) * 10) / 10;

/** The days of a month cell: its project and other days added, one decimal (both already rounded from hours). */
export const cellTotalDays = (projectDays: number, otherDays: number): number =>
  Math.round((projectDays + otherDays) * 10) / 10;

/** The requested horizon, or the default when it is missing or not one of the offered ones. */
export function normalizeTimeLoggedMonths(value: unknown): number {
  const parsed = Number(String(value ?? '').trim());
  return (TIME_LOGGED_MONTHS as readonly number[]).includes(parsed) ? parsed : TIME_LOGGED_DEFAULT_MONTHS;
}

const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });

/**
 * Where the logged time goes, month after month: project time or the rest, by team and by
 * person. It reads the raw entries rather than the monthly aggregate, which is kept in UTC
 * months and knows neither teams nor projects. An entry is project time when its task hangs
 * off a project or when it was logged on a project directly, exactly like the aggregate.
 *
 * Two statements, both filtered on the tenant: the hours grouped by person, month and kind,
 * and the people with their teams. Days are always computed from summed hours, never by adding
 * rounded days. The report shows counts of days only, never the notes of an entry.
 */
@Injectable()
export class PortfolioTimeLoggedReportService {
  async getReport(
    tenantId: string,
    query: { months?: unknown; timeZone?: string | null } & ProjectTeamFilters,
    opts: { manager?: EntityManager },
  ): Promise<TimeLoggedReportResponse> {
    const manager = opts.manager;
    if (!manager) throw new Error('A tenant-bound EntityManager is required');

    const timeZone = normalizeReportTimeZone(query.timeZone);
    const monthCount = normalizeTimeLoggedMonths(query.months);
    const today = todayIn(timeZone);
    const bounds = buildMonths(today, monthCount);
    const months = bounds.map((bound) => bound.periodStart.slice(0, 7));
    const filters: ProjectTeamFilters = {
      projectIds: normalizeIdList(query.projectIds),
      teamIds: normalizeIdList(query.teamIds),
    };

    const hoursRows = await this.fetchHours(manager, tenantId, timeZone, bounds[0].periodStart, today, filters);

    // Hours by person (`''` for the entries without one) and month.
    const byUser = new Map<string, Map<string, Hours>>();
    const byMonth = new Map<string, Hours>();
    for (const row of hoursRows) {
      const hours = Number(row.hours ?? 0) || 0;
      if (hours === 0 || !months.includes(row.month)) continue;
      const userKey = row.user_id ?? '';
      if (!byUser.has(userKey)) byUser.set(userKey, new Map());
      addHours(byUser.get(userKey)!, row.month, row.is_project, hours);
      addHours(byMonth, row.month, row.is_project, hours);
    }

    const entryUserIds = Array.from(byUser.keys()).filter((key) => key !== '');
    const people = await this.fetchPeople(manager, tenantId, entryUserIds, filters);

    const cellsOf = (hours: Map<string, Hours> | undefined): TimeLoggedCell[] =>
      months.map((month) => {
        const value = hours?.get(month);
        const projectDays = hoursToDays(value?.project ?? 0);
        const otherDays = hoursToDays(value?.other ?? 0);
        return { month, projectDays, otherDays, totalDays: cellTotalDays(projectDays, otherDays) };
      });

    type Group = { team: TimeLoggedTeam; order: number; hours: Map<string, Hours> };
    const groups = new Map<string, Group>();
    const groupFor = (teamId: string | null, teamName: string | null, order: number): Group => {
      const key = teamId ?? '';
      let group = groups.get(key);
      if (!group) {
        group = { team: { teamId, teamName, members: [], cells: [] }, order, hours: new Map() };
        groups.set(key, group);
      }
      return group;
    };
    const mergeInto = (target: Map<string, Hours>, source: Map<string, Hours> | undefined) => {
      source?.forEach((value, month) => {
        addHours(target, month, true, value.project);
        addHours(target, month, false, value.other);
      });
    };

    let contributorsTotal = 0;
    let contributorsWithoutEntries = 0;
    for (const person of people) {
      const hours = byUser.get(person.user_id);
      if (person.is_contributor) {
        contributorsTotal += 1;
        if (!hours) contributorsWithoutEntries += 1;
      }
      const group = groupFor(
        person.team_id ?? null,
        person.team_id ? person.team_name ?? null : null,
        Number(person.team_order ?? 0) || 0,
      );
      group.team.members.push({
        userId: person.user_id,
        name: person.name ?? '',
        contributorRef: person.item_number != null ? `CTR-${person.item_number}` : null,
        cells: cellsOf(hours),
      });
      mergeInto(group.hours, hours);
    }

    const groupList = Array.from(groups.values());
    groupList.forEach((group) => group.team.members.sort((a, b) => byName(a.name, b.name)));

    // Entries logged without a person still count: they close the group without a team.
    const unknown = byUser.get('');
    if (unknown) {
      const group = groupFor(null, null, 0);
      const member: TimeLoggedMember = { userId: null, name: '', contributorRef: null, cells: cellsOf(unknown) };
      group.team.members.push(member);
      mergeInto(group.hours, unknown);
      if (!groupList.includes(group)) groupList.push(group);
    }

    groupList.forEach((group) => {
      group.team.cells = cellsOf(group.hours);
    });
    groupList.sort((a, b) => {
      if (a.team.teamId === null) return 1;
      if (b.team.teamId === null) return -1;
      return a.order - b.order || byName(a.team.teamName ?? '', b.team.teamName ?? '');
    });

    let projectHours = 0;
    let otherHours = 0;
    byMonth.forEach((value) => {
      projectHours += value.project;
      otherHours += value.other;
    });

    return {
      months,
      totals: {
        projectDays: hoursToDays(projectHours),
        otherDays: hoursToDays(otherHours),
        totalDays: hoursToDays(projectHours + otherHours),
        contributorsWithoutEntries,
        contributorsTotal,
      },
      series: cellsOf(byMonth),
      teams: groupList.map((group) => group.team),
    };
  }

  /**
   * The hours of the window, grouped by person, local month and kind: the union of the two time
   * tables, never a query per person. The window runs from the first day of the oldest month to
   * today, both read in the viewer's zone.
   */
  private fetchHours(
    manager: EntityManager,
    tenantId: string,
    timeZone: string,
    startDate: string,
    endDate: string,
    filters: ProjectTeamFilters,
  ): Promise<HoursRow[]> {
    const sqlParams: any[] = [tenantId, startDate, timeZone, endDate];
    const { taskFilter, projectFilter } = timeEntryProjectTeamFilters(sqlParams, filters, '$1');
    return manager.query(
      `
      WITH entries AS (
        SELECT
          tte.user_id,
          tte.hours::numeric AS hours,
          tte.logged_at,
          -- A standalone task has no type at all: its time is other time, not unknown time.
          COALESCE(t.related_object_type = 'project', FALSE) AS is_project
        FROM task_time_entries tte
        JOIN tasks t ON t.id = tte.task_id AND t.tenant_id = $1
        WHERE tte.tenant_id = $1
          AND tte.logged_at >= ($2::date::timestamp AT TIME ZONE $3)
          AND tte.logged_at < (($4::date + 1)::timestamp AT TIME ZONE $3)${taskFilter}

        UNION ALL

        SELECT
          pte.user_id,
          pte.hours::numeric AS hours,
          pte.logged_at,
          TRUE AS is_project
        FROM portfolio_project_time_entries pte
        WHERE pte.tenant_id = $1
          AND pte.logged_at >= ($2::date::timestamp AT TIME ZONE $3)
          AND pte.logged_at < (($4::date + 1)::timestamp AT TIME ZONE $3)${projectFilter}
      )
      SELECT
        e.user_id::text AS user_id,
        to_char(date_trunc('month', e.logged_at AT TIME ZONE $3), 'YYYY-MM') AS month,
        e.is_project,
        SUM(e.hours)::numeric AS hours
      FROM entries e
      GROUP BY e.user_id, month, e.is_project
      `,
      sqlParams,
    );
  }

  /**
   * Every contributor profile in scope — the team filter keeps its teams' members — plus the
   * people who logged time without one. A contributor with no entry is listed all the same:
   * an empty row is the information. Names only, never an email.
   */
  private fetchPeople(
    manager: EntityManager,
    tenantId: string,
    entryUserIds: string[],
    filters: ProjectTeamFilters,
  ): Promise<PersonRow[]> {
    const sqlParams: any[] = [tenantId, entryUserIds];
    let contributorScope = 'mc.id IS NOT NULL';
    const teamIds = normalizeIdList(filters.teamIds);
    if (teamIds.length > 0) {
      sqlParams.push(teamIds);
      contributorScope += ` AND u.id IN ${teamMembersSql(`$${sqlParams.length}`, '$1')}`;
    }
    return manager.query(
      `
      SELECT
        u.id::text AS user_id,
        COALESCE(
          NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
          split_part(u.email, '@', 1)
        ) AS name,
        mc.item_number,
        mc.team_id::text AS team_id,
        pt.name AS team_name,
        pt.display_order AS team_order,
        (mc.id IS NOT NULL) AS is_contributor
      FROM users u
      LEFT JOIN portfolio_team_member_configs mc ON mc.user_id = u.id AND mc.tenant_id = $1
      LEFT JOIN portfolio_teams pt ON pt.id = mc.team_id AND pt.tenant_id = $1
      WHERE u.tenant_id = $1
        AND ((${contributorScope}) OR u.id::text = ANY($2::text[]))
      `,
      sqlParams,
    );
  }
}

function addHours(target: Map<string, Hours>, month: string, isProject: boolean, hours: number) {
  const value = target.get(month) ?? { project: 0, other: 0 };
  if (isProject) value.project += hours;
  else value.other += hours;
  target.set(month, value);
}
