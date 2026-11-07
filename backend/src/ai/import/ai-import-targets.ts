import type { EntityManager } from 'typeorm';
import type { CsvLanguage } from '../../common/csv-sheet';
import { BUDGET_AMOUNT_COLUMNS } from '../../common/csv-sheet';
import { CsvEntityConfig, CsvFieldDefinition, CsvFieldType } from '../../common/csv/csv-field.types';
import { applicationCsvConfig } from '../../applications/application-csv.config';
import { assetCsvConfig } from '../../assets/asset-csv.config';
import { ASSET_ENVIRONMENT_LABELS } from '../../assets/asset-environments';
import { portfolioProjectCsvConfig } from '../../portfolio/portfolio-project-csv.config';
import { portfolioRequestCsvConfig } from '../../portfolio/portfolio-request-csv.config';
import { taskCsvConfig } from '../../tasks/task-csv.config';
import { incidentCsvConfig } from '../../incidents/incident-csv.config';
import { SUPPLIER_CSV_COLUMNS, SUPPLIER_CSV_HEADERS } from '../../suppliers/supplier-csv-headers';
import { CONTRACT_CSV_COLUMNS, CONTRACT_CSV_HEADERS } from '../../contracts/contract-csv-headers';
import { COST_CENTER_CSV_HEADERS } from '../../cost-centers/cost-centers-csv.service';
import { ANALYTICS_VALUE_CSV_HEADERS } from '../../analytics/analytics-categories-csv.service';
import { CALENDAR_MONTH_HEADERS, WORKING_DAY_PROFILE_CSV_HEADERS } from '../../working-day-profiles/working-day-profiles-csv.service';
import { APPLICATION_LINK_CSV_HEADERS, ASSET_LINK_CSV_HEADERS } from '../../technologies/technology-links-csv.service';
import { BUSINESS_PROCESS_TYPES } from '../../business-processes/business-process-tree';
import { detailColumns, EXPORT_ONLY_COLUMNS } from '../../spend/budget-file/columns';
import { DEFAULT_ANALYTICS_AXIS_LABELS, loadAnalyticsAxes } from '../../analytics/analytics-axes.util';
import type { AiImportColumnKind } from './ai-import-convert';
import { defaultColumnTitle } from './ai-import-titles';
import { AI_IMPORT_ACCESS, type AiImportAccess, type AiImportKey } from './ai-import-access';
import {
  BILLING_FREQUENCY_LABELS,
  BUDGET_NATURE_LABELS,
  COST_CENTER_KIND_LABELS,
  LINE_USAGE_LABELS,
  PROCESS_TYPE_LABELS,
  RUN_BUILD_LABELS,
  labelsForEnum,
} from './ai-import-code-labels';

export { AI_IMPORT_KEYS, type AiImportKey } from './ai-import-access';

/**
 * The imports Plaid maps a spreadsheet onto: every import of business data, as its screen offers it,
 * with the columns of its template. Two imports stay on their screens: people (Admin › Users) and
 * data access (Admin › Data access), as every change of an account or of a person's access does; and
 * the incident journal, which only the sample data loads.
 *
 * A column says how its cells convert (`kind`): the catalogs are the workspace's IT catalogs, read by
 * name in any language; a country is read by its code or its name; a reference names another record
 * (a supplier, a location, a person) and is checked by the import's own validation when it runs.
 */

/** The workspace IT catalogs a column reads by name (`ItOpsSettings`). */
export type AiImportCatalog =
  | 'applicationCategories' | 'lifecycleStates' | 'businessCriticalityLevels' | 'cyberCriticalityLevels' | 'dataClasses'
  | 'recoveryWaves' | 'accessMethods' | 'serverKinds' | 'adminZones' | 'domains' | 'ipAddressTypes' | 'incidentCategories';

export interface AiImportColumnSpec {
  column: string;
  kind: AiImportColumnKind;
  required?: boolean;
  codes?: readonly string[];
  catalog?: AiImportCatalog;
  multi?: boolean;
  /** A number that is a percentage, 0 to 100. */
  percent?: boolean;
  /** The name of each code in each language: read as the code, shown on the card. */
  labels?: Readonly<Record<CsvLanguage, Readonly<Record<string, string>>>>;
  /** What the column takes, for the model, when its name does not say it. */
  hint?: string;
  titles?: Partial<Record<CsvLanguage, string>>;
}


