import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, ILike, In, IsNull, Repository, SelectQueryBuilder } from 'typeorm';
import { randomUUID } from 'crypto';
import * as path from 'path';
import {
  FeasibilityReview,
  FeasibilityReviewEntry,
  FeasibilityReviewStatus,
  FEASIBILITY_REVIEW_KEYS,
  FEASIBILITY_REVIEW_STATUSES,
  PortfolioRequest,
  RequestStatus,
} from './portfolio-request.entity';
import { PortfolioRequestTeam, TeamRole } from './portfolio-request-team.entity';
import { PortfolioRequestContact } from './portfolio-request-contact.entity';
import { PortfolioRequestUrl } from './portfolio-request-url.entity';
import { PortfolioRequestAttachment } from './portfolio-request-attachment.entity';
import { PortfolioRequestOpex } from './portfolio-request-opex.entity';
import { budgetLineIdsOfKind, CAPEX_ITEMS_NOT_FOUND, OPEX_ITEMS_NOT_FOUND } from './project-budget-links.util';
import { PortfolioRequestBusinessProcess } from './portfolio-request-business-process.entity';
import { PortfolioRequestDependency } from './portfolio-request-dependency.entity';
import { PortfolioProjectDependency } from './portfolio-project-dependency.entity';
import { PortfolioProject } from './portfolio-project.entity';
import { PortfolioActivity } from './portfolio-activity.entity';
import { AuditService } from '../audit/audit.service';
import { resolveRecordCreators } from '../audit/record-creator.util';
import { ItemNumberService } from '../common/item-number.service';
import { StorageService } from '../common/storage/storage.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { parsePagination } from '../common/pagination';
import {
  compileAgFilterCondition,
  createParamNameGenerator,
  FilterTargetConfig,
  CompiledCondition,
  buildQuickSearchConditions,
  normalizeAgFilterModel,
  assertSetFilterModes,
} from '../common/ag-grid-filtering';
import { PortfolioCriteriaService } from './portfolio-criteria.service';
import { validateUploadedFile } from '../common/upload-validation';
import { fixMulterFilename } from '../common/upload';
import { extractInlineImageUrls } from '../common/content-image-urls';
import { isStoragePathReferencedInAnyTable } from '../common/storage-path-refs';
import { detectChanges, REQUEST_TRACKED_FIELDS, resolveDisplayNames } from '../common/change-detection';
import { normalizeMarkdownRichText } from '../common/markdown-rich-text';
import { RemoteInlineImageImportService } from '../common/remote-inline-image-import.service';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';
import { Task } from '../tasks/task.entity';
import { requestInvolvesUsersSql, requestLinkedToProjectsSql } from './services/portfolio-report-filters';
import { TaskAttachment } from '../tasks/task-attachment.entity';
import { TaskActivitiesService } from '../tasks/task-activities.service';
import {
  ParticipationAccessScope,
  applyRequestParticipantScope,
  requestParticipantCondition,
} from '../auth/business-contributor-scope';

type InvolvementScope = { involvedUserId?: string; involvedTeamId?: string };
type RequestServiceOpts = { manager?: EntityManager; tenantId?: string; accessScope?: ParticipationAccessScope };
type ConvertFromTaskOverrides = {
  name?: string;
  purpose?: string;
  requestor_id?: string | null;
  close_task?: boolean;
  origin_task_url?: string;
};

const normalizeScopeValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
};

const parseInvolvementScope = (query: any): InvolvementScope => ({
  involvedUserId: normalizeScopeValue(query?.involvedUserId),
  involvedTeamId: normalizeScopeValue(query?.involvedTeamId),
});

