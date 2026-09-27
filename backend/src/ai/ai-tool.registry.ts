import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { z } from 'zod';
import zodToJsonSchema from 'zod-to-json-schema';
import { Features } from '../config/features';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { ItOpsSettingsService } from '../it-ops-settings/it-ops-settings.service';
import { AiMutationPreviewService } from './ai-mutation-preview.service';
import { AiEntityService } from './ai-entity.service';
import { AiPolicyService } from './ai-policy.service';
import { AiSettingsService } from './ai-settings.service';
import { AiProviderToolDef } from './providers/ai-provider.types';
import { BraveSearchService } from './web-search/brave-search.service';
import { AiAggregateExecutor } from './query/ai-aggregate.executor';
import { AiQueryExecutor } from './query/ai-query.executor';
import { describeAiEntityFilters } from './query/ai-filter-description.util';
import { budgetColumnsAiContext, readBudgetColumns } from '../budget-columns/budget-columns.util';
import { AiMutationOperationRegistry } from './mutation/ai-mutation-operation.registry';
import { AiSettings } from './ai-settings.entity';
import { AiAdapterConfig } from './control-plane/providers/adapter-config.entity';
import { parseCredentialRef } from './control-plane/providers/adapter-config.service';
import { LEGACY_GLPI_TICKETING_PROVIDER_KEY } from './control-plane/providers/provider-constants';
import {
  AI_CONTEXT_ENTITY_TYPES,
  AI_QUERY_ENTITY_TYPES,
  AiContextEntityTypeSchema,
  AiDocumentDto,
  AiEntityDetailDto,
  AiEntitySummaryDto,
  AiExecutionContextWithManager,
  AiKnowledgeSearchResultDto,
  AiMutationPreviewDto,
  AiToolCategory,
  AiQueryEntityTypeSchema,
  AiQueryScopeSchema,
  AiSearchEntityTypeSchema,
  AiToolDefinition,
  AiToolListItemDto,
  AiToolName,
} from './ai.types';

const SearchAllInputSchema = z.object({
  query: z.string().trim().min(1),
  entity_types: z.array(AiSearchEntityTypeSchema).optional(),
  limit: z.number().int().min(1).max(100).default(25),
});

const GetEntityContextInputSchema = z.object({
  entity_type: AiContextEntityTypeSchema,
  entity_id: z.string().trim().min(1),
});

const GetEntityDetailInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema,
  entity_id: z.string().trim().min(1).describe('Entity UUID or canonical reference when that entity supports references.'),
  year: z.number().int().min(1900).max(3000).optional()
    .describe('Optional fiscal/calendar year for year-backed metrics on supported entities such as companies and departments.'),
});

const GetEntityCommentsInputSchema = z.object({
  entity_type: z.enum(['projects', 'tasks']).describe('The entity family: projects or tasks.'),
  entity_id: z.string().trim().min(1).describe('The project/task UUID or canonical reference such as PRJ-12 or T-42.'),
  offset: z.number().int().min(0).max(5000).default(0).describe('Zero-based comment offset for pagination.'),
  limit: z.number().int().min(1).max(100).default(20).describe('Maximum number of comments to return.'),
});

const SearchKnowledgeInputSchema = z.object({
  query: z.string().trim().min(1),
  offset: z.number().int().min(0).max(5000).default(0),
  limit: z.number().int().min(1).max(200).default(20),
});

const GetDocumentInputSchema = z.object({
  document_id: z.string().trim().min(1),
});

const AiFilterValueSchema = z.union([
  z.array(z.union([z.string(), z.null()])),
  z.string(),
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
  entity_type: AiQueryEntityTypeSchema,
  scope: AiQueryScopeSchema.optional(),
  filters: z.record(z.string(), AiFilterValueSchema).optional(),
  q: z.string().trim().optional(),
  year: z.number().int().min(1900).max(3000).optional()
    .describe('Optional fiscal/calendar year for year-backed metrics on supported entities such as companies and departments. Defaults to the current year when metric fields are included.'),
  sort: z.object({
    field: z.string().trim().min(1),
    direction: z.enum(['asc', 'desc']),
  }).optional(),
  page: z.number().int().min(1).max(100).default(1),
  limit: z.number().int().min(1).max(200).default(200),
});

const DescribeEntityFiltersInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema,
});

const AggregateEntitiesInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema,
  scope: AiQueryScopeSchema.optional(),
  group_by: z.string().trim().min(1),
  metric: z.string().trim().min(1).optional(),
  function: z.enum(['count', 'sum', 'avg', 'min', 'max']).optional(),
  filters: z.record(z.string(), AiFilterValueSchema).optional(),
  q: z.string().trim().optional(),
});

