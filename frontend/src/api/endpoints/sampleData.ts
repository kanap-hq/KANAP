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
  /** Sample data was loaded in full once (kept by a reset): the home banner never shows again. */
  ever_loaded_at: string | null;
  /** The last reset an administrator asked for failed; cleared by the next load or reset. */
  reset_failed_at: string | null;
};

/** Why a load would be refused now (the codes of the load's errors). */
export type SampleDataLoadRefusal = 'SUBSCRIPTION_FROZEN' | 'TRIAL_EXPIRED' | 'tenant_not_empty';

export type SampleDataOverview = SampleDataState & {
  can_load: boolean;
  load_refusal: SampleDataLoadRefusal | null;
  created_since_load: number | null;
  workspace_name: string;
  loaded_by_name: string | null;
};

/** `banner`: the light answer of the home banner (no count since the load, no loader name). */
export type SampleDataView = 'page' | 'banner';

export const sampleDataApi = {
  get: (view: SampleDataView = 'page'): Promise<SampleDataOverview> =>
    (view === 'banner'
      ? api.get<SampleDataOverview>('/admin/sample-data', { params: { view } })
      : api.get<SampleDataOverview>('/admin/sample-data')),
  load: (): Promise<SampleDataState> => api.post<SampleDataState>('/admin/sample-data/load'),
  reset: (confirmName: string): Promise<SampleDataState> =>
    api.post<SampleDataState, { confirm_name: string }>('/admin/sample-data/reset', { confirm_name: confirmName }),
  dismiss: (): Promise<SampleDataState> => api.post<SampleDataState>('/admin/sample-data/dismiss'),
};
