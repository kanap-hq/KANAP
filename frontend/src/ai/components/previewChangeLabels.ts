import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import useLocalizedTaskTypes from '../../hooks/useLocalizedTaskTypes';
import { useLocale } from '../../i18n/useLocale';
import { formatShortDate, formatShortDateTime } from '../../lib/dateFormat';
import { formatCurrency, formatDecimal } from '../../i18n/formatters';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import { AiMutationPreview, AiPreviewAmounts, AiPreviewRelationItem } from '../aiTypes';

type PreviewChange = AiMutationPreview['changes'][string];

/**
 * The labels and values of a preview card in the user's language, with the words of the screens.
 * The server sends each change under its field key, with an English label and the stored value
 * (a code for a list value): the label is the one the record's screen shows (`SCREEN_FIELD_KEYS`,
 * else `ai:previewCard`), the value comes from the catalog the screens use (a classification level
 * from the tenant's catalog, a task type from the tenant's types). A key or a value nobody translates shows as the server sent it (a dimension's name,
 * a record's name, a free text). A date reads as on the screens ("3 nov. 2027"). Budget amounts come
 * as numbers: each column is named as on the budget screens (or as the tenant named it), with the
 * year, and the amount in the language and the line's currency ("Budget 2026 : 12 000 €").
 */

const TASK_TOOLS = new Set(['create_task', 'update_task_fields', 'update_task_status', 'update_task_assignee', 'import_ticket', 'import_glpi_ticket']);
const RECORD_TOOLS = new Set([
  'create_business_record',
  'update_business_record',
  'create_master_data_record',
  'update_master_data_record',
  'write_financial_plan',
  // The incident administrator cards read their status codes and their Yes/No values as the
  // record cards do (the status rule and the screen's incident field labels do the naming).
  'change_incident_state',
  'set_incident_confidentiality',
]);

/** A stored code as the catalogs key it: `in progress` and `In_Progress` read as `in_progress`. */
const codeOf = (value: string) => value.trim().toLowerCase().replace(/[\s-]+/g, '_');
const camel = (code: string) => code.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** A date as the server sends it: a day, or a day and a time (a date field read back from a timestamp). */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
/** An ISO instant with a time: the card shows its day and time, not just its day. */
const ISO_DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
/** The incident date-time fields: they read with the time, a date field keeps its day. */
const DATE_TIME_FIELDS = new Set(['started_at', 'detected_at', 'resolved_at', 'closed_at', 'authority_notified_at', 'occurred_at']);

type ValueRule = {
  fields: string[];
  tools?: Set<string>;
  entities?: string[];
  key: (code: string) => string;
};

/** The catalog of each list value, first match wins. */
const VALUE_RULES: ValueRule[] = [
  { tools: TASK_TOOLS, fields: ['status'], key: (code) => `portfolio:statuses.task.${code}` },
  { tools: TASK_TOOLS, fields: ['priority', 'priority_level'], key: (code) => `portfolio:priority.${code}` },
  { tools: TASK_TOOLS, fields: ['relation'], key: (code) => `portfolio:context.${code}` },
  { tools: TASK_TOOLS, fields: ['assignee', 'assignee_email'], key: (code) => (code === 'unassigned' ? 'ai:previewCard.values.unassigned' : '') },
  { tools: new Set(['create_document']), fields: ['status'], key: (code) => `knowledge:statuses.${code}` },
  { entities: ['incidents'], fields: ['status'], key: (code) => `it:enums.incidentStatus.${code}` },
  { entities: ['incidents'], fields: ['severity'], key: (code) => `it:enums.incidentSeverity.${code}` },
  { entities: ['projects'], fields: ['status'], key: (code) => `portfolio:statuses.project.${code}` },
  { entities: ['projects'], fields: ['origin'], key: (code) => `portfolio:origin.${code}` },
  { entities: ['projects'], fields: ['scheduling_mode'], key: (code) => `portfolio:planning.roadmap.schedulingModes.${code}` },
  { entities: ['requests'], fields: ['status'], key: (code) => `portfolio:statuses.request.${code}` },
  { entities: ['chart_of_accounts'], fields: ['scope'], key: (code) => `ai:previewCard.values.coaScope.${code}` },
  { fields: ['environment'], key: (code) => `it:enums.environment.${camel(code)}` },
  { fields: ['topology'], key: (code) => `it:enums.topology.${camel(code)}` },
  { fields: ['risk_mode'], key: (code) => `it:enums.riskMode.${code}` },
  { fields: ['integration_route_type'], key: (code) => `it:enums.routeType.${camel(code)}` },
  { fields: ['billing_frequency'], key: (code) => `ops:contracts.billing.${code}` },
  { fields: ['run_build'], key: (code) => `ops:opex.runBuild.${code}` },
  { fields: ['supplier_role'], key: (code) => `master-data:contacts.roles.${code}` },
  { fields: ['nature', 'applies_to'], key: (code) => `master-data:shared.usages.nature.${code}` },
  { fields: ['users_mode'], key: (code) => `ai:previewCard.values.usersMode.${code}` },
  { fields: ['input_grain'], key: (code) => `ai:previewCard.values.inputGrain.${code}` },
  { fields: ['allocation_method', 'allocation_driver'], key: (code) => `ai:previewCard.values.allocationMethod.${code}` },
  { fields: ['status'], key: (code) => `common:statuses.${code}` },
];

