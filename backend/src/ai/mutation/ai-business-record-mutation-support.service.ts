import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { ApplicationsService } from '../../applications/services/applications.service';
import { AssetsService } from '../../assets/services/assets.service';
import { AuditService } from '../../audit/audit.service';
import {
  applicationParticipantCondition,
  resolveBusinessContributorScopeForUser,
} from '../../auth/business-contributor-scope';
import { CapexItemsService } from '../../capex/capex-items.service';
import { ConnectionsService } from '../../connections/services/connections.service';
import { ContractsService } from '../../contracts/contracts.service';
import { InterfacesService } from '../../interfaces/services/interfaces.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { ClassificationCatalog, resolveClassificationOption } from '../../it-ops-settings/classification-catalog';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioProjectsService } from '../../portfolio/services';
import { SpendItemsService } from '../../spend/spend-items.service';
import { lockBudgetLine } from '../../spend/budget-locks';
import { parseItemRef } from '../../common/resolve-item-id';
import {
  DISABLED_VALUE_MESSAGE,
  dimensionPhrase,
  disabledDimensionMessage,
  isValueActive,
  itemAnalyticsFields,
  ItemAnalyticsScope,
  ItemAnalyticsValue,
  loadItemAnalyticsValues,
  notApplicableDimensionMessage,
  notApplicableValueMessage,
  valueAppliesTo,
} from '../../spend/item-analytics.util';
import {
  ANALYTICS_CSV_PREFIX,
  AnalyticsAxisInfo,
  analyticsAxisLabel,
  axisAppliesTo,
  loadAnalyticsAxes,
} from '../../analytics/analytics-axes.util';
import { isActiveAt, parseEndOfValidityInput } from '../../common/status';
import { sameFieldValue } from '../../common/edit-conflicts';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationPreviewChangeDto } from '../ai.types';
import { buildAiMutationAudit } from './ai-mutation-audit.util';
import {
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from './ai-mutation-operation.types';
import { AiTaskMutationSupportService } from './ai-task-mutation-support.service';

export const AI_BUSINESS_RECORD_ENTITY_TYPES = [
  'applications',
  'assets',
  'contracts',
  'projects',
  'requests',
  'interfaces',
  'connections',
  'spend_items',
  'capex_items',
] as const;

export type AiBusinessRecordEntityType = typeof AI_BUSINESS_RECORD_ENTITY_TYPES[number];

export type AiCreateBusinessRecordInput = {
  entity_type: AiBusinessRecordEntityType;
  fields: Record<string, unknown>;
};

export type AiUpdateBusinessRecordInput = AiCreateBusinessRecordInput & {
  ref: string;
};

type RelationTarget =
  | AiBusinessRecordEntityType
  | 'accounts'
  | 'analytics_categories'
  | 'business_processes'
  | 'companies'
  | 'cost_centers'
  | 'departments'
  | 'locations'
  | 'location_sub_items'
  | 'portfolio_categories'
  | 'portfolio_sources'
  | 'portfolio_streams'
  | 'suppliers'
  | 'users';

type FieldKind =
  | 'array_text'
  | 'boolean'
  | 'date'
  | 'enum'
  | 'integer'
  | 'json'
  | 'application_category'
  | 'application_classification'
  | 'non_negative_decimal'
  | 'percent'
  | 'relation'
  | 'text'
  | 'upper3';

type FieldConfig = {
  label: string;
  kind: FieldKind;
  aliases?: readonly string[];
  nullable?: boolean;
  requiredOnCreate?: boolean;
  enumValues?: readonly string[];
  relationTarget?: RelationTarget;
  classificationAxis?: 'business' | 'cyber' | 'confidentiality' | 'recovery';
  minimum?: number;
};

type EntityConfig = {
  labelSingular: string;
  labelPlural: string;
  businessResource: string;
  tableName: string;
  fields: Record<string, FieldConfig>;
};

type ResolvedReference = {
  id: string;
  ref: string | null;
  label: string;
  row: Record<string, unknown>;
};

type NormalizedFields = {
  fields: Record<string, unknown>;
  displayValues: Record<string, string | null>;
  fieldLabels: Record<string, string>;
};

const ENVIRONMENTS = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'] as const;
const STATUS_STATES = ['enabled', 'disabled'] as const;
const APPLICATION_LIFECYCLES = ['active', 'planned', 'in_development', 'retired'] as const;
// Operational interface/connection criticality uses tenant business codes at the
// service boundary; this legacy list remains only for their existing AI schema
// until those mutation configs become catalog-aware.
const CRITICALITIES = ['business_critical', 'high', 'medium', 'low'] as const;
const USERS_MODES = ['manual', 'it_users', 'headcount'] as const;
const PROJECT_STATUSES = ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold', 'done', 'cancelled'] as const;
const PROJECT_ORIGINS = ['standard', 'fast_track', 'legacy'] as const;
const REQUEST_STATUSES = ['pending_review', 'candidate', 'approved', 'on_hold', 'rejected', 'converted'] as const;
const SCHEDULING_MODES = ['independent', 'collaborative'] as const;
const BILLING_FREQUENCIES = ['monthly', 'quarterly', 'annual', 'other'] as const;
const PPE_TYPES = ['hardware', 'software'] as const;
const INVESTMENT_TYPES = ['replacement', 'capacity', 'productivity', 'security', 'conformity', 'business_growth', 'other'] as const;
const PRIORITIES = ['mandatory', 'high', 'medium', 'low'] as const;
const RUN_BUILD = ['run', 'build'] as const;
const INTERFACE_ROUTES = ['direct', 'via_middleware'] as const;
const CONNECTION_TOPOLOGIES = ['server_to_server', 'multi_server'] as const;
const RISK_MODES = ['manual', 'derived'] as const;

const COMMON_PORTFOLIO_FIELDS = {
  source_id: { label: 'Source', kind: 'relation', nullable: true, relationTarget: 'portfolio_sources' as RelationTarget },
  category_id: { label: 'Category', kind: 'relation', nullable: true, relationTarget: 'portfolio_categories' as RelationTarget },
  stream_id: { label: 'Stream', kind: 'relation', nullable: true, relationTarget: 'portfolio_streams' as RelationTarget },
  company_id: { label: 'Company', kind: 'relation', nullable: true, relationTarget: 'companies' as RelationTarget },
  department_id: { label: 'Department', kind: 'relation', nullable: true, relationTarget: 'departments' as RelationTarget },
  priority_score: { label: 'Priority Score', kind: 'non_negative_decimal', nullable: true },
  priority_override: { label: 'Priority Override', kind: 'boolean' },
  override_justification: { label: 'Override Justification', kind: 'text', nullable: true },
  override_value: { label: 'Override Value', kind: 'non_negative_decimal', nullable: true },
  criteria_values: { label: 'Criteria Values', kind: 'json' },
  business_sponsor_id: { label: 'Business Sponsor', kind: 'relation', nullable: true, relationTarget: 'users' as RelationTarget },
  business_lead_id: { label: 'Business Lead', kind: 'relation', nullable: true, relationTarget: 'users' as RelationTarget },
  it_sponsor_id: { label: 'IT Sponsor', kind: 'relation', nullable: true, relationTarget: 'users' as RelationTarget },
  it_lead_id: { label: 'IT Lead', kind: 'relation', nullable: true, relationTarget: 'users' as RelationTarget },
} satisfies Record<string, FieldConfig>;

const ENTITY_CONFIG: Record<AiBusinessRecordEntityType, EntityConfig> = {
  applications: {
    labelSingular: 'application',
    labelPlural: 'applications',
    businessResource: 'applications',
    tableName: 'applications',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      supplier_id: { label: 'Supplier', kind: 'relation', nullable: true, relationTarget: 'suppliers', aliases: ['supplier'] },
      category: { label: 'Category', kind: 'application_category' },
      description: { label: 'Description', kind: 'text', nullable: true },
      editor: { label: 'Editor', kind: 'text', nullable: true },
      retired_date: { label: 'Retired Date', kind: 'date', nullable: true },
      version: { label: 'Version', kind: 'text', nullable: true },
      end_of_support_date: { label: 'End of Support Date', kind: 'date', nullable: true },
      go_live_date: { label: 'Go-Live Date', kind: 'date', nullable: true },
      predecessor_id: { label: 'Predecessor', kind: 'relation', nullable: true, relationTarget: 'applications', aliases: ['predecessor'] },
      lifecycle: { label: 'Lifecycle', kind: 'enum', enumValues: APPLICATION_LIFECYCLES },
      environment: { label: 'Environment', kind: 'enum', enumValues: ENVIRONMENTS },
      criticality: { label: 'Business criticality', kind: 'application_classification', classificationAxis: 'business', nullable: true, aliases: ['business_criticality'] },
      cyber_criticality: { label: 'Cyber Criticality', kind: 'application_classification', classificationAxis: 'cyber', nullable: true, aliases: ['cyber'] },
      data_class: { label: 'Data Confidentiality', kind: 'application_classification', classificationAxis: 'confidentiality', nullable: true, aliases: ['confidentiality'] },
      recovery_wave: { label: 'Recovery Wave', kind: 'application_classification', classificationAxis: 'recovery', nullable: true, aliases: ['wave'] },
      rto_minutes: { label: 'RTO (minutes)', kind: 'integer', nullable: true, minimum: 1, aliases: ['rto'] },
      rpo_minutes: { label: 'RPO (minutes)', kind: 'integer', nullable: true, minimum: 0, aliases: ['rpo'] },
      classification_justification: { label: 'Classification Justification', kind: 'text', nullable: true, aliases: ['justification'] },
      hosting_model: { label: 'Hosting Model', kind: 'text', nullable: true },
      external_facing: { label: 'External Facing', kind: 'boolean' },
      is_suite: { label: 'Suite', kind: 'boolean' },
      last_dr_test: { label: 'Last DR Test', kind: 'date', nullable: true },
      sso_enabled: { label: 'SSO Enabled', kind: 'boolean' },
      mfa_supported: { label: 'MFA Supported', kind: 'boolean' },
      etl_enabled: { label: 'ETL Enabled', kind: 'boolean' },
      access_methods: { label: 'Access Methods', kind: 'array_text' },
      contains_pii: { label: 'Contains PII', kind: 'boolean' },
      licensing: { label: 'Licensing', kind: 'text', nullable: true },
      notes: { label: 'Notes', kind: 'text', nullable: true },
      support_notes: { label: 'Support Notes', kind: 'text', nullable: true },
      users_mode: { label: 'Users Mode', kind: 'enum', enumValues: USERS_MODES, nullable: true },
      users_year: { label: 'Users Year', kind: 'integer', nullable: true },
      users_override: { label: 'Users Override', kind: 'integer', nullable: true },
      status: { label: 'Status', kind: 'enum', enumValues: STATUS_STATES },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
    },
  },
  assets: {
    labelSingular: 'asset',
    labelPlural: 'assets',
    businessResource: 'infrastructure',
    tableName: 'assets',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      asset_reference: { label: 'Asset Reference', kind: 'text', nullable: true, aliases: ['reference'] },
      kind: { label: 'Kind', kind: 'text', requiredOnCreate: true },
      provider: { label: 'Provider', kind: 'text', requiredOnCreate: true },
      environment: { label: 'Environment', kind: 'enum', enumValues: ENVIRONMENTS, requiredOnCreate: true },
      region: { label: 'Region', kind: 'text', nullable: true },
      zone: { label: 'Zone', kind: 'text', nullable: true },
      hostname: { label: 'Hostname', kind: 'text', nullable: true },
      domain: { label: 'Domain', kind: 'text', nullable: true },
      aliases: { label: 'Aliases', kind: 'array_text', nullable: true },
      ip_addresses: { label: 'IP Addresses', kind: 'json', nullable: true },
      cluster: { label: 'Cluster', kind: 'text', nullable: true },
      is_cluster: { label: 'Cluster Asset', kind: 'boolean' },
      operating_system: { label: 'Operating System', kind: 'text', nullable: true },
      location_id: { label: 'Location', kind: 'relation', nullable: true, relationTarget: 'locations' as RelationTarget, aliases: ['location'] },
      sub_location_id: { label: 'Sub-location', kind: 'relation', nullable: true, relationTarget: 'location_sub_items' as RelationTarget, aliases: ['sub_location'] },
      status: { label: 'Status', kind: 'text' },
      go_live_date: { label: 'Go-Live Date', kind: 'date', nullable: true },
      end_of_life_date: { label: 'End of Life Date', kind: 'date', nullable: true },
      notes: { label: 'Notes', kind: 'text', nullable: true },
    },
  },
  contracts: {
    labelSingular: 'contract',
    labelPlural: 'contracts',
    businessResource: 'contracts',
    tableName: 'contracts',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      company_id: { label: 'Company', kind: 'relation', requiredOnCreate: true, relationTarget: 'companies', aliases: ['company'] },
      supplier_id: { label: 'Supplier', kind: 'relation', requiredOnCreate: true, relationTarget: 'suppliers', aliases: ['supplier'] },
      owner_user_id: { label: 'Owner', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['owner'] },
      start_date: { label: 'Start Date', kind: 'date', requiredOnCreate: true },
      duration_months: { label: 'Duration Months', kind: 'integer' },
      auto_renewal: { label: 'Auto Renewal', kind: 'boolean' },
      notice_period_months: { label: 'Notice Period Months', kind: 'integer' },
      yearly_amount_at_signature: { label: 'Yearly Amount at Signature', kind: 'non_negative_decimal' },
      currency: { label: 'Currency', kind: 'upper3' },
      billing_frequency: { label: 'Billing Frequency', kind: 'enum', enumValues: BILLING_FREQUENCIES },
      status: { label: 'Status', kind: 'enum', enumValues: STATUS_STATES },
      disabled_at: { label: 'Disabled At', kind: 'date', nullable: true },
      notes: { label: 'Notes', kind: 'text', nullable: true },
    },
  },
  projects: {
    labelSingular: 'project',
    labelPlural: 'projects',
    businessResource: 'portfolio_projects',
    tableName: 'portfolio_projects',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      purpose: { label: 'Purpose', kind: 'text', nullable: true },
      origin: { label: 'Origin', kind: 'enum', enumValues: PROJECT_ORIGINS },
      status: { label: 'Status', kind: 'enum', enumValues: PROJECT_STATUSES },
      scheduling_mode: { label: 'Scheduling Mode', kind: 'enum', enumValues: SCHEDULING_MODES },
      execution_progress: { label: 'Execution Progress', kind: 'percent' },
      planned_start: { label: 'Planned Start', kind: 'date', nullable: true },
      planned_end: { label: 'Planned End', kind: 'date', nullable: true },
      estimated_effort_it: { label: 'Estimated IT Effort', kind: 'non_negative_decimal', nullable: true },
      estimated_effort_business: { label: 'Estimated Business Effort', kind: 'non_negative_decimal', nullable: true },
      actual_effort_it: { label: 'Actual IT Effort', kind: 'non_negative_decimal', nullable: true },
      actual_effort_business: { label: 'Actual Business Effort', kind: 'non_negative_decimal', nullable: true },
      ...COMMON_PORTFOLIO_FIELDS,
    },
  },
  requests: {
    labelSingular: 'request',
    labelPlural: 'requests',
    businessResource: 'portfolio_requests',
    tableName: 'portfolio_requests',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      purpose: { label: 'Purpose', kind: 'text', nullable: true },
      risks: { label: 'Risks and Mitigations', kind: 'text', nullable: true },
      requestor_id: { label: 'Requestor', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['requestor'] },
      target_delivery_date: { label: 'Target Delivery Date', kind: 'date', nullable: true },
      status: { label: 'Status', kind: 'enum', enumValues: REQUEST_STATUSES },
      current_situation: { label: 'Current Situation', kind: 'text', nullable: true },
      expected_benefits: { label: 'Expected Benefits', kind: 'text', nullable: true },
      feasibility_review: { label: 'Feasibility Review', kind: 'json' },
      ...COMMON_PORTFOLIO_FIELDS,
    },
  },
  interfaces: {
    labelSingular: 'interface',
    labelPlural: 'interfaces',
    businessResource: 'applications',
    tableName: 'interfaces',
    fields: {
      interface_reference: { label: 'Interface reference', kind: 'text', aliases: ['reference'] },
      interface_id: { label: 'Interface code', kind: 'text', nullable: true, aliases: ['legacy_code', 'external_code'] },
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      business_process_id: { label: 'Business Process', kind: 'relation', nullable: true, relationTarget: 'business_processes', aliases: ['business_process'] },
      business_purpose: { label: 'Business Purpose', kind: 'text', requiredOnCreate: true },
      source_application_id: { label: 'Source Application', kind: 'relation', requiredOnCreate: true, relationTarget: 'applications', aliases: ['source_application'] },
      target_application_id: { label: 'Target Application', kind: 'relation', requiredOnCreate: true, relationTarget: 'applications', aliases: ['target_application'] },
      data_category: { label: 'Data Category', kind: 'text', requiredOnCreate: true },
      integration_route_type: { label: 'Integration Route Type', kind: 'enum', enumValues: INTERFACE_ROUTES },
      lifecycle: { label: 'Lifecycle', kind: 'text' },
      overview_notes: { label: 'Overview Notes', kind: 'text', nullable: true },
      criticality: { label: 'Operational criticality', kind: 'application_classification', classificationAxis: 'business', nullable: true },
      impact_of_failure: { label: 'Impact of Failure', kind: 'text', nullable: true },
      business_objects: { label: 'Business Objects', kind: 'json', nullable: true },
      main_use_cases: { label: 'Main Use Cases', kind: 'text', nullable: true },
      functional_rules: { label: 'Functional Rules', kind: 'text', nullable: true },
      core_transformations_summary: { label: 'Core Transformations Summary', kind: 'text', nullable: true },
      error_handling_summary: { label: 'Error Handling Summary', kind: 'text', nullable: true },
      data_class: { label: 'Data confidentiality', kind: 'application_classification', classificationAxis: 'confidentiality', nullable: true },
      contains_pii: { label: 'Contains PII', kind: 'boolean' },
      pii_description: { label: 'PII Description', kind: 'text', nullable: true },
      typical_data: { label: 'Typical Data', kind: 'text', nullable: true },
      audit_logging: { label: 'Audit Logging', kind: 'text', nullable: true },
      security_controls_summary: { label: 'Security Controls Summary', kind: 'text', nullable: true },
      middleware_application_ids: { label: 'Middleware Applications', kind: 'relation', nullable: true, relationTarget: 'applications', aliases: ['middleware_applications'] },
      specification_markdown: { label: 'Specification', kind: 'text', nullable: true },
    },
  },
  connections: {
    labelSingular: 'connection',
    labelPlural: 'connections',
    businessResource: 'infrastructure',
    tableName: 'connections',
    fields: {
      connection_reference: { label: 'Connection reference', kind: 'text', requiredOnCreate: false, aliases: ['reference', 'connection_id'] },
      name: { label: 'Name', kind: 'text', requiredOnCreate: true },
      description: { label: 'Description', kind: 'text', nullable: true, aliases: ['purpose', 'notes'] },
      topology: { label: 'Topology', kind: 'enum', enumValues: CONNECTION_TOPOLOGIES },
      source_asset_id: { label: 'Source Asset', kind: 'relation', nullable: true, relationTarget: 'assets', aliases: ['source_asset', 'source_server_id', 'source_server'] },
      source_entity_code: { label: 'Source Entity Code', kind: 'text', nullable: true },
      destination_asset_id: { label: 'Destination Asset', kind: 'relation', nullable: true, relationTarget: 'assets', aliases: ['destination_asset', 'destination_server_id', 'destination_server'] },
      destination_entity_code: { label: 'Destination Entity Code', kind: 'text', nullable: true },
      servers: { label: 'Servers', kind: 'relation', nullable: true, relationTarget: 'assets' },
      protocol_codes: { label: 'Protocol Codes', kind: 'array_text', requiredOnCreate: true, aliases: ['protocols'] },
      lifecycle: { label: 'Lifecycle', kind: 'text' },
      criticality: { label: 'Operational criticality', kind: 'application_classification', classificationAxis: 'business', nullable: true },
      data_class: { label: 'Data confidentiality', kind: 'application_classification', classificationAxis: 'confidentiality', nullable: true },
      contains_pii: { label: 'Contains PII', kind: 'boolean' },
      risk_mode: { label: 'Risk Mode', kind: 'enum', enumValues: RISK_MODES },
    },
  },
  spend_items: {
    labelSingular: 'spend item',
    labelPlural: 'spend items',
    businessResource: 'opex',
    tableName: 'spend_items',
    fields: {
      product_name: { label: 'Product Name', kind: 'text', requiredOnCreate: true, aliases: ['name'] },
      description: { label: 'Description', kind: 'text', nullable: true },
      supplier_id: { label: 'Supplier', kind: 'relation', nullable: true, relationTarget: 'suppliers', aliases: ['supplier'] },
      paying_company_id: { label: 'Paying Company', kind: 'relation', requiredOnCreate: true, relationTarget: 'companies', aliases: ['company', 'paying_company'] },
      account_id: { label: 'Account', kind: 'relation', nullable: true, relationTarget: 'accounts', aliases: ['account'] },
      currency: { label: 'Currency', kind: 'upper3', requiredOnCreate: true },
      effective_start: { label: 'Effective Start', kind: 'date', requiredOnCreate: true },
      // Deprecated alias of disabled_at for one release: fills an empty end of validity, never clears it.
      effective_end: { label: 'End of validity', kind: 'date', nullable: true },
      owner_it_id: { label: 'IT Owner', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['it_owner'] },
      owner_business_id: { label: 'Business Owner', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['business_owner'] },
      analytics_category_id: { label: 'Analytics Category', kind: 'relation', nullable: true, relationTarget: 'analytics_categories', aliases: ['analytics_category'] },
      project_id: { label: 'Project', kind: 'relation', nullable: true, relationTarget: 'projects', aliases: ['project'] },
      cost_center_id: { label: 'Cost center', kind: 'relation', nullable: true, relationTarget: 'cost_centers', aliases: ['cost_center'] },
      run_build: { label: 'Run or build', kind: 'enum', enumValues: RUN_BUILD, nullable: true },
      contract_id: { label: 'Contract', kind: 'relation', nullable: true, relationTarget: 'contracts', aliases: ['contract'] },
      status: { label: 'Status', kind: 'enum', enumValues: STATUS_STATES },
      disabled_at: { label: 'End of validity', kind: 'date', nullable: true, aliases: ['end_of_validity'] },
      notes: { label: 'Notes', kind: 'text', nullable: true },
    },
  },
  capex_items: {
    labelSingular: 'CAPEX item',
    labelPlural: 'CAPEX items',
    businessResource: 'capex',
    tableName: 'capex_items',
    fields: {
      description: { label: 'Description', kind: 'text', requiredOnCreate: true, aliases: ['name'] },
      ppe_type: { label: 'PPE Type', kind: 'enum', enumValues: PPE_TYPES, requiredOnCreate: true },
      investment_type: { label: 'Investment Type', kind: 'enum', enumValues: INVESTMENT_TYPES, requiredOnCreate: true },
      priority: { label: 'Priority', kind: 'enum', enumValues: PRIORITIES, requiredOnCreate: true },
      supplier_id: { label: 'Supplier', kind: 'relation', nullable: true, relationTarget: 'suppliers', aliases: ['supplier'] },
      paying_company_id: { label: 'Paying Company', kind: 'relation', requiredOnCreate: true, relationTarget: 'companies', aliases: ['company', 'paying_company'] },
      account_id: { label: 'Account', kind: 'relation', nullable: true, relationTarget: 'accounts', aliases: ['account'] },
      currency: { label: 'Currency', kind: 'upper3', requiredOnCreate: true },
      effective_start: { label: 'Effective Start', kind: 'date', requiredOnCreate: true },
      // Deprecated alias of disabled_at for one release: fills an empty end of validity, never clears it.
      effective_end: { label: 'End of validity', kind: 'date', nullable: true },
      owner_it_id: { label: 'IT Owner', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['it_owner'] },
      owner_business_id: { label: 'Business Owner', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['business_owner'] },
      analytics_category_id: { label: 'Analytics Category', kind: 'relation', nullable: true, relationTarget: 'analytics_categories', aliases: ['analytics_category'] },
      project_id: { label: 'Project', kind: 'relation', nullable: true, relationTarget: 'projects', aliases: ['project'] },
      cost_center_id: { label: 'Cost center', kind: 'relation', nullable: true, relationTarget: 'cost_centers', aliases: ['cost_center'] },
      run_build: { label: 'Run or build', kind: 'enum', enumValues: RUN_BUILD, nullable: true },
      status: { label: 'Status', kind: 'enum', enumValues: STATUS_STATES },
      disabled_at: { label: 'End of validity', kind: 'date', nullable: true, aliases: ['end_of_validity'] },
      notes: { label: 'Notes', kind: 'text', nullable: true },
    },
  },
};

