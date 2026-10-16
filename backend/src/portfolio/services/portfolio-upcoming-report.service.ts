import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { normalizeReportTimeZone } from '../../common/report-period';
import {
  UPCOMING_PROJECT_DAYS,
  UPCOMING_PROJECT_DEFAULT_DAYS,
  UPCOMING_REQUEST_DAYS,
  UPCOMING_REQUEST_DEFAULT_DAYS,
  UPCOMING_TASK_DAYS,
  UPCOMING_TASK_DEFAULT_DAYS,
  UpcomingProjectRow,
  UpcomingReportResponse,
  UpcomingRequestRow,
  UpcomingTaskRow,
} from '../dto/upcoming-report.dto';
import { shiftDay, todayIn } from './portfolio-flow-report.service';
import {
  andPredicates,
  ProjectTeamFilters,
  projectProjectTeamPredicates,
  requestProjectTeamPredicates,
  taskProjectTeamPredicates,
} from './portfolio-report-filters';

/**
 * The statuses each block counts as open. They are the lists the report links carry in their
 * status filter, so a figure and the list it opens always read the same population.
 */
export const UPCOMING_OPEN_TASK_STATUSES = ['open', 'in_progress', 'pending', 'in_testing'];
export const UPCOMING_OPEN_PROJECT_STATUSES = ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'];
/** A project that has not started yet: the only ones a planned start still means something for. */
export const UPCOMING_NOT_STARTED_PROJECT_STATUSES = ['waiting_list', 'planned'];
export const UPCOMING_OPEN_REQUEST_STATUSES = ['pending_review', 'candidate', 'approved', 'on_hold'];
/** Awaiting a decision: the other open statuses already had one. */
export const UPCOMING_AWAITING_REQUEST_STATUSES = ['pending_review'];

/** Standalone and project tasks only, like the steering strip and the other reports. */
const TASK_SCOPE_SQL = `(t.related_object_type IS NULL OR t.related_object_type = 'project')`;

/** A person's display name: first and last name, or the local part of the address. */
const userNameSql = (alias: string) =>
  `COALESCE(NULLIF(TRIM(CONCAT(${alias}.first_name, ' ', ${alias}.last_name)), ''), split_part(${alias}.email, '@', 1))`;

const pick = (allowed: readonly number[], fallback: number) => (value: unknown): number => {
  const parsed = Number(String(value ?? '').trim());
  return allowed.includes(parsed) ? parsed : fallback;
};

/** The requested horizons, or each block's default when missing or not one of the offered ones. */
export const normalizeTaskDays = pick(UPCOMING_TASK_DAYS, UPCOMING_TASK_DEFAULT_DAYS);
export const normalizeProjectDays = pick(UPCOMING_PROJECT_DAYS, UPCOMING_PROJECT_DEFAULT_DAYS);
export const normalizeRequestDays = pick(UPCOMING_REQUEST_DAYS, UPCOMING_REQUEST_DEFAULT_DAYS);

const num = (value: unknown): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const numOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const refOf = (prefix: string, itemNumber: unknown): string =>
  itemNumber == null ? '' : `${prefix}-${itemNumber}`;

type RawTaskRow = {
  overdue: number | string;
  id: string | null;
  item_number: number | string | null;
  title: string | null;
  status: string | null;
  due_date: string | null;
  priority_level: string | null;
  task_type_name: string | null;
  task_type_code: string | null;
  assignee_name: string | null;
  project_id: string | null;
  project_number: number | string | null;
  project_name: string | null;
};

type RawProjectRow = {
  passed?: number | string;
  id: string | null;
  item_number: number | string | null;
  name: string | null;
  status: string | null;
  priority: number | string | null;
  planned_start: string | null;
  planned_end: string | null;
  progress: number | string | null;
  it_lead_name: string | null;
  business_lead_name: string | null;
};

type RawRequestRow = {
  id: string;
  item_number: number | string | null;
  name: string | null;
  status: string;
  source_name: string | null;
  created_on: string | null;
  target_delivery_date: string | null;
  requestor_name: string | null;
};

