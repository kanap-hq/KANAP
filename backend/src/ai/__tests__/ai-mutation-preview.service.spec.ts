import * as assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AiMutationPreviewService } from '../ai-mutation-preview.service';
import { AiMutationOperationRegistry } from '../mutation/ai-mutation-operation.registry';
import { AiDocumentMutationSupportService } from '../mutation/ai-document-mutation-support.service';
import { AiTaskMutationSupportService } from '../mutation/ai-task-mutation-support.service';
import { AddTaskCommentAiMutationOperation } from '../mutation/operations/add-task-comment.ai-mutation-operation';
import { CreateDocumentAiMutationOperation } from '../mutation/operations/create-document.ai-mutation-operation';
import { CreateTaskAiMutationOperation } from '../mutation/operations/create-task.ai-mutation-operation';
import { ImportGlpiTicketAiMutationOperation, ImportTicketAiMutationOperation } from '../mutation/operations/import-glpi-ticket.ai-mutation-operation';
import { UpdateDocumentContentAiMutationOperation } from '../mutation/operations/update-document-content.ai-mutation-operation';
import { UpdateDocumentMetadataAiMutationOperation } from '../mutation/operations/update-document-metadata.ai-mutation-operation';
import { UpdateDocumentRelationsAiMutationOperation } from '../mutation/operations/update-document-relations.ai-mutation-operation';
import { UpdateTaskAssigneeAiMutationOperation } from '../mutation/operations/update-task-assignee.ai-mutation-operation';
import { UpdateTaskStatusAiMutationOperation } from '../mutation/operations/update-task-status.ai-mutation-operation';

function createStatusPreview(overrides?: Record<string, unknown>) {
  return {
    id: 'preview-1',
    tenant_id: 'tenant-1',
    conversation_id: 'conv-1',
    user_id: 'user-1',
    tool_name: 'update_task_status',
    target_entity_type: 'tasks',
    target_entity_id: '11111111-1111-4111-8111-111111111111',
    mutation_input: { status: 'done' },
    current_values: {
      target_ref: 'T-1',
      target_title: 'Example task',
      status: 'open',
      assignee_user_id: null,
      assignee_label: null,
    },
    status: 'pending',
    approved_at: null,
    rejected_at: null,
    executed_at: null,
    expires_at: new Date('2099-03-24T10:10:00.000Z'),
    error_message: null,
    created_at: new Date('2026-03-24T10:00:00.000Z'),
    ...overrides,
  };
}

function createCommentPreview(overrides?: Record<string, unknown>) {
  return createStatusPreview({
    tool_name: 'add_task_comment',
    mutation_input: {
      content: 'Please investigate the rollback path.',
    },
    current_values: {
      target_ref: 'T-1',
      target_title: 'Example task',
    },
    ...overrides,
  });
}

function createDocumentMetadataPreview(overrides?: Record<string, unknown>) {
  return createStatusPreview({
    tool_name: 'update_document_metadata',
    target_entity_type: 'documents',
    target_entity_id: '22222222-2222-4222-8222-222222222222',
    mutation_input: {
      summary: 'Updated summary',
      review_due_at: '2026-04-30',
    },
    current_values: {
      target_ref: 'DOC-14',
      target_title: 'Disaster Recovery',
      summary: 'Current summary',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      revision: 3,
      is_managed_integrated_document: false,
    },
    ...overrides,
  });
}

function createDocumentContentPreview(overrides?: Record<string, unknown>) {
  return createStatusPreview({
    tool_name: 'update_document_content',
    target_entity_type: 'documents',
    target_entity_id: '22222222-2222-4222-8222-222222222222',
    mutation_input: {
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups\n\n## Restart\n\n- Restart the cluster',
    },
    current_values: {
      target_ref: 'DOC-14',
      target_title: 'Disaster Recovery',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
      revision: 3,
    },
    ...overrides,
  });
}

function createDocumentRelationsPreview(overrides?: Record<string, unknown>) {
  return createStatusPreview({
    tool_name: 'update_document_relations',
    target_entity_type: 'documents',
    target_entity_id: '22222222-2222-4222-8222-222222222222',
    mutation_input: {
      relations: {
        projects: ['project-1'],
      },
      relation_labels: {
        projects: [{ id: 'project-1', ref: 'PRJ-33', label: 'PRJ-33 - Website Refresh' }],
      },
    },
    current_values: {
      target_ref: 'DOC-14',
      target_title: 'Project Brief',
      revision: 3,
      relation_snapshot: {
        projects: [],
      },
    },
    ...overrides,
  });
}

