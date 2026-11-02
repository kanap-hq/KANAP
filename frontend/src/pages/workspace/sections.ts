import type { OnboardingAngle } from '../../components/onboarding/onboardingApi';

/** The sections of the home page; each tile belongs to one (`TILE_REGISTRY`, the budget tiles to `budget`). */
export type SectionId = 'work' | 'portfolio' | 'landscape' | 'budget';
export type SectionState = { id: SectionId; hidden: boolean };

export const SECTION_IDS: SectionId[] = ['work', 'portfolio', 'landscape', 'budget'];

/** Each section is named as its module in the navigation; the person's own work has its own name. */
export const SECTION_TITLE_KEYS: Record<SectionId, string> = {
  work: 'dashboard.sections.work',
  portfolio: 'nav:workspaces.portfolio',
  landscape: 'nav:workspaces.itOperations',
  budget: 'nav:workspaces.budgetManagement',
};

const ANGLE_SECTION: Record<OnboardingAngle, SectionId> = {
  budget: 'budget',
  cartography: 'landscape',
  portfolio: 'portfolio',
};

/** The section of an onboarding path, which heads the page until the person orders the sections. */
export function angleSection(angle: OnboardingAngle | null): SectionId | null {
  return angle ? ANGLE_SECTION[angle] : null;
}

/**
 * The sections in the person's order, every section once. Until they order them, the default order
 * with the section of their onboarding path first.
 */
export function resolveSections(saved: SectionState[] | null | undefined, angle: OnboardingAngle | null): SectionState[] {
  if (saved?.length) {
    const known = saved.filter((section, index) => SECTION_IDS.includes(section.id) && saved.findIndex((other) => other.id === section.id) === index);
    const missing = SECTION_IDS.filter((id) => !known.some((section) => section.id === id)).map((id) => ({ id, hidden: false }));
    return [...known, ...missing];
  }
  const first = angleSection(angle);
  return [...SECTION_IDS].sort((a, b) => Number(b === first) - Number(a === first)).map((id) => ({ id, hidden: false }));
}
