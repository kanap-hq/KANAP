import React from 'react';
import { useMutation, useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatures } from '../../../config/FeaturesContext';
import { useTenant } from '../../../tenant/TenantContext';
import {
  sampleDataApi,
  type SampleDataOverview,
  type SampleDataState,
  type SampleDataStatus,
  type SampleDataView,
} from '../../../api/endpoints/sampleData';

/** The sample data queries (`[SAMPLE_DATA_QUERY_ROOT, view]`). */
export const SAMPLE_DATA_QUERY_ROOT = 'sample-data';

/** The loader steps, in order (`step('…')` in `backend/fixtures/fromage-co/setup-tenant.mjs`, checked by a test). */
export const SAMPLE_DATA_STEPS = [
  'settings',
  'classification',
  'companies',
  'charts-of-accounts',
  'master-data',
  'users',
  'budget-setup',
  'applications',
  'contracts',
  'budget',
  'portfolio',
  'assets',
  'tasks',
  'application-links',
  'landscape',
  'budget-links',
  'portfolio-teams',
  'allocations',
  'knowledge',
] as const;

const RUNNING: SampleDataStatus[] = ['loading', 'resetting'];

const statusOf = (error: unknown): number | undefined => (error as any)?.response?.status;

/** Refusals that will not change by asking again: no polling, no retry. */
const isPersistent = (error: unknown) => statusOf(error) === 403 || statusOf(error) === 404;

/** Whether this user may use sample data here: cloud, a workspace host, the Administrator role. */
export function useSampleDataAvailable(): boolean {
  const { config } = useFeatures();
  const { claims } = useAuth();
  const { isPlatformHost } = useTenant();
  return config.deploymentMode !== 'single-tenant'
    && config.features.sampleData === true
    && !isPlatformHost
    && claims?.isGlobalAdmin === true;
}

/**
 * The sample data state of the workspace, polled every 3 s while a load or a reset runs, and the
 * actions. When a load or a reset ends and has changed the workspace, every other cached query is
 * reset and the profile reloaded, so no page shows data from before; the sample data answer is
 * read again in place (no flicker).
 */
export function useSampleData(enabled: boolean, view: SampleDataView = 'page') {
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();
  const queryKey = React.useMemo(() => [SAMPLE_DATA_QUERY_ROOT, view] as const, [view]);

  const query = useQuery({
    queryKey,
    queryFn: () => sampleDataApi.get(view),
    enabled,
    retry: (count, error) => !isPersistent(error) && count < 2,
    refetchInterval: (current: Query<SampleDataOverview>) => {
      if (isPersistent(current.state.error)) return false;
      return current.state.data && RUNNING.includes(current.state.data.status) ? 3000 : false;
    },
  });
  const data = query.data;

  const previous = React.useRef<SampleDataOverview | undefined>(undefined);
  React.useEffect(() => {
    if (!data) return;
    const before = previous.current;
    previous.current = data;
    if (!before || !RUNNING.includes(before.status) || RUNNING.includes(data.status)) return;
    // A reset an administrator asked for that failed changed nothing.
    if (before.status === 'resetting' && data.reset_failed_at && data.reset_failed_at !== before.reset_failed_at) return;
    void queryClient.resetQueries({ predicate: (other) => other.queryKey[0] !== SAMPLE_DATA_QUERY_ROOT });
    void queryClient.invalidateQueries({ queryKey: [SAMPLE_DATA_QUERY_ROOT] });
    void refreshMe();
  }, [data, queryClient, refreshMe]);

  /** Shows the answer of an action at once, then reads the whole overview again. */
  const applyState = React.useCallback((state: Partial<SampleDataOverview>) => {
    queryClient.setQueryData<SampleDataOverview>(queryKey, (current) => (current ? { ...current, ...state } : current));
    void queryClient.invalidateQueries({ queryKey: [SAMPLE_DATA_QUERY_ROOT] });
  }, [queryClient, queryKey]);

  /** A 409: the state moved meanwhile (another administrator, another tab); read it again. */
  const onActionError = React.useCallback((error: unknown) => {
    if (statusOf(error) === 409) void queryClient.invalidateQueries({ queryKey: [SAMPLE_DATA_QUERY_ROOT] });
  }, [queryClient]);

  const load = useMutation({
    mutationFn: () => sampleDataApi.load(),
    onSuccess: (state: SampleDataState) => applyState({ ...state, can_load: false }),
    onError: onActionError,
  });
  const reset = useMutation({
    mutationFn: (confirmName: string) => sampleDataApi.reset(confirmName),
    onSuccess: (state: SampleDataState) => applyState(state),
    onError: onActionError,
  });
  const dismiss = useMutation({
    mutationFn: () => sampleDataApi.dismiss(),
    onSuccess: (state: SampleDataState) => applyState({ dismissed_at: state.dismissed_at }),
    onError: onActionError,
  });

  return { query, overview: data, load, reset, dismiss };
}

/** The workspace name typed to confirm a reset, compared as the server does. */
export function confirmationMatches(typed: string, workspaceName: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase();
  return normalize(typed) !== '' && normalize(typed) === normalize(workspaceName);
}
