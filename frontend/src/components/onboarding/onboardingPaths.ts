import type { OnboardingAngle } from './onboardingApi';

/**
 * Where each step opens, and what its hint points at on that screen: the page title by default,
 * or the composer of Plaid. The step keys and their order come from the API
 * (`backend/src/onboarding/onboarding-paths.ts`); a key missing here is left out of the list.
 */
export type StepTarget = 'title' | 'composer';

export type StepScreen = { to: string; target: StepTarget };

const title = (to: string): StepScreen => ({ to, target: 'title' });

export const STEP_SCREENS: Record<string, StepScreen> = {
  budget_overview: title('/ops/budget'),
  budget_line: title('/ops/budget'),
  budget_report: title('/ops/reports/top-opex'),
  budget_plaid: { to: '/ai', target: 'composer' },
  budget_import: title('/ops/budget'),
  own_company: title('/master-data/companies'),
  own_budget_lines: title('/ops/budget'),
  own_contract: title('/ops/contracts'),
  own_report: title('/ops/reports/top-opex'),
  own_invite: title('/admin/users'),
  map_overview: title('/it/interface-map'),
  map_application: title('/it/applications'),
  map_technologies: title('/it/technologies/end-of-support'),
  map_vulnerabilities: title('/it/vulnerabilities'),
  map_import: title('/it/applications'),
  own_applications: title('/it/applications'),
  own_technologies: title('/it/technologies'),
  own_assets: title('/it/assets'),
  own_map: title('/it/interface-map'),
  portfolio_overview: title('/portfolio/projects'),
  portfolio_request: title('/portfolio/requests'),
  portfolio_planning: title('/portfolio/planning'),
  portfolio_plaid: { to: '/ai', target: 'composer' },
  portfolio_import: title('/portfolio/projects'),
  own_projects: title('/portfolio/projects'),
  own_request: title('/portfolio/requests'),
  own_project_budget: title('/portfolio/projects'),
  own_planning: title('/portfolio/planning'),
};

/** The query parameter that carries a step to its screen. */
export const STEP_PARAM = 'step';

export function stepHref(key: string): string | null {
  const screen = STEP_SCREENS[key];
  return screen ? `${screen.to}?${STEP_PARAM}=${encodeURIComponent(key)}` : null;
}

/** The hint of a step: `own_invite` names a different colleague for each angle. */
export function stepHintKey(key: string, angle: OnboardingAngle | null): string {
  return key === 'own_invite' && angle
    ? `onboarding.firstSteps.steps.own_invite.hint.${angle}`
    : `onboarding.firstSteps.steps.${key}.hint`;
}
