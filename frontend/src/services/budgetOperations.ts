import api from '../api';

/** A column in the copy and clear API (summary key vocabulary). */
export type BudgetColumn = 'budget' | 'revision' | 'forecast' | 'follow_up' | 'landing';

/** Which items a column operation runs on. */
export type BudgetScope = 'opex' | 'capex';

const OPERATIONS_BASE: Record<BudgetScope, string> = {
  opex: '/spend-items/budget-operations',
  capex: '/capex-items/budget-operations',
};

export type BudgetColumnOperation = {
  sourceYear: number;
  sourceColumn: BudgetColumn;
  destinationYear: number;
  destinationColumn: BudgetColumn;
  percentageIncrease: number;
  overwrite: boolean;
  dryRun: boolean;
  /** Confirms a copy whose lines change calendar or cannot be recalculated (see `CalendarIssue`). */
  acceptCalendarChanges?: boolean;
};

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

export type BudgetOperationResult = {
  itemId: string;
  itemName: string;
  sourceValue: number;
  currentDestinationValue: number;
  newValue: number;
  /** The server skips this item (source all zero, or destination not empty without overwrite), month by month. */
  skipped: boolean;
  /** The item is valid for part of the destination year: the months outside its validity are not copied. */
  prorated?: boolean;
  /** The source column follows its quantity and price lines: the copy raises their unit prices and recalculates the months. */
  fromLines?: boolean;
  calendarIssues?: CalendarIssue[];
};

export type BudgetOperationResponse = {
  success: boolean;
  dryRun: boolean;
  summary: {
    totalItems: number;
    processed: number;
    skipped: number;
    errors: number;
  };
  results: BudgetOperationResult[];
};

export const copyBudgetColumn = async (scope: BudgetScope, operation: BudgetColumnOperation): Promise<BudgetOperationResponse> => {
  const response = await api.post<BudgetOperationResponse>(`${OPERATIONS_BASE[scope]}/copy-column`, operation);
  return response.data;
};

export type AllocationCopyOperation = {
  sourceYear: number;
  destinationYear: number;
  overwrite: boolean;
  dryRun: boolean;
};

export type AllocationCopyResult = {
  itemId: string;
  itemName: string;
  sourceMethod: string | null;
  sourceMethodLabel: string;
  destinationMethod: string | null;
  destinationMethodLabel: string;
  resultMethod: string | null;
  resultMethodLabel: string;
  sourceAllocationsCount: number;
  destinationAllocationsCount: number;
  action: 'copy' | 'skip_missing_source_version' | 'skip_no_source_allocations' | 'skip_destination_has_data' | 'error';
  message?: string;
};

export type AllocationCopyResponse = {
  success: boolean;
  dryRun: boolean;
  summary: {
    totalItems: number;
    processed: number;
    skipped: number;
    errors: number;
  };
  results: AllocationCopyResult[];
};

export const copyAllocations = async (scope: BudgetScope, operation: AllocationCopyOperation): Promise<AllocationCopyResponse> => {
  const response = await api.post<AllocationCopyResponse>(`${OPERATIONS_BASE[scope]}/copy-allocations`, operation);
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

export const clearBudgetColumn = async (scope: BudgetScope, operation: ClearColumnOperation): Promise<ClearColumnResponse> => {
  const response = await api.post<ClearColumnResponse>(`${OPERATIONS_BASE[scope]}/clear-column`, operation);
  return response.data;
};
