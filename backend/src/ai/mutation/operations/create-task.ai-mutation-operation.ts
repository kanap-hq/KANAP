import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { validate as isUuid } from 'uuid';
import { normalizeMarkdownRichText } from '../../../common/markdown-worker';
import { AiPolicyService } from '../../ai-policy.service';
import { assertRecordInWriteScope } from '../ai-write-levels';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import {
  AiTaskCreateTarget,
  AiTaskMutationSupportService,
} from '../ai-task-mutation-support.service';
import { TasksUnifiedService } from '../../../tasks/tasks-unified.service';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiWriteLanguage, previewSummaryText, quoted, taskDetailText, taskPriorityText, writeActionText } from '../../ai-write-texts';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const RELATION_TYPE_VALUES = ['standalone', 'project', 'budget_line', 'incident'] as const;
const PRIORITY_LEVEL_VALUES = ['blocker', 'high', 'normal', 'low', 'optional'] as const;

type CreateTaskRelationType = typeof RELATION_TYPE_VALUES[number];
type CreateTaskPriorityLevel = typeof PRIORITY_LEVEL_VALUES[number];

type CreateTaskInput = {
  title: string;
  description?: string | null;
  relation_type: CreateTaskRelationType;
  relation_ref?: string | null;
  assignee?: string | null;
  priority_level?: CreateTaskPriorityLevel | null;
  start_date?: string | null;
  due_date?: string | null;
  task_type?: string | null;
  phase?: string | null;
  applications?: string[];
  assets?: string[];
};

function normalizeRelationType(value: unknown): unknown {
  if (value == null) {
    return undefined;
  }
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return normalized;
}

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function parseEntityList(value: unknown): string[] {
  if (value == null) return [];
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter(Boolean)));
}

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'tasks',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

function toDisplayPriority(value: unknown): string | null {
  switch (String(value || '')) {
    case 'blocker':
      return 'Blocker';
    case 'high':
      return 'High';
    case 'normal':
      return 'Normal';
    case 'low':
      return 'Low';
    case 'optional':
      return 'Optional';
    default:
      return null;
  }
}

function toDisplayRelation(mutation: Record<string, unknown>): string {
  const relationType = textOrNull(mutation.relation_type) ?? 'standalone';
  const relationLabel = textOrNull(mutation.relation_label);
  if (relationType === 'standalone') {
    return 'Standalone';
  }
  return relationLabel ?? relationType;
}

const CreateTaskInputSchema = z.object({
  title: z.string().trim().min(1)
    .describe('Task title.'),
  description: z.union([z.string(), z.null()]).optional()
    .describe('Optional task description with the full instructions, specifications, and implementation notes.'),
  relation_type: z.preprocess(
    normalizeRelationType,
    z.enum(RELATION_TYPE_VALUES).optional(),
  ).describe('Optional relation type. Use `project`, `budget_line`, `incident`, or `standalone`. Omit this to create a standalone task.'),
  relation_ref: z.union([z.string(), z.null()]).optional()
    .describe('Optional relation target reference. For project tasks, prefer a PRJ reference such as `PRJ-33`. For budget line tasks, use a BL-n reference, an exact title or a UUID. For incident tasks, use an INC-n reference, the incident UUID or its exact title. Required when relation_type is not standalone.'),
  assignee: z.union([z.string(), z.null()]).optional()
    .describe('Optional assignee email, full name, or unique user label in the current tenant.'),
  priority_level: z.union([z.enum(PRIORITY_LEVEL_VALUES), z.null()]).optional()
    .describe('Optional task priority. Defaults to `normal`.'),
  priority: z.union([z.enum(PRIORITY_LEVEL_VALUES), z.null()]).optional()
    .describe('Alias for priority_level. Optional task priority.'),
  start_date: z.union([z.string().trim().regex(DATE_ONLY_RE, 'start_date must be in YYYY-MM-DD format.'), z.null()]).optional()
    .describe('Optional task start date in YYYY-MM-DD format.'),
  due_date: z.union([z.string().trim().regex(DATE_ONLY_RE, 'due_date must be in YYYY-MM-DD format.'), z.null()]).optional()
    .describe('Optional task due date in YYYY-MM-DD format.'),
  task_type: z.union([z.string(), z.null()]).optional()
    .describe('Optional task type name or UUID in the current tenant.'),
  type: z.union([z.string(), z.null()]).optional()
    .describe('Alias for task_type. Optional task type name or UUID in the current tenant.'),
  phase: z.union([z.string(), z.null()]).optional()
    .describe('Optional project phase name or UUID. Only valid when relation_type is `project`.'),
  applications: z.union([z.array(z.string()), z.string(), z.null()]).optional()
    .describe('Optional linked applications as exact names, APP references, UUIDs, or a comma-separated list.'),
  assets: z.union([z.array(z.string()), z.string(), z.null()]).optional()
    .describe('Optional linked assets as exact names, AST references, hostnames, UUIDs, or a comma-separated list.'),
}).superRefine((value, ctx) => {
  const relationType = value.relation_type ?? 'standalone';
  const relationRef = textOrNull(value.relation_ref);
  if (relationType !== 'standalone' && !relationRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'relation_ref is required when relation_type is not standalone.',
      path: ['relation_ref'],
    });
  }
  if (relationType === 'standalone' && relationRef) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'relation_ref must be omitted when relation_type is standalone.',
      path: ['relation_ref'],
    });
  }
  if (value.phase != null && relationType !== 'project') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'phase can only be provided for project-linked tasks.',
      path: ['phase'],
    });
  }
  if (
    value.priority_level != null
    && value.priority != null
    && value.priority_level !== value.priority
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`priority_level` and `priority` must match when both are provided.',
      path: ['priority'],
    });
  }
  if (
    value.task_type != null
    && value.type != null
    && String(value.task_type).trim() !== String(value.type).trim()
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`task_type` and `type` must match when both are provided.',
      path: ['type'],
    });
  }
}).transform((value): CreateTaskInput => ({
  title: value.title,
  description: textOrNull(value.description),
  relation_type: value.relation_type ?? 'standalone',
  relation_ref: textOrNull(value.relation_ref),
  assignee: textOrNull(value.assignee),
  priority_level: value.priority_level ?? value.priority ?? null,
  start_date: value.start_date ?? null,
  due_date: value.due_date ?? null,
  task_type: textOrNull(value.task_type ?? value.type),
  phase: textOrNull(value.phase),
  applications: parseEntityList(value.applications),
  assets: parseEntityList(value.assets),
}));