const applyRequestInvolvementScope = (
  qb: SelectQueryBuilder<PortfolioRequest>,
  scope: InvolvementScope,
  alias = 'r',
) => {
  const involvedUserId = scope.involvedUserId;
  const involvedTeamId = scope.involvedTeamId;
  if (!involvedUserId && !involvedTeamId) return;

  const userCondition = `(
    ${alias}.requestor_id = :involvedUserId
    OR ${alias}.created_by_id = :involvedUserId
    OR ${alias}.business_sponsor_id = :involvedUserId
    OR ${alias}.business_lead_id = :involvedUserId
    OR ${alias}.it_sponsor_id = :involvedUserId
    OR ${alias}.it_lead_id = :involvedUserId
    OR EXISTS (
      SELECT 1
      FROM portfolio_request_team rt
      WHERE rt.request_id = ${alias}.id
        AND rt.user_id = :involvedUserId
    )
  )`;

  const teamUsersSql = `(
    SELECT tmc.user_id
    FROM portfolio_team_member_configs tmc
    WHERE tmc.team_id = :involvedTeamId
  )`;

  const teamCondition = requestInvolvesUsersSql(alias, teamUsersSql);

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
 * The filters the portfolio reports link with, by id: the projects a request is linked to
 * (`linked_project_id`) and the teams involved in it (`involved_team_id`, the rule of the
 * "My team" scope above). No column shows them; the page keeps hidden columns so the model
 * survives a sort or a page change. Returns `undefined` for any other field, `null` for a
 * model that says nothing.
 */
export const compileRequestLinkFilter = (
  field: string,
  rawModel: any,
  nextParam: () => string,
): CompiledCondition | null | undefined => {
  if (field !== 'linked_project_id' && field !== 'involved_team_id') return undefined;
  const model = normalizeAgFilterModel(rawModel);
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return null;
  const ids = model.values.map((value: any) => String(value ?? '').trim()).filter(Boolean);
  if (ids.length === 0) return { sql: '1=0', params: {} };
  const param = nextParam();
  if (field === 'linked_project_id') {
    return { sql: requestLinkedToProjectsSql('r', `:${param}::text[]`), params: { [param]: ids } };
  }
  const teamUsersSql = `(
    SELECT tmc.user_id
    FROM portfolio_team_member_configs tmc
    WHERE tmc.tenant_id = r.tenant_id
      AND tmc.team_id::text = ANY(:${param}::text[])
  )`;
  return { sql: requestInvolvesUsersSql('r', teamUsersSql), params: { [param]: ids } };
};

const requestDateFields = new Map<string, string>([
  ['target_delivery_date', 'r.target_delivery_date'],
  // The creation day, not the instant: the grid sends plain days, and the portfolio reports
  // link to age brackets counted in whole days.
  ['created_at', 'r.created_at::date'],
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

const buildRequestContributorNamesSql = (alias: string): string => `COALESCE((
  SELECT string_agg(contributor.name, ', ' ORDER BY contributor.name)
  FROM (
    SELECT DISTINCT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS name
    FROM portfolio_request_team rt
    JOIN users u ON u.id = rt.user_id AND u.tenant_id = ${alias}.tenant_id
    WHERE rt.request_id = ${alias}.id
      AND rt.tenant_id = ${alias}.tenant_id
  ) contributor
), '')`;

const applyExplicitTenantConstraint = (
  qb: SelectQueryBuilder<PortfolioRequest>,
  tenantId?: string,
) => {
  if (!tenantId) return;
  qb.andWhere('r.tenant_id = :tenantId', { tenantId });
};

@Injectable()
export class PortfolioRequestsService {
  constructor(
    @InjectRepository(PortfolioRequest)
    private readonly repo: Repository<PortfolioRequest>,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(forwardRef(() => PortfolioCriteriaService))
    private readonly criteriaService: PortfolioCriteriaService,
    @Inject(forwardRef(() => TaskActivitiesService))
    private readonly taskActivitiesSvc: TaskActivitiesService,
    private readonly notifications: NotificationsService,
    private readonly itemNumberService: ItemNumberService,
    private readonly remoteInlineImages: RemoteInlineImageImportService,
    private readonly integratedDocuments: IntegratedDocumentsService,
  ) {}

  // ==================== LIST ====================
  async list(query: any, opts?: RequestServiceOpts) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);
    const tenantId = String(opts?.tenantId || '').trim();
    const involvementScope = parseInvolvementScope(query);

    const { page, limit, skip, sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, (field) => field !== 'linked_project_id' && field !== 'involved_team_id');

    const include = new Set(
      (query?.include || '').split(',').map((s: string) => s.trim()).filter(Boolean)
    );

    const fm = filters && typeof filters === 'object' ? filters : undefined;
    const hasStatusFilter = fm && Object.prototype.hasOwnProperty.call(fm, 'status');

    // Define filter targets for AG Grid model -> SQL translation
    type Target = FilterTargetConfig;
    const targets: Record<string, Target> = {
      name: { expression: 'r.name', dataType: 'string' },
      status: { expression: 'r.status', dataType: 'string' },
      source_id: { expression: 'r.source_id', dataType: 'string' },
      category_id: { expression: 'r.category_id', dataType: 'string' },
      stream_id: { expression: 'r.stream_id', dataType: 'string' },
      company_id: { expression: 'r.company_id', dataType: 'string' },
      department_id: { expression: 'r.department_id', dataType: 'string' },
      requestor_id: { expression: 'r.requestor_id', dataType: 'string' },
      business_sponsor_id: { expression: 'r.business_sponsor_id', dataType: 'string' },
      it_sponsor_id: { expression: 'r.it_sponsor_id', dataType: 'string' },
      priority_score: { expression: 'r.priority_score', dataType: 'number' },
      target_delivery_date: { expression: 'r.target_delivery_date', textExpression: 'CAST(r.target_delivery_date AS TEXT)', dataType: 'string' },
      created_at: { expression: 'r.created_at', textExpression: 'CAST(r.created_at AS TEXT)', dataType: 'string' },
      // Derived filter targets for joined/computed columns
      source_name: {
        expression: 'r.source_id',
        textExpression: `COALESCE((SELECT t.name FROM portfolio_sources t WHERE t.id = r.source_id), '')`,
        dataType: 'string',
      },
      category_name: {
        expression: 'r.category_id',
        textExpression: `COALESCE((SELECT c.name FROM portfolio_categories c WHERE c.id = r.category_id), '')`,
        dataType: 'string',
      },
      stream_name: {
        expression: 'r.stream_id',
        textExpression: `COALESCE((SELECT s.name FROM portfolio_streams s WHERE s.id = r.stream_id), '')`,
        dataType: 'string',
      },
      company_name: {
        expression: 'r.company_id',
        textExpression: `COALESCE((SELECT c.name FROM companies c WHERE c.id = r.company_id), '')`,
        dataType: 'string',
      },
      department_name: {
        expression: 'r.department_id',
        textExpression: `COALESCE((SELECT d.name FROM departments d WHERE d.id = r.department_id), '')`,
        dataType: 'string',
      },
      requestor_name: {
        expression: 'r.requestor_id',
        textExpression: `COALESCE((SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) FROM users u WHERE u.id = r.requestor_id), '')`,
        dataType: 'string',
      },
      business_lead_name: {
        expression: 'r.business_lead_id',
        textExpression: buildUserDisplayNameSql('r.business_lead_id', 'r.tenant_id'),
        dataType: 'string',
      },
      it_lead_name: {
        expression: 'r.it_lead_id',
        textExpression: buildUserDisplayNameSql('r.it_lead_id', 'r.tenant_id'),
        dataType: 'string',
      },
      contributor_name: {
        expression: 'r.id',
        textExpression: buildRequestContributorNamesSql('r'),
        dataType: 'string',
      },
    };

    // Compile AG Grid filters
    const nextParam = createParamNameGenerator('p');
    const compiledFilters: CompiledCondition[] = [];
    if (fm) {
      for (const [field, model] of Object.entries(fm)) {
        const linkCond = compileRequestLinkFilter(field, model, nextParam);
        if (linkCond !== undefined) {
          if (linkCond) compiledFilters.push(linkCond);
          continue;
        }
        const dateField = requestDateFields.get(field);
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
      'r.name',
      'r.status',
      `(SELECT t.name FROM portfolio_sources t WHERE t.id = r.source_id)`,
      `(SELECT cat.name FROM portfolio_categories cat WHERE cat.id = r.category_id)`,
      `(SELECT s.name FROM portfolio_streams s WHERE s.id = r.stream_id)`,
      `(SELECT c.name FROM companies c WHERE c.id = r.company_id)`,
      `(SELECT d.name FROM departments d WHERE d.id = r.department_id)`,
      `(SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) FROM users u WHERE u.id = r.requestor_id)`,
      buildUserDisplayNameSql('r.business_lead_id', 'r.tenant_id'),
      buildUserDisplayNameSql('r.it_lead_id', 'r.tenant_id'),
      buildRequestContributorNamesSql('r'),
    ];
    const quickSearch = q ? buildQuickSearchConditions(q, quickSearchExpressions, nextParam) : [];

    // Add exact item_number match for ref patterns (REQ-123 or plain number)
    if (q) {
      const refMatch = q.match(/^(?:REQ-)?(\d+)$/i);
      if (refMatch) {
        const param = nextParam();
        quickSearch.push({ sql: `r.item_number = :${param}`, params: { [param]: parseInt(refMatch[1], 10) } });
      }
    }

    // Build query
    const qb = repo.createQueryBuilder('r');
    if (tenantId) {
      qb.andWhere('r.tenant_id = :tenantId', { tenantId });
    }
    applyRequestInvolvementScope(qb, involvementScope, 'r');
    applyRequestParticipantScope(qb, opts?.accessScope, 'r');

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

    // Default status filter: exclude 'converted' unless explicitly filtering
    if (!hasStatusFilter && query?.status !== 'all') {
      qb.andWhere(`r.status <> :excludedStatus`, { excludedStatus: 'converted' });
    }

    // Sorting
    const validFields = new Set(['name', 'status', 'source_id', 'category_id', 'stream_id', 'priority_score', 'target_delivery_date', 'created_at', 'updated_at']);
    const sortField = validFields.has(sort.field) ? sort.field : 'created_at';
    // For priority_score, put NULLs last so requests without scores appear at the end
    const nullsOption = sortField === 'priority_score' ? 'NULLS LAST' : undefined;
    qb.orderBy(`r.${sortField}`, sort.direction, nullsOption);

    // Count
    const total = await qb.getCount();

    // Page
    qb.skip(skip).take(limit);
    const items = await qb.getMany();

    // Enrich with related data if requested
    if (items.length > 0 && (include.has('company') || include.has('requestor') || include.has('classification') || include.has('sponsors') || include.has('team'))) {
      await this.enrichItems(items, include as Set<string>, mg);
    }

    return { items, total, page, limit };
  }

  // ==================== LIST IDS ====================
  async listIds(query: any, opts?: RequestServiceOpts): Promise<{ ids: string[]; refs: string[]; total: number }> {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);
    const tenantId = String(opts?.tenantId || '').trim();
    const involvementScope = parseInvolvementScope(query);

    const { sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, (field) => field !== 'linked_project_id' && field !== 'involved_team_id');

    const fm = filters && typeof filters === 'object' ? filters : undefined;
    const hasStatusFilter = fm && Object.prototype.hasOwnProperty.call(fm, 'status');

    // Define filter targets for AG Grid model -> SQL translation
    type Target = FilterTargetConfig;
    const targets: Record<string, Target> = {
      name: { expression: 'r.name', dataType: 'string' },
      status: { expression: 'r.status', dataType: 'string' },
      source_id: { expression: 'r.source_id', dataType: 'string' },
      category_id: { expression: 'r.category_id', dataType: 'string' },
      stream_id: { expression: 'r.stream_id', dataType: 'string' },
      company_id: { expression: 'r.company_id', dataType: 'string' },
      department_id: { expression: 'r.department_id', dataType: 'string' },
      requestor_id: { expression: 'r.requestor_id', dataType: 'string' },
      priority_score: { expression: 'r.priority_score', dataType: 'number' },
      target_delivery_date: { expression: 'r.target_delivery_date', textExpression: 'CAST(r.target_delivery_date AS TEXT)', dataType: 'string' },
      created_at: { expression: 'r.created_at', textExpression: 'CAST(r.created_at AS TEXT)', dataType: 'string' },
      // Derived filter targets for joined/computed columns (used by grid filters)
      source_name: {
        expression: 'r.source_id',
        textExpression: `COALESCE((SELECT t.name FROM portfolio_sources t WHERE t.id = r.source_id), '')`,
        dataType: 'string',
      },
      category_name: {
        expression: 'r.category_id',
        textExpression: `COALESCE((SELECT c.name FROM portfolio_categories c WHERE c.id = r.category_id), '')`,
        dataType: 'string',
      },
      stream_name: {
        expression: 'r.stream_id',
        textExpression: `COALESCE((SELECT s.name FROM portfolio_streams s WHERE s.id = r.stream_id), '')`,
        dataType: 'string',
      },
      company_name: {
        expression: 'r.company_id',
        textExpression: `COALESCE((SELECT c.name FROM companies c WHERE c.id = r.company_id), '')`,
        dataType: 'string',
      },
      department_name: {
        expression: 'r.department_id',
        textExpression: `COALESCE((SELECT d.name FROM departments d WHERE d.id = r.department_id), '')`,
        dataType: 'string',
      },
      requestor_name: {
        expression: 'r.requestor_id',
        textExpression: `COALESCE((SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) FROM users u WHERE u.id = r.requestor_id), '')`,
        dataType: 'string',
      },
      business_lead_name: {
        expression: 'r.business_lead_id',
        textExpression: buildUserDisplayNameSql('r.business_lead_id', 'r.tenant_id'),
        dataType: 'string',
      },
      it_lead_name: {
        expression: 'r.it_lead_id',
        textExpression: buildUserDisplayNameSql('r.it_lead_id', 'r.tenant_id'),
        dataType: 'string',
      },
      contributor_name: {
        expression: 'r.id',
        textExpression: buildRequestContributorNamesSql('r'),
        dataType: 'string',
      },
    };

    // Compile AG Grid filters
    const nextParam = createParamNameGenerator('p');
    const compiledFilters: CompiledCondition[] = [];
    if (fm) {
      for (const [field, model] of Object.entries(fm)) {
        const linkCond = compileRequestLinkFilter(field, model, nextParam);
        if (linkCond !== undefined) {
          if (linkCond) compiledFilters.push(linkCond);
          continue;
        }
        const dateField = requestDateFields.get(field);
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
      'r.name',
      'r.status',
      buildUserDisplayNameSql('r.business_lead_id', 'r.tenant_id'),
      buildUserDisplayNameSql('r.it_lead_id', 'r.tenant_id'),
      buildRequestContributorNamesSql('r'),
    ];
    const quickSearch = q ? buildQuickSearchConditions(q, quickSearchExpressions, nextParam) : [];

    // Build query
    const qb = repo.createQueryBuilder('r').select('r.id').addSelect('r.item_number', 'item_number');
    if (tenantId) {
      qb.andWhere('r.tenant_id = :tenantId', { tenantId });
    }
    applyRequestInvolvementScope(qb, involvementScope, 'r');
    applyRequestParticipantScope(qb, opts?.accessScope, 'r');

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

    // Default status filter: exclude 'converted' unless explicitly filtering
    if (!hasStatusFilter && query?.status !== 'all') {
      qb.andWhere(`r.status <> :excludedStatus`, { excludedStatus: 'converted' });
    }

    // Sorting
    const validFields = new Set(['name', 'status', 'source_id', 'category_id', 'stream_id', 'priority_score', 'target_delivery_date', 'created_at', 'updated_at']);
    const sortField = validFields.has(sort.field) ? sort.field : 'created_at';
    const nullsOption = sortField === 'priority_score' ? 'NULLS LAST' : undefined;
    qb.orderBy(`r.${sortField}`, sort.direction, nullsOption);

    const total = await qb.clone().getCount();
    const limit = Math.min(Math.max(Number(query?.limit) || 10000, 1), 10000);
    const rows: Array<{ r_id: string; item_number: number | null }> = await qb.take(limit).getRawMany();
    const ids = rows.map((r) => r.r_id);
    const refs = rows.map((r) => (r.item_number != null ? `REQ-${r.item_number}` : r.r_id));

    return { ids, refs, total };
  }

  // ==================== FILTER VALUES ====================
  /**
   * Return scoped filter values for checkbox set filters.
   */
  async listFilterValues(query: any, opts?: RequestServiceOpts): Promise<Record<string, Array<string | null>>> {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);
    const tenantId = String(opts?.tenantId || '').trim();
    const involvementScope = parseInvolvementScope(query);
    const { q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    assertSetFilterModes(filters, (field) => field !== 'linked_project_id' && field !== 'involved_team_id');
    const fm = filters && typeof filters === 'object' ? filters : undefined;

    const rawFields = String(query?.fields || query?.field || '').split(',').map((f) => f.trim()).filter(Boolean);
    const allowed = new Set(['status', 'source_name', 'category_name', 'stream_name', 'company_name', 'department_name', 'requestor_name', 'business_lead_name', 'it_lead_name', 'contributor_name']);
    const fields = rawFields.filter((field) => allowed.has(field));
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | null>> = {};

    type Target = FilterTargetConfig;
    const targets: Record<string, Target> = {
      name: { expression: 'r.name', dataType: 'string' },
      status: { expression: 'r.status', dataType: 'string' },
      source_id: { expression: 'r.source_id', dataType: 'string' },
      category_id: { expression: 'r.category_id', dataType: 'string' },
      stream_id: { expression: 'r.stream_id', dataType: 'string' },
      company_id: { expression: 'r.company_id', dataType: 'string' },
      department_id: { expression: 'r.department_id', dataType: 'string' },
      requestor_id: { expression: 'r.requestor_id', dataType: 'string' },
      business_sponsor_id: { expression: 'r.business_sponsor_id', dataType: 'string' },
      it_sponsor_id: { expression: 'r.it_sponsor_id', dataType: 'string' },
      priority_score: { expression: 'r.priority_score', dataType: 'number' },
      target_delivery_date: { expression: 'r.target_delivery_date', textExpression: 'CAST(r.target_delivery_date AS TEXT)', dataType: 'string' },
      created_at: { expression: 'r.created_at', textExpression: 'CAST(r.created_at AS TEXT)', dataType: 'string' },
      source_name: {
        expression: 'r.source_id',
        textExpression: `COALESCE((SELECT t.name FROM portfolio_sources t WHERE t.id = r.source_id), '')`,
        dataType: 'string',
      },
      category_name: {
        expression: 'r.category_id',
        textExpression: `COALESCE((SELECT c.name FROM portfolio_categories c WHERE c.id = r.category_id), '')`,
        dataType: 'string',
      },
      stream_name: {
        expression: 'r.stream_id',
        textExpression: `COALESCE((SELECT s.name FROM portfolio_streams s WHERE s.id = r.stream_id), '')`,
        dataType: 'string',
      },
      company_name: {
        expression: 'r.company_id',
        textExpression: `COALESCE((SELECT c.name FROM companies c WHERE c.id = r.company_id), '')`,
        dataType: 'string',
      },
      department_name: {
        expression: 'r.department_id',
        textExpression: `COALESCE((SELECT d.name FROM departments d WHERE d.id = r.department_id), '')`,
        dataType: 'string',
      },
      requestor_name: {
        expression: 'r.requestor_id',
        textExpression: `COALESCE((SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) FROM users u WHERE u.id = r.requestor_id), '')`,
        dataType: 'string',
      },
      business_lead_name: {
        expression: 'r.business_lead_id',
        textExpression: buildUserDisplayNameSql('r.business_lead_id', 'r.tenant_id'),
        dataType: 'string',
      },
      it_lead_name: {
        expression: 'r.it_lead_id',
        textExpression: buildUserDisplayNameSql('r.it_lead_id', 'r.tenant_id'),
        dataType: 'string',
      },
      contributor_name: {
        expression: 'r.id',
        textExpression: buildRequestContributorNamesSql('r'),
        dataType: 'string',
      },
    };

    const valueExpressions: Record<string, string> = {
      status: 'r.status',
      source_name: `(SELECT t.name FROM portfolio_sources t WHERE t.id = r.source_id)`,
      category_name: `(SELECT c.name FROM portfolio_categories c WHERE c.id = r.category_id)`,
      stream_name: `(SELECT s.name FROM portfolio_streams s WHERE s.id = r.stream_id)`,
      company_name: `(SELECT c.name FROM companies c WHERE c.id = r.company_id)`,
      department_name: `(SELECT d.name FROM departments d WHERE d.id = r.department_id)`,
      requestor_name: `(SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) FROM users u WHERE u.id = r.requestor_id)`,
      business_lead_name: buildUserDisplayNameSql('r.business_lead_id', 'r.tenant_id'),
      it_lead_name: buildUserDisplayNameSql('r.it_lead_id', 'r.tenant_id'),
    };

    const quickSearchExpressions = [
      'r.name',
      'r.status',
      `(SELECT t.name FROM portfolio_sources t WHERE t.id = r.source_id)`,
      `(SELECT cat.name FROM portfolio_categories cat WHERE cat.id = r.category_id)`,
      `(SELECT s.name FROM portfolio_streams s WHERE s.id = r.stream_id)`,
      `(SELECT c.name FROM companies c WHERE c.id = r.company_id)`,
      `(SELECT d.name FROM departments d WHERE d.id = r.department_id)`,
      `(SELECT COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) FROM users u WHERE u.id = r.requestor_id)`,
      buildUserDisplayNameSql('r.business_lead_id', 'r.tenant_id'),
      buildUserDisplayNameSql('r.it_lead_id', 'r.tenant_id'),
      buildRequestContributorNamesSql('r'),
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
          const linkCond = compileRequestLinkFilter(filterField, model, nextParam);
          if (linkCond !== undefined) {
            if (linkCond) compiledFilters.push(linkCond);
            continue;
          }
          const dateField = requestDateFields.get(filterField);
          if (dateField) {
            const cond = compileDateFilterCondition(model, dateField, nextParam);
            if (cond) {
              compiledFilters.push(cond);
              continue;
            }
          }
          const target = targets[filterField];
          if (!target) continue;
          const cond = compileAgFilterCondition(model, target, nextParam);
          if (cond) compiledFilters.push(cond);
        }
      }

      const quickSearch = q ? buildQuickSearchConditions(q, quickSearchExpressions, nextParam) : [];

      const qb = repo.createQueryBuilder('r');
      if (tenantId) {
        qb.andWhere('r.tenant_id = :tenantId', { tenantId });
      }
      applyRequestInvolvementScope(qb, involvementScope, 'r');
      applyRequestParticipantScope(qb, opts?.accessScope, 'r');

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
        qb.andWhere(`r.status <> :excludedStatus`, { excludedStatus: 'converted' });
      }

      if (field === 'contributor_name') {
        const contributorRows = await qb
          .innerJoin('portfolio_request_team', 'rt', 'rt.request_id = r.id AND rt.tenant_id = r.tenant_id')
          .innerJoin('users', 'u_team', 'u_team.id = rt.user_id AND u_team.tenant_id = r.tenant_id')
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

  private async enrichItems(
    items: PortfolioRequest[],
    include: Set<string>,
    mg: EntityManager,
  ) {
    const ids = items.map((i) => i.id);
    if (ids.length === 0) return;

    // Load requestor names
    if (include.has('requestor')) {
      const userIds = [...new Set(items.map((i) => i.requestor_id).filter(Boolean))] as string[];
      if (userIds.length > 0) {
        const users = await mg.query(
          `SELECT id, email, first_name, last_name FROM users WHERE id = ANY($1)`,
          [userIds]
        );
        const userMap = Object.fromEntries(users.map((u: any) => [u.id, u]));
        items.forEach((i: any) => {
          if (i.requestor_id) {
            i.requestor = userMap[i.requestor_id] || null;
          }
        });
      }
    }

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
        item.requestor_id,
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
          item.requestor = item.requestor_id ? userMap[item.requestor_id] || null : null;
          item.business_sponsor = item.business_sponsor_id ? userMap[item.business_sponsor_id] || null : null;
          item.business_lead = item.business_lead_id ? userMap[item.business_lead_id] || null : null;
          item.it_sponsor = item.it_sponsor_id ? userMap[item.it_sponsor_id] || null : null;
          item.it_lead = item.it_lead_id ? userMap[item.it_lead_id] || null : null;
        });
      }
    }

    if (include.has('team')) {
      const teamRows = await mg.query(
        `SELECT rt.request_id, rt.role, rt.user_id, u.email, u.first_name, u.last_name
         FROM portfolio_request_team rt
         JOIN users u ON u.id = rt.user_id AND u.tenant_id = rt.tenant_id
         WHERE rt.request_id = ANY($1)
         ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.email ASC NULLS LAST`,
        [ids],
      );

      const teamsByRequest = new Map<string, { business: any[]; it: any[] }>();
      for (const row of teamRows) {
        const entry = teamsByRequest.get(row.request_id) ?? { business: [], it: [] };
        if (row.role === 'business_team') entry.business.push(row);
        if (row.role === 'it_team') entry.it.push(row);
        teamsByRequest.set(row.request_id, entry);
      }

      items.forEach((item: any) => {
        const teams = teamsByRequest.get(item.id) ?? { business: [], it: [] };
        item.business_team = teams.business;
        item.it_team = teams.it;
      });
    }
  }

  // ==================== GET ====================
  async assertVisible(
    id: string,
    accessScope: ParticipationAccessScope | undefined,
    opts?: { manager?: EntityManager },
  ): Promise<void> {
    if (!accessScope) return;
    const mg = opts?.manager ?? this.repo.manager;
    const rows = await mg.query(
      `SELECT 1
       FROM portfolio_requests r
       WHERE r.id = $1
         AND ${requestParticipantCondition('r', '$2')}
       LIMIT 1`,
      [id, accessScope.userId],
    );
    if (rows.length === 0) throw new NotFoundException('Request not found');
  }

  async get(id: string, query: any, opts?: { manager?: EntityManager; accessScope?: ParticipationAccessScope }) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);

    const includeRaw = typeof query === 'string' ? query : (query?.include || '');
    const include = new Set(
      includeRaw.split(',').map((s: string) => s.trim()).filter(Boolean)
    );

    await this.assertVisible(id, opts?.accessScope, { manager: mg });

    const request = await repo.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');

    const result: any = { ...request };

    // Load team members
    if (include.has('team')) {
      const team = await mg.query(
        `SELECT rt.*, u.email, u.first_name, u.last_name
         FROM portfolio_request_team rt
         JOIN users u ON u.id = rt.user_id AND u.tenant_id = rt.tenant_id
         WHERE rt.request_id = $1`,
        [id]
      );
      result.business_team = team.filter((t: any) => t.role === 'business_team');
      result.it_team = team.filter((t: any) => t.role === 'it_team');
    }

    // Load sponsors/leads
    if (include.has('sponsors') || include.has('team')) {
      const userIds = [
        request.requestor_id,
        request.business_sponsor_id,
        request.business_lead_id,
        request.it_sponsor_id,
        request.it_lead_id,
      ].filter(Boolean) as string[];

      if (userIds.length > 0) {
        const users = await mg.query(
          `SELECT id, email, first_name, last_name FROM users WHERE id = ANY($1) AND tenant_id = $2`,
          [userIds, request.tenant_id]
        );
        const userMap = Object.fromEntries(users.map((u: any) => [u.id, u]));
        result.requestor = request.requestor_id ? userMap[request.requestor_id] : null;
        result.business_sponsor = request.business_sponsor_id ? userMap[request.business_sponsor_id] : null;
        result.business_lead = request.business_lead_id ? userMap[request.business_lead_id] : null;
        result.it_sponsor = request.it_sponsor_id ? userMap[request.it_sponsor_id] : null;
        result.it_lead = request.it_lead_id ? userMap[request.it_lead_id] : null;
      }
    }

    // Load external contacts
    if (include.has('contacts')) {
      result.external_contacts = await mg.query(
        `SELECT c.* FROM portfolio_request_contacts rc
         JOIN contacts c ON c.id = rc.contact_id
         WHERE rc.request_id = $1`,
        [id]
      );
    }

    // Load company/department
    if (include.has('company') && request.company_id) {
      const companies = await mg.query(`SELECT id, name FROM companies WHERE id = $1`, [request.company_id]);
      result.company = companies[0] || null;
    }
    if (include.has('department') && request.department_id) {
      const departments = await mg.query(`SELECT id, name FROM departments WHERE id = $1`, [request.department_id]);
      result.department = departments[0] || null;
    }

    if (include.has('origin_task') && request.origin_task_id) {
      const originTasks = await mg.query<Array<{
        id: string;
        item_number: number | null;
        title: string | null;
        task_type_id: string | null;
        task_type_name: string | null;
      }>>(
        `SELECT t.id, t.item_number, t.title, t.task_type_id, tt.name AS task_type_name
         FROM tasks t
         LEFT JOIN portfolio_task_types tt ON tt.id = t.task_type_id
         WHERE t.id = $1
         LIMIT 1`,
        [request.origin_task_id],
      );
      result.origin_task = originTasks[0] || null;
    }

    // Load URLs
    if (include.has('urls')) {
      result.urls = await mg.query(
        `SELECT * FROM portfolio_request_urls WHERE request_id = $1 ORDER BY created_at`,
        [id]
      );
    }

    // Load attachments (exclude inline images - they're managed via rich text editor)
    if (include.has('attachments')) {
      result.attachments = await mg.query(
        `SELECT id, original_filename, mime_type, size, created_at
         FROM portfolio_request_attachments WHERE request_id = $1 AND source_field IS NULL ORDER BY created_at`,
        [id]
      );
    }

    // Load resulting projects
    if (include.has('projects')) {
      result.resulting_projects = await mg.query(
        `SELECT p.id, p.name, p.status
         FROM portfolio_request_projects rp
         JOIN portfolio_projects p ON p.id = rp.project_id
         WHERE rp.request_id = $1`,
        [id]
      );
    }

    // Load dependencies
    if (include.has('dependencies')) {
      const rawDeps = await mg.query(
        `SELECT d.*,
          r.name as request_name, r.status as request_status,
          p.name as project_name, p.status as project_status
         FROM portfolio_request_dependencies d
         LEFT JOIN portfolio_requests r ON r.id = d.depends_on_request_id
         LEFT JOIN portfolio_projects p ON p.id = d.depends_on_project_id
         WHERE d.request_id = $1`,
        [id]
      );
      // Transform to unified format for frontend
      result.dependencies = rawDeps.map((d: any) => ({
        id: d.id,
        target_type: d.depends_on_request_id ? 'request' : 'project',
        target_id: d.depends_on_request_id || d.depends_on_project_id,
        target_name: d.depends_on_request_id ? d.request_name : d.project_name,
        target_status: d.depends_on_request_id ? d.request_status : d.project_status,
      }));
    }

    // Load CAPEX items
    if (include.has('financials') || include.has('capex')) {
      result.capex_items = await mg.query(
        `SELECT c.id, c.product_name AS description, c.ppe_type, c.investment_type, c.priority, c.currency, c.status,
                sup.name as supplier_name
         FROM portfolio_request_opex rc
         JOIN spend_items c ON c.id = rc.opex_id AND c.nature = 'capex'
         LEFT JOIN suppliers sup ON sup.id = c.supplier_id
         WHERE rc.request_id = $1`,
        [id]
      );
    }

    // Load OPEX items
    if (include.has('financials') || include.has('opex')) {
      result.opex_items = await mg.query(
        `SELECT s.id, s.product_name, s.description, s.currency, s.status,
                sup.name as supplier_name
         FROM portfolio_request_opex ro
         JOIN spend_items s ON s.id = ro.opex_id AND s.nature = 'opex'
         LEFT JOIN suppliers sup ON sup.id = s.supplier_id
         WHERE ro.request_id = $1`,
        [id]
      );
    }

    // Load business processes
    if (include.has('business_processes')) {
      result.business_processes = await mg.query(
        `SELECT bp.id, bp.name, bp.status
         FROM portfolio_request_business_processes rbp
         JOIN business_processes bp ON bp.id = rbp.business_process_id
         WHERE rbp.request_id = $1
         ORDER BY bp.name`,
        [id]
      );
    }

    // Load activity history
    if (include.has('activities')) {
      result.activities = await mg.query(
        `SELECT a.*, u.email, u.first_name, u.last_name
         FROM portfolio_activities a
         LEFT JOIN users u ON u.id = a.author_id
         WHERE a.request_id = $1
           AND a.tenant_id = app_current_tenant()
         ORDER BY a.created_at DESC, a.id`,
        [id]
      );
      const creators = await resolveRecordCreators(mg, 'portfolio_requests', [id]);
      result.created_by_name = creators.get(id) ?? null;
    }

    return result;
  }

  // ==================== ESTIMATED EFFORT ====================
  /**
   * Get estimated effort derived from Time estimation criteria values.
   * Used by the conversion dialog to pre-fill effort fields.
   */
  async getEstimatedEffort(
    requestId: string,
    tenantId: string,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);

    const request = await repo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    return this.criteriaService.calculateEffortFromCriteria(
      request.criteria_values || {},
      tenantId,
      { manager: mg }
    );
  }

  // ==================== CREATE ====================
  async create(
    body: Partial<PortfolioRequest>,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);

    if (!tenantId) throw new BadRequestException('Tenant context is required');

    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('name is required');
    const purposeContent = this.normalizeNullable(body.purpose);
    const risksContent = this.normalizeNullable(body.risks);

    const entity = repo.create({
      tenant_id: tenantId,
      name,
      requestor_id: body.requestor_id || userId,
      source_id: body.source_id || null,
      category_id: body.category_id || null,
      stream_id: body.stream_id || null,
      company_id: body.company_id || null,
      department_id: body.department_id || null,
      target_delivery_date: body.target_delivery_date || null,
      status: 'pending_review' as RequestStatus,

      // Note: Effort estimation is now derived from Time estimation criteria values

      // Analysis
      current_situation: this.normalizeNullable(body.current_situation),
      expected_benefits: this.normalizeNullable(body.expected_benefits),
      feasibility_review: this.normalizeFeasibilityReview(body.feasibility_review),

      // Team leads/sponsors
      business_sponsor_id: body.business_sponsor_id || null,
      business_lead_id: body.business_lead_id || null,
      it_sponsor_id: body.it_sponsor_id || null,
      it_lead_id: body.it_lead_id || null,

      // Metadata
      created_by_id: userId,
      criteria_values: {},
    });

    entity.item_number = await this.itemNumberService.nextItemNumber('request', tenantId, mg);
    const saved = await repo.save(entity);

    await this.integratedDocuments.provisionForRequest(
      {
        id: saved.id,
        tenant_id: saved.tenant_id,
        item_number: saved.item_number,
        name: saved.name,
      },
      {
        purpose: purposeContent,
        risks_mitigations: risksContent,
      },
      userId,
      { manager: mg },
    );

    await this.audit.log({
      table: 'portfolio_requests',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  async convertFromTask(
    taskId: string,
    overrides: ConvertFromTaskOverrides,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const requestRepo = mg.getRepository(PortfolioRequest);
    const taskRepo = mg.getRepository(Task);
    const requestAttachmentRepo = mg.getRepository(PortfolioRequestAttachment);
    const taskAttachmentRepo = mg.getRepository(TaskAttachment);

    if (!tenantId) throw new BadRequestException('Tenant context is required');

    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task || task.tenant_id !== tenantId) {
      throw new NotFoundException('Task not found');
    }

    const existingRequest = await requestRepo.findOne({ where: { origin_task_id: taskId } });
    if (existingRequest) {
      const requestRef = existingRequest.item_number ? `REQ-${existingRequest.item_number}` : existingRequest.id;
      throw new BadRequestException(`Task is already linked to request ${requestRef}`);
    }

    const hasNameOverride = Object.prototype.hasOwnProperty.call(overrides || {}, 'name');
    const name = String(hasNameOverride ? (overrides?.name || '') : (task.title || '')).trim();
    if (!name) throw new BadRequestException('name is required');

    const hasPurposeOverride = Object.prototype.hasOwnProperty.call(overrides || {}, 'purpose');
    const hasRequestorOverride = Object.prototype.hasOwnProperty.call(overrides || {}, 'requestor_id');
    const purposeContent = hasPurposeOverride
      ? this.normalizeNullable(overrides?.purpose)
      : this.normalizeNullable(task.description);

    const request = requestRepo.create({
      tenant_id: tenantId,
      name,
      requestor_id: hasRequestorOverride ? (overrides?.requestor_id || null) : (userId || task.creator_id || null),
      source_id: task.source_id || null,
      category_id: task.category_id || null,
      stream_id: task.stream_id || null,
      company_id: task.company_id || null,
      department_id: null,
      target_delivery_date: task.due_date || null,
      status: 'pending_review' as RequestStatus,
      current_situation: null,
      expected_benefits: null,
      feasibility_review: this.normalizeFeasibilityReview(null),
      criteria_values: {},
      created_by_id: userId,
      origin_task_id: task.id,
    });

    request.item_number = await this.itemNumberService.nextItemNumber('request', tenantId, mg);
    const savedRequest = await requestRepo.save(request);

    await this.integratedDocuments.provisionForRequest(
      {
        id: savedRequest.id,
        tenant_id: savedRequest.tenant_id,
        item_number: savedRequest.item_number,
        name: savedRequest.name,
      },
      {
        purpose: purposeContent,
        risks_mitigations: null,
      },
      userId,
      { manager: mg },
    );

    await this.audit.log({
      table: 'portfolio_requests',
      recordId: savedRequest.id,
      action: 'create',
      before: null,
      after: savedRequest,
      userId,
    }, { manager: mg });

    const taskAttachments = await taskAttachmentRepo.find({
      where: { task_id: task.id, source_field: IsNull() },
      order: { uploaded_at: 'ASC' },
    });
    if (taskAttachments.length > 0) {
      const toInsert = taskAttachments.map((att) => requestAttachmentRepo.create({
        tenant_id: tenantId,
        request_id: savedRequest.id,
        original_filename: att.original_filename,
        stored_filename: att.stored_filename,
        mime_type: att.mime_type,
        size: att.size,
        storage_path: att.storage_path,
        source_field: null,
      }));
      await requestAttachmentRepo.save(toInsert);
    }

    const taskLabel = task.item_number
      ? `T-${task.item_number}: ${task.title}`
      : `${task.title || task.id}`;
    const requestLabel = savedRequest.item_number
      ? `REQ-${savedRequest.item_number}: ${savedRequest.name}`
      : `${savedRequest.name || savedRequest.id}`;
    const originTaskUrl = this.normalizeOriginTaskUrl(overrides?.origin_task_url, task.id, task.item_number);

    await this.logActivity(mg, {
      request_id: savedRequest.id,
      tenant_id: tenantId,
      author_id: userId,
      type: 'comment',
      context: 'task_conversion',
      content: `Link to the originating task: <${originTaskUrl}>`,
    });

    await this.logActivity(mg, {
      request_id: savedRequest.id,
      tenant_id: tenantId,
      author_id: userId,
      type: 'change',
      changed_fields: { created_from_task: [null, taskLabel] },
    });

    await this.taskActivitiesSvc.logChange(
      task.id,
      { converted_to_request: [null, requestLabel] },
      tenantId,
      userId,
      { manager: mg },
    );

    if (overrides?.close_task === true && task.status !== 'done') {
      const beforeTask = { ...task };
      task.status = 'done';
      task.updated_at = new Date();
      const savedTask = await taskRepo.save(task);

      await this.audit.log({
        table: 'tasks',
        recordId: savedTask.id,
        action: 'update',
        before: beforeTask,
        after: savedTask,
        userId,
      }, { manager: mg });

      await this.taskActivitiesSvc.logChange(
        task.id,
        { status: [beforeTask.status, savedTask.status] },
        tenantId,
        userId,
        { manager: mg },
      );
    }

    return savedRequest;
  }

  // ==================== UPDATE ====================
  async update(
    id: string,
    body: Partial<PortfolioRequest> & {
      is_decision?: boolean;
      decision_outcome?: string;
      decision_context?: string;
      decision_rationale?: string;
    },
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);

    const existing = await repo.findOne({ where: { id } });
    if (!existing) throw new NotFoundException('Request not found');

    if (existing.status === 'converted') {
      throw new BadRequestException('Converted requests cannot be edited');
    }

    const before = { ...existing };
    const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key);
    const nextPurpose = has('purpose') ? this.normalizeNullable(body.purpose) : undefined;
    const nextRisks = has('risks') ? this.normalizeNullable(body.risks) : undefined;

    // Overview fields
    if (has('name')) {
      const name = String(body.name || '').trim();
      if (!name) throw new BadRequestException('name cannot be empty');
      existing.name = name;
    }
    if (has('source_id')) existing.source_id = body.source_id || null;
    if (has('category_id')) {
      existing.category_id = body.category_id || null;
      // Reset stream if category changed (stream must match category)
      if (existing.stream_id && body.category_id !== existing.category_id) {
        existing.stream_id = null;
      }
    }
    if (has('stream_id')) existing.stream_id = body.stream_id || null;
    if (has('company_id')) existing.company_id = body.company_id || null;
    if (has('department_id')) existing.department_id = body.department_id || null;
    if (has('requestor_id')) existing.requestor_id = body.requestor_id || null;
    if (has('target_delivery_date')) existing.target_delivery_date = body.target_delivery_date || null;

    // Status change with validation
    if (has('status')) {
      const newStatus = this.normalizeStatus(body.status);
      // Only validate if status is actually changing
      if (newStatus !== existing.status) {
        this.validateStatusTransition(existing.status, newStatus);
        existing.status = newStatus;
      }

      if (newStatus === 'converted' && !existing.converted_date) {
        existing.converted_date = new Date();
      }
    }

    // Note: Effort estimation is now derived from Time estimation criteria values

    // Analysis
    if (has('current_situation')) existing.current_situation = this.normalizeNullable(body.current_situation);
    if (has('expected_benefits')) existing.expected_benefits = this.normalizeNullable(body.expected_benefits);
    if (has('feasibility_review')) {
      existing.feasibility_review = this.normalizeFeasibilityReview(body.feasibility_review);
    }

    // Team
    if (has('business_sponsor_id')) existing.business_sponsor_id = body.business_sponsor_id || null;
    if (has('business_lead_id')) existing.business_lead_id = body.business_lead_id || null;
    if (has('it_sponsor_id')) existing.it_sponsor_id = body.it_sponsor_id || null;
    if (has('it_lead_id')) existing.it_lead_id = body.it_lead_id || null;

    existing.updated_at = new Date();

    const saved = await repo.save(existing);
    const sourceDescriptor = {
      id: saved.id,
      tenant_id: saved.tenant_id,
      item_number: saved.item_number,
      name: saved.name,
    };

    if (has('purpose')) {
      await this.integratedDocuments.writeSourceSlotContent(
        'requests',
        sourceDescriptor,
        'purpose',
        nextPurpose,
        userId,
        { manager: mg, logSourceActivity: true },
      );
    }
    if (has('risks')) {
      await this.integratedDocuments.writeSourceSlotContent(
        'requests',
        sourceDescriptor,
        'risks_mitigations',
        nextRisks,
        userId,
        { manager: mg, logSourceActivity: true },
      );
    }
    if (before.name !== saved.name) {
      await this.integratedDocuments.syncTitles('requests', sourceDescriptor, userId, { manager: mg });
    }

    // Log status change as activity (optionally as decision)
    if (has('status') && before.status !== saved.status) {
      const isDecision = body.is_decision === true;
      await this.logActivity(mg, {
        request_id: id,
        tenant_id: tenantId,
        author_id: userId,
        type: isDecision ? 'decision' : 'change',
        content: isDecision
          ? normalizeMarkdownRichText(body.decision_rationale, { fieldName: 'decision_rationale' })
          : null,
        context: isDecision ? (body.decision_context || null) : null,
        decision_outcome: isDecision ? (body.decision_outcome as any || null) : null,
        changed_fields: { status: [before.status, saved.status] },
      });

      // Notify status change (fire-and-forget)
      const recipients = await this.notifications.getRequestRecipients(id, mg);
      this.notifications.notifyStatusChange({
        itemType: 'request',
        itemId: id,
        itemName: saved.name,
        oldStatus: before.status,
        newStatus: saved.status,
        recipients,
        tenantId,
        excludeUserId: userId ?? undefined,
        manager: mg,
      });
    }

    // Notify when lead/sponsor roles are assigned to new users
    const roleChanges: Array<{ field: string; oldId: string | null; newId: string | null; role: string }> = [
      { field: 'business_sponsor_id', oldId: before.business_sponsor_id, newId: saved.business_sponsor_id, role: 'Business Sponsor' },
      { field: 'business_lead_id', oldId: before.business_lead_id, newId: saved.business_lead_id, role: 'Business Lead' },
      { field: 'it_sponsor_id', oldId: before.it_sponsor_id, newId: saved.it_sponsor_id, role: 'IT Sponsor' },
      { field: 'it_lead_id', oldId: before.it_lead_id, newId: saved.it_lead_id, role: 'IT Lead' },
    ];
    for (const change of roleChanges) {
      // Only notify if a NEW user is assigned (not when clearing or same user)
      // Exclude users with system roles (e.g., Contact) who cannot log in
      if (change.newId && change.newId !== change.oldId) {
        const user = await mg.query(
          `SELECT u.id, u.email, u.first_name, u.last_name, u.locale FROM users u
           JOIN roles ro ON ro.id = u.role_id
           WHERE u.id = $1 AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [change.newId],
        );
        if (user.length > 0) {
          // Notify the added user
          this.notifications.notifyTeamAdded({
            itemType: 'request',
            itemId: id,
            itemName: saved.name,
            role: change.role,
            addedUser: { userId: user[0].id, email: user[0].email, locale: user[0].locale },
            tenantId,
          });
          // Notify IT Lead about the team change
          const addedUserName = [user[0].first_name, user[0].last_name].filter(Boolean).join(' ') || 'Unknown';
          this.notifications.notifyItLeadOfTeamChange({
            itemType: 'request',
            itemId: id,
            itemName: saved.name,
            addedUserName,
            role: change.role,
            itLeadId: saved.it_lead_id,
            actorId: userId,
            addedUserId: user[0].id,
            tenantId,
          });
        }
      }
    }

    const changes = detectChanges(
      before as unknown as Record<string, unknown>,
      saved as unknown as Record<string, unknown>,
      REQUEST_TRACKED_FIELDS,
    );
    if (changes.length > 0) {
      const changedFields = await resolveDisplayNames(changes, REQUEST_TRACKED_FIELDS, mg);
      await this.logActivity(mg, {
        request_id: id,
        tenant_id: tenantId,
        author_id: userId,
        type: 'change',
        changed_fields: changedFields,
      });
    }

    await this.audit.log({
      table: 'portfolio_requests',
      recordId: id,
      action: 'update',
      before,
      after: saved,
      userId,
    }, { manager: mg });

    // Cleanup orphaned inline images for rich text fields
    const richTextFields = ['current_situation', 'expected_benefits'] as const;
    for (const field of richTextFields) {
      if (has(field) && before[field] !== saved[field]) {
        await this.cleanupOrphanedImages(id, field, before[field], saved[field], { manager: mg });
      }
    }

    return saved;
  }

  // ==================== TEAM MANAGEMENT ====================
  async bulkReplaceTeam(
    requestId: string,
    role: TeamRole,
    userIds: string[],
    opts?: { manager?: EntityManager; userId?: string | null },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestTeam);
    const actorId = this.requireActivityAuthor(opts?.userId);

    const unique = Array.from(new Set((userIds || []).filter(Boolean)));
    const existing = await repo.find({ where: { request_id: requestId, role } });
    const beforeIds = Array.from(new Set(existing.map((e) => e.user_id)));

    const toDelete = existing.filter((e) => !unique.includes(e.user_id));
    const existingSet = new Set(existing.map((e) => e.user_id));

    const request = await this.getRequestOrThrow(requestId, mg);

    const newUserIds = unique.filter((id) => !existingSet.has(id));
    const toInsert = newUserIds.map((id) => repo.create({
      tenant_id: request.tenant_id,
      request_id: requestId,
      user_id: id,
      role,
    }));

    if (toDelete.length > 0) await repo.remove(toDelete);
    if (toInsert.length > 0) await repo.save(toInsert);

    // Notify newly added team members (fire-and-forget)
    // Exclude users with system roles (e.g., Contact) who cannot log in
    if (newUserIds.length > 0) {
      const users = await mg.query(
        `SELECT u.id, u.email, u.first_name, u.last_name, u.locale FROM users u
         JOIN roles ro ON ro.id = u.role_id
         WHERE u.id = ANY($1) AND u.status = 'enabled'
           AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
        [newUserIds]
      );
      for (const user of users) {
        // Notify the added user
        this.notifications.notifyTeamAdded({
          itemType: 'request',
          itemId: requestId,
          itemName: request.name,
          role,
          addedUser: { userId: user.id, email: user.email, locale: user.locale },
          tenantId: request.tenant_id,
          manager: mg,
        });
        // Notify IT Lead about the team change
        const addedUserName = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'Unknown';
        this.notifications.notifyItLeadOfTeamChange({
          itemType: 'request',
          itemId: requestId,
          itemName: request.name,
          addedUserName,
          role,
          itLeadId: request.it_lead_id,
          actorId,
          addedUserId: user.id,
          tenantId: request.tenant_id,
        });
      }
    }

    const afterIds = Array.from(new Set(unique));
    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...afterIds].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeNames, afterNames] = await Promise.all([
        this.resolveUserNamesByIds(mg, beforeSorted),
        this.resolveUserNamesByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        request_id: requestId,
        tenant_id: request.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { [role]: [beforeNames, afterNames] },
      });
    }

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // ==================== CONTACTS MANAGEMENT ====================
  async bulkReplaceContacts(
    requestId: string,
    contactIds: string[],
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestContact);

    const unique = Array.from(new Set((contactIds || []).filter(Boolean)));
    const existing = await repo.find({ where: { request_id: requestId } });

    const toDelete = existing.filter((e) => !unique.includes(e.contact_id));
    const existingSet = new Set(existing.map((e) => e.contact_id));

    const request = await this.getRequestOrThrow(requestId, mg);

    const toInsert = unique
      .filter((id) => !existingSet.has(id))
      .map((id) => repo.create({
        tenant_id: request.tenant_id,
        request_id: requestId,
        contact_id: id,
      }));

    if (toDelete.length > 0) await repo.remove(toDelete);
    if (toInsert.length > 0) await repo.save(toInsert);

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // ==================== LINKED APPLICATIONS ====================
  async listLinkedApplications(
    requestId: string,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const request = await this.getRequestOrThrow(requestId, mg);
    const rows = await mg.query<Array<{ id: string; name: string | null; description: string | null }>>(
      `SELECT l.application_id AS id, a.name, a.description
       FROM portfolio_request_applications l
       JOIN applications a ON a.id = l.application_id
       WHERE l.request_id = $1
         AND l.tenant_id = $2
         AND a.tenant_id = $2
       ORDER BY a.name ASC`,
      [requestId, request.tenant_id],
    );
    return { items: rows };
  }

  async bulkReplaceApplications(
    requestId: string,
    applicationIds: string[],
    opts?: { manager?: EntityManager; userId?: string | null },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const actorId = this.requireActivityAuthor(opts?.userId);
    const request = await this.getRequestOrThrow(requestId, mg);

    const unique = Array.from(new Set((applicationIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (unique.length > 0) {
      const rows = await mg.query<Array<{ id: string }>>(
        `SELECT id
         FROM applications
         WHERE tenant_id = $1
           AND id = ANY($2::uuid[])`,
        [request.tenant_id, unique],
      );
      if (rows.length !== unique.length) {
        throw new BadRequestException('One or more applications were not found');
      }
    }

    const existing = await mg.query<Array<{ id: string; application_id: string }>>(
      `SELECT id, application_id
       FROM portfolio_request_applications
       WHERE request_id = $1
         AND tenant_id = $2`,
      [requestId, request.tenant_id],
    );
    const beforeIds = Array.from(new Set(existing.map((row) => row.application_id)));

    await mg.query(
      `DELETE FROM portfolio_request_applications
       WHERE request_id = $1
         AND tenant_id = $2`,
      [requestId, request.tenant_id],
    );

    if (unique.length > 0) {
      await mg.query(
        `INSERT INTO portfolio_request_applications (tenant_id, request_id, application_id)
         SELECT $1, $2, application_id
         FROM unnest($3::uuid[]) AS application_id`,
        [request.tenant_id, requestId, unique],
      );
    }

    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...unique].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveApplicationLabelsByIds(mg, beforeSorted),
        this.resolveApplicationLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        request_id: requestId,
        tenant_id: request.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { applications: [beforeLabels, afterLabels] },
      });
    }

    return { ok: true, count: unique.length };
  }

  // ==================== LINKED ASSETS ====================
  async listLinkedAssets(
    requestId: string,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const request = await this.getRequestOrThrow(requestId, mg);
    const rows = await mg.query<Array<{ id: string; name: string | null }>>(
      `SELECT l.asset_id AS id, a.name
       FROM portfolio_request_assets l
       JOIN assets a ON a.id = l.asset_id
       WHERE l.request_id = $1
         AND l.tenant_id = $2
         AND a.tenant_id = $2
       ORDER BY a.name ASC`,
      [requestId, request.tenant_id],
    );
    return { items: rows };
  }

  async bulkReplaceAssets(
    requestId: string,
    assetIds: string[],
    opts?: { manager?: EntityManager; userId?: string | null },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const actorId = this.requireActivityAuthor(opts?.userId);
    const request = await this.getRequestOrThrow(requestId, mg);

    const unique = Array.from(new Set((assetIds || []).map((id) => String(id || '').trim()).filter(Boolean)));
    if (unique.length > 0) {
      const rows = await mg.query<Array<{ id: string }>>(
        `SELECT id
         FROM assets
         WHERE tenant_id = $1
           AND id = ANY($2::uuid[])`,
        [request.tenant_id, unique],
      );
      if (rows.length !== unique.length) {
        throw new BadRequestException('One or more assets were not found');
      }
    }

    const existing = await mg.query<Array<{ id: string; asset_id: string }>>(
      `SELECT id, asset_id
       FROM portfolio_request_assets
       WHERE request_id = $1
         AND tenant_id = $2`,
      [requestId, request.tenant_id],
    );
    const beforeIds = Array.from(new Set(existing.map((row) => row.asset_id)));

    await mg.query(
      `DELETE FROM portfolio_request_assets
       WHERE request_id = $1
         AND tenant_id = $2`,
      [requestId, request.tenant_id],
    );

    if (unique.length > 0) {
      await mg.query(
        `INSERT INTO portfolio_request_assets (tenant_id, request_id, asset_id)
         SELECT $1, $2, asset_id
         FROM unnest($3::uuid[]) AS asset_id`,
        [request.tenant_id, requestId, unique],
      );
    }

    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...unique].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveAssetLabelsByIds(mg, beforeSorted),
        this.resolveAssetLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        request_id: requestId,
        tenant_id: request.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { assets: [beforeLabels, afterLabels] },
      });
    }

    return { ok: true, count: unique.length };
  }

  // ==================== CAPEX MANAGEMENT ====================
  async bulkReplaceCapex(
    requestId: string,
    capexIds: string[],
    opts?: { manager?: EntityManager; userId?: string | null },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestOpex);
    const actorId = this.requireActivityAuthor(opts?.userId);

    // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
    const unique = Array.from(new Set((capexIds || []).filter(Boolean).map((id) => String(id).toLowerCase())));
    const request = await this.getRequestOrThrow(requestId, mg);
    // The request's links to CAPEX lines only (one table with the OPEX ones since lot Z1,
    // `spend/budget-nature.ts`): a link to an OPEX line is neither replaced nor removed. Every id
    // given names a CAPEX line of the tenant, or the request is refused before anything is written.
    const stored = await repo.find({ where: { request_id: requestId } });
    const capexLines = await budgetLineIdsOfKind(mg, 'capex', request.tenant_id, [...stored.map((e) => e.opex_id), ...unique]);
    if (unique.some((id) => !capexLines.has(id))) throw new BadRequestException(CAPEX_ITEMS_NOT_FOUND);
    const existing = stored.filter((e) => capexLines.has(e.opex_id));
    const beforeIds = Array.from(new Set(existing.map((e) => e.opex_id)));

    const toDelete = existing.filter((e) => !unique.includes(e.opex_id));
    const existingSet = new Set(existing.map((e) => e.opex_id));

    const toInsert = unique
      .filter((id) => !existingSet.has(id))
      .map((id) => repo.create({
        tenant_id: request.tenant_id,
        request_id: requestId,
        opex_id: id,
      }));

    if (toDelete.length > 0) await repo.remove(toDelete);
    if (toInsert.length > 0) await repo.save(toInsert);

    const afterIds = Array.from(new Set(unique));
    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...afterIds].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveCapexLabelsByIds(mg, beforeSorted),
        this.resolveCapexLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        request_id: requestId,
        tenant_id: request.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { capex_items: [beforeLabels, afterLabels] },
      });
    }

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // ==================== OPEX MANAGEMENT ====================
  async bulkReplaceOpex(
    requestId: string,
    opexIds: string[],
    opts?: { manager?: EntityManager; userId?: string | null },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestOpex);
    const actorId = this.requireActivityAuthor(opts?.userId);

    // Stored ids are lower case: an upper-case id must compare equal to its stored twin.
    const unique = Array.from(new Set((opexIds || []).filter(Boolean).map((id) => String(id).toLowerCase())));
    const request = await this.getRequestOrThrow(requestId, mg);
    // The request's links to OPEX lines only (`spend/budget-nature.ts`): a link to a line of another
    // nature is neither replaced nor removed. Every id given names an OPEX line of the tenant, or
    // the request is refused before anything is written.
    const stored = await repo.find({ where: { request_id: requestId } });
    const opexLines = await budgetLineIdsOfKind(mg, 'opex', request.tenant_id, [...stored.map((e) => e.opex_id), ...unique]);
    if (unique.some((id) => !opexLines.has(id))) throw new BadRequestException(OPEX_ITEMS_NOT_FOUND);
    const existing = stored.filter((e) => opexLines.has(e.opex_id));
    const beforeIds = Array.from(new Set(existing.map((e) => e.opex_id)));

    const toDelete = existing.filter((e) => !unique.includes(e.opex_id));
    const existingSet = new Set(existing.map((e) => e.opex_id));

    const toInsert = unique
      .filter((id) => !existingSet.has(id))
      .map((id) => repo.create({
        tenant_id: request.tenant_id,
        request_id: requestId,
        opex_id: id,
      }));

    if (toDelete.length > 0) await repo.remove(toDelete);
    if (toInsert.length > 0) await repo.save(toInsert);

    const afterIds = Array.from(new Set(unique));
    const beforeSorted = [...beforeIds].sort();
    const afterSorted = [...afterIds].sort();
    if (JSON.stringify(beforeSorted) !== JSON.stringify(afterSorted)) {
      const [beforeLabels, afterLabels] = await Promise.all([
        this.resolveOpexLabelsByIds(mg, beforeSorted),
        this.resolveOpexLabelsByIds(mg, afterSorted),
      ]);
      await this.logActivity(mg, {
        request_id: requestId,
        tenant_id: request.tenant_id,
        author_id: actorId,
        type: 'change',
        changed_fields: { opex_items: [beforeLabels, afterLabels] },
      });
    }

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // ==================== BUSINESS PROCESSES MANAGEMENT ====================
  async bulkReplaceBusinessProcesses(
    requestId: string,
    businessProcessIds: string[],
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestBusinessProcess);

    const unique = Array.from(new Set((businessProcessIds || []).filter(Boolean)));
    const existing = await repo.find({ where: { request_id: requestId } });

    const toDelete = existing.filter((e) => !unique.includes(e.business_process_id));
    const existingSet = new Set(existing.map((e) => e.business_process_id));

    const request = await this.getRequestOrThrow(requestId, mg);

    const toInsert = unique
      .filter((id) => !existingSet.has(id))
      .map((id) => repo.create({
        tenant_id: request.tenant_id,
        request_id: requestId,
        business_process_id: id,
      }));

    if (toDelete.length > 0) await repo.remove(toDelete);
    if (toInsert.length > 0) await repo.save(toInsert);

    return { ok: true, added: toInsert.length, removed: toDelete.length };
  }

  // ==================== DEPENDENCIES MANAGEMENT ====================
  async addDependency(
    requestId: string,
    targetType: 'request' | 'project',
    targetId: string,
    tenantId: string,
    opts?: { manager?: EntityManager; userId?: string | null },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const actorId = this.requireActivityAuthor(opts?.userId);

    const request = await this.getRequestOrThrow(requestId, mg);

    // Validate target exists
    if (targetType === 'request') {
      const target = await mg.getRepository(PortfolioRequest).findOne({ where: { id: targetId } });
      if (!target) throw new NotFoundException('Target request not found');
      if (targetId === requestId) throw new BadRequestException('Cannot add self as dependency');
    } else {
      const target = await mg.getRepository(PortfolioProject).findOne({ where: { id: targetId } });
      if (!target) throw new NotFoundException('Target project not found');
    }

    // Check for circular dependency
    await this.checkCircularDependency(requestId, 'request', targetType, targetId, mg);

    // Check if already exists
    const repo = mg.getRepository(PortfolioRequestDependency);
    const whereClause = targetType === 'request'
      ? { request_id: requestId, depends_on_request_id: targetId }
      : { request_id: requestId, depends_on_project_id: targetId };
    const existing = await repo.findOne({ where: whereClause });
    if (existing) return { ok: true, message: 'Already linked' };

    // Create dependency
    const entity = repo.create({
      tenant_id: tenantId,
      request_id: requestId,
      depends_on_request_id: targetType === 'request' ? targetId : undefined,
      depends_on_project_id: targetType === 'project' ? targetId : undefined,
    });
    await repo.save(entity);

    await this.logActivity(mg, {
      request_id: requestId,
      tenant_id: request.tenant_id,
      author_id: actorId,
      type: 'change',
      changed_fields: {
        dependency: [null, await this.resolveDependencyTargetLabel(targetType, targetId, mg)],
      },
    });

    return { ok: true };
  }

  async removeDependency(
    requestId: string,
    targetType: 'request' | 'project',
    targetId: string,
    opts?: { manager?: EntityManager; userId?: string | null },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestDependency);
    const actorId = this.requireActivityAuthor(opts?.userId);
    const request = await this.getRequestOrThrow(requestId, mg);

    const whereClause = targetType === 'request'
      ? { request_id: requestId, depends_on_request_id: targetId }
      : { request_id: requestId, depends_on_project_id: targetId };

    const existing = await repo.findOne({ where: whereClause });
    if (!existing) return { ok: true };

    await repo.delete(whereClause);

    await this.logActivity(mg, {
      request_id: requestId,
      tenant_id: request.tenant_id,
      author_id: actorId,
      type: 'change',
      changed_fields: {
        dependency: [await this.resolveDependencyTargetLabel(targetType, targetId, mg), null],
      },
    });

    return { ok: true };
  }

  /**
   * Check for circular dependencies using DFS.
   * A circular dependency exists if we can reach the source from the target.
   */
  private async checkCircularDependency(
    sourceId: string,
    sourceType: 'request' | 'project',
    targetType: 'request' | 'project',
    targetId: string,
    mg: EntityManager,
  ) {
    const visited = new Set<string>();
    const stack: Array<{ id: string; type: 'request' | 'project' }> = [
      { id: targetId, type: targetType },
    ];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const key = `${current.type}:${current.id}`;

      if (visited.has(key)) continue;
      visited.add(key);

      // If we reach the source, we have a cycle
      if (current.id === sourceId && current.type === sourceType) {
        throw new BadRequestException('Cannot add dependency: would create a circular reference');
      }

      // Get dependencies of current item
      if (current.type === 'request') {
        const deps = await mg.query(
          `SELECT depends_on_request_id, depends_on_project_id FROM portfolio_request_dependencies WHERE request_id = $1`,
          [current.id]
        );
        for (const dep of deps) {
          if (dep.depends_on_request_id) {
            stack.push({ id: dep.depends_on_request_id, type: 'request' });
          }
          if (dep.depends_on_project_id) {
            stack.push({ id: dep.depends_on_project_id, type: 'project' });
          }
        }
      } else {
        // Projects can only depend on other projects
        const deps = await mg.query(
          `SELECT depends_on_project_id FROM portfolio_project_dependencies WHERE project_id = $1`,
          [current.id]
        );
        for (const dep of deps) {
          if (dep.depends_on_project_id) {
            stack.push({ id: dep.depends_on_project_id, type: 'project' });
          }
        }
      }
    }
  }

  // ==================== URLs MANAGEMENT ====================
  async replaceUrls(
    requestId: string,
    urls: Array<{ url: string; label?: string }>,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestUrl);

    const request = await this.getRequestOrThrow(requestId, mg);

    await repo.delete({ request_id: requestId });

    const toInsert = (urls || [])
      .filter((u) => u.url && String(u.url).trim())
      .map((u) => repo.create({
        tenant_id: request.tenant_id,
        request_id: requestId,
        url: String(u.url).trim(),
        label: u.label ? String(u.label).trim() : null,
      }));

    if (toInsert.length > 0) {
      await repo.save(toInsert);
    }

    return { ok: true, count: toInsert.length };
  }

  // ==================== COMMENTS ====================
  async addComment(
    requestId: string,
    content: string,
    context: string | null,
    tenantId: string,
    userId: string | null,
    opts?: {
      manager?: EntityManager;
      isDecision?: boolean;
      decisionOutcome?: string;
      newStatus?: string;
    },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);

    const request = await repo.findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');

    const isDecision = opts?.isDecision === true;
    const normalizedContent = normalizeMarkdownRichText(content, { fieldName: 'content' });
    let changedFields: Record<string, [unknown, unknown]> | null = null;
    let oldStatus: string | null = null;

    // Handle status change if requested (only for decisions)
    if (isDecision && opts?.newStatus) {
      const currentStatus = request.status;
      oldStatus = currentStatus;
      const newStatus = this.normalizeStatus(opts.newStatus);
      const before = { ...request };

      this.validateStatusTransition(currentStatus, newStatus);

      // Update request status
      request.status = newStatus;
      if (newStatus === 'converted') {
        request.converted_date = new Date();
      }
      await repo.save(request);
      await this.audit.log({
        table: 'portfolio_requests',
        recordId: request.id,
        action: 'update',
        before,
        after: request,
        userId,
      }, { manager: mg });

      changedFields = { status: [currentStatus, newStatus] };
    }

    const activity = await this.logActivity(mg, {
      request_id: requestId,
      tenant_id: tenantId,
      author_id: userId,
      type: isDecision ? 'decision' : 'comment',
      content: normalizedContent,
      context: context ? String(context).trim() : null,
      decision_outcome: isDecision ? (opts?.decisionOutcome as any || null) : null,
      changed_fields: changedFields,
    });

    // Notify status change if it occurred (fire-and-forget)
    if (oldStatus && changedFields) {
      const recipients = await this.notifications.getRequestRecipients(requestId, mg);
      this.notifications.notifyStatusChange({
        itemType: 'request',
        itemId: requestId,
        itemName: request.name,
        oldStatus,
        newStatus: request.status,
        recipients,
        tenantId,
        excludeUserId: userId ?? undefined,
        manager: mg,
      });
    }

    // Notify about comment (fire-and-forget)
    if (!isDecision && userId) {
      const authorData = await mg.query(
        `SELECT first_name, last_name FROM users WHERE id = $1`,
        [userId]
      );
      const authorName = authorData.length > 0
        ? `${authorData[0].first_name || ''} ${authorData[0].last_name || ''}`.trim() || 'Unknown'
        : 'Unknown';

      const recipients = await this.notifications.getRequestRecipients(requestId, mg);
      this.notifications.notifyComment({
        itemType: 'request',
        itemId: requestId,
        itemName: request.name,
        authorId: userId,
        authorName,
        commentContent: normalizedContent || '',
        recipients,
        tenantId,
        manager: mg,
      });
    }

    return activity;
  }

  async updateComment(
    requestId: string,
    activityId: string,
    content: string,
    userId: string,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const activityRepo = mg.getRepository(PortfolioActivity);

    // Find the activity
    const activity = await activityRepo.findOne({ where: { id: activityId, request_id: requestId } });
    if (!activity) throw new NotFoundException('Comment not found');

    // Only allow editing comments, not decisions or changes
    if (activity.type !== 'comment') {
      throw new BadRequestException('Only comments can be edited');
    }

    // Only allow the author to edit
    if (activity.author_id !== userId) {
      throw new ForbiddenException('You can only edit your own comments');
    }

    const oldContent = activity.content;
    activity.content = normalizeMarkdownRichText(content, { fieldName: 'content' });
    activity.updated_at = new Date();

    const saved = await activityRepo.save(activity);

    // Cleanup orphaned inline images
    await this.cleanupOrphanedImages(requestId, 'comment', oldContent, saved.content, { manager: mg });

    return saved;
  }

  private requireActivityAuthor(userId?: string | null): string {
    if (!userId) throw new BadRequestException('userId is required for change activity logging');
    return userId;
  }

  private async resolveUserNamesByIds(mg: EntityManager, userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; first_name: string | null; last_name: string | null; email: string | null }>>(
      `SELECT id, first_name, last_name, email
       FROM users
       WHERE id = ANY($1::uuid[])`,
      [userIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      const fullName = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
      byId.set(row.id, fullName || row.email || row.id);
    }
    return userIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveCapexLabelsByIds(mg: EntityManager, capexIds: string[]): Promise<string[]> {
    if (capexIds.length === 0) return [];
    // A CAPEX line's title is its `product_name` (lot Z1).
    const rows = await mg.query<Array<{ id: string; description: string | null }>>(
      `SELECT id, product_name AS description
       FROM spend_items
       WHERE id = ANY($1::uuid[]) AND nature = 'capex'`,
      [capexIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.description || row.id);
    }
    return capexIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveApplicationLabelsByIds(mg: EntityManager, applicationIds: string[]): Promise<string[]> {
    if (applicationIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; name: string | null }>>(
      `SELECT id, name
       FROM applications
       WHERE id = ANY($1::uuid[])`,
      [applicationIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.name || row.id);
    }
    return applicationIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveAssetLabelsByIds(mg: EntityManager, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; name: string | null }>>(
      `SELECT id, name
       FROM assets
       WHERE id = ANY($1::uuid[])`,
      [assetIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.name || row.id);
    }
    return assetIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveOpexLabelsByIds(mg: EntityManager, opexIds: string[]): Promise<string[]> {
    if (opexIds.length === 0) return [];
    const rows = await mg.query<Array<{ id: string; product_name: string | null; description: string | null }>>(
      `SELECT id, product_name, description
       FROM spend_items
       WHERE id = ANY($1::uuid[]) AND nature = 'opex'`,
      [opexIds],
    );
    const byId = new Map<string, string>();
    for (const row of rows) {
      byId.set(row.id, row.product_name || row.description || row.id);
    }
    return opexIds.map((id) => byId.get(id) ?? id).sort((a, b) => a.localeCompare(b));
  }

  private async resolveDependencyTargetLabel(
    targetType: 'request' | 'project',
    targetId: string,
    mg: EntityManager,
  ): Promise<string> {
    if (targetType === 'request') {
      const [row] = await mg.query<Array<{ item_number: number | null; name: string | null }>>(
        'SELECT item_number, name FROM portfolio_requests WHERE id = $1 LIMIT 1',
        [targetId],
      );
      if (!row) return targetId;
      const prefix = row.item_number ? `REQ-${row.item_number}: ` : 'Request: ';
      return `${prefix}${row.name || targetId}`;
    }

    const [row] = await mg.query<Array<{ item_number: number | null; name: string | null }>>(
      'SELECT item_number, name FROM portfolio_projects WHERE id = $1 LIMIT 1',
      [targetId],
    );
    if (!row) return targetId;
    const prefix = row.item_number ? `PRJ-${row.item_number}: ` : 'Project: ';
    return `${prefix}${row.name || targetId}`;
  }

  private async logActivity(
    mg: EntityManager,
    data: Partial<PortfolioActivity>,
  ) {
    const repo = mg.getRepository(PortfolioActivity);
    const activity = repo.create(data);
    return repo.save(activity);
  }

  private async getRequestOrThrow(requestId: string, mg: EntityManager) {
    const request = await mg.getRepository(PortfolioRequest).findOne({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  // ==================== ATTACHMENTS ====================
  async uploadAttachment(
    requestId: string,
    file: Express.Multer.File,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;

    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 20 MB limit');
    }

    const request = await this.getRequestOrThrow(requestId, mg);

    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: file.mimetype,
      buffer: buf,
      size: file.size,
    });
    const originalName = decodedName || `attachment${validated.extension}`;
    const stored = `${randomUUID()}_${originalName}`;
    const key = path.posix.join(
      'files',
      request.tenant_id,
      'portfolio-requests',
      requestId,
      stored
    );

    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const repo = mg.getRepository(PortfolioRequestAttachment);
    const saved = await repo.save(repo.create({
      tenant_id: request.tenant_id,
      request_id: requestId,
      original_filename: originalName,
      stored_filename: stored,
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: key,
    }));

    await this.audit.log({
      table: 'portfolio_request_attachments',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
    }, { manager: mg });

    return saved;
  }

  async deleteAttachment(
    attachmentId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestAttachment);

    const attachment = await repo.findOne({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Attachment not found');

    const isReferencedElsewhere = await isStoragePathReferencedInAnyTable(
      mg,
      attachment.storage_path,
      [attachment.id],
    );
    if (!isReferencedElsewhere) {
      try {
        await this.storage.deleteObject(attachment.storage_path);
      } catch (e) {
        // Log but don't fail
      }
    }

    await repo.delete({ id: attachmentId });

    await this.audit.log({
      table: 'portfolio_request_attachments',
      recordId: attachmentId,
      action: 'delete',
      before: attachment,
      after: null,
      userId,
    }, { manager: mg });

    return { ok: true };
  }

  async getAttachment(
    attachmentId: string,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestAttachment);

    const attachment = await repo.findOne({ where: { id: attachmentId } });
    if (!attachment) throw new NotFoundException('Attachment not found');

    return attachment;
  }

  // Upload inline attachment for rich text editor (images embedded in content)
  async uploadInlineAttachment(
    requestId: string,
    file: Express.Multer.File,
    sourceField: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;

    if (!file) throw new BadRequestException('No file uploaded');
    if (file.size > 20 * 1024 * 1024) {
      throw new BadRequestException('File size exceeds 20 MB limit');
    }

    const request = await this.getRequestOrThrow(requestId, mg);

    const buf = Buffer.isBuffer(file.buffer) ? file.buffer : Buffer.from(file.buffer as any);
    const decodedName = fixMulterFilename(file.originalname);
    const validated = validateUploadedFile({
      originalName: decodedName,
      mimeType: file.mimetype,
      buffer: buf,
      size: file.size,
    }, { scope: 'inline-image' });
    const originalName = decodedName || `image${validated.extension}`;
    const stored = `${randomUUID()}_${originalName}`;
    const key = path.posix.join(
      'files',
      request.tenant_id,
      'portfolio-requests',
      requestId,
      'inline',
      stored
    );

    await this.storage.putObject({
      key,
      body: buf,
      contentType: validated.mimeType,
      contentLength: validated.size,
      sse: 'AES256',
    });

    const repo = mg.getRepository(PortfolioRequestAttachment);
    const saved = await repo.save(repo.create({
      tenant_id: request.tenant_id,
      request_id: requestId,
      original_filename: originalName,
      stored_filename: stored,
      mime_type: validated.mimeType || null,
      size: validated.size,
      storage_path: key,
      source_field: sourceField,
    }));

    return saved;
  }

  async importInlineAttachmentFromUrl(
    requestId: string,
    sourceUrl: string,
    sourceField: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const file = await this.remoteInlineImages.importFromUrl(sourceUrl);
    return this.uploadInlineAttachment(requestId, file, sourceField, userId, opts);
  }

  // Cleanup orphaned inline images when rich text content is updated
  async cleanupOrphanedImages(
    requestId: string,
    sourceField: string,
    oldContent: string | null,
    newContent: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequestAttachment);

    const oldUrls = extractInlineImageUrls(oldContent);
    const newUrls = new Set(extractInlineImageUrls(newContent));

    // Find URLs that were in old content but not in new content
    const removedUrls = oldUrls.filter(url => !newUrls.has(url));

    for (const url of removedUrls) {
      // Extract attachment ID from URL (pattern: /inline/{tenantSlug}/{attachmentId})
      const match = url.match(/\/inline\/[^/]+\/([a-f0-9-]+)\/?(?:\?.*)?$/i);
      if (match) {
        const attachmentId = match[1];
        try {
          const attachment = await repo.findOne({
            where: { id: attachmentId, request_id: requestId, source_field: sourceField },
          });
          if (attachment) {
            const referenced = await isStoragePathReferencedInAnyTable(mg, attachment.storage_path, [attachment.id]);
            await repo.delete({ id: attachmentId });
            if (!referenced) {
              try { await this.storage.deleteObject(attachment.storage_path); } catch {}
            }
          }
        } catch {
          // Ignore errors - image may have already been deleted
        }
      }
    }
  }

  private normalizeNullable(value: unknown): string | null {
    return normalizeMarkdownRichText(value);
  }

  private normalizeOriginTaskUrl(
    value: unknown,
    taskId: string,
    taskItemNumber: number | null,
  ): string {
    const taskLinkId = taskItemNumber ? `T-${taskItemNumber}` : taskId;
    const fallback = `/portfolio/tasks/${taskLinkId}/overview`;
    if (value == null) return fallback;

    const text = String(value).trim();
    if (!text) return fallback;

    if (text.startsWith('/')) return text;

    try {
      const parsed = new URL(text);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.toString();
      }
    } catch {
      return fallback;
    }

    return fallback;
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private normalizeFeasibilityStatus(value: unknown): FeasibilityReviewStatus {
    const status = String(value || '').trim().toLowerCase();
    if (FEASIBILITY_REVIEW_STATUSES.includes(status as FeasibilityReviewStatus)) {
      return status as FeasibilityReviewStatus;
    }
    return 'not_assessed';
  }

  private normalizeFeasibilityReviewEntry(value: unknown): FeasibilityReviewEntry {
    const raw = (value && typeof value === 'object' && !Array.isArray(value))
      ? (value as Record<string, unknown>)
      : {};

    return {
      status: this.normalizeFeasibilityStatus(raw.status),
      comment: String(raw.comment ?? ''),
    };
  }

  private normalizeFeasibilityReview(value: unknown): FeasibilityReview {
    const source = (value && typeof value === 'object' && !Array.isArray(value))
      ? (value as Record<string, unknown>)
      : {};

    const normalized = {} as FeasibilityReview;
    for (const key of FEASIBILITY_REVIEW_KEYS) {
      normalized[key] = this.normalizeFeasibilityReviewEntry(source[key]);
    }
    return normalized;
  }

  private isSameFeasibilityReview(a: unknown, b: unknown): boolean {
    return JSON.stringify(this.normalizeFeasibilityReview(a)) === JSON.stringify(this.normalizeFeasibilityReview(b));
  }

  private normalizeStatus(value: unknown): RequestStatus {
    const v = String(value || '').trim().toLowerCase();
    const valid: RequestStatus[] = [
      'pending_review', 'candidate', 'approved', 'on_hold', 'rejected', 'converted',
    ];
    if (!valid.includes(v as RequestStatus)) {
      throw new BadRequestException(`Invalid status: ${value}`);
    }
    return v as RequestStatus;
  }

  private validateStatusTransition(current: RequestStatus, next: RequestStatus) {
    const allowed: Record<RequestStatus, RequestStatus[]> = {
      pending_review: ['candidate', 'approved', 'rejected', 'on_hold'],
      candidate: ['approved', 'rejected', 'on_hold'],
      approved: ['converted'],
      on_hold: ['pending_review', 'candidate', 'rejected'],
      rejected: ['pending_review'],
      converted: [],
    };

    if (!allowed[current].includes(next)) {
      throw new BadRequestException(
        `Cannot transition from '${current}' to '${next}'`
      );
    }
  }

  // ==================== DELETE ====================
  async delete(
    id: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ) {
    const mg = opts?.manager ?? this.repo.manager;
    const repo = mg.getRepository(PortfolioRequest);

    const request = await repo.findOne({ where: { id } });
    if (!request) throw new NotFoundException('Request not found');

    if (request.status === 'converted') {
      throw new BadRequestException('Converted requests cannot be deleted');
    }

    await this.integratedDocuments.deleteForEntity('requests', id, userId, { manager: mg });

    // Delete all attachment files from S3 before cascade removes DB rows
    const attachments: PortfolioRequestAttachment[] = await mg
      .getRepository(PortfolioRequestAttachment)
      .find({ where: { request_id: id } });

    const excludedRequestAttachmentIds = attachments.map((att) => att.id);

    for (const att of attachments) {
      const isReferencedElsewhere = await isStoragePathReferencedInAnyTable(
        mg,
        att.storage_path,
        excludedRequestAttachmentIds,
      );
      if (!isReferencedElsewhere) {
        try {
          await this.storage.deleteObject(att.storage_path);
        } catch {
          // Log but don't fail — orphaned S3 objects are preferable to a blocked delete
        }
      }
    }

    const before = { ...request };
    await repo.delete({ id });

    await this.audit.log({
      table: 'portfolio_requests',
      recordId: id,
      action: 'delete',
      before,
      after: null,
      userId,
    }, { manager: mg });

    return { ok: true };
  }

  async shareRequest(
    requestId: string,
    dto: ShareItemDto,
    tenantId: string,
    userId: string,
    opts?: { manager?: EntityManager },
  ) {
    const userIds = dto.recipient_user_ids ?? [];
    const rawEmails = dto.recipient_emails ?? [];
    if (userIds.length === 0 && rawEmails.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }

    const mg = opts?.manager ?? this.repo.manager;

    const request = await mg.findOne(PortfolioRequest, {
      where: { id: requestId },
      select: ['id', 'name'],
    });
    if (!request) throw new NotFoundException('Request not found');

    const senderRows = await mg.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [userId],
    );
    const senderName = senderRows.length > 0
      ? `${senderRows[0].first_name} ${senderRows[0].last_name}`.trim() || 'Someone'
      : 'Someone';

    const recipientRows = userIds.length > 0
      ? await mg.query(
          `SELECT u.id AS "userId", u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.locale
           FROM users u
           JOIN roles ro ON ro.id = u.role_id
           WHERE u.id = ANY($1) AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [userIds],
        )
      : [];

    if (recipientRows.length > 0 || rawEmails.length > 0) {
      this.notifications.notifyShare({
        itemType: 'request',
        itemId: requestId,
        itemName: request.name,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
      });
    }

    return { success: true };
  }
}
