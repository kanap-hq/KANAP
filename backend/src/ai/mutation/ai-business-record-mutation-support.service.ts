import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { ApplicationsService } from '../../applications/services/applications.service';
import { AssetsService } from '../../assets/services/assets.service';
import { AuditService } from '../../audit/audit.service';
import {
  applicationParticipantCondition,
  resolveBusinessContributorScopeForUser,
} from '../../auth/business-contributor-scope';
import { ConnectionsService } from '../../connections/services/connections.service';
import { ContractsService } from '../../contracts/contracts.service';
import { InterfacesService } from '../../interfaces/services/interfaces.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../../technologies/catalog/technology-catalog.service';
import { TechnologiesService } from '../../technologies/technologies.service';
import { findCatalogOption } from '../../it-ops-settings/catalog-resolve';
import { withShippedLabels } from '../../it-ops-settings/catalog-shipped-labels';
import { ClassificationCatalog, resolveClassificationOption } from '../../it-ops-settings/classification-catalog';
import { PortfolioRequestsService } from '../../portfolio/portfolio-requests.service';
import { PortfolioProjectsService } from '../../portfolio/services';
import { BudgetLinesService } from '../../spend/budget-lines.service';
import { lockBudgetLine } from '../../spend/budget-locks';
import { auditTableOf, BUDGET_LINE_PREFIX, BUDGET_NATURES, BudgetNature, naturesAnd } from '../../spend/budget-nature';
import { parseItemNumber } from '../../common/parse-item-number';
import { budgetLineReferenceNumbers, parseItemRef, resolveBudgetLine } from '../../common/resolve-item-id';
import {
  DISABLED_VALUE_MESSAGE,
  dimensionPhrase,
  disabledDimensionMessage,
  isValueActive,
  itemAnalyticsFields,
  ItemAnalyticsScope,
  ItemAnalyticsValue,
  loadItemAnalyticsValues,
  missingRequiredDimensions,
  notApplicableDimensionMessage,
  notApplicableValueMessage,
  requiredDimensionMessage,
  valueAppliesTo,
} from '../../spend/item-analytics.util';
import {
  ANALYTICS_CSV_PREFIX,
  AnalyticsAxisInfo,
  analyticsAxisLabel,
  axisAppliesTo,
  axisRequiredFor,
  loadAnalyticsAxes,
} from '../../analytics/analytics-axes.util';
import { isActiveAt, parseEndOfValidityInput } from '../../common/status';
import { sameFieldValue } from '../../common/edit-conflicts';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager, AiMutationPreviewChangeDto, AiPreviewClassificationCatalog } from '../ai.types';
import { previewFieldOrder } from './ai-preview-field-order';
import { buildAiMutationAudit } from './ai-mutation-audit.util';
import { aiParticipationScopeSql } from '../query/ai-query-scope.util';
import {
  AiMutationPreviewPresentation,
  AiPreparedMutationPreview,
} from './ai-mutation-operation.types';
import { nameWithoutLeadingReference } from './name-without-leading-reference';
import { AiTaskMutationSupportService } from './ai-task-mutation-support.service';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES, INCIDENT_STATUS_RANK } from '../../incidents/incident.entity';
import {
  INCIDENT_LOCKED_MESSAGE,
  incidentVisibilitySql,
  isFrozenIncidentStatus,
  resolveIncidentViewer,
} from '../../incidents/incident-visibility';
import { IncidentsService } from '../../incidents/services/incidents.service';
import {
  AiWriteLanguage,
  PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE,
  incidentClosureWarning,
  incidentAccessWarning,
  previewSummaryText,
  quoted,
  technologyAdoptionCardText,
  writeActionText,
} from '../ai-write-texts';

export const AI_BUSINESS_RECORD_ENTITY_TYPES = [
  'applications',
  'assets',
  'contracts',
  'projects',
  'requests',
  'interfaces',
  'connections',
  'budget_lines',
  'incidents',
  'technologies',
] as const;

export type AiBusinessRecordEntityType = typeof AI_BUSINESS_RECORD_ENTITY_TYPES[number];

