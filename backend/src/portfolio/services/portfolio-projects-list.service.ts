import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository, SelectQueryBuilder } from 'typeorm';
import { PortfolioProject } from '../portfolio-project.entity';
import { parsePagination } from '../../common/pagination';
import { applyProjectParticipantScope, projectParticipantCondition } from '../../auth/business-contributor-scope';
import {
  compileAgFilterCondition,
  createParamNameGenerator,
  FilterTargetConfig,
  CompiledCondition,
  buildQuickSearchConditions,
  normalizeAgFilterModel,
  assertSetFilterModes,
} from '../../common/ag-grid-filtering';
import { PortfolioProjectsBaseService, ServiceOpts } from './portfolio-projects-base.service';
import { projectInvolvesUsersSql } from './portfolio-report-filters';

type InvolvementScope = { involvedUserId?: string; involvedTeamId?: string };

const normalizeScopeValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseInvolvementScope = (query: any): InvolvementScope => ({
  involvedUserId: normalizeScopeValue(query?.involvedUserId),
  involvedTeamId: normalizeScopeValue(query?.involvedTeamId),
});

const applyProjectInvolvementScope = (
  qb: SelectQueryBuilder<PortfolioProject>,
  scope: InvolvementScope,
  alias = 'p',
) => {
  const involvedUserId = scope.involvedUserId;
  const involvedTeamId = scope.involvedTeamId;
  if (!involvedUserId && !involvedTeamId) return;

  const userCondition = `(
    ${alias}.business_sponsor_id = :involvedUserId
    OR ${alias}.business_lead_id = :involvedUserId
    OR ${alias}.it_sponsor_id = :involvedUserId
    OR ${alias}.it_lead_id = :involvedUserId
    OR EXISTS (
      SELECT 1
      FROM portfolio_project_team pt
      WHERE pt.project_id = ${alias}.id
        AND pt.user_id = :involvedUserId
    )
  )`;

  const teamUsersSql = `(
    SELECT tmc.user_id
    FROM portfolio_team_member_configs tmc
    WHERE tmc.team_id = :involvedTeamId
  )`;

  const teamCondition = projectInvolvesUsersSql(alias, teamUsersSql);

  if (involvedUserId && involvedTeamId) {
    qb.andWhere(`(${userCondition} OR ${teamCondition})`, { involvedUserId, involvedTeamId });
    return;
  }

  if (involvedUserId) {
    qb.andWhere(userCondition, { involvedUserId });
    return;
  }

  qb.andWhere(teamCondition, { involvedTeamId });
};

/**
 * The filters the portfolio reports link with, by id: the project itself (`id`) and the teams
 * involved in it (`involved_team_id`, the rule of the "My team" scope above). No column shows
 * them; the page keeps hidden columns so the model survives a sort or a page change. Returns
 * `undefined` for any other field, `null` for a model that says nothing.
 */
export const compileProjectLinkFilter = (
  field: string,
  rawModel: any,
  nextParam: () => string,
): CompiledCondition | null | undefined => {
  if (field !== 'id' && field !== 'involved_team_id') return undefined;
  const model = normalizeAgFilterModel(rawModel);
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return null;
  const ids = model.values.map((value: any) => String(value ?? '').trim()).filter(Boolean);
  if (ids.length === 0) return { sql: '1=0', params: {} };
  const param = nextParam();
  if (field === 'id') return { sql: `p.id::text IN (:...${param})`, params: { [param]: ids } };
  const teamUsersSql = `(
    SELECT tmc.user_id
    FROM portfolio_team_member_configs tmc
    WHERE tmc.tenant_id = p.tenant_id
      AND tmc.team_id::text IN (:...${param})
  )`;
  return { sql: projectInvolvesUsersSql('p', teamUsersSql), params: { [param]: ids } };
};

const projectDateFields = new Map<string, string>([
  ['planned_start', 'p.planned_start'],
  ['planned_end', 'p.planned_end'],
  // The creation day, not the instant: the grid sends plain days, and the portfolio reports
  // link to age brackets counted in whole days.
  ['created_at', 'p.created_at::date'],
]);

