import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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
import { IncidentRecordService, IncidentsService } from '../../incidents/services';
import { incidentVisibilitySql, resolveIncidentViewer } from '../../incidents/incident-visibility';
import { InterfacesService } from '../../interfaces/services';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import {
  documentIncidentVisibilitySql,
} from '../../knowledge/document-entity-visibility';
import { LocationsService } from '../../locations/locations.service';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioProjectsService } from '../../portfolio/services';
import { SpendItemsService } from '../../spend/spend-items.service';
import { TasksService } from '../../spend/tasks.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { UsersService } from '../../users/users.service';
import {
  AiEntityMetadata,
  AiEntityDetailDto,
  AiEntitySummaryDto,
  AiExecutionContextWithManager,
  AiQueryEntityType,
  AiQueryScope,
} from '../ai.types';
import { adaptFilters } from './ai-filter.adapter';
import {
  buildFilterRepairSuggestions,
  hasEmailOrUuidFilterValue,
} from './ai-filter-description.util';
import {
  applyScopeToAiQuery,
  isParticipationScopedAiEntityType,
  participantConditionForAiEntity,
  resolveAiDocumentIncidentViewer,
  resolveAiParticipationAccessScope,
} from './ai-query-scope.util';
import {
  AiEntityFilterRegistry,
  AiFilterValue,
  AiFilterValuesResult,
  AiQueryResult,
} from './ai-filter.types';
import { assertPlainTextQuickSearch } from './ai-quick-search-validation.util';
import { analyticsAxisFields, resolveAiEntityRegistry } from './registries';
import { budgetFteFields } from './registries/budget-amount-fields';
import { analyticsAxisLabel, AnalyticsAxisInfo, axisAppliesTo, loadAnalyticsAxes, parseAnalyticsFieldKey } from '../../analytics/analytics-axes.util';
import { FIXED_SLOTS, FixedSlot, fteFieldKey, resolveFteField, SlotMetric, SUMMARY_COLUMNS } from '../../spend/spend-summary.builder';

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function buildRef(
  entityType: AiQueryEntityType,
  itemNumber?: number | null,
): string | null {
  if (!itemNumber) return null;
  if (entityType === 'projects') return `PRJ-${itemNumber}`;
  if (entityType === 'requests') return `REQ-${itemNumber}`;
  if (entityType === 'tasks') return `T-${itemNumber}`;
  if (entityType === 'documents') return `DOC-${itemNumber}`;
  if (entityType === 'incidents') return `INC-${itemNumber}`;
  return null;
}

function scalar(value: unknown): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return toIso(value);
  return String(value);
}

function numericScalar(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeMetricYear(value: unknown): number | null {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1900 || parsed > 3000) return null;
  return parsed;
}

function displayName(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  if (typeof value !== 'object') return null;

  const row = value as {
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
  };
  if (typeof row.name === 'string' && row.name.trim()) return row.name.trim();
  const combined = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return combined || row.email || null;
}

function joinDisplayNames(values: unknown[]): string | null {
  const names = Array.from(new Set(values.map((value) => displayName(value)).filter((value): value is string => !!value)));
  return names.length > 0 ? names.join(', ') : null;
}

function extractContributorNames(row: any): string | null {
  return joinDisplayNames([
    ...(Array.isArray(row?.business_team) ? row.business_team : []),
    ...(Array.isArray(row?.it_team) ? row.it_team : []),
  ]);
}

function budgetSlot(row: any, slot: FixedSlot, anchorYear: number): any {
  const versions = row?.versions;
  if (!versions || typeof versions !== 'object') return null;
  return versions[slot.key] ?? versions[`y${anchorYear + slot.offset}`] ?? null;
}

function budgetSlotValue(slot: any, metric: SlotMetric): number | null {
  if (!slot || typeof slot !== 'object') return null;
  const reportingValue = numericScalar(slot.reporting?.[metric]);
  if (reportingValue != null) return reportingValue;
  return numericScalar(slot.totals?.[metric]);
}

/**
 * The FTE of a fixed slot and column: the slot's engine key, else its year's,
 * else the AI key of a detail row already converted by `withDetailAiKeys`; null is unknown.
 */
function budgetFteValue(row: any, slot: FixedSlot, column: (typeof SUMMARY_COLUMNS)[number], anchorYear: number): number | null {
  return numericScalar(
    row?.[fteFieldKey(`${slot.key}${column.suffix}`)]
      ?? row?.[fteFieldKey(`y${anchorYear + slot.offset}${column.suffix}`)]
      ?? row?.[`${slot.ai}_${column.ai}_fte`],
  );
}

/**
 * Every column of every fixed year under its registry key (`y_plus1_forecast`),
 * and the same per year; the FTE of each under `<slot>_<column>_fte`.
 */
function budgetAmountMetadata(row: any, anchorYear: number): AiEntityMetadata {
  const metadata: AiEntityMetadata = {};
  const yearlyTotals: Array<Record<string, string | number | null>> = [];
  for (const slot of FIXED_SLOTS) {
    const data = budgetSlot(row, slot, anchorYear);
    const year: Record<string, string | number | null> = { label: slot.label, year: anchorYear + slot.offset };
    for (const column of SUMMARY_COLUMNS) {
      const value = budgetSlotValue(data, column.key);
      metadata[`${slot.ai}_${column.ai}`] = value;
      year[column.ai] = value;
    }
    yearlyTotals.push(year);
  }
  metadata.yearly_totals = yearlyTotals;
  for (const slot of FIXED_SLOTS) {
    for (const column of SUMMARY_COLUMNS) metadata[`${slot.ai}_${column.ai}_fte`] = budgetFteValue(row, slot, column, anchorYear);
  }
  return metadata;
}

/**
 * The value of each enabled non-default analytics dimension under its AI key
 * (`analytics:<code>`): read from the engine's key, or from the AI key on a
 * detail row already converted by `withDetailAiKeys`.
 */
function analyticsAxisMetadata(row: any, registry: AiEntityFilterRegistry): AiEntityMetadata {
  return Object.fromEntries(analyticsAxisFields(registry).map(({ key, grid }) => [key, scalar(row?.[grid] ?? row?.[key])]));
}

/**
 * A summary row as the AI detail shows it: the dimension values under their AI
 * keys (`analytics:<code>`) and the FTE under theirs (`y_budget_fte`), without
 * the engine's per-id and `fte_<slot><Suffix>` keys.
 */
function withDetailAiKeys(row: Record<string, any> | undefined, registry: AiEntityFilterRegistry): Record<string, any> | undefined {
  if (!row) return row;
  const output: Record<string, any> = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === 'analytics_value_ids' || parseAnalyticsFieldKey(key) || resolveFteField(key)) continue;
    output[key] = value;
  }
  for (const { key, grid } of analyticsAxisFields(registry)) output[key] = row[grid] ?? null;
  for (const field of Object.values(budgetFteFields())) output[field.ai] = numericScalar(row[field.grid]);
  return output;
}

/** The descriptive fields both budget item types share, for the registry resolved for the tenant. */
function budgetItemMetadata(row: any, registry: AiEntityFilterRegistry): AiEntityMetadata {
  return {
    supplier: scalar(row.supplier_name),
    paying_company: scalar(row.paying_company_name ?? row.company_name),
    account: scalar(row.account_display),
    owner_it: scalar(row.owner_it_name),
    owner_business: scalar(row.owner_business_name),
    analytics_category: scalar(row.analytics_category_name),
    ...analyticsAxisMetadata(row, registry),
    cost_center: scalar(row.cost_center_label),
    budget_holder: scalar(row.budget_holder_name),
    run_build: scalar(row.run_build),
    allocation_method: scalar(row.allocation_method_label),
    next_year_allocation_method: scalar(row.next_year_allocation_method_label),
    contract: scalar(row.latest_contract_name),
    currency: scalar(row.currency),
    effective_start: scalar(row.effective_start),
    end_of_validity: scalar(row.disabled_at),
    project_name: scalar(row.project_name),
    project_stream: scalar(row.project_stream_name),
    project_category: scalar(row.project_category_name),
  };
}

/** The years the AI reads on both budget item types: the five fixed ones. */
function budgetQueryYears(anchorYear: number): number[] {
  return FIXED_SLOTS.map((slot) => anchorYear + slot.offset);
}

const DETAIL_OMITTED_KEYS = new Set([
  'tenant_id',
  'storage_key',
  'storage_path',
  'file_path',
  'object_key',
  'password',
  'secret',
  'token',
]);

function sanitizeDetailValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return toIso(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((entry) => sanitizeDetailValue(entry));

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalizedKey = key.toLowerCase();
    if (DETAIL_OMITTED_KEYS.has(normalizedKey)) continue;
    if (normalizedKey.endsWith('_encrypted')) continue;
    if (normalizedKey.includes('password') || normalizedKey.includes('secret')) continue;
    if (normalizedKey.endsWith('_token') || normalizedKey.includes('api_key')) continue;
    output[key] = sanitizeDetailValue(entry);
  }
  return output;
}

