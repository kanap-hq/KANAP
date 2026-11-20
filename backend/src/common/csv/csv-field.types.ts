import type { CsvLanguage } from '../csv-sheet/types';
import type { AuditSourceOptions } from '../../audit/audit.service';
import type { ExportFileFormat } from '../xlsx/format';
import type { ImportNameMatch, ImportProposals, ImportRefusedProposal } from '../name-matching';
import type { ImportLookalikeChoice, ImportLookalikes } from './csv-lookalikes';
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
  /**
   * The properties of the record a reference belongs to (a task's phase to its project, a stream to
   * its category, a department to its company). On a record the row updates, the stored reference is
   * kept for a name nothing finds only while the row leaves them as stored; a row that changes one
   * clears it (lot I3 of 26.11.9, review fixes).
   */
  keptWith?: readonly string[];
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
  /**
   * A name the config finds itself beyond case, with Kad's proposals (a task's phase, in its project:
   * lot I3 of 26.11.9): the shared lookup finds it case aside only and leaves Kad's proposal to the config.
   */
  nameMatchedByConfig?: boolean;
  /** May return a promise: the import awaits it. `line` is the row's line in the file (a match noted there). */
  importTransformFn?: (value: string, row: Record<string, string>, context: CsvImportContext, line?: number) => any;
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
  /**
   * Lists the config writes in numbered columns of its own (`business_owner_email_1` to `_4`, declared
   * in `fields` with their `exportFn`): `base` names the columns, `values` gives an entity's list in
   * order. The export writes as many columns as the longest list of its rows, the declared ones at
   * least; the import reads every `<base>_<n>` the file holds (`csv-numbered-lists.ts`).
   */
  numberedLists?: ReadonlyArray<{ base: string; values: (entity: any, context: CsvExportContext) => string[] }>;
  /** The name of the list in each language: the sheet of an xlsx export. `displayName` when a language has none. */
  sheetNames?: Partial<Record<CsvLanguage, string>>;
  /** Export presets (e.g., 'basic', 'full') */
  exportPresets?: CsvExportPreset[];
  /** Relation handlers for complex relationships */
  relationHandlers?: CsvRelationHandler[];
  /** Hook called before import validation */
  beforeValidate?: (rows: CsvImportRow[], context: CsvImportContext) => Promise<void>;
  /**
   * Before the rows' cells are read, with the record each row was found to update by its id or key
   * (`found`, null for a row that would create one): the record each row updates instead, or a row
   * left out (lot I3 of 26.11.9, the applications' lookalikes). One entry per row, in order, with the
   * errors and warnings the config gives the row.
   */
  settleRows?: (rows: Array<{ raw: Record<string, string>; rowNumber: number; found: any | null }>, context: CsvImportContext) => Promise<CsvSettledRow[]>;
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
  /** Hook called after import commit, with each written row and the entity it saved (`id` set). */
  afterCommit?: (entities: any[], context: CsvImportContext, written?: Array<{ row: CsvImportRow; entity: any }>) => Promise<void>;
}

