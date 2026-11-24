/**
 * The fields of Kad's read registries that `AI_NAMED_FIELDS` (`ai-code-names.ts`) does not name,
 * checked by `ai-code-names.spec.ts`: every set field of a registry is named, a yes-or-no field, or
 * listed here. A field added tomorrow fails the spec until it is placed.
 */

/**
 * Codes still read without their name, with where the screen takes the name (a locale object
 * `namespace:path` of the frontend, a catalog of the workspace, or the screen that holds the words).
 * Naming one is an entry of `AI_CODE_LISTS` (a copy checked against that object, or a catalog) and
 * of `AI_NAMED_FIELDS`, and its removal from here. An item's `status` that repeats a field is
 * named with that field.
 */
export const AI_CODE_NAMES_PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  applications: {
    classification_review_state: 'frontend pages/it/ApplicationsPage.tsx and components/ApplicationClassificationPanel.tsx (review state words: incomplete, stale, reviewed)',
    users_mode: 'admin:auditLogs.values.usersMode',
    data_residency: 'country names: frontend/src/i18n/countries (countryNameFor)',
    vulnerabilities: 'it:pages.technologies.vulnerabilityFilter (severe, any, none)',
  },
  assets: {
    provider: 'catalog hostingTypes, else catalog serverProviders (it:catalogDefaults.hostingTypes / serverProviders)',
    vulnerabilities: 'it:pages.technologies.vulnerabilityFilter (severe, any, none)',
  },
  chart_of_accounts: {
    scope: 'frontend pages/coa/coaRoles.ts (GLOBAL, COUNTRY)',
    country_iso: 'country names: frontend/src/i18n/countries (countryNameFor)',
  },
  companies: {
    country: 'country names: frontend/src/i18n/countries (countryNameFor)',
    country_iso: 'country names: frontend/src/i18n/countries (countryNameFor)',
  },
  contacts: {
    country: 'country names: frontend/src/i18n/countries (countryNameFor)',
  },
  locations: {
    provider: 'frontend pages/it location workspace: provider (catalog serverProviders, or an operating company name)',
    country: 'country names: frontend/src/i18n/countries (countryNameFor)',
    country_iso: 'country names: frontend/src/i18n/countries (countryNameFor)',
  },
  connections: {
    topology: 'it:enums.topology (camel case keys)',
    risk_mode: 'it:enums.riskMode',
  },
  interfaces: {
    integration_route_type: 'it:enums.routeType (camel case keys)',
  },
  data_access: {
    status: 'the item\'s access (same words as access)',
    node_type: 'frontend pages/admin/DataAccessPage.tsx and components/dataAccess (all data, company, cost center)',
    node_kind: 'admin:auditLogs.values.costCenterKind (group, cost_center)',
    access: 'admin:dataAccess.access (read, edit)',
  },
  documents: {
    status: 'knowledge:statuses',
  },
  roles: {
    status: 'the role\'s type (same words as type)',
    type: 'frontend pages/UsersPage.tsx and components/fields/MultiRoleSelect.tsx role badges (system, built_in, custom)',
  },
  role_permissions: {
    role_type: 'frontend pages/UsersPage.tsx and components/fields/MultiRoleSelect.tsx role badges (system, built_in, custom)',
  },
  support_deadlines: {
    status: 'the row\'s state (same words as state)',
    subject_type: 'it:pages.endOfSupport.types',
    state: 'it:pages.endOfSupport.states',
    milestone: 'it:pages.endOfSupport.milestones',
  },
  support_gaps: {
    status: 'the row\'s gap (same words as gap)',
    gap: 'it:pages.endOfSupport.gaps',
    subject_type: 'it:pages.endOfSupport (types of the records to complete: application, asset, technology)',
    related_type: 'it:pages.endOfSupport (types of the records to complete: asset, application)',
  },
  tasks: {
    related: 'common:relatedObject.types (camel case keys; budget_line is a line of either nature)',
  },
  technologies: {
    support_status: 'frontend pages/it/TechnologiesPage.tsx and TechnologyWorkspacePage.tsx support state words (End of support report)',
  },
  technology_versions: {
    status: 'the version\'s support state (same words as support_status)',
    support_status: 'frontend pages/it/TechnologyWorkspacePage.tsx support state words (End of support report)',
  },
  users: {
    data_access: 'frontend components/dataAccess/dataAccess.ts (all data, limited)',
    locale: 'settings:profile language names',
    contributor_profile: 'frontend users list, contributor profile column (configured, not_configured)',
  },
  vulnerabilities: {
    severity: 'it:pages.vulnerabilities.severities',
    score_source: 'it:pages.vulnerabilities.feeds.badge',
    sources: 'it:pages.vulnerabilities.feeds (nvd, cve_org)',
  },
  chargeback: {
    status: 'the row\'s level (same words as level)',
    column: 'the workspace\'s budget column names (localizedBudgetColumns, ops:operations.budgetColumns)',
    level: 'frontend chargeback report rows (company total, department, common costs)',
  },
  chargeback_lines: {
    column: 'the workspace\'s budget column names (localizedBudgetColumns, ops:operations.budgetColumns)',
  },
  working_day_calendars: {
    kind: 'frontend working-day calendars screen (standard, custom)',
    source: 'frontend working-day calendars screen, year source (edited, standard, none)',
  },
  analytics_axes: {
    applies_to: 'frontend analytics dimensions settings, "applies to" (opex, capex)',
    required_for: 'frontend analytics dimensions settings, "required for" (opex, capex)',
  },
  exchange_rates: {
    status: 'the rate\'s source (same words as source)',
    source: 'frontend pages/operations/CurrencySettingsPage.tsx rate sources',
  },
};

