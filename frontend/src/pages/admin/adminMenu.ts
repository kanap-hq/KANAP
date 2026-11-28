/**
 * The Administration menu: one line per page, in menu order. The side menu (`Layout`) and the
 * `/admin` address (`AdminDefaultRedirect` in `App.tsx`) read it.
 *
 * Each line names what opens its page. The route guard names the same in
 * `ADMIN_ROUTE_REQUIREMENTS` (`components/ProtectedRoute.tsx`), and `adminMenu.test.ts` compares
 * the two: a change of right is made on both lines. The Installation section has a single guard,
 * `isInstallationOperator`, which covers every address under `/admin/installation/`.
 */

export type AdminLevel = 'reader' | 'contributor' | 'member' | 'admin';

/** A module right. `allData` also refuses a person whose data access is limited. */
export type AdminGrant = { resource: string; level: AdminLevel; allData?: true };

export type AdminRequirement =
  | AdminGrant
  /** The Administrator role (`claims.isGlobalAdmin`). */
  | 'administrator'
  /** The person who runs the installation: `isInstallationOperator`. */
  | 'operator'
  /** The integrations page: the `canShowIntegrations` of the context. */
  | 'integrations'
  /**
   * No right of its own: the pages of the platform host. Their route asks `hasLevel(<segment>,
   * 'reader')`, which only an Administrator or a platform administrator passes.
   */
  | 'none';

/** Where the menu shows: a workspace host of the cloud, the platform host of the cloud, on site. */
export type AdminPlace = 'organization' | 'platform' | 'site';

export type AdminGroup = 'organization' | 'ai' | 'integrations' | 'platform' | 'platformTools' | 'installation';

/** A flag of `/config/public` the page needs; `aiSettings` is the `aiSettingsAvailable` of the context. */
export type AdminFeature = 'billing' | 'sso' | 'sampleData' | 'aiSettings';

/** Named after the MUI icon the menu draws (`ADMIN_MENU_ICONS` in `Layout.tsx`). */
export type AdminMenuIcon =
  | 'People' | 'Security' | 'LockOutlined' | 'History' | 'CreditCard' | 'AdminPanelSettings' | 'Brush'
  | 'Dataset' | 'Storage' | 'AutoAwesome' | 'MonitorHeart' | 'Extension' | 'Apartment'
  | 'HourglassBottom' | 'AccountBalance' | 'Schedule';

export type AdminMenuEntry = {
  group: AdminGroup;
  to: string;
  /** i18n key of the label. */
  label: string;
  icon: AdminMenuIcon;
  requires: AdminRequirement;
  feature?: AdminFeature;
  /** Shown in the cloud only. */
  cloudOnly?: true;
};

/** Where each group shows, and its title: a label key, '' for a plain divider, null for none. */
export const ADMIN_MENU_GROUPS: Record<AdminGroup, { places: readonly AdminPlace[]; title: string | null }> = {
  organization: { places: ['organization', 'site'], title: null },
  ai: { places: ['organization', 'site'], title: 'nav:sidebar.admin.sections.ai' },
  integrations: { places: ['organization', 'site'], title: 'nav:sidebar.admin.sections.integrations' },
  platform: { places: ['platform'], title: null },
  platformTools: { places: ['platform'], title: '' },
  installation: { places: ['site', 'platform'], title: 'nav:sidebar.admin.sections.installation' },
};

/** Every address under it is an installation page, behind `isInstallationOperator`. */
export const INSTALLATION_ROOT = '/admin/installation';

/** Former addresses of installation pages: the same guard, then a redirect to the new one. */
export const LEGACY_INSTALLATION_PATHS: readonly string[] = ['/admin/scheduled-tasks'];

export const ADMIN_MENU: readonly AdminMenuEntry[] = [
  { group: 'organization', to: '/admin/users', label: 'nav:sidebar.admin.users', icon: 'People', requires: { resource: 'users', level: 'admin' } },
  { group: 'organization', to: '/admin/roles', label: 'nav:sidebar.admin.roles', icon: 'Security', requires: { resource: 'users', level: 'admin' } },
  { group: 'organization', to: '/admin/data-access', label: 'nav:sidebar.admin.dataAccess', icon: 'LockOutlined', requires: { resource: 'users', level: 'admin', allData: true } },
  { group: 'organization', to: '/admin/audit-logs', label: 'nav:sidebar.admin.auditLog', icon: 'History', requires: { resource: 'users', level: 'admin' } },
  { group: 'organization', to: '/admin/billing', label: 'nav:sidebar.admin.billing', icon: 'CreditCard', requires: { resource: 'billing', level: 'reader' }, feature: 'billing' },
  { group: 'organization', to: '/admin/auth', label: 'nav:sidebar.admin.authentication', icon: 'AdminPanelSettings', requires: { resource: 'users', level: 'admin' }, feature: 'sso' },
  { group: 'organization', to: '/admin/branding', label: 'nav:sidebar.admin.branding', icon: 'Brush', requires: { resource: 'users', level: 'admin' } },
  { group: 'organization', to: '/admin/sample-data', label: 'nav:sidebar.admin.sampleData', icon: 'Dataset', requires: 'administrator', feature: 'sampleData', cloudOnly: true },
  { group: 'ai', to: '/admin/ai-models', label: 'nav:sidebar.admin.aiModels', icon: 'Storage', requires: { resource: 'ai_settings', level: 'admin' }, feature: 'aiSettings' },
  { group: 'ai', to: '/admin/ai', label: 'nav:sidebar.admin.ai', icon: 'AutoAwesome', requires: { resource: 'ai_settings', level: 'admin' }, feature: 'aiSettings' },
  { group: 'ai', to: '/admin/ai-usage', label: 'nav:sidebar.admin.aiUsage', icon: 'MonitorHeart', requires: { resource: 'ai_settings', level: 'admin' }, feature: 'aiSettings' },
  { group: 'integrations', to: '/admin/integrations', label: 'nav:sidebar.admin.integrations', icon: 'Extension', requires: 'integrations' },
  { group: 'platform', to: '/admin/tenants', label: 'nav:sidebar.platform.tenants', icon: 'Apartment', requires: 'none' },
  { group: 'platform', to: '/admin/trials', label: 'nav:sidebar.platform.trials', icon: 'HourglassBottom', requires: 'none' },
  { group: 'platform', to: '/admin/coa-templates', label: 'nav:sidebar.platform.coaTemplates', icon: 'Storage', requires: 'none' },
  { group: 'platform', to: '/admin/standard-accounts', label: 'nav:sidebar.platform.standardAccounts', icon: 'AccountBalance', requires: 'none' },
  { group: 'platformTools', to: '/admin/platform-ai', label: 'nav:sidebar.platform.platformAi', icon: 'AutoAwesome', requires: 'none' },
  { group: 'platformTools', to: '/admin/ops-dashboard', label: 'nav:sidebar.platform.opsDashboard', icon: 'MonitorHeart', requires: 'none' },
  { group: 'installation', to: '/admin/installation/scheduled-tasks', label: 'nav:sidebar.platform.scheduledTasks', icon: 'Schedule', requires: 'operator' },
];

