/** The tabs of the portfolio settings page, in screen order: the slug of its address and its label. */
export const SETTINGS_TABS = [
  { slug: 'criteria', labelKey: 'settings.tabs.scoringCriteria' },
  { slug: 'skills', labelKey: 'settings.tabs.skills' },
  { slug: 'phase-templates', labelKey: 'settings.tabs.phaseTemplates' },
  { slug: 'classification', labelKey: 'settings.tabs.classification' },
  { slug: 'teams', labelKey: 'settings.tabs.teams' },
  { slug: 'contract-types', labelKey: 'settings.tabs.employmentTypes' },
] as const;

export type SettingsTabSlug = (typeof SETTINGS_TABS)[number]['slug'];

/** The tab an address without a known slug opens. */
export const DEFAULT_SETTINGS_TAB: SettingsTabSlug = 'criteria';

export const SETTINGS_PATH = '/portfolio/settings';

export function settingsTabPath(slug: SettingsTabSlug): string {
  return `${SETTINGS_PATH}/${slug}`;
}

export function isSettingsTabSlug(value: string | undefined): value is SettingsTabSlug {
  return SETTINGS_TABS.some((tab) => tab.slug === value);
}
