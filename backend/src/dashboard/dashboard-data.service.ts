import { Injectable } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import {
  ParticipationAccessScope,
  projectParticipantCondition,
  taskParticipantCondition,
} from '../auth/business-contributor-scope';

interface ServiceOptions {
  manager?: EntityManager;
  /** Present for business contributors: restrict to projects/tasks they take part in (same rule as the lists). */
  accessScope?: ParticipationAccessScope;
}

export interface MyLeadershipProject {
  id: string;
  name: string;
  status: string;
  role: 'it_lead' | 'business_lead' | 'it_sponsor' | 'business_sponsor';
  planned_end: string | null;
  next_milestone: {
    id: string;
    name: string;
    target_date: string | null;
  } | null;
}

export interface MyContributionProject {
  id: string;
  name: string;
  status: string;
  team: 'it_team' | 'business_team';
  my_tasks_count: number;
}

export interface TimeSummary {
  totalHours: number;
  byProject: Array<{
    projectId: string;
    projectName: string;
    hours: number;
  }>;
  byCategory: {
    it: number;
    business: number;
  };
  nonProjectTaskHours: number;
}

export interface TeamActivityItem {
  id: string;
  projectId: string;
  projectName: string;
  type: 'change' | 'comment' | 'decision';
  content: string | null;
  authorName: string;
  createdAt: string;
  changedFields: Record<string, [unknown, unknown]> | null;
}

export interface ProjectStatusChangeItem {
  id: string;
  projectId: string;
  projectName: string;
  previousStatus: string | null;
  nextStatus: string | null;
  authorName: string;
  createdAt: string;
}

export interface StaleTaskItem {
  id: string;
  itemNumber: number;
  title: string;
  status: string;
  updatedAt: string;
  staleDays: number;
  assigneeName: string | null;
  relatedObjectType: string | null;
  relatedObjectId: string | null;
  relatedObjectName: string | null;
}

export interface KnowledgeReviewItem {
  id: string;
  itemNumber: number;
  title: string;
  status: string;
  stage: 'reviewer' | 'approver';
  requestedAt: string;
  requestedByName: string | null;
}

