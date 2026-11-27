import { AmountMeasure, AMOUNT_MEASURES } from '../amounts-write.util';
import { budgetLineReference, type BudgetNature } from '../budget-nature';
import type { ImportNameMatch, ImportRefusedProposal } from '../../common/name-matching';

/**
 * The list a file is exported from or loaded on (`/spend-items/budget-file/*` or the CAPEX alias):
 * the lines an export holds, and the nature of a line in a file without a `nature` column (a file
 * of before lot C1b). One file holds lines of both natures since lot C1b; every check of a line
 * follows the line's own nature.
 */
export type BudgetFileScope = BudgetNature;
/** Only exports accept both natures; import and preflight retain their route's default. */
export type BudgetFileExportScope = BudgetFileScope | 'all';

export type BudgetFileDetail = 'yearly' | 'months';

/** How many row errors the preflight returns. The count is the full number. */
export const PREFLIGHT_ERROR_LIMIT = 100;

/** How many entries of every other list the preflight returns. */
export const PREFLIGHT_LIST_LIMIT = 20;

/** Examples named in a "Missing:" sentence. */
export const MISSING_EXAMPLE_LIMIT = 8;

export interface MonthCell {
  /** Null when that month has no amount row. A stored zero is 0n, not null. */
  cents: bigint | null;
}

/**
 * A column's calculation lines (quantity × price, written by the Budget tab), as the file reads
 * them: it neither writes nor exports them, it only says when a total stops their driving the column.
 */
export interface StoredRound {
  /** `computed`: the column follows its lines; any other method keeps them as a reference. */
  method: 'spread' | 'copied' | 'manual' | 'computed';
  /** How many calculation lines the column holds. */
  lineCount: number;
  /** What the lines compute over the year, in cents, while the column follows them; null otherwise. */
  linesTotal: bigint | null;
}

export interface StoredVersion {
  id: string;
  year: number;
  budgetRev: number;
  months: Record<AmountMeasure, MonthCell[]>;
  /** The columns that have a round-input record; a column without one is absent. Unset reads as none. */
  rounds?: Partial<Record<AmountMeasure, StoredRound>>;
}

/** One line as the preflight compares it and as the export writes it. */
export interface StoredLine {
  id: string;
  nature: BudgetNature;
  /** The line's own number, its `BL-n` reference. */
  itemNumber: number;
  /** `OPX-n` or `CPX-n`, the number the files of before lot C1b named it by; null when it has none. */
  legacyNumber: string | null;
  rowVersion: number;
  name: string;
  description: string | null;
  companyId: string | null;
  companyName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierErpId: string | null;
  accountId: string | null;
  accountNumber: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  /** The centre's names from the root group, joined with ` / `. Null for a root centre. */
  costCenterPath: string | null;
  runBuild: 'run' | 'build' | null;
  /** Dimension code to the value name. A missing code means no value. */
  analytics: Record<string, string>;
  ownerItEmail: string | null;
  ownerBusinessEmail: string | null;
  /** The owners' ids: whether a limited person stays responsible after the file's change. */
  ownerItId?: string | null;
  ownerBusinessId?: string | null;
  projectNumber: number | null;
  currency: string;
  /** `YYYY-MM-DD`. */
  effectiveStart: string;
  /** ISO instant, or null. A bare day is noon UTC. */
  endOfValidity: string | null;
  notes: string | null;
  versions: StoredVersion[];
}

/** One year of a line as the lookalike pass reads it: its version, and its totals by measure in cents. */
export interface LineHintYear {
  year: number;
  versionId: string;
  budgetRev: number;
  /** The year's totals (`spend_version_totals`); a measure without a total is absent. */
  totals: Partial<Record<AmountMeasure, bigint>>;
}

/**
 * Every line the person reads, for the lookalikes of the rows the file creates (lot I2 of 26.11.9).
 * Not the full row. The years are read only when the file has rows to create.
 */
export interface LineHint {
  nature: BudgetNature;
  itemNumber: number;
  name: string;
  supplierId: string | null;
  id?: string;
  companyId?: string | null;
  accountId?: string | null;
  currency?: string | null;
  rowVersion?: number;
  /** ISO instant, or null: a line that ends before the file's first year is no lookalike target. */
  endOfValidity?: string | null;
  years?: LineHintYear[];
}

