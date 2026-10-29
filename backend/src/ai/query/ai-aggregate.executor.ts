import { BadRequestException, Injectable, Logger, Optional } from '@nestjs/common';
import { AiPolicyService } from '../ai-policy.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { convertTurnovers, turnoverMissingItems, TurnoverFxMissingItem, yearRateSetId } from '../../spend/allocation-distribution';
import { listAiTechnologies, listAiTechnologyVersions, resolveAiApplicationsReach } from './ai-technologies.query';
import { listAiVulnerabilities, readAiVulnerabilityFeeds } from './ai-vulnerabilities.query';
import { aggregateSupportRows, APPLICATIONS_UNREAD_NOTE, listAiSupportDeadlines, listAiSupportGaps } from './ai-support.query';
import { EndOfSupportService } from '../../technologies/reports/end-of-support.service';
import { PermissionsService, type PermissionLevel, type Resource } from '../../permissions/permissions.service';
import { RolesService } from '../../roles/roles.service';
import { aggregateRolesRows, listAiRolePermissions, listAiRoles } from './ai-roles.query';
import { aiPermissionLevelLabel, aiResourceLabel } from '../ai-role-labels';
import { readAiScreenLanguage } from '../ai-unread-families';
import { DataAccessAdminService } from '../../data-access/data-access-admin.service';
import { DataAccessReservedException } from '../../data-access/reserved-operations';
import {
  aggregateDataAccessRows,
  AI_DATA_ACCESS_COVERAGE_NOTE,
  AI_DATA_ACCESS_UNAVAILABLE_NOTE,
  listAiDataAccess,
} from './ai-data-access.query';
import { aiAmountsCurrency, aiCompanyTurnoverCurrency, isBudgetLineEntity } from './ai-amounts-currency.util';
import { aiDataAccessNote } from './ai-data-access-note.util';
import { normalizeAgFilterModel, assertSetFilterModes } from '../../common/ag-grid-filtering';
import { applicationParticipantCondition } from '../../auth/business-contributor-scope';
import { bilingualDocumentTsQuerySql } from '../../common/document-search-tsquery';
import { AccountsService } from '../../accounts/accounts.service';
import { ChartOfAccountsService } from '../../accounts/chart-of-accounts.service';
import { AnalyticsCategoriesService } from '../../analytics/analytics-categories.service';
import { ApplicationsService } from '../../applications/services';
import { AssetsService } from '../../assets/services';
import { BusinessProcessesService } from '../../business-processes/business-processes.service';
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
import { BudgetLinesService } from '../../spend/budget-lines.service';
import { TasksService } from '../../spend/tasks.service';
import { loadLinkedReads } from '../../common/relations/linked-reads';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { UsersService } from '../../users/users.service';
import { AiExecutionContextWithManager, AiQueryEntityType, AiQueryScope } from '../ai.types';
import { adaptFilters } from './ai-filter.adapter';
import {
  invalidFilterResult,
  hasEmailOrUuidFilterValue,
} from './ai-filter-description.util';
import {
  applyScopeToAiQuery,
  resolveAiDocumentIncidentViewer,
  resolveAiIncidentViewer,
  resolveAiParticipationAccessScope,
  ResolvedAiScope,
} from './ai-query-scope.util';
import {
  AiAggregateMetricDef,
  AiAggregateMetricType,
  AiAggregateResult,
  AiBudgetStaffFigures,
  AiDateFilterValue,
  AiEntityFilterRegistry,
  AiFilterValue,
} from './ai-filter.types';
import { assertPlainTextQuickSearch } from './ai-quick-search-validation.util';
import { resolveAiEntityRegistry } from './registries';
import { COMPANY_AGGREGATE_METRIC_YEAR_SQL } from './registries/companies.registry';
import { isMoneyVariant, resolveFteField, resolveFteVariantField } from '../../spend/spend-summary.builder';
import { BudgetRatioMetric, isBudgetMoneyKey, resolveBudgetRatioMetric } from './registries/budget-amount-fields';
import type { AggregateSpec } from '../../common/list-engine/list-aggregate';
import type { FxMissingPair } from '../../spend/budget-list/budget-list.service';
import { trailingDigits } from '../../common/text-scan';

/** Connection fields grouped on their effective values (see aggregateConnectionsByEffectiveRisk). */
const CONNECTION_EFFECTIVE_RISK_GROUPS = new Set(['criticality', 'data_class', 'contains_pii']);

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
  | 'budget_lines'
  | 'business_processes'
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
  | 'suppliers'
  | 'tasks'
  | 'technologies'
  | 'technology_versions'
  | 'users'
  | 'vulnerabilities'
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
  const digits = trailingDigits(value);
  if (!digits) return null;
  const itemNumber = Number(digits);
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

/** Null keys last, then code-point order, as `ORDER BY key ASC NULLS LAST`. */
function compareNullableKeys(a: string | null, b: string | null): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `ORDER BY value <dir> NULLS LAST, key ASC NULLS LAST` of the generic metric path.
 * A null value is a group with nothing left to aggregate.
 */