const GetFilterValuesInputSchema = z.object({
  entity_type: AiQueryEntityTypeSchema,
  fields: z.array(z.string().trim().min(1)).min(1).max(10),
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

const QUERY_ENTITY_TYPE_SUMMARY = AI_QUERY_ENTITY_TYPES.join(', ');
const CONTEXT_ENTITY_TYPE_SUMMARY = AI_CONTEXT_ENTITY_TYPES.join(', ');

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
    && normalized.type === undefined
    && Array.isArray(normalized.enum)
    && normalized.enum.length === 1
    && normalized.enum[0] === 'null'
  ) {
    return { type: 'null' };
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
  ) {
    this.definitions = new Map<AiToolName, AiToolDefinition<any, any>>([
      [
        'search_all',
        {
          name: 'search_all',
          category: 'discovery',
          description: 'Search across readable KANAP entity families using stable AI DTOs. If complete=true and truncated=false, use the returned results instead of repeating broad searches; if failed_entity_types is non-empty, treat the answer as partial and prefer a specific authoritative tool.',
          inputSchema: SearchAllInputSchema,
          inputSummary: {
            query: 'Search text or item reference such as PRJ-12, REQ-7, T-42, DOC-3, or INC-12.',
            entity_types: 'Optional entity families to include.',
            limit: 'Maximum number of results to return (default 25, max 100). Raise limit or page with offset only when the first page is insufficient. If truncated=true, narrow the query or switch to a more specific tool.',
          },
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: (context, input) => this.entityTools.searchAll(context, input),
        },
      ],
      [
        'describe_entity_filters',
        {
          name: 'describe_entity_filters',
          category: 'authoritative',
          description: 'Describe supported AI filter fields for one readable entity family, including aliases, expected value kinds, examples, and lookup hints. Use this before structured filtering when field names or value formats are uncertain.',
          inputSchema: DescribeEntityFiltersInputSchema,
          inputSummary: {
            entity_type: `One of ${QUERY_ENTITY_TYPE_SUMMARY}.`,
          },
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            const description = describeAiEntityFilters(input.entity_type);
            if (input.entity_type !== 'spend_items' && input.entity_type !== 'capex_items') return description;
            // Amount field descriptions are positional; the tenant's column names come with them (MCP clients have no system prompt).
            return { ...description, budget_columns: budgetColumnsAiContext(await readBudgetColumns(context.manager, context.tenantId)) };
          },
        },
      ],
      [
        'query_entities',
        {
          name: 'query_entities',
          category: 'authoritative',
          description: 'Query one readable entity family with server-side filters, pagination, and exact totals. If `filters_ignored` is non-empty, the query was not fully honored and must be repaired before answering.',
          inputSchema: QueryEntitiesInputSchema,
          inputSummary: {
            entity_type: `One of ${QUERY_ENTITY_TYPE_SUMMARY}.`,
            scope: 'Optional first-person scope. Use "me" or "my_team" for tasks, projects, and requests.',
            filters: 'Optional field filters keyed by AI field name. Use describe_entity_filters when unsure which fields or value formats are supported.',
            q: 'Optional literal quick-search text. Use plain text only; never encode filters like status:in_progress or assignee=bob@example.com here.',
            year: 'Optional fiscal/calendar year for year-backed metrics, such as company headcount, IT users, turnover, and department headcount. Defaults to the current year when metric fields are included.',
            sort: 'Optional sort field and direction.',
            page: 'Page number to fetch (default 1). Use later pages when total is greater than returned.',
            limit: 'Maximum number of items to return per page (default 200). Use the maximum unless you have a reason to limit.',
          },
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input) => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            return this.queryExecutor.execute(context, input);
          },
        },
      ],
      [
        'aggregate_entities',
        {
          name: 'aggregate_entities',
          category: 'authoritative',
          description: 'Break down one readable entity family by a supported field with exact server-side counts or metric aggregations. If `filters_ignored` is non-empty, the query was not fully honored and must be repaired before answering.',
          inputSchema: AggregateEntitiesInputSchema,
          inputSummary: {
            entity_type: `One of ${QUERY_ENTITY_TYPE_SUMMARY}.`,
            scope: 'Optional first-person scope. Use "me" or "my_team" for tasks, projects, and requests.',
            group_by: 'A supported group-by field from the query layer registry.',
            metric: 'Optional numeric or date field to aggregate when using sum, avg, min, or max.',
            function: 'Optional aggregation function: count, sum, avg, min, or max. Defaults to count.',
            filters: 'Optional field filters keyed by AI field name.',
            q: 'Optional literal quick-search text. Use plain text only; never encode filters like status:in_progress or assignee=bob@example.com here.',
          },
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
          description: 'Discover exact filter values for supported set-like AI query fields. If `fields_ignored` is non-empty, those field names are unsupported for that entity and must not be used for filtering.',
          inputSchema: GetFilterValuesInputSchema,
          inputSummary: {
            entity_type: `One of ${QUERY_ENTITY_TYPE_SUMMARY}.`,
            fields: 'AI field names to inspect.',
          },
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
          description: 'Return one readable business/domain entity as a detailed AI-safe DTO. Use query_entities for long lists, then call this for the specific item that needs full scalar detail and attachment metadata.',
          inputSchema: GetEntityDetailInputSchema,
          inputSummary: {
            entity_type: `One of ${QUERY_ENTITY_TYPE_SUMMARY}.`,
            entity_id: 'The entity UUID, or canonical reference such as PRJ-12, REQ-7, T-42, DOC-3, or INC-12 when supported.',
            year: 'Optional fiscal/calendar year for year-backed metrics on supported entities such as companies and departments.',
          },
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: async (context, input): Promise<AiEntityDetailDto> => {
            await this.policy.assertEntityTypeReadAccess(context, input.entity_type, context.manager);
            return this.queryExecutor.executeDetail(context, input);
          },
        },
      ],
      [
        'get_entity_context',
        {
          name: 'get_entity_context',
          category: 'inspection',
          description: 'Return a stable relationship-focused context payload for one known entity.',
          inputSchema: GetEntityContextInputSchema,
          inputSummary: {
            entity_type: `One of ${CONTEXT_ENTITY_TYPE_SUMMARY}.`,
            entity_id: 'The entity UUID to inspect.',
          },
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: (context, input) => this.entityTools.getEntityContext(context, input),
        },
      ],
      [
        'get_entity_comments',
        {
          name: 'get_entity_comments',
          category: 'inspection',
          description: 'Return the paginated discussion comments feed for one readable project or task. Use this instead of mixed recent activity when the user asks what people said.',
          inputSchema: GetEntityCommentsInputSchema,
          inputSummary: {
            entity_type: 'One of projects or tasks.',
            entity_id: 'The project/task UUID or canonical reference such as PRJ-12 or T-42.',
            offset: 'Zero-based comment offset (default 0). Increase this to page deeper into the discussion history.',
            limit: 'Maximum number of comments to return (default 20, max 100).',
          },
          surfaces: ['chat', 'mcp'],
          readOnly: true,
          execute: (context, input) => this.entityTools.getEntityComments(context, input),
        },
      ],
      [
        'search_knowledge',
        {
          name: 'search_knowledge',
          category: 'discovery',
          description: 'Search the knowledge base with existing PostgreSQL full-text retrieval.',
          inputSchema: SearchKnowledgeInputSchema,
          inputSummary: {
            query: 'Search text or document reference such as DOC-14.',
            offset: 'Zero-based result offset (default 0). Increase this to fetch the next batch when truncated=true.',
            limit: 'Maximum number of documents to return (default 20, max 200). Raise limit or page with offset only when the first page is insufficient.',
          },
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
          description: 'Return one knowledge document using a stable AI-oriented DTO.',
          inputSchema: GetDocumentInputSchema,
          inputSummary: {
            document_id: 'The document UUID or DOC-123 reference.',
          },
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
              relations: {
                applications: (document.relations?.applications || []).map((row: any) => toDocumentRelation('applications', row)),
                assets: (document.relations?.assets || []).map((row: any) => toDocumentRelation('assets', row)),
                projects: (document.relations?.projects || []).map((row: any) => toDocumentRelation('projects', row)),
                requests: (document.relations?.requests || []).map((row: any) => toDocumentRelation('requests', row)),
                tasks: (document.relations?.tasks || []).map((row: any) => toDocumentRelation('tasks', row)),
              },
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
                  message: err?.message || 'Preview creation failed.',
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
          : avail.readableEntityTypes.length > 0;
      case 'get_entity_context':
        return AI_CONTEXT_ENTITY_TYPES.some((type) => avail.readableEntityTypes.includes(type));
      case 'get_entity_comments':
        return avail.readableEntityTypes.includes('projects') || avail.readableEntityTypes.includes('tasks');
      case 'search_knowledge':
      case 'get_document':
        return avail.canReadKnowledge;
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

    const writeAccessByResource = new Map<string, boolean>();
    for (const operation of this.mutationOperations.listOperations()) {
      for (const resource of operationResources(operation)) {
        if (writeAccessByResource.has(resource)) {
          continue;
        }
        try {
          await this.policy.assertWriteAccess(context, resource, context.manager);
          writeAccessByResource.set(resource, true);
        } catch {
          writeAccessByResource.set(resource, false);
        }
      }
    }

    const writableMutationToolNames = new Set<AiToolName>();
    for (const operation of this.mutationOperations.listOperations()) {
      if (!operationResources(operation).some((resource) => writeAccessByResource.get(resource) === true)) {
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
        zodToJsonSchema(definition.inputSchema as any, { target: 'openApi3' }),
      );
      return {
        name: definition.name,
        description: definition.description,
        parameters: jsonSchema as Record<string, unknown>,
      };
    });
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

    const parsed = definition.inputSchema.safeParse(rawInput);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.flatten());
    }

    return definition.execute(context, parsed.data);
  }
}