function createService(options?: {
  previews?: any[];
  taskRow?: any;
  liveTask?: any;
  currentUserRow?: any;
  assigneeRow?: any;
  assigneeRows?: any[];
  documentRows?: any[];
  documentSearchRows?: any[];
  sqlResponses?: Array<{ pattern: string; rows: any[] | ((sql: string, params?: any[]) => any[]) }>;
  libraries?: any[];
  documentTypes?: any[];
  documentCreateResult?: any;
  workflowError?: Error;
  lockedDocumentError?: Error;
  writeAccessError?: Error;
  acquireLockError?: Error;
  releaseLockError?: Error;
  updateError?: Error;
  taskCreateResult?: any;
  contextUserId?: string;
  queryRunner?: any;
}) {
  const previews = [...(options?.previews || [createStatusPreview()])];
  const plans: any[] = [];
  const planSteps: any[] = [];
  const saved: any[] = [];
  const taskCreates: any[] = [];
  const taskUpdates: any[] = [];
  const activityCreates: any[] = [];
  const documentCreates: any[] = [];
  const documentUpdates: any[] = [];
  const documentLocksAcquired: any[] = [];
  const documentLocksReleased: any[] = [];
  const businessPermissionChecks: any[] = [];

  const previewRepo = {
    findOne: async ({ where }: any) =>
      previews.find((preview) =>
        preview.id === where.id
        && preview.tenant_id === where.tenant_id
        && preview.user_id === where.user_id,
      ) ?? null,
    save: async (record: any) => {
      const index = previews.findIndex((preview) => preview.id === record.id);
      if (index >= 0) {
        previews[index] = record;
      } else {
        previews.push(record);
      }
      saved.push(record);
      return record;
    },
    create: (payload: any) => ({ id: `preview-${previews.length + 1}`, ...payload }),
    find: async (opts: any) => {
      const createdAtOrder = opts?.order?.created_at;
      const expectedStatuses = Array.isArray(opts.where.status?.value)
        ? opts.where.status.value
        : Array.isArray(opts.where.status?._value)
          ? opts.where.status._value
          : Array.isArray(opts.where.status)
            ? opts.where.status
            : opts.where.status
              ? [opts.where.status]
              : null;
      const expectedToolNames = Array.isArray(opts.where.tool_name?.value)
        ? opts.where.tool_name.value
        : Array.isArray(opts.where.tool_name?._value)
          ? opts.where.tool_name._value
          : Array.isArray(opts.where.tool_name)
            ? opts.where.tool_name
            : opts.where.tool_name
              ? [opts.where.tool_name]
              : null;
      const rows = previews.filter((preview) =>
        preview.tenant_id === opts.where.tenant_id
        && preview.conversation_id === opts.where.conversation_id
        && preview.user_id === opts.where.user_id
        && (!expectedStatuses || expectedStatuses.includes(preview.status))
        && (!expectedToolNames || expectedToolNames.includes(preview.tool_name)),
      );
      rows.sort((left, right) => {
        const diff = left.created_at.getTime() - right.created_at.getTime();
        return createdAtOrder === 'DESC' ? -diff : diff;
      });
      return rows.slice(0, opts.take ?? rows.length);
    },
    count: async ({ where }: any) => {
      const expectedToolNames = Array.isArray(where.tool_name?.value)
        ? where.tool_name.value
        : Array.isArray(where.tool_name?._value)
          ? where.tool_name._value
          : Array.isArray(where.tool_name)
            ? where.tool_name
            : null;

      return previews.filter((preview) =>
        preview.tenant_id === where.tenant_id
        && preview.conversation_id === where.conversation_id
        && preview.user_id === where.user_id
        && preview.status === where.status
        && (!expectedToolNames || expectedToolNames.includes(preview.tool_name)),
      ).length;
    },
    createQueryBuilder: () => {
      const state: Record<string, unknown> = {};
      return {
        update() {
          return this;
        },
        set(values: Record<string, unknown>) {
          state.values = values;
          return this;
        },
        where() {
          return this;
        },
        andWhere() {
          return this;
        },
        execute: async () => ({ affected: 0, values: state.values }),
      };
    },
  };

  const taskRepo = {
    findOne: async () => options?.liveTask ?? {
      id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'tenant-1',
      status: 'open',
      assignee_user_id: null,
    },
  };

  const planRepo = {
    findOne: async ({ where }: any) =>
      plans.find((plan) =>
        (!where.id || plan.id === where.id)
        && plan.tenant_id === where.tenant_id
        && (!where.user_id || plan.user_id === where.user_id),
      ) ?? null,
    find: async ({ where, order }: any) => {
      const rows = plans.filter((plan) =>
        plan.tenant_id === where.tenant_id
        && (!where.conversation_id || plan.conversation_id === where.conversation_id)
        && (!where.status || plan.status === where.status),
      );
      if (order?.created_at) {
        rows.sort((left, right) => {
          const diff = left.created_at.getTime() - right.created_at.getTime();
          return order.created_at === 'DESC' ? -diff : diff;
        });
      }
      return rows;
    },
    save: async (record: any) => {
      const savedRecord = {
        id: record.id ?? `plan-${plans.length + 1}`,
        ...record,
      };
      const index = plans.findIndex((plan) => plan.id === savedRecord.id);
      if (index >= 0) {
        plans[index] = savedRecord;
      } else {
        plans.push(savedRecord);
      }
      return savedRecord;
    },
    create: (payload: any) => payload,
  };

  const planStepRepo = {
    findOne: async ({ where }: any) =>
      planSteps.find((step) =>
        (!where.id || step.id === where.id)
        && step.tenant_id === where.tenant_id
        && (!where.preview_id || step.preview_id === where.preview_id)
        && (!where.user_id || step.user_id === where.user_id),
      ) ?? null,
    find: async ({ where, order }: any) => {
      const rows = planSteps.filter((step) =>
        step.tenant_id === where.tenant_id
        && (!where.plan_id || step.plan_id === where.plan_id)
        && (!where.preview_id || step.preview_id === where.preview_id)
        && (!where.user_id || step.user_id === where.user_id)
        && (!where.status || step.status === where.status),
      );
      if (order?.created_at) {
        rows.sort((left, right) => {
          const diff = left.created_at.getTime() - right.created_at.getTime();
          return order.created_at === 'DESC' ? -diff : diff;
        });
      }
      return rows;
    },
    save: async (record: any) => {
      const savedRecord = {
        id: record.id ?? `plan-step-${planSteps.length + 1}`,
        ...record,
      };
      const index = planSteps.findIndex((step) => step.id === savedRecord.id);
      if (index >= 0) {
        planSteps[index] = savedRecord;
      } else {
        planSteps.push(savedRecord);
      }
      return savedRecord;
    },
    create: (payload: any) => payload,
  };

  const manager = {
    queryRunner: options?.queryRunner,
    getRepository: (entity?: any) => {
      if (entity?.name === 'Task') return taskRepo;
      if (entity?.name === 'AiMutationPlan') return planRepo;
      if (entity?.name === 'AiMutationPlanStep') return planStepRepo;
      return previewRepo;
    },
    query: async (sql: string, params?: any[]) => {
      for (const response of options?.sqlResponses || []) {
        if (!sql.includes(response.pattern)) {
          continue;
        }
        return typeof response.rows === 'function'
          ? response.rows(sql, params)
          : response.rows;
      }
      if (sql.includes('FROM tasks')) {
        return [options?.taskRow ?? {
          id: '11111111-1111-4111-8111-111111111111',
          item_number: 1,
          title: 'Example task',
          status: 'open',
          assignee_user_id: null,
          assignee_label: null,
        }];
      }
      if (sql.includes('FROM users u')) {
        if (sql.includes('AND u.id = $2')) {
          return [options?.currentUserRow ?? {
            id: options?.contextUserId ?? 'user-1',
            email: 'requestor@example.com',
            label: 'Requestor User',
          }];
        }
        if (sql.includes('LOWER(u.email) = LOWER($2)')) {
          return [options?.assigneeRow ?? {
            id: 'user-2',
            email: 'new@example.com',
            label: 'New User',
          }];
        }
        return options?.assigneeRows ?? [options?.assigneeRow ?? {
          id: 'user-2',
          email: 'new@example.com',
          label: 'New User',
        }];
      }
      if (sql.includes('FROM documents d')) {
        return options?.documentSearchRows ?? [];
      }
      return [];
    },
  };

  const support = new AiTaskMutationSupportService();
  const tasks = {
    createForTarget: async (...args: any[]) => {
      taskCreates.push(args);
      return options?.taskCreateResult ?? {
        id: '44444444-4444-4444-8444-444444444444',
        item_number: 44,
        title: args[0]?.payload?.title ?? 'New task',
      };
    },
    updateById: async (...args: any[]) => {
      taskUpdates.push(args);
    },
  };
  const policy = {
    assertWriteAccess: async () => undefined,
    assertBusinessPermission: async (...args: any[]) => {
      businessPermissionChecks.push(args);
    },
  };
  const defaultDocumentRow = {
    id: '22222222-2222-4222-8222-222222222222',
    item_ref: 'DOC-14',
    item_number: 14,
    title: 'Disaster Recovery',
    summary: 'Current summary',
    content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
    revision: 3,
    status: 'draft',
    review_due_at: '2026-04-01',
    last_reviewed_at: null,
    is_managed_integrated_document: false,
    library_name: 'Operations',
    library_slug: 'operations',
    folder_name: null,
    document_type_id: 'type-1',
    document_type_name: 'Document',
    template_document_id: null,
    template_document_title: null,
    template_document_item_number: null,
    relations: {
      applications: [],
      assets: [],
      projects: [],
      requests: [],
      tasks: [],
    },
  };
  const documentRows = [...(options?.documentRows || [defaultDocumentRow])];
  const knowledge = {
    listLibraries: async () => options?.libraries ?? [
      { id: 'library-1', name: 'Operations', is_system: false, can_write: true },
    ],
    listTypes: async () => options?.documentTypes ?? [
      { id: 'type-1', name: 'Document', is_default: true },
    ],
    get: async () => documentRows.shift() ?? defaultDocumentRow,
    // The preview now runs the same write gate as the mutation itself (S2).
    assertDocumentWritable: async () => {
      if (options?.writeAccessError) {
        throw options.writeAccessError;
      }
    },
    assertWorkflowAllowsEditing: async () => {
      if (options?.workflowError) {
        throw options.workflowError;
      }
    },
    assertDocumentUnlockedForUser: async () => {
      if (options?.lockedDocumentError) {
        throw options.lockedDocumentError;
      }
    },
    create: async (...args: any[]) => {
      documentCreates.push(args);
      return options?.documentCreateResult ?? {
        id: '33333333-3333-4333-8333-333333333333',
        item_ref: 'DOC-22',
        item_number: 22,
        title: args[0]?.title ?? 'New document',
      };
    },
    acquireLock: async (...args: any[]) => {
      documentLocksAcquired.push(args);
      if (options?.acquireLockError) {
        throw options.acquireLockError;
      }
      return {
        lock_token: 'lock-token-1',
        expires_at: new Date('2026-03-24T10:15:00.000Z'),
        holder_user_id: args[1],
      };
    },
    update: async (...args: any[]) => {
      documentUpdates.push(args);
      if (options?.updateError) {
        throw options.updateError;
      }
      return {
        id: args[0],
        item_ref: 'DOC-14',
      };
    },
    releaseLock: async (...args: any[]) => {
      documentLocksReleased.push(args);
      if (options?.releaseLockError) {
        throw options.releaseLockError;
      }
      return { ok: true };
    },
  };
  const documentSupport = new AiDocumentMutationSupportService(knowledge as any);
  const createMasterDataOperation = {
    toolName: 'create_master_data_record',
    businessResource: 'companies',
    writePreview: { reversible: false },
    presentPreview: () => ({
      target: { entity_type: 'companies', entity_id: null, ref: null, title: null },
      changes: {},
      summary: 'Create master data record.',
    }),
  };
  const updateMasterDataOperation = {
    toolName: 'update_master_data_record',
    businessResource: 'companies',
    writePreview: { reversible: false },
    presentPreview: () => ({
      target: { entity_type: 'companies', entity_id: null, ref: null, title: null },
      changes: {},
      summary: 'Update master data record.',
    }),
  };
  const createBusinessRecordOperation = {
    toolName: 'create_business_record',
    businessResource: 'applications',
    writePreview: { reversible: false },
    presentPreview: () => ({
      target: { entity_type: 'applications', entity_id: null, ref: null, title: null },
      changes: {},
      summary: 'Create business record.',
    }),
  };
  const writeFinancialPlanOperation = {
    toolName: 'write_financial_plan',
    businessResource: 'opex',
    writePreview: { reversible: true },
    presentPreview: () => ({
      target: { entity_type: 'spend_items', entity_id: null, ref: null, title: null },
      changes: {},
      summary: 'Write financial plan.',
    }),
  };
  const updateBusinessRecordOperation = {
    toolName: 'update_business_record',
    businessResource: 'applications',
    writePreview: { reversible: true },
    presentPreview: () => ({
      target: { entity_type: 'applications', entity_id: null, ref: null, title: null },
      changes: {},
      summary: 'Update business record.',
    }),
  };
  const updateEntityRelationsOperation = {
    toolName: 'update_entity_relations',
    businessResource: 'applications',
    writePreview: { reversible: true },
    presentPreview: () => ({
      target: { entity_type: 'applications', entity_id: null, ref: null, title: null },
      changes: {},
      summary: 'Update entity relations.',
    }),
  };
  const updateTaskFieldsOperation = {
    toolName: 'update_task_fields',
    businessResource: 'tasks',
    writePreview: { reversible: true },
    presentPreview: () => ({
      target: { entity_type: 'tasks', entity_id: null, ref: null, title: null },
      changes: {},
      summary: 'Update task fields.',
    }),
  };
  const operations = new AiMutationOperationRegistry(
    new ImportGlpiTicketAiMutationOperation(
      support,
      tasks as any,
      {} as any,
      {} as any,
      {} as any,
      policy as any,
    ),
    new CreateDocumentAiMutationOperation(
      documentSupport,
      knowledge as any,
    ),
    new CreateTaskAiMutationOperation(
      support,
      tasks as any,
      policy as any,
    ),
    createMasterDataOperation as any,
    createBusinessRecordOperation as any,
    writeFinancialPlanOperation as any,
    new UpdateDocumentContentAiMutationOperation(
      documentSupport,
      knowledge as any,
    ),
    new UpdateDocumentMetadataAiMutationOperation(
      documentSupport,
      knowledge as any,
    ),
    new UpdateDocumentRelationsAiMutationOperation(
      documentSupport,
      knowledge as any,
    ),
    updateMasterDataOperation as any,
    updateBusinessRecordOperation as any,
    updateEntityRelationsOperation as any,
    updateTaskFieldsOperation as any,
    new UpdateTaskStatusAiMutationOperation(
      support,
      tasks as any,
    ),
    new UpdateTaskAssigneeAiMutationOperation(
      support,
      tasks as any,
    ),
    new AddTaskCommentAiMutationOperation(
      support,
      {
        create: async (...args: any[]) => {
          activityCreates.push(args);
        },
      } as any,
    ),
    new ImportTicketAiMutationOperation(
      support,
      tasks as any,
      {} as any,
      {} as any,
      {} as any,
      policy as any,
    ),
  );

  const service = new AiMutationPreviewService(
    { manager } as any,
    { manager } as any,
    { manager } as any,
    policy as any,
    operations,
  );

  return {
    service,
    saved,
    taskCreates,
    taskUpdates,
    activityCreates,
    documentCreates,
    documentUpdates,
    documentLocksAcquired,
    documentLocksReleased,
    businessPermissionChecks,
    plans,
    planSteps,
    context: {
      tenantId: 'tenant-1',
      userId: options?.contextUserId ?? 'user-1',
      isPlatformHost: false,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      conversationId: 'conv-1',
      manager: manager as any,
    },
  };
}