export type AiCreateBusinessRecordInput = {
  entity_type: AiBusinessRecordEntityType;
  fields: Record<string, unknown>;
  /** A new spend or CAPEX line's amounts for one year (`create_business_record` only). */
  amounts?: unknown;
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
  | 'incident_category'
  | 'it_catalog'
  | 'date_time'
  | 'non_negative_decimal'
  | 'percent'
  | 'relation'
  | 'text'
  | 'upper3';

/** The tenant's IT settings lists a `it_catalog` field takes its code and label from. */
type ItCatalogList = 'technologyFamilies' | 'lifecycleStates' | 'hostingTypes' | 'cyberCriticalityLevels' | 'recoveryWaves' | 'adminZones';

type FieldConfig = {
  label: string;
  kind: FieldKind;
  aliases?: readonly string[];
  nullable?: boolean;
  requiredOnCreate?: boolean;
  enumValues?: readonly string[];
  relationTarget?: RelationTarget;
  classificationAxis?: 'business' | 'cyber' | 'confidentiality' | 'recovery';
  /** A tenant catalog of IT settings: the card accepts the code or the exact label and shows the label. */
  itCatalog?: ItCatalogList;
  minimum?: number;
  maximum?: number;
  /** The service's text bound, in characters; absent keeps the generic text rule. */
  maxLength?: number;
};

type EntityConfig = {
  labelSingular: string;
  labelPlural: string;
  businessResource: string;
  /** The table the audit log names for the record: a CAPEX line keeps its CAPEX label (`auditTableOf`). */
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
      admin_zone: { label: 'Administration Zone', kind: 'text', nullable: true },
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
      cost_center_id: { label: 'Cost center', kind: 'relation', nullable: true, relationTarget: 'cost_centers', aliases: ['cost_center'] },
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
  incidents: {
    labelSingular: 'incident',
    labelPlural: 'incidents',
    businessResource: 'incidents',
    tableName: 'incidents',
    fields: {
      title: { label: 'Title', kind: 'text', requiredOnCreate: true },
      category: { label: 'Category', kind: 'incident_category', nullable: true },
      severity: { label: 'Severity', kind: 'enum', enumValues: INCIDENT_SEVERITIES, requiredOnCreate: true },
      status: { label: 'Status', kind: 'enum', enumValues: INCIDENT_STATUSES },
      started_at: { label: 'Started', kind: 'date_time', nullable: true },
      // Always stamped: a null would only be refused by the table at execution.
      detected_at: { label: 'Detected', kind: 'date_time' },
      resolved_at: { label: 'Resolved', kind: 'date_time', nullable: true },
      closed_at: { label: 'Closed', kind: 'date_time', nullable: true },
      reporter_user_id: { label: 'Reporter', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['reporter'] },
      owner_user_id: { label: 'Owner', kind: 'relation', nullable: true, relationTarget: 'users', aliases: ['owner'] },
      description: { label: 'Description', kind: 'text', nullable: true },
      source_ref: { label: 'External reference', kind: 'text', nullable: true },
      personal_data_affected: { label: 'Personal data affected', kind: 'boolean' },
      authority_notification_required: { label: 'Authority notification required', kind: 'boolean' },
      confidential: { label: 'Restricted access', kind: 'boolean' },
      authority_notified_at: { label: 'Authority notified on', kind: 'date_time', nullable: true },
      notified_parties: { label: 'Parties informed', kind: 'text', nullable: true },
    },
  },
  technologies: {
    labelSingular: 'technology',
    labelPlural: 'technologies',
    businessResource: 'infrastructure',
    tableName: 'technologies',
    fields: {
      name: { label: 'Name', kind: 'text', requiredOnCreate: true, maxLength: 200 },
      editor: { label: 'Editor', kind: 'text', nullable: true, maxLength: 200 },
      family: { label: 'Family', kind: 'it_catalog', itCatalog: 'technologyFamilies' },
      lifecycle: { label: 'Lifecycle', kind: 'it_catalog', itCatalog: 'lifecycleStates' },
      hosting_type: { label: 'Hosting type', kind: 'it_catalog', itCatalog: 'hostingTypes' },
      description: { label: 'Description', kind: 'text', nullable: true, maxLength: 20000 },
      notes: { label: 'Notes', kind: 'text', nullable: true, maxLength: 20000 },
      support_notes: { label: 'Support notes', kind: 'text', nullable: true, maxLength: 20000 },
      replaced_by_id: { label: 'Replaced by', kind: 'relation', nullable: true, relationTarget: 'technologies', aliases: ['replaced_by'] },
      cyber_criticality: { label: 'Cyber criticality', kind: 'it_catalog', itCatalog: 'cyberCriticalityLevels', nullable: true, aliases: ['cyber'] },
      recovery_wave: { label: 'Recovery wave', kind: 'it_catalog', itCatalog: 'recoveryWaves', nullable: true, aliases: ['wave'] },
      rto_minutes: { label: 'RTO (minutes)', kind: 'integer', nullable: true, minimum: 1, maximum: 5256000, aliases: ['rto'] },
      rpo_minutes: { label: 'RPO (minutes)', kind: 'integer', nullable: true, minimum: 0, maximum: 5256000, aliases: ['rpo'] },
      admin_zone: { label: 'Administration zone', kind: 'it_catalog', itCatalog: 'adminZones', nullable: true },
    },
  },
  budget_lines: {
    labelSingular: 'budget line',
    labelPlural: 'budget lines',
    businessResource: 'budget',
    tableName: 'spend_items',
    fields: {
      // The nature is required on create and never changes here: a change of type is the budget
      // screen's action (`spend/budget-lines.service.ts`, `changeType`).
      nature: { label: 'Nature', kind: 'enum', enumValues: BUDGET_NATURES, requiredOnCreate: true },
      product_name: { label: 'Title', kind: 'text', requiredOnCreate: true, aliases: ['name'] },
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
      // OPEX only: `BudgetLinesService` refuses it on a CAPEX line, and the preview refuses it first.
      contract_id: { label: 'Contract', kind: 'relation', nullable: true, relationTarget: 'contracts', aliases: ['contract'] },
      status: { label: 'Status', kind: 'enum', enumValues: STATUS_STATES },
      disabled_at: { label: 'End of validity', kind: 'date', nullable: true, aliases: ['end_of_validity'] },
      notes: { label: 'Notes', kind: 'text', nullable: true },
    },
  },

};

/** Every field of the incident family, as the contributor screen accepts them. */
export const AI_INCIDENT_WRITABLE_FIELDS: readonly string[] = Object.keys(ENTITY_CONFIG.incidents.fields);

/**
 * The technology fields Plaid never writes, and the sentence that says where they are set:
 * the CPE and CVE matching fields (lot 5 keeps them to the matcher), the catalog key (an
 * adoption), `mode` (replaced by `hosting_type`) and the vulnerability alert setting (lot 5).
 */
const TECHNOLOGY_REFUSED_FIELDS: Record<string, string> = {
  cpe_products: 'CPE products are filled by the vulnerability matching, not by a record write.',
  cve_names: 'CVE names are filled by the vulnerability matching, not by a record write.',
  catalog_key: 'A catalog key comes from adopting the catalog entry, not from a record write.',
  mode: 'mode is replaced by hosting_type.',
  vulnerability_alerts: 'Vulnerability alerts are set with set_technology_vulnerability_alerts, not as a field of the record.',
  attachment: "Attachments are added from the technology's Relations tab, not by a record write.",
  attachments: "Attachments are added from the technology's Relations tab, not by a record write.",
  file: "Attachments are added from the technology's Relations tab, not by a record write.",
  technology_attachments: "Attachments are added from the technology's Relations tab, not by a record write.",
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

/** The field of a line's default analytics dimension (`analytics_category` for the model). */
const DEFAULT_ANALYTICS_FIELD = 'analytics_category_id';
/**
 * The stored key of another analytics dimension of a line: built on the
 * dimension id, so renaming the dimension between preview and apply changes
 * nothing. The model addresses it as `analytics:<code>`; `normalizeFields`
 * accepts both (undo re-feeds the stored keys).
 */
const ANALYTICS_AXIS_FIELD_PREFIX = 'analytics_axis:';

function isBudgetLineEntity(entityType: AiBusinessRecordEntityType): entityType is 'budget_lines' {
  return entityType === 'budget_lines';
}

/** The nature a stored line carries, else null (a record of another family). */
function lineNatureOf(row: Record<string, unknown> | null | undefined): BudgetNature | null {
  const nature = row?.nature;
  return nature === 'opex' || nature === 'capex' ? nature : null;
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

/** The list of the catalog each classification axis reads. */
const CLASSIFICATION_CATALOG_LISTS: Record<NonNullable<FieldConfig['classificationAxis']>, AiPreviewClassificationCatalog> = {
  business: 'businessCriticalityLevels',
  cyber: 'cyberCriticalityLevels',
  confidentiality: 'dataClasses',
  recovery: 'recoveryWaves',
};

/** The options of one classification axis of the tenant's catalog. */
function classificationOptions(catalog: ClassificationCatalog, axis: NonNullable<FieldConfig['classificationAxis']>) {
  switch (axis) {
    case 'business': return catalog.businessCriticalityLevels;
    case 'cyber': return catalog.cyberCriticalityLevels;
    case 'confidentiality': return catalog.dataClasses;
    default: return catalog.recoveryWaves;
  }
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

/**
 * Reads the technology instruction `from_catalog` (true or false) out of the given fields and
 * removes it, so it never reaches normalization or the write. Absent means "the catalog first".
 */
function takeFromCatalogFlag(fields: Record<string, unknown>): boolean | undefined {
  const key = Object.keys(fields).find((name) => normalizeFieldKey(name) === 'from_catalog');
  if (!key) return undefined;
  const value = fields[key];
  delete fields[key];
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new BadRequestException('from_catalog must be true or false.');
}

@Injectable()
export class AiBusinessRecordMutationSupportService {
  constructor(
    private readonly applications: ApplicationsService,
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
    private readonly budgetLines: BudgetLinesService,
    private readonly connections: ConnectionsService,
    private readonly contracts: ContractsService,
    private readonly interfaces: InterfacesService,
    private readonly itOpsSettings: ItOpsSettingsService,
    private readonly portfolioProjects: PortfolioProjectsService,
    private readonly portfolioRequests: PortfolioRequestsService,
    private readonly taskSupport: AiTaskMutationSupportService,
    private readonly incidents: IncidentsService,
    private readonly technologies: TechnologiesService,
    private readonly technologyCatalog: TechnologyCatalogService,
  ) {}

  getBusinessResource(entityType: unknown): string {
    return getAiBusinessRecordBusinessResource(entityType);
  }

  getWritableFieldDescriptions(entityTypes: readonly AiBusinessRecordEntityType[] = AI_BUSINESS_RECORD_ENTITY_TYPES): string[] {
    return entityTypes.map((entityType) => {
      const fields = Object.keys(ENTITY_CONFIG[entityType].fields);
      // The tenant's other analytics dimensions (listed per tenant in the prompt context).
      if (isBudgetLineEntity(entityType)) fields.push(`${ANALYTICS_CSV_PREFIX}<dimension code>`);
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
        // A new assignment names an enabled node; the stored one is kept as it is. A line takes a
        // cost center only (spec §2.3); a contract takes a group or a cost center (spec §3.3).
        if (entityType !== 'contracts' && relation.row.kind !== 'cost_center') throw new BadRequestException('Choose a cost center, not a group.');
        if (!isActiveAt(relation.row.disabled_at as any)) throw new BadRequestException('This cost center is disabled.');
      }
      return { value: relation?.id ?? null, displayValue: relation?.label ?? null };
    }

    if (field.kind === 'boolean') {
      return this.normalizeBoolean(rawValue, field);
    }
    if (field.kind === 'integer') {
      const parsed = Number(rawValue);
      const maximum = field.maximum ?? 2147483647;
      if (!Number.isInteger(parsed) || parsed > maximum || (field.minimum !== undefined && parsed < field.minimum)) {
        throw new BadRequestException(`${field.label} must be an integer${field.minimum !== undefined ? ` from ${field.minimum} to ${maximum}` : ''}.`);
      }
      return { value: parsed, displayValue: String(parsed) };
    }
    if (field.kind === 'non_negative_decimal' || field.kind === 'percent') {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed) || parsed < 0) throw new BadRequestException(`${field.label} must be a non-negative number.`);
      if (field.kind === 'percent' && parsed > 100) throw new BadRequestException(`${field.label} must be between 0 and 100.`);
      return { value: parsed, displayValue: String(parsed) };
    }
    if (field.kind === 'date_time') {
      // ISO 8601 with an explicit offset: the model converts a said time into the person's
      // `time_zone` and says which instant it means; a bare day would be ambiguous.
      const text = String(rawValue).trim();
      const withZone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(text);
      const parsed = new Date(text);
      if (!withZone || Number.isNaN(parsed.getTime())) {
        throw new BadRequestException(`${field.label} must be an ISO date-time with a time zone, for example 2026-10-28T15:00:00+01:00.`);
      }
      return { value: parsed.toISOString(), displayValue: parsed.toISOString() };
    }
    if (field.kind === 'date' && entityType === 'budget_lines' && (fieldName === 'disabled_at' || fieldName === 'effective_end')) {
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
    if (field.kind === 'it_catalog') {
      // The tenant's own list, with the labels the app shows for a shipped value in every
      // language: the code or an exact label is accepted. A retired value is refused unless it is
      // the one the record already holds, as the screen hides it. An ambiguous label is refused.
      const settings = withShippedLabels(await this.itOpsSettings.getSettings(context.tenantId, { manager: context.manager }));
      const options = field.itCatalog
        ? settings[field.itCatalog] as Array<{ code: string; label: string; deprecated?: boolean }>
        : [];
      const current = existing?.[fieldName] == null ? null : String(existing[fieldName]);
      const option = findCatalogOption(rawValue, options, current, true);
      if (!option) {
        const allowed = options
          .filter((item) => !item.deprecated || item.code === current)
          .slice(0, 10)
          .map((item) => item.label || item.code)
          .join(', ');
        throw new BadRequestException(
          `Unknown ${field.label.toLowerCase()} "${String(rawValue).trim()}". Valid values: ${allowed}.`,
        );
      }
      // The card shows the code: the frontend names it from the same list in the person's language.
      return { value: option.code, displayValue: option.code };
    }
    if (field.kind === 'incident_category') {
      const settings = await this.itOpsSettings.getSettings(context.tenantId, { manager: context.manager });
      const current = existing?.[fieldName] == null ? null : String(existing[fieldName]);
      // A deprecated category is refused unless it is the one the incident already holds; the
      // refusal lists only the categories a new value may take, as the screen's selector does.
      const option = findCatalogOption(rawValue, settings.incidentCategories, current, true);
      if (!option) {
        const allowed = settings.incidentCategories
          .filter((item) => !item.deprecated || item.code === current)
          .map((item) => item.label || item.code)
          .join(', ');
        throw new BadRequestException(`Unknown incident category "${String(rawValue).trim()}". Valid incident categories: ${allowed}.`);
      }
      // The card names the category from the tenant's own list in the person's language: keep the code.
      return { value: option.code, displayValue: option.code };
    }
    if (field.kind === 'application_classification') {
      if (!catalog || !field.classificationAxis) throw new BadRequestException('Application classification catalog is unavailable.');
      const options = classificationOptions(catalog, field.classificationAxis);
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
    if (field.maxLength !== undefined && text.length > field.maxLength) {
      throw new BadRequestException(`${field.label} must be ${field.maxLength} characters or fewer.`);
    }
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

  /**
   * The nature of a budget line being written: `nature` on create, the stored line's on update.
   * A change of nature is the budget screen's action, refused here before any preview.
   */
  private lineNatureForWrite(
    rawFields: Record<string, unknown>,
    mode: 'create' | 'update',
    existing?: Record<string, unknown> | null,
  ): BudgetNature {
    const rawNature = Object.entries(rawFields).find(([name]) => normalizeFieldKey(name) === 'nature');
    if (mode === 'update') {
      if (rawNature) {
        throw new BadRequestException('The nature of a budget line cannot be changed here: change the line type in the budget screen.');
      }
      const nature = lineNatureOf(existing);
      if (!nature) throw new BadRequestException('The budget line nature could not be read.');
      return nature;
    }
    const value = rawNature ? String(rawNature[1] ?? '').trim().toLowerCase() : '';
    if (value !== 'opex' && value !== 'capex') {
      throw new BadRequestException('nature is required to create a budget line: opex or capex.');
    }
    return value;
  }

  /**
   * The status rules of the incident screen, checked before any preview: an incident is created
   * open or in progress and it only moves forward. Cancelling and lifting the confidentiality are
   * separate administrator actions, so the field path names their tools. The service
   * checks again at apply.
   */
  private assertIncidentTransition(
    fields: Record<string, unknown>,
    mode: 'create' | 'update',
    existing?: Record<string, unknown> | null,
  ): void {
    const status = fields.status as string | undefined;
    if (status !== undefined) {
      if (status === 'cancelled') {
        throw new BadRequestException('Cancelling an incident needs a register administrator: use `change_incident_state`.');
      }
      if (mode === 'create') {
        if (status !== 'open' && status !== 'in_progress') {
          throw new BadRequestException('An incident is created open or in progress. Create it open, then move it forward so the step stays visible.');
        }
      } else {
        const current = String(existing?.status ?? '');
        if (current
          && INCIDENT_STATUS_RANK[status as keyof typeof INCIDENT_STATUS_RANK]
            < INCIDENT_STATUS_RANK[current as keyof typeof INCIDENT_STATUS_RANK]) {
          throw new BadRequestException('Status cannot move backwards: reopening an incident needs a register administrator (`change_incident_state`).');
        }
      }
    }
    if (mode === 'update' && fields.confidential === false && existing?.confidential === true) {
      throw new BadRequestException('Lifting the confidentiality needs a register administrator: use `set_incident_confidentiality`.');
    }
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

    // A budget line also writes its analytics dimensions (the tenant's, loaded once when named).
    // Its nature is given on create and read from the stored line on update; a change of nature
    // is the budget screen's action, refused here before any preview.
    const isLine = isBudgetLineEntity(entityType);
    const nature: BudgetNature | null = isLine ? this.lineNatureForWrite(rawFields, mode, existing) : null;
    const scope: ItemAnalyticsScope | null = nature;
    let axes: AnalyticsAxisInfo[] | null = null;
    const tenantAxes = async () => (axes ??= await loadAnalyticsAxes(context.manager, context.tenantId));

    for (const [rawName, rawValue] of Object.entries(rawFields)) {
      if (rawValue === undefined) continue;
      if (entityType === 'technologies') {
        const refused = Object.entries(TECHNOLOGY_REFUSED_FIELDS)
          .find(([name]) => normalizeFieldKey(name) === normalizeFieldKey(rawName));
        if (refused) throw new BadRequestException(refused[1]);
      }
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
      if (isLine && resolved.name === 'contract_id' && nature === 'capex') {
        throw new BadRequestException('A contract cannot be written on a CAPEX line: link the contract from the line\'s Relations tab instead.');
      }
      let normalized: { value: unknown; displayValue: string | null };
      let label = resolved.config.label;
      if (scope && isAnalyticsDimensionField(resolved.name)) {
        // Any dimension of a line, the default one included (however addressed), takes the gate's rules
        // and shows the dimension's name. A tenant still without its default dimension holds no value on it.
        const dimensionAxis = axis ?? (await tenantAxes()).find((candidate) => candidate.is_default) ?? null;
        label = analyticsAxisLabel(dimensionAxis ?? { name: null });
        if (dimensionAxis) {
          const currentId = (existing?.[resolved.name] as string | null | undefined) ?? null;
          const dimension = await this.normalizeDimensionValue(context, scope, dimensionAxis, rawValue, currentId);
          // A dimension the line may not change passes its current value as a no-op: nothing to create.
          if (dimension.locked && mode === 'create') continue;
          // The write gate's rule: a required dimension cannot lose the value the line holds.
          if (mode === 'update' && dimension.value === null && currentId && axisRequiredFor(dimensionAxis, scope)) {
            throw new BadRequestException(requiredDimensionMessage(dimensionAxis));
          }
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

    if (isLine && Object.prototype.hasOwnProperty.call(fields, 'effective_end')) {
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
    if (entityType === 'incidents') {
      this.assertIncidentTransition(fields, mode, existing);
    }
    if (mode === 'create') {
      for (const [name, field] of Object.entries(config.fields)) {
        if (!field.requiredOnCreate) continue;
        const value = fields[name];
        if (value == null || value === '' || (Array.isArray(value) && value.length === 0)) {
          throw new BadRequestException(`${field.label} is required for ${config.labelSingular} creation.`);
        }
      }
      if (scope) {
        // A new line needs a value on each dimension required for its type (the write gate checks again).
        const lineAxes = await tenantAxes();
        const values = new Map(lineAxes.map((axis) => [
          axis.id,
          (fields[axis.is_default ? DEFAULT_ANALYTICS_FIELD : analyticsAxisFieldKey(axis.id)] as string | null | undefined) ?? null,
        ]));
        const [missing] = missingRequiredDimensions(lineAxes, values, scope);
        if (missing) {
          throw new BadRequestException(`${analyticsAxisLabel(missing)} is required for ${config.labelSingular} creation.`);
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

  /**
   * The one record a uuid, business reference or exact name names, with the label the screens
   * show. Shared with the delete of a connection or an interface.
   */
  async resolveRecordReference(
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

  private async queryReferenceCandidates(
    context: AiExecutionContextWithManager,
    entityType: RelationTarget,
    ref: string,
  ): Promise<Record<string, unknown>[]> {
    const uuid = isUuid(ref);
    const rawDigits = ref.match(/(?:^|[-\s])(\d+)$/)?.[1];
    const itemNumber = rawDigits == null ? 0 : (parseItemNumber(rawDigits) ?? -1);
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
      case 'requests': {
        // A Business Contributor finds only the records of their participation scope, as they read
        // them: one outside it reads as missing (lot D11).
        const params: unknown[] = [tenantId, ref, Number.isInteger(itemNumber) ? itemNumber : -1];
        const scopeSql = await aiParticipationScopeSql(context, entityType, 'x', params);
        return manager.query(
          `
          SELECT x.* FROM ${entityType === 'projects' ? 'portfolio_projects' : 'portfolio_requests'} x
          WHERE x.tenant_id = $1
            AND (${uuid ? 'x.id = $2 OR ' : ''}LOWER(x.name) = LOWER($2::text) OR x.item_number = $3)
            ${scopeSql}
          ORDER BY x.item_number LIMIT 6
          `,
          params,
        );
      }
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
      case 'incidents': {
        // The reference, the exact title, or the uuid, with the viewer's confidentiality rule: a
        // hidden incident matches nothing, as it does on the screen.
        const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
        const params: unknown[] = [tenantId, ref, Number.isInteger(itemNumber) ? itemNumber : -1];
        const visibility = incidentVisibilitySql('incident_row', viewer, params);
        return manager.query(
          `SELECT * FROM incidents incident_row
            WHERE incident_row.tenant_id = $1
              AND (${uuid ? 'incident_row.id = $2 OR ' : ''}LOWER(incident_row.title) = LOWER($2::text) OR incident_row.item_number = $3)
              ${visibility}
            ORDER BY incident_row.item_number LIMIT 6`,
          params,
        );
      }
      case 'technologies':
        return manager.query(
          `SELECT * FROM technologies WHERE tenant_id = $1
            AND (${uuid ? 'id = $2 OR ' : ''}LOWER(name) = LOWER($2::text) OR item_number = $3)
          ORDER BY item_number LIMIT 6`,
          [tenantId, ref, Number.isInteger(itemNumber) ? itemNumber : -1],
        );
      case 'budget_lines': {
        // Both natures in one family (`spend/budget-nature.ts`): by id, native title, own number
        // (BL-n or a bare number) or legacy number (OPX-n, CPX-n). Each row keeps its nature.
        const number = budgetLineReferenceNumbers(ref);
        const rows: Record<string, unknown>[] = await manager.query(
          `SELECT * FROM spend_items WHERE tenant_id = $1 AND (${uuid ? 'id = $2 OR ' : ''}LOWER(product_name) = LOWER($2::text) OR item_number = $3 OR legacy_number = $4::text)${naturesAnd(null, BUDGET_NATURES)} ORDER BY product_name LIMIT 6`,
          [tenantId, ref, number.itemNumber, number.legacyNumber],
        );
        return this.withDefaultAnalyticsValue(context, rows);
      }
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
    rows: Record<string, unknown>[],
  ): Promise<Record<string, unknown>[]> {
    const values = new Map<string, ItemAnalyticsValue[]>();
    for (const nature of BUDGET_NATURES) {
      const ids = rows.filter((row) => lineNatureOf(row) === nature).map((row) => String(row.id));
      if (ids.length === 0) continue;
      for (const [id, lineValues] of await loadItemAnalyticsValues(context.manager, nature, context.tenantId, ids)) {
        values.set(id, lineValues);
      }
    }
    return rows.map((row) => {
      const lineValues = values.get(String(row.id)) ?? [];
      return { ...row, ...analyticsValueKeys(lineValues), analytics_category_id: itemAnalyticsFields(lineValues).analytics_category_id };
    });
  }

  /** A line snapshot (`get`) with every dimension's value under its stored key as well. */
  private withAnalyticsValueKeys(entityType: AiBusinessRecordEntityType, row: Record<string, unknown>): Record<string, unknown> {
    if (!isBudgetLineEntity(entityType)) return row;
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
    // The value a field holds, as the new one is shown: a classification by its catalog label, a
    // linked record by its name. A record that no longer resolves keeps its stored value.
    const fields = this.getConfig(entityType).fields;
    let catalog: ClassificationCatalog | null = null;
    for (const [fieldName, value] of Object.entries(previousValues)) {
      const field = fields[fieldName];
      // The analytics dimensions of a line are named below, from their values.
      if (!field || typeof value !== 'string' || !value || isAnalyticsDimensionField(fieldName)) continue;
      if (field.kind === 'application_classification' && field.classificationAxis) {
        catalog ??= await this.itOpsSettings.getClassificationCatalog(context.tenantId, { manager: context.manager });
        display[fieldName] = classificationOptions(catalog, field.classificationAxis).find((option) => option.code === value)?.label ?? value;
      } else if (field.kind === 'relation' && field.relationTarget && isUuid(value)) {
        try {
          display[fieldName] = (await this.resolveRelation(context, field.relationTarget, value, field.label, previousValues))?.label ?? value;
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
      }
    }
    if (!isBudgetLineEntity(entityType)) return display;
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
      case 'budget_lines': return row.item_number == null ? null : `${BUDGET_LINE_PREFIX}-${row.item_number}`;
      case 'incidents': return row.item_number == null ? null : `INC-${row.item_number}`;
      case 'technologies': return row.item_number == null ? null : `TEC-${row.item_number}`;
      case 'accounts': return textOrNull(row.account_number);
      case 'cost_centers': return textOrNull(row.code);
      default: return null;
    }
  }

  private recordTitle(entityType: RelationTarget, row: Record<string, unknown>): string {
    switch (entityType) {
      case 'applications': {
        const reference = textOrNull(row.sequential_id);
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.name))].filter(Boolean).join(' - ') || 'Untitled application';
      }
      case 'assets': {
        const reference = textOrNull(row.asset_reference);
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.name))].filter(Boolean).join(' - ') || 'Untitled asset';
      }
      case 'interfaces': {
        const reference = textOrNull(row.interface_reference) || textOrNull(row.interface_id);
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.name))].filter(Boolean).join(' - ') || 'Untitled interface';
      }
      case 'connections': {
        const reference = textOrNull(row.connection_reference);
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.name))].filter(Boolean).join(' - ') || 'Untitled connection';
      }
      case 'projects': {
        const reference = row.item_number == null ? null : `PRJ-${row.item_number}`;
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.name))].filter(Boolean).join(' - ') || 'Untitled project';
      }
      case 'requests': {
        const reference = row.item_number == null ? null : `REQ-${row.item_number}`;
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.name))].filter(Boolean).join(' - ') || 'Untitled request';
      }
      case 'budget_lines':
        return textOrNull(row.product_name) || 'Untitled budget line';
      case 'incidents': {
        const reference = this.recordRef('incidents', row);
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.title))].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled incident';
      }
      case 'technologies': {
        const reference = this.recordRef('technologies', row);
        return [reference, nameWithoutLeadingReference(reference, textOrNull(row.name))].map(textOrNull).filter(Boolean).join(' - ') || 'Untitled technology';
      }
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

  /**
   * What the incident card warns about before approval, computed from the state the write would
   * leave: the record freezes on closure (only an administrator reopens it), and a restricted
   * incident whose reporter and owner are both somebody else disappears from the person's
   * register (the screen's `loseAccessMessage`). The card says it; the write itself is offered.
   */
  private async incidentWriteWarnings(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    existing: Record<string, unknown> | null,
    fields: Record<string, unknown>,
  ): Promise<Record<string, boolean> | undefined> {
    if (entityType !== 'incidents') return undefined;
    const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
    const confidential = fields.confidential !== undefined
      ? fields.confidential === true
      : existing?.confidential === true;
    // On a change, an incident without a reporter stays without one: only a creation defaults
    // the reporter to the person, as the screen does.
    const reporter = fields.reporter_user_id !== undefined
      ? fields.reporter_user_id
      : (existing ? (existing.reporter_user_id ?? null) : context.userId);
    const owner = fields.owner_user_id !== undefined
      ? fields.owner_user_id
      : (existing?.owner_user_id ?? null);
    const stillVisible = !!viewer.isAdmin
      || String(reporter ?? '') === String(viewer.userId ?? '')
      || String(owner ?? '') === String(viewer.userId ?? '');
    const losesAccess = confidential && !stillVisible;
    const closure = fields.status === 'closed' && existing?.status !== 'closed';
    if (!losesAccess && !closure) return undefined;
    return {
      ...(closure ? { closure: true } : {}),
      ...(losesAccess ? { lose_access: true } : {}),
    };
  }

  async prepareCreatePreview(
    context: AiExecutionContextWithManager,
    input: AiCreateBusinessRecordInput,
  ): Promise<AiPreparedMutationPreview> {
    const entityType = requireEntityType(input.entity_type);
    // A shallow copy: `from_catalog` is read out of the preparation input without touching the
    // step input a plan keeps.
    const rawFields = { ...coerceRecord(input.fields, 'fields') };
    // `from_catalog: false` asks for a typed technology, never for an adoption. It is an
    // instruction to this preparation, not a column the write carries.
    const fromCatalog = entityType === 'technologies' ? takeFromCatalogFlag(rawFields) : undefined;
    if (entityType === 'technologies') {
      // The completion of a hand-typed record normalises against that record (update mode), so the
      // name is checked here rather than by a create-mode pass that would not know the current values.
      if (!String(rawFields.name ?? '').trim()) {
        throw new BadRequestException('Name is required for technology creation.');
      }
      return this.prepareTechnologyCreate(context, rawFields, fromCatalog);
    }
    const normalized = await this.normalizeFields(context, entityType, rawFields, 'create');
    // An incident is created open when the request names no status: the card says which step it
    // starts at. The service applies the same default.
    if (entityType === 'incidents' && normalized.fields.status === undefined) {
      normalized.fields.status = 'open';
      normalized.displayValues.status = 'open';
      normalized.fieldLabels.status = ENTITY_CONFIG.incidents.fields.status.label;
    }
    const classification = entityType === 'applications'
      ? this.applicationClassificationPreviewState(normalized.fields, null)
      : null;
    const title = this.titleForPendingCreate(entityType, normalized.fields);
    const warnings = await this.incidentWriteWarnings(context, entityType, null, normalized.fields);
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
        ...(warnings ? { warnings } : {}),
      },
      currentValues: {
        target_ref: null,
        target_title: title,
        values: null,
        display_values: null,
      },
    };
  }

  /**
   * A technology is adopted from the KANAP catalog when it knows the exact name, typed free
   * otherwise or when `from_catalog: false` asks for it. A hand-typed record of the same name,
   * without a catalog key, is completed by the exact catalog entry when there is one (the card
   * names it and what the adoption adds); otherwise a same-name technology is refused here with
   * its reference, and an ambiguous name lists the closest catalog entries.
   *
   * A completion keeps the record's current values: its other fields are normalised in update mode
   * against that record, a field equal to the current value leaves the card, and the execution
   * compares each requested field with the live one before writing (the `update_business_record`
   * drift check).
   */
  private async prepareTechnologyCreate(
    context: AiExecutionContextWithManager,
    rawFields: Record<string, unknown>,
    fromCatalog: boolean | undefined,
  ): Promise<AiPreparedMutationPreview> {
    const name = String(rawFields.name ?? '').trim();
    const sameName: Array<{ id: string; item_number: number; catalog_key: string | null }> = await context.manager.query(
      `SELECT id, item_number, catalog_key FROM technologies
        WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`,
      [context.tenantId, name],
    );
    const title = name;
    if (fromCatalog !== false) {
      const catalog = await this.technologyCatalog.notAdopted(
        { q: name },
        { manager: context.manager, tenantId: context.tenantId, userId: context.userId },
      );
      const wanted = name.toLowerCase();
      const exact = catalog.items.find((item) => item.name.trim().toLowerCase() === wanted);
      const existing = sameName[0] ?? null;
      if (exact && (!existing || (!existing.catalog_key && exact.completes_id === existing.id))) {
        // The adoption writes the record, or completes the hand-typed one the card names; the other
        // given fields are an update in the same transaction. The card lists them apart.
        const existingRow = existing ? await this.getRecordSnapshot(context, 'technologies', existing.id) : null;
        const normalized = await this.normalizeFields(
          context,
          'technologies',
          rawFields,
          existingRow ? 'update' : 'create',
          existingRow,
        );
        let fields = { ...normalized.fields };
        let displayValues = { ...normalized.displayValues };
        let fieldLabels = { ...normalized.fieldLabels };
        delete fields.name;
        delete displayValues.name;
        delete fieldLabels.name;
        let previousValues: Record<string, unknown> = {};
        let previousDisplayValues: Record<string, unknown> = {};
        if (existingRow) {
          // A requested field equal to the current value is not a change: it leaves the card and
          // the write, and it is not part of the drift check.
          const current = this.pickFieldValues('technologies', existingRow, Object.keys(fields));
          const changed = Object.keys(fields).filter((fieldName) => !sameValue(current[fieldName], fields[fieldName]));
          const changedFields: Record<string, unknown> = {};
          const changedDisplay: Record<string, string | null> = {};
          const changedLabels: Record<string, string> = {};
          previousValues = {};
          for (const fieldName of changed) {
            changedFields[fieldName] = fields[fieldName];
            changedDisplay[fieldName] = displayValues[fieldName];
            changedLabels[fieldName] = fieldLabels[fieldName];
            previousValues[fieldName] = current[fieldName];
          }
          fields = changedFields;
          displayValues = changedDisplay;
          fieldLabels = changedLabels;
          previousDisplayValues = await this.previousDisplayValues(context, 'technologies', previousValues);
        }
        return {
          targetEntityType: 'technologies',
          targetEntityId: existing?.id ?? null,
          mutationInput: {
            action: 'create',
            entity_type: 'technologies',
            fields,
            display_values: displayValues,
            field_labels: fieldLabels,
            adopt: {
              catalog_key: exact.key,
              name: exact.name,
              // The code: the card's family field names it from the tenant's list on the frontend.
              family: exact.family,
              versions: exact.versions,
              support_from: exact.support_from,
              support_to: exact.support_to,
              completes: exact.completes
                ? {
                  id: exact.completes_id,
                  ref: exact.completes,
                  missing_versions: exact.completes_missing_versions ?? [],
                  fills_description: exact.completes_description_empty === true,
                }
                : null,
            },
          },
          currentValues: {
            target_ref: exact.completes ?? null,
            target_title: exact.completes ? `${exact.completes} - ${title}` : title,
            values: existingRow ? previousValues : null,
            display_values: existingRow ? previousDisplayValues : null,
          },
        };
      }
      if (existing) {
        throw new BadRequestException(`A technology with this name already exists: TEC-${existing.item_number}.`);
      }
      const closest = catalog.items
        .filter((item) => item.name.trim().toLowerCase().includes(wanted))
        .slice(0, 5);
      if (closest.length > 0) {
        throw new BadRequestException(
          `No exact KANAP catalog entry for "${name}". Closest entries: ${closest.map((item) => item.name).join(', ')}. `
          + 'Choose one of them, or ask for a free entry with from_catalog: false.',
        );
      }
    }
    if (sameName[0]) {
      throw new BadRequestException(`A technology with this name already exists: TEC-${sameName[0].item_number}.`);
    }
    const normalized = await this.normalizeFields(context, 'technologies', rawFields, 'create');
    return {
      targetEntityType: 'technologies',
      targetEntityId: null,
      mutationInput: {
        action: 'create',
        entity_type: 'technologies',
        fields: normalized.fields,
        display_values: normalized.displayValues,
        field_labels: normalized.fieldLabels,
      },
      currentValues: {
        target_ref: null,
        target_title: title,
        values: null,
        display_values: null,
      },
    };
  }

  /**
   * The screen's checks before an update: a new name is free, and the replacement is not the
   * technology itself and makes no cycle. The service checks again at execution.
   */
  private async assertTechnologyUpdateRules(
    context: AiExecutionContextWithManager,
    technologyId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    if (fields.name != null && fields.name !== '') {
      await this.technologies.assertNameFree(context.manager, context.tenantId, String(fields.name), technologyId);
    }
    if (fields.replaced_by_id != null && fields.replaced_by_id !== '') {
      const replacementId = String(fields.replaced_by_id);
      if (replacementId === technologyId) throw new BadRequestException('A technology cannot replace itself.');
      await this.technologies.assertNoReplacementCycle(context.manager, context.tenantId, technologyId, replacementId);
    }
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
    if (entityType === 'incidents') {
      const changed = coerceRecord(preview.mutation_input?.fields, 'mutation_input.fields');
      // Going back would reopen the incident (administrator) or lift its confidentiality (lot 4):
      // neither is a field to restore.
      if (changed.status !== undefined) {
        throw new BadRequestException('A status change cannot be undone: reopening the incident needs a register administrator (`change_incident_state`).');
      }
      if (changed.confidential === true) {
        throw new BadRequestException('Setting the confidentiality cannot be undone here: lifting it needs a register administrator (`set_incident_confidentiality`).');
      }
    }
    const previousValues = coerceRecord(preview.current_values?.values, 'current_values.values');
    if (entityType === 'incidents' && previousValues.category !== undefined) {
      // The screen also refuses to go back to a retired category, but the sentence names the
      // original value and the way out, never "Unknown incident category".
      const settings = await this.itOpsSettings.getSettings(context.tenantId, { manager: context.manager });
      const original = findCatalogOption(previousValues.category, settings.incidentCategories, null, false);
      if (original?.deprecated) {
        throw new BadRequestException(
          `The incident's original category "${original.label || original.code}" was removed; choose an active category.`,
        );
      }
    }
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
    if (entityType === 'incidents' && isFrozenIncidentStatus(String(target.row.status ?? ''))) {
      throw new ForbiddenException(INCIDENT_LOCKED_MESSAGE);
    }
    const normalized = await this.normalizeFields(context, entityType, rawFields, 'update', target.row);
    if (entityType === 'technologies') {
      await this.assertTechnologyUpdateRules(context, target.id, normalized.fields);
    }
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
    const warnings = await this.incidentWriteWarnings(context, entityType, target.row, nextFields);

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
        ...(warnings ? { warnings } : {}),
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

  presentPreview(preview: AiMutationPreview, language: AiWriteLanguage = 'en'): AiMutationPreviewPresentation {
    const entityType = requireEntityType(preview.target_entity_type || preview.mutation_input?.entity_type);
    const config = this.getConfig(entityType);
    const mutation = preview.mutation_input ?? {};
    const current = preview.current_values ?? {};
    const action = String(mutation.action || '');
    const fields = coerceRecord(mutation.fields, 'mutation_input.fields');
    const displayValues = coerceRecord(mutation.display_values ?? {}, 'mutation_input.display_values');
    const fieldLabels = coerceRecord(mutation.field_labels ?? {}, 'mutation_input.field_labels');
    const adoption = mutation.adopt && typeof mutation.adopt === 'object'
      ? mutation.adopt as Record<string, unknown>
      : null;
    const adoptionName = adoption ? (textOrNull(adoption.name) ?? '') : '';
    const completes = adoption?.completes && typeof adoption.completes === 'object'
      ? adoption.completes as Record<string, unknown>
      : null;
    const adoptionKind = adoption ? (completes ? 'completion' : 'adoption') : null;
    const adoptionTitle = adoptionKind ? (adoptionName || textOrNull(current.target_title) || '') : '';
    const currentValues = current.display_values && typeof current.display_values === 'object'
      ? current.display_values as Record<string, unknown>
      : {};
    const title = textOrNull(current.target_title) || this.titleForPendingCreate(entityType, fields);
    const fieldNames = previewFieldOrder(fields, config.fields);
    const labelList = fieldNames.map((fieldName) => String(fieldLabels[fieldName] || fieldName)).join(', ');

    let summary = `Preview ${preview.id} ${preview.status}.`;
    switch (preview.status) {
      case 'pending':
        summary = action === 'create'
          ? (adoptionKind === 'adoption'
            ? `Adopt technology "${adoptionTitle}" from the KANAP catalog.`
            : adoptionKind === 'completion'
              ? `Complete technology "${adoptionTitle}" with the KANAP catalog.`
              : `Create ${config.labelSingular} "${title}".`)
          : `Update ${config.labelSingular} "${title}": ${labelList}.`;
        break;
      case 'executed':
        summary = action === 'create'
          ? (adoptionKind === 'adoption'
            ? `Adopted technology "${adoptionTitle}" from the KANAP catalog.`
            : adoptionKind === 'completion'
              ? `Completed technology "${adoptionTitle}" with the KANAP catalog.`
              : `Created ${config.labelSingular} "${title}".`)
          : `Updated ${config.labelSingular} "${title}".`;
        break;
      case 'rejected':
        summary = `${action === 'create' ? (adoptionKind === 'adoption' ? 'Adoption' : adoptionKind === 'completion' ? 'Completion' : 'Creation') : 'Update'} preview for ${config.labelSingular} "${title}" was rejected.`;
        break;
      case 'expired':
        summary = `${action === 'create' ? (adoptionKind === 'adoption' ? 'Adoption' : adoptionKind === 'completion' ? 'Completion' : 'Creation') : 'Update'} preview for ${config.labelSingular} "${title}" expired before approval.`;
        break;
      case 'failed':
        summary = preview.error_message || `${action === 'create' ? (adoptionKind === 'adoption' ? 'Adoption' : adoptionKind === 'completion' ? 'Completion' : 'Creation') : 'Update'} preview for ${config.labelSingular} "${title}" failed.`;
        break;
    }

    if (language !== 'en') {
      summary = previewSummaryText(
        language,
        preview.status,
        adoptionKind && action === 'create'
          ? writeActionText.adoptTechnology(language, adoptionTitle)
          : writeActionText.writeRecord(language, action === 'create' ? 'create' : 'update', entityType, quoted(language, title)),
        { errorMessage: preview.error_message },
      );
    }

    const previousCodes = current.values && typeof current.values === 'object' ? current.values as Record<string, unknown> : {};
    const shownValue = (_fieldName: string, value: unknown): string | null => formatPlainValue(value);
    const changes: Record<string, AiMutationPreviewChangeDto> = {};
    if (adoption) {
      const completes = adoption.completes && typeof adoption.completes === 'object'
        ? adoption.completes as Record<string, unknown>
        : null;
      changes.catalog_adoption = {
        label: { en: 'KANAP catalog', fr: 'Catalogue KANAP', de: 'KANAP-Katalog', es: 'Catálogo KANAP' }[language],
        from: null,
        to: technologyAdoptionCardText(language, {
          family: String(adoption.family ?? ''),
          catalog_key: textOrNull(adoption.catalog_key),
          versions: Number(adoption.versions ?? 0),
          support_from: textOrNull(adoption.support_from),
          support_to: textOrNull(adoption.support_to),
          completes: completes
            ? {
              reference: String(completes.ref ?? ''),
              missing_versions: Array.isArray(completes.missing_versions)
                ? completes.missing_versions.map((label) => String(label))
                : [],
              fills_description: completes.fills_description === true,
            }
            : null,
        }),
        format: 'markdown',
      };
    }
    for (const fieldName of fieldNames) {
      const field = config.fields[fieldName];
      changes[fieldName] = {
        label: String(fieldLabels[fieldName] || fieldName),
        // A completion keeps the hand-typed record's values: the card shows what each requested
        // field held there, not null as a creation would.
        from: action === 'create' && adoptionKind !== 'completion' ? null : shownValue(fieldName, currentValues[fieldName]),
        to: shownValue(fieldName, displayValues[fieldName]),
        format: 'text',
        // The card names a level from the catalog in the person's language, as the application screens do.
        ...(field?.kind === 'application_classification' && field.classificationAxis ? {
          classification: {
            catalog: CLASSIFICATION_CATALOG_LISTS[field.classificationAxis],
            from: action === 'create' ? null : textOrNull(previousCodes[fieldName]),
            to: textOrNull(fields[fieldName]),
          },
        } : {}),
      };
    }
    // A new adoption writes the catalog's family; the card names the code, the frontend localises
    // it from the tenant's list. A completion keeps the hand-typed record's family.
    if (adoption && !adoption.completes && !fieldNames.includes('family') && adoption.family) {
      changes.family = {
        label: config.fields.family.label,
        from: null,
        to: String(adoption.family),
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
    const warnings = mutation.warnings && typeof mutation.warnings === 'object'
      ? mutation.warnings as Record<string, unknown>
      : null;
    if (warnings?.closure) {
      changes.closure_warning = { label: 'Closure', from: null, to: incidentClosureWarning(language), format: 'text' };
    }
    if (warnings?.lose_access) {
      changes.access_warning = { label: 'Access', from: null, to: incidentAccessWarning(language), format: 'text' };
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
    const config = this.getConfig(entityType);
    const mutation = preview.mutation_input ?? {};
    const action = String(mutation.action || '');
    const fields = coerceRecord(mutation.fields, 'mutation_input.fields');
    const executionFields = this.executionFields(fields);
    const audit = buildAiMutationAudit(preview);
    if (action === 'create') {
      const adoption = mutation.adopt && typeof mutation.adopt === 'object'
        ? mutation.adopt as Record<string, unknown>
        : null;
      if (entityType === 'technologies' && adoption) {
        // The catalog adoption writes the record and its versions; the fields the person added
        // beside it are one update in the same transaction, with the same audit source. The
        // adoption checks under its advisory lock what the card announced: a new record, or the
        // hand-typed record it completes. A record adopted or typed in between answers 409.
        const completes = adoption.completes && typeof adoption.completes === 'object'
          ? adoption.completes as Record<string, unknown>
          : null;
        const completesId = completes ? String(completes.id ?? '') : '';
        // A completion writes the fields the person asked beside the catalog: each one is compared
        // with the live record first, field by field, as `update_business_record` does.
        if (completesId) {
          await this.assertTechnologyFieldDrift(
            context,
            completesId,
            coerceRecord(preview.current_values?.values, 'current_values.values'),
            mutation.field_labels,
          );
        }
        const adopted = await this.technologyCatalog.adopt(String(adoption.catalog_key ?? ''), {
          manager: context.manager,
          tenantId: context.tenantId,
          userId: context.userId,
          audit,
          expect: completesId ? { mode: 'complete', technologyId: completesId } : { mode: 'create' },
        });
        if (completesId && adopted.technology.id !== completesId) {
          throw new ConflictException(`Technology "${String(adoption.name ?? '')}" changed after the preview was created.`);
        }
        if (!completesId && adopted.created !== true) {
          throw new ConflictException(`Technology "${String(adoption.name ?? '')}" changed after the preview was created.`);
        }
        const updateFields = { ...executionFields };
        delete updateFields.name;
        if (Object.keys(updateFields).length > 0) {
          await this.technologies.update(adopted.technology.id, updateFields as any, {
            manager: context.manager,
            tenantId: context.tenantId,
            userId: context.userId,
            audit,
          });
        }
        const adoptedSnapshot = await this.getRecordSnapshot(context, 'technologies', adopted.technology.id);
        const adoptedRef = this.referenceFromRow('technologies', adoptedSnapshot);
        preview.target_entity_id = adoptedRef.id;
        preview.current_values = {
          ...(preview.current_values ?? {}),
          target_ref: adoptedRef.ref,
          target_title: adoptedRef.label,
        };
        return;
      }
      // A free technology creation: a record of the same name that appeared between the preview
      // and the approval is a drift, not the service's duplicate-name error.
      if (entityType === 'technologies') {
        const sameName: Array<{ item_number: number }> = await context.manager.query(
          `SELECT item_number FROM technologies WHERE tenant_id = $1 AND lower(btrim(name)) = lower(btrim($2)) LIMIT 1`,
          [context.tenantId, String(executionFields.name ?? '')],
        );
        if (sameName[0]) {
          throw new ConflictException(
            `A technology with this name appeared after the preview was created: TEC-${sameName[0].item_number}.`,
          );
        }
      }
      const saved = await this.createRecord(context, entityType, executionFields, audit).catch((error) => {
        if (entityType === 'technologies' && (error as { getStatus?: () => number })?.getStatus?.() === 409) {
          throw new ConflictException(
            `A technology with this name appeared after the preview was created: ${String(executionFields.name ?? '')}.`,
          );
        }
        throw error;
      });
      // The incident and technology services already write the audit row with the preview's
      // source and reference: the created detail is the snapshot (its viewer stays the author's,
      // even when they no longer see the restricted incident they have just created).
      const snapshot = entityType === 'incidents' || entityType === 'technologies'
        ? coerceRecord(saved, `created ${config.labelSingular}`)
        : await this.getRecordSnapshot(context, entityType, String((saved as any).id));
      const ref = this.referenceFromRow(entityType, snapshot);
      preview.target_entity_id = ref.id;
      preview.current_values = {
        ...(preview.current_values ?? {}),
        target_ref: ref.ref,
        target_title: ref.label,
      };
      if (entityType !== 'incidents' && entityType !== 'technologies') {
        await this.logAiAudit(context, preview, entityType, 'create', null, snapshot);
      }
      return;
    }
    if (action !== 'update') throw new BadRequestException('Unsupported business record mutation action.');
    if (!preview.target_entity_id) throw new BadRequestException('Preview is missing the target record.');

    const expectedValues = coerceRecord(preview.current_values?.values, 'current_values.values');
    // A budget line is locked, by its stored nature, before what the preview saw is compared
    // with what is stored (lock order, `spend/budget-locks.ts`): nothing changes between the check
    // and the write.
    if (entityType === 'budget_lines') {
      const line = await resolveBudgetLine(preview.target_entity_id, context.manager);
      await lockBudgetLine(context.manager, line.nature, context.tenantId, preview.target_entity_id);
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
    try {
      await this.updateRecord(context, entityType, preview.target_entity_id, executionFields, audit);
    } catch (error) {
      if (entityType === 'incidents' && (error as { getStatus?: () => number })?.getStatus?.() === 423) {
        throw new BadRequestException(PREVIEW_INCIDENT_REVIEW_LOCKED_MESSAGE);
      }
      throw error;
    }
    // The incident and technology services write their own audit row, with the preview's source
    // and reference; the detail they return stays the author's, even when the change makes the
    // record invisible to them.
    if (entityType === 'incidents' || entityType === 'technologies') return;
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

  /** The `update_business_record` drift check, on the fields a completion writes beside the catalog. */
  private async assertTechnologyFieldDrift(
    context: AiExecutionContextWithManager,
    technologyId: string,
    expectedValues: Record<string, unknown>,
    storedLabels: unknown,
  ): Promise<void> {
    const fieldNames = Object.keys(expectedValues);
    if (fieldNames.length === 0) return;
    const live = await this.getRecordSnapshot(context, 'technologies', technologyId);
    for (const fieldName of fieldNames) {
      if (sameValue(live[fieldName] ?? null, expectedValues[fieldName])) continue;
      const label = await this.conflictLabel(context, 'technologies', fieldName, storedLabels);
      throw new ConflictException(`${label} changed after the preview was created.`);
    }
  }

  /** The label of a field that changed since the preview: a dimension's current name, else the field's label. */
  private async conflictLabel(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    fieldName: string,
    storedLabels: unknown,
  ): Promise<string> {
    const axisId = analyticsAxisIdOfField(fieldName);
    if (isBudgetLineEntity(entityType) && fieldName === DEFAULT_ANALYTICS_FIELD) {
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

  /** The incident services' options for a Plaid write: the person's viewer and the preview's audit source. */
  private async incidentWriteOptions(
    context: AiExecutionContextWithManager,
    audit?: ReturnType<typeof buildAiMutationAudit>,
  ) {
    const viewer = await resolveIncidentViewer(context.manager, context.userId, context.tenantId);
    return { manager: context.manager, tenantId: context.tenantId, viewer, ...(audit ? { audit } : {}) };
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
    // A CAPEX line's audit rows keep their CAPEX table name (`auditTableOf`).
    const nature = lineNatureOf((after ?? before) as Record<string, unknown> | null) ?? 'opex';
    await this.audit.log(
      {
        table: entityType === 'budget_lines' ? auditTableOf(nature, 'spend_items') : this.getConfig(entityType).tableName,
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
    audit?: ReturnType<typeof buildAiMutationAudit>,
  ): Promise<unknown> {
    switch (entityType) {
      case 'applications':
        return this.applications.create(fields as any, context.userId, { manager: context.manager, tenantId: context.tenantId });
      case 'assets':
        return this.assets.create(fields as any, context.tenantId, context.userId, { manager: context.manager, tenantId: context.tenantId, osSource: 'ai' });
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
      case 'budget_lines':
        return this.budgetLines.create(fields, context.userId, { manager: context.manager });
      case 'incidents':
        return this.incidents.create(fields, context.userId, await this.incidentWriteOptions(context, audit));
      case 'technologies':
        return this.technologies.create(fields as any, {
          manager: context.manager,
          tenantId: context.tenantId,
          userId: context.userId,
          ...(audit ? { audit } : {}),
        });
    }
  }

  private async updateRecord(
    context: AiExecutionContextWithManager,
    entityType: AiBusinessRecordEntityType,
    id: string,
    fields: Record<string, unknown>,
    audit?: ReturnType<typeof buildAiMutationAudit>,
  ): Promise<unknown> {
    switch (entityType) {
      case 'applications':
        return this.applications.update(id, fields as any, context.userId, { manager: context.manager, tenantId: context.tenantId });
      case 'assets':
        return this.assets.update(id, fields as any, context.tenantId, context.userId, { manager: context.manager, tenantId: context.tenantId, osSource: 'ai' });
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
      case 'budget_lines':
        return this.budgetLines.update(id, fields, context.userId, { manager: context.manager });
      case 'incidents':
        return this.incidents.update(id, fields, context.userId, await this.incidentWriteOptions(context, audit));
      case 'technologies':
        return this.technologies.update(id, fields as any, {
          manager: context.manager,
          tenantId: context.tenantId,
          userId: context.userId,
          ...(audit ? { audit } : {}),
        });
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
      case 'budget_lines':
        return this.budgetLines.get(id, { manager: context.manager }) as any;
      case 'incidents':
        return this.incidents.get(id, await this.incidentWriteOptions(context)) as any;
      case 'technologies':
        return this.technologies.get(id, {
          manager: context.manager,
          tenantId: context.tenantId,
          userId: context.userId,
        }) as any;
    }
  }
}
