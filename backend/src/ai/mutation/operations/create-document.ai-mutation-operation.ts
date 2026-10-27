import { BadRequestException, Injectable } from '@nestjs/common';
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
} from '../ai-document-relation-input';
import { AiDocumentMutationSupportService } from '../ai-document-mutation-support.service';
import { buildAiMutationAudit } from '../ai-mutation-audit.util';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';
import { AiWriteLanguage, previewSummaryText, quoted, writeActionText } from '../../ai-write-texts';

type CreateDocumentInput = {
  title: string;
  summary?: string | null;
  content_markdown?: string | null;
  template_document?: string | null;
  relations: AiDocumentRelationInput;
};

const CreateDocumentInputSchema = z.object({
  title: z.string().trim().min(1)
    .describe('Document title.'),
  summary: z.union([z.string(), z.null()]).optional()
    .describe('Optional short summary for the document.'),
  content_markdown: z.union([z.string(), z.null()]).optional()
    .describe('Optional initial markdown body for the document. Put the full draft content here when creating a drafted document.'),
  content: z.union([z.string(), z.null()]).optional()
    .describe('Alias for content_markdown. Optional initial markdown body for the document.'),
  template_document: z.union([z.string(), z.null()]).optional()
    .describe('Optional template document to use, identified by DOC reference or exact template title from the Templates library.'),
  template: z.union([z.string(), z.null()]).optional()
    .describe('Alias for template_document.'),
  ...AI_DOCUMENT_RELATION_INPUT_SHAPE,
}).superRefine((value, ctx) => {
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
  if (
    value.template_document != null
    && value.template != null
    && String(value.template_document) !== String(value.template)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: '`template_document` and `template` must match when both are provided.',
      path: ['template'],
    });
  }
  extractAiDocumentRelationInput(value, ctx);
}).transform((value): CreateDocumentInput => ({
  title: value.title,
  summary: value.summary,
  content_markdown: value.content_markdown ?? value.content ?? null,
  template_document: value.template_document ?? value.template ?? null,
  relations: extractAiDocumentRelationInput(value),
}));

function buildTarget(preview: AiMutationPreview): AiMutationPreviewPresentation['target'] {
  const current = preview.current_values ?? {};
  return {
    entity_type: 'documents',
    entity_id: preview.target_entity_id ?? null,
    ref: typeof current.target_ref === 'string' ? current.target_ref : null,
    title: typeof current.target_title === 'string' ? current.target_title : null,
  };
}

function textOrNull(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const normalized = String(value).trim();
  return normalized || null;
}

@Injectable()
export class CreateDocumentAiMutationOperation implements AiMutationOperation<CreateDocumentInput> {
  readonly toolName = 'create_document' as const;
  readonly description = 'Create a preview to create one draft knowledge document in the default library. Optionally base it on a template from the Templates library using `template_document`, and optionally add linked projects, requests, tasks, applications, or assets. Put the final document body in `content_markdown` or `content`; assistant prose outside the tool call is not saved. Requires explicit user approval before execution.';
  readonly inputSchema = CreateDocumentInputSchema;
  readonly inputSummary = {
    title: 'Document title.',
    summary: 'Optional short summary.',
    content_markdown: 'Optional initial markdown content for the draft document. If the user wants the document body drafted, include the full body here. Text outside the tool call is not saved.',
    content: 'Alias for content_markdown. Optional initial markdown content for the draft document.',
    template_document: 'Optional template document, identified by DOC reference or exact template title from the Templates library. When using a template, first read it with `get_document` if you need to fill its structure.',
    ...getAiDocumentRelationInputSummary(),
  };
  readonly businessResource = 'knowledge';
  readonly writePreview = {
    entity_type: 'documents',
    fields: ['title', 'summary', 'template_document', 'content_markdown', ...AI_DOCUMENT_RELATION_WRITE_FIELDS],
    reversible: false,
    prompt_hint: 'For draft document creation, use `create_document`. If the user wants to generate from a template, first identify and read the template document with `get_document`, then pass its DOC reference or exact title in `template_document` and the full resulting body in `content_markdown`. You can also attach linked projects, requests, tasks, applications, or assets in the same preview by passing `projects`, `requests`, `tasks`, `applications`, or `assets`.',
  };