async function testCreatePreviewPersistsCorrectData() {
  const { service, context, saved } = createService({
    previews: [],
    taskRow: {
      id: 'task-1',
      item_number: 42,
      title: 'Fix login bug',
      status: 'open',
      assignee_user_id: null,
      assignee_label: null,
    },
  });

  const result = await service.createPreview(context, 'update_task_status', {
    ref: 'T-42',
    status: 'done',
  });

  assert.equal(result.preview_id, 'preview-1');
  assert.equal(result.status, 'pending');
  assert.equal(result.target.ref, 'T-42');
  assert.equal(result.target.title, 'Fix login bug');
  assert.equal(result.changes.status.from, 'open');
  assert.equal(result.changes.status.to, 'done');
  assert.equal(saved[0].mutation_input.status, 'done');
  assert.equal(saved[0].current_values.status, 'open');
  assert.equal(saved[0].conversation_id, 'conv-1');
}

async function testCreatePreviewAllowsMultiplePendingPreviewsInConversation() {
  const { service, context } = createService({
    previews: [],
    taskRow: {
      id: 'task-1',
      item_number: 42,
      title: 'Fix login bug',
      status: 'open',
      assignee_user_id: null,
      assignee_label: null,
    },
  });

  const first = await service.createPreview(context, 'update_task_status', {
    ref: 'T-42',
    status: 'in_progress',
  });
  const second = await service.createPreview(context, 'update_task_status', {
    ref: 'T-42',
    status: 'done',
  });

  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'pending');
  assert.notEqual(first.preview_id, second.preview_id);
}

async function testCreatePreviewReusesEquivalentPendingPreviewInConversation() {
  const { service, context, saved } = createService({
    previews: [],
    taskRow: {
      id: 'task-1',
      item_number: 42,
      title: 'Fix login bug',
      status: 'open',
      assignee_user_id: null,
      assignee_label: null,
    },
  });

  const first = await service.createPreview(context, 'update_task_status', {
    ref: 'T-42',
    status: 'done',
  });
  const second = await service.createPreview(context, 'update_task_status', {
    ref: 'T-42',
    status: 'done',
  });

  assert.equal(first.status, 'pending');
  assert.equal(second.status, 'pending');
  assert.equal(first.preview_id, second.preview_id);
  assert.equal(saved.length, 1);
}

async function testMutationPlanCreatesDependentPreviewAfterApproval() {
  const { service, context, planSteps } = createService({
    previews: [],
    taskRow: {
      id: '11111111-1111-4111-8111-111111111111',
      item_number: 1,
      title: 'Example task',
      status: 'open',
      assignee_user_id: null,
      assignee_label: null,
    },
    liveTask: {
      id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'tenant-1',
      status: 'open',
      assignee_user_id: null,
    },
    assigneeRow: {
      id: 'user-2',
      email: 'new@example.com',
      label: 'New User',
    },
  });

  const plan = await service.createMutationPlan(context, {
    summary: 'Update status, then assign the same task.',
    operations: [
      {
        operation_id: 'status_step',
        tool_name: 'update_task_status',
        input: { ref: 'T-1', status: 'done' },
      },
      {
        operation_id: 'assignee_step',
        tool_name: 'update_task_assignee',
        input: { ref: '{{status_step.ref}}', assignee_email: 'new@example.com' },
        depends_on: ['status_step'],
      },
    ],
  });

  assert.equal(plan.total, 2);
  assert.equal(plan.created, 1);
  assert.equal(plan.deferred_count, 1);
  assert.equal(plan.previews[0].tool_name, 'update_task_status');

  const execution = await service.executePreviewsWithFollowUps(context, [plan.previews[0].preview_id]);
  assert.equal(execution.results[0].status, 'executed');
  assert.equal(execution.followUpPreviews.length, 1);
  assert.equal(execution.followUpPreviews[0].tool_name, 'update_task_assignee');
  assert.equal(execution.followUpPreviews[0].target.ref, 'T-1');

  const statusStep = planSteps.find((step) => step.step_key === 'status_step');
  const assigneeStep = planSteps.find((step) => step.step_key === 'assignee_step');
  assert.equal(statusStep?.status, 'executed');
  assert.equal(assigneeStep?.status, 'preview_ready');
  assert.equal(assigneeStep?.preview_id, execution.followUpPreviews[0].preview_id);
}

async function testMutationPlanNormalizesLegacyGlpiImportStep() {
  const { service, context, planSteps } = createService({ previews: [] });

  await service.createMutationPlan(context, {
    summary: 'Import one legacy GLPI ticket.',
    operations: [
      {
        operation_id: 'import_step',
        tool_name: 'import_glpi_ticket',
        input: {
          ticket_id: 123,
          relation_type: 'standalone',
        },
      },
    ],
  });

  const importStep = planSteps.find((step) => step.step_key === 'import_step');
  assert.equal(importStep?.tool_name, 'import_ticket');
  assert.deepEqual(importStep?.input, {
    ticket_id: 123,
    relation_type: 'standalone',
    provider_key: 'glpi',
  });
}

async function testMutationPlanDeduplicatesEquivalentOperationsAndRemapsDependents() {
  const { service, context, planSteps } = createService({
    previews: [],
    taskRow: {
      id: '11111111-1111-4111-8111-111111111111',
      item_number: 1,
      title: 'Example task',
      status: 'open',
      assignee_user_id: null,
      assignee_label: null,
    },
    liveTask: {
      id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'tenant-1',
      status: 'open',
      assignee_user_id: null,
    },
    assigneeRow: {
      id: 'user-2',
      email: 'new@example.com',
      label: 'New User',
    },
  });

  const plan = await service.createMutationPlan(context, {
    summary: 'Duplicate status step should collapse to one dependency.',
    operations: [
      {
        operation_id: 'status_step',
        tool_name: 'update_task_status',
        input: { ref: 'T-1', status: 'done' },
      },
      {
        operation_id: 'duplicate_status_step',
        tool_name: 'update_task_status',
        input: { ref: 'T-1', status: 'done' },
      },
      {
        operation_id: 'assignee_step',
        tool_name: 'update_task_assignee',
        input: { ref: '{{status_step.ref}}', assignee_email: 'new@example.com' },
        depends_on: ['duplicate_status_step'],
      },
    ],
  });

  assert.equal(plan.total, 2);
  assert.equal(plan.created, 1);
  assert.equal(plan.deferred_count, 1);
  assert.deepEqual(planSteps.map((step) => [step.step_key, step.depends_on]), [
    ['status_step', []],
    ['assignee_step', ['status_step']],
  ]);

  const execution = await service.executePreviewsWithFollowUps(context, [plan.previews[0].preview_id]);
  assert.equal(execution.results[0].status, 'executed');
  assert.equal(execution.followUpPreviews.length, 1);
  assert.equal(execution.followUpPreviews[0].tool_name, 'update_task_assignee');
}

async function testMutationPlanAdvancesDependentsWhenRootPreviewAlreadyExecuted() {
  const { service, context, planSteps } = createService({
    previews: [
      createStatusPreview({
        status: 'executed',
        approved_at: new Date('2026-03-24T10:01:00.000Z'),
        executed_at: new Date('2026-03-24T10:01:00.000Z'),
      }),
    ],
    taskRow: {
      id: '11111111-1111-4111-8111-111111111111',
      item_number: 1,
      title: 'Example task',
      status: 'open',
      assignee_user_id: null,
      assignee_label: null,
    },
    liveTask: {
      id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'tenant-1',
      status: 'done',
      assignee_user_id: null,
    },
    assigneeRow: {
      id: 'user-2',
      email: 'new@example.com',
      label: 'New User',
    },
  });

  const plan = await service.createMutationPlan(context, {
    summary: 'Reuse already executed root step, then prepare its dependent step.',
    operations: [
      {
        operation_id: 'status_step',
        tool_name: 'update_task_status',
        input: { ref: 'T-1', status: 'done' },
      },
      {
        operation_id: 'assignee_step',
        tool_name: 'update_task_assignee',
        input: { ref: '{{status_step.ref}}', assignee_email: 'new@example.com' },
        depends_on: ['status_step'],
      },
    ],
  });

  assert.equal(plan.total, 2);
  assert.equal(plan.created, 1);
  assert.equal(plan.deferred_count, 0);
  assert.equal(plan.previews.length, 1);
  assert.equal(plan.previews[0].tool_name, 'update_task_assignee');

  const statusStep = planSteps.find((step) => step.step_key === 'status_step');
  const assigneeStep = planSteps.find((step) => step.step_key === 'assignee_step');
  assert.equal(statusStep?.status, 'executed');
  assert.equal(assigneeStep?.status, 'preview_ready');
  assert.equal(assigneeStep?.preview_id, plan.previews[0].preview_id);
}

async function testMutationPlanBlocksDependentsWhenDependencyPreparationFails() {
  const { service, context, planSteps } = createService({ previews: [] });

  const plan = await service.createMutationPlan(context, {
    summary: 'Unsupported first step blocks its dependent step.',
    operations: [
      {
        operation_id: 'bad_step',
        tool_name: 'unsupported_tool',
        input: {},
      },
      {
        operation_id: 'dependent_step',
        tool_name: 'update_task_status',
        input: { ref: '{{bad_step.ref}}', status: 'done' },
        depends_on: ['bad_step'],
      },
    ],
  });

  assert.equal(plan.created, 0);
  assert.equal(plan.failed, 2);
  assert.equal(plan.complete, false);
  assert.deepEqual(planSteps.map((step) => [step.step_key, step.status]), [
    ['bad_step', 'failed'],
    ['dependent_step', 'blocked'],
  ]);
  assert.ok(plan.errors.some((error) =>
    error.step_key === 'dependent_step' && /Dependency bad_step/i.test(error.message),
  ));
}

async function testMutationPlanReportsMissingExpectedTargetRefs() {
  const { service, context } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM tasks',
      rows: (_sql: string, params?: any[]) => {
        const itemNumber = Number(params?.[1] ?? 1);
        return [{
          id: `11111111-1111-4111-8111-${String(itemNumber).padStart(12, '0')}`,
          item_number: itemNumber,
          title: `Task ${itemNumber}`,
          status: 'open',
          assignee_user_id: null,
          assignee_label: null,
        }];
      },
    }],
  });

  const plan = await service.createMutationPlan(context, {
    summary: 'Add comments to overdue tasks.',
    target_set_label: 'active overdue tasks',
    expected_target_refs: ['T-1', 'T-2', 'T-3', 'T-4'],
    expected_target_count: 4,
    operations: [
      {
        operation_id: 'comment_t_1',
        tool_name: 'add_task_comment',
        input: { ref: 'T-1', content: 'allo ?' },
      },
      {
        operation_id: 'comment_t_2',
        tool_name: 'add_task_comment',
        input: { ref: 'T-2', content: 'allo ?' },
      },
      {
        operation_id: 'comment_t_3',
        tool_name: 'add_task_comment',
        input: { ref: 'T-3', content: 'allo ?' },
      },
    ],
  });

  assert.equal(plan.created, 3);
  assert.equal(plan.expected_count, 4);
  assert.deepEqual(plan.covered_refs, ['T-1', 'T-2', 'T-3']);
  assert.deepEqual(plan.missing_refs, ['T-4']);
  assert.equal(plan.complete, false);
}

