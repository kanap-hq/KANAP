import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import { validate as isUuid } from 'uuid';
import { incidentVisibilitySql, resolveIncidentViewer } from '../../../incidents/incident-visibility';
import { Task, TASK_STATUSES, TaskStatus } from '../../../tasks/task.entity';
import { RelatedType, TasksUnifiedService } from '../../../tasks/tasks-unified.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiPolicyService } from '../../ai-policy.service';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiTaskMutationSupportService, toDisplayStatus } from '../ai-task-mutation-support.service';

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const PRIORITIES = ['blocker', 'high', 'normal', 'low', 'optional'] as const;
const RELATION_TYPES = ['standalone', 'project', 'spend_item', 'capex_item', 'contract', 'incident'] as const;

type UpdateTaskFieldsInput = {
  ref: string;
  fields: Record<string, unknown>;
};

type FieldConfig = {
  label: string;
  kind:
    | 'assignee'
    | 'date'
    | 'json_text_array'
    | 'priority'
    | 'relation'
    | 'status'
    | 'task_type'
    | 'phase'
    | 'entity_array'
    | 'portfolio_ref'
    | 'text';
  nullable?: boolean;
  targetField?: string;
  relationTarget?: 'companies' | 'portfolio_categories' | 'portfolio_sources' | 'portfolio_streams';
  entityTarget?: 'applications' | 'assets';
};

type TaskSnapshot = Record<string, unknown> & {
  id: string;
  item_number: number;
  title: string;
  related_object_type: RelatedType;
  related_object_id: string | null;
};

const FIELD_CONFIG: Record<string, FieldConfig> = {
  title: { label: 'Title', kind: 'text' },
  description: { label: 'Description', kind: 'text', nullable: true },
  status: { label: 'Status', kind: 'status' },
  assignee: { label: 'Assignee', kind: 'assignee', nullable: true, targetField: 'assignee_user_id' },
  assignee_email: { label: 'Assignee', kind: 'assignee', nullable: true, targetField: 'assignee_user_id' },
  priority: { label: 'Priority', kind: 'priority', targetField: 'priority_level' },
  priority_level: { label: 'Priority', kind: 'priority' },
  start_date: { label: 'Start Date', kind: 'date', nullable: true },
  due_date: { label: 'Due Date', kind: 'date', nullable: true },
  task_type: { label: 'Task Type', kind: 'task_type', nullable: true, targetField: 'task_type_id' },
  type: { label: 'Task Type', kind: 'task_type', nullable: true, targetField: 'task_type_id' },
  phase: { label: 'Phase', kind: 'phase', nullable: true, targetField: 'phase_id' },
  labels: { label: 'Labels', kind: 'json_text_array' },
  applications: { label: 'Linked Applications', kind: 'entity_array', targetField: 'application_ids', entityTarget: 'applications' },
  application_ids: { label: 'Linked Applications', kind: 'entity_array', entityTarget: 'applications' },
  assets: { label: 'Linked Assets', kind: 'entity_array', targetField: 'asset_ids', entityTarget: 'assets' },
  asset_ids: { label: 'Linked Assets', kind: 'entity_array', entityTarget: 'assets' },
  relation_type: { label: 'Relation', kind: 'relation' },
  relation_ref: { label: 'Relation', kind: 'relation' },
  company: { label: 'Company', kind: 'portfolio_ref', nullable: true, targetField: 'company_id', relationTarget: 'companies' },
  company_id: { label: 'Company', kind: 'portfolio_ref', nullable: true, relationTarget: 'companies' },
  source: { label: 'Source', kind: 'portfolio_ref', nullable: true, targetField: 'source_id', relationTarget: 'portfolio_sources' },
  source_id: { label: 'Source', kind: 'portfolio_ref', nullable: true, relationTarget: 'portfolio_sources' },
  category: { label: 'Category', kind: 'portfolio_ref', nullable: true, targetField: 'category_id', relationTarget: 'portfolio_categories' },
  category_id: { label: 'Category', kind: 'portfolio_ref', nullable: true, relationTarget: 'portfolio_categories' },
  stream: { label: 'Stream', kind: 'portfolio_ref', nullable: true, targetField: 'stream_id', relationTarget: 'portfolio_streams' },
  stream_id: { label: 'Stream', kind: 'portfolio_ref', nullable: true, relationTarget: 'portfolio_streams' },
};

