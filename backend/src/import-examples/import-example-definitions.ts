import type { CsvLanguage } from '../common/csv-sheet';
import { applicationCsvConfig } from '../applications/application-csv.config';
import { assetCsvConfig } from '../assets/asset-csv.config';
import { portfolioProjectCsvConfig } from '../portfolio/portfolio-project-csv.config';
import { SUPPLIER_CSV_HEADERS } from '../suppliers/supplier-csv-headers';
import { CONTRACT_CSV_HEADERS } from '../contracts/contract-csv-headers';
import type { ColumnHint, ReferenceThing } from './import-example-texts';

/** The IT catalogs an example cell is written from, by their name in the tenant's settings. */
export type CatalogList =
  | 'applicationCategories' | 'lifecycleStates' | 'businessCriticalityLevels' | 'cyberCriticalityLevels' | 'dataClasses'
  | 'recoveryWaves' | 'accessMethods' | 'serverKinds' | 'adminZones' | 'domains' | 'ipAddressTypes';

/**
 * How a column of an example is written and explained. A catalog cell is written as the name the
 * export writes (the tenant's catalog, in the file's language), and its notes list the names.
 */
export type ExampleColumn = { required?: boolean } & (
  | { kind: 'text' | 'date' | 'number' | 'amount' | 'bool'; hint?: ColumnHint }
  | { kind: 'catalog'; list: CatalogList; multi?: boolean }
  | { kind: 'codes'; codes: readonly string[] }
  | { kind: 'environment' }
  | { kind: 'reference'; thing: ReferenceThing }
);

export const IMPORT_EXAMPLE_KEYS = ['applications', 'assets', 'portfolio-projects', 'suppliers', 'contracts', 'budget-lines'] as const;
export type ImportExampleKey = (typeof IMPORT_EXAMPLE_KEYS)[number];

export interface ImportExampleDefinition {
  /** The list in the name of the file, in each language: `applications-example.xlsx`. */
  fileNames: Record<CsvLanguage, string>;
  /** The header of a column in the file's language, as the import reads it. */
  header: (column: string, language: CsvLanguage) => string;
  /** Every column the fixture names, budget amount columns aside (`budget_{Y}`: read from their name). */
  columns: Record<string, ExampleColumn>;
}

const fromLabels = (labels: Record<string, Partial<Record<CsvLanguage, string>>> | undefined) =>
  (column: string, language: CsvLanguage) => labels?.[column]?.[language] ?? column;

const text = (hint?: ColumnHint): ExampleColumn => ({ kind: 'text', hint });
const date = (hint?: ColumnHint): ExampleColumn => ({ kind: 'date', hint });
const number = (hint?: ColumnHint): ExampleColumn => ({ kind: 'number', hint });
const bool: ExampleColumn = { kind: 'bool' };
const catalog = (list: CatalogList, multi = false): ExampleColumn => ({ kind: 'catalog', list, multi });
const reference = (thing: ReferenceThing, required = false): ExampleColumn => ({ kind: 'reference', thing, required });
const userEmail = text('userEmail');

