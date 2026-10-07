import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { Features } from '../../config/features';
import { AiAggregateExecutor } from '../query/ai-aggregate.executor';
import { AiQueryExecutor } from '../query/ai-query.executor';
import { AiToolRegistry } from '../ai-tool.registry';
import { AiDocumentMutationSupportService } from '../mutation/ai-document-mutation-support.service';
import { CreateDocumentAiMutationOperation } from '../mutation/operations/create-document.ai-mutation-operation';
import { CreateTaskAiMutationOperation } from '../mutation/operations/create-task.ai-mutation-operation';
import { ImportGlpiTicketAiMutationOperation, ImportTicketAiMutationOperation } from '../mutation/operations/import-glpi-ticket.ai-mutation-operation';
import { UpdateDocumentContentAiMutationOperation } from '../mutation/operations/update-document-content.ai-mutation-operation';
import { UpdateDocumentRelationsAiMutationOperation } from '../mutation/operations/update-document-relations.ai-mutation-operation';

function createContext() {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: { tag: 'manager' } as any,
  };
}

function createChatContext() {
  return {
    ...createContext(),
    surface: 'chat' as const,
    authMethod: 'jwt' as const,
    conversationId: 'conv-1',
  };
}

function createRegistry(overrides?: {
  entityTools?: any;
  knowledge?: any;
  policy?: any;
  queryExecutor?: any;
  aggregateExecutor?: any;
  settingsService?: any;
  braveSearch?: any;
  previews?: any;
  mutationOperations?: any;
}) {
  return new AiToolRegistry(
    {
      searchAll: async () => ({ items: [], total: 0, complete: false, entity_types: ['applications'] }),
      getEntityContext: async () => ({
        entity: { id: 'app-1', metadata: {} },
        related: [],
        knowledge: null,
        total: 1,
        returned: 1,
        truncated: false,
        complete: true,
      }),
      getEntityComments: async () => ({
        entity: { type: 'tasks', id: 'task-1', ref: 'T-1', label: 'Test task' },
        items: [],
        total: 0,
        offset: 0,
        limit: 20,
        returned: 0,
        truncated: false,
        complete: true,
      }),
      ...(overrides?.entityTools || {}),
    } as any,
    {
      search: async () => ({ total: 0, items: [] }),
      get: async () => null,
      ...(overrides?.knowledge || {}),
    } as any,
    {
      assertSurfaceAccess: async () => undefined,
      listReadableEntityTypes: async () => ['applications', 'documents'],
      canReadKnowledge: async () => true,
      assertKnowledgeReadAccess: async () => undefined,
      assertEntityTypeReadAccess: async () => undefined,
      ...(overrides?.policy || {}),
    } as any,
    {
      execute: async () => ({ items: [], total: 0, filters_applied: [], filters_ignored: [], complete: true }),
      executeDetail: async () => ({
        entity: { type: 'applications', id: 'app-1', ref: null, label: 'App', status: 'enabled', summary: null, updated_at: null },
        data: { id: 'app-1', name: 'App' },
        total: 1,
        returned: 1,
        truncated: false,
        complete: true,
      }),
      executeFilterValues: async () => ({ values: {}, fields_ignored: [], total: 0, returned: 0, truncated: false, complete: true }),
      ...(overrides?.queryExecutor || {}),
    } as any,
    {
      execute: async () => ({ group_by: 'status', groups: [], total: 0, returned: 0, truncated: false, filters_applied: [], filters_ignored: [], complete: true }),
      ...(overrides?.aggregateExecutor || {}),
    } as any,
    {
      find: async () => ({
        web_search_enabled: true,
        glpi_enabled: false,
        glpi_url: null,
        glpi_user_token_encrypted: null,
      }),
      ...(overrides?.settingsService || {}),
    } as any,
    {
      search: async () => ([{ title: 'Test', url: 'https://example.com', description: 'Test result' }]),
      ...(overrides?.braveSearch || {}),
    } as any,
    {
      createPreview: async () => ({
        preview_id: 'preview-1',
        tool_name: 'update_task_status',
        status: 'pending',
        target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Test task' },
        changes: { status: { from: 'open', to: 'done' } },
        requires_confirmation: true,
        actions: ['approve', 'reject'],
        summary: 'Update T-1 status from open to done.',
        error_message: null,
        conversation_id: 'conv-1',
        created_at: '2026-03-24T10:00:00.000Z',
        expires_at: '2026-03-24T10:10:00.000Z',
        approved_at: null,
        rejected_at: null,
        executed_at: null,
      }),
      createReversePreview: async () => ({
        preview_id: 'preview-2',
        tool_name: 'update_task_status',
        status: 'pending',
        target: { entity_type: 'tasks', entity_id: 'task-1', ref: 'T-1', title: 'Test task' },
        changes: { status: { from: 'done', to: 'open' } },
        requires_confirmation: true,
        actions: ['approve', 'reject'],
        summary: 'Update T-1 status from done to open.',
        error_message: null,
        conversation_id: 'conv-1',
        created_at: '2026-03-24T10:00:00.000Z',
        expires_at: '2026-03-24T10:10:00.000Z',
        approved_at: null,
        rejected_at: null,
        executed_at: null,
      }),
      createMutationPlan: async (_context: any, input: any) => ({
        plan: {
          plan_id: 'plan-1',
          summary: input.summary ?? null,
          status: 'active',
          steps: [],
        },
        previews: [],
        errors: [],
        deferred: [],
        total: Array.isArray(input.operations) ? input.operations.length : 0,
        created: 0,
        failed: 0,
        deferred_count: 0,
        complete: true,
      }),
      hasExecutedUndoablePreviewInConversation: async () => false,
      ...(overrides?.previews || {}),
    } as any,
    {
      listOperations: () => ([
        {
          toolName: 'import_ticket',
          description: 'Create a preview to import one ticket from a configured ticketing provider.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            provider_key: 'Configured ticketing provider key.',
            ticket_id: 'Ticket identifier in the selected provider.',
          },
          businessResource: 'tasks',
          writePreview: {
            entity_type: 'tasks',
            fields: ['relation', 'title', 'description', 'source'],
            reversible: false,
            prompt_hint: 'For ticket escalation, use `import_ticket` with provider_key and ticket_id.',
          },
        },
        {
          toolName: 'import_glpi_ticket',
          description: 'Create a preview to import one GLPI ticket into one KANAP task.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            ticket_id: 'GLPI ticket numeric identifier.',
          },
          businessResource: 'tasks',
          writePreview: {
            entity_type: 'tasks',
            fields: ['relation', 'title', 'description', 'assignee', 'priority_level', 'task_type', 'source'],
            reversible: false,
            prompt_hint: 'For GLPI escalation, use `import_glpi_ticket` with the numeric GLPI ticket id.',
          },
        },
        {
          toolName: 'create_document',
          description: 'Create a preview to create one draft knowledge document.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            title: 'Document title.',
            summary: 'Optional summary.',
            content_markdown: 'Optional initial markdown content.',
            template_document: 'Optional template document.',
          },
          businessResource: 'knowledge',
          writePreview: {
            entity_type: 'documents',
            fields: ['title', 'summary', 'template_document', 'content_markdown'],
            reversible: false,
            prompt_hint: 'For draft document creation, use `create_document`.',
          },
        },
        {
          toolName: 'create_task',
          description: 'Create a preview to create one task.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            title: 'Task title.',
            relation_type: 'Optional relation type.',
            relation_ref: 'Optional relation target reference.',
            assignee: 'Optional assignee email, full name, or unique user label.',
            priority_level: 'Optional task priority.',
            description: 'Optional task description.',
          },
          businessResource: 'tasks',
          writePreview: {
            entity_type: 'tasks',
            fields: ['relation', 'title', 'description', 'assignee', 'priority_level', 'start_date', 'due_date', 'task_type', 'phase'],
            reversible: false,
            prompt_hint: 'For task creation, use `create_task` with a title and optional relation, assignee, priority, dates, task type, and project phase.',
          },
        },
        {
          toolName: 'update_document_content',
          description: 'Create a preview to update one document markdown body.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            document_id: 'The document UUID or DOC-123 reference.',
            content_markdown: 'The full updated markdown body.',
          },
          businessResource: 'knowledge',
          writePreview: {
            entity_type: 'documents',
            fields: ['content_markdown'],
            reversible: false,
            prompt_hint: 'For document body edits, use `update_document_content` with the full resulting markdown.',
          },
        },
        {
          toolName: 'update_document_metadata',
          description: 'Create a preview to update one document metadata record.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            document_id: 'The document UUID or DOC-123 reference.',
            title: 'Optional new title.',
            summary: 'Optional new summary.',
            review_due_at: 'Optional review due date.',
            last_reviewed_at: 'Optional last reviewed date.',
          },
          businessResource: 'knowledge',
          writePreview: {
            entity_type: 'documents',
            fields: ['title', 'summary', 'review_due_at', 'last_reviewed_at'],
            reversible: false,
            prompt_hint: 'For document metadata changes, use `update_document_metadata` with a DOC-123 reference.',
          },
        },
        {
          toolName: 'update_document_relations',
          description: 'Create a preview to add links to one document.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            document_id: 'The document UUID or DOC-123 reference.',
            projects: 'Project references or exact names to link.',
            requests: 'Request references or exact names to link.',
            tasks: 'Task references or exact titles to link.',
            applications: 'Application names or UUIDs to link.',
            assets: 'Asset names or UUIDs to link.',
          },
          businessResource: 'knowledge',
          writePreview: {
            entity_type: 'documents',
            fields: ['linked_projects', 'linked_requests', 'linked_tasks', 'linked_applications', 'linked_assets'],
            reversible: false,
            prompt_hint: 'For relation-only document changes, use `update_document_relations`.',
          },
        },
        {
          toolName: 'update_task_status',
          description: 'Create a preview to update one task status. Requires explicit user approval before execution.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            ref: 'Task reference such as T-42.',
            status: 'One of open, in_progress, pending, in_testing, done, or cancelled.',
          },
          businessResource: 'tasks',
          writePreview: {
            entity_type: 'tasks',
            fields: ['status'],
            reversible: true,
            prompt_hint: 'For task status changes, use `update_task_status` with a canonical task reference such as `T-42`.',
          },
        },
        {
          toolName: 'update_task_assignee',
          description: 'Create a preview to change one task assignee. Requires explicit user approval before execution.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            ref: 'Task reference such as T-42.',
            assignee_email: 'The assignee email address in the current tenant.',
          },
          businessResource: 'tasks',
          writePreview: {
            entity_type: 'tasks',
            fields: ['assignee'],
            reversible: true,
            prompt_hint: 'For assignee changes, use `update_task_assignee` with the assignee email.',
          },
        },
        {
          toolName: 'add_task_comment',
          description: 'Create a preview to add one comment to a task. Requires explicit user approval before execution.',
          inputSchema: {
            safeParse: (value: any) => ({ success: true, data: value }),
          },
          inputSummary: {
            ref: 'Task reference such as T-42.',
            content: 'Markdown comment content to add to the task.',
          },
          businessResource: 'tasks',
          writePreview: {
            entity_type: 'tasks',
            fields: ['comments'],
            reversible: false,
            prompt_hint: 'For task comments, use `add_task_comment` with a canonical task reference and the exact comment content.',
          },
        },
      ]),
      getOperationOrNull: (toolName: string) => {
        const operation = ({
          import_ticket: { toolName: 'import_ticket' },
          import_glpi_ticket: { toolName: 'import_glpi_ticket' },
          create_document: { toolName: 'create_document' },
          create_task: { toolName: 'create_task' },
          update_document_content: { toolName: 'update_document_content' },
          update_document_metadata: { toolName: 'update_document_metadata' },
          update_document_relations: { toolName: 'update_document_relations' },
          update_task_status: { toolName: 'update_task_status' },
          update_task_assignee: { toolName: 'update_task_assignee' },
          add_task_comment: { toolName: 'add_task_comment' },
        } as Record<string, any>)[toolName];
        return operation ?? null;
      },
      ...(overrides?.mutationOperations || {}),
    } as any,
  );
}