async function testMutationPlanAcceptsExplicitTargetExclusion() {
  const { service, context } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM tasks',
      rows: (_sql: string, params?: any[]) => {
        const itemNumber = Number(params?.[1] ?? 1);
        return [{
          id: `11111111-1111-4111-8111-${String(itemNumber).padStart(12, '0')}`,
          item_number: itemNumber,
          title: `Task ${itemNumber}`,
          status: 'open',
          assignee_user_id: null,
          assignee_label: null,
        }];
      },
    }],
  });

  const plan = await service.createMutationPlan(context, {
    summary: 'Add comments to active overdue tasks.',
    target_set_label: 'active overdue tasks',
    expected_target_refs: ['T-1', 'T-2', 'T-3', 'T-4'],
    expected_target_count: 4,
    explicit_exclusions: [{ ref: 'T-4', reason: 'Task is not active under the stated assumption.' }],
    operations: [
      {
        operation_id: 'comment_t_1',
        tool_name: 'add_task_comment',
        input: { ref: 'T-1', content: 'allo ?' },
      },
      {
        operation_id: 'comment_t_2',
        tool_name: 'add_task_comment',
        input: { ref: 'T-2', content: 'allo ?' },
      },
      {
        operation_id: 'comment_t_3',
        tool_name: 'add_task_comment',
        input: { ref: 'T-3', content: 'allo ?' },
      },
    ],
  });

  assert.equal(plan.created, 3);
  assert.deepEqual(plan.missing_refs, []);
  assert.deepEqual(plan.excluded, [{ ref: 'T-4', reason: 'Task is not active under the stated assumption.' }]);
  assert.equal(plan.complete, true);
}

async function testCreateCommentPreviewPersistsMarkdownPayload() {
  const { service, context, saved } = createService({ previews: [] });

  const result = await service.createPreview(context, 'add_task_comment', {
    ref: 'T-1',
    content: 'Please **investigate** the rollback path.',
  });

  assert.equal(result.tool_name, 'add_task_comment');
  assert.equal(result.changes.comment.format, 'markdown');
  assert.equal(result.changes.comment.from, null);
  assert.match(result.changes.comment.to || '', /\*\*investigate\*\*/);
  assert.equal(saved[0].tool_name, 'add_task_comment');
  assert.equal(saved[0].mutation_input.content, 'Please **investigate** the rollback path.');
}

async function testCreateTaskPreviewPersistsResolvedStandaloneFields() {
  const { service, context, saved } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM users u',
      rows: (sql: string) => {
        if (sql.includes('AND u.id = $2')) {
          return [{
            id: 'user-1',
            email: 'requestor@example.com',
            label: 'Requestor User',
          }];
        }
        if (sql.includes('LOWER(u.email) = LOWER($2)')) {
          return [];
        }
        return [{
          id: 'user-2',
          email: 'michael@example.com',
          label: 'Michael Dupont',
        }];
      },
    }],
  });

  const result = await service.createPreview(context, 'create_task', {
    title: 'Install server X',
    description: 'Install with the standard SQL Server procedure.',
    assignee: 'Michael Dupont',
    priority_level: 'high',
  });

  assert.equal(result.tool_name, 'create_task');
  assert.equal(result.status, 'pending');
  assert.equal(result.target.entity_id, null);
  assert.equal(result.target.title, 'Install server X');
  assert.equal(result.changes.relation.to, 'Standalone');
  assert.equal(result.changes.requestor.to, 'Requestor User');
  assert.equal(result.changes.assignee.to, 'Michael Dupont');
  assert.equal(result.changes.priority.to, 'High');
  assert.equal(result.changes.status.to, 'Open');
  assert.equal(saved[0].mutation_input.relation_type, 'standalone');
  assert.equal(saved[0].mutation_input.requestor_user_id, 'user-1');
  assert.equal(saved[0].mutation_input.assignee_user_id, 'user-2');
  assert.equal(saved[0].mutation_input.priority_level, 'high');
}

