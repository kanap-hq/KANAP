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
  AI_BUSINESS_RECORD_BUSINESS_RESOURCES,
  AI_BUSINESS_RECORD_ENTITY_TYPES,
  AiBusinessRecordMutationSupportService,
  AiUpdateBusinessRecordInput,
  getAiBusinessRecordBusinessResource,
} from '../ai-business-record-mutation-support.service';

const UpdateBusinessRecordInputSchema = z.object({
  entity_type: z.enum(AI_BUSINESS_RECORD_ENTITY_TYPES)
    .describe('The business entity family to update.'),
  ref: z.string().trim().min(1)
    .describe('Exact record reference. Use a UUID from a previous tool result, or an exact business reference/name when unique.'),
  fields: z.record(z.string(), z.unknown())
    .describe('Only fields to change. Unknown fields are rejected. Relation fields accept exact names, references, emails, or UUIDs from previous tool results. Spend and CAPEX items set an analytics dimension with `analytics:<dimension code>` and the value name; null clears a dimension the line may change.'),
});

@Injectable()
export class UpdateBusinessRecordAiMutationOperation implements AiMutationOperation<AiUpdateBusinessRecordInput> {
  readonly toolName = 'update_business_record' as const;
  readonly description = 'Create a preview to update selected scalar/status/planning fields on one workflow or financial business record: application, asset, contract, project, request, interface, connection, spend item, or CAPEX item. Requires explicit user approval before execution.';
  readonly inputSchema = UpdateBusinessRecordInputSchema;
  readonly inputSummary = {
    entity_type: `One of ${AI_BUSINESS_RECORD_ENTITY_TYPES.join(', ')}.`,
    ref: 'Exact record reference. Prefer UUIDs from prior tool results internally; use exact business references/names when unique.',
    fields: 'Only fields to change. Unknown fields are rejected; no-op updates are rejected. Relation fields accept exact names/references/emails or UUIDs returned by prior tools. Spend/CAPEX analytics dimensions: `analytics:<dimension code>` with the value name; null clears a dimension the line may change.',
  };
  readonly businessResource = 'applications';
  readonly businessResources = AI_BUSINESS_RECORD_BUSINESS_RESOURCES;
  readonly writePreview = {
    entity_type: 'business_record',
    fields: this.support.getWritableFieldDescriptions(),
    reversible: true,
    prompt_hint: 'Use `update_business_record` for Tier 3 workflow/status fields and Tier 4 spend/CAPEX scalar/planning fields. Set `entity_type`, identify one record with `ref`, and put only changed fields in `fields`. Query first when references are ambiguous. On spend and CAPEX items, set or change a value on an analytics dimension with `analytics:<dimension code>` (the default dimension is `analytics_category`) and the value name, or null to clear a dimension the line may change (the value of a `required` dimension can be changed, not cleared); a value missing from the dimension must be created first or asked for. This only creates a preview and still requires explicit approval. Executed update previews can be undone through `undo_preview` when the previous values are still applicable.',
  };

  constructor(private readonly support: AiBusinessRecordMutationSupportService) {}

  resolveBusinessResource(params: { input?: AiUpdateBusinessRecordInput; preview?: AiMutationPreview }): string {
    return getAiBusinessRecordBusinessResource(params.input?.entity_type ?? params.preview?.target_entity_type);
  }

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiUpdateBusinessRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    return this.support.prepareUpdatePreview(context, input);
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    return this.support.presentPreview(preview);
  }

  executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    return this.support.executePreview(context, preview);
  }

  prepareReversePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    return this.support.prepareReverseUpdatePreview(context, preview);
  }
}