export interface CatalogCompany {
  id: string;
  name: string;
  coaId: string | null;
  disabledAt: string | null;
  /** The company's base currency (`companies.base_currency`); null or absent when it has none. */
  baseCurrency?: string | null;
}

export interface CatalogSupplier {
  id: string;
  name: string;
  erpId: string | null;
  disabledAt: string | null;
}

export interface CatalogCostCenter {
  id: string;
  code: string;
  kind: string;
  companyId: string | null;
  disabledAt: string | null;
}

export interface CatalogAccount {
  id: string;
  number: string;
  coaId: string | null;
  disabledAt: string | null;
  /** The lines that may use it: OPEX only, CAPEX only; null or absent for both. */
  nature?: 'opex' | 'capex' | null;
  /**
   * It expects quantity and price entry, itself or through its consolidation account (lot B12b,
   * `expectedAccountsSql`): an amount the file writes on it will be to check. Absent: not expected.
   */
  quantityPrice?: boolean;
}

export interface CatalogUser {
  id: string;
  email: string;
  status: string;
}

export interface CatalogProject {
  id: string;
  itemNumber: number;
}

export interface CatalogValue {
  id: string;
  name: string;
  disabledAt: string | null;
  /** The lines that may choose it: OPEX only, CAPEX only; null or absent for both. */
  appliesTo?: 'opex' | 'capex' | null;
}

export interface CatalogDimension {
  code: string;
  name: string;
  /** The lines that may hold a value on it: OPEX only, CAPEX only; null or absent for both. */
  appliesTo?: BudgetNature | null;
  /**
   * A new line of a nature it applies to must get a value on it, and such a line cannot clear a
   * held value (the catalog holds the enabled dimensions, of both natures).
   */
  required: boolean;
  /** The dimension's own name: null for the unnamed default (`name` then holds its code). */
  axisName: string | null;
  /**
   * Open values (planning/data-scoped-access spec §3.5): an unknown value is created for anyone;
   * on a closed list it is refused to a limited person and created for an unscoped one.
   */
  openValues?: boolean;
  values: CatalogValue[];
}

/** Reference data of one tenant. Nothing here is written by the preflight. */
export interface BudgetCatalog {
  companies: CatalogCompany[];
  suppliers: CatalogSupplier[];
  costCenters: CatalogCostCenter[];
  accounts: CatalogAccount[];
  users: CatalogUser[];
  projects: CatalogProject[];
  dimensions: CatalogDimension[];
  /** Null or empty: the tenant has no allowed list, so any three-letter code is accepted. */
  allowedCurrencies: string[] | null;
  defaultCoaId: string | null;
  /** `nature:year:column`, column being `budget`, `revision`, `forecast`, `actual` or `landing`: a freeze is per nature. */
  frozen: string[];
  /** The columns shown in the tenant's settings, that the "To check" rule reads (lot B12b). Absent: the check does not warn. */
  shownMeasures?: AmountMeasure[];
}

export function emptyMonths(): Record<AmountMeasure, MonthCell[]> {
  const blank = (): MonthCell[] => Array.from({ length: 12 }, () => ({ cents: null }));
  return {
    planned: blank(),
    committed: blank(),
    forecast: blank(),
    actual: blank(),
    expected_landing: blank(),
  };
}

export function emptyCatalog(patch: Partial<BudgetCatalog> = {}): BudgetCatalog {
  return {
    companies: [],
    suppliers: [],
    costCenters: [],
    accounts: [],
    users: [],
    projects: [],
    dimensions: [],
    allowedCurrencies: null,
    defaultCoaId: null,
    frozen: [],
    ...patch,
  };
}

/** The reference a file and a report name a line by: `BL-n`, for both natures (decision U3). */
export function lineRef(itemNumber: number): string {
  return budgetLineReference(itemNumber) as string;
}

export interface BudgetFileSnapshotLine {
  id: string;
  itemNumber: number;
  rowVersion: number;
  years: Array<{ year: number; versionId: string; budgetRev: number }>;
  /**
   * For a limited person only: whether the person may modify the line. The load compares it with
   * the preflight's, so an access changed in between asks for a new preflight.
   */
  editable?: boolean;
}

/**
 * A sentence of the check the interface translates: `code` is its key (frontend `errors`
 * namespace) and `params` the values it names; `message` is its English text, shown without a code.
 */
export interface BudgetFileSentence {
  message: string;
  code?: string;
  params?: Record<string, string | number>;
}

