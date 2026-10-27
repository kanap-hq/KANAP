import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { Task, TASK_STATUSES, TaskStatus } from '../../../tasks/task.entity';
import { TasksUnifiedService } from '../../../tasks/tasks-unified.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiTaskMutationSupportService, toDisplayStatus } from '../ai-task-mutation-support.service';
import { AiWriteLanguage, previewSummaryText, taskStatusText, writeActionText } from '../../ai-write-texts';

type UpdateTaskStatusInput = {
  ref: string;
  status: TaskStatus;
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
export class UpdateTaskStatusAiMutationOperation implements AiMutationOperation<UpdateTaskStatusInput> {
  readonly toolName = 'update_task_status' as const;
  readonly description = 'Create a preview to update one task status. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    ref: z.string().trim().min(1),
    status: z.enum(['open', 'in_progress', 'pending', 'in_testing', 'done', 'cancelled']),
  });
  readonly inputSummary = {
    ref: 'Task reference such as T-42.',
    status: 'One of open, in_progress, pending, in_testing, done, or cancelled.',
  };
  readonly businessResource = 'tasks';
  readonly writePreview = {
    entity_type: 'tasks',
    fields: ['status'],
    reversible: true,
    prompt_hint: 'For task status changes, use `update_task_status` with a canonical task reference such as `T-42`.',
  };

  constructor(
    private readonly support: AiTaskMutationSupportService,
    private readonly tasks: TasksUnifiedService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateTaskStatusInput,
  ): Promise<AiPreparedMutationPreview> {
    const task = await this.support.resolveTaskSnapshot(context, input.ref);
    if (!TASK_STATUSES.includes(input.status)) {
      throw new BadRequestException(`Invalid status. Allowed values: ${TASK_STATUSES.join(', ')}`);
    }
    if (task.status === input.status) {
      throw new BadRequestException('Task already has that status.');
    }

    return {
      targetEntityType: 'tasks',
      targetEntityId: task.task_id,
      mutationInput: {
        status: input.status,
      },
      currentValues: {
        target_ref: task.target_ref,
        target_title: task.target_title,
        status: task.status,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'task';
    const nextStatus = toDisplayStatus(typeof mutation.status === 'string' ? mutation.status : null) ?? 'updated';
    const prevStatus = toDisplayStatus(typeof current.status === 'string' ? current.status : null) ?? 'unknown';

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Update ${ref} status from ${prevStatus} to ${nextStatus}.`;
        break;
      case 'executed':
        summary = `${ref} status updated to ${nextStatus}.`;
        break;
      case 'rejected':
        summary = `Status update for ${ref} was rejected.`;
        break;
      case 'expired':
        summary = `Status update preview for ${ref} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Status update for ${ref} failed.`;
        break;
    }

    if (language !== 'en') {
      const statusOf = (value: unknown) => taskStatusText(language, typeof value === 'string' ? value : null) ?? '—';
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.changeTaskStatus(language, ref, statusOf(current.status), statusOf(mutation.status)),
        { errorMessage: preview.error_message },
      );
    }

    return {
      target: buildTarget(preview),
      changes: {
        status: {
          label: 'Status',
          from: prevStatus,
          to: nextStatus,
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
    if ((liveTask.status ?? null) !== (current.status ?? null)) {
      throw new ConflictException('Task status changed after the preview was created.');
    }

    await this.tasks.updateById(
      liveTask.id,
      { status: mutation.status as TaskStatus },
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
    const originalStatus = originalCurrent.status as TaskStatus | undefined;
    if (!originalStatus) {
      throw new BadRequestException('Original preview is missing the previous task status.');
    }

    const task = await this.support.resolveTaskSnapshot(context, preview.target_entity_id ?? '');
    if (task.status === originalStatus) {
      throw new BadRequestException('Task already has its previous status.');
    }

    return {
      targetEntityType: 'tasks',
      targetEntityId: preview.target_entity_id ?? null,
      mutationInput: {
        status: originalStatus,
        source_preview_id: preview.id,
      },
      currentValues: {
        target_ref: task.target_ref,
        target_title: task.target_title,
        status: task.status,
      },
    };
  }
}