/** The label key of each field on the screen of its record: the card names a field as that screen does. */
const portfolioRecordFields = (kind: 'project' | 'request'): Record<string, string> => ({
  purpose: `portfolio:workspace.${kind}.summary.cards.purpose`,
  status: `portfolio:workspace.${kind}.fields.status`,
  source_id: `portfolio:workspace.${kind}.fields.source`,
  category_id: `portfolio:workspace.${kind}.fields.category`,
  stream_id: `portfolio:workspace.${kind}.fields.stream`,
  company_id: `portfolio:workspace.${kind}.fields.company`,
  department_id: `portfolio:workspace.${kind}.fields.department`,
  business_sponsor_id: `portfolio:workspace.${kind}.fields.businessSponsor`,
  business_lead_id: `portfolio:workspace.${kind}.fields.businessLead`,
  it_sponsor_id: `portfolio:workspace.${kind}.fields.itSponsor`,
  it_lead_id: `portfolio:workspace.${kind}.fields.itLead`,
  priority_score: 'portfolio:editors.scoring.labels.priorityScore',
  priority_override: 'portfolio:activity.history.fields.priorityOverride',
  override_value: 'portfolio:activity.history.fields.overrideValue',
});

const BUDGET_LINE_FIELDS: Record<string, string> = {
  nature: 'ops:operations.scope.label',
  product_name: 'ops:opex.columns.productName',
  description: 'ops:opex.fields.description',
  supplier_id: 'ops:opex.fields.supplier',
  paying_company_id: 'ops:opex.fields.payingCompany',
  account_id: 'ops:opex.fields.account',
  currency: 'ops:opex.fields.currency',
  effective_start: 'ops:opex.fields.effectiveStart',
  effective_end: 'ops:opex.fields.endOfValidity',
  disabled_at: 'ops:opex.fields.endOfValidity',
  owner_it_id: 'ops:opex.metadata.itOwner',
  owner_business_id: 'ops:opex.metadata.businessOwner',
  project_id: 'ops:opex.columns.project',
  cost_center_id: 'ops:opex.fields.costCenter',
  run_build: 'ops:opex.fields.runBuild',
  contract_id: 'ops:opex.columns.contract',
  notes: 'ops:opex.fields.notes',
};

const TASK_FIELDS: Record<string, string> = {
  relation: 'portfolio:workspace.task.sidebar.fields.relatedTo',
  relation_type: 'portfolio:workspace.task.sidebar.fields.relatedTo',
  relation_ref: 'portfolio:workspace.task.sidebar.fields.relatedTo',
  title: 'portfolio:workspace.task.title.label',
  requestor: 'portfolio:workspace.task.sidebar.fields.requestor',
  assignee: 'portfolio:workspace.task.sidebar.fields.assignee',
  assignee_email: 'portfolio:workspace.task.sidebar.fields.assignee',
  priority: 'portfolio:workspace.task.sidebar.fields.priority',
  priority_level: 'portfolio:workspace.task.sidebar.fields.priority',
  status: 'portfolio:workspace.task.sidebar.fields.status',
  start_date: 'portfolio:workspace.task.sidebar.fields.startDate',
  due_date: 'portfolio:workspace.task.sidebar.fields.dueDate',
  task_type: 'portfolio:workspace.task.sidebar.fields.taskType',
  type: 'portfolio:workspace.task.sidebar.fields.taskType',
  phase: 'portfolio:workspace.task.sidebar.fields.phase',
  source: 'portfolio:workspace.task.sidebar.fields.source',
  source_id: 'portfolio:workspace.task.sidebar.fields.source',
  category: 'portfolio:workspace.task.sidebar.fields.category',
  category_id: 'portfolio:workspace.task.sidebar.fields.category',
  stream: 'portfolio:workspace.task.sidebar.fields.stream',
  stream_id: 'portfolio:workspace.task.sidebar.fields.stream',
  company: 'portfolio:workspace.task.sidebar.fields.company',
  company_id: 'portfolio:workspace.task.sidebar.fields.company',
  description: 'portfolio:tasks.columns.description',
  comment: 'portfolio:workspace.task.activity.actions.comment',
};