export const AI_BUSINESS_RECORD_BUSINESS_RESOURCES = Array.from(
  new Set(AI_BUSINESS_RECORD_ENTITY_TYPES.map((entityType) => ENTITY_CONFIG[entityType].businessResource)),
);

export function getAiBusinessRecordBusinessResource(entityType: unknown): string {
  const normalized = String(entityType || '').trim() as AiBusinessRecordEntityType;
  if (!AI_BUSINESS_RECORD_ENTITY_TYPES.includes(normalized)) {
    throw new BadRequestException('Unsupported business record entity type.');
  }
  return ENTITY_CONFIG[normalized].businessResource;
}

// Budget items whose disabled_at is their end of validity (effective_end is its deprecated alias).
const END_OF_VALIDITY_ENTITIES = new Set<AiBusinessRecordEntityType>(['spend_items', 'capex_items']);

/** The field of a line's default analytics dimension (`analytics_category` for the model). */
const DEFAULT_ANALYTICS_FIELD = 'analytics_category_id';
/**
 * The stored key of another analytics dimension of a line: built on the
 * dimension id, so renaming the dimension between preview and apply changes
 * nothing. The model addresses it as `analytics:<code>`; `normalizeFields`
 * accepts both (undo re-feeds the stored keys).
 */
const ANALYTICS_AXIS_FIELD_PREFIX = 'analytics_axis:';

