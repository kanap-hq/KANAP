import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import { ParticipationAccessScope, taskParticipantCondition } from '../auth/business-contributor-scope';
import { incidentRelatedLabelSql } from '../incidents/incident-visibility';
import { resolveRecordCreators } from '../audit/record-creator.util';
import { assertSetFilterModes } from '../common/ag-grid-filtering';

export interface TaskListItem {
  id: string;
  tenant_id: string;
  item_number: number;
  title: string | null;
  description: string;
  status: string;
  due_date: string | null;
  start_date: string | null;
  created_at: Date;
  updated_at: Date;
  assignee_user_id: string | null;
  assignee_name: string | null;
  related_object_type: string | null;
  related_object_id: string | null;
  related_object_name: string | null;
  // Task type (FK to portfolio_task_types)
  task_type_id: string | null;
  task_type_name: string | null;
  // Project-specific fields
  phase_id: string | null;
  phase_name: string | null;
  priority_level: string;
  priority_score: number;
  labels: string[];
  // Classification fields (stored directly on the task)
  source_id: string | null;
  source_name: string | null;
  category_id: string | null;
  category_name: string | null;
  stream_id: string | null;
  stream_name: string | null;
  company_id: string | null;
  company_name: string | null;
  creator_id: string | null;
  creator_name: string | null;
  /** Creation author resolved from the audit trail (detail reads only). */
  created_by_name?: string | null;
  owner_ids: string[];
  viewer_ids: string[];
  application_ids: string[];
  asset_ids: string[];
  applications?: Array<{ id: string; name: string | null; sequential_id?: string | null }>;
  assets?: Array<{ id: string; name: string | null; asset_reference?: string | null; hostname?: string | null }>;
  converted_request_id?: string | null;
  converted_request_item_number?: number | null;
}

