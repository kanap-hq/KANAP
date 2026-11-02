import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { normalizeReportTimeZone } from '../../common/report-period';
import { SteeringFlow, SteeringSummaryResponse } from '../dto/steering-summary.dto';

/** Periods the strip offers. Anything else falls back to the middle one. */
export const STEERING_DAYS = [7, 30, 90] as const;
export const STEERING_DEFAULT_DAYS = 30;

/** A project with no activity for this many days is reported as stale. */
export const STALE_PROJECT_DAYS = 30;

/**
 * Tasks only count when they are standalone or hang off a project. The tasks attached to a
 * contract, a spend item, a capex item or an incident belong to those workflows and would
 * distort every portfolio figure.
 */
const TASK_SCOPE_SQL = `(t.related_object_type IS NULL OR t.related_object_type = 'project')`;

const CLOSED_TASK_STATUSES = ['done', 'cancelled'];
const CLOSED_PROJECT_STATUSES = ['done', 'cancelled'];
const CLOSED_REQUEST_STATUSES = ['rejected', 'converted'];

const PROJECTS_IN_FLIGHT = ['in_progress', 'in_testing'];

type FlowRow = { created: string | number; closed: string | number; reopened: string | number; open_now: string | number };

type StaleRow = {
  id: string;
  item_number: number | string | null;
  name: string | null;
  status: string | null;
  last_activity_at: string | null;
};

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

export type SteeringSummaryQuery = { days?: unknown; timeZone?: string | null };

/** The requested period, or the default when it is missing or not one of the offered ones. */
export function normalizeSteeringDays(value: unknown): number {
  const parsed = Number(String(value ?? '').trim());
  return (STEERING_DAYS as readonly number[]).includes(parsed) ? parsed : STEERING_DEFAULT_DAYS;
}

/** Today in the viewer's zone, as `YYYY-MM-DD`. */
function todayIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