const UpdateTaskFieldsInputSchema = z.object({
  ref: z.string().trim().min(1)
    .describe('Task UUID or canonical task reference such as T-42.'),
  fields: z.record(z.string(), z.unknown())
    .describe('Task fields to change. Supported: title, description, status, assignee, priority_level, start_date, due_date, task_type, phase, labels, applications, assets, relation_type/relation_ref, source, category, stream, company.'),
});

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function normalizeKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeRelationType(value: unknown): typeof RELATION_TYPES[number] {
  const normalized = normalizeKey(String(value || 'standalone'));
  if (normalized === 'opex' || normalized === 'budget' || normalized === 'budget_entry') return 'spend_item';
  if (normalized === 'capex') return 'capex_item';
  if (!RELATION_TYPES.includes(normalized as any)) {
    throw new BadRequestException(`relation_type must be one of ${RELATION_TYPES.join(', ')}.`);
  }
  return normalized as typeof RELATION_TYPES[number];
}

function normalizeDate(value: unknown, label: string, nullable: boolean | undefined): string | null {
  const text = textOrNull(value);
  if (!text) {
    if (nullable) return null;
    throw new BadRequestException(`${label} cannot be empty.`);
  }
  if (DATE_ONLY_RE.test(text)) return text;
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})T/);
  if (dateOnly) return dateOnly[1];
  throw new BadRequestException(`${label} must be in YYYY-MM-DD format.`);
}

function normalizeComparable(value: unknown): unknown {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value) || typeof value === 'object') return JSON.stringify(value ?? null);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (DATE_ONLY_RE.test(trimmed)) return trimmed;
    const dateOnly = trimmed.match(/^(\d{4}-\d{2}-\d{2})T/);
    if (dateOnly) return dateOnly[1];
    return trimmed;
  }
  return value;
}

function sameValue(left: unknown, right: unknown): boolean {
  return normalizeComparable(left) === normalizeComparable(right);
}

function formatValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function taskRef(row: TaskSnapshot): string | null {
  return row.item_number ? `T-${row.item_number}` : null;
}

function relationMode(type: RelatedType): typeof RELATION_TYPES[number] {
  return type ?? 'standalone';
}

@Injectable()
export class UpdateTaskFieldsAiMutationOperation implements AiMutationOperation<UpdateTaskFieldsInput> {
  readonly toolName = 'update_task_fields' as const;
  readonly description = 'Create a preview to update general task fields beyond the specialized status, assignee, and comment tools. Requires explicit user approval before execution.';
  readonly inputSchema = UpdateTaskFieldsInputSchema;
  readonly inputSummary = {
    ref: 'Task UUID or canonical reference such as T-42.',
    fields: 'Fields to change: title, description, status, assignee, priority_level, start_date, due_date, task_type, phase, labels, applications, assets, relation_type/relation_ref, source, category, stream, company.',
  };
  readonly businessResource = 'tasks';
  readonly writePreview = {
    entity_type: 'tasks',
    fields: ['title', 'description', 'status', 'assignee', 'priority_level', 'start_date', 'due_date', 'task_type', 'phase', 'labels', 'relation', 'source', 'category', 'stream', 'company'],
    reversible: true,
    prompt_hint: 'Use `update_task_fields` for richer task edits. Use the narrower task tools for simple status, assignee, or comment-only changes. Query the task first when relation, task type, phase, or assignee references are ambiguous. This only creates a preview and still requires explicit approval.',
  };

