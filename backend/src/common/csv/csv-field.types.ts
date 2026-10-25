import type { CsvLanguage } from '../csv-sheet/types';
/**
 * CSV Field Type Definitions
 *
 * This module defines the types and interfaces for the declarative CSV import/export system.
 */

/**
 * Supported field types for CSV columns
 */
export enum CsvFieldType {
  /** Plain string field */
  STRING = 'STRING',
  /** Numeric field (integer or decimal) */
  NUMBER = 'NUMBER',
  /** Date field (YYYY-MM-DD format) */
  DATE = 'DATE',
  /** Enumerated value with predefined options */
  ENUM = 'ENUM',
  /** Array of values */
  ARRAY = 'ARRAY',
  /** Foreign key lookup by email address (users) */
  FK_BY_EMAIL = 'FK_BY_EMAIL',
  /** Foreign key lookup by name (suppliers, categories, etc.) */
  FK_BY_NAME = 'FK_BY_NAME',
  /** Foreign key lookup by code (e.g., location codes) */
  FK_BY_CODE = 'FK_BY_CODE',
  /** JSON field with optional validation */
  JSON = 'JSON',
  /** Computed/derived field (export only) */
  COMPUTED = 'COMPUTED',
  /** Nested field within a JSON column */
  NESTED = 'NESTED',
  /** Boolean field (true/false) */
  BOOLEAN = 'BOOLEAN',
}

/**
 * Strategy for handling array fields in CSV
 */
export enum ArrayStrategy {
  /** Values separated by commas in a single column: "a, b, c" */
  COMMA_SEPARATED = 'COMMA_SEPARATED',
  /** Values spread across numbered columns: email_1, email_2, email_3 */
  NUMBERED_COLUMNS = 'NUMBERED_COLUMNS',
}

/**
 * Definition for a single CSV field
 */
export interface CsvFieldDefinition {
  /** Column header in CSV file */
  csvColumn: string;
  /** Property name on the entity (or source property for FK) */
  entityProperty: string;
  /** Field type */
  type: CsvFieldType;
  /** Whether this field can be exported (default: true) */
  exportable?: boolean;
  /** Whether this field can be imported (default: true) */
  importable?: boolean;
  /** Whether this field is required for import (default: false) */
  required?: boolean;
  /** Whether to include in default export preset (default: true) */
  defaultExport?: boolean;
  /** Whether this field is the primary identity column (e.g., 'id') */
  isIdentityColumn?: boolean;
  /** Maximum number of items for array fields (default: 4) */
  maxItems?: number;
  /** Valid values for ENUM type fields */
  enumValues?: string[];
  /** Target entity for FK lookups (e.g., 'users', 'suppliers') */
  fkEntity?: string;
  /** Column to use for FK lookup (e.g., 'email', 'name') */
  fkLookupColumn?: string;
  /** Whether the FK relationship is required (default: false) */
  fkRequired?: boolean;
  /** Name of JSON validator function for JSON fields */
  jsonValidator?: string;
  /** Strategy for array handling (default: COMMA_SEPARATED) */
  arrayStrategy?: ArrayStrategy;
  /** Index for numbered column arrays (1-based) */
  arrayIndex?: number;
  /** Path within nested JSON (e.g., 'criteria_values.strategic_alignment') */
  nestedPath?: string;
  /** Grouping label for UI display */
  group?: string;
  /** Human-readable label for UI display */
  label?: string;
  /**
   * An instant written as a day and a time in a zone, the zone named in the header after the
   * column name (`detected_at (Europe/Paris)`). The import hands the zone its header names to
   * the transform (`CsvImportContext.timeZones`) and refuses a zone nobody knows.
   */
  zonedDateTime?: boolean;
  /** Custom export function (for COMPUTED fields) */
  exportFn?: (entity: any, context: CsvExportContext) => string | null;
  /** Custom import transform function */
  /** May return a promise: the import awaits it. */
  importTransformFn?: (value: string, row: Record<string, string>, context: CsvImportContext) => any;
}

/**
 * Configuration for a CSV-enabled entity
 */