async function testCreateTaskPreviewPersistsResolvedProjectFields() {
  const {
    service,
    context,
    saved,
    businessPermissionChecks,
  } = createService({
    previews: [],
    sqlResponses: [
      {
        pattern: 'FROM users u',
        rows: (sql: string) => (sql.includes('AND u.id = $2')
          ? [{
              id: 'user-1',
              email: 'requestor@example.com',
              label: 'Requestor User',
            }]
          : []),
      },
      {
        pattern: 'FROM portfolio_projects',
        rows: [{
          id: 'project-1',
          name: 'SQL Refresh',
          item_number: 33,
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
      {
        pattern: 'FROM portfolio_task_types',
        rows: [{
          id: 'task-type-1',
          name: 'Implementation',
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
      {
        pattern: 'FROM portfolio_project_phases',
        rows: [{
          id: 'phase-1',
          name: 'Execution',
        }],
      },
    ],
  });

  const result = await service.createPreview(context, 'create_task', {
    title: 'Install server X',
    relation_type: 'project',
    relation_ref: 'PRJ-33',
    task_type: 'Implementation',
    phase: 'Execution',
  });

  assert.equal(result.changes.relation.to, 'PRJ-33 - SQL Refresh');
  assert.equal(result.changes.task_type.to, 'Implementation');
  assert.equal(result.changes.phase.to, 'Execution');
  assert.equal(saved[0].mutation_input.relation_id, 'project-1');
  assert.equal(saved[0].mutation_input.task_type_id, 'task-type-1');
  assert.equal(saved[0].mutation_input.phase_id, 'phase-1');
  assert.equal(businessPermissionChecks.length, 1);
  assert.equal(businessPermissionChecks[0][1], 'portfolio_projects');
  assert.equal(businessPermissionChecks[0][2], 'contributor');
}

async function testCreateTaskPreviewResolvesSpendItemRelation() {
  const { service, context, saved, businessPermissionChecks } = createService({
    previews: [],
    sqlResponses: [
      {
        pattern: 'FROM users u',
        rows: (sql: string) => (sql.includes('AND u.id = $2')
          ? [{
              id: 'user-1',
              email: 'requestor@example.com',
              label: 'Requestor User',
            }]
          : []),
      },
      {
        pattern: 'FROM spend_items',
        rows: [{
          id: 'spend-1',
          name: 'SQL Server License',
          item_number: null,
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
    ],
  });

  const result = await service.createPreview(context, 'create_task', {
    title: 'Renew SQL Server License',
    relation_type: 'spend_item',
    relation_ref: 'SQL Server License',
  });

  assert.equal(result.changes.relation.to, 'OPEX - SQL Server License');
  assert.equal(saved[0].mutation_input.relation_id, 'spend-1');
  assert.equal(businessPermissionChecks.length, 0);
}

async function testCreateTaskPreviewResolvesCapexRelation() {
  const { service, context, saved } = createService({
    previews: [],
    sqlResponses: [
      {
        pattern: 'FROM users u',
        rows: (sql: string) => (sql.includes('AND u.id = $2')
          ? [{
              id: 'user-1',
              email: 'requestor@example.com',
              label: 'Requestor User',
            }]
          : []),
      },
      {
        // Lot Z1: a CAPEX line is a spend line of nature 'capex'.
        pattern: 'FROM spend_items',
        rows: (sql: string) => (sql.includes(`target.nature = 'capex'`)
          ? [{
              id: 'capex-1',
              name: 'New SAN',
              item_number: null,
              updated_at: '2026-03-28T10:00:00.000Z',
            }]
          : []),
      },
    ],
  });

  const result = await service.createPreview(context, 'create_task', {
    title: 'Rack the SAN',
    relation_type: 'capex_item',
    relation_ref: 'New SAN',
  });

  assert.equal(result.changes.relation.to, 'CAPEX - New SAN');
  assert.equal(saved[0].mutation_input.relation_id, 'capex-1');
}

async function testCreateTaskPreviewRequiresConfirmationForAmbiguousAssignee() {
  const { service, context } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM users u',
      rows: (sql: string) => {
        if (sql.includes('AND u.id = $2')) {
          return [{
            id: 'user-1',
            email: 'requestor@example.com',
            label: 'Requestor User',
          }];
        }
        if (sql.includes('LOWER(u.email) = LOWER($2)')) {
          return [];
        }
        return [
          {
            id: 'user-2',
            email: 'michael.dupont@example.com',
            label: 'Michael Dupont',
          },
          {
            id: 'user-3',
            email: 'michael.doe@example.com',
            label: 'Michael Doe',
          },
        ];
      },
    }],
  });

  await assert.rejects(
    () => service.createPreview(context, 'create_task', {
      title: 'Install server X',
      assignee: 'Michael',
    }),
    (error: any) => error instanceof BadRequestException
      && /ambiguous/i.test(error.message)
      && /confirm which user/i.test(error.message),
  );
}

async function testCreateDocumentPreviewPersistsResolvedDefaults() {
  const { service, context, saved } = createService({ previews: [] });

  const result = await service.createPreview(context, 'create_document', {
    title: 'Disaster Recovery Runbook',
    summary: 'Draft for the DR procedure.',
    content_markdown: '## Steps\n\n- Verify backups',
  });

  assert.equal(result.tool_name, 'create_document');
  assert.equal(result.status, 'pending');
  assert.equal(result.target.entity_id, null);
  assert.equal(result.target.title, 'Disaster Recovery Runbook');
  assert.equal(result.changes.library.to, 'Operations');
  assert.equal(result.changes.document_type.to, 'Document');
  assert.equal(saved[0].mutation_input.library_id, 'library-1');
  assert.equal(saved[0].mutation_input.document_type_id, 'type-1');
}

async function testCreateDocumentPreviewUsesTemplateContentAndType() {
  const { service, context, saved } = createService({
    previews: [],
    documentSearchRows: [{
      id: 'template-1',
      item_number: 50,
      title: 'Project Brief',
      library_name: 'Templates',
      library_slug: 'templates',
      document_type_name: 'Brief',
      updated_at: '2026-03-28T10:00:00.000Z',
    }],
    documentRows: [{
      id: 'template-1',
      item_ref: 'DOC-50',
      item_number: 50,
      title: 'Project Brief',
      summary: null,
      content_markdown: '# Project Brief\n\n## Context\n\n- Fill me in',
      revision: 8,
      status: 'published',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      library_name: 'Templates',
      library_slug: 'templates',
      folder_name: null,
      document_type_id: 'type-brief',
      document_type_name: 'Brief',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }],
  });

  const result = await service.createPreview(context, 'create_document', {
    title: 'Project 33 Brief',
    template_document: 'Project Brief',
  });

  assert.equal(result.tool_name, 'create_document');
  assert.equal(result.changes.template_document.to, 'DOC-50 - Project Brief');
  assert.equal(result.changes.document_type.to, 'Brief');
  assert.equal(result.changes.content.to, '# Project Brief\n\n## Context\n\n- Fill me in');
  assert.equal(saved[0].mutation_input.template_document_id, 'template-1');
  assert.equal(saved[0].mutation_input.document_type_id, 'type-brief');
}

async function testCreateDocumentPreviewIncludesResolvedRelations() {
  const { service, context, saved } = createService({
    previews: [],
    sqlResponses: [
      {
        pattern: 'FROM portfolio_projects',
        rows: [{
          id: 'project-1',
          name: 'Website Refresh',
          item_number: 33,
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
      {
        pattern: 'FROM applications',
        rows: [{
          id: 'app-1',
          name: 'Billing App',
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
    ],
  });

  const result = await service.createPreview(context, 'create_document', {
    title: 'Project 33 Brief',
    projects: 'PRJ-33',
    applications: 'Billing App',
  });

  assert.equal(result.changes.linked_projects.to, '- PRJ-33 - Website Refresh');
  assert.equal(result.changes.linked_applications.to, '- Billing App');
  assert.deepEqual(saved[0].mutation_input.relations, {
    projects: ['project-1'],
    applications: ['app-1'],
  });
}

async function testCreateDocumentTemplateAmbiguityFailsWithConfirmationMessage() {
  const { service, context } = createService({
    previews: [],
    documentSearchRows: [{
      id: 'template-1',
      item_number: 50,
      title: 'Project Brief',
      library_name: 'Templates',
      library_slug: 'templates',
      document_type_name: 'Brief',
      updated_at: '2026-03-28T10:00:00.000Z',
    }, {
      id: 'template-2',
      item_number: 51,
      title: 'Project Brief',
      library_name: 'Templates',
      library_slug: 'templates',
      document_type_name: 'Brief',
      updated_at: '2026-03-20T10:00:00.000Z',
    }],
  });

  await assert.rejects(
    () => service.createPreview(context, 'create_document', {
      title: 'Project 33 Brief',
      template_document: 'Project Brief',
    }),
    (error: any) => error instanceof BadRequestException
      && /Most likely:/i.test(error.message)
      && /confirm which template to use/i.test(error.message),
  );
}

async function testCreateDocumentTemplateReferenceMustPointToTemplatesLibrary() {
  const { service, context } = createService({
    previews: [],
    documentRows: [{
      id: 'not-a-template',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Operational Runbook',
      summary: null,
      content_markdown: '# Runbook',
      revision: 3,
      status: 'draft',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      library_name: 'Operations',
      library_slug: 'operations',
      folder_name: null,
      document_type_id: 'type-1',
      document_type_name: 'Document',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }],
  });

  await assert.rejects(
    () => service.createPreview(context, 'create_document', {
      title: 'Project 33 Brief',
      template_document: 'DOC-14',
    }),
    (error: any) => error instanceof BadRequestException
      && /Templates library/i.test(error.message),
  );
}

async function testCreateDocumentInputSchemaAcceptsContentAlias() {
  const knowledge = {
    listLibraries: async () => [{ id: 'library-1', name: 'Operations', is_system: false, can_write: true }],
    listTypes: async () => [{ id: 'type-1', name: 'Document', is_default: true }],
    get: async () => null,
    assertDocumentWritable: async () => undefined,
    assertWorkflowAllowsEditing: async () => undefined,
    assertDocumentUnlockedForUser: async () => undefined,
    create: async () => null,
  };
  const operation = new CreateDocumentAiMutationOperation(
    new AiDocumentMutationSupportService(knowledge as any),
    knowledge as any,
  );

  const parsed = operation.inputSchema.safeParse({
    title: 'Disaster Recovery Runbook',
    content: '## Steps\n\n- Verify backups',
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.content_markdown, '## Steps\n\n- Verify backups');
  }
}

async function testCreateDocumentInputSchemaAcceptsTemplateAlias() {
  const knowledge = {
    listLibraries: async () => [{ id: 'library-1', name: 'Operations', is_system: false, can_write: true }],
    listTypes: async () => [{ id: 'type-1', name: 'Document', is_default: true }],
    get: async () => null,
    assertDocumentWritable: async () => undefined,
    assertWorkflowAllowsEditing: async () => undefined,
    assertDocumentUnlockedForUser: async () => undefined,
    create: async () => null,
  };
  const operation = new CreateDocumentAiMutationOperation(
    new AiDocumentMutationSupportService(knowledge as any),
    knowledge as any,
  );

  const parsed = operation.inputSchema.safeParse({
    title: 'Project 33 Brief',
    template: 'Project Brief',
  });

  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.template_document, 'Project Brief');
  }
}

async function testExecuteCreateDocumentRoutesThroughKnowledgeService() {
  const { service, context, documentCreates } = createService({ previews: [] });

  await service.createPreview(context, 'create_document', {
    title: 'Disaster Recovery Runbook',
    summary: 'Draft for the DR procedure.',
    content_markdown: '## Steps\n\n- Verify backups',
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'executed');
  assert.equal(result.target.entity_id, '33333333-3333-4333-8333-333333333333');
  assert.equal(result.target.ref, 'DOC-22');
  assert.equal(documentCreates.length, 1);
  assert.deepEqual(documentCreates[0][0], {
    title: 'Disaster Recovery Runbook',
    summary: 'Draft for the DR procedure.',
    content_markdown: '## Steps\n\n- Verify backups',
    library_id: 'library-1',
    document_type_id: 'type-1',
    template_document_id: null,
    status: 'draft',
  });
  assert.equal(documentCreates[0][1], 'tenant-1');
  assert.equal(documentCreates[0][2], 'user-1');
  assert.deepEqual(documentCreates[0][3]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
}

async function testExecuteCreateDocumentRoutesTemplateThroughKnowledgeService() {
  const { service, context, documentCreates } = createService({
    previews: [],
    documentSearchRows: [{
      id: 'template-1',
      item_number: 50,
      title: 'Project Brief',
      library_name: 'Templates',
      library_slug: 'templates',
      document_type_name: 'Brief',
      updated_at: '2026-03-28T10:00:00.000Z',
    }],
    documentRows: [{
      id: 'template-1',
      item_ref: 'DOC-50',
      item_number: 50,
      title: 'Project Brief',
      summary: null,
      content_markdown: '# Project Brief\n\n## Context\n\n- Fill me in',
      revision: 8,
      status: 'published',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      library_name: 'Templates',
      library_slug: 'templates',
      folder_name: null,
      document_type_id: 'type-brief',
      document_type_name: 'Brief',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }],
  });

  await service.createPreview(context, 'create_document', {
    title: 'Project 33 Brief',
    template_document: 'Project Brief',
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'executed');
  assert.equal(documentCreates.length, 1);
  assert.deepEqual(documentCreates[0][0], {
    title: 'Project 33 Brief',
    summary: null,
    content_markdown: '# Project Brief\n\n## Context\n\n- Fill me in',
    library_id: 'library-1',
    document_type_id: 'type-brief',
    template_document_id: 'template-1',
    status: 'draft',
  });
}

async function testExecuteCreateDocumentRoutesRelationsThroughKnowledgeService() {
  const { service, context, documentCreates } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM portfolio_projects',
      rows: [{
        id: 'project-1',
        name: 'Website Refresh',
        item_number: 33,
        updated_at: '2026-03-28T10:00:00.000Z',
      }],
    }],
  });

  await service.createPreview(context, 'create_document', {
    title: 'Project 33 Brief',
    projects: 'PRJ-33',
  });

  await service.executePreview(context, 'preview-1');

  assert.deepEqual(documentCreates[0][0], {
    title: 'Project 33 Brief',
    summary: null,
    content_markdown: '',
    library_id: 'library-1',
    document_type_id: 'type-1',
    template_document_id: null,
    relations: {
      projects: ['project-1'],
    },
    status: 'draft',
  });
}

async function testExecuteCreateTaskRoutesThroughTasksService() {
  const { service, context, taskCreates } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM users u',
      rows: (sql: string) => {
        if (sql.includes('AND u.id = $2')) {
          return [{
            id: 'user-1',
            email: 'requestor@example.com',
            label: 'Requestor User',
          }];
        }
        if (sql.includes('LOWER(u.email) = LOWER($2)')) {
          return [];
        }
        return [{
          id: 'user-2',
          email: 'michael@example.com',
          label: 'Michael Dupont',
        }];
      },
    }],
    taskCreateResult: {
      id: 'created-task-1',
      item_number: 77,
      title: 'Install server X',
    },
  });

  await service.createPreview(context, 'create_task', {
    title: 'Install server X',
    description: 'Install following the SQL Server standard.',
    assignee: 'Michael Dupont',
    priority_level: 'high',
    start_date: '2026-04-02',
    due_date: '2026-04-07',
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'executed');
  assert.equal(result.target.entity_id, 'created-task-1');
  assert.equal(result.target.ref, 'T-77');
  assert.equal(result.summary, 'Created T-77.');
  assert.equal(taskCreates.length, 1);
  assert.deepEqual(taskCreates[0][0], {
    type: null,
    id: null,
    payload: {
      title: 'Install server X',
      description: 'Install following the SQL Server standard.',
      status: 'open',
      assignee_user_id: 'user-2',
      priority_level: 'high',
      start_date: '2026-04-02',
      due_date: '2026-04-07',
      task_type_id: null,
      phase_id: null,
      creator_id: 'user-1',
    },
  });
  assert.equal(taskCreates[0][1], 'user-1');
  assert.deepEqual(taskCreates[0][2]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
}

async function testUpdateDocumentMetadataPreviewFailsWhenWorkflowBlocksEditing() {
  const { service, context } = createService({
    previews: [],
    workflowError: new BadRequestException('Document is currently in review. Cancel review to edit it.'),
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_metadata', {
      document_id: 'DOC-14',
      summary: 'Updated summary',
    }),
    (error: any) => error instanceof BadRequestException
      && /currently in review/i.test(error.message),
  );
}

async function testUpdateDocumentMetadataPreviewFailsWhenDocumentLocked() {
  const { service, context } = createService({
    previews: [],
    lockedDocumentError: new BadRequestException('Document is locked by another user'),
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_metadata', {
      document_id: 'DOC-14',
      summary: 'Updated summary',
    }),
    (error: any) => error instanceof BadRequestException
      && /locked by another user/i.test(error.message),
  );
}

async function testUpdateDocumentMetadataPreviewRejectsManagedIntegratedTitleChange() {
  const { service, context } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Managed Runbook',
      summary: 'Current summary',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: true,
    }],
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_metadata', {
      document_id: 'DOC-14',
      title: 'Renamed managed runbook',
    }),
    (error: any) => error instanceof BadRequestException
      && /Managed integrated documents cannot change: title/i.test(error.message),
  );
}