export interface CostCenterCompanyWarning {
  line: number;
  /** Translation code of the sentence (frontend `errors` namespace); `message` is its English text. */
  code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY' | 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY_UNREAD';
  costCenter: string;
  company: string;
  /**
   * The cost center's company, for a person who reads the companies; absent otherwise (`_UNREAD`, P10
   * of 26.12.1): `company` is then the name the file writes.
   */
  costCenterCompany?: string;
  message: string;
}

/**
 * A changed amount on a column that follows its calculation lines: the load writes the file's
 * amounts, and the lines stay as a reference that no longer drives the column. Said once per line,
 * column and year; never for a column whose lines are already a reference, nor for an equal total.
 */
export interface CalculationLinesWarning {
  line: number;
  /** The line's reference, `BL-n`. */
  item: string;
  /** The file column: `budget`, `revision`, `forecast`, `actual` or `landing`. */
  column: string;
  year: number;
  /** How many calculation lines the column holds. */
  count: number;
  /** What they give over the year, two decimals (`281280.00`). */
  total: string;
  /** The English sentence, with the tenant's name of the column. */
  message: string;
}

/** Lines counted by nature, for what a check creates and updates. */
export interface BudgetFileNatureCounts {
  created: Record<BudgetNature, number>;
  updated: Record<BudgetNature, number>;
}

export interface BudgetFileReport {
  ok: boolean;
  scope: BudgetFileScope;
  encoding: 'utf-8' | 'windows-1252' | null;
  separator: ',' | ';' | '\t' | null;
  notices: { dates: string | null; amounts: string | null };
  fileErrors: string[];
  headerErrors: string[];
  errors: Array<{ line: number; column: string | null } & BudgetFileSentence>;
  errorCount: number;
  missing: Array<{ type: string; count: number; examples: string[]; where: string; message: string }>;
  deleted: Array<{ line: number; itemNumber: string }>;
  deletedCount: number;
  changes: {
    created: number;
    updated: number;
    unchanged: number;
    /**
     * The stored values the `-` cells of the updated lines clear (D21 of 26.11.9): the dialog and Kad's
     * card say "N values will be cleared". A `-` on an empty value counts nothing. The load repeats it.
     */
    cleared: number;
    createdLines: Array<{ line: number; name: string }>;
    updatedLines: Array<{ line: number; itemNumber: string; fields: string[] }>;
    /** The lines created and updated, by nature: what Kad announces on the approval (lot I1 of 26.11.9). */
    byNature?: BudgetFileNatureCounts;
  };
  changedSinceExport: Array<{
    line: number;
    itemNumber: string;
    id: string;
    by: string | null;
    at: string | null;
    message: string;
    /** True when `row_version` is not the token's. */
    rowMismatch: boolean;
    /** Years whose `budget_rev` is not the token's, or whose version is gone. */
    years: number[];
  }>;
  changedSinceExportCount: number;
  warnings: {
    /**
     * New rows that look like an earlier row of the file (`BUDGET_FILE_LOOKS_LIKE_ROW`): the first 20.
     * A row that looks like a stored line is in `lookalikes` (lot I2 of 26.11.9).
     */
    duplicates: Array<{ line: number } & BudgetFileSentence>;
    /** How many there are in all. */
    duplicatesCount: number;
    ignoredColumns: string[];
    supplierNames: Array<{ line: number } & BudgetFileSentence>;
    /** company_name names another company than the cost center's: accepted, said once per line. */
    costCenterCompanies: CostCenterCompanyWarning[];
    /** Changed amounts on columns that follow their calculation lines, the first 20. */
    calculationLines: CalculationLinesWarning[];
    /** How many there are in all. */
    calculationLinesCount: number;
    /**
     * The consistency checks of the lines the file creates or updates (lot I2 of 26.11.9): an amount
     * ten times away from the line it looks like or from its supplier's lines, dates outside the years
     * of its amounts, a currency other than the paying company's; and, from lot B12b, an amount the
     * file writes on an account that expects quantity and price entry (`BUDGET_FILE_QUANTITY_PRICE_EXPECTED`).
     * Warnings only: the first 20.
     */
    consistency?: Array<{ line: number } & BudgetFileSentence>;
    consistencyCount?: number;
  };
  /**
   * The rows to create that look like a line the person reads (lot I2 of 26.11.9): left out unless
   * the person chooses otherwise. Absent from a check that refused the file before reading its rows.
   */
  lookalikes?: BudgetFileLookalikes;
  /**
   * What the check matched before creating (lot I1 of 26.11.9), and what it could not. Absent from a
   * check that refused the file before reading its rows.
   */
  matching?: BudgetFileMatching;
  creates: {
    /** The values each dimension gets, by its code; `name` is the dimension's name (null for the unnamed default dimension). */
    dimensionValues: Array<{ dimension: string; name: string | null; names: string[] }>;
    suppliers: Array<{ name: string; erpId: string | null }>;
    /** How many suppliers the load creates: `suppliers` lists the first ones. */
    supplierCount: number;
    /** How many dimension values the load creates, over all dimensions: `dimensionValues` lists the first ones. */
    dimensionValueCount: number;
    /**
     * For a limited person only: unknown values of a closed-list dimension, refused (each row has
     * its error); `dimensionValues` lists the ones the load will create.
     */
    refusedDimensionValues?: Array<{ dimension: string; name: string | null; names: string[] }>;
  };
  supplierMessage: string | null;
  snapshot: { lines: BudgetFileSnapshotLine[] };
  /** An .xlsx workbook of more than one sheet: the name of the sheet read, the first one. Absent otherwise. */
  firstSheetOnly?: string;
  /** For a limited person only: the check ran on the person's access ("Calculated on your access"). */
  dataAccessLimited?: true;
}

