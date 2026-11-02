import type { ComponentType } from 'react';
import type { FeaturesConfig } from '../../../config/FeaturesContext';
import type { SectionId } from '../sections';

/** A runtime feature flag of `GET /config/public`. */
export type Features = FeaturesConfig['features'];

export type PermissionLevel = 'reader' | 'contributor' | 'member' | 'admin';

export interface ConfigFieldSchema {
  type: 'number' | 'boolean' | 'select';
  /** i18n key (common namespace) for the option label. */
  labelKey: string;
  min?: number;
  max?: number;
  options?: string[];
  /** i18n key prefix (common namespace) for select option labels, e.g. `dashboard.tiles.scope`. */
  optionLabelKey?: string;
}

export interface TileDefinition {
  component: ComponentType<{ config: Record<string, unknown> }>;
  /** English fallback; the UI shows `titleKey`. */
  title: string;
  /** i18n key (common namespace) for the tile name without parameters. */
  titleKey: string;
  icon: string;
  defaultConfig: Record<string, unknown>;
  configSchema: Record<string, ConfigFieldSchema>;
  requiredPermissions?: Array<{
    resource: string;
    level: PermissionLevel;
  }>;
  /** The tile exists only while this feature flag is on (absent from the dashboard and its settings otherwise). */
  requiredFeature?: keyof Features;
  /** The home page section that holds the tile. */
  section: SectionId;
}

// Lazy load tile components to avoid circular imports
// They will be imported dynamically
const LazyMyTasksTile = () => import('./MyTasksTile').then((m) => m.default);
const LazyProjectsILeadTile = () => import('./ProjectsILeadTile').then((m) => m.default);
const LazyProjectsIContributeTile = () => import('./ProjectsIContributeTile').then((m) => m.default);
const LazyRecentlyViewedTile = () => import('./RecentlyViewedTile').then((m) => m.default);
const LazyMyTimeLastWeekTile = () => import('./MyTimeLastWeekTile').then((m) => m.default);
const LazyNewRequestsTile = () => import('./NewRequestsTile').then((m) => m.default);
const LazyTeamActivityTile = () => import('./TeamActivityTile').then((m) => m.default);
const LazyGlobalStatusChangesTile = () => import('./GlobalStatusChangesTile').then((m) => m.default);
const LazyStaleTasksTile = () => import('./StaleTasksTile').then((m) => m.default);
const LazyKnowledgeOverviewTile = () => import('./KnowledgeOverviewTile').then((m) => m.default);
const LazyApplicationComplianceTile = () => import('./ApplicationComplianceTile').then((m) => m.default);
const LazyNetboxSyncTile = () => import('./NetboxSyncTile').then((m) => m.default);
const LazyVulnerabilitiesTile = () => import('./VulnerabilitiesTile').then((m) => m.default);

// We'll use a placeholder component initially, then replace with lazy-loaded ones
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Placeholder: ComponentType<any> = () => null;