function lineScope(entityType: AiBusinessRecordEntityType): ItemAnalyticsScope | null {
  if (entityType === 'spend_items') return 'opex';
  if (entityType === 'capex_items') return 'capex';
  return null;
}

function analyticsAxisFieldKey(axisId: string): string {
  return `${ANALYTICS_AXIS_FIELD_PREFIX}${axisId}`;
}

/** The dimension id of an `analytics_axis:<id>` field, else null. */
function analyticsAxisIdOfField(fieldName: string): string | null {
  return fieldName.startsWith(ANALYTICS_AXIS_FIELD_PREFIX) ? fieldName.slice(ANALYTICS_AXIS_FIELD_PREFIX.length) : null;
}

function isAnalyticsDimensionField(fieldName: string): boolean {
  return fieldName === DEFAULT_ANALYTICS_FIELD || analyticsAxisIdOfField(fieldName) !== null;
}

/** Whether a line of `scope` may change its value on the dimension (the write gate's rule). */
function dimensionWritable(axis: AnalyticsAxisInfo, scope: ItemAnalyticsScope): boolean {
  return axis.status === 'enabled' && axisAppliesTo(axis, scope);
}

/** The write gate's refusal for a dimension the line may not change (the other-type message wins). */
function lockedDimensionMessage(axis: AnalyticsAxisInfo, scope: ItemAnalyticsScope): string {
  return axisAppliesTo(axis, scope) ? disabledDimensionMessage(axis) : notApplicableDimensionMessage(axis);
}

/**
 * The `analytics:<code>` keys of the dimensions a line of `scope` may write
 * besides the default one (`analytics_category`): enabled and used for its type.
 */
export function writableAnalyticsDimensionKeys(axes: AnalyticsAxisInfo[], scope: ItemAnalyticsScope): string[] {
  return axes
    .filter((axis) => !axis.is_default && dimensionWritable(axis, scope))
    .map((axis) => `${ANALYTICS_CSV_PREFIX}${axis.code}`);
}

/** A line's analytics values under their stored keys (`analytics_axis:<dimension id>` → value id). */
function analyticsValueKeys(values: ItemAnalyticsValue[]): Record<string, string> {
  return Object.fromEntries(values.map((value) => [analyticsAxisFieldKey(value.axis_id), value.category_id]));
}

function coerceRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  return { ...(value as Record<string, unknown>) };
}

function normalizeFieldKey(value: string): string {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function formatPlainValue(value: unknown): string | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map((item) => String(item)).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function toJsonValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (value === undefined) return null;
  return value;
}

/** Type-aware equality, shared with the edit conflicts of the PATCH routes (`common/edit-conflicts.ts`). */
const sameValue = sameFieldValue;

