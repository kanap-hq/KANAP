import type { AccessRule, DeploymentMode } from '../accessRule';

/** Where a page sits: the person, a module, the organisation, the installation, the platform. */
export type SettingsScope = 'person' | 'module' | 'organization' | 'installation' | 'platform';

/** The module of a `module` page: its section in the top bar. */
export type SettingsModule = 'budget' | 'it' | 'portfolio' | 'agents' | 'knowledge';

/** Host: an organisation's address (cloud or on site), or the platform host of the cloud. */
export type SettingsHost = 'organization' | 'platform';

/** Flags of `GET /config/public` (`features`) a page needs. */
export type SettingsFeatureFlag = 'billing' | 'sso' | 'aiSettings' | 'aiMcp' | 'sampleData';

/**
 * Where the page exists. Per mode, the hosts that show it, or `false` for none; a missing mode
 * means the organisation host. Every flag listed must be on.
 */
export type SettingsAvailability = {
  cloud?: SettingsHost[] | false;
  onprem?: SettingsHost[] | false;
  features?: SettingsFeatureFlag[];
};

/**
 * The page of the user manual the Help button opens on the page (`getDocSlug`), with the heading
 * of its section when the page covers several screens; or no page, with the reason.
 */
export type SettingsDoc = { page: string; section?: string } | { page: null; reason: string };

/** One settings page of the application. Pure data. */
export type SettingsPageEntry = {
  /** Stable identifier, `<area>.<page>`. */
  id: string;
  scope?: SettingsScope;
  /** A page whose scope depends on the mode (scheduled tasks: installation on site, platform in the cloud). */
  scopeByMode?: Record<DeploymentMode, SettingsScope>;
  /** For a `module` page. */
  module?: SettingsModule;
  /**
   * The address the link opens, without the tab: the page's own route, or for a setting without a
   * route of its own (a dialog, a mode of a page) the page that hosts it.
   */
  path: string;
  /** The tab, when it is part of the address: a path segment (`/settings/profile`) or `?tab=`. */
  tab?: { value: string; in: 'path' | 'query' };
  /** The component `App.tsx` renders at `path`. */
  component: string;
  /**
   * The file that holds the page's settings (relative to `frontend/src`), when it is not the file
   * of `component`: a tab, a panel or a dialog of the page.
   */
  source?: string;
  /** i18n key of the page's name (`namespace:key`). */
  labelKey: string;
  /** i18n keys of the menu path before the name, shown in grey. */
  menuKeys: string[];
  /** i18n keys (`namespace:key`) of the page's main settings, 3 to 8, used in its file. The search reads them. */
  settingKeys: string[];
  /** Who may open the page: the strictest of its route, its menu entry and the page itself. */
  open: AccessRule;
  /** Who may change its settings (equal to `open` when opening means changing). */
  change: AccessRule;
  availability: SettingsAvailability;
  doc: SettingsDoc;
};
