import { BadRequestException, Injectable } from '@nestjs/common';
import { normalizeAgFilterModel } from '../../common/ag-grid-filtering';
import { bilingualDocumentTsQuerySql } from '../../common/document-search-tsquery';
import { AccountsService } from '../../accounts/accounts.service';
import { ChartOfAccountsService } from '../../accounts/chart-of-accounts.service';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { ApplicationsService } from '../../applications/services';
import { AssetsService } from '../../assets/services';
import { BusinessProcessesService } from '../../business-processes/business-processes.service';
import { CapexItemsService } from '../../capex/capex-items.service';
import { CompaniesService } from '../../companies/companies.service';
import { ConnectionsService } from '../../connections/services';
import { ContactsService } from '../../contacts/contacts.service';
import { ContractsService } from '../../contracts/contracts.service';
import { DepartmentsService } from '../../departments/departments.service';
import { IncidentsService } from '../../incidents/services';
import { resolveIncidentViewer } from '../../incidents/incident-visibility';
import { InterfacesService } from '../../interfaces/services';
import { Document } from '../../knowledge/document.entity';
import { isDocumentStatus } from '../../knowledge/document-status';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import {
  documentIncidentVisibilityQueryBuilderClause,
} from '../../knowledge/document-entity-visibility';
import { LocationsService } from '../../locations/locations.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioProjectsService } from '../../portfolio/services';
import { SpendItemsService } from '../../spend/spend-items.service';
import { TasksService } from '../../spend/tasks.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { UsersService } from '../../users/users.service';
import { AiExecutionContextWithManager, AiQueryEntityType, AiQueryScope } from '../ai.types';
import { adaptFilters } from './ai-filter.adapter';
import {
  buildFilterRepairSuggestions,
  hasEmailOrUuidFilterValue,
} from './ai-filter-description.util';
import {
  applyScopeToAiQuery,
  resolveAiDocumentIncidentViewer,
  resolveAiParticipationAccessScope,
  ResolvedAiScope,
} from './ai-query-scope.util';
import {
  AiAggregateMetricDef,
  AiAggregateMetricType,
  AiAggregateResult,
  AiDateFilterValue,
  AiEntityFilterRegistry,
  AiFilterValue,
} from './ai-filter.types';
import { assertPlainTextQuickSearch } from './ai-quick-search-validation.util';
import { resolveAiEntityRegistry } from './registries';
import { getSpendSummaryFieldValue, resolveFteField } from '../../spend/spend-summary.builder';
import { formatCents, toCents } from '../../common/amount';
import { Decimal, divRoundHalfAway } from '../../common/decimal';

type DocumentSearchState = { term: string; itemNumber: number | null };
type AiAggregateFunction = 'count' | 'sum' | 'avg' | 'min' | 'max';
type DocumentLinkedEntityField =
  | 'linked_application'
  | 'linked_asset'
  | 'linked_project'
  | 'linked_request'
  | 'linked_task';
type DocumentLinkedEntitySurface =
  | {
      kind: 'legacy';
      table: string;
      relationAlias: string;
      relationIdColumn: string;
      targetTable: string;
      targetAlias: string;
      targetMatchExpressions: string[];
    }
  | {
      kind: 'integrated';
      relationAlias: string;
      sourceEntityType: 'applications' | 'assets' | 'projects' | 'requests';
      targetTable: string;
      targetAlias: string;
      targetMatchExpressions: string[];
    };
type SupportedAggregateEntityType =
  'accounts'
  | 'analytics_categories'
  | 'applications'
  | 'assets'
  | 'business_processes'
  | 'capex_items'
  | 'chart_of_accounts'
  | 'companies'
  | 'connections'
  | 'contacts'
  | 'contracts'
  | 'departments'
  | 'incidents'
  | 'interfaces'
  | 'locations'
  | 'projects'
  | 'requests'
  | 'spend_items'
  | 'suppliers'
  | 'tasks'
  | 'users'
  | 'documents';

const AGGREGATE_ID_COLLECTION_LIMIT = 10_000;

