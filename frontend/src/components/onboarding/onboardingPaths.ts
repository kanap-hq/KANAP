import type { OnboardingAngle } from './onboardingApi';

/**
 * `opensRecord`: the step opens one record of its list rather than the list (the largest budget
 * line of the year, the first of the most critical applications, the best-scored request on its
 * scoring tab, the project resulting from the best-scored converted request), the list when there
 * is none.
 */
export type OpenedRecord = 'topBudgetLine' | 'mostCriticalApplication' | 'topScoredRequest' | 'projectFromRequest';

/**
 * Where each step opens. The step keys and their order come from the API
 * (`backend/src/onboarding/onboarding-paths.ts`); a key missing here is left out of the list.
 * `tab`: the tab (or the properties panel section, `team`) the opened project shows; its summary by default.
 */
export type StepScreen = { to: string; opensRecord?: OpenedRecord; tab?: string };

export const STEP_SCREENS: Record<string, StepScreen> = {
  budget_overview: { to: '/ops/budget' },
  budget_line: { to: '/ops/budget', opensRecord: 'topBudgetLine' },
  budget_report: { to: '/ops/reports/top-opex' },
  budget_plaid: { to: '/ai' },
  budget_import: { to: '/ops/budget' },
  own_company: { to: '/master-data/companies' },
  own_budget_lines: { to: '/ops/budget' },
  own_contract: { to: '/ops/contracts' },
  own_report: { to: '/ops/reports/top-opex' },
  own_invite: { to: '/admin/users' },
  map_applications: { to: '/it/applications' },
  map_application: { to: '/it/applications', opensRecord: 'mostCriticalApplication' },
  map_assets: { to: '/it/assets' },
  map_technologies: { to: '/it/technologies/end-of-support' },
  map_import: { to: '/it/applications' },
  own_sites: { to: '/it/locations' },
  own_applications: { to: '/it/applications' },
  own_technologies: { to: '/it/technologies' },
  own_assets: { to: '/it/assets' },
  portfolio_request: { to: '/portfolio/requests', opensRecord: 'topScoredRequest' },
  portfolio_project: { to: '/portfolio/projects', opensRecord: 'projectFromRequest' },
  portfolio_tasks: { to: '/portfolio/tasks' },
  // The key stays (it is stored): the step now shows the portfolio reports.
  portfolio_time: { to: '/portfolio/reports' },
  portfolio_import: { to: '/portfolio/projects' },
  own_request: { to: '/portfolio/requests' },
  own_projects: { to: '/portfolio/projects', opensRecord: 'projectFromRequest' },
  own_tasks: { to: '/portfolio/tasks' },
  own_project_budget: { to: '/portfolio/projects', opensRecord: 'projectFromRequest', tab: 'relations' },
};

/** The screens a step opens on one path only: on the portfolio, the person sets up their own contributor profile. */
const ANGLE_SCREENS: Record<string, Partial<Record<OnboardingAngle, StepScreen>>> = {
  own_invite: { portfolio: { to: '/portfolio/contributors/me' } },
};

export function stepScreen(key: string, angle: OnboardingAngle | null): StepScreen | null {
  return (angle ? ANGLE_SCREENS[key]?.[angle] : undefined) ?? STEP_SCREENS[key] ?? null;
}

/** The query parameter that carries a step to its screen. */
export const STEP_PARAM = 'step';

export function stepHref(key: string, angle: OnboardingAngle | null = null): string | null {
  const screen = stepScreen(key, angle);
  return screen ? `${screen.to}?${STEP_PARAM}=${encodeURIComponent(key)}` : null;
}

/** The title of a step: on the portfolio, the last one is the person's own contributor profile. */
export function stepTitleKey(key: string, angle: OnboardingAngle | null): string {
  return key === 'own_invite' && angle === 'portfolio'
    ? 'onboarding.firstSteps.steps.own_invite.portfolioTitle'
    : `onboarding.firstSteps.steps.${key}.title`;
}

/** The hint of a step: `own_invite` names a different colleague for each angle. */
export function stepHintKey(key: string, angle: OnboardingAngle | null): string {
  return key === 'own_invite' && angle
    ? `onboarding.firstSteps.steps.own_invite.hint.${angle}`
    : `onboarding.firstSteps.steps.${key}.hint`;
}

/** What the hint of a record opened by its step names: carried in the navigation state. */
export type StepLocationState = { onboardingRecord?: string };