  constructor(
    private readonly support: AiDocumentMutationSupportService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: CreateDocumentInput,
  ): Promise<AiPreparedMutationPreview> {
    const requestedRelations = input.relations ?? extractAiDocumentRelationInput(input as unknown as Record<string, unknown>);
    const title = textOrNull(input.title);
    if (!title) {
      throw new BadRequestException('Document title is required.');
    }

    const summary = input.summary == null ? null : textOrNull(input.summary);
    const explicitContentMarkdown = await normalizeMarkdownRichText(input.content_markdown, {
      fieldName: 'content_markdown',
    });
    const template = input.template_document
      ? await this.support.resolveTemplateSnapshot(context, input.template_document)
      : null;
    const contentMarkdown = explicitContentMarkdown ?? template?.content_markdown ?? '';
    const resolvedRelations = await this.support.resolveRelationTargets(context, requestedRelations);
    const relationIds = Object.fromEntries(
      Object.entries(resolvedRelations).map(([entityType, items]) => [
        entityType,
        items.map((item) => item.id),
      ]),
    );

    const defaults = await this.support.resolveCreateDefaults(context);
    const documentTypeId = template?.document_type_id ?? defaults.documentTypeId;
    const documentTypeName = template?.document_type_name ?? defaults.documentTypeName;

    return {
      targetEntityType: 'documents',
      targetEntityId: null,
      mutationInput: {
        title,
        summary,
        content_markdown: contentMarkdown,
        library_id: defaults.libraryId,
        library_name: defaults.libraryName,
        folder_id: null,
        folder_name: null,
        document_type_id: documentTypeId,
        document_type_name: documentTypeName,
        template_document_id: template?.document_id ?? null,
        template_document_ref: template?.target_ref ?? null,
        template_document_title: template?.target_title ?? null,
        ...(Object.keys(relationIds).length > 0
          ? {
              relations: relationIds,
              relation_labels: resolvedRelations,
            }
          : {}),
        status: 'draft',
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
    const draftTitle = textOrNull(current.target_title) ?? textOrNull(mutation.title) ?? 'Untitled document';
    const ref = textOrNull(current.target_ref);
    const subject = ref ?? `"${draftTitle}"`;
    const libraryName = textOrNull(mutation.library_name);
    const templateRef = textOrNull(mutation.template_document_ref);
    const templateTitle = textOrNull(mutation.template_document_title);
    const templateLabel = templateRef
      ? `${templateRef}${templateTitle ? ` - ${templateTitle}` : ''}`
      : templateTitle;

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = libraryName
          ? `Create draft document ${subject} in ${libraryName}.`
          : `Create draft document ${subject}.`;
        break;
      case 'executed':
        summary = ref
          ? `Created ${ref}.`
          : `Created draft document ${subject}.`;
        break;
      case 'rejected':
        summary = `Document creation preview for ${subject} was rejected.`;
        break;
      case 'expired':
        summary = `Document creation preview for ${subject} expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `Document creation preview for ${subject} failed.`;
        break;
    }

    if (language !== 'en') {
      const named = ref ?? quoted(language, draftTitle);
      summary = previewSummaryText(
        language,
        preview.status,
        writeActionText.createDocument(language, named, preview.status === 'pending' ? libraryName : null),
        { errorMessage: preview.error_message },
      );
    }

    const changes: AiMutationPreviewPresentation['changes'] = {
      title: {
        label: 'Title',
        from: null,
        to: textOrNull(mutation.title),
        format: 'text',
      },
      summary: {
        label: 'Summary',
        from: null,
        to: textOrNull(mutation.summary),
        format: 'text',
      },
      library: {
        label: 'Library',
        from: null,
        to: textOrNull(mutation.library_name),
        format: 'text',
      },
      folder: {
        label: 'Folder',
        from: null,
        to: textOrNull(mutation.folder_name),
        format: 'text',
      },
      document_type: {
        label: 'Type',
        from: null,
        to: textOrNull(mutation.document_type_name),
        format: 'text',
      },
      status: {
        label: 'Status',
        from: null,
        to: textOrNull(mutation.status),
        format: 'text',
      },
      content: {
        label: 'Content',
        from: null,
        to: textOrNull(mutation.content_markdown),
        format: 'markdown',
      },
    };

    if (templateLabel) {
      changes.template_document = {
        label: 'Template',
        from: null,
        to: templateLabel,
        format: 'text',
      };
    }

    Object.assign(
      changes,
      this.support.buildRelationPreviewChanges(null, mutation.relation_labels),
    );

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
    const mutation = preview.mutation_input ?? {};
    const created = await this.knowledge.create(
      {
        title: textOrNull(mutation.title),
        summary: mutation.summary ?? null,
        content_markdown: mutation.content_markdown ?? '',
        library_id: mutation.library_id,
        document_type_id: mutation.document_type_id,
        template_document_id: mutation.template_document_id ?? null,
        ...(mutation.relations ? { relations: mutation.relations } : {}),
        status: 'draft',
      },
      context.tenantId,
      context.userId,
      {
        manager: context.manager,
        audit: buildAiMutationAudit(preview),
      },
    );

    preview.target_entity_id = created.id;
    preview.current_values = {
      ...(preview.current_values ?? {}),
      target_ref: created.item_ref ?? (created.item_number ? `DOC-${created.item_number}` : null),
      target_title: created.title ?? textOrNull(mutation.title),
    };
  }
}
