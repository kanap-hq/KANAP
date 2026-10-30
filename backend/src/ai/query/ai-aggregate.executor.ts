import { BadRequestException, ForbiddenException, Injectable, Logger, Optional } from '@nestjs/common';
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
import { ChargebackReportService } from '../../spend/chargeback-report.service';
import {
  aggregateChargebackRows,
  chargebackAggregateRows,
  chargebackGroupValue,
  chargebackLineGroupValue,
  listAiChargebackLines,
} from './ai-chargeback.query';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { ManualRatesService } from '../../currency/manual-rates.service';
import { aggregateExchangeRateRows, readAiExchangeRates } from './ai-exchange-rates.query';
import { aiDataAccessNote } from './ai-data-access-note.util';
import { CostCentersService } from '../../cost-centers/cost-centers.service';
import { aggregateCostCenterRows, filterAiCostCenters } from './ai-cost-centers.query';
import { WorkingDayProfilesService } from '../../working-day-profiles/working-day-profiles.service';
import { AnalyticsAxesService } from '../../analytics/analytics-axes.service';
import {
  AI_CALENDAR_NO_YEAR_NOTE,
  AI_CALENDAR_YEAR_NOTE,
  aggregateWorkingDayCalendarRows,
  listAiWorkingDayCalendars,
} from './ai-working-day-calendars.query';
import { AI_AXIS_VALUES_NOTE, aggregateAnalyticsAxisRows, listAiAnalyticsAxes } from './ai-analytics-axes.query';
import { aiBudgetListAccess } from './ai-budget-list-access.util';
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
  AiBudgetMetricsRow,
  AiBudgetStaffFigures,
  AiDateFilterValue,
  AiEntityFilterRegistry,
  AiFilterFieldDef,
  AiFilterValue,
} from './ai-filter.types';
import { assertPlainTextQuickSearch } from './ai-quick-search-validation.util';
import { resolveAiEntityRegistry } from './registries';
import { COMPANY_AGGREGATE_METRIC_YEAR_SQL } from './registries/companies.registry';
import { isMoneyVariant, resolveFteField, resolveFteVariantField } from '../../spend/spend-summary.builder';
import {
  BudgetDeltaMetric,
  BudgetMonthlyFteMetric,
  BudgetRatioMetric,
  isBudgetMoneyKey,
  resolveBudgetDeltaMetric,
  resolveBudgetMonthlyFteMetric,
  resolveBudgetRatioMetric,
} from './registries/budget-amount-fields';
import {
  deltaRequests,
  readDelta,
  readStaffing,
  staffingGroupKeys,
  staffingRequest,
  type AggregateResult as ReportAggregateResult,
  type DeltaMode,
} from '../../spend/reports/shared/reportAggregates';
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

type BudgetValueGroup = { key: string | null; title?: string | null; then_key?: string | null; value: number | null; unknown?: number };
type BudgetCountGroup = { key: string | null; title?: string | null; then_key?: string | null; count: number };
type BudgetMetricsGroup = AiBudgetMetricsRow & { key: string | null; title?: string | null; then_key?: string | null };
type BudgetOverall = NonNullable<AiAggregateResult['overall']>;
type BudgetOthers = NonNullable<AiAggregateResult['others']>;

/**
 * The groups an aggregate of budget lines returns with `then_by` (by default) or `limit`, the rest
 * in `others`. 50 is a page of query_entities; at most 100, as the top N of lines: a group is a few
 * figures (100 groups of 8 values stay near 25 KB), and past that the answer is no longer a table a
 * person reads, while `others` and `overall` keep the totals whole.
 */
export const AI_BUDGET_GROUP_LIMIT = { default: 50, max: 100 } as const;

/**
 * The budget fields that group a line linked to several records under the combination (the streams
 * and categories of the linked projects; their names do not group): crossed with another field,
 * those combinations pile up into groups nobody reads, so a crossing refuses them.
 */
const BUDGET_MULTI_VALUED_GROUPS: Record<string, string> = {
  project_stream: 'streams',
  project_category: 'categories',
};

/** The lines a change between two columns keeps by default, as the report's top (`OpexDeltaReport`); at most AI_BUDGET_GROUP_LIMIT.max. */
export const AI_BUDGET_DELTA_DEFAULT_LIMIT = 10;

/**
 * A budget metric with its own computation, which `metrics` and `then_by` do not take: the cost
 * per FTE and the day rate (nor `limit`), the change between two columns and the FTE by month
 * (which take `limit`). The refusal, with what to ask instead; null for any other key.
 */