function createQueryExecutor(overrides?: {
  tasks?: any;
}) {
  return new AiQueryExecutor(
    {
      listAllTasks: async () => ({ items: [], total: 0, page: 1, limit: 200 }),
      ...(overrides?.tasks || {}),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function createAggregateExecutor(overrides?: {
  tasks?: any;
}) {
  return new AiAggregateExecutor(
    {
      listIds: async () => ({ ids: [], total: 0 }),
      ...(overrides?.tasks || {}),
    } as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

function nullableWithoutTypePaths(value: unknown, path = '$'): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => nullableWithoutTypePaths(entry, `${path}[${index}]`));
  }
  if (!value || typeof value !== 'object') {
    return [];
  }
  const record = value as Record<string, unknown>;
  const current = record.nullable === true && record.type === undefined ? [path] : [];
  const children = Object.entries(record).flatMap(([key, entry]) => nullableWithoutTypePaths(entry, `${path}.${key}`));
  return [...current, ...children];
}

async function testListAvailableTools() {
  const registry = createRegistry();

  const tools = await registry.listAvailableTools(createContext());
  assert.deepEqual(
    tools.map((tool) => tool.name),
    ['search_all', 'describe_entity_filters', 'query_entities', 'aggregate_entities', 'get_filter_values', 'get_application_classification_catalog', 'get_entity_detail', 'get_entity_context', 'search_knowledge', 'get_document'],
  );
  assert.match(
    tools.find((tool) => tool.name === 'describe_entity_filters')?.description || '',
    /expected value kinds/i,
  );
  assert.match(
    tools.find((tool) => tool.name === 'query_entities')?.description || '',
    /filters_ignored.*must be repaired before answering/i,
  );
  assert.match(
    tools.find((tool) => tool.name === 'aggregate_entities')?.description || '',
    /filters_ignored.*must be repaired before answering/i,
  );
  assert.match(
    tools.find((tool) => tool.name === 'get_filter_values')?.description || '',
    /fields_ignored.*must not be used for filtering/i,
  );
  assert.match(
    tools.find((tool) => tool.name === 'query_entities')?.input_summary.q || '',
    /plain text only.*never encode filters/i,
  );
  assert.match(
    tools.find((tool) => tool.name === 'aggregate_entities')?.input_summary.q || '',
    /plain text only.*never encode filters/i,
  );
}

async function testTaskReadersSeeEntityCommentsTool() {
  const registry = createRegistry({
    policy: {
      listReadableEntityTypes: async () => ['tasks'],
    },
  });

  const tools = await registry.listAvailableTools(createContext());
  assert.ok(tools.some((tool) => tool.name === 'get_entity_comments'));
}

async function testListRegisteredToolsExposesRuntimeRegistry() {
  const registry = createRegistry();

  assert.deepEqual(
    registry.listRegisteredTools().map((tool) => tool.name),
    [
      'search_all',
      'describe_entity_filters',
      'query_entities',
      'aggregate_entities',
      'get_filter_values',
      'get_application_classification_catalog',
      'get_entity_detail',
      'get_entity_context',
      'get_entity_comments',
      'search_knowledge',
      'get_document',
      'prepare_mutation_plan',
      'update_task_assignees',
      'undo_preview',
      'web_search',
      'import_ticket',
      'import_glpi_ticket',
      'create_document',
      'create_task',
      'update_document_content',
      'update_document_metadata',
      'update_document_relations',
      'update_task_status',
      'update_task_assignee',
      'add_task_comment',
    ],
  );
}

async function testListAvailableToolsIncludesCategories() {
  const registry = createRegistry();
  const tools = await registry.listAvailableTools(createContext());

  assert.equal(tools.find((tool) => tool.name === 'search_all')?.category, 'discovery');
  assert.equal(tools.find((tool) => tool.name === 'describe_entity_filters')?.category, 'authoritative');
  assert.equal(tools.find((tool) => tool.name === 'query_entities')?.category, 'authoritative');
  assert.equal(tools.find((tool) => tool.name === 'get_entity_detail')?.category, 'inspection');
  assert.equal(tools.find((tool) => tool.name === 'get_entity_context')?.category, 'inspection');
}

async function testRegisteredToolCategoriesMatchExpectedAssignments() {
  const registry = createRegistry();
  const categories = new Map(
    registry.listRegisteredTools().map((tool) => [tool.name, tool.category]),
  );

  for (const category of categories.values()) {
    assert.ok(['discovery', 'authoritative', 'inspection', 'mutation'].includes(category));
  }

  assert.equal(categories.get('search_all'), 'discovery');
  assert.equal(categories.get('describe_entity_filters'), 'authoritative');
  assert.equal(categories.get('query_entities'), 'authoritative');
  assert.equal(categories.get('aggregate_entities'), 'authoritative');
  assert.equal(categories.get('get_filter_values'), 'authoritative');
  assert.equal(categories.get('get_entity_detail'), 'inspection');
  assert.equal(categories.get('get_entity_context'), 'inspection');
  assert.equal(categories.get('get_entity_comments'), 'inspection');
  assert.equal(categories.get('search_knowledge'), 'discovery');
  assert.equal(categories.get('get_document'), 'inspection');
  assert.equal(categories.get('web_search'), 'discovery');
  assert.equal(categories.get('prepare_mutation_plan'), 'mutation');
  assert.equal(categories.get('update_task_assignees'), 'mutation');
  assert.equal(categories.get('undo_preview'), 'mutation');
  assert.equal(categories.get('import_ticket'), 'mutation');
  assert.equal(categories.get('import_glpi_ticket'), 'mutation');
  assert.equal(categories.get('create_task'), 'mutation');
  assert.equal(categories.get('update_task_status'), 'mutation');
}

async function testDescribeEntityFiltersExposesAssigneeFormat() {
  const registry = createRegistry({
    policy: {
      listReadableEntityTypes: async () => ['tasks'],
    },
  });

  const result = await registry.execute(createContext(), 'describe_entity_filters', {
    entity_type: 'tasks',
  }) as any;
  const assignee = result.fields.find((field: any) => field.field === 'assignee');
  const application = result.fields.find((field: any) => field.field === 'application');
  const asset = result.fields.find((field: any) => field.field === 'asset');

  assert.equal(result.entity_type, 'tasks');
  assert.equal(result.complete, true);
  assert.equal(assignee.lookup_entity, 'users');
  assert.match(assignee.accepted_value_kind, /email and UUID are accepted/i);
  assert.ok(assignee.aliases.includes('assignee_id'));
  assert.equal(application.lookup_entity, 'applications');
  assert.equal(application.groupable, true);
  assert.ok(application.aliases.includes('app'));
  assert.equal(asset.lookup_entity, 'assets');
  assert.equal(asset.groupable, true);
  assert.ok(asset.aliases.includes('server'));
}

async function testChatSurfaceIncludesWritePreviewToolsWhenWriteAllowed() {
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['applications', 'documents'],
    },
    previews: {
      hasExecutedUndoablePreviewInConversation: async () => true,
    },
  });

  const tools = await registry.listAvailableTools(createChatContext());
  assert.ok(tools.some((tool) => tool.name === 'create_document'));
  assert.ok(tools.some((tool) => tool.name === 'create_task'));
  assert.ok(!tools.some((tool) => tool.name === 'import_ticket'));
  assert.ok(!tools.some((tool) => tool.name === 'import_glpi_ticket'));
  assert.ok(tools.some((tool) => tool.name === 'update_document_content'));
  assert.ok(tools.some((tool) => tool.name === 'update_document_metadata'));
  assert.ok(tools.some((tool) => tool.name === 'update_document_relations'));
  assert.ok(tools.some((tool) => tool.name === 'update_task_status'));
  assert.ok(tools.some((tool) => tool.name === 'update_task_assignee'));
  assert.ok(tools.some((tool) => tool.name === 'prepare_mutation_plan'));
  assert.ok(tools.some((tool) => tool.name === 'update_task_assignees'));
  assert.ok(tools.some((tool) => tool.name === 'add_task_comment'));
  assert.ok(tools.some((tool) => tool.name === 'undo_preview'));
}

