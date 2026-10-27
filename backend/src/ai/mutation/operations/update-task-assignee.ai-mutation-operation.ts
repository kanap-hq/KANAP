import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Task } from '../../../tasks/task.entity';
import { TasksUnifiedService } from '../../../tasks/tasks-unified.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiTaskMutationSupportService, toDisplayAssignee } from '../ai-task-mutation-support.service';
import { AiWriteLanguage, previewSummaryText, unassignedText, writeActionText } from '../../ai-write-texts';

type UpdateTaskAssigneeInput = {
  ref: string;
  assignee_email: string;
};

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'tasks',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

@Injectable()
export class UpdateTaskAssigneeAiMutationOperation implements AiMutationOperation<UpdateTaskAssigneeInput> {
  readonly toolName = 'update_task_assignee' as const;
  readonly description = 'Create a preview to change one task assignee. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    ref: z.string().trim().min(1),
    assignee_email: z.string().trim().email(),
  });
  readonly inputSummary = {
    ref: 'Task reference such as T-42.',
    assignee_email: 'The assignee email address in the current tenant.',
  };
  readonly businessResource = 'tasks';
  readonly writePreview = {
    entity_type: 'tasks',
    fields: ['assignee'],
    reversible: true,
    prompt_hint: 'For assignee changes, use `update_task_assignee` with the assignee email.',
  };

  constructor(
    private readonly support: AiTaskMutationSupportService,
    private readonly tasks: TasksUnifiedService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateTaskAssigneeInput,
  ): Promise<AiPreparedMutationPreview> {
    const task = await this.support.resolveTaskSnapshot(context, input.ref);
    const assignee = await this.support.resolveAssignee(context, input.assignee_email);
    if (task.assignee_user_id === assignee.id) {
      throw new BadRequestException('Task is already assigned to that user.');
    }

    return {
      targetEntityType: 'tasks',
      targetEntityId: task.task_id,
      mutationInput: {
        assignee_user_id: assignee.id,
        assignee_email: assignee.email,
        assignee_label: assignee.label,
      },
      currentValues: {
        target_ref: task.target_ref,
        target_title: task.target_title,
        assignee_user_id: task.assignee_user_id,
        assignee_label: task.assignee_label,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'task';
    const nextAssignee = toDisplayAssignee(
      typeof mutation.assignee_label === 'string'
        ? mutation.assignee_label
        : typeof mutation.assignee_email === 'string'
          ? mutation.assignee_email
          : null,
    );
    const prevAssignee = toDisplayAssignee(
      typeof current.assignee_label === 'string' ? current.assignee_label : null,
    );

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Update ${ref} assignee from ${prevAssignee} to ${nextAssignee}.`;
        break;
      case 'executed':
        summary = `${ref} assignee updated to ${nextAssignee}.`;
        break;
      case 'rejected':
        summary = `Assignee update for ${ref} was rejected.`;
        break;
      case 'expired':
        summary = `Assignee update preview for ${ref} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Assignee update for ${ref} failed.`;
        break;
    }

    if (language !== 'en') {
      const named = (value: unknown) => (typeof value === 'string' && value.trim() ? value : unassignedText(language));
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.changeTaskAssignee(
          language,
          ref,
          named(current.assignee_label),
          named(mutation.assignee_label ?? mutation.assignee_email),
        ),
        { errorMessage: preview.error_message },
      );
    }

    return {
      target: buildTarget(preview),
      changes: {
        assignee: {
          label: 'Assignee',
          from: prevAssignee,
          to: nextAssignee,
          format: 'text',
        },
      },
      summary,
    };
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const liveTask = await context.manager.getRepository(Task).findOne({
      where: {
        id: preview.target_entity_id ?? '',
        tenant_id: context.tenantId,
      },
    });

    if (!liveTask) {
      throw new BadRequestException('Task no longer exists.');
    }
    if ((liveTask.assignee_user_id ?? null) !== (current.assignee_user_id ?? null)) {
      throw new ConflictException('Task assignee changed after the preview was created.');
    }

    await this.tasks.updateById(
      liveTask.id,
      { assignee_user_id: mutation.assignee_user_id as string | null },
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
    const originalCurrent = preview.current_values ?? {};
    const originalAssigneeId = (originalCurrent.assignee_user_id as string | null | undefined) ?? null;
    const task = await this.support.resolveTaskSnapshot(context, preview.target_entity_id ?? '');
    if ((task.assignee_user_id ?? null) === originalAssigneeId) {
      throw new BadRequestException('Task already has its previous assignee.');
    }

    return {
      targetEntityType: 'tasks',
      targetEntityId: preview.target_entity_id ?? null,
      mutationInput: {
        assignee_user_id: originalAssigneeId,
        assignee_label: (originalCurrent.assignee_label as string | null | undefined) ?? null,
        source_preview_id: preview.id,
      },
      currentValues: {
        target_ref: task.target_ref,
        target_title: task.target_title,
        assignee_user_id: task.assignee_user_id,
        assignee_label: task.assignee_label,
      },
    };
  }
}
