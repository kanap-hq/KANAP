import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import InfoHint from '../../components/workspace/InfoHint';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import MonitoringIntegrationCard from '../../components/admin/MonitoringIntegrationCard';
import NetboxIntegrationCard from '../../components/admin/NetboxIntegrationCard';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import { useAiCapabilities } from '../../ai/useAiCapabilities';
import {
  aiAdminApi,
  type AiGlpiTestResult,
  type AiSettingsPayload,
} from '../../ai/aiApi';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { glpiAddressRoot, isNewSecretAddress } from '../../utils/secretAddress';

type IntegrationsForm = {
  glpi_enabled: boolean;
  glpi_url: string;
  glpi_user_token: string;
  glpi_app_token: string;
};

const EMPTY_FORM: IntegrationsForm = {
  glpi_enabled: false,
  glpi_url: '',
  glpi_user_token: '',
  glpi_app_token: '',
};

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function buildForm(settings: AiSettingsPayload['settings']): IntegrationsForm {
  return {
    glpi_enabled: settings.glpi_enabled,
    glpi_url: settings.glpi_url || '',
    glpi_user_token: '',
    glpi_app_token: '',
  };
}

function buildUpdatePayload(
  form: IntegrationsForm,
  settings: AiSettingsPayload['settings'],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (form.glpi_enabled !== settings.glpi_enabled) {
    payload.glpi_enabled = form.glpi_enabled;
  }

  const glpiUrl = normalizeNullableString(form.glpi_url);
  // A typed token goes with the address on screen: the server binds it to that address.
  const tokenTyped = !!form.glpi_user_token.trim() || !!form.glpi_app_token.trim();
  if (glpiUrl !== settings.glpi_url || tokenTyped) {
    payload.glpi_url = glpiUrl;
  }

  if (form.glpi_user_token.trim()) {
    payload.glpi_user_token = form.glpi_user_token.trim();
  }

  if (form.glpi_app_token.trim()) {
    payload.glpi_app_token = form.glpi_app_token.trim();
  }

  return payload;
}

function buildGlpiTestPayload(form: IntegrationsForm): Record<string, unknown> {
  return {
    glpi_url: normalizeNullableString(form.glpi_url),
    ...(form.glpi_user_token.trim() ? { glpi_user_token: form.glpi_user_token.trim() } : {}),
    ...(form.glpi_app_token.trim() ? { glpi_app_token: form.glpi_app_token.trim() } : {}),
  };
}

function glpiSecretHelperText(
  hasStoredSecret: boolean | undefined,
  keepExistingKey: string,
  settings: AiSettingsPayload['settings'] | undefined,
  t: (key: string) => string,
): string | undefined {
  const messages: string[] = [];
  if (hasStoredSecret) {
    messages.push(t(keepExistingKey));
  }
  if (settings && !settings.provider_secret_writable) {
    messages.push(t('aiAdmin.provider.apiKey.storageUnavailable'));
  }
  return messages.length > 0 ? messages.join(' ') : undefined;
}

