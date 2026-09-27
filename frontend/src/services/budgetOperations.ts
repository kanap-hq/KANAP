import api from '../api';

/** A column in the copy and clear API (summary key vocabulary). */
export type BudgetColumn = 'budget' | 'revision' | 'forecast' | 'follow_up' | 'landing';

/** Which items a column operation runs on. */
export type BudgetScope = 'opex' | 'capex';

const OPERATIONS_BASE: Record<BudgetScope, string> = {
  opex: '/spend-items/budget-operations',
  capex: '/capex-items/budget-operations',
};

/** Budget rows file: monthly amounts of every OPEX and CAPEX line (CSV dialogs append `/export` and `/import`). */
export const budgetRowsEndpoint = '/budget-rows';

export type BudgetColumnOperation = {
  sourceYear: number;
  sourceColumn: BudgetColumn;
  destinationYear: number;
  destinationColumn: BudgetColumn;
  percentageIncrease: number;
  overwrite: boolean;
  dryRun: boolean;
};

export type BudgetOperationResult = {
  itemId: string;
  itemName: string;
  sourceValue: number;
  currentDestinationValue: number;
  newValue: number;
  /** The server skips this item (source all zero, or destination not empty without overwrite), month by month. */
  skipped: boolean;
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
