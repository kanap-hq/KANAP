import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
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
import { BudgetLinesService } from '../../spend/budget-lines.service';
import { budgetLineReference } from '../../spend/budget-nature';
import { TaskLinkedScopes, TasksService } from '../../spend/tasks.service';
import { AllocationCalculatorService } from '../../spend/allocation-calculator.service';
import { describeAllocationWarning } from '../../spend/allocation-distribution';
import type { SpendVersion } from '../../spend/spend-version.entity';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { TechnologiesService } from '../../technologies/technologies.service';
import { EndOfSupportService, type DeadlineRow } from '../../technologies/reports/end-of-support.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolesService } from '../../roles/roles.service';
import { DataAccessAdminService } from '../../data-access/data-access-admin.service';
import { DataAccessReservedException } from '../../data-access/reserved-operations';
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
  invalidFilterResult,
  hasEmailOrUuidFilterValue,
} from './ai-filter-description.util';
import {
  applyScopeToAiQuery,
  isParticipationScopedAiEntityType,
  participantConditionForAiEntity,
  resolveAiDocumentIncidentViewer,
  resolveAiIncidentViewer,
  resolveAiParticipationAccessScope,
} from './ai-query-scope.util';
import {
  AiAdaptedFilters,
  AiAmountTotals,
  AiEntityFilterRegistry,
  AiFilterValue,
  AiFilterValuesResult,
  AiQueryResult,
} from './ai-filter.types';
import { assertPlainTextQuickSearch } from './ai-quick-search-validation.util';
import { aiAmountsCurrency } from './ai-amounts-currency.util';
import { aiDataAccessCountsNote, aiDataAccessNote } from './ai-data-access-note.util';
import { aiBudgetListAccess } from './ai-budget-list-access.util';
import { compareNullableText } from '../../common/list-engine/sql-fragments';
import type { BudgetListAccess } from '../../spend/budget-list/budget-list.runtime';
import { coveredRecordsText, loadContractCoverage } from './ai-contract-coverage';
import { hiddenContractLineCount } from '../../contracts/contract-relations';
import { contractMismatchesAgainstLine, lineMismatchesAgainstContract } from '../../contracts/contract-line-match';
import { AiReadProbe, analyticsAxisFields, resolveAiEntityRegistry } from './registries';
import { taskRelatedFamily } from './registries/tasks.registry';
import { budgetFteFields, budgetLineTotalFieldsOf, budgetPairOfKey, isBudgetMoneyKey } from './registries/budget-amount-fields';
import { analyticsAxisLabel, AnalyticsAxisInfo, axisAppliesTo, loadAnalyticsAxes, parseAnalyticsFieldKey } from '../../analytics/analytics-axes.util';
import { entityNotFound, isUuid, resolveAiEntityReference } from '../ai-entity-reference.util';
import { AiPolicyService } from '../ai-policy.service';
import { LinkedReads, loadLinkedReads } from '../../common/relations/linked-reads';
import type { PortfolioLinkedReads } from '../../portfolio/portfolio-linked-reads';
import {
  AiTechnologyRow,
  AiTechnologyVersionRow,
  listAiTechnologies,
  listAiTechnologyVersions,
  resolveAiApplicationsReach,
  technologyContractCount,
  technologyVersionFigures,
} from './ai-technologies.query';
import { AiVulnerabilityDetailRow, AiVulnerabilityRow, listAiVulnerabilities, readAiVulnerabilityFeeds } from './ai-vulnerabilities.query';
import { APPLICATIONS_UNREAD_NOTE, listAiSupportDeadlines, listAiSupportGaps, type AiSupportGapRow } from './ai-support.query';
import {
  findAiRole,
  listAiRolePermissions,
  listAiRoles,
  type AiRolePermissionRow,
  type AiRoleRow,
  type AiRolesServices,
} from './ai-roles.query';
import {
  AI_DATA_ACCESS_COVERAGE_NOTE,
  AI_DATA_ACCESS_DELETED_NODE,
  AI_DATA_ACCESS_NO_NODE_NOTE,
  AI_DATA_ACCESS_UNAVAILABLE_NOTE,
  listAiDataAccess,
  type AiDataAccessRow,
} from './ai-data-access.query';
import { ChargebackReportService } from '../../spend/chargeback-report.service';
import {
  chargebackRowId,
  chargebackRowLabel,
  listAiChargeback,
  listAiChargebackLines,
  type AiChargebackLineRow,
  type AiChargebackList,
  type AiChargebackRow,
} from './ai-chargeback.query';
import { CostCentersService } from '../../cost-centers/cost-centers.service';
import {
  aiCostCenterDetail,
  costCenterFilterValues,
  listAiCostCenters,
  readAiCostCenterTree,
  type AiCostCenterRow,
} from './ai-cost-centers.query';
import { WorkingDayProfilesService } from '../../working-day-profiles/working-day-profiles.service';
import { AnalyticsAxesService } from '../../analytics/analytics-axes.service';
import {
  AI_CALENDAR_NO_YEAR_NOTE,
  AI_CALENDAR_YEAR_NOTE,
  calendarHolidays,
  calendarMonths,
  calendarYearOf,
  listAiWorkingDayCalendars,
  readCalendarYear,
  type AiWorkingDayCalendarOpts,
  type AiWorkingDayCalendarRow,
} from './ai-working-day-calendars.query';
import { AI_AXIS_VALUES_NOTE, listAiAnalyticsAxes, toAiAnalyticsAxisRow, type AiAnalyticsAxisRow } from './ai-analytics-axes.query';
import { applicationVulnerabilityCounts, assetVulnerabilityCounts, VulnerabilityReachCounts } from '../../vulnerabilities/vulnerability-reach-counts';
import { FIXED_SLOTS, FixedSlot, fteFieldKey, resolveFteField, SlotMetric, SUMMARY_COLUMNS } from '../../spend/spend-summary.builder';
import { classificationLabels } from '../../applications/services/application-classification';
import { readClassificationCatalog } from '../ai-classification-catalog.util';
import { AI_SCREEN_RESOURCES, aiPermissionLevelLabel, aiResourceLabel } from '../ai-role-labels';
import { readAiScreenLanguage, type AiScreenLanguage } from '../ai-unread-families';

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
  if (entityType === 'technologies') return `TEC-${itemNumber}`;
  if (entityType === 'budget_lines') return `BL-${itemNumber}`;
  return null;
}

function scalar(value: unknown): string | number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return toIso(value);
  return String(value);
}

/**
 * The vulnerability counts of an asset or application row: as its list sets them
 * (`vulnerabilityListFields`), or as the detail does (`vulnerabilityCountsOf`). Null retired or out
 * of service, or with the feed off.
 */
function vulnerabilityCountsMetadata(row: any): { open_vulnerabilities: number | null; severe_vulnerabilities: number | null } {
  return {
    open_vulnerabilities: numericScalar(row.vulnerabilities_to_review ?? row.open_vulnerabilities),
    severe_vulnerabilities: numericScalar(row.vulnerabilities_severe ?? row.severe_vulnerabilities),
  };
}

/** The detail's counts, under the assistant's field names (shared module, one id). */
function vulnerabilityCountsOf(counts: VulnerabilityReachCounts | undefined) {
  return { open_vulnerabilities: counts?.open ?? null, severe_vulnerabilities: counts?.severe ?? null };
}

/** The modules whose linked records a detail lists, each on its read right (`readableLinks`). */
type AiReadableLinks = { budget: boolean; contracts: boolean; projects: boolean; applications: boolean };

/**
 * An application's relation counts (`relationCounts`) without the modules the caller does not
 * read: null, never 0, and left out of `total`.
 */
function readableRelationCounts<T extends { opex: number; capex: number; contracts: number; projects: number; total: number }>(
  counts: T,
  reads: AiReadableLinks,
): Omit<T, 'opex' | 'capex' | 'contracts' | 'projects' | 'total'> & { budget_lines: number | null; contracts: number | null; projects: number | null; total: number } {
  const unread = (shown: boolean, value: number) => (shown ? 0 : value);
  const budgetLines = counts.opex + counts.capex;
  // The old per-nature keys are not an alias of the merged count: they do not leave this function.
  const { opex: _opex, capex: _capex, contracts: _contracts, projects: _projects, total: _total, ...rest } = counts;
  return {
    ...rest,
    budget_lines: reads.budget ? budgetLines : null,
    contracts: reads.contracts ? counts.contracts : null,
    projects: reads.projects ? counts.projects : null,
    total: counts.total
      - unread(reads.budget, budgetLines)
      - unread(reads.contracts, counts.contracts)
      - unread(reads.projects, counts.projects),
  };
}

/**
 * The budget lines linked to another family, both natures in one list. `product_name` is the
 * title of both (the CAPEX link read returns it as `description`); `nature` says which nature
 * the line is. Null when the caller does not read the budget: not "none".
 */
function mergeLinkedBudgetLines(
  opex: { items?: Array<{ id: string; product_name: string | null; item_number?: number | null }> } | null,
  capex: { items?: Array<{ id: string; description: string | null; item_number?: number | null }> } | null,
): { items: Array<{ id: string; reference: string | null; product_name: string | null; item_number: number | null; nature: 'opex' | 'capex' }> } | null {
  if (!opex && !capex) return null;
  return {
    items: [
      ...(opex?.items ?? []).map((line) => ({ id: line.id, reference: budgetLineReference(line.item_number), product_name: line.product_name, item_number: line.item_number ?? null, nature: 'opex' as const })),
      ...(capex?.items ?? []).map((line) => ({ id: line.id, reference: budgetLineReference(line.item_number), product_name: line.description, item_number: line.item_number ?? null, nature: 'capex' as const })),
    ],
  };
}

/**
 * A child row (link, attachment) under its native name: a CAPEX service presents its line as
 * `capex_item_id`, which the AI surface does not use.
 */
function nativeLineChild<T extends Record<string, any>>(row: T): T {
  if (!row || typeof row !== 'object' || !('capex_item_id' in row)) return row;
  const { capex_item_id, ...rest } = row;
  return { ...rest, spend_item_id: capex_item_id } as unknown as T;
}

