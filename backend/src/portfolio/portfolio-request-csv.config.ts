import {
  CsvEntityConfig,
  CsvFieldType,
  CsvImportContext,
} from '../common/csv';
import { allocateItemNumbers } from '../common/item-number.service';
import { sameAsStoredWithDocuments } from '../knowledge/integrated-document-bodies';

// Status label to code mapping
const statusLookup = new Map<string, string>([
  // Codes map to themselves
  ['pending_review', 'pending_review'],
  ['candidate', 'candidate'],
  ['approved', 'approved'],
  ['on_hold', 'on_hold'],
  ['rejected', 'rejected'],
  ['converted', 'converted'],
  // Common labels
  ['pending review', 'pending_review'],
  ['pending', 'pending_review'],
  ['on hold', 'on_hold'],
]);

/** Status accepts a code or a common label. */
function normalizeCodes(entity: any): void {
  for (const [key, lookup] of [['status', statusLookup]] as const) {
    if (!entity[key]) continue;
    const resolved = lookup.get(String(entity[key]).trim().toLowerCase());
    if (resolved) entity[key] = resolved;
  }
}

/**
 * CSV configuration for Portfolio Requests entity
 *
 * Column order: id, reference (REQ-n, export only), name, then RequestWorkspacePage.tsx tab by tab:
 * - Summary: purpose, the property panel (status to target delivery date, sponsors and leads)
 * - Analysis: risks, current_situation, expected_benefits
 * - Scoring: criteria_values, priority fields
 */
export const portfolioRequestCsvConfig: CsvEntityConfig = {
  entityName: 'portfolio_request',
  // The sheet of an xlsx export: the list's title on screen.
  sheetNames: { en: 'Portfolio requests', fr: 'Demandes du portefeuille', de: 'Portfolio-Anfragen', es: 'Solicitudes del portafolio' },
  tableName: 'portfolio_requests',
  displayName: 'Portfolio Requests',
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
      // The business reference the list shows (REQ-n): export only, ignored on import.
      csvColumn: 'reference',
      entityProperty: 'item_number',
      type: CsvFieldType.COMPUTED,
      exportable: true,
      importable: false,
      defaultExport: true,
      label: 'Reference',
      group: 'Identity',
      exportFn: (entity: any) => (entity.item_number ? `REQ-${entity.item_number}` : ''),
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
    },
    {
      csvColumn: 'status',
      entityProperty: 'status',
      type: CsvFieldType.ENUM,
      enumValues: ['pending_review', 'candidate', 'approved', 'on_hold', 'rejected', 'converted'],
      required: false,
      defaultExport: true,
      label: 'Status',
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
      csvColumn: 'requestor_email',
      entityProperty: 'requestor_id',
      type: CsvFieldType.FK_BY_EMAIL,
      fkEntity: 'users',
      fkLookupColumn: 'email',
      fkRequired: false,
      required: false,
      defaultExport: true,
      label: 'Requestor Email',
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
      csvColumn: 'target_delivery_date',
      entityProperty: 'target_delivery_date',
      type: CsvFieldType.DATE,
      required: false,
      defaultExport: true,
      label: 'Target Delivery Date',
      group: 'Overview',
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

    // === ANALYSIS TAB ===
    {
      csvColumn: 'risks',
      entityProperty: 'risks',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Risks',
      group: 'Analysis',
    },
    {
      csvColumn: 'current_situation',
      entityProperty: 'current_situation',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Current Situation',
      group: 'Analysis',
    },
    {
      csvColumn: 'expected_benefits',
      entityProperty: 'expected_benefits',
      type: CsvFieldType.STRING,
      required: false,
      defaultExport: false,
      label: 'Expected Benefits',
      group: 'Analysis',
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
      // Only importable fields - excludes computed fields like priority_score
      fields: [
        'id', 'name', 'status', 'purpose',
        'source_name', 'category_name', 'stream_name',
        'requestor_email', 'company_name', 'department_name',
        'target_delivery_date',
        'current_situation', 'expected_benefits', 'risks',
        'business_sponsor_email', 'business_lead_email',
        'it_sponsor_email', 'it_lead_email',
        'criteria_values', 'priority_override',
        'override_value', 'override_justification',
      ],
    },
  ],

  /** The purpose and the risks live in bound documents (the CSV service writes them there), the rest in columns. */
  sameAsStored: (rows, context) => sameAsStoredWithDocuments(rows, context, 'requests', { purpose: 'purpose', risks: 'risks_mitigations' }, normalizeCodes),

  /**
   * Hook to normalize status values before commit.
   * Accepts both codes and common labels for status field.
   */
  beforeCommit: async (entities: any[], context: CsvImportContext) => {
    for (const entity of entities) normalizeCodes(entity);

    // Assign item_numbers to new entities
    const newEntities = entities.filter(e => !e.item_number);
    if (newEntities.length > 0) {
      const firstNumber = await allocateItemNumbers(
        'request', context.tenantId, newEntities.length, context.manager,
      );
      newEntities.forEach((e, i) => { e.item_number = firstNumber + i; });
    }
  },
};