@Injectable()
export class CreateTaskAiMutationOperation implements AiMutationOperation<CreateTaskInput> {
  readonly toolName = 'create_task' as const;
  readonly description = 'Create a preview to create one task. Tasks can be standalone or linked to one project, budget line or incident. The requestor is always the current Plaid user. Requires explicit user approval before execution.';
  readonly inputSchema = CreateTaskInputSchema;
  readonly inputSummary = {
    title: 'Task title.',
    description: 'Optional task description with the full instructions, specifications, and implementation notes.',
    relation_type: 'Optional relation type: project, budget_line, incident, or standalone. Omit this to create a standalone task.',
    relation_ref: 'Optional relation target reference. Required when relation_type is project, budget_line or incident. Use a PRJ reference for projects, a BL-n reference or exact title for budget lines, and an INC-n reference or exact title for incidents.',
    assignee: 'Optional assignee email, full name, or unique user label in the current tenant.',
    priority_level: 'Optional task priority. Defaults to normal.',
    priority: 'Alias for priority_level.',
    start_date: 'Optional start date in YYYY-MM-DD format.',
    due_date: 'Optional due date in YYYY-MM-DD format.',
    task_type: 'Optional task type name or UUID in the current tenant.',
    type: 'Alias for task_type.',
    phase: 'Optional project phase name or UUID. Only valid for project-linked tasks.',
    applications: 'Optional linked application names, APP references, UUIDs, or comma-separated list.',
    assets: 'Optional linked asset names, AST references, hostnames, UUIDs, or comma-separated list.',
  };
  readonly businessResource = 'tasks';
  readonly writePreview = {
    entity_type: 'tasks',
    fields: ['relation', 'title', 'description', 'assignee', 'priority_level', 'start_date', 'due_date', 'task_type', 'phase', 'applications', 'assets'],
    reversible: false,
    prompt_hint: 'For task creation, use `create_task` with a title. Use `relation_type` plus `relation_ref` for project, budget line or incident tasks. Omit the relation fields to create a standalone task. The requestor is always the current user. On an incident, the task follows the incident visibility and is refused on a closed or cancelled incident. If the assignee, relation target, task type, or phase is ambiguous, ask the user to confirm before retrying.',
  };

  constructor(
    private readonly support: AiTaskMutationSupportService,
    private readonly tasks: TasksUnifiedService,
    private readonly policy: AiPolicyService,
  ) {}

