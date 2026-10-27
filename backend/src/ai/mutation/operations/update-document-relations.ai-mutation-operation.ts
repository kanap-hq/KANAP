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
  AI_DOCUMENT_RELATION_ENTITY_TYPES,
  AI_DOCUMENT_RELATION_INPUT_SHAPE,
  AI_DOCUMENT_RELATION_MUTATION_INPUT_SHAPE,
  AI_DOCUMENT_RELATION_REMOVE_INPUT_SHAPE,
  AI_DOCUMENT_RELATION_WRITE_FIELDS,
  extractAiDocumentRelationInput,
  extractAiDocumentRelationObjectInput,
  extractAiDocumentRelationRemoveInput,
  getAiDocumentRelationRemoveInputSummary,
  getAiDocumentRelationInputSummary,
  AiDocumentRelationInput,
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

type UpdateDocumentRelationsInput = {
  document_id: string;
  relations: {
    add: ReturnType<typeof extractAiDocumentRelationInput>;
    remove: ReturnType<typeof extractAiDocumentRelationRemoveInput>;
  };
};

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

function sameRelationValues(left: string[] | undefined, right: string[] | undefined): boolean {
  const sortedLeft = [...(left || [])].sort();
  const sortedRight = [...(right || [])].sort();
  if (sortedLeft.length !== sortedRight.length) {
    return false;
  }
  return sortedLeft.every((value, index) => value === sortedRight[index]);
}

function mergeRelationInputSources(
  topLevel: AiDocumentRelationInput,
  grouped: AiDocumentRelationInput,
  ctx?: z.RefinementCtx,
  groupedFieldName?: 'add' | 'remove',
): AiDocumentRelationInput {
  const merged: AiDocumentRelationInput = {};

  for (const entityType of AI_DOCUMENT_RELATION_ENTITY_TYPES) {
    const topLevelValues = topLevel[entityType];
    const groupedValues = grouped[entityType];
    const topLevelFieldName = groupedFieldName === 'remove'
      ? `remove_${entityType}`
      : entityType;

    if (
      topLevelValues !== undefined
      && groupedValues !== undefined
      && !sameRelationValues(topLevelValues, groupedValues)
    ) {
      ctx?.addIssue({
        code: z.ZodIssueCode.custom,
        message: `\`${groupedFieldName}.${String(entityType)}\` and top-level \`${topLevelFieldName}\` must match when both are provided.`,
        path: groupedFieldName ? [groupedFieldName, String(entityType)] : [String(entityType)],
      });
      continue;
    }

    const normalized = topLevelValues ?? groupedValues;
    if (normalized && normalized.length > 0) {
      merged[entityType] = normalized;
    }
  }

  return merged;
}

const UpdateDocumentRelationsInputSchema = z.object({
  document_id: z.union([z.string().trim().min(1), z.null()]).optional()
    .describe('The document UUID, DOC reference, or document title. Prefer a DOC reference when available.'),
  document: z.union([z.string().trim().min(1), z.null()]).optional()
    .describe('Alias for document_id.'),
  ...AI_DOCUMENT_RELATION_INPUT_SHAPE,
  ...AI_DOCUMENT_RELATION_REMOVE_INPUT_SHAPE,
  ...AI_DOCUMENT_RELATION_MUTATION_INPUT_SHAPE,
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

  const addRelations = mergeRelationInputSources(
    extractAiDocumentRelationInput(value, ctx),
    extractAiDocumentRelationObjectInput(value.add),
    ctx,
    'add',
  );
  const removeRelations = mergeRelationInputSources(
    extractAiDocumentRelationRemoveInput(value, ctx),
    extractAiDocumentRelationObjectInput(value.remove),
    ctx,
    'remove',
  );
  if (!hasAiDocumentRelationInput(addRelations) && !hasAiDocumentRelationInput(removeRelations)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'At least one linked project, request, task, application, or asset to add or remove must be provided.',
      path: ['projects'],
    });
  }
}).transform((value): UpdateDocumentRelationsInput => ({
  document_id: String(value.document_id ?? value.document ?? ''),
  relations: {
    add: mergeRelationInputSources(
      extractAiDocumentRelationInput(value),
      extractAiDocumentRelationObjectInput(value.add),
      undefined,
      'add',
    ),
    remove: mergeRelationInputSources(
      extractAiDocumentRelationRemoveInput(value),
      extractAiDocumentRelationObjectInput(value.remove),
      undefined,
      'remove',
    ),
  },
}));