  constructor(
    private readonly support: AiTaskMutationSupportService,
    private readonly tasks: TasksUnifiedService,
    private readonly policy: AiPolicyService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateTaskFieldsInput,
  ): Promise<AiPreparedMutationPreview> {
    const task = await this.resolveTask(context, input.ref);
    return this.preparePreviewForTask(context, task, input.fields, null);
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    const mutation = preview.mutation_input ?? {};
    const current = preview.current_values ?? {};
    const fields = (mutation.fields && typeof mutation.fields === 'object' ? mutation.fields : {}) as Record<string, unknown>;
    const displayValues = (mutation.display_values && typeof mutation.display_values === 'object' ? mutation.display_values : {}) as Record<string, unknown>;
    const fieldLabels = (mutation.field_labels && typeof mutation.field_labels === 'object' ? mutation.field_labels : {}) as Record<string, unknown>;
    const previousDisplay = (current.display_values && typeof current.display_values === 'object' ? current.display_values : {}) as Record<string, unknown>;
    const ref = textOrNull(current.target_ref) || 'task';
    const title = textOrNull(current.target_title) || ref;

    const changes: Record<string, any> = {};
    for (const fieldName of Object.keys(fields)) {
      if (fieldName === 'related_object_type' || fieldName === 'related_object_id') continue;
      changes[fieldName] = {
        label: String(fieldLabels[fieldName] || fieldName),
        from: formatValue(previousDisplay[fieldName]),
        to: formatValue(displayValues[fieldName] ?? fields[fieldName]),
        format: fieldName === 'description' ? 'markdown' : 'text',
      };
    }
    if (Object.prototype.hasOwnProperty.call(fields, 'related_object_type') || Object.prototype.hasOwnProperty.call(fields, 'related_object_id')) {
      changes.relation = {
        label: 'Relation',
        from: formatValue(previousDisplay.relation),
        to: formatValue(displayValues.relation),
        format: 'text',
      };
    }

    let summary = `Preview ${preview.id} ${preview.status}.`;
    if (preview.status === 'pending') {
      summary = `Update ${ref}: ${Object.values(changes).map((change: any) => change.label).join(', ')}.`;
    } else if (preview.status === 'executed') {
      summary = `Updated ${ref}.`;
    } else if (preview.status === 'rejected') {
      summary = `Task update preview for ${ref} was rejected.`;
    } else if (preview.status === 'expired') {
      summary = `Task update preview for ${ref} expired before approval.`;
    } else if (preview.status === 'failed') {
      summary = preview.error_message || `Task update preview for ${ref} failed.`;
    }

    return {
      target: {
        entity_type: 'tasks',
        entity_id: preview.target_entity_id ?? null,
        ref,
        title,
      },
      changes,
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the task.');
    const mutation = preview.mutation_input ?? {};
    const fields = (mutation.fields && typeof mutation.fields === 'object' ? mutation.fields : {}) as Record<string, unknown>;
    const expected = (preview.current_values?.values && typeof preview.current_values.values === 'object' ? preview.current_values.values : {}) as Record<string, unknown>;
    const live = await this.resolveTask(context, preview.target_entity_id);
    for (const [fieldName, expectedValue] of Object.entries(expected)) {
      if (!sameValue(live[fieldName], expectedValue)) {
        const label = String(((mutation.field_labels as any) || {})[fieldName] || fieldName);
        throw new ConflictException(`${label} changed after the preview was created.`);
      }
    }

    await this.tasks.updateById(
      preview.target_entity_id,
      fields as Partial<Task>,
      context.userId,
      {
        manager: context.manager,
        tenantId: context.tenantId,
        audit: buildAiMutationAudit(preview),
      },
    );
  }

  async prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the task.');
    const live = await this.resolveTask(context, preview.target_entity_id);
    const reverseFields = preview.current_values?.reverse_fields && typeof preview.current_values.reverse_fields === 'object'
      ? preview.current_values.reverse_fields as Record<string, unknown>
      : preview.current_values?.values as Record<string, unknown>;
    return this.preparePreviewForTask(context, live, reverseFields, preview.id);
  }

