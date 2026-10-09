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
  AI_MASTER_DATA_BUSINESS_RESOURCES,
  AI_MASTER_DATA_ENTITY_TYPES,
  AiCreateMasterDataRecordInput,
  AiMasterDataMutationSupportService,
  getAiMasterDataBusinessResource,
} from '../ai-master-data-mutation-support.service';

const CreateMasterDataRecordInputSchema = z.object({
  entity_type: z.enum(AI_MASTER_DATA_ENTITY_TYPES)
    .describe('The master data entity family to create.'),
  fields: z.record(z.string(), z.unknown())
    .describe('Writable field values keyed by field name. Unknown fields are rejected. Relation fields accept exact human names, codes, emails, or UUIDs from previous tool results.'),
});

@Injectable()
export class CreateMasterDataRecordAiMutationOperation implements AiMutationOperation<AiCreateMasterDataRecordInput> {
  readonly toolName = 'create_master_data_record' as const;
  readonly description = 'Create a preview to create one Tier 1 master-data record: company, department, supplier, contact, account, chart of accounts, analytics category, business process, or location. Requires explicit user approval before execution.';
  readonly inputSchema = CreateMasterDataRecordInputSchema;
  readonly inputSummary = {
    entity_type: `One of ${AI_MASTER_DATA_ENTITY_TYPES.join(', ')}.`,
    fields: 'Field values for the new record. Required fields depend on entity_type; unknown fields are rejected. Relation fields accept exact names/codes/emails or UUIDs returned by prior tools.',
  };
  readonly businessResource = 'companies';
  readonly businessResources = AI_MASTER_DATA_BUSINESS_RESOURCES;
  readonly writePreview = {
    entity_type: 'master_data',
    fields: [
      'companies: name, country_iso, city, postal_code, address1, address2, reg_number, vat_number, state, base_currency, notes, coa_id, status, disabled_at, metrics_year, headcount, it_users, turnover',
      'departments: company_id, name, description, status, disabled_at, metrics_year, headcount',
      'suppliers: name, erp_supplier_id, notes, status, disabled_at',
      'contacts: first_name, last_name, job_title, email, phone, mobile, country, notes, active, supplier_id, supplier_role',
      'accounts: coa_id, account_number, account_name, native_name, description, consolidation_account_number, consolidation_account_name, consolidation_account_description, nature, status, disabled_at',
      'chart_of_accounts: code, name, country_iso, scope, is_default',
      'analytics_categories: name, description, applies_to, status, disabled_at',
      'business_processes: name, description, notes, owner_user_id, it_owner_user_id, status, disabled_at',
      'locations: name, hosting_type, operating_company_id, country_iso, city, provider, region, additional_info',
    ],
    reversible: false,
    prompt_hint: 'For Tier 1 master data creation, use `create_master_data_record`. Set `entity_type` first, then put values in `fields`. Required examples: companies need name/country_iso/city; company and department metrics also need metrics_year/headcount when provided; departments need company_id/name; contacts need email; accounts need coa_id/account_number/account_name; chart_of_accounts need code/name and country_iso unless scope is GLOBAL; locations need name/hosting_type (location_reference is system-generated). Use exact human names/codes/emails for relations when possible. This only creates a preview and still requires explicit approval.',
  };

  constructor(private readonly support: AiMasterDataMutationSupportService) {}

  resolveBusinessResource(params: { input?: AiCreateMasterDataRecordInput; preview?: AiMutationPreview }): string {
    return getAiMasterDataBusinessResource(params.input?.entity_type ?? params.preview?.target_entity_type);
  }

  prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiCreateMasterDataRecordInput,
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