export interface AiImportTarget extends AiImportAccess {
  key: AiImportKey;
  /** The list the import fills, in each language: the card's title. */
  names: Record<CsvLanguage, string>;
  /** What a row is and how it matches a stored record, for the model. */
  about: string;
  columns(ctx: { manager: EntityManager; tenantId: string }): Promise<AiImportColumnSpec[]> | AiImportColumnSpec[];
}

const STATUS_CODES = ['enabled', 'disabled'] as const;
/** The status as the screens name it. */
export const STATUS_LABELS: Record<CsvLanguage, Record<string, string>> = {
  en: { enabled: 'Enabled', disabled: 'Disabled' },
  fr: { enabled: 'Activé', disabled: 'Désactivé' },
  de: { enabled: 'Aktiviert', disabled: 'Deaktiviert' },
  es: { enabled: 'Activado', disabled: 'Desactivado' },
};
const status: AiImportColumnSpec = { column: 'status', kind: 'codes', codes: STATUS_CODES, labels: STATUS_LABELS };
const disabledAt: AiImportColumnSpec = { column: 'disabled_at', kind: 'date', hint: 'the day the record stops being used' };
const text = (column: string, hint?: string, required = false): AiImportColumnSpec => ({ column, kind: 'text', hint, required });
const date = (column: string, required = false): AiImportColumnSpec => ({ column, kind: 'date', required });
const number = (column: string, hint?: string): AiImportColumnSpec => ({ column, kind: 'number', hint });
const email = (column: string, hint = 'the e-mail of a person of the workspace'): AiImportColumnSpec => ({ column, kind: 'email', hint });
const reference = (column: string, hint: string, required = false): AiImportColumnSpec => ({ column, kind: 'reference', hint, required });
const country = (column: string, required = false): AiImportColumnSpec => ({ column, kind: 'country', required });
/** A person the incident import finds by e-mail or by name. */
const PERSON = 'a person of the workspace, by e-mail or by "First Last" name';

/** Identity columns a person's own file never holds (a KANAP id or reference): left to the template. */
const IDENTITY_COLUMNS = new Set(['id', 'ref', 'reference', 'item_number', 'kanap_token']);

function isStatusList(codes: readonly string[] | undefined): boolean {
  return codes?.length === STATUS_CODES.length && STATUS_CODES.every((code) => codes.includes(code));
}

function kindOfField(field: CsvFieldDefinition): AiImportColumnKind {
  if (field.enumValues?.length) return 'codes';
  switch (field.type) {
    case CsvFieldType.NUMBER: return 'number';
    case CsvFieldType.DATE: return 'date';
    case CsvFieldType.BOOLEAN: return 'boolean';
    case CsvFieldType.ENUM: return 'codes';
    case CsvFieldType.FK_BY_EMAIL: return 'email';
    case CsvFieldType.FK_BY_NAME:
    case CsvFieldType.FK_BY_CODE: return 'reference';
    default: return /_email(_\d+)?$/.test(field.csvColumn) ? 'email' : 'text';
  }
}

/**
 * The columns of a declarative import, its importable fields in the template's order, with what
 * `overrides` says beyond the field type (a catalog read by name, a hint).
 */
function fromCsvConfig(config: CsvEntityConfig, overrides: Record<string, Partial<AiImportColumnSpec>> = {}): AiImportColumnSpec[] {
  return config.fields
    .filter((field) => field.importable !== false && !IDENTITY_COLUMNS.has(field.csvColumn) && field.type !== CsvFieldType.JSON)
    .map((field) => {
      const labels = isStatusList(field.enumValues) ? STATUS_LABELS : labelsForEnum(field.enumValues);
      return {
        column: field.csvColumn,
        kind: kindOfField(field),
        required: field.required === true,
        ...(field.enumValues?.length ? { codes: field.enumValues } : {}),
        ...(labels ? { labels } : {}),
        ...(field.zonedDateTime ? { kind: 'datetime' as const } : {}),
        titles: config.headerLabels?.[field.csvColumn],
        ...overrides[field.csvColumn],
      };
    });
}

const catalog = (list: AiImportCatalog, multi = false): Partial<AiImportColumnSpec> => ({ kind: 'catalog', catalog: list, multi });
const owners = (prefix: string): Record<string, Partial<AiImportColumnSpec>> =>
  Object.fromEntries([1, 2, 3, 4].map((index) => [`${prefix}_${index}`, { kind: 'email' as const }]));

/** The years a file's yearly columns usually cover: the previous one to the next one. */
function nearYears(): number[] {
  const year = new Date().getFullYear();
  return [year - 1, year, year + 1];
}

