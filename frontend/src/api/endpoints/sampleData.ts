import { api } from '../client';

/**
 * Sample data of a cloud workspace (`/admin/sample-data`, backend `demo-data.controller.ts`).
 * Every route needs the Administrator role of the workspace.
 */

export type SampleDataStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'resetting';

export type SampleDataErrorCode =
  | 'load_failed'
  | 'load_timeout'
  | 'load_not_started'
  | 'load_interrupted'
  | 'reset_failed';

export type SampleDataState = {
  status: SampleDataStatus;
  /** The loader step running now (a technical name, see `SAMPLE_DATA_STEPS`). */
  step: string | null;
  started_at: string | null;
  heartbeat_at: string | null;
  loaded_at: string | null;
  loaded_by: string | null;
  failed_at: string | null;
  error_code: SampleDataErrorCode | null;
  dismissed_at: string | null;
};

export type SampleDataOverview = SampleDataState & {
  can_load: boolean;
  created_since_load: number | null;
  workspace_name: string;
  loaded_by_name: string | null;
};

export const sampleDataApi = {
  get: (): Promise<SampleDataOverview> => api.get<SampleDataOverview>('/admin/sample-data'),
  load: (): Promise<SampleDataState> => api.post<SampleDataState>('/admin/sample-data/load'),
  reset: (confirmName: string): Promise<SampleDataState> =>
    api.post<SampleDataState, { confirm_name: string }>('/admin/sample-data/reset', { confirm_name: confirmName }),
  dismiss: (): Promise<SampleDataState> => api.post<SampleDataState>('/admin/sample-data/dismiss'),
};