async function testUpdateDocumentMetadataPreviewIncludesRelationAdditions() {
  const { service, context, saved } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
    sqlResponses: [{
      pattern: 'FROM portfolio_projects',
      rows: [{
        id: 'project-1',
        name: 'Website Refresh',
        item_number: 33,
        updated_at: '2026-03-28T10:00:00.000Z',
      }],
    }],
  });

  const result = await service.createPreview(context, 'update_document_metadata', {
    document_id: 'DOC-14',
    summary: 'Updated summary',
    projects: 'PRJ-33',
  });

  assert.equal(result.changes.summary.to, 'Updated summary');
  assert.equal(result.changes.linked_projects.to, '- PRJ-33 - Website Refresh');
  assert.deepEqual(saved[0].mutation_input.relations, {
    projects: ['project-1'],
  });
}

async function testUpdateDocumentContentPreviewRejectsNoOpBody() {
  const { service, context } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      library_name: 'Operations',
      library_slug: 'operations',
      folder_name: null,
      document_type_id: 'type-1',
      document_type_name: 'Document',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }],
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_content', {
      document_id: 'DOC-14',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
    }),
    (error: any) => error instanceof BadRequestException
      && /already matches the requested body/i.test(error.message),
  );
}

async function testUpdateDocumentContentPreviewRequiresConfirmationForAmbiguousDocument() {
  const { service, context } = createService({
    previews: [],
    documentSearchRows: [{
      id: 'doc-1',
      item_number: 14,
      title: 'SOP tc-db-prod',
      library_name: 'Operations',
      library_slug: 'operations',
      document_type_name: 'SOP',
      updated_at: '2026-03-28T10:00:00.000Z',
    }],
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_content', {
      document_id: 'tc-db-prod',
      content_markdown: '# SOP tc-db-prod\n\n## Restart\n\n- Restart the server',
    }),
    (error: any) => error instanceof BadRequestException
      && /Most likely:/i.test(error.message)
      && /confirm which document to use/i.test(error.message),
  );
}

async function testUpdateDocumentContentPreviewFailsWhenWorkflowBlocksEditing() {
  const { service, context } = createService({
    previews: [],
    workflowError: new BadRequestException('Document is currently in review. Cancel review to edit it.'),
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_content', {
      document_id: 'DOC-14',
      content_markdown: '# Disaster Recovery\n\n## Restart\n\n- Restart the cluster',
    }),
    (error: any) => error instanceof BadRequestException
      && /currently in review/i.test(error.message),
  );
}

async function testUpdateDocumentContentPreviewFailsWhenDocumentLocked() {
  const { service, context } = createService({
    previews: [],
    lockedDocumentError: new BadRequestException('Document is locked by another user'),
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_content', {
      document_id: 'DOC-14',
      content_markdown: '# Disaster Recovery\n\n## Restart\n\n- Restart the cluster',
    }),
    (error: any) => error instanceof BadRequestException
      && /locked by another user/i.test(error.message),
  );
}

async function testUpdateDocumentContentPreviewIncludesRelationAdditions() {
  const { service, context, saved } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
    sqlResponses: [{
      pattern: 'FROM applications',
      rows: [{
        id: 'app-1',
        name: 'Billing App',
        updated_at: '2026-03-28T10:00:00.000Z',
      }],
    }],
  });

  const result = await service.createPreview(context, 'update_document_content', {
    document_id: 'DOC-14',
    content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups\n\n## Restart\n\n- Restart the cluster',
    applications: 'Billing App',
  });

  assert.equal(result.changes.linked_applications.to, '- Billing App');
  assert.deepEqual(saved[0].mutation_input.relations, {
    applications: ['app-1'],
  });
}

async function testUpdateDocumentRelationsPreviewAddsMultipleLinks() {
  const { service, context, saved } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Project Brief',
      summary: 'Current summary',
      content_markdown: '# Project Brief',
      revision: 3,
      status: 'draft',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [{ id: 'app-0', name: 'Core ERP' }],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
    sqlResponses: [
      {
        pattern: 'FROM portfolio_projects',
        rows: (_sql: string, params?: any[]) => {
          const itemNumber = params?.[1];
          if (itemNumber === 34) {
            return [{
              id: 'project-2',
              name: 'Data Platform',
              item_number: 34,
              updated_at: '2026-03-27T10:00:00.000Z',
            }];
          }
          return [{
            id: 'project-1',
            name: 'Website Refresh',
            item_number: 33,
            updated_at: '2026-03-28T10:00:00.000Z',
          }];
        },
      },
      {
        pattern: 'FROM applications',
        rows: [{
          id: 'app-1',
          name: 'Billing App',
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
    ],
  });

  const result = await service.createPreview(context, 'update_document_relations', {
    document_id: 'DOC-14',
    projects: ['PRJ-33', 'PRJ-34'],
    applications: 'Billing App',
  });

  assert.equal(result.changes.linked_projects.to, '- PRJ-33 - Website Refresh\n- PRJ-34 - Data Platform');
  assert.equal(result.changes.linked_applications.from, '- Core ERP');
  assert.equal(result.changes.linked_applications.to, '- Core ERP\n- Billing App');
  assert.deepEqual(saved[0].mutation_input.relations, {
    applications: ['app-0', 'app-1'],
    projects: ['project-1', 'project-2'],
  });
}

async function testUpdateDocumentRelationsPreviewAcceptsNestedMutationShape() {
  const { service, context, saved } = createService({
    previews: [],
    sqlResponses: [
      {
        pattern: 'FROM portfolio_projects',
        rows: [{
          id: 'project-1',
          name: 'Website Refresh',
          item_number: 33,
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
      {
        pattern: 'FROM applications',
        rows: [{
          id: 'app-0',
          name: 'Core ERP',
          updated_at: '2026-03-28T10:00:00.000Z',
        }],
      },
    ],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Project Brief',
      summary: 'Current summary',
      content_markdown: '# Project Brief',
      revision: 3,
      status: 'draft',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [{ id: 'app-0', name: 'Core ERP' }],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
  });

  const result = await service.createPreview(context, 'update_document_relations', {
    document_id: 'DOC-14',
    add: {
      projects: 'PRJ-33',
    },
    remove: {
      applications: 'Core ERP',
    },
  });

  assert.equal(result.changes.linked_projects.to, '- PRJ-33 - Website Refresh');
  assert.equal(result.changes.linked_applications.from, '- Core ERP');
  assert.equal(result.changes.linked_applications.to, null);
  assert.deepEqual(saved[0].mutation_input.relations, {
    applications: [],
    projects: ['project-1'],
  });
}

async function testUpdateDocumentRelationsPreviewRemovesLastLinkedApplication() {
  const { service, context, saved } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM applications',
      rows: [{
        id: 'app-0',
        name: 'Core ERP',
        updated_at: '2026-03-28T10:00:00.000Z',
      }],
    }],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Project Brief',
      summary: 'Current summary',
      content_markdown: '# Project Brief',
      revision: 3,
      status: 'draft',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [{ id: 'app-0', name: 'Core ERP' }],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
  });

  const result = await service.createPreview(context, 'update_document_relations', {
    document_id: 'DOC-14',
    remove_application: 'Core ERP',
  });

  assert.equal(result.changes.linked_applications.from, '- Core ERP');
  assert.equal(result.changes.linked_applications.to, null);
  assert.deepEqual(saved[0].mutation_input.relations, {
    applications: [],
  });
  assert.deepEqual(saved[0].mutation_input.relation_labels, {
    applications: [],
  });
  assert.deepEqual(saved[0].current_values.relation_snapshot, {
    applications: [{ id: 'app-0', ref: null, label: 'Core ERP' }],
  });
}

async function testUpdateDocumentRelationsPreviewRequiresConfirmationForAmbiguousProject() {
  const { service, context } = createService({
    previews: [],
    sqlResponses: [{
      pattern: 'FROM portfolio_projects',
      rows: [{
        id: 'project-1',
        name: 'Website Refresh',
        item_number: 33,
        updated_at: '2026-03-28T10:00:00.000Z',
      }, {
        id: 'project-2',
        name: 'Website Refresh',
        item_number: 34,
        updated_at: '2026-03-27T10:00:00.000Z',
      }],
    }],
  });

  await assert.rejects(
    () => service.createPreview(context, 'update_document_relations', {
      document_id: 'DOC-14',
      projects: 'Website Refresh',
    }),
    (error: any) => error instanceof BadRequestException
      && /Most likely:/i.test(error.message)
      && /confirm which project to use/i.test(error.message),
  );
}

