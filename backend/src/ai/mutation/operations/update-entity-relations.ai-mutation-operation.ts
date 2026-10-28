import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { AiMutationPreview } from '../../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../../ai.types';
import {
  AiMutationOperation,
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from '../ai-mutation-operation.types';
import {
  AI_RELATION_BUSINESS_RESOURCES,
  AI_RELATION_ENTITY_TYPES,
  AiRelationMutationSupportService,
  AiUpdateEntityRelationsInput,
  getAiRelationBusinessResource,
} from '../ai-relation-mutation-support.service';
import { AiWriteLanguage } from '../../ai-write-texts';

const UpdateEntityRelationsInputSchema = z.object({
  entity_type: z.enum(AI_RELATION_ENTITY_TYPES)
    .describe('The source entity family whose relations should be updated.'),
  ref: z.string().trim().min(1)
    .describe('Exact source record reference. Use a UUID from a previous tool result, or an exact business reference/name when unique.'),
  relation: z.string().trim().min(1)
    .describe('The supported relation name for the selected entity type, such as companies, contacts, owners, links, projects, assets or budget_lines.'),
  add: z.array(z.unknown()).optional()
    .describe('Relation entries to add. Simple relations accept strings or objects with ref/id; role-bearing relations accept objects with role/owner_type and contact/user/asset refs.'),
  remove: z.array(z.unknown()).optional()
    .describe('Relation entries to remove. Use the same reference shape as add, or an existing link/sub-location/assignment id where applicable.'),
});

@Injectable()
export class UpdateEntityRelationsAiMutationOperation implements AiMutationOperation<AiUpdateEntityRelationsInput> {
  readonly toolName = 'update_entity_relations' as const;
  readonly description = 'Create a preview to add or remove links/relationships for one business object without mutating the linked records. Requires explicit user approval before execution.';
  readonly inputSchema = UpdateEntityRelationsInputSchema;
  readonly inputSummary = {
    entity_type: `One of ${AI_RELATION_ENTITY_TYPES.join(', ')}.`,
    ref: 'Exact source record reference. Prefer UUIDs from prior tool results internally; use exact business references/names when unique.',
    relation: 'Supported relation for the source entity. Query details first if unsure.',
    add: 'Optional array of entries to add. Simple relations accept exact refs; role-bearing relations use objects with ref/contact_ref/user_ref/asset_ref plus role or owner_type.',
    remove: 'Optional array of entries to remove. Use exact refs or existing link/sub-location/assignment ids where relevant.',
  };
  readonly businessResource = 'applications';
  readonly businessResources = AI_RELATION_BUSINESS_RESOURCES;
  readonly writePreview = {
    entity_type: 'entity_relation',
    fields: this.support.getSupportedRelationDescriptions(),
    reversible: true,
    prompt_hint: 'Use `update_entity_relations` for Tier 2 relationship/link writes. Set `entity_type`, `ref`, one `relation`, and add/remove arrays. Do not use this to change fields on linked records. Query the source detail first so relation names and current links are clear. This only creates a preview and still requires explicit approval. Executed relation previews can be undone through `undo_preview` when the previous relation set is still applicable.',
  };

  constructor(private readonly support: AiRelationMutationSupportService) {}

  resolveBusinessResource(params: { input?: AiUpdateEntityRelationsInput; preview?: AiMutationPreview }): string {
    return getAiRelationBusinessResource(
      params.input?.entity_type ?? params.preview?.target_entity_type,
      params.input?.relation ?? params.preview?.mutation_input?.relation,
    );
  }

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiUpdateEntityRelationsInput,
  ): Promise<AiPreparedMutationPreview> {
    return this.support.prepareUpdatePreview(context, input);
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    return this.support.presentPreview(preview, language);
  }

  executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    return this.support.executePreview(context, preview);
  }

  prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    return this.support.prepareReversePreview(context, preview);
  }
}