function withTitles(columns: AiImportColumnSpec[], titles: Record<string, Partial<Record<CsvLanguage, string>>>): AiImportColumnSpec[] {
  return columns.map((column) => ({ ...column, titles: column.titles ?? titles[column.column] }));
}

export const AI_IMPORT_TARGETS: Record<AiImportKey, AiImportTarget> = {
  applications: {
    key: 'applications',
    names: { en: 'Applications', fr: 'Applications', de: 'Anwendungen', es: 'Aplicaciones' },
    ...AI_IMPORT_ACCESS.applications,
    about: 'One row per application, matched to a stored one by its name.',
    columns: () => fromCsvConfig(applicationCsvConfig, {
      lifecycle: catalog('lifecycleStates'),
      category: catalog('applicationCategories'),
      criticality: catalog('businessCriticalityLevels'),
      cyber_criticality: catalog('cyberCriticalityLevels'),
      data_class: catalog('dataClasses'),
      recovery_wave: catalog('recoveryWaves'),
      access_methods: catalog('accessMethods', true),
      supplier_name: { hint: 'a supplier by name' },
      rto_minutes: { kind: 'number', hint: 'minutes' },
      rpo_minutes: { kind: 'number', hint: 'minutes' },
      data_residency: { kind: 'country', multi: true },
      ...owners('business_owner_email'),
      ...owners('it_owner_email'),
    }),
  },
  assets: {
    key: 'assets',
    names: { en: 'Servers', fr: 'Serveurs', de: 'Server', es: 'Servidores' },
    ...AI_IMPORT_ACCESS.assets,
    about: 'One row per server or other asset, matched to a stored one by its name.',
    columns: () => fromCsvConfig(assetCsvConfig, {
      kind: catalog('serverKinds'),
      environment: { kind: 'codes', codes: Object.keys(ASSET_ENVIRONMENT_LABELS.en), labels: ASSET_ENVIRONMENT_LABELS },
      admin_zone: catalog('adminZones'),
      status: catalog('lifecycleStates'),
      domain: catalog('domains'),
      location_reference: { hint: 'the code of a location of the workspace' },
      cluster: { hint: 'the names of the clusters the asset belongs to, separated by commas' },
      aliases: { hint: 'other names, separated by commas' },
      ...Object.fromEntries([1, 2, 3, 4].map((index) => [`ip_${index}_type`, catalog('ipAddressTypes')])),
    }),
  },
  portfolio_projects: {
    key: 'portfolio_projects',
    names: { en: 'Projects', fr: 'Projets', de: 'Projekte', es: 'Proyectos' },
    ...AI_IMPORT_ACCESS.portfolio_projects,
    about: 'One row per project, matched to a stored one by its name.',
    columns: () => fromCsvConfig(portfolioProjectCsvConfig, {
      execution_progress: { percent: true, hint: 'percent, 0 to 100; a cell shown as a percentage (45%) reads as 45' },
      estimated_effort_it: { hint: 'man-days' },
      estimated_effort_business: { hint: 'man-days' },
      baseline_effort_it: { hint: 'man-days' },
      baseline_effort_business: { hint: 'man-days' },
    }),
  },
  portfolio_requests: {
    key: 'portfolio_requests',
    names: { en: 'Requests', fr: 'Demandes', de: 'Anfragen', es: 'Solicitudes' },
    ...AI_IMPORT_ACCESS.portfolio_requests,
    about: 'One row per request, matched to a stored one by its name.',
    columns: () => fromCsvConfig(portfolioRequestCsvConfig),
  },
  tasks: {
    key: 'tasks',
    names: { en: 'Tasks', fr: 'Tâches', de: 'Aufgaben', es: 'Tareas' },
    ...AI_IMPORT_ACCESS.tasks,
    about: 'One row per task, matched to a stored one by its title.',
    columns: () => fromCsvConfig(taskCsvConfig, {
      ...owners('viewer_email'),
      ...owners('owner_email'),
      labels: { hint: 'labels separated by commas' },
      related_object_id: { hint: 'the id of the record the task belongs to' },
    }),
  },
  incidents: {
    key: 'incidents',
    names: { en: 'Incidents', fr: 'Incidents', de: 'Vorfälle', es: 'Incidentes' },
    ...AI_IMPORT_ACCESS.incidents,
    about: 'One row per incident; every row creates a new incident.',
    columns: () => fromCsvConfig(incidentCsvConfig, {
      category: catalog('incidentCategories'),
      reporter: { kind: 'reference', hint: PERSON },
      owner: { kind: 'reference', hint: PERSON },
    }),
  },
  budget_lines: {
    key: 'budget_lines',
    names: { en: 'Budget lines', fr: 'Lignes budgétaires', de: 'Budgetzeilen', es: 'Líneas presupuestarias' },
    ...AI_IMPORT_ACCESS.budget_lines,
    about: 'One row per budget line, OPEX or CAPEX; every row creates a new line. Amount columns are named '
      + '<measure>_<year> (budget_2026, revision_2026, forecast_2026, actual_2026, landing_2026).',
    columns: async (ctx) => {
      const axes = await loadAnalyticsAxes(ctx.manager, ctx.tenantId);
      const dimensions = axes.filter((axis) => axis.status === 'enabled').map((axis) => axis.code);
      const specs: Record<string, AiImportColumnSpec> = {
        nature: { column: 'nature', kind: 'codes', codes: ['opex', 'capex'], required: true, labels: BUDGET_NATURE_LABELS },
        name: text('name', undefined, true),
        company_name: reference('company_name', 'a company by name'),
        supplier_name: reference('supplier_name', 'a supplier by name'),
        supplier_erp_id: text('supplier_erp_id', 'the supplier\'s id in the ERP'),
        account_number: reference('account_number', 'the number of an account of the chart of accounts', true),
        cost_center_code: reference('cost_center_code', 'the code of a cost center'),
        run_build: { column: 'run_build', kind: 'codes', codes: ['run', 'build'], labels: RUN_BUILD_LABELS },
        owner_it_email: email('owner_it_email'),
        owner_business_email: email('owner_business_email'),
        project: reference('project', 'a project by name or reference'),
        currency: text('currency', 'a three-letter currency code', true),
        effective_start: date('effective_start'),
        end_of_validity: date('end_of_validity'),
      };
      const columns = detailColumns(dimensions)
        .filter((column) => !IDENTITY_COLUMNS.has(column) && !EXPORT_ONLY_COLUMNS.has(column))
        .map((column) => {
          if (specs[column]) return specs[column];
          if (!column.startsWith('analytics:')) return text(column);
          // The dimension's name, or the default dimension's label in each language while it has none.
          const name = axes.find((entry) => `analytics:${entry.code}` === column)?.name?.trim();
          const [en, fr, de, es] = name ? [name, name, name, name] : DEFAULT_ANALYTICS_AXIS_LABELS;
          return { ...reference(column, 'a value of that analytics dimension, by name'), titles: { en, fr, de, es } };
        });
      for (const year of nearYears()) {
        for (const amount of BUDGET_AMOUNT_COLUMNS) columns.push(number(`${amount.names[0]}_${year}`, 'an amount of the year'));
      }
      return columns;
    },
  },
  contracts: {
    key: 'contracts',
    names: { en: 'Contracts', fr: 'Contrats', de: 'Verträge', es: 'Contratos' },
    ...AI_IMPORT_ACCESS.contracts,
    about: 'One row per contract, matched to a stored one by its name and supplier.',
    columns: () => withTitles(CONTRACT_CSV_COLUMNS.map((column) => ({
      name: text('name', undefined, true),
      company_name: reference('company_name', 'a company by name', true),
      supplier_name: reference('supplier_name', 'a supplier by name', true),
      cost_center: reference('cost_center', 'a cost center by name'),
      start_date: date('start_date', true),
      duration_months: number('duration_months', 'months'),
      auto_renewal: { column: 'auto_renewal', kind: 'boolean' } as AiImportColumnSpec,
      notice_period_months: number('notice_period_months', 'months'),
      yearly_amount_at_signature: number('yearly_amount_at_signature', 'the yearly amount'),
      currency: text('currency', 'a three-letter currency code'),
      billing_frequency: { column: 'billing_frequency', kind: 'codes', codes: ['monthly', 'quarterly', 'annual', 'other'], labels: BILLING_FREQUENCY_LABELS } as AiImportColumnSpec,
      status,
      owner_email: email('owner_email'),
      notes: text('notes'),
    } as Record<string, AiImportColumnSpec>)[column] ?? text(column)), CONTRACT_CSV_HEADERS),
  },
  suppliers: {
    key: 'suppliers',
    names: { en: 'Suppliers', fr: 'Fournisseurs', de: 'Lieferanten', es: 'Proveedores' },
    ...AI_IMPORT_ACCESS.suppliers,
    about: 'One row per supplier, matched to a stored one by its name.',
    columns: () => withTitles(SUPPLIER_CSV_COLUMNS.map((column) => ({
      name: text('name', undefined, true),
      erp_supplier_id: text('erp_supplier_id', 'the supplier\'s id in the ERP'),
      commercial_contact: reference('commercial_contact', 'the e-mail of a contact already in the workspace'),
      technical_contact: reference('technical_contact', 'the e-mail of a contact already in the workspace'),
      support_contact: reference('support_contact', 'the e-mail of a contact already in the workspace'),
      status,
      disabled_at: disabledAt,
    } as Record<string, AiImportColumnSpec>)[column] ?? text(column)), SUPPLIER_CSV_HEADERS),
  },
  contacts: {
    key: 'contacts',
    names: { en: 'Contacts', fr: 'Contacts', de: 'Kontakte', es: 'Contactos' },
    ...AI_IMPORT_ACCESS.contacts,
    about: 'One row per contact, matched to a stored one by its e-mail.',
    columns: () => [
      text('first_name'), text('last_name'), text('job_title'),
      { column: 'email', kind: 'email', required: true },
      text('phone'), text('mobile'), country('country'), text('notes'),
      { column: 'active', kind: 'boolean' },
    ],
  },
  companies: {
    key: 'companies',
    names: { en: 'Companies', fr: 'Sociétés', de: 'Gesellschaften', es: 'Empresas' },
    ...AI_IMPORT_ACCESS.companies,
    about: 'One row per company, matched to a stored one by its name. A year of metrics needs its three columns: '
      + 'headcount_<year>, it_users_<year> and turnover_<year> (millions).',
    columns: () => [
      text('name', undefined, true), country('country_iso', true),
      text('address1'), text('address2'), text('postal_code'), text('city', undefined, true), text('state'),
      text('reg_number'), text('vat_number'), text('base_currency', 'a three-letter currency code', true),
      status, disabledAt, text('notes'),
      ...nearYears().flatMap((year) => [
        number(`headcount_${year}`, 'people'), number(`it_users_${year}`, 'people'), number(`turnover_${year}`, 'millions'),
      ]),
    ],
  },
  departments: {
    key: 'departments',
    names: { en: 'Departments', fr: 'Départements', de: 'Abteilungen', es: 'Departamentos' },
    ...AI_IMPORT_ACCESS.departments,
    about: 'One row per department, matched to a stored one by its company and name.',
    columns: () => [reference('company_name', 'a company by name', true), text('name', undefined, true), text('description'), status, disabledAt],
  },
  cost_centers: {
    key: 'cost_centers',
    names: { en: 'Cost centers', fr: 'Centres de coûts', de: 'Kostenstellen', es: 'Centros de coste' },
    ...AI_IMPORT_ACCESS.cost_centers,
    about: 'One row per cost center or group, matched to a stored one by its code.',
    columns: () => COST_CENTER_CSV_HEADERS.map((column) => ({
      code: text('code', undefined, true),
      kind: { column: 'kind', kind: 'codes', codes: ['group', 'cost_center'], required: true, labels: COST_CENTER_KIND_LABELS } as AiImportColumnSpec,
      name: text('name', undefined, true),
      parent_code: reference('parent_code', 'the code of the parent group'),
      company_name: reference('company_name', 'a company by name'),
      owner_email: email('owner_email'),
      status,
      disabled_at: disabledAt,
    } as Record<string, AiImportColumnSpec>)[column] ?? text(column)),
  },
  accounts: {
    key: 'accounts',
    names: { en: 'Accounts', fr: 'Comptes', de: 'Konten', es: 'Cuentas' },
    ...AI_IMPORT_ACCESS.accounts,
    about: 'One row per account of a chart of accounts, matched to a stored one by its number in that chart.',
    columns: () => [
      reference('coa_code', 'the code of the chart of accounts, the same on every row', true),
      { column: 'account_number', kind: 'number', required: true, hint: 'a whole number' },
      text('account_name', undefined, true), text('native_name'), text('description'),
      number('consolidation_account_number', 'a whole number'), text('consolidation_account_name'),
      text('consolidation_account_description'), status,
      { column: 'nature', kind: 'codes', codes: ['opex', 'capex'], labels: LINE_USAGE_LABELS },
    ],
  },
  analytics_categories: {
    key: 'analytics_categories',
    names: { en: 'Analytics values', fr: 'Valeurs analytiques', de: 'Analysewerte', es: 'Valores analíticos' },
    ...AI_IMPORT_ACCESS.analytics_categories,
    about: 'One row per value of an analytics dimension, matched to a stored one by its dimension and name.',
    columns: () => ANALYTICS_VALUE_CSV_HEADERS.map((column) => ({
      axis_code: reference('axis_code', 'the code of the dimension; blank for the default one'),
      name: text('name', undefined, true),
      status,
      disabled_at: disabledAt,
      applies_to: { column: 'applies_to', kind: 'codes', codes: ['opex', 'capex'], labels: LINE_USAGE_LABELS, hint: 'blank for both OPEX and CAPEX' } as AiImportColumnSpec,
    } as Record<string, AiImportColumnSpec>)[column] ?? text(column)),
  },
  business_processes: {
    key: 'business_processes',
    names: { en: 'Business processes', fr: 'Processus métier', de: 'Geschäftsprozesse', es: 'Procesos de negocio' },
    ...AI_IMPORT_ACCESS.business_processes,
    about: 'One row per business process, matched to a stored one by its name.',
    columns: () => [
      text('name', undefined, true),
      { column: 'process_type', kind: 'codes', codes: BUSINESS_PROCESS_TYPES, labels: PROCESS_TYPE_LABELS },
      reference('parent_name', 'the parent process by name'),
      text('description'), text('notes'), status,
    ],
  },
  working_day_calendars: {
    key: 'working_day_calendars',
    names: { en: 'Working-day calendars', fr: 'Calendriers de jours ouvrés', de: 'Arbeitstagekalender', es: 'Calendarios laborables' },
    ...AI_IMPORT_ACCESS.working_day_calendars,
    about: 'One row per calendar and year, matched to a stored calendar by its code; jan to dec hold the working days of each month.',
    columns: () => WORKING_DAY_PROFILE_CSV_HEADERS.map((column) => (({
      code: text('code', undefined, true),
      name: text('name', undefined, true),
      country: country('country'),
      status,
      disabled_at: disabledAt,
      year: number('year', 'a year, needed when the months are filled'),
    } as Record<string, AiImportColumnSpec>)[column]
      ?? ((CALENDAR_MONTH_HEADERS as readonly string[]).includes(column) ? number(column, 'working days of the month') : text(column)))),
  },
  technology_asset_links: {
    key: 'technology_asset_links',
    names: { en: 'Technologies of servers', fr: 'Technologies des serveurs', de: 'Technologien der Server', es: 'Tecnologías de los servidores' },
    ...AI_IMPORT_ACCESS.technology_asset_links,
    about: 'One row per technology installed on a server (a server by reference or name, a technology by reference or name, a version).',
    columns: () => ASSET_LINK_CSV_HEADERS.filter((column) => column !== 'source').map((column) => ({
      asset_reference: reference('asset_reference', 'the reference of a server, AST-n'),
      asset_name: reference('asset_name', 'a server by name'),
      technology_reference: reference('technology_reference', 'the reference of a technology, TEC-n'),
      technology_name: reference('technology_name', 'a technology by name'),
      version: text('version'),
      operating_system: { column: 'operating_system', kind: 'boolean', hint: 'yes when the technology is the server\'s operating system' } as AiImportColumnSpec,
    } as Record<string, AiImportColumnSpec>)[column] ?? text(column)),
  },
  technology_application_links: {
    key: 'technology_application_links',
    names: { en: 'Technologies of applications', fr: 'Technologies des applications', de: 'Technologien der Anwendungen', es: 'Tecnologías de las aplicaciones' },
    ...AI_IMPORT_ACCESS.technology_application_links,
    about: 'One row per technology an application uses (an application by reference or name, a technology by reference or name, a version).',
    columns: () => APPLICATION_LINK_CSV_HEADERS.filter((column) => column !== 'source').map((column) => ({
      application_reference: reference('application_reference', 'the reference of an application, APP-n'),
      application_name: reference('application_name', 'an application by name'),
      technology_reference: reference('technology_reference', 'the reference of a technology, TEC-n'),
      technology_name: reference('technology_name', 'a technology by name'),
      version: text('version'),
    } as Record<string, AiImportColumnSpec>)[column] ?? text(column)),
  },
};

/** The column's title in the language, else the template's own header. */
export function importColumnTitle(spec: AiImportColumnSpec, language: CsvLanguage): string {
  return spec.titles?.[language] ?? defaultColumnTitle(spec.column, language) ?? spec.titles?.en ?? spec.column;
}