const SCREEN_FIELD_KEYS: Record<string, Record<string, string>> = {
  applications: {
    name: 'it:common.name',
    supplier_id: 'it:workspace.application.overview.supplier',
    category: 'it:workspace.application.overview.category',
    description: 'it:workspace.application.overview.description',
    editor: 'it:workspace.application.overview.publisher',
    retired_date: 'it:workspace.application.overview.retiredDate',
    version: 'it:workspace.application.overview.version',
    end_of_support_date: 'it:workspace.application.overview.endOfSupport',
    go_live_date: 'it:workspace.application.overview.goLiveDate',
    predecessor_id: 'it:workspace.application.overview.previousVersion',
    lifecycle: 'it:workspace.application.overview.lifecycle',
    criticality: 'it:classification.business_criticality',
    cyber_criticality: 'it:classification.cyber_criticality',
    data_class: 'it:classification.data_confidentiality',
    recovery_wave: 'it:classification.recovery_wave',
    rto_minutes: 'it:classification.recovery_time_objective_rto',
    rpo_minutes: 'it:classification.recovery_point_objective_rpo',
    classification_justification: 'it:classification.justification',
    last_dr_test: 'it:classification.last_recovery_test',
    contains_pii: 'it:classification.contains_personal_data',
    external_facing: 'it:workspace.application.technical.externalFacing',
    is_suite: 'it:workspace.application.overview.canHaveChildApps',
    etl_enabled: 'it:workspace.application.technical.dataIntegrationEtl',
    sso_enabled: 'it:pages.applications.columns.ssoEnabled',
    mfa_supported: 'it:components.instances.mfaSupported',
    access_methods: 'it:workspace.application.technical.accessMethods',
    licensing: 'it:workspace.application.overview.licensing',
    notes: 'it:workspace.application.overview.notes',
    support_notes: 'it:workspace.application.technical.supportNotes',
    users_mode: 'it:workspace.application.ownership.calculationMethod',
    users_override: 'it:workspace.application.ownership.manualUsers',
  },
  assets: {
    name: 'it:workspace.asset.overview.name',
    kind: 'it:workspace.asset.overview.assetType',
    provider: 'it:workspace.asset.overview.cloudProvider',
    environment: 'it:workspace.asset.technical.environment',
    region: 'it:workspace.location.fields.region',
    hostname: 'it:workspace.asset.technical.hostname',
    domain: 'it:workspace.asset.technical.domain',
    admin_zone: 'it:workspace.asset.technical.adminZone',
    aliases: 'it:workspace.asset.technical.aliases',
    ip_addresses: 'it:workspace.asset.technical.ipAddresses',
    cluster: 'it:workspace.asset.meta.cluster',
    is_cluster: 'it:workspace.asset.overview.isCluster',
    operating_system: 'it:workspace.asset.technologies.operatingSystem',
    location_id: 'it:workspace.asset.overview.location',
    sub_location_id: 'it:workspace.asset.overview.subLocation',
    lifecycle: 'it:workspace.asset.overview.lifecycle',
    go_live_date: 'it:workspace.asset.overview.goLiveDate',
    end_of_life_date: 'it:workspace.asset.overview.endOfLifeDate',
    notes: 'it:workspace.asset.overview.notes',
  },
  interfaces: {
    interface_reference: 'it:workspace.interface.fields.reference',
    interface_id: 'it:workspace.interface.fields.interfaceCode',
    name: 'it:workspace.interface.fields.name',
    business_process_id: 'it:workspace.interface.fields.businessProcess',
    source_application_id: 'it:workspace.interface.fields.sourceApplication',
    target_application_id: 'it:workspace.interface.fields.targetApplication',
    data_category: 'it:workspace.interface.fields.dataCategory',
    integration_route_type: 'it:workspace.interface.fields.routeType',
    middleware_application_ids: 'it:workspace.interface.fields.middlewareApplications',
    pii_description: 'it:workspace.interface.fields.piiDescription',
    specification_markdown: 'it:workspace.interface.overview.specification',
    lifecycle: 'it:common.lifecycle',
    criticality: 'it:pages.connections.columns.criticality',
    contains_pii: 'it:pages.interfaces.columns.containsPii',
  },
  connections: {
    connection_reference: 'it:workspace.connection.overview.connectionReference',
    name: 'it:workspace.connection.overview.name',
    description: 'it:workspace.connection.create.description',
    topology: 'it:pages.connections.columns.topology',
    servers: 'it:pages.connections.columns.servers',
    protocol_codes: 'it:workspace.connection.overview.protocols',
    lifecycle: 'it:workspace.connection.overview.lifecycle',
    criticality: 'it:workspace.connection.compliance.criticality',
    data_class: 'it:workspace.connection.compliance.dataClass',
    contains_pii: 'it:workspace.connection.compliance.containsPii',
    risk_mode: 'it:workspace.connection.compliance.riskMode',
  },
  locations: {
    name: 'it:common.name',
    hosting_type: 'it:pages.locations.columns.hostingType',
    city: 'it:pages.locations.columns.city',
    provider: 'it:workspace.location.relations.provider',
    region: 'it:workspace.location.fields.region',
  },
  contracts: {
    name: 'ops:contracts.fields.name',
    company_id: 'ops:contracts.fields.company',
    cost_center_id: 'ops:contracts.fields.costCenter',
    supplier_id: 'ops:contracts.fields.supplier',
    owner_user_id: 'ops:contracts.fields.owner',
    start_date: 'ops:contracts.fields.startDate',
    duration_months: 'ops:contracts.fields.durationMonths',
    auto_renewal: 'ops:contracts.fields.autoRenewal',
    notice_period_months: 'ops:contracts.fields.noticeMonths',
    yearly_amount_at_signature: 'ops:contracts.fields.yearlyAmount',
    currency: 'ops:contracts.fields.currency',
    billing_frequency: 'ops:contracts.fields.billingFrequency',
    status: 'ops:contracts.fields.status',
    notes: 'ops:contracts.fields.notes',
  },
  budget_lines: BUDGET_LINE_FIELDS,
  projects: {
    ...portfolioRecordFields('project'),
    origin: 'portfolio:workspace.project.fields.origin',
    execution_progress: 'portfolio:workspace.project.summary.fields.executionProgress',
    planned_start: 'portfolio:workspace.project.fields.plannedStart',
    planned_end: 'portfolio:workspace.project.fields.plannedEnd',
  },
  requests: {
    ...portfolioRecordFields('request'),
    requestor_id: 'portfolio:workspace.request.fields.requestor',
    target_delivery_date: 'portfolio:workspace.request.fields.targetDeliveryDate',
    current_situation: 'portfolio:workspace.request.analysis.labels.currentSituation',
    expected_benefits: 'portfolio:workspace.request.analysis.labels.expectedBenefits',
    feasibility_review: 'portfolio:workspace.request.analysis.sections.feasibilityReview',
  },
  technologies: {
    name: 'it:workspace.technology.fields.name',
    editor: 'it:workspace.technology.fields.editor',
    family: 'it:workspace.technology.fields.family',
    lifecycle: 'it:common.lifecycle',
    hosting_type: 'it:workspace.technology.fields.hostingType',
    description: 'it:workspace.technology.fields.description',
    notes: 'it:workspace.technology.fields.notes',
    support_notes: 'ai:previewCard.fields.support_notes',
    replaced_by_id: 'it:workspace.technology.fields.replacedBy',
    cyber_criticality: 'it:classification.cyber_criticality',
    recovery_wave: 'it:classification.recovery_wave',
    rto_minutes: 'it:classification.recovery_time_objective_rto',
    rpo_minutes: 'it:classification.recovery_point_objective_rpo',
    admin_zone: 'it:workspace.technology.fields.adminZone',
    catalog_adoption: 'ai:previewCard.fields.catalog_adoption',
    technology_versions: 'ai:previewCard.fields.technology_versions',
    technology_owners: 'ai:previewCard.fields.technology_owners',
    technology_support_contacts: 'ai:previewCard.fields.technology_support_contacts',
    technology_web_links: 'ai:previewCard.fields.technology_web_links',
    technology_vulnerability_alerts: 'ai:previewCard.fields.technology_vulnerability_alerts',
    technology_applications: 'ai:previewCard.fields.technology_applications',
    technology_servers: 'ai:previewCard.fields.technology_servers',
  },
  vulnerabilities: {
    vulnerability_state: 'ai:previewCard.fields.vulnerability_state',
  },
  incidents: {
    title: 'it:workspace.incident.fields.title',
    category: 'it:workspace.incident.drawer.category',
    severity: 'it:workspace.incident.drawer.severity',
    status: 'it:workspace.incident.drawer.status',
    started_at: 'it:workspace.incident.drawer.started',
    detected_at: 'it:workspace.incident.drawer.detected',
    resolved_at: 'it:workspace.incident.drawer.resolved',
    closed_at: 'it:workspace.incident.drawer.closed',
    reporter_user_id: 'it:workspace.incident.drawer.reporter',
    owner_user_id: 'it:workspace.incident.drawer.owner',
    description: 'it:workspace.incident.create.description',
    source_ref: 'it:workspace.incident.drawer.sourceRef',
    personal_data_affected: 'it:workspace.incident.drawer.personalData',
    authority_notification_required: 'it:workspace.incident.drawer.authorityRequired',
    confidential: 'it:workspace.incident.drawer.restrictAccess',
    authority_notified_at: 'it:workspace.incident.drawer.notifiedOn',
    notified_parties: 'it:workspace.incident.drawer.notifiedParties',
  },
  tasks: TASK_FIELDS,
  documents: {
    title: 'knowledge:columns.title',
    summary: 'knowledge:sidebar.fields.summary',
    library: 'knowledge:columns.library',
    folder: 'knowledge:sidebar.fields.folder',
    document_type: 'knowledge:sidebar.fields.type',
    status: 'knowledge:sidebar.fields.status',
    template_document: 'knowledge:columns.template',
  },
  companies: {
    name: 'master-data:companies.fields.name',
    country_iso: 'master-data:companies.fields.country',
    city: 'master-data:companies.fields.city',
    postal_code: 'master-data:companies.fields.postalCode',
    address1: 'master-data:companies.fields.address1',
    address2: 'master-data:companies.fields.address2',
    reg_number: 'master-data:companies.fields.regNumber',
    vat_number: 'master-data:companies.fields.vatNumber',
    state: 'master-data:companies.fields.state',
    base_currency: 'master-data:companies.fields.baseCurrency',
    notes: 'master-data:companies.fields.notes',
    status: 'master-data:companies.fields.status',
    headcount: 'master-data:companies.fields.headcount',
    it_users: 'master-data:companies.fields.itUsers',
  },
  departments: {
    name: 'master-data:departments.fields.name',
    description: 'master-data:departments.fields.description',
    status: 'master-data:shared.columns.status',
    headcount: 'master-data:departments.fields.headcount',
  },
  suppliers: {
    name: 'master-data:suppliers.fields.name',
    erp_supplier_id: 'master-data:suppliers.fields.erpSupplierId',
    notes: 'master-data:suppliers.fields.notes',
    status: 'master-data:suppliers.fields.status',
  },
  contacts: {
    first_name: 'master-data:contacts.fields.firstName',
    last_name: 'master-data:contacts.fields.lastName',
    job_title: 'master-data:contacts.fields.jobTitle',
    email: 'master-data:contacts.fields.email',
    phone: 'master-data:contacts.fields.phone',
    mobile: 'master-data:contacts.fields.mobile',
    country: 'master-data:contacts.fields.country',
    notes: 'master-data:contacts.fields.notes',
    active: 'master-data:shared.columns.active',
  },
  accounts: {
    account_number: 'master-data:accounts.fields.accountNumber',
    account_name: 'master-data:accounts.fields.accountName',
    native_name: 'master-data:accounts.fields.nativeName',
    description: 'master-data:accounts.fields.description',
    consolidation_account_number: 'master-data:accounts.fields.consolidationAccountNumber',
    consolidation_account_name: 'master-data:accounts.fields.consolidationAccountName',
    consolidation_account_description: 'master-data:accounts.fields.consolidationAccountDescription',
  },
  chart_of_accounts: {
    code: 'master-data:coa.manageDialog.columns.code',
    name: 'master-data:coa.manageDialog.columns.name',
  },
  analytics_categories: {
    name: 'master-data:analytics.fields.name',
    description: 'master-data:analytics.fields.description',
    status: 'master-data:shared.columns.status',
    dimension: 'master-data:analytics.fields.dimension',
  },
  business_processes: {
    name: 'master-data:shared.fields.name',
    description: 'master-data:shared.fields.description',
    notes: 'master-data:shared.fields.notes',
    status: 'master-data:shared.columns.status',
  },
};

