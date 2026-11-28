import React from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { SettingsPage } from '../../components/settings';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import WorkspaceTabs from '../portfolio/workspace/WorkspaceTabs';
import { NetboxSyncPanel } from './NetboxSyncPage';
import ItSettingsLists from './settings/ItSettingsLists';

const LISTS_TAB = 'lists';
const NETBOX_TAB = 'netbox';
const SETTINGS_PATH = '/it/settings';

/** The tab named by the address: `/it/settings/<tab>`, or the former `?tab=` of the page. */
function requestedTab(pathname: string, search: string): string | null {
  const segment = /^\/it\/settings\/([^/]+)/.exec(pathname)?.[1];
  return segment ?? new URLSearchParams(search).get('tab');
}

/**
 * IT settings: the reusable lists, and the Netbox synchronisation. Each tab is shown only to
 * someone who may open it; the tab is in the path (`/it/settings/lists`, `/it/settings/netbox`).
 * An address without a tab, with a tab the person cannot open or with the former `?tab=` is
 * replaced by the tab on screen, its other parameters kept (Netbox keeps its record filter there).
 */
export default function ItOperationsSettingsPage() {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canLists = hasLevel('settings', 'reader');
  const canNetbox = hasLevel('infrastructure', 'admin');
  const tabs = [
    ...(canLists ? [{ key: LISTS_TAB, label: t('pages.settings.tabs.lists') }] : []),
    ...(canNetbox ? [{ key: NETBOX_TAB, label: t('pages.settings.tabs.netbox') }] : []),
  ];
  const requested = requestedTab(location.pathname, location.search);
  const active = tabs.some((tab) => tab.key === requested) ? requested! : (tabs[0]?.key ?? '');

  // The help button reads the address: it always names the tab on screen.
  React.useEffect(() => {
    if (!active) return;
    const params = new URLSearchParams(location.search);
    const legacy = params.has('tab');
    params.delete('tab');
    if (location.pathname === `${SETTINGS_PATH}/${active}` && !legacy) return;
    const search = params.toString();
    navigate({ pathname: `${SETTINGS_PATH}/${active}`, search: search ? `?${search}` : '' }, { replace: true });
  }, [active, location.pathname, location.search, navigate]);

  const changeTab = (next: string) => {
    navigate({ pathname: `${SETTINGS_PATH}/${next}`, search: location.search }, { replace: true });
  };

  if (!active) return <ForbiddenPage />;

  const tabRow = <WorkspaceTabs tabs={tabs} activeTab={active} onTabChange={changeTab} ariaLabel={t('pages.settings.title')} />;
  const netbox = active === NETBOX_TAB ? <NetboxSyncPanel /> : null;
  if (!canLists) return <SettingsPage title={t('pages.settings.title')} tabs={tabRow}>{netbox}</SettingsPage>;
  return <ItSettingsLists title={t('pages.settings.title')} tabs={tabRow} listsShown={active === LISTS_TAB} netbox={netbox} />;
}