async function testWritePreviewToolsStayHiddenWithoutWriteAccess() {
  const registry = createRegistry();

  const tools = await registry.listAvailableTools(createChatContext());
  assert.ok(!tools.some((tool) => tool.name === 'create_document'));
  assert.ok(!tools.some((tool) => tool.name === 'create_task'));
  assert.ok(!tools.some((tool) => tool.name === 'import_ticket'));
  assert.ok(!tools.some((tool) => tool.name === 'import_glpi_ticket'));
  assert.ok(!tools.some((tool) => tool.name === 'update_document_content'));
  assert.ok(!tools.some((tool) => tool.name === 'update_document_metadata'));
  assert.ok(!tools.some((tool) => tool.name === 'update_document_relations'));
  assert.ok(!tools.some((tool) => tool.name === 'update_task_status'));
  assert.ok(!tools.some((tool) => tool.name === 'update_task_assignee'));
  assert.ok(!tools.some((tool) => tool.name === 'prepare_mutation_plan'));
  assert.ok(!tools.some((tool) => tool.name === 'update_task_assignees'));
  assert.ok(!tools.some((tool) => tool.name === 'add_task_comment'));
  assert.ok(!tools.some((tool) => tool.name === 'undo_preview'));
}

async function testUpdateTaskAssigneesCreatesOnePreviewPerTaskAndReturnsPartialErrors() {
  const calls: Array<{ toolName: string; input: any }> = [];
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['tasks'],
    },
    previews: {
      createPreview: async (_context: any, toolName: string, input: any) => {
        calls.push({ toolName, input });
        if (input.ref === 'T-2') {
          throw new Error('Task no longer exists.');
        }
        return {
          preview_id: `preview-${input.ref}`,
          tool_name: 'update_task_assignee',
          status: 'pending',
          target: { entity_type: 'tasks', entity_id: `task-${input.ref}`, ref: input.ref, title: input.ref },
          changes: { assignee: { from: 'Paul', to: 'Marie' } },
          requires_confirmation: true,
          actions: ['approve', 'reject'],
          summary: `${input.ref} assignee update preview.`,
          error_message: null,
          conversation_id: 'conv-1',
          created_at: '2026-03-24T10:00:00.000Z',
          expires_at: '2026-03-24T10:10:00.000Z',
          approved_at: null,
          rejected_at: null,
          executed_at: null,
        };
      },
    },
  });

  const result = await registry.execute(createChatContext(), 'update_task_assignees', {
    refs: ['T-1', 'T-2', 'T-3'],
    assignee_email: 'marie@example.com',
  }) as any;

  assert.deepEqual(calls.map((call) => call.toolName), [
    'update_task_assignee',
    'update_task_assignee',
    'update_task_assignee',
  ]);
  assert.deepEqual(calls.map((call) => call.input), [
    { ref: 'T-1', assignee_email: 'marie@example.com' },
    { ref: 'T-2', assignee_email: 'marie@example.com' },
    { ref: 'T-3', assignee_email: 'marie@example.com' },
  ]);
  assert.equal(result.total, 3);
  assert.equal(result.created, 2);
  assert.equal(result.failed, 1);
  assert.equal(result.complete, false);
  assert.deepEqual(result.previews.map((preview: any) => preview.target.ref), ['T-1', 'T-3']);
  assert.deepEqual(result.errors, [{ ref: 'T-2', message: 'Task no longer exists.' }]);
}