async function testExecuteDocumentMetadataPreviewUsesLockAndAudit() {
  const { service, context, documentUpdates, documentLocksAcquired, documentLocksReleased } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
    }, {
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
    }],
  });

  await service.createPreview(context, 'update_document_metadata', {
    document_id: 'DOC-14',
    summary: 'Updated summary',
    review_due_at: '2026-04-30',
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'executed');
  assert.equal(documentLocksAcquired.length, 1);
  assert.equal(documentLocksReleased.length, 1);
  assert.equal(documentUpdates.length, 1);
  assert.deepEqual(documentUpdates[0][1], {
    summary: 'Updated summary',
    review_due_at: '2026-04-30',
    revision: 3,
    save_mode: 'manual',
  });
  assert.equal(documentUpdates[0][2], 'user-1');
  assert.equal(documentUpdates[0][3], 'lock-token-1');
  assert.deepEqual(documentUpdates[0][4]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
}

async function testExecuteDocumentMetadataPreviewRoutesRelationsThroughKnowledgeService() {
  const { service, context, documentUpdates } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }, {
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
    sqlResponses: [{
      pattern: 'FROM portfolio_projects',
      rows: [{
        id: 'project-1',
        name: 'Website Refresh',
        item_number: 33,
        updated_at: '2026-03-28T10:00:00.000Z',
      }],
    }],
  });

  await service.createPreview(context, 'update_document_metadata', {
    document_id: 'DOC-14',
    summary: 'Updated summary',
    projects: 'PRJ-33',
  });

  await service.executePreview(context, 'preview-1');

  assert.deepEqual(documentUpdates[0][1], {
    summary: 'Updated summary',
    relations: {
      projects: ['project-1'],
    },
    revision: 3,
    save_mode: 'manual',
  });
}

async function testExecuteDocumentContentPreviewUsesLockAndAudit() {
  const { service, context, documentUpdates, documentLocksAcquired, documentLocksReleased } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      library_name: 'Operations',
      library_slug: 'operations',
      folder_name: null,
      document_type_id: 'type-1',
      document_type_name: 'Document',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }, {
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      library_name: 'Operations',
      library_slug: 'operations',
      folder_name: null,
      document_type_id: 'type-1',
      document_type_name: 'Document',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }],
  });

  await service.createPreview(context, 'update_document_content', {
    document_id: 'DOC-14',
    content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups\n\n## Restart\n\n- Restart the cluster',
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'executed');
  assert.equal(documentLocksAcquired.length, 1);
  assert.equal(documentLocksReleased.length, 1);
  assert.equal(documentUpdates.length, 1);
  assert.deepEqual(documentUpdates[0][1], {
    content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups\n\n## Restart\n\n- Restart the cluster',
    revision: 3,
    save_mode: 'manual',
  });
  assert.equal(documentUpdates[0][2], 'user-1');
  assert.equal(documentUpdates[0][3], 'lock-token-1');
  assert.deepEqual(documentUpdates[0][4]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
}

async function testExecuteDocumentContentPreviewRoutesRelationsThroughKnowledgeService() {
  const { service, context, documentUpdates } = createService({
    previews: [],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
      library_name: 'Operations',
      library_slug: 'operations',
      folder_name: null,
      document_type_id: 'type-1',
      document_type_name: 'Document',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }, {
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups',
      revision: 3,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
      library_name: 'Operations',
      library_slug: 'operations',
      folder_name: null,
      document_type_id: 'type-1',
      document_type_name: 'Document',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }],
    sqlResponses: [{
      pattern: 'FROM applications',
      rows: [{
        id: 'app-1',
        name: 'Billing App',
        updated_at: '2026-03-28T10:00:00.000Z',
      }],
    }],
  });

  await service.createPreview(context, 'update_document_content', {
    document_id: 'DOC-14',
    content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups\n\n## Restart\n\n- Restart the cluster',
    applications: 'Billing App',
  });

  await service.executePreview(context, 'preview-1');

  assert.deepEqual(documentUpdates[0][1], {
    content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups\n\n## Restart\n\n- Restart the cluster',
    relations: {
      applications: ['app-1'],
    },
    revision: 3,
    save_mode: 'manual',
  });
}

async function testExecuteDocumentRelationsPreviewUsesLockAndAudit() {
  const { service, context, documentUpdates, documentLocksAcquired, documentLocksReleased } = createService({
    previews: [createDocumentRelationsPreview()],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Project Brief',
      summary: 'Current summary',
      content_markdown: '# Project Brief',
      revision: 3,
      status: 'draft',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'executed');
  assert.equal(documentLocksAcquired.length, 1);
  assert.equal(documentLocksReleased.length, 1);
  assert.deepEqual(documentUpdates[0][1], {
    relations: {
      projects: ['project-1'],
    },
    revision: 3,
    save_mode: 'manual',
  });
  assert.deepEqual(documentUpdates[0][4]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
}

async function testExecuteDocumentRelationsPreviewRoutesRemovalThroughKnowledgeService() {
  const { service, context, documentUpdates } = createService({
    previews: [createDocumentRelationsPreview({
      mutation_input: {
        relations: {
          applications: [],
        },
        relation_labels: {
          applications: [],
        },
      },
      current_values: {
        target_ref: 'DOC-14',
        target_title: 'Project Brief',
        revision: 3,
        relation_snapshot: {
          applications: [{ id: 'app-0', ref: null, label: 'Core ERP' }],
        },
      },
    })],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Project Brief',
      summary: 'Current summary',
      content_markdown: '# Project Brief',
      revision: 3,
      status: 'draft',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [{ id: 'app-0', name: 'Core ERP' }],
        assets: [],
        projects: [],
        requests: [],
        tasks: [],
      },
    }],
  });

  await service.executePreview(context, 'preview-1');

  assert.deepEqual(documentUpdates[0][1], {
    relations: {
      applications: [],
    },
    revision: 3,
    save_mode: 'manual',
  });
}

async function testDocumentRevisionDriftFailsExecutionAndReleasesLock() {
  const { service, context, documentUpdates, documentLocksReleased } = createService({
    previews: [createDocumentMetadataPreview()],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      revision: 4,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
    }],
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.error_message, 'Document changed after the preview was created.');
  assert.equal(documentUpdates.length, 0);
  assert.equal(documentLocksReleased.length, 1);
}

async function testFailedExecutionRollsBackDomainWritesBeforeSavingFailedPreview() {
  const queryRunnerQueries: string[] = [];
  const { service, context, saved, documentUpdates } = createService({
    previews: [createDocumentContentPreview()],
    updateError: new BadRequestException('Simulated document update failure.'),
    queryRunner: {
      isTransactionActive: true,
      query: async (sql: string) => {
        queryRunnerQueries.push(sql);
        return [];
      },
    },
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.error_message, 'Simulated document update failure.');
  assert.equal(documentUpdates.length, 1);
  assert.deepEqual(queryRunnerQueries, [
    'SAVEPOINT ai_mutation_preview_execution',
    'ROLLBACK TO SAVEPOINT ai_mutation_preview_execution',
  ]);
  assert.equal(saved[saved.length - 1].status, 'failed');
}

async function testDocumentContentRevisionDriftFailsExecutionAndReleasesLock() {
  const { service, context, documentUpdates, documentLocksReleased } = createService({
    previews: [createDocumentContentPreview()],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Disaster Recovery',
      summary: 'Current summary',
      content_markdown: '# Disaster Recovery\n\n## Restore\n\n- Verify backups\n\n## Restart\n\n- Restart the cluster',
      revision: 4,
      status: 'draft',
      review_due_at: '2026-04-01',
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      library_name: 'Operations',
      library_slug: 'operations',
      folder_name: null,
      document_type_id: 'type-1',
      document_type_name: 'Document',
      template_document_id: null,
      template_document_title: null,
      template_document_item_number: null,
    }],
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.error_message, 'Document changed after the preview was created.');
  assert.equal(documentUpdates.length, 0);
  assert.equal(documentLocksReleased.length, 1);
}

