import { platformAdmin } from '../accessRule';
import type { SettingsPageEntry } from './types';

const PLATFORM_DOC = { page: null, reason: 'Platform host screen, kept out of the public user manual.' } as const;

const platformPage = (
  id: string,
  segment: string,
  component: string,
  labelKey: string,
  settingKeys: string[],
): SettingsPageEntry => ({
  id,
  scope: 'platform',
  path: `/admin/${segment}`,
  component,
  labelKey,
  menuKeys: [],
  settingKeys,
  open: platformAdmin,
  change: platformAdmin,
  availability: { cloud: ['platform'], onprem: false },
  doc: PLATFORM_DOC,
});

/** The platform administration of the cloud, on the platform host only. */
export const PLATFORM_SETTINGS_PAGES: SettingsPageEntry[] = [
  platformPage('platform.tenants', 'tenants', 'AdminTenantsPage', 'nav:sidebar.platform.tenants', [
    'admin:tenants.columns.status',
    'admin:tenants.actions.freeze',
    'admin:tenants.actions.unfreeze',
    'admin:tenants.actions.savePlan',
    'admin:tenants.actions.markInternal',
  ]),
  platformPage('platform.trials', 'trials', 'AdminTrialsPage', 'nav:sidebar.platform.trials', [
    'admin:trials.call.title',
    'admin:trials.call.date',
    'admin:trials.call.note',
    'admin:trials.call.status',
  ]),
  platformPage('platform.coa-templates', 'coa-templates', 'AdminCoaTemplatesPage', 'nav:sidebar.platform.coaTemplates', [
    'admin:coaTemplates.columns.code',
    'admin:coaTemplates.columns.scope',
    'admin:coaTemplates.columns.version',
    'admin:coaTemplates.columns.loadedByDefault',
  ]),
  platformPage('platform.standard-accounts', 'standard-accounts', 'AdminStandardAccountsPage', 'nav:sidebar.platform.standardAccounts', [
    'admin:standardAccounts.columns.accountNumber',
    'admin:standardAccounts.columns.nature',
    'admin:standardAccounts.columns.consolidationAccountNumber',
    'admin:standardAccounts.actions.importCsv',
  ]),
  platformPage('platform.platform-ai', 'platform-ai', 'AdminPlatformAiPage', 'nav:sidebar.platform.platformAi', [
    'admin:platformAi.cards.provider',
    'admin:platformAi.cards.planLimits',
    'admin:platformAi.fields.apiKey',
    'admin:platformAi.disclosure.title',
  ]),
  platformPage('platform.ops-dashboard', 'ops-dashboard', 'OpsDashboardPage', 'nav:sidebar.platform.opsDashboard', [
    'admin:opsDashboard.cards.requestsPerMinute',
    'admin:opsDashboard.cards.poolUtilization',
    'admin:opsDashboard.cards.loginFailures',
    'admin:opsDashboard.cards.eventLoopP99',
  ]),
];
