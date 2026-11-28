import { useState, type ComponentType } from 'react';
import { Box, Tab, Tabs } from '@mui/material';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';
import ClassificationTab from './settings/ClassificationTab';
import EmploymentTypesTab from './settings/EmploymentTypesTab';
import PhaseTemplatesTab from './settings/PhaseTemplatesTab';
import ScoringTab from './settings/ScoringTab';
import SkillsTab from './settings/SkillsTab';
import { TabActionsProvider, TabActionsSlot } from './settings/TabActions';
import TeamsTab from './settings/TeamsTab';
import {
  DEFAULT_SETTINGS_TAB, SETTINGS_TABS, isSettingsTabSlug, settingsTabPath, type SettingsTabSlug,
} from './settings/tabs';
import type { SettingsTabProps } from './settings/types';

const TAB_CONTENT: Record<SettingsTabSlug, ComponentType<SettingsTabProps>> = {
  criteria: ScoringTab,
  skills: SkillsTab,
  'phase-templates': PhaseTemplatesTab,
  classification: ClassificationTab,
  teams: TeamsTab,
  'contract-types': EmploymentTypesTab,
};

/**
 * The portfolio settings page: one tab per list, the open tab in the address
 * (`/portfolio/settings/<slug>`). Only the open tab is mounted: it loads its own lists and puts
 * its buttons in the title row.
 */
export default function SettingsPage() {
  const { hasLevel } = useAuth();
  const { t } = useTranslation(['portfolio', 'common']);
  const { tab } = useParams<{ tab: string }>();
  const navigate = useNavigate();
  const canEdit = hasLevel('portfolio_settings', 'admin');
  const [actionsSlot, setActionsSlot] = useState<HTMLElement | null>(null);

  if (!isSettingsTabSlug(tab)) return <Navigate to={settingsTabPath(DEFAULT_SETTINGS_TAB)} replace />;

  const ActiveTab = TAB_CONTENT[tab];

  return (
    <>
      <PageHeader title={t('settings.title')} actions={<TabActionsSlot ref={setActionsSlot} />} />

      <Box sx={{ p: 3, maxWidth: 1200 }}>
        <Tabs
          value={SETTINGS_TABS.findIndex((entry) => entry.slug === tab)}
          onChange={(_, index: number) => navigate(settingsTabPath(SETTINGS_TABS[index].slug), { replace: true })}
          sx={{ mb: 3 }}
        >
          {SETTINGS_TABS.map((entry) => (
            <Tab key={entry.slug} label={t(entry.labelKey)} />
          ))}
        </Tabs>

        <TabActionsProvider value={actionsSlot}>
          <ActiveTab key={tab} canEdit={canEdit} />
        </TabActionsProvider>
      </Box>
    </>
  );
}