function toEntitySummary(
  entityType: AiQueryEntityType,
  row: {
    id: string;
    item_number?: number | null;
    label: string;
    status: string | null;
    summary?: string | null;
    updated_at?: Date | string | null;
    metadata?: AiEntityMetadata;
  },
): AiEntitySummaryDto {
  return {
    type: entityType,
    id: row.id,
    ref: buildRef(entityType, row.item_number ?? null),
    label: row.label,
    status: row.status ?? null,
    summary: row.summary ?? null,
    updated_at: toIso(row.updated_at),
    metadata: row.metadata ?? null,
  };
}

@Injectable()
export class AiQueryExecutor {
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
    private readonly incidentRecords: IncidentRecordService,
  ) {}

  private resolveSort(
    registry: AiEntityFilterRegistry,
    sort?: { field: string; direction: 'asc' | 'desc' },
  ): string {
    if (!sort?.field) {
      return `${registry.defaultSort.field}:${registry.defaultSort.direction.toUpperCase()}`;
    }
    const mappedField = registry.sortFields[sort.field];
    const direction = sort.direction === 'asc' ? 'ASC' : 'DESC';
    if (!mappedField) {
      return `${registry.defaultSort.field}:${registry.defaultSort.direction.toUpperCase()}`;
    }
    return `${mappedField}:${direction}`;
  }

  private async normalizePersonFilters(
    context: AiExecutionContextWithManager,
    entityType: AiQueryEntityType,
    filters?: Record<string, AiFilterValue>,
  ): Promise<Record<string, AiFilterValue> | undefined> {
    if (entityType !== 'tasks' || !filters) return filters;

    const normalized: Record<string, AiFilterValue> = { ...filters };
    const personFields: Array<{ field: 'assignee' | 'creator'; idColumn: string }> = [
      { field: 'assignee', idColumn: 'assignee_user_id' },
      { field: 'creator', idColumn: 'creator_id' },
    ];

    for (const { field, idColumn } of personFields) {
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
        const trimmed = value.trim();
        const rows = await context.manager.query(
          `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), email) AS display_name
           FROM users
           WHERE tenant_id = $1
             AND (LOWER(email) = LOWER($2) OR id::text = $2)
           LIMIT 1`,
          [context.tenantId, trimmed],
        );
        resolvedValues.push(rows[0]?.display_name ?? trimmed);
      }

      if (resolvedValues.length > 0) {
        normalized[field] = Array.isArray(rawValue) ? resolvedValues : resolvedValues[0] ?? rawValue;
      }

      const aliasValue = normalized[idColumn];
      if (aliasValue && !normalized[field]) {
        normalized[field] = aliasValue;
      }
    }

    return normalized;
  }

  private async buildBaseQuery(
    context: AiExecutionContextWithManager,
    entityType: AiQueryEntityType,
    registry: AiEntityFilterRegistry,
    input: {
      filters?: Record<string, AiFilterValue>;
      q?: string;
      year?: number;
      sort?: { field: string; direction: 'asc' | 'desc' };
      page?: number;
      limit?: number;
    },
  ): Promise<{ query: Record<string, any>; filtersApplied: string[]; filtersIgnored: string[] }> {
    const normalizedFilters = await this.normalizePersonFilters(context, entityType, input.filters);
    const adapted = adaptFilters(registry, normalizedFilters);
    const page = Math.min(Math.max(Number(input.page) || 1, 1), 100);
    const limit = Math.min(Math.max(Number(input.limit) || 200, 1), 200);
    assertPlainTextQuickSearch(entityType, input.q, registry);
    const query: Record<string, any> = {
      page,
      limit,
      sort: this.resolveSort(registry, input.sort),
    };
    if (input.q?.trim()) query.q = input.q.trim();
    if (Object.keys(adapted.filters).length > 0) query.filters = adapted.filters;

    const metricYear = normalizeMetricYear(input.year);

    if (entityType === 'projects') {
      query.include = 'classification,company,sponsors,team';
      if (!Object.prototype.hasOwnProperty.call(adapted.filters, 'status')) {
        query.status = 'all';
      }
    } else if (entityType === 'requests') {
      query.include = 'classification,company,requestor,sponsors,team';
      if (!Object.prototype.hasOwnProperty.call(adapted.filters, 'status')) {
        query.status = 'all';
      }
    } else if (entityType === 'applications') {
      query.include = 'supplier,owners,residency,hosting,counts,structure,instances';
      query.include_inactive = true;
    } else if (
      entityType === 'spend_items'
      || entityType === 'accounts'
      || entityType === 'analytics_categories'
      || entityType === 'business_processes'
      || entityType === 'capex_items'
      || entityType === 'contracts'
      || entityType === 'chart_of_accounts'
      || entityType === 'companies'
      || entityType === 'contacts'
      || entityType === 'suppliers'
      || entityType === 'departments'
    ) {
      query.includeDisabled = true;
    }
    if (entityType === 'companies' || entityType === 'departments') {
      query.year = metricYear ?? new Date().getFullYear();
    }

    return {
      query,
      filtersApplied: adapted.applied,
      filtersIgnored: adapted.ignored,
    };
  }

  private serializeFiltersForTasks(query: Record<string, any>): Record<string, any> {
    if (!query.filters || typeof query.filters !== 'object') {
      return query;
    }
    return {
      ...query,
      filters: JSON.stringify(query.filters),
    };
  }

  private mapTask(row: any): AiEntitySummaryDto {
    return toEntitySummary('tasks', {
      id: row.id,
      item_number: row.item_number ?? null,
      label: row.title || 'Untitled task',
      status: row.status ?? null,
      summary: row.description ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        assignee: scalar(row.assignee_name),
        creator: scalar(row.creator_name),
        priority: scalar(row.priority_level),
        type: scalar(row.task_type_name),
        due_date: scalar(row.due_date),
        phase: scalar(row.phase_name),
        labels: scalar(Array.isArray(row.labels) ? row.labels.join(', ') : null),
        related: scalar(row.related_object_type),
        related_label: scalar(row.related_object_name),
        applications: scalar(Array.isArray(row.applications) ? row.applications.map((item: any) => item?.name).filter(Boolean).join(', ') : null),
        assets: scalar(Array.isArray(row.assets) ? row.assets.map((item: any) => item?.name).filter(Boolean).join(', ') : null),
        category: scalar(row.category_name),
        stream: scalar(row.stream_name),
        company: scalar(row.company_name),
        source: scalar(row.source_name),
        project_name: scalar(row.project_name),
        project_stream: scalar(row.project_stream_name),
        project_category: scalar(row.project_category_name),
      },
    });
  }

  private mapProject(row: any): AiEntitySummaryDto {
    return toEntitySummary('projects', {
      id: row.id,
      item_number: row.item_number ?? null,
      label: row.name,
      status: row.status ?? null,
      summary: row.purpose ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        origin: scalar(row.origin),
        source: scalar(row.source_name),
        category: scalar(row.category_name),
        stream: scalar(row.stream_name),
        company: scalar(row.company?.name ?? row.company_name),
        department: scalar(row.department?.name ?? row.department_name),
        business_lead: scalar(displayName(row.business_lead) ?? row.business_lead_name),
        it_lead: scalar(displayName(row.it_lead) ?? row.it_lead_name),
        contributors: scalar(extractContributorNames(row)),
        priority_score: numericScalar(row.priority_score),
        execution_progress: numericScalar(row.execution_progress),
        planned_start: scalar(row.planned_start),
        planned_end: scalar(row.planned_end),
      },
    });
  }

  private mapRequest(row: any): AiEntitySummaryDto {
    return toEntitySummary('requests', {
      id: row.id,
      item_number: row.item_number ?? null,
      label: row.name,
      status: row.status ?? null,
      summary: row.current_situation ?? row.expected_benefits ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        source: scalar(row.source_name),
        requestor: scalar(displayName(row.requestor) ?? row.requestor_name),
        category: scalar(row.category_name),
        stream: scalar(row.stream_name),
        company: scalar(row.company?.name ?? row.company_name),
        department: scalar(row.department?.name ?? row.department_name),
        business_lead: scalar(displayName(row.business_lead) ?? row.business_lead_name),
        it_lead: scalar(displayName(row.it_lead) ?? row.it_lead_name),
        contributors: scalar(extractContributorNames(row)),
        priority_score: numericScalar(row.priority_score),
        target_date: scalar(row.target_delivery_date),
      },
    });
  }

  private mapApplication(row: any): AiEntitySummaryDto {
    return toEntitySummary('applications', {
      id: row.id,
      label: row.name,
      status: row.status ?? null,
      summary: row.description ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        ref: scalar(row.sequential_id),
        lifecycle: scalar(row.lifecycle),
        criticality: scalar(row.criticality),
        business_criticality_label: scalar(row.business_criticality_label),
        business_criticality_rank: numericScalar(row.business_criticality_rank),
        cyber_criticality: scalar(row.cyber_criticality),
        cyber_criticality_label: scalar(row.cyber_criticality_label),
        cyber_criticality_rank: numericScalar(row.cyber_criticality_rank),
        recovery_wave: scalar(row.recovery_wave),
        recovery_wave_label: scalar(row.recovery_wave_label),
        recovery_wave_order: numericScalar(row.recovery_wave_order),
        rto_minutes: numericScalar(row.rto_minutes),
        rpo_minutes: numericScalar(row.rpo_minutes),
        classification_review_state: scalar(row.classification_review_state),
        classification_review_reason: scalar(row.classification_review_reason),
        classification_reviewed_at: scalar(row.classification_reviewed_at),
        category: scalar(row.category),
        editor: scalar(row.editor),
        environment: scalar(row.environment),
        environments: scalar(Array.isArray(row.instances)
          ? row.instances.map((item: any) => item.environment).filter(Boolean).join(', ')
          : null),
        hosting_model: scalar(row.hosting_model),
        hosting_types: scalar(Array.isArray(row.hosting_types) ? row.hosting_types.join(', ') : null),
        data_class: scalar(row.data_class),
        data_class_label: scalar(row.data_class_label),
        data_class_rank: numericScalar(row.data_class_rank),
        version: scalar(row.version),
        go_live_date: scalar(row.go_live_date),
        end_of_support_date: scalar(row.end_of_support_date),
        retired_date: scalar(row.retired_date),
        supplier: scalar(row.supplier_name),
        business_owner: scalar(joinDisplayNames(Array.isArray(row.owners_business)
          ? row.owners_business
          : Array.isArray(row.owners)
            ? row.owners.filter((owner: any) => owner.owner_type === 'business')
            : [])),
        it_owner: scalar(joinDisplayNames(Array.isArray(row.owners_it)
          ? row.owners_it
          : Array.isArray(row.owners)
            ? row.owners.filter((owner: any) => owner.owner_type === 'it')
            : [])),
        external_facing: row.external_facing == null ? null : Boolean(row.external_facing),
        is_suite: row.is_suite == null ? null : Boolean(row.is_suite),
        sso_enabled: row.sso_enabled == null ? null : Boolean(row.sso_enabled),
        mfa_supported: row.mfa_supported == null ? null : Boolean(row.mfa_supported),
        etl_enabled: row.etl_enabled == null ? null : Boolean(row.etl_enabled),
        contains_pii: row.contains_pii == null ? null : Boolean(row.contains_pii),
        users_mode: scalar(row.users_mode),
        users_year: numericScalar(row.users_year),
        users_override: numericScalar(row.users_override),
        derived_total_users: numericScalar(row.derived_total_users),
        data_residency: scalar(Array.isArray(row.data_residency)
          ? row.data_residency.map((entry: any) => typeof entry === 'string' ? entry : entry?.country_iso).filter(Boolean).join(', ')
          : null),
        spend_count: numericScalar(row.spend_count),
        capex_count: numericScalar(row.capex_count),
        contracts_count: numericScalar(row.contracts_count),
        suites_count: numericScalar(row.suites_count),
        components_count: numericScalar(row.components_count),
      },
    });
  }

  private mapSpendItem(row: any, registry: AiEntityFilterRegistry): AiEntitySummaryDto {
    const anchorYear = new Date().getFullYear();
    const summary = row.description
      ?? ([row.supplier_name, row.paying_company_name, row.account_display].filter(Boolean).join(' | ') || null);
    return toEntitySummary('spend_items', {
      id: row.id,
      label: row.product_name || 'Untitled spend item',
      status: row.status ?? null,
      summary,
      updated_at: row.updated_at ?? null,
      metadata: {
        ...budgetItemMetadata(row, registry),
        budget_anchor_year: anchorYear,
        ...budgetAmountMetadata(row, anchorYear),
      },
    });
  }

  private mapCapexItem(row: any, registry: AiEntityFilterRegistry): AiEntitySummaryDto {
    const anchorYear = new Date().getFullYear();
    const summary = row.notes
      ?? ([row.company_name, row.ppe_type, row.investment_type].filter(Boolean).join(' | ') || null);
    return toEntitySummary('capex_items', {
      id: row.id,
      label: row.description || 'Untitled CAPEX item',
      status: row.status ?? null,
      summary,
      updated_at: row.updated_at ?? null,
      metadata: {
        ...budgetItemMetadata(row, registry),
        ppe_type: scalar(row.ppe_type),
        investment_type: scalar(row.investment_type),
        priority: scalar(row.priority),
        budget_anchor_year: anchorYear,
        ...budgetAmountMetadata(row, anchorYear),
      },
    });
  }

  private mapAccount(row: any): AiEntitySummaryDto {
    return toEntitySummary('accounts', {
      id: row.id,
      label: [row.account_number, row.account_name].filter(Boolean).join(' - ') || 'Untitled account',
      status: row.status ?? null,
      summary: row.description ?? row.native_name ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        coa_code: scalar(row.coa_code),
        account_number: scalar(row.account_number),
        native_name: scalar(row.native_name),
        consolidation_account_number: numericScalar(row.consolidation_account_number),
        consolidation_account_name: scalar(row.consolidation_account_name),
        nature: scalar(row.nature),
      },
    });
  }

  private mapChartOfAccounts(row: any): AiEntitySummaryDto {
    return toEntitySummary('chart_of_accounts', {
      id: row.id,
      label: [row.code, row.name].filter(Boolean).join(' - ') || 'Untitled chart of accounts',
      status: null,
      summary: [row.scope, row.country_iso].filter(Boolean).join(' | ') || null,
      updated_at: row.updated_at ?? null,
      metadata: {
        code: scalar(row.code),
        country_iso: scalar(row.country_iso),
        scope: scalar(row.scope),
        is_default: row.is_default == null ? null : Boolean(row.is_default),
        is_global_default: row.is_global_default == null ? null : Boolean(row.is_global_default),
        is_consolidation: row.is_consolidation == null ? null : Boolean(row.is_consolidation),
        companies_count: numericScalar(row.companies_count),
        accounts_count: numericScalar(row.accounts_count),
      },
    });
  }

  /** A value with its dimension (the tenant's dimensions by id, read once per call). */
  private mapAnalyticsCategory(row: any, axisById: Map<string, AnalyticsAxisInfo>): AiEntitySummaryDto {
    const axis = row.axis_id ? axisById.get(row.axis_id) : undefined;
    return toEntitySummary('analytics_categories', {
      id: row.id,
      label: row.name || 'Untitled analytics category',
      status: row.status ?? null,
      summary: row.description ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        axis: axis ? analyticsAxisLabel(axis) : null,
        axis_code: axis ? axis.code : null,
        applies_to: scalar(row.applies_to),
      },
    });
  }

  private async analyticsAxesById(context: AiExecutionContextWithManager): Promise<Map<string, AnalyticsAxisInfo>> {
    const axes = await loadAnalyticsAxes(context.manager, context.tenantId);
    return new Map(axes.map((axis) => [axis.id, axis]));
  }

  /**
   * A line's `analytics_values` (the detail endpoint returns every value it holds) without
   * the values on dimensions of the other line type: kept in the database, hidden everywhere.
   */
  private async withoutHiddenAnalyticsValues(context: AiExecutionContextWithManager, row: any, scope: 'opex' | 'capex'): Promise<void> {
    if (!Array.isArray(row?.analytics_values) || row.analytics_values.length === 0) return;
    const axes = await this.analyticsAxesById(context);
    row.analytics_values = row.analytics_values.filter((value: { axis_id: string }) => {
      const axis = axes.get(value.axis_id);
      return !axis || axisAppliesTo(axis, scope);
    });
  }

  private mapBusinessProcess(row: any): AiEntitySummaryDto {
    return toEntitySummary('business_processes', {
      id: row.id,
      label: row.name || 'Untitled business process',
      status: row.status ?? null,
      summary: row.description ?? row.notes ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        owner: scalar(row.owner_name),
        primary_category: scalar(row.primary_category_name),
        categories: scalar(Array.isArray(row.categories) ? row.categories.map((item: any) => item.name).join(', ') : null),
        is_default: row.is_default == null ? null : Boolean(row.is_default),
      },
    });
  }

  private mapContract(row: any): AiEntitySummaryDto {
    const companyName = row.company?.name ?? row.company_name ?? null;
    const supplierName = row.supplier?.name ?? row.supplier_name ?? null;
    const summary = row.notes ?? ([companyName, supplierName].filter(Boolean).join(' | ') || null);
    return toEntitySummary('contracts', {
      id: row.id,
      label: row.name,
      status: row.status ?? null,
      summary,
      updated_at: row.updated_at ?? null,
      metadata: {
        company: scalar(companyName),
        supplier: scalar(supplierName),
        currency: scalar(row.currency),
        billing_frequency: scalar(row.billing_frequency),
        start_date: scalar(row.start_date),
        duration_months: numericScalar(row.duration_months),
        auto_renewal: row.auto_renewal == null ? null : Boolean(row.auto_renewal),
        notice_period_months: numericScalar(row.notice_period_months),
        end_date: scalar(row.end_date),
        cancellation_deadline: scalar(row.cancellation_deadline),
        yearly_amount: numericScalar(row.yearly_amount_at_signature),
        yearly_amount_at_signature: numericScalar(row.yearly_amount_at_signature),
      },
    });
  }

  private mapCompany(row: any): AiEntitySummaryDto {
    const metricYear = numericScalar(row.metrics_year);
    const headcount = numericScalar(row.headcount_year);
    const itUsers = numericScalar(row.it_users_year);
    const turnover = numericScalar(row.turnover_year);
    return toEntitySummary('companies', {
      id: row.id,
      label: row.name,
      status: row.status ?? null,
      summary: [row.city, row.country_iso].filter(Boolean).join(', ') || null,
      updated_at: row.updated_at ?? null,
      metadata: {
        country: scalar(row.country_iso),
        country_iso: scalar(row.country_iso),
        city: scalar(row.city),
        state: scalar(row.state),
        base_currency: scalar(row.base_currency),
        metrics_year: metricYear,
        headcount,
        it_users: itUsers,
        turnover,
        metrics_frozen: row.metrics_frozen == null ? null : Boolean(row.metrics_frozen),
      },
    });
  }

  private mapSupplier(row: any): AiEntitySummaryDto {
    return toEntitySummary('suppliers', {
      id: row.id,
      label: row.name,
      status: row.status ?? null,
      summary: row.notes ?? row.erp_supplier_id ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        erp_supplier_id: scalar(row.erp_supplier_id),
      },
    });
  }

  private mapDepartment(row: any): AiEntitySummaryDto {
    const metricYear = numericScalar(row.metrics_year);
    const headcount = numericScalar(row.headcount_year);
    return toEntitySummary('departments', {
      id: row.id,
      label: row.name,
      status: row.status ?? null,
      summary: row.description ?? row.company_name ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        company: scalar(row.company_name),
        metrics_year: metricYear,
        headcount,
        metrics_frozen: row.metrics_frozen == null ? null : Boolean(row.metrics_frozen),
      },
    });
  }

  private mapContact(row: any): AiEntitySummaryDto {
    const label = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
      || row.email
      || 'Unknown contact';
    return toEntitySummary('contacts', {
      id: row.id,
      label,
      status: row.active === false ? 'inactive' : 'active',
      summary: [row.job_title, row.supplier_name, row.country].filter(Boolean).join(' | ') || null,
      updated_at: row.updated_at ?? null,
      metadata: {
        email: scalar(row.email),
        phone: scalar(row.phone),
        mobile: scalar(row.mobile),
        country: scalar(row.country),
        supplier: scalar(row.supplier_name),
        supplier_role: scalar(row.supplier_role),
      },
    });
  }

  private mapAsset(row: any): AiEntitySummaryDto {
    return toEntitySummary('assets', {
      id: row.id,
      label: row.name,
      status: row.status ?? null,
      summary: row.fqdn ?? row.hostname ?? row.notes ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        asset_reference: scalar(row.asset_reference),
        kind: scalar(row.kind),
        provider: scalar(row.provider),
        environment: scalar(row.environment),
        region: scalar(row.region),
        zone: scalar(row.zone),
        os: scalar(row.operating_system),
        hostname: scalar(row.hostname),
        domain: scalar(row.domain),
        fqdn: scalar(row.fqdn),
        aliases: scalar(Array.isArray(row.aliases) ? row.aliases.join(', ') : null),
        network_segment: scalar(row.network_segment),
        location: scalar(row.location_name),
        hosting_type: scalar(row.hosting_type),
        sub_location: scalar(row.sub_location_name),
        cluster: scalar(row.cluster),
        is_cluster: row.is_cluster == null ? null : Boolean(row.is_cluster),
        assignments_count: numericScalar(row.assignments_count),
        go_live_date: scalar(row.go_live_date),
        end_of_life_date: scalar(row.end_of_life_date),
      },
    });
  }

  private mapLocation(row: any): AiEntitySummaryDto {
    const subLocations = Array.isArray(row.sub_locations) && row.sub_locations.length > 0
      ? row.sub_locations
          .map((item: any) => typeof item === 'string' ? item : item?.name)
          .filter(Boolean)
          .join(', ')
      : null;
    return toEntitySummary('locations', {
      id: row.id,
      label: `${row.code} — ${row.name}`,
      status: null,
      summary: [row.city, row.country_iso].filter(Boolean).join(', ') || null,
      updated_at: row.updated_at ?? null,
      metadata: {
        hosting_type: scalar(row.hosting_type),
        provider: scalar(row.provider) ?? scalar(row.operating_company_name),
        country: scalar(row.country_iso),
        country_iso: scalar(row.country_iso),
        city: scalar(row.city),
        assets: row.servers_count ?? 0,
        sub_locations: subLocations,
      },
    });
  }

  private mapInterface(row: any): AiEntitySummaryDto {
    return toEntitySummary('interfaces', {
      id: row.id,
      label: [row.interface_reference || row.interface_id, row.name].filter(Boolean).join(' - ') || 'Untitled interface',
      status: row.lifecycle ?? null,
      summary: row.business_purpose ?? row.overview_notes ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        interface_reference: scalar(row.interface_reference),
        interface_id: scalar(row.interface_id),
        source_application: scalar(row.source_application_name),
        target_application: scalar(row.target_application_name),
        business_process: scalar(row.business_process_name),
        data_category: scalar(row.data_category),
        data_class: scalar(row.data_class),
        criticality: scalar(row.criticality),
        integration_route_type: scalar(row.integration_route_type),
        contains_pii: row.contains_pii == null ? null : Boolean(row.contains_pii),
        bindings_count: numericScalar(row.bindings_count),
        environment_coverage: numericScalar(row.environment_coverage),
        binding_environments: scalar(Array.isArray(row.binding_environments) ? row.binding_environments.join(', ') : null),
      },
    });
  }

  private mapConnection(row: any): AiEntitySummaryDto {
    return toEntitySummary('connections', {
      id: row.id,
      label: [row.connection_reference, row.name].filter(Boolean).join(' - ') || 'Untitled connection',
      status: row.lifecycle ?? null,
      summary: row.description ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        connection_reference: scalar(row.connection_reference),
        topology: scalar(row.topology),
        source: scalar(row.source_label ?? row.source_asset_name ?? row.source_entity_code),
        destination: scalar(row.destination_label ?? row.destination_asset_name ?? row.destination_entity_code),
        protocols: scalar(Array.isArray(row.protocol_labels) ? row.protocol_labels.join(', ') : null),
        criticality: scalar(row.effective_criticality ?? row.criticality),
        data_class: scalar(row.effective_data_class ?? row.data_class),
        contains_pii: row.effective_contains_pii == null ? null : Boolean(row.effective_contains_pii),
        risk_mode: scalar(row.risk_mode),
        derived_interface_count: numericScalar(row.derived_interface_count),
      },
    });
  }

  private mapUser(row: any): AiEntitySummaryDto {
    const label = displayName(row) ?? row.email ?? 'Unknown user';
    const summary = label === row.email
      ? ([row.job_title, row.team_name, row.company_name].filter(Boolean).join(' | ') || null)
      : ([row.email, row.job_title, row.team_name, row.company_name].filter(Boolean).join(' | ') || null);
    return toEntitySummary('users', {
      id: row.id,
      label,
      status: row.status ?? null,
      summary,
      updated_at: row.updated_at ?? null,
      metadata: {
        email: scalar(row.email),
        first_name: scalar(row.first_name),
        last_name: scalar(row.last_name),
        job_title: scalar(row.job_title),
        company: scalar(row.company_name),
        department: scalar(row.department_name),
        primary_role: scalar(row.primary_role_name),
        locale: scalar(row.locale),
        team: scalar(row.team_name),
        contributor_profile: scalar(row.contributor_profile),
        project_availability: numericScalar(row.project_availability),
        areas_of_expertise: scalar(row.areas_of_expertise),
      },
    });
  }

  private mapIncident(row: any): AiEntitySummaryDto {
    return toEntitySummary('incidents', {
      id: row.id,
      item_number: row.item_number ?? null,
      label: row.title,
      status: row.status ?? null,
      summary: row.description ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        severity: scalar(row.severity),
        category: scalar(row.category),
        status: scalar(row.status),
        detected_at: scalar(row.detected_at),
        resolved_at: scalar(row.resolved_at),
        owner: scalar(row.owner_name),
        asset_count: numericScalar(row.asset_count ?? row.counts?.assets),
        task_count: numericScalar(row.task_count ?? row.counts?.tasks),
      },
    });
  }

  private mapDocument(row: any): AiEntitySummaryDto {
    return toEntitySummary('documents', {
      id: row.id,
      item_number: row.item_number ?? null,
      label: row.title,
      status: row.status ?? null,
      summary: row.summary ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        library: scalar(row.library_name),
        folder: scalar(row.folder_name),
        type: scalar(row.document_type_name),
        owner: scalar(row.primary_owner_name),
        review_due: scalar(row.review_due_at),
      },
    });
  }

  async execute(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiQueryEntityType;
      filters?: Record<string, AiFilterValue>;
      q?: string;
      year?: number;
      sort?: { field: string; direction: 'asc' | 'desc' };
      page?: number;
      limit?: number;
      scope?: AiQueryScope;
    },
  ): Promise<AiQueryResult> {
    const registry = await resolveAiEntityRegistry(context, input.entity_type);
    const { query, filtersApplied, filtersIgnored } = await this.buildBaseQuery(context, input.entity_type, registry, input);
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 200;
    if (filtersIgnored.length > 0) {
      return {
        status: 'invalid_filter',
        items: [],
        total: 0,
        page,
        limit,
        returned: 0,
        truncated: false,
        complete: false,
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        suggested_repairs: buildFilterRepairSuggestions(registry, filtersIgnored),
        scope: null,
      };
    }
    const scoped = await applyScopeToAiQuery(context, input.entity_type, query, input.scope);
    if (scoped.scope && scoped.scope.resolved === false) {
      return {
        items: [],
        total: 0,
        page,
        limit,
        returned: 0,
        truncated: false,
        complete: false,
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: scoped.scope,
      };
    }

    const isCompleteQueryResult = (resultPage: number, truncated: boolean): boolean =>
      resultPage === 1
      && !truncated
      && filtersIgnored.length === 0
      && (scoped.scope?.resolved !== false);
    const accessScope = await resolveAiParticipationAccessScope(context, input.entity_type);

    if (input.entity_type === 'tasks') {
      const result = await this.tasks.listAllTasks(this.serializeFiltersForTasks(scoped.query), {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapTask(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: scoped.scope,
      };
    }

    if (input.entity_type === 'projects') {
      const result = await this.projects.list(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapProject(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: scoped.scope,
      };
    }

    if (input.entity_type === 'requests') {
      const result = await this.requests.list(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapRequest(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: scoped.scope,
      };
    }

    if (input.entity_type === 'applications') {
      const result = await this.applications.list(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapApplication(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: scoped.scope,
      };
    }

    if (input.entity_type === 'capex_items') {
      const anchorYear = new Date().getFullYear();
      const result = await this.capexItems.summary(
        {
          ...scoped.query,
          years: budgetQueryYears(anchorYear).join(','),
        },
        { manager: context.manager },
      );
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      // The CAPEX list has no cap: the total is every matching line.
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapCapexItem(row, registry)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'spend_items') {
      const anchorYear = new Date().getFullYear();
      const result = await this.spendItems.summary(
        {
          ...scoped.query,
          years: budgetQueryYears(anchorYear).join(','),
        },
        { manager: context.manager, includeNextYearAllocation: true },
      );
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      // The OPEX list has no cap: the total is every matching line.
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapSpendItem(row, registry)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'contracts') {
      const result = await this.contracts.list(scoped.query, { manager: context.manager });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapContract(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'incidents') {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      const result = await this.incidents.list(scoped.query, { manager: context.manager, tenantId: context.tenantId, viewer });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapIncident(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'companies') {
      const result = await this.companies.list(scoped.query, { manager: context.manager });
      const metricsYear = normalizeMetricYear(scoped.query.year);
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapCompany({ ...row, metrics_year: metricsYear })),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'accounts') {
      const result = await this.accounts.list(scoped.query, { manager: context.manager });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapAccount(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'chart_of_accounts') {
      const result = await this.chartOfAccounts.list(scoped.query, { manager: context.manager });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapChartOfAccounts(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'analytics_categories') {
      const result = await this.analyticsCategories.list(scoped.query, { manager: context.manager });
      const axisById = await this.analyticsAxesById(context);
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapAnalyticsCategory(row, axisById)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'business_processes') {
      const result = await this.businessProcesses.list(scoped.query, { manager: context.manager });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapBusinessProcess(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'suppliers') {
      const result = await this.suppliers.list(scoped.query, { manager: context.manager });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapSupplier(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'departments') {
      const result = await this.departments.list(scoped.query, { manager: context.manager });
      const metricsYear = normalizeMetricYear(scoped.query.year);
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapDepartment({ ...row, metrics_year: metricsYear })),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'contacts') {
      const result = await this.contacts.list(scoped.query, { manager: context.manager, tenantId: context.tenantId });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapContact(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'assets') {
      const result = await this.assets.list(scoped.query, { manager: context.manager, tenantId: context.tenantId });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapAsset(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: scoped.scope,
      };
    }

    if (input.entity_type === 'documents') {
      const result = await this.knowledge.list(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        userId: context.userId,
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapDocument(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: scoped.scope,
      };
    }

    if (input.entity_type === 'locations') {
      const result = await this.locations.list(scoped.query, { manager: context.manager, tenantId: context.tenantId });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapLocation(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'interfaces') {
      const result = await this.interfaces.list(scoped.query, { manager: context.manager });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapInterface(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'connections') {
      const result = await this.connections.list(context.tenantId, scoped.query, { manager: context.manager });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapConnection(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'users') {
      const result = await this.users.listForAi(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapUser(row)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    throw new BadRequestException('Unsupported entity type.');
  }

  private async resolveDetailEntityId(
    context: AiExecutionContextWithManager,
    entityType: AiQueryEntityType,
    rawId: string,
  ): Promise<string> {
    const value = String(rawId || '').trim();
    if (!value) return value;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      return value;
    }
    if (entityType === 'documents') {
      return value;
    }

    if (entityType === 'incidents') {
      const itemNumber = value.match(/^INC-?(\d+)$/i)?.[1];
      if (itemNumber) {
        const rows: Array<{ id: string }> = await context.manager.query(
          `SELECT id FROM incidents WHERE tenant_id = $1 AND item_number = $2 LIMIT 1`,
          [context.tenantId, Number(itemNumber)],
        );
        if (rows.length === 0) throw new NotFoundException('Incident not found.');
        return String(rows[0].id);
      }
    }

    const result = await this.execute(context, {
      entity_type: entityType,
      q: value,
      page: 1,
      limit: 5,
    });
    const lower = value.toLowerCase();
    const exact = result.items.find((item) =>
      item.id.toLowerCase() === lower
      || item.ref?.toLowerCase() === lower
      || item.label.toLowerCase() === lower,
    );
    if (exact) return exact.id;
    if (result.items.length === 1) return result.items[0].id;
    return value;
  }

  private toDetailResult(
    entity: AiEntitySummaryDto,
    row: unknown,
    complete = true,
  ): AiEntityDetailDto {
    const data = sanitizeDetailValue(row);
    return {
      entity,
      data: data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : { value: data },
      total: 1,
      returned: 1,
      truncated: false,
      complete,
    };
  }

  private async loadCompanyMetrics(
    context: AiExecutionContextWithManager,
    companyId: string,
  ): Promise<Array<{
    fiscal_year: number;
    headcount: number;
    it_users: number | null;
    turnover: number | null;
    is_frozen: boolean;
    frozen_at: string | null;
    updated_at: string | null;
  }>> {
    const rows = await context.manager.query(
      `
      SELECT fiscal_year,
             headcount,
             it_users,
             turnover,
             is_frozen,
             frozen_at,
             updated_at
      FROM company_metrics
      WHERE tenant_id = $1
        AND company_id = $2
      ORDER BY fiscal_year DESC
      `,
      [context.tenantId, companyId],
    );

    return (rows || []).map((row: any) => ({
      fiscal_year: Number(row.fiscal_year),
      headcount: Number(row.headcount ?? 0),
      it_users: row.it_users == null ? null : Number(row.it_users),
      turnover: row.turnover == null ? null : Number(row.turnover),
      is_frozen: row.is_frozen === true,
      frozen_at: toIso(row.frozen_at),
      updated_at: toIso(row.updated_at),
    }));
  }

  private async loadDepartmentMetrics(
    context: AiExecutionContextWithManager,
    departmentId: string,
  ): Promise<Array<{
    fiscal_year: number;
    headcount: number;
    is_frozen: boolean;
    frozen_at: string | null;
    updated_at: string | null;
  }>> {
    const rows = await context.manager.query(
      `
      SELECT fiscal_year,
             headcount,
             is_frozen,
             frozen_at,
             updated_at
      FROM department_metrics
      WHERE tenant_id = $1
        AND department_id = $2
      ORDER BY fiscal_year DESC
      `,
      [context.tenantId, departmentId],
    );

    return (rows || []).map((row: any) => ({
      fiscal_year: Number(row.fiscal_year),
      headcount: Number(row.headcount ?? 0),
      is_frozen: row.is_frozen === true,
      frozen_at: toIso(row.frozen_at),
      updated_at: toIso(row.updated_at),
    }));
  }

  private groupRowsByKey(rows: any[], key: string): Record<string, any[]> {
    const grouped: Record<string, any[]> = {};
    for (const row of rows || []) {
      const groupKey = String(row?.[key] ?? '');
      if (!groupKey) continue;
      const list = grouped[groupKey] ?? [];
      list.push(row);
      grouped[groupKey] = list;
    }
    return grouped;
  }

  private async loadFinancialVersions(
    context: AiExecutionContextWithManager,
    params: {
      versionTable: 'spend_versions' | 'capex_versions';
      amountTable: 'spend_amounts' | 'capex_amounts';
      allocationTable: 'spend_allocations' | 'capex_allocations';
      itemColumn: 'spend_item_id' | 'capex_item_id';
      itemId: string;
    },
  ): Promise<any[]> {
    const versions = await context.manager.query(
      `
      SELECT *
      FROM ${params.versionTable}
      WHERE tenant_id = $1
        AND ${params.itemColumn} = $2
      ORDER BY budget_year DESC, as_of_date DESC, created_at DESC
      `,
      [context.tenantId, params.itemId],
    );
    const versionIds = (versions || []).map((row: any) => row.id).filter(Boolean);
    if (versionIds.length === 0) return [];

    const amounts = await context.manager.query(
      `
      SELECT *
      FROM ${params.amountTable}
      WHERE tenant_id = $1
        AND version_id = ANY($2::uuid[])
      ORDER BY period ASC
      `,
      [context.tenantId, versionIds],
    );
    const allocations = await context.manager.query(
      `
      SELECT a.*,
             c.name AS company_name,
             d.name AS department_name
      FROM ${params.allocationTable} a
      LEFT JOIN companies c ON c.id = a.company_id AND c.tenant_id = a.tenant_id
      LEFT JOIN departments d ON d.id = a.department_id AND d.tenant_id = a.tenant_id
      WHERE a.tenant_id = $1
        AND a.version_id = ANY($2::uuid[])
      ORDER BY c.name ASC NULLS LAST, d.name ASC NULLS LAST, a.created_at ASC
      `,
      [context.tenantId, versionIds],
    );

    const amountsByVersion = this.groupRowsByKey(amounts, 'version_id');
    const allocationsByVersion = this.groupRowsByKey(allocations, 'version_id');
    return versions.map((version: any) => ({
      ...version,
      amounts: amountsByVersion[version.id] ?? [],
      allocations: allocationsByVersion[version.id] ?? [],
    }));
  }

  private async loadLinkedContacts(
    context: AiExecutionContextWithManager,
    params: {
      table: 'spend_item_contacts' | 'capex_item_contacts' | 'contract_contacts';
      foreignKey: 'spend_item_id' | 'capex_item_id' | 'contract_id';
      id: string;
    },
  ): Promise<any[]> {
    return context.manager.query(
      `
      SELECT link.*,
             contact.first_name,
             contact.last_name,
             contact.job_title,
             contact.email,
             contact.phone,
             contact.mobile,
             contact.country,
             contact.active
      FROM ${params.table} link
      LEFT JOIN contacts contact ON contact.id = link.contact_id AND contact.tenant_id = link.tenant_id
      WHERE link.tenant_id = $1
        AND link.${params.foreignKey} = $2
      ORDER BY link.role ASC, link.created_at DESC
      `,
      [context.tenantId, params.id],
    );
  }

  private async loadSpendItemDeepDetail(
    context: AiExecutionContextWithManager,
    spendItemId: string,
    registry: AiEntityFilterRegistry,
  ): Promise<Record<string, unknown>> {
    const anchorYear = new Date().getFullYear();
    const [row] = await this.spendItems.summaryRowsByIds(
      [spendItemId],
      {
        years: budgetQueryYears(anchorYear),
        includeRecipientDetails: true,
        includeLatestTask: true,
        includeNextYearAllocation: true,
      },
      { manager: context.manager },
    );
    const summary = withDetailAiKeys(row, registry);

    const [
      financialVersions,
      contacts,
      linkedApplications,
      linkedProjects,
      linkedContracts,
      links,
      attachments,
    ] = await Promise.all([
      this.loadFinancialVersions(context, {
        versionTable: 'spend_versions',
        amountTable: 'spend_amounts',
        allocationTable: 'spend_allocations',
        itemColumn: 'spend_item_id',
        itemId: spendItemId,
      }),
      this.loadLinkedContacts(context, {
        table: 'spend_item_contacts',
        foreignKey: 'spend_item_id',
        id: spendItemId,
      }).catch(() => []),
      this.spendItems.listApplications(spendItemId, { manager: context.manager }).catch(() => ({ items: [] })),
      this.spendItems.listProjects(spendItemId, { manager: context.manager }).catch(() => ({ items: [] })),
      this.contracts.listContractsForSpendItem(spendItemId, { manager: context.manager }).catch(() => ({ items: [] })),
      this.spendItems.listLinks(spendItemId, { manager: context.manager }).catch(() => []),
      this.spendItems.listAttachments(spendItemId, { manager: context.manager }).catch(() => []),
    ]);

    return {
      ...(summary ?? {}),
      financial_summary: summary ?? null,
      financial_versions: financialVersions,
      contacts,
      linked_applications: linkedApplications,
      projects: linkedProjects,
      linked_contracts: linkedContracts,
      links,
      attachments,
    };
  }

  private async loadCapexItemDeepDetail(
    context: AiExecutionContextWithManager,
    capexItemId: string,
    registry: AiEntityFilterRegistry,
  ): Promise<Record<string, unknown>> {
    const anchorYear = new Date().getFullYear();
    const [[row], financialVersions, contacts, linkedApplications, linkedProjects, linkedContracts] = await Promise.all([
      this.capexItems.summaryRowsByIds(
        [capexItemId],
        {
          years: budgetQueryYears(anchorYear),
          includeRecipientDetails: true,
          includeLatestTask: true,
          includeNextYearAllocation: true,
        },
        { manager: context.manager },
      ),
      this.loadFinancialVersions(context, {
        versionTable: 'capex_versions',
        amountTable: 'capex_amounts',
        allocationTable: 'capex_allocations',
        itemColumn: 'capex_item_id',
        itemId: capexItemId,
      }),
      this.loadLinkedContacts(context, {
        table: 'capex_item_contacts',
        foreignKey: 'capex_item_id',
        id: capexItemId,
      }).catch(() => []),
      this.loadCapexLinkedApplications(context, capexItemId).catch(() => ({ items: [] })),
      this.capexItems.listProjects(capexItemId, { manager: context.manager }).catch(() => ({ items: [] })),
      this.contracts.listContractsForCapexItem(capexItemId, { manager: context.manager }).catch(() => ({ items: [] })),
    ]);
    const summary = withDetailAiKeys(row, registry);

    return {
      ...(summary ?? {}),
      financial_summary: summary ?? null,
      financial_versions: financialVersions,
      contacts,
      linked_applications: linkedApplications,
      projects: linkedProjects,
      linked_contracts: linkedContracts,
    };
  }

  /** Applications linked to a CAPEX item, in the shape of the OPEX detail's `linked_applications`. */
  private async loadCapexLinkedApplications(
    context: AiExecutionContextWithManager,
    capexItemId: string,
  ): Promise<{ items: Array<{ id: string; name: string }> }> {
    const items = await context.manager.query(
      `SELECT a.id, a.name
       FROM application_capex_items l
       JOIN applications a ON a.id = l.application_id AND a.tenant_id = l.tenant_id
       WHERE l.tenant_id = $1 AND l.capex_item_id = $2
       ORDER BY a.name ASC`,
      [context.tenantId, capexItemId],
    );
    return { items };
  }

  private async loadContractDeepDetail(
    context: AiExecutionContextWithManager,
    contractId: string,
  ): Promise<Record<string, unknown>> {
    const rows = await context.manager.query(
      `
      SELECT c.id,
             comp.name AS company_name,
             sup.name AS supplier_name,
             owner.email AS owner_email,
             owner.first_name AS owner_first_name,
             owner.last_name AS owner_last_name
      FROM contracts c
      LEFT JOIN companies comp ON comp.id = c.company_id AND comp.tenant_id = c.tenant_id
      LEFT JOIN suppliers sup ON sup.id = c.supplier_id AND sup.tenant_id = c.tenant_id
      LEFT JOIN users owner ON owner.id = c.owner_user_id AND owner.tenant_id = c.tenant_id
      WHERE c.tenant_id = $1
        AND c.id = $2
      LIMIT 1
      `,
      [context.tenantId, contractId],
    );
    const names = rows[0] ?? {};
    const ownerName = displayName({
      first_name: names.owner_first_name,
      last_name: names.owner_last_name,
      email: names.owner_email,
    });

    const [contacts, linkedCapexItems, tasks] = await Promise.all([
      this.loadLinkedContacts(context, {
        table: 'contract_contacts',
        foreignKey: 'contract_id',
        id: contractId,
      }).catch(() => []),
      this.contracts.listLinkedCapexItems(contractId, { manager: context.manager }).catch(() => ({ items: [] })),
      this.contracts.listTasks(contractId, { manager: context.manager }).catch(() => []),
    ]);

    return {
      company_name: names.company_name ?? null,
      supplier_name: names.supplier_name ?? null,
      owner: ownerName
        ? {
            name: ownerName,
            email: names.owner_email ?? null,
          }
        : null,
      contacts,
      linked_capex_items: linkedCapexItems,
      tasks,
    };
  }

  async executeDetail(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiQueryEntityType;
      entity_id: string;
      year?: number;
    },
  ): Promise<AiEntityDetailDto> {
    const entityType = input.entity_type;
    const entityId = await this.resolveDetailEntityId(context, entityType, input.entity_id);
    const accessScope = await resolveAiParticipationAccessScope(context, entityType);

    if (entityType === 'tasks') {
      const row = await this.tasks.getOne(entityId, { manager: context.manager, accessScope });
      if (!row) throw new NotFoundException('Task not found.');
      return this.toDetailResult(this.mapTask(row), row);
    }

    if (entityType === 'projects') {
      const row = await this.projects.get(
        entityId,
        { include: 'team,sponsors,contacts,company,department,source_requests,urls,dependencies,attachments,phases,milestones,financials' },
        { manager: context.manager, tenantId: context.tenantId, accessScope },
      );
      return this.toDetailResult(this.mapProject(row), row);
    }

    if (entityType === 'requests') {
      const row = await this.requests.get(
        entityId,
        { include: 'team,sponsors,contacts,company,department,origin_task,urls,attachments,projects,dependencies,financials,business_processes' },
        { manager: context.manager, accessScope },
      );
      return this.toDetailResult(this.mapRequest(row), row);
    }

    if (entityType === 'applications') {
      const row: any = await this.applications.get(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        include: 'instances,deployments,support',
        accessScope,
      });
      row.relation_counts = await this.applications.relationCounts(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
        projectAccessScope: await resolveAiParticipationAccessScope(context, 'projects'),
      }).catch(() => null);
      if (row.supplier_id) {
        const supplierRows = await context.manager.query(
          `SELECT name FROM suppliers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [row.supplier_id, context.tenantId],
        );
        row.supplier_name = supplierRows[0]?.name ?? null;
      }
      if (row.relation_counts) {
        row.spend_count = row.relation_counts.opex;
        row.capex_count = row.relation_counts.capex;
        row.contracts_count = row.relation_counts.contracts;
      }
      row.linked_spend_items = await this.applications.listLinkedSpendItems(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }).catch(() => ({ items: [] }));
      row.linked_capex_items = await this.applications.listLinkedCapexItems(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }).catch(() => ({ items: [] }));
      row.linked_contracts = await this.applications.listLinkedContracts(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }).catch(() => ({ items: [] }));
      row.projects = await this.applications.listProjects(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
        projectAccessScope: await resolveAiParticipationAccessScope(context, 'projects'),
      }).catch(() => ({ items: [] }));
      row.suites = await this.applications.listSuites(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }).catch(() => ({ items: [] }));
      row.components = await this.applications.listComponents(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }).catch(() => ({ items: [] }));
      return this.toDetailResult(this.mapApplication(row), row);
    }

    if (entityType === 'assets') {
      const row: any = await this.assets.get(entityId, { manager: context.manager, tenantId: context.tenantId });
      row.hardware_info = await this.assets.getHardwareInfo(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => null);
      row.support_info = await this.assets.getSupportInfo(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => null);
      row.support_contacts = await this.assets.listSupportContacts(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.relations = await this.assets.listRelations(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ outgoing: [], incoming: [] }));
      row.linked_spend_items = await this.assets.listLinkedSpendItems(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] }));
      row.linked_capex_items = await this.assets.listLinkedCapexItems(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] }));
      row.linked_contracts = await this.assets.listLinkedContracts(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] }));
      row.projects = await this.assets.listProjects(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] }));
      row.cluster_members = await this.assets.listClusterMembers(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.clusters = await this.assets.listClustersForAsset(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.links = await this.assets.listLinks(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.attachments = await this.assets.listAttachments(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      return this.toDetailResult(this.mapAsset(row), row);
    }

    if (entityType === 'spend_items') {
      const row: any = await this.spendItems.get(entityId, { manager: context.manager });
      if (row.tenant_id && row.tenant_id !== context.tenantId) throw new NotFoundException('Spend item not found.');
      await this.withoutHiddenAnalyticsValues(context, row, 'opex');
      const registry = await resolveAiEntityRegistry(context, entityType);
      Object.assign(row, await this.loadSpendItemDeepDetail(context, entityId, registry));
      return this.toDetailResult(this.mapSpendItem(row, registry), row);
    }

    if (entityType === 'capex_items') {
      const row: any = await this.capexItems.get(entityId, { manager: context.manager });
      if (row.tenant_id && row.tenant_id !== context.tenantId) throw new NotFoundException('CAPEX item not found.');
      // The id, not the reference the caller may have given (`get` accepts both).
      const capexItemId = row.id as string;
      await this.withoutHiddenAnalyticsValues(context, row, 'capex');
      const registry = await resolveAiEntityRegistry(context, entityType);
      Object.assign(row, await this.loadCapexItemDeepDetail(context, capexItemId, registry));
      row.links = await this.capexItems.listLinks(capexItemId, { manager: context.manager }).catch(() => []);
      row.attachments = await this.capexItems.listAttachments(capexItemId, { manager: context.manager }).catch(() => []);
      return this.toDetailResult(this.mapCapexItem(row, registry), row);
    }

    if (entityType === 'contracts') {
      const row: any = await this.contracts.get(entityId, { manager: context.manager });
      if (row.tenant_id && row.tenant_id !== context.tenantId) throw new NotFoundException('Contract not found.');
      Object.assign(row, await this.loadContractDeepDetail(context, entityId));
      return this.toDetailResult(this.mapContract(row), row);
    }

    if (entityType === 'companies') {
      const row: any = await this.companies.get(entityId, { manager: context.manager });
      row.metrics = await this.loadCompanyMetrics(context, entityId);
      const selectedYear = normalizeMetricYear(input.year) ?? new Date().getFullYear();
      const selectedMetric = row.metrics.find((metric: any) => metric.fiscal_year === selectedYear) ?? null;
      row.selected_metrics_year = selectedYear;
      row.selected_metrics = selectedMetric;
      if (selectedMetric) {
        row.metrics_year = selectedYear;
        row.headcount_year = selectedMetric.headcount;
        row.it_users_year = selectedMetric.it_users;
        row.turnover_year = selectedMetric.turnover;
        row.metrics_frozen = selectedMetric.is_frozen;
      }
      return this.toDetailResult(this.mapCompany(row), row);
    }

    if (entityType === 'suppliers') {
      const row = await this.suppliers.get(entityId, { manager: context.manager });
      return this.toDetailResult(this.mapSupplier(row), row);
    }

    if (entityType === 'departments') {
      const row: any = await this.departments.get(entityId, { manager: context.manager });
      row.metrics = await this.loadDepartmentMetrics(context, entityId);
      const selectedYear = normalizeMetricYear(input.year) ?? new Date().getFullYear();
      const selectedMetric = row.metrics.find((metric: any) => metric.fiscal_year === selectedYear) ?? null;
      row.selected_metrics_year = selectedYear;
      row.selected_metrics = selectedMetric;
      if (selectedMetric) {
        row.metrics_year = selectedYear;
        row.headcount_year = selectedMetric.headcount;
        row.metrics_frozen = selectedMetric.is_frozen;
      }
      return this.toDetailResult(this.mapDepartment(row), row);
    }

    if (entityType === 'accounts') {
      const row = await this.accounts.get(entityId, { manager: context.manager });
      return this.toDetailResult(this.mapAccount(row), row);
    }

    if (entityType === 'chart_of_accounts') {
      const row = await this.chartOfAccounts.get(entityId, { manager: context.manager });
      return this.toDetailResult(this.mapChartOfAccounts(row), row);
    }

    if (entityType === 'analytics_categories') {
      const row = await this.analyticsCategories.get(entityId, { manager: context.manager });
      return this.toDetailResult(this.mapAnalyticsCategory(row, await this.analyticsAxesById(context)), row);
    }

    if (entityType === 'business_processes') {
      const row = await this.businessProcesses.get(entityId, { manager: context.manager });
      return this.toDetailResult(this.mapBusinessProcess(row), row);
    }

    if (entityType === 'contacts') {
      const row = await this.contacts.get(entityId, { manager: context.manager, tenantId: context.tenantId });
      return this.toDetailResult(this.mapContact(row), row);
    }

    if (entityType === 'locations') {
      const row: any = await this.locations.get(entityId, {
        manager: context.manager,
        include: ['internal_contacts', 'external_contacts', 'links'],
      });
      row.sub_locations = await this.locations.listSubItems(entityId, { manager: context.manager }).catch(() => []);
      return this.toDetailResult(this.mapLocation(row), row);
    }

    if (entityType === 'interfaces') {
      const row = await this.interfaces.get(
        entityId,
        { include: 'relations,legs,attachments,middleware_applications' },
        { manager: context.manager },
      );
      return this.toDetailResult(this.mapInterface(row), row);
    }

    if (entityType === 'connections') {
      const row = await this.connections.get(entityId, context.tenantId, { manager: context.manager, includeLegs: true });
      return this.toDetailResult(this.mapConnection(row), row);
    }

    if (entityType === 'users') {
      const row = await this.users.findById(entityId, { manager: context.manager });
      if (!row) throw new NotFoundException('User not found.');
      return this.toDetailResult(this.mapUser(row), row);
    }

    if (entityType === 'documents') {
      const document = await this.knowledge.get(entityId, { manager: context.manager, userId: context.userId });
      if (!document) throw new NotFoundException('Document not found.');
      return this.toDetailResult(this.mapDocument(document), document);
    }

    if (entityType === 'incidents') {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      const record = await this.incidentRecords.load(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        userId: context.userId,
        viewer,
      });
      // The four narrative columns are gone: the review document carries them
      // now (planning/incident-review-document.md §3.6). The record service
      // already applied the incident permissions and row visibility, and the
      // business reference is exposed, never the document UUID.
      return this.toDetailResult(this.mapIncident(record.incident), {
        ...record.incident,
        review_markdown: record.review?.content_markdown ?? null,
        review_document_ref: record.review?.item_number != null
          ? `DOC-${Number(record.review.item_number)}`
          : null,
        entries: record.entries,
        assets: record.assets,
        applications: record.applications,
        tasks: record.tasks,
        documents: record.documents,
        attachments: record.attachments,
      });
    }

    throw new BadRequestException('Unsupported entity type.');
  }

  private async loadRegistryFilterValues(
    context: AiExecutionContextWithManager,
    entityType: AiQueryEntityType,
    registry: AiEntityFilterRegistry,
    aiFields: string[],
  ): Promise<Record<string, Array<string | boolean | null>>> {
    const values: Record<string, Array<string | boolean | null>> = {};

    // Resolved once for the whole call: the viewers and the readable library set
    // depend on the user and the tenant only, never on the field being listed.
    const incidentViewer = entityType === 'incidents'
      ? await resolveIncidentViewer(context.manager, context.userId, context.tenantId)
      : null;
    const accessibleLibraries = entityType === 'documents'
      ? await this.knowledge.listReadableLibraryIdsForUser(context.manager, context.userId ?? null)
      : null;
    const documentIncidentViewer = entityType === 'documents'
      ? await resolveAiDocumentIncidentViewer(context)
      : null;

    for (const aiField of aiFields) {
      const groupField = registry.aggregate.groupFields[aiField];
      if (!groupField) continue;
      const joins = Array.from(new Set(groupField.joins || [])).join('\n');
      const alias = registry.aggregate.alias;
      const params: unknown[] = [context.tenantId];
      const accessScope = await resolveAiParticipationAccessScope(context, entityType);
      const accessScopeSql = accessScope && isParticipationScopedAiEntityType(entityType)
        ? `AND ${participantConditionForAiEntity(entityType, alias, `$${params.length + 1}`)}`
        : '';
      if (accessScopeSql) params.push(accessScope!.userId);
      const incidentVisibility = incidentViewer
        ? incidentVisibilitySql(alias, incidentViewer, params)
        : '';
      // Documents fall through to this registry path for dynamic fields; without
      // the two clauses below it would be a tenant-wide oracle on library and
      // incident-review metadata.
      let documentAclSql = '';
      if (entityType === 'documents') {
        if (accessibleLibraries) {
          if (accessibleLibraries.length === 0) {
            values[aiField] = [];
            continue;
          }
          params.push(accessibleLibraries);
          documentAclSql += ` AND ${alias}.library_id = ANY($${params.length}::uuid[])`;
        }
        documentAclSql += documentIncidentVisibilitySql(alias, documentIncidentViewer, params);
      }
      const rows = await context.manager.query(
        `SELECT DISTINCT ${groupField.expression} AS value
         FROM ${registry.aggregate.baseTable} ${alias}
         ${joins}
         WHERE ${alias}.tenant_id = $1
           ${accessScopeSql}
           ${incidentVisibility}
           ${documentAclSql}
         ORDER BY value ASC NULLS LAST
         LIMIT 5000`,
        params,
      );
      values[aiField] = (rows || []).map((row: any) => {
        if (row.value === null || row.value === undefined || row.value === '') return null;
        if (typeof row.value === 'boolean') return row.value;
        return String(row.value);
      });
    }

    return values;
  }

  async executeFilterValues(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiQueryEntityType;
      fields: string[];
    },
  ): Promise<AiFilterValuesResult> {
    const registry = await resolveAiEntityRegistry(context, input.entity_type);
    const requestedFields = Array.from(
      new Set(
        (input.fields || [])
          .map((fieldName) => String(fieldName || '').trim())
          .filter((fieldName) => fieldName.length > 0),
      ),
    );
    const values: Record<string, Array<string | boolean | null>> = {};
    const fieldsIgnored = new Set<string>();
    const dynamicFieldMap = new Map<string, string[]>();

    for (const fieldName of requestedFields) {
      const field = registry.fields[fieldName];
      if (!field || field.discoverable !== true) {
        fieldsIgnored.add(fieldName);
        continue;
      }
      if (Array.isArray(field.values)) {
        values[fieldName] = [...field.values];
        continue;
      }
      if (field.dynamic) {
        const mapped = dynamicFieldMap.get(field.grid) ?? [];
        mapped.push(fieldName);
        dynamicFieldMap.set(field.grid, mapped);
        continue;
      }
      fieldsIgnored.add(fieldName);
    }

    if (dynamicFieldMap.size === 0) {
      const ignoredFields = Array.from(fieldsIgnored);
      return {
        values,
        fields_ignored: ignoredFields,
        total: requestedFields.length,
        returned: Object.keys(values).length,
        truncated: false,
        complete: ignoredFields.length === 0,
      };
    }

    const query: Record<string, any> = {
      fields: Array.from(dynamicFieldMap.keys()).join(','),
    };
    if (input.entity_type === 'projects') {
      query.status = 'all';
    } else if (input.entity_type === 'requests') {
      query.status = 'all';
    } else if (input.entity_type === 'applications') {
      query.include_inactive = true;
    } else if (
      input.entity_type === 'spend_items'
      || input.entity_type === 'accounts'
      || input.entity_type === 'analytics_categories'
      || input.entity_type === 'business_processes'
      || input.entity_type === 'capex_items'
      || input.entity_type === 'chart_of_accounts'
      || input.entity_type === 'contracts'
      || input.entity_type === 'companies'
      || input.entity_type === 'contacts'
      || input.entity_type === 'suppliers'
      || input.entity_type === 'departments'
    ) {
      query.includeDisabled = true;
    }

    const accessScope = await resolveAiParticipationAccessScope(context, input.entity_type);
    let raw: Record<string, Array<string | boolean | null>> = {};
    if (input.entity_type === 'tasks') {
      raw = await this.tasks.listFilterValues(query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }) as any;
    } else if (input.entity_type === 'projects') {
      raw = await this.projects.listFilterValues(query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }) as any;
    } else if (input.entity_type === 'requests') {
      raw = await this.requests.listFilterValues(query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }) as any;
    } else if (input.entity_type === 'applications') {
      raw = await this.applications.listFilterValues(query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
      }) as any;
    } else if (input.entity_type === 'spend_items') {
      raw = await this.spendItems.summaryFilterValues(query, {
        manager: context.manager,
      }) as any;
    } else if (input.entity_type === 'capex_items') {
      raw = await this.capexItems.summaryFilterValues(query, {
        manager: context.manager,
      }) as any;
    } else if (input.entity_type === 'contracts') {
      raw = await this.contracts.listFilterValues(query, {
        manager: context.manager,
      }) as any;
    } else if (input.entity_type === 'companies') {
      raw = await this.companies.listFilterValues(query, {
        manager: context.manager,
      }) as any;
    } else if (input.entity_type === 'suppliers') {
      raw = await this.suppliers.listFilterValues(query, {
        manager: context.manager,
      }) as any;
    } else if (input.entity_type === 'departments') {
      raw = await this.departments.listFilterValues(query, {
        manager: context.manager,
      }) as any;
    } else if (input.entity_type === 'assets') {
      raw = await this.assets.listFilterValues(query, { manager: context.manager, tenantId: context.tenantId }) as any;
    } else if (input.entity_type === 'documents') {
      raw = await this.knowledge.listFilterValues(query, {
        manager: context.manager,
        tenantId: context.tenantId,
        // Without the real userId the library ACL degrades to "unrestricted".
        userId: context.userId ?? null,
      }) as any;
    } else if (input.entity_type === 'connections') {
      // Effective criticality and data class, as the list filters on them; other fields fall back below.
      raw = await this.connections.listFilterValues(context.tenantId, query, { manager: context.manager }) as any;
    } else if (input.entity_type === 'locations') {
      raw = await this.locations.listFilterValues(query, { manager: context.manager, tenantId: context.tenantId }) as any;
    } else if (input.entity_type === 'users') {
      raw = await this.users.listFilterValuesForAi(query, {
        manager: context.manager,
        tenantId: context.tenantId,
      }) as any;
    } else if (input.entity_type === 'incidents') {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      raw = await this.incidents.listFilterValues(query, {
        manager: context.manager,
        tenantId: context.tenantId,
        viewer,
      }) as any;
    }

    const fallbackAiFields = requestedFields.filter((fieldName) => {
      const field = registry.fields[fieldName];
      return field?.dynamic === true && !raw?.[field.grid];
    });
    if (fallbackAiFields.length > 0) {
      const fallback = await this.loadRegistryFilterValues(context, input.entity_type, registry, fallbackAiFields);
      for (const [aiField, fieldValues] of Object.entries(fallback)) {
        const field = registry.fields[aiField];
        if (field) raw[field.grid] = fieldValues;
      }
    }

    for (const [gridField, aiFields] of dynamicFieldMap.entries()) {
      const rawValues = raw?.[gridField] ?? [];
      for (const aiField of aiFields) {
        values[aiField] = rawValues;
      }
    }

    const ignoredFields = Array.from(fieldsIgnored);
    return {
      values,
      fields_ignored: ignoredFields,
      total: requestedFields.length,
      returned: Object.keys(values).length,
      truncated: false,
      complete: ignoredFields.length === 0,
    };
  }
}