export interface CsvEntityConfig {
  /** Internal entity name (e.g., 'task') */
  entityName: string;
  /** Database table name (e.g., 'tasks') */
  tableName: string;
  /** Human-readable display name (e.g., 'Tasks') */
  displayName: string;
  /** Fields used for upsert matching (beyond id) */
  upsertKey: string[];
  /**
   * Match the upsert key without the spaces around the stored value as well, as
   * `lower(btrim(column))` (the uniqueness rule of application names). Off: `lower(column)`.
   */
  upsertKeyIgnoresOuterSpaces?: boolean;
  /** Field definitions */
  fields: CsvFieldDefinition[];
  /**
   * The header of a column in the file's language, by `csvColumn` (`{ severity: { fr: 'Gravité' } }`).
   * The export writes it, and the import accepts it as well as the technical `csvColumn` (`severity`),
   * so an exported file reads back whatever language it was written in. A language without a text
   * keeps the technical header.
   */
  headerLabels?: Record<string, Partial<Record<CsvLanguage, string>>>;
  /** Export presets (e.g., 'basic', 'full') */
  exportPresets?: CsvExportPreset[];
  /** Relation handlers for complex relationships */
  relationHandlers?: CsvRelationHandler[];
  /** Hook called before import validation */
  beforeValidate?: (rows: CsvImportRow[], context: CsvImportContext) => Promise<void>;
  /** Validate resolved rows identically in dry-run and execution, after identity resolution. */
  afterValidate?: (rows: CsvImportRow[], context: CsvImportContext) => Promise<void>;
  /**
   * Which matched rows leave everything as stored, one answer per row (the rows to update,
   * free of errors). Replaces the plain comparison of each parsed value with its stored
   * column, for configs whose hooks resolve names to codes, read virtual columns or write
   * texts and links elsewhere. A row may be true only when the commit, its hooks and the
   * entity service's follow-up writes would change nothing.
   */
  sameAsStored?: (rows: CsvImportRow[], context: CsvImportContext) => Promise<boolean[]>;
  /** Hook called before import commit */
  beforeCommit?: (entities: any[], context: CsvImportContext) => Promise<void>;
  /** Hook called after import commit */
  afterCommit?: (entities: any[], context: CsvImportContext) => Promise<void>;
}

/**
 * Export preset definition
 */
export interface CsvExportPreset {
  /** Preset name (e.g., 'basic', 'full', 'custom') */
  name: string;
  /** Human-readable label */
  label: string;
  /** Fields included in this preset (by csvColumn) */
  fields: string[];
}

/**
 * Handler for complex entity relationships
 */
export interface CsvRelationHandler {
  /** Relationship name (e.g., 'owners', 'tags') */
  name: string;
  /** Handler for export */
  exportHandler: (entity: any, context: CsvExportContext) => Promise<Record<string, string>>;
  /** Handler for import */
  importHandler: (entity: any, values: Record<string, string>, context: CsvImportContext) => Promise<void>;
}

/**
 * Import parameters
 */
export interface CsvImportParams {
  /** Whether to validate without committing changes */
  dryRun: boolean;
  /** Import mode: 'replace' clears empty values, 'enrich' preserves existing */
  mode: 'replace' | 'enrich';
  /** Operation type */
  operation: 'upsert' | 'update_only' | 'insert_only';
}

/**
 * Row-level import error
 */
export interface CsvImportError {
  /** CSV row number (1-based, accounting for header) */
  row: number;
  /** Column name if applicable */
  column?: string;
  /** Error message */
  message: string;
  /** Error code the interface translates, when the message has one (MARKDOWN_TOO_LARGE, ...) */
  code?: string;
  /** The values the translated sentence names (`value`, `missing`, ...) */
  params?: Record<string, string | number>;
}

/**
 * Row-level import warning
 */
export interface CsvImportWarning {
  /** CSV row number (1-based, accounting for header) */
  row: number;
  /** Column name if applicable */
  column?: string;
  /** Warning message */
  message: string;
  /** Warning code the interface translates, with the values its sentence names */
  code?: string;
  params?: Record<string, string | number>;
}

/**
 * Import result
 */
