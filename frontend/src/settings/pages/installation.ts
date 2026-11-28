import { administrator, allOf, byMode, fullDataAccess, platformAdmin } from '../accessRule';
import type { SettingsPageEntry } from './types';

/**
 * Settings of the installation, in the Installation section of the Administration menu. On site,
 * the Administrator role with access to all data sets them on the organisation host; in the cloud,
 * the platform administrator on the platform host (`isInstallationOperator`, `pages/admin/adminMenu.ts`).
 */
const installationOperator = byMode({ onprem: allOf(administrator, fullDataAccess), cloud: platformAdmin });

export const INSTALLATION_SETTINGS_PAGES: SettingsPageEntry[] = [
  {
    id: 'ops.scheduled-tasks',
    scope: 'installation',
    path: '/admin/installation/scheduled-tasks',
    component: 'ScheduledTasksPage',
    labelKey: 'nav:sidebar.platform.scheduledTasks',
    menuKeys: ['nav:workspaces.admin', 'nav:sidebar.admin.sections.installation'],
    settingKeys: [
      'admin:scheduledTasks.columns.schedule',
      'admin:scheduledTasks.columns.enabled',
      'admin:scheduledTasks.columns.lastRun',
      'admin:scheduledTasks.actions.runNow',
    ],
    open: installationOperator,
    change: installationOperator,
    availability: { cloud: ['platform'], onprem: ['organization'] },
    doc: { page: 'scheduled-tasks' },
  },
];
