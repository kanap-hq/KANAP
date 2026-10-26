import api from '../api';

export type MasterDataCopyScope = 'companies' | 'departments';
export type MasterDataMetric = 'headcount' | 'it_users' | 'turnover';

export type MasterDataCopyRequest = {
  sourceYear: number;
  destinationYear: number;
  includeCompanies: boolean;
  includeDepartments: boolean;
  companyMetrics: MasterDataMetric[];
  dryRun: boolean;
};

export type MasterDataCopyResultItem = {
  entityType: 'company' | 'department';
  entityId: string;
  /** Null when a department has no name: the copy screen words it. */
  entityName: string | null;
  metric: MasterDataMetric;
  sourceValue: number | null;
  destinationValue: number | null;
  newValue: number | null;
  skipped: boolean;
  reason?: string;
};

export type MasterDataCopyError = {
  entityType: 'company' | 'department';
  entityId: string;
  /** Null when a department has no name: the copy screen words it. */
  entityName: string | null;
  message: string;
};

export type MasterDataCopyResponse = {
  success: boolean;
  dryRun: boolean;
  summary: {
    totalItems: number;
    processed: number;
    skipped: number;
    errors: number;
  };
  results: MasterDataCopyResultItem[];
  errors: MasterDataCopyError[];
};

export async function copyMasterData(payload: MasterDataCopyRequest): Promise<MasterDataCopyResponse> {
  const response = await api.post<MasterDataCopyResponse>('/master-data-operations/copy', payload);
  return response.data;
}