function nativeLineChildren(rows: any[]): any[] {
  return (rows ?? []).map(nativeLineChild);
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
  // No rate for the line's currency that year: no value in the reporting currency (never the line's own).
  if (slot.reporting?.fx_source === 'missing') return null;
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
 * The fixed years whose amounts were not converted: no rate for the line's currency that year,
 * so the reporting values are null (`fx-rate.service.ts`, `missing`; `loadVersionTotals`).
 */
export function budgetFxMissingYears(row: any, anchorYear: number): number[] {
  const years: number[] = [];
  for (const slot of FIXED_SLOTS) {
    const reporting = budgetSlot(row, slot, anchorYear)?.reporting;
    if (reporting?.fx_source === 'missing' && reporting.currency !== reporting.reporting_currency) years.push(anchorYear + slot.offset);
  }
  return years;
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
  // The years without a rate, as "2025, 2026"; null when every year is converted.
  metadata.amounts_fx_missing_years = budgetFxMissingYears(row, anchorYear).join(', ') || null;
  for (const slot of FIXED_SLOTS) {
    for (const column of SUMMARY_COLUMNS) metadata[`${slot.ai}_${column.ai}_fte`] = budgetFteValue(row, slot, column, anchorYear);
  }
  return metadata;
}

/**
 * The amounts of the budget lines of one page, as `amount_totals` sums every line the filters keep
 * (same fields, same reporting currency): the total of the lines listed, "the ten largest lines".
 */
function budgetPageAmountTotals(rows: any[], anchorYear: number, currency: string | null): AiAmountTotals {
  const values: Record<string, number> = {};
  for (const slot of FIXED_SLOTS) {
    for (const column of SUMMARY_COLUMNS) values[`${slot.ai}_${column.ai}`] = 0;
  }
  const fxMissing = new Map<string, { currency: string; year: number; lines: number }>();
  for (const row of rows) {
    for (const slot of FIXED_SLOTS) {
      const data = budgetSlot(row, slot, anchorYear);
      for (const column of SUMMARY_COLUMNS) {
        const value = budgetSlotValue(data, column.key);
        if (value != null) values[`${slot.ai}_${column.ai}`] += value;
      }
    }
    for (const year of budgetFxMissingYears(row, anchorYear)) {
      const lineCurrency = String(row.currency ?? '');
      const key = `${lineCurrency}\u0000${year}`;
      const entry = fxMissing.get(key) ?? { currency: lineCurrency, year, lines: 0 };
      entry.lines += 1;
      fxMissing.set(key, entry);
    }
  }
  for (const key of Object.keys(values)) values[key] = Math.round(values[key] * 100) / 100;
  return {
    records: rows.length,
    currency,
    values,
    ...(fxMissing.size ? { fx_missing: [...fxMissing.values()] } : {}),
    note: `Each amount field summed over the ${rows.length} lines returned on this page only, in ${currency ?? 'the reporting currency'}, by the server: `
      + 'the total of the lines listed (for "the ten largest lines and their total", a page of ten sorted on the amount). '
      + 'amount_totals is the total of every line the filters keep.'
      + (fxMissing.size ? ' The amounts of the lines listed in fx_missing have no rate and are left out: say so.' : ''),
  };
}

/** The yearly amounts of the contracts of one page, per contract currency, as `amount_totals` sums every contract. */
function contractPageAmountTotals(rows: any[]): AiAmountTotals {
  const byCurrency = new Map<string, { currency: string | null; yearly_amount: number | null; contracts: number; without_amount: number }>();
  for (const row of rows) {
    const currency = row.currency == null ? null : String(row.currency);
    const entry = byCurrency.get(currency ?? '') ?? { currency, yearly_amount: null, contracts: 0, without_amount: 0 };
    const amount = numericScalar(row.yearly_amount_at_signature);
    entry.contracts += 1;
    if (amount == null) entry.without_amount += 1;
    else entry.yearly_amount = Math.round(((entry.yearly_amount ?? 0) + amount) * 100) / 100;
    byCurrency.set(currency ?? '', entry);
  }
  const by_currency = [...byCurrency.values()].sort((a, b) =>
    (a.currency == null ? 1 : 0) - (b.currency == null ? 1 : 0) || String(a.currency).localeCompare(String(b.currency)));
  return {
    records: rows.length,
    currency: null,
    by_currency,
    note: `The yearly amounts of the ${rows.length} contracts returned on this page only, summed per contract currency by the server: `
      + 'the total of the contracts listed. Amounts in different currencies do not add up. amount_totals is the total of every contract the filters keep.',
  };
}

/**
 * The value of each enabled non-default analytics dimension under its AI key
 * (`analytics:<code>`): read from the engine's key, or from the AI key on a
 * detail row already converted by `withDetailAiKeys`.
 */
function analyticsAxisMetadata(row: any, registry: AiEntityFilterRegistry): AiEntityMetadata {
  return Object.fromEntries(analyticsAxisFields(registry)
    .filter(({ nature }) => !nature || !row?.nature || nature === row.nature)
    .map(({ key, grid }) => [key, scalar(row?.[grid] ?? row?.[key])]));
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
  for (const { key, grid, nature } of analyticsAxisFields(registry)) {
    // A dimension of the other nature stays out of a line's detail (blank, never a stale value).
    if (nature && row.nature && nature !== row.nature) continue;
    output[key] = row[grid] ?? null;
  }
  for (const field of Object.values(budgetFteFields())) output[field.ai] = numericScalar(row[field.grid]);
  return output;
}

/**
 * The descriptive fields both budget item types share, for the registry resolved for the tenant.
 * `consolidation`: each line's consolidation account (`consolidationLabels`), for a registry that
 * holds the field (a person who reads the accounts).
 */
function budgetItemMetadata(row: any, registry: AiEntityFilterRegistry, consolidation?: Map<string, string | null>): AiEntityMetadata {
  return {
    supplier: scalar(row.supplier_name),
    paying_company: scalar(row.paying_company_name ?? row.company_name),
    account: scalar(row.account_display),
    ...(registry.fields.consolidation_account ? { consolidation_account: consolidation?.get(row.id) ?? null } : {}),
    owner_it: scalar(row.owner_it_name),
    owner_business: scalar(row.owner_business_name),
    analytics_category: registry.fields.analytics_category?.nature && registry.fields.analytics_category.nature !== row.nature
      ? null
      : scalar(row.analytics_category_name),
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
    reference?: string | null;
    label: string;
    status: string | null;
    summary?: string | null;
    created_at?: Date | string | null;
    updated_at?: Date | string | null;
    metadata?: AiEntityMetadata;
  },
): AiEntitySummaryDto {
  return {
    type: entityType,
    id: row.id,
    ref: row.reference ?? buildRef(entityType, row.item_number ?? null),
    label: row.label,
    status: row.status ?? null,
    summary: clipSummary(row.summary),
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
    metadata: row.metadata ?? null,
  };
}

/** A list row's summary stays short: the full text is in get_entity_detail. */
export const AI_QUERY_SUMMARY_MAX_CHARS = 300;

function clipSummary(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.length <= AI_QUERY_SUMMARY_MAX_CHARS ? text : `${text.slice(0, AI_QUERY_SUMMARY_MAX_CHARS - 1)}…`;
}

/**
 * Page size of query_entities. A page of the widest families must fit the MCP response cap
 * (64,000 characters, `ai-mcp.controller.ts`): measured on the demo tenant, an OPEX or CAPEX
 * line takes about 2,800 characters (its yearly amounts), an application about 1,500 and any
 * other row under 900. A larger `limit` is reduced to the family's maximum; the result's
 * `limit` is the one applied.
 */
export const AI_QUERY_DEFAULT_LIMIT = 25;
export const AI_QUERY_MAX_LIMIT = 50;
export const AI_QUERY_FAMILY_MAX_LIMIT: Partial<Record<AiQueryEntityType, number>> = {
  // Both natures in one family: the sum of the two former per-nature caps (15 each).
  budget_lines: 30,
  applications: 30,
  // A technology lists up to 10 versions in use (`versions_in_use`): about 1,500 characters a row.
  technologies: 30,
  // A CVE row carries its summary (clipped), note and page link: about 1,200 characters.
  vulnerabilities: 30,
  // A deadline carries its servers and applications by name (at most ten then a count).
  support_deadlines: 30,
};

export function aiQueryMaxLimit(entityType: AiQueryEntityType): number {
  return AI_QUERY_FAMILY_MAX_LIMIT[entityType] ?? AI_QUERY_MAX_LIMIT;
}

export function aiQueryLimit(entityType: AiQueryEntityType, requested: unknown): number {
  const max = aiQueryMaxLimit(entityType);
  const value = Number(requested);
  if (!Number.isFinite(value) || value < 1) return Math.min(AI_QUERY_DEFAULT_LIMIT, max);
  return Math.min(Math.floor(value), max);
}

/** The sort a query runs with, and the requested field it could not use (not advertised by the registry). */
export type AiResolvedSort = {
  param: string;
  applied: { field: string; direction: 'asc' | 'desc' };
  ignored: string[];
};

export function resolveAiQuerySort(
  registry: AiEntityFilterRegistry,
  sort?: { field?: string; direction?: string },
): AiResolvedSort {
  const fallback: AiResolvedSort = {
    param: `${registry.sortFields[registry.defaultSort.field] ?? registry.defaultSort.field}:${registry.defaultSort.direction.toUpperCase()}`,
    applied: { field: registry.defaultSort.field, direction: registry.defaultSort.direction },
    ignored: [],
  };
  const field = typeof sort?.field === 'string' ? sort.field.trim() : '';
  if (!field) return fallback;
  const mappedField = Object.prototype.hasOwnProperty.call(registry.sortFields, field) ? registry.sortFields[field] : undefined;
  if (!mappedField) return { ...fallback, ignored: [field] };
  const direction = sort?.direction === 'asc' ? 'asc' : 'desc';
  return { param: `${mappedField}:${direction.toUpperCase()}`, applied: { field, direction }, ignored: [] };
}

/**
 * A task of a budget line the person cannot read (data-scoped access, `related_object_hidden`):
 * the task list and page name the line by its reference; Plaid and MCP show no trace of it, neither
 * its reference nor its id (spec §5.4). The task's own type of object stays.
 */
function withoutHiddenLine<T extends { related_object_hidden?: true }>(row: T): T {
  if (row.related_object_hidden !== true) return row;
  const { related_object_hidden: _hidden, ...task } = row;
  return { ...task, related_object_id: null, related_object_name: null } as unknown as T;
}

@Injectable()
export class AiQueryExecutor {
  constructor(
    private readonly tasks: TasksService,
    /** The unified read engine of the budget lines, both natures (`spend/budget-lines.service.ts`). */
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
    private readonly incidentRecords: IncidentRecordService,
    /** Each version's allocation as the Allocations tab computes it (`loadFinancialVersions`). */
    private readonly allocationCalculator: AllocationCalculatorService,
    /** Whether the caller reads applications, for the application figures of the technologies. */
    @Optional() private readonly policy?: AiPolicyService,
    @Optional() private readonly technologies?: TechnologiesService,
    /** The End of support report of the screen, which the two report families read. */
    @Optional() private readonly endOfSupport?: EndOfSupportService,
    /** The services of Admin › Roles, which `roles` and `role_permissions` read. */
    @Optional() private readonly roles?: RolesService,
    @Optional() private readonly permissions?: PermissionsService,
    /** Admin › Data access: the `data_access` family, and the access blocks of a person and a company. */
    @Optional() private readonly dataAccess?: DataAccessAdminService,
    /** The chargeback reports of the screens, which `chargeback` and `chargeback_lines` read. */
    @Optional() private readonly chargeback?: ChargebackReportService,
    /** Master data › Cost centers, which the `cost_centers` family reads. */
    @Optional() private readonly costCenters?: CostCentersService,
    /** Master data › Working-day calendars and Analytics dimensions: `working_day_calendars`, `analytics_axes`. */
    @Optional() private readonly workingDayProfiles?: WorkingDayProfilesService,
    @Optional() private readonly analyticsAxes?: AnalyticsAxesService,
  ) {
    // Absent, the technology figures close (no application count, no detail): say so once, at start.
    const logger = new Logger(AiQueryExecutor.name);
    if (!policy) logger.warn('AiPolicyService is not injected: technologies show no application or contract figure.');
    if (!technologies) logger.warn('TechnologiesService is not injected: the technology detail is unavailable.');
    if (!endOfSupport) logger.warn('EndOfSupportService is not injected: the end-of-support report families are unavailable.');
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
      page?: number;
      limit?: number;
    },
    sort: AiResolvedSort,
  ): Promise<{ query: Record<string, any>; filtersApplied: string[]; filtersIgnored: string[]; adapted: AiAdaptedFilters }> {
    const normalizedFilters = await this.normalizePersonFilters(context, entityType, input.filters);
    const adapted = adaptFilters(registry, normalizedFilters);
    const page = Math.min(Math.max(Number(input.page) || 1, 1), 100);
    const limit = aiQueryLimit(entityType, input.limit);
    assertPlainTextQuickSearch(entityType, input.q, registry);
    const query: Record<string, any> = {
      page,
      limit,
      sort: sort.param,
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
      query.include = 'supplier,owners,residency,hosting,counts,structure,instances,vulnerabilities';
      query.include_inactive = true;
    } else if (
      entityType === 'budget_lines'
      || entityType === 'accounts'
      || entityType === 'analytics_categories'
      || entityType === 'business_processes'
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
      adapted,
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
    // A task of a line the person cannot read (data-scoped access): the task list names the line
    // by its reference (`related_object_hidden`); Plaid and MCP name nothing (spec §5.4: neither
    // mention nor reference). The task's own type of object stays, as on any visible task.
    const hiddenLine = row.related_object_hidden === true;
    return toEntitySummary('tasks', {
      id: row.id,
      item_number: row.item_number ?? null,
      label: row.title || 'Untitled task',
      status: row.status ?? null,
      summary: row.description ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        assignee: scalar(row.assignee_name),
        creator: scalar(row.creator_name),
        priority: scalar(row.priority_level),
        type: scalar(row.task_type_name),
        due_date: scalar(row.due_date),
        phase: scalar(row.phase_name),
        labels: scalar(Array.isArray(row.labels) ? row.labels.join(', ') : null),
        related: scalar(taskRelatedFamily(row.related_object_type)),
        related_label: hiddenLine ? null : scalar(row.related_object_name),
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
      created_at: row.created_at ?? null,
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
      created_at: row.created_at ?? null,
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

  /** With the list's `registry`, the counts it leaves out (`withoutUnreadableLinkedCounts`) are null. */
  private mapApplication(row: any, registry?: AiEntityFilterRegistry): AiEntitySummaryDto {
    const count = (field: string) => (registry && !registry.fields[field] ? null : numericScalar(row[field]));
    return toEntitySummary('applications', {
      id: row.id,
      reference: row.sequential_id ?? null,
      label: row.name,
      status: row.status ?? null,
      summary: row.description ?? null,
      created_at: row.created_at ?? null,
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
        last_dr_test: scalar(row.last_dr_test),
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
        budget_lines_count: count('budget_lines_count'),
        contracts_count: count('contracts_count'),
        suites_count: numericScalar(row.suites_count),
        components_count: numericScalar(row.components_count),
        ...vulnerabilityCountsMetadata(row),
      },
    });
  }

  /**
   * A budget line of either nature, in the native shape of the unified list: `product_name` is
   * the title, `description` the description, and `nature` says which nature the line is.
   */
  private mapBudgetLine(row: any, registry: AiEntityFilterRegistry, consolidation?: Map<string, string | null>): AiEntitySummaryDto {
    const anchorYear = new Date().getFullYear();
    const summary = row.description
      ?? ([row.supplier_name, row.paying_company_name, row.account_display].filter(Boolean).join(' | ') || null);
    return toEntitySummary('budget_lines', {
      id: row.id,
      reference: row.reference,
      item_number: row.item_number ?? null,
      label: row.product_name || (row.nature === 'capex' ? 'Untitled CAPEX line' : 'Untitled OPEX line'),
      status: row.status ?? null,
      summary,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        nature: scalar(row.nature),
        ...budgetItemMetadata(row, registry, consolidation),
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
      created_at: row.created_at ?? null,
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
      created_at: row.created_at ?? null,
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
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        axis: axis ? analyticsAxisLabel(axis) : null,
        axis_code: axis ? axis.code : null,
        applies_to: scalar(row.applies_to),
        // The value's position in its dimension (the manual order).
        sort_order: numericScalar(row.sort_order),
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
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        owner: scalar(row.owner_name),
        primary_category: scalar(row.primary_category_name),
        categories: scalar(Array.isArray(row.categories) ? row.categories.map((item: any) => item.name).join(', ') : null),
        is_default: row.is_default == null ? null : Boolean(row.is_default),
      },
    });
  }

  /**
   * A contract as the Contracts list shows it, with its current term (`contract-terms.ts`): state,
   * next due date, cancellation deadline. `coveredApplications` is the line of the applications it
   * covers when the caller reads them (`coveredApplicationsOf`); null otherwise.
   */
  private mapContract(row: any, coveredApplications: string | null = null): AiEntitySummaryDto {
    const companyName = row.company?.name ?? row.company_name ?? null;
    const supplierName = row.supplier?.name ?? row.supplier_name ?? null;
    const summary = row.notes ?? ([companyName, supplierName].filter(Boolean).join(' | ') || null);
    return toEntitySummary('contracts', {
      id: row.id,
      label: row.name,
      status: row.status ?? null,
      summary,
      created_at: row.created_at ?? null,
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
        owner: scalar(row.owner_name),
        term_state: scalar(row.term_state),
        // The number of the term in progress (1 for the first), counted here: a model got it one off.
        current_term_number: row.term_index == null ? null : Number(row.term_index) + 1,
        next_due_date: scalar(row.next_due_date),
        renewed: row.renewed == null ? null : Boolean(row.renewed),
        current_term_end: scalar(row.current_term_end),
        end_date: scalar(row.end_date),
        cancellation_deadline: scalar(row.cancellation_deadline),
        covered_applications: coveredApplications,
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
      created_at: row.created_at ?? null,
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
        turnover_currency: scalar(row.base_currency),
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
      created_at: row.created_at ?? null,
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
      created_at: row.created_at ?? null,
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
      created_at: row.created_at ?? null,
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
      reference: row.asset_reference ?? null,
      label: row.name,
      status: row.status ?? null,
      summary: row.fqdn ?? row.hostname ?? row.notes ?? null,
      created_at: row.created_at ?? null,
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
        admin_zone: scalar(row.admin_zone),
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
        ...vulnerabilityCountsMetadata(row),
      },
    });
  }

  /**
   * A vulnerability row as listed: the CVE id as label and reference (one CVE can have a row per
   * technology version), the technology by reference and name. No id of another record.
   */
  private mapVulnerability(row: AiVulnerabilityRow): AiEntitySummaryDto {
    return toEntitySummary('vulnerabilities', {
      id: row.id,
      reference: row.cve_id,
      label: row.cve_id,
      status: row.state,
      summary: row.summary,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: {
        severity: scalar(row.severity),
        cvss_score: numericScalar(row.cvss_score),
        score_source: scalar(row.score_source),
        exploited: row.exploited,
        epss: numericScalar(row.epss),
        state: row.state,
        note: scalar(clipSummary(row.note)),
        technology: row.technology,
        technology_name: row.technology_name,
        version: scalar(row.version),
        sources: row.sources.join(', '),
        alerts: row.alerts,
        estate: row.estate,
        matching: row.matching,
        published_at: scalar(row.published_at),
        detected_at: scalar(row.detected_at),
        servers_reached: row.servers_reached,
        applications_reached: numericScalar(row.applications_reached),
        page_url: row.page_url,
      },
    });
  }

  /** A technology as listed: business references and names only. */
  private mapTechnology(row: AiTechnologyRow): AiEntitySummaryDto {
    return toEntitySummary('technologies', {
      id: row.id,
      reference: row.reference,
      label: row.name,
      status: row.lifecycle ?? null,
      summary: row.description ?? null,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        family: scalar(row.family),
        publisher: scalar(row.editor),
        hosting_type: scalar(row.hosting_type),
        lifecycle: scalar(row.lifecycle),
        admin_zone: scalar(row.admin_zone),
        server_count: numericScalar(row.server_count),
        application_count: numericScalar(row.application_count),
        support_status: scalar(row.support_status),
        end_of_standard_support: scalar(row.end_of_standard_support),
        end_of_support: scalar(row.end_of_support),
        versions_in_use: scalar(row.versions_in_use),
        open_vulnerabilities: numericScalar(row.open_vulnerabilities),
      },
    });
  }

  /**
   * A technology version as listed: the technology's reference and name, the label, the support
   * dates and state, whether it is in use, and its servers and the version's applications. Its
   * line label is the technology and the version ("PostgreSQL 16"); it has no reference of its
   * own: `ref` is its technology's (`TEC-n`).
   */
  private mapTechnologyVersion(row: AiTechnologyVersionRow): AiEntitySummaryDto {
    return toEntitySummary('technology_versions', {
      id: row.id,
      reference: row.technology,
      label: row.label ? `${row.technology_name} ${row.label}` : row.technology_name,
      status: row.support_status,
      created_at: row.created_at ?? null,
      updated_at: row.updated_at ?? null,
      metadata: {
        technology: row.technology,
        technology_name: row.technology_name,
        label: row.label,
        end_of_standard_support: scalar(row.end_of_standard_support),
        end_of_support: scalar(row.end_of_support),
        support_status: scalar(row.support_status),
        support_date: scalar(row.support_date),
        in_use: row.in_use,
        server_count: numericScalar(row.server_count),
        application_count: numericScalar(row.application_count),
        family: scalar(row.family),
        lifecycle: scalar(row.lifecycle),
      },
    });
  }

  /**
   * A record to complete of the End of support report: its gap, its subject (business reference
   * where the record has one, its name otherwise) and the other end of a link. No identifier: the
   * subject is read through its own family, by `subject`.
   */
  private mapSupportGap(row: AiSupportGapRow): AiEntitySummaryDto {
    return toEntitySummary('support_gaps', {
      id: row.key,
      reference: row.subject_reference ?? null,
      label: row.subject_name,
      status: row.gap,
      created_at: null,
      updated_at: null,
      metadata: {
        gap: row.gap,
        subject_type: row.subject_type,
        subject: row.subject_reference ?? row.subject_name,
        subject_name: row.subject_name,
        related: row.related_reference ?? row.related_name,
        related_name: row.related_name,
        related_type: row.related_type,
        version: scalar(row.version),
      },
    });
  }

  /** A role of Admin › Roles: its name, kind and count of people (never their names). */
  private mapRole(row: AiRoleRow): AiEntitySummaryDto {
    return toEntitySummary('roles', {
      id: row.id,
      label: row.name,
      status: row.type,
      summary: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: {
        name: row.name,
        type: row.type,
        user_count: row.user_count,
      },
    });
  }

  /**
   * A right a role gives, at the level the Roles screen shows, with the screen's words for the right
   * and the level in the person's language (`language`; null: the four languages).
   */
  private mapRolePermission(row: AiRolePermissionRow, language: AiScreenLanguage | null): AiEntitySummaryDto {
    const resourceLabel = aiResourceLabel(row.resource, language);
    return toEntitySummary('role_permissions', {
      id: row.key,
      label: `${row.role}: ${resourceLabel ?? row.resource}`,
      status: row.level,
      created_at: null,
      updated_at: null,
      metadata: {
        role: row.role,
        role_type: row.role_type,
        resource: row.resource,
        resource_label: resourceLabel,
        level: row.level,
        level_label: aiPermissionLevelLabel(row.level, language),
      },
    });
  }

  /**
   * A row of Admin › Data access: a person in limited access and one of their nodes, or no node.
   * The person names the row (`id` is theirs); no email.
   */
  private mapDataAccess(row: AiDataAccessRow): AiEntitySummaryDto {
    const where = row.node_type === null
      ? 'no node'
      : row.node_type === 'all' ? 'all data' : row.node ?? '';
    return toEntitySummary('data_access', {
      id: row.person_id,
      label: `${row.person}: ${where}`,
      status: row.access,
      summary: row.node_type === null ? AI_DATA_ACCESS_NO_NODE_NOTE : null,
      created_at: null,
      updated_at: row.changed_at,
      metadata: {
        person: row.person,
        roles: row.roles.join(', '),
        node_type: row.node_type,
        node: row.node,
        node_code: row.node_code,
        node_kind: row.node_kind,
        access: row.access,
        changed_at: row.changed_at,
        changed_by: row.changed_by,
      },
    });
  }

  /** A row of the global chargeback: a company, or one of its departments, named by both. */
  private mapChargeback(row: AiChargebackRow): AiEntitySummaryDto {
    return toEntitySummary('chargeback', {
      // Distinct per row: a company's row and its common costs share the company.
      id: chargebackRowId(row),
      label: chargebackRowLabel(row),
      status: row.level,
      summary: null,
      created_at: null,
      updated_at: null,
      metadata: {
        level: row.level,
        company: row.company,
        department: row.department,
        nature: row.nature,
        amount: row.amount,
        share: row.share,
        headcount: row.headcount,
        cost_per_user: row.cost_per_user,
        ...(row.level === 'company' ? {
          paid: row.paid,
          net: row.net,
          it_users: row.it_users,
          turnover: row.turnover,
          cost_per_it_user: row.cost_per_it_user,
          cost_vs_turnover_pct: row.cost_vs_turnover_pct,
        } : {}),
      },
    });
  }

  /**
   * A line charged to the company of the report. A line the person does not read keeps no id: its
   * BL reference and title name it, as the screen's line column, and it opens nothing.
   */
  private mapChargebackLine(row: AiChargebackLineRow): AiEntitySummaryDto {
    return toEntitySummary('chargeback_lines', {
      id: row.item_id ?? row.ref ?? row.key,
      reference: row.ref,
      label: row.line ?? row.ref ?? 'line outside your access',
      status: row.allocation_method,
      summary: null,
      created_at: null,
      updated_at: null,
      metadata: {
        nature: row.nature,
        allocation_method: row.allocation_method,
        amount: row.amount,
        share_pct: row.share_pct,
        readable: row.readable,
        ...(row.paying_company !== undefined ? {
          paying_company: row.paying_company,
          allocation_pct: row.allocation_pct ?? null,
          departments: (row.departments ?? []).join(', ') || null,
        } : {}),
      },
    });
  }

  /** A working-day calendar of Master data, `ref` its code; with a year, its source and exact total. */
  private mapWorkingDayCalendar(row: AiWorkingDayCalendarRow): AiEntitySummaryDto {
    return toEntitySummary('working_day_calendars', {
      id: row.id,
      reference: row.code,
      label: row.name,
      status: row.status,
      summary: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: {
        code: row.code,
        name: row.name,
        kind: row.kind,
        country: row.country,
        country_code: row.country_code,
        region: row.region,
        region_code: row.region_code,
        disabled_at: row.disabled_at,
        years_edited: row.years_edited.join(', ') || null,
        ...(row.year != null ? { year: row.year, source: row.source, total_days: row.total_days } : {}),
      },
    });
  }

  /** An analytics dimension of Master data, `ref` its code, with its settings and its budget_lines field. */
  private mapAnalyticsAxis(row: AiAnalyticsAxisRow): AiEntitySummaryDto {
    return toEntitySummary('analytics_axes', {
      id: row.id,
      reference: row.code,
      label: row.name,
      status: row.status,
      summary: row.description,
      created_at: row.created_at,
      updated_at: row.updated_at,
      metadata: {
        code: row.code,
        name: row.name,
        is_default: row.is_default,
        applies_to: row.applies_to,
        required: row.required,
        required_for: row.required_for.join(', ') || null,
        open_values: row.open_values,
        disabled_at: row.disabled_at,
        sort_order: row.sort_order,
        field: row.field,
      },
    });
  }

  /**
   * The services of Master data › Working-day calendars and Analytics dimensions, read with the
   * right of their page: checked again here, the database not guarding it, refused in words (the
   * right and the screen).
   */
  private async workingDayCalendarServices(context: AiExecutionContextWithManager, year?: number | null) {
    if (!this.policy || !this.workingDayProfiles) throw new BadRequestException('The working-day calendars are not available.');
    await this.policy.assertEntityTypeReadRight(context, 'working_day_calendars', context.manager);
    const language = await readAiScreenLanguage(context.manager, context.tenantId, context.userId);
    const opts: AiWorkingDayCalendarOpts = {
      manager: context.manager,
      tenantId: context.tenantId,
      userId: context.userId,
      lang: language ?? 'en',
      year: year ?? null,
    };
    return { services: { calendars: this.workingDayProfiles }, opts };
  }

  private async analyticsAxesServices(context: AiExecutionContextWithManager) {
    if (!this.policy || !this.analyticsAxes) throw new BadRequestException('The analytics dimensions are not available.');
    await this.policy.assertEntityTypeReadRight(context, 'analytics_axes', context.manager);
    const language = await readAiScreenLanguage(context.manager, context.tenantId, context.userId);
    return {
      services: { axes: this.analyticsAxes },
      opts: { manager: context.manager, tenantId: context.tenantId, userId: context.userId, language },
    };
  }

  /**
   * The chargeback reports, read with the reporting right as their routes: checked again here, the
   * database not guarding it, refused in words (the right and the screen).
   */
  private async chargebackServices(context: AiExecutionContextWithManager, entityType: 'chargeback' | 'chargeback_lines') {
    if (!this.policy || !this.chargeback) throw new BadRequestException('The chargeback reports are not available.');
    await this.policy.assertEntityTypeReadRight(context, entityType, context.manager);
    return { chargeback: this.chargeback };
  }

  /**
   * The tree of cost centers, read with the right of its page as its route: checked again here,
   * the database not guarding it, refused in words (the right and the screen).
   */
  private async costCenterServices(context: AiExecutionContextWithManager) {
    if (!this.policy || !this.costCenters) throw new BadRequestException('The cost centers are not available.');
    await this.policy.assertEntityTypeReadRight(context, 'cost_centers', context.manager);
    return { services: { costCenters: this.costCenters }, opts: { manager: context.manager, tenantId: context.tenantId } };
  }

  /** A node of the tree of cost centers: its code is its reference, its name its label; no person id. */
  private mapCostCenter(row: AiCostCenterRow): AiEntitySummaryDto {
    return toEntitySummary('cost_centers', {
      id: row.id,
      reference: row.code,
      label: row.name,
      status: row.status,
      summary: null,
      created_at: null,
      updated_at: null,
      metadata: {
        code: row.code,
        name: row.name,
        kind: row.kind,
        parent: row.parent,
        parent_code: row.parent_code,
        company: row.company,
        budget_holder: row.budget_holder,
        status: row.status,
        depth: row.depth,
        path: row.path,
        children: row.children,
        disabled_at: row.disabled_at,
        ...(row.matched_on ? { matched_on: row.matched_on } : {}),
      },
    });
  }

  /**
   * Whether the caller reads Admin › Data access: users at admin level and access not limited, the
   * family's gate (`AiPolicyService`). The database does not protect the nodes: every read of them
   * (the family, the users fields, the person and company blocks) passes here. Closed without the
   * policy or the service.
   */
  private async dataAccessView(context: AiExecutionContextWithManager): Promise<boolean> {
    if (!this.dataAccess) return false;
    return (await this.policy?.canReadEntityType(context, 'data_access', context.manager)) === true;
  }

  /**
   * A person's access as the Data access tab of their dialog shows it (`GET /users/:id/data-access`):
   * the mode, the nodes with their level, who changed it last, the cost centers they own. Missing
   * parts of the function in the screen's words.
   */
  private personAccessBlock(access: Awaited<ReturnType<DataAccessAdminService['personAccess']>>): Record<string, unknown> {
    const nodes = access.nodes.map((node) => {
      if (node.type === 'all') return { type: 'all', access: node.access };
      if (node.type === 'company') return { type: 'company', name: node.name ?? AI_DATA_ACCESS_DELETED_NODE, access: node.access };
      const name = [node.code, node.name].filter((part) => !!part && String(part).trim()).join(' ');
      return { type: 'cost_center', kind: node.kind, code: node.code, name: name || AI_DATA_ACCESS_DELETED_NODE, access: node.access };
    });
    const note = access.is_administrator
      ? 'Administrator: sees all data, whatever is stored.'
      : access.mode === 'all'
        ? 'Sees all budget and contract data.'
        : nodes.length === 0
          ? AI_DATA_ACCESS_NO_NODE_NOTE
          : 'Limited to these nodes: a company node covers the company and the cost centers of that company; a group node covers the group, its sub-groups and their cost centers, whatever their company; a cost center node covers that cost center only; all covers everything. Edit includes read. The person also always sees what they are named on.';
    return {
      mode: access.mode,
      is_administrator: access.is_administrator,
      nodes,
      updated_at: access.updated_at,
      updated_by_name: access.updated_by_name,
      budget_owner_centers: access.budget_owner_centers.map((center) => ({ code: center.code, name: center.name })),
      available: access.available,
      ...(access.available ? {} : { unavailable_note: AI_DATA_ACCESS_UNAVAILABLE_NOTE }),
      note,
      coverage_note: AI_DATA_ACCESS_COVERAGE_NOTE,
    };
  }

  /**
   * Who sees a company, as its Access tab (`GET /companies/:id/data-access`): `full`, the people in
   * limited access with an `all` node or a node on the company (by the most direct one), and
   * `partial`, those whose cost center or group node covers a part of it. People whose access is
   * not limited see it whole and are not listed.
   */
  private companyAccessBlock(access: Awaited<ReturnType<DataAccessAdminService['companyAccess']>>): Record<string, unknown> {
    return {
      full: access.full.map((entry) => ({
        person: entry.person.name,
        via: entry.via.type === 'all' ? 'all data' : entry.via.name ?? AI_DATA_ACCESS_DELETED_NODE,
        via_type: entry.via.type,
        access: entry.access,
      })),
      partial: access.partial.map((entry) => ({
        person: entry.person.name,
        via: [entry.via.code, entry.via.name].filter((part) => !!part && String(part).trim()).join(' ') || AI_DATA_ACCESS_DELETED_NODE,
        via_type: entry.via.type,
        access: entry.access,
      })),
      note: 'Only people in limited access are listed: everyone else sees the whole company. full: a node on all data or on this company; partial: a node on a cost center or group that covers a part of it. Who has a node on one cost center: query_entities on data_access filtered on node_code; what a cost center inherits is on its Access tab in KANAP.',
      coverage_note: AI_DATA_ACCESS_COVERAGE_NOTE,
    };
  }

  /** The services the two role families read; refused without them, never an empty list. */
  private rolesServices(): AiRolesServices {
    if (!this.roles || !this.permissions) throw new BadRequestException('The roles are not available.');
    return { roles: this.roles, permissions: this.permissions };
  }

  /**
   * The roles and their rights, checked again here though the tool checked them, as the data access
   * branch: users at admin level and access not limited, refused in the policy's words (the right
   * and the screen, or the reserved message). Closed without the policy.
   */
  private async assertRolesRead(context: AiExecutionContextWithManager, entityType: 'roles' | 'role_permissions'): Promise<void> {
    if (!this.policy) throw new ForbiddenException('The roles are not available.');
    await this.policy.assertEntityTypeReadRight(context, entityType, context.manager);
  }

  /**
   * The names of at most ten servers or applications, then the rest counted: a card never carries
   * an unbounded list, and an empty count is "not read", never "none".
   */
  private namesText(items: Array<{ name: string }> | null | undefined, noun: 'server' | 'application'): string | null {
    if (!items?.length) return null;
    const shown = items.slice(0, 10).map((item) => item.name);
    const rest = items.length - shown.length;
    return rest > 0 ? `${shown.join(', ')}, and ${rest} other ${noun}${rest === 1 ? '' : 's'}` : shown.join(', ');
  }

  /**
   * A deadline of the End of support report: its subject and type, the version, the date and the
   * state, the recorded ends, and the servers and applications by name (the service keeps the
   * caller's application scope). No identifier: the subject is read through its own family.
   */
  private mapSupportDeadline(row: DeadlineRow): AiEntitySummaryDto {
    return toEntitySummary('support_deadlines', {
      id: row.key,
      reference: row.item_reference ?? null,
      label: row.version ? `${row.item_name} ${row.version}` : row.item_name,
      status: row.state,
      created_at: null,
      updated_at: null,
      metadata: {
        subject_type: row.type,
        subject: row.item_reference ?? row.item_name,
        subject_name: row.item_name,
        version: scalar(row.version),
        date: row.date,
        state: row.state,
        milestone: scalar(row.milestone),
        standard_support_end: scalar(row.standard_support_end),
        extended_support_end: scalar(row.extended_support_end),
        server_count: numericScalar(row.server_count),
        servers: this.namesText(row.servers, 'server'),
        application_count: numericScalar(row.application_count),
        applications: this.namesText(row.applications, 'application'),
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
      label: `${row.code} · ${row.name}`,
      status: null,
      summary: [row.city, row.country_iso].filter(Boolean).join(', ') || null,
      created_at: row.created_at ?? null,
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
      created_at: row.created_at ?? null,
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
      created_at: row.created_at ?? null,
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

  /**
   * A user as the users list shows them: every column to an administrator of users whose own access
   * is not limited, name, email and status to anyone else (`adminView` false), as the screen does. The roles and the data-access mode
   * (`accessView`) only to an administrator of users whose own access is not limited, as the
   * list's Access column.
   */
  private mapUser(row: any, adminView: boolean, accessView = false): AiEntitySummaryDto {
    const label = displayName(row) ?? row.email ?? 'Unknown user';
    if (!adminView) {
      return toEntitySummary('users', {
        id: row.id,
        label,
        status: row.status ?? null,
        summary: label === row.email || typeof row.email !== 'string' ? null : row.email,
        created_at: null,
        updated_at: null,
        metadata: {
          email: scalar(row.email),
          first_name: scalar(row.first_name),
          last_name: scalar(row.last_name),
        },
      });
    }
    const summary = label === row.email
      ? ([row.job_title, row.team_name, row.company_name].filter(Boolean).join(' | ') || null)
      : ([row.email, row.job_title, row.team_name, row.company_name].filter(Boolean).join(' | ') || null);
    return toEntitySummary('users', {
      id: row.id,
      label,
      status: row.status ?? null,
      summary,
      created_at: row.created_at ?? null,
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
        ...(accessView
          ? {
            roles: Array.isArray(row.roles) ? row.roles.join(', ') : null,
            data_access: scalar(row.data_access),
          }
          : {}),
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
      created_at: row.created_at ?? null,
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
        resolution_hours: numericScalar(row.resolution_hours),
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
      created_at: row.created_at ?? null,
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
    const registry = await resolveAiEntityRegistry(context, input.entity_type, this.readProbe(context));
    const sort = resolveAiQuerySort(registry, input.sort);
    const result = await this.executeQuery(context, input, registry, sort);
    const requestedLimit = Math.floor(Number(input.limit));
    // Neither a reduced page size nor an unknown sort field passes silently.
    const limitCapped = Number.isFinite(requestedLimit) && requestedLimit > result.limit
      ? { limit_capped: { requested: requestedLimit, applied: result.limit } }
      : {};
    const amounts = await aiAmountsCurrency(context, input.entity_type);
    const dataAccess = await aiDataAccessNote(context, input.entity_type);
    if (!sort.ignored.length) return { ...result, sort: sort.applied, sort_ignored: [], ...limitCapped, ...amounts, ...dataAccess };
    // The items come in the default order, said so; a field withheld for lack of a right says why.
    const withheld = (registry.withheldFields ?? []).filter((entry) => sort.ignored.includes(entry.field));
    return {
      ...result,
      complete: false,
      sort: sort.applied,
      sort_ignored: sort.ignored,
      ...(withheld.length ? { fields_withheld: withheld } : {}),
      sortable_fields: Object.keys(registry.sortFields),
      ...limitCapped,
      ...amounts,
      ...dataAccess,
    };
  }

  /** The totals of every line the query keeps (`amount_totals`) and of the page returned (`page_amount_totals`). */
  private async budgetTotals(
    context: AiExecutionContextWithManager,
    query: Record<string, any>,
    records: number,
    rows: any[],
    anchorYear: number,
    named: string[],
    access: BudgetListAccess,
  ): Promise<{ amount_totals: AiAmountTotals; page_amount_totals: AiAmountTotals }> {
    const amountTotals = await this.budgetAmountTotals(context, query, records, access);
    const pageTotals = budgetPageAmountTotals(rows, anchorYear, amountTotals.currency);
    // The line totals (staff cost and FTE, day cost, days) of every line kept, and of the page's lines:
    // the five columns of the current year and the years and columns the filters or the sort name
    // (each year read costs a statement's worth of joins; aggregate_entities sums any other).
    const pairs = new Set(SUMMARY_COLUMNS.map((column) => `y_${column.ai}`));
    for (const key of named) {
      const pair = budgetPairOfKey(key);
      if (pair) pairs.add(pair);
    }
    const { page: _page, limit: _limit, sort: _sort, years: _years, ...listState } = query;
    const ids = rows.map((row) => row?.id).filter((id): id is string => typeof id === 'string');
    // One after the other: both read on the request's connection.
    const all = await this.budgetLineTotals(context, listState, pairs, access);
    // A page that holds every line kept sums as all of them: no second statement.
    let page = all;
    if (ids.length !== records) {
      page = ids.length
        ? await this.budgetLineTotals(context, { ...listState, filters: { ...(listState.filters ?? {}), id: { filterType: 'set', values: ids } } }, pairs, access)
        : Object.fromEntries(budgetLineTotalFieldsOf(pairs).map((field) => [field.ai, isBudgetMoneyKey(field.ai) ? 0 : null]));
    }
    const note = ' The staff cost, staff FTE, day cost and days (`<year>_<column>_staff_cost`...) are summed for the current year\'s columns '
      + 'and the years and columns the filters or the sort name; aggregate_entities sums the others. '
      + 'A cost per FTE or a day rate comes from aggregate_entities (`<year>_<column>_cost_per_fte`, `_day_rate`), never from dividing these totals.';
    amountTotals.values = { ...amountTotals.values, ...all };
    amountTotals.note += note;
    pageTotals.values = { ...pageTotals.values, ...page };
    pageTotals.note += note;
    return { amount_totals: amountTotals, page_amount_totals: pageTotals };
  }

  /**
   * The line totals of every line of a list state (`<slot>_<column>_<total>`: staff cost, staff FTE,
   * day cost, days), summed by the list engine as the "Cost per FTE" report sums them: amounts exact
   * to the cent in the reporting currency (0 without line detail), FTE and days null when no line has one.
   */
  private async budgetLineTotals(
    context: AiExecutionContextWithManager,
    listState: Record<string, any>,
    pairs: ReadonlySet<string>,
    access: BudgetListAccess,
  ): Promise<Record<string, number | null>> {
    const fields = budgetLineTotalFieldsOf(pairs);
    const values: Record<string, number | null> = {};
    // One statement per 50 sums: the engine takes at most 60 measures without group keys.
    for (let start = 0; start < fields.length; start += 50) {
      const chunk = fields.slice(start, start + 50);
      const result = await this.budgetLines.summaryAggregate(
        listState,
        { groupBy: [], measures: chunk.map((field, i) => ({ id: `m${i}`, fn: 'sum' as const, field: field.grid })) },
        { manager: context.manager, access },
      );
      chunk.forEach((field, i) => {
        const value = result.total.values[`m${i}`] ?? null;
        values[field.ai] = value == null && isBudgetMoneyKey(field.ai) ? 0 : value;
      });
    }
    return values;
  }

  /**
   * The consolidation account of each line of `rows`, as the list engine labels it for the
   * Consolidation accounts report (`account_consolidation_label`: one label per consolidation
   * number, null without one), in one statement on their ids. Nothing when the registry holds no
   * such field (a person who does not read the accounts).
   */
  private async consolidationLabels(
    context: AiExecutionContextWithManager,
    rows: any[],
    registry: AiEntityFilterRegistry,
    access: BudgetListAccess,
  ): Promise<Map<string, string | null> | undefined> {
    if (!registry.fields.consolidation_account) return undefined;
    const ids = rows.map((row) => row?.id).filter((id): id is string => typeof id === 'string');
    if (!ids.length) return new Map();
    const result = await this.budgetLines.summaryAggregate(
      { filters: { id: { filterType: 'set', values: ids } }, includeDisabled: true },
      { groupBy: ['id', registry.fields.consolidation_account.grid], measures: [] },
      { manager: context.manager, access },
    );
    return new Map(result.groups.map((group: { keys: Array<string | null> }) => [String(group.keys[0]), group.keys[1] ?? null]));
  }

  /**
   * The consolidation accounts of the tenant's budget lines (every line, as the other values), in
   * text order with null (a line without one) last: one aggregate statement grouped by the label.
   */
  private async consolidationValues(
    context: AiExecutionContextWithManager,
    grid: string,
    access: BudgetListAccess,
  ): Promise<Array<string | null>> {
    const result = await this.budgetLines.summaryAggregate(
      { includeDisabled: true },
      { groupBy: [grid], measures: [] },
      { manager: context.manager, access },
    );
    return result.groups.map((group: { keys: Array<string | null> }) => group.keys[0] ?? null).sort(compareNullableText);
  }

  /**
   * The amounts of every budget line the query keeps, all pages, as the list footer computes them
   * (`summaryTotals`, same filters and quick search): the total an answer quotes.
   */
  private async budgetAmountTotals(
    context: AiExecutionContextWithManager,
    query: Record<string, any>,
    records: number,
    access: BudgetListAccess,
  ): Promise<AiAmountTotals> {
    const { page: _page, limit: _limit, sort: _sort, years: _years, ...listState } = query;
    const totals: any = await this.budgetLines.summaryTotals(listState, { manager: context.manager, access });
    const values: Record<string, number> = {};
    for (const slot of FIXED_SLOTS) {
      for (const column of SUMMARY_COLUMNS) values[`${slot.ai}_${column.ai}`] = Number(totals?.[`${slot.key}${column.suffix}`] ?? 0);
    }
    const currency = typeof totals?.reportingCurrency === 'string' ? totals.reportingCurrency : null;
    const fxMissing = Array.isArray(totals?.fxMissing) ? totals.fxMissing : [];
    return {
      records,
      currency,
      values,
      ...(fxMissing.length ? { fx_missing: fxMissing } : {}),
      note: `Each amount field summed over the ${records} lines the filters keep (every page, not only the items returned), in ${currency ?? 'the reporting currency'}, by the server. `
        + 'A total in the answer is quoted from here (or from aggregate_entities on the same filters), never added up from the items.'
        + (fxMissing.length ? ' The amounts of the lines listed in fx_missing have no rate and are left out: say so.' : ''),
    };
  }

  /** The yearly amounts of every contract the query keeps, all pages, summed per currency. */
  private async contractAmountTotals(context: AiExecutionContextWithManager, query: Record<string, any>, records: number): Promise<AiAmountTotals> {
    const { ids } = await this.contracts.listIds(
      { q: query.q, filters: query.filters, includeDisabled: true, limit: 10_000 },
      { manager: context.manager, coveredApplications: { scope: await resolveAiParticipationAccessScope(context, 'applications') } },
    );
    const rows: Array<{ currency: string | null; total: string | null; contracts: number; without_amount: number }> = ids?.length
      ? await context.manager.query(
        `SELECT c.currency, sum(c.yearly_amount_at_signature)::text AS total, count(*)::int AS contracts,
                count(*) FILTER (WHERE c.yearly_amount_at_signature IS NULL)::int AS without_amount
         FROM contracts c
         WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])
         GROUP BY c.currency
         ORDER BY c.currency NULLS LAST`,
        [context.tenantId, ids],
      )
      : [];
    return {
      records,
      currency: null,
      by_currency: rows.map((row) => ({
        currency: row.currency,
        yearly_amount: row.total == null ? null : Number(row.total),
        contracts: Number(row.contracts),
        without_amount: Number(row.without_amount),
      })),
      note: `The yearly amounts of the ${records} contracts the filters keep (every page, not only the items returned), summed per contract currency by the server. `
        + 'Amounts in different currencies do not add up. A total in the answer is quoted from here (or from aggregate_entities), never added up from the items.'
        // The ids stop at 10,000 (`listIds`): a larger selection is summed in part, said so.
        + ((ids?.length ?? 0) < records ? ` Only ${ids?.length ?? 0} of the ${records} contracts are summed: say that the total is partial.` : ''),
    };
  }

  private async executeQuery(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiQueryEntityType;
      filters?: Record<string, AiFilterValue>;
      q?: string;
      year?: number;
      page?: number;
      limit?: number;
      scope?: AiQueryScope;
    },
    registry: AiEntityFilterRegistry,
    sort: AiResolvedSort,
  ): Promise<AiQueryResult> {
    const { query, filtersApplied, filtersIgnored, adapted } = await this.buildBaseQuery(context, input.entity_type, registry, input, sort);
    const page = Number(query.page) || 1;
    const limit = Number(query.limit);
    if (filtersIgnored.length > 0) {
      const refusal = invalidFilterResult(registry, adapted);
      return {
        status: refusal.status,
        items: [],
        total: 0,
        page,
        limit,
        returned: 0,
        truncated: false,
        complete: false,
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        suggested_repairs: refusal.suggested_repairs,
        ...(refusal.invalid_filter_values ? { invalid_filter_values: refusal.invalid_filter_values } : {}),
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
        viewer: await resolveAiIncidentViewer(context),
        linkedReads: await this.linkedReads(context),
        linkedScopes: await this.taskLinkedScopes(context),
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
        items: (result.items || []).map((row: any) => this.mapApplication(row, registry)),
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

    if (input.entity_type === 'budget_lines') {
      const anchorYear = new Date().getFullYear();
      // The person's access, as the screen passes it, to every engine call of the list.
      const access = await aiBudgetListAccess(this.policy, context);
      const result = await this.budgetLines.summary(
        {
          ...scoped.query,
          years: budgetQueryYears(anchorYear).join(','),
        },
        { manager: context.manager, access },
      );
      const consolidation = await this.consolidationLabels(context, result.items || [], registry, access);
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      // The list has no cap: the total is every matching line of either nature.
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapBudgetLine(row, registry, consolidation)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        ...await this.budgetTotals(context, scoped.query, result.total ?? 0, result.items || [], anchorYear, [...Object.keys(input.filters ?? {}), sort.applied.field], access),
        scope: null,
      };
    }

    if (input.entity_type === 'contracts') {
      // The `application` filter matches a Business Contributor's applications only, as `covered_applications`.
      const result = await this.contracts.list(scoped.query, {
        manager: context.manager,
        coveredApplications: { scope: await resolveAiParticipationAccessScope(context, 'applications') },
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      const covered = await this.coveredApplicationsOf(context, (result.items || []).map((row: any) => String(row.id)));
      return {
        items: (result.items || []).map((row: any) => this.mapContract(row, covered ? covered.get(String(row.id)) ?? '' : null)),
        total: result.total ?? 0,
        page: resultPage,
        limit: resultLimit,
        returned,
        truncated,
        complete: isCompleteQueryResult(resultPage, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        amount_totals: await this.contractAmountTotals(context, scoped.query, result.total ?? 0),
        page_amount_totals: contractPageAmountTotals(result.items || []),
        scope: null,
      };
    }

    if (input.entity_type === 'incidents') {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      const reads = this.readProbe(context);
      const readsApplications = await reads('applications');
      const result = await this.incidents.list(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        viewer,
        // The linked counts and filters, each on its module's read (null otherwise), as on the
        // incidents list; the application filter and values follow a Business Contributor's scope.
        technologies: await reads('technologies'),
        applications: readsApplications,
        applicationScope: readsApplications
          ? await resolveAiParticipationAccessScope(context, 'applications')
          : undefined,
      });
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

    if (input.entity_type === 'technologies') {
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const result = await listAiTechnologies(context.manager, context.tenantId, scoped.query, applications);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        items: result.items.map((row) => this.mapTechnology(row)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'technology_versions') {
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const result = await listAiTechnologyVersions(context.manager, context.tenantId, scoped.query, applications);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        items: result.items.map((row) => this.mapTechnologyVersion(row)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'support_gaps' || input.entity_type === 'support_deadlines') {
      const service = this.endOfSupport;
      if (!service) throw new BadRequestException('The End of support report is not available.');
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const opts = { manager: context.manager, tenantId: context.tenantId, userId: context.userId };
      const result = input.entity_type === 'support_gaps'
        ? await listAiSupportGaps(service, opts, applications, scoped.query)
        : await listAiSupportDeadlines(service, opts, applications, scoped.query);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        applications_visible: result.applications_visible,
        ...(result.applications_visible ? {} : { applications_visible_note: APPLICATIONS_UNREAD_NOTE }),
        items: result.items.map((row) => (input.entity_type === 'support_gaps'
          ? this.mapSupportGap(row as AiSupportGapRow)
          : this.mapSupportDeadline(row as DeadlineRow))),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'roles' || input.entity_type === 'role_permissions') {
      await this.assertRolesRead(context, input.entity_type);
      const services = this.rolesServices();
      const result = input.entity_type === 'roles'
        ? await listAiRoles(services, context.manager, scoped.query)
        : await listAiRolePermissions(services, context.manager, scoped.query);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      // The words of the rights follow the person's menus; a list of roles names none.
      const language = input.entity_type === 'role_permissions'
        ? await readAiScreenLanguage(context.manager, context.tenantId, context.userId)
        : null;
      return {
        items: result.items.map((row) => (input.entity_type === 'roles'
          ? this.mapRole(row as AiRoleRow)
          : this.mapRolePermission(row as AiRolePermissionRow, language))),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'data_access') {
      // The tool already checked the family; checked again here, the database not guarding the nodes.
      if (!this.dataAccess || !(await this.dataAccessView(context))) throw new DataAccessReservedException();
      const result = await listAiDataAccess({ dataAccess: this.dataAccess }, context.manager, scoped.query);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        available: result.available,
        missing: result.missing,
        ...(result.available ? {} : { unavailable_note: AI_DATA_ACCESS_UNAVAILABLE_NOTE }),
        counters: result.counters,
        coverage_note: AI_DATA_ACCESS_COVERAGE_NOTE,
        items: result.items.map((row) => this.mapDataAccess(row)),
        total: result.total,
        distinct_total: result.distinct_total,
        distinct_label: 'person',
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'chargeback' || input.entity_type === 'chargeback_lines') {
      const services = await this.chargebackServices(context, input.entity_type);
      const opts = { manager: context.manager, tenantId: context.tenantId, year: input.year };
      const result: AiChargebackList<AiChargebackRow | AiChargebackLineRow> = input.entity_type === 'chargeback'
        ? await listAiChargeback(services, scoped.query, opts)
        : await listAiChargebackLines(services, scoped.query, opts);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        chargeback: result.report,
        items: result.items.map((row) => (input.entity_type === 'chargeback'
          ? this.mapChargeback(row as AiChargebackRow)
          : this.mapChargebackLine(row as AiChargebackLineRow))),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'cost_centers') {
      const { services, opts } = await this.costCenterServices(context);
      const result = await listAiCostCenters(services, opts, scoped.query);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        ...(result.unmatched_note ? { unmatched_note: result.unmatched_note } : {}),
        items: result.items.map((row) => this.mapCostCenter(row)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'working_day_calendars') {
      const { services, opts } = await this.workingDayCalendarServices(context, input.year);
      const result = await listAiWorkingDayCalendars(services, scoped.query, opts);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        calendar_year: result.year,
        calendar_note: result.year != null ? AI_CALENDAR_YEAR_NOTE : AI_CALENDAR_NO_YEAR_NOTE,
        items: result.items.map((row) => this.mapWorkingDayCalendar(row)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'analytics_axes') {
      const { services, opts } = await this.analyticsAxesServices(context);
      const result = await listAiAnalyticsAxes(services, scoped.query, opts);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        values_note: AI_AXIS_VALUES_NOTE,
        items: result.items.map((row) => this.mapAnalyticsAxis(row)),
        total: result.total,
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
        filters_applied: filtersApplied,
        filters_ignored: filtersIgnored,
        scope: null,
      };
    }

    if (input.entity_type === 'vulnerabilities') {
      const applications = await resolveAiApplicationsReach(context, this.policy);
      const result = await listAiVulnerabilities(context.manager, context.tenantId, scoped.query, applications);
      const returned = result.items.length;
      const truncated = result.total > ((result.page - 1) * result.limit + returned);
      return {
        items: result.items.map((row) => this.mapVulnerability(row)),
        total: result.total,
        // The rows and the distinct CVE among them, as the page's total.
        distinct_total: result.distinct_total,
        distinct_label: 'cve',
        feeds: await readAiVulnerabilityFeeds(context.manager),
        page: result.page,
        limit: result.limit,
        returned,
        truncated,
        complete: isCompleteQueryResult(result.page, truncated),
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
      const adminView = await this.usersAdminView(context);
      const accessView = adminView && await this.dataAccessView(context);
      const result = await this.users.listForAi(scoped.query, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessView,
      });
      const resultPage = result.page ?? page;
      const resultLimit = result.limit ?? limit;
      const returned = Array.isArray(result.items) ? result.items.length : 0;
      const truncated = (result.total ?? 0) > ((resultPage - 1) * resultLimit + returned);
      return {
        items: (result.items || []).map((row: any) => this.mapUser(row, adminView, accessView)),
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

  /** The record an `entity_id` names (uuid, reference or name), as get_entity_detail reads it; get_record_history reads it the same way. */
  async resolveDetailEntityId(
    context: AiExecutionContextWithManager,
    entityType: AiQueryEntityType,
    rawId: string,
  ): Promise<string> {
    const value = String(rawId || '').trim();
    if (!value) return value;
    if (entityType === 'budget_lines' && /^(?:BL|OPX|CPX)-\d+$/i.test(value)) {
      // `BudgetLinesService.get` resolves native and legacy references (both natures) before loading.
      return value;
    }
    if (entityType === 'documents' || entityType === 'vulnerabilities') {
      // A document and a vulnerability (a row id or a CVE id) are read by their own path.
      return value;
    }
    const resolved = await resolveAiEntityReference(context.manager, context.tenantId, entityType, value);
    if (resolved) return resolved;

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
    // Not a uuid and nothing matched: the services would cast it to uuid and
    // fail in Postgres, so answer with a plain "not found" instead.
    throw entityNotFound(entityType, value);
  }

  /** The person reads the budget: a project's or request's budget lines are named, else counted. */
  private async readsBudget(context: AiExecutionContextWithManager): Promise<boolean> {
    return (await this.policy?.canReadEntityType(context, 'budget_lines', context.manager)) === true;
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
      versionTable: 'spend_versions';
      amountTable: 'spend_amounts';
      itemColumn: 'spend_item_id';
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
    // The allocation as the Allocations tab shows it, not the stored percentages: those of an
    // automatic split are a copy from their last save (a split by turnover saved before the
    // turnovers were converted into the reporting currency is stale).
    const computed = await this.allocationCalculator.computeForVersions(versions as SpendVersion[], {
      manager: context.manager,
      tenantId: context.tenantId,
      suppressErrors: true,
    });
    const companyIds = new Set<string>();
    const departmentIds = new Set<string>();
    computed.forEach((entry) => entry.shares.forEach((share) => {
      if (share.company_id) companyIds.add(share.company_id);
      if (share.department_id) departmentIds.add(share.department_id);
    }));
    const names = async (table: 'companies' | 'departments', ids: Set<string>) => {
      if (ids.size === 0) return new Map<string, string>();
      const rows: Array<{ id: string; name: string }> = await context.manager.query(
        `SELECT id, name FROM ${table} WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
        [context.tenantId, Array.from(ids)],
      );
      return new Map(rows.map((row) => [row.id, row.name] as const));
    };
    const companyNames = await names('companies', companyIds);
    const departmentNames = await names('departments', departmentIds);

    const amountsByVersion = this.groupRowsByKey(amounts, 'version_id');
    return versions.map((version: any) => {
      const allocation = computed.get(version.id);
      const allocations = (allocation?.shares ?? [])
        .map((share) => ({
          id: share.allocation_id ?? null,
          version_id: version.id,
          company_id: share.company_id,
          company_name: companyNames.get(share.company_id) ?? null,
          department_id: share.department_id ?? null,
          department_name: share.department_id ? departmentNames.get(share.department_id) ?? null : null,
          allocation_pct: share.allocation_pct,
          source: share.source,
        }))
        .sort((a, b) => String(a.company_name ?? '').localeCompare(String(b.company_name ?? ''))
          || String(a.department_name ?? '').localeCompare(String(b.department_name ?? '')));
      return {
        ...version,
        amounts: amountsByVersion[version.id] ?? [],
        resolved_allocation_method: allocation?.resolvedMethod ?? null,
        allocation_warning: allocation?.error ?? (allocation?.warning ? describeAllocationWarning(allocation.warning) : null),
        allocations,
      };
    });
  }

  private async loadLinkedContacts(
    context: AiExecutionContextWithManager,
    params: {
      table: 'spend_item_contacts' | 'contract_contacts';
      foreignKey: 'spend_item_id' | 'contract_id';
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

  /**
   * The detail of one budget line, of either nature, read through `BudgetLinesService`: the
   * unified list row (native fields), the versions, contacts, links and attachments under their
   * native names (`spend_item_id`), and the linked records each on its module's read right.
   */
  private async loadBudgetLineDeepDetail(
    context: AiExecutionContextWithManager,
    lineId: string,
    nature: 'opex' | 'capex',
    registry: AiEntityFilterRegistry,
  ): Promise<Record<string, unknown>> {
    const anchorYear = new Date().getFullYear();
    const reads = await this.readableLinks(context);
    const [row] = await this.budgetLines.summaryRowsByIds(
      [lineId],
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
        itemColumn: 'spend_item_id',
        itemId: lineId,
      }),
      this.loadLinkedContacts(context, {
        table: 'spend_item_contacts',
        foreignKey: 'spend_item_id',
        id: lineId,
      }).catch(() => []),
      reads.applications ? this.budgetLines.listApplications(lineId, nature, { manager: context.manager }).catch(() => ({ items: [] })) : null,
      reads.projects ? this.budgetLines.listProjects(lineId, nature, { manager: context.manager }).catch(() => ({ items: [] })) : null,
      reads.contracts
        ? (nature === 'opex'
          ? this.contracts.listContractsForSpendItem(lineId, { manager: context.manager })
          : this.contracts.listContractsForCapexItem(lineId, { manager: context.manager })).catch(() => ({ items: [] }))
          .then(async (linked) => {
            if (!linked || linked.items.length === 0) return linked;
            const mismatches = await contractMismatchesAgainstLine(
              context.manager,
              context.tenantId,
              lineId,
              linked.items.map((row) => row.id),
            );
            return {
              items: linked.items.map((row) => ({ ...row, mismatches: mismatches?.get(row.id) ?? [] })),
            };
          })
        : null,
      this.budgetLines.listLinks(lineId, nature, { manager: context.manager }).catch(() => []),
      this.budgetLines.listAttachments(lineId, nature, { manager: context.manager }).catch(() => []),
    ]);

    return {
      ...(summary ?? {}),
      financial_summary: summary ?? null,
      financial_versions: financialVersions,
      contacts,
      linked_applications: linkedApplications,
      projects: linkedProjects,
      linked_contracts: linkedContracts,
      // The native child names: both natures carry `spend_item_id`, never the CAPEX alias.
      links: nativeLineChildren(links),
      attachments: nativeLineChildren(attachments),
    };
  }

  private async loadContractDeepDetail(
    context: AiExecutionContextWithManager,
    contractId: string,
    linkedSpendItems: Array<{ id: string; product_name: string | null; item_number?: number | null }> | null,
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

    const reads = await this.readableLinks(context);
    const probe = this.readProbe(context);
    const readsAssets = await probe('assets');
    const readsTechnologies = await probe('technologies');
    const [contacts, linkedCapexItems, tasks] = await Promise.all([
      this.loadLinkedContacts(context, {
        table: 'contract_contacts',
        foreignKey: 'contract_id',
        id: contractId,
      }).catch(() => []),
      reads.budget ? this.contracts.listLinkedCapexItems(contractId, { manager: context.manager }).catch(() => ({ items: [] })) : null,
      this.contracts.listTasks(contractId, { manager: context.manager }).catch(() => []),
    ]);
    // The contract's budget lines, both natures in one list: the OPEX lines come with the contract
    // (`contracts.get`), the CAPEX lines from their own link read. Null without the budget right,
    // which is not "none".
    const linkedBudgetLineRows = [
      ...(linkedSpendItems ?? []).map((line) => ({ id: line.id, reference: budgetLineReference(line.item_number), product_name: line.product_name, nature: 'opex' as const })),
      ...((linkedCapexItems?.items ?? []) as Array<{ id: string; description: string | null; item_number?: number | null }>)
        .map((line) => ({ id: line.id, reference: budgetLineReference(line.item_number), product_name: line.description, nature: 'capex' as const })),
    ];
    const lineMismatches = reads.budget && linkedBudgetLineRows.length > 0
      ? await lineMismatchesAgainstContract(context.manager, context.tenantId, contractId, linkedBudgetLineRows.map((line) => line.id))
      : null;
    // Null without the budget right, which is not "none". A line outside data access is already
    // absent; `mismatches` is empty when the visible line agrees with the contract.
    const linkedBudgetLines = reads.budget
      ? {
        items: linkedBudgetLineRows.map((line) => ({ ...line, mismatches: lineMismatches?.get(line.id) ?? [] })),
      }
      : null;
    // What the contract covers, each family on its module's read right:
    // null when the caller does not read it, so the answer never reads it as "none".
    const covered = async (family: 'applications' | 'assets' | 'technologies', readable: boolean) => {
      if (!readable) return null;
      const scope = family === 'applications' ? await resolveAiParticipationAccessScope(context, 'applications') : undefined;
      const byContract = await loadContractCoverage(context.manager, context.tenantId, family, [contractId], scope);
      return { items: byContract.get(contractId) ?? [] };
    };
    const linkedApplications = await covered('applications', reads.applications);
    const linkedAssets = await covered('assets', readsAssets);
    const linkedTechnologies = await covered('technologies', readsTechnologies);
    // The linked lines outside a limited person's data access: counted, never named, as on the
    // contract's Budget tab ("and 3 lines outside your access"). Only with the budget right.
    const linesOutsideAccess = reads.budget
      ? await hiddenContractLineCount(context.manager, { id: contractId, tenant_id: context.tenantId })
      : null;

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
      linked_budget_lines: linkedBudgetLines,
      budget_lines_outside_access: linesOutsideAccess,
      linked_applications: linkedApplications,
      linked_assets: linkedAssets,
      linked_technologies: linkedTechnologies,
      tasks,
    };
  }

  /**
   * The applications each contract of `contractIds` covers, as one line per contract, for the
   * caller who reads applications (a Business Contributor: those of their participation); null
   * for any other caller.
   */
  private async coveredApplicationsOf(context: AiExecutionContextWithManager, contractIds: string[]): Promise<Map<string, string> | null> {
    if (!(await this.readProbe(context)('applications'))) return null;
    const scope = await resolveAiParticipationAccessScope(context, 'applications');
    const byContract = await loadContractCoverage(context.manager, context.tenantId, 'applications', contractIds, scope);
    return new Map(contractIds.map((id) => [id, coveredRecordsText(byContract.get(id))]));
  }

  /**
   * Whether the caller reads the administration fields of a person: users at admin level and access
   * not limited, as the users list decides its columns (`canViewUserAdministration`, closed to a
   * limited person by `frontend/src/auth/dataAccess.ts`). The rule of the registry
   * (`UNSCOPED_ADMIN_FIELDS`).
   */
  private async usersAdminView(context: AiExecutionContextWithManager): Promise<boolean> {
    return (await this.policy?.canReadEntityType(context, 'data_access', context.manager)) === true;
  }

  /**
   * What a project or a request detail may name of the other portfolio records: each module on its
   * read right, a Business Contributor's projects, requests and tasks inside their participation.
   */
  private async portfolioLinkedReads(context: AiExecutionContextWithManager): Promise<PortfolioLinkedReads> {
    const reads = await this.linkedReads(context);
    return {
      reads,
      projectScope: await resolveAiParticipationAccessScope(context, 'projects'),
      requestScope: await resolveAiParticipationAccessScope(context, 'requests'),
      taskScope: await resolveAiParticipationAccessScope(context, 'tasks'),
    };
  }

  /** A Business Contributor's linked projects, requests and applications, inside their participation. */
  private async taskLinkedScopes(context: AiExecutionContextWithManager): Promise<TaskLinkedScopes> {
    return {
      projects: await resolveAiParticipationAccessScope(context, 'projects'),
      requests: await resolveAiParticipationAccessScope(context, 'requests'),
      applications: await resolveAiParticipationAccessScope(context, 'applications'),
    };
  }

  /** The modules the caller reads, for the linked records of a task, a project or a request. */
  private linkedReads(context: AiExecutionContextWithManager): Promise<LinkedReads> {
    return loadLinkedReads(context.manager, context.userId, context.tenantId);
  }

  /** Whether the caller reads a family; nothing without the policy. */
  private readProbe(context: AiExecutionContextWithManager): AiReadProbe {
    return async (entityType) => !!(await this.policy?.canReadEntityType(context, entityType, context.manager));
  }

  /**
   * The linked modules a detail may list, each on its own read right, as on the record's page
   * (the application Relations tab). Without it, the list and its count are null, never 0.
   */
  private async readableLinks(context: AiExecutionContextWithManager): Promise<AiReadableLinks> {
    const reads = this.readProbe(context);
    // One after the other: the probes share the request's connection.
    return {
      budget: await reads('budget_lines'),
      contracts: await reads('contracts'),
      projects: await reads('projects'),
      applications: await reads('applications'),
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
    const detail = await this.executeEntityDetail(context, input);
    const amounts = await aiAmountsCurrency(context, input.entity_type, 'detail');
    return amounts ? { ...detail, ...amounts } : detail;
  }

  private async executeEntityDetail(
    context: AiExecutionContextWithManager,
    input: {
      entity_type: AiQueryEntityType;
      entity_id: string;
      year?: number;
    },
  ): Promise<AiEntityDetailDto> {
    const entityType = input.entity_type;
    if (entityType === 'technology_versions') {
      // A version has no page of its own: its technology's detail lists every version.
      throw new BadRequestException('A technology version has no detail of its own: read its technology with get_entity_detail on technologies (by TEC-n reference), or query_entities on technology_versions filtered on technology.');
    }
    if (entityType === 'support_gaps' || entityType === 'support_deadlines') {
      // A report row has no page of its own: it names its subject by `subject`.
      throw new BadRequestException('An End of support report row has no detail of its own: its `subject` names the record, read with get_entity_detail on its family (applications, assets or technologies) by that reference or name.');
    }
    if (entityType === 'role_permissions') {
      throw new BadRequestException('A right of a role has no detail of its own: read the role with get_entity_detail on roles (by name), which lists all its rights.');
    }
    if (entityType === 'roles') return this.roleDetail(context, input.entity_id);
    if (entityType === 'data_access') {
      throw new BadRequestException('A row of Admin › Data access has no detail of its own: read the person with get_entity_detail on users (by name or email), which gives their data access.');
    }
    const entityId = await this.resolveDetailEntityId(context, entityType, input.entity_id);
    if (entityType === 'cost_centers') {
      const { services, opts } = await this.costCenterServices(context);
      const { row, data } = await aiCostCenterDetail(services, opts, entityId);
      // The line counts pass the lines' access rules: within the person's access when it is limited.
      return { ...this.toDetailResult(this.mapCostCenter(row), data), ...await aiDataAccessCountsNote(context, entityType) };
    }
    if (entityType === 'working_day_calendars') return this.workingDayCalendarDetail(context, entityId, input.year);
    if (entityType === 'analytics_axes') return this.analyticsAxisDetail(context, entityId);
    const accessScope = await resolveAiParticipationAccessScope(context, entityType);

    if (entityType === 'tasks') {
      const row = await this.tasks.getOne(entityId, {
        manager: context.manager,
        accessScope,
        viewer: await resolveAiIncidentViewer(context),
        linkedReads: await this.linkedReads(context),
        linkedScopes: await this.taskLinkedScopes(context),
      });
      if (!row) throw new NotFoundException('Task not found.');
      const task: any = withoutHiddenLine(row);
      // The stored `spend_item` / `capex_item` never reaches the model: both natures are one
      // `budget_line` family on the AI surface.
      if (task.related_object_type) task.related_object_type = taskRelatedFamily(task.related_object_type);
      return this.toDetailResult(this.mapTask(row), task);
    }

    if (entityType === 'projects') {
      const row = await this.projects.get(
        entityId,
        { include: 'team,sponsors,contacts,company,department,source_requests,urls,dependencies,attachments,phases,milestones,financials' },
        {
          manager: context.manager,
          tenantId: context.tenantId,
          accessScope,
          readsBudget: await this.readsBudget(context),
          linked: await this.portfolioLinkedReads(context),
        },
      );
      return this.toDetailResult(this.mapProject(row), row);
    }

    if (entityType === 'requests') {
      const row = await this.requests.get(
        entityId,
        { include: 'team,sponsors,contacts,company,department,origin_task,urls,attachments,projects,dependencies,financials,business_processes' },
        {
          manager: context.manager,
          accessScope,
          readsBudget: await this.readsBudget(context),
          viewer: await resolveAiIncidentViewer(context),
          linked: await this.portfolioLinkedReads(context),
        },
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
      const reads = await this.readableLinks(context);
      const counts = await this.applications.relationCounts(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        accessScope,
        projectAccessScope: await resolveAiParticipationAccessScope(context, 'projects'),
      }).catch(() => null);
      row.relation_counts = counts ? readableRelationCounts(counts, reads) : null;
      if (row.supplier_id) {
        const supplierRows = await context.manager.query(
          `SELECT name FROM suppliers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [row.supplier_id, context.tenantId],
        );
        row.supplier_name = supplierRows[0]?.name ?? null;
      }
      if (row.relation_counts) {
        row.budget_lines_count = row.relation_counts.budget_lines;
        row.contracts_count = row.relation_counts.contracts;
      }
      if (!reads.budget) row.budget_lines_count = null;
      if (!reads.contracts) row.contracts_count = null;
      row.linked_budget_lines = reads.budget
        ? mergeLinkedBudgetLines(
          await this.applications.listLinkedSpendItems(entityId, {
            manager: context.manager,
            tenantId: context.tenantId,
            accessScope,
          }).catch(() => ({ items: [] })),
          await this.applications.listLinkedCapexItems(entityId, {
            manager: context.manager,
            tenantId: context.tenantId,
            accessScope,
          }).catch(() => ({ items: [] })),
        )
        : null;
      row.linked_contracts = reads.contracts
        ? await this.applications.listLinkedContracts(entityId, {
          manager: context.manager,
          tenantId: context.tenantId,
          accessScope,
        }).catch(() => ({ items: [] }))
        : null;
      row.projects = reads.projects
        ? await this.applications.listProjects(entityId, {
          manager: context.manager,
          tenantId: context.tenantId,
          accessScope,
          projectAccessScope: await resolveAiParticipationAccessScope(context, 'projects'),
        }).catch(() => ({ items: [] }))
        : null;
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
      Object.assign(row, vulnerabilityCountsOf((await applicationVulnerabilityCounts(context.manager, context.tenantId, [row.id])).get(row.id)));
      // The labels and ranks of the classification, as the list gives them.
      Object.assign(row, classificationLabels(row, await readClassificationCatalog(context)));
      return this.toDetailResult(this.mapApplication(row), row);
    }

    if (entityType === 'assets') {
      const row: any = await this.assets.get(entityId, { manager: context.manager, tenantId: context.tenantId });
      row.hardware_info = await this.assets.getHardwareInfo(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => null);
      row.support_info = await this.assets.getSupportInfo(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => null);
      row.support_contacts = await this.assets.listSupportContacts(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.relations = await this.assets.listRelations(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ outgoing: [], incoming: [] }));
      const reads = await this.readableLinks(context);
      row.linked_budget_lines = reads.budget
        ? mergeLinkedBudgetLines(
          await this.assets.listLinkedSpendItems(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] })),
          await this.assets.listLinkedCapexItems(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] })),
        )
        : null;
      row.linked_contracts = reads.contracts
        ? await this.assets.listLinkedContracts(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] }))
        : null;
      row.projects = reads.projects
        ? await this.assets.listProjects(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => ({ items: [] }))
        : null;
      row.cluster_members = await this.assets.listClusterMembers(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.clusters = await this.assets.listClustersForAsset(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.links = await this.assets.listLinks(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      row.attachments = await this.assets.listAttachments(entityId, { manager: context.manager, tenantId: context.tenantId }).catch(() => []);
      Object.assign(row, vulnerabilityCountsOf((await assetVulnerabilityCounts(context.manager, context.tenantId, [row.id])).get(row.id)));
      return this.toDetailResult(this.mapAsset(row), row);
    }

    if (entityType === 'budget_lines') {
      // The unified read engine resolves BL-n, a legacy OPX-n or CPX-n, a bare number or a UUID,
      // and answers the line of either nature (`resolveBudgetLine`).
      const row: any = await this.budgetLines.get(entityId, { manager: context.manager });
      if (row.tenant_id && row.tenant_id !== context.tenantId) throw new NotFoundException('Budget line not found.');
      // The workspace's own read adds its picker references, its change-of-type lineage and, for a
      // limited person, whether the line is editable: none of them is part of the AI's detail.
      delete row.references;
      delete row.lineage;
      delete row.editable;
      await this.withoutHiddenAnalyticsValues(context, row, row.nature);
      const registry = await resolveAiEntityRegistry(context, entityType, this.readProbe(context));
      // The id, not the reference the caller may have given (`get` accepts both).
      Object.assign(row, await this.loadBudgetLineDeepDetail(context, row.id as string, row.nature, registry));
      const consolidation = await this.consolidationLabels(context, [row], registry, await aiBudgetListAccess(this.policy, context));
      return this.toDetailResult(this.mapBudgetLine(row, registry, consolidation), row);
    }

    if (entityType === 'contracts') {
      const row: any = await this.contracts.get(entityId, { manager: context.manager });
      if (row.tenant_id && row.tenant_id !== context.tenantId) throw new NotFoundException('Contract not found.');
      // The OPEX lines come with the contract; the loader merges both natures into one list.
      const linkedSpendItems = Array.isArray(row.linked_spend_items) ? row.linked_spend_items : null;
      delete row.linked_spend_items;
      Object.assign(row, await this.loadContractDeepDetail(context, entityId, linkedSpendItems));
      const coveredApplications = row.linked_applications ? coveredRecordsText(row.linked_applications.items) : null;
      return this.toDetailResult(this.mapContract(row, coveredApplications), row);
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
      // The company's Access tab, to an administrator of users whose own access is not limited only.
      if (this.dataAccess && await this.dataAccessView(context)) {
        row.data_access = this.companyAccessBlock(await this.dataAccess.companyAccess(context.manager, entityId));
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

    if (entityType === 'technologies') {
      return this.technologyDetail(context, entityId);
    }

    if (entityType === 'vulnerabilities') {
      return this.vulnerabilityDetail(context, entityId);
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
      const user = await this.users.findById(entityId, { manager: context.manager });
      if (!user) throw new NotFoundException('User not found.');
      // A reader of users gets what the user's page gives them (`toUserLookup`): name, email, status.
      if (!(await this.usersAdminView(context))) {
        const lookup = { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, status: user.status };
        return this.toDetailResult(this.mapUser(lookup, false), lookup);
      }
      // `findById` gives the entity; `mapUser` reads the columns of the users list (company,
      // department, primary role, team, contributor profile, availability, expertise), read by the
      // list's own query for this one person.
      const listed = await this.users.listForAi({ limit: 1 }, { manager: context.manager, tenantId: context.tenantId, ids: [user.id] });
      const row = { ...user, ...(listed.items[0] ?? {}) };
      // The Data access tab of the person's dialog, to an administrator of users whose own access
      // is not limited only (the database does not guard the nodes: the gate is here).
      if (!this.dataAccess || !(await this.dataAccessView(context))) {
        return this.toDetailResult(this.mapUser(row, true), row);
      }
      const roles = await this.users.rolesOf(row, { manager: context.manager });
      const access = await this.dataAccess.personAccess(context.manager, row.id);
      const detail = { ...row, roles, data_access: access.mode };
      return this.toDetailResult(this.mapUser(detail, true, true), {
        ...detail,
        data_access: this.personAccessBlock(access),
      });
    }

    if (entityType === 'documents') {
      const document = await this.knowledge.get(entityId, { manager: context.manager, userId: context.userId });
      if (!document) throw new NotFoundException('Document not found.');
      return this.toDetailResult(this.mapDocument(document), document);
    }

    if (entityType === 'incidents') {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      // The record's linked sections follow the same module reads as the incident's REST
      // routes: infrastructure for assets and technologies, applications (narrowed to a
      // Business Contributor's participation) for applications, tasks for tasks. A section
      // without its right stays absent from the detail instead of failing the call.
      const [readsInfrastructure, readsApplications, readsTasks] = await Promise.all([
        this.policy?.canReadEntityType(context, 'technologies', context.manager) ?? false,
        this.policy?.canReadEntityType(context, 'applications', context.manager) ?? false,
        this.policy?.canReadEntityType(context, 'tasks', context.manager) ?? false,
      ]);
      const applicationScope = readsApplications
        ? await resolveAiParticipationAccessScope(context, 'applications')
        : undefined;
      const record = await this.incidentRecords.load(entityId, {
        manager: context.manager,
        tenantId: context.tenantId,
        userId: context.userId,
        viewer,
        technologies: readsInfrastructure,
        applications: readsApplications,
        tasks: readsTasks,
        applicationScope,
      });
      // The four narrative columns are gone: the review document carries them
      // now (planning/incident-review-document.md §3.6). The record service
      // already applied the incident permissions and row visibility, and the
      // business reference is exposed, never the document UUID.
      const detail: Record<string, unknown> = {
        ...record.incident,
        review_markdown: record.review?.content_markdown ?? null,
        review_document_ref: record.review?.item_number != null
          ? `DOC-${Number(record.review.item_number)}`
          : null,
        entries: record.entries,
        documents: record.documents,
        attachments: record.attachments,
      };
      if (record.assets !== null) detail.assets = record.assets;
      if (record.applications !== null) detail.applications = record.applications;
      if (record.technologies !== null) detail.technologies = record.technologies;
      if (record.tasks !== null) detail.tasks = record.tasks;
      return this.toDetailResult(this.mapIncident(record.incident), detail);
    }

    throw new BadRequestException('Unsupported entity type.');
  }

  /**
   * A technology with its figures (`listAiTechnologies`), versions (support state and date, use,
   * servers in service per version), owners (names only) and number of contracts (null without the contracts read right).
   * References and names only: no id of another record.
   */
  private async technologyDetail(context: AiExecutionContextWithManager, entityId: string): Promise<AiEntityDetailDto> {
    if (!this.technologies) throw new BadRequestException('Unsupported entity type.');
    const opts = { manager: context.manager, tenantId: context.tenantId };
    const record = await this.technologies.get(entityId, opts);
    const applications = await resolveAiApplicationsReach(context, this.policy);
    const { items: [row] } = await listAiTechnologies(context.manager, context.tenantId, {}, applications, { ids: [record.id] });
    if (!row) throw new NotFoundException('Technology not found.');
    const figures = await technologyVersionFigures(context.manager, context.tenantId, record.id);
    const owners = (type: 'business' | 'it') => record.owners
      .filter((owner) => owner.owner_type === type)
      .map((owner) => owner.full_name)
      .filter((name): name is string => !!name);
    // What Plaid writes beside the record: support contacts and web links, as the Operations and
    // Relations tabs read them. Names only for a contact, never its email.
    const supportContacts: any[] = await this.technologies.listSupportContacts(record.id, opts);
    const webLinks: any[] = await this.technologies.listLinks(record.id, opts);
    return this.toDetailResult(this.mapTechnology(row), {
      reference: row.reference,
      name: record.name,
      family: record.family,
      publisher: record.editor,
      hosting_type: record.hosting_type,
      lifecycle: record.lifecycle,
      admin_zone: record.admin_zone,
      description: record.description,
      notes: record.notes,
      support_notes: record.support_notes,
      cpe_products: record.cpe_products,
      cyber_criticality: record.cyber_criticality,
      recovery_wave: record.recovery_wave,
      rto_minutes: record.rto_minutes,
      rpo_minutes: record.rpo_minutes,
      replaced_by: record.replaced_by ? { reference: record.replaced_by.reference, name: record.replaced_by.name } : null,
      server_count: row.server_count,
      application_count: row.application_count,
      support_status: row.support_status,
      end_of_standard_support: row.end_of_standard_support,
      end_of_support: row.end_of_support,
      versions_in_use: row.versions_in_use,
      open_vulnerabilities: row.open_vulnerabilities,
      // The technology's alert setting, and each version's own exception: null follows the technology.
      vulnerability_alerts: record.vulnerability_alerts === true,
      // Each version with its state on the End of support report rule: out_of_support since
      // support_date, extended_support until support_date, supported until support_date (its
      // standard end), unknown without a date. in_use: on a server or an application in service.
      versions: record.versions.map((version: any) => ({
        label: version.label,
        standard_support_end: version.standard_support_end ?? null,
        extended_support_end: version.extended_support_end ?? null,
        support_status: figures.get(version.id)?.support_status ?? 'unknown',
        support_date: figures.get(version.id)?.support_date ?? null,
        in_use: figures.get(version.id)?.in_use ?? false,
        server_count: figures.get(version.id)?.servers ?? 0,
        vulnerability_alerts: version.vulnerability_alerts == null ? null : version.vulnerability_alerts === true,
        vulnerability_alerts_effective: version.vulnerability_alerts_effective === true,
      })),
      business_owners: owners('business'),
      it_owners: owners('it'),
      support_contacts: supportContacts.map((contact: any) => ({
        // The Operations tab's label: a name, else the email it shows for an unnamed contact.
        name: [contact.contact?.first_name, contact.contact?.last_name].filter(Boolean).join(' ')
          || String(contact.contact?.email ?? '').trim()
          || 'Unnamed contact',
        role: contact.role ?? null,
      })),
      web_links: webLinks.map((link: any) => ({ url: String(link.url ?? ''), description: link.description ?? null })),
      // As the technology page: no number of contracts without the contracts read right.
      contract_count: (await this.policy?.canReadEntityType(context, 'contracts', context.manager))
        ? await technologyContractCount(context.manager, context.tenantId, record.id)
        : null,
      created_at: record.created_at,
      updated_at: record.updated_at,
    });
  }

  /**
   * A vulnerability row, by its id or by a CVE id (then the CVE's first row in the list order:
   * exploited, then most severe), with every field of the row, the CVE's signals and `rows`: each
   * row of that CVE in the workspace (technology, version, state, alert, direct reach). References
   * and names only: no id of another record.
   */
  private async vulnerabilityDetail(context: AiExecutionContextWithManager, entityId: string): Promise<AiEntityDetailDto> {
    const value = String(entityId ?? '').trim();
    const isId = isUuid(value);
    let cveId = value.toUpperCase();
    if (isId) {
      const [row]: Array<{ cve_id: string }> = await context.manager.query(
        `SELECT cve_id FROM technology_vulnerabilities WHERE tenant_id = $1 AND id = $2::uuid`,
        [context.tenantId, value],
      );
      if (!row) throw entityNotFound('vulnerabilities', value);
      cveId = row.cve_id;
    } else if (!/^CVE-\d{4}-\d{4,}$/.test(cveId)) {
      throw entityNotFound('vulnerabilities', value);
    }
    const applications = await resolveAiApplicationsReach(context, this.policy);
    const { items } = await listAiVulnerabilities(context.manager, context.tenantId, { limit: 500 }, applications, { cveIds: [cveId], detail: true });
    const row: AiVulnerabilityDetailRow | undefined = isId ? items.find((item) => item.id === value) : items[0];
    if (!row) throw entityNotFound('vulnerabilities', value);
    const { id: _id, created_at: _created, updated_at: _updated, ...fields } = row;
    return this.toDetailResult(this.mapVulnerability(row), {
      ...fields,
      rows: items.map((item) => ({
        technology: item.technology,
        technology_name: item.technology_name,
        version: item.version,
        state: item.state,
        alerts: item.alerts,
        matching: item.matching,
        servers_reached: item.servers_reached,
        applications_reached: item.applications_reached,
      })),
    });
  }

  /**
   * A working-day calendar as its page (`GET /working-day-profiles/:id`): its source, the years
   * stored, the OPEX and CAPEX lines using it (within the person's access) and, with a year, that
   * year as its tab (`GET /working-day-profiles/:id/years/:year`): the source, the twelve months,
   * their exact total and the public holidays by name in the person's language.
   */
  private async workingDayCalendarDetail(context: AiExecutionContextWithManager, id: string, rawYear?: number): Promise<AiEntityDetailDto> {
    const { services, opts } = await this.workingDayCalendarServices(context);
    const year = calendarYearOf(undefined, rawYear ?? null);
    const ctx = { manager: context.manager, tenantId: context.tenantId, userId: context.userId };
    const calendar = await services.calendars.get(id, ctx, opts.lang);
    const row: AiWorkingDayCalendarRow = {
      id: calendar.id,
      code: calendar.code,
      name: calendar.name,
      kind: calendar.country_iso ? 'standard' : 'custom',
      country: calendar.country_name,
      country_code: calendar.country_iso,
      region: calendar.region_name,
      region_code: calendar.region_code,
      status: calendar.status,
      disabled_at: calendar.disabled_at,
      description: calendar.description,
      years_edited: Object.keys(calendar.days_by_year ?? {}),
      created_at: calendar.created_at,
      updated_at: calendar.updated_at,
      year: null,
      source: null,
      total_days: null,
    };
    let yearBlock: Record<string, unknown> = { year_note: AI_CALENDAR_NO_YEAR_NOTE };
    if (year != null) {
      const read = await readCalendarYear(services, opts, id, year);
      row.year = year;
      row.source = read.source;
      row.total_days = read.total_days;
      yearBlock = {
        year,
        source: read.source,
        total_days: read.total_days,
        months: calendarMonths(read.days),
        ...(read.source === 'edited' && read.standard_days ? { standard_total_days: read.standard_total_days } : {}),
        holidays: calendarHolidays(read.holidays),
        year_note: AI_CALENDAR_YEAR_NOTE,
      };
    }
    const { days_by_year: _days, opex_count: _opex, capex_count: _capex, ...rest } = calendar;
    return {
      ...this.toDetailResult(this.mapWorkingDayCalendar(row), {
        ...rest,
        kind: row.kind,
        years_edited: row.years_edited,
        lines_using: { opex: calendar.opex_count, capex: calendar.capex_count },
        lines_using_note: 'The OPEX and CAPEX lines with a quantity × price line on this calendar, whatever the year or column.',
        ...yearBlock,
      }),
      ...(await aiDataAccessNote(context, 'working_day_calendars')),
    };
  }

  /**
   * An analytics dimension as its page (`GET /analytics-axes/:id`): its settings, its number of
   * values, the OPEX and CAPEX lines holding a value on it and without one (within the person's
   * access), and the natures on which no enabled value can be chosen.
   */
  private async analyticsAxisDetail(context: AiExecutionContextWithManager, id: string): Promise<AiEntityDetailDto> {
    const { services, opts } = await this.analyticsAxesServices(context);
    const axis = await services.axes.get(id, { manager: context.manager, tenantId: context.tenantId, userId: context.userId });
    const row = toAiAnalyticsAxisRow(axis, opts.language);
    return {
      ...this.toDetailResult(this.mapAnalyticsAxis(row), {
        ...row,
        value_count: axis.value_count,
        opex_count: axis.opex_count,
        capex_count: axis.capex_count,
        opex_missing: axis.opex_missing,
        capex_missing: axis.capex_missing,
        unusable_for: axis.unusable_for,
        counts_note: 'opex_count and capex_count: the lines holding a value on the dimension; opex_missing and capex_missing: the lines of every status without one (0 for a nature it does not apply to), whether or not it is required; unusable_for: the natures it applies to on which none of its enabled values can be chosen.',
        values_note: AI_AXIS_VALUES_NOTE,
      }),
      ...(await aiDataAccessNote(context, 'analytics_axes')),
    };
  }

  /**
   * A role by its name or id, with its rights as the Roles screen's matrix: every right, in the
   * screen's order, at the level the role gives, null where it gives none, and `rights`, the rights
   * it gives with the screen's words in the person's language. The people it is given to are
   * counted, never named.
   */
  private async roleDetail(context: AiExecutionContextWithManager, entityId: string): Promise<AiEntityDetailDto> {
    await this.assertRolesRead(context, 'roles');
    const services = this.rolesServices();
    const value = String(entityId ?? '').trim();
    const role = await findAiRole(services, context.manager, value);
    if (!role) throw entityNotFound('roles', value);
    const matrix = await services.permissions.getRolePermissionMatrix(role.id, { manager: context.manager });
    // The rights the Roles screen shows, and no other (`AI_SCREEN_RESOURCES`).
    const permissions = Object.fromEntries(AI_SCREEN_RESOURCES.map((resource) => [resource, matrix[resource] ?? null]));
    const language = await readAiScreenLanguage(context.manager, context.tenantId, context.userId);
    const rights = (Object.entries(permissions) as Array<[AiRolePermissionRow['resource'], AiRolePermissionRow['level'] | null]>)
      .filter((entry): entry is [AiRolePermissionRow['resource'], AiRolePermissionRow['level']] => entry[1] != null)
      .map(([resource, level]) => ({
        resource,
        resource_label: aiResourceLabel(resource, language),
        level,
        level_label: aiPermissionLevelLabel(level, language),
      }));
    return this.toDetailResult(this.mapRole(role), {
      name: role.name,
      description: role.description,
      type: role.type,
      user_count: role.user_count,
      created_at: role.created_at,
      updated_at: role.updated_at,
      permissions,
      rights,
      permissions_note: '`permissions` gives every right of the Roles screen with the level the role gives (null: none); `rights` lists the rights it gives with the words of the Roles screen (`resource_label`, `level_label`), the ones to quote, never the codes.',
    });
  }

  /**
   * The version labels of the tenant, the values of the `version` filter of the technologies and
   * of the `label` filter of `technology_versions`: one query, never a label typed in.
   */
  private async technologyVersionLabels(context: AiExecutionContextWithManager): Promise<string[]> {
    const rows: Array<{ value: string }> = await context.manager.query(
      `SELECT DISTINCT v.label AS value
         FROM technology_versions v
        WHERE v.tenant_id = $1 AND btrim(v.label) <> ''
        ORDER BY value ASC NULLS LAST
        LIMIT 5000`,
      [context.tenantId],
    );
    return (rows || []).map((row) => String(row.value));
  }

  /**
   * The values of the technologies filters that no column carries: the tenant's version labels
   * (`version`) and the display names of the owners of its technologies (`owner` of any type,
   * `it_owner`, `business_owner`). Read from `technology_versions` and `technology_owners`, never
   * from the technology row, and only for the fields the caller asked (`grids`).
   */
  private async technologyFilterValues(
    context: AiExecutionContextWithManager,
    grids: ReadonlySet<string>,
  ): Promise<Record<string, Array<string | null>>> {
    const values: Record<string, Array<string | null>> = {};
    if (grids.has('version')) values.version = await this.technologyVersionLabels(context);
    const ownerFields: Array<{ grid: string; type: 'it' | 'business' | null }> = [
      { grid: 'owner_name', type: null },
      { grid: 'it_owner_name', type: 'it' },
      { grid: 'business_owner_name', type: 'business' },
    ];
    for (const { grid, type } of ownerFields) {
      if (!grids.has(grid)) continue;
      const rows: Array<{ value: string | null }> = await context.manager.query(
        `SELECT DISTINCT NULLIF(btrim(concat_ws(' ', u.first_name, u.last_name)), '') AS value
           FROM technology_owners o
           JOIN users u ON u.id = o.user_id AND u.tenant_id = o.tenant_id
          WHERE o.tenant_id = $1${type ? ` AND o.owner_type = '${type}'` : ''}
          ORDER BY value ASC NULLS LAST
          LIMIT 5000`,
        [context.tenantId],
      );
      values[grid] = (rows || []).map((row) => row.value).filter((value): value is string => !!value);
    }
    return values;
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
         WHERE ${alias}.tenant_id = $1${registry.aggregate.baseWhere ? ` AND ${registry.aggregate.baseWhere}` : ''}
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
    const registry = await resolveAiEntityRegistry(context, input.entity_type, this.readProbe(context));
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

    // The requested fields the person may not read, with the reason.
    const withheld = (registry.withheldFields ?? []).filter((entry) => requestedFields.includes(entry.field));
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
        ...(withheld.length ? { fields_withheld: withheld } : {}),
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
      input.entity_type === 'budget_lines'
      || input.entity_type === 'accounts'
      || input.entity_type === 'analytics_categories'
      || input.entity_type === 'business_processes'
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
        viewer: await resolveAiIncidentViewer(context),
        linkedReads: await this.linkedReads(context),
        linkedScopes: await this.taskLinkedScopes(context),
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
    } else if (input.entity_type === 'budget_lines') {
      const access = await aiBudgetListAccess(this.policy, context);
      raw = await this.budgetLines.summaryFilterValues(query, { manager: context.manager, access }) as any;
      // The consolidation account is no column of the list: its values are the engine's labels of the lines.
      const consolidation = registry.fields.consolidation_account?.grid;
      if (consolidation && dynamicFieldMap.has(consolidation)) raw[consolidation] = await this.consolidationValues(context, consolidation, access);
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
    } else if (input.entity_type === 'technologies') {
      // The version labels and the owner names have no column on `technologies`: they are read
      // from their own tables. The other dynamic fields fall back to the registry below.
      raw = await this.technologyFilterValues(context, new Set(dynamicFieldMap.keys()));
    } else if (input.entity_type === 'technology_versions') {
      // The labels have no value list on the version row: they are read from the labels of the
      // tenant's technology versions, one query (the `version` values of the technologies).
      if (dynamicFieldMap.has('label')) raw.label = await this.technologyVersionLabels(context);
    } else if (input.entity_type === 'cost_centers') {
      // The names the nodes carry, read from the tree: no column to read them from.
      const { services, opts } = await this.costCenterServices(context);
      const { rows } = await readAiCostCenterTree(services, opts);
      for (const field of ['company', 'budget_holder'] as const) {
        if (dynamicFieldMap.has(field)) raw[field] = costCenterFilterValues(rows, field);
      }
    } else if (input.entity_type === 'incidents') {
      const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
      const reads = this.readProbe(context);
      const readsApplications = await reads('applications');
      raw = await this.incidents.listFilterValues(query, {
        manager: context.manager,
        tenantId: context.tenantId,
        viewer,
        // The linked values follow the module reads; applications follow the participation scope.
        technologies: await reads('technologies'),
        applications: readsApplications,
        applicationScope: readsApplications
          ? await resolveAiParticipationAccessScope(context, 'applications')
          : undefined,
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
      ...(withheld.length ? { fields_withheld: withheld } : {}),
      total: requestedFields.length,
      returned: Object.keys(values).length,
      truncated: false,
      complete: ignoredFields.length === 0,
    };
  }
}