async function testPrepareMutationPlanDelegatesToPreviewService() {
  let receivedInput: any = null;
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['projects', 'tasks'],
    },
    previews: {
      createMutationPlan: async (_context: any, input: any) => {
        receivedInput = input;
        return {
          plan: {
            plan_id: 'plan-1',
            summary: input.summary,
            status: 'active',
            steps: [],
          },
          previews: [],
          errors: [],
          deferred: [],
          total: input.operations.length,
          created: 0,
          failed: 0,
          deferred_count: input.operations.length,
          complete: false,
        };
      },
    },
  });

  const result = await registry.execute(createChatContext(), 'prepare_mutation_plan', {
    summary: 'Create a project and tasks.',
    operations: [
      {
        operation_id: 'create_project',
        tool_name: 'create_business_record',
        input: { entity_type: 'projects', fields: { name: 'Project A' } },
      },
      {
        operation_id: 'task_1',
        tool_name: 'create_task',
        input: { title: 'Task 1', relation_type: 'project', relation_ref: '{{create_project.ref}}' },
        depends_on: ['create_project'],
      },
    ],
  }) as any;

  assert.equal(result.total, 2);
  assert.deepEqual(receivedInput.operations.map((operation: any) => operation.operation_id), [
    'create_project',
    'task_1',
  ]);
}

async function testUndoPreviewStaysHiddenWhenOnlyNonReversibleWritesExist() {
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['applications', 'documents'],
    },
    previews: {
      hasExecutedUndoablePreviewInConversation: async () => false,
    },
  });

  const tools = await registry.listAvailableTools(createChatContext());
  assert.ok(tools.some((tool) => tool.name === 'add_task_comment'));
  assert.ok(!tools.some((tool) => tool.name === 'undo_preview'));
}

async function testGenericImportToolAppearsWhenLegacyGlpiSettingsAreConfigured() {
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['tasks'],
    },
    settingsService: {
      find: async () => ({
        web_search_enabled: true,
        glpi_enabled: true,
        glpi_url: 'https://glpi.internal/',
        glpi_user_token_encrypted: 'enc:secret',
      }),
    },
  });

  const tools = await registry.listAvailableTools(createChatContext());
  assert.ok(tools.some((tool) => tool.name === 'import_ticket'));
  assert.ok(!tools.some((tool) => tool.name === 'import_glpi_ticket'));
}

async function testImportTicketToolAppearsWhenTicketingAdapterConfigExists() {
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['tasks'],
    },
    settingsService: {
      find: async () => ({
        web_search_enabled: true,
        glpi_enabled: false,
        glpi_url: null,
        glpi_user_token_encrypted: null,
      }),
    },
  });
  const context = {
    ...createChatContext(),
    manager: {
      getRepository: () => ({
        find: async (opts: any) =>
          opts?.where?.provider_kind === 'ticketing' && opts?.where?.enabled === true
            ? [{
              tenant_id: 'tenant-1',
              provider_kind: 'ticketing',
              provider_key: 'ticketing-prod',
              implementation: 'freshdesk',
              enabled: true,
              credential_ref_json: { kind: 'secret_ref', ref: 'tenant/tenant-1/ticketing/freshdesk' },
            }]
            : [],
      }),
    } as any,
  };

  const tools = await registry.listAvailableTools(context);
  assert.ok(tools.some((tool) => tool.name === 'import_ticket'));
  assert.ok(!tools.some((tool) => tool.name === 'import_glpi_ticket'));
}

async function testImportTicketToolStaysHiddenForCredentiallessTicketingAdapterConfig() {
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['tasks'],
    },
    settingsService: {
      find: async () => ({
        web_search_enabled: true,
        glpi_enabled: false,
        glpi_url: null,
        glpi_user_token_encrypted: null,
      }),
    },
  });
  const context = {
    ...createChatContext(),
    manager: {
      getRepository: () => ({
        find: async () => [{
          tenant_id: 'tenant-1',
          provider_kind: 'ticketing',
          provider_key: 'ticketing-prod',
          implementation: 'freshdesk',
          enabled: true,
          credential_ref_json: null,
        }],
      }),
    } as any,
  };

  const tools = await registry.listAvailableTools(context);
  assert.ok(!tools.some((tool) => tool.name === 'import_ticket'));
  assert.ok(!tools.some((tool) => tool.name === 'import_glpi_ticket'));
}

async function testCreateDocumentToolSchemaExposesBodyFields() {
  const knowledge = {
    listLibraries: async () => [{ id: 'library-1', name: 'Operations', is_system: false }],
    listTypes: async () => [{ id: 'type-1', name: 'Document', is_default: true }],
  };
  const operation = new CreateDocumentAiMutationOperation(
    new AiDocumentMutationSupportService(knowledge as any),
    knowledge as any,
  );
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['applications', 'documents'],
    },
    mutationOperations: {
      listOperations: () => [operation],
      getOperationOrNull: (toolName: string) => (toolName === 'create_document' ? operation : null),
    },
  });

  const tools = await registry.getToolJsonSchemas(createChatContext());
  const schema = tools.find((tool) => tool.name === 'create_document');

  assert.ok(schema);
  assert.match(String((schema!.parameters as any).properties?.content_markdown?.description || ''), /full draft content/i);
  assert.match(String((schema!.parameters as any).properties?.content?.description || ''), /alias/i);
  assert.match(String((schema!.parameters as any).properties?.template_document?.description || ''), /template document/i);
  assert.match(String((schema!.parameters as any).properties?.projects?.description || ''), /Project reference/i);
}

async function testCreateTaskToolSchemaExposesRelationAndAssignmentFields() {
  const operation = new CreateTaskAiMutationOperation(
    {} as any,
    {} as any,
    {} as any,
  );
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['tasks'],
    },
    mutationOperations: {
      listOperations: () => [operation],
      getOperationOrNull: (toolName: string) => (toolName === 'create_task' ? operation : null),
    },
  });

  const tools = await registry.getToolJsonSchemas(createChatContext());
  const schema = tools.find((tool) => tool.name === 'create_task');

  assert.ok(schema);
  assert.match(String((schema!.parameters as any).properties?.relation_type?.description || ''), /relation type/i);
  assert.match(String((schema!.parameters as any).properties?.relation_ref?.description || ''), /relation target reference/i);
  assert.match(String((schema!.parameters as any).properties?.assignee?.description || ''), /assignee email, full name/i);
  assert.match(String((schema!.parameters as any).properties?.priority_level?.description || ''), /task priority/i);
  assert.match(String((schema!.parameters as any).properties?.phase?.description || ''), /project phase/i);
}