const NAME = 'a name the screen shows as stored (a record, a person, a library, a value of the workspace)';
const REFERENCE = 'a business reference or an identifier, shown as is';
const FREE = 'free text, shown as typed';
const CURRENCY = 'an ISO currency code, which the screens show as is';
const DATE_PART = 'a year, a month or a number';
const NAMED_ELSEWHERE = 'named by its own label field (`resource_label`, `level_label`)';

/** Set fields that hold no code to name, each with the reason. */
export const AI_NOT_CODE_FIELDS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  analytics_categories: { axis: NAME, axis_code: REFERENCE },
  applications: {
    editor: NAME, end_of_support_year: DATE_PART, supplier: NAME, it_owner: NAME, business_owner: NAME,
  },
  assets: {
    asset_reference: REFERENCE, region: FREE, zone: FREE, os: NAME, location: NAME, cluster: NAME,
  },
  budget_lines: {
    line: REFERENCE, currency: CURRENCY, supplier: NAME, paying_company: NAME, account: NAME, consolidation_account: NAME,
    owner_it: NAME, owner_business: NAME, analytics_category: NAME, cost_center: NAME, budget_holder: NAME, contract: NAME,
    project_stream: NAME, project_category: NAME,
  },
  business_processes: { parent: NAME },
  companies: { reference: REFERENCE, city: FREE, state: FREE, base_currency: CURRENCY },
  contacts: { reference: REFERENCE },
  contracts: {
    reference: REFERENCE, owner: NAME, application: NAME, currency: CURRENCY, supplier: NAME, company: NAME, cost_center: NAME,
  },
  departments: { reference: REFERENCE, company: NAME },
  documents: { library: NAME, folder: NAME, type: NAME, owner: NAME },
  incidents: {
    owner: NAME, reporter: NAME, asset: NAME, application: NAME, technology: NAME, detected_month: DATE_PART, resolved_month: DATE_PART,
  },
  projects: {
    category: NAME, stream: NAME, company: NAME, department: NAME, business_lead: NAME, it_lead: NAME, source: NAME,
  },
  requests: {
    category: NAME, stream: NAME, company: NAME, department: NAME, requestor: NAME, business_lead: NAME, it_lead: NAME, source: NAME,
  },
  role_permissions: { resource: NAMED_ELSEWHERE, level: NAMED_ELSEWHERE },
  suppliers: { reference: REFERENCE, erp_supplier_id: REFERENCE },
  support_deadlines: { end_of_support_year: DATE_PART, horizon_months: DATE_PART },
  tasks: {
    assignee: NAME, creator: NAME, type: NAME, category: NAME, stream: NAME, company: NAME, application: NAME, asset: NAME,
    source: NAME, phase: NAME, project_stream: NAME, project_category: NAME,
  },
  technologies: {
    reference: REFERENCE, publisher: NAME, version: FREE, owner: NAME, it_owner: NAME, business_owner: NAME,
  },
  technology_versions: { label: FREE, technology: NAME, end_of_support_year: DATE_PART },
  users: { company: NAME, department: NAME, primary_role: NAME, roles: NAME, team: NAME },
  vulnerabilities: { technology: NAME, version: FREE, asset: REFERENCE, application: REFERENCE },
  cost_centers: { company: NAME, budget_holder: NAME },
  exchange_rates: { currency: CURRENCY, against: CURRENCY },
};