/**
 * A choice of the person on a check: a match they undo (the value of the file is then created, or
 * refused, as an unknown one), or whether the missing suppliers are created. The check and the load
 * replay the same list.
 */
export type BudgetFileChoice =
  | { kind: 'unmatch'; column: string; value: string }
  | { kind: 'create_suppliers'; value: boolean }
  | BudgetFileLookalikeChoice
  | BudgetFileLookalikesChoice;

/**
 * What a row that looks like a stored line becomes (lot I2 of 26.11.9): left out (the default, sent
 * only to override a choice for all rows), created anyway, or the update of the line it looks like.
 * `line` is the line of the person's file; `item` the number of the line it looks like; `state` that
 * line's state at the check (`lineState`): the update is refused when the line changed since. An
 * update that carries a state applies to its line even when the row no longer looks like it.
 */
export type BudgetFileLookalikeChoice =
  | { kind: 'lookalike'; line: number; action: 'ignore' | 'create' }
  | { kind: 'lookalike'; line: number; action: 'update'; item: number; state?: string };

/** The line a row looked like at a check, and that line's state then (`lineState`). */
export interface BudgetFileLookalikeTarget {
  item: number;
  state: string;
}

/**
 * The choice for every row that looks like a stored line; a choice for one row wins over it.
 * `targets`, by line of the person's file: the line each row looked like at the check shown, and its
 * state (the report's `lookalikes.targets`). A row it names keeps that target even when it no longer
 * looks like it: left out for `ignore` (what the check gives back when the person chose nothing, so a
 * row left out is never created without a choice), refused for `update` when the line changed since.
 * A row it does not name is left out by `update`. Without `targets`, `update` updates every line a row
 * looks like.
 */
export type BudgetFileLookalikesChoice = {
  kind: 'lookalikes';
  action: 'ignore' | 'create' | 'update';
  targets?: Record<string, BudgetFileLookalikeTarget>;
};

/** Why a row looks like a stored line, in the order the check tries them. */
export type BudgetFileLookalikeReason = 'title_supplier' | 'amounts' | 'close_title';

/** A row to create that looks like a stored line the person reads. */
export interface BudgetFileLookalike {
  /** The row's line in the file (header counted). */
  line: number;
  nature: BudgetNature;
  /** The row's title. */
  name: string;
  /** The stored line it looks like: its number, reference, title and state at this check (empty when the line is gone). */
  target: { item: number; ref: string; name: string; state: string };
  /**
   * `title_supplier`: the same title (case and accents aside) and supplier; `amounts`: every amount
   * of the row equal, the same currency, supplier or company, and account when the file gives one;
   * `close_title`: a close title, the same supplier and an equal amount. Absent when the row keeps a
   * target it no longer looks like (the line changed since the check the person chose on).
   */
  reason?: BudgetFileLookalikeReason;
  /** What the check does with it: left out (the default), created anyway, or the line updated. */
  outcome: 'ignored' | 'created' | 'updated';
  /** Whether the person may update that line: "Update" is offered only then. */
  updatable: boolean;
  /** For an update: the fields it changes (none when the line already holds the row). */
  fields?: string[];
}