async function testImportGlpiTicketToolSchemaUsesNumericExclusiveMinimum() {
  const operation = new ImportGlpiTicketAiMutationOperation(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['tasks'],
    },
    settingsService: {
      find: async () => ({
        web_search_enabled: true,
        glpi_enabled: true,
        glpi_url: 'https://glpi.example.com',
        glpi_user_token_encrypted: 'encrypted-token',
      }),
    },
    mutationOperations: {
      listOperations: () => [operation],
      getOperationOrNull: (toolName: string) => (toolName === 'import_glpi_ticket' ? operation : null),
    },
  });

  const tools = await registry.getToolJsonSchemas(createChatContext());
  const schema = tools.find((tool) => tool.name === 'import_glpi_ticket');

  assert.ok(schema);
  assert.equal((schema!.parameters as any).properties?.ticket_id?.exclusiveMinimum, 0);
  assert.equal(typeof (schema!.parameters as any).properties?.ticket_id?.exclusiveMinimum, 'number');
  assert.deepEqual(nullableWithoutTypePaths(schema!.parameters), []);
  assert.equal((schema!.parameters as any).properties?.relation_ref?.anyOf?.[1]?.type, 'null');
  assert.equal((schema!.parameters as any).properties?.assignee?.anyOf?.[1]?.type, 'null');
  assert.equal((schema!.parameters as any).properties?.priority_level?.anyOf?.[1]?.type, 'null');
  assert.equal((schema!.parameters as any).properties?.priority?.anyOf?.[1]?.type, 'null');
}

async function testImportTicketToolSchemaRequiresProviderKey() {
  const operation = new ImportTicketAiMutationOperation(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['tasks'],
    },
    mutationOperations: {
      listOperations: () => [operation],
      getOperationOrNull: (toolName: string) => (toolName === 'import_ticket' ? operation : null),
    },
  });
  const context = {
    ...createChatContext(),
    manager: {
      getRepository: () => ({
        find: async () => [{
          tenant_id: 'tenant-1',
          provider_kind: 'ticketing',
          provider_key: 'ticketing-prod',
          implementation: 'freshdesk',
          enabled: true,
          credential_ref_json: { kind: 'secret_ref', ref: 'tenant/tenant-1/ticketing/freshdesk' },
        }],
      }),
    } as any,
  };

  const tools = await registry.getToolJsonSchemas(context);
  const schema = tools.find((tool) => tool.name === 'import_ticket');

  assert.ok(schema);
  assert.ok(((schema!.parameters as any).required as string[]).includes('provider_key'));
  assert.match(String((schema!.parameters as any).properties?.provider_key?.description || ''), /ticketing provider key/i);
  assert.match(String((schema!.parameters as any).properties?.ticket_id?.description || ''), /ticket identifier/i);
}

async function testUpdateDocumentContentToolSchemaExposesDocumentAndBodyFields() {
  const knowledge = {
    listLibraries: async () => [{ id: 'library-1', name: 'Operations', is_system: false }],
    listTypes: async () => [{ id: 'type-1', name: 'Document', is_default: true }],
    get: async () => null,
    assertWorkflowAllowsEditing: async () => undefined,
    assertDocumentUnlockedForUser: async () => undefined,
    acquireLock: async () => ({ lock_token: 'token' }),
    releaseLock: async () => ({ ok: true }),
    update: async () => null,
  };
  const operation = new UpdateDocumentContentAiMutationOperation(
    new AiDocumentMutationSupportService(knowledge as any),
    knowledge as any,
  );
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['applications', 'documents'],
    },
    mutationOperations: {
      listOperations: () => [operation],
      getOperationOrNull: (toolName: string) => (toolName === 'update_document_content' ? operation : null),
    },
  });

  const tools = await registry.getToolJsonSchemas(createChatContext());
  const schema = tools.find((tool) => tool.name === 'update_document_content');

  assert.ok(schema);
  assert.match(String((schema!.parameters as any).properties?.document_id?.description || ''), /DOC reference/i);
  assert.match(String((schema!.parameters as any).properties?.content_markdown?.description || ''), /full resulting markdown body/i);
  assert.match(String((schema!.parameters as any).properties?.applications?.description || ''), /Application name/i);
}

async function testUpdateDocumentRelationsToolSchemaExposesRelationFields() {
  const knowledge = {
    get: async () => null,
    assertWorkflowAllowsEditing: async () => undefined,
    assertDocumentUnlockedForUser: async () => undefined,
    acquireLock: async () => ({ lock_token: 'token' }),
    releaseLock: async () => ({ ok: true }),
    update: async () => null,
  };
  const operation = new UpdateDocumentRelationsAiMutationOperation(
    new AiDocumentMutationSupportService(knowledge as any),
    knowledge as any,
  );
  const registry = createRegistry({
    policy: {
      assertWriteAccess: async () => undefined,
      listReadableEntityTypes: async () => ['applications', 'documents'],
    },
    mutationOperations: {
      listOperations: () => [operation],
      getOperationOrNull: (toolName: string) => (toolName === 'update_document_relations' ? operation : null),
    },
  });

  const tools = await registry.getToolJsonSchemas(createChatContext());
  const schema = tools.find((tool) => tool.name === 'update_document_relations');

  assert.ok(schema);
  assert.match(String((schema!.parameters as any).properties?.projects?.description || ''), /PRJ-33/i);
  assert.match(String((schema!.parameters as any).properties?.applications?.description || ''), /Application name/i);
  assert.match(String((schema!.parameters as any).properties?.add?.description || ''), /Canonical grouped relation additions/i);
  assert.match(String((schema!.parameters as any).properties?.add?.properties?.projects?.description || ''), /PRJ-33/i);
  assert.match(String((schema!.parameters as any).properties?.remove?.description || ''), /Canonical grouped relation removals/i);
  assert.match(String((schema!.parameters as any).properties?.remove?.properties?.applications?.description || ''), /remove multiple linked applications/i);
  assert.match(String((schema!.parameters as any).properties?.remove_applications?.description || ''), /remove multiple linked applications/i);
}

async function testSearchAllDelegatesToEntityTools() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    entityTools: {
      searchAll: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return { items: [{ id: 'app-1' }], total: 1, complete: false, entity_types: ['applications'] };
      },
    },
    policy: {
      listReadableEntityTypes: async () => ['applications'],
    },
  });

  const result = await registry.execute(createContext(), 'search_all', {
    query: 'billing',
    entity_types: ['applications'],
    limit: 5,
  }) as any;

  assert.equal(result.total, 1);
  assert.equal(result.complete, false);
  assert.deepEqual(calls, [{
    query: 'billing',
    entity_types: ['applications'],
    limit: 5,
  }]);
}

async function testSearchAllAppliesTokenLeanDefaultLimit() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    entityTools: {
      searchAll: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return { items: [], total: 0, complete: false, entity_types: ['applications'] };
      },
    },
  });

  await registry.execute(createContext(), 'search_all', {
    query: 'billing',
  });

  assert.deepEqual(calls, [{
    query: 'billing',
    limit: 25,
  }]);
}