@Injectable()
export class UpdateDocumentRelationsAiMutationOperation implements AiMutationOperation<UpdateDocumentRelationsInput> {
  private readonly logger = new Logger(UpdateDocumentRelationsAiMutationOperation.name);

  readonly toolName = 'update_document_relations' as const;
  readonly description = 'Create a preview to add or remove linked projects, requests, tasks, applications, or assets on one knowledge document. Prefer the canonical nested `add` / `remove` shape. This tool only creates a preview and requires explicit user approval before execution.';
  readonly inputSchema = UpdateDocumentRelationsInputSchema;
  readonly inputSummary = {
    document_id: 'The document UUID, DOC reference, or document title. Prefer a DOC reference when available.',
    add: 'Canonical grouped relation additions by entity type, for example {"projects":["PRJ-33"]}.',
    remove: 'Canonical grouped relation removals by entity type, for example {"applications":["Billing App"]}.',
    ...getAiDocumentRelationInputSummary(),
    ...getAiDocumentRelationRemoveInputSummary(),
  };
  readonly businessResource = 'knowledge';
  readonly writePreview = {
    entity_type: 'documents',
    fields: [...AI_DOCUMENT_RELATION_WRITE_FIELDS],
    reversible: false,
    prompt_hint: 'For relation-only document changes, use `update_document_relations`. This tool edits document links, not project, request, application, asset, or task records. If the user starts from a project, request, application, asset, or task, first identify the target document ref from entity knowledge or by querying documents with `linked_project`, `linked_request`, `linked_application`, `linked_asset`, or `linked_task`, then call `update_document_relations` on that document. Prefer the canonical nested shape, for example `{"document_id":"DOC-14","remove":{"applications":["Billing App"]}}` or `{"document_id":"DOC-14","add":{"projects":["PRJ-33"]}}`. If the document or a relation target is ambiguous, ask the user to confirm before retrying.',
  };

  constructor(
    private readonly support: AiDocumentMutationSupportService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: UpdateDocumentRelationsInput,
  ): Promise<AiPreparedMutationPreview> {
    const rawInput = input as unknown as Record<string, unknown>;
    const requestedRelationAdds = input.relations?.add ?? mergeRelationInputSources(
      extractAiDocumentRelationInput(rawInput),
      extractAiDocumentRelationObjectInput(rawInput.add),
    );
    const requestedRelationRemovals = input.relations?.remove ?? mergeRelationInputSources(
      extractAiDocumentRelationRemoveInput(rawInput),
      extractAiDocumentRelationObjectInput(rawInput.remove),
    );
    const documentRef = textOrNull(input.document_id);
    if (!documentRef) {
      throw new BadRequestException('document_id is required.');
    }

    const document = await this.support.resolveDocumentSnapshot(context, documentRef);
    await this.support.assertUpdatePreviewAllowed(context, document.document_id);
    this.support.assertRelationEditingAllowed(document);

    const [resolvedRelationAdds, resolvedRelationRemovals] = await Promise.all([
      this.support.resolveRelationTargets(context, requestedRelationAdds),
      this.support.resolveRelationTargets(context, requestedRelationRemovals),
    ]);
    const relationMutation = this.support.buildRelationMutation(document.relations, {
      add: resolvedRelationAdds,
      remove: resolvedRelationRemovals,
    });
    if (relationMutation.changedTypes.length === 0) {
      throw new BadRequestException('Document relations already match the requested changes.');
    }

    return {
      targetEntityType: 'documents',
      targetEntityId: document.document_id,
      mutationInput: {
        relations: relationMutation.nextRelations,
        relation_labels: relationMutation.nextRelationLabels,
      },
      currentValues: {
        target_ref: document.target_ref,
        target_title: document.target_title,
        revision: document.revision,
        relation_snapshot: relationMutation.currentRelationSnapshot,
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
        summary = `Update links for ${ref}.`;
        break;
      case 'executed':
        summary = `${ref} links updated.`;
        break;
      case 'rejected':
        summary = `Link changes for ${ref} were rejected.`;
        break;
      case 'expired':
        summary = `Link update preview for ${ref} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Link update for ${ref} failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(language, preview.status, writeActionText.updateDocumentLinks(language, ref), {
        errorMessage: preview.error_message,
      });
    }

    return {
      target: buildTarget(preview),
      changes: this.support.buildRelationPreviewChanges(current.relation_snapshot, mutation.relation_labels),
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

      this.support.assertRelationEditingAllowed(liveDocument);
      this.support.assertRelationSnapshotUnchanged(liveDocument, current.relation_snapshot);

      await this.knowledge.update(
        documentId,
        {
          relations: mutation.relations,
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
