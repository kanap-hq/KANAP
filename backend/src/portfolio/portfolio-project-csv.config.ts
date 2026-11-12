import type { CsvLanguage } from '../common/csv-sheet';
import {
  CsvEntityConfig,
  CsvFieldType,
  CsvImportContext,
} from '../common/csv';
import { richTextCell } from '../common/csv/rich-text-cell';
import { allocateItemNumbers } from '../common/item-number.service';
import { keepStoredSlotBodies, sameAsStoredWithDocuments } from '../knowledge/integrated-document-bodies';

// Status label to code mapping
const statusLookup = new Map<string, string>([
  // Codes map to themselves
  ['waiting_list', 'waiting_list'],
  ['planned', 'planned'],
  ['in_progress', 'in_progress'],
  ['in_testing', 'in_testing'],
  ['on_hold', 'on_hold'],
  ['done', 'done'],
  ['cancelled', 'cancelled'],
  // Common labels
  ['waiting list', 'waiting_list'],
  ['waiting', 'waiting_list'],
  ['in progress', 'in_progress'],
  ['active', 'in_progress'],
  ['in testing', 'in_testing'],
  ['testing', 'in_testing'],
  ['on hold', 'on_hold'],
  ['paused', 'on_hold'],
  ['completed', 'done'],
  ['complete', 'done'],
  ['finished', 'done'],
  ['canceled', 'cancelled'],
]);

// Origin label to code mapping
const originLookup = new Map<string, string>([
  // Codes map to themselves
  ['standard', 'standard'],
  ['fast_track', 'fast_track'],
  ['legacy', 'legacy'],
  // Common labels
  ['fast track', 'fast_track'],
  ['fasttrack', 'fast_track'],
  ['fast-track', 'fast_track'],
]);

/** Status and origin accept a code or a common label. */
function normalizeCodes(entity: any): void {
  for (const [key, lookup] of [['status', statusLookup], ['origin', originLookup]] as const) {
    if (!entity[key]) continue;
    const resolved = lookup.get(String(entity[key]).trim().toLowerCase());
    if (resolved) entity[key] = resolved;
  }
}

/**
 * CSV configuration for Portfolio Projects entity
 *
 * Column order: id, reference (PRJ-n, export only), name, then ProjectWorkspacePage.tsx tab by tab:
 * - Summary: purpose, the property panel (status to planned dates, sponsors and leads)
 * - Timeline: actual and baseline dates
 * - Progress: execution_progress, efforts
 * - Scoring: criteria_values, priority fields
 */
/**
 * The title of each column in the file's language, as the export dialog names the project fields
 * (`csv.fields.portfolio_projects` of the screen). The export and the template write it, and the import reads
 * the titles of every language as well as the technical column.
 */
