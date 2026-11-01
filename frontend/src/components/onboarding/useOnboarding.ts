import React from 'react';
import { useQuery, useQueryClient, type Query } from '@tanstack/react-query';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import { useTenant } from '../../tenant/TenantContext';
import { onboardingApi, type OnboardingState } from './onboardingApi';

export const ONBOARDING_QUERY_KEY = ['onboarding'] as const;

const statusOf = (error: unknown): number | undefined => (error as { response?: { status?: number } })?.response?.status;

/** A load or a reset of the sample data is running: the state is read again every 3 s. */
export function sampleDataRunning(state: OnboardingState | undefined): boolean {
  return !!state && (state.reset_in_progress || state.sample_data.status === 'loading' || state.sample_data.status === 'resetting');
}

/** Onboarding exists for the users of a cloud workspace (trial workspaces are cloud only). */
export function useOnboardingAvailable(): boolean {
  const { config } = useFeatures();
  const { profile, claims } = useAuth();
  const { isPlatformHost } = useTenant();
  return config.deploymentMode !== 'single-tenant' && !!profile?.id && !isPlatformHost && !claims?.isPlatformAdmin;
}

/** The workspace is in a running trial. */
export function useRunningTrial(): boolean {
  const { config } = useFeatures();
  const { subscription } = useAuth();
  return config.deploymentMode !== 'single-tenant'
    && subscription?.status === 'trialing'
    && subscription.is_subscription_healthy === true;
}

/**
 * The onboarding state of the workspace for the signed-in user. While the sample data loads or
 * the workspace is reset, it is read every 3 s; when that ends, every other cached query is reset
 * and the profile reloaded, so no page keeps showing the workspace as it was.
 */
export function useOnboarding() {
  const available = useOnboardingAvailable();
  const queryClient = useQueryClient();
  const { refreshMe } = useAuth();

  const query = useQuery({
    queryKey: ONBOARDING_QUERY_KEY,
    queryFn: onboardingApi.get,
    enabled: available,
    staleTime: 60_000,
    // A server without the onboarding API (404) or a refusal is final.
    retry: (count, error) => ![403, 404].includes(statusOf(error) ?? 0) && count < 2,
    refetchInterval: (current: Query<OnboardingState>) => (sampleDataRunning(current.state.data) ? 3000 : false),
  });

  const data = query.data;
  const previous = React.useRef<OnboardingState | undefined>(undefined);
  React.useEffect(() => {
    if (!data) return;
    const before = previous.current;
    previous.current = data;
    if (!sampleDataRunning(before) || sampleDataRunning(data)) return;
    void queryClient.resetQueries({ predicate: (other) => other.queryKey[0] !== ONBOARDING_QUERY_KEY[0] });
    void refreshMe();
  }, [data, queryClient, refreshMe]);

  const apply = React.useCallback((state: OnboardingState) => {
    queryClient.setQueryData(ONBOARDING_QUERY_KEY, state);
  }, [queryClient]);

  return { query, state: available ? data : undefined, apply };
}
