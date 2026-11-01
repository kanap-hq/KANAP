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
import { AiFinancialPlanMutationSupportService, storedPreviewAmounts } from '../ai-financial-plan-mutation-support.service';
import { AiWriteLanguage } from '../../ai-write-texts';

/** The families whose creation may carry the amounts of the new line. */
const LINE_ENTITY_TYPES = new Set<string>(['budget_lines']);

const CreateBusinessRecordInputSchema = z.object({
  entity_type: z.enum(AI_BUSINESS_RECORD_ENTITY_TYPES)
    .describe('The business entity family to create.'),
  fields: z.record(z.string(), z.unknown())
    .describe('Writable field values keyed by field name. Unknown fields are rejected. Relation fields accept exact names, references, emails, or UUIDs from previous tool results. An asset requires `name`, `kind`, `provider`, `environment` and `location_id` (its site: a location name or reference). A budget line requires `nature` (opex or capex) and `product_name`, and sets an analytics dimension with `analytics:<dimension code>` and the value name; `contract_id` is for an OPEX line only. An incident requires `title` and `severity`; `category` takes an incident category code or exact label from IT settings; `status` is `open` or `in_progress` (create it open, then move it forward in a second preview so the step stays visible); date-times (`started_at`, `detected_at`, `resolved_at`, `closed_at`, `authority_notified_at`) are ISO 8601 with a time zone, converted into the person\'s `time_zone`; `detected_at` defaults to now; `reporter` and `owner` take a user name, email or uuid, the reporter defaulting to the person. A technology takes `name`, `family` and `lifecycle` (catalog codes or exact labels), `hosting_type` (code or label), `editor`, `description`, `notes`, `support_notes`, `replaced_by` (a TEC-n or exact technology name), `cyber_criticality`, `recovery_wave`, `rto_minutes`, `rpo_minutes` and `admin_zone` (codes or exact labels); `from_catalog: false` asks for a free entry. The CPE and CVE matching fields, `catalog_key`, `mode` and `vulnerability_alerts` are not written here.'),
  amounts: z.unknown().optional()
    .describe('Budget lines only: the amounts of the new line for one year, in the shape of write_financial_plan upsert_amounts, for example {kind:"annual", year:2026, totals:{planned:12000}}. The line, its budget version for that year and the amounts are created on one approval.'),
});

@Injectable()
export class CreateBusinessRecordAiMutationOperation implements AiMutationOperation<AiCreateBusinessRecordInput> {
  readonly toolName = 'create_business_record' as const;
  readonly description = 'Create a preview to create one workflow or financial business record: application, asset, contract, project, request, interface, connection, incident, technology, or budget line (OPEX or CAPEX, chosen by `nature`). Requires explicit user approval before execution.';
  readonly inputSchema = CreateBusinessRecordInputSchema;
  readonly inputSummary = {
    entity_type: `One of ${AI_BUSINESS_RECORD_ENTITY_TYPES.join(', ')}.`,
    fields: 'Writable fields for the chosen entity. Relation fields accept exact names/references/emails or UUIDs returned by prior tools. A budget line needs `nature` (opex or capex) and `product_name`; its analytics dimensions use `analytics:<dimension code>` with the value name. An incident needs `title` and `severity`, is created `open` or `in_progress`, takes an exact incident category code/label, and its date-times are ISO with a time zone.',
  };
  readonly businessResource = 'applications';
  readonly businessResources = AI_BUSINESS_RECORD_BUSINESS_RESOURCES;
  readonly writePreview = {
    entity_type: 'business_record',
    fields: this.support.getWritableFieldDescriptions(),
    reversible: false,
    prompt_hint: 'Use `create_business_record` for Tier 3 workflow records, incidents and Tier 4 budget lines. Set `entity_type`, provide required fields plus optional scalar fields (an asset always needs its site, `location_id`), and resolve ambiguous human references by querying first. A budget line is one family: set `nature` (opex or capex) and `product_name`, and set a value on an analytics dimension with `analytics:<dimension code>` (the default dimension is `analytics_category`) and the value name; a value missing from the dimension must be created first or asked for. `contract_id` is refused on a CAPEX line. An incident requires `title` and `severity`, is created `open` or `in_progress` (never resolved, closed or cancelled: create it open, then move it forward in a second preview), takes `category` as an incident category code or exact label from IT settings, and its date-times are ISO 8601 with a time zone, converted into the person\'s `time_zone`; `detected_at` defaults to now. `confidential: true` is allowed; `false` on a restricted incident is refused. A closure freezes the record: only an administrator reopens it. The journal and the links have their own tools (`add_incident_note`, `update_incident_links`); reopening, cancelling and lifting the confidentiality need a register administrator (`change_incident_state`, `set_incident_confidentiality`). When the user gives the new line an amount, pass it in `amounts` ({kind:"annual", year, totals:{planned}}): one preview creates the line, its budget version and the amounts; never a plan with separate version and amount steps. A technology is adopted from the KANAP catalog when it knows it, typed free otherwise or on request (`from_catalog: false`); its versions, links, people, web links and alert setting have their own tools (`update_technology_versions`, `update_technology_links`, `update_technology_people`, `update_technology_web_links`, `set_technology_vulnerability_alerts`). This only creates a preview and still requires explicit approval. Creates are not undoable because deletion/cleanup can have side effects.',
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
      throw new BadRequestException('amounts is only accepted when creating a budget line.');
    }
    const prepared = await this.support.prepareCreatePreview(context, input);
    if (input.amounts == null) return prepared;
    const fields = prepared.mutationInput.fields as Record<string, unknown> | undefined;
    const lineAmounts = await this.financialPlan.prepareNewLineAmounts(context, input.amounts, fields?.currency);
    return {
      ...prepared,
      mutationInput: {
        ...prepared.mutationInput,
        amounts: lineAmounts.amounts,
        amounts_display: lineAmounts.display,
        amounts_preview: lineAmounts.preview,
      },
    };
  }

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const presentation = this.support.presentPreview(preview, language);
    const display = preview.mutation_input?.amounts_display;
    if (preview.mutation_input?.amounts == null || typeof display !== 'string') return presentation;
    // The card shows the line with the amount it is created with.
    const amounts = storedPreviewAmounts(preview.mutation_input?.amounts_preview);
    return {
      ...presentation,
      changes: {
        ...presentation.changes,
        amounts: { label: 'Amounts', from: null, to: display, format: 'text', ...(amounts ? { amounts: { from: null, to: amounts } } : {}) },
      },
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    await this.support.executePreview(context, preview);
    const amounts = preview.mutation_input?.amounts;
    if (amounts == null) return;
    if (!preview.target_entity_id) throw new BadRequestException('The created line is missing.');
    await this.financialPlan.writeNewLineAmounts(context, preview, preview.target_entity_id, amounts);
  }
}