@Injectable()
export class DashboardDataService {
  /**
   * Get projects where the user is a lead or sponsor
   */
  async getMyLeadershipProjects(
    userId: string,
    limit: number = 5,
    opts?: ServiceOptions,
  ): Promise<MyLeadershipProject[]> {
    const manager = opts?.manager;
    if (!manager) throw new Error('EntityManager required');

    // Query projects where user is in a leadership role
    const projects = await manager.query(
      `
      WITH leadership_projects AS (
        SELECT
          p.id,
          p.name,
          p.status,
          p.planned_end,
          CASE
            WHEN p.it_lead_id = $1 THEN 'it_lead'
            WHEN p.business_lead_id = $1 THEN 'business_lead'
            WHEN p.it_sponsor_id = $1 THEN 'it_sponsor'
            WHEN p.business_sponsor_id = $1 THEN 'business_sponsor'
          END as role
        FROM portfolio_projects p
        WHERE (
          p.it_lead_id = $1
          OR p.business_lead_id = $1
          OR p.it_sponsor_id = $1
          OR p.business_sponsor_id = $1
        )
        AND p.status NOT IN ('done', 'cancelled')
        ORDER BY p.name ASC
        LIMIT $2
      )
      SELECT
        lp.*,
        m.id as milestone_id,
        m.name as milestone_name,
        m.target_date as milestone_target_date
      FROM leadership_projects lp
      LEFT JOIN LATERAL (
        SELECT id, name, target_date
        FROM portfolio_project_milestones
        WHERE project_id = lp.id
          AND status NOT IN ('completed', 'cancelled')
        ORDER BY target_date ASC NULLS LAST
        LIMIT 1
      ) m ON true
      `,
      [userId, limit],
    );

    return projects.map((p: any) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      role: p.role,
      planned_end: p.planned_end,
      next_milestone: p.milestone_id
        ? {
            id: p.milestone_id,
            name: p.milestone_name,
            target_date: p.milestone_target_date,
          }
        : null,
    }));
  }

  /**
   * Get projects where the user is a team member but NOT a lead/sponsor
   */
  async getMyContributionProjects(
    userId: string,
    limit: number = 5,
    opts?: ServiceOptions,
  ): Promise<MyContributionProject[]> {
    const manager = opts?.manager;
    if (!manager) throw new Error('EntityManager required');

    const projects = await manager.query(
      `
      SELECT
        p.id,
        p.name,
        p.status,
        ppt.role as team,
        COALESCE(task_counts.count, 0)::int as my_tasks_count
      FROM portfolio_projects p
      JOIN portfolio_project_team ppt
        ON ppt.project_id = p.id
        AND ppt.user_id = $1
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int as count
        FROM tasks t
        WHERE t.related_object_type = 'project'
          AND t.related_object_id = p.id
          AND t.assignee_user_id = $1
          AND t.status NOT IN ('done', 'cancelled')
      ) task_counts ON true
      WHERE p.status NOT IN ('done', 'cancelled')
        AND p.it_lead_id IS DISTINCT FROM $1
        AND p.business_lead_id IS DISTINCT FROM $1
        AND p.it_sponsor_id IS DISTINCT FROM $1
        AND p.business_sponsor_id IS DISTINCT FROM $1
      ORDER BY p.name ASC
      LIMIT $2
      `,
      [userId, limit],
    );

    return projects.map((p: any) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      team: p.team,
      my_tasks_count: p.my_tasks_count,
    }));
  }

  /**
   * Get time summary for the user over the specified number of days
   */
  async getTimeSummary(
    userId: string,
    days: number = 7,
    opts?: ServiceOptions,
  ): Promise<TimeSummary> {
    const manager = opts?.manager;
    if (!manager) throw new Error('EntityManager required');

    // Query time entries from both task_time_entries and portfolio_project_time_entries
    const result = await manager.query(
      `
      WITH date_cutoff AS (
        -- Calendar window: today and the (N - 1) previous days, so "last 7 days" starts at a day boundary
        SELECT (CURRENT_DATE - (($2::int - 1) || ' days')::interval)::timestamptz as cutoff
      ),
      -- Task time entries with project association
      task_time AS (
        SELECT
          tte.hours::numeric as hours,
          tte.category,
          t.related_object_id as project_id,
          t.related_object_type
        FROM task_time_entries tte
        JOIN tasks t ON t.id = tte.task_id
        CROSS JOIN date_cutoff dc
        WHERE tte.user_id = $1
          AND tte.logged_at >= dc.cutoff
      ),
      -- Direct project time entries
      project_time AS (
        SELECT
          pte.hours::numeric as hours,
          pte.category,
          pte.project_id,
          'project' as related_object_type
        FROM portfolio_project_time_entries pte
        CROSS JOIN date_cutoff dc
        WHERE pte.user_id = $1
          AND pte.logged_at >= dc.cutoff
      ),
      -- Combined time entries
      all_time AS (
        SELECT * FROM task_time
        UNION ALL
        SELECT * FROM project_time
      ),
      -- Sum by project
      by_project AS (
        SELECT
          at.project_id,
          p.name as project_name,
          SUM(at.hours) as hours
        FROM all_time at
        JOIN portfolio_projects p ON p.id = at.project_id
        WHERE at.related_object_type = 'project'
        GROUP BY at.project_id, p.name
        ORDER BY hours DESC
      ),
      -- Sum by category
      by_category AS (
        SELECT
          SUM(CASE WHEN category = 'it' THEN hours ELSE 0 END) as it_hours,
          SUM(CASE WHEN category = 'business' THEN hours ELSE 0 END) as business_hours
        FROM all_time
      ),
      -- Non-project task hours
      non_project_hours AS (
        SELECT COALESCE(SUM(hours), 0) as hours
        FROM task_time
        WHERE related_object_type IS DISTINCT FROM 'project'
      ),
      -- Total hours
      total AS (
        SELECT COALESCE(SUM(hours), 0) as hours FROM all_time
      )
      SELECT
        t.hours as total_hours,
        bc.it_hours,
        bc.business_hours,
        np.hours as non_project_hours,
        COALESCE(
          (SELECT json_agg(json_build_object(
            'projectId', bp.project_id,
            'projectName', bp.project_name,
            'hours', bp.hours
          )) FROM by_project bp),
          '[]'::json
        ) as by_project
      FROM total t
      CROSS JOIN by_category bc
      CROSS JOIN non_project_hours np
      `,
      [userId, days],
    );

    const row = result[0] || {
      total_hours: 0,
      it_hours: 0,
      business_hours: 0,
      non_project_hours: 0,
      by_project: [],
    };

    return {
      totalHours: parseFloat(row.total_hours) || 0,
      byProject: row.by_project || [],
      byCategory: {
        it: parseFloat(row.it_hours) || 0,
        business: parseFloat(row.business_hours) || 0,
      },
      nonProjectTaskHours: parseFloat(row.non_project_hours) || 0,
    };
  }

  async getTeamActivity(
    userId: string,
    limit: number = 5,
    days: number = 7,
    opts?: ServiceOptions,
  ): Promise<TeamActivityItem[]> {
    const manager = opts?.manager;
    if (!manager) throw new Error('EntityManager required');

    const rows = await manager.query(
      `
      WITH involved_projects AS (
        SELECT p.id
        FROM portfolio_projects p
        WHERE p.status NOT IN ('done', 'cancelled')
          AND ${projectParticipantCondition('p', '$1')}
      )
      SELECT
        a.id,
        a.project_id,
        p.name AS project_name,
        a.type,
        a.content,
        a.changed_fields,
        a.created_at,
        COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, 'Someone') AS author_name
      FROM portfolio_activities a
      JOIN involved_projects ip ON ip.id = a.project_id
      JOIN portfolio_projects p ON p.id = a.project_id
      LEFT JOIN users u ON u.id = a.author_id AND u.tenant_id = p.tenant_id
      WHERE a.project_id IS NOT NULL
        AND a.created_at >= NOW() - ($3 || ' days')::interval
        AND (
          a.type IN ('comment', 'decision')
          OR (
            a.type = 'change'
            AND a.changed_fields IS NOT NULL
            AND a.changed_fields ?| ARRAY[
              'status',
              'phase_id',
              'execution_progress',
              'planned_start',
              'planned_end',
              'it_lead_id',
              'business_lead_id',
              'it_sponsor_id',
              'business_sponsor_id',
              'priority_score',
              'task_created'
            ]
          )
        )
      ORDER BY a.created_at DESC
      LIMIT $2
      `,
      [userId, limit, days],
    );

    return rows.map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      type: row.type,
      content: row.content || null,
      authorName: row.author_name || 'Someone',
      createdAt: row.created_at,
      changedFields: row.changed_fields || null,
    }));
  }

  async getProjectStatusChanges(
    days: number = 5,
    limit: number = 5,
    opts?: ServiceOptions,
  ): Promise<ProjectStatusChangeItem[]> {
    const manager = opts?.manager;
    if (!manager) throw new Error('EntityManager required');

    const params: unknown[] = [days, limit];
    let scopeSql = '';
    if (opts?.accessScope?.userId) {
      params.push(opts.accessScope.userId);
      scopeSql = `AND ${projectParticipantCondition('p', `$${params.length}`)}`;
    }

    const rows = await manager.query(
      `
      SELECT
        a.id,
        a.project_id,
        p.name AS project_name,
        a.changed_fields->'status'->>0 AS previous_status,
        a.changed_fields->'status'->>1 AS next_status,
        a.created_at,
        COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, 'Someone') AS author_name
      FROM portfolio_activities a
      JOIN portfolio_projects p ON p.id = a.project_id
      LEFT JOIN users u ON u.id = a.author_id AND u.tenant_id = p.tenant_id
      WHERE a.project_id IS NOT NULL
        AND a.type = 'change'
        AND a.changed_fields ? 'status'
        AND a.created_at >= NOW() - ($1 || ' days')::interval
        ${scopeSql}
      ORDER BY a.created_at DESC
      LIMIT $2
      `,
      params,
    );

    return rows.map((row: any) => ({
      id: row.id,
      projectId: row.project_id,
      projectName: row.project_name,
      previousStatus: row.previous_status || null,
      nextStatus: row.next_status || null,
      authorName: row.author_name || 'Someone',
      createdAt: row.created_at,
    }));
  }

  async getStaleTasks(
    userId: string,
    scope: 'my' | 'team' | 'all' = 'my',
    thresholdDays: number = 90,
    limit: number = 5,
    opts?: ServiceOptions,
  ): Promise<StaleTaskItem[]> {
    const manager = opts?.manager;
    if (!manager) throw new Error('EntityManager required');

    let scopeSql = '';
    const params: unknown[] = [thresholdDays];

    if (scope === 'my') {
      params.push(userId);
      scopeSql = `AND t.assignee_user_id = $${params.length}`;
    } else if (scope === 'team') {
      // Every team the user belongs to (a member can sit in several); rows without a team are ignored
      params.push(userId);
      scopeSql = `AND t.assignee_user_id IN (
        SELECT members.user_id
        FROM portfolio_team_member_configs members
        WHERE members.tenant_id = app_current_tenant()
          AND members.team_id IN (
            SELECT mine.team_id
            FROM portfolio_team_member_configs mine
            WHERE mine.user_id = $${params.length}
              AND mine.team_id IS NOT NULL
              AND mine.tenant_id = app_current_tenant()
          )
      )`;
    }

    if (opts?.accessScope?.userId) {
      params.push(opts.accessScope.userId);
      scopeSql += ` AND ${taskParticipantCondition('t', `$${params.length}`)}`;
    }

    params.push(limit);

    const rows = await manager.query(
      `
      SELECT
        t.id,
        t.item_number,
        t.title,
        t.status,
        t.updated_at,
        COALESCE(
          NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''),
          u.email
        ) AS assignee_name,
        t.related_object_type,
        t.related_object_id,
        CASE
          WHEN t.related_object_type IS NULL THEN NULL
          WHEN t.related_object_type = 'spend_item' THEN si.product_name
          WHEN t.related_object_type = 'contract' THEN c.name
          WHEN t.related_object_type = 'capex_item' THEN ci.product_name
          WHEN t.related_object_type = 'project' THEN pp.name
          WHEN t.related_object_type = 'incident' THEN CASE WHEN inc.confidential THEN 'INC-' || inc.item_number::text ELSE 'INC-' || inc.item_number::text || ' · ' || inc.title END
          ELSE NULL
        END AS related_object_name,
        GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NOW() - t.updated_at)) / 86400))::int AS stale_days
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex'
      LEFT JOIN contracts c ON t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id
      LEFT JOIN spend_items ci ON t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex'
      LEFT JOIN portfolio_projects pp ON t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id
      LEFT JOIN incidents inc ON t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id
      WHERE t.status NOT IN ('done', 'cancelled')
        AND t.updated_at < NOW() - ($1 || ' days')::interval
        ${scopeSql}
      ORDER BY t.updated_at ASC, t.created_at ASC
      LIMIT $${params.length}
      `,
      params,
    );

    return rows.map((row: any) => ({
      id: row.id,
      itemNumber: Number(row.item_number || 0),
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      staleDays: Number(row.stale_days || 0),
      assigneeName: row.assignee_name || null,
      relatedObjectType: row.related_object_type || null,
      relatedObjectId: row.related_object_id || null,
      relatedObjectName: row.related_object_name || null,
    }));
  }

  async getKnowledgeReviewItems(
    userId: string,
    limit: number = 5,
    opts?: ServiceOptions,
  ): Promise<KnowledgeReviewItem[]> {
    const manager = opts?.manager;
    if (!manager) throw new Error('EntityManager required');

    // Managed integrated documents (project purpose, incident review, …) never
    // enter the Knowledge review workflow — assertIntegratedDocumentWorkflowRequestAllowed
    // refuses it. The NOT EXISTS below is defence in depth so a binding created
    // after a workflow was opened cannot surface an incident review (and its
    // "INC-N - title" managed title) on someone else's dashboard.
    const rows = await manager.query(
      `
      SELECT
        d.id,
        d.item_number,
        d.title,
        d.status,
        CASE
          WHEN w.status = 'pending_review' THEN 'reviewer'
          WHEN w.status = 'pending_approval' THEN 'approver'
          ELSE p.stage
        END AS stage,
        w.requested_at,
        COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, w.requested_by::text) AS requested_by_name
      FROM document_workflow_participants p
      JOIN document_workflows w
        ON w.id = p.workflow_id
       AND w.tenant_id = p.tenant_id
      JOIN documents d
        ON d.id = w.document_id
       AND d.tenant_id = w.tenant_id
      LEFT JOIN users u
        ON u.id = w.requested_by
       AND u.tenant_id = w.tenant_id
      WHERE p.user_id = $1
        AND p.decision = 'pending'
        AND (
          (w.status = 'pending_review' AND p.stage = 'reviewer')
          OR (w.status = 'pending_approval' AND p.stage = 'approver')
        )
        AND NOT EXISTS (
          SELECT 1
          FROM integrated_document_bindings b
          WHERE b.document_id = d.id
            AND b.tenant_id = d.tenant_id
        )
      ORDER BY w.requested_at ASC, d.updated_at DESC
      LIMIT $2
      `,
      [userId, limit],
    );

    return rows.map((row: any) => ({
      id: row.id,
      itemNumber: Number(row.item_number || 0),
      title: row.title,
      status: row.status,
      stage: row.stage,
      requestedAt: row.requested_at,
      requestedByName: row.requested_by_name || null,
    }));
  }
}