  private async assertRelationAccess(
    context: AiExecutionContextWithManager,
    relation: AiTaskCreateTarget,
  ): Promise<void> {
    if (relation.mode === 'project') {
      await this.policy.assertBusinessPermission(context, 'portfolio_projects', 'contributor', context.manager);
      // The project in the scope of the screen route that adds a task to it (contributor, lot D11).
      await assertRecordInWriteScope(context, 'projects', relation.id, 'contributor');
    }
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: CreateTaskInput,
  ): Promise<AiPreparedMutationPreview> {
    const title = textOrNull(input.title);
    if (!title) {
      throw new BadRequestException('Task title is required.');
    }

    const requestor = await this.support.resolveCurrentUser(context);
    const relation = await this.support.resolveCreateTarget(context, input.relation_type, input.relation_ref);
    await this.assertRelationAccess(context, relation);

    const assignee = input.assignee
      ? await this.support.resolveUserReference(context, input.assignee)
      : null;
    const taskType = input.task_type
      ? await this.support.resolveTaskType(context, input.task_type)
      : await this.support.resolveDefaultTaskType(context);
    const phase = input.phase && relation.mode === 'project'
      ? await this.support.resolveProjectPhase(context, relation.id ?? '', relation.label, input.phase)
      : null;
    const applications = await this.resolveEntityArray(context, 'applications', input.applications || []);
    const assets = await this.resolveEntityArray(context, 'assets', input.assets || []);

    return {
      targetEntityType: 'tasks',
      targetEntityId: null,
      mutationInput: {
        relation_type: relation.mode,
        relation_id: relation.id,
        relation_ref: relation.ref,
        relation_label: relation.label,
        title,
        description: await normalizeMarkdownRichText(input.description, { fieldName: 'description' }),
        requestor_user_id: requestor.id,
        requestor_label: requestor.label,
        assignee_user_id: assignee?.id ?? null,
        assignee_label: assignee?.label ?? null,
        assignee_email: assignee?.email ?? null,
        priority_level: input.priority_level ?? 'normal',
        start_date: input.start_date ?? null,
        due_date: input.due_date ?? null,
        task_type_id: taskType?.id ?? null,
        task_type_label: taskType?.label ?? null,
        phase_id: phase?.id ?? null,
        phase_label: phase?.label ?? null,
        application_ids: applications.ids,
        application_labels: applications.labels,
        asset_ids: assets.ids,
        asset_labels: assets.labels,
        status: 'open',
      },
      currentValues: {
        target_ref: null,
        target_title: title,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = textOrNull(current.target_ref);
    const title = textOrNull(current.target_title) ?? textOrNull(mutation.title) ?? 'Untitled task';
    const assigneeLabel = textOrNull(mutation.assignee_label);
    const priorityLabel = toDisplayPriority(mutation.priority_level) ?? 'Normal';
    const applicationLabels = Array.isArray(mutation.application_labels) ? mutation.application_labels.join(', ') : null;
    const assetLabels = Array.isArray(mutation.asset_labels) ? mutation.asset_labels.join(', ') : null;

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = mutation.relation_type === 'standalone'
          ? `Create standalone task "${title}".`
          : `Create task "${title}" on ${toDisplayRelation(mutation)}.`;
        if (assigneeLabel) {
          summary += ` Assignee: ${assigneeLabel}.`;
        }
        summary += ` Priority: ${priorityLabel}.`;
        break;
      case 'executed':
        summary = ref
          ? `Created ${ref}.`
          : `Created task "${title}".`;
        break;
      case 'rejected':
        summary = `Task creation preview for "${title}" was rejected.`;
        break;
      case 'expired':
        summary = `Task creation preview for "${title}" expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Task creation preview for "${title}" failed.`;
        break;
    }

    if (language !== 'en') {
      const pending = preview.status === 'pending';
      const standalone = mutation.relation_type === 'standalone';
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.createTask(language, {
          subject: !pending && ref ? ref : quoted(language, title),
          on: pending && !standalone ? toDisplayRelation(mutation) : null,
          standalone: pending && standalone,
        }),
        {
          pending: [
            ...(assigneeLabel ? [taskDetailText.assignee(language, assigneeLabel)] : []),
            taskDetailText.priority(language, taskPriorityText(language, textOrNull(mutation.priority_level) ?? 'normal')!),
          ],
          errorMessage: preview.error_message,
        },
      );
    }

    return {
      target: buildTarget(preview),
      changes: {
        relation: {
          label: 'Relation',
          from: null,
          to: toDisplayRelation(mutation),
          format: 'text',
        },
        title: {
          label: 'Title',
          from: null,
          to: textOrNull(mutation.title),
          format: 'text',
        },
        requestor: {
          label: 'Requestor',
          from: null,
          to: textOrNull(mutation.requestor_label),
          format: 'text',
        },
        assignee: {
          label: 'Assignee',
          from: null,
          to: assigneeLabel,
          format: 'text',
        },
        priority: {
          label: 'Priority',
          from: null,
          to: priorityLabel,
          format: 'text',
        },
        status: {
          label: 'Status',
          from: null,
          to: 'Open',
          format: 'text',
        },
        start_date: {
          label: 'Start Date',
          from: null,
          to: textOrNull(mutation.start_date),
          format: 'text',
        },
        due_date: {
          label: 'Due Date',
          from: null,
          to: textOrNull(mutation.due_date),
          format: 'text',
        },
        task_type: {
          label: 'Task Type',
          from: null,
          to: textOrNull(mutation.task_type_label),
          format: 'text',
        },
        phase: {
          label: 'Phase',
          from: null,
          to: textOrNull(mutation.phase_label),
          format: 'text',
        },
        applications: {
          label: 'Linked Applications',
          from: null,
          to: applicationLabels,
          format: 'text',
        },
        assets: {
          label: 'Linked Assets',
          from: null,
          to: assetLabels,
          format: 'text',
        },
        description: {
          label: 'Description',
          from: null,
          to: textOrNull(mutation.description),
          format: 'markdown',
        },
      },
      summary,
    };
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    const mutation = preview.mutation_input ?? {};
    const relation = await this.support.resolveStoredCreateTarget(
      context,
      (mutation.relation_type as CreateTaskRelationType | undefined) ?? 'standalone',
      (mutation.relation_id as string | null | undefined) ?? null,
    );
    await this.assertRelationAccess(context, relation);

    const created = await this.tasks.createForTarget(
      {
        type: relation.type,
        id: relation.id,
        payload: {
          title: textOrNull(mutation.title) ?? undefined,
          description: textOrNull(mutation.description),
          status: 'open',
          assignee_user_id: (mutation.assignee_user_id as string | null | undefined) ?? null,
          priority_level: (mutation.priority_level as CreateTaskPriorityLevel | undefined) ?? 'normal',
          start_date: (mutation.start_date as string | null | undefined) ?? null,
          due_date: (mutation.due_date as string | null | undefined) ?? null,
          task_type_id: (mutation.task_type_id as string | null | undefined) ?? null,
          phase_id: (mutation.phase_id as string | null | undefined) ?? null,
          ...(Array.isArray(mutation.application_ids) && mutation.application_ids.length > 0 ? { application_ids: mutation.application_ids as string[] } : {}),
          ...(Array.isArray(mutation.asset_ids) && mutation.asset_ids.length > 0 ? { asset_ids: mutation.asset_ids as string[] } : {}),
          creator_id: context.userId,
        },
      },
      context.userId,
      {
        manager: context.manager,
        tenantId: context.tenantId,
        audit: buildAiMutationAudit(preview),
      },
    );

    preview.target_entity_id = created.id;
    preview.current_values = {
      ...(preview.current_values ?? {}),
      target_ref: created.item_number ? `T-${created.item_number}` : null,
      target_title: created.title ?? textOrNull(mutation.title),
    };
  }

