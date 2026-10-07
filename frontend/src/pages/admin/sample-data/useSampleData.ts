import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../../auth/AuthContext';
import { useFeatures } from '../../../config/FeaturesContext';
import { useTenant } from '../../../tenant/TenantContext';
import { sampleDataApi, type SampleDataOverview, type SampleDataStatus } from '../../../api/endpoints/sampleData';

export const SAMPLE_DATA_QUERY_KEY = ['sample-data'] as const;

/** The loader steps, in order (`fixtures/fromage-co/setup-tenant.mjs`, server mode). */
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
 * actions. When a load or a reset ends, every cached query is reset and the profile reloaded, so
 * no page shows data from before.
 */
export function useSampleData(enabled: boolean) {
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();

  const query = useQuery({
    queryKey: SAMPLE_DATA_QUERY_KEY,
    queryFn: () => sampleDataApi.get(),
    enabled,
    refetchInterval: (current) => (current.state.data && RUNNING.includes(current.state.data.status) ? 3000 : false),
  });
  const status = query.data?.status;

  const previous = React.useRef<SampleDataStatus | undefined>(undefined);
  React.useEffect(() => {
    if (!status) return;
    const before = previous.current;
    previous.current = status;
    if (before && RUNNING.includes(before) && !RUNNING.includes(status)) {
      void queryClient.resetQueries();
      void refreshMe();
    }
  }, [status, queryClient, refreshMe]);

  /** Shows the answer of an action at once, then reads the whole overview again. */
  const applyState = React.useCallback((state: Partial<SampleDataOverview>) => {
    queryClient.setQueryData<SampleDataOverview>(SAMPLE_DATA_QUERY_KEY, (current) => (current ? { ...current, ...state } : current));
    void queryClient.invalidateQueries({ queryKey: SAMPLE_DATA_QUERY_KEY });
  }, [queryClient]);

  const load = useMutation({
    mutationFn: () => sampleDataApi.load(),
    onSuccess: (state) => applyState({ ...state, can_load: false }),
  });
  const reset = useMutation({
    mutationFn: (confirmName: string) => sampleDataApi.reset(confirmName),
    onSuccess: (state) => applyState(state),
  });
  const dismiss = useMutation({
    mutationFn: () => sampleDataApi.dismiss(),
    onSuccess: (state) => applyState({ dismissed_at: state.dismissed_at }),
  });

  return { query, overview: query.data, load, reset, dismiss };
}

/** The workspace name typed to confirm a reset, compared as the server does. */
export function confirmationMatches(typed: string, workspaceName: string): boolean {
  const normalize = (value: string) => value.normalize('NFC').trim().toLowerCase();
  return normalize(typed) !== '' && normalize(typed) === normalize(workspaceName);
}
