/**
 * The fields of Kad's read registries that `AI_NAMED_FIELDS` (`ai-code-names.ts`) does not name,
 * checked by `ai-code-names.spec.ts`: every set field of a registry is named, a yes-or-no field, or
 * listed here. A field added tomorrow fails the spec until it is placed.
 */

/**
 * Codes read without their name because no screen names them: the screen shows the value another
 * way (a row present or absent, a country column), and no locale key holds a word for each code in
 * the four languages. A list is not invented for Kad alone; naming one of these needs the screen's
 * words first, then an entry of `AI_CODE_LISTS` and of `AI_NAMED_FIELDS`, and its removal from here.
 */
export const AI_CODE_NAMES_PENDING: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  users: {
    contributor_profile: 'no screen word: the Contributors list shows a person with a profile, and nothing for one without',
  },
  working_day_calendars: {
    kind: 'no screen word: the list shows a standard calendar by its country and a custom one by an empty country',
    source: 'no screen word: the calendar shows the standard values of a year next to the days entered by hand',
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
  accounts: { quantity_price_expected: 'a yes-or-no setting: true when the account sets it, null when it does not (never stored false)' },
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
