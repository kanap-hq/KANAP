import type { CsvReportMessage } from './csvMessage';

/**
 * CSV Types and Interfaces for Frontend Components
 */

/** Import operation: what actions to perform */
export type ImportOperation = 'upsert' | 'update_only' | 'insert_only';

/**
 * A workflow preset: the operation the import runs. Every import reads its cells by one rule (D21 of
 * 26.11.9): a blank cell keeps the stored value, `-` clears it.
 */
export interface WorkflowPreset {
  id: string;
  /** i18n key (common namespace) of the preset name */
  labelKey: string;
  /** i18n key (common namespace) of the preset description */
  descriptionKey: string;
  operation: ImportOperation;
  recommended?: boolean;
}

/** Pre-defined workflow presets */
export const WORKFLOW_PRESETS: WorkflowPreset[] = [
  {
    id: 'merge',
    labelKey: 'csv.workflowPresets.merge.label',
    descriptionKey: 'csv.workflowPresets.merge.description',
    operation: 'upsert',
    recommended: true,
  },
  {
    id: 'update_only',
    labelKey: 'csv.workflowPresets.updateOnly.label',
    descriptionKey: 'csv.workflowPresets.updateOnly.description',
    operation: 'update_only',
  },
  {
    id: 'insert_only',
    labelKey: 'csv.workflowPresets.insertOnly.label',
    descriptionKey: 'csv.workflowPresets.insertOnly.description',
    operation: 'insert_only',
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
  /** The stored values the import clears (`-`, and the entries a filled list removes): the check says so. */
  cleared?: number;
  errors: CsvReportMessage[];
  warnings: CsvReportMessage[];
  /**
   * The values of the file found beyond case (accents set aside, a name in another language), one
   * entry per column, value and record: each one Kad proposed, then the first others, `matchesTotal`
   * in all. Absent when none.
   */
  matches?: CsvImportMatch[];
  matchesTotal?: number;
  /** Kad's proposals the import refused (its card), all of them, `refusedProposalsTotal` in all. Absent when none. */
  refusedProposals?: CsvImportRefusedProposal[];
  refusedProposalsTotal?: number;
  /** The rows that look like an existing record (the applications), left out unless the person chooses. Absent when none. */
  lookalikes?: ImportLookalikes;
}

/** The record a row looks like, and its state at the check: what "Update" sends back. */
export interface ImportLookalikeTarget {
  id: string;
  state: string;
}

/**
 * A row to create that looks like an existing record the person reads (lot I3 of 26.11.9, the
 * applications; the budget file's rows have the same shape, with a line's number for its id).
 */
export interface ImportLookalike {
  /** The row's line in the person's file. */
  line: number;
  name: string;
  /** The record it looks like: its id, reference (`APP-4`), name and state at the check; reference, name and state empty when it is gone. */
  target: ImportLookalikeTarget & { ref: string; name: string };
  /**
   * `name_accents`: the same name, accents aside; `close_name`: a close name and the same supplier or
   * publisher. Absent when the row keeps a target it no longer looks like (chosen on an earlier check).
   */
  reason?: 'name_accents' | 'close_name';
  /** What the check does with it: left out (the default), created anyway, or the record updated. */
  outcome: 'ignored' | 'created' | 'updated';
  /** "Update" is offered only when true. */
  updatable: boolean;
  /** For an update: the keys of the columns it changes (none when the record already holds the row), shown by their titles. */
  fields?: string[];
}

export interface ImportLookalikes {
  /** The first 200, in file order. */
  lines: ImportLookalike[];
  /** Every row's target, by its line in the file, beyond the rows listed: what a choice for all rows sends. */
  targets: Record<string, ImportLookalikeTarget>;
  count: number;
  ignored: number;
  created: number;
  updated: number;
  /**
   * The choices the check followed, the targets of the rows it left out by default included: the load
   * and the next check send them back, a choice of the person replacing its row's.
   */
  choices: ImportLookalikeChoice[];
}

/**
 * A choice on a row that looks like an existing record: the budget file's choice, the record named by
 * its `id`. Sent as the `lookalikes` form field of the import screen, and in `{ choices }` to the
 * import card's choice route. Leaving a row out is the default, sent only against a choice for all rows.
 */
export type ImportLookalikeChoice =
  | { kind: 'lookalike'; line: number; action: 'ignore' | 'create' }
  | { kind: 'lookalike'; line: number; action: 'update'; id: string; state?: string }
  | { kind: 'lookalikes'; action: 'ignore' | 'create' | 'update'; targets?: Record<string, ImportLookalikeTarget> };

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

/** A row of the file that updates a stored record: its line, the record's reference (null when its family has none) and its name. */
export interface CsvImportUpdate {
  row: number;
  ref: string | null;
  name: string;
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
  /** `editor`: an application's supplier found by its publisher. */
  origin: 'server' | 'model' | 'editor';
  /** `version`: a version label found in the catalog by a prefix rule (`22.04` for `22.04 LTS`); `editor`: found by the publisher. */
  reason: 'accents' | 'translation' | 'model' | 'version' | 'editor';
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