export interface CsvImportResult {
  /** Whether the import was successful (no errors) */
  ok: boolean;
  /** Whether this was a dry run */
  dryRun: boolean;
  /** Total rows processed */
  total: number;
  /** Number of rows that would be/were inserted */
  inserted: number;
  /** Number of rows that would be/were updated */
  updated: number;
  /** Number of rows skipped (update_only mode with no match, insert_only with match) */
  skipped: number;
  /** Number of matched rows identical to what is stored: not written */
  unchanged: number;
  /** Validation and processing errors */
  errors: CsvImportError[];
  /** Non-fatal warnings */
  warnings: CsvImportWarning[];
}

/**
 * Export result
 */
export interface CsvExportResult {
  /** Generated filename */
  filename: string;
  /** CSV content (with BOM) */
  content: string;
  /** Number of rows exported */
  rowCount: number;
  /** Warnings generated during export */
  warnings: string[];
}

/**
 * Context passed to export functions
 */
export interface CsvExportContext {
  /** Tenant ID */
  tenantId: string;
  /** TypeORM EntityManager */
  manager: any;
  /** Preloaded FK caches */
  resolverCache: Map<string, Map<string, any>>;
  /** The file's language: its separator, days, decimal mark and yes or no. */
  language: CsvLanguage;
  /** The zone the date-times are written in (`zonedDateTime` fields): the exporting user's. */
  timeZone: string;
}

/**
 * Context passed to import functions
 */
export interface CsvImportContext {
  /** Tenant ID */
  tenantId: string;
  /** TypeORM EntityManager */
  manager: any;
  /** Import parameters */
  params: CsvImportParams;
  /** Preloaded FK caches */
  resolverCache: Map<string, Map<string, any>>;
  /** User ID performing the import */
  userId?: string | null;
  /** True when the importer is incidents:admin (or Administrator). */
  isAdmin?: boolean;
  /** Register viewer (userId + incidents:admin). Used to hide confidential incidents. */
  viewer?: { userId: string | null; isAdmin: boolean };
  /** Effective IT Ops catalogs (defaults included), read with the tenant shared lock by the entity CSV service. */
  itOpsSettings?: import('../../it-ops-settings/it-ops-settings.service').ItOpsSettings;
  /**
   * The zone named in the header of each `zonedDateTime` column, by column (`detected_at`:
   * `Europe/Paris`). A column whose header names no zone is absent: its cells are UTC.
   */
  timeZones?: Record<string, string>;
  /** Time budget of the rich-text cells of the file, processed in the Markdown workers (markdown-worker.ts). */
  markdownBudget?: import('../markdown-worker').MarkdownWorkBudget;
}

/**
 * Parsed import row with metadata
 */
export interface CsvImportRow {
  /** 1-based row number */
  rowNumber: number;
  /** Raw row data from CSV */
  raw: Record<string, string>;
  /** Parsed/transformed values */
  parsed: Record<string, any>;
  /** Matched existing entity (if any) */
  existingEntity?: any;
  /** Whether this row will be inserted (vs updated) */
  isInsert: boolean;
  /** A matched row whose values all equal the stored entity: counted, not written */
  unchanged?: boolean;
  /** Row-level errors */
  errors: CsvImportError[];
  /** Row-level warnings */
  warnings: CsvImportWarning[];
}

/**
 * Field metadata for frontend
 */
export interface CsvFieldInfo {
  /** Column name */
  csvColumn: string;
  /** Human-readable label */
  label: string;
  /** Field type */
  type: CsvFieldType;
  /** Whether exportable */
  exportable: boolean;
  /** Whether importable */
  importable: boolean;
  /** Whether required for import */
  required: boolean;
  /** Grouping */
  group?: string;
  /** Enum values if applicable */
  enumValues?: string[];
  /** Description/help text */
  description?: string;
}

/**
 * A cell the import refuses, with the code the interface translates and the
 * values its sentence names. The English message stays for the API and the logs.
 */
export class CsvCellError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly params?: Record<string, string | number>,
  ) {
    super(message);
    this.name = 'CsvCellError';
  }
}