function parsePagination(query: any) {
  const page = parseInt(query.page as string, 10) || 1;
  const limit = parseInt(query.limit as string, 10) || 50;
  const skip = (page - 1) * limit;
  const sortRaw = (query.sort as string) || 'created_at:DESC';
  const [field, direction] = sortRaw.split(':');
  const sort = { field: field || 'created_at', direction: (direction?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC') as 'ASC' | 'DESC' };
  const q = (query.q as string) || '';
  let filters: AgFilterModel = {};
  if (query.filters) {
    if (typeof query.filters === 'string') {
      try {
        filters = JSON.parse(query.filters);
      } catch {
        filters = {};
      }
    } else if (typeof query.filters === 'object') {
      filters = query.filters;
    }
  }
  return { page, limit, skip, sort, q, filters };
}

type AgFilterModel = Record<string, any>;

function isSetFilter(model: any): model is { filterType: 'set'; values: any[] } {
  return !!model && model.filterType === 'set' && Array.isArray(model.values);
}

function isDateLikeFilter(model: any): boolean {
  return !!model && typeof model === 'object' && (model.filterType === 'date' || model.filterType === 'text');
}

/** The request's tenant for a task list: required, a list never runs without its tenant predicate. */
function requireListTenant(tenantId: string | undefined): string {
  const normalized = String(tenantId || '').trim();
  if (!normalized) throw new InternalServerErrorException('Task lists need a tenant.');
  return normalized;
}

function buildWhereConditions(
  query: any,
  rawFilters: any,
  q: string,
  skipField: string | undefined,
  tenantId: string,
  accessScope?: ParticipationAccessScope,
) {
  const params: any[] = [requireListTenant(tenantId)];
  const tenantParamRef = '$1';
  // Every condition below is appended as ` AND <atom>` or ` AND (<...>)`, so none widens this one.
  let whereConditions = `t.tenant_id = ${tenantParamRef}`;
  const filters: AgFilterModel = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
  assertSetFilterModes(filters);

  const shouldSkip = (field: string) => field === skipField;

  if (accessScope?.userId) {
    params.push(accessScope.userId);
    whereConditions += ` AND ${taskParticipantCondition('t', `$${params.length}`)}`;
  }

  const applySetFilter = (model: any, expression: string) => {
    if (!isSetFilter(model)) return false;
    if (model.values.length === 0) {
      whereConditions += ' AND 1=0';
      return true;
    }
    const nonNullValues = model.values.filter((value: any) => value !== null && value !== undefined);
    const hasNull = model.values.some((value: any) => value === null || value === undefined);
    const clauses: string[] = [];
    if (nonNullValues.length > 0) {
      const placeholders = nonNullValues.map((value: any) => {
        params.push(value);
        return `$${params.length}`;
      });
      clauses.push(`${expression} IN (${placeholders.join(', ')})`);
    }
    if (hasNull) clauses.push(`${expression} IS NULL`);
    if (clauses.length > 0) {
      whereConditions += ` AND (${clauses.join(' OR ')})`;
    }
    return true;
  };

  const applyDateFilter = (model: any, expression: string) => {
    if (!isDateLikeFilter(model)) return false;
    const type = String(model.type || 'equals');
    const fromRaw = model.dateFrom ?? model.filter ?? model.value;
    const toRaw = model.dateTo ?? model.filterTo ?? model.valueTo;

    if (type === 'blank') {
      whereConditions += ` AND ${expression} IS NULL`;
      return true;
    }
    if (type === 'notBlank') {
      whereConditions += ` AND ${expression} IS NOT NULL`;
      return true;
    }

    const pushDateParam = (value: any) => {
      params.push(value);
      return `$${params.length}::date`;
    };

    if (type === 'inRange') {
      if (!fromRaw || !toRaw) return false;
      const fromParam = pushDateParam(fromRaw);
      const toParam = pushDateParam(toRaw);
      whereConditions += ` AND ${expression} BETWEEN ${fromParam} AND ${toParam}`;
      return true;
    }

    if (!fromRaw) return false;
    const param = pushDateParam(fromRaw);
    switch (type) {
      case 'equals':
        whereConditions += ` AND ${expression} = ${param}`;
        return true;
      case 'notEqual':
        whereConditions += ` AND ${expression} <> ${param}`;
        return true;
      case 'lessThan':
        whereConditions += ` AND ${expression} < ${param}`;
        return true;
      case 'lessThanOrEqual':
        whereConditions += ` AND ${expression} <= ${param}`;
        return true;
      case 'greaterThan':
        whereConditions += ` AND ${expression} > ${param}`;
        return true;
      case 'greaterThanOrEqual':
        whereConditions += ` AND ${expression} >= ${param}`;
        return true;
      default:
        return false;
    }
  };

  const normalizeMultiValue = (value: any): string[] => {
    const values = Array.isArray(value) ? value : String(value || '').split(',');
    return values.map((item) => String(item || '').trim()).filter(Boolean);
  };

  const applyRelationIdFilter = (
    value: any,
    table: 'task_applications' | 'task_assets',
    column: 'application_id' | 'asset_id',
  ) => {
    const ids = normalizeMultiValue(value);
    if (ids.length === 0) return;
    const placeholders = ids.map((id) => {
      params.push(id);
      return `$${params.length}::uuid`;
    });
    whereConditions += ` AND EXISTS (
      SELECT 1
      FROM ${table} rel
      WHERE rel.task_id = t.id
        AND rel.tenant_id = t.tenant_id
        AND rel.${column} IN (${placeholders.join(', ')})
    )`;
  };

  const applyRelationNameFilter = (
    model: any,
    table: 'task_applications' | 'task_assets',
    column: 'application_id' | 'asset_id',
    targetTable: 'applications' | 'assets',
    nameColumn: 'name',
  ) => {
    if (isSetFilter(model)) {
      if (model.values.length === 0) {
        whereConditions += ' AND 1=0';
        return true;
      }
      const values = model.values.map((value: any) => String(value || '').trim()).filter(Boolean);
      if (values.length === 0) return true;
      params.push(values);
      whereConditions += ` AND EXISTS (
        SELECT 1
        FROM ${table} rel
        JOIN ${targetTable} target ON target.id = rel.${column} AND target.tenant_id = rel.tenant_id
        WHERE rel.task_id = t.id
          AND rel.tenant_id = t.tenant_id
          AND target.${nameColumn} = ANY($${params.length}::text[])
      )`;
      return true;
    }
    if (model?.filter) {
      params.push(`%${model.filter}%`);
      whereConditions += ` AND EXISTS (
        SELECT 1
        FROM ${table} rel
        JOIN ${targetTable} target ON target.id = rel.${column} AND target.tenant_id = rel.tenant_id
        WHERE rel.task_id = t.id
          AND rel.tenant_id = t.tenant_id
          AND target.${nameColumn} ILIKE $${params.length}
      )`;
      return true;
    }
    return false;
  };

  // Apply scope filters (assigneeUserId, involvedUserId or teamId)
  if (query.assigneeUserId) {
    params.push(query.assigneeUserId);
    whereConditions += ` AND t.assignee_user_id = $${params.length}`;
  }

  // "My tasks": assigned to me or requested by me (mirrors the involvement
  // scope of "My requests" / "My projects"; viewers are deliberately excluded)
  if (query.involvedUserId) {
    params.push(query.involvedUserId);
    whereConditions += ` AND (t.assignee_user_id = $${params.length} OR t.creator_id = $${params.length})`;
  }

  if (query.teamId) {
    params.push(query.teamId);
    whereConditions += ` AND t.assignee_user_id IN (
      SELECT user_id FROM portfolio_team_member_configs WHERE team_id = $${params.length} AND tenant_id = ${tenantParamRef}
    )`;
  }

  if (query.applicationId) {
    applyRelationIdFilter(query.applicationId, 'task_applications', 'application_id');
  }

  if (query.assetId) {
    applyRelationIdFilter(query.assetId, 'task_assets', 'asset_id');
  }

  // Apply filters from AG Grid
  if (!shouldSkip('status') && filters.status) {
    if (!applySetFilter(filters.status, 't.status') && filters.status?.filter) {
      const filterType = filters.status.type || 'contains';
      if (filterType === 'equals') {
        params.push(filters.status.filter);
        whereConditions += ` AND t.status = $${params.length}`;
      } else if (filterType === 'notEqual') {
        params.push(filters.status.filter);
        whereConditions += ` AND t.status != $${params.length}`;
      } else if (filterType === 'notContains') {
        params.push(`%${filters.status.filter}%`);
        whereConditions += ` AND t.status NOT ILIKE $${params.length}`;
      } else {
        // contains (default)
        params.push(`%${filters.status.filter}%`);
        whereConditions += ` AND t.status ILIKE $${params.length}`;
      }
    }
  }

  if (!shouldSkip('title') && filters.title?.filter) {
    params.push(`%${filters.title.filter}%`);
    whereConditions += ` AND t.title ILIKE $${params.length}`;
  }

  if (!shouldSkip('related_object_name') && filters.related_object_name?.filter) {
    params.push(`%${filters.related_object_name.filter}%`);
    whereConditions += ` AND (
      (t.related_object_type = 'spend_item' AND si.product_name ILIKE $${params.length}) OR
      (t.related_object_type = 'contract' AND c.name ILIKE $${params.length}) OR
      (t.related_object_type = 'project' AND pp.name ILIKE $${params.length}) OR
      (t.related_object_type = 'incident' AND ${incidentRelatedLabelSql('inc')} ILIKE $${params.length})
    )`;
  }

  if (!shouldSkip('task_type_name') && filters.task_type_name) {
    if (!applySetFilter(filters.task_type_name, 'tt.name') && filters.task_type_name?.filter) {
      const filterType = filters.task_type_name.type || 'contains';
      if (filterType === 'equals') {
        params.push(filters.task_type_name.filter);
        whereConditions += ` AND tt.name = $${params.length}`;
      } else if (filterType === 'notEqual') {
        params.push(filters.task_type_name.filter);
        whereConditions += ` AND tt.name != $${params.length}`;
      } else if (filterType === 'notContains') {
        params.push(`%${filters.task_type_name.filter}%`);
        whereConditions += ` AND tt.name NOT ILIKE $${params.length}`;
      } else {
        params.push(`%${filters.task_type_name.filter}%`);
        whereConditions += ` AND tt.name ILIKE $${params.length}`;
      }
    }
  }

  if (!shouldSkip('related_object_type') && filters.related_object_type) {
    if (!applySetFilter(filters.related_object_type, 't.related_object_type') && filters.related_object_type?.filter) {
      const filterType = filters.related_object_type.type || 'contains';
      if (filterType === 'equals') {
        params.push(filters.related_object_type.filter);
        whereConditions += ` AND t.related_object_type = $${params.length}`;
      } else if (filterType === 'notEqual') {
        params.push(filters.related_object_type.filter);
        whereConditions += ` AND t.related_object_type != $${params.length}`;
      } else if (filterType === 'notContains') {
        params.push(`%${filters.related_object_type.filter}%`);
        whereConditions += ` AND t.related_object_type NOT ILIKE $${params.length}`;
      } else {
        params.push(`%${filters.related_object_type.filter}%`);
        whereConditions += ` AND t.related_object_type ILIKE $${params.length}`;
      }
    }
  }

  if (!shouldSkip('phase_name') && filters.phase_name) {
    if (!applySetFilter(filters.phase_name, 'phase.name') && filters.phase_name?.filter) {
      params.push(`%${filters.phase_name.filter}%`);
      whereConditions += ` AND phase.name ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('source_name') && filters.source_name) {
    if (!applySetFilter(filters.source_name, 'ps.name') && filters.source_name?.filter) {
      params.push(`%${filters.source_name.filter}%`);
      whereConditions += ` AND ps.name ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('due_date') && filters.due_date) {
    applyDateFilter(filters.due_date, 't.due_date');
  }

  // The creation day, not the instant: the grid sends plain days, and the portfolio reports
  // link to age brackets counted in whole days.
  if (!shouldSkip('created_at') && filters.created_at) {
    applyDateFilter(filters.created_at, 't.created_at::date');
  }

  // The day of the last change, not the instant, for the same reason: the portfolio reports
  // link to tasks that have not moved since a given day.
  if (!shouldSkip('updated_at') && filters.updated_at) {
    applyDateFilter(filters.updated_at, 't.updated_at::date');
  }

  // The assignee by id rather than by name: the reports group people by account, and two
  // people can carry the same display name. An empty value asks for the unassigned tasks.
  if (!shouldSkip('assignee_user_id') && filters.assignee_user_id) {
    applySetFilter(filters.assignee_user_id, 't.assignee_user_id');
  }

  // The project a task hangs off, by id: the portfolio reports narrowed to projects link with
  // it, alongside `related_object_type = project`.
  if (!shouldSkip('related_object_id') && filters.related_object_id) {
    applySetFilter(filters.related_object_id, 't.related_object_id');
  }

  // The team of the assignee, by id, for the portfolio reports narrowed to teams. A person
  // belongs to one team at most, and an unassigned task belongs to none: it never matches.
  if (!shouldSkip('assignee_team_id') && isSetFilter(filters.assignee_team_id)) {
    const teamIds = filters.assignee_team_id.values
      .map((value: any) => String(value ?? '').trim())
      .filter(Boolean);
    if (teamIds.length === 0) {
      whereConditions += ' AND 1=0';
    } else {
      params.push(teamIds);
      whereConditions += ` AND t.assignee_user_id IN (
      SELECT user_id FROM portfolio_team_member_configs
      WHERE team_id::text = ANY($${params.length}::text[]) AND tenant_id = ${tenantParamRef}
    )`;
    }
  }

  if (!shouldSkip('labels') && filters.labels?.filter) {
    params.push(`%${filters.labels.filter}%`);
    whereConditions += ` AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements_text(t.labels) AS lbl(value)
      WHERE lbl.value ILIKE $${params.length}
    )`;
  }

  if (!shouldSkip('category_name') && filters.category_name) {
    if (!applySetFilter(filters.category_name, 'pc.name') && filters.category_name?.filter) {
      params.push(`%${filters.category_name.filter}%`);
      whereConditions += ` AND pc.name ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('stream_name') && filters.stream_name) {
    if (!applySetFilter(filters.stream_name, 'pst.name') && filters.stream_name?.filter) {
      params.push(`%${filters.stream_name.filter}%`);
      whereConditions += ` AND pst.name ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('company_name') && filters.company_name) {
    if (!applySetFilter(filters.company_name, 'comp.name') && filters.company_name?.filter) {
      params.push(`%${filters.company_name.filter}%`);
      whereConditions += ` AND comp.name ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('priority_level') && filters.priority_level) {
    if (!applySetFilter(filters.priority_level, 't.priority_level') && filters.priority_level?.filter) {
      const filterType = filters.priority_level.type || 'equals';
      if (filterType === 'equals') {
        params.push(filters.priority_level.filter);
        whereConditions += ` AND t.priority_level = $${params.length}`;
      } else {
        params.push(`%${filters.priority_level.filter}%`);
        whereConditions += ` AND t.priority_level ILIKE $${params.length}`;
      }
    }
  }

  if (!shouldSkip('assignee_name') && filters.assignee_name) {
    if (!applySetFilter(filters.assignee_name, `COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)`) && filters.assignee_name?.filter) {
      params.push(`%${filters.assignee_name.filter}%`);
      whereConditions += ` AND (u.first_name ILIKE $${params.length} OR u.last_name ILIKE $${params.length} OR u.email ILIKE $${params.length})`;
    }
  }

  if (!shouldSkip('creator_name') && filters.creator_name) {
    if (!applySetFilter(filters.creator_name, `COALESCE(NULLIF(TRIM(CONCAT(uc.first_name, ' ', uc.last_name)), ''), uc.email)`) && filters.creator_name?.filter) {
      params.push(`%${filters.creator_name.filter}%`);
      whereConditions += ` AND (uc.first_name ILIKE $${params.length} OR uc.last_name ILIKE $${params.length} OR uc.email ILIKE $${params.length})`;
    }
  }

  if (!shouldSkip('project_name') && filters.project_name?.filter) {
    params.push(`%${filters.project_name.filter}%`);
    whereConditions += ` AND pp.name ILIKE $${params.length}`;
  }

  if (!shouldSkip('project_stream_name') && filters.project_stream_name) {
    if (!applySetFilter(filters.project_stream_name, 'project_pst.name') && filters.project_stream_name?.filter) {
      params.push(`%${filters.project_stream_name.filter}%`);
      whereConditions += ` AND project_pst.name ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('project_category_name') && filters.project_category_name) {
    if (!applySetFilter(filters.project_category_name, 'project_pc.name') && filters.project_category_name?.filter) {
      params.push(`%${filters.project_category_name.filter}%`);
      whereConditions += ` AND project_pc.name ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('application_name') && filters.application_name) {
    applyRelationNameFilter(filters.application_name, 'task_applications', 'application_id', 'applications', 'name');
  }

  if (!shouldSkip('asset_name') && filters.asset_name) {
    applyRelationNameFilter(filters.asset_name, 'task_assets', 'asset_id', 'assets', 'name');
  }

  if (!shouldSkip('description') && filters.description?.filter) {
    params.push(`%${filters.description.filter}%`);
    whereConditions += ` AND t.description ILIKE $${params.length}`;
  }

  // Apply quick search across multiple fields
  if (q) {
    // Check if query matches item ref pattern (T-123 or plain number)
    const refMatch = q.match(/^(?:T-)?(\d+)$/i);
    if (refMatch) {
      params.push(parseInt(refMatch[1], 10));
      params.push(`%${q}%`);
      whereConditions += ` AND (
        t.item_number = $${params.length - 1} OR
        t.title ILIKE $${params.length} OR
        t.description ILIKE $${params.length} OR
        si.product_name ILIKE $${params.length} OR
        c.name ILIKE $${params.length} OR
        pp.name ILIKE $${params.length} OR
        u.first_name ILIKE $${params.length} OR
        u.last_name ILIKE $${params.length} OR
        u.email ILIKE $${params.length} OR
        uc.first_name ILIKE $${params.length} OR
        uc.last_name ILIKE $${params.length} OR
        uc.email ILIKE $${params.length}
      )`;
    } else {
      params.push(`%${q}%`);
      whereConditions += ` AND (
        t.title ILIKE $${params.length} OR
        t.description ILIKE $${params.length} OR
        si.product_name ILIKE $${params.length} OR
        c.name ILIKE $${params.length} OR
        pp.name ILIKE $${params.length} OR
        u.first_name ILIKE $${params.length} OR
        u.last_name ILIKE $${params.length} OR
        u.email ILIKE $${params.length} OR
        uc.first_name ILIKE $${params.length} OR
        uc.last_name ILIKE $${params.length} OR
        uc.email ILIKE $${params.length}
      )`;
    }
  }

  return { whereConditions, params };
}

const TASK_FILTER_VALUE_FIELDS: Record<string, string> = {
  assignee_name: `COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)`,
  creator_name: `COALESCE(NULLIF(TRIM(CONCAT(uc.first_name, ' ', uc.last_name)), ''), uc.email)`,
  task_type_name: 'tt.name',
  status: 't.status',
  priority_level: 't.priority_level',
  related_object_type: 't.related_object_type',
  source_name: 'ps.name',
  category_name: 'pc.name',
  stream_name: 'pst.name',
  company_name: 'comp.name',
  phase_name: 'phase.name',
  labels: 'labels',
  project_stream_name: 'project_pst.name',
  project_category_name: 'project_pc.name',
  application_name: 'application_name',
  asset_name: 'asset_name',
};

const TASK_APPLICATION_IDS_SQL = `
  COALESCE((
    SELECT jsonb_agg(app_link.application_id ORDER BY app.name ASC NULLS LAST, app_link.application_id)
    FROM task_applications app_link
    JOIN applications app ON app.id = app_link.application_id AND app.tenant_id = app_link.tenant_id
    WHERE app_link.task_id = t.id
      AND app_link.tenant_id = t.tenant_id
  ), '[]'::jsonb)`;

const TASK_ASSET_IDS_SQL = `
  COALESCE((
    SELECT jsonb_agg(asset_link.asset_id ORDER BY asset.name ASC NULLS LAST, asset_link.asset_id)
    FROM task_assets asset_link
    JOIN assets asset ON asset.id = asset_link.asset_id AND asset.tenant_id = asset_link.tenant_id
    WHERE asset_link.task_id = t.id
      AND asset_link.tenant_id = t.tenant_id
  ), '[]'::jsonb)`;

const TASK_APPLICATIONS_SQL = `
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', app.id,
      'name', app.name,
      'sequential_id', app.sequential_id
    ) ORDER BY app.name ASC NULLS LAST, app.id)
    FROM task_applications app_link
    JOIN applications app ON app.id = app_link.application_id AND app.tenant_id = app_link.tenant_id
    WHERE app_link.task_id = t.id
      AND app_link.tenant_id = t.tenant_id
  ), '[]'::jsonb)`;

const TASK_ASSETS_SQL = `
  COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'id', asset.id,
      'name', asset.name,
      'asset_reference', asset.asset_reference,
      'hostname', asset.hostname
    ) ORDER BY asset.name ASC NULLS LAST, asset.id)
    FROM task_assets asset_link
    JOIN assets asset ON asset.id = asset_link.asset_id AND asset.tenant_id = asset_link.tenant_id
    WHERE asset_link.task_id = t.id
      AND asset_link.tenant_id = t.tenant_id
  ), '[]'::jsonb)`;

@Injectable()
export class TasksService {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /** The request's tenant when the caller passes it, else the session tenant bound to the manager. */
  private async resolveTenantId(manager: EntityManager, tenantId?: string): Promise<string> {
    const explicit = String(tenantId || '').trim();
    if (explicit) return explicit;
    const rows: Array<{ tenant_id: string | null }> = await manager.query(`SELECT app_current_tenant() AS tenant_id`);
    const sessionTenant = rows?.[0]?.tenant_id;
    if (!sessionTenant) throw new InternalServerErrorException('Task reads need a tenant.');
    return sessionTenant;
  }

  async list(query: any, opts: { manager?: EntityManager; tenantId: string; accessScope?: ParticipationAccessScope }) {
    return this.listAllTasks(query, opts);
  }

  async listAllTasks(query: any, opts: { manager?: EntityManager; tenantId: string; accessScope?: ParticipationAccessScope }): Promise<{ items: TaskListItem[]; total: number; page: number; limit: number }> {
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = requireListTenant(opts?.tenantId);
    const { page, limit, skip, sort, q, filters } = parsePagination(query);
    const { whereConditions, params } = buildWhereConditions(query, filters, q, undefined, tenantId, opts?.accessScope);

    // Count total
    const countQuery = `
      SELECT COUNT(*)::int as count
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
      LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_requests pr_origin ON pr_origin.origin_task_id = t.id AND pr_origin.tenant_id = t.tenant_id
      LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
      LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
      -- Classification JOINs (COALESCE: task value wins, falls back to project)
      LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
      LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
      WHERE ${whereConditions}
    `;
    const countResult = await manager.query(countQuery, params);
    const total = countResult[0]?.count || 0;

    // Map sort field
    const sortFieldMap: Record<string, string> = {
      title: 't.title',
      description: 't.description',
      status: 't.status',
      created_at: 't.created_at',
      updated_at: 't.updated_at',
      due_date: 't.due_date',
      start_date: 't.start_date',
      assignee_name: 'assignee_name',
      creator_name: 'creator_name',
      related_object_name: 'related_object_name',
      related_object_type: 't.related_object_type',
      task_type_name: 'task_type_name',
      phase_name: 'phase_name',
      priority_level: 't.priority_level',
      priority_score: 'priority_score',
      source_name: 'source_name',
      category_name: 'category_name',
      stream_name: 'stream_name',
      company_name: 'company_name',
      project_stream_name: 'project_stream_name',
      project_category_name: 'project_category_name',
    };
    const sortField = sortFieldMap[sort.field] || 't.created_at';

    // Fetch paginated data
    const dataQuery = `
      SELECT
        t.id,
        t.tenant_id,
        t.item_number,
        t.title,
        t.description,
        t.status,
        t.due_date,
        t.start_date,
        t.created_at,
        t.updated_at,
        t.assignee_user_id,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) as assignee_name,
        COALESCE(uc.first_name || ' ' || uc.last_name, uc.email) as creator_name,
        t.related_object_type,
        t.related_object_id,
        CASE
          WHEN t.related_object_type IS NULL THEN NULL
          WHEN t.related_object_type = 'spend_item' THEN si.product_name
          WHEN t.related_object_type = 'contract' THEN c.name
          WHEN t.related_object_type = 'capex_item' THEN ci.description
          WHEN t.related_object_type = 'incident' THEN ${incidentRelatedLabelSql('inc')}
          WHEN t.related_object_type = 'project' THEN pp.name
          ELSE ''
        END as related_object_name,
        t.task_type_id,
        tt.name as task_type_name,
        t.phase_id,
        phase.name as phase_name,
        t.priority_level,
        CASE
          WHEN t.related_object_type = 'project' AND pp.priority_score IS NOT NULL THEN
            ROUND(LEAST(GREATEST(
              pp.priority_score +
              CASE t.priority_level
                WHEN 'blocker' THEN 10
                WHEN 'high' THEN 5
                WHEN 'normal' THEN 0
                WHEN 'low' THEN -5
                WHEN 'optional' THEN -10
                ELSE 0
              END, 0), 100))
          ELSE
            CASE t.priority_level
              WHEN 'blocker' THEN 110
              WHEN 'high' THEN 90
              WHEN 'normal' THEN 70
              WHEN 'low' THEN 50
              WHEN 'optional' THEN 30
              ELSE 70
            END
        END as priority_score,
        t.labels,
        pp.name as project_name,
        project_pst.name as project_stream_name,
        project_pc.name as project_category_name,
        -- Classification (task value wins, falls back to project)
        COALESCE(t.source_id, pp.source_id) as source_id,
        COALESCE(t.category_id, pp.category_id) as category_id,
        COALESCE(t.stream_id, pp.stream_id) as stream_id,
        COALESCE(t.company_id, pp.company_id) as company_id,
        -- Resolved classification names
        ps.name as source_name,
        pc.name as category_name,
        pst.name as stream_name,
        comp.name as company_name,
        t.creator_id,
        t.owner_ids,
        t.viewer_ids,
        ${TASK_APPLICATION_IDS_SQL} AS application_ids,
        ${TASK_ASSET_IDS_SQL} AS asset_ids,
        ${TASK_APPLICATIONS_SQL} AS applications,
        ${TASK_ASSETS_SQL} AS assets,
        pr_origin.id as converted_request_id,
        pr_origin.item_number as converted_request_item_number
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
      LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_requests pr_origin ON pr_origin.origin_task_id = t.id AND pr_origin.tenant_id = t.tenant_id
      LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
      LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
      -- Classification JOINs (COALESCE: task value wins, falls back to project)
      LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
      LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
      WHERE ${whereConditions}
      ORDER BY ${sortField} ${sort.direction}
      LIMIT ${limit} OFFSET ${skip}
    `;

    const items = await manager.query(dataQuery, params);

    return { items, total, page, limit };
  }

  async listIds(query: any, opts: { manager?: EntityManager; tenantId: string; accessScope?: ParticipationAccessScope }): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = requireListTenant(opts?.tenantId);
    const { sort, q, filters } = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 });
    const { whereConditions, params } = buildWhereConditions(query, filters, q, undefined, tenantId, opts?.accessScope);

    const sortFieldMap: Record<string, string> = {
      title: 't.title',
      description: 't.description',
      status: 't.status',
      created_at: 't.created_at',
      updated_at: 't.updated_at',
      due_date: 't.due_date',
      start_date: 't.start_date',
      // The ids query only projects id/item_number/priority_score, so sortable
      // display names must be spelled out as expressions, not output aliases.
      assignee_name: `COALESCE(u.first_name || ' ' || u.last_name, u.email)`,
      creator_name: `COALESCE(uc.first_name || ' ' || uc.last_name, uc.email)`,
      related_object_name: `CASE
          WHEN t.related_object_type IS NULL THEN NULL
          WHEN t.related_object_type = 'spend_item' THEN si.product_name
          WHEN t.related_object_type = 'contract' THEN c.name
          WHEN t.related_object_type = 'capex_item' THEN ci.description
          WHEN t.related_object_type = 'incident' THEN ${incidentRelatedLabelSql('inc')}
          WHEN t.related_object_type = 'project' THEN pp.name
          ELSE ''
        END`,
      related_object_type: 't.related_object_type',
      task_type_name: 'tt.name',
      phase_name: 'phase.name',
      priority_level: 't.priority_level',
      priority_score: 'priority_score',
      source_name: 'ps.name',
      category_name: 'pc.name',
      stream_name: 'pst.name',
      company_name: 'comp.name',
      project_stream_name: 'project_pst.name',
      project_category_name: 'project_pc.name',
    };
    const sortField = sortFieldMap[sort.field] || 't.created_at';
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
      LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
      LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
      LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
      LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
      WHERE ${whereConditions}
    `;
    const countRows: Array<{ total: number }> = await manager.query(countQuery, params);
    const total = Number(countRows[0]?.total) || 0;

    const idsQuery = `
      SELECT t.id,
        t.item_number,
        CASE
          WHEN t.related_object_type = 'project' AND pp.priority_score IS NOT NULL THEN
            ROUND(LEAST(GREATEST(
              pp.priority_score +
              CASE t.priority_level
                WHEN 'blocker' THEN 10
                WHEN 'high' THEN 5
                WHEN 'normal' THEN 0
                WHEN 'low' THEN -5
                WHEN 'optional' THEN -10
                ELSE 0
              END, 0), 100))
          ELSE
            CASE t.priority_level
              WHEN 'blocker' THEN 110
              WHEN 'high' THEN 90
              WHEN 'normal' THEN 70
              WHEN 'low' THEN 50
              WHEN 'optional' THEN 30
              ELSE 70
            END
        END as priority_score
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
      LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
      LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
      -- Classification JOINs (COALESCE: task value wins, falls back to project)
      LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
      LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
      WHERE ${whereConditions}
      ORDER BY ${sortField} ${sort.direction}
      LIMIT ${limit}
    `;
    const rows: Array<{ id: string; item_number: number | null }> = await manager.query(idsQuery, params);
    const ids = rows.map((r) => r.id);
    const refs = rows.map((r) => (r.item_number != null ? `T-${r.item_number}` : r.id));
    return { ids, refs, total };
  }

  async listFilterValues(query: any, opts: { manager?: EntityManager; tenantId: string; accessScope?: ParticipationAccessScope }): Promise<Record<string, Array<string | null>>> {
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = requireListTenant(opts?.tenantId);
    const q = (query.q as string) || '';
    let filters: AgFilterModel = {};
    if (query.filters) {
      if (typeof query.filters === 'string') {
        try {
          filters = JSON.parse(query.filters);
        } catch {
          filters = {};
        }
      } else if (typeof query.filters === 'object') {
        filters = query.filters;
      }
    }

    const rawFields = String(query.fields || query.field || '').split(',').map((f) => f.trim()).filter(Boolean);
    const fields = rawFields.filter((field) => Object.prototype.hasOwnProperty.call(TASK_FILTER_VALUE_FIELDS, field));
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | null>> = {};

    for (const field of fields) {
      const { whereConditions, params } = buildWhereConditions(query, filters, q, field, tenantId, opts?.accessScope);
      if (field === 'application_name' || field === 'asset_name') {
        const relation = field === 'application_name'
          ? { table: 'task_applications', column: 'application_id', target: 'applications' }
          : { table: 'task_assets', column: 'asset_id', target: 'assets' };
        const rows: Array<{ value: string | null }> = await manager.query(
          `
            SELECT DISTINCT target.name AS value
            FROM tasks t
            JOIN ${relation.table} rel ON rel.task_id = t.id AND rel.tenant_id = t.tenant_id
            JOIN ${relation.target} target ON target.id = rel.${relation.column} AND target.tenant_id = rel.tenant_id
            LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
            LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
            LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
            LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
            LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
            LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
            LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
            LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
            LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
            LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
            LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
            LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
            LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
            LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
            LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
            WHERE ${whereConditions}
            ORDER BY value ASC
          `,
          params,
        );
        results[field] = rows.map((row) => row.value);
        continue;
      }

      if (field === 'labels') {
        const labelRows: Array<{ value: string | null }> = await manager.query(
          `
            SELECT DISTINCT lbl.value AS value
            FROM tasks t
            LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
            LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
            LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
            LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
            LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
            LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
            LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
            LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
            LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
            LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
            LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
            LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
            LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
            LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
            LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
            CROSS JOIN LATERAL jsonb_array_elements_text(t.labels) AS lbl(value)
            WHERE ${whereConditions}
            ORDER BY value ASC
          `,
          params,
        );
        results[field] = labelRows.map((row) => row.value);
        continue;
      }

      const expression = TASK_FILTER_VALUE_FIELDS[field];
      const distinctQuery = `
        SELECT DISTINCT ${expression} as value
        FROM tasks t
        LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
        LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
        LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
        LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
        LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
        LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
        LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
        LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
        LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
        -- Classification JOINs (COALESCE: task value wins, falls back to project)
        LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
        LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
        LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
        LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
        LEFT JOIN portfolio_streams project_pst ON project_pst.id = pp.stream_id AND project_pst.tenant_id = t.tenant_id
        LEFT JOIN portfolio_categories project_pc ON project_pc.id = pp.category_id AND project_pc.tenant_id = t.tenant_id
        WHERE ${whereConditions}
        ORDER BY value ASC
      `;
      const rows: Array<{ value: string | null }> = await manager.query(distinctQuery, params);
      results[field] = rows.map((row) => row.value);
    }

    return results;
  }

  /** `tenantId`: the request's tenant; without it, the session tenant of the manager. */
  async getOne(id: string, opts?: { manager?: EntityManager; tenantId?: string; accessScope?: ParticipationAccessScope }): Promise<TaskListItem | null> {
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = await this.resolveTenantId(manager, opts?.tenantId);
    const params: any[] = [id, tenantId];
    let accessWhere = '';
    if (opts?.accessScope?.userId) {
      params.push(opts.accessScope.userId);
      accessWhere = ` AND ${taskParticipantCondition('t', `$${params.length}`)}`;
    }
    const dataQuery = `
      SELECT
        t.id,
        t.tenant_id,
        t.item_number,
        t.title,
        t.description,
        t.status,
        t.due_date,
        t.start_date,
        t.created_at,
        t.assignee_user_id,
        COALESCE(u.first_name || ' ' || u.last_name, u.email) as assignee_name,
        COALESCE(uc.first_name || ' ' || uc.last_name, uc.email) as creator_name,
        t.related_object_type,
        t.related_object_id,
        CASE
          WHEN t.related_object_type IS NULL THEN NULL
          WHEN t.related_object_type = 'spend_item' THEN si.product_name
          WHEN t.related_object_type = 'contract' THEN c.name
          WHEN t.related_object_type = 'capex_item' THEN ci.description
          WHEN t.related_object_type = 'incident' THEN ${incidentRelatedLabelSql('inc')}
          WHEN t.related_object_type = 'project' THEN pp.name
          ELSE ''
        END as related_object_name,
        t.task_type_id,
        tt.name as task_type_name,
        t.phase_id,
        phase.name as phase_name,
        t.priority_level,
        CASE
          WHEN t.related_object_type = 'project' AND pp.priority_score IS NOT NULL THEN
            ROUND(LEAST(GREATEST(
              pp.priority_score +
              CASE t.priority_level
                WHEN 'blocker' THEN 10
                WHEN 'high' THEN 5
                WHEN 'normal' THEN 0
                WHEN 'low' THEN -5
                WHEN 'optional' THEN -10
                ELSE 0
              END, 0), 100))
          ELSE
            CASE t.priority_level
              WHEN 'blocker' THEN 110
              WHEN 'high' THEN 90
              WHEN 'normal' THEN 70
              WHEN 'low' THEN 50
              WHEN 'optional' THEN 30
              ELSE 70
            END
        END as priority_score,
        t.labels,
        -- Classification (task value wins, falls back to project)
        COALESCE(t.source_id, pp.source_id) as source_id,
        COALESCE(t.category_id, pp.category_id) as category_id,
        COALESCE(t.stream_id, pp.stream_id) as stream_id,
        COALESCE(t.company_id, pp.company_id) as company_id,
        -- Resolved classification names
        ps.name as source_name,
        pc.name as category_name,
        pst.name as stream_name,
        comp.name as company_name,
        t.creator_id,
        t.owner_ids,
        t.viewer_ids,
        ${TASK_APPLICATION_IDS_SQL} AS application_ids,
        ${TASK_ASSET_IDS_SQL} AS asset_ids,
        ${TASK_APPLICATIONS_SQL} AS applications,
        ${TASK_ASSETS_SQL} AS assets,
        pr_origin.id as converted_request_id,
        pr_origin.item_number as converted_request_item_number
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN capex_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id)
      LEFT JOIN incidents inc ON (t.related_object_type = 'incident' AND t.related_object_id = inc.id AND inc.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_projects pp ON (t.related_object_type = 'project' AND t.related_object_id = pp.id AND pp.tenant_id = t.tenant_id)
      LEFT JOIN portfolio_requests pr_origin ON pr_origin.origin_task_id = t.id AND pr_origin.tenant_id = t.tenant_id
      LEFT JOIN portfolio_project_phases phase ON t.phase_id = phase.id AND phase.tenant_id = t.tenant_id
      LEFT JOIN portfolio_task_types tt ON t.task_type_id = tt.id AND tt.tenant_id = t.tenant_id
      -- Classification JOINs (COALESCE: task value wins, falls back to project)
      LEFT JOIN portfolio_sources ps ON COALESCE(t.source_id, pp.source_id) = ps.id AND ps.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories pc ON COALESCE(t.category_id, pp.category_id) = pc.id AND pc.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams pst ON COALESCE(t.stream_id, pp.stream_id) = pst.id AND pst.tenant_id = t.tenant_id
      LEFT JOIN companies comp ON COALESCE(t.company_id, pp.company_id) = comp.id AND comp.tenant_id = t.tenant_id
      WHERE t.id = $1
        AND t.tenant_id = $2
        ${accessWhere}
      LIMIT 1
    `;
    const rows: TaskListItem[] = await manager.query(dataQuery, params);
    const task = rows[0];
    if (!task) return null;

    // `creator_id` is the requestor (mutable, labelled "Requestor"), so the
    // creation author comes from the audit trail instead.
    const creators = await resolveRecordCreators(manager, 'tasks', [task.id]);
    task.created_by_name = creators.get(task.id) ?? null;

    return task;
  }

  /** `tenantId`: the request's tenant; without it, the session tenant of the manager. */
  async assertVisible(
    id: string,
    accessScope: ParticipationAccessScope | undefined,
    opts?: { manager?: EntityManager; tenantId?: string },
  ): Promise<void> {
    if (!accessScope) return;
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = await this.resolveTenantId(manager, opts?.tenantId);
    const rows = await manager.query(
      `SELECT 1
       FROM tasks t
       WHERE t.id = $1
         AND t.tenant_id = $3
         AND ${taskParticipantCondition('t', '$2')}
       LIMIT 1`,
      [id, accessScope.userId, tenantId],
    );
    if (rows.length === 0) throw new NotFoundException('Task not found');
  }
}
