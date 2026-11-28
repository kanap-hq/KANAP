import { administrator, byMode, platformAdmin } from '../accessRule';
import type { SettingsPageEntry } from './types';

/**
 * Settings of the installation. On site, the operator (Administrator role) sets them on the
 * organisation host; in the cloud, the platform administrator on the platform host.
 */
export const INSTALLATION_SETTINGS_PAGES: SettingsPageEntry[] = [
  {
    id: 'ops.scheduled-tasks',
    scopeByMode: { onprem: 'installation', cloud: 'platform' },
    path: '/admin/scheduled-tasks',
    component: 'ScheduledTasksPage',
    labelKey: 'nav:sidebar.platform.scheduledTasks',
    menuKeys: ['nav:workspaces.admin'],
    settingKeys: [
      'admin:scheduledTasks.columns.schedule',
      'admin:scheduledTasks.columns.enabled',
      'admin:scheduledTasks.columns.lastRun',
      'admin:scheduledTasks.actions.runNow',
    ],
    open: byMode({ onprem: administrator, cloud: platformAdmin }),
    change: byMode({ onprem: administrator, cloud: platformAdmin }),
    availability: { cloud: ['platform'], onprem: ['organization'] },
    doc: { page: 'scheduled-tasks' },
  },
];