function budgetOwnPathRefusal(key: string, input: 'metrics' | 'then_by' | 'limit'): string | null {
  if (resolveBudgetRatioMetric(key)) {
    return `${key} is a ratio the server computes on its own and does not take ${input}. `
      + `Ask it as metric alone: each group then returns staff_fte, staff_cost, days, day_cost and day_rate. `
      + 'For two fields, filter on one value of the first and group by the second; for several years or columns, one call per metric.';
  }
  if (input === 'limit') return null;
  if (resolveBudgetDeltaMetric(key)) {
    return `${key} is a change between two columns the server computes on its own and does not take ${input}. `
      + 'Ask it as metric alone, with group_by, direction and limit: each group then returns previous, current, delta and pct_increase. '
      + 'For two fields, filter on one value of the first and group by the second; for another pair of columns, one call per change.';
  }
  if (resolveBudgetMonthlyFteMetric(key)) {
    return `${key} is the FTE month by month the server computes on its own and does not take ${input}. `
      + 'Ask it as metric alone, with group_by: each group then returns its months, average and peak. '
      + 'For two fields, filter on one value of the first and group by the second; for another year or column, one call each.';
  }
  return null;
}

/** The engine keys of a line, as the reports group it: its id, its title and its number (`BL-n`). */
const BUDGET_LINE_GROUP_KEYS = staffingGroupKeys('all', { kind: 'item' });

/** The engine keys of a budget group field: a line is grouped on its id, title and number, any other field on its column. */
function budgetGroupKeys(field: AiFilterFieldDef): string[] {
  return field.ai === 'line' ? BUDGET_LINE_GROUP_KEYS : [field.grid];
}

/** A budget group's key, read on its engine keys: a line is named by its reference (BL-12) and its title, never by its id. */
function budgetGroupKey(field: AiFilterFieldDef, keys: Array<string | null>): { key: string | null; title?: string | null } {
  if (field.ai !== 'line') return { key: keys[0] ?? null };
  return { key: keys[2] != null ? `BL-${keys[2]}` : null, title: keys[1] ?? null };
}

const BUDGET_MONTHLY_FTE_NOTE = 'Computed by the server, as the "Staffing by month" report: each month sums the FTE the quantity × price lines of the column give that month '
  + '(people and days lines; pieces lines count nothing); a null month is one no line of the group details, which is not 0. '
  + 'average is the sum of the twelve months ÷ 12 (the full-year average, not the average of the months covered) and peak the highest month; '
  + 'the groups without any month are left out. Quote these figures: never average the months again. '
  + 'fte_without_monthly_detail is FTE declared on columns without monthly detail (spread or copied), in no month; '
  + 'fte_amount_not_following_lines is FTE in the months of columns whose amount no longer follows their lines (spread, copied or edited): '
  + 'their months come from the lines, not from the column amount. Say so when present.';

