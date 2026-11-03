import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { normalizeReportTimeZone } from '../../common/report-period';
import {
  ASSIGNEE_STALE_DAYS,
  ASSIGNEE_STALE_DEFAULT_DAYS,
  AssigneeAttentionResponse,
  AssigneeRow,
  AttentionCounts,
  TeamGroup,
} from '../dto/assignee-attention.dto';
import { shiftDay, todayIn } from './portfolio-flow-report.service';
import { andPredicates, taskProjectTeamPredicates } from './portfolio-report-filters';

/**
 * Tasks only count when they are standalone or hang off a project, exactly like the steering
 * strip and the other reports: the tasks attached to a contract, a spend item, a capex item or
 * an incident belong to those workflows and would distort the workload picture.
 */
const TASK_SCOPE_SQL = `(t.related_object_type IS NULL OR t.related_object_type = 'project')`;

/** The statuses a task is counted as open in, the same list the task list link carries. */
const OPEN_TASK_STATUSES = ['open', 'in_progress', 'pending', 'in_testing'];

type PersonRow = {
  user_id: string;
  name: string | null;
  item_number: number | string | null;
  team_id: string | null;
  team_name: string | null;
  open: number | string;
  overdue: number | string;
  stale: number | string;
};

type CountsRow = { open: number | string; overdue: number | string; stale: number | string };

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** The requested window, or the default when it is missing or not one of the offered ones. */
export function normalizeStaleDays(value: unknown): number {
  const parsed = Number(String(value ?? '').trim());
  return (ASSIGNEE_STALE_DAYS as readonly number[]).includes(parsed) ? parsed : ASSIGNEE_STALE_DEFAULT_DAYS;
}

const emptyCounts = (): AttentionCounts => ({ open: 0, overdue: 0, stale: 0 });

const addCounts = (target: AttentionCounts, source: AttentionCounts) => {
  target.open += source.open;
  target.overdue += source.overdue;
  target.stale += source.stale;
};

/**
 * Where the open work sits, team by team and person by person: what is open, what is already
 * late, and what nobody has touched for the chosen window. It answers "who needs help or needs
 * to be relieved", so it never ranks anyone: teams and members are listed by name.
 *
 * Every figure is a link into the task list, so the two have to count the same population. The
 * "no movement" test is therefore written exactly as the list writes it, `updated_at::date`
 * against a plain day, with no zone conversion: the list does not convert either.
 *
 * Every query filters on `tenant_id`, and the zone is a bound parameter, never interpolated.
 */
@Injectable()
export class PortfolioAssigneeAttentionService {
  async getReport(
    tenantId: string,
    query: { staleDays?: unknown; timeZone?: string | null; projectIds?: string[]; teamIds?: string[] },
    opts: { manager?: EntityManager },
  ): Promise<AssigneeAttentionResponse> {
    const manager = opts.manager;
    if (!manager) throw new Error('A tenant-bound EntityManager is required');

    const timeZone = normalizeReportTimeZone(query.timeZone);
    const staleDays = normalizeStaleDays(query.staleDays);
    const asOf = todayIn(timeZone);
    const staleBefore = shiftDay(asOf, -staleDays);
    const params: any[] = [tenantId, OPEN_TASK_STATUSES, asOf, staleBefore];
    // The project and team filters, the ones the task list applies to the links: a team filter
    // leaves the unassigned tasks out, so the unassigned line counts zero under it.
    const projectTeamSql = andPredicates(taskProjectTeamPredicates(params, 't', query));

    // One after the other: the request's single connection runs its queries in turn anyway.
    const people = await manager.query(
        `
        WITH scope AS (
          SELECT t.assignee_user_id AS user_id,
                 (t.due_date IS NOT NULL AND t.due_date < $3::date) AS is_overdue,
                 (t.updated_at::date < $4::date) AS is_stale
          FROM tasks t
          WHERE t.tenant_id = $1
            AND t.status = ANY($2::text[])
            AND ${TASK_SCOPE_SQL}
            AND t.assignee_user_id IS NOT NULL${projectTeamSql}
        )
        SELECT s.user_id::text AS user_id,
               COALESCE(
                 NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''),
                 split_part(u.email, '@', 1)
               ) AS name,
               mc.item_number,
               mc.team_id::text AS team_id,
               pt.name AS team_name,
               COUNT(*)::int AS open,
               COUNT(*) FILTER (WHERE s.is_overdue)::int AS overdue,
               COUNT(*) FILTER (WHERE s.is_stale)::int AS stale
        FROM scope s
        LEFT JOIN users u ON u.id = s.user_id AND u.tenant_id = $1
        LEFT JOIN portfolio_team_member_configs mc ON mc.user_id = s.user_id AND mc.tenant_id = $1
        LEFT JOIN portfolio_teams pt ON pt.id = mc.team_id AND pt.tenant_id = $1
        GROUP BY s.user_id, u.first_name, u.last_name, u.email, mc.item_number, mc.team_id, pt.name
        `,
        params,
      ) as PersonRow[];
    const unassignedRows = await manager.query(
        `
        SELECT COUNT(*)::int AS open,
               COUNT(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date < $3::date)::int AS overdue,
               COUNT(*) FILTER (WHERE t.updated_at::date < $4::date)::int AS stale
        FROM tasks t
        WHERE t.tenant_id = $1
          AND t.status = ANY($2::text[])
          AND ${TASK_SCOPE_SQL}
          AND t.assignee_user_id IS NULL${projectTeamSql}
        `,
        params,
      ) as CountsRow[];

    const unassignedRow = unassignedRows[0];
    const unassigned: AttentionCounts = {
      open: num(unassignedRow?.open),
      overdue: num(unassignedRow?.overdue),
      stale: num(unassignedRow?.stale),
    };

    const teams = this.groupByTeam(people);
    const totals = emptyCounts();
    teams.forEach((team) => addCounts(totals, team));
    addCounts(totals, unassigned);

    return { staleDays, asOf, staleBefore, teams, unassigned, totals };
  }

  /**
   * Teams by name with the members inside them, the people without a contributor profile or
   * without a team gathered in a last group that carries no team id.
   */
  private groupByTeam(rows: PersonRow[]): TeamGroup[] {
    const groups = new Map<string, TeamGroup>();

    for (const row of rows) {
      const teamId = row.team_id ?? null;
      const key = teamId ?? '';
      let group = groups.get(key);
      if (!group) {
        group = { teamId, teamName: teamId ? row.team_name ?? null : null, members: [], ...emptyCounts() };
        groups.set(key, group);
      }
      const member: AssigneeRow = {
        userId: row.user_id,
        name: row.name ?? '',
        contributorRef: row.item_number != null ? `CTR-${row.item_number}` : null,
        open: num(row.open),
        overdue: num(row.overdue),
        stale: num(row.stale),
      };
      group.members.push(member);
      addCounts(group, member);
    }

    const byName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base' });
    const teams = Array.from(groups.values());
    teams.forEach((team) => team.members.sort((a, b) => byName(a.name, b.name)));
    teams.sort((a, b) => {
      if (a.teamId === null) return 1;
      if (b.teamId === null) return -1;
      return byName(a.teamName ?? '', b.teamName ?? '');
    });
    return teams;
  }
}