function compareMetricGroups(
  a: { key: string | null; value: number | null },
  b: { key: string | null; value: number | null },
  direction: 'ASC' | 'DESC',
): number {
  if (a.value == null || b.value == null) {
    if (a.value != null) return -1;
    if (b.value != null) return 1;
  } else if (a.value !== b.value) {
    return direction === 'ASC' ? a.value - b.value : b.value - a.value;
  }
  return compareNullableKeys(a.key, b.key);
}

/** sum, avg, min, max over the converted turnovers of one group. Empty means no value. */
function aggregateConverted(fn: 'sum' | 'avg' | 'min' | 'max', values: number[]): number | null {
  if (values.length === 0) return null;
  let total = 0;
  let min = values[0];
  let max = values[0];
  for (const value of values) {
    total += value;
    if (value < min) min = value;
    if (value > max) max = value;
  }
  if (fn === 'min') return min;
  if (fn === 'max') return max;
  if (fn === 'avg') return total / values.length;
  return total;
}

function buildMetricAggregateExpression(fn: AiAggregateFunction, expression: string, round?: number): string {
  const aggregate = (() => {
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
  })();
  // A definition can carry more precision than the card reads (an exact delay): the group keeps
  // the readable figure, the sum stays exact.
  return round != null && fn !== 'sum' && fn !== 'count' ? `ROUND(${aggregate}, ${round})` : aggregate;
}

type BudgetValueGroup = { key: string | null; value: number | null; unknown?: number };
type BudgetOverall = NonNullable<AiAggregateResult['overall']>;
type BudgetRatioGroup = { key: string | null; count: number; value: number | null } & AiBudgetStaffFigures;

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * A group's staff figures, as the "Cost per FTE" report reads them (`costPerFteCell`,
 * `dailyRateCell` in `spend/reports/shared/reportAggregates.ts`): no FTE (no line detail) is no
 * cost either; a ratio is null when its divisor is null or 0, rounded to the cent.
 */
function budgetStaffFigures(values: Record<string, number | null>): AiBudgetStaffFigures {
  const staffFte = values.staff_fte ?? null;
  const days = values.days ?? null;
  const staffCost = staffFte == null ? null : values.staff_cost ?? 0;
  const dayCost = days == null ? null : values.day_cost ?? 0;
  return {
    staff_fte: staffFte,
    staff_cost: staffCost,
    cost_per_fte: staffFte ? round2(staffCost! / staffFte) : null,
    days,
    day_cost: dayCost,
    day_rate: days ? round2(dayCost! / days) : null,
  };
}