/** `day` shifted by a whole number of calendar days, both sides `YYYY-MM-DD`. */
function shiftDay(day: string, offset: number): string {
  const shifted = new Date(`${day}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + offset);
  return shifted.toISOString().slice(0, 10);
}

/**
 * The daily steering picture of the portfolio: what moved over the period, and what is waiting
 * for someone. Everything is derived from the live tables and from `audit_log`, which carries a
 * `create` row and a before/after `update` row for every write path (UI, CSV import, agents).
 *
 * A figure only counts an item that still exists: the period counts join the live table, so a
 * deleted item never inflates the flow. Every query filters on `tenant_id`.
 */
@Injectable()
export class PortfolioSteeringSummaryService {
  async getSummary(
    tenantId: string,
    query: SteeringSummaryQuery,
    opts: { manager?: EntityManager },
  ): Promise<SteeringSummaryResponse> {
    const manager = opts.manager;
    if (!manager) throw new Error('A tenant-bound EntityManager is required');

    const timeZone = normalizeReportTimeZone(query.timeZone);
    const days = normalizeSteeringDays(query.days);
    const endDate = todayIn(timeZone);
    const startDate = shiftDay(endDate, -(days - 1));
    const period = { tenantId, startDate, endDate, timeZone };

    // One after the other: the request's single connection runs its queries in turn anyway.
    const tasks = await this.flow(manager, period, {
      table: 'tasks',
      closedStatuses: CLOSED_TASK_STATUSES,
      scopeSql: `
          SELECT t.id, (t.status <> ALL($6::text[])) AS is_open
          FROM tasks t
          WHERE t.tenant_id = $1 AND ${TASK_SCOPE_SQL}
        `,
    });
    const requests = await this.flow(manager, period, {
      table: 'portfolio_requests',
      closedStatuses: CLOSED_REQUEST_STATUSES,
      scopeSql: `
          SELECT r.id, (r.status <> ALL($6::text[])) AS is_open
          FROM portfolio_requests r
          WHERE r.tenant_id = $1
        `,
    });
    const projects = await this.flow(manager, period, {
      table: 'portfolio_projects',
      closedStatuses: CLOSED_PROJECT_STATUSES,
      scopeSql: `
          SELECT p.id, (p.status <> ALL($6::text[])) AS is_open
          FROM portfolio_projects p
          WHERE p.tenant_id = $1
        `,
    });
    const attention = await this.taskAttention(manager, tenantId, timeZone);
    const staleProjects = await this.staleProjects(manager, tenantId, timeZone);

    return {
      days,
      startDate,
      endDate,
      tasks,
      requests,
      projects,
      attention: { ...attention, staleProjects },
    };
  }

  /**
   * One statement per entity: the live rows in scope decide what exists and what is open, the
   * audit events of the period decide what was created, closed or reopened. Grouping the events
   * by record first makes each figure a count of distinct items, not of events. Created and
   * closed follow the period review's rules on the same days, so each figure equals the
   * review's list it links to.
   */
  private async flow(
    manager: EntityManager,
    period: { tenantId: string; startDate: string; endDate: string; timeZone: string },
    spec: { table: string; closedStatuses: string[]; scopeSql: string },
  ): Promise<SteeringFlow> {
    const [row] = (await manager.query(
      `
      WITH scope AS (${spec.scopeSql}),
      period_events AS (
        SELECT al.record_id, al.action, al.before_json, al.after_json, al.created_at, al.id
        FROM audit_log al
        WHERE al.tenant_id = $1
          AND al.table_name = $5
          AND al.record_id IS NOT NULL
          AND al.action IN ('create', 'update')
          AND al.created_at >= ($2::date::timestamp AT TIME ZONE $4)
          AND al.created_at < (($3::date + 1)::timestamp AT TIME ZONE $4)
      ),
      events AS (
        SELECT
          pe.record_id AS id,
          bool_or(pe.action = 'create') AS was_created,
          bool_or(
            pe.action = 'update'
            AND pe.before_json->>'status' IS NOT NULL
            AND pe.after_json->>'status' IS NOT NULL
            AND pe.before_json->>'status' = ANY($6::text[])
            AND pe.after_json->>'status' <> ALL($6::text[])
          ) AS was_reopened
        FROM period_events pe
        GROUP BY pe.record_id
      ),
      -- Closed: the last status event of the period, the creation included, leaves the item in
      -- a closed status. The period review's rule ("closing" in its event CTEs), so the
      -- figure and the review's closed list count the same items.
      status_event_last AS (
        SELECT DISTINCT ON (pe.record_id) pe.record_id, pe.after_json->>'status' AS after_status
        FROM period_events pe
        WHERE pe.action = 'create'
           OR pe.before_json->>'status' IS DISTINCT FROM pe.after_json->>'status'
        ORDER BY pe.record_id, pe.created_at DESC, pe.id DESC
      )
      SELECT
        COUNT(*) FILTER (WHERE e.was_created)::int AS created,
        COUNT(*) FILTER (WHERE sel.after_status = ANY($6::text[]))::int AS closed,
        COUNT(*) FILTER (WHERE e.was_reopened)::int AS reopened,
        COUNT(*) FILTER (WHERE s.is_open)::int AS open_now
      FROM scope s
      LEFT JOIN events e ON e.id = s.id
      LEFT JOIN status_event_last sel ON sel.record_id = s.id
      `,
      [period.tenantId, period.startDate, period.endDate, period.timeZone, spec.table, spec.closedStatuses],
    )) as FlowRow[];

    const created = num(row?.created);
    const closed = num(row?.closed);
    const reopened = num(row?.reopened);
    return { created, closed, reopened, openNow: num(row?.open_now), netChange: created + reopened - closed };
  }

  /** Open tasks in scope that are past their due day, and open tasks nobody owns. */
  private async taskAttention(
    manager: EntityManager,
    tenantId: string,
    timeZone: string,
  ): Promise<{ overdueTasks: number; unassignedTasks: number }> {
    const [row] = (await manager.query(
      `
      SELECT
        COUNT(*) FILTER (WHERE t.due_date IS NOT NULL AND t.due_date < (now() AT TIME ZONE $2)::date)::int AS overdue,
        COUNT(*) FILTER (WHERE t.assignee_user_id IS NULL)::int AS unassigned
      FROM tasks t
      WHERE t.tenant_id = $1
        AND t.status <> ALL($3::text[])
        AND ${TASK_SCOPE_SQL}
      `,
      [tenantId, timeZone, CLOSED_TASK_STATUSES],
    )) as Array<{ overdue: number; unassigned: number }>;

    return { overdueTasks: num(row?.overdue), unassignedTasks: num(row?.unassigned) };
  }

  /**
   * Projects that are supposed to be running but where nothing has happened for a month.
   *
   * "Nothing" is deliberately wide: a field change on the project or on one of its tasks, a
   * comment or decision in the project journal, a task of the project touched in any way, and
   * any time logged on the project or on one of its tasks. A project only shows up when every
   * one of those signals is older than the window, so the figure stays trustworthy.
   */
  private async staleProjects(manager: EntityManager, tenantId: string, timeZone: string) {
    const rows = (await manager.query(
      `
      WITH proj AS (
        SELECT p.id, p.item_number, p.name, p.status, p.updated_at
        FROM portfolio_projects p
        WHERE p.tenant_id = $1 AND p.status = ANY($4::text[])
      ),
      proj_tasks AS (
        SELECT t.related_object_id AS project_id, t.id AS task_id, t.updated_at
        FROM tasks t
        JOIN proj ON proj.id = t.related_object_id
        WHERE t.tenant_id = $1 AND t.related_object_type = 'project'
      ),
      audit_on_project AS (
        SELECT al.record_id AS project_id, MAX(al.created_at) AS at
        FROM audit_log al
        JOIN proj ON proj.id = al.record_id
        WHERE al.tenant_id = $1 AND al.table_name = 'portfolio_projects'
        GROUP BY 1
      ),
      audit_on_tasks AS (
        SELECT pt.project_id, MAX(al.created_at) AS at
        FROM audit_log al
        JOIN proj_tasks pt ON pt.task_id = al.record_id
        WHERE al.tenant_id = $1 AND al.table_name = 'tasks'
        GROUP BY 1
      ),
      task_touch AS (
        SELECT pt.project_id, MAX(pt.updated_at) AS at FROM proj_tasks pt GROUP BY 1
      ),
      journal AS (
        SELECT COALESCE(pa.project_id, pt.project_id) AS project_id,
               MAX(GREATEST(pa.created_at, pa.updated_at)) AS at
        FROM portfolio_activities pa
        LEFT JOIN proj_tasks pt ON pt.task_id = pa.task_id
        WHERE pa.tenant_id = $1
          AND (pa.project_id IN (SELECT id FROM proj) OR pt.project_id IS NOT NULL)
        GROUP BY 1
      ),
      project_time AS (
        SELECT te.project_id, MAX(GREATEST(te.logged_at, te.created_at, te.updated_at)) AS at
        FROM portfolio_project_time_entries te
        JOIN proj ON proj.id = te.project_id
        WHERE te.tenant_id = $1
        GROUP BY 1
      ),
      task_time AS (
        SELECT pt.project_id, MAX(GREATEST(tte.logged_at, tte.created_at, tte.updated_at)) AS at
        FROM task_time_entries tte
        JOIN proj_tasks pt ON pt.task_id = tte.task_id
        WHERE tte.tenant_id = $1
        GROUP BY 1
      ),
      merged AS (
        SELECT
          proj.id,
          proj.item_number,
          proj.name,
          proj.status,
          GREATEST(
            proj.updated_at,
            ap.at,
            at_.at,
            tt.at,
            j.at,
            ptime.at,
            ttime.at
          ) AS last_activity_at
        FROM proj
        LEFT JOIN audit_on_project ap ON ap.project_id = proj.id
        LEFT JOIN audit_on_tasks at_ ON at_.project_id = proj.id
        LEFT JOIN task_touch tt ON tt.project_id = proj.id
        LEFT JOIN journal j ON j.project_id = proj.id
        LEFT JOIN project_time ptime ON ptime.project_id = proj.id
        LEFT JOIN task_time ttime ON ttime.project_id = proj.id
      )
      SELECT
        m.id,
        m.item_number,
        m.name,
        m.status,
        (m.last_activity_at AT TIME ZONE $2)::date::text AS last_activity_at
      FROM merged m
      WHERE m.last_activity_at IS NULL
         OR m.last_activity_at < (((now() AT TIME ZONE $2)::date - $3::int)::timestamp AT TIME ZONE $2)
      ORDER BY m.last_activity_at ASC NULLS FIRST, m.item_number ASC
      `,
      [tenantId, timeZone, STALE_PROJECT_DAYS, PROJECTS_IN_FLIGHT],
    )) as StaleRow[];

    return rows.map((row) => ({
      id: row.id,
      ref: row.item_number != null ? `PRJ-${row.item_number}` : row.id,
      name: row.name ?? '',
      status: row.status ?? '',
      lastActivityAt: row.last_activity_at ?? null,
    }));
  }
}
