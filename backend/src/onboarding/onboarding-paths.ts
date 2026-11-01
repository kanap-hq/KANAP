/**
 * The first steps of a trial workspace ("Your first five steps"): one path per angle and mode,
 * five step keys each, in the order the list shows them. The keys are stored in
 * `onboarding_steps.step_key` and named by the interface: never rename one.
 */

export const ONBOARDING_ANGLES = ['budget', 'cartography', 'portfolio'] as const;
export type OnboardingAngle = (typeof ONBOARDING_ANGLES)[number];

export const ONBOARDING_MODES = ['example', 'own_data'] as const;
export type OnboardingMode = (typeof ONBOARDING_MODES)[number];

export const ONBOARDING_PATHS: Readonly<Record<OnboardingAngle, Readonly<Record<OnboardingMode, readonly string[]>>>> = {
  budget: {
    example: ['budget_overview', 'budget_line', 'budget_report', 'budget_plaid', 'budget_import'],
    own_data: ['own_company', 'own_budget_lines', 'own_contract', 'own_report', 'own_invite'],
  },
  cartography: {
    example: ['map_overview', 'map_application', 'map_technologies', 'map_vulnerabilities', 'map_import'],
    own_data: ['own_applications', 'own_technologies', 'own_assets', 'own_map', 'own_invite'],
  },
  portfolio: {
    example: ['portfolio_overview', 'portfolio_request', 'portfolio_planning', 'portfolio_plaid', 'portfolio_import'],
    own_data: ['own_projects', 'own_request', 'own_project_budget', 'own_planning', 'own_invite'],
  },
};

export function isOnboardingAngle(value: unknown): value is OnboardingAngle {
  return typeof value === 'string' && (ONBOARDING_ANGLES as readonly string[]).includes(value);
}

export function isOnboardingMode(value: unknown): value is OnboardingMode {
  return typeof value === 'string' && (ONBOARDING_MODES as readonly string[]).includes(value);
}

/** The step keys of a path, in order; none without an angle or a mode. */
export function onboardingPath(angle: OnboardingAngle | null, mode: OnboardingMode | null): readonly string[] {
  return angle && mode ? ONBOARDING_PATHS[angle][mode] : [];
}