export const TILE_REGISTRY: Record<string, TileDefinition> = {
  'my-tasks': {
    section: 'work',
    component: Placeholder, // Will be replaced
    title: 'My Tasks',
    titleKey: 'dashboard.myTasks',
    icon: 'Task',
    defaultConfig: { limit: 5, showOverdue: true },
    configSchema: {
      limit: { type: 'number', labelKey: 'dashboard.settings.options.limit', min: 3, max: 10 },
      showOverdue: { type: 'boolean', labelKey: 'dashboard.settings.options.showOverdue' },
    },
    requiredPermissions: [{ resource: 'tasks', level: 'reader' }],
  },
  'projects-i-lead': {
    section: 'portfolio',
    component: Placeholder,
    title: 'Projects I Lead',
    titleKey: 'dashboard.tiles.projectsILead',
    icon: 'Leaderboard',
    defaultConfig: { limit: 5 },
    configSchema: {
      limit: { type: 'number', labelKey: 'dashboard.settings.options.limit', min: 3, max: 10 },
    },
    requiredPermissions: [{ resource: 'portfolio_projects', level: 'reader' }],
  },
  'projects-i-contribute': {
    section: 'portfolio',
    component: Placeholder,
    title: 'Projects I Contribute To',
    titleKey: 'dashboard.tiles.projectsIContribute',
    icon: 'Groups',
    defaultConfig: { limit: 5 },
    configSchema: {
      limit: { type: 'number', labelKey: 'dashboard.settings.options.limit', min: 3, max: 10 },
    },
    requiredPermissions: [{ resource: 'portfolio_projects', level: 'reader' }],
  },
  'recently-viewed': {
    section: 'work',
    component: Placeholder,
    title: 'Recently Viewed',
    titleKey: 'dashboard.tiles.recentlyViewed',
    icon: 'History',
    defaultConfig: { limit: 5 },
    configSchema: {
      limit: { type: 'number', labelKey: 'dashboard.settings.options.limit', min: 1, max: 10 },
    },
    // No requiredPermissions - always visible
  },
  'my-time-last-week': {
    section: 'work',
    component: Placeholder,
    title: 'My Time Last Week',
    titleKey: 'dashboard.tiles.myTimeTitle',
    icon: 'AccessTime',
    defaultConfig: { days: 7 },
    configSchema: {
      days: { type: 'number', labelKey: 'dashboard.settings.options.days', min: 7, max: 30 },
    },
    requiredPermissions: [{ resource: 'portfolio_projects', level: 'reader' }],
  },
  'new-requests': {
    section: 'portfolio',
    component: Placeholder,
    title: 'New Requests',
    titleKey: 'dashboard.tiles.newRequestsTitle',
    icon: 'Inbox',
    defaultConfig: { limit: 5, days: 7 },
    configSchema: {
      limit: { type: 'number', labelKey: 'dashboard.settings.options.limit', min: 3, max: 10 },
      days: { type: 'number', labelKey: 'dashboard.settings.options.days', min: 1, max: 30 },
    },
    requiredPermissions: [{ resource: 'portfolio_requests', level: 'reader' }],
  },
  'knowledge-overview': {
    section: 'work',
    component: Placeholder,
    title: 'Knowledge',
    titleKey: 'dashboard.tiles.knowledge',
    icon: 'Description',
    defaultConfig: {},
    configSchema: {},
    requiredPermissions: [{ resource: 'knowledge', level: 'reader' }],
  },
  'application-compliance': {
    section: 'landscape',
    component: Placeholder,
    title: 'Compliance',
    titleKey: 'dashboard.tiles.compliance',
    icon: 'VerifiedUser',
    defaultConfig: {},
    configSchema: {},
    requiredPermissions: [{ resource: 'applications', level: 'reader' }],
  },
  'netbox-sync': {
    section: 'landscape',
    component: Placeholder,
    title: 'Netbox synchronisation',
    titleKey: 'dashboard.tiles.netboxSync',
    icon: 'Dns',
    defaultConfig: {},
    configSchema: {},
    requiredPermissions: [{ resource: 'infrastructure', level: 'admin' }],
  },
  vulnerabilities: {
    section: 'landscape',
    component: Placeholder,
    title: 'Vulnerabilities in your estate',
    titleKey: 'dashboard.tiles.vulnerabilities',
    icon: 'GppMaybe',
    defaultConfig: {},
    configSchema: {},
    requiredPermissions: [{ resource: 'infrastructure', level: 'reader' }],
    requiredFeature: 'vulnerabilityFeed',
  },
  // Phase 2 tiles
  'team-activity': {
    section: 'portfolio',
    component: Placeholder,
    title: 'Team Activity',
    titleKey: 'dashboard.tiles.teamActivity',
    icon: 'Update',
    defaultConfig: { limit: 5, days: 7 },
    configSchema: {
      limit: { type: 'number', labelKey: 'dashboard.settings.options.limit', min: 1, max: 10 },
      days: { type: 'number', labelKey: 'dashboard.settings.options.days', min: 1, max: 30 },
    },
    requiredPermissions: [{ resource: 'portfolio_projects', level: 'reader' }],
  },
  'global-status-changes': {
    section: 'portfolio',
    component: Placeholder,
    title: 'Project Status Changes',
    titleKey: 'dashboard.tiles.statusChangesTitle',
    icon: 'SwapHoriz',
    defaultConfig: { days: 5 },
    configSchema: {
      days: { type: 'number', labelKey: 'dashboard.settings.options.days', min: 1, max: 14 },
    },
    requiredPermissions: [{ resource: 'portfolio_projects', level: 'reader' }],
  },
  'stale-tasks': {
    section: 'work',
    component: Placeholder,
    title: 'Stale Tasks',
    titleKey: 'dashboard.tiles.staleTasks',
    icon: 'Warning',
    defaultConfig: { scope: 'my', thresholdDays: 90 },
    configSchema: {
      scope: { type: 'select', labelKey: 'dashboard.settings.options.scope', options: ['my', 'team', 'all'], optionLabelKey: 'dashboard.tiles.scope' },
      thresholdDays: { type: 'number', labelKey: 'dashboard.settings.options.thresholdDays', min: 30, max: 365 },
    },
    requiredPermissions: [{ resource: 'tasks', level: 'reader' }],
  },
};

// Export lazy loaders for use in the dashboard page
export const TILE_LOADERS = {
  'my-tasks': LazyMyTasksTile,
  'projects-i-lead': LazyProjectsILeadTile,
  'projects-i-contribute': LazyProjectsIContributeTile,
  'recently-viewed': LazyRecentlyViewedTile,
  'my-time-last-week': LazyMyTimeLastWeekTile,
  'new-requests': LazyNewRequestsTile,
  'knowledge-overview': LazyKnowledgeOverviewTile,
  'application-compliance': LazyApplicationComplianceTile,
  'netbox-sync': LazyNetboxSyncTile,
  vulnerabilities: LazyVulnerabilitiesTile,
  'team-activity': LazyTeamActivityTile,
  'global-status-changes': LazyGlobalStatusChangesTile,
  'stale-tasks': LazyStaleTasksTile,
};