const BUDGET_RATIO_NOTE = 'Computed by the server, as the "Cost per FTE" report: from the people and days quantity × price lines of the column '
  + '(pieces lines left out), in the reporting currency. cost_per_fte is staff_cost ÷ staff_fte and day_rate is day_cost ÷ days, per group and, '
  + 'in overall, of all groups together (never an average of the groups\' ratios). Quote these figures: never divide amounts by FTE '
  + 'or assume a number of working days. The cost per FTE keeps every group with line detail (its day rate included); '
  + 'the day rate keeps only the groups with days bought. '
  + 'fte_without_line_detail is FTE declared on columns without line detail, left out of every figure; '
  + 'fte_amount_not_following_lines is FTE on columns whose amount no longer follows their lines (spread, copied or edited): '
  + 'these figures use the cost of their lines, not the column amount; '
  + 'staff_cost_not_in_day_rate is the cost of people priced per month, in the cost per FTE but not in the day rate. Say so when present.';

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
    /** The unified read engine of the budget lines, both natures. */
    private readonly budgetLines: BudgetLinesService,
    private readonly projects: PortfolioProjectsService,
    private readonly requests: PortfolioRequestsService,
    private readonly applications: ApplicationsService,
    private readonly assets: AssetsService,
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
    private readonly contacts: ContactsService,
    private readonly interfaces: InterfacesService,
    private readonly connections: ConnectionsService,
    private readonly incidents: IncidentsService,
    /** Whether the caller reads applications: a technology filter on `application_count` stays in that scope. */
    @Optional() private readonly policy?: AiPolicyService,
    /** Live rates for company turnover aggregates. Tests that build the executor by hand omit it. */
    @Optional() private readonly fxRates?: FxRateService,
    /** The End of support report of the screen, which the two report families group. */
    @Optional() private readonly endOfSupport?: EndOfSupportService,
    /** The services of Admin › Roles, which `roles` and `role_permissions` group. */
    @Optional() private readonly roles?: RolesService,
    @Optional() private readonly permissions?: PermissionsService,
    /** Admin › Data access, which `data_access` groups. */
    @Optional() private readonly dataAccess?: DataAccessAdminService,
  ) {
    // Absent, a technology filter on application_count matches nothing: say so once, at start.
    if (!policy) new Logger(AiAggregateExecutor.name).warn('AiPolicyService is not injected: technology aggregates see no application.');
  }

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
  ): Promise<{ ids: string[]; total: number; scope: ResolvedAiScope | null; distinct_total?: number }> {
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
        viewer: await resolveAiIncidentViewer(context),
        // Name filters match only the linked records the caller sees, as in the list.
        linkedReads: await loadLinkedReads(context.manager, context.userId, context.tenantId),
        linkedScopes: {
          projects: await resolveAiParticipationAccessScope(context, 'projects'),
          requests: await resolveAiParticipationAccessScope(context, 'requests'),
          applications: await resolveAiParticipationAccessScope(context, 'applications'),
        },
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

    if (entityType === 'contracts') {
      const result = await this.contracts.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
          includeDisabled: true,
        },
        // The `application` filter matches a Business Contributor's applications only, as on query_entities.
        { manager: context.manager, coveredApplications: { scope: await resolveAiParticipationAccessScope(context, 'applications') } },
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
        { manager: context.manager, tenantId: context.tenantId },
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

    if (entityType === 'technologies') {
      // "me" and "my_team" do not apply to technologies: refused as for assets.
      await applyScopeToAiQuery(context, entityType, {}, scope);
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const result = await listAiTechnologies(
        context.manager,
        context.tenantId,
        { q, limit: AGGREGATE_ID_COLLECTION_LIMIT, filters: adaptedFilters },
        applications,
        { idsOnly: true },
      );
      return { ids: result.ids, total: result.total, scope: null };
    }

    if (entityType === 'technology_versions') {
      // "me" and "my_team" do not apply to versions either: refused as for technologies.
      await applyScopeToAiQuery(context, entityType, {}, scope);
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const result = await listAiTechnologyVersions(
        context.manager,
        context.tenantId,
        { q, limit: AGGREGATE_ID_COLLECTION_LIMIT, filters: adaptedFilters },
        applications,
        { idsOnly: true },
      );
      return { ids: result.ids, total: result.total, scope: null };
    }

    if (entityType === 'vulnerabilities') {
      // "me" and "my_team" do not apply to vulnerabilities: refused as for technologies.
      await applyScopeToAiQuery(context, entityType, {}, scope);
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const result = await listAiVulnerabilities(
        context.manager,
        context.tenantId,
        { q, limit: AGGREGATE_ID_COLLECTION_LIMIT, filters: adaptedFilters },
        applications,
        { idsOnly: true },
      );
      // The distinct CVE of every row the filters keep, beyond the ids cap.
      return { ids: result.ids, total: result.total, scope: null, distinct_total: result.distinct_total };
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
          // The quick search looks in the administration fields for their readers only.
          accessView: (await this.policy?.canReadEntityType(context, 'data_access', context.manager)) === true,
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
      const reads = async (type: AiQueryEntityType) =>
        !!(await this.policy?.canReadEntityType(context, type, context.manager));
      const readsApplications = await reads('applications');
      const result = await this.incidents.listIds(
        {
          q,
          limit: AGGREGATE_ID_COLLECTION_LIMIT,
          filters: adaptedFilters,
        },
        {
          manager: context.manager,
          tenantId: context.tenantId,
          viewer,
          // The linked filters follow the module reads, as the list does; the application filter
          // and the group are narrowed to a Business Contributor's participation.
          technologies: await reads('technologies'),
          applications: readsApplications,
          applicationScope: readsApplications
            ? await resolveAiParticipationAccessScope(context, 'applications')
            : undefined,
        },
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
    assertSetFilterModes(filters);
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
  ): Promise<Array<{ key: string | null; count: number; distinct_count?: number } | { key: string | null; value: number | string | null }>> {
    const groupField = registry.aggregate.groupFields[groupBy];
    if (!groupField) {
      throw new BadRequestException('Unsupported group_by field.');
    }

    let joinList = Array.from(new Set([...(groupField.joins || []), ...(metric?.def.joins || [])]));
    const queryParams: unknown[] = [context.tenantId, ids];
    // A many-to-many group on a participation-scoped family lists only the linked records the
    // caller takes part in (a Business Contributor's applications), as the incident detail does.
    if (groupField.participation) {
      const scope = await resolveAiParticipationAccessScope(context, groupField.participation.entityType);
      if (scope) {
        queryParams.push(scope.userId);
        const condition = applicationParticipantCondition(
          groupField.participation.alias,
          `$${queryParams.length}`,
        );
        const target = `JOIN ${groupField.participation.table} ${groupField.participation.alias}`;
        joinList = joinList.map((join) => (join.includes(target) ? `${join} AND ${condition}` : join));
      }
    }
    const joins = joinList.join('\n');
    const alias = registry.aggregate.alias;
    const idColumn = registry.aggregate.idColumn ?? 'id';
    const baseWhere = registry.aggregate.baseWhere ? ` AND ${registry.aggregate.baseWhere}` : '';
    if (fn === 'count' || !metric) {
      // A many-to-many group whose links can repeat a name (`countDistinct`) counts its record
      // once: two owners of the same name are one row for that technology.
      const countExpression = groupField.countDistinct
        ? `COUNT(DISTINCT ${alias}.${idColumn})::int`
        : 'COUNT(*)::int';
      // A family with several rows per record (`distinctRecord`) counts the records beside the rows.
      const distinct = registry.aggregate.distinctRecord;
      const distinctColumn = distinct ? `, COUNT(DISTINCT ${distinct.expression})::int AS distinct_count` : '';
      const rows = await context.manager.query(
        `SELECT ${groupField.expression} AS key, ${countExpression} AS count${distinctColumn}
         FROM ${registry.aggregate.baseTable} ${alias}
         ${joins}
         WHERE ${alias}.tenant_id = $1${baseWhere}
           AND ${alias}.${idColumn} = ANY($2::uuid[])
         GROUP BY ${groupField.expression}
         ORDER BY count DESC, key ASC NULLS LAST`,
        queryParams,
      );

      return (rows || []).map((row: any) => ({
        key: row.key == null ? null : String(row.key),
        count: Number(row.count) || 0,
        ...(distinct ? { distinct_count: Number(row.distinct_count) || 0 } : {}),
      }));
    }

    // One row per (group, record): a many-to-many group whose links repeat a name (two IT owners
    // named alike) must not count or sum the record twice. The metric is read once per record.
    const aggregateExpression = buildMetricAggregateExpression(fn, 'd.metric', metric.def.round);
    const orderDirection = getMetricOrderDirection(fn);
    const rows = await context.manager.query(
      `SELECT d.key, ${aggregateExpression} AS value
       FROM (
         SELECT DISTINCT ${groupField.expression} AS key, ${alias}.${idColumn} AS record_id,
                ${metric.def.expression} AS metric
           FROM ${registry.aggregate.baseTable} ${alias}
           ${joins}
          WHERE ${alias}.tenant_id = $1${baseWhere}
            AND ${alias}.${idColumn} = ANY($2::uuid[])
       ) d
       GROUP BY d.key
       ORDER BY value ${orderDirection} NULLS LAST, key ASC NULLS LAST`,
      queryParams,
    );

    return (rows || []).map((row: any) => ({
      key: row.key == null ? null : String(row.key),
      value: normalizeAggregateValue(row.value, metric.def.type),
    }));
  }

  /**
   * Company `turnover_year` (sum, avg, min, max). Count stays on the generic path.
   *
   * The metric year is the registry join's (`COMPANY_AGGREGATE_METRIC_YEAR_SQL`):
   * `aggregate_entities` has no year argument. Each company's turnover, in millions
   * of its base currency, is converted at the live rates of that year (`rateSetId`
   * null). A company in the reporting currency, or without a base currency, is not
   * converted. A company without a rate is left out of its group; a group with
   * nothing left has a null value. The same filters, search and scope as the
   * generic path: `ids` is that set.
   */
  private async aggregateCompanyTurnover(
    context: AiExecutionContextWithManager,
    registry: AiEntityFilterRegistry,
    groupBy: string,
    ids: string[],
    fn: AiAggregateFunction,
  ): Promise<{ groups: Array<{ key: string | null; value: number | null }>; missing: TurnoverFxMissingItem[] }> {
    if (fn === 'count') {
      throw new BadRequestException('Company turnover conversion does not apply to count.');
    }
    const groupField = registry.aggregate.groupFields[groupBy];
    const metric = registry.aggregate.metricFields?.turnover_year;
    if (!groupField || !metric) {
      throw new BadRequestException('Unsupported group_by field.');
    }

    const joins = Array.from(new Set([...(groupField.joins || []), ...(metric.joins || [])])).join('\n');
    const alias = registry.aggregate.alias;
    const idColumn = registry.aggregate.idColumn ?? 'id';
    const baseWhere = registry.aggregate.baseWhere ? ` AND ${registry.aggregate.baseWhere}` : '';
    const rows: Array<{
      company_id: string;
      company_name: string | null;
      base_currency: string | null;
      key: string | null;
      turnover: string | number | null;
      metric_year: number | string;
    }> = await context.manager.query(
      `SELECT ${alias}.id AS company_id,
              ${alias}.name AS company_name,
              ${alias}.base_currency AS base_currency,
              ${groupField.expression} AS key,
              ${metric.expression} AS turnover,
              ${COMPANY_AGGREGATE_METRIC_YEAR_SQL} AS metric_year
       FROM ${registry.aggregate.baseTable} ${alias}
       ${joins}
       WHERE ${alias}.tenant_id = $1${baseWhere}
         AND ${alias}.${idColumn} = ANY($2::uuid[])`,
      [context.tenantId, ids],
    );
    if (!rows?.length) return { groups: [], missing: [] };

    const year = Number(rows[0].metric_year);
    const converted = await convertTurnovers({
      fxRates: this.fxRates,
      manager: context.manager,
      tenantId: context.tenantId,
      fiscalYear: year,
      // The rates of the companies list total: the set the year is frozen at, else the live rates.
      rateSetId: await yearRateSetId(context.manager, context.tenantId, year),
      entries: rows.map((row) => ({
        companyId: String(row.company_id),
        currency: row.base_currency,
        turnover: row.turnover,
      })),
    });

    const buckets = new Map<string, { key: string | null; values: number[] }>();
    for (const row of rows) {
      const key = row.key == null ? null : String(row.key);
      // 'n' marks a null key so it cannot collide with a real key.
      const bucketKey = key == null ? 'n' : `k${key}`;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = { key, values: [] };
        buckets.set(bucketKey, bucket);
      }
      const value = converted.values.get(String(row.company_id));
      if (typeof value === 'number' && Number.isFinite(value)) bucket.values.push(value);
    }

    const direction = getMetricOrderDirection(fn);
    const groups = Array.from(buckets.values())
      .map((bucket) => ({ key: bucket.key, value: aggregateConverted(fn, bucket.values) }))
      .sort((a, b) => compareMetricGroups(a, b, direction));
    const missing = turnoverMissingItems(
      converted.missing,
      year,
      rows.map((row) => ({ id: String(row.company_id), name: row.company_name })),
    );
    missing.sort((a, b) => a.year - b.year
      || a.currency.localeCompare(b.currency)
      || a.companyName.localeCompare(b.companyName)
      || a.companyId.localeCompare(b.companyId));
    return { groups, missing };
  }

  /**
   * Connections by criticality, data class or PII: the effective values the list shows and
   * filters on (a derived connection takes them from its linked interfaces), read through the
   * connections service rather than the stored columns. Counts only: connections have no metric.
   */
  private async aggregateConnectionsByEffectiveRisk(
    context: AiExecutionContextWithManager,
    groupBy: string,
    ids: string[],
    fn: AiAggregateFunction,
    metric: { key: string; def: AiAggregateMetricDef } | null,
  ): Promise<Array<{ key: string | null; count: number }>> {
    if (metric || fn !== 'count') {
      throw new BadRequestException('Connections grouped by a risk field support count only.');
    }
    const risks = await this.connections.effectiveRiskByIds(context.tenantId, ids, { manager: context.manager });
    const counts = new Map<string, { key: string | null; count: number }>();
    for (const risk of risks.values()) {
      const raw = groupBy === 'criticality'
        ? risk.effective_criticality
        : groupBy === 'data_class'
          ? risk.effective_data_class
          : String(risk.effective_contains_pii);
      const key = raw == null || raw === '' ? null : String(raw);
      const bucketKey = key ?? '__NULL__';
      const current = counts.get(bucketKey) ?? { key, count: 0 };
      current.count += 1;
      counts.set(bucketKey, current);
    }
    // Same order as the SQL path: count descending, then key with null last.
    return Array.from(counts.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      if (a.key == null) return b.key == null ? 0 : 1;
      if (b.key == null) return -1;
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
  }

  /**
   * OPEX and CAPEX: one aggregate statement of the list engine
   * (`budgetListAggregate`) over every line the filters and the quick search
   * keep, every status: the group key as the list reads it (a multi-valued
   * field groups under its joined names), amounts in exact cents (each line
   * converted to the cent first, as the list's totals), FTE exact with, per
   * group, the lines whose FTE is unknown. Counts largest first; values
   * largest first (smallest first for min), groups without a value last;
   * ties by the key's text, blank first, in the list's text order: the
   * engine's final tie-break, which never follows an enum's rank, so status,
   * run or build and the CAPEX enums tie as the former `localeCompare` did.
   */
  private async aggregateBudgetSummary(
    context: AiExecutionContextWithManager,
    registry: AiEntityFilterRegistry,
    groupBy: string,
    q: string | undefined,
    filters: Record<string, any>,
    fn: AiAggregateFunction,
    metric: { key: string; def: AiAggregateMetricDef } | null,
  ): Promise<{ groups: Array<{ key: string | null; count: number } | BudgetValueGroup>; total: number; fxMissing: FxMissingPair[] | null; overall: BudgetOverall | null }> {
    const groupField = registry.fields[groupBy];
    if (!groupField) {
      throw new BadRequestException('Unsupported group_by field.');
    }
    let spec: AggregateSpec;
    let fte = false;
    if (fn === 'count' || !metric) {
      spec = { groupBy: [groupField.grid], measures: [], order: [{ by: 'count', dir: 'DESC' }] };
    } else {
      const metricField = registry.fields[metric.key];
      if (!metricField) {
        throw new BadRequestException('Unsupported metric field.');
      }
      // FTE and days (not amounts) count, per group, the lines without a value.
      const variant = resolveFteVariantField(metricField.grid);
      fte = resolveFteField(metricField.grid) != null || (variant != null && !isMoneyVariant(variant));
      spec = {
        groupBy: [groupField.grid],
        measures: [{ id: 'value', fn, field: metricField.grid }],
        order: [{ by: 'measure', id: 'value', dir: getMetricOrderDirection(fn), nulls: 'LAST' }],
      };
    }

    const result = await this.budgetLines.summaryAggregate({ q, filters, includeDisabled: true }, spec, { manager: context.manager });
    const groups = result.groups.map((group) => {
      const key = group.keys[0] ?? null;
      if (!spec.measures.length) return { key, count: group.count };
      return fte ? { key, value: group.values.value, unknown: group.unknown.value } : { key, value: group.values.value };
    });
    // The same measure over every line (all groups together): a total the answer quotes, never adds up.
    const overall: BudgetOverall | null = spec.measures.length
      ? { count: result.total.count, value: result.total.values.value ?? null, ...(fte ? { unknown: result.total.unknown.value ?? 0 } : {}) }
      : null;
    // The amounts left out of the values for lack of a rate (`[]` when none); null without a measure.
    return { groups, total: result.total.count, fxMissing: spec.measures.length ? result.fxMissing ?? [] : null, overall };
  }

  /**
   * OPEX and CAPEX, a ratio metric (`y_budget_cost_per_fte`, `y_budget_day_rate`): the "Cost per FTE"
   * report's figures per group, in one aggregate statement of the list engine (`costPerFteRequests`,
   * `dailyRateRequests`): the sums of the staff cost, staff FTE, day cost and days, and the ratios
   * computed here. The groups the report shows (a staff FTE for the cost per FTE, days for the day
   * rate), largest first; `overall` holds the ratios of the totals and the report's notices.
   */
  private async aggregateBudgetRatio(
    context: AiExecutionContextWithManager,
    registry: AiEntityFilterRegistry,
    groupBy: string,
    q: string | undefined,
    filters: Record<string, any>,
    ratio: BudgetRatioMetric,
  ): Promise<{ groups: BudgetRatioGroup[]; total: number; fxMissing: FxMissingPair[]; overall: BudgetOverall }> {
    const groupField = registry.fields[groupBy];
    if (!groupField) {
      throw new BadRequestException('Unsupported group_by field.');
    }
    const governing = ratio.kind === 'cost_per_fte' ? 'staff_fte' : 'days';
    const spec: AggregateSpec = {
      groupBy: [groupField.grid],
      measures: [
        { id: 'staff_cost', fn: 'sum', field: ratio.staffCost },
        { id: 'staff_fte', fn: 'sum', field: ratio.staffFte },
        { id: 'day_cost', fn: 'sum', field: ratio.dayCost },
        { id: 'days', fn: 'sum', field: ratio.days },
        { id: 'no_detail', fn: 'sum', field: ratio.noDetail },
        { id: 'detached', fn: 'sum', field: ratio.detached },
      ],
      order: [{ by: 'measure', id: governing, dir: 'DESC', nulls: 'LAST' }],
    };
    const result = await this.budgetLines.summaryAggregate({ q, filters, includeDisabled: true }, spec, { manager: context.manager });
    const valueOf = (figures: AiBudgetStaffFigures) => (ratio.kind === 'cost_per_fte' ? figures.cost_per_fte : figures.day_rate);
    const groups = result.groups
      .filter((group) => group.values[governing] != null)
      .map((group): BudgetRatioGroup => {
        const figures = budgetStaffFigures(group.values);
        return { key: group.keys[0] ?? null, count: group.count, value: valueOf(figures), ...figures };
      });
    const total = result.total.values;
    const figures = budgetStaffFigures(total);
    // The report's notices: FTE without line detail, FTE whose amount no longer follows its lines,
    // and (cents, from 50) the staff cost priced per month.
    const noDetail = total.no_detail ?? 0;
    // As the report (`detachedWithDetail`): a column without line detail is detached too, so it comes
    // off both the FTE and the line count (in cents; a rounding below zero reads as none).
    const linesWith = (id: string) => result.total.count - (result.total.unknown[id] ?? 0);
    const detachedFte = Math.max(0, Math.round(((total.detached ?? 0) - noDetail) * 100) / 100);
    const detachedLines = (total.detached ? linesWith('detached') : 0) - (noDetail > 0 ? linesWith('no_detail') : 0);
    const monthlyCents = Math.round((total.staff_cost ?? 0) * 100) - Math.round((total.day_cost ?? 0) * 100);
    const overall: BudgetOverall = {
      count: result.total.count,
      value: valueOf(figures),
      ...figures,
      ...(noDetail > 0 ? { fte_without_line_detail: noDetail } : {}),
      ...(detachedFte > 0 && detachedLines > 0 ? { fte_amount_not_following_lines: detachedFte } : {}),
      ...(monthlyCents >= 50 ? { staff_cost_not_in_day_rate: monthlyCents / 100 } : {}),
    };
    return { groups, total: result.total.count, fxMissing: result.fxMissing ?? [], overall };
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
    const result = { ...await this.executeAggregate(context, input), ...await aiDataAccessNote(context, input.entity_type) };
    // Company turnover (sum, avg, min, max) is in the reporting currency. A count has none.
    // Attached here, as the budget and contract notes are, so chat and MCP both carry it.
    if (input.entity_type === 'companies' && result.metric === 'turnover_year') {
      const amounts = await aiCompanyTurnoverCurrency(context, result.turnover_fx_missing);
      return { ...result, ...amounts };
    }
    // A sum or an average of amounts names their currency; a count or an FTE has none.
    const metric = input.metric?.trim() ?? '';
    const isAmount = metric !== '' && (
      isBudgetLineEntity(input.entity_type) ? isBudgetMoneyKey(metric) : metric.startsWith('yearly_amount')
    );
    const amounts = isAmount ? await aiAmountsCurrency(context, input.entity_type, 'list', result.amounts_fx_missing) : null;
    return amounts ? { ...result, ...amounts } : result;
  }

  /**
   * A family with several rows per record (`distinctRecord`, vulnerabilities: one row per technology
   * version of a CVE): the distinct records among every row the filters keep, as its id list counts
   * them over the whole set (beyond the ids cap; a record in two groups counts once), named by
   * `distinct_label`. Nothing for the other families, nor for a list that does not count them.
   */
  private distinctRecordTotal(
    registry: AiEntityFilterRegistry,
    scoped: { distinct_total?: number },
  ): Pick<AiAggregateResult, 'distinct_total' | 'distinct_label'> {
    const distinct = registry.aggregate.distinctRecord;
    if (!distinct || typeof scoped.distinct_total !== 'number') return {};
    return { distinct_total: scoped.distinct_total, distinct_label: distinct.name };
  }

  /** Vulnerabilities: how fresh the feeds are, as the page's feed line. Nothing for the other families. */
  private async familyFeeds(context: AiExecutionContextWithManager, entityType: AiQueryEntityType): Promise<Pick<AiAggregateResult, 'feeds'>> {
    return entityType === 'vulnerabilities' ? { feeds: await readAiVulnerabilityFeeds(context.manager) } : {};
  }

  private async executeAggregate(
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
    // The policy decides which linked counts the caller may group, filter and aggregate.
    const registry = await resolveAiEntityRegistry(context, input.entity_type, async (entityType) =>
      !!(await this.policy?.canReadEntityType(context, entityType, context.manager)));
    const field = registry.fields[input.group_by];
    if (!field || field.groupable !== true) {
      throw new BadRequestException('Unsupported group_by field.');
    }
    assertPlainTextQuickSearch(input.entity_type, input.q, registry);

    // A budget ratio (cost per FTE, day rate) is no field: the server computes it whatever the function.
    const ratio = isBudgetLineEntity(input.entity_type) ? resolveBudgetRatioMetric(input.metric?.trim()) : null;
    const fn = normalizeAggregateFunction(input.function);
    const metric = ratio ? null : this.resolveMetric(registry, input.metric?.trim(), fn);
    const normalizedFilters = await this.normalizePersonFilters(context, input.entity_type, input.filters);
    const adapted = adaptFilters(registry, normalizedFilters);
    if (adapted.ignored.length > 0) {
      const refusal = invalidFilterResult(registry, adapted);
      return {
        status: refusal.status,
        group_by: input.group_by,
        metric: metric || ratio ? input.metric?.trim() ?? null : null,
        function: ratio ? 'ratio' : fn,
        groups: [],
        total: 0,
        returned: 0,
        truncated: false,
        complete: false,
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        suggested_repairs: refusal.suggested_repairs,
        ...(refusal.invalid_filter_values ? { invalid_filter_values: refusal.invalid_filter_values } : {}),
        scope: null,
      };
    }
    const isCompleteAggregateResult = (scope: ResolvedAiScope | null): boolean =>
      adapted.ignored.length === 0 && (scope?.resolved !== false);
    if (input.entity_type === 'support_gaps' || input.entity_type === 'support_deadlines') {
      const service = this.endOfSupport;
      if (!service) throw new BadRequestException('The End of support report is not available.');
      // The report rows are not participation-scoped: `scope` is applied as on query_entities,
      // and a scope the family cannot take (`me`) is refused there too.
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
          complete: false,
          filters_applied: adapted.applied,
          filters_ignored: adapted.ignored,
          scope: scoped.scope,
        };
      }
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const opts = { manager: context.manager, tenantId: context.tenantId, userId: context.userId };
      const result = input.entity_type === 'support_gaps'
        ? await listAiSupportGaps(service, opts, applications, scoped.query, true)
        : await listAiSupportDeadlines(service, opts, applications, scoped.query, true);
      const rows = result.items;
      const groups = aggregateSupportRows(input.entity_type, rows, input.group_by, fn, metric?.key ?? null);
      const total = rows.length;
      return {
        applications_visible: result.applications_visible,
        ...(result.applications_visible ? {} : { applications_visible_note: APPLICATIONS_UNREAD_NOTE }),
        group_by: input.group_by,
        metric: metric?.key ?? null,
        function: fn,
        groups,
        total,
        returned: groups.length,
        truncated: false,
        complete: isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }
    if (input.entity_type === 'roles' || input.entity_type === 'role_permissions') {
      if (!this.roles || !this.permissions) throw new BadRequestException('The roles are not available.');
      const services = { roles: this.roles, permissions: this.permissions };
      // The roles are not participation-scoped: `scope` is applied as on query_entities.
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
          complete: false,
          filters_applied: adapted.applied,
          filters_ignored: adapted.ignored,
          scope: scoped.scope,
        };
      }
      const result = input.entity_type === 'roles'
        ? await listAiRoles(services, context.manager, scoped.query, true)
        : await listAiRolePermissions(services, context.manager, scoped.query, true);
      const counted = aggregateRolesRows(result.items, input.group_by);
      // A right or a level is named with the Roles screen's words, in the person's language.
      const labelOf = input.entity_type === 'role_permissions' && (input.group_by === 'resource' || input.group_by === 'level')
        ? { language: await readAiScreenLanguage(context.manager, context.tenantId, context.userId), field: input.group_by }
        : null;
      const groups = labelOf
        ? counted.map((group) => ({
          ...group,
          label: group.key == null
            ? null
            : labelOf.field === 'resource'
              ? aiResourceLabel(group.key as Resource, labelOf.language)
              : aiPermissionLevelLabel(group.key as PermissionLevel, labelOf.language),
        }))
        : counted;
      return {
        group_by: input.group_by,
        metric: null,
        function: 'count',
        groups,
        total: result.items.length,
        returned: groups.length,
        truncated: false,
        complete: isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }
    if (input.entity_type === 'data_access') {
      // The tool already checked the family; checked again here, the database not guarding the nodes.
      if (!this.dataAccess || (await this.policy?.canReadEntityType(context, 'data_access', context.manager)) !== true) {
        throw new DataAccessReservedException();
      }
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
          complete: false,
          filters_applied: adapted.applied,
          filters_ignored: adapted.ignored,
          scope: scoped.scope,
        };
      }
      const result = await listAiDataAccess({ dataAccess: this.dataAccess }, context.manager, scoped.query, true);
      const groups = aggregateDataAccessRows(result.items, input.group_by);
      return {
        available: result.available,
        missing: result.missing,
        ...(result.available ? {} : { unavailable_note: AI_DATA_ACCESS_UNAVAILABLE_NOTE }),
        counters: result.counters,
        coverage_note: AI_DATA_ACCESS_COVERAGE_NOTE,
        group_by: input.group_by,
        metric: null,
        function: 'count',
        groups,
        // `total` counts rows (a person per node); `distinct_total` the persons.
        total: result.items.length,
        distinct_total: result.distinct_total,
        distinct_label: 'person',
        returned: groups.length,
        truncated: false,
        complete: isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }
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
        const aggregateExpression = buildMetricAggregateExpression(fn, metric.def.expression, metric.def.round);
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

    if (input.entity_type === 'budget_lines' && ratio) {
      const { groups, total, fxMissing, overall } = await this.aggregateBudgetRatio(
        context,
        registry,
        input.group_by,
        input.q?.trim(),
        adapted.filters,
        ratio,
      );
      return {
        group_by: input.group_by,
        metric: ratio.key,
        function: 'ratio',
        groups,
        overall,
        ratio_note: BUDGET_RATIO_NOTE,
        total,
        returned: groups.length,
        truncated: false,
        complete: isCompleteAggregateResult(null),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: null,
        amounts_fx_missing: fxMissing,
      };
    }

    if (input.entity_type === 'budget_lines') {
      const { groups, total, fxMissing, overall } = await this.aggregateBudgetSummary(
        context,
        registry,
        input.group_by,
        input.q?.trim(),
        adapted.filters,
        fn,
        metric,
      );
      return {
        group_by: input.group_by,
        metric: metric?.key ?? null,
        function: fn,
        groups,
        ...(overall ? { overall } : {}),
        total,
        returned: groups.length,
        truncated: false,
        complete: isCompleteAggregateResult(null),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: null,
        ...(fxMissing ? { amounts_fx_missing: fxMissing } : {}),
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
        ...this.distinctRecordTotal(registry, scoped),
        ...(await this.familyFeeds(context, input.entity_type)),
        returned: 0,
        truncated,
        complete: !truncated && isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }

    if (input.entity_type === 'companies' && metric?.key === 'turnover_year') {
      const turnover = await this.aggregateCompanyTurnover(context, registry, input.group_by, ids, fn);
      return {
        group_by: input.group_by,
        metric: metric.key,
        function: fn,
        groups: turnover.groups,
        total: scoped.total,
        returned: turnover.groups.length,
        truncated,
        complete: !truncated && isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
        ...(turnover.missing.length ? { turnover_fx_missing: turnover.missing } : {}),
      };
    }

    const groups = input.entity_type === 'connections' && CONNECTION_EFFECTIVE_RISK_GROUPS.has(input.group_by)
      ? await this.aggregateConnectionsByEffectiveRisk(context, input.group_by, ids, fn, metric)
      : await this.aggregateByIds(context, registry, input.group_by, ids, fn, metric);
    return {
      group_by: input.group_by,
      metric: metric?.key ?? null,
      function: fn,
      groups,
      total: scoped.total,
      ...this.distinctRecordTotal(registry, scoped),
      ...(await this.familyFeeds(context, input.entity_type)),
      returned: groups.length,
      truncated,
      complete: !truncated && isCompleteAggregateResult(scoped.scope),
      filters_applied: adapted.applied,
      filters_ignored: adapted.ignored,
      scope: scoped.scope,
    };
  }
}
