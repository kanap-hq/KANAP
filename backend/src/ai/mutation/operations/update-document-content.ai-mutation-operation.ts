import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { z } from 'zod';
import { normalizeMarkdownRichText } from '../../../common/markdown-worker';
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

type UpdateDocumentContentInput = {
  document_id: string;
  content_markdown: string;
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

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'documents',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

const UpdateDocumentContentInputSchema = z.object({
  document_id: NullableStringSchema.optional()
    .describe('The document UUID, DOC reference, or document title. Prefer a DOC reference when available.'),
  document: NullableStringSchema.optional()
    .describe('Alias for document_id.'),
  content_markdown: NullableStringSchema.optional()
    .describe('The full resulting markdown body for the document after applying the requested changes.'),
  content: NullableStringSchema.optional()
    .describe('Alias for content_markdown.'),
  ...AI_DOCUMENT_RELATION_INPUT_SHAPE,
}).superRefine((value, ctx) => {
  if (value.document_id == null && value.document == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'document_id is required.',
      path: ['document_id'],
    });
  }
  if (
    value.document_id != null
    && value.document != null
    && String(value.document_id) !== String(value.document)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`document_id` and `document` must match when both are provided.',
      path: ['document'],
    });
  }
  if (value.content_markdown == null && value.content == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'content_markdown is required.',
      path: ['content_markdown'],
    });
  }
  if (
    value.content_markdown != null
    && value.content != null
    && String(value.content_markdown) !== String(value.content)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`content_markdown` and `content` must match when both are provided.',
      path: ['content'],
    });
  }
  extractAiDocumentRelationInput(value, ctx);
}).transform((value): UpdateDocumentContentInput => ({
  document_id: String(value.document_id ?? value.document ?? ''),
  content_markdown: String(value.content_markdown ?? value.content ?? ''),
  relations: extractAiDocumentRelationInput(value),
}));

@Injectable()
export class UpdateDocumentContentAiMutationOperation implements AiMutationOperation<UpdateDocumentContentInput> {
  private readonly logger = new Logger(UpdateDocumentContentAiMutationOperation.name);

  readonly toolName = 'update_document_content' as const;
  readonly description = 'Create a preview to update the markdown body of one knowledge document. You can also add linked projects, requests, tasks, applications, or assets in the same preview. Requires explicit user approval before execution.';
  readonly inputSchema = UpdateDocumentContentInputSchema;
  readonly inputSummary = {
    document_id: 'The document UUID, DOC reference, or document title. Prefer a DOC reference when available.',
    content_markdown: 'The full resulting markdown body after applying the requested edit. Read the current document first with `get_document`, then send the complete updated body here.',
    content: 'Alias for content_markdown.',
    ...getAiDocumentRelationInputSummary(),
  };
  readonly businessResource = 'knowledge';
  readonly writePreview = {
    entity_type: 'documents',
    fields: ['content_markdown', ...AI_DOCUMENT_RELATION_WRITE_FIELDS],
    reversible: false,
    prompt_hint: 'For document body edits, first call `get_document`, apply the requested changes to the markdown, then use `update_document_content` with the full resulting `content_markdown`. If you also need to add linked projects, requests, tasks, applications, or assets, include them in the same tool call. If the document or a relation target is ambiguous, ask the user to confirm before retrying.',
  };

  constructor(
    private readonly support: AiDocumentMutationSupportService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateDocumentContentInput,
  ): Promise<AiPreparedMutationPreview> {
    const requestedRelations = input.relations ?? extractAiDocumentRelationInput(input as unknown as Record<string, unknown>);
    const documentRef = textOrNull(input.document_id);
    if (!documentRef) {
      throw new BadRequestException('document_id is required.');
    }

    const document = await this.support.resolveDocumentSnapshot(context, documentRef);
    await this.support.assertUpdatePreviewAllowed(context, document.document_id);
    const resolvedRelationTargets = await this.support.resolveRelationTargets(context, requestedRelations);
    if (hasAiDocumentRelationInput(requestedRelations)) {
      this.support.assertRelationEditingAllowed(document);
    }

    const nextContent = await normalizeMarkdownRichText(input.content_markdown, {
      fieldName: 'content_markdown',
    });
    if (!nextContent?.trim()) {
      throw new BadRequestException('Document content cannot be empty.');
    }
    const relationMutation = this.support.buildRelationAdditionMutation(document.relations, resolvedRelationTargets);
    const contentChanged = nextContent !== document.content_markdown;
    if (!contentChanged && relationMutation.changedTypes.length === 0) {
      throw new BadRequestException(
        hasAiDocumentRelationInput(requestedRelations)
          ? 'Document content and relations already match the requested changes.'
          : 'Document content already matches the requested body.',
      );
    }

    return {
      targetEntityType: 'documents',
      targetEntityId: document.document_id,
      mutationInput: {
        ...(contentChanged ? { content_markdown: nextContent } : {}),
        ...(relationMutation.changedTypes.length > 0
          ? {
              relations: relationMutation.nextRelations,
              relation_labels: relationMutation.nextRelationLabels,
            }
          : {}),
      },
      currentValues: {
        target_ref: document.target_ref,
        target_title: document.target_title,
        content_markdown: document.content_markdown,
        revision: document.revision,
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

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = `Update content for ${ref}.`;
        break;
      case 'executed':
        summary = `${ref} content updated.`;
        break;
      case 'rejected':
        summary = `Content update for ${ref} was rejected.`;
        break;
      case 'expired':
        summary = `Content update preview for ${ref} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Content update for ${ref} failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(language, preview.status, writeActionText.updateDocumentContent(language, ref), {
        errorMessage: preview.error_message,
      });
    }

    return {
      target: buildTarget(preview),
      changes: {
        ...(Object.prototype.hasOwnProperty.call(mutation, 'content_markdown')
          ? {
              content: {
                label: 'Content',
                from: textOrNull(current.content_markdown),
                to: textOrNull(mutation.content_markdown),
                format: 'markdown' as const,
              },
            }
          : {}),
        ...this.support.buildRelationPreviewChanges(current.relation_snapshot, mutation.relation_labels),
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
      this.support.assertRelationSnapshotUnchanged(liveDocument, current.relation_snapshot);
      if (Object.prototype.hasOwnProperty.call(mutation, 'relations')) {
        this.support.assertRelationEditingAllowed(liveDocument);
      }

      await this.knowledge.update(
        documentId,
        {
          ...(Object.prototype.hasOwnProperty.call(mutation, 'content_markdown')
            ? { content_markdown: mutation.content_markdown }
            : {}),
          ...(mutation.relations ? { relations: mutation.relations } : {}),
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
          `Failed to release document lock for ${documentId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