export type UpcomingQuery = ProjectTeamFilters & {
  taskDays?: unknown;
  projectDays?: unknown;
  requestDays?: unknown;
  timeZone?: string | null;
};

/**
 * What comes next and what is waiting: tasks falling due, projects expected to end or start,
 * requests awaiting a decision for too long, and requested deliveries. It is the only report
 * that looks forward; the flow report and the attention blocks read the present.
 *
 * Every figure links to a list that must count exactly the same rows, so every predicate is
 * written the way the list writes it: the date columns are plain days compared with inclusive
 * bounds (`BETWEEN`), and a request's creation day is `created_at::date` with no zone
 * conversion, because the request list does not convert either.
 *
 * One statement per block, every one filtered on `tenant_id`; the days, statuses and filter
 * values are bound parameters, never interpolated.
 */
@Injectable()
export class PortfolioUpcomingReportService {
  async getReport(
    tenantId: string,
    query: UpcomingQuery,
    opts: { manager?: EntityManager },
  ): Promise<UpcomingReportResponse> {
    const manager = opts.manager;
    if (!manager) throw new Error('A tenant-bound EntityManager is required');

    const timeZone = normalizeReportTimeZone(query.timeZone);
    const asOf = todayIn(timeZone);
    const taskDays = normalizeTaskDays(query.taskDays);
    const projectDays = normalizeProjectDays(query.projectDays);
    const requestDays = normalizeRequestDays(query.requestDays);
    const taskUntil = shiftDay(asOf, taskDays);
    const projectUntil = shiftDay(asOf, projectDays);
    const createdBefore = shiftDay(asOf, 1 - requestDays);
    const filters: ProjectTeamFilters = { projectIds: query.projectIds, teamIds: query.teamIds };

    const [tasks, projectEnds, projectStarts, pendingRequests, requestDeliveries] = await Promise.all([
      this.tasks(manager, tenantId, asOf, taskUntil, filters),
      this.projects(manager, tenantId, 'planned_end', UPCOMING_OPEN_PROJECT_STATUSES, asOf, projectUntil, filters, true),
      this.projects(manager, tenantId, 'planned_start', UPCOMING_NOT_STARTED_PROJECT_STATUSES, asOf, projectUntil, filters, false),
      this.pendingRequests(manager, tenantId, createdBefore, filters),
      this.requestDeliveries(manager, tenantId, asOf, projectUntil, filters),
    ]);

    return {
      asOf,
      tasks: { horizonDays: taskDays, until: taskUntil, overdueCount: tasks.overdue, rows: tasks.rows },
      projectEnds: { horizonDays: projectDays, until: projectUntil, passedCount: projectEnds.passed, rows: projectEnds.rows },
      projectStarts: { horizonDays: projectDays, until: projectUntil, rows: projectStarts.rows },
      pendingRequests: { thresholdDays: requestDays, createdBefore, rows: pendingRequests },
      requestDeliveries: { horizonDays: projectDays, until: projectUntil, rows: requestDeliveries },
    };
  }

