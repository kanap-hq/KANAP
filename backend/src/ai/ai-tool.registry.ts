import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { describeZodIssues, invalidInputMessage } from './control-plane/dispatcher/ai-input-validation.util';
import { legacyFlattenError } from '../common/zod-error';
import { z } from 'zod';
import { Features } from '../config/features';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { AiMutationPreviewService } from './ai-mutation-preview.service';
import { AiEntityService } from './ai-entity.service';
import { AiPolicyService } from './ai-policy.service';
import { AI_RECORD_HISTORY_ENTITY_TYPES, AI_RECORD_HISTORY_FAMILY_WORDS, AiRecordHistoryService } from './ai-record-history.service';
import { AiSettingsService } from './ai-settings.service';
import { AiProviderToolDef } from './providers/ai-provider.types';
import { BraveSearchService } from './web-search/brave-search.service';
import { AI_BUDGET_DELTA_DEFAULT_LIMIT, AI_BUDGET_GROUP_LIMIT, AiAggregateExecutor } from './query/ai-aggregate.executor';
import { AI_QUERY_DEFAULT_LIMIT, AI_QUERY_FAMILY_MAX_LIMIT, AI_QUERY_MAX_LIMIT, AiQueryExecutor } from './query/ai-query.executor';
import { describeAiEntityFilters } from './query/ai-filter-description.util';
import { resolveAiEntityRegistry } from './query/registries';
import { readBudgetColumns } from '../budget-columns/budget-columns.util';
import { localizedBudgetColumnsAiContext } from '../budget-columns/budget-column-labels';
import { AiMutationOperationRegistry } from './mutation/ai-mutation-operation.registry';
import { aiWriteRequirements } from './mutation/ai-write-levels';
import { PermissionLevel } from '../permissions/permissions.service';
import { AiSettings } from './ai-settings.entity';
import { AiAdapterConfig } from './control-plane/providers/adapter-config.entity';
import { parseCredentialRef } from './control-plane/providers/adapter-config.service';
import { LEGACY_GLPI_TICKETING_PROVIDER_KEY } from './control-plane/providers/provider-constants';
import { dataAccessRefusalMessage } from '../common/filters/database-error.mapping';
import { resolveConfiguredAppBaseUrl } from '../common/url';
import { AI_PAGE_URL_NOTE, withAiPageUrls } from './ai-page-urls';
import { AI_UNREAD_FAMILIES_SENTENCE, type AiScreenLanguage, readAiScreenLanguage, unreadFamiliesReachOf, unreadFamilyLines } from './ai-unread-families';
import { AiHelpManualService, HELP_SECTION_MAX_CHARS } from './ai-help-manual.service';
import {
  AI_CONTEXT_ENTITY_TYPES,
  AI_DETAIL_ENTITY_TYPES,
  AI_QUERY_ENTITY_TYPES,
  AiContextEntityTypeSchema,
  AiDetailEntityTypeSchema,
  AiDocumentDto,
  AiEntityDetailDto,
  AiEntitySummaryDto,
  AiExecutionContextWithManager,
  AiKnowledgeSearchResultDto,
  AiMutationPreviewDto,
  AiToolCategory,
  AiQueryEntityTypeSchema,
  AiQueryScopeSchema,
  AiSearchAllEntityTypeSchema,
  AiToolDefinition,
  AiToolListItemDto,
  AiToolName,
} from './ai.types';

const QUERY_ENTITY_TYPE_SUMMARY = AI_QUERY_ENTITY_TYPES.join(', ');
const CONTEXT_ENTITY_TYPE_SUMMARY = AI_CONTEXT_ENTITY_TYPES.join(', ');
const QUICK_SEARCH_DESCRIPTION = 'Optional quick-search text, matched literally: a filter written here (status:in_progress, assignee=bob@example.com) is searched as words. Field filters go in `filters`.';
const SCOPE_DESCRIPTION = 'Optional first-person scope for tasks, projects and requests: "me" or "my_team".';
const FILTERS_DESCRIPTION = 'Optional field filters keyed by field name. describe_entity_filters lists the supported fields and value formats.';
const YEAR_DESCRIPTION = 'Optional fiscal or calendar year for year-backed metrics, such as company headcount, IT users, turnover and department headcount. Defaults to the current year when metric fields are included.';

const SearchAllInputSchema = z.object({
  query: z.string().trim().min(1).describe('Search text or item reference such as PRJ-12, REQ-7, T-42, DOC-3 or INC-12.'),
  entity_types: z.array(AiSearchAllEntityTypeSchema).optional().describe('Optional entity families to search. All readable families by default.'),
  limit: z.number().int().min(1).max(100).default(25)
    .describe('Maximum number of results (default 25, max 100). When `truncated` is true, more matches exist than returned: a narrower query or query_entities on one family finds them.'),
});

const GetEntityContextInputSchema = z.object({
  entity_type: AiContextEntityTypeSchema.describe(`One of ${CONTEXT_ENTITY_TYPE_SUMMARY}.`),
  entity_id: z.string().trim().min(1).describe('The UUID or reference of the record, such as APP-4, AST-9, PRJ-12, REQ-7, T-42 or TEC-3; a contract by its UUID.'),
});

const GetEntityDetailInputSchema = z.object({
  entity_type: AiDetailEntityTypeSchema.describe(`The entity family of the record: one of ${AI_DETAIL_ENTITY_TYPES.join(', ')}.`),
  entity_id: z.string().trim().min(1)
    .describe('The UUID of the record, or its reference where the family has one, such as APP-4, AST-9, PRJ-12, REQ-7, T-42, DOC-3, INC-12, BL-5 or TEC-3, or a CVE id such as CVE-2024-3094 on vulnerabilities. A cost center, a working-day calendar or an analytics dimension is also named by its code, such as FR-TRV-500, FR or it_tower.'),
  year: z.number().int().min(1900).max(3000).optional()
    .describe('Optional fiscal or calendar year for year-backed metrics, on companies and departments, and the year whose working days a working-day calendar gives.'),
});

const GetEntityCommentsInputSchema = z.object({
  entity_type: z.enum(['projects', 'tasks']).describe('The entity family: projects or tasks.'),
  entity_id: z.string().trim().min(1).describe('The UUID or reference of the project or task, such as PRJ-12 or T-42.'),
  offset: z.number().int().min(0).max(5000).default(0).describe('Zero-based comment offset (default 0). A higher offset reads older comments.'),
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of comments to return (default 20, max 100).'),
});

const GetRecordHistoryInputSchema = z.object({
  entity_type: AiDetailEntityTypeSchema.describe(`The entity family of the record. The families with a history: ${AI_RECORD_HISTORY_ENTITY_TYPES.join(', ')}.`),
  entity_id: z.string().trim().min(1)
    .describe('The UUID or reference of the record, such as TEC-3, AST-9, BL-5, OPX-12, CPX-3 or DOC-4; a record without a reference by its UUID or exact name.'),
  cursor: z.string().trim().min(1).optional().describe('The next_cursor of the previous page, for older entries.'),
  limit: z.number().int().min(1).max(100).default(50).describe('Maximum number of entries (default 50, max 100).'),
});

const SearchKnowledgeInputSchema = z.object({
  query: z.string().trim().min(1).describe('Search words, or a document reference such as DOC-14.'),
  offset: z.number().int().min(0).max(5000).default(0).describe('Zero-based result offset (default 0). When `truncated` is true, offset + limit fetches the next batch.'),
  limit: z.number().int().min(1).max(200).default(20).describe('Maximum number of documents to return (default 20, max 200).'),
});

const GetDocumentInputSchema = z.object({
  document_id: z.string().trim().min(1).describe('The document UUID or DOC reference, such as DOC-123.'),
});

const HELP_LANGUAGE_DESCRIPTION = 'Optional language of the manual: en, fr, de or es. Defaults to the language of the person\'s interface, else English; pass the language of the conversation.';