/** The role words of a relation item, as the screens name them: owners, contact roles, asset relations. */
const RELATION_ROLE_KEYS: Record<'owner' | 'contact' | 'asset_relation', (code: string) => string> = {
  owner: (code) => (code === 'it' ? 'ops:opex.metadata.itOwner' : code === 'business' ? 'ops:opex.metadata.businessOwner' : ''),
  contact: (code) => `master-data:contacts.roles.${code}`,
  asset_relation: (code) => `it:workspace.asset.relations.${camel(code)}`,
};

const CLASSIFICATION_REVIEW: Record<string, string> = {
  Reviewed: 'ai:previewCard.values.classificationReview.reviewed',
  'Stale after this change': 'ai:previewCard.values.classificationReview.stale',
};

/** The labels of one preview's card; the tenant's catalogs load only when the card shows one of their values. */
export function usePreviewChangeLabels(preview?: AiMutationPreview) {
  const { t, i18n } = useTranslation(['ai', 'portfolio', 'knowledge', 'it', 'ops', 'master-data', 'common']);
  const { labelFor } = useItOpsEnumOptions();
  const locale = useLocale();
  const changes = Object.values(preview?.changes ?? {});
  const { data: classificationCatalog = undefined } = useApplicationClassificationCatalog({
    enabled: changes.some((change) => !!change.classification)
      || (preview?.target.entity_type === 'technologies'
        && (preview.changes.cyber_criticality != null || preview.changes.recovery_wave != null)),
  });
  const { labelByName: taskTypeLabels } = useLocalizedTaskTypes({
    enabled: !!preview && TASK_TOOLS.has(preview.tool_name) && !!(preview.changes.task_type?.to || preview.changes.type?.to),
  });

  /** The first key the loaded texts hold, translated; null when none does. */
  const known = useCallback(
    (keys: string[]): string | null => {
      const key = keys.find((candidate) => candidate && i18n.exists(candidate));
      return key ? t(key) : null;
    },
    [i18n, t],
  );

  const fieldLabel = useCallback(
    (preview: AiMutationPreview, field: string, label: string | null | undefined): string => {
      const entity = preview.target.entity_type;
      return known([
        preview.tool_name === 'update_entity_relations' ? `ai:previewCard.relationFields.${field}` : '',
        preview.tool_name === 'delete_record' ? 'ai:previewCard.fields.deletion' : '',
        SCREEN_FIELD_KEYS[entity]?.[field] ?? '',
        `ai:previewCard.fields.${field}`,
      ]) ?? (label || field);
    },
    [known],
  );

  const valueLabel = useCallback(
    (preview: AiMutationPreview, field: string, value: string | null): string | null => {
      if (!value) return value;
      if (ISO_DATE_RE.test(value)) {
        return DATE_TIME_FIELDS.has(field) && ISO_DATE_TIME_RE.test(value)
          ? formatShortDateTime(value, locale, { empty: value })
          : formatShortDate(value, locale, { empty: value });
      }
      if (field === 'classification_review_state') return known([CLASSIFICATION_REVIEW[value] ?? '']) ?? value;
      const entity = preview.target.entity_type;
      // The incident category is the tenant's list: its label, in the person's language.
      if (entity === 'incidents' && field === 'category') return labelFor('incidentCategories', value) || value;
      if (TASK_TOOLS.has(preview.tool_name) && (field === 'task_type' || field === 'type')) return taskTypeLabels[value] ?? value;
      if (entity === 'technologies') {
        // The tenant's catalogs, in the person's language: the server stores the code.
        if (field === 'family') return labelFor('technologyFamily', value) || value;
        if (field === 'lifecycle') return labelFor('lifecycleStatus', value) || value;
        if (field === 'hosting_type') return labelFor('hostingType', value) || value;
        if (field === 'admin_zone') return labelFor('adminZone', value) || value;
        if (field === 'cyber_criticality') {
          return classificationCatalog?.cyberCriticalityLevels?.find((level) => level.code === value)?.label || value;
        }
        if (field === 'recovery_wave') {
          return classificationCatalog?.recoveryWaves?.find((wave) => wave.code === value)?.label || value;
        }
      }
      if (field === 'lifecycle' && entity === 'applications') return labelFor('lifecycleStatus', value) || value;
      if (RECORD_TOOLS.has(preview.tool_name) && (value === 'Yes' || value === 'No')) {
        return known([`it:enums.yesNo.${value.toLowerCase()}`]) ?? value;
      }
      const code = codeOf(value);
      const rules = VALUE_RULES.filter((rule) => rule.fields.includes(field)
        && (!rule.tools || rule.tools.has(preview.tool_name))
        && (!rule.entities || rule.entities.includes(entity)));
      return known(rules.map((rule) => rule.key(code))) ?? value;
    },
    [known, labelFor, locale, taskTypeLabels],
  );

  /** A classification level as the application screens name it: the tenant's catalog in the person's language. */
  const classificationLabel = useCallback(
    (classification: NonNullable<PreviewChange['classification']>, side: 'from' | 'to', shown: string | null): string | null => {
      const code = classification[side];
      if (!code) return shown;
      return classificationCatalog?.[classification.catalog]?.find((level) => level.code === code)?.label || shown;
    },
    [classificationCatalog],
  );

  const amountsLabel = useCallback(
    (value: AiPreviewAmounts): string => {
      const money = (amount: number) => {
        const digits = Number.isInteger(amount) ? 0 : 2;
        return value.currency
          ? formatCurrency(amount, locale, value.currency, { minimumFractionDigits: digits, maximumFractionDigits: digits })
          : formatDecimal(amount, locale, digits);
      };
      const columnLabel = (measure: string) => {
        const column = AMOUNT_COLUMNS.find((entry) => entry.measure === measure);
        const name = value.column_names?.[measure] || (column ? t(column.labelKey) : measure);
        return value.year == null ? name : `${name} ${value.year}`;
      };
      if (value.quarters) {
        const quarters = (['Q1', 'Q2', 'Q3', 'Q4'] as const)
          .map((quarter, index) => `${t('ops:budgetTab.result.quarter', { n: index + 1 })} ${money(value.quarters!.values[quarter] ?? 0)}`)
          .join(', ');
        return t('ai:previewCard.amounts.column', { column: columnLabel(value.quarters.measure), amount: quarters });
      }
      if (value.months != null) {
        return t('ai:previewCard.amounts.months', { count: value.months, year: value.year ?? '' });
      }
      const totals = value.totals ?? {};
      return AMOUNT_COLUMNS
        .filter((column) => totals[column.measure] != null)
        .map((column) => t('ai:previewCard.amounts.column', { column: columnLabel(column.measure), amount: money(totals[column.measure]!) }))
        .join(', ');
    },
    [locale, t],
  );

  /**
   * The items of a relation, each role named as on the screens in the person's language (a role a person
   * typed stays as typed, a server role from the tenant's catalog); the names as sent.
   */
  const relationItemsLabel = useCallback(
    (items: AiPreviewRelationItem[]): string | null => {
      if (items.length === 0) return null;
      return items.map((item) => {
        if (item.host) return t('ai:previewCard.relationItems.hostContains', { host: item.host, name: item.name });
        const role = item.role;
        if (!role) return item.name;
        if (role.kind === 'server_role') {
          const environment = item.environment
            ? known([`it:enums.environment.${camel(codeOf(item.environment))}`]) ?? item.environment
            : null;
          const roleLabel = labelFor('serverRole', role.code) || role.code;
          return environment
            ? t('ai:previewCard.relationItems.assignment', { environment, name: item.name, role: roleLabel })
            : t('ai:previewCard.relationItems.withRole', { name: item.name, role: roleLabel });
        }
        if (role.kind === 'text') return t('ai:previewCard.relationItems.withRole', { name: item.name, role: role.code });
        const roleLabel = known([RELATION_ROLE_KEYS[role.kind](codeOf(role.code))]) ?? role.code;
        return role.kind === 'contact'
          ? t('ai:previewCard.relationItems.withRole', { name: item.name, role: roleLabel })
          : t('ai:previewCard.relationItems.role', { role: roleLabel, name: item.name });
      }).join(', ');
    },
    [known, labelFor, t],
  );

  return { fieldLabel, valueLabel, amountsLabel, classificationLabel, relationItemsLabel };
}