function requireEntityType(value: unknown): AiBusinessRecordEntityType {
  const normalized = String(value || '').trim() as AiBusinessRecordEntityType;
  if (!AI_BUSINESS_RECORD_ENTITY_TYPES.includes(normalized)) {
    throw new BadRequestException('Unsupported business record entity type.');
  }
  return normalized;
}

@Injectable()
export class AiBusinessRecordMutationSupportService {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
    private readonly capexItems: CapexItemsService,
    private readonly connections: ConnectionsService,
    private readonly contracts: ContractsService,
    private readonly interfaces: InterfacesService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly portfolioProjects: PortfolioProjectsService,
    private readonly portfolioRequests: PortfolioRequestsService,
    private readonly spendItems: SpendItemsService,
    private readonly taskSupport: AiTaskMutationSupportService,
  ) {}

  getBusinessResource(entityType: unknown): string {
    return getAiBusinessRecordBusinessResource(entityType);
  }

  getWritableFieldDescriptions(entityTypes: readonly AiBusinessRecordEntityType[] = AI_BUSINESS_RECORD_ENTITY_TYPES): string[] {
    return entityTypes.map((entityType) => {
      const fields = Object.keys(ENTITY_CONFIG[entityType].fields);
      // The tenant's other analytics dimensions (listed per tenant in the prompt context).
      if (lineScope(entityType)) fields.push(`${ANALYTICS_CSV_PREFIX}<dimension code>`);
      return `${entityType}: ${fields.join(', ')}`;
    });
  }

  private getConfig(entityType: AiBusinessRecordEntityType): EntityConfig {
    return ENTITY_CONFIG[entityType];
  }

  private getFieldConfig(entityType: AiBusinessRecordEntityType, rawField: string): { name: string; config: FieldConfig } | null {
    const normalized = normalizeFieldKey(rawField);
    const fields = this.getConfig(entityType).fields;
    if (fields[normalized]) return { name: normalized, config: fields[normalized] };
    for (const [name, config] of Object.entries(fields)) {
      if ((config.aliases || []).some((alias) => normalizeFieldKey(alias) === normalized)) {
        return { name, config };
      }
    }
    return null;
  }

  private normalizeNullableInput(value: unknown, field: FieldConfig): { empty: boolean; value: unknown } {
    if (value == null) return { empty: true, value: null };
    if (typeof value === 'string' && value.trim() === '') return { empty: true, value: null };
    if (Array.isArray(value) && value.length === 0 && field.nullable) return { empty: true, value: null };
    return { empty: false, value };
  }

  private async normalizeFieldValue(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    fieldName: string,
    field: FieldConfig,
    rawValue: unknown,
    fieldsSoFar: Record<string, unknown>,
    catalog?: ClassificationCatalog,
    existing?: Record<string, unknown> | null,
  ): Promise<{ value: unknown; displayValue: string | null }> {
    const nullable = this.normalizeNullableInput(rawValue, field);
    if (nullable.empty) {
      if (field.nullable) return { value: null, displayValue: null };
      throw new BadRequestException(`${field.label} cannot be empty.`);
    }

    if (field.kind === 'relation') {
      if (entityType === 'connections' && fieldName === 'servers') {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        const refs = [];
        for (const value of values) {
          const resolved = await this.resolveRelation(context, field.relationTarget!, value, field.label, fieldsSoFar);
          if (resolved) refs.push(resolved);
        }
        return {
          value: refs.map((ref) => ref.id),
          displayValue: refs.map((ref) => ref.label).join(', '),
        };
      }
      if (entityType === 'interfaces' && fieldName === 'middleware_application_ids') {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue];
        const refs = [];
        for (const value of values) {
          const resolved = await this.resolveRelation(context, 'applications', value, field.label, fieldsSoFar);
          if (resolved) refs.push(resolved);
        }
        return {
          value: refs.map((ref) => ref.id),
          displayValue: refs.map((ref) => ref.label).join(', '),
        };
      }
      const relation = await this.resolveRelation(context, field.relationTarget!, rawValue, field.label, fieldsSoFar);
      if (!relation && !field.nullable) throw new BadRequestException(`${field.label} cannot be empty.`);
      if (field.relationTarget === 'cost_centers' && relation && relation.id !== (existing?.[fieldName] ?? null)) {
        // A new assignment names an enabled cost center; the stored one is kept as it is.
        if (relation.row.kind !== 'cost_center') throw new BadRequestException('Choose a cost center, not a group.');
        if (!isActiveAt(relation.row.disabled_at as any)) throw new BadRequestException('This cost center is disabled.');
      }
      return { value: relation?.id ?? null, displayValue: relation?.label ?? null };
    }

    if (field.kind === 'boolean') {
      return this.normalizeBoolean(rawValue, field);
    }
    if (field.kind === 'integer') {
      const parsed = Number(rawValue);
      if (!Number.isInteger(parsed) || parsed > 2147483647 || (field.minimum !== undefined && parsed < field.minimum)) {
        throw new BadRequestException(`${field.label} must be an integer${field.minimum !== undefined ? ` from ${field.minimum} to 2147483647` : ''}.`);
      }
      return { value: parsed, displayValue: String(parsed) };
    }
    if (field.kind === 'non_negative_decimal' || field.kind === 'percent') {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed < 0) throw new BadRequestException(`${field.label} must be a non-negative number.`);
      if (field.kind === 'percent' && parsed > 100) throw new BadRequestException(`${field.label} must be between 0 and 100.`);
      return { value: parsed, displayValue: String(parsed) };
    }
    if (field.kind === 'date' && END_OF_VALIDITY_ENTITIES.has(entityType) && (fieldName === 'disabled_at' || fieldName === 'effective_end')) {
      // A bare day is stored at 12:00 UTC, like the CSV import, so it reads the same day everywhere.
      let parsed: Date | null;
      try {
        parsed = parseEndOfValidityInput(rawValue);
      } catch {
        throw new BadRequestException(`${field.label} must be a valid date (YYYY-MM-DD) or datetime.`);
      }
      const value = parsed ? parsed.toISOString() : null;
      return { value, displayValue: value ? value.slice(0, 10) : null };
    }
    if (field.kind === 'date') {
      const text = String(rawValue).trim();
      const parsed = new Date(text);
      if (Number.isNaN(parsed.getTime())) throw new BadRequestException(`${field.label} must be a valid date or datetime.`);
      return { value: text, displayValue: text };
    }
    if (field.kind === 'enum') {
      const normalized = String(rawValue).trim().toLowerCase();
      if (!(field.enumValues || []).includes(normalized)) {
        throw new BadRequestException(`${field.label} must be one of ${(field.enumValues || []).join(', ')}.`);
      }
      return { value: normalized, displayValue: normalized };
    }
    if (field.kind === 'application_category') {
      const option = await this.itOpsSettings.resolveApplicationCategoryOption(context.tenantId, rawValue, {
        manager: context.manager,
      });
      return { value: option.code, displayValue: option.label || option.code };
    }
    if (field.kind === 'application_classification') {
      if (!catalog || !field.classificationAxis) throw new BadRequestException('Application classification catalog is unavailable.');
      const options = field.classificationAxis === 'business' ? catalog.businessCriticalityLevels : field.classificationAxis === 'cyber'
        ? catalog.cyberCriticalityLevels
        : field.classificationAxis === 'confidentiality'
          ? catalog.dataClasses
          : catalog.recoveryWaves;
      const value = resolveClassificationOption(rawValue, options, existing?.[fieldName] as string | null | undefined);
      const option = options.find((item) => item.code === value);
      return { value, displayValue: option?.label ?? value };
    }
    if (field.kind === 'array_text') {
      const values = Array.isArray(rawValue)
        ? rawValue
        : String(rawValue).split(',').map((part) => part.trim()).filter(Boolean);
      const normalized = values.map((item) => String(item).trim()).filter(Boolean);
      return { value: normalized, displayValue: normalized.join(', ') };
    }
    if (field.kind === 'json') {
      if (typeof rawValue === 'string') {
        try {
          const parsed = JSON.parse(rawValue);
          return { value: parsed, displayValue: JSON.stringify(parsed) };
        } catch {
          throw new BadRequestException(`${field.label} must be valid JSON.`);
        }
      }
      if (typeof rawValue !== 'object') throw new BadRequestException(`${field.label} must be an object or array.`);
      return { value: rawValue, displayValue: JSON.stringify(rawValue) };
    }

    let text = String(rawValue).trim();
    if (field.kind === 'upper3') {
      text = text.toUpperCase();
      if (text.length !== 3) throw new BadRequestException(`${field.label} must be 3 letters.`);
    }
    return { value: text, displayValue: text };
  }

  private normalizeBoolean(value: unknown, field: FieldConfig): { value: boolean; displayValue: string } {
    if (typeof value === 'boolean') return { value, displayValue: value ? 'Yes' : 'No' };
    const normalized = String(value).trim().toLowerCase();
    if (['true', 'yes', 'y', '1'].includes(normalized)) return { value: true, displayValue: 'Yes' };
    if (['false', 'no', 'n', '0'].includes(normalized)) return { value: false, displayValue: 'No' };
    throw new BadRequestException(`${field.label} must be true or false.`);
  }

  private async normalizeFields(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    rawFields: Record<string, unknown>,
    mode: 'create' | 'update',
    existing?: Record<string, unknown> | null,
  ): Promise<NormalizedFields> {
    const config = this.getConfig(entityType);
    const fields: Record<string, unknown> = {};
    const displayValues: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};
    const catalog = ['applications', 'interfaces', 'connections'].includes(entityType)
      ? await this.itOpsSettings.getClassificationCatalog(context.tenantId, { manager: context.manager })
      : undefined;

    // OPEX and CAPEX lines also write their analytics dimensions (the tenant's, loaded once when named).
    const scope = lineScope(entityType);
    let axes: AnalyticsAxisInfo[] | null = null;
    const tenantAxes = async () => (axes ??= await loadAnalyticsAxes(context.manager, context.tenantId));

    for (const [rawName, rawValue] of Object.entries(rawFields)) {
      if (rawValue === undefined) continue;
      const axis = scope ? await this.dimensionOfField(rawName, tenantAxes) : undefined;
      let resolved: { name: string; config: FieldConfig } | null;
      if (axis === undefined) {
        resolved = this.getFieldConfig(entityType, rawName);
      } else if (axis === null) {
        resolved = null;
      } else if (axis.is_default) {
        // `analytics:<default code>` is the default dimension's field: a second address of it is a duplicate.
        resolved = { name: DEFAULT_ANALYTICS_FIELD, config: config.fields[DEFAULT_ANALYTICS_FIELD] };
      } else {
        resolved = {
          name: analyticsAxisFieldKey(axis.id),
          config: { label: analyticsAxisLabel(axis), kind: 'relation', nullable: true, relationTarget: 'analytics_categories' },
        };
      }
      if (!resolved) {
        const writable = Object.keys(config.fields);
        if (scope) writable.push(...writableAnalyticsDimensionKeys(await tenantAxes(), scope));
        throw new BadRequestException(`${rawName} is not writable for ${config.labelPlural}. Writable fields: ${writable.join(', ')}.`);
      }
      if (Object.prototype.hasOwnProperty.call(fields, resolved.name)) {
        const shown = axis && !axis.is_default ? `${ANALYTICS_CSV_PREFIX}${axis.code}` : resolved.name;
        throw new BadRequestException(`Field ${shown} was provided more than once.`);
      }
      let normalized: { value: unknown; displayValue: string | null };
      let label = resolved.config.label;
      if (scope && isAnalyticsDimensionField(resolved.name)) {
        // Any dimension of a line, the default one included (however addressed), takes the gate's rules
        // and shows the dimension's name. A tenant still without its default dimension holds no value on it.
        const dimensionAxis = axis ?? (await tenantAxes()).find((candidate) => candidate.is_default) ?? null;
        label = analyticsAxisLabel(dimensionAxis ?? { name: null });
        if (dimensionAxis) {
          const dimension = await this.normalizeDimensionValue(context, scope, dimensionAxis, rawValue, (existing?.[resolved.name] as string | null | undefined) ?? null);
          // A dimension the line may not change passes its current value as a no-op: nothing to create.
          if (dimension.locked && mode === 'create') continue;
          normalized = dimension;
        } else {
          const ref = textOrNull(rawValue);
          if (ref) throw new BadRequestException(`"${ref}" is not a value of ${dimensionPhrase({ name: null })}.`);
          normalized = { value: null, displayValue: null };
        }
      } else {
        normalized = await this.normalizeFieldValue(context, entityType, resolved.name, resolved.config, rawValue, fields, catalog, existing);
      }
      fields[resolved.name] = normalized.value;
      displayValues[resolved.name] = normalized.displayValue;
      fieldLabels[resolved.name] = label;
    }

    if (END_OF_VALIDITY_ENTITIES.has(entityType) && Object.prototype.hasOwnProperty.call(fields, 'effective_end')) {
      // Deprecated alias: fills an empty end of validity, never overrides a given one, never clears it.
      const legacyValue = fields.effective_end;
      const legacyDisplay = displayValues.effective_end;
      delete fields.effective_end;
      delete displayValues.effective_end;
      delete fieldLabels.effective_end;
      if (legacyValue != null && (fields.disabled_at == null || fields.disabled_at === '')) {
        fields.disabled_at = legacyValue;
        displayValues.disabled_at = legacyDisplay;
        fieldLabels.disabled_at = config.fields.disabled_at.label;
      }
    }

    if (Object.keys(fields).length === 0) {
      throw new BadRequestException('At least one writable field is required.');
    }
    if (mode === 'create') {
      for (const [name, field] of Object.entries(config.fields)) {
        if (!field.requiredOnCreate) continue;
        const value = fields[name];
        if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
          throw new BadRequestException(`${field.label} is required for ${config.labelSingular} creation.`);
        }
      }
      if (entityType === 'projects' && fields.origin === 'standard') {
        throw new BadRequestException('Standard projects must be created by converting an approved request. Use origin fast_track or legacy.');
      }
    }
    return { fields, displayValues, fieldLabels };
  }

  /**
   * The dimension a line field names: `analytics:<code>` (code matched case-insensitively,
   * read before `normalizeFieldKey`, which would rewrite a `-` of the code) or the stored
   * `analytics_axis:<dimension id>`. undefined when the field is no dimension key, null
   * when its code names no dimension of the tenant. A stored key whose dimension was deleted
   * since (an undo) is refused as such.
   */
  private async dimensionOfField(
    rawName: string,
    tenantAxes: () => Promise<AnalyticsAxisInfo[]>,
  ): Promise<AnalyticsAxisInfo | null | undefined> {
    const name = String(rawName ?? '').trim();
    const lower = name.toLowerCase();
    if (lower.startsWith(ANALYTICS_CSV_PREFIX)) {
      const code = lower.slice(ANALYTICS_CSV_PREFIX.length).trim();
      return (await tenantAxes()).find((axis) => axis.code.toLowerCase() === code) ?? null;
    }
    if (lower.startsWith(ANALYTICS_AXIS_FIELD_PREFIX)) {
      const id = lower.slice(ANALYTICS_AXIS_FIELD_PREFIX.length).trim();
      const axis = (await tenantAxes()).find((candidate) => candidate.id.toLowerCase() === id);
      if (!axis) throw new BadRequestException('This dimension no longer exists.');
      return axis;
    }
    return undefined;
  }

  /**
   * A line's value on one dimension: by name (case-insensitive) or
   * id, looked up within that dimension only; empty clears it. The write gate's rules, checked
   * at preview (the gate checks again at apply): a dimension that is disabled or used for the
   * other line type only passes the line's current value (`locked`); a disabled value or one
   * used for the other line type only when it is the line's current value.
   */
  private async normalizeDimensionValue(
    context: AiExecutionContextWithManager,
    scope: ItemAnalyticsScope,
    axis: AnalyticsAxisInfo,
    rawValue: unknown,
    currentId: string | null,
  ): Promise<{ value: string | null; displayValue: string | null; locked: boolean }> {
    const ref = Array.isArray(rawValue) && rawValue.length === 0 ? null : textOrNull(rawValue);
    const value = ref ? await this.findDimensionValue(context, axis.id, ref) : null;
    const writable = dimensionWritable(axis, scope);
    if (ref && !value) {
      throw new BadRequestException(writable ? `"${ref}" is not a value of ${dimensionPhrase(axis)}.` : lockedDimensionMessage(axis, scope));
    }
    const id = value?.id ?? null;
    const current = sameValue(id, currentId);
    if (!writable && !current) throw new BadRequestException(lockedDimensionMessage(axis, scope));
    if (value && !current) {
      if (!isValueActive(value)) throw new BadRequestException(DISABLED_VALUE_MESSAGE);
      if (!valueAppliesTo(value, scope)) throw new BadRequestException(notApplicableValueMessage(value, scope));
    }
    return { value: id, displayValue: value?.name ?? null, locked: !writable };
  }

  /** The value of one dimension named by `ref` (its id, or its name, unique within the dimension). */
  private async findDimensionValue(
    context: AiExecutionContextWithManager,
    axisId: string,
    ref: string,
  ): Promise<{ id: string; name: string; applies_to: string | null; status: string; disabled_at: Date | string | null } | null> {
    const rows: Array<{ id: string; name: string; applies_to: string | null; status: string; disabled_at: Date | string | null }> =
      await context.manager.query(
        `SELECT c.id::text AS id, c.name, c.applies_to, c.status::text AS status, c.disabled_at
           FROM analytics_categories c
          WHERE c.tenant_id = $1 AND c.axis_id = $2
            AND (${isUuid(ref) ? 'c.id = $3 OR ' : ''}LOWER(c.name) = LOWER($3::text))
          ORDER BY c.name
          LIMIT 2`,
        [context.tenantId, axisId, ref],
      );
    return rows.find((row) => row.id.toLowerCase() === ref.toLowerCase()) ?? rows[0] ?? null;
  }

  private async resolveRelation(
    context: AiExecutionContextWithManager,
    target: RelationTarget,
    value: unknown,
    fieldLabel: string,
    fieldsSoFar: Record<string, unknown>,
  ): Promise<ResolvedReference | null> {
    const normalized = textOrNull(value);
    if (!normalized) return null;
    if (target === 'users') {
      const user = isUuid(normalized)
        ? await this.resolveUserById(context, normalized)
        : await this.taskSupport.resolveUserReference(context, normalized);
      return { id: user.id, ref: user.email, label: user.label, row: user as any };
    }
    if (target === 'location_sub_items') {
      return this.resolveLocationSubItem(context, normalized, fieldsSoFar.location_id);
    }
    try {
      return await this.resolveRecordReference(context, target as any, normalized);
    } catch (error) {
      if (error instanceof NotFoundException) throw new NotFoundException(`${fieldLabel} not found.`);
      throw error;
    }
  }

  private async resolveUserById(context: AiExecutionContextWithManager, id: string) {
    const rows = await context.manager.query(
      `
      SELECT u.id,
             u.email,
             COALESCE(NULLIF(TRIM(CONCAT(u.first_name, ' ', u.last_name)), ''), u.email) AS label
      FROM users u
      WHERE u.tenant_id = $1 AND u.id = $2 AND u.status = 'enabled'
      LIMIT 1
      `,
      [context.tenantId, id],
    );
    if (!rows[0]) throw new NotFoundException('User not found.');
    return {
      id: String(rows[0].id),
      email: textOrNull(rows[0].email),
      label: String(rows[0].label || rows[0].email || rows[0].id),
    };
  }

  private async resolveLocationSubItem(
    context: AiExecutionContextWithManager,
    ref: string,
    locationId: unknown,
  ): Promise<ResolvedReference> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('Sub-location reference is required.');
    const params: unknown[] = [context.tenantId, normalized];
    let locationClause = '';
    if (locationId) {
      params.push(String(locationId));
      locationClause = ` AND si.location_id = $3`;
    }
    const rows = isUuid(normalized)
      ? await context.manager.query(
        `SELECT si.*, l.name AS location_name FROM location_sub_items si LEFT JOIN locations l ON l.id = si.location_id AND l.tenant_id = si.tenant_id WHERE si.tenant_id = $1 AND si.id = $2${locationClause} LIMIT 2`,
        params,
      )
      : await context.manager.query(
        `SELECT si.*, l.name AS location_name FROM location_sub_items si LEFT JOIN locations l ON l.id = si.location_id AND l.tenant_id = si.tenant_id WHERE si.tenant_id = $1 AND LOWER(si.name) = LOWER($2::text)${locationClause} ORDER BY si.name LIMIT 6`,
        params,
      );
    if (rows.length === 0) throw new NotFoundException('Sub-location not found.');
    if (rows.length > 1) throw new BadRequestException(`Multiple sub-locations matched "${normalized}". Use a UUID or set location_id first.`);
    return {
      id: String(rows[0].id),
      ref: textOrNull(rows[0].name),
      label: [rows[0].name, rows[0].location_name].map(textOrNull).filter(Boolean).join(' - '),
      row: rows[0],
    };
  }

  private async resolveRecordReference(
    context: AiExecutionContextWithManager,
    entityType: RelationTarget,
    ref: string,
  ): Promise<ResolvedReference> {
    const normalized = textOrNull(ref);
    if (!normalized) throw new BadRequestException('Record reference is required.');
    const rows = await this.queryReferenceCandidates(context, entityType, normalized);
    if (rows.length === 0) throw new NotFoundException(`No ${this.referenceLabelPlural(entityType)} found matching "${normalized}".`);
    if (rows.length > 1) {
      const labels = rows.map((row) => this.recordTitle(entityType, row)).join(', ');
      throw new BadRequestException(`Multiple ${this.referenceLabelPlural(entityType)} matched "${normalized}": ${labels}. Use a more specific reference.`);
    }
    return this.referenceFromRow(entityType, rows[0]);
  }

  /** The item number of a budget line reference (`OPX-3`, `CPX-3`), or -1 when the reference is not one of this type. */
  private itemNumberOfReference(ref: string, type: 'spend' | 'capex'): number {
    try {
      const parsed = parseItemRef(ref, type);
      // A bare number stays a name: only the prefixed reference names a line.
      return parsed.type === 'item_number' && ref.includes('-') ? parsed.value : -1;
    } catch {
      return -1;
    }
  }

  private async queryReferenceCandidates(
    context: AiExecutionContextWithManager,
    entityType: RelationTarget,
    ref: string,
  ): Promise<Record<string, unknown>[]> {
    const uuid = isUuid(ref);
    const itemNumber = Number((ref.match(/(?:^|[-\s])(\d+)$/)?.[1] ?? '').trim());
    const { manager, tenantId } = context;
    switch (entityType) {
      case 'applications': {
        const accessScope = await resolveBusinessContributorScopeForUser({
          manager,
          userId: context.userId,
          tenantId,
        }, 'applications', 'reader');
        const params: unknown[] = [tenantId, ref];
        const accessScopeSql = accessScope
          ? (() => {
            params.push(accessScope.userId);
            return `AND ${applicationParticipantCondition('a', `$${params.length}`)}`;
          })()
          : '';
        return manager.query(
          `
          SELECT a.* FROM applications a
          WHERE a.tenant_id = $1
            AND (${uuid ? 'a.id = $2 OR ' : ''}LOWER(COALESCE(a.sequential_id, '')) = LOWER($2::text) OR LOWER(a.name) = LOWER($2::text))
            ${accessScopeSql}
          ORDER BY a.name LIMIT 6
          `,
          params,
        );
      }
      case 'assets':
        return manager.query(
          `
          SELECT * FROM assets
          WHERE tenant_id = $1
            AND (${uuid ? 'id = $2 OR ' : ''}LOWER(COALESCE(asset_reference, '')) = LOWER($2::text) OR LOWER(name) = LOWER($2::text) OR LOWER(COALESCE(hostname, '')) = LOWER($2::text) OR LOWER(COALESCE(fqdn, '')) = LOWER($2::text))
          ORDER BY name LIMIT 6
          `,
          [tenantId, ref],
        );
      case 'contracts':
        return manager.query(
          `SELECT * FROM contracts WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`,
          [tenantId, ref],
        );
      case 'projects':
        return manager.query(
          `
          SELECT * FROM portfolio_projects
          WHERE tenant_id = $1
            AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR item_number = $3)
          ORDER BY item_number LIMIT 6
          `,
          [tenantId, ref, Number.isInteger(itemNumber) ? itemNumber : -1],
        );
      case 'requests':
        return manager.query(
          `
          SELECT * FROM portfolio_requests
          WHERE tenant_id = $1
            AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR item_number = $3)
          ORDER BY item_number LIMIT 6
          `,
          [tenantId, ref, Number.isInteger(itemNumber) ? itemNumber : -1],
        );
      case 'interfaces':
        return manager.query(
          `SELECT * FROM interfaces WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(interface_reference) = LOWER($2::text) OR LOWER(COALESCE(interface_id, '')) = LOWER($2::text) OR LOWER(name) = LOWER($2::text)) ORDER BY interface_reference LIMIT 6`,
          [tenantId, ref],
        );
      case 'connections':
        return manager.query(
          `SELECT * FROM connections WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(connection_reference) = LOWER($2::text) OR LOWER(name) = LOWER($2::text)) ORDER BY connection_reference LIMIT 6`,
          [tenantId, ref],
        );
      case 'spend_items':
        return this.withDefaultAnalyticsValue(context, 'opex', await manager.query(
          `SELECT * FROM spend_items WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(product_name) = LOWER($2::text) OR item_number = $3) ORDER BY product_name LIMIT 6`,
          [tenantId, ref, this.itemNumberOfReference(ref, 'spend')],
        ));
      case 'capex_items':
        return this.withDefaultAnalyticsValue(context, 'capex', await manager.query(
          `SELECT * FROM capex_items WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(description) = LOWER($2::text) OR item_number = $3) ORDER BY description LIMIT 6`,
          [tenantId, ref, this.itemNumberOfReference(ref, 'capex')],
        ));
      case 'companies':
        return manager.query(`SELECT * FROM companies WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'cost_centers': {
        // By id, code or name; a code (unique in the tenant) wins over names that match too.
        const rows: Record<string, unknown>[] = await manager.query(
          `SELECT * FROM cost_centers WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(code) = LOWER($2::text) OR LOWER(name) = LOWER($2::text)) ORDER BY code LIMIT 6`,
          [tenantId, ref],
        );
        const exact = rows.filter((row) => String(row.id) === ref.toLowerCase() || String(row.code).toLowerCase() === ref.toLowerCase());
        return exact.length > 0 ? exact : rows;
      }
      case 'departments':
        return manager.query(`SELECT * FROM departments WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'suppliers':
        return manager.query(`SELECT * FROM suppliers WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR LOWER(COALESCE(erp_supplier_id, '')) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'accounts':
        return manager.query(`SELECT * FROM accounts WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}account_number::text = $2::text OR LOWER(account_name) = LOWER($2::text) OR LOWER(CONCAT(account_number, ' - ', account_name)) = LOWER($2::text)) ORDER BY account_number LIMIT 6`, [tenantId, ref]);
      case 'business_processes':
        return manager.query(`SELECT * FROM business_processes WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'portfolio_sources':
        return manager.query(`SELECT * FROM portfolio_sources WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'portfolio_categories':
        return manager.query(`SELECT * FROM portfolio_categories WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'portfolio_streams':
        return manager.query(`SELECT * FROM portfolio_streams WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text)) ORDER BY name LIMIT 6`, [tenantId, ref]);
      case 'locations':
        return manager.query(`SELECT * FROM locations WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(location_reference) = LOWER($2::text) OR LOWER(name) = LOWER($2::text) OR LOWER(CONCAT(location_reference, ' - ', name)) = LOWER($2::text)) ORDER BY location_reference LIMIT 6`, [tenantId, ref]);
      default:
        throw new BadRequestException(`Unsupported relation target ${entityType}.`);
    }
  }

  /**
   * Line rows with their analytics values read from the links: the default dimension's
   * under `analytics_category_id` (the item column of that name is no longer written, so
   * the preview's current values and the reference checks never read it), and every
   * dimension's under its stored key `analytics_axis:<dimension id>`.
   */
  private async withDefaultAnalyticsValue(
    context: AiExecutionContextWithManager,
    scope: ItemAnalyticsScope,
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const values = await loadItemAnalyticsValues(context.manager, scope, context.tenantId, rows.map((row) => String(row.id)));
    return rows.map((row) => {
      const lineValues = values.get(String(row.id)) ?? [];
      return { ...row, ...analyticsValueKeys(lineValues), analytics_category_id: itemAnalyticsFields(lineValues).analytics_category_id };
    });
  }

  /** A line snapshot (`get`) with every dimension's value under its stored key as well. */
  private withAnalyticsValueKeys(entityType: AiBusinessRecordEntityType, row: Record<string, unknown>): Record<string, unknown> {
    if (!lineScope(entityType)) return row;
    const values = Array.isArray(row.analytics_values) ? row.analytics_values as ItemAnalyticsValue[] : [];
    return { ...row, ...analyticsValueKeys(values) };
  }

  /** What the update preview shows as "from": the value names of the dimension fields, the values otherwise. */
  private async previousDisplayValues(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    previousValues: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const display: Record<string, unknown> = { ...previousValues };
    if (!lineScope(entityType)) return display;
    const ids = Object.entries(previousValues)
      .filter(([fieldName, value]) => isAnalyticsDimensionField(fieldName) && typeof value === 'string' && isUuid(value))
      .map(([, value]) => String(value));
    if (ids.length === 0) return display;
    const rows: Array<{ id: string; name: string }> = await context.manager.query(
      `SELECT id::text AS id, name FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [context.tenantId, ids],
    );
    const names = new Map(rows.map((row) => [row.id.toLowerCase(), row.name]));
    for (const [fieldName, value] of Object.entries(previousValues)) {
      if (!isAnalyticsDimensionField(fieldName) || typeof value !== 'string') continue;
      display[fieldName] = names.get(value.toLowerCase()) ?? value;
    }
    return display;
  }

  private referenceFromRow(entityType: RelationTarget, row: Record<string, unknown>): ResolvedReference {
    const id = String(row.id || '');
    if (!id) throw new NotFoundException(`${this.referenceLabelSingular(entityType)} not found.`);
    return { id, ref: this.recordRef(entityType, row), label: this.recordTitle(entityType, row), row };
  }

  private referenceLabelSingular(entityType: RelationTarget): string {
    if (AI_BUSINESS_RECORD_ENTITY_TYPES.includes(entityType as any)) {
      return this.getConfig(entityType as AiBusinessRecordEntityType).labelSingular;
    }
    return String(entityType).replace(/_/g, ' ');
  }

  private referenceLabelPlural(entityType: RelationTarget): string {
    if (AI_BUSINESS_RECORD_ENTITY_TYPES.includes(entityType as any)) {
      return this.getConfig(entityType as AiBusinessRecordEntityType).labelPlural;
    }
    return String(entityType).replace(/_/g, ' ');
  }

  private recordRef(entityType: RelationTarget, row: Record<string, unknown>): string | null {
    switch (entityType) {
      case 'applications': return textOrNull(row.sequential_id);
      case 'assets': return textOrNull(row.asset_reference) || textOrNull(row.hostname);
      case 'interfaces': return textOrNull(row.interface_reference) || textOrNull(row.interface_id);
      case 'connections': return textOrNull(row.connection_reference);
      case 'projects': return row.item_number == null ? null : `PRJ-${row.item_number}`;
      case 'requests': return row.item_number == null ? null : `REQ-${row.item_number}`;
      case 'spend_items': return textOrNull(row.product_name);
      case 'capex_items': return textOrNull(row.description);
      case 'accounts': return textOrNull(row.account_number);
      case 'cost_centers': return textOrNull(row.code);
      default: return null;
    }
  }

  private recordTitle(entityType: RelationTarget, row: Record<string, unknown>): string {
    switch (entityType) {
      case 'applications':
        return [row.sequential_id, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled application';
      case 'assets':
        return [row.asset_reference, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled asset';
      case 'interfaces':
        return [row.interface_reference || row.interface_id, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled interface';
      case 'connections':
        return [row.connection_reference, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled connection';
      case 'projects':
        return [row.item_number == null ? null : `PRJ-${row.item_number}`, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled project';
      case 'requests':
        return [row.item_number == null ? null : `REQ-${row.item_number}`, row.name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled request';
      case 'spend_items':
        return textOrNull(row.product_name) || 'Untitled spend item';
      case 'capex_items':
        return textOrNull(row.description) || 'Untitled CAPEX item';
      case 'accounts':
        return [row.account_number, row.account_name].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled account';
      case 'cost_centers':
        return [row.code, row.name].map(textOrNull).filter(Boolean).join(' · ') || 'Untitled cost center';
      default:
        return textOrNull(row.name) || String(row.id || `Untitled ${this.referenceLabelSingular(entityType)}`);
    }
  }

  private titleForPendingCreate(entityType: AiBusinessRecordEntityType, fields: Record<string, unknown>): string {
    return this.recordTitle(entityType, fields);
  }

  private pickFieldValues(
    entityType: AiBusinessRecordEntityType,
    row: Record<string, unknown>,
    fieldNames: string[],
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    for (const fieldName of fieldNames) {
      values[fieldName] = toJsonValue(row[fieldName]);
    }
    return values;
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiCreateBusinessRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireEntityType(input.entity_type);
    const normalized = await this.normalizeFields(context, entityType, coerceRecord(input.fields, 'fields'), 'create');
    const classification = entityType === 'applications'
      ? this.applicationClassificationPreviewState(normalized.fields, null)
      : null;
    const title = this.titleForPendingCreate(entityType, normalized.fields);
    return {
      targetEntityType: entityType,
      targetEntityId: null,
      mutationInput: {
        action: 'create',
        entity_type: entityType,
        fields: normalized.fields,
        display_values: normalized.displayValues,
        field_labels: normalized.fieldLabels,
        ...(classification ? { classification } : {}),
      },
      currentValues: {
        target_ref: null,
        target_title: title,
        values: null,
        display_values: null,
      },
    };
  }

  async prepareUpdatePreview(
    context: AiExecutionContextWithManager,
    input: AiUpdateBusinessRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireEntityType(input.entity_type);
    const target = await this.resolveRecordReference(context, entityType, input.ref);
    return this.prepareUpdatePreviewForTarget(context, entityType, target, coerceRecord(input.fields, 'fields'), {
      sourcePreviewId: null,
    });
  }

  async prepareReverseUpdatePreview(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    if (!preview.target_entity_id) throw new BadRequestException('Original preview is missing the target record.');
    const previousValues = coerceRecord(preview.current_values?.values, 'current_values.values');
    const targetRow = this.withAnalyticsValueKeys(entityType, await this.getRecordSnapshot(context, entityType, preview.target_entity_id));
    const target = this.referenceFromRow(entityType, targetRow);
    return this.prepareUpdatePreviewForTarget(context, entityType, target, previousValues, {
      sourcePreviewId: preview.id,
    });
  }

  private async prepareUpdatePreviewForTarget(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    target: ResolvedReference,
    rawFields: Record<string, unknown>,
    opts: { sourcePreviewId: string | null },
  ): Promise<AiPreparedMutationPreview> {
    const normalized = await this.normalizeFields(context, entityType, rawFields, 'update', target.row);
    const requestedFieldNames = Object.keys(normalized.fields);
    const currentValues = this.pickFieldValues(entityType, target.row, requestedFieldNames);
    const changedFieldNames = requestedFieldNames.filter((fieldName) => !sameValue(currentValues[fieldName], normalized.fields[fieldName]));
    if (changedFieldNames.length === 0) {
      throw new BadRequestException(`${this.getConfig(entityType).labelSingular} already has the requested values.`);
    }

    const nextFields: Record<string, unknown> = {};
    const nextDisplayValues: Record<string, string | null> = {};
    const fieldLabels: Record<string, string> = {};
    const previousValues: Record<string, unknown> = {};
    for (const fieldName of changedFieldNames) {
      nextFields[fieldName] = normalized.fields[fieldName];
      nextDisplayValues[fieldName] = normalized.displayValues[fieldName];
      fieldLabels[fieldName] = normalized.fieldLabels[fieldName];
      previousValues[fieldName] = currentValues[fieldName];
    }
    const classification = entityType === 'applications'
      ? this.applicationClassificationPreviewState(nextFields, target.row)
      : null;

    return {
      targetEntityType: entityType,
      targetEntityId: target.id,
      mutationInput: {
        action: 'update',
        entity_type: entityType,
        fields: nextFields,
        display_values: nextDisplayValues,
        field_labels: fieldLabels,
        source_preview_id: opts.sourcePreviewId,
        ...(classification ? { classification } : {}),
      },
      currentValues: {
        target_ref: target.ref,
        target_title: target.label,
        values: previousValues,
        display_values: await this.previousDisplayValues(context, entityType, previousValues),
      },
    };
  }

  private applicationClassificationPreviewState(
    fields: Record<string, unknown>,
    existing: Record<string, unknown> | null,
  ): Record<string, unknown> {
    const hasClassificationInput = Object.keys(fields).some((field) => [
      'criticality', 'cyber_criticality', 'data_class', 'recovery_wave',
      'rto_minutes', 'rpo_minutes', 'classification_justification',
    ].includes(field));
    return {
      has_classification_input: hasClassificationInput,
      invalidates_review: !!existing?.classification_review && hasClassificationInput,
    };
  }

  presentPreview(preview: AiMutationPreview): AiMutationPreviewPresentation {
    const entityType = requireEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const config = this.getConfig(entityType);
    const mutation = preview.mutation_input ?? {};
    const current = preview.current_values ?? {};
    const action = String(mutation.action || '');
    const fields = coerceRecord(mutation.fields, 'mutation_input.fields');
    const displayValues = coerceRecord(mutation.display_values ?? {}, 'mutation_input.display_values');
    const fieldLabels = coerceRecord(mutation.field_labels ?? {}, 'mutation_input.field_labels');
    const currentValues = current.display_values && typeof current.display_values === 'object'
      ? current.display_values as Record<string, unknown>
      : {};
    const title = textOrNull(current.target_title) || this.titleForPendingCreate(entityType, fields);
    const fieldNames = Object.keys(fields);
    const labelList = fieldNames.map((fieldName) => String(fieldLabels[fieldName] || fieldName)).join(', ');

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = action === 'create'
          ? `Create ${config.labelSingular} "${title}".`
          : `Update ${config.labelSingular} "${title}": ${labelList}.`;
        break;
      case 'executed':
        summary = action === 'create'
          ? `Created ${config.labelSingular} "${title}".`
          : `Updated ${config.labelSingular} "${title}".`;
        break;
      case 'rejected':
        summary = `${action === 'create' ? 'Creation' : 'Update'} preview for ${config.labelSingular} "${title}" was rejected.`;
        break;
      case 'expired':
        summary = `${action === 'create' ? 'Creation' : 'Update'} preview for ${config.labelSingular} "${title}" expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `${action === 'create' ? 'Creation' : 'Update'} preview for ${config.labelSingular} "${title}" failed.`;
        break;
    }

    const changes: Record<string, AiMutationPreviewChangeDto> = {};
    for (const fieldName of fieldNames) {
      changes[fieldName] = {
        label: String(fieldLabels[fieldName] || fieldName),
        from: action === 'create' ? null : formatPlainValue(currentValues[fieldName]),
        to: formatPlainValue(displayValues[fieldName]),
        format: 'text',
      };
    }
    const classification = mutation.classification && typeof mutation.classification === 'object'
      ? mutation.classification as Record<string, unknown>
      : null;
    if (classification?.invalidates_review) {
      changes.classification_review_state = {
        label: 'Classification Review', from: 'Reviewed', to: 'Stale after this change', format: 'text',
      };
    }

    return {
      target: {
        entity_type: entityType,
        entity_id: preview.target_entity_id ?? null,
        ref: textOrNull(current.target_ref),
        title,
      },
      changes,
      summary,
    };
  }

  async executePreview(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    const entityType = requireEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const mutation = preview.mutation_input ?? {};
    const action = String(mutation.action || '');
    const fields = coerceRecord(mutation.fields, 'mutation_input.fields');
    const executionFields = this.executionFields(fields);
    if (action === 'create') {
      const saved = await this.createRecord(context, entityType, executionFields);
      const snapshot = await this.getRecordSnapshot(context, entityType, String((saved as any).id));
      const ref = this.referenceFromRow(entityType, snapshot);
      preview.target_entity_id = ref.id;
      preview.current_values = {
        ...(preview.current_values ?? {}),
        target_ref: ref.ref,
        target_title: ref.label,
      };
      await this.logAiAudit(context, preview, entityType, 'create', null, snapshot);
      return;
    }
    if (action !== 'update') throw new BadRequestException('Unsupported business record mutation action.');
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the target record.');

    const expectedValues = coerceRecord(preview.current_values?.values, 'current_values.values');
    // An OPEX or CAPEX line is locked before what the preview saw is compared with what is
    // stored (lock order, `spend/budget-locks.ts`): nothing changes between the check and the write.
    if (entityType === 'spend_items' || entityType === 'capex_items') {
      await lockBudgetLine(context.manager, entityType === 'spend_items' ? 'opex' : 'capex', context.tenantId, preview.target_entity_id);
    }
    const live = await this.getRecordSnapshot(context, entityType, preview.target_entity_id);
    // A dimension is compared with the live line's value on that dimension (none reads null).
    const liveValues = this.withAnalyticsValueKeys(entityType, live);
    for (const [fieldName, expectedValue] of Object.entries(expectedValues)) {
      if (!sameValue(liveValues[fieldName] ?? null, expectedValue)) {
        const label = await this.conflictLabel(context, entityType, fieldName, mutation.field_labels);
        throw new ConflictException(`${label} changed after the preview was created.`);
      }
    }
    const before = { ...live };
    await this.updateRecord(context, entityType, preview.target_entity_id, executionFields);
    const after = await this.getRecordSnapshot(context, entityType, preview.target_entity_id);
    await this.logAiAudit(context, preview, entityType, 'update', before, after);
  }

  /**
   * The fields the services take: the stored dimension keys become
   * `analytics_values: { [dimension id]: value id | null }`, checked again by the
   * write gate; the default dimension stays `analytics_category_id`.
   */
  private executionFields(fields: Record<string, unknown>): Record<string, unknown> {
    const execution: Record<string, unknown> = {};
    const analyticsValues: Record<string, string | null> = {};
    for (const [fieldName, value] of Object.entries(fields)) {
      const axisId = analyticsAxisIdOfField(fieldName);
      if (axisId) analyticsValues[axisId] = value == null || value === '' ? null : String(value);
      else execution[fieldName] = value;
    }
    if (Object.keys(analyticsValues).length > 0) execution.analytics_values = analyticsValues;
    return execution;
  }

  /** The label of a field that changed since the preview: a dimension's current name, else the field's label. */
  private async conflictLabel(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    fieldName: string,
    storedLabels: unknown,
  ): Promise<string> {
    const axisId = analyticsAxisIdOfField(fieldName);
    if (lineScope(entityType) && fieldName === DEFAULT_ANALYTICS_FIELD) {
      const axis = (await loadAnalyticsAxes(context.manager, context.tenantId)).find((candidate) => candidate.is_default);
      return analyticsAxisLabel(axis ?? { name: null });
    }
    if (axisId) {
      const axis = (await loadAnalyticsAxes(context.manager, context.tenantId)).find((candidate) => candidate.id === axisId);
      if (axis) return analyticsAxisLabel(axis);
      const stored = storedLabels && typeof storedLabels === 'object' ? (storedLabels as Record<string, unknown>)[fieldName] : null;
      return typeof stored === 'string' && stored ? stored : fieldName;
    }
    return this.getConfig(entityType).fields[fieldName]?.label ?? fieldName;
  }

  private async logAiAudit(
    context: AiExecutionContextWithManager,
    preview: AiMutationPreview,
    entityType: AiBusinessRecordEntityType,
    action: 'create' | 'update',
    before: unknown,
    after: unknown,
  ): Promise<void> {
    const audit = buildAiMutationAudit(preview);
    await this.audit.log(
      {
        table: this.getConfig(entityType).tableName,
        recordId: preview.target_entity_id ?? null,
        action,
        before,
        after,
        userId: context.userId,
        source: audit.source,
        sourceRef: audit.sourceRef,
      },
      { manager: context.manager },
    );
  }

  private async createRecord(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    switch (entityType) {
      case 'applications':
        return this.applications.create(fields as any, context.userId, { manager: context.manager, tenantId: context.tenantId });
      case 'assets':
        return this.assets.create(fields as any, context.tenantId, context.userId, { manager: context.manager, tenantId: context.tenantId });
      case 'contracts':
        return this.contracts.create(fields as any, context.userId, { manager: context.manager });
      case 'projects':
        return this.portfolioProjects.create(fields as any, context.tenantId, context.userId, { manager: context.manager, tenantId: context.tenantId, userId: context.userId });
      case 'requests':
        return this.portfolioRequests.create(fields as any, context.tenantId, context.userId, { manager: context.manager });
      case 'interfaces':
        return this.interfaces.create(fields as any, context.tenantId, context.userId, { manager: context.manager });
      case 'connections':
        return this.connections.create(fields as any, context.tenantId, context.userId, { manager: context.manager });
      case 'spend_items':
        return this.spendItems.create(fields as any, context.userId, { manager: context.manager });
      case 'capex_items':
        return this.capexItems.create(fields as any, context.userId, { manager: context.manager });
    }
  }

  private async updateRecord(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    id: string,
    fields: Record<string, unknown>,
  ): Promise<unknown> {
    switch (entityType) {
      case 'applications':
        return this.applications.update(id, fields as any, context.userId, { manager: context.manager, tenantId: context.tenantId });
      case 'assets':
        return this.assets.update(id, fields as any, context.tenantId, context.userId, { manager: context.manager, tenantId: context.tenantId });
      case 'contracts':
        return this.contracts.update(id, fields as any, context.userId, { manager: context.manager });
      case 'projects':
        return this.portfolioProjects.update(id, fields as any, context.tenantId, context.userId, { manager: context.manager, tenantId: context.tenantId, userId: context.userId });
      case 'requests':
        return this.portfolioRequests.update(id, fields as any, context.tenantId, context.userId, { manager: context.manager });
      case 'interfaces':
        return this.interfaces.update(id, fields as any, context.tenantId, context.userId, { manager: context.manager });
      case 'connections':
        return this.connections.update(id, fields as any, context.tenantId, context.userId, { manager: context.manager });
      case 'spend_items':
        return this.spendItems.update(id, fields as any, context.userId, { manager: context.manager });
      case 'capex_items':
        return this.capexItems.update(id, fields as any, context.userId, { manager: context.manager });
    }
  }

  private async getRecordSnapshot(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    id: string,
  ): Promise<Record<string, unknown>> {
    switch (entityType) {
      case 'applications':
        return this.applications.get(id, {
          manager: context.manager,
          tenantId: context.tenantId,
          accessScope: await resolveBusinessContributorScopeForUser({
            manager: context.manager,
            userId: context.userId,
            tenantId: context.tenantId,
          }, 'applications', 'reader'),
        }) as any;
      case 'assets':
        return this.assets.get(id, { manager: context.manager, tenantId: context.tenantId }) as any;
      case 'contracts':
        return this.contracts.get(id, { manager: context.manager }) as any;
      case 'projects':
        return this.portfolioProjects.get(id, { include: 'relations,financials' }, { manager: context.manager, tenantId: context.tenantId }) as any;
      case 'requests':
        return this.portfolioRequests.get(id, { include: 'relations,financials' }, { manager: context.manager }) as any;
      case 'interfaces':
        return this.interfaces.get(id, { include: 'relations' }, { manager: context.manager }) as any;
      case 'connections':
        return this.connections.get(id, context.tenantId, { manager: context.manager, includeLegs: true }) as any;
      case 'spend_items':
        return this.spendItems.get(id, { manager: context.manager }) as any;
      case 'capex_items':
        return this.capexItems.get(id, { manager: context.manager }) as any;
    }
  }
}