async function testGetEntityContextDelegatesToEntityTools() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    entityTools: {
      getEntityContext: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return {
          entity: { id: 'app-1', metadata: {} },
          related: [],
          knowledge: null,
          total: 1,
          returned: 1,
          truncated: false,
          complete: true,
        };
      },
    },
    policy: {
      listReadableEntityTypes: async () => ['applications'],
    },
  });

  const result = await registry.execute(createContext(), 'get_entity_context', {
    entity_type: 'applications',
    entity_id: 'app-1',
  }) as any;

  assert.equal(result.entity.id, 'app-1');
  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [{
    entity_type: 'applications',
    entity_id: 'app-1',
  }]);
}

async function testGetEntityCommentsDelegatesToEntityTools() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    entityTools: {
      getEntityComments: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return {
          entity: { type: 'projects', id: 'project-1', ref: 'PRJ-1', label: 'Migration' },
          items: [{ author: 'Alex', content: 'Need a rollback plan.', created_at: '2026-03-29T10:00:00.000Z', updated_at: '2026-03-29T10:00:00.000Z', edited: false }],
          total: 1,
          offset: 0,
          limit: 20,
          returned: 1,
          truncated: false,
          complete: true,
        };
      },
    },
    policy: {
      listReadableEntityTypes: async () => ['projects'],
    },
  });

  const result = await registry.execute(createContext(), 'get_entity_comments', {
    entity_type: 'projects',
    entity_id: 'PRJ-1',
  }) as any;

  assert.equal(result.entity.ref, 'PRJ-1');
  assert.equal(result.items[0].content, 'Need a rollback plan.');
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [{
    entity_type: 'projects',
    entity_id: 'PRJ-1',
    offset: 0,
    limit: 20,
  }]);
}

async function testSearchKnowledgeMapsStableDto() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    knowledge: {
      search: async (query: unknown) => {
        calls.push(query);
        return {
          total: 1,
          items: [{
            id: 'doc-1',
            item_number: 14,
            title: 'AI Guide',
            summary: 'Tenant-safe knowledge',
            status: 'published',
            snippet: 'Stable DTO snippet',
            library_id: 'lib-1',
            library_name: 'Operations',
            updated_at: '2026-03-16T08:00:00.000Z',
          }],
        };
      },
    },
    policy: {
      listReadableEntityTypes: async () => ['documents'],
    },
  });

  const result = await registry.execute(createContext(), 'search_knowledge', {
    query: 'stable dto',
    limit: 10,
  }) as any;

  assert.equal(result.total, 1);
  assert.equal(result.items[0].ref, 'DOC-14');
  assert.equal(result.items[0].library.name, 'Operations');
  assert.equal(result.complete, false);
  assert.equal((calls[0] as any).matchMode, 'any');
}

async function testSearchKnowledgeAppliesDefaultLimit() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    knowledge: {
      search: async (query: unknown) => {
        calls.push(query);
        return { total: 0, items: [] };
      },
    },
  });

  await registry.execute(createContext(), 'search_knowledge', {
    query: 'runbook',
  });

  assert.deepEqual(calls, [{
    q: 'runbook',
    offset: 0,
    limit: 20,
    matchMode: 'any',
  }]);
}

async function testGetDocumentMapsStableDto() {
  const registry = createRegistry({
    knowledge: {
      get: async () => ({
        id: 'doc-1',
        item_number: 7,
        item_ref: 'DOC-7',
        title: 'Runbook',
        summary: 'Draft runbook',
        status: 'draft',
        content_markdown: '# Title',
        updated_at: '2026-03-16T08:00:00.000Z',
        library_id: 'lib-1',
        library_name: 'Knowledge',
        library_slug: 'knowledge',
        folder_id: 'folder-1',
        folder_name: 'Operations',
        document_type_id: 'type-1',
        document_type_name: 'Runbook',
        relations: {
          applications: [{ id: 'app-1', name: 'Billing App' }],
          assets: [],
          projects: [],
          requests: [],
          tasks: [],
        },
        contributors: [{ user_id: 'user-1', user_name: 'A. User', role: 'owner', is_primary: true }],
      }),
    },
    policy: {
      listReadableEntityTypes: async () => ['documents'],
    },
  });

  const result = await registry.execute(createContext(), 'get_document', {
    document_id: 'DOC-7',
  }) as any;

  assert.equal(result.ref, 'DOC-7');
  assert.equal(result.relations.applications[0].label, 'Billing App');
  assert.equal(result.contributors[0].name, 'A. User');
  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.complete, true);
}

async function testQueryEntitiesDelegatesToQueryExecutor() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    queryExecutor: {
      execute: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return { items: [{ id: 'task-1' }], total: 1, filters_applied: ['status'], filters_ignored: [], complete: true };
      },
    },
  });

  const result = await registry.execute(createContext(), 'query_entities', {
    entity_type: 'tasks',
    filters: { status: ['open'] },
    limit: 10,
  }) as any;

  assert.equal(result.total, 1);
  assert.deepEqual(calls, [{
    entity_type: 'tasks',
    filters: { status: ['open'] },
    page: 1,
    limit: 10,
  }]);
}

async function testQueryEntitiesAppliesGenerousDefaultLimit() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    queryExecutor: {
      execute: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return { items: [], total: 0, filters_applied: [], filters_ignored: [], complete: true };
      },
    },
  });

  await registry.execute(createContext(), 'query_entities', {
    entity_type: 'tasks',
  });

  assert.deepEqual(calls, [{
    entity_type: 'tasks',
    page: 1,
    limit: 200,
  }]);
}

async function testSchemasExposeDefaultLimits() {
  const registry = createRegistry();
  const schemas = await registry.getToolJsonSchemas(createContext()) as any[];

  const searchAll = schemas.find((schema) => schema.name === 'search_all');
  const queryEntities = schemas.find((schema) => schema.name === 'query_entities');
  const searchKnowledge = schemas.find((schema) => schema.name === 'search_knowledge');

  assert.equal(searchAll.parameters.properties.limit.default, 25);
  assert.equal(searchAll.parameters.properties.limit.maximum, 100);
  assert.equal(queryEntities.parameters.properties.page.default, 1);
  assert.equal(queryEntities.parameters.properties.limit.default, 200);
  assert.equal(searchKnowledge.parameters.properties.offset.default, 0);
  assert.equal(searchKnowledge.parameters.properties.limit.default, 20);
  assert.equal(searchKnowledge.parameters.properties.limit.maximum, 200);
}

async function testGetEntityCommentsSchemaExposesPaginationDefaults() {
  const registry = createRegistry({
    policy: {
      listReadableEntityTypes: async () => ['projects'],
    },
  });
  const schemas = await registry.getToolJsonSchemas(createContext()) as any[];
  const getEntityComments = schemas.find((schema) => schema.name === 'get_entity_comments');

  assert.ok(getEntityComments);
  assert.equal(getEntityComments.parameters.properties.offset.default, 0);
  assert.equal(getEntityComments.parameters.properties.limit.default, 20);
  assert.match(String(getEntityComments.parameters.properties.entity_id.description || ''), /PRJ-12|T-42/i);
}

async function testAggregateEntitiesDelegatesToAggregateExecutor() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    aggregateExecutor: {
      execute: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return { group_by: 'status', metric: 'priority_score', function: 'sum', groups: [{ key: 'open', value: 2 }], total: 2, filters_applied: [], filters_ignored: [], complete: true };
      },
    },
  });

  const result = await registry.execute(createContext(), 'aggregate_entities', {
    entity_type: 'tasks',
    group_by: 'status',
    metric: 'priority_score',
    function: 'sum',
  }) as any;

  assert.equal(result.total, 2);
  assert.deepEqual(calls, [{
    entity_type: 'tasks',
    group_by: 'status',
    metric: 'priority_score',
    function: 'sum',
  }]);
}

