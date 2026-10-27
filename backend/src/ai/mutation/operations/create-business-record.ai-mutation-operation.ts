import { BadRequestException, Injectable } from '@nestjs/common';
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
import { AiFinancialPlanMutationSupportService } from '../ai-financial-plan-mutation-support.service';
import { AiWriteLanguage } from '../../ai-write-texts';

/** The families whose creation may carry the amounts of the new line. */
const LINE_ENTITY_TYPES = new Set<string>(['spend_items', 'capex_items']);

const CreateBusinessRecordInputSchema = z.object({
  entity_type: z.enum(AI_BUSINESS_RECORD_ENTITY_TYPES)
    .describe('The business entity family to create.'),
  fields: z.record(z.string(), z.unknown())
    .describe('Writable field values keyed by field name. Unknown fields are rejected. Relation fields accept exact names, references, emails, or UUIDs from previous tool results. Spend and CAPEX items set an analytics dimension with `analytics:<dimension code>` and the value name.'),
  amounts: z.unknown().optional()
    .describe('Spend and CAPEX items only: the amounts of the new line for one year, in the shape of write_financial_plan upsert_amounts, for example {kind:"annual", year:2026, totals:{planned:12000}}. The line, its budget version for that year and the amounts are created on one approval.'),
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
    prompt_hint: 'Use `create_business_record` for Tier 3 workflow records and Tier 4 spend/CAPEX records. Set `entity_type`, provide required fields plus optional scalar fields, and resolve ambiguous human references by querying first. On spend and CAPEX items, set a value on an analytics dimension with `analytics:<dimension code>` (the default dimension is `analytics_category`) and the value name; a value missing from the dimension must be created first or asked for. When the user gives the new line an amount, pass it in `amounts` ({kind:"annual", year, totals:{planned}}): one preview creates the line, its budget version and the amounts; never a plan with separate version and amount steps. This only creates a preview and still requires explicit approval. Creates are not undoable because deletion/cleanup can have side effects.',
  };

  constructor(
    private readonly support: AiBusinessRecordMutationSupportService,
    private readonly financialPlan: AiFinancialPlanMutationSupportService,
  ) {}

  resolveBusinessResource(params: { input?: AiCreateBusinessRecordInput; preview?: AiMutationPreview }): string {
    return getAiBusinessRecordBusinessResource(params.input?.entity_type ?? params.preview?.target_entity_type);
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiCreateBusinessRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    if (input.amounts != null && !LINE_ENTITY_TYPES.has(String(input.entity_type))) {
      throw new BadRequestException('amounts is only accepted when creating a spend item or a CAPEX item.');
    }
    const prepared = await this.support.prepareCreatePreview(context, input);
    if (input.amounts == null) return prepared;
    const lineAmounts = await this.financialPlan.prepareNewLineAmounts(context, input.entity_type, input.amounts);
    return {
      ...prepared,
      mutationInput: { ...prepared.mutationInput, amounts: lineAmounts.amounts, amounts_display: lineAmounts.display },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const presentation = this.support.presentPreview(preview, language);
    const display = preview.mutation_input?.amounts_display;
    if (preview.mutation_input?.amounts == null || typeof display !== 'string') return presentation;
    // The card shows the line with the amount it is created with.
    return {
      ...presentation,
      changes: { ...presentation.changes, amounts: { label: 'Amounts', from: null, to: display, format: 'text' } },
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    await this.support.executePreview(context, preview);
    const amounts = preview.mutation_input?.amounts;
    if (amounts == null) return;
    if (!preview.target_entity_id) throw new BadRequestException('The created line is missing.');
    await this.financialPlan.writeNewLineAmounts(context, preview, preview.target_entity_type, preview.target_entity_id, amounts);
  }
}
