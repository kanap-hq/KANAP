import type { CsvReportMessage } from './csvMessage';

/**
 * CSV Types and Interfaces for Frontend Components
 */

/** Import mode: how to handle empty cells */
export type ImportMode = 'replace' | 'enrich';

/** Import operation: what actions to perform */
export type ImportOperation = 'upsert' | 'update_only' | 'insert_only';

/** Workflow preset combining mode and operation */
export interface WorkflowPreset {
  id: string;
  /** i18n key (common namespace) of the preset name */
  labelKey: string;
  /** i18n key (common namespace) of the preset description */
  descriptionKey: string;
  mode: ImportMode;
  operation: ImportOperation;
  recommended?: boolean;
}

/** Pre-defined workflow presets */
export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'merge',
    labelKey: 'csv.workflowPresets.merge.label',
    descriptionKey: 'csv.workflowPresets.merge.description',
    mode: 'enrich',
    operation: 'upsert',
    recommended: true,
  },
  {
    id: 'update_only',
    labelKey: 'csv.workflowPresets.updateOnly.label',
    descriptionKey: 'csv.workflowPresets.updateOnly.description',
    mode: 'enrich',
    operation: 'update_only',
  },
  {
    id: 'insert_only',
    labelKey: 'csv.workflowPresets.insertOnly.label',
    descriptionKey: 'csv.workflowPresets.insertOnly.description',
    mode: 'enrich',
    operation: 'insert_only',
  },
  {
    id: 'full_replace',
    labelKey: 'csv.workflowPresets.fullReplace.label',
    descriptionKey: 'csv.workflowPresets.fullReplace.description',
    mode: 'replace',
    operation: 'upsert',
  },
];

/** Import result from backend */
export interface CsvImportResult {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  skipped: number;
  /** Matched rows identical to what is stored: not written. */
  unchanged?: number;
  errors: CsvReportMessage[];
  warnings: CsvReportMessage[];
  /**
   * The values of the file found beyond case (accents set aside, a name in another language), one
   * entry per column, value and record: the first ones, `matchesTotal` in all. Absent when none.
   */
  matches?: CsvImportMatch[];
  matchesTotal?: number;
  /** Kad's proposals the import refused (its card), the first ones, `refusedProposalsTotal` in all. Absent when none. */
  refusedProposals?: CsvImportRefusedProposal[];
  refusedProposalsTotal?: number;
}

/**
 * A name Kad proposed for a value of the file that the import refused (the budget file's have the same
 * shape): `missing`, no such record the person reads (`target` is then Kad's own words); `disabled`,
 * the record is disabled (the budget file only).
 */
export interface CsvImportRefusedProposal {
  column: string;
  name: string | null;
  value: string;
  target: string;
  reason: 'missing' | 'disabled';
  lines: number[];
  count: number;
}

/**
 * A value of the file matched to an existing record beyond case (the budget file's matches have the
 * same shape). `lines` are the file's lines (the first ones), `count` all of them. The import takes
 * an undone match back with its `column` and `value` (`unmatched`).
 */
export interface CsvImportMatch {
  column: string;
  /** The dimension's name for a budget file's `analytics:` column; null otherwise. */
  name: string | null;
  value: string;
  /** The record's name. */
  target: string;
  /** The record's business reference (`SUP-3`), null when its family has none. */
  ref?: string | null;
  origin: 'server' | 'model';
  /** `version`: a version label found in the catalog by a prefix rule (`22.04` for `22.04 LTS`). */
  reason: 'accents' | 'translation' | 'model' | 'version';
  lines: number[];
  count: number;
  undoable: boolean;
}

/** Field info from backend */
export interface CsvFieldInfo {
  csvColumn: string;
  label: string;
  type: string;
  exportable: boolean;
  importable: boolean;
  required: boolean;
  group?: string;
  enumValues?: string[];
  description?: string;
}

/** Export preset */
export interface CsvExportPreset {
  name: string;
  label: string;
  /** Field list - optional if preset is handled by backend */
  fields?: string[];
}

/** Import phase */
export type ImportPhase = 'upload' | 'validate' | 'result';