  private async preparePreviewForTask(
    context: AiExecutionContextWithManager,
    task: TaskSnapshot,
    rawFields: Record<string, unknown>,
    sourcePreviewId: string | null,
  ): Promise<AiPreparedMutationPreview> {
    const normalized = await this.normalizeFields(context, task, rawFields);
    const changedFields = Object.keys(normalized.fields).filter((fieldName) => !sameValue(task[fieldName], normalized.fields[fieldName]));
    if (changedFields.length === 0) throw new BadRequestException('Task already has the requested values.');

    const fields: Record<string, unknown> = {};
    const previousValues: Record<string, unknown> = {};
    const reverseFields: Record<string, unknown> = {};
    const displayValues: Record<string, string | null> = {};
    const previousDisplay: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};
    for (const fieldName of changedFields) {
      fields[fieldName] = normalized.fields[fieldName];
      previousValues[fieldName] = task[fieldName] ?? null;
      if (fieldName !== 'related_object_type' && fieldName !== 'related_object_id') {
        reverseFields[fieldName] = this.reverseFieldValue(fieldName, task);
      }
      displayValues[fieldName] = normalized.displayValues[fieldName];
      previousDisplay[fieldName] = this.displayForField(fieldName, task);
      fieldLabels[fieldName] = normalized.fieldLabels[fieldName];
    }
    if (fields.related_object_type !== undefined || fields.related_object_id !== undefined) {
      previousDisplay.relation = await this.describeRelation(context, task.related_object_type, task.related_object_id);
      displayValues.relation = await this.describeRelation(context, fields.related_object_type as RelatedType, fields.related_object_id as string | null);
      reverseFields.relation_type = relationMode(task.related_object_type);
      reverseFields.relation_ref = task.related_object_id;
      fieldLabels.related_object_type = 'Relation';
      fieldLabels.related_object_id = 'Relation';
    }