async function testAggregateEntitiesSchemaExposesMetricAndFunction() {
  const registry = createRegistry();
  const schemas = await registry.getToolJsonSchemas(createContext()) as any[];
  const aggregate = schemas.find((schema) => schema.name === 'aggregate_entities');

  assert.equal(aggregate.parameters.properties.metric.type, 'string');
  assert.deepEqual(aggregate.parameters.properties.function.enum, ['count', 'sum', 'avg', 'min', 'max']);
}

async function testGetFilterValuesDelegatesToQueryExecutor() {
  const calls: unknown[] = [];
  const registry = createRegistry({
    queryExecutor: {
      executeFilterValues: async (_context: unknown, input: unknown) => {
        calls.push(input);
        return { values: { status: ['open', 'done'] }, fields_ignored: [], total: 1, returned: 1, truncated: false, complete: true };
      },
    },
  });

  const result = await registry.execute(createContext(), 'get_filter_values', {
    entity_type: 'tasks',
    fields: ['status'],
  }) as any;

  assert.deepEqual(result.values.status, ['open', 'done']);
  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.complete, true);
  assert.deepEqual(calls, [{
    entity_type: 'tasks',
    fields: ['status'],
  }]);
}

async function testWebSearchRejectsOversizedQueries() {
  const original = Features.AI_WEB_SEARCH_READY;
  try {
    (Features as any).AI_WEB_SEARCH_READY = true;
    const registry = createRegistry();

    await assert.rejects(
      () => registry.execute(createContext(), 'web_search', {
        query: 'x'.repeat(257),
      }),
      () => true,
    );
  } finally {
    (Features as any).AI_WEB_SEARCH_READY = original;
  }
}

async function testWebSearchReturnsIncompleteResults() {
  const original = Features.AI_WEB_SEARCH_READY;
  try {
    (Features as any).AI_WEB_SEARCH_READY = true;
    const registry = createRegistry();
    const result = await registry.execute(createContext(), 'web_search', {
      query: 'kanap',
      count: 1,
    }) as any;

    assert.equal(result.total, null);
    assert.equal(result.returned, 1);
    assert.equal(result.truncated, false);
    assert.equal(result.complete, false);
  } finally {
    (Features as any).AI_WEB_SEARCH_READY = original;
  }
}

async function testQueryExecutorRejectsStructuredPredicatesInsideQuickSearch() {
  const executor = createQueryExecutor();

  await assert.rejects(
    () => executor.execute(createContext(), {
      entity_type: 'tasks',
      q: 'status:in_progress',
      limit: 10,
    }),
    (error: unknown) => {
      assert.equal(error instanceof BadRequestException, true);
      assert.match((error as Error).message, /Quick-search q must be plain text/i);
      assert.match((error as Error).message, /status:in_progress/i);
      return true;
    },
  );
}

async function testQueryExecutorAllowsLiteralQuickSearchText() {
  const calls: unknown[] = [];
  const executor = createQueryExecutor({
    tasks: {
      listAllTasks: async (query: unknown) => {
        calls.push(query);
        return { items: [], total: 0, page: 1, limit: 25 };
      },
    },
  });

  await executor.execute(createContext(), {
    entity_type: 'tasks',
    q: 'Siemens',
    limit: 25,
  });

  assert.equal(calls.length, 1);
  assert.equal((calls[0] as any).q, 'Siemens');
}

async function testQueryExecutorMarksFirstPageAsCompleteWhenFull() {
  const executor = createQueryExecutor({
    tasks: {
      listAllTasks: async () => ({
        items: [{ id: 'task-1' }],
        total: 1,
        page: 1,
        limit: 25,
      }),
    },
  });

  const result = await executor.execute(createContext(), {
    entity_type: 'tasks',
    limit: 25,
  });

  assert.equal(result.complete, true);
}

async function testQueryExecutorMarksLaterPagesIncompleteEvenWhenNotTruncated() {
  const executor = createQueryExecutor({
    tasks: {
      listAllTasks: async () => ({
        items: [{ id: 'task-26' }],
        total: 26,
        page: 2,
        limit: 25,
      }),
    },
  });

  const result = await executor.execute(createContext(), {
    entity_type: 'tasks',
    page: 2,
    limit: 25,
  });

  assert.equal(result.truncated, false);
  assert.equal(result.complete, false);
}

async function testQueryExecutorMarksIgnoredFiltersIncomplete() {
  let called = false;
  const executor = createQueryExecutor({
    tasks: {
      listAllTasks: async () => {
        called = true;
        return {
          items: [],
          total: 0,
          page: 1,
          limit: 25,
        };
      },
    },
  });

  const result = await executor.execute(createContext(), {
    entity_type: 'tasks',
    filters: { not_a_real_field: ['open'] } as any,
    limit: 25,
  });

  assert.equal(called, false);
  assert.equal((result as any).status, 'invalid_filter');
  assert.deepEqual(result.filters_ignored, ['not_a_real_field']);
  assert.match((result as any).suggested_repairs[0].reason, /describe_entity_filters/i);
  assert.equal(result.complete, false);
}

async function testQueryExecutorSuggestsSupportedFieldForAssigneeAlias() {
  const executor = createQueryExecutor();

  const result = await executor.execute(createContext(), {
    entity_type: 'tasks',
    filters: { assignee_id: ['user-1'] } as any,
    limit: 25,
  });

  assert.equal((result as any).status, 'invalid_filter');
  assert.deepEqual(result.filters_ignored, ['assignee_id']);
  assert.deepEqual((result as any).suggested_repairs, [{
    field: 'assignee',
    reason: 'Use supported AI field "assignee" instead of unsupported alias "assignee_id".',
  }]);
}

async function testQueryExecutorNormalizesTaskAssigneeEmailFilter() {
  const calls: unknown[] = [];
  const executor = createQueryExecutor({
    tasks: {
      listAllTasks: async (query: unknown) => {
        calls.push(query);
        return { items: [], total: 0, page: 1, limit: 25 };
      },
    },
  });
  const context = {
    ...createContext(),
    manager: {
      query: async () => ([{ display_name: 'Franck BONGAY' }]),
    } as any,
  };

  await executor.execute(context, {
    entity_type: 'tasks',
    filters: { assignee: 'john.smith@example.com' },
    limit: 25,
  });

  assert.equal(calls.length, 1);
  const filters = JSON.parse((calls[0] as any).filters);
  assert.deepEqual(filters.assignee_name, {
    filterType: 'set',
    values: ['Franck BONGAY'],
  });
}

async function testQueryExecutorMarksUnresolvedScopeIncomplete() {
  const executor = createQueryExecutor();
  const context = {
    ...createContext(),
    manager: {
      query: async () => ([]),
    } as any,
  };

  const result = await executor.execute(context, {
    entity_type: 'projects',
    scope: 'my_team',
    limit: 25,
  });

  assert.equal(result.complete, false);
  assert.deepEqual(result.scope, {
    requested: 'my_team',
    resolved: false,
    team_name: null,
  });
}

async function testFilterValuesMarksSupportedFieldsComplete() {
  const executor = createQueryExecutor();
  const result = await executor.executeFilterValues(createContext(), {
    entity_type: 'tasks',
    fields: ['status'],
  });

  assert.equal(result.total, 1);
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.fields_ignored, []);
  assert.equal(result.complete, true);
}