const PORTFOLIO_PROJECT_CSV_HEADERS: Record<string, Record<CsvLanguage, string>> = {
  reference: { en: 'Reference', fr: 'Référence', de: 'Referenz', es: 'Referencia' },
  name: { en: 'Name', fr: 'Nom', de: 'Name', es: 'Nombre' },
  purpose: { en: 'Purpose', fr: 'Objectif', de: 'Zweck', es: 'Objetivo' },
  status: { en: 'Status', fr: 'Statut', de: 'Status', es: 'Estado' },
  origin: { en: 'Origin', fr: 'Origine', de: 'Herkunft', es: 'Procedencia' },
  source_name: { en: 'Source', fr: 'Source', de: 'Quelle', es: 'Origen' },
  category_name: { en: 'Category', fr: 'Catégorie', de: 'Kategorie', es: 'Categoría' },
  stream_name: { en: 'Stream', fr: 'Filière', de: 'Stream', es: 'Línea' },
  company_name: { en: 'Company', fr: 'Société', de: 'Unternehmen', es: 'Empresa' },
  department_name: { en: 'Department', fr: 'Département', de: 'Abteilung', es: 'Departamento' },
  planned_start: { en: 'Planned start', fr: 'Début prévu', de: 'Geplanter Start', es: 'Inicio planificado' },
  planned_end: { en: 'Planned end', fr: 'Fin prévue', de: 'Geplantes Ende', es: 'Fin planificado' },
  business_sponsor_email: {
    en: 'Business sponsor email',
    fr: 'E-mail du sponsor métier',
    de: 'E-Mail Fachbereichssponsor',
    es: 'Correo del patrocinador de negocio',
  },
  business_lead_email: {
    en: 'Business lead email',
    fr: 'E-mail du responsable métier',
    de: 'E-Mail Fachbereichsleiter',
    es: 'Correo del responsable de negocio',
  },
  it_sponsor_email: { en: 'IT sponsor email', fr: 'E-mail du sponsor IT', de: 'E-Mail IT-Sponsor', es: 'Correo del patrocinador IT' },
  it_lead_email: { en: 'IT lead email', fr: 'E-mail du responsable IT', de: 'E-Mail IT-Leiter', es: 'Correo del responsable IT' },
  actual_start: { en: 'Actual start', fr: 'Début réel', de: 'Tatsächlicher Beginn', es: 'Inicio real' },
  actual_end: { en: 'Actual end', fr: 'Fin réelle', de: 'Tatsächliches Ende', es: 'Fin real' },
  baseline_start_date: { en: 'Baseline start', fr: 'Début de référence', de: 'Baseline-Start', es: 'Inicio de línea base' },
  baseline_end_date: { en: 'Baseline end', fr: 'Fin de référence', de: 'Baseline-Ende', es: 'Fin de línea base' },
  execution_progress: { en: 'Progress (%)', fr: 'Progression (%)', de: 'Fortschritt (%)', es: 'Progreso (%)' },
  estimated_effort_it: {
    en: 'Estimated IT effort (MD)',
    fr: 'Charge IT estimée (JH)',
    de: 'Geschätzter IT-Aufwand (PT)',
    es: 'Esfuerzo IT estimado (DP)',
  },
  estimated_effort_business: {
    en: 'Estimated business effort (MD)',
    fr: 'Charge métier estimée (JH)',
    de: 'Geschätzter Fachbereichs-Aufwand (PT)',
    es: 'Esfuerzo de negocio estimado (DP)',
  },
  actual_effort_it: {
    en: 'Actual IT effort (MD)',
    fr: 'Charge IT réelle (JH)',
    de: 'Tatsächlicher IT-Aufwand (PT)',
    es: 'Esfuerzo IT real (DP)',
  },
  actual_effort_business: {
    en: 'Actual business effort (MD)',
    fr: 'Charge métier réelle (JH)',
    de: 'Tatsächlicher Fachbereichs-Aufwand (PT)',
    es: 'Esfuerzo de negocio real (DP)',
  },
  baseline_effort_it: {
    en: 'Baseline IT effort (MD)',
    fr: 'Charge IT de référence (JH)',
    de: 'Baseline IT-Aufwand (PT)',
    es: 'Esfuerzo IT de línea base (DP)',
  },
  baseline_effort_business: {
    en: 'Baseline business effort (MD)',
    fr: 'Charge métier de référence (JH)',
    de: 'Baseline Fachbereichs-Aufwand (PT)',
    es: 'Esfuerzo de negocio de línea base (DP)',
  },
  criteria_values: {
    en: 'Evaluation criteria (JSON)',
    fr: 'Critères d’évaluation (JSON)',
    de: 'Bewertungskriterien (JSON)',
    es: 'Criterios de evaluación (JSON)',
  },
  priority_score: { en: 'Priority score', fr: 'Score de priorité', de: 'Prioritätsscore', es: 'Puntuación de prioridad' },
  priority_override: {
    en: 'Priority override',
    fr: 'Surcharge de priorité',
    de: 'Prioritätsüberschreibung',
    es: 'Sobrescritura de prioridad',
  },
  override_value: { en: 'Override value', fr: 'Valeur de surcharge', de: 'Überschreibungswert', es: 'Valor de sobrescritura' },
  override_justification: {
    en: 'Override justification',
    fr: 'Justification de la surcharge',
    de: 'Begründung der Überschreibung',
    es: 'Justificación de la sobrescritura',
  },
};