const ListHelpTopicsInputSchema = z.object({
  query: z.string().trim().max(200).optional()
    .describe('Optional words to look for in the manual, in its language (contrat application, budget line import). Without words, every page with its main sections.'),
  language: z.enum(['en', 'fr', 'de', 'es']).optional().describe(HELP_LANGUAGE_DESCRIPTION),
});

const ReadHelpSectionInputSchema = z.object({
  page: z.string().trim().min(1).max(300).describe('The page path list_help_topics gives, such as contracts or on-premise/installation.'),
  section: z.string().trim().min(1).max(300).optional()
    .describe('Optional section title as list_help_topics writes it (Relations, or Parent › Child when a title repeats). Without it, the whole page.'),
  language: z.enum(['en', 'fr', 'de', 'es']).optional().describe(HELP_LANGUAGE_DESCRIPTION),
});

const AiFilterValueSchema = z.union([
  z.array(z.union([z.string(), z.null()])),
  // Exclude mode of a set field: every value but these (budget lines only).
  z.object({ not: z.array(z.union([z.string(), z.null()])) }).strict(),
  z.string(),
  // A number alone on a number field means eq (`2026` is {"op": "eq", "value": 2026}).
  z.number(),
  z.object({
    op: z.enum(['eq', 'gt', 'lt', 'gte', 'lte', 'between']),
    value: z.number(),
    valueTo: z.number().optional(),
  }),
  z.object({
    op: z.enum(['eq', 'before', 'after', 'between']),
    value: z.string().trim().min(1),
    valueTo: z.string().trim().min(1).optional(),
  }),
]);

const QueryEntitiesInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema.describe('The entity family to list.'),
  scope: AiQueryScopeSchema.optional().describe(SCOPE_DESCRIPTION),
  filters: z.record(z.string(), AiFilterValueSchema).optional().describe(FILTERS_DESCRIPTION),
  q: z.string().trim().optional().describe(QUICK_SEARCH_DESCRIPTION),
  year: z.number().int().min(1900).max(3000).optional().describe(YEAR_DESCRIPTION),
  sort: z.object({
    field: z.string().trim().min(1),
    direction: z.enum(['asc', 'desc']),
  }).optional()
    .describe('Optional sort field and direction: a field marked sortable by describe_entity_filters, or created_at and updated_at on every family. "The latest created" is created_at desc.'),
  page: z.number().int().min(1).max(100).default(1)
    .describe('Page number (default 1). When `total` is greater than the items returned, later pages with the same limit hold the rest.'),
  // No default or maximum here: the executor applies the family's (`aiQueryLimit`) and reports it.
  limit: z.number().int().min(1).optional()
    .describe(`Items per page: default ${AI_QUERY_DEFAULT_LIMIT}, at most ${AI_QUERY_MAX_LIMIT} (${Object.entries(AI_QUERY_FAMILY_MAX_LIMIT).map(([type, max]) => `${max} for ${type}`).join(', ')}). A larger value is reduced; the result's limit is the one applied. aggregate_entities returns counts and totals without paging.`),
});

/**
 * The chargeback reports (Plaid L8, lot D), one sentence shared by query_entities and
 * aggregate_entities, chat and MCP alike.
 */
const CHARGEBACK_FAMILIES_SENTENCE = 'The chargeback reports are read for a person with the Reporting right: `chargeback` holds the rows of Reporting › Global chargeback '
  + '(each beneficiary company, then its departments and its costs without a department, a group by department keyed "company › department"), '
  + 'and `chargeback_lines` the budget lines charged to the one company its `company` filter names (Reporting › Company chargeback). '
  + 'Each reads one year and one column; without a `nature` filter it covers both natures, which the result says (the screens open on OPEX), '
  + 'and `chargeback.warnings` names in words what the figures leave out, for the answer to repeat.';

/**
 * The reference data read as families (Plaid L9), shared by query_entities, aggregate_entities and
 * describe_entity_filters: facts the fields do not say on their own.
 */
const REFERENCE_DATA_FAMILIES_SENTENCE = 'The reference data are families too: on `cost_centers` (Master data › Cost centers), `budget_holder` is the budget holder of the node, '
  + 'the person responsible for it, `under` keeps every node below a group and `parent` the nodes directly under it; '
  + 'a `working_day_calendars` row reads one year (the `year` filter), whose `total_days` the server computes; '
  + 'on `analytics_axes` (the analytics dimensions and their settings), `required_for` is where a value is required now, an enabled dimension only; '
  + '`exchange_rates` gives each currency\'s rate for a year in the reporting currency for 1 unit of that currency, '
  + 'with `inverse_rate` and, with the `against` filter, `cross_rate` computed by the server; '
  + 'a pair with the reporting currency reads on the row of the other currency (`rate` and `inverse_rate`), and `against` serves a pair of two other currencies.';

const DescribeEntityFiltersInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema.describe('The entity family to describe.'),
});

const AggregateEntitiesInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema.describe('The entity family to aggregate.'),
  scope: AiQueryScopeSchema.optional().describe(SCOPE_DESCRIPTION),
  group_by: z.string().trim().min(1).describe('The field to group by, among the group-by fields describe_entity_filters lists.'),
  metric: z.string().trim().min(1).optional()
    .describe('Optional numeric or date field to aggregate with sum, avg, min or max. On budget lines, a key names its year and column, `<year>_<column>`: <year> is y (the current year), y_minus1, y_minus2, y_plus1 or y_plus2; <column> is budget, review, forecast, actual or landing. '
      + '`y_budget` is the amount; `y_budget_fte` the full-year average FTE (each group then also returns `unknown`, the number of lines whose column has no quantity × price lines, left out of the value); '
      + '`y_budget_staff_cost`, `y_budget_staff_fte`, `y_budget_day_cost` and `y_budget_days` the cost and FTE of the people and days lines, the cost of the lines priced per day and the days they buy. '
      + 'Cost per FTE and average day rate (TJM, daily rate): metric `y_budget_cost_per_fte` or `y_budget_day_rate`, no function needed. The server divides as the "Cost per FTE" report does, and each group returns staff_fte, staff_cost, cost_per_fte, days, day_cost and day_rate in one call, so the answer needs no division and no assumed number of working days. `y_budget_cost_per_fte` keeps every group with staff (FTE and day rate per group); `y_budget_day_rate` keeps only the groups with days bought. '
      + 'On budget lines, `overall` gives the measure over all groups together.'),
  metrics: z.array(z.string().trim().min(1)).min(2).max(8).optional()
    .describe('Budget lines, in place of metric: 2 to 8 amounts, FTE or line totals measured with one function in one call, each group and `overall` then carrying `values` by metric, '
      + 'as a table of companies by column (group_by paying_company, metrics y_budget, y_review, y_landing) or of suppliers by year (group_by supplier, metrics y_minus1_budget, y_budget, y_plus1_budget).'),
  then_by: z.string().trim().min(1).optional()
    .describe('Budget lines: a second group-by field, each group then carrying `then_key` (a null key or then_key is the group of the lines without that value), '
      + `at most limit groups (${AI_BUDGET_GROUP_LIMIT.default} by default); the streams and categories of the linked projects do not cross.`),
  limit: z.number().int().min(1).max(AI_BUDGET_GROUP_LIMIT.max).optional()
    .describe(`Budget lines: the groups returned at most, 1 to ${AI_BUDGET_GROUP_LIMIT.max} (${AI_BUDGET_GROUP_LIMIT.default} with then_by, every group without), ordered by the metric (the first of metrics) or the count; \`others\` gives the same measure over the rest, and \`group_count\` counts every group. `
      + `A change between two columns keeps ${AI_BUDGET_DELTA_DEFAULT_LIMIT} groups by default, and the FTE by month keeps the largest averages.`),
  direction: z.enum(['increase', 'decrease']).optional()
    .describe('Budget lines, a change between two columns (metric `y_review_minus_y_budget`): increase (the default) keeps the groups that rise, largest first; decrease the groups that fall, largest fall first.'),
  function: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional().describe('Optional aggregation function: count, sum, avg, min or max. Defaults to count.'),
  filters: z.record(z.string(), AiFilterValueSchema).optional().describe(FILTERS_DESCRIPTION),
  q: z.string().trim().optional().describe(QUICK_SEARCH_DESCRIPTION),
});

const GetFilterValuesInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema.describe('The entity family.'),
  fields: z.array(z.string().trim().min(1)).min(1).max(10).describe('Up to 10 filter field names to list values for.'),
});

const GetApplicationClassificationCatalogInputSchema = z.object({}).strict();

const WebSearchInputSchema = z.object({
  query: z.string().trim().min(1).max(256),
  count: z.number().int().min(1).max(10).optional(),
});

const UndoPreviewInputSchema = z.object({
  preview_id: z.string().trim().uuid(),
});

const UpdateTaskAssigneesInputSchema = z.object({
  refs: z.array(z.string().trim().min(1)).min(1).max(50),
  assignee_email: z.string().trim().email(),
});

const PrepareMutationPlanOperationSchema = z.object({
  operation_id: z.string().trim().regex(/^[A-Za-z0-9_-]+$/).optional()
    .describe('Stable step key used by dependencies and placeholders, for example create_project or task_1.'),
  label: z.string().trim().optional()
    .describe('Human-readable step label.'),
  tool_name: z.string().trim().min(1)
    .describe('Exact write-preview tool name to prepare for this step, such as create_business_record or create_task.'),
  input: z.record(z.string(), z.unknown())
    .describe('Input object for the selected write-preview tool. Dependent steps may use placeholders like {{create_project.ref}}.'),
  depends_on: z.array(z.string().trim().min(1)).optional()
    .describe('Step keys that must execute before this step can prepare its preview.'),
}).refine((operation) => operation.tool_name !== 'delete_record', {
  message: 'delete_record prepares one record at a time and cannot be part of a mutation plan.',
  path: ['tool_name'],
});

const BulkExplicitExclusionSchema = z.object({
  ref: z.string().trim().min(1)
    .describe('Canonical target reference explicitly excluded from this bulk mutation, such as T-42.'),
  reason: z.string().trim().min(1)
    .describe('Short user-visible reason why this target is outside the resolved target set.'),
});

const PrepareMutationPlanInputSchema = z.object({
  summary: z.string().trim().optional()
    .describe('Short description of the overall requested mutation plan.'),
  target_set_label: z.string().trim().optional()
    .describe('Short label for the resolved bulk target set, including assumptions when relevant, such as "active overdue tasks".'),
  expected_target_refs: z.array(z.string().trim().min(1)).max(50).optional()
    .describe('Canonical references for every resolved target expected to receive a preview, after explicit assumptions are applied.'),
  expected_target_count: z.number().int().min(0).max(50).optional()
    .describe('Expected number of targets in the resolved target set when exact refs are known or counted.'),
  explicit_exclusions: z.array(BulkExplicitExclusionSchema).max(50).optional()
    .describe('Targets found during discovery but explicitly excluded because of a stated assumption or validation reason.'),
  operations: z.array(PrepareMutationPlanOperationSchema).min(1).max(50)
    .describe('Ordered write-preview operations. Independent operations create previews immediately; dependent operations wait for their prerequisites.'),
});

/** The schema's field descriptions, the single source of a read tool's `inputSummary`. */
function fieldDescriptions(schema: z.ZodObject<any>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(schema.shape as Record<string, z.ZodTypeAny>)
      .flatMap(([field, type]) => (type.description ? [[field, type.description]] : [])),
  );
}

function normalizeBulkTargetRef(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.toUpperCase() : null;
}

function normalizeBulkTargetRefs(values: unknown): string[] {
  if (!Array.isArray(values)) {
    return [];
  }
  const refs: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const ref = normalizeBulkTargetRef(value);
    if (!ref || seen.has(ref)) {
      continue;
    }
    seen.add(ref);
    refs.push(ref);
  }
  return refs;
}

function normalizeJsonSchemaForProviders(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJsonSchemaForProviders(entry));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const normalized = Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, normalizeJsonSchemaForProviders(entry)]),
  );

  if (
    normalized.nullable === true
    && Array.isArray(normalized.enum)
    && normalized.enum.length === 1
    && (normalized.enum[0] === null || normalized.enum[0] === 'null')
  ) {
    return { type: 'null' };
  }

  // Zod 4's OpenAPI 3.0 output leaves a plain object open; the provider tool schemas have always
  // declared `additionalProperties: false` (zod-to-json-schema's output for a stripping object).
  if (normalized.type === 'object' && normalized.properties && normalized.additionalProperties === undefined) {
    normalized.additionalProperties = false;
  }

  if (normalized.exclusiveMinimum === true && typeof normalized.minimum === 'number') {
    normalized.exclusiveMinimum = normalized.minimum;
    delete normalized.minimum;
  } else if (normalized.exclusiveMinimum === false) {
    delete normalized.exclusiveMinimum;
  }

  if (normalized.exclusiveMaximum === true && typeof normalized.maximum === 'number') {
    normalized.exclusiveMaximum = normalized.maximum;
    delete normalized.maximum;
  } else if (normalized.exclusiveMaximum === false) {
    delete normalized.exclusiveMaximum;
  }

  // `z.int()` bounds itself by the safe-integer range. These bounds say nothing a model can use
  // (JSON cannot carry an exact integer outside it) and the tool schemas never showed them.
  if (normalized.minimum === Number.MIN_SAFE_INTEGER) delete normalized.minimum;
  if (normalized.maximum === Number.MAX_SAFE_INTEGER) delete normalized.maximum;

  // Zod 4 adds the regex behind `format: "uuid"` and `format: "email"`. The providers read the
  // format, as they always did; the pattern only widens the diff.
  if (typeof normalized.format === 'string' && typeof normalized.pattern === 'string') delete normalized.pattern;

  return normalized;
}

function toDocumentRelation(type: AiEntitySummaryDto['type'], row: any): AiEntitySummaryDto {
  return {
    type,
    id: row.id,
    ref: null,
    label: row.name,
    status: null,
    summary: null,
    updated_at: null,
  };
}

@Injectable()
export class AiToolRegistry {
  private readonly definitions: Map<AiToolName, AiToolDefinition<any, any>>;