export type AdminClaims = { isGlobalAdmin?: boolean; isPlatformAdmin?: boolean } | null | undefined;

export type AdminMenuContext = {
  singleTenant: boolean;
  platformHost: boolean;
  claims: AdminClaims;
  hasLevel: (resource: string, level: AdminLevel) => boolean;
  dataAccessLimited: boolean;
  features: { billing: boolean; sso: boolean; sampleData: boolean };
  /** The AI settings are on and available to the person (`surfaces.settings.available`). */
  aiSettingsAvailable: boolean;
  /** An AI settings administrator while they are available, or an infrastructure administrator. */
  canShowIntegrations: boolean;
};

export type InstallationOperatorContext = Pick<AdminMenuContext, 'singleTenant' | 'platformHost' | 'claims' | 'dataAccessLimited'>;

export function adminPlace(ctx: Pick<AdminMenuContext, 'singleTenant' | 'platformHost'>): AdminPlace {
  if (ctx.singleTenant) return 'site';
  return ctx.platformHost ? 'platform' : 'organization';
}

/**
 * The person who runs the installation, as the server's `SystemAdminGuard` and
 * `@ReservedToUnscopedDataAccess()` see them. On site: the Administrator role, with access to all
 * data. In the cloud: a platform administrator on the platform host (`isGlobalAdmin` is not
 * enough there: every Administrator of the platform workspace has it).
 */
export function isInstallationOperator(ctx: InstallationOperatorContext): boolean {
  if (ctx.singleTenant) return !!ctx.claims?.isGlobalAdmin && !ctx.dataAccessLimited;
  return ctx.platformHost && !!ctx.claims?.isPlatformAdmin;
}

/**
 * An address of the Installation section, or a former address of one of its pages. The router
 * matches an address whatever its case and after decoding it (`/admin/%69nstallation`,
 * `/admin/Installation`), so the guard reads it the same way.
 */
export function isInstallationPath(path: string): boolean {
  let read = path;
  try {
    read = decodeURIComponent(path);
  } catch {
    // A malformed escape matches no route either: read the address as it is.
  }
  read = read.toLowerCase();
  return [INSTALLATION_ROOT, ...LEGACY_INSTALLATION_PATHS].some((root) => read === root || read.startsWith(`${root}/`));
}

export function meetsAdminRequirement(requirement: AdminRequirement, ctx: AdminMenuContext): boolean {
  switch (requirement) {
    case 'none': return true;
    case 'administrator': return !!ctx.claims?.isGlobalAdmin;
    case 'operator': return isInstallationOperator(ctx);
    case 'integrations': return ctx.canShowIntegrations;
    default:
      return ctx.hasLevel(requirement.resource, requirement.level) && !(requirement.allData && ctx.dataAccessLimited);
  }
}

function featureOn(feature: AdminFeature | undefined, ctx: AdminMenuContext): boolean {
  if (!feature) return true;
  return feature === 'aiSettings' ? ctx.aiSettingsAvailable : ctx.features[feature];
}

/** The entries of the menu the person may open here, in menu order. */
export function adminMenuEntries(ctx: AdminMenuContext): AdminMenuEntry[] {
  const place = adminPlace(ctx);
  return ADMIN_MENU.filter((entry) => (
    ADMIN_MENU_GROUPS[entry.group].places.includes(place)
    && !(entry.cloudOnly && place === 'site')
    && featureOn(entry.feature, ctx)
    && meetsAdminRequirement(entry.requires, ctx)
  ));
}

/** The first entry the person may open, in menu order (in one group when given); null when none. */
export function firstAdminEntry(ctx: AdminMenuContext, group?: AdminGroup): AdminMenuEntry | null {
  return adminMenuEntries(ctx).find((entry) => !group || entry.group === group) ?? null;
}