export interface BudgetFileLookalikes {
  /** The first LOOKALIKE_LIST_LIMIT, in file order. */
  lines: BudgetFileLookalike[];
  /** Every row's target and its state now, by line of the file: what "Update all" sends back. */
  targets: Record<string, BudgetFileLookalikeTarget>;
  count: number;
  ignored: number;
  created: number;
  updated: number;
}

/** Lookalikes the report lists; beyond, only the choice for all rows reaches them. */
export const LOOKALIKE_LIST_LIMIT = 200;

/** The person's choices and Kad's proposals the check follows. */
export interface BudgetFileMatchOptions {
  choices?: readonly BudgetFileChoice[];
  /**
   * Kad's proposals, by column (`supplier_name`, `analytics:<code>`): a value of the file and the
   * existing value it stands for. Accepted only when that value exists and is enabled.
   */
  proposals?: Readonly<Record<string, Readonly<Record<string, string>>>>;
}

/** Lines of the file a matching entry names (the first ones), and the entries of each matching list: common to every import. */
export { MATCH_LINE_LIMIT, MATCH_LIST_LIMIT } from '../../common/name-matching';

/**
 * A value of the file matched to an existing value beyond case: listed, and the person may undo it
 * (`undoable: true`). Its column is `supplier_name` or `analytics:<code>`; `name` is the dimension's
 * name for an `analytics:` column (null for the unnamed default dimension, and for the supplier). The
 * shape every import shares (lot I3 of 26.11.9).
 */
export type BudgetFileMatch = ImportNameMatch;

/** A value Kad proposed that the check did not accept: the shape every import shares (lot I3 of 26.11.9). */
export type BudgetFileRefusedProposal = ImportRefusedProposal;

/** A value of the file nothing matched, and the closest values of the workspace's list. */
export interface BudgetFileCandidates {
  /** `supplier_name`, `analytics:<code>` or `company_name`. */
  column: string;
  name: string | null;
  value: string;
  /** `create`: the load creates it; `refused`: the check refuses it (a company, a supplier not created, a closed list). */
  outcome: 'create' | 'refused';
  lines: number[];
  count: number;
  /** Three at most, the closest first; `score` from 0 to 1 (pg_trgm's similarity). Empty when none is close. */
  candidates: Array<{ name: string; score: number }>;
}

export interface BudgetFileMatching {
  matches: BudgetFileMatch[];
  /** Kad's proposals the check refused. */
  refusedProposals: BudgetFileRefusedProposal[];
  candidates: BudgetFileCandidates[];
  /**
   * How many entries each list has: `matches` holds each one Kad proposed and the first MATCH_LIST_LIMIT
   * others, `refusedProposals` all, `candidates` the first MATCH_LIST_LIMIT.
   */
  totals: { matches: number; refusedProposals: number; candidates: number };
  /** The choices the check followed: the undone matches it would otherwise make, and the suppliers option. */
  choices: BudgetFileChoice[];
  /** The "Create missing suppliers" option: `allowed` when the person may create suppliers, `value` the one followed. */
  createSuppliers: { allowed: boolean; value: boolean };
}

export const AMOUNT_MEASURE_LIST: readonly AmountMeasure[] = AMOUNT_MEASURES;

/** One amount the load writes. `month` null is a yearly total. */
export interface BudgetFileAmountChange {
  year: number;
  measure: AmountMeasure;
  month: number | null;
  cents: bigint;
}

/** One dimension value the load sets. `createName` is a value that does not exist yet. */
export interface BudgetFileAnalyticsChange {
  code: string;
  categoryId: string | null;
  createName: string | null;
}

/**
 * One line the load writes. `body` holds only the item-service columns that
 * change (every column a new line sets). Amounts and new suppliers are beside
 * it: the supplier id and the new dimension values are known only after those
 * inserts.
 */
export interface BudgetFileLinePlan {
  line: number;
  /** The line's nature: the service, the freeze, the audit label and the numbers of its write follow it. */
  nature: BudgetNature;
  creating: boolean;
  itemId: string | null;
  itemNumber: number | null;
  body: Record<string, unknown>;
  analytics: BudgetFileAnalyticsChange[];
  amounts: BudgetFileAmountChange[];
  /** Grain of a version this file creates, per year it writes. */
  grains: Array<{ year: number; grain: 'annual' | 'monthly' }>;
  newSupplier: { name: string; erpId: string | null } | null;
}