const DOCUMENT_LINKED_ENTITY_FILTERS: Record<DocumentLinkedEntityField, DocumentLinkedEntitySurface[]> = {
  linked_application: [
    {
      kind: 'legacy',
      table: 'document_applications',
      relationAlias: 'da_link',
      relationIdColumn: 'application_id',
      targetTable: 'applications',
      targetAlias: 'a_link',
      targetMatchExpressions: ['a_link.name'],
    },
  ],
  linked_asset: [
    {
      kind: 'legacy',
      table: 'document_assets',
      relationAlias: 'da_link',
      relationIdColumn: 'asset_id',
      targetTable: 'assets',
      targetAlias: 'ast_link',
      targetMatchExpressions: ['ast_link.name', 'ast_link.hostname', 'ast_link.fqdn'],
    },
  ],
  linked_project: [
    {
      kind: 'legacy',
      table: 'document_projects',
      relationAlias: 'dp_link',
      relationIdColumn: 'project_id',
      targetTable: 'portfolio_projects',
      targetAlias: 'p_link',
      targetMatchExpressions: ['p_link.name', `('PRJ-' || p_link.item_number::text)`],
    },
    {
      kind: 'integrated',
      relationAlias: 'idb_project_link',
      sourceEntityType: 'projects',
      targetTable: 'portfolio_projects',
      targetAlias: 'p_link',
      targetMatchExpressions: ['p_link.name', `('PRJ-' || p_link.item_number::text)`],
    },
  ],
  linked_request: [
    {
      kind: 'legacy',
      table: 'document_requests',
      relationAlias: 'dr_link',
      relationIdColumn: 'request_id',
      targetTable: 'portfolio_requests',
      targetAlias: 'r_link',
      targetMatchExpressions: ['r_link.name', `('REQ-' || r_link.item_number::text)`],
    },
    {
      kind: 'integrated',
      relationAlias: 'idb_request_link',
      sourceEntityType: 'requests',
      targetTable: 'portfolio_requests',
      targetAlias: 'r_link',
      targetMatchExpressions: ['r_link.name', `('REQ-' || r_link.item_number::text)`],
    },
  ],
  linked_task: [
    {
      kind: 'legacy',
      table: 'document_tasks',
      relationAlias: 'dt_link',
      relationIdColumn: 'task_id',
      targetTable: 'tasks',
      targetAlias: 't_link',
      targetMatchExpressions: ['t_link.title', `('T-' || t_link.item_number::text)`],
    },
  ],
};

function parseDocumentItemNumberQuery(input: string): number | null {
  const value = String(input || '').trim();
  if (!value) return null;
  const match = value.match(/(?:^[A-Z]+-)?(\d+)$/i);
  if (!match) return null;
  const itemNumber = Number(match[1]);
  return Number.isFinite(itemNumber) && itemNumber > 0 ? itemNumber : null;
}

function getDocumentSearchState(input?: string): DocumentSearchState | null {
  const term = String(input || '').trim();
  if (!term) return null;
  return {
    term,
    itemNumber: parseDocumentItemNumberQuery(term),
  };
}

function buildDocumentSearchSql(
  alias: string,
  search: DocumentSearchState,
): { clause: string; params: Record<string, string | number> } {
  const params: Record<string, string | number> = {
    searchTerm: search.term,
    searchLike: `%${search.term}%`,
  };
  const clauses = [
    `${alias}.search_vector @@ ${bilingualDocumentTsQuerySql(':searchTerm')}`,
    `${alias}.title ILIKE :searchLike`,
    `COALESCE(${alias}.summary, '') ILIKE :searchLike`,
    `COALESCE(${alias}.content_plain, '') ILIKE :searchLike`,
    `COALESCE(${alias}.content_markdown, '') ILIKE :searchLike`,
  ];
  if (search.itemNumber != null) {
    params.searchItemNumber = search.itemNumber;
    clauses.unshift(`${alias}.item_number = :searchItemNumber`);
  }
  return {
    clause: `(${clauses.join(' OR ')})`,
    params,
  };
}

