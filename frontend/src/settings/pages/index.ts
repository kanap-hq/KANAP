import type { DeploymentMode } from '../accessRule';
import { INSTALLATION_SETTINGS_PAGES } from './installation';
import { MODULE_SETTINGS_PAGES } from './module';
import { ORGANIZATION_SETTINGS_PAGES } from './organization';
import { PERSON_SETTINGS_PAGES } from './person';
import { PLATFORM_SETTINGS_PAGES } from './platform';
import type { SettingsFeatureFlag, SettingsHost, SettingsPageEntry, SettingsScope } from './types';

export type * from './types';

/**
 * The registry of the settings pages: one line per page, the four settings without a route of
 * their own included. `settingsPages.test.ts` holds it to `App.tsx`, the locales and the manual.
 */
export const SETTINGS_PAGES: SettingsPageEntry[] = [
  ...PERSON_SETTINGS_PAGES,
  ...MODULE_SETTINGS_PAGES,
  ...ORGANIZATION_SETTINGS_PAGES,
  ...INSTALLATION_SETTINGS_PAGES,
  ...PLATFORM_SETTINGS_PAGES,
];

/** The scope of a page in a deployment mode. */
export function settingsPageScope(entry: SettingsPageEntry, mode: DeploymentMode): SettingsScope {
  return entry.scopeByMode?.[mode] ?? entry.scope ?? 'organization';
}

export type SettingsEnvironment = {
  mode: DeploymentMode;
  host: SettingsHost;
  features: Partial<Record<SettingsFeatureFlag, boolean>>;
};

/** Whether the page exists in this mode, on this host, with these flags. */
export function isSettingsPageAvailable(entry: SettingsPageEntry, environment: SettingsEnvironment): boolean {
  const hosts = entry.availability[environment.mode] ?? ['organization'];
  if (hosts === false || !hosts.includes(environment.host)) return false;
  return (entry.availability.features ?? []).every((flag) => environment.features[flag] === true);
}

/** The address a link to the page opens: the page, and its tab when the tab is in the address. */
export function settingsPageHref(entry: SettingsPageEntry): string {
  if (!entry.tab) return entry.path;
  if (entry.tab.in === 'path') return `${entry.path.replace(/\/$/, '')}/${entry.tab.value}`;
  return `${entry.path}?tab=${encodeURIComponent(entry.tab.value)}`;
}