export default function AdminIntegrationsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const queryClient = useQueryClient();
  const { hasLevel } = useAuth();
  const { config } = useFeatures();
  const aiCapabilities = useAiCapabilities();
  // Same condition the route used to enforce for the whole page; it now only
  // decides whether the AI-backed connectors (GLPI, PRTG) are shown.
  const aiSettingsAvailable = config.features.aiSettings
    && aiCapabilities.data?.surfaces.settings.available === true;
  const canManageNetbox = hasLevel('infrastructure', 'admin');

  const [form, setForm] = React.useState<IntegrationsForm>(EMPTY_FORM);
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [glpiTestResult, setGlpiTestResult] = React.useState<AiGlpiTestResult | null>(null);

  const settingsQuery = useQuery<AiSettingsPayload>({
    queryKey: ['admin-ai-settings'],
    queryFn: () => aiAdminApi.getSettings(),
    enabled: aiSettingsAvailable,
  });

  React.useEffect(() => {
    if (settingsQuery.data?.settings) {
      setForm(buildForm(settingsQuery.data.settings));
    }
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: async (data: IntegrationsForm) => {
      if (!settingsQuery.data) {
        throw new Error('Settings are not loaded.');
      }
      const payload = buildUpdatePayload(data, settingsQuery.data.settings);
      return aiAdminApi.updateSettings(payload);
    },
    onMutate: () => {
      setSaveSuccess(false);
      setSaveError(null);
    },
    onSuccess: async (data) => {
      setSaveSuccess(true);
      setForm(buildForm(data.settings));
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
    },
    onError: (error: any) => {
      setSaveError(getApiErrorMessage(error, t, t('aiAdmin.messages.saveFailed')));
    },
  });

  const testGlpiMutation = useMutation({
    mutationFn: async (data: IntegrationsForm) => aiAdminApi.testGlpi(buildGlpiTestPayload(data)),
    onMutate: () => {
      setGlpiTestResult(null);
    },
    onSuccess: (result) => {
      setGlpiTestResult(result);
    },
    onError: (error: any) => {
      setGlpiTestResult({
        ok: false,
        message: getApiErrorMessage(error, t, t('aiAdmin.glpi.messages.testFailed')),
        latency_ms: null,
      });
    },
  });

  const currentSettings = settingsQuery.data?.settings;
  // The saved tokens only go to the saved address: a new one empties them on save.
  const glpiAddressChanged = !!currentSettings
    && isNewSecretAddress(glpiAddressRoot(form.glpi_url), glpiAddressRoot(currentSettings.glpi_url));
  const hasUserToken = !!currentSettings?.has_glpi_user_token && !glpiAddressChanged;
  const hasAppToken = !!currentSettings?.has_glpi_app_token && !glpiAddressChanged;
  const userTokenRequired = glpiAddressChanged && !!currentSettings?.has_glpi_user_token;
  const userTokenMissing = userTokenRequired && !form.glpi_user_token.trim();

  return (
    <>
      <PageHeader title={t('aiAdmin.sections.integrations')} />
      <Stack spacing={2} maxWidth={760}>
        {aiSettingsAvailable ? (
          <Card>
            <CardContent>
              {settingsQuery.isLoading ? (
                <Box display="flex" justifyContent="center" py={4}>
                  <CircularProgress size={28} />
                </Box>
              ) : settingsQuery.isError ? (
                <Alert severity="error">
                  {getApiErrorMessage(settingsQuery.error, t, t('aiAdmin.messages.loadSettingsFailed'))}
                </Alert>
              ) : settingsQuery.data ? (
                <Stack spacing={2.5}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="h6">{t('aiAdmin.glpi.title')}</Typography>
                    <InfoHint text={`${t('aiAdmin.glpi.description')} ${t('aiAdmin.glpi.tooltips.plaidRequired')}`} />
                  </Stack>

                  <FormControlLabel
                    control={(
                      <Switch
                        checked={form.glpi_enabled}
                        onChange={(event) => setForm((prev) => ({ ...prev, glpi_enabled: event.target.checked }))}
                      />
                    )}
                    label={t('aiAdmin.glpi.fields.enabled')}
                  />

                  <TextField
                    size="small"
                    label={t('aiAdmin.glpi.fields.url')}
                    value={form.glpi_url}
                    onChange={(event) => setForm((prev) => ({ ...prev, glpi_url: event.target.value }))}
                    placeholder={t('aiAdmin.glpi.placeholders.url')}
                  />

                  <TextField
                    size="small"
                    label={t('aiAdmin.glpi.fields.userToken')}
                    type="password"
                    required={userTokenRequired}
                    value={form.glpi_user_token}
                    onChange={(event) => setForm((prev) => ({ ...prev, glpi_user_token: event.target.value }))}
                    placeholder={
                      hasUserToken
                        ? t('aiAdmin.glpi.placeholders.userTokenConfigured')
                        : t('aiAdmin.glpi.placeholders.enterUserToken')
                    }
                    helperText={userTokenRequired
                      ? t('integrations.secretAddressChanged')
                      : glpiSecretHelperText(
                        hasUserToken,
                        'aiAdmin.glpi.tokenHint.userTokenExisting',
                        currentSettings,
                        t,
                      )}
                  />

                  <TextField
                    size="small"
                    label={t('aiAdmin.glpi.fields.appToken')}
                    type="password"
                    value={form.glpi_app_token}
                    onChange={(event) => setForm((prev) => ({ ...prev, glpi_app_token: event.target.value }))}
                    placeholder={
                      hasAppToken
                        ? t('aiAdmin.glpi.placeholders.appTokenConfigured')
                        : t('aiAdmin.glpi.placeholders.enterAppToken')
                    }
                    helperText={glpiAddressChanged && currentSettings?.has_glpi_app_token
                      ? t('integrations.secretAddressChanged')
                      : glpiSecretHelperText(
                        hasAppToken,
                        'aiAdmin.glpi.tokenHint.appTokenExisting',
                        currentSettings,
                        t,
                      )}
                  />

                  {glpiTestResult ? (
                    <Alert
                      severity={glpiTestResult.ok ? 'success' : 'error'}
                      onClose={() => setGlpiTestResult(null)}
                    >
                      {glpiTestResult.message}
                      {glpiTestResult.latency_ms != null ? ` (${glpiTestResult.latency_ms}ms)` : ''}
                    </Alert>
                  ) : null}

                  {saveSuccess ? <Alert severity="success">{t('aiAdmin.messages.settingsSaved')}</Alert> : null}
                  {saveError ? <Alert severity="error">{saveError}</Alert> : null}

                  <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                    <Button
                      variant="contained"
                      onClick={() => saveMutation.mutate(form)}
                      disabled={saveMutation.isPending || (userTokenMissing && form.glpi_enabled)}
                    >
                      {saveMutation.isPending ? t('common:status.saving') : t('aiAdmin.actions.saveSettings')}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => testGlpiMutation.mutate(form)}
                      disabled={testGlpiMutation.isPending || userTokenMissing}
                    >
                      {testGlpiMutation.isPending ? t('aiAdmin.actions.testing') : t('aiAdmin.actions.testConnection')}
                    </Button>
                  </Stack>
                </Stack>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {aiSettingsAvailable ? <MonitoringIntegrationCard /> : null}

        {canManageNetbox ? <NetboxIntegrationCard /> : null}
      </Stack>
    </>
  );
}