async function testFilterValuesMarksIgnoredFieldsIncomplete() {
  const executor = createQueryExecutor();
  const result = await executor.executeFilterValues(createContext(), {
    entity_type: 'tasks',
    fields: ['status', 'missing_field'],
  });

  assert.equal(result.total, 2);
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, false);
  assert.deepEqual(result.fields_ignored, ['missing_field']);
  assert.equal(result.complete, false);
}

async function testAggregateExecutorRejectsStructuredPredicatesInsideQuickSearch() {
  const executor = createAggregateExecutor();

  await assert.rejects(
    () => executor.execute(createContext(), {
      entity_type: 'tasks',
      group_by: 'status',
      q: 'status:in_progress',
    }),
    (error: unknown) => {
      assert.equal(error instanceof BadRequestException, true);
      assert.match((error as Error).message, /Quick-search q must be plain text/i);
      assert.match((error as Error).message, /status:in_progress/i);
      return true;
    },
  );
}

async function testAggregateExecutorMarksCompleteWhenNoIgnoredFilters() {
  const executor = createAggregateExecutor();
  const result = await executor.execute(createContext(), {
    entity_type: 'tasks',
    group_by: 'status',
  });

  assert.equal(result.total, 0);
  assert.equal(result.returned, 0);
  assert.equal(result.truncated, false);
  assert.equal(result.complete, true);
}

async function testAggregateExecutorMarksIgnoredFiltersIncomplete() {
  const executor = createAggregateExecutor();
  const result = await executor.execute(createContext(), {
    entity_type: 'tasks',
    group_by: 'status',
    filters: { not_a_real_field: ['open'] } as any,
  });

  assert.equal((result as any).status, 'invalid_filter');
  assert.deepEqual(result.filters_ignored, ['not_a_real_field']);
  assert.equal(result.complete, false);
}

async function testAggregateExecutorNormalizesTaskAssigneeEmailFilter() {
  const executor = createAggregateExecutor({
    tasks: {
      listIds: async (query: any) => {
        const filters = JSON.parse(query.filters);
        assert.deepEqual(filters.assignee_name, {
          filterType: 'set',
          values: ['Franck BONGAY'],
        });
        return { ids: [], total: 0 };
      },
    },
  });
  const context = {
    ...createContext(),
    manager: {
      query: async () => ([{ display_name: 'Franck BONGAY' }]),
    } as any,
  };

  await executor.execute(context, {
    entity_type: 'tasks',
    group_by: 'status',
    filters: { assignee: 'john.smith@example.com' },
  });
}

async function testAggregateExecutorMarksTruncatedWhenCollectedIdsAreCapped() {
  const executor = createAggregateExecutor({
    tasks: {
      listIds: async () => ({
        ids: ['task-1', 'task-2'],
        total: 3,
      }),
    },
  });
  const context = {
    ...createContext(),
    manager: {
      query: async () => ([{ key: 'open', count: 2 }]),
    } as any,
  };

  const result = await executor.execute(context, {
    entity_type: 'tasks',
    group_by: 'status',
  });

  assert.equal(result.total, 3);
  assert.equal(result.returned, 1);
  assert.equal(result.truncated, true);
  assert.equal(result.complete, false);
  assert.deepEqual(result.groups, [{ key: 'open', count: 2 }]);
}

async function testAggregateExecutorMarksUnresolvedScopeIncomplete() {
  const executor = createAggregateExecutor();
  const context = {
    ...createContext(),
    manager: {
      query: async () => ([]),
    } as any,
  };

  const result = await executor.execute(context, {
    entity_type: 'projects',
    group_by: 'status',
    scope: 'my_team',
  });

  assert.equal(result.complete, false);
  assert.deepEqual(result.scope, {
    requested: 'my_team',
    resolved: false,
    team_name: null,
  });
}

async function run() {
  await testListAvailableTools();
  await testTaskReadersSeeEntityCommentsTool();
  await testListRegisteredToolsExposesRuntimeRegistry();
  await testListAvailableToolsIncludesCategories();
  await testRegisteredToolCategoriesMatchExpectedAssignments();
  await testDescribeEntityFiltersExposesAssigneeFormat();
  await testSearchAllDelegatesToEntityTools();
  await testSearchAllAppliesTokenLeanDefaultLimit();
  await testChatSurfaceIncludesWritePreviewToolsWhenWriteAllowed();
  await testWritePreviewToolsStayHiddenWithoutWriteAccess();
  await testUpdateTaskAssigneesCreatesOnePreviewPerTaskAndReturnsPartialErrors();
  await testPrepareMutationPlanDelegatesToPreviewService();
  await testUndoPreviewStaysHiddenWhenOnlyNonReversibleWritesExist();
  await testGenericImportToolAppearsWhenLegacyGlpiSettingsAreConfigured();
  await testImportTicketToolAppearsWhenTicketingAdapterConfigExists();
  await testImportTicketToolStaysHiddenForCredentiallessTicketingAdapterConfig();
  await testCreateDocumentToolSchemaExposesBodyFields();
  await testCreateTaskToolSchemaExposesRelationAndAssignmentFields();
  await testImportGlpiTicketToolSchemaUsesNumericExclusiveMinimum();
  await testImportTicketToolSchemaRequiresProviderKey();
  await testUpdateDocumentContentToolSchemaExposesDocumentAndBodyFields();
  await testUpdateDocumentRelationsToolSchemaExposesRelationFields();
  await testQueryEntitiesDelegatesToQueryExecutor();
  await testQueryEntitiesAppliesGenerousDefaultLimit();
  await testAggregateEntitiesDelegatesToAggregateExecutor();
  await testAggregateEntitiesSchemaExposesMetricAndFunction();
  await testGetFilterValuesDelegatesToQueryExecutor();
  await testGetEntityContextDelegatesToEntityTools();
  await testGetEntityCommentsDelegatesToEntityTools();
  await testSearchKnowledgeMapsStableDto();
  await testSearchKnowledgeAppliesDefaultLimit();
  await testSchemasExposeDefaultLimits();
  await testGetEntityCommentsSchemaExposesPaginationDefaults();
  await testGetDocumentMapsStableDto();
  await testWebSearchRejectsOversizedQueries();
  await testWebSearchReturnsIncompleteResults();
  await testQueryExecutorRejectsStructuredPredicatesInsideQuickSearch();
  await testQueryExecutorAllowsLiteralQuickSearchText();
  await testQueryExecutorMarksFirstPageAsCompleteWhenFull();
  await testQueryExecutorMarksLaterPagesIncompleteEvenWhenNotTruncated();
  await testQueryExecutorMarksIgnoredFiltersIncomplete();
  await testQueryExecutorSuggestsSupportedFieldForAssigneeAlias();
  await testQueryExecutorNormalizesTaskAssigneeEmailFilter();
  await testQueryExecutorMarksUnresolvedScopeIncomplete();
  await testFilterValuesMarksSupportedFieldsComplete();
  await testFilterValuesMarksIgnoredFieldsIncomplete();
  await testAggregateExecutorRejectsStructuredPredicatesInsideQuickSearch();
  await testAggregateExecutorMarksCompleteWhenNoIgnoredFilters();
  await testAggregateExecutorMarksIgnoredFiltersIncomplete();
  await testAggregateExecutorNormalizesTaskAssigneeEmailFilter();
  await testAggregateExecutorMarksTruncatedWhenCollectedIdsAreCapped();
  await testAggregateExecutorMarksUnresolvedScopeIncomplete();
}

void run();