export const IMPORT_EXAMPLES: Record<ImportExampleKey, ImportExampleDefinition> = {
  applications: {
    fileNames: { en: 'applications', fr: 'applications', de: 'anwendungen', es: 'aplicaciones' },
    header: fromLabels(applicationCsvConfig.headerLabels),
    columns: {
      name: { kind: 'text', required: true },
      description: text(),
      category: catalog('applicationCategories'),
      lifecycle: catalog('lifecycleStates'),
      editor: text(),
      version: text('version'),
      go_live_date: date(),
      criticality: catalog('businessCriticalityLevels'),
      external_facing: bool,
      contains_pii: bool,
      supplier_name: reference('supplier'),
      business_owner_email_1: userEmail,
      it_owner_email_1: userEmail,
      end_of_support_date: date(),
      access_methods: catalog('accessMethods', true),
      data_class: catalog('dataClasses'),
      cyber_criticality: catalog('cyberCriticalityLevels'),
      recovery_wave: catalog('recoveryWaves'),
      rto_minutes: number('minutes'),
      rpo_minutes: number('minutes'),
      data_residency: text('countries'),
      last_dr_test: date(),
      support_notes: text(),
      licensing: text(),
      notes: text(),
    },
  },
  assets: {
    fileNames: { en: 'servers', fr: 'serveurs', de: 'server', es: 'servidores' },
    header: fromLabels(assetCsvConfig.headerLabels),
    columns: {
      name: { kind: 'text', required: true },
      kind: { kind: 'catalog', list: 'serverKinds', required: true },
      environment: { kind: 'environment', required: true },
      location_reference: reference('location', true),
      status: catalog('lifecycleStates'),
      go_live_date: date(),
      hostname: text('hostname'),
      operating_system: text('operatingSystem'),
      is_cluster: bool,
      cluster: reference('cluster'),
      admin_zone: catalog('adminZones'),
      domain: catalog('domains'),
      end_of_life_date: date(),
      aliases: text('names'),
      ip_1_type: catalog('ipAddressTypes'),
      ip_1_address: text('ipAddress'),
      ip_1_subnet_cidr: text('subnet'),
      ip_2_type: catalog('ipAddressTypes'),
      ip_2_address: text('ipAddress'),
      ip_2_subnet_cidr: text('subnet'),
      notes: text(),
    },
  },
  'portfolio-projects': {
    fileNames: { en: 'projects', fr: 'projets', de: 'projekte', es: 'proyectos' },
    header: fromLabels(portfolioProjectCsvConfig.headerLabels),
    columns: {
      name: { kind: 'text', required: true },
      purpose: text(),
      status: { kind: 'codes', codes: ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold', 'done', 'cancelled'] },
      origin: { kind: 'codes', codes: ['standard', 'fast_track', 'legacy'] },
      planned_start: date(),
      planned_end: date(),
      estimated_effort_it: number('manDays'),
      estimated_effort_business: number('manDays'),
      source_name: reference('source'),
      category_name: reference('category'),
      stream_name: reference('stream'),
      company_name: reference('company'),
      department_name: reference('department'),
      business_sponsor_email: userEmail,
      business_lead_email: userEmail,
      it_sponsor_email: userEmail,
      it_lead_email: userEmail,
      actual_start: date(),
      actual_end: date(),
      execution_progress: number('percent'),
    },
  },
  suppliers: {
    fileNames: { en: 'suppliers', fr: 'fournisseurs', de: 'lieferanten', es: 'proveedores' },
    header: fromLabels(SUPPLIER_CSV_HEADERS),
    columns: {
      name: { kind: 'text', required: true },
      erp_supplier_id: text('erpId'),
      commercial_contact: text('contactEmail'),
      technical_contact: text('contactEmail'),
      support_contact: text('contactEmail'),
      notes: text(),
      status: { kind: 'codes', codes: ['enabled', 'disabled'] },
      disabled_at: date('endDay'),
    },
  },
  contracts: {
    fileNames: { en: 'contracts', fr: 'contrats', de: 'vertraege', es: 'contratos' },
    header: fromLabels(CONTRACT_CSV_HEADERS),
    columns: {
      name: { kind: 'text', required: true },
      company_name: reference('company', true),
      supplier_name: reference('supplier', true),
      cost_center: reference('costCenterName'),
      start_date: { kind: 'date', required: true },
      duration_months: number('months'),
      auto_renewal: bool,
      notice_period_months: number('months'),
      yearly_amount_at_signature: { kind: 'amount' },
      currency: text('currency'),
      billing_frequency: { kind: 'codes', codes: ['monthly', 'quarterly', 'annual', 'other'] },
      status: { kind: 'codes', codes: ['enabled', 'disabled'] },
      owner_email: userEmail,
      notes: text(),
    },
  },
  'budget-lines': {
    fileNames: { en: 'budget', fr: 'budget', de: 'budget', es: 'presupuesto' },
    // The budget file keeps its technical headers, whatever the language: its notes explain them.
    header: (column) => column,
    columns: {
      nature: { kind: 'codes', codes: ['opex', 'capex'], required: true },
      name: { kind: 'text', required: true },
      company_name: reference('company'),
      supplier_name: reference('supplier'),
      account_number: reference('account', true),
      cost_center_code: reference('costCenterCode'),
      currency: { kind: 'text', hint: 'currency', required: true },
      description: text(),
      run_build: { kind: 'codes', codes: ['run', 'build'] },
      owner_it_email: userEmail,
      owner_business_email: userEmail,
      project: reference('project'),
      effective_start: date('startDay'),
      end_of_validity: date('endDay'),
      notes: text(),
    },
  },
};
