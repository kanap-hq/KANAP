import { Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { MAX_EXPORT_LIMIT } from '../common/pagination';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import {
  ParticipationAccessScope,
  applicationParticipantCondition,
  projectParticipantCondition,
  taskParticipantCondition,
} from '../auth/business-contributor-scope';
import { idsInScope } from '../portfolio/portfolio-linked-reads';
import { IncidentViewer, incidentRelatedLabelSql, taskIncidentVisibilitySql } from '../incidents/incident-visibility';
import { textSortKey } from '../common/list-sort';
import { parseItemNumber } from '../common/parse-item-number';
import { resolveRecordCreators } from '../audit/record-creator.util';
import type { LinkedModule, LinkedReads } from '../common/relations/linked-reads';
import { assertSetFilterModes, bindPositional, compileAgFilterCondition, compileReferenceFilter, createParamNameGenerator, type CompiledCondition } from '../common/ag-grid-filtering';

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
  /**
   * Set (true) when the task names a budget line or a contract the person cannot read (data-scoped
   * access, spec §5.4 "Champ simple"): `related_object_name` is then the line's reference alone
   * (`BL-12`), or null for a contract, shown without a link. Absent otherwise.
   */
  related_object_hidden?: true;
  /**
   * The kind of hidden object, for the screen's label: `contract` shows "Contract outside your
   * access" without a link (a contract has no business reference); absent for a hidden line, whose
   * reference is its name.
   */
  related_object_hidden_kind?: 'contract';
  // Task type (FK to portfolio_task_types)
  task_type_id: string | null;
  task_type_name: string | null;
  /** The shipped type it started as (`task`, `bug`...), null for a tenant's own type. */
  task_type_code: string | null;
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
  /** Null, as `applications`, for a person who does not read applications (`withReadableTaskLinks`). */
  application_ids: string[] | null;
  /** Null, as `assets`, for a person who does not read the infrastructure. */
  asset_ids: string[] | null;
  applications?: Array<{ id: string; name: string | null; sequential_id?: string | null }> | null;
  assets?: Array<{ id: string; name: string | null; asset_reference?: string | null; hostname?: string | null }> | null;
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
  viewer?: IncidentViewer | null,
  linkedReads?: LinkedReads,
  linkedScopes?: TaskLinkedScopes,
) {
  // A search or a filter on the name of a linked record matches only in the modules the person
  // reads: the list does not show the others, and a match would tell which task links them.
  const readsModule = (module: LinkedModule) => !linkedReads || linkedReads[module];
  const params: any[] = [requireListTenant(tenantId)];
  // A Business Contributor's project and applications, inside their participation: the person's
  // id goes into the parameters only when a condition uses it.
  const userRefs = new Map<string, string>();
  const userRef = (userId: string) => {
    if (!userRefs.has(userId)) {
      params.push(userId);
      userRefs.set(userId, `$${params.length}`);
    }
    return userRefs.get(userId)!;
  };
  /** Whether the task's project (`pp`) shows: the projects module, then the participation. */
  const projectVisible = () => {
    if (!readsModule('projects')) return 'FALSE';
    return linkedScopes?.projects ? projectParticipantCondition('pp', userRef(linkedScopes.projects.userId)) : 'TRUE';
  };
  /** A value of the task's project (its name, its phase), null where the project does not show. */
  const projectField = (expression: string) => {
    const visible = projectVisible();
    return visible === 'TRUE' ? expression : `(CASE WHEN ${visible} THEN ${expression} END)`;
  };
  /** Whether a linked application (`alias`) shows to a Business Contributor. */
  const applicationVisible = (alias: string) => (linkedScopes?.applications
    ? applicationParticipantCondition(alias, userRef(linkedScopes.applications.userId))
    : 'TRUE');
  const tenantParamRef = '$1';
  // Every condition below is appended as ` AND <atom>` or ` AND (<...>)`, so none widens this one.
  let whereConditions = `t.tenant_id = ${tenantParamRef}`;
  // A task of an incident the reader cannot see does not exist for them (empty for incidents:admin).
  whereConditions += taskIncidentVisibilitySql('t', viewer, params);
  const filters: AgFilterModel = rawFilters && typeof rawFilters === 'object' ? rawFilters : {};
  assertSetFilterModes(filters);

  const shouldSkip = (field: string) => field === skipField;

  if (accessScope?.userId) {
    params.push(accessScope.userId);
    whereConditions += ` AND ${taskParticipantCondition('t', `$${params.length}`)}`;
  }

  // A condition of the shared compiler (`:name` parameters), appended with positional ones.
  const namedParam = createParamNameGenerator('task_filter_');
  const applyCompiled = (compiled: CompiledCondition | null) => {
    if (compiled) whereConditions += ` AND (${bindPositional(compiled, params)})`;
  };

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
    // A name matches only on the records the person sees: an application inside their participation.
    const targetVisible = (alias: string) => (targetTable === 'applications' ? applicationVisible(alias) : 'TRUE');
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
          AND ${targetVisible('target')}
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
          AND ${targetVisible('target')}
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
    const p = `$${params.length}`;
    const clauses = [
      // Both natures: the line join is `si` for an OPEX line and `ci` for a CAPEX line.
      readsModule('budget') && `(t.related_object_type IN ('spend_item', 'capex_item') AND COALESCE(si.product_name, ci.product_name) ILIKE ${p})`,
      readsModule('contracts') && `(t.related_object_type = 'contract' AND c.name ILIKE ${p})`,
      readsModule('projects') && `(t.related_object_type = 'project' AND ${projectField('pp.name')} ILIKE ${p})`,
      readsModule('incidents') && `(t.related_object_type = 'incident' AND ${incidentRelatedLabelSql('inc')} ILIKE ${p})`,
      readsModule('budget') && `(${TASK_HIDDEN_LINE_REFERENCE_SQL}) ILIKE ${p}`,
    ].filter(Boolean);
    whereConditions += clauses.length > 0 ? ` AND (\n      ${clauses.join(' OR\n      ')}\n    )` : ' AND 1=0';
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
    // The phase of a project the person does not see reads as empty, as on the task.
    const phaseName = projectField('phase.name');
    if (!applySetFilter(filters.phase_name, phaseName) && filters.phase_name?.filter) {
      params.push(`%${filters.phase_name.filter}%`);
      whereConditions += ` AND ${phaseName} ILIKE $${params.length}`;
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

  if (!shouldSkip('project_name') && filters.project_name?.filter && readsModule('projects')) {
    const projectName = projectField('pp.name');
    params.push(`%${filters.project_name.filter}%`);
    whereConditions += ` AND ${projectName} ILIKE $${params.length}`;
  }

  if (!shouldSkip('project_stream_name') && filters.project_stream_name) {
    const projectStream = projectField('project_pst.name');
    if (!applySetFilter(filters.project_stream_name, projectStream) && filters.project_stream_name?.filter) {
      params.push(`%${filters.project_stream_name.filter}%`);
      whereConditions += ` AND ${projectStream} ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('project_category_name') && filters.project_category_name) {
    const projectCategory = projectField('project_pc.name');
    if (!applySetFilter(filters.project_category_name, projectCategory) && filters.project_category_name?.filter) {
      params.push(`%${filters.project_category_name.filter}%`);
      whereConditions += ` AND ${projectCategory} ILIKE $${params.length}`;
    }
  }

  if (!shouldSkip('application_name') && filters.application_name && readsModule('applications')) {
    applyRelationNameFilter(filters.application_name, 'task_applications', 'application_id', 'applications', 'name');
  }

  if (!shouldSkip('asset_name') && filters.asset_name && readsModule('assets')) {
    applyRelationNameFilter(filters.asset_name, 'task_assets', 'asset_id', 'assets', 'name');
  }

  // The reference column shows `T-12`: its digits, with or without the prefix (`compileReferenceFilter`).
  if (!shouldSkip('item_number') && filters.item_number) {
    applyCompiled(compileReferenceFilter(filters.item_number, 't.item_number', 'T', namedParam));
  }

  if (!shouldSkip('priority_score') && filters.priority_score) {
    applyCompiled(compileAgFilterCondition(filters.priority_score, { expression: TASK_PRIORITY_SCORE_SQL, dataType: 'number' }, namedParam));
  }

  if (!shouldSkip('description') && filters.description?.filter) {
    params.push(`%${filters.description.filter}%`);
    whereConditions += ` AND t.description ILIKE $${params.length}`;
  }

  // The quick search on the name of the object a task belongs to, in the modules the person reads.
  // Apply quick search across multiple fields
  if (q) {
    // Resolved before the search's own parameters: the project's condition may add one.
    const searchedProjectName = readsModule('projects') ? projectField('pp.name') : null;
    const linkedNameSearch = (p: string) => [
      readsModule('budget') && `COALESCE(si.product_name, ci.product_name) ILIKE ${p} OR`,
      readsModule('contracts') && `c.name ILIKE ${p} OR`,
      searchedProjectName && `${searchedProjectName} ILIKE ${p} OR`,
    ].filter(Boolean).join(' ');
    // Check if query matches item ref pattern (T-123 or plain number)
    const refMatch = q.match(/^(?:T-)?(\d+)$/i);
    const itemNumber = refMatch ? parseItemNumber(refMatch[1]) : null;
    if (itemNumber != null) {
      params.push(itemNumber);
      params.push(`%${q}%`);
      whereConditions += ` AND (
        t.item_number = $${params.length - 1} OR
        t.title ILIKE $${params.length} OR
        t.description ILIKE $${params.length} OR
        ${linkedNameSearch(`$${params.length}`)}
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
        ${linkedNameSearch(`$${params.length}`)}
        u.first_name ILIKE $${params.length} OR
        u.last_name ILIKE $${params.length} OR
        u.email ILIKE $${params.length} OR
        uc.first_name ILIKE $${params.length} OR
        uc.last_name ILIKE $${params.length} OR
        uc.email ILIKE $${params.length}
      )`;
    }
  }

  return { whereConditions, params, projectField, applicationVisible };
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

/** A task's first linked application or asset by name: the sort key of the Applications and Assets columns. */
const TASK_FIRST_APPLICATION_NAME_SQL = `(
    SELECT MIN(app.name)
    FROM task_applications app_link
    JOIN applications app ON app.id = app_link.application_id AND app.tenant_id = app_link.tenant_id
    WHERE app_link.task_id = t.id
      AND app_link.tenant_id = t.tenant_id
  )`;

const TASK_FIRST_ASSET_NAME_SQL = `(
    SELECT MIN(asset.name)
    FROM task_assets asset_link
    JOIN assets asset ON asset.id = asset_link.asset_id AND asset.tenant_id = asset_link.tenant_id
    WHERE asset_link.task_id = t.id
      AND asset_link.tenant_id = t.tenant_id
  )`;

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

/**
 * The priority score of a task (`t`, its project `pp`): the project's score moved by the task's
 * priority level, within 0 and 100, or a score from the level alone. The lists project it and the
 * grid filters on it.
 */
const TASK_PRIORITY_SCORE_SQL = `CASE
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
END`;

/**
 * The reference of the budget line a task names when the line join found nothing: under a limited
 * access, a line the person cannot read (`data_access_reference`, SECURITY DEFINER, checks that the
 * task is visible). NULL for every other task, and for an unscoped person's task whose line exists.
 */
export const TASK_HIDDEN_LINE_REFERENCE_SQL = `CASE
          WHEN t.related_object_type IN ('spend_item', 'capex_item') AND t.related_object_id IS NOT NULL
               AND si.id IS NULL AND ci.id IS NULL
          THEN data_access_reference('task', t.id)
        END`;

/**
 * Whether a task names a contract the person cannot read (spec §5.4 "Champ simple"): the contract
 * join (`c`) is filtered by the contract policy, so under a limited access a null join on a
 * contract task is a hidden contract. An unscoped person's dangling contract task (none today)
 * keeps its old shape. The row shaping returns no id and no name, and the kind for the screen.
 */
export const TASK_HIDDEN_CONTRACT_SQL = `CASE
          WHEN t.related_object_type = 'contract' AND t.related_object_id IS NOT NULL AND c.id IS NULL
               AND (SELECT 1 WHERE current_setting('app.da_mode', true) = 'limited') IS NOT NULL
          THEN true ELSE false
        END`;

/**
 * The sort keys of the tasks list and of its ids, spelled out as expressions over the joins both
 * queries share (an output alias cannot take a collation). `priority_score` is the computed
 * column both queries project.
 */
/** Both stored budget line types are one family, so a sort on the context column groups them. */
const TASK_RELATED_FAMILY_SQL = `CASE WHEN t.related_object_type IN ('spend_item', 'capex_item') THEN 'budget_line' ELSE t.related_object_type END`;

const TASK_SORT_EXPRESSIONS: Record<string, string> = {
  title: 't.title',
  description: 't.description',
  status: 't.status',
  created_at: 't.created_at',
  updated_at: 't.updated_at',
  due_date: 't.due_date',
  start_date: 't.start_date',
  assignee_name: `COALESCE(u.first_name || ' ' || u.last_name, u.email)`,
  creator_name: `COALESCE(uc.first_name || ' ' || uc.last_name, uc.email)`,
  // A hidden line sorts by its reference (BL-n), the name the list shows.
  related_object_name: `COALESCE(${TASK_HIDDEN_LINE_REFERENCE_SQL}, CASE
      WHEN t.related_object_type IS NULL THEN NULL
      WHEN t.related_object_type = 'spend_item' THEN si.product_name
      WHEN t.related_object_type = 'contract' THEN c.name
      WHEN t.related_object_type = 'capex_item' THEN ci.product_name
      WHEN t.related_object_type = 'incident' THEN ${incidentRelatedLabelSql('inc')}
      WHEN t.related_object_type = 'project' THEN pp.name
      ELSE ''
    END)`,
  related_object_type: TASK_RELATED_FAMILY_SQL,
  // The family the assistant shows and groups by: the same key as the context column.
  related_family: TASK_RELATED_FAMILY_SQL,
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
  application_name: TASK_FIRST_APPLICATION_NAME_SQL,
  asset_name: TASK_FIRST_ASSET_NAME_SQL,
};
/** The task list columns that sort alphabetically (`textSortKey`). */
const TASK_TEXT_SORTS = new Set([
  'title', 'description', 'assignee_name', 'creator_name', 'related_object_name', 'task_type_name', 'phase_name',
  'source_name', 'category_name', 'stream_name', 'company_name', 'project_stream_name', 'project_category_name',
  'application_name', 'asset_name',
]);

/**
 * A row of the list or the detail: a hidden line shows as its reference (`related_object_hidden`),
 * without its id (as Plaid, MCP and the export); a hidden contract shows no name, no id, and its
 * kind (`contract`), so the screen can write "Contract outside your access" without a link.
 */
function withHiddenReference(row: TaskListItem & { related_object_reference?: string | null; related_object_contract_hidden?: boolean }): TaskListItem {
  const { related_object_reference: reference, related_object_contract_hidden: contractHidden, ...task } = row;
  if (contractHidden === true) {
    return { ...task, related_object_id: null, related_object_name: null, related_object_hidden: true, related_object_hidden_kind: 'contract' };
  }
  if (!reference) return task;
  return { ...task, related_object_id: null, related_object_name: reference, related_object_hidden: true };
}

/** The module that reads each kind of object a task belongs to. */
const TASK_RELATED_MODULES: Record<string, LinkedModule> = {
  project: 'projects',
  spend_item: 'budget',
  capex_item: 'budget',
  contract: 'contracts',
  incident: 'incidents',
};

/**
 * The records a Business Contributor sees inside their participation, by family (`idsInScope`).
 * A family left out has no participation limit.
 */
export type TaskVisibleLinks = {
  projects?: Set<string>;
  requests?: Set<string>;
  applications?: Set<string>;
};

/**
 * A task row without the linked records of the modules the person does not read, as on the
 * records' own pages: applications and assets are null (the field disappears from the screen), the
 * object the task belongs to loses its id and its name (`related_object_hidden`, without a kind:
 * the screen shows nothing in its place), and so do the project's name, phase and classification
 * and the converted request. A record outside a Business Contributor's participation (`visible`)
 * reads the same way; one application outside it hides the field, which a save would replace whole.
 * The task keeps its own type of object, so an edit of another field leaves the link untouched.
 */
export function withReadableTaskLinks<T extends Record<string, any>>(row: T, reads: LinkedReads, visible: TaskVisibleLinks = {}): T {
  const task: Record<string, any> = { ...row };
  const applicationIds: string[] = Array.isArray(task.application_ids) ? task.application_ids.map(String) : [];
  if (!reads.applications || (visible.applications && applicationIds.some((id) => !visible.applications!.has(id)))) {
    task.applications = null;
    task.application_ids = null;
  }
  if (!reads.assets) {
    task.assets = null;
    task.asset_ids = null;
  }
  const relatedType = String(task.related_object_type ?? '');
  const module = TASK_RELATED_MODULES[relatedType];
  const outsideParticipation = relatedType === 'project'
    && !!visible.projects
    && !!task.related_object_id
    && !visible.projects.has(String(task.related_object_id));
  const projectHidden = relatedType === 'project' && (!reads.projects || outsideParticipation);
  if (module && task.related_object_type && (!reads[module] || outsideParticipation)) {
    task.related_object_id = null;
    task.related_object_name = null;
    task.related_object_hidden = true;
    delete task.related_object_hidden_kind;
  }
  if ((!reads.projects || projectHidden) && 'project_name' in task) task.project_name = null;
  if (projectHidden) {
    for (const field of ['phase_name', 'project_stream_name', 'project_category_name']) {
      if (field in task) task[field] = null;
    }
  }
  const requestHidden = !reads.requests
    || (!!visible.requests && !!task.converted_request_id && !visible.requests.has(String(task.converted_request_id)));
  if (requestHidden) {
    if ('converted_request_id' in task) task.converted_request_id = null;
    if ('converted_request_item_number' in task) task.converted_request_item_number = null;
  }
  return task as T;
}

/**
 * The scopes of a Business Contributor's linked records: the projects, requests and applications
 * they take part in (`resolveBusinessContributorScope` on each module). None for everyone else.
 */
export type TaskLinkedScopes = {
  projects?: ParticipationAccessScope;
  requests?: ParticipationAccessScope;
  applications?: ParticipationAccessScope;
};

/** Task rows through `withReadableTaskLinks`, the participation of the page's records in one query per family. */
async function readableTaskRows<T extends Record<string, any>>(
  manager: EntityManager,
  rows: T[],
  reads: LinkedReads | undefined,
  scopes: TaskLinkedScopes | undefined,
): Promise<T[]> {
  if (!reads) return rows;
  const visible: TaskVisibleLinks = {};
  if (scopes?.projects && reads.projects) {
    const ids = rows.filter((row) => row.related_object_type === 'project').map((row) => row.related_object_id);
    visible.projects = await idsInScope(manager, 'projects', ids, scopes.projects);
  }
  if (scopes?.requests && reads.requests) {
    visible.requests = await idsInScope(manager, 'requests', rows.map((row) => row.converted_request_id), scopes.requests);
  }
  if (scopes?.applications && reads.applications) {
    const ids = rows.flatMap((row) => (Array.isArray(row.application_ids) ? row.application_ids.map(String) : []));
    visible.applications = await idsInScope(manager, 'applications', ids, scopes.applications);
  }
  return rows.map((row) => withReadableTaskLinks(row, reads, visible));
}

/** The filter-value fields that are values of the task's project: empty where the project does not show. */
const TASK_PROJECT_VALUE_FIELDS = new Set(['phase_name', 'project_stream_name', 'project_category_name']);

/** The filter-value fields that name another module's records, with that module. */
const TASK_LINKED_VALUE_FIELDS: Record<string, LinkedModule> = {
  application_name: 'applications',
  asset_name: 'assets',
};

/** The ORDER BY key of a task list field: text alphabetically, the creation date by default. */
async function taskSortKey(manager: EntityManager, field: string): Promise<string> {
  const expr = TASK_SORT_EXPRESSIONS[field] ?? 't.created_at';
  return TASK_TEXT_SORTS.has(field) ? (await textSortKey(manager))(expr) : expr;
}

/**
 * How a read of tasks is scoped. `linkedReads`: the modules the person reads; the rows then leave
 * out the linked records of the others (`withReadableTaskLinks`). The screen and the assistant pass it.
 */
export type TaskReadOptions = {
  manager?: EntityManager;
  tenantId: string;
  accessScope?: ParticipationAccessScope;
  viewer?: IncidentViewer | null;
  linkedReads?: LinkedReads;
  /** A Business Contributor's participation in the linked projects, requests and applications. */
  linkedScopes?: TaskLinkedScopes;
};

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

  async list(query: any, opts: TaskReadOptions) {
    return this.listAllTasks(query, opts);
  }

  async listAllTasks(query: any, opts: TaskReadOptions): Promise<{ items: TaskListItem[]; total: number; page: number; limit: number }> {
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = requireListTenant(opts?.tenantId);
    const { page, limit, skip, sort, q, filters } = parsePagination(query);
    const { whereConditions, params } = buildWhereConditions(query, filters, q, undefined, tenantId, opts?.accessScope, opts?.viewer, opts?.linkedReads, opts?.linkedScopes);

    // Count total
    const countQuery = `
      SELECT COUNT(*)::int as count
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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

    const sortField = await taskSortKey(manager, sort.field);

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
          WHEN t.related_object_type = 'capex_item' THEN ci.product_name
          WHEN t.related_object_type = 'incident' THEN ${incidentRelatedLabelSql('inc')}
          WHEN t.related_object_type = 'project' THEN pp.name
          ELSE ''
        END as related_object_name,
        ${TASK_HIDDEN_LINE_REFERENCE_SQL} AS related_object_reference,
        ${TASK_HIDDEN_CONTRACT_SQL} AS related_object_contract_hidden,
        t.task_type_id,
        tt.name as task_type_name,
        tt.code as task_type_code,
        t.phase_id,
        phase.name as phase_name,
        t.priority_level,
        ${TASK_PRIORITY_SCORE_SQL} as priority_score,
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
      LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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
      ORDER BY ${sortField} ${sort.direction}, t.id ASC
      LIMIT ${limit} OFFSET ${skip}
    `;

    const items: TaskListItem[] = await readableTaskRows(
      manager,
      (await manager.query(dataQuery, params)).map(withHiddenReference),
      opts?.linkedReads,
      opts?.linkedScopes,
    );

    return { items, total, page, limit };
  }

  async listIds(query: any, opts: TaskReadOptions): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = requireListTenant(opts?.tenantId);
    const { sort, q, filters } = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 });
    const { whereConditions, params } = buildWhereConditions(query, filters, q, undefined, tenantId, opts?.accessScope, opts?.viewer, opts?.linkedReads, opts?.linkedScopes);

    const sortField = await taskSortKey(manager, sort.field);
    // The navigation reads at most 10,000 ids; the export (`__export`, set by the server only: a query
    // string never carries a boolean) reads up to the export bound.
    const cap = query?.__export === true ? MAX_EXPORT_LIMIT : 10000;
    const limit = Math.min(Math.max(Number(query?.limit) || cap, 1), cap);

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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
        ${TASK_PRIORITY_SCORE_SQL} as priority_score
      FROM tasks t
      LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
      LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
      LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
      LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
      LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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
      ORDER BY ${sortField} ${sort.direction}, t.id ASC
      LIMIT ${limit}
    `;
    const rows: Array<{ id: string; item_number: number | null }> = await manager.query(idsQuery, params);
    const ids = rows.map((r) => r.id);
    const refs = rows.map((r) => (r.item_number != null ? `T-${r.item_number}` : r.id));
    return { ids, refs, total };
  }

  async listFilterValues(query: any, opts: TaskReadOptions): Promise<Record<string, Array<string | null>>> {
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
    const reads = opts?.linkedReads;
    // Names of another module's records only for a person who reads it.
    const fields = rawFields
      .filter((field) => Object.prototype.hasOwnProperty.call(TASK_FILTER_VALUE_FIELDS, field))
      .filter((field) => !reads || !TASK_LINKED_VALUE_FIELDS[field] || reads[TASK_LINKED_VALUE_FIELDS[field]]);
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | null>> = {};

    for (const field of fields) {
      const { whereConditions, params, projectField, applicationVisible } = buildWhereConditions(query, filters, q, field, tenantId, opts?.accessScope, opts?.viewer, opts?.linkedReads, opts?.linkedScopes);
      if (field === 'application_name' || field === 'asset_name') {
        const relation = field === 'application_name'
          ? { table: 'task_applications', column: 'application_id', target: 'applications' }
          : { table: 'task_assets', column: 'asset_id', target: 'assets' };
        // A Business Contributor's application names, inside their participation.
        const targetVisible = field === 'application_name' ? applicationVisible('target') : 'TRUE';
        const rows: Array<{ value: string | null }> = await manager.query(
          `
            SELECT DISTINCT target.name AS value
            FROM tasks t
            JOIN ${relation.table} rel ON rel.task_id = t.id AND rel.tenant_id = t.tenant_id
            JOIN ${relation.target} target ON target.id = rel.${relation.column} AND target.tenant_id = rel.tenant_id AND ${targetVisible}
            LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
            LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
            LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
            LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
            LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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
            LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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

      // The project's own values (phase, classification) only where the project shows.
      const expression = TASK_PROJECT_VALUE_FIELDS.has(field)
        ? projectField(TASK_FILTER_VALUE_FIELDS[field])
        : TASK_FILTER_VALUE_FIELDS[field];
      const distinctQuery = `
        SELECT DISTINCT ${expression} as value
        FROM tasks t
        LEFT JOIN users u ON t.assignee_user_id = u.id AND u.tenant_id = t.tenant_id
        LEFT JOIN users uc ON t.creator_id = uc.id AND uc.tenant_id = t.tenant_id
        LEFT JOIN spend_items si ON (t.related_object_type = 'spend_item' AND t.related_object_id = si.id AND si.tenant_id = t.tenant_id AND si.nature = 'opex')
        LEFT JOIN contracts c ON (t.related_object_type = 'contract' AND t.related_object_id = c.id AND c.tenant_id = t.tenant_id)
        LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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
  async getOne(id: string, opts?: Partial<TaskReadOptions>): Promise<TaskListItem | null> {
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = await this.resolveTenantId(manager, opts?.tenantId);
    const params: any[] = [id, tenantId];
    let accessWhere = '';
    if (opts?.accessScope?.userId) {
      params.push(opts.accessScope.userId);
      accessWhere = ` AND ${taskParticipantCondition('t', `$${params.length}`)}`;
    }
    // The detail answers like a missing task for a task of an incident the reader cannot see.
    accessWhere += taskIncidentVisibilitySql('t', opts?.viewer, params);
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
          WHEN t.related_object_type = 'capex_item' THEN ci.product_name
          WHEN t.related_object_type = 'incident' THEN ${incidentRelatedLabelSql('inc')}
          WHEN t.related_object_type = 'project' THEN pp.name
          ELSE ''
        END as related_object_name,
        ${TASK_HIDDEN_LINE_REFERENCE_SQL} AS related_object_reference,
        ${TASK_HIDDEN_CONTRACT_SQL} AS related_object_contract_hidden,
        t.task_type_id,
        tt.name as task_type_name,
        tt.code as task_type_code,
        t.phase_id,
        phase.name as phase_name,
        t.priority_level,
        ${TASK_PRIORITY_SCORE_SQL} as priority_score,
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
      LEFT JOIN spend_items ci ON (t.related_object_type = 'capex_item' AND t.related_object_id = ci.id AND ci.tenant_id = t.tenant_id AND ci.nature = 'capex')
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
    const rows: TaskListItem[] = (await manager.query(dataQuery, params)).map(withHiddenReference);
    const [task] = await readableTaskRows(manager, rows.slice(0, 1), opts?.linkedReads, opts?.linkedScopes);
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
    opts?: { manager?: EntityManager; tenantId?: string; viewer?: IncidentViewer | null },
  ): Promise<void> {
    // An unscoped registry admin reads every task: nothing to look up.
    if (!accessScope && opts?.viewer?.isAdmin) return;
    const manager = opts?.manager ?? this.dataSource.manager;
    const tenantId = await this.resolveTenantId(manager, opts?.tenantId);
    const params: any[] = [id, tenantId];
    let accessWhere = '';
    if (accessScope) {
      params.push(accessScope.userId);
      accessWhere = `AND ${taskParticipantCondition('t', `$${params.length}`)}`;
    }
    const rows = await manager.query(
      `SELECT 1
       FROM tasks t
       WHERE t.id = $1
         AND t.tenant_id = $2
         ${accessWhere}
         ${taskIncidentVisibilitySql('t', opts?.viewer, params)}
       LIMIT 1`,
      params,
    );
    // The same message a missing T-N gets from `resolveToUuid`: a hidden task is missing.
    if (rows.length === 0) throw new NotFoundException('Item not found');
  }
}