  constructor(
    private readonly entityTools: AiEntityService,
    private readonly knowledge: KnowledgeService,
    private readonly policy: AiPolicyService,
    private readonly queryExecutor: AiQueryExecutor,
    private readonly aggregateExecutor: AiAggregateExecutor,
    private readonly settingsService: AiSettingsService,
    private readonly braveSearch: BraveSearchService,
    private readonly previews: AiMutationPreviewService,
    private readonly mutationOperations: AiMutationOperationRegistry,
    @Optional() private readonly itOpsSettings?: ItOpsSettingsService,
    @Optional() private readonly recordHistory?: AiRecordHistoryService,
    @Optional() private readonly helpManual?: AiHelpManualService,
  ) {
    this.definitions = new Map<AiToolName, AiToolDefinition<any, any>>([
      [
        'search_all',
        {
          name: 'search_all',
          category: 'discovery',
          description: 'Searches the readable KANAP records of every family (applications, assets, projects, requests, tasks, documents, budget lines, contracts and more) by text or by reference such as PRJ-12, and returns the matches with their reference, name and status. It also searches the cost centers, working-day calendars and analytics dimensions by code and by name (`ref` is the code; at most five of each family): an exact code or name ranks as a reference, a part of one as a name. Suited to finding a record whose family or exact name is unknown; query_entities lists, filters and counts one family. When `complete` is true and `truncated` false, the results hold every match. `failed_entity_types` lists the families that could not be searched: the results are then partial, and query_entities on those families gives the authoritative answer. `not_read_here` names the families the search words ask for that this server does not read, with the screen that shows them; without any match, `families_not_read` lists them all. The exchange rates are not searched here: query_entities on `exchange_rates` reads them, and `not_searched_here` says so when the search words ask for rates or currencies. Vulnerabilities are not searched here: query_entities on `vulnerabilities` finds a CVE by `cve_id` or `q`. The roles, their rights and the data access of people (`roles`, `role_permissions`, `data_access`) are not searched here either: query_entities reads them, for an administrator of users with access to all data. ' + AI_UNREAD_FAMILIES_SENTENCE + ` ${AI_PAGE_URL_NOTE}`,
          inputSchema: SearchAllInputSchema,
          inputSummary: fieldDescriptions(SearchAllInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => this.withPageUrls(context, await this.entityTools.searchAll(context, input)),
        },
      ],
      [
        'describe_entity_filters',
        {
          name: 'describe_entity_filters',
          category: 'authoritative',
          description: 'Describes how one entity family can be filtered and sorted: each filter field with its aliases, expected value kinds, examples and lookup hints, plus `sort_fields` (every field query_entities sorts by, created_at and updated_at included, the keys of `field_families` aside) and `default_sort`. Useful before query_entities or aggregate_entities when field names or value formats are unknown. On budget lines, `budget_columns` gives each amount column the name the answer uses: the workspace\'s own name when set, otherwise the product name in the person\'s language (`names` in en, fr, de and es when the profile sets none, the one in the language of the conversation). The answer uses that name on its own, without the English default in brackets. `field_families` lists the staff cost, staff FTE, day cost and days of every year and column once per family, and `metric_families` the cost per FTE, the day rate, the change between two columns and the FTE by month aggregate_entities computes. `families_not_read` lists what KANAP holds and these tools do not read, with the screen that shows it in the person\'s language (in four languages when their profile sets none). `fields_withheld` names each field of the family this person may not read, for lack of a right, with the reason: the field is withheld, which says nothing of its values (they are not empty). `roles`, `role_permissions` and `data_access` are described for an administrator of users with access to all data only, as their screens. ' + REFERENCE_DATA_FAMILIES_SENTENCE,
          inputSchema: DescribeEntityFiltersInputSchema,
          inputSummary: fieldDescriptions(DescribeEntityFiltersInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            const screenLanguage = await readAiScreenLanguage(context.manager, context.tenantId, context.userId);
            // The budget lines list the tenant's analytics dimensions (`analytics:<code>`) among their fields.
            const description = {
              ...describeAiEntityFilters(input.entity_type, await resolveAiEntityRegistry(context, input.entity_type, (entityType) =>
                this.policy.canReadEntityType(context, entityType, context.manager))),
              families_not_read: unreadFamilyLines(
                screenLanguage,
                await this.policy.adminFamiliesGap(context, context.manager),
                await unreadFamiliesReachOf(this.policy, context, context.manager),
              ),
            };
            if (input.entity_type !== 'budget_lines') return description;
            // Amount field descriptions are positional; the column names come with them, in the person's language
            // (MCP clients have no system prompt). A workspace name wins over the product name.
            return {
              ...description,
              budget_columns: localizedBudgetColumnsAiContext(await readBudgetColumns(context.manager, context.tenantId), screenLanguage),
            };
          },
        },
      ],
      [
        'query_entities',
        {
          name: 'query_entities',
          category: 'authoritative',
          description: 'Lists the records of one entity family with server-side filters, sort and pagination, and returns the exact `total`. Each item carries its created_at and updated_at; the End of support report rows carry none (they are computed). `filters_ignored` lists the filters the server could not apply: the items are then not the requested set. A set filter given a value its field does not take (status active for enabled) is refused with status `invalid_filter_value` and `invalid_filter_values`, which lists the accepted values: nothing was searched, so it does not mean "none". On budget lines and contracts, `amount_totals` sums the amounts of every record the filters keep, all pages included: a total in the answer comes from it or from aggregate_entities, not from adding up items. `page_amount_totals` sums the same amounts over the items returned only: the total of the records listed, for example "the ten largest lines and their total" (a page of ten sorted on the amount). `data_access` limited means the person sees only part of the budget lines, contracts and their tasks: every count and total is "within your access", not the workspace total. For an administrator of users with access to all data, the families `roles` (each role with its count of people), `role_permissions` (one row per role and right it gives) and `data_access` (the people whose access is limited, one row per node; Administrators see all data and are not listed) read as Admin › Roles and Admin › Data access, and on users `primary_role` is the primary role only, `roles` every role of the person and `data_access` their access; a limited person without a node sees no budget or contract data, a limited access covers the budget and the contracts only, and who sees one company is in the company\'s get_entity_detail. `sort` is the order the items are in. `sort_ignored` names a requested sort field that is not supported: the items are then in the default order (with the reason in `fields_withheld` for a field this person may not read), and `sortable_fields` lists the fields a new query can sort by, which a question about order (latest, oldest, largest, first) needs. Items with the same sort value come in no particular order: when the first items share it (for example the same created_at), they tie, which a page of one item cannot show. A limit above the family\'s maximum is reduced and named in `limit_capped`. On budget lines and contracts, `amounts_currency` and `amounts_currency_note` give the currency of the returned amounts; an item\'s own `currency` is the one its amounts were entered in. On technologies, a question about what is out of support filters `support_status` on `out_of_support` (past every end of support, as the End of support report says); `extended_support` is past the standard end only, and `end_of_standard_support` and `end_of_support` date the first and the last end; each item\'s `versions_in_use` names the versions concerned. Every version of a technology is a row of the family `technology_versions`, with its own support dates, state and use: a question about versions no longer used filters `in_use` false, and one about versions ending in a year filters or groups `end_of_support_year`; a version has no detail of its own, and its technology\'s detail lists them. The records to complete and the deadlines of the End of support report are read through `support_gaps` and `support_deadlines`; an application\'s end of support is `end_of_support_date`. On vulnerabilities, an item is a CVE on one version of a technology (`ref` is the CVE id, so one CVE can come once per technology version); without a `state` or `alerts` filter, the list and the aggregates keep, as the vulnerabilities page, the rows to review (`state` to_review) that alert (`alerts` true), and `all` on either lifts that default; the counts per asset and per application keep the same rows; `servers_reached`, `applications_reached` and the `asset` and `application` filters follow direct links only; `page_url` opens the vulnerabilities page on the item. On vulnerabilities, `total` counts rows (technology, version, CVE) and `distinct_total` the distinct CVE among them, the two figures the page quotes ("117 rows (112 CVE)"), `feeds` gives each feed\'s last success and whether it is failing, and `estate` true keeps the technologies in use in the estate, so the home tile\'s figures (critical CVE published in the last 7 and 30 days, exploited CVE, in the estate) read with `estate` true and `severity`, `published_at` or `exploited`. On assets and applications, each item carries `open_vulnerabilities` and `severe_vulnerabilities`, the CVE to review that alert, by direct links (null when retired, out of service or with the feed off), and the `vulnerabilities` filter takes severe, any or none. To find the critical applications touched by an exploited CVE, query applications filtered on the top criticality and `vulnerabilities` severe, then query vulnerabilities filtered on their `application` references and `exploited` true. On contracts, each item carries its current term as the Contracts list shows it: `term_state` (to_decide, in_progress, renewed, ending, expired), `next_due_date`, `cancellation_deadline`, and `covered_applications`, the applications it covers (a Business Contributor\'s: those they take part in; null when the user cannot read applications, which is not "none"); the contracts to decide within the workspace\'s decision window (`describe_entity_filters` gives it), with the applications they cover, are one query filtered on `term_state` to_decide, and the `application` filter (APP-8) lists the contracts that cover an application. ' + CHARGEBACK_FAMILIES_SENTENCE + ` ${REFERENCE_DATA_FAMILIES_SENTENCE} ${AI_PAGE_URL_NOTE}`,
          inputSchema: QueryEntitiesInputSchema,
          inputSummary: fieldDescriptions(QueryEntitiesInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            return this.withPageUrls(context, await this.queryExecutor.execute(context, input));
          },
        },
      ],
      [
        'aggregate_entities',
        {
          name: 'aggregate_entities',
          category: 'authoritative',
          description: 'Groups the records of one entity family by a field and returns exact server-side counts, or the sum, average, minimum or maximum of a numeric or date field for each group. `filters_ignored` lists the filters the server could not apply: the figures then cover more records than requested. A set filter given a value its field does not take is refused with status `invalid_filter_value` and the accepted values in `invalid_filter_values`. A group by a linked record (a task by application or asset, an incident by asset, application or technology, a technology by IT or business owner) counts the record once per link: the group counts need not add up to `total`, and a record with no link is in none of them. `data_access` limited means the figures cover the person\'s access only: they are "within your access", not the workspace total. A sum or average of amounts names its currency in `amounts_currency` and `amounts_currency_note`: budget lines are in the reporting currency; contracts keep each contract\'s own currency, so a total across currencies needs a group or filter by currency. Budget lines are one family (`budget_lines`) of both natures: a budget question that names no nature (budget, FTE, staff, cost per FTE, day rate) covers both, and `nature` filters or groups one. On budget lines, `overall` is the measure over every line the filters keep, computed by the server, and the cost per FTE and the day rate are metrics the server computes (see metric), with `ratio_note` stating what they leave out. A change between two columns is the metric `<destination>_minus_<source>` (`y_review_minus_y_budget`; in FTE `y_review_fte_minus_y_budget_fte`), computed as the "Top increase / decrease" report: the groups that rise (or fall, with `direction`), largest change first, each with previous, current, delta and pct_increase, and `overall` with the net change and its gross increase and decrease over every line. Like the report, a question about the largest increases or decreases groups by `line`, unless the person names another axis (by supplier). The FTE month by month is the metric `<year>_<column>_fte_by_month` (`y_budget_fte_by_month`), computed as the "Staffing by month" report: each group\'s twelve months, average (÷ 12) and peak, with `monthly_fte_note` stating what they leave out. These budget figures read every line, ended ones included, while the budget reports read the lines still active on 1 January of the year before the first year they show: a line that ended earlier counts here and not in a report. On budget lines, `amounts_fx_missing` names the line currencies and years without an exchange rate whose amounts the values leave out: say so in the answer. On companies, a sum, average, minimum or maximum of turnover_year is in millions of the reporting currency (`amounts_currency` and `amounts_currency_note`); `turnover_fx_missing` names the companies left out for lack of a rate: say so in the answer. On vulnerabilities, a group\'s `count` counts rows and its `distinct_count` the distinct CVE, and `distinct_total` is the distinct CVE of the whole set, not a sum of groups: the CVE groups add up on the fields of the CVE itself (severity, score_source, exploited), while a CVE whose rows differ in state, technology, version, alerts or estate counts once in each of its groups. ' + CHARGEBACK_FAMILIES_SENTENCE + ` ${REFERENCE_DATA_FAMILIES_SENTENCE}`,
          inputSchema: AggregateEntitiesInputSchema,
          inputSummary: fieldDescriptions(AggregateEntitiesInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            return this.aggregateExecutor.execute(context, input);
          },
        },
      ],
      [
        'get_filter_values',
        {
          name: 'get_filter_values',
          category: 'authoritative',
          description: 'Returns the exact values that exist for set-like filter fields of one entity family (statuses, categories, owners and similar), as accepted by the filters of query_entities and aggregate_entities. `fields_ignored` lists the requested fields this family cannot filter on; `fields_withheld` names those this person may not read, for lack of a right, with the reason: their values are withheld, not empty.',
          inputSchema: GetFilterValuesInputSchema,
          inputSummary: fieldDescriptions(GetFilterValuesInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            return this.queryExecutor.executeFilterValues(context, input);
          },
        },
      ],
      [
        'get_application_classification_catalog',
        {
          name: 'get_application_classification_catalog',
          category: 'authoritative',
          description: 'Return the complete tenant application-classification catalog: business criticality levels (with their optional maximum tolerable downtime in minutes, an attribute of the level and not of the application), cyber and confidentiality severity ranks, recovery-wave order and deprecated historical levels. Lists are ordered from most to least severe; waves in restoration order. Use it before interpreting, filtering, sorting, or writing a classification. Codes are authoritative; deprecated values remain readable but cannot be newly assigned.',
          inputSchema: GetApplicationClassificationCatalogInputSchema,
          inputSummary: {},
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context) => {
            await this.policy.assertEntityTypeReadAccess(context, 'applications', context.manager);
            if (!this.itOpsSettings) throw new BadRequestException('Application classification catalog is unavailable.');
            const catalog = await this.itOpsSettings.getClassificationCatalog(context.tenantId, { manager: context.manager });
            return {
              ...catalog,
              durationUnit: 'minutes',
              assignmentPolicy: 'Only active levels may be newly assigned. Deprecated levels remain readable for historical records.',
              businessPolicy: 'Business criticality is chosen directly among the tenant levels. Level definitions may mention a maximum tolerable downtime; applications do not store a downtime of their own.',
            };
          },
        },
      ],
      [
        'get_entity_detail',
        {
          name: 'get_entity_detail',
          category: 'inspection',
          description: 'Returns one record with all its scalar fields and its attachment metadata, by UUID or reference (APP-4, PRJ-12, BL-5...). query_entities suits lists; this tool gives the full detail of one known record. A vulnerability read by its CVE id is that CVE\'s first row (exploited, then most severe), and `rows` lists every technology version the CVE concerns in the workspace. On budget lines and contracts, `amounts_currency_note` says which amounts are in the reporting currency and which in the record\'s own currency. A contract comes with its current term (`term_state`, `next_due_date`, `cancellation_deadline`) and what it covers: `linked_applications` (a Business Contributor\'s: those they take part in), `linked_assets`, `linked_technologies`, its budget lines (`linked_budget_lines`, each with its `nature` and `mismatches`) and `budget_lines_outside_access`, the linked lines outside the user\'s data access; a family the user cannot read is null, which is not "none". `mismatches` on a linked budget line or a linked contract lists each differing field (`paying_company`, `cost_center`, `supplier`, `currency`) with `line_value` and `contract_value`; an empty array means the two records agree. A record the user cannot read is left out, so a missing row is not a match.' + ` ${AI_PAGE_URL_NOTE}`,
          inputSchema: GetEntityDetailInputSchema,
          inputSummary: fieldDescriptions(GetEntityDetailInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input): Promise<AiEntityDetailDto> => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            return this.withPageUrls(context, await this.queryExecutor.executeDetail(context, input));
          },
        },
      ],
      [
        'get_entity_context',
        {
          name: 'get_entity_context',
          category: 'inspection',
          description: 'Returns one application, asset, project, request, task, technology or contract with the records linked to it, by UUID or reference (APP-4, AST-9, PRJ-12, REQ-7, T-42, TEC-3; a contract by UUID). Applications and assets come with their related applications or assets, linked projects and requests, and their technologies (an asset: installed on it or carried to it; an application: declared, or deduced from its servers, for a user who reads technologies); technologies with the servers they are installed on and the applications that declare them or are deduced from those servers (for a user who reads applications); projects with their source requests, tasks, dependencies, linked applications, assets and documents; requests with their resulting projects, dependencies, linked applications and assets; tasks with their project, converted request, linked applications and assets; contracts with their current term and the applications, assets, technologies and budget lines they cover (a family that is empty or that the user cannot read is left out, so a missing family is not "none": get_entity_detail tells them apart). A budget line in that contract context carries `contract_mismatches` in its metadata: null when the line agrees with the contract, otherwise one note per differing field with the value on the line and the value on the contract. get_entity_detail returns the same differences as `mismatches`. Every record but a technology or a contract also lists the knowledge documents linked to it, and projects and tasks their recent activity. A group with a `total` lists at most 25 records; `truncated` is true when a group or the recent activity holds more entries than returned. The entity carries an extract of its fields (`fields_note`): a field absent from its metadata is not read here, which is not "empty"; get_entity_detail gives every field (an application\'s context does carry its classifications, RTO, RPO, recovery wave, last recovery test and end of support).' + ` ${AI_PAGE_URL_NOTE}`,
          inputSchema: GetEntityContextInputSchema,
          inputSummary: fieldDescriptions(GetEntityContextInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => this.withPageUrls(context, await this.entityTools.getEntityContext(context, input)),
        },
      ],
      [
        'get_entity_comments',
        {
          name: 'get_entity_comments',
          category: 'inspection',
          description: 'Returns the discussion comments of one project or task, newest first, with offset and limit for older ones. It holds what people wrote, without the field changes that the recent activity of get_entity_context mixes in.',
          inputSchema: GetEntityCommentsInputSchema,
          inputSummary: fieldDescriptions(GetEntityCommentsInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: (context, input) => this.entityTools.getEntityComments(context, input),
        },
      ],
      [
        'get_record_history',
        {
          name: 'get_record_history',
          category: 'inspection',
          description: `Returns the history of one record, newest first, as its History tab shows it: who did what and when (creation, each change with its before and after values, deletion), with next_cursor for older entries. The records with a history: ${AI_RECORD_HISTORY_FAMILY_WORDS}. The other families have no History tab in KANAP, so no history here.`,
          inputSchema: GetRecordHistoryInputSchema,
          inputSummary: fieldDescriptions(GetRecordHistoryInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: (context, input) => {
            if (!this.recordHistory) throw new BadRequestException('The record history is unavailable.');
            return this.recordHistory.getRecordHistory(context, input);
          },
        },
      ],
      [
        'search_knowledge',
        {
          name: 'search_knowledge',
          category: 'discovery',
          description: 'Full-text search over the knowledge base documents the user can read, by words or by DOC reference (DOC-14). Returns each match\'s reference, title, summary, status, a text snippet, a relevance score, its library and its last update, with the `total` number of matches; `truncated` is true when more matches exist past offset + limit. get_document returns a document\'s full content.',
          inputSchema: SearchKnowledgeInputSchema,
          inputSummary: fieldDescriptions(SearchKnowledgeInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertKnowledgeReadAccess(context, context.manager);
            const result = await this.knowledge.search(
              { q: input.query, offset: input.offset, limit: input.limit, matchMode: 'any' },
              { manager: context.manager, userId: context.userId },
            );
            return {
              items: (result.items || []).map((item: any): AiKnowledgeSearchResultDto => ({
                id: item.id,
                ref: `DOC-${item.item_number}`,
                title: item.title,
                summary: item.summary ?? null,
                status: item.status,
                snippet: item.snippet ?? null,
                score: Number.isFinite(Number(item.score ?? item.rank))
                  ? Number(item.score ?? item.rank)
                  : null,
                library: {
                  id: item.library_id ?? null,
                  name: item.library_name ?? null,
                },
                updated_at: item.updated_at ? new Date(item.updated_at).toISOString() : null,
              })),
              total: result.total ?? 0,
              offset: result.offset ?? input.offset,
              limit: result.limit ?? input.limit,
              returned: Array.isArray(result.items) ? result.items.length : 0,
              truncated: result.truncated === true,
              complete: false,
            };
          },
        },
      ],
      [
        'get_document',
        {
          name: 'get_document',
          category: 'inspection',
          description: 'Returns one knowledge document by UUID or DOC reference (DOC-123): its full content as Markdown in `content_markdown`, with its title, summary, status, library, folder, document type, contributors, and the applications, assets, projects, requests and tasks it is linked to.',
          inputSchema: GetDocumentInputSchema,
          inputSummary: fieldDescriptions(GetDocumentInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertKnowledgeReadAccess(context, context.manager);
            const document = await this.knowledge.get(input.document_id, { manager: context.manager, userId: context.userId });
            if (!document) {
              throw new NotFoundException('Document not found.');
            }
            const result: AiDocumentDto = {
              id: document.id,
              ref: document.item_ref ?? `DOC-${document.item_number}`,
              title: document.title,
              summary: document.summary ?? null,
              status: document.status,
              content_markdown: document.content_markdown ?? '',
              updated_at: document.updated_at ? new Date(document.updated_at).toISOString() : null,
              library: {
                id: document.library_id ?? null,
                name: document.library_name ?? null,
                slug: document.library_slug ?? null,
              },
              folder: {
                id: document.folder_id ?? null,
                name: document.folder_name ?? null,
              },
              document_type: {
                id: document.document_type_id ?? null,
                name: document.document_type_name ?? null,
              },
              // The families the reader reads (`knowledge.get` leaves the others out): absent, never empty.
              relations: Object.fromEntries(
                (['applications', 'assets', 'projects', 'requests', 'tasks'] as const)
                  .filter((family) => Array.isArray(document.relations?.[family]))
                  .map((family) => [family, document.relations[family].map((row: any) => toDocumentRelation(family, row))]),
              ),
              contributors: (document.contributors || []).map((row: any) => ({
                name: row.user_name ?? 'Unknown user',
                role: row.role,
                is_primary: row.is_primary === true,
              })),
              total: 1,
              returned: 1,
              truncated: false,
              complete: true,
            };
            return result;
          },
        },
      ],
      [
        'list_help_topics',
        {
          name: 'list_help_topics',
          category: 'discovery',
          description: 'Lists the pages of the KANAP user manual, the manual of this version, with their path, title, doc.kanap.net address and sections. Without words, every page with its main sections; with words, the pages that hold them, best first, with the sections and subsections where they appear (`Parent › Child`). read_help_section reads a page or a section. The manual describes the screens, menus, buttons and steps of KANAP as they are in this version.',
          inputSchema: ListHelpTopicsInputSchema,
          inputSummary: fieldDescriptions(ListHelpTopicsInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => this.helpManual!.listTopics(await this.helpLanguage(context, input.language), input.query),
        },
      ],
      [
        'read_help_section',
        {
          name: 'read_help_section',
          category: 'inspection',
          description: `Returns one page of the KANAP user manual, or one of its sections, as Markdown text with its doc.kanap.net address (\`url\`, with the section's anchor) to give the person as the link. \`subsections\` names the sections inside it. The text holds at most ${HELP_SECTION_MAX_CHARS.toLocaleString('en-US')} characters: when \`truncated\` is true, read one of its sections. Links in the text point to doc.kanap.net.`,
          inputSchema: ReadHelpSectionInputSchema,
          inputSummary: fieldDescriptions(ReadHelpSectionInputSchema),
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => this.helpManual!.readSection(await this.helpLanguage(context, input.language), input.page, input.section),
        },
      ],
      [
        'prepare_mutation_plan',
        {
          name: 'prepare_mutation_plan',
          category: 'mutation',
          description: 'Prepare a durable group of write-preview steps, including dependent steps that can only be previewed after earlier previews execute. Requires explicit user approval for every created preview before execution.',
          inputSchema: PrepareMutationPlanInputSchema,
          inputSummary: {
            summary: 'Short description of the overall mutation plan.',
            target_set_label: 'Optional label for the resolved target set and assumptions.',
            expected_target_refs: 'Optional canonical refs for every resolved target expected to receive a preview.',
            expected_target_count: 'Optional expected number of targets in the resolved target set.',
            explicit_exclusions: 'Optional targets found but deliberately excluded, each with a reason.',
            operations: 'Ordered write-preview steps. Use operation_id for dependency keys, depends_on for prerequisites, and placeholders such as {{create_project.ref}} in dependent inputs.',
          },
          surfaces: ['chat'],
          readOnly: false,
          writePreview: {
            entity_type: 'mutation_plan',
            fields: ['operations'],
            reversible: false,
            prompt_hint: 'For multiple related changes, mixed object changes, dependencies, or bulk target-set tracking, prefer `prepare_mutation_plan`. Give each step a stable `operation_id`; use `depends_on` and placeholders like `{{create_project.ref}}`, `{{create_project.id}}`, or `{{create_project.title}}` in dependent step inputs. When a bulk target set is known, include expected_target_refs/expected_target_count and explicit_exclusions for any intentionally excluded targets.',
          },
          execute: (context, input) => this.previews.createMutationPlan(context, input),
        },
      ],
      [
        'update_task_assignees',
        {
          name: 'update_task_assignees',
          category: 'mutation',
          description: 'Create assignee-change previews for several tasks in one call. Requires explicit user approval before execution.',
          inputSchema: UpdateTaskAssigneesInputSchema,
          inputSummary: {
            refs: 'Task references such as T-41, T-38, and T-37. Include every resolved target task.',
            assignee_email: 'The assignee email address in the current tenant.',
          },
          surfaces: ['chat'],
          readOnly: false,
          writePreview: {
            entity_type: 'tasks',
            fields: ['assignee'],
            reversible: true,
            prompt_hint: 'For bulk task reassignment, prefer `update_task_assignees` with all target task refs and the assignee email; it returns one backend preview per task.',
          },
          execute: async (context, input) => {
            const previews: AiMutationPreviewDto[] = [];
            const errors: Array<{ ref: string; message: string }> = [];
            const expectedRefs = normalizeBulkTargetRefs(input.refs);

            for (const ref of input.refs) {
              try {
                const preview = await this.previews.createPreview(context, 'update_task_assignee', {
                  ref,
                  assignee_email: input.assignee_email,
                });
                previews.push(preview);
              } catch (err: any) {
                errors.push({
                  ref,
                  message: dataAccessRefusalMessage(err) ?? (err?.message || 'Preview creation failed.'),
                });
              }
            }

            const coveredRefs = normalizeBulkTargetRefs(previews.map((preview) => preview.target.ref));
            const coveredRefSet = new Set(coveredRefs);
            const failedRefSet = new Set(normalizeBulkTargetRefs(errors.map((error) => error.ref)));
            const missingRefs = expectedRefs.filter((ref) =>
              !coveredRefSet.has(ref)
              && !failedRefSet.has(ref),
            );
            return {
              previews,
              errors,
              total: input.refs.length,
              created: previews.length,
              failed: errors.length,
              expected_count: expectedRefs.length,
              expected_refs: expectedRefs,
              covered_refs: coveredRefs,
              missing_refs: missingRefs,
              excluded: [],
              complete: errors.length === 0 && missingRefs.length === 0,
            };
          },
        },
      ],
      [
        'undo_preview',
        {
          name: 'undo_preview',
          category: 'mutation',
          description: 'Create a reversal preview for a previously executed reversible AI write. Requires explicit user approval before execution.',
          inputSchema: UndoPreviewInputSchema,
          inputSummary: {
            preview_id: 'The preview ID of a previously executed task write in this conversation.',
          },
          surfaces: ['chat'],
          readOnly: false,
          execute: async (context, input) => {
            return this.previews.createReversePreview(context, input.preview_id);
          },
        },
      ],
      [
        'web_search',
        {
          name: 'web_search',
          category: 'discovery',
          description: 'Search the web for current information. Use when you need up-to-date facts, EOL dates, product details, or any information not available in the KANAP database.',
          inputSchema: WebSearchInputSchema,
          inputSummary: {
            query: 'Web search query using only generic, publicly meaningful terms.',
            count: 'Number of results to return (1–10, default 5).',
          },
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (_context, input) => {
            const results = await this.braveSearch.search(input.query, { count: input.count });
            return {
              items: results,
              total: null,
              returned: results.length,
              truncated: false,
              complete: false,
            };
          },
        },
      ],
    ]);

    for (const operation of this.mutationOperations.listOperations()) {
      this.definitions.set(operation.toolName, {
        name: operation.toolName,
        category: 'mutation',
        description: operation.description,
        inputSchema: operation.inputSchema,
        inputSummary: operation.inputSummary,
        surfaces: ['chat'],
        readOnly: false,
        writePreview: operation.writePreview,
        execute: async (context, input) => this.previews.createPreview(context, operation.toolName, input),
      });
    }
  }

  private getRegisteredDefinitions(): AiToolDefinition<any, any>[] {
    return Array.from(this.definitions.values());
  }

  private getDefinition(toolName: string): AiToolDefinition<any, any> {
    const definition = this.definitions.get(toolName as AiToolName);
    if (!definition) {
      throw new NotFoundException('Unknown AI tool.');
    }
    return definition;
  }

  listRegisteredTools(): Array<{
    name: AiToolName;
    category: AiToolCategory;
    description: string;
    inputSummary: Record<string, string>;
    surfaces: string[];
    readOnly: boolean;
  }> {
    return this.getRegisteredDefinitions().map((definition) => ({
      name: definition.name,
      category: definition.category,
      description: definition.description,
      inputSummary: definition.inputSummary,
      surfaces: [...definition.surfaces],
      readOnly: definition.readOnly,
    }));
  }

  private async isToolAvailable(
    toolName: AiToolName,
    context: AiExecutionContextWithManager,
    availability?: {
      readableEntityTypes: string[];
      canReadKnowledge: boolean;
      webSearchEnabled: boolean;
      writableMutationToolNames: Set<AiToolName>;
      canUndoPreview: boolean;
    },
  ): Promise<boolean> {
    // Lazy-load availability context if not pre-computed
    const avail = availability ?? await this.loadAvailabilityContext(context);
    const mutationOperation = this.mutationOperations.getOperationOrNull(toolName);
    if (mutationOperation) {
      return avail.writableMutationToolNames.has(mutationOperation.toolName);
    }

    switch (toolName) {
      case 'search_all':
      case 'describe_entity_filters':
      case 'query_entities':
      case 'aggregate_entities':
      case 'get_filter_values':
      case 'get_application_classification_catalog':
      case 'get_entity_detail':
        return toolName === 'get_application_classification_catalog'
          ? avail.readableEntityTypes.includes('applications')
          : AI_DETAIL_ENTITY_TYPES.some((type) => avail.readableEntityTypes.includes(type));
      case 'get_entity_context':
        return AI_CONTEXT_ENTITY_TYPES.some((type) => avail.readableEntityTypes.includes(type));
      case 'get_entity_comments':
        return avail.readableEntityTypes.includes('projects') || avail.readableEntityTypes.includes('tasks');
      case 'get_record_history':
        // Offered to a person who reads one family with a history; the record's own right is checked on the call.
        return !!this.recordHistory && AI_RECORD_HISTORY_ENTITY_TYPES.some((type) => avail.readableEntityTypes.includes(type));
      case 'search_knowledge':
      case 'get_document':
        return avail.canReadKnowledge;
      case 'list_help_topics':
      case 'read_help_section':
        // The manual is public: every person who may use the assistant reads it.
        return this.helpManual?.available() === true;
      case 'prepare_mutation_plan':
        return avail.writableMutationToolNames.size > 0;
      case 'update_task_assignees':
        return avail.writableMutationToolNames.has('update_task_assignee');
      case 'undo_preview':
        return avail.writableMutationToolNames.size > 0 && avail.canUndoPreview;
      case 'web_search':
        return Features.AI_WEB_SEARCH_READY && avail.webSearchEnabled;
      default:
        return false;
    }
  }

  private async isMutationOperationConfigured(
    toolName: AiToolName,
    settings: AiSettings | null,
    context: AiExecutionContextWithManager,
  ): Promise<boolean> {
    switch (toolName) {
      case 'import_glpi_ticket':
        return settings?.glpi_enabled === true
          && !!settings.glpi_url
          && !!settings.glpi_user_token_encrypted;
      case 'import_ticket':
        if (settings?.glpi_enabled === true && !!settings.glpi_url && !!settings.glpi_user_token_encrypted) {
          return true;
        }
        if (typeof (context.manager as { getRepository?: unknown }).getRepository !== 'function') {
          return false;
        }
        try {
          const configs = await context.manager.getRepository(AiAdapterConfig).find({
            where: {
              tenant_id: context.tenantId,
              provider_kind: 'ticketing',
              enabled: true,
            },
          });
          return configs.some((config) => {
            if (config.implementation === 'mock') {
              return true;
            }
            const credential = parseCredentialRef(config.credential_ref_json);
            return !!credential && credential.kind !== 'none';
          });
        } catch {
          return false;
        }
      case 'change_vulnerability_state':
        // As the screen's routes (`VulnerabilityFeedGuard`): no state change while the feed is off.
        return Features.VULNERABILITY_FEED_ENABLED;
      default:
        return true;
    }
  }

  private async loadAvailabilityContext(context: AiExecutionContextWithManager) {
    const readableEntityTypes = await this.policy.listReadableEntityTypes(
      context,
      [...AI_QUERY_ENTITY_TYPES],
      context.manager,
    );
    const canReadKnowledge = await this.policy.canReadKnowledge(context, context.manager);
    const settings = await this.settingsService.find(context.tenantId, { manager: context.manager });
    const webSearchEnabled = settings?.web_search_enabled === true;

    const operationResources = (operation: { businessResource: string; businessResources?: readonly string[] }) =>
      operation.businessResources && operation.businessResources.length > 0
        ? operation.businessResources
        : [operation.businessResource];

    // A tool is offered when the person holds one of its modules at the level of the screen route
    // that makes the same change (`member`, or `contributor` where the screen opens it, lot D11).
    const writeAccessByRequirement = new Map<string, boolean>();
    const canWrite = async (requirement: { resource: string; level: PermissionLevel }): Promise<boolean> => {
      const key = `${requirement.resource}:${requirement.level}`;
      if (!writeAccessByRequirement.has(key)) {
        try {
          await this.policy.assertWriteAccess(context, requirement.resource, context.manager, { level: requirement.level });
          writeAccessByRequirement.set(key, true);
        } catch {
          writeAccessByRequirement.set(key, false);
        }
      }
      return writeAccessByRequirement.get(key) === true;
    };

    const writableMutationToolNames = new Set<AiToolName>();
    for (const operation of this.mutationOperations.listOperations()) {
      let writable = false;
      for (const requirement of aiWriteRequirements(operation.toolName, operationResources(operation))) {
        if (await canWrite(requirement)) {
          writable = true;
          break;
        }
      }
      if (!writable) {
        continue;
      }
      if (!await this.isMutationOperationConfigured(operation.toolName, settings, context)) {
        continue;
      }
      writableMutationToolNames.add(operation.toolName);
    }
    // Keep the legacy GLPI operation registered so existing previews and
    // compatibility paths can still execute, but stop advertising it to new
    // chat/tool turns once the provider-keyed import surface is available.
    if (writableMutationToolNames.has('import_ticket')) {
      writableMutationToolNames.delete('import_glpi_ticket');
    }

    const canUndoPreview = writableMutationToolNames.size > 0
      ? await this.previews.hasExecutedUndoablePreviewInConversation(context, context.conversationId ?? null)
      : false;

    return { readableEntityTypes, canReadKnowledge, webSearchEnabled, writableMutationToolNames, canUndoPreview };
  }

  async listAvailableTools(context: AiExecutionContextWithManager): Promise<AiToolListItemDto[]> {
    await this.policy.assertSurfaceAccess(context, context.manager);

    const availability = await this.loadAvailabilityContext(context);

    const results: AiToolListItemDto[] = [];
    for (const definition of this.getRegisteredDefinitions()) {
      if (!definition.surfaces.includes(context.surface)) continue;
      if (!await this.isToolAvailable(definition.name, context, availability)) continue;
      results.push({
        name: definition.name,
        category: definition.category,
        description: definition.description,
        input_summary: definition.inputSummary,
        read_only: definition.readOnly,
        surfaces: definition.surfaces,
        write_preview: definition.writePreview,
      });
    }
    return results;
  }

  async getToolJsonSchemas(context: AiExecutionContextWithManager): Promise<AiProviderToolDef[]> {
    const available = await this.listAvailableTools(context);
    return this.toToolJsonSchemas(available);
  }

  toToolJsonSchemas(tools: Array<Pick<AiToolListItemDto, 'name'>>): AiProviderToolDef[] {
    return tools.map((item) => {
      const definition = this.definitions.get(item.name)!;
      const jsonSchema = normalizeJsonSchemaForProviders(
        z.toJSONSchema(definition.inputSchema as any, { target: 'openapi-3.0', io: 'input' }),
      );
      return {
        name: definition.name,
        description: definition.description,
        parameters: jsonSchema as Record<string, unknown>,
      };
    });
  }

  /**
   * `page_url` on the records of a read result (`ai-page-urls.ts`), for the pages the user may open.
   * An MCP client is outside the application: its addresses are absolute when the server knows the
   * workspace address (`resolveConfiguredAppBaseUrl`, as the links of the emails).
   */
  private async withPageUrls<T>(context: AiExecutionContextWithManager, result: T): Promise<T> {
    return withAiPageUrls(result, {
      readableResources: (resources) => this.policy.readableResources(context, resources, context.manager),
      origin: async () => {
        if (context.surface !== 'mcp') return null;
        const [tenant]: Array<{ slug: string }> = await context.manager.query('SELECT slug FROM tenants WHERE id = $1', [context.tenantId]);
        return resolveConfiguredAppBaseUrl(tenant?.slug ?? null);
      },
    });
  }

  /** The language a manual tool reads: the one asked for, else the person's interface language, else English. */
  private async helpLanguage(context: AiExecutionContextWithManager, language: string | undefined) {
    return (language as AiScreenLanguage | undefined)
      ?? await readAiScreenLanguage(context.manager, context.tenantId, context.userId)
      ?? 'en';
  }

  async execute(
    context: AiExecutionContextWithManager,
    toolName: string,
    rawInput: unknown,
  ): Promise<unknown> {
    // Deprecated-name alias: the legacy GLPI import tool is de-advertised once
    // the generic tool is available, but a by-name call (e.g. the model echoing
    // a stale name from conversation history) must keep working. Mirrors
    // normalizePlanOperationForCompatibility in ai-mutation-preview.service.
    if (toolName === 'import_glpi_ticket' && await this.isToolAvailable('import_ticket', context)) {
      toolName = 'import_ticket';
      rawInput = {
        ...(typeof rawInput === 'object' && rawInput !== null ? rawInput as Record<string, unknown> : {}),
        provider_key: LEGACY_GLPI_TICKETING_PROVIDER_KEY,
      };
    }
    await this.policy.assertSurfaceAccess(context, context.manager);
    const definition = this.getDefinition(toolName);
    if (!definition.surfaces.includes(context.surface)) {
      throw new BadRequestException('AI tool is not available on this surface.');
    }

    if (!await this.isToolAvailable(definition.name, context)) {
      throw new BadRequestException('AI tool is not available.');
    }

    const parsed = definition.inputSchema.safeParse(rawInput, { reportInput: true });
    if (!parsed.success) {
      throw new BadRequestException({
        message: invalidInputMessage(definition.name, describeZodIssues(parsed.error.issues)),
        ...legacyFlattenError(parsed.error),
      });
    }

    return definition.execute(context, parsed.data);
  }
}