export const portfolioProjectCsvConfig: CsvEntityConfig = {
  entityName: 'portfolio_project',
  // The sheet of an xlsx export: the list's title on screen.
  sheetNames: { en: 'Portfolio projects', fr: 'Projets du portefeuille', de: 'Portfolio-Projekte', es: 'Proyectos del portafolio' },
  tableName: 'portfolio_projects',
  displayName: 'Portfolio Projects',
  headerLabels: PORTFOLIO_PROJECT_CSV_HEADERS,
  upsertKey: ['name'],
  fields: [
    // === IDENTITY ===
    {
      csvColumn: 'id',
      entityProperty: 'id',
      type: CsvFieldType.STRING,
      isIdentityColumn: true,
      exportable: true,
      importable: true,
      required: false,
      defaultExport: true,
      label: 'ID',
      group: 'Identity',
    },
    {
      // The business reference the list shows (PRJ-n): export only, ignored on import.
      csvColumn: 'reference',
      entityProperty: 'item_number',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Reference',
      group: 'Identity',
      exportFn: (entity: any) => (entity.item_number ? `PRJ-${entity.item_number}` : ''),
    },
    {
      csvColumn: 'name',
      entityProperty: 'name',
      type: CsvFieldType.STRING,
      required: true,
      defaultExport: true,
      label: 'Name',
      group: 'Overview',
    },

    // === SUMMARY TAB (purpose, properties) ===
    {
      csvColumn: 'purpose',
      entityProperty: 'purpose',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: true,
      label: 'Purpose',
      group: 'Overview',
      // Rich text: same rules as in the editor of the project.
      importTransformFn: richTextCell('purpose'),
    },
    {
      csvColumn: 'status',
      entityProperty: 'status',
      type: CsvFieldType.ENUM,
      enumValues: ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold', 'done', 'cancelled'],
      required: false,
      defaultExport: true,
      label: 'Status',
      group: 'Overview',
    },
    {
      csvColumn: 'origin',
      entityProperty: 'origin',
      type: CsvFieldType.ENUM,
      enumValues: ['standard', 'fast_track', 'legacy'],
      required: false,
      defaultExport: true,
      label: 'Origin',
      group: 'Overview',
    },
    {
      csvColumn: 'source_name',
      entityProperty: 'source_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_sources',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Source',
      group: 'Overview',
    },
    {
      csvColumn: 'category_name',
      entityProperty: 'category_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_categories',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Category',
      group: 'Overview',
    },
    {
      csvColumn: 'stream_name',
      entityProperty: 'stream_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'portfolio_streams',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Stream',
      group: 'Overview',
    },
    {
      csvColumn: 'company_name',
      entityProperty: 'company_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'companies',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Company',
      group: 'Overview',
    },
    {
      csvColumn: 'department_name',
      entityProperty: 'department_id',
      type: CsvFieldType.FK_BY_NAME,
      fkEntity: 'departments',
      fkLookupColumn: 'name',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Department',
      group: 'Overview',
    },
    {
      csvColumn: 'planned_start',
      entityProperty: 'planned_start',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Planned Start',
      group: 'Timeline',
    },
    {
      csvColumn: 'planned_end',
      entityProperty: 'planned_end',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Planned End',
      group: 'Timeline',
    },
    {
      csvColumn: 'business_sponsor_email',
      entityProperty: 'business_sponsor_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Business Sponsor Email',
      group: 'Team',
    },
    {
      csvColumn: 'business_lead_email',
      entityProperty: 'business_lead_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Business Lead Email',
      group: 'Team',
    },
    {
      csvColumn: 'it_sponsor_email',
      entityProperty: 'it_sponsor_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'IT Sponsor Email',
      group: 'Team',
    },
    {
      csvColumn: 'it_lead_email',
      entityProperty: 'it_lead_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'IT Lead Email',
      group: 'Team',
    },

    // === TIMELINE TAB ===
    {
      csvColumn: 'actual_start',
      entityProperty: 'actual_start',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Actual Start',
      group: 'Timeline',
    },
    {
      csvColumn: 'actual_end',
      entityProperty: 'actual_end',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Actual End',
      group: 'Timeline',
    },
    {
      csvColumn: 'baseline_start_date',
      entityProperty: 'baseline_start_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: false,
      label: 'Baseline Start Date',
      group: 'Timeline',
    },
    {
      csvColumn: 'baseline_end_date',
      entityProperty: 'baseline_end_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: false,
      label: 'Baseline End Date',
      group: 'Timeline',
    },

    // === PROGRESS TAB ===
    {
      csvColumn: 'execution_progress',
      entityProperty: 'execution_progress',
      type: CsvFieldType.NUMBER,
      exportable: true,
      importable: true,
      defaultExport: true,
      label: 'Execution Effort (%)',
      group: 'Effort',
    },
    {
      csvColumn: 'estimated_effort_it',
      entityProperty: 'estimated_effort_it',
      type: CsvFieldType.NUMBER,
      required: false,
      defaultExport: true,
      label: 'Estimated Effort IT (MD)',
      group: 'Effort',
    },
    {
      csvColumn: 'estimated_effort_business',
      entityProperty: 'estimated_effort_business',
      type: CsvFieldType.NUMBER,
      required: false,
      defaultExport: true,
      label: 'Estimated Effort Business (MD)',
      group: 'Effort',
    },
    {
      csvColumn: 'actual_effort_it',
      entityProperty: 'actual_effort_it',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Actual Effort IT (MD)',
      group: 'Effort',
      exportFn: (entity: any) => {
        return entity.actual_effort_it != null ? String(Math.round(entity.actual_effort_it)) : '';
      },
    },
    {
      csvColumn: 'actual_effort_business',
      entityProperty: 'actual_effort_business',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Actual Effort Business (MD)',
      group: 'Effort',
      exportFn: (entity: any) => {
        return entity.actual_effort_business != null ? String(Math.round(entity.actual_effort_business)) : '';
      },
    },
    {
      csvColumn: 'baseline_effort_it',
      entityProperty: 'baseline_effort_it',
      type: CsvFieldType.NUMBER,
      required: false,
      defaultExport: false,
      label: 'Baseline Effort IT (MD)',
      group: 'Effort',
    },
    {
      csvColumn: 'baseline_effort_business',
      entityProperty: 'baseline_effort_business',
      type: CsvFieldType.NUMBER,
      required: false,
      defaultExport: false,
      label: 'Baseline Effort Business (MD)',
      group: 'Effort',
    },

    // === SCORING TAB ===
    {
      csvColumn: 'criteria_values',
      entityProperty: 'criteria_values',
      type: CsvFieldType.JSON,
      jsonValidator: 'portfolio_criteria',
      required: false,
      defaultExport: false,
      label: 'Criteria Values (JSON)',
      group: 'Scoring',
    },
    {
      csvColumn: 'priority_score',
      entityProperty: 'priority_score',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Priority Score',
      group: 'Scoring',
      exportFn: (entity: any) => {
        return entity.priority_score != null ? String(entity.priority_score) : '';
      },
    },
    {
      csvColumn: 'priority_override',
      entityProperty: 'priority_override',
      type: CsvFieldType.BOOLEAN,
      required: false,
      defaultExport: false,
      label: 'Priority Override',
      group: 'Scoring',
    },
    {
      csvColumn: 'override_value',
      entityProperty: 'override_value',
      type: CsvFieldType.NUMBER,
      required: false,
      defaultExport: false,
      label: 'Override Value',
      group: 'Scoring',
    },
    {
      csvColumn: 'override_justification',
      entityProperty: 'override_justification',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Override Justification',
      group: 'Scoring',
    },
  ],

  // Export presets
  exportPresets: [
    {
      name: 'enrichment',
      label: 'Data Enrichment',
      // Only importable fields - excludes computed fields like actual_effort_*, priority_score
      fields: [
        'id', 'name', 'status', 'purpose', 'origin',
        'source_name', 'category_name', 'stream_name',
        'company_name', 'department_name',
        'planned_start', 'planned_end', 'actual_start', 'actual_end',
        'baseline_start_date', 'baseline_end_date',
        'execution_progress',
        'estimated_effort_it', 'estimated_effort_business',
        'baseline_effort_it', 'baseline_effort_business',
        'business_sponsor_email', 'business_lead_email',
        'it_sponsor_email', 'it_lead_email',
        'criteria_values', 'priority_override',
        'override_value', 'override_justification',
      ],
    },
  ],

  /** A purpose cell that repeats its document is kept as stored, whatever tags it holds. */
  afterValidate: (rows, context) => keepStoredSlotBodies(rows, context, 'projects', { purpose: 'purpose' }),

  /** The purpose lives in bound documents (the CSV service writes them there), the rest in columns. */
  sameAsStored: (rows, context) => sameAsStoredWithDocuments(rows, context, 'projects', { purpose: 'purpose' }, normalizeCodes),

  /**
   * Hook to normalize status and origin values before commit.
   * Accepts both codes and common labels for these fields.
   */
  beforeCommit: async (entities: any[], context: CsvImportContext) => {
    for (const entity of entities) normalizeCodes(entity);

    // Assign item_numbers to new entities
    const newEntities = entities.filter(e => !e.item_number);
    if (newEntities.length > 0) {
      const firstNumber = await allocateItemNumbers(
        'project', context.tenantId, newEntities.length, context.manager,
      );
      newEntities.forEach((e, i) => { e.item_number = firstNumber + i; });
    }
  },
};
