import api from '../../api';

export const ONBOARDING_ANGLES = ['budget', 'cartography', 'portfolio'] as const;
export type OnboardingAngle = (typeof ONBOARDING_ANGLES)[number];
export type OnboardingMode = 'example' | 'own_data';

export type SampleDataStatus = 'idle' | 'loading' | 'loaded' | 'failed' | 'resetting';

/** `GET /onboarding`: the workspace's answers and the calling user's steps (`doc/onboarding.md`). */
export type OnboardingState = {
  angle: OnboardingAngle | null;
  mode: OnboardingMode | null;
  chosen_at: string | null;
  can_choose: boolean;
  steps: Array<{ key: string; done_at: string | null }>;
  next_step: string | null;
  completed: boolean;
  dismissed_at: string | null;
  sample_data: { status: SampleDataStatus | string; step: string | null; error_code?: string | null };
  reset_in_progress: boolean;
};

export type OnboardingChoice = {
  angle?: OnboardingAngle;
  mode?: OnboardingMode;
  /** Erase the objects created since the sample data was loaded (after a 409 `sample_data_modified`). */
  confirm_reset?: boolean;
};

export const onboardingApi = {
  get: async () => (await api.get<OnboardingState>('/onboarding')).data,
  choose: async (choice: OnboardingChoice) => (await api.put<OnboardingState>('/onboarding/choice', choice)).data,
  markDone: async (key: string) => (await api.post<OnboardingState>(`/onboarding/steps/${encodeURIComponent(key)}/done`)).data,
  markUndone: async (key: string) => (await api.delete<OnboardingState>(`/onboarding/steps/${encodeURIComponent(key)}/done`)).data,
  dismiss: async () => (await api.post<OnboardingState>('/onboarding/dismiss')).data,
  undismiss: async () => (await api.delete<OnboardingState>('/onboarding/dismiss')).data,
};

/** The workspace holds sample data: only an administrator may then choose "start with my own data". */
export function holdsSampleData(state: Pick<OnboardingState, 'sample_data'>): boolean {
  const { status, error_code } = state.sample_data;
  return status === 'loaded' || status === 'loading' || (status === 'failed' && error_code === 'reset_failed');
}