  /**
   * Open tasks due from today to the horizon, and how many are already late. The late count
   * rides on the same statement: the scope is read once, the rows are the part of it that
   * falls in the window, and the count survives an empty window through the left join.
   */
  private async tasks(
    manager: EntityManager,
    tenantId: string,
    asOf: string,
    until: string,
    filters: ProjectTeamFilters,
  ): Promise<{ overdue: number; rows: UpcomingTaskRow[] }> {
    const params: any[] = [tenantId, UPCOMING_OPEN_TASK_STATUSES, asOf, until];
    const projectTeamSql = andPredicates(taskProjectTeamPredicates(params, 't', filters));

    const raw = (await manager.query(
      `
      WITH scope AS (
        SELECT t.*
        FROM tasks t
        WHERE t.tenant_id = $1
          AND t.status = ANY($2::text[])
          AND ${TASK_SCOPE_SQL}
          AND t.due_date IS NOT NULL
          AND t.due_date <= $4::date${projectTeamSql}
      ),
      counts AS (
        SELECT COUNT(*) FILTER (WHERE s.due_date < $3::date)::int AS overdue FROM scope s
      )
      SELECT c.overdue, r.*
      FROM counts c
      LEFT JOIN LATERAL (
        SELECT t.id::text AS id,
               t.item_number,
               t.title,
               t.status,
               t.due_date::text AS due_date,
               t.priority_level,
               tt.name AS task_type_name,
               tt.code AS task_type_code,
               ${userNameSql('u')} AS assignee_name,
               pp.id::text AS project_id,
               pp.item_number AS project_number,
               pp.name AS project_name
        FROM scope t
        LEFT JOIN portfolio_task_types tt ON tt.id = t.task_type_id AND tt.tenant_id = t.tenant_id
        LEFT JOIN users u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
        LEFT JOIN portfolio_projects pp
          ON t.related_object_type = 'project'
         AND pp.id = t.related_object_id
         AND pp.tenant_id = t.tenant_id
        WHERE t.due_date BETWEEN $3::date AND $4::date
      ) r ON true
      ORDER BY r.due_date ASC NULLS LAST, r.item_number ASC
      `,
      params,
    )) as RawTaskRow[];

    const overdue = num(raw[0]?.overdue);
    const rows = raw
      .filter((row) => row.id != null)
      .map((row): UpcomingTaskRow => {
        const ref = refOf('T', row.item_number);
        const projectRef = refOf('PRJ', row.project_number);
        return {
          ref,
          itemPath: `/portfolio/tasks/${ref || row.id}/overview`,
          name: row.title ?? '',
          status: row.status ?? '',
          taskTypeName: row.task_type_name ?? null,
          taskTypeCode: row.task_type_code ?? null,
          priorityLevel: row.priority_level ?? null,
          assigneeName: row.assignee_name ?? null,
          dueDate: row.due_date ?? '',
          project: row.project_id
            ? {
                ref: projectRef,
                name: row.project_name ?? '',
                itemPath: `/portfolio/projects/${projectRef || row.project_id}/summary`,
              }
            : null,
        };
      });
    return { overdue, rows };
  }

  /**
   * Projects whose planned end (or start) falls from today to the horizon. For the ends, the
   * open projects already past their planned end are counted on the same statement: they stay
   * in the flow report, the page only says how many there are.
   */
  private async projects(
    manager: EntityManager,
    tenantId: string,
    column: 'planned_end' | 'planned_start',
    statuses: string[],
    asOf: string,
    until: string,
    filters: ProjectTeamFilters,
    countPassed: boolean,
  ): Promise<{ passed: number; rows: UpcomingProjectRow[] }> {
    const params: any[] = [tenantId, statuses, asOf, until];
    const projectTeamSql = andPredicates(projectProjectTeamPredicates(params, 'p', filters));

    const raw = (await manager.query(
      `
      WITH scope AS (
        SELECT p.*
        FROM portfolio_projects p
        WHERE p.tenant_id = $1
          AND p.status = ANY($2::text[])
          AND p.${column} IS NOT NULL
          AND p.${column} <= $4::date${projectTeamSql}
      ),
      counts AS (
        SELECT COUNT(*) FILTER (WHERE s.${column} < $3::date)::int AS passed FROM scope s
      )
      SELECT c.passed, r.*
      FROM counts c
      LEFT JOIN LATERAL (
        SELECT p.id::text AS id,
               p.item_number,
               p.name,
               p.status,
               p.priority_score AS priority,
               p.planned_start::text AS planned_start,
               p.planned_end::text AS planned_end,
               p.execution_progress AS progress,
               ${userNameSql('itl')} AS it_lead_name,
               ${userNameSql('bl')} AS business_lead_name
        FROM scope p
        LEFT JOIN users itl ON itl.id = p.it_lead_id AND itl.tenant_id = p.tenant_id
        LEFT JOIN users bl ON bl.id = p.business_lead_id AND bl.tenant_id = p.tenant_id
        WHERE p.${column} BETWEEN $3::date AND $4::date
      ) r ON true
      ORDER BY r.${column} ASC NULLS LAST, r.item_number ASC
      `,
      params,
    )) as RawProjectRow[];

    const rows = raw
      .filter((row) => row.id != null)
      .map((row): UpcomingProjectRow => {
        const ref = refOf('PRJ', row.item_number);
        return {
          ref,
          itemPath: `/portfolio/projects/${ref || row.id}/summary`,
          name: row.name ?? '',
          status: row.status ?? '',
          priority: numOrNull(row.priority),
          plannedStart: row.planned_start ?? null,
          plannedEnd: row.planned_end ?? null,
          progress: numOrNull(row.progress),
          itLeadName: row.it_lead_name ?? null,
          businessLeadName: row.business_lead_name ?? null,
        };
      });
    return { passed: countPassed ? num(raw[0]?.passed) : 0, rows };
  }

