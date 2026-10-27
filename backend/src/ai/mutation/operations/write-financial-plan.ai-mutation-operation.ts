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
  AI_FINANCIAL_PLAN_ACTIONS,
  AI_FINANCIAL_PLAN_BUSINESS_RESOURCES,
  AI_FINANCIAL_PLAN_ENTITY_TYPES,
  AiFinancialPlanMutationSupportService,
  AiWriteFinancialPlanInput,
  getAiFinancialPlanBusinessResource,
} from '../ai-financial-plan-mutation-support.service';
import { AiWriteLanguage } from '../../ai-write-texts';

const WriteFinancialPlanInputSchema = z.object({
  entity_type: z.enum(AI_FINANCIAL_PLAN_ENTITY_TYPES)
    .describe('The financial item family whose financial plan should be changed: spend_items or capex_items.'),
  ref: z.string().trim().min(1)
    .describe('Exact spend/CAPEX item reference. Use a UUID from a previous tool result, or an exact item name/description when unique.'),
  action: z.enum(AI_FINANCIAL_PLAN_ACTIONS)
    .describe('Financial subresource action: create_version, update_version, upsert_amounts, or replace_allocations.'),
  version_ref: z.string().trim().min(1).optional()
    .describe('Required except for create_version. Use a version UUID, exact version name, or budget year when unique for the item.'),
  fields: z.record(z.string(), z.unknown()).optional()
    .describe('For create_version/update_version only. Writable fields include version_name, input_grain, as_of_date, budget_year on create, allocation_method, allocation_driver, notes, and reporting_currency.'),
  amounts: z.unknown().optional()
    .describe('For upsert_amounts only. Use {kind:"annual", year, totals:{planned,forecast,committed,actual,expected_landing}}, {kind:"quarterly", year, measure, Q1..Q4}, or {kind:"monthly", year, months:[{period:"YYYY-MM-01", planned, forecast, committed, actual, expected_landing}]}.'),
  allocations: z.array(z.unknown()).optional()
    .describe('For replace_allocations only. Manual company allocations accept company refs; manual department allocations accept department refs plus optional company refs. Automatic methods require an empty array.'),
});

@Injectable()
export class WriteFinancialPlanAiMutationOperation implements AiMutationOperation<AiWriteFinancialPlanInput> {
  readonly toolName = 'write_financial_plan' as const;
  readonly description = 'Create a preview to write spend/CAPEX financial planning subresources: versions, amounts, and allocations. Requires explicit user approval before execution.';
  readonly inputSchema = WriteFinancialPlanInputSchema;
  readonly inputSummary = {
    entity_type: `One of ${AI_FINANCIAL_PLAN_ENTITY_TYPES.join(', ')}.`,
    ref: 'Exact spend/CAPEX item reference. Prefer UUIDs from prior tool results; use exact item names/descriptions only when unique.',
    action: `One of ${AI_FINANCIAL_PLAN_ACTIONS.join(', ')}.`,
    version_ref: 'Required except for create_version. Use a version UUID, exact version name, or budget year when unique.',
    fields: 'Version fields for create_version/update_version. Unknown fields are rejected; budget_year is create-only.',
    amounts: 'Amount payload for upsert_amounts. Annual, quarterly, and monthly payload shapes are supported.',
    allocations: 'Allocation entries for replace_allocations. Use empty array for automatic allocation methods.',
  };
  readonly businessResource = 'budget';
  readonly businessResources = AI_FINANCIAL_PLAN_BUSINESS_RESOURCES;
  readonly writePreview = {
    entity_type: 'financial_plan',
    fields: this.support.getWritableFieldDescriptions(),
    reversible: true,
    prompt_hint: 'Use `write_financial_plan` for Tier 4 spend/CAPEX versions, amounts, and allocations. Query the item detail first, set `entity_type`, `ref` (the BL-n reference of the line, its UUID or its exact title), `action`, and `version_ref` when needed. The amounts of a line being created go in `amounts` of `create_business_record`, not here. This only creates a preview and still requires explicit approval. update_version, upsert_amounts, and replace_allocations can be undone through `undo_preview` when the prior state is still applicable; create_version is auditable but not undoable.',
  };

  constructor(private readonly support: AiFinancialPlanMutationSupportService) {}

  resolveBusinessResource(params: { input?: AiWriteFinancialPlanInput; preview?: AiMutationPreview }): string {
    return getAiFinancialPlanBusinessResource(params.input?.entity_type ?? params.preview?.target_entity_type);
  }

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiWriteFinancialPlanInput,
  ): Promise<AiPreparedMutationPreview> {
    return this.support.prepareCreatePreview(context, input);
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