function compileDateFilterCondition(
  rawModel: any,
  expression: string,
  nextParam: () => string,
): { sql: string; params: Record<string, any> } | null {
  const model = normalizeAgFilterModel(rawModel);
  if (!model || typeof model !== 'object') return null;

  const filterCategory = String(model.filterType ?? 'date');
  const type = String(model.type ?? 'equals');
  const fromRaw = model.dateFrom ?? model.filter ?? model.value;
  const toRaw = model.dateTo ?? model.filterTo ?? model.valueTo;

  if (filterCategory !== 'date' && filterCategory !== 'text') return null;

  if (type === 'blank') return { sql: `${expression} IS NULL`, params: {} };
  if (type === 'notBlank') return { sql: `${expression} IS NOT NULL`, params: {} };

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
    case 'lessThan':
      return { sql: `${expression} < ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'lessThanOrEqual':
      return { sql: `${expression} <= ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'greaterThan':
      return { sql: `${expression} > ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'greaterThanOrEqual':
      return { sql: `${expression} >= ${castParam(param)}`, params: { [param]: fromRaw } };
    case 'notEqual':
      return { sql: `${expression} <> ${castParam(param)}`, params: { [param]: fromRaw } };
    default:
      return null;
  }
}

function buildDocumentLinkedEntityExistsClause(
  surface: DocumentLinkedEntitySurface,
  documentAlias: string,
  predicateSql?: string,
): string {
  if (surface.kind === 'legacy') {
    return `EXISTS (
      SELECT 1
      FROM ${surface.table} ${surface.relationAlias}
      JOIN ${surface.targetTable} ${surface.targetAlias}
        ON ${surface.targetAlias}.id = ${surface.relationAlias}.${surface.relationIdColumn}
       AND ${surface.targetAlias}.tenant_id = ${documentAlias}.tenant_id
      WHERE ${surface.relationAlias}.document_id = ${documentAlias}.id
        AND ${surface.relationAlias}.tenant_id = ${documentAlias}.tenant_id
        ${predicateSql ? `AND (${predicateSql})` : ''}
    )`;
  }

  return `EXISTS (
    SELECT 1
    FROM integrated_document_bindings ${surface.relationAlias}
    JOIN ${surface.targetTable} ${surface.targetAlias}
      ON ${surface.targetAlias}.id = ${surface.relationAlias}.source_entity_id
     AND ${surface.targetAlias}.tenant_id = ${documentAlias}.tenant_id
    WHERE ${surface.relationAlias}.document_id = ${documentAlias}.id
      AND ${surface.relationAlias}.tenant_id = ${documentAlias}.tenant_id
      AND ${surface.relationAlias}.source_entity_type = '${surface.sourceEntityType}'
      ${predicateSql ? `AND (${predicateSql})` : ''}
  )`;
}

function buildDocumentLinkedEntityExistsGroup(
  field: DocumentLinkedEntityField,
  documentAlias: string,
  predicateFactory?: (surface: DocumentLinkedEntitySurface) => string,
): string {
  const clauses = DOCUMENT_LINKED_ENTITY_FILTERS[field].map((surface) =>
    buildDocumentLinkedEntityExistsClause(
      surface,
      documentAlias,
      predicateFactory ? predicateFactory(surface) : undefined,
    ),
  );
  return clauses.length === 1 ? clauses[0] : `(${clauses.join(' OR ')})`;
}

function compileDocumentLinkedEntityFilterCondition(
  field: DocumentLinkedEntityField,
  rawModel: any,
  documentAlias: string,
  paramRef: string,
): { sql: string; value?: string } | null {
  const model = normalizeAgFilterModel(rawModel);
  if (!model || typeof model !== 'object') return null;

  const type = String(model.type ?? 'contains');
  const anyLinkedSql = buildDocumentLinkedEntityExistsGroup(field, documentAlias);

  if (type === 'blank') return { sql: `NOT ${anyLinkedSql}` };
  if (type === 'notBlank') return { sql: anyLinkedSql };

  const filterText = String(model.filter ?? model.value ?? '').trim();
  if (!filterText) return null;

  let value = filterText;
  let predicateKind: 'equals' | 'contains' = 'contains';
  let negate = false;

  switch (type) {
    case 'equals':
      predicateKind = 'equals';
      break;
    case 'notEqual':
      predicateKind = 'equals';
      negate = true;
      break;
    case 'startsWith':
      value = `${filterText}%`;
      break;
    case 'endsWith':
      value = `%${filterText}`;
      break;
    case 'notContains':
      value = `%${filterText}%`;
      negate = true;
      break;
    case 'contains':
    default:
      value = `%${filterText}%`;
      break;
  }

  const matchSql = buildDocumentLinkedEntityExistsGroup(field, documentAlias, (surface) => {
    const comparisons = surface.targetMatchExpressions.map((expression) =>
      predicateKind === 'equals'
        ? `${expression} = ${paramRef}`
        : `${expression} ILIKE ${paramRef}`,
    );
    return comparisons.length === 1 ? comparisons[0] : `(${comparisons.join(' OR ')})`;
  });

  return {
    sql: negate ? `NOT ${matchSql}` : matchSql,
    value,
  };
}

function normalizeAggregateFunction(value?: string | null): AiAggregateFunction {
  return value === 'sum' || value === 'avg' || value === 'min' || value === 'max'
    ? value
    : 'count';
}

function getMetricOrderDirection(fn: AiAggregateFunction): 'ASC' | 'DESC' {
  return fn === 'min' ? 'ASC' : 'DESC';
}

function buildMetricAggregateExpression(fn: AiAggregateFunction, expression: string): string {
  switch (fn) {
    case 'sum':
      return `SUM(${expression})`;
    case 'avg':
      return `AVG(${expression})`;
    case 'min':
      return `MIN(${expression})`;
    case 'max':
      return `MAX(${expression})`;
    default:
      return 'COUNT(*)::int';
  }
}

type BudgetValueGroup = { key: string | null; value: number | null; unknown?: number };

/** Largest value first (smallest for min), groups without a value last, then by key. */
function sortValueGroups<T extends BudgetValueGroup>(groups: T[], fn: AiAggregateFunction): T[] {
  return groups.sort((a, b) => {
    const av = a.value;
    const bv = b.value;
    if (av == null && bv == null) return (a.key ?? '').localeCompare(b.key ?? '');
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av !== bv) {
      return fn === 'min' ? av - bv : bv - av;
    }
    return (a.key ?? '').localeCompare(b.key ?? '');
  });
}

/**
 * An FTE metric of the OPEX and CAPEX aggregates: exact decimal arithmetic on
 * the lines' FTE (2 decimals each, never through cents of money), and per group
 * `unknown`, the lines whose column has no quantity × price lines, left out of the value. A group
 * of unknown lines only has a null value.
 */
function aggregateFteGroups(rows: any[], groupGrid: string, metricGrid: string, fn: AiAggregateFunction): BudgetValueGroup[] {
  type FteBucket = { key: string | null; sum: Decimal; count: number; unknown: number; min: Decimal | null; max: Decimal | null };
  const buckets = new Map<string, FteBucket>();
  for (const row of rows) {
    const rawKey = getSpendSummaryFieldValue(row, groupGrid);
    const key = rawKey == null || rawKey === '' ? null : String(rawKey);
    const bucketKey = key ?? '__NULL__';
    const bucket = buckets.get(bucketKey) ?? { key, sum: Decimal.ZERO, count: 0, unknown: 0, min: null, max: null };
    buckets.set(bucketKey, bucket);
    const raw = getSpendSummaryFieldValue(row, metricGrid);
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      bucket.unknown += 1;
      continue;
    }
    const value = Decimal.from(raw);
    bucket.sum = bucket.sum.add(value);
    bucket.count += 1;
    if (bucket.min == null || value.cmp(bucket.min) < 0) bucket.min = value;
    if (bucket.max == null || value.cmp(bucket.max) > 0) bucket.max = value;
  }
  const toNumber = (value: Decimal | null) => (value == null ? null : Number(value.toString()));
  return Array.from(buckets.values()).map((bucket) => {
    let value: number | null = null;
    if (bucket.count > 0) {
      switch (fn) {
        case 'sum':
          value = toNumber(bucket.sum);
          break;
        case 'avg':
          // Rounded once to 2 decimals, like the line values.
          value = toNumber(bucket.sum.divRound(bucket.count, 2));
          break;
        case 'min':
          value = toNumber(bucket.min);
          break;
        case 'max':
          value = toNumber(bucket.max);
          break;
        default:
          value = null;
      }
    }
    return { key: bucket.key, value, unknown: bucket.unknown };
  });
}

function normalizeAggregateValue(value: any, metricType: AiAggregateMetricType): number | string | null {
  if (value == null) return null;
  if (metricType === 'number') {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return String(value);
}

@Injectable()
export class AiAggregateExecutor {
  constructor(
    private readonly tasks: TasksService,
    private readonly projects: PortfolioProjectsService,
    private readonly requests: PortfolioRequestsService,
    private readonly applications: ApplicationsService,
    private readonly assets: AssetsService,
    private readonly spendItems: SpendItemsService,
    private readonly contracts: ContractsService,
    private readonly companies: CompaniesService,
    private readonly suppliers: SuppliersService,
    private readonly departments: DepartmentsService,
    private readonly knowledge: KnowledgeService,
    private readonly locations: LocationsService,
    private readonly users: UsersService,
    private readonly accounts: AccountsService,
    private readonly chartOfAccounts: ChartOfAccountsService,
    private readonly analyticsCategories: AnalyticsCategoriesService,
    private readonly businessProcesses: BusinessProcessesService,
    private readonly capexItems: CapexItemsService,
    private readonly contacts: ContactsService,
    private readonly interfaces: InterfacesService,
    private readonly connections: ConnectionsService,
    private readonly incidents: IncidentsService,
  ) {}

  private async normalizePersonFilters(
    context: AiExecutionContextWithManager,
    entityType: AiQueryEntityType,
    filters?: Record<string, AiFilterValue>,
  ): Promise<Record<string, AiFilterValue> | undefined> {
    if (entityType !== 'tasks' || !filters) return filters;

    const normalized: Record<string, AiFilterValue> = { ...filters };
    for (const field of ['assignee', 'creator'] as const) {
      const rawValue = normalized[field];
      if (!rawValue || !hasEmailOrUuidFilterValue(rawValue)) continue;
      const values = Array.isArray(rawValue)
        ? rawValue
        : typeof rawValue === 'string'
          ? [rawValue]
          : [];
      const resolvedValues: Array<string | null> = [];
      for (const value of values) {
        if (value === null) {
          resolvedValues.push(null);
          continue;
        }
        if (typeof value !== 'string' || !value.trim()) continue;
        const rows = await context.manager.query(
          `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), email) AS display_name
           FROM users
           WHERE tenant_id = $1
             AND (LOWER(email) = LOWER($2) OR id::text = $2)
           LIMIT 1`,
          [context.tenantId, value.trim()],
        );
        resolvedValues.push(rows[0]?.display_name ?? value.trim());
      }
      if (resolvedValues.length > 0) {
        normalized[field] = Array.isArray(rawValue) ? resolvedValues : resolvedValues[0] ?? rawValue;
      }
    }

    return normalized;
  }

  private serializeFiltersForTasks(filters: Record<string, any>): string | undefined {
    return Object.keys(filters).length > 0 ? JSON.stringify(filters) : undefined;
  }

  private async listIdsForEntity(
    context: AiExecutionContextWithManager,
    entityType: SupportedAggregateEntityType,
    q: string | undefined,
    adaptedFilters: Record<string, any>,
    scope?: AiQueryScope,
  ): Promise<{ ids: string[]; total: number; scope: ResolvedAiScope | null }> {
    if (entityType === 'tasks') {
      const accessScope = await resolveAiParticipationAccessScope(context, entityType);
      const scoped = await applyScopeToAiQuery(
        context,
        entityType,
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: this.serializeFiltersForTasks(adaptedFilters),
        },
        scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return { ids: [], total: 0, scope: scoped.scope };
      }
      const result = await this.tasks.listIds(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: scoped.scope,
      };
    }

    if (entityType === 'projects') {
      const accessScope = await resolveAiParticipationAccessScope(context, entityType);
      const scoped = await applyScopeToAiQuery(
        context,
        entityType,
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          status: Object.prototype.hasOwnProperty.call(adaptedFilters, 'status') ? undefined : 'all',
        },
        scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return { ids: [], total: 0, scope: scoped.scope };
      }
      const result = await this.projects.listIds(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: scoped.scope,
      };
    }

    if (entityType === 'requests') {
      const accessScope = await resolveAiParticipationAccessScope(context, entityType);
      const scoped = await applyScopeToAiQuery(
        context,
        entityType,
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          status: Object.prototype.hasOwnProperty.call(adaptedFilters, 'status') ? undefined : 'all',
        },
        scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return { ids: [], total: 0, scope: scoped.scope };
      }
      const result = await this.requests.listIds(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: scoped.scope,
      };
    }

    if (entityType === 'applications') {
      const accessScope = await resolveAiParticipationAccessScope(context, entityType);
      const scoped = await applyScopeToAiQuery(
        context,
        entityType,
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          include_inactive: true,
        },
        scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return { ids: [], total: 0, scope: scoped.scope };
      }
      const result = await this.applications.listIds(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: scoped.scope,
      };
    }

    if (entityType === 'capex_items') {
      const result = await this.capexItems.summaryIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'spend_items') {
      const result = await this.spendItems.summaryIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'contracts') {
      const result = await this.contracts.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'companies') {
      const result = await this.companies.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'accounts') {
      const result = await this.accounts.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'chart_of_accounts') {
      const result = await this.chartOfAccounts.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        { manager: context.manager },
      );
      return {
        ids: result.ids || [],
        total: typeof result.total === 'number' ? result.total : (result.ids || []).length,
        scope: null,
      };
    }

    if (entityType === 'analytics_categories') {
      const result = await this.analyticsCategories.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'business_processes') {
      const result = await this.businessProcesses.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'suppliers') {
      const result = await this.suppliers.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'departments') {
      const result = await this.departments.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'contacts') {
      const result = await this.contacts.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        { manager: context.manager },
      );
      return {
        ids: result.ids || [],
        total: typeof result.total === 'number' ? result.total : (result.ids || []).length,
        scope: null,
      };
    }

    if (entityType === 'assets') {
      const scoped = await applyScopeToAiQuery(
        context,
        entityType,
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return { ids: [], total: 0, scope: scoped.scope };
      }
      const result = await this.assets.listIds(scoped.query, { manager: context.manager, tenantId: context.tenantId });
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: scoped.scope,
      };
    }

    if (entityType === 'locations') {
      const result = await this.locations.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        { manager: context.manager, tenantId: context.tenantId },
      );
      return {
        ids: result.ids || [],
        total: typeof result.total === 'number' ? result.total : (result.ids || []).length,
        scope: null,
      };
    }

    if (entityType === 'interfaces') {
      const result = await this.interfaces.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        { manager: context.manager },
      );
      return {
        ids: result.ids || [],
        total: typeof result.total === 'number' ? result.total : (result.ids || []).length,
        scope: null,
      };
    }

    if (entityType === 'connections') {
      const result = await this.connections.listIds(
        context.tenantId,
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        { manager: context.manager },
      );
      return {
        ids: result.ids || [],
        total: typeof result.total === 'number' ? result.total : (result.ids || []).length,
        scope: null,
      };
    }

    if (entityType === 'users') {
      const result = await this.users.listIdsForAi(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        {
          manager: context.manager,
          tenantId: context.tenantId,
        },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    if (entityType === 'incidents') {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      const result = await this.incidents.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        { manager: context.manager, tenantId: context.tenantId, viewer },
      );
      const ids = result.ids || [];
      return {
        ids,
        total: typeof result.total === 'number' ? result.total : ids.length,
        scope: null,
      };
    }

    throw new BadRequestException('Unsupported entity type.');
  }

  private resolveMetric(
    registry: AiEntityFilterRegistry,
    metric: string | undefined,
    fn: AiAggregateFunction,
  ): { key: string; def: AiAggregateMetricDef } | null {
    if (fn === 'count') return null;
    if (!metric) {
      throw new BadRequestException('metric is required for non-count aggregation.');
    }

    const explicit = registry.aggregate.metricFields?.[metric];
    if (explicit) {
      if ((fn === 'sum' || fn === 'avg') && explicit.type !== 'number') {
        throw new BadRequestException('sum and avg require a numeric metric.');
      }
      return { key: metric, def: explicit };
    }

    const field = registry.fields[metric];
    if (!field || field.aggregable !== true) {
      throw new BadRequestException('Unsupported metric field.');
    }

    if (field.type !== 'number' && field.type !== 'date') {
      throw new BadRequestException('Unsupported metric field.');
    }
    if ((fn === 'sum' || fn === 'avg') && field.type !== 'number') {
      throw new BadRequestException('sum and avg require a numeric metric.');
    }

    return {
      key: metric,
      def: {
        expression: `${registry.aggregate.alias}.${field.grid}`,
        type: field.type,
      },
    };
  }

  private async buildDocumentAggregateQuery(
    context: AiExecutionContextWithManager,
    registry: AiEntityFilterRegistry,
    groupBy: string,
    q: string | undefined,
    filters: Record<string, any>,
  ) {
    const groupField = registry.aggregate.groupFields[groupBy];
    if (!groupField) {
      throw new BadRequestException('Unsupported group_by field.');
    }

    const qb = context.manager
      .getRepository(Document)
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId', { tenantId: context.tenantId })
      .leftJoin('document_folders', 'f', 'f.id = d.folder_id AND f.tenant_id = d.tenant_id')
      .leftJoin('document_libraries', 'dl', 'dl.id = d.library_id AND dl.tenant_id = d.tenant_id')
      .leftJoin('document_types', 'dtype', 'dtype.id = d.document_type_id AND dtype.tenant_id = d.tenant_id');

    // §3.7 point 5: aggregation must not become a content oracle. `q` runs a
    // full-text match over content_plain/content_markdown, so counts have to be
    // computed on the documents the caller could actually open — Knowledge
    // library ACL plus the incident rules for bound reviews.
    const accessibleLibraries = await this.knowledge.listReadableLibraryIdsForUser(
      context.manager,
      context.userId ?? null,
    );
    if (accessibleLibraries) {
      if (accessibleLibraries.length === 0) {
        qb.andWhere('1 = 0');
      } else {
        qb.andWhere('d.library_id IN (:...documentAclLibraryIds)', { documentAclLibraryIds: accessibleLibraries });
      }
    }
    const incidentAcl = documentIncidentVisibilityQueryBuilderClause(
      'd',
      await resolveAiDocumentIncidentViewer(context),
    );
    qb.andWhere(incidentAcl.clause, incidentAcl.params);

    const search = getDocumentSearchState(q);
    if (search) {
      const searchFilter = buildDocumentSearchSql('d', search);
      qb.andWhere(searchFilter.clause, searchFilter.params);
    }

    const statusFilter = filters.status;
    if (statusFilter?.filterType === 'set' && Array.isArray(statusFilter.values) && statusFilter.values.length > 0) {
      const validStatuses = statusFilter.values.filter((value: string) => isDocumentStatus(String(value)));
      if (validStatuses.length > 0) {
        qb.andWhere('d.status = ANY(:statusValues)', { statusValues: validStatuses });
      }
    }

    const applyNamedSetFilter = (filter: any, expression: string, paramName: string) => {
      if (!filter?.filterType || filter.filterType !== 'set' || !Array.isArray(filter.values) || filter.values.length === 0) {
        return;
      }
      const hasNull = filter.values.includes(null);
      const nonNull = filter.values.filter((value: any) => value !== null);
      if (hasNull && nonNull.length > 0) {
        qb.andWhere(`(${expression} = ANY(:${paramName}) OR ${expression} IS NULL)`, { [paramName]: nonNull });
      } else if (hasNull) {
        qb.andWhere(`${expression} IS NULL`);
      } else if (nonNull.length > 0) {
        qb.andWhere(`${expression} = ANY(:${paramName})`, { [paramName]: nonNull });
      }
    };

    applyNamedSetFilter(filters.library_name, 'dl.name', 'libraryNames');
    applyNamedSetFilter(filters.folder_name, 'f.name', 'folderNames');
    applyNamedSetFilter(filters.document_type_name, 'dtype.name', 'documentTypeNames');

    const ownerSubquery = `(SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email, c.user_id::text)
      FROM document_contributors c
      LEFT JOIN users u ON u.id = c.user_id AND u.tenant_id = d.tenant_id
      WHERE c.document_id = d.id AND c.tenant_id = d.tenant_id AND c.role = 'owner' AND c.is_primary = true
      LIMIT 1)`;
    applyNamedSetFilter(filters.primary_owner_name, ownerSubquery, 'ownerNames');

    const reviewDueFilter = filters.review_due_at;
    if (reviewDueFilter) {
      let paramIndex = 0;
      const nextParam = () => `reviewDue${paramIndex++}`;
      if (typeof reviewDueFilter === 'string' && reviewDueFilter.trim()) {
        qb.andWhere('d.review_due_at = :reviewDueDate', { reviewDueDate: reviewDueFilter.trim() });
      } else {
        const condition = compileDateFilterCondition(reviewDueFilter, 'd.review_due_at', nextParam);
        if (condition) qb.andWhere(condition.sql, condition.params);
      }
    }

    let linkedEntityParamIndex = 0;
    const nextLinkedEntityParam = () => `linkedEntity${linkedEntityParamIndex++}`;
    for (const fieldName of Object.keys(DOCUMENT_LINKED_ENTITY_FILTERS) as DocumentLinkedEntityField[]) {
      const filter = filters[fieldName];
      if (!filter) continue;
      const param = nextLinkedEntityParam();
      const condition = compileDocumentLinkedEntityFilterCondition(fieldName, filter, 'd', `:${param}`);
      if (!condition) continue;
      qb.andWhere(condition.sql, condition.value === undefined ? {} : { [param]: condition.value });
    }

    return {
      qb,
      groupExpression: groupField.expression,
    };
  }

  private async aggregateByIds(
    context: AiExecutionContextWithManager,
    registry: AiEntityFilterRegistry,
    groupBy: string,
    ids: string[],
    fn: AiAggregateFunction,
    metric: { key: string; def: AiAggregateMetricDef } | null,
  ): Promise<Array<{ key: string | null; count: number } | { key: string | null; value: number | string | null }>> {
    const groupField = registry.aggregate.groupFields[groupBy];
    if (!groupField) {
      throw new BadRequestException('Unsupported group_by field.');
    }

    const joins = Array.from(new Set([...(groupField.joins || []), ...(metric?.def.joins || [])])).join('\n');
    const alias = registry.aggregate.alias;
    const idColumn = registry.aggregate.idColumn ?? 'id';
    if (fn === 'count' || !metric) {
      const rows = await context.manager.query(
        `SELECT ${groupField.expression} AS key, COUNT(*)::int AS count
         FROM ${registry.aggregate.baseTable} ${alias}
         ${joins}
         WHERE ${alias}.tenant_id = $1
           AND ${alias}.${idColumn} = ANY($2::uuid[])
         GROUP BY ${groupField.expression}
         ORDER BY count DESC, key ASC NULLS LAST`,
        [context.tenantId, ids],
      );

      return (rows || []).map((row: any) => ({
        key: row.key == null ? null : String(row.key),
        count: Number(row.count) || 0,
      }));
    }

    const aggregateExpression = buildMetricAggregateExpression(fn, metric.def.expression);
    const orderDirection = getMetricOrderDirection(fn);
    const rows = await context.manager.query(
      `SELECT ${groupField.expression} AS key, ${aggregateExpression} AS value
       FROM ${registry.aggregate.baseTable} ${alias}
       ${joins}
       WHERE ${alias}.tenant_id = $1
         AND ${alias}.${idColumn} = ANY($2::uuid[])
       GROUP BY ${groupField.expression}
       ORDER BY value ${orderDirection} NULLS LAST, key ASC NULLS LAST`,
      [context.tenantId, ids],
    );

    return (rows || []).map((row: any) => ({
      key: row.key == null ? null : String(row.key),
      value: normalizeAggregateValue(row.value, metric.def.type),
    }));
  }

  /** OPEX and CAPEX: rows of every id (no page cap), grouped and measured with the list engine's field values. */
  private async aggregateBudgetSummaryByIds(
    context: AiExecutionContextWithManager,
    entityType: 'spend_items' | 'capex_items',
    registry: AiEntityFilterRegistry,
    groupBy: string,
    ids: string[],
    fn: AiAggregateFunction,
    metric: { key: string; def: AiAggregateMetricDef } | null,
  ): Promise<Array<{ key: string | null; count: number } | BudgetValueGroup>> {
    const groupField = registry.fields[groupBy];
    if (!groupField) {
      throw new BadRequestException('Unsupported group_by field.');
    }

    const items = entityType === 'spend_items' ? this.spendItems : this.capexItems;
    const rows = await items.summaryRowsByIds(ids, {}, { manager: context.manager });

    if (fn === 'count' || !metric) {
      const counts = new Map<string, { key: string | null; count: number }>();
      for (const row of rows) {
        const rawKey = getSpendSummaryFieldValue(row, groupField.grid);
        const key = rawKey == null || rawKey === '' ? null : String(rawKey);
        const bucketKey = key ?? '__NULL__';
        const current = counts.get(bucketKey) ?? { key, count: 0 };
        current.count += 1;
        counts.set(bucketKey, current);
      }
      return Array.from(counts.values()).sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return (a.key ?? '').localeCompare(b.key ?? '');
      });
    }

    const metricField = registry.fields[metric.key];
    if (!metricField) {
      throw new BadRequestException('Unsupported metric field.');
    }
    if (resolveFteField(metricField.grid)) {
      return sortValueGroups(aggregateFteGroups(rows, groupField.grid, metricField.grid, fn), fn);
    }

    // Amounts are summed in cents and converted once: never money in binary floating point.
    type AggregateBucket = {
      key: string | null;
      sum: bigint;
      count: number;
      min: bigint | null;
      max: bigint | null;
    };
    const buckets = new Map<string, AggregateBucket>();

    for (const row of rows) {
      const rawKey = getSpendSummaryFieldValue(row, groupField.grid);
      const key = rawKey == null || rawKey === '' ? null : String(rawKey);
      const rawMetric = getSpendSummaryFieldValue(row, metricField.grid);
      const number = rawMetric == null || rawMetric === '' ? null : Number(rawMetric);
      if (number == null || !Number.isFinite(number)) continue;
      const cents = toCents(number);

      const bucketKey = key ?? '__NULL__';
      const bucket = buckets.get(bucketKey) ?? {
        key,
        sum: 0n,
        count: 0,
        min: null,
        max: null,
      };
      bucket.sum += cents;
      bucket.count += 1;
      bucket.min = bucket.min == null || cents < bucket.min ? cents : bucket.min;
      bucket.max = bucket.max == null || cents > bucket.max ? cents : bucket.max;
      buckets.set(bucketKey, bucket);
    }

    const toAmount = (cents: bigint | null) => (cents == null ? null : Number(formatCents(cents)));
    const values = Array.from(buckets.values()).map((bucket) => {
      let value: number | null = null;
      switch (fn) {
        case 'sum':
          value = toAmount(bucket.sum);
          break;
        case 'avg':
          value = bucket.count > 0 ? toAmount(divRoundHalfAway(bucket.sum, BigInt(bucket.count))) : null;
          break;
        case 'min':
          value = toAmount(bucket.min);
          break;
        case 'max':
          value = toAmount(bucket.max);
          break;
        default:
          value = null;
      }
      return {
        key: bucket.key,
        value,
      };
    });

    return sortValueGroups(values, fn);
  }

  async execute(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiQueryEntityType;
      group_by: string;
      metric?: string;
      function?: AiAggregateFunction;
      filters?: Record<string, AiFilterValue>;
      q?: string;
      scope?: AiQueryScope;
    },
  ): Promise<AiAggregateResult> {
    const registry = await resolveAiEntityRegistry(context, input.entity_type);
    const field = registry.fields[input.group_by];
    if (!field || field.groupable !== true) {
      throw new BadRequestException('Unsupported group_by field.');
    }
    assertPlainTextQuickSearch(input.entity_type, input.q, registry);

    const fn = normalizeAggregateFunction(input.function);
    const metric = this.resolveMetric(registry, input.metric?.trim(), fn);
    const normalizedFilters = await this.normalizePersonFilters(context, input.entity_type, input.filters);
    const adapted = adaptFilters(registry, normalizedFilters);
    if (adapted.ignored.length > 0) {
      return {
        status: 'invalid_filter',
        group_by: input.group_by,
        metric: metric ? input.metric?.trim() ?? null : null,
        function: fn,
        groups: [],
        total: 0,
        returned: 0,
        truncated: false,
        complete: false,
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        suggested_repairs: buildFilterRepairSuggestions(registry, adapted.ignored),
        scope: null,
      };
    }
    const isCompleteAggregateResult = (scope: ResolvedAiScope | null): boolean =>
      adapted.ignored.length === 0 && (scope?.resolved !== false);
    if (input.entity_type === 'documents') {
      const scoped = await applyScopeToAiQuery(
        context,
        input.entity_type,
        { q: input.q?.trim(), filters: adapted.filters },
        input.scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return {
          group_by: input.group_by,
          metric: metric?.key ?? null,
          function: fn,
          groups: [],
          total: 0,
          returned: 0,
          truncated: false,
          complete: isCompleteAggregateResult(scoped.scope),
          filters_applied: adapted.applied,
          filters_ignored: adapted.ignored,
          scope: scoped.scope,
        };
      }

      const { qb, groupExpression } = await this.buildDocumentAggregateQuery(
        context,
        registry,
        input.group_by,
        input.q?.trim(),
        adapted.filters,
      );
      const total = await qb.clone().getCount();
      if (total === 0) {
        return {
          group_by: input.group_by,
          metric: metric?.key ?? null,
          function: fn,
          groups: [],
          total: 0,
          returned: 0,
          truncated: false,
          complete: isCompleteAggregateResult(scoped.scope),
          filters_applied: adapted.applied,
          filters_ignored: adapted.ignored,
          scope: scoped.scope,
        };
      }

      let rows: Array<{ key: string | null; count: number } | { key: string | null; value: number | string | null }>;
      if (fn === 'count' || !metric) {
        const countRows = await qb
          .clone()
          .select(groupExpression, 'key')
          .addSelect('COUNT(*)::int', 'count')
          .groupBy(groupExpression)
          .orderBy('count', 'DESC')
          .addOrderBy('key', 'ASC', 'NULLS LAST')
          .getRawMany();
        rows = (countRows || []).map((row: any) => ({
          key: row.key == null ? null : String(row.key),
          count: Number(row.count) || 0,
        }));
      } else {
        const aggregateExpression = buildMetricAggregateExpression(fn, metric.def.expression);
        const valueRows = await qb
          .clone()
          .select(groupExpression, 'key')
          .addSelect(aggregateExpression, 'value')
          .groupBy(groupExpression)
          .orderBy('value', getMetricOrderDirection(fn), 'NULLS LAST')
          .addOrderBy('key', 'ASC', 'NULLS LAST')
          .getRawMany();
        rows = (valueRows || []).map((row: any) => ({
          key: row.key == null ? null : String(row.key),
          value: normalizeAggregateValue(row.value, metric.def.type),
        }));
      }

      return {
        group_by: input.group_by,
        metric: metric?.key ?? null,
        function: fn,
        groups: rows,
        total,
        returned: rows.length,
        truncated: false,
        complete: isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }

    const scoped = await this.listIdsForEntity(
      context,
      input.entity_type,
      input.q?.trim(),
      adapted.filters,
      input.scope,
    );
    const ids = scoped.ids;
    const truncated = ids.length < scoped.total;
    if (ids.length === 0) {
      return {
        group_by: input.group_by,
        metric: metric?.key ?? null,
        function: fn,
        groups: [],
        total: scoped.total,
        returned: 0,
        truncated,
        complete: !truncated && isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }

    const groups = input.entity_type === 'spend_items' || input.entity_type === 'capex_items'
      ? await this.aggregateBudgetSummaryByIds(context, input.entity_type, registry, input.group_by, ids, fn, metric)
      : await this.aggregateByIds(context, registry, input.group_by, ids, fn, metric);
    return {
      group_by: input.group_by,
      metric: metric?.key ?? null,
      function: fn,
      groups,
      total: scoped.total,
      returned: groups.length,
      truncated,
      complete: !truncated && isCompleteAggregateResult(scoped.scope),
      filters_applied: adapted.applied,
      filters_ignored: adapted.ignored,
      scope: scoped.scope,
    };
  }
}