const compileDateFilterCondition = (
  rawModel: any,
  expression: string,
  nextParam: () => string,
): CompiledCondition | null => {
  const model = normalizeAgFilterModel(rawModel);
  if (!model || typeof model !== 'object') return null;

  const filterCategory = String(model.filterType ?? 'date');
  const type = String(model.type ?? 'equals');
  const fromRaw = model.dateFrom ?? model.filter ?? model.value;
  const toRaw = model.dateTo ?? model.filterTo ?? model.valueTo;

  if (filterCategory !== 'date' && filterCategory !== 'text') return null;

  if (type === 'blank') {
    return { sql: `${expression} IS NULL`, params: {} };
  }
  if (type === 'notBlank') {
    return { sql: `${expression} IS NOT NULL`, params: {} };
  }

  const castParam = (param: string): string => `:${param}::date`;

  if (type === 'inRange') {
    if (!fromRaw || !toRaw) return null;
    const fromParam = nextParam();
    const toParam = nextParam();
    return {
      sql: `${expression} BETWEEN ${castParam(fromParam)} AND ${castParam(toParam)}`,
      params: { [fromParam]: fromRaw, [toParam]: toRaw },
    };
  }

  if (!fromRaw) return null;
  const param = nextParam();
  switch (type) {
    case 'equals':
      return { sql: `${expression} = ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'notEqual':
      return { sql: `${expression} <> ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'lessThan':
      return { sql: `${expression} < ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'lessThanOrEqual':
      return { sql: `${expression} <= ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'greaterThan':
      return { sql: `${expression} > ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'greaterThanOrEqual':
      return { sql: `${expression} >= ${castParam(param)}`, params: { [param]: fromRaw } };
    default:
      return null;
  }
};

const buildUserDisplayNameSql = (userIdExpression: string, tenantIdExpression: string): string => `COALESCE((
  SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email)
  FROM users u
  WHERE u.id = ${userIdExpression}
    AND u.tenant_id = ${tenantIdExpression}
), '')`;

const buildProjectContributorNamesSql = (alias: string): string => `COALESCE((
  SELECT string_agg(contributor.name, ', ' ORDER BY contributor.name)
  FROM (
    SELECT DISTINCT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS name
    FROM portfolio_project_team pt
    JOIN users u ON u.id = pt.user_id AND u.tenant_id = ${alias}.tenant_id
    WHERE pt.project_id = ${alias}.id
      AND pt.tenant_id = ${alias}.tenant_id
  ) contributor
), '')`;

const applyExplicitTenantConstraint = (
  qb: SelectQueryBuilder<PortfolioProject>,
  tenantId?: string,
) => {
  if (!tenantId) return;
  qb.andWhere('p.tenant_id = :tenantId', { tenantId });
};

/**
 * Service for listing and filtering portfolio projects.
 */
@Injectable()
export class PortfolioProjectsListService extends PortfolioProjectsBaseService {
  constructor(
    @InjectRepository(PortfolioProject) projectRepo: Repository<PortfolioProject>,
  ) {
    super(projectRepo);
  }

  /**
   * List projects with filtering, sorting, and pagination.
   */
  async list(query: any, opts?: ServiceOpts) {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProject);
    const tenantId = String(opts?.tenantId || '').trim();
    const involvementScope = parseInvolvementScope(query);

    const { page, limit, skip, sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, (field) => field !== 'id' && field !== 'involved_team_id');

    const include = new Set(
      (query?.include || '').split(',').map((s: string) => s.trim()).filter(Boolean)
    );

    const fm = filters && typeof filters === 'object' ? filters : undefined;
    const hasStatusFilter = fm && Object.prototype.hasOwnProperty.call(fm, 'status');

    // Define filter targets for AG Grid model -> SQL translation
    type Target = FilterTargetConfig;
    const targets: Record<string, Target> = {
      name: { expression: 'p.name', dataType: 'string' },
      status: { expression: 'p.status', dataType: 'string' },
      origin: { expression: 'p.origin', dataType: 'string' },
      source_id: { expression: 'p.source_id', dataType: 'string' },
      category_id: { expression: 'p.category_id', dataType: 'string' },
      stream_id: { expression: 'p.stream_id', dataType: 'string' },
      company_id: { expression: 'p.company_id', dataType: 'string' },
      department_id: { expression: 'p.department_id', dataType: 'string' },
      priority_score: { expression: 'p.priority_score', dataType: 'number' },
      execution_progress: { expression: 'p.execution_progress', dataType: 'number' },
      planned_start: { expression: 'p.planned_start', textExpression: 'CAST(p.planned_start AS TEXT)', dataType: 'string' },
      planned_end: { expression: 'p.planned_end', textExpression: 'CAST(p.planned_end AS TEXT)', dataType: 'string' },
      created_at: { expression: 'p.created_at', textExpression: 'CAST(p.created_at AS TEXT)', dataType: 'string' },
      // Derived filter targets for joined/computed columns
      source_name: {
        expression: 'p.source_id',
        textExpression: `COALESCE((SELECT t.name FROM portfolio_sources t WHERE t.id = p.source_id), '')`,
        dataType: 'string',
      },
      category_name: {
        expression: 'p.category_id',
        textExpression: `COALESCE((SELECT cat.name FROM portfolio_categories cat WHERE cat.id = p.category_id), '')`,
        dataType: 'string',
      },
      stream_name: {
        expression: 'p.stream_id',
        textExpression: `COALESCE((SELECT s.name FROM portfolio_streams s WHERE s.id = p.stream_id), '')`,
        dataType: 'string',
      },
      company_name: {
        expression: 'p.company_id',
        textExpression: `COALESCE((SELECT c.name FROM companies c WHERE c.id = p.company_id), '')`,
        dataType: 'string',
      },
      department_name: {
        expression: 'p.department_id',
        textExpression: `COALESCE((SELECT d.name FROM departments d WHERE d.id = p.department_id), '')`,
        dataType: 'string',
      },
      business_lead_name: {
        expression: 'p.business_lead_id',
        textExpression: buildUserDisplayNameSql('p.business_lead_id', 'p.tenant_id'),
        dataType: 'string',
      },
      it_lead_name: {
        expression: 'p.it_lead_id',
        textExpression: buildUserDisplayNameSql('p.it_lead_id', 'p.tenant_id'),
        dataType: 'string',
      },
      contributor_name: {
        expression: 'p.id',
        textExpression: buildProjectContributorNamesSql('p'),
        dataType: 'string',
      },
    };

    // Compile AG Grid filters
    const nextParam = createParamNameGenerator('p');
    const compiledFilters: CompiledCondition[] = [];
    if (fm) {
      for (const [field, model] of Object.entries(fm)) {
        const linkCond = compileProjectLinkFilter(field, model, nextParam);
        if (linkCond !== undefined) {
          if (linkCond) compiledFilters.push(linkCond);
          continue;
        }
        const dateField = projectDateFields.get(field);
        if (dateField) {
          const cond = compileDateFilterCondition(model, dateField, nextParam);
          if (cond) {
            compiledFilters.push(cond);
            continue;
          }
        }
        const target = targets[field];
        if (!target) continue;
        const cond = compileAgFilterCondition(model, target, nextParam);
        if (cond) compiledFilters.push(cond);
      }
    }

    // Quick search across all visible grid columns
    const quickSearchExpressions = [
      'p.name',
      'p.status',
      'p.origin',
      `(SELECT t.name FROM portfolio_sources t WHERE t.id = p.source_id)`,
      `(SELECT cat.name FROM portfolio_categories cat WHERE cat.id = p.category_id)`,
      `(SELECT s.name FROM portfolio_streams s WHERE s.id = p.stream_id)`,
      `(SELECT c.name FROM companies c WHERE c.id = p.company_id)`,
      `(SELECT d.name FROM departments d WHERE d.id = p.department_id)`,
      buildUserDisplayNameSql('p.business_lead_id', 'p.tenant_id'),
      buildUserDisplayNameSql('p.it_lead_id', 'p.tenant_id'),
      buildProjectContributorNamesSql('p'),
    ];
    const quickSearch = q ? buildQuickSearchConditions(q, quickSearchExpressions, nextParam) : [];

    // Add exact item_number match for ref patterns (PRJ-123 or plain number)
    if (q) {
      const refMatch = q.match(/^(?:PRJ-)?(\d+)$/i);
      if (refMatch) {
        const param = nextParam();
        quickSearch.push({ sql: `p.item_number = :${param}`, params: { [param]: parseInt(refMatch[1], 10) } });
      }
    }

    // Build query
    const qb = repo.createQueryBuilder('p');
    if (tenantId) {
      qb.andWhere('p.tenant_id = :tenantId', { tenantId });
    }
    applyProjectInvolvementScope(qb, involvementScope, 'p');
    applyProjectParticipantScope(qb, opts?.accessScope, 'p');

    // Apply compiled filter conditions
    compiledFilters.forEach((c) => {
      qb.andWhere(new Brackets((sub) => sub.where(c.sql, c.params)));
    });

    // Apply quick search (OR across searched fields)
    if (quickSearch.length > 0) {
      qb.andWhere(new Brackets((sub) => {
        quickSearch.forEach((c, i) => {
          if (i === 0) sub.where(c.sql, c.params);
          else sub.orWhere(c.sql, c.params);
        });
      }));
    }

    // Default status filter: exclude 'done' unless explicitly filtering
    if (!hasStatusFilter && query?.status !== 'all') {
      qb.andWhere(`p.status <> :excludedStatus`, { excludedStatus: 'done' });
    }

    // Sorting
    const validFields = new Set([
      'name', 'status', 'origin', 'source_id', 'category_id', 'stream_id', 'priority_score',
      'planned_start', 'planned_end', 'execution_progress', 'created_at', 'updated_at',
    ]);
    const sortField = validFields.has(sort.field) ? sort.field : 'created_at';
    // For priority_score, put NULLs last so projects without scores appear at the end
    const nullsOption = sortField === 'priority_score' ? 'NULLS LAST' : undefined;
    qb.orderBy(`p.${sortField}`, sort.direction, nullsOption);

    // Count
    const total = await qb.getCount();

    // Page
    qb.skip(skip).take(limit);
    const items = await qb.getMany();

    // Enrich with related data if requested
    if (items.length > 0 && (include.has('company') || include.has('source_requests') || include.has('classification') || include.has('sponsors') || include.has('team'))) {
      await this.enrichItems(items, include as Set<string>, mg);
    }

    return { items, total, page, limit };
  }

  /**
   * Enrich list items with related data.
   */
  private async enrichItems(
    items: PortfolioProject[],
    include: Set<string>,
    mg: EntityManager,
  ): Promise<void> {
    const ids = items.map((i) => i.id);
    if (ids.length === 0) return;

    // Load company names
    if (include.has('company')) {
      const companyIds = [...new Set(items.map((i) => i.company_id).filter(Boolean))] as string[];
      if (companyIds.length > 0) {
        const companies = await mg.query(
          `SELECT id, name FROM companies WHERE id = ANY($1)`,
          [companyIds]
        );
        const map = Object.fromEntries(companies.map((c: any) => [c.id, c]));
        items.forEach((i: any) => {
          i.company = i.company_id ? map[i.company_id] : null;
        });
      }
    }

    // Load source requests
    if (include.has('source_requests')) {
      const links = await mg.query(
        `SELECT rp.project_id, r.id, r.item_number, r.name, r.status
         FROM portfolio_request_projects rp
         JOIN portfolio_requests r ON r.id = rp.request_id
         WHERE rp.project_id = ANY($1)`,
        [ids]
      );
      const map: Record<string, any[]> = {};
      links.forEach((l: any) => {
        if (!map[l.project_id]) map[l.project_id] = [];
        map[l.project_id].push({ id: l.id, item_number: l.item_number, name: l.name, status: l.status });
      });
      items.forEach((i: any) => {
        i.source_requests = map[i.id] || [];
      });
    }

    // Load classification names (source, category, stream)
    if (include.has('classification')) {
      // Load sources
      const sourceIds = [...new Set(items.map((i) => i.source_id).filter(Boolean))] as string[];
      if (sourceIds.length > 0) {
        const sources = await mg.query(
          `SELECT id, name FROM portfolio_sources WHERE id = ANY($1)`,
          [sourceIds]
        );
        const sourceMap = Object.fromEntries(sources.map((t: any) => [t.id, t.name]));
        items.forEach((i: any) => {
          i.source_name = i.source_id ? sourceMap[i.source_id] || null : null;
        });
      }

      // Load categories
      const categoryIds = [...new Set(items.map((i) => i.category_id).filter(Boolean))] as string[];
      if (categoryIds.length > 0) {
        const categories = await mg.query(
          `SELECT id, name FROM portfolio_categories WHERE id = ANY($1)`,
          [categoryIds]
        );
        const categoryMap = Object.fromEntries(categories.map((c: any) => [c.id, c.name]));
        items.forEach((i: any) => {
          i.category_name = i.category_id ? categoryMap[i.category_id] || null : null;
        });
      }

      // Load streams
      const streamIds = [...new Set(items.map((i) => i.stream_id).filter(Boolean))] as string[];
      if (streamIds.length > 0) {
        const streams = await mg.query(
          `SELECT id, name FROM portfolio_streams WHERE id = ANY($1)`,
          [streamIds]
        );
        const streamMap = Object.fromEntries(streams.map((s: any) => [s.id, s.name]));
        items.forEach((i: any) => {
          i.stream_name = i.stream_id ? streamMap[i.stream_id] || null : null;
        });
      }
    }

    if (include.has('sponsors') || include.has('team')) {
      const tenantIds = [...new Set(items.map((item: any) => item.tenant_id).filter(Boolean))] as string[];
      const userIds = [...new Set(items.flatMap((item) => [
        item.business_sponsor_id,
        item.business_lead_id,
        item.it_sponsor_id,
        item.it_lead_id,
      ]).filter(Boolean))] as string[];

      if (userIds.length > 0) {
        const users = await mg.query(
          `SELECT id, email, first_name, last_name FROM users WHERE id = ANY($1) AND tenant_id = ANY($2)`,
          [userIds, tenantIds],
        );
        const userMap = Object.fromEntries(users.map((user: any) => [user.id, user]));
        items.forEach((item: any) => {
          item.business_sponsor = item.business_sponsor_id ? userMap[item.business_sponsor_id] || null : null;
          item.business_lead = item.business_lead_id ? userMap[item.business_lead_id] || null : null;
          item.it_sponsor = item.it_sponsor_id ? userMap[item.it_sponsor_id] || null : null;
          item.it_lead = item.it_lead_id ? userMap[item.it_lead_id] || null : null;
        });
      }
    }

    if (include.has('team')) {
      const teamRows = await mg.query(
        `SELECT pt.project_id, pt.role, pt.user_id, u.email, u.first_name, u.last_name
         FROM portfolio_project_team pt
         JOIN users u ON u.id = pt.user_id AND u.tenant_id = pt.tenant_id
         WHERE pt.project_id = ANY($1)
         ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.email ASC NULLS LAST`,
        [ids],
      );

      const teamsByProject = new Map<string, { business: any[]; it: any[] }>();
      for (const row of teamRows) {
        const entry = teamsByProject.get(row.project_id) ?? { business: [], it: [] };
        if (row.role === 'business_team') entry.business.push(row);
        if (row.role === 'it_team') entry.it.push(row);
        teamsByProject.set(row.project_id, entry);
      }

      items.forEach((item: any) => {
        const teams = teamsByProject.get(item.id) ?? { business: [], it: [] };
        item.business_team = teams.business;
        item.it_team = teams.it;
      });
    }
  }

  /**
   * Return ordered list of matching project IDs for navigation.
   */
  async listIds(query: any, opts?: ServiceOpts): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProject);
    const tenantId = String(opts?.tenantId || '').trim();
    const involvementScope = parseInvolvementScope(query);

    const { sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, (field) => field !== 'id' && field !== 'involved_team_id');

    const fm = filters && typeof filters === 'object' ? filters : undefined;
    const hasStatusFilter = fm && Object.prototype.hasOwnProperty.call(fm, 'status');

    // Define filter targets for AG Grid model -> SQL translation
    type Target = FilterTargetConfig;
    const targets: Record<string, Target> = {
      name: { expression: 'p.name', dataType: 'string' },
      status: { expression: 'p.status', dataType: 'string' },
      origin: { expression: 'p.origin', dataType: 'string' },
      source_id: { expression: 'p.source_id', dataType: 'string' },
      category_id: { expression: 'p.category_id', dataType: 'string' },
      stream_id: { expression: 'p.stream_id', dataType: 'string' },
      company_id: { expression: 'p.company_id', dataType: 'string' },
      department_id: { expression: 'p.department_id', dataType: 'string' },
      priority_score: { expression: 'p.priority_score', dataType: 'number' },
      execution_progress: { expression: 'p.execution_progress', dataType: 'number' },
      planned_start: { expression: 'p.planned_start', textExpression: 'CAST(p.planned_start AS TEXT)', dataType: 'string' },
      planned_end: { expression: 'p.planned_end', textExpression: 'CAST(p.planned_end AS TEXT)', dataType: 'string' },
      created_at: { expression: 'p.created_at', textExpression: 'CAST(p.created_at AS TEXT)', dataType: 'string' },
      // Derived filter targets for joined/computed columns (used by grid filters)
      source_name: {
        expression: 'p.source_id',
        textExpression: `COALESCE((SELECT t.name FROM portfolio_sources t WHERE t.id = p.source_id), '')`,
        dataType: 'string',
      },
      category_name: {
        expression: 'p.category_id',
        textExpression: `COALESCE((SELECT cat.name FROM portfolio_categories cat WHERE cat.id = p.category_id), '')`,
        dataType: 'string',
      },
      stream_name: {
        expression: 'p.stream_id',
        textExpression: `COALESCE((SELECT s.name FROM portfolio_streams s WHERE s.id = p.stream_id), '')`,
        dataType: 'string',
      },
      company_name: {
        expression: 'p.company_id',
        textExpression: `COALESCE((SELECT c.name FROM companies c WHERE c.id = p.company_id), '')`,
        dataType: 'string',
      },
      department_name: {
        expression: 'p.department_id',
        textExpression: `COALESCE((SELECT d.name FROM departments d WHERE d.id = p.department_id), '')`,
        dataType: 'string',
      },
      business_lead_name: {
        expression: 'p.business_lead_id',
        textExpression: buildUserDisplayNameSql('p.business_lead_id', 'p.tenant_id'),
        dataType: 'string',
      },
      it_lead_name: {
        expression: 'p.it_lead_id',
        textExpression: buildUserDisplayNameSql('p.it_lead_id', 'p.tenant_id'),
        dataType: 'string',
      },
      contributor_name: {
        expression: 'p.id',
        textExpression: buildProjectContributorNamesSql('p'),
        dataType: 'string',
      },
    };

    // Compile AG Grid filters
    const nextParam = createParamNameGenerator('p');
    const compiledFilters: CompiledCondition[] = [];
    if (fm) {
      for (const [field, model] of Object.entries(fm)) {
        const linkCond = compileProjectLinkFilter(field, model, nextParam);
        if (linkCond !== undefined) {
          if (linkCond) compiledFilters.push(linkCond);
          continue;
        }
        const dateField = projectDateFields.get(field);
        if (dateField) {
          const cond = compileDateFilterCondition(model, dateField, nextParam);
          if (cond) {
            compiledFilters.push(cond);
            continue;
          }
        }
        const target = targets[field];
        if (!target) continue;
        const cond = compileAgFilterCondition(model, target, nextParam);
        if (cond) compiledFilters.push(cond);
      }
    }

    // Quick search across all visible grid columns
    const quickSearchExpressions = [
      'p.name',
      'p.status',
      'p.origin',
      buildUserDisplayNameSql('p.business_lead_id', 'p.tenant_id'),
      buildUserDisplayNameSql('p.it_lead_id', 'p.tenant_id'),
      buildProjectContributorNamesSql('p'),
    ];
    const quickSearch = q ? buildQuickSearchConditions(q, quickSearchExpressions, nextParam) : [];

    // Build query
    const qb = repo.createQueryBuilder('p').select('p.id').addSelect('p.item_number', 'item_number');
    if (tenantId) {
      qb.andWhere('p.tenant_id = :tenantId', { tenantId });
    }
    applyProjectInvolvementScope(qb, involvementScope, 'p');
    applyProjectParticipantScope(qb, opts?.accessScope, 'p');

    // Apply compiled filter conditions
    compiledFilters.forEach((c) => {
      qb.andWhere(new Brackets((sub) => sub.where(c.sql, c.params)));
    });

    // Apply quick search (OR across searched fields)
    if (quickSearch.length > 0) {
      qb.andWhere(new Brackets((sub) => {
        quickSearch.forEach((c, i) => {
          if (i === 0) sub.where(c.sql, c.params);
          else sub.orWhere(c.sql, c.params);
        });
      }));
    }

    // Default status filter: exclude 'done' unless explicitly filtering
    if (!hasStatusFilter && query?.status !== 'all') {
      qb.andWhere(`p.status <> :excludedStatus`, { excludedStatus: 'done' });
    }

    // Sorting
    const validFields = new Set([
      'name', 'status', 'origin', 'source_id', 'category_id', 'stream_id', 'priority_score',
      'planned_start', 'planned_end', 'execution_progress', 'created_at', 'updated_at',
    ]);
    const sortField = validFields.has(sort.field) ? sort.field : 'created_at';
    const nullsOption = sortField === 'priority_score' ? 'NULLS LAST' : undefined;
    qb.orderBy(`p.${sortField}`, sort.direction, nullsOption);

    const total = await qb.clone().getCount();
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const rows: Array<{ p_id: string; item_number: number | null }> = await qb.take(limit).getRawMany();
    const ids = rows.map((r) => r.p_id);
    const refs = rows.map((r) => (r.item_number != null ? `PRJ-${r.item_number}` : r.p_id));

    return { ids, refs, total };
  }

  /**
   * Return scoped filter values for checkbox set filters.
   */
  async listFilterValues(query: any, opts?: ServiceOpts): Promise<Record<string, Array<string | null>>> {
    const mg = this.getManager(opts);
    const repo = mg.getRepository(PortfolioProject);
    const tenantId = String(opts?.tenantId || '').trim();
    const involvementScope = parseInvolvementScope(query);
    const { q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, (field) => field !== 'id' && field !== 'involved_team_id');
    const fm = filters && typeof filters === 'object' ? filters : undefined;

    const rawFields = String(query?.fields || query?.field || '').split(',').map((f) => f.trim()).filter(Boolean);
    const allowed = new Set(['status', 'origin', 'source_name', 'category_name', 'stream_name', 'company_name', 'department_name', 'business_lead_name', 'it_lead_name', 'contributor_name']);
    const fields = rawFields.filter((field) => allowed.has(field));
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | null>> = {};

    type Target = FilterTargetConfig;
    const targets: Record<string, Target> = {
      name: { expression: 'p.name', dataType: 'string' },
      status: { expression: 'p.status', dataType: 'string' },
      origin: { expression: 'p.origin', dataType: 'string' },
      source_id: { expression: 'p.source_id', dataType: 'string' },
      category_id: { expression: 'p.category_id', dataType: 'string' },
      stream_id: { expression: 'p.stream_id', dataType: 'string' },
      company_id: { expression: 'p.company_id', dataType: 'string' },
      department_id: { expression: 'p.department_id', dataType: 'string' },
      priority_score: { expression: 'p.priority_score', dataType: 'number' },
      execution_progress: { expression: 'p.execution_progress', dataType: 'number' },
      planned_start: { expression: 'p.planned_start', textExpression: 'CAST(p.planned_start AS TEXT)', dataType: 'string' },
      planned_end: { expression: 'p.planned_end', textExpression: 'CAST(p.planned_end AS TEXT)', dataType: 'string' },
      created_at: { expression: 'p.created_at', textExpression: 'CAST(p.created_at AS TEXT)', dataType: 'string' },
      source_name: {
        expression: 'p.source_id',
        textExpression: `COALESCE((SELECT t.name FROM portfolio_sources t WHERE t.id = p.source_id), '')`,
        dataType: 'string',
      },
      category_name: {
        expression: 'p.category_id',
        textExpression: `COALESCE((SELECT cat.name FROM portfolio_categories cat WHERE cat.id = p.category_id), '')`,
        dataType: 'string',
      },
      stream_name: {
        expression: 'p.stream_id',
        textExpression: `COALESCE((SELECT s.name FROM portfolio_streams s WHERE s.id = p.stream_id), '')`,
        dataType: 'string',
      },
      company_name: {
        expression: 'p.company_id',
        textExpression: `COALESCE((SELECT c.name FROM companies c WHERE c.id = p.company_id), '')`,
        dataType: 'string',
      },
      department_name: {
        expression: 'p.department_id',
        textExpression: `COALESCE((SELECT d.name FROM departments d WHERE d.id = p.department_id), '')`,
        dataType: 'string',
      },
      business_lead_name: {
        expression: 'p.business_lead_id',
        textExpression: buildUserDisplayNameSql('p.business_lead_id', 'p.tenant_id'),
        dataType: 'string',
      },
      it_lead_name: {
        expression: 'p.it_lead_id',
        textExpression: buildUserDisplayNameSql('p.it_lead_id', 'p.tenant_id'),
        dataType: 'string',
      },
      contributor_name: {
        expression: 'p.id',
        textExpression: buildProjectContributorNamesSql('p'),
        dataType: 'string',
      },
    };

    const valueExpressions: Record<string, string> = {
      status: 'p.status',
      origin: 'p.origin',
      source_name: `(SELECT t.name FROM portfolio_sources t WHERE t.id = p.source_id)`,
      category_name: `(SELECT cat.name FROM portfolio_categories cat WHERE cat.id = p.category_id)`,
      stream_name: `(SELECT s.name FROM portfolio_streams s WHERE s.id = p.stream_id)`,
      company_name: `(SELECT c.name FROM companies c WHERE c.id = p.company_id)`,
      department_name: `(SELECT d.name FROM departments d WHERE d.id = p.department_id)`,
      business_lead_name: buildUserDisplayNameSql('p.business_lead_id', 'p.tenant_id'),
      it_lead_name: buildUserDisplayNameSql('p.it_lead_id', 'p.tenant_id'),
    };

    const quickSearchExpressions = [
      'p.name',
      'p.status',
      'p.origin',
      `(SELECT t.name FROM portfolio_sources t WHERE t.id = p.source_id)`,
      `(SELECT cat.name FROM portfolio_categories cat WHERE cat.id = p.category_id)`,
      `(SELECT s.name FROM portfolio_streams s WHERE s.id = p.stream_id)`,
      `(SELECT c.name FROM companies c WHERE c.id = p.company_id)`,
      `(SELECT d.name FROM departments d WHERE d.id = p.department_id)`,
      buildUserDisplayNameSql('p.business_lead_id', 'p.tenant_id'),
      buildUserDisplayNameSql('p.it_lead_id', 'p.tenant_id'),
      buildProjectContributorNamesSql('p'),
    ];

    for (const field of fields) {
      const filtersForField = fm ? { ...fm } : {};
      if (filtersForField && Object.prototype.hasOwnProperty.call(filtersForField, field)) {
        delete filtersForField[field];
      }
      const hasStatusFilter = !!(filtersForField && Object.prototype.hasOwnProperty.call(filtersForField, 'status'));

      const nextParam = createParamNameGenerator('p');
      const compiledFilters: CompiledCondition[] = [];
      if (filtersForField) {
        for (const [filterField, model] of Object.entries(filtersForField)) {
          const linkCond = compileProjectLinkFilter(filterField, model, nextParam);
          if (linkCond !== undefined) {
            if (linkCond) compiledFilters.push(linkCond);
            continue;
          }
          const target = targets[filterField];
          if (!target) continue;
          const cond = compileAgFilterCondition(model, target, nextParam);
          if (cond) compiledFilters.push(cond);
        }
      }

      const quickSearch = q ? buildQuickSearchConditions(q, quickSearchExpressions, nextParam) : [];

      const qb = repo.createQueryBuilder('p');
      if (tenantId) {
        qb.andWhere('p.tenant_id = :tenantId', { tenantId });
      }
      applyProjectInvolvementScope(qb, involvementScope, 'p');
      applyProjectParticipantScope(qb, opts?.accessScope, 'p');
      compiledFilters.forEach((c) => {
        qb.andWhere(new Brackets((sub) => sub.where(c.sql, c.params)));
      });

      if (quickSearch.length > 0) {
        qb.andWhere(new Brackets((sub) => {
          quickSearch.forEach((c, i) => {
            if (i === 0) sub.where(c.sql, c.params);
            else sub.orWhere(c.sql, c.params);
          });
        }));
      }

      if (!hasStatusFilter && query?.status !== 'all' && field !== 'status') {
        qb.andWhere(`p.status <> :excludedStatus`, { excludedStatus: 'done' });
      }

      if (field === 'contributor_name') {
        const contributorRows = await qb
          .innerJoin('portfolio_project_team', 'pt', 'pt.project_id = p.id AND pt.tenant_id = p.tenant_id')
          .innerJoin('users', 'u_team', 'u_team.id = pt.user_id AND u_team.tenant_id = p.tenant_id')
          .select(`DISTINCT COALESCE(NULLIF(TRIM(CONCAT(u_team.first_name, ' ', u_team.last_name)), ''), u_team.email)`, 'value')
          .orderBy('value', 'ASC')
          .getRawMany();
        results[field] = contributorRows.map((row: any) => row.value);
        continue;
      }

      const expr = valueExpressions[field];
      if (!expr) {
        results[field] = [];
        continue;
      }
      qb.select(`DISTINCT ${expr}`, 'value');
      qb.orderBy('value', 'ASC');
      const rows = await qb.getRawMany();
      results[field] = rows.map((row: any) => row.value);
    }

    return results;
  }

  /**
   * Get timeline/Gantt data for projects.
   */
  async getTimelineData(
    query: { months?: number; category?: string; status?: string[] },
    opts?: ServiceOpts,
  ) {
    const mg = this.getManager(opts);
    const monthsBack = query.months || 3;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - monthsBack);

    // Note: RLS via app_current_tenant() automatically filters by tenant.
    let sql = `
      SELECT p.id, p.name, p.status, p.scheduling_mode, p.category_id,
             p.planned_start, p.planned_end, p.actual_start, p.actual_end,
             p.execution_progress
      FROM portfolio_projects p
      WHERE p.status NOT IN ('cancelled')
      AND (
        (p.planned_start IS NOT NULL AND p.planned_end IS NOT NULL)
        OR p.actual_end IS NOT NULL
      )
      AND (
        p.planned_end >= $1 OR p.actual_end >= $1
      )
    `;
    const params: any[] = [startDate];

    if (opts?.accessScope?.userId) {
      params.push(opts.accessScope.userId);
      sql += ` AND ${projectParticipantCondition('p', `$${params.length}`)}`;
    }

    if (query.category) {
      params.push(query.category);
      sql += ` AND p.category_id = $${params.length}`;
    }

    if (query.status?.length) {
      params.push(query.status);
      sql += ` AND p.status = ANY($${params.length})`;
    }

    sql += ` ORDER BY COALESCE(p.planned_start, p.actual_start) ASC`;

    const projects = await mg.query(sql, params);
    const projectIds = projects.map((p: any) => p.id);

    // Fetch dependencies between projects in the timeline
    const dependencies = projectIds.length > 0
      ? await mg.query(
          `SELECT id, project_id, depends_on_project_id, dependency_type
           FROM portfolio_project_dependencies
           WHERE project_id = ANY($1)
           AND depends_on_project_id = ANY($1)`,
          [projectIds],
        )
      : [];

    // Fetch milestones for projects in the timeline
    const milestones = projectIds.length > 0
      ? await mg.query(
          `SELECT m.id, m.project_id, m.name, m.target_date, m.status, p.name as project_name
           FROM portfolio_project_milestones m
           JOIN portfolio_projects p ON p.id = m.project_id
           WHERE m.project_id = ANY($1)
           AND m.target_date IS NOT NULL
           AND m.target_date >= $2
           ORDER BY m.target_date ASC`,
          [projectIds, startDate],
        )
      : [];

    return {
      projects,
      dependencies,
      milestones,
      viewStart: startDate.toISOString().split('T')[0],
    };
  }
}