    return {
      targetEntityType: 'tasks',
      targetEntityId: task.id,
      mutationInput: {
        fields,
        display_values: displayValues,
        field_labels: fieldLabels,
        source_preview_id: sourcePreviewId,
      },
      currentValues: {
        target_ref: taskRef(task),
        target_title: task.title,
        values: previousValues,
        reverse_fields: reverseFields,
        display_values: previousDisplay,
      },
    };
  }

  private async normalizeFields(
    context: AiExecutionContextWithManager,
    task: TaskSnapshot,
    rawFields: Record<string, unknown>,
  ): Promise<{ fields: Record<string, unknown>; displayValues: Record<string, string | null>; fieldLabels: Record<string, string> }> {
    if (!rawFields || typeof rawFields !== 'object' || Array.isArray(rawFields)) throw new BadRequestException('fields must be an object.');
    const fields: Record<string, unknown> = {};
    const displayValues: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};
    const relationPatch: { relation_type?: unknown; relation_ref?: unknown } = {};

    for (const [rawName, rawValue] of Object.entries(rawFields)) {
      const inputName = normalizeKey(rawName);
      const config = FIELD_CONFIG[inputName];
      if (!config) throw new BadRequestException(`${rawName} is not writable for tasks.`);
      if (config.kind === 'relation') {
        (relationPatch as any)[inputName] = rawValue;
        continue;
      }
      const fieldName = config.targetField ?? inputName;
      if (fields[fieldName] !== undefined) throw new BadRequestException(`Field ${fieldName} was provided more than once.`);
      const normalized = await this.normalizeFieldValue(context, task, fieldName, config, rawValue);
      fields[fieldName] = normalized.value;
      displayValues[fieldName] = normalized.display;
      fieldLabels[fieldName] = config.label;
    }

    if (relationPatch.relation_type !== undefined || relationPatch.relation_ref !== undefined) {
      const currentMode = relationMode(task.related_object_type);
      const mode = relationPatch.relation_type === undefined
        ? currentMode
        : normalizeRelationType(relationPatch.relation_type);
      const relationRef = relationPatch.relation_ref === undefined ? task.related_object_id : textOrNull(relationPatch.relation_ref);
      const relation = mode === 'contract'
        ? await this.resolveContractRelation(context, relationRef)
        : mode === 'incident'
          ? await this.resolveIncidentRelation(context, relationRef)
          : await this.support.resolveCreateTarget(context, mode, relationRef);
      if (relation.mode === 'project') {
        await this.policy.assertBusinessPermission(context, 'portfolio_projects', 'contributor', context.manager);
      }
      fields.related_object_type = relation.type;
      fields.related_object_id = relation.id;
      displayValues.relation = relation.label;
      fieldLabels.related_object_type = 'Relation';
      fieldLabels.related_object_id = 'Relation';
    }

    if (Object.keys(fields).length === 0) throw new BadRequestException('At least one task field is required.');
    return { fields, displayValues, fieldLabels };
  }

  private async normalizeFieldValue(
    context: AiExecutionContextWithManager,
    task: TaskSnapshot,
    fieldName: string,
    config: FieldConfig,
    rawValue: unknown,
  ): Promise<{ value: unknown; display: string | null }> {
    if ((rawValue == null || (typeof rawValue === 'string' && rawValue.trim() === '')) && config.nullable) {
      return { value: null, display: null };
    }
    if (config.kind === 'text') {
      const text = textOrNull(rawValue);
      if (!text && !config.nullable) throw new BadRequestException(`${config.label} cannot be empty.`);
      return { value: text, display: text };
    }
    if (config.kind === 'date') {
      const value = normalizeDate(rawValue, config.label, config.nullable);
      return { value, display: value };
    }
    if (config.kind === 'status') {
      const status = normalizeKey(String(rawValue)) as TaskStatus;
      if (!TASK_STATUSES.includes(status)) throw new BadRequestException(`Status must be one of ${TASK_STATUSES.join(', ')}.`);
      return { value: status, display: toDisplayStatus(status) };
    }
    if (config.kind === 'priority') {
      const priority = normalizeKey(String(rawValue));
      if (!PRIORITIES.includes(priority as any)) throw new BadRequestException(`Priority must be one of ${PRIORITIES.join(', ')}.`);
      return { value: priority, display: priority };
    }
    if (config.kind === 'assignee') {
      const assignee = await this.support.resolveUserReference(context, String(rawValue));
      return { value: assignee.id, display: assignee.label };
    }
    if (config.kind === 'task_type') {
      const type = await this.support.resolveTaskType(context, String(rawValue));
      return { value: type.id, display: type.label };
    }
    if (config.kind === 'phase') {
      if (task.related_object_type !== 'project' || !task.related_object_id) {
        throw new BadRequestException('Phase can only be set on project-linked tasks.');
      }
      const phase = await this.support.resolveProjectPhase(context, task.related_object_id, await this.describeRelation(context, 'project', task.related_object_id) ?? 'project', String(rawValue));
      return { value: phase?.id ?? null, display: phase?.label ?? null };
    }
    if (config.kind === 'json_text_array') {
      const values = Array.isArray(rawValue)
        ? rawValue.map((item) => String(item).trim()).filter(Boolean)
        : String(rawValue).split(',').map((item) => item.trim()).filter(Boolean);
      return { value: values, display: values.join(', ') };
    }
    if (config.kind === 'entity_array') {
      const values = Array.isArray(rawValue)
        ? rawValue.map((item) => String(item).trim()).filter(Boolean)
        : String(rawValue).split(',').map((item) => item.trim()).filter(Boolean);
      const resolved = await this.resolveEntityArray(context, config.entityTarget!, values);
      return { value: resolved.ids, display: resolved.labels.join(', ') || null };
    }
    if (config.kind === 'portfolio_ref') {
      const ref = textOrNull(rawValue);
      if (!ref) return { value: null, display: null };
      const resolved = await this.resolvePortfolioReference(context, config.relationTarget!, ref);
      return { value: resolved.id, display: resolved.label };
    }
    throw new BadRequestException(`${config.label} is not supported.`);
  }

  private reverseFieldValue(fieldName: string, task: TaskSnapshot): unknown {
    if (fieldName === 'assignee_user_id') return task.assignee_user_id ?? null;
    if (fieldName === 'task_type_id') return task.task_type_id ?? null;
    if (fieldName === 'phase_id') return task.phase_id ?? null;
    if (fieldName === 'application_ids') return task.application_ids ?? [];
    if (fieldName === 'asset_ids') return task.asset_ids ?? [];
    return task[fieldName] ?? null;
  }

  private displayForField(fieldName: string, task: TaskSnapshot): string | null {
    if (fieldName === 'status') return toDisplayStatus(task.status as string);
    if (fieldName === 'assignee_user_id') return textOrNull(task.assignee_label);
    if (fieldName === 'task_type_id') return textOrNull(task.task_type_label);
    if (fieldName === 'phase_id') return textOrNull(task.phase_label);
    if (fieldName === 'company_id') return textOrNull(task.company_name);
    if (fieldName === 'source_id') return textOrNull(task.source_name);
    if (fieldName === 'category_id') return textOrNull(task.category_name);
    if (fieldName === 'stream_id') return textOrNull(task.stream_name);
    if (fieldName === 'application_ids') return formatValue(task.application_names);
    if (fieldName === 'asset_ids') return formatValue(task.asset_names);
    return formatValue(task[fieldName]);
  }

  private async resolveTask(context: AiExecutionContextWithManager, ref: string): Promise<TaskSnapshot> {
    const normalized = String(ref || '').trim();
    const match = normalized.match(/^T-(\d+)$/i);
    const rows = await context.manager.query(
      `
      SELECT t.*,
             t.start_date::text AS start_date_text,
             t.due_date::text AS due_date_text,
             COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS assignee_label,
             tt.name AS task_type_label,
             phase.name AS phase_label,
             comp.name AS company_name,
             ps.name AS source_name,
             pc.name AS category_name,
             pst.name AS stream_name,
             COALESCE((
               SELECT jsonb_agg(ta.application_id ORDER BY app.name ASC NULLS LAST, ta.application_id)
               FROM task_applications ta
               JOIN applications app ON app.id = ta.application_id AND app.tenant_id = ta.tenant_id
               WHERE ta.task_id = t.id AND ta.tenant_id = t.tenant_id
             ), '[]'::jsonb) AS application_ids,
             COALESCE((
               SELECT jsonb_agg(app.name ORDER BY app.name ASC NULLS LAST, app.id)
               FROM task_applications ta
               JOIN applications app ON app.id = ta.application_id AND app.tenant_id = ta.tenant_id
               WHERE ta.task_id = t.id AND ta.tenant_id = t.tenant_id
             ), '[]'::jsonb) AS application_names,
             COALESCE((
               SELECT jsonb_agg(ta.asset_id ORDER BY asset.name ASC NULLS LAST, ta.asset_id)
               FROM task_assets ta
               JOIN assets asset ON asset.id = ta.asset_id AND asset.tenant_id = ta.tenant_id
               WHERE ta.task_id = t.id AND ta.tenant_id = t.tenant_id
             ), '[]'::jsonb) AS asset_ids,
             COALESCE((
               SELECT jsonb_agg(asset.name ORDER BY asset.name ASC NULLS LAST, asset.id)
               FROM task_assets ta
               JOIN assets asset ON asset.id = ta.asset_id AND asset.tenant_id = ta.tenant_id
               WHERE ta.task_id = t.id AND ta.tenant_id = t.tenant_id
             ), '[]'::jsonb) AS asset_names
      FROM tasks t
      LEFT JOIN users u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
      LEFT JOIN portfolio_task_types tt ON tt.id = t.task_type_id AND tt.tenant_id = t.tenant_id
      LEFT JOIN portfolio_project_phases phase ON phase.id = t.phase_id AND phase.tenant_id = t.tenant_id
      LEFT JOIN companies comp ON comp.id = t.company_id AND comp.tenant_id = t.tenant_id
      LEFT JOIN portfolio_sources ps ON ps.id = t.source_id AND ps.tenant_id = t.tenant_id
      LEFT JOIN portfolio_categories pc ON pc.id = t.category_id AND pc.tenant_id = t.tenant_id
      LEFT JOIN portfolio_streams pst ON pst.id = t.stream_id AND pst.tenant_id = t.tenant_id
      WHERE t.tenant_id = $1
        AND (${isUuid(normalized) ? 't.id = $2' : 't.item_number = $2'})
      LIMIT 1
      `,
      [context.tenantId, isUuid(normalized) ? normalized : match ? Number(match[1]) : -1],
    );
    if (!rows[0]) throw new NotFoundException('Task not found.');
    const task = rows[0];
    task.start_date = task.start_date_text ?? null;
    task.due_date = task.due_date_text ?? null;
    delete task.start_date_text;
    delete task.due_date_text;
    return task as TaskSnapshot;
  }

  private async resolvePortfolioReference(
    context: AiExecutionContextWithManager,
    target: NonNullable<FieldConfig['relationTarget']>,
    ref: string,
  ): Promise<{ id: string; label: string }> {
    const uuid = isUuid(ref);
    const labelColumn = target === 'companies' ? 'name' : 'name';
    const rows = await context.manager.query(
      `SELECT id, ${labelColumn} AS label FROM ${target} WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(${labelColumn}) = LOWER($2::text)) ORDER BY ${labelColumn} LIMIT 6`,
      [context.tenantId, ref],
    );
    if (rows.length === 0) throw new NotFoundException(`${target.replace(/_/g, ' ')} "${ref}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple ${target.replace(/_/g, ' ')} matched "${ref}". Use a UUID.`);
    return { id: String(rows[0].id), label: String(rows[0].label || rows[0].id) };
  }

  private async resolveEntityArray(
    context: AiExecutionContextWithManager,
    target: 'applications' | 'assets',
    refs: string[],
  ): Promise<{ ids: string[]; labels: string[] }> {
    if (refs.length === 0) return { ids: [], labels: [] };
    const ids: string[] = [];
    const labels: string[] = [];
    for (const ref of Array.from(new Set(refs))) {
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
      if (rows.length === 0) throw new NotFoundException(`${target.slice(0, -1)} "${ref}" not found.`);
      if (rows.length > 1) throw new BadRequestException(`Multiple ${target} matched "${ref}". Use a UUID or exact reference.`);
      ids.push(String(rows[0].id));
      labels.push(String(rows[0].label || rows[0].id));
    }
    return { ids, labels };
  }

  private async resolveContractRelation(
    context: AiExecutionContextWithManager,
    ref: string | null,
  ): Promise<{ mode: 'contract'; type: 'contract'; id: string; label: string }> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('relation_ref is required when relation_type is contract.');
    const uuid = isUuid(normalized);
    const rows = await context.manager.query(
      `SELECT id, name FROM contracts WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`,
      [context.tenantId, normalized],
    );
    if (rows.length === 0) throw new NotFoundException(`Contract "${normalized}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple contracts matched "${normalized}". Use a UUID.`);
    return { mode: 'contract', type: 'contract', id: String(rows[0].id), label: `Contract - ${rows[0].name || rows[0].id}` };
  }

  private async resolveIncidentRelation(
    context: AiExecutionContextWithManager,
    ref: string | null,
  ): Promise<{ mode: 'incident'; type: 'incident'; id: string; label: string }> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('relation_ref is required when relation_type is incident.');
    const uuid = isUuid(normalized);
    const itemNumber = normalized.match(/^INC-(\d+)$/i)?.[1] ?? null;
    const params: unknown[] = [context.tenantId, normalized, itemNumber];
    const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
    const visibility = incidentVisibilitySql('i', viewer, params);
    const rows = await context.manager.query(
      `SELECT i.id, i.item_number,
              CASE WHEN i.confidential THEN CONCAT('INC-', i.item_number::text)
                   ELSE CONCAT('INC-', i.item_number::text, ' - ', i.title)
              END AS label
       FROM incidents i
       WHERE i.tenant_id = $1
         AND (${uuid ? 'i.id = $2 OR ' : ''}($3::int IS NOT NULL AND i.item_number = $3::int) OR LOWER(i.title) = LOWER($2::text))
         ${visibility}
       ORDER BY i.item_number LIMIT 6`,
      params,
    );
    if (rows.length === 0) throw new NotFoundException(`Incident "${normalized}" not found.`);
    if (rows.length > 1) throw new BadRequestException(`Multiple incidents matched "${normalized}". Use an INC reference.`);
    return { mode: 'incident', type: 'incident', id: String(rows[0].id), label: String(rows[0].label || rows[0].id) };
  }

  private async describeRelation(context: AiExecutionContextWithManager, type: RelatedType, id: string | null): Promise<string | null> {
    if (!type || !id) return 'Standalone';
    const table = type === 'project' ? 'portfolio_projects' : type === 'spend_item' ? 'spend_items' : type === 'capex_item' ? 'capex_items' : type === 'incident' ? 'incidents' : 'contracts';
    const labelColumn = type === 'project' ? "CONCAT('PRJ-', item_number::text, ' - ', name)" : type === 'spend_item' ? 'product_name' : type === 'capex_item' ? 'description' : type === 'incident' ? "CASE WHEN confidential THEN CONCAT('INC-', item_number::text) ELSE CONCAT('INC-', item_number::text, ' - ', title) END" : 'name';
    // A `spend_item` names an OPEX line (`spend/budget-nature.ts`).
    const nature = type === 'spend_item' ? ` AND nature = 'opex'` : '';
    const rows = await context.manager.query(`SELECT ${labelColumn} AS label FROM ${table} WHERE tenant_id = $1 AND id = $2${nature} LIMIT 1`, [context.tenantId, id]);
    return textOrNull(rows[0]?.label) || id;
  }
}
