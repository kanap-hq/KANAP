import { AmountMeasure, AMOUNT_MEASURES } from '../amounts-write.util';

/** OPEX or CAPEX. One engine, the list decides which. */
export type BudgetFileScope = 'opex' | 'capex';

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

export interface StoredVersion {
  id: string;
  year: number;
  budgetRev: number;
  months: Record<AmountMeasure, MonthCell[]>;
}

/** One line as the preflight compares it and as the export writes it. */
export interface StoredLine {
  id: string;
  itemNumber: number;
  rowVersion: number;
  name: string;
  description: string | null;
  ppeType: string | null;
  investmentType: string | null;
  priority: string | null;
  companyId: string | null;
  companyName: string | null;
  supplierId: string | null;
  supplierName: string | null;
  supplierErpId: string | null;
  accountId: string | null;
  accountNumber: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  runBuild: 'run' | 'build' | null;
  /** Dimension code to the value name. A missing code means no value. */
  analytics: Record<string, string>;
  ownerItEmail: string | null;
  ownerBusinessEmail: string | null;
  projectNumber: number | null;
  currency: string;
  /** `YYYY-MM-DD`. */
  effectiveStart: string;
  /** ISO instant, or null. A bare day is noon UTC. */
  endOfValidity: string | null;
  notes: string | null;
  versions: StoredVersion[];
}

/** Every line of the tenant, for the duplicate hint. Not the full row. */
export interface LineHint {
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
}

export interface CatalogDimension {
  code: string;
  name: string;
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
  /** `year:column`, column being `budget`, `revision`, `forecast`, `actual` or `landing`. */
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

export function lineRef(scope: BudgetFileScope, itemNumber: number): string {
  return `${scope === 'opex' ? 'OPX' : 'CPX'}-${itemNumber}`;
}

export interface BudgetFileSnapshotLine {
  id: string;
  itemNumber: number;
  rowVersion: number;
  years: Array<{ year: number; versionId: string; budgetRev: number }>;
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
  };
  creates: {
    dimensionValues: Array<{ dimension: string; names: string[] }>;
    suppliers: Array<{ name: string; erpId: string | null }>;
  };
  supplierMessage: string | null;
  snapshot: { lines: BudgetFileSnapshotLine[] };
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
