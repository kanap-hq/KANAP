import type { OnboardingAngle } from './onboardingApi';

/**
 * Where each step opens, and what its hint points at on that screen: the page title by default,
 * the composer of Plaid, the tab row of a record or the list's Export button. The step keys and their order come from the API
 * (`backend/src/onboarding/onboarding-paths.ts`); a key missing here is left out of the list.
 */
export type StepTarget = 'title' | 'composer' | 'tabs' | 'export';

/**
 * `opensRecord`: the step opens one record of its list rather than the list (the largest budget
 * line of the year, the first of the most critical applications, the best-scored request on its
 * scoring tab, the project resulting from the best-scored converted request), the list when there
 * is none.
 */
export type OpenedRecord = 'topBudgetLine' | 'mostCriticalApplication' | 'topScoredRequest' | 'projectFromRequest';

/** `tab`: the tab (or the properties panel section, `team`) the opened project shows; its summary by default. */
export type StepScreen = { to: string; target: StepTarget; opensRecord?: OpenedRecord; tab?: string };

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
  own_sites: title('/it/locations'),
  own_applications: title('/it/applications'),
  own_technologies: title('/it/technologies'),
  own_assets: title('/it/assets'),
  portfolio_request: { to: '/portfolio/requests', target: 'tabs', opensRecord: 'topScoredRequest' },
  portfolio_project: { to: '/portfolio/projects', target: 'tabs', opensRecord: 'projectFromRequest' },
  portfolio_tasks: title('/portfolio/tasks'),
  // The key stays (it is stored): the step now shows the portfolio reports.
  portfolio_time: title('/portfolio/reports'),
  portfolio_import: { to: '/portfolio/projects', target: 'export' },
  own_request: title('/portfolio/requests'),
  own_projects: { to: '/portfolio/projects', target: 'tabs', opensRecord: 'projectFromRequest' },
  own_tasks: title('/portfolio/tasks'),
  own_project_budget: { to: '/portfolio/projects', target: 'tabs', opensRecord: 'projectFromRequest', tab: 'relations' },
};

/** The screens a step opens on one path only: the portfolio's colleague joins the project's team. */
const ANGLE_SCREENS: Record<string, Partial<Record<OnboardingAngle, StepScreen>>> = {
  own_invite: { portfolio: { to: '/portfolio/projects', target: 'title', opensRecord: 'projectFromRequest', tab: 'team' } },
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

/** The title of a step: the portfolio's colleague is a contributor. */
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
