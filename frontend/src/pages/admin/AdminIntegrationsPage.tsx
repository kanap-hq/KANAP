import { Stack } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { SettingsPage } from '../../components/settings';
import GlpiIntegrationCard from '../../components/admin/GlpiIntegrationCard';
import MonitoringIntegrationCard from '../../components/admin/MonitoringIntegrationCard';
import NetboxIntegrationCard from '../../components/admin/NetboxIntegrationCard';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import { useAiCapabilities } from '../../ai/useAiCapabilities';

/** The connections to external systems, one card each: GLPI and PRTG with the AI settings, Netbox with the infrastructure. */
export default function AdminIntegrationsPage() {
  const { t } = useTranslation(['admin']);
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const aiCapabilities = useAiCapabilities();
  // Same condition the route used to enforce for the whole page; it now only
  // decides whether the AI-backed connectors (GLPI, PRTG) are shown.
  const aiSettingsAvailable = config.features.aiSettings
    && aiCapabilities.data?.surfaces.settings.available === true;
  const canManageNetbox = hasLevel('infrastructure', 'admin');

  return (
    <SettingsPage title={t('aiAdmin.sections.integrations')} history={undefined}>
      <Stack spacing={2}>
        {aiSettingsAvailable ? <GlpiIntegrationCard /> : null}
        {aiSettingsAvailable ? <MonitoringIntegrationCard /> : null}
        {canManageNetbox ? <NetboxIntegrationCard /> : null}
      </Stack>
    </SettingsPage>
  );
}