/** The engine's refusal of a spec beyond its limits, in words a person reads (400). */
function engineLimitRefusal(error: unknown): never {
  if (error instanceof BadRequestException && /^Aggregate: /.test(error.message)) {
    throw new BadRequestException(`The server cannot compute this aggregate in one call: ${error.message.replace(/^Aggregate: /, '')} `
      + 'Ask fewer metrics, or split the question into several calls.');
  }
  throw error;
}
type BudgetDeltaGroup = { key: string | null; title?: string | null; count: number; previous: number | null; current: number | null; delta: number; pct_increase: number | null };
type BudgetMonthlyFteGroup = { key: string | null; title?: string | null; months: Array<number | null>; average: number | null; peak: number | null };
type BudgetRatioGroup = { key: string | null; title?: string | null; count: number; value: number | null } & AiBudgetStaffFigures;

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
    /** The chargeback reports of the screens, which `chargeback` and `chargeback_lines` group. */
    @Optional() private readonly chargeback?: ChargebackReportService,
    /** Master data › Cost centers, which `cost_centers` groups. */
    @Optional() private readonly costCenters?: CostCentersService,
    /** Master data › Working-day calendars and Analytics dimensions: `working_day_calendars`, `analytics_axes`. */
    @Optional() private readonly workingDayProfiles?: WorkingDayProfilesService,
    @Optional() private readonly analyticsAxes?: AnalyticsAxesService,
    /** The rate matrix of the Currency settings screen, which `exchange_rates` groups. */
    @Optional() private readonly manualRates?: ManualRatesService,
    /** The currency settings, in every `exchange_rates` response. */
    @Optional() private readonly currencySettings?: CurrencySettingsService,
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

  /**
   * Budget lines: `metrics` (2 to 8 metrics with one function, instead of `metric`), `then_by` (a
   * second group field) and `limit` (the groups kept, 50 by default with `then_by`, the rest in
   * `others`), checked and refused in words. The other families take none of them.
   */
  private resolveBudgetShape(
    registry: AiEntityFilterRegistry,
    input: { entity_type: AiQueryEntityType; group_by: string; metric?: string; metrics?: string[]; then_by?: string; limit?: number },
    fn: AiAggregateFunction,
  ): { metrics?: string[]; thenBy?: string; limit?: number } {
    const metrics = input.metrics?.map((key) => key.trim()).filter(Boolean);
    const thenBy = input.then_by?.trim() || undefined;
    const asked = !!metrics?.length || !!thenBy || input.limit != null;
    if (!asked) return {};
    if (input.entity_type !== 'budget_lines') {
      throw new BadRequestException('metrics, then_by and limit apply to budget lines only: on this family, group by one field with one metric.');
    }
    const metric = input.metric?.trim();
    if (metric && metrics?.length) throw new BadRequestException('Give metric (one metric) or metrics (several), not both.');
    // Ratios have their own computation: what to ask instead.
    const ownPath = metric
      ? budgetOwnPathRefusal(metric, thenBy ? 'then_by' : 'limit')
      : (metrics ?? []).map((key) => budgetOwnPathRefusal(key, 'metrics')).find((refusal) => refusal);
    if (ownPath) throw new BadRequestException(ownPath);
    if (metrics?.length) {
      if (metrics.length < 2 || metrics.length > 8) throw new BadRequestException('metrics takes 2 to 8 metrics; for one, use metric.');
      if (new Set(metrics).size !== metrics.length) throw new BadRequestException('metrics names a metric twice.');
      if (fn === 'count') throw new BadRequestException('metrics takes the function sum, avg, min or max (one for every metric); a count needs no metric.');
      for (const key of metrics) {
        const field = registry.fields[key];
        if (!field || field.aggregable !== true || field.type !== 'number') {
          throw new BadRequestException(`metrics: ${key} is not a metric of budget lines (an amount, an FTE or a line total, such as y_budget, y_budget_fte or y_budget_staff_cost).`);
        }
      }
    }
    if (thenBy) {
      const withheld = registry.withheldFields?.find((entry) => entry.field === thenBy);
      if (withheld) throw new ForbiddenException(`then_by ${withheld.field} is not available: ${withheld.reason}`);
      const field = registry.fields[thenBy];
      if (!field || field.groupable !== true) throw new BadRequestException('Unsupported then_by field: a group-by field describe_entity_filters lists.');
      if (thenBy === input.group_by) throw new BadRequestException('then_by names the group_by field again: give a second field, or leave then_by out.');
      if (thenBy === 'line' || input.group_by === 'line') {
        throw new BadRequestException('A line has one value of every other field, so a second field does not cross it: group by line alone (query_entities gives its fields), or cross two other fields.');
      }
      for (const key of [input.group_by, thenBy]) {
        const linked = BUDGET_MULTI_VALUED_GROUPS[key];
        if (linked) {
          throw new BadRequestException(`${key} groups a line linked to several ${linked} under the combination, which a second field cannot cross. `
            + `Group by ${key} alone, or filter on one of its values and group by the other field.`);
        }
      }
    }
    const limit = input.limit ?? (thenBy ? AI_BUDGET_GROUP_LIMIT.default : undefined);
    if (limit != null && !(Number.isInteger(limit) && limit >= 1 && limit <= AI_BUDGET_GROUP_LIMIT.max)) {
      throw new BadRequestException(`limit is a whole number from 1 to ${AI_BUDGET_GROUP_LIMIT.max}.`);
    }
    return { ...(metrics?.length ? { metrics } : {}), ...(thenBy ? { thenBy } : {}), ...(limit != null ? { limit } : {}) };
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
    // `metrics`: several metrics with one function (each group's `values`); `thenBy`: a second
    // group field (`then_key`); `limit`: the groups kept, the rest in `others`.
    more: { metrics?: string[]; thenBy?: string; limit?: number } = {},
  ): Promise<{
    groups: Array<BudgetCountGroup | BudgetValueGroup | BudgetMetricsGroup>;
    total: number;
    fxMissing: FxMissingPair[] | null;
    overall: BudgetOverall | null;
    others: BudgetOthers | null;
    groupCount: number;
  }> {
    const groupField = registry.fields[groupBy];
    if (!groupField) {
      throw new BadRequestException('Unsupported group_by field.');
    }
    const thenField = more.thenBy ? registry.fields[more.thenBy] : null;
    const groupKeys = budgetGroupKeys(groupField);
    const keys = [...groupKeys, ...(thenField ? [thenField.grid] : [])];
    const limit = more.limit != null ? { limit: more.limit, others: true } : {};
    let spec: AggregateSpec;
    let fte = false;
    if (more.metrics?.length) {
      // One measure per metric, ordered by the first.
      spec = {
        groupBy: keys,
        measures: more.metrics.map((key, i) => ({ id: `m${i}`, fn: fn as 'sum' | 'avg' | 'min' | 'max', field: registry.fields[key].grid })),
        order: [{ by: 'measure', id: 'm0', dir: getMetricOrderDirection(fn), nulls: 'LAST' }],
        ...limit,
      };
    } else if (fn === 'count' || !metric) {
      spec = { groupBy: keys, measures: [], order: [{ by: 'count', dir: 'DESC' }], ...limit };
    } else {
      const metricField = registry.fields[metric.key];
      if (!metricField) {
        throw new BadRequestException('Unsupported metric field.');
      }
      // FTE and days (not amounts) count, per group, the lines without a value.
      const variant = resolveFteVariantField(metricField.grid);
      fte = resolveFteField(metricField.grid) != null || (variant != null && !isMoneyVariant(variant));
      spec = {
        groupBy: keys,
        measures: [{ id: 'value', fn, field: metricField.grid }],
        order: [{ by: 'measure', id: 'value', dir: getMetricOrderDirection(fn), nulls: 'LAST' }],
        ...limit,
      };
    }

    // The person's access, as the screen passes it: the consolidation fields read only for a reader of accounts.
    const access = await aiBudgetListAccess(this.policy, context);
    const result = await this.budgetLines.summaryAggregate({ q, filters, includeDisabled: true }, spec, { manager: context.manager, access })
      .catch(engineLimitRefusal);
    // `values` and `unknown` by metric name (the engine's measure ids are m0, m1...); `unknown` only for the FTE metrics.
    const metricsRow = (row: { count: number; values: Record<string, number | null>; unknown: Record<string, number> }): AiBudgetMetricsRow => {
      const names = more.metrics!;
      const unknown = Object.fromEntries(names.flatMap((name, i) => (`m${i}` in row.unknown ? [[name, row.unknown[`m${i}`]]] : [])));
      return {
        count: row.count,
        values: Object.fromEntries(names.map((name, i) => [name, row.values[`m${i}`] ?? null])),
        ...(Object.keys(unknown).length ? { unknown } : {}),
      };
    };
    const groups = result.groups.map((group) => {
      const key = budgetGroupKey(groupField, group.keys);
      // A null `then_key` is a real group: the lines without a value of the second field.
      const then = thenField ? { then_key: group.keys[groupKeys.length] ?? null } : {};
      if (more.metrics?.length) return { ...key, ...then, ...metricsRow(group) };
      if (!spec.measures.length) return { ...key, ...then, count: group.count };
      return fte ? { ...key, ...then, value: group.values.value, unknown: group.unknown.value } : { ...key, ...then, value: group.values.value };
    });
    // The same measure over every line (all groups together): a total the answer quotes, never adds up.
    let overall: BudgetOverall | null = null;
    if (more.metrics?.length) overall = metricsRow(result.total);
    else if (spec.measures.length) {
      overall = { count: result.total.count, value: result.total.values.value ?? null, ...(fte ? { unknown: result.total.unknown.value ?? 0 } : {}) };
    }
    // The groups past the limit, as one row, with the number of groups it holds.
    const othersGroups = result.groupCount - groups.length;
    let others: BudgetOthers | null = null;
    if (result.others && othersGroups > 0) {
      const row = result.others;
      if (more.metrics?.length) others = { ...metricsRow(row), groups: othersGroups };
      else if (!spec.measures.length) others = { count: row.count, groups: othersGroups };
      else others = { count: row.count, value: row.values.value ?? null, ...(fte ? { unknown: row.unknown.value ?? 0 } : {}), groups: othersGroups };
    }
    // The amounts left out of the values for lack of a rate (`[]` when none); null without a measure.
    return {
      groups,
      total: result.total.count,
      fxMissing: spec.measures.length ? result.fxMissing ?? [] : null,
      overall,
      others,
      groupCount: result.groupCount,
    };
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
      groupBy: budgetGroupKeys(groupField),
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
    const access = await aiBudgetListAccess(this.policy, context);
    const result = await this.budgetLines.summaryAggregate({ q, filters, includeDisabled: true }, spec, { manager: context.manager, access });
    const valueOf = (figures: AiBudgetStaffFigures) => (ratio.kind === 'cost_per_fte' ? figures.cost_per_fte : figures.day_rate);
    const groups = result.groups
      .filter((group) => group.values[governing] != null)
      .map((group): BudgetRatioGroup => {
        const figures = budgetStaffFigures(group.values);
        return { ...budgetGroupKey(groupField, group.keys), count: group.count, value: valueOf(figures), ...figures };
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

  /**
   * A change between two columns (`y_review_minus_y_budget`, or in FTE): the "Top increase /
   * decrease" report's own request (`deltaRequests`: the source, the destination, their change and
   * its rises and falls; the groups that rise, or fall, largest change first, `limit` of them) grouped
   * by Plaid's field, on Plaid's lines, read by the report's own reader (`readDelta`). `overall`
   * holds the sources, destinations and changes of every line the filters keep.
   */
  private async aggregateBudgetDelta(
    context: AiExecutionContextWithManager,
    registry: AiEntityFilterRegistry,
    groupBy: string,
    q: string | undefined,
    filters: Record<string, any>,
    delta: BudgetDeltaMetric,
    direction: DeltaMode,
    limit: number,
  ): Promise<{ groups: BudgetDeltaGroup[]; total: number; groupCount: number; fxMissing: FxMissingPair[]; overall: BudgetOverall }> {
    const groupField = registry.fields[groupBy];
    if (!groupField) throw new BadRequestException('Unsupported group_by field.');
    const [request] = deltaRequests({
      scope: 'all',
      source: delta.source,
      destination: delta.destination,
      modes: [direction],
      topCount: limit,
      excludedIds: [],
      excludedAccounts: [],
      filters: {},
      measure: delta.measure,
    });
    const spec = { ...request.spec, groupBy: budgetGroupKeys(groupField) } as AggregateSpec;
    const access = await aiBudgetListAccess(this.policy, context);
    const result = await this.budgetLines.summaryAggregate({ q, filters, includeDisabled: true }, spec, { manager: context.manager, access });
    // One direction: the reader's rows are the groups, in their order.
    const { processed, allTotals } = readDelta([direction], [result as unknown as ReportAggregateResult], delta.measure);
    const groups = result.groups.map((group, i): BudgetDeltaGroup => {
      const row = processed[i];
      return {
        ...budgetGroupKey(groupField, group.keys),
        count: group.count,
        previous: row.previous,
        current: row.current,
        delta: row.delta,
        pct_increase: row.pct_increase == null ? null : round2(row.pct_increase),
      };
    });
    // As the reader: an amount nobody holds is 0, an FTE nobody declares is null.
    const side = (id: 'prev' | 'curr') => result.total.values[id] ?? (delta.measure === 'fte' ? null : 0);
    const overall: BudgetOverall = {
      count: result.total.count,
      previous: side('prev'),
      current: side('curr'),
      net: allTotals.net,
      gross_increase: allTotals.grossIncrease,
      gross_decrease: allTotals.grossDecrease,
    };
    return { groups, total: result.total.count, groupCount: result.groupCount, fxMissing: result.fxMissing ?? [], overall };
  }

  /**
   * The FTE of each month of one year and column (`y_budget_fte_by_month`): the "Staffing by month"
   * report's own request (`staffingRequest`: twelve monthly sums, the FTE whose amount no longer
   * follows its lines and the FTE without monthly detail) grouped by Plaid's field, on Plaid's lines,
   * read by the report's own reader (`readStaffing`: the groups with a month, largest average first,
   * the total row and its two notices). `limit` keeps the first groups; `overall` holds every line.
   */
  private async aggregateBudgetMonthlyFte(
    context: AiExecutionContextWithManager,
    registry: AiEntityFilterRegistry,
    groupBy: string,
    q: string | undefined,
    filters: Record<string, any>,
    monthly: BudgetMonthlyFteMetric,
    limit: number | undefined,
  ): Promise<{ groups: BudgetMonthlyFteGroup[]; total: number; groupCount: number; overall: BudgetOverall }> {
    const groupField = registry.fields[groupBy];
    if (!groupField) throw new BadRequestException('Unsupported group_by field.');
    const request = staffingRequest({ scope: 'all', year: monthly.year, metric: monthly.metric, group: { kind: 'item' }, filters: {} });
    const spec = { ...request.spec, groupBy: budgetGroupKeys(groupField) } as AggregateSpec;
    const access = await aiBudgetListAccess(this.policy, context);
    const result = await this.budgetLines.summaryAggregate({ q, filters, includeDisabled: true }, spec, { manager: context.manager, access });
    const staffing = readStaffing(result as unknown as ReportAggregateResult, { none: '', unnamed: '' }, (a, b) => a.localeCompare(b));
    const line = groupField.ai === 'line';
    const figures = (row: { months: Array<number | null>; average: number | null; peak: number | null }) => ({
      months: row.months.map((value) => (value == null ? null : round2(value))),
      average: row.average == null ? null : round2(row.average),
      peak: row.peak == null ? null : round2(row.peak),
    });
    // The reader keys a line by its reference and any other group by its value (`name` null: the lines without one).
    const rows = staffing.rows.map((row): BudgetMonthlyFteGroup => (line
      ? { key: row.key.startsWith('BL-') ? row.key : null, title: row.name, ...figures(row) }
      : { key: row.name == null ? null : row.key, ...figures(row) }));
    const groups = limit != null ? rows.slice(0, limit) : rows;
    const overall: BudgetOverall = {
      count: result.total.count,
      ...figures(staffing.total),
      ...(staffing.noDetail ? { fte_without_monthly_detail: staffing.noDetail.fte } : {}),
      ...(staffing.detached ? { fte_amount_not_following_lines: staffing.detached.fte } : {}),
    };
    return { groups, total: result.total.count, groupCount: rows.length, overall };
  }

  async execute(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiQueryEntityType;
      group_by: string;
      metric?: string;
      metrics?: string[];
      then_by?: string;
      limit?: number;
      direction?: DeltaMode;
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
    // With `metrics` (budget lines), one amount among them is enough: the note names their currency.
    const isAmount = isBudgetLineEntity(input.entity_type) && result.metrics?.length
      ? result.metrics.some(isBudgetMoneyKey)
      : metric !== '' && (isBudgetLineEntity(input.entity_type) ? isBudgetMoneyKey(metric) : metric.startsWith('yearly_amount'));
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
      metrics?: string[];
      then_by?: string;
      limit?: number;
      direction?: DeltaMode;
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
    // A field the person may not read is refused with the reason (the right), never grouped as one blank group.
    const withheld = registry.withheldFields?.find((entry) => entry.field === input.group_by);
    if (withheld) throw new ForbiddenException(`group_by ${withheld.field} is not available: ${withheld.reason}`);
    if (!field || field.groupable !== true) {
      throw new BadRequestException('Unsupported group_by field.');
    }
    assertPlainTextQuickSearch(input.entity_type, input.q, registry);

    // A budget ratio (cost per FTE, day rate), a change between two columns and the FTE by month are
    // no fields: the server computes them whatever the function.
    const budgetLines = isBudgetLineEntity(input.entity_type);
    const ratio = budgetLines ? resolveBudgetRatioMetric(input.metric?.trim()) : null;
    const delta = budgetLines ? resolveBudgetDeltaMetric(input.metric?.trim()) : null;
    const monthly = budgetLines ? resolveBudgetMonthlyFteMetric(input.metric?.trim()) : null;
    const fn = normalizeAggregateFunction(input.function);
    const budget = this.resolveBudgetShape(registry, input, fn);
    if (input.direction != null) {
      if (!delta) throw new BadRequestException('direction applies to a change between two columns, a metric such as y_review_minus_y_budget.');
      if (input.direction !== 'increase' && input.direction !== 'decrease') throw new BadRequestException('direction is increase or decrease.');
    }
    const ownMetric = ratio ?? delta ?? monthly;
    const ownFunction = ratio ? 'ratio' : delta ? 'delta' : monthly ? 'by_month' : null;
    const metric = ownMetric || budget.metrics ? null : this.resolveMetric(registry, input.metric?.trim(), fn);
    const normalizedFilters = await this.normalizePersonFilters(context, input.entity_type, input.filters);
    const adapted = adaptFilters(registry, normalizedFilters);
    if (adapted.ignored.length > 0) {
      const refusal = invalidFilterResult(registry, adapted);
      return {
        status: refusal.status,
        group_by: input.group_by,
        ...(budget.thenBy ? { then_by: budget.thenBy } : {}),
        metric: metric || ownMetric ? input.metric?.trim() ?? null : null,
        ...(budget.metrics ? { metrics: budget.metrics } : {}),
        function: ownFunction ?? fn,
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
      // The tool already checked the family; checked again here, as the data access branch, in the
      // policy's words (the right and the screen, or the reserved message).
      if (!this.policy) throw new ForbiddenException('The roles are not available.');
      await this.policy.assertEntityTypeReadRight(context, input.entity_type, context.manager);
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
    if (input.entity_type === 'working_day_calendars' || input.entity_type === 'analytics_axes') {
      // Read with the right of their page, as the screen: checked again here, the database not guarding it.
      if (!this.policy) throw new BadRequestException('The master data is not available.');
      await this.policy.assertEntityTypeReadRight(context, input.entity_type, context.manager);
      const scoped = await applyScopeToAiQuery(
        context,
        input.entity_type,
        { q: input.q?.trim(), filters: adapted.filters },
        input.scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return {
          group_by: input.group_by,
          metric: null,
          function: 'count',
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
      const language = await readAiScreenLanguage(context.manager, context.tenantId, context.userId);
      const base = { manager: context.manager, tenantId: context.tenantId, userId: context.userId };
      const shared = {
        group_by: input.group_by,
        metric: null,
        function: 'count' as const,
        truncated: false,
        complete: isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
      if (input.entity_type === 'working_day_calendars') {
        if (!this.workingDayProfiles) throw new BadRequestException('The working-day calendars are not available.');
        const result = await listAiWorkingDayCalendars({ calendars: this.workingDayProfiles }, scoped.query, { ...base, lang: language ?? 'en' }, true);
        const groups = aggregateWorkingDayCalendarRows(result.items, input.group_by);
        return {
          calendar_year: result.year,
          calendar_note: result.year != null ? AI_CALENDAR_YEAR_NOTE : AI_CALENDAR_NO_YEAR_NOTE,
          ...shared,
          groups,
          total: result.items.length,
          returned: groups.length,
        };
      }
      if (!this.analyticsAxes) throw new BadRequestException('The analytics dimensions are not available.');
      const result = await listAiAnalyticsAxes({ axes: this.analyticsAxes }, scoped.query, { ...base, language }, true);
      const groups = aggregateAnalyticsAxisRows(result.items, input.group_by);
      return {
        values_note: AI_AXIS_VALUES_NOTE,
        ...shared,
        groups,
        // A dimension required for both natures counts in each group of required_for.
        total: result.items.length,
        returned: groups.length,
      };
    }
    if (input.entity_type === 'chargeback' || input.entity_type === 'chargeback_lines') {
      // Read with the reporting right, as the routes: checked again here, the database not guarding it.
      if (!this.policy || !this.chargeback) throw new BadRequestException('The chargeback reports are not available.');
      await this.policy.assertEntityTypeReadRight(context, input.entity_type, context.manager);
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
      const services = { chargeback: this.chargeback };
      const opts = { manager: context.manager, tenantId: context.tenantId };
      const read = input.entity_type === 'chargeback'
        ? await chargebackAggregateRows(services, scoped.query, opts, input.group_by)
        : await listAiChargebackLines(services, scoped.query, opts, true).then((list) => ({ rows: list.items, report: list.report }));
      const groups = input.entity_type === 'chargeback'
        ? aggregateChargebackRows(read.rows as any[], (row) => chargebackGroupValue(row, input.group_by), fn, metric?.key ?? null)
        : aggregateChargebackRows(read.rows as any[], (row) => chargebackLineGroupValue(row, input.group_by), fn, metric?.key ?? null);
      // An amount names its currency; a count, a share, a headcount or a percentage has none.
      const money = new Set(['amount', 'paid', 'net', 'turnover', 'cost_per_user', 'cost_per_it_user']);
      const amounts = metric && money.has(metric.key) ? await aiAmountsCurrency(context, input.entity_type) : null;
      return {
        chargeback: read.report,
        ...(amounts ?? {}),
        group_by: input.group_by,
        metric: metric?.key ?? null,
        function: fn,
        groups,
        // The rows of the report table the groups add up (`level`): a count counts them, not budget lines.
        total: read.rows.length,
        returned: groups.length,
        truncated: false,
        complete: isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }
    if (input.entity_type === 'cost_centers') {
      // Read with the right of the page, as its route: checked again here, the database not guarding it.
      if (!this.policy || !this.costCenters) throw new BadRequestException('The cost centers are not available.');
      await this.policy.assertEntityTypeReadRight(context, input.entity_type, context.manager);
      const scoped = await applyScopeToAiQuery(
        context,
        input.entity_type,
        { q: input.q?.trim(), filters: adapted.filters },
        input.scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return {
          group_by: input.group_by,
          metric: null,
          function: 'count',
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
      const { rows, unmatched_note } = await filterAiCostCenters(
        { costCenters: this.costCenters },
        { manager: context.manager, tenantId: context.tenantId },
        scoped.query,
      );
      const groups = aggregateCostCenterRows(rows, input.group_by);
      return {
        ...(unmatched_note ? { unmatched_note } : {}),
        group_by: input.group_by,
        metric: null,
        function: 'count',
        groups,
        // The nodes of the tree the filters keep, groups and cost centers alike unless `kind` says.
        total: rows.length,
        returned: groups.length,
        truncated: false,
        complete: isCompleteAggregateResult(scoped.scope),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: scoped.scope,
      };
    }
    if (input.entity_type === 'exchange_rates') {
      const scoped = await applyScopeToAiQuery(
        context,
        input.entity_type,
        { q: input.q?.trim(), filters: adapted.filters },
        input.scope,
      );
      if (scoped.scope && scoped.scope.resolved === false) {
        return {
          group_by: input.group_by,
          metric: null,
          function: 'count',
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
      const result = await readAiExchangeRates(
        { policy: this.policy, rates: this.manualRates, settings: this.currencySettings },
        context,
        scoped.query,
        true,
      );
      const groups = aggregateExchangeRateRows(result.items, input.group_by);
      return {
        exchange_rates: result.block,
        group_by: input.group_by,
        metric: null,
        function: 'count',
        groups,
        // `total` counts the rows of the matrix the filters keep: a currency in one year each.
        total: result.items.length,
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

    if (input.entity_type === 'budget_lines' && delta) {
      const direction = input.direction ?? 'increase';
      const limit = budget.limit ?? AI_BUDGET_DELTA_DEFAULT_LIMIT;
      const { groups, total, groupCount, fxMissing, overall } = await this.aggregateBudgetDelta(
        context,
        registry,
        input.group_by,
        input.q?.trim(),
        adapted.filters,
        delta,
        direction,
        limit,
      );
      return {
        group_by: input.group_by,
        metric: delta.key,
        function: 'delta',
        direction,
        groups,
        overall,
        limit,
        group_count: groupCount,
        total,
        returned: groups.length,
        truncated: groupCount > groups.length,
        complete: isCompleteAggregateResult(null),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: null,
        ...(delta.measure === 'amount' ? { amounts_fx_missing: fxMissing } : {}),
      };
    }

    if (input.entity_type === 'budget_lines' && monthly) {
      const { groups, total, groupCount, overall } = await this.aggregateBudgetMonthlyFte(
        context,
        registry,
        input.group_by,
        input.q?.trim(),
        adapted.filters,
        monthly,
        budget.limit,
      );
      return {
        group_by: input.group_by,
        metric: monthly.key,
        function: 'by_month',
        groups,
        overall,
        monthly_fte_note: BUDGET_MONTHLY_FTE_NOTE,
        ...(budget.limit != null ? { limit: budget.limit, group_count: groupCount } : {}),
        total,
        returned: groups.length,
        truncated: groupCount > groups.length,
        complete: isCompleteAggregateResult(null),
        filters_applied: adapted.applied,
        filters_ignored: adapted.ignored,
        scope: null,
      };
    }

    if (input.entity_type === 'budget_lines') {
      const { groups, total, fxMissing, overall, others, groupCount } = await this.aggregateBudgetSummary(
        context,
        registry,
        input.group_by,
        input.q?.trim(),
        adapted.filters,
        fn,
        metric,
        { metrics: budget.metrics, thenBy: budget.thenBy, limit: budget.limit },
      );
      return {
        group_by: input.group_by,
        ...(budget.thenBy ? { then_by: budget.thenBy } : {}),
        metric: metric?.key ?? null,
        ...(budget.metrics ? { metrics: budget.metrics } : {}),
        function: fn,
        groups,
        ...(overall ? { overall } : {}),
        ...(others ? { others } : {}),
        ...(budget.limit != null ? { limit: budget.limit, group_count: groupCount } : {}),
        total,
        returned: groups.length,
        // With a limit, the groups past it are in `others`: the figures stay whole (`complete`).
        truncated: groupCount > groups.length,
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
