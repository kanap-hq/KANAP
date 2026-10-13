import api from '../api';

/** A column in the copy and clear API (summary key vocabulary). */
export type BudgetColumn = 'budget' | 'revision' | 'forecast' | 'follow_up' | 'landing';

/** Which budget lines a read or a budget operation targets: all of them, or one nature. */
export type BudgetScope = 'opex' | 'capex' | 'all';
/** One nature. */
export type BudgetOperationScope = Exclude<BudgetScope, 'all'>;

/**
 * What the copy does with the calendar of one line priced per day:
 * - `disabled`: the calendar is disabled and still used;
 * - `fallback`: it has no working days for the destination year, `fallback` (the company standard calendar) replaces it;
 * - `missing`: no replacement: the item's amounts are copied without recalculation.
 */
export type CalendarIssue = {
  /** The line's description, or "Line n" when it has none. */
  line: string;
  /** The line's place in the source column, from 1. */
  lineNumber: number;
  calendar: string;
  kind: 'disabled' | 'fallback' | 'missing';
  fallback?: string;
};

/** "Copy the budget" (`POST /budget-lines/budget-operations/copy`): the amounts, the allocations or both. */
export type CopyBudgetOperation = {
  scope: BudgetScope;
  sourceYear: number;
  destinationYear: number;
  amounts?: {
    sourceColumn: BudgetColumn;
    destinationColumn: BudgetColumn;
    percentageIncrease: number;
    /** Confirms a copy whose lines change calendar or cannot be recalculated (see `CalendarIssue`). */
    acceptCalendarChanges?: boolean;
  } | null;
  /** Allocations go to another year only. */
  allocations?: boolean;
  overwrite: boolean;
  dryRun: boolean;
};

/**
 * Why the amounts of a line are skipped: no version in the source year, nothing to copy within the
 * line's dates, or a destination column that holds amounts (without overwrite).
 */
export type AmountsSkip = 'no_source' | 'source_empty' | 'destination_filled';

/** The amounts part of a line: the column's totals in the line's own currency. */
export type AmountsPart = {
  sourceValue: number;
  currentDestinationValue: number;
  newValue: number;
  skipped: boolean;
  skip: AmountsSkip | null;
  /** The line is valid for part of the destination year: the months outside its validity are not copied. */
  prorated: boolean;
  /** The source column follows its quantity and price lines: the copy raises their unit prices and recalculates the months. */
  fromLines: boolean;
  calendarIssues: CalendarIssue[];
};

export type AllocationAction = 'copy' | 'skip_missing_source_version' | 'skip_no_source_allocations' | 'skip_destination_has_data' | 'error';

/** The allocations part of a line: the method of each side and what the copy leaves. */
export type AllocationsPart = {
  sourceMethod: string | null;
  sourceMethodLabel: string;
  destinationMethod: string | null;
  destinationMethodLabel: string;
  resultMethod: string | null;
  resultMethodLabel: string;
  sourceAllocationsCount: number;
  destinationAllocationsCount: number;
  action: AllocationAction;
  message?: string;
};

/** One line of a copy, with its BL number and nature, and each part asked. */
export type CopyBudgetLine = {
  itemId: string;
  itemNumber: number;
  reference: string | null;
  nature: BudgetOperationScope;
  itemName: string;
  amounts?: AmountsPart;
  allocations?: AllocationsPart;
};

export type CopyPartSummary = { totalItems: number; processed: number; skipped: number; errors: number };

export type CopyBudgetResponse = {
  success: boolean;
  dryRun: boolean;
  scope: BudgetScope;
  summary: { lines: number; amounts?: CopyPartSummary; allocations?: CopyPartSummary };
  results: CopyBudgetLine[];
};

export const copyBudget = async (operation: CopyBudgetOperation): Promise<CopyBudgetResponse> => {
  const response = await api.post<CopyBudgetResponse>('/budget-lines/budget-operations/copy', operation);
  return response.data;
};

export type ClearColumnOperation = {
  year: number;
  column: BudgetColumn;
};

export type ClearColumnResponse = {
  success: boolean;
  summary: {
    totalItems: number;
    cleared: number;
    skipped: number;
    errors: number;
  };
};

/** "Reset a column" (`POST /budget-lines/budget-operations/clear-column`), on all lines or one nature. */
export const clearBudgetColumn = async (scope: BudgetScope, operation: ClearColumnOperation): Promise<ClearColumnResponse> => {
  const response = await api.post<ClearColumnResponse>('/budget-lines/budget-operations/clear-column', { scope, ...operation });
  return response.data;
};