  /** Requests awaiting review created at least the threshold ago (before `createdBefore`). */
  private async pendingRequests(
    manager: EntityManager,
    tenantId: string,
    createdBefore: string,
    filters: ProjectTeamFilters,
  ): Promise<UpcomingRequestRow[]> {
    const params: any[] = [tenantId, UPCOMING_AWAITING_REQUEST_STATUSES, createdBefore];
    const projectTeamSql = andPredicates(requestProjectTeamPredicates(params, 'r', filters));
    return this.requestRows(
      manager,
      `r.created_at::date < $3::date${projectTeamSql}`,
      'r.created_at ASC',
      params,
    );
  }

  /** Open requests whose requested delivery falls from today to the horizon. */
  private async requestDeliveries(
    manager: EntityManager,
    tenantId: string,
    asOf: string,
    until: string,
    filters: ProjectTeamFilters,
  ): Promise<UpcomingRequestRow[]> {
    const params: any[] = [tenantId, UPCOMING_OPEN_REQUEST_STATUSES, asOf, until];
    const projectTeamSql = andPredicates(requestProjectTeamPredicates(params, 'r', filters));
    return this.requestRows(
      manager,
      `r.target_delivery_date BETWEEN $3::date AND $4::date${projectTeamSql}`,
      'r.target_delivery_date ASC',
      params,
    );
  }

  /** `$1` is the tenant and `$2` the statuses; the caller brings its own date predicate. */
  private async requestRows(
    manager: EntityManager,
    predicateSql: string,
    orderSql: string,
    params: any[],
  ): Promise<UpcomingRequestRow[]> {
    const raw = (await manager.query(
      `
      SELECT r.id::text AS id,
             r.item_number,
             r.name,
             r.status,
             ps.name AS source_name,
             r.created_at::date::text AS created_on,
             r.target_delivery_date::text AS target_delivery_date,
             ${userNameSql('rq')} AS requestor_name
      FROM portfolio_requests r
      LEFT JOIN portfolio_sources ps ON ps.id = r.source_id AND ps.tenant_id = r.tenant_id
      LEFT JOIN users rq ON rq.id = r.requestor_id AND rq.tenant_id = r.tenant_id
      WHERE r.tenant_id = $1
        AND r.status = ANY($2::text[])
        AND ${predicateSql}
      ORDER BY ${orderSql}, r.item_number ASC
      `,
      params,
    )) as RawRequestRow[];

    return raw.map((row) => {
      const ref = refOf('REQ', row.item_number);
      return {
        ref,
        itemPath: `/portfolio/requests/${ref || row.id}/summary`,
        name: row.name ?? '',
        status: row.status,
        sourceName: row.source_name ?? null,
        createdOn: row.created_on ?? null,
        targetDeliveryDate: row.target_delivery_date ?? null,
        requestorName: row.requestor_name ?? null,
      };
    });
  }
}
