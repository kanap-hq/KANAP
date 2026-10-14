import { Box, Tab, Tabs } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import ProfileTab from './ProfileTab';
import NotificationsTab from './NotificationsTab';
import AppearanceTab from './AppearanceTab';
import ConnectedAppsTab from './ConnectedAppsTab';
import AboutTab from './AboutTab';

type TabSlug = 'profile' | 'notifications' | 'appearance' | 'connected-apps' | 'about';

const tabLabelKeys: Record<TabSlug, string> = {
  profile: 'tabs.profile',
  notifications: 'tabs.notifications',
  appearance: 'tabs.appearance',
  'connected-apps': 'tabs.connectedApps',
  about: 'tabs.about',
};

export default function SettingsPage() {
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation('settings');
  const { config } = useFeatures();
  const { hasLevel } = useAuth();
  // Connected applications use the MCP server: shown when the instance offers it and the user may use it.
  const showConnectedApps = config.features.aiMcp && hasLevel('ai_mcp', 'reader');
  const tabSlugs: TabSlug[] = [
    'profile',
    'notifications',
    'appearance',
    ...(showConnectedApps ? (['connected-apps'] as const) : []),
    'about',
  ];
  const activeSlug: TabSlug = tabSlugs.includes(tab as TabSlug) ? (tab as TabSlug) : 'profile';

  const handleTabChange = (_: unknown, index: number) => {
    navigate(`/settings/${tabSlugs[index]}`, { replace: true });
  };

  return (
    <>
      <PageHeader title={t('pageTitle')} />

      <Box sx={{ p: 3, maxWidth: 900 }}>
        <Tabs value={tabSlugs.indexOf(activeSlug)} onChange={handleTabChange} sx={{ mb: 3 }}>
          {tabSlugs.map((slug) => (
            <Tab key={slug} label={t(tabLabelKeys[slug])} />
          ))}
        </Tabs>

        {activeSlug === 'profile' && <ProfileTab />}
        {activeSlug === 'notifications' && <NotificationsTab />}
        {activeSlug === 'appearance' && <AppearanceTab />}
        {activeSlug === 'connected-apps' && <ConnectedAppsTab />}
        {activeSlug === 'about' && <AboutTab />}
      </Box>
    </>
  );
}
