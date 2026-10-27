import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  AiDeleteImpact,
  AiWriteLanguage,
  deletionImpactText,
  previewSummaryText,
  quoted,
  writeActionText,
} from '../../ai-write-texts';
import { AiMutationOperation, AiMutationPreviewPresentation, AiPreparedMutationPreview } from '../ai-mutation-operation.types';
import { AI_DELETE_ENTITY_TYPES, AiDeleteEntityType, AiDeleteMutationSupportService } from '../ai-delete-mutation-support.service';

type DeleteRecordInput = {
  entity_type: AiDeleteEntityType;
  ref: string;
};

const NOUNS: Record<AiDeleteEntityType, string> = {
  tasks: 'task',
  contacts: 'contact',
  locations: 'location',
};

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

/** The record's name without the business reference the card already shows. */
function displayTitle(current: Record<string, unknown>): string {
  const ref = textOrNull(current.target_ref);
  const title = textOrNull(current.target_title);
  if (title && ref && title.startsWith(ref)) {
    const stripped = title.slice(ref.length).replace(/^\s*[-–—·:|]\s*/, '').trim();
    if (stripped) return stripped;
  }
  return title || ref || 'record';
}

function impactOf(current: Record<string, unknown>): AiDeleteImpact {
  const counts = current.counts && typeof current.counts === 'object' && !Array.isArray(current.counts)
    ? current.counts as Record<string, unknown>
    : {};
  return {
    counts: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, Number(value) || 0])),
    ...(Number(current.hidden) > 0 ? { hidden: Number(current.hidden) } : {}),
  };
}

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: preview.target_entity_type,
    entity_id: preview.target_entity_id ?? null,
    ref: textOrNull(current.target_ref),
    title: textOrNull(current.target_title),
  };
}

/**
 * The preview of a delete, one record at a time: the screen's service does the delete, and the
 * card says what goes with the record in counts, in the person's language. Nothing is reversible:
 * there is no reverse preview.
 */
@Injectable()
export class DeleteRecordAiMutationOperation implements AiMutationOperation<DeleteRecordInput> {
  readonly toolName = 'delete_record' as const;
  readonly description = 'Create a preview to delete one task, one contact or one location. One record per preview, never a bulk delete, and every delete waits for explicit approval.';
  readonly inputSchema = z.object({
    entity_type: z.enum(['tasks', 'contacts', 'locations']).describe('The family of the record to delete: tasks, contacts or locations.'),
    ref: z.string().trim().min(1).describe('The record reference or exact name: T-42, a contact name or email, or a location reference or name.'),
  });
  readonly inputSummary = {
    entity_type: 'One of tasks, contacts or locations.',
    ref: 'The record reference or exact name. One record per preview.',
  };
  readonly businessResource = 'tasks';
  readonly businessResources = AI_DELETE_ENTITY_TYPES;
  readonly writePreview = {
    entity_type: 'records',
    fields: ['entity_type', 'ref'],
    reversible: false,
    prompt_hint: 'To delete one record, use `delete_record` with `entity_type` (tasks, contacts or locations) and the record\'s `ref` or exact name. One record per preview, always under approval, never in bulk and never in `prepare_mutation_plan`: the preview says what goes with the record and the delete cannot be undone. When several records are asked for, prepare the first and say the others are deleted one at a time, or ask which one to delete first.',
  };

  constructor(private readonly support: AiDeleteMutationSupportService) {}

  resolveBusinessResource(params: { input?: DeleteRecordInput; preview?: AiMutationPreview }): string {
    return String(params.input?.entity_type ?? params.preview?.target_entity_type ?? 'tasks');
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: DeleteRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    const { target, impact } = await this.support.prepare(context, input.entity_type, input.ref);
    return {
      targetEntityType: target.entityType,
      targetEntityId: target.id,
      mutationInput: {
        entity_type: target.entityType,
        ref: target.ref ?? target.id,
      },
      currentValues: {
        target_ref: target.ref,
        target_title: target.title,
        updated_at: target.updatedAt,
        counts: impact.counts,
        ...(impact.hidden ? { hidden: impact.hidden } : {}),
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const entityType = (preview.target_entity_type || preview.mutation_input?.entity_type) as AiDeleteEntityType;
    const noun = NOUNS[entityType] ?? 'record';
    const title = displayTitle(current);
    const impact = impactOf(current);

    let summary: string;
    switch (preview.status) {
      case 'executed':
        summary = `${noun.charAt(0).toUpperCase()}${noun.slice(1)} "${title}" deleted.`;
        break;
      case 'rejected':
        summary = `Deletion of ${noun} "${title}" was rejected.`;
        break;
      case 'expired':
        summary = `Deletion preview for ${noun} "${title}" expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Deletion of ${noun} "${title}" failed.`;
        break;
      default:
        summary = `Delete ${noun} "${title}".`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.deleteRecord(language, entityType, quoted(language, title)),
        { errorMessage: preview.error_message },
      );
    }

    return {
      target: buildTarget(preview),
      changes: {
        deletion: {
          label: 'What goes with it',
          from: null,
          to: deletionImpactText(language, entityType, impact),
          format: 'markdown',
        },
      },
      summary,
    };
  }

  executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    return this.support.execute(context, preview);
  }
}