/** What `settleRows` makes of a row: left out, or the record it updates (null to create one). */
export type CsvSettledRow =
  | { leaveOut: true; warnings?: CsvImportWarning[] }
  | { leaveOut?: false; entity: any | null; errors?: CsvImportError[]; warnings?: CsvImportWarning[] };

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
  /** Operation type */
  operation: 'upsert' | 'update_only' | 'insert_only';
  /**
   * The matches the person undid (lot I3 of 26.11.9), by file column and value as the result lists
   * them (`matches`): such a value is found by its name, case aside, and nothing beyond (no accents
   * set aside, no other language). Otherwise it reads as a name nothing finds.
   */
  unmatched?: Array<{ column: string; value: string }>;
  /**
   * Kad's proposals (lot I3 of 26.11.9, second pass), by file column: a value of the file and the name
   * of the record it stands for. Accepted when that record exists, by its name or case aside, in a
   * family the person reads (a match, listed); otherwise refused (`refusedProposals`) and the value is
   * found by its own name.
   */
  proposals?: ImportProposals;
  /**
   * The person's choices for the rows that look like a stored record (lot I3 of 26.11.9, the
   * applications): an import whose config settles its rows (`settleRows`) follows them.
   */
  lookalikes?: ImportLookalikeChoice[];
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
  /**
   * Stored values the import clears (`-`, and the entries a filled list removes), the same at the
   * preflight and at the load (`csv-import-cells.ts`). Values already empty count nothing.
   */
  cleared: number;
  /** Validation and processing errors */
  errors: CsvImportError[];
  /** Non-fatal warnings */
  warnings: CsvImportWarning[];
  /**
   * The values of the file found beyond case (accents set aside, a name in another language), one
   * entry per column, value and record, with the file's lines (lot I3 of 26.11.9): each one Kad
   * proposed, then the first `MATCH_LIST_LIMIT` (`listedMatchEntries`). Each may be undone
   * (`CsvImportParams.unmatched`). Absent when none.
   */
  matches?: ImportNameMatch[];
  /** How many entries `matches` would hold uncut. Present with `matches`. */
  matchesTotal?: number;
  /** Kad's proposals the import refused (`CsvImportParams.proposals`), all of them; absent when none. */
  refusedProposals?: ImportRefusedProposal[];
  /** How many entries `refusedProposals` would hold uncut. Present with it. */
  refusedProposalsTotal?: number;
  /** The rows that would create a record and look like a stored one (lot I3 of 26.11.9, the applications); absent when none. */
  lookalikes?: ImportLookalikes;
}

/**
 * Export result. `F` is the format asked for: a CSV export (the default) holds text, an xlsx
 * export a workbook.
 */
export interface CsvExportResult<F extends ExportFileFormat = 'csv'> {
  /** Generated filename: `<entity>_export.csv`, `.xlsx` for a workbook. */
  filename: string;
  /** The Content-Type the file is sent with. */
  contentType: string;
  /** The CSV text (with BOM), or the xlsx workbook. */
  content: F extends 'xlsx' ? Buffer : string;
  /** Number of rows exported */
  rows: number;
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
  /** The source of each record's history row (Kad's card); without it, the person's. */
  audit?: AuditSourceOptions;
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
  /**
   * The file's language (the screen's, else the user's). A report that names a
   * value uses it. Absent, that value stays the stored code.
   */
  language?: CsvLanguage;
  /**
   * The rights of the person who imports: a name finds a record beyond case only in a family whose
   * module they read (lot I3 of 26.11.9). Absent: names are found case aside only, as before.
   */
  access?: CsvCallerAccess;
  /** The names found beyond case so far, noted by `noteNameMatch` (the result's `matches`). */
  nameMatches?: Map<string, ImportNameMatch>;
  /** Kad's proposals refused so far, noted by `noteRefusedProposal` (the result's `refusedProposals`). */
  refusedProposals?: Map<string, ImportRefusedProposal>;
}

/** The rights of the person who imports, as the routes and Kad know them (`PermissionGuard`, `effectiveAccess`). */
export interface CsvCallerAccess {
  isAdmin?: boolean;
  permissions?: Record<string, string>;
}

/** The person's rights as `PermissionGuard` leaves them on the request (`TenantRequest` or the raw request). */
export function csvCallerAccess(request: { isAdmin?: boolean; permissions?: Record<string, string> | null } | null | undefined): CsvCallerAccess {
  return { isAdmin: request?.isAdmin === true, permissions: request?.permissions ?? {} };
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
  /** Stored values the config's hooks clear on this row (`noteCleared`), counted in the result's `cleared`. */
  clearedByConfig?: number;
  /**
   * A row the config left out (`settleRows`, a row that looks like a stored record): not read, not
   * written, no error of its own; counted as skipped. It carries only the config's own warnings, and
   * its key (`parsed`), which counts in the file's duplicates.
   */
  leftOut?: boolean;
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
