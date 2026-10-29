import { AmountMeasure, AMOUNT_MEASURES } from '../amounts-write.util';
import { budgetLineReference, type BudgetNature } from '../budget-nature';

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

/** Every line of the tenant the caller may import, for the duplicate hint. Not the full row. */
export interface LineHint {
  nature: BudgetNature;
  itemNumber: number;
  name: string;
  supplierId: string | null;
}

export interface CatalogCompany {
  id: string;
  name: string;
  coaId: string | null;
  disabledAt: string | null;
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

export interface CostCenterCompanyWarning {
  line: number;
  /** Translation code of the sentence (frontend `errors` namespace); `message` is its English text. */
  code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY';
  costCenter: string;
  company: string;
  costCenterCompany: string;
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

export interface BudgetFileReport {
  ok: boolean;
  scope: BudgetFileScope;
  encoding: 'utf-8' | 'windows-1252' | null;
  separator: ',' | ';' | '\t' | null;
  notices: { dates: string | null; amounts: string | null };
  fileErrors: string[];
  headerErrors: string[];
  errors: Array<{ line: number; column: string | null; message: string }>;
  errorCount: number;
  missing: Array<{ type: string; count: number; examples: string[]; where: string; message: string }>;
  deleted: Array<{ line: number; itemNumber: string }>;
  deletedCount: number;
  changes: {
    created: number;
    updated: number;
    unchanged: number;
    createdLines: Array<{ line: number; name: string }>;
    updatedLines: Array<{ line: number; itemNumber: string; fields: string[] }>;
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
    duplicates: Array<{ line: number; message: string }>;
    ignoredColumns: string[];
    supplierNames: Array<{ line: number; message: string }>;
    /** company_name names another company than the cost center's: accepted, said once per line. */
    costCenterCompanies: CostCenterCompanyWarning[];
    /** Changed amounts on columns that follow their calculation lines, the first 20. */
    calculationLines: CalculationLinesWarning[];
    /** How many there are in all. */
    calculationLinesCount: number;
  };
  creates: {
    dimensionValues: Array<{ dimension: string; names: string[] }>;
    suppliers: Array<{ name: string; erpId: string | null }>;
    /**
     * For a limited person only: unknown values of a closed-list dimension, refused (each row has
     * its error); `dimensionValues` lists the ones the load will create.
     */
    refusedDimensionValues?: Array<{ dimension: string; names: string[] }>;
  };
  supplierMessage: string | null;
  snapshot: { lines: BudgetFileSnapshotLine[] };
  /** An .xlsx workbook of more than one sheet: the name of the sheet read, the first one. Absent otherwise. */
  firstSheetOnly?: string;
  /** For a limited person only: the check ran on the person's access ("Calculated on your access"). */
  dataAccessLimited?: true;
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
