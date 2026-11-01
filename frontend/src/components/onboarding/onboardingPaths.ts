import type { OnboardingAngle } from './onboardingApi';

/**
 * Where each step opens, and what its hint points at on that screen: the page title by default,
 * the composer of Plaid, the tab row of a record or the list's Export button. The step keys and their order come from the API
 * (`backend/src/onboarding/onboarding-paths.ts`); a key missing here is left out of the list.
 */
export type StepTarget = 'title' | 'composer' | 'tabs' | 'export';

/**
 * `opensRecord`: the step opens one record of its list rather than the list (the largest budget
 * line of the year, the first of the most critical applications), the list when there is none.
 */
export type OpenedRecord = 'topBudgetLine' | 'mostCriticalApplication';

export type StepScreen = { to: string; target: StepTarget; opensRecord?: OpenedRecord };

const title = (to: string): StepScreen => ({ to, target: 'title' });

export const STEP_SCREENS: Record<string, StepScreen> = {
  budget_overview: title('/ops/budget'),
  budget_line: { to: '/ops/budget', target: 'tabs', opensRecord: 'topBudgetLine' },
  budget_report: title('/ops/reports/top-opex'),
  budget_plaid: { to: '/ai', target: 'composer' },
  budget_import: { to: '/ops/budget', target: 'export' },
  own_company: title('/master-data/companies'),
  own_budget_lines: title('/ops/budget'),
  own_contract: title('/ops/contracts'),
  own_report: title('/ops/reports/top-opex'),
  own_invite: title('/admin/users'),
  map_applications: title('/it/applications'),
  map_application: { to: '/it/applications', target: 'tabs', opensRecord: 'mostCriticalApplication' },
  map_assets: title('/it/assets'),
  map_technologies: title('/it/technologies/end-of-support'),
  map_import: { to: '/it/applications', target: 'export' },
  own_applications: title('/it/applications'),
  own_technologies: title('/it/technologies'),
  own_assets: title('/it/assets'),
  own_findings: title('/it/technologies/end-of-support'),
  portfolio_request: title('/portfolio/requests'),
  portfolio_project: title('/portfolio/projects'),
  portfolio_tasks: title('/portfolio/tasks'),
  portfolio_time: title('/portfolio/projects'),
  portfolio_import: title('/portfolio/projects'),
  own_request: title('/portfolio/requests'),
  own_projects: title('/portfolio/projects'),
  own_tasks: title('/portfolio/tasks'),
  own_project_budget: title('/portfolio/projects'),
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

/** What the hint of a record opened by its step names: carried in the navigation state. */
export type StepLocationState = { onboardingRecord?: string };