  private async resolveEntityArray(
    context: AiExecutionContextWithManager,
    target: 'applications' | 'assets',
    refs: string[],
  ): Promise<{ ids: string[]; labels: string[] }> {
    if (refs.length === 0) return { ids: [], labels: [] };
    const ids: string[] = [];
    const labels: string[] = [];
    for (const ref of refs) {
      const uuid = isUuid(ref);
      const rows = target === 'applications'
        ? await context.manager.query(
          `SELECT id, name AS label
           FROM applications
           WHERE tenant_id = $1
             AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR LOWER(sequential_id) = LOWER($2::text))
           ORDER BY name
           LIMIT 6`,
          [context.tenantId, ref],
        )
        : await context.manager.query(
          `SELECT id, COALESCE(name, hostname, asset_reference) AS label
           FROM assets
           WHERE tenant_id = $1
             AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR LOWER(asset_reference) = LOWER($2::text) OR LOWER(hostname) = LOWER($2::text))
           ORDER BY name
           LIMIT 6`,
          [context.tenantId, ref],
        );
      if (rows.length === 0) throw new BadRequestException(`${target.slice(0, -1)} "${ref}" not found.`);
      if (rows.length > 1) throw new BadRequestException(`Multiple ${target} matched "${ref}". Use a UUID or exact reference.`);
      ids.push(String(rows[0].id));
      labels.push(String(rows[0].label || rows[0].id));
    }
    return { ids, labels };
  }
}
