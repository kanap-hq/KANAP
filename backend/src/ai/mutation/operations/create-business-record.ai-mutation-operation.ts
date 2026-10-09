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
  AiCreateBusinessRecordInput,
  getAiBusinessRecordBusinessResource,
} from '../ai-business-record-mutation-support.service';

const CreateBusinessRecordInputSchema = z.object({
  entity_type: z.enum(AI_BUSINESS_RECORD_ENTITY_TYPES)
    .describe('The business entity family to create.'),
  fields: z.record(z.string(), z.unknown())
    .describe('Writable field values keyed by field name. Unknown fields are rejected. Relation fields accept exact names, references, emails, or UUIDs from previous tool results. Spend and CAPEX items set an analytics dimension with `analytics:<dimension code>` and the value name.'),
});

@Injectable()
export class CreateBusinessRecordAiMutationOperation implements AiMutationOperation<AiCreateBusinessRecordInput> {
  readonly toolName = 'create_business_record' as const;
  readonly description = 'Create a preview to create one workflow or financial business record: application, asset, contract, project, request, interface, connection, spend item, or CAPEX item. Requires explicit user approval before execution.';
  readonly inputSchema = CreateBusinessRecordInputSchema;
  readonly inputSummary = {
    entity_type: `One of ${AI_BUSINESS_RECORD_ENTITY_TYPES.join(', ')}.`,
    fields: 'Writable fields for the chosen entity. Relation fields accept exact names/references/emails or UUIDs returned by prior tools. Spend/CAPEX analytics dimensions: `analytics:<dimension code>` with the value name.',
  };
  readonly businessResource = 'applications';
  readonly businessResources = AI_BUSINESS_RECORD_BUSINESS_RESOURCES;
  readonly writePreview = {
    entity_type: 'business_record',
    fields: this.support.getWritableFieldDescriptions(),
    reversible: false,
    prompt_hint: 'Use `create_business_record` for Tier 3 workflow records and Tier 4 spend/CAPEX records. Set `entity_type`, provide required fields plus optional scalar fields, and resolve ambiguous human references by querying first. On spend and CAPEX items, set a value on an analytics dimension with `analytics:<dimension code>` (the default dimension is `analytics_category`) and the value name; a value missing from the dimension must be created first or asked for. This only creates a preview and still requires explicit approval. Creates are not undoable because deletion/cleanup can have side effects.',
  };

  constructor(private readonly support: AiBusinessRecordMutationSupportService) {}

  resolveBusinessResource(params: { input?: AiCreateBusinessRecordInput; preview?: AiMutationPreview }): string {
    return getAiBusinessRecordBusinessResource(params.input?.entity_type ?? params.preview?.target_entity_type);
  }

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiCreateBusinessRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    return this.support.prepareCreatePreview(context, input);
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    return this.support.presentPreview(preview);
  }

  executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    return this.support.executePreview(context, preview);
  }
}
