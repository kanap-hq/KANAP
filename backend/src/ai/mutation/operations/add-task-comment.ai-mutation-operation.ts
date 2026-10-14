import { BadRequestException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { normalizeMarkdownRichText } from '../../../common/markdown-worker';
import { TaskActivitiesService } from '../../../tasks/task-activities.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import { AiTaskMutationSupportService } from '../ai-task-mutation-support.service';

type AddTaskCommentInput = {
  ref: string;
  content: string;
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
export class AddTaskCommentAiMutationOperation implements AiMutationOperation<AddTaskCommentInput> {
  readonly toolName = 'add_task_comment' as const;
  readonly description = 'Create a preview to add one comment to a task. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    ref: z.string().trim().min(1),
    content: z.string().trim().min(1),
  });
  readonly inputSummary = {
    ref: 'Task reference such as T-42.',
    content: 'Markdown comment content to add to the task.',
  };
  readonly businessResource = 'tasks';
  readonly writePreview = {
    entity_type: 'tasks',
    fields: ['comments'],
    reversible: false,
    prompt_hint: 'For task comments, use `add_task_comment` with a canonical task reference and the exact comment content.',
  };

  constructor(
    private readonly support: AiTaskMutationSupportService,
    private readonly activities: TaskActivitiesService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AddTaskCommentInput,
  ): Promise<AiPreparedMutationPreview> {
    const task = await this.support.resolveTaskSnapshot(context, input.ref);
    const normalizedContent = await normalizeMarkdownRichText(input.content, { fieldName: 'content' });
    if (!normalizedContent?.trim()) {
      throw new BadRequestException('Comment content is required.');
    }

    return {
      targetEntityType: 'tasks',
      targetEntityId: task.task_id,
      mutationInput: {
        content: normalizedContent,
      },
      currentValues: {
        target_ref: task.target_ref,
        target_title: task.target_title,
      },
    };
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = typeof current.target_ref === 'string' ? current.target_ref : 'task';

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Add a comment to ${ref}.`;
        break;
      case 'executed':
        summary = `Comment added to ${ref}.`;
        break;
      case 'rejected':
        summary = `Comment preview for ${ref} was rejected.`;
        break;
      case 'expired':
        summary = `Comment preview for ${ref} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Comment preview for ${ref} failed.`;
        break;
    }

    return {
      target: buildTarget(preview),
      changes: {
        comment: {
          label: 'Comment',
          from: null,
          to: typeof mutation.content === 'string' ? mutation.content : null,
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
    const content = typeof mutation.content === 'string' ? mutation.content : null;
    if (!content?.trim()) {
      throw new BadRequestException('Preview is missing comment content.');
    }

    const task = await this.support.resolveTaskSnapshot(context, preview.target_entity_id ?? '');
    await this.activities.create(
      task.task_id,
      {
        type: 'comment',
        content,
      },
      context.tenantId,
      context.userId,
      {
        manager: context.manager,
        audit: buildAiMutationAudit(preview),
      },
    );
  }
}
