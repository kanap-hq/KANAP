import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { z } from 'zod';
import { KnowledgeService } from '../../../knowledge/knowledge.service';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  AI_DOCUMENT_RELATION_INPUT_SHAPE,
  AI_DOCUMENT_RELATION_WRITE_FIELDS,
  AiDocumentRelationInput,
  extractAiDocumentRelationInput,
  getAiDocumentRelationInputSummary,
  hasAiDocumentRelationInput,
} from '../ai-document-relation-input';
import { AiDocumentMutationSupportService } from '../ai-document-mutation-support.service';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';
import { AiWriteLanguage, previewSummaryText, writeActionText } from '../../ai-write-texts';

type UpdateDocumentMetadataInput = {
  document_id: string;
  title?: string;
  summary?: string | null;
  review_due_at?: string | null;
  last_reviewed_at?: string | null;
  relations: AiDocumentRelationInput;
};

const NullableStringSchema = z.union([z.string(), z.null()]);

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

function normalizeDateInput(
  value: string | null | undefined,
  fieldName: string,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = textOrNull(value);
  if (!normalized) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid date.`);
  }
  return parsed.toISOString().slice(0, 10);
}

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'documents',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

@Injectable()
export class UpdateDocumentMetadataAiMutationOperation implements AiMutationOperation<UpdateDocumentMetadataInput> {
  private readonly logger = new Logger(UpdateDocumentMetadataAiMutationOperation.name);

  readonly toolName = 'update_document_metadata' as const;
  readonly description = 'Create a preview to update selected metadata fields on one knowledge document. You can also add linked projects, requests, tasks, applications, or assets in the same preview. Requires explicit user approval before execution.';
  readonly inputSchema = z.object({
    document_id: z.string().trim().min(1),
    title: z.string().trim().min(1).optional(),
    summary: NullableStringSchema.optional(),
    review_due_at: NullableStringSchema.optional(),
    last_reviewed_at: NullableStringSchema.optional(),
    ...AI_DOCUMENT_RELATION_INPUT_SHAPE,
  }).refine(
    (value) =>
      value.title !== undefined
      || value.summary !== undefined
      || value.review_due_at !== undefined
      || value.last_reviewed_at !== undefined
      || hasAiDocumentRelationInput(extractAiDocumentRelationInput(value)),
    {
      message: 'At least one document metadata or relation change must be provided.',
    },
  ).superRefine((value, ctx) => {
    extractAiDocumentRelationInput(value, ctx);
  }).transform((value): UpdateDocumentMetadataInput => ({
    document_id: value.document_id,
    title: value.title,
    summary: value.summary,
    review_due_at: value.review_due_at,
    last_reviewed_at: value.last_reviewed_at,
    relations: extractAiDocumentRelationInput(value),
  }));
  readonly inputSummary = {
    document_id: 'The document UUID or DOC-123 reference.',
    title: 'Optional new document title.',
    summary: 'Optional new summary. Use null to clear it.',
    review_due_at: 'Optional new review due date as YYYY-MM-DD. Use null to clear it.',
    last_reviewed_at: 'Optional new last-reviewed date as YYYY-MM-DD. Use null to clear it.',
    ...getAiDocumentRelationInputSummary(),
  };
  readonly businessResource = 'knowledge';
  readonly writePreview = {
    entity_type: 'documents',
    fields: ['title', 'summary', 'review_due_at', 'last_reviewed_at', ...AI_DOCUMENT_RELATION_WRITE_FIELDS],
    reversible: false,
    prompt_hint: 'For document metadata changes, use `update_document_metadata` with a DOC-123 reference. This tool supports title, summary, review due date, last reviewed date, and optional relation additions for linked projects, requests, tasks, applications, or assets.',
  };

  constructor(
    private readonly support: AiDocumentMutationSupportService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateDocumentMetadataInput,
  ): Promise<AiPreparedMutationPreview> {
    const requestedRelations = input.relations ?? extractAiDocumentRelationInput(input as unknown as Record<string, unknown>);
    const document = await this.support.resolveDocumentSnapshot(context, input.document_id);
    await this.support.assertUpdatePreviewAllowed(context, document.document_id);
    const resolvedRelationTargets = await this.support.resolveRelationTargets(context, requestedRelations);
    if (hasAiDocumentRelationInput(requestedRelations)) {
      this.support.assertRelationEditingAllowed(document);
    }

    const nextTitle = input.title !== undefined ? textOrNull(input.title) : undefined;
    if (input.title !== undefined && !nextTitle) {
      throw new BadRequestException('Document title cannot be empty.');
    }

    const nextSummary = input.summary !== undefined
      ? (input.summary == null ? null : textOrNull(input.summary))
      : undefined;
    const nextReviewDueAt = normalizeDateInput(input.review_due_at, 'review_due_at');
    const nextLastReviewedAt = normalizeDateInput(input.last_reviewed_at, 'last_reviewed_at');

    if (
      document.is_managed_integrated_document
      && nextTitle !== undefined
      && nextTitle !== document.target_title
    ) {
      throw new BadRequestException('Managed integrated documents cannot change: title');
    }

    const mutationInput: Record<string, unknown> = {};
    const changes: string[] = [];
    const relationMutation = this.support.buildRelationAdditionMutation(document.relations, resolvedRelationTargets);

    if (nextTitle !== undefined && nextTitle !== document.target_title) {
      mutationInput.title = nextTitle;
      changes.push('title');
    }
    if (nextSummary !== undefined && nextSummary !== document.summary) {
      mutationInput.summary = nextSummary;
      changes.push('summary');
    }
    if (nextReviewDueAt !== undefined && nextReviewDueAt !== document.review_due_at) {
      mutationInput.review_due_at = nextReviewDueAt;
      changes.push('review_due_at');
    }
    if (nextLastReviewedAt !== undefined && nextLastReviewedAt !== document.last_reviewed_at) {
      mutationInput.last_reviewed_at = nextLastReviewedAt;
      changes.push('last_reviewed_at');
    }

    if (relationMutation.changedTypes.length > 0) {
      mutationInput.relations = relationMutation.nextRelations;
      mutationInput.relation_labels = relationMutation.nextRelationLabels;
      changes.push('relations');
    }

    if (changes.length === 0) {
      throw new BadRequestException('Document metadata and relations already match the requested values.');
    }

    return {
      targetEntityType: 'documents',
      targetEntityId: document.document_id,
      mutationInput,
      currentValues: {
        target_ref: document.target_ref,
        target_title: document.target_title,
        summary: document.summary,
        review_due_at: document.review_due_at,
        last_reviewed_at: document.last_reviewed_at,
        revision: document.revision,
        is_managed_integrated_document: document.is_managed_integrated_document,
        ...(relationMutation.changedTypes.length > 0
          ? { relation_snapshot: relationMutation.currentRelationSnapshot }
          : {}),
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const ref = textOrNull(current.target_ref) ?? 'document';

    const changes: AiMutationPreviewPresentation['changes'] = {};
    if (Object.prototype.hasOwnProperty.call(mutation, 'title')) {
      changes.title = {
        label: 'Title',
        from: textOrNull(current.target_title),
        to: textOrNull(mutation.title),
        format: 'text',
      };
    }
    if (Object.prototype.hasOwnProperty.call(mutation, 'summary')) {
      changes.summary = {
        label: 'Summary',
        from: textOrNull(current.summary),
        to: textOrNull(mutation.summary),
        format: 'text',
      };
    }
    if (Object.prototype.hasOwnProperty.call(mutation, 'review_due_at')) {
      changes.review_due_at = {
        label: 'Review Due',
        from: textOrNull(current.review_due_at),
        to: textOrNull(mutation.review_due_at),
        format: 'text',
      };
    }
    if (Object.prototype.hasOwnProperty.call(mutation, 'last_reviewed_at')) {
      changes.last_reviewed_at = {
        label: 'Last Reviewed',
        from: textOrNull(current.last_reviewed_at),
        to: textOrNull(mutation.last_reviewed_at),
        format: 'text',
      };
    }
    Object.assign(
      changes,
      this.support.buildRelationPreviewChanges(current.relation_snapshot, mutation.relation_labels),
    );

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Update ${ref}.`;
        break;
      case 'executed':
        summary = `${ref} updated.`;
        break;
      case 'rejected':
        summary = `Update for ${ref} was rejected.`;
        break;
      case 'expired':
        summary = `Update preview for ${ref} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Update for ${ref} failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(language, preview.status, writeActionText.updateRecord(language, ref), {
        errorMessage: preview.error_message,
      });
    }

    return {
      target: buildTarget(preview),
      changes,
      summary,
    };
  }

  async executePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<void> {
    const current = preview.current_values ?? {};
    const mutation = preview.mutation_input ?? {};
    const documentId = preview.target_entity_id;
    if (!documentId) {
      throw new BadRequestException('Preview is missing the target document.');
    }

    const previewRevision = Number(current.revision);
    if (!Number.isFinite(previewRevision)) {
      throw new BadRequestException('Preview is missing the document revision.');
    }

    await this.knowledge.assertWorkflowAllowsEditing(documentId, context.manager);

    const lock = await this.knowledge.acquireLock(documentId, context.userId, {
      manager: context.manager,
    });

    try {
      const liveDocument = await this.support.resolveDocumentSnapshot(context, documentId);
      if (liveDocument.revision !== previewRevision) {
        throw new ConflictException('Document changed after the preview was created.');
      }
      if (
        liveDocument.is_managed_integrated_document
        && Object.prototype.hasOwnProperty.call(mutation, 'title')
        && textOrNull(mutation.title) !== liveDocument.target_title
      ) {
        throw new BadRequestException('Managed integrated documents cannot change: title');
      }
      this.support.assertRelationSnapshotUnchanged(liveDocument, current.relation_snapshot);
      if (Object.prototype.hasOwnProperty.call(mutation, 'relations')) {
        this.support.assertRelationEditingAllowed(liveDocument);
      }

      await this.knowledge.update(
        documentId,
        {
          ...(Object.prototype.hasOwnProperty.call(mutation, 'title') ? { title: mutation.title } : {}),
          ...(Object.prototype.hasOwnProperty.call(mutation, 'summary') ? { summary: mutation.summary } : {}),
          ...(Object.prototype.hasOwnProperty.call(mutation, 'review_due_at') ? { review_due_at: mutation.review_due_at } : {}),
          ...(Object.prototype.hasOwnProperty.call(mutation, 'last_reviewed_at') ? { last_reviewed_at: mutation.last_reviewed_at } : {}),
          ...(Object.prototype.hasOwnProperty.call(mutation, 'relations') ? { relations: mutation.relations } : {}),
          revision: previewRevision,
          save_mode: 'manual',
        },
        context.userId,
        lock.lock_token,
        {
          manager: context.manager,
          audit: buildAiMutationAudit(preview),
        },
      );
    } finally {
      try {
        await this.knowledge.releaseLock(documentId, context.userId, lock.lock_token, {
          manager: context.manager,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to release AI-acquired document lock for ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