async function testDocumentRelationDriftFailsExecutionAndReleasesLock() {
  const { service, context, documentUpdates, documentLocksReleased } = createService({
    previews: [createDocumentRelationsPreview()],
    documentRows: [{
      id: '22222222-2222-4222-8222-222222222222',
      item_ref: 'DOC-14',
      item_number: 14,
      title: 'Project Brief',
      summary: 'Current summary',
      content_markdown: '# Project Brief',
      revision: 3,
      status: 'draft',
      review_due_at: null,
      last_reviewed_at: null,
      is_managed_integrated_document: false,
      relations: {
        applications: [],
        assets: [],
        projects: [{ id: 'project-9', name: 'PRJ-99 - Competing Change' }],
        requests: [],
        tasks: [],
      },
    }],
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.error_message, 'Document project relations changed after the preview was created.');
  assert.equal(documentUpdates.length, 0);
  assert.equal(documentLocksReleased.length, 1);
}

async function testPreviewActionsStayScopedToConversation() {
  {
    const { service, context } = createService({
      previews: [createStatusPreview({ conversation_id: 'conv-2', status: 'executed' })],
    });
    await assert.rejects(
      () => service.executePreview(context, 'preview-1'),
      (error: any) => error instanceof ForbiddenException,
    );
  }

  {
    const { service, context } = createService({
      previews: [createStatusPreview({ conversation_id: 'conv-2' })],
    });
    await assert.rejects(
      () => service.rejectPreview(context, 'preview-1'),
      (error: any) => error instanceof ForbiddenException,
    );
  }

  {
    const { service, context } = createService({
      previews: [createStatusPreview({ conversation_id: 'conv-2', status: 'executed', executed_at: new Date() })],
    });
    await assert.rejects(
      () => service.createReversePreview(context, 'preview-1'),
      (error: any) => error instanceof ForbiddenException,
    );
  }
}

async function testOnlyCreatingUserCanExecutePreview() {
  const { service, context } = createService({
    contextUserId: 'user-2',
  });

  await assert.rejects(
    () => service.executePreview(context, 'preview-1'),
    (error: any) => error instanceof NotFoundException,
  );
}

async function testExpiredPreviewCannotBeExecuted() {
  const { service, context, saved } = createService({
    previews: [createStatusPreview({ expires_at: new Date('2026-03-24T09:59:00.000Z') })],
  });

  const now = Date.now;
  Date.now = () => new Date('2026-03-24T10:30:00.000Z').getTime();
  try {
    const result = await service.executePreview(context, 'preview-1');
    assert.equal(result.status, 'expired');
    assert.equal(result.error_message, 'Preview expired before approval.');
    assert.equal(saved[0].status, 'expired');
  } finally {
    Date.now = now;
  }
}

async function testDriftDetectionFailsExecutionWhenTaskChanged() {
  const { service, context, taskUpdates } = createService({
    previews: [createStatusPreview()],
    liveTask: {
      id: '11111111-1111-4111-8111-111111111111',
      tenant_id: 'tenant-1',
      status: 'in_progress',
      assignee_user_id: null,
    },
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'failed');
  assert.equal(result.error_message, 'Task status changed after the preview was created.');
  assert.equal(taskUpdates.length, 0);
}

async function testExecuteCommentPreviewRoutesThroughTaskActivities() {
  const { service, context, activityCreates } = createService({
    previews: [createCommentPreview()],
  });

  const result = await service.executePreview(context, 'preview-1');

  assert.equal(result.status, 'executed');
  assert.equal(activityCreates.length, 1);
  assert.equal(activityCreates[0][0], '11111111-1111-4111-8111-111111111111');
  assert.deepEqual(activityCreates[0][1], {
    type: 'comment',
    content: 'Please investigate the rollback path.',
  });
  assert.equal(activityCreates[0][2], 'tenant-1');
  assert.equal(activityCreates[0][3], 'user-1');
  assert.deepEqual(activityCreates[0][4]?.audit, {
    source: 'ai_chat',
    sourceRef: 'preview-1',
  });
}

async function testRejectPreviewMarksRejected() {
  const { service, context, saved } = createService();

  const result = await service.rejectPreview(context, 'preview-1');

  assert.equal(result.status, 'rejected');
  assert.equal(saved[0].status, 'rejected');
  assert.ok(saved[0].rejected_at instanceof Date);
}

async function testRejectingExpiredPreviewKeepsExpiredState() {
  const { service, context, saved } = createService({
    previews: [createStatusPreview({ expires_at: new Date('2026-03-24T09:59:00.000Z') })],
  });

  const now = Date.now;
  Date.now = () => new Date('2026-03-24T10:30:00.000Z').getTime();
  try {
    const result = await service.rejectPreview(context, 'preview-1');
    assert.equal(result.status, 'expired');
    assert.equal(result.error_message, 'Preview expired before approval.');
    assert.equal(saved[0].status, 'expired');
    assert.equal(saved[0].rejected_at, null);
  } finally {
    Date.now = now;
  }
}

async function testCreateReversePreviewBuildsExpectedMutation() {
  const { service, context, saved } = createService({
    previews: [
      createStatusPreview({
        status: 'executed',
        approved_at: new Date('2026-03-24T10:01:00.000Z'),
        executed_at: new Date('2026-03-24T10:01:00.000Z'),
      }),
    ],
    taskRow: {
      id: '11111111-1111-4111-8111-111111111111',
      item_number: 1,
      title: 'Example task',
      status: 'done',
      assignee_user_id: null,
      assignee_label: null,
    },
  });

  const result = await service.createReversePreview(context, 'preview-1');

  assert.equal(result.status, 'pending');
  assert.equal(result.target.ref, 'T-1');
  assert.equal(result.changes.status.from, 'done');
  assert.equal(result.changes.status.to, 'open');
  assert.equal(saved[0].mutation_input.status, 'open');
  assert.equal(saved[0].mutation_input.source_preview_id, 'preview-1');
}

async function testUndoRejectsNonReversibleCommentPreview() {
  const { service, context } = createService({
    previews: [
      createCommentPreview({
        status: 'executed',
        approved_at: new Date('2026-03-24T10:01:00.000Z'),
        executed_at: new Date('2026-03-24T10:01:00.000Z'),
      }),
    ],
  });

  await assert.rejects(
    () => service.createReversePreview(context, 'preview-1'),
    (error: any) => error instanceof BadRequestException
      && /Undo is not supported/i.test(error.message),
  );
}

async function testListConversationPreviewsReturnsLatestWindowInChronologicalOrder() {
  const previews = Array.from({ length: 55 }, (_, index) =>
    createStatusPreview({
      id: `preview-${index + 1}`,
      created_at: new Date(Date.UTC(2026, 2, 24, 10, index, 0)),
    }),
  );
  const { service, context } = createService({ previews });

  const result = await service.listConversationPreviews(context, 'conv-1');

  assert.equal(result.length, 50);
  assert.deepEqual(
    result.map((preview) => preview.preview_id),
    Array.from({ length: 50 }, (_, index) => `preview-${index + 6}`),
  );
}

/**
 * S2: previewing an AI document mutation must refuse exactly what the write
 * would refuse. Without the write gate the preview discloses that a document the
 * caller cannot write exists and is editable — and for an incident review it
 * skips `incidents:contributor` and the closure freeze entirely.
 */
async function testUpdatePreviewRequiresDocumentWriteAccess() {
  const context: any = { manager: {}, userId: 'user-1', tenantId: 'tenant-1' };

  const refusedCalls: string[] = [];
  const refusing: any = {
    assertDocumentWritable: async () => {
      refusedCalls.push('writable');
      throw new ForbiddenException('incidents:contributor permission is required');
    },
    assertWorkflowAllowsEditing: async () => { refusedCalls.push('workflow'); },
    assertDocumentUnlockedForUser: async () => { refusedCalls.push('lock'); },
  };
  await assert.rejects(
    new AiDocumentMutationSupportService(refusing).assertUpdatePreviewAllowed(context, 'doc-1'),
    /incidents:contributor/,
  );
  assert.deepEqual(refusedCalls, ['writable'], 'the write ACL runs first and short-circuits');

  const allowedCalls: string[] = [];
  const permissive: any = {
    assertDocumentWritable: async (documentId: string, manager: unknown, userId: string) => {
      assert.equal(manager, context.manager);
      allowedCalls.push(`writable:${documentId}:${userId}`);
    },
    assertWorkflowAllowsEditing: async () => { allowedCalls.push('workflow'); },
    assertDocumentUnlockedForUser: async () => { allowedCalls.push('lock'); },
  };
  await new AiDocumentMutationSupportService(permissive).assertUpdatePreviewAllowed(context, 'doc-1');
  assert.deepEqual(allowedCalls, ['writable:doc-1:user-1', 'workflow', 'lock']);
}

async function main() {
  await testCreatePreviewPersistsCorrectData();
  await testCreatePreviewAllowsMultiplePendingPreviewsInConversation();
  await testCreatePreviewReusesEquivalentPendingPreviewInConversation();
  await testMutationPlanCreatesDependentPreviewAfterApproval();
  await testMutationPlanNormalizesLegacyGlpiImportStep();
  await testMutationPlanDeduplicatesEquivalentOperationsAndRemapsDependents();
  await testMutationPlanAdvancesDependentsWhenRootPreviewAlreadyExecuted();
  await testMutationPlanBlocksDependentsWhenDependencyPreparationFails();
  await testMutationPlanReportsMissingExpectedTargetRefs();
  await testMutationPlanAcceptsExplicitTargetExclusion();
  await testCreateCommentPreviewPersistsMarkdownPayload();
  await testCreateTaskPreviewPersistsResolvedStandaloneFields();
  await testCreateTaskPreviewPersistsResolvedProjectFields();
  await testCreateTaskPreviewResolvesSpendItemRelation();
  await testCreateTaskPreviewResolvesCapexRelation();
  await testCreateTaskPreviewRequiresConfirmationForAmbiguousAssignee();
  await testCreateDocumentPreviewPersistsResolvedDefaults();
  await testCreateDocumentPreviewUsesTemplateContentAndType();
  await testCreateDocumentPreviewIncludesResolvedRelations();
  await testCreateDocumentTemplateAmbiguityFailsWithConfirmationMessage();
  await testCreateDocumentTemplateReferenceMustPointToTemplatesLibrary();
  await testCreateDocumentInputSchemaAcceptsContentAlias();
  await testCreateDocumentInputSchemaAcceptsTemplateAlias();
  await testExecuteCreateDocumentRoutesThroughKnowledgeService();
  await testExecuteCreateDocumentRoutesTemplateThroughKnowledgeService();
  await testExecuteCreateDocumentRoutesRelationsThroughKnowledgeService();
  await testExecuteCreateTaskRoutesThroughTasksService();
  await testUpdateDocumentMetadataPreviewFailsWhenWorkflowBlocksEditing();
  await testUpdateDocumentMetadataPreviewFailsWhenDocumentLocked();
  await testUpdateDocumentMetadataPreviewRejectsManagedIntegratedTitleChange();
  await testUpdateDocumentMetadataPreviewIncludesRelationAdditions();
  await testUpdateDocumentContentPreviewRejectsNoOpBody();
  await testUpdateDocumentContentPreviewRequiresConfirmationForAmbiguousDocument();
  await testUpdateDocumentContentPreviewFailsWhenWorkflowBlocksEditing();
  await testUpdateDocumentContentPreviewFailsWhenDocumentLocked();
  await testUpdateDocumentContentPreviewIncludesRelationAdditions();
  await testUpdateDocumentRelationsPreviewAddsMultipleLinks();
  await testUpdateDocumentRelationsPreviewAcceptsNestedMutationShape();
  await testUpdateDocumentRelationsPreviewRemovesLastLinkedApplication();
  await testUpdateDocumentRelationsPreviewRequiresConfirmationForAmbiguousProject();
  await testExecuteDocumentMetadataPreviewUsesLockAndAudit();
  await testExecuteDocumentMetadataPreviewRoutesRelationsThroughKnowledgeService();
  await testExecuteDocumentContentPreviewUsesLockAndAudit();
  await testExecuteDocumentContentPreviewRoutesRelationsThroughKnowledgeService();
  await testExecuteDocumentRelationsPreviewUsesLockAndAudit();
  await testExecuteDocumentRelationsPreviewRoutesRemovalThroughKnowledgeService();
  await testDocumentRevisionDriftFailsExecutionAndReleasesLock();
  await testFailedExecutionRollsBackDomainWritesBeforeSavingFailedPreview();
  await testDocumentContentRevisionDriftFailsExecutionAndReleasesLock();
  await testDocumentRelationDriftFailsExecutionAndReleasesLock();
  await testPreviewActionsStayScopedToConversation();
  await testOnlyCreatingUserCanExecutePreview();
  await testExpiredPreviewCannotBeExecuted();
  await testDriftDetectionFailsExecutionWhenTaskChanged();
  await testExecuteCommentPreviewRoutesThroughTaskActivities();
  await testRejectPreviewMarksRejected();
  await testRejectingExpiredPreviewKeepsExpiredState();
  await testCreateReversePreviewBuildsExpectedMutation();
  await testUndoRejectsNonReversibleCommentPreview();
  await testListConversationPreviewsReturnsLatestWindowInChronologicalOrder();
  await testUpdatePreviewRequiresDocumentWriteAccess();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
