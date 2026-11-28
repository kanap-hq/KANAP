import React from 'react';
import { TextField } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { aiAdminApi, type AiSettingsPayload } from '../../ai/aiApi';
import { useKanapDialogs } from '../design';
import {
  ConnectionCard,
  ConnectionNotice,
  ConnectionSecretField,
  ConnectionSwitchField,
  SettingField,
  connectionTestCause,
  connectionValueMissing,
  type ConnectionTest,
} from '../settings';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { glpiAddressRoot, isNewSecretAddress } from '../../utils/secretAddress';

type GlpiForm = {
  glpi_enabled: boolean;
  glpi_url: string;
  glpi_user_token: string;
  glpi_app_token: string;
};

type Settings = AiSettingsPayload['settings'];

const EMPTY_FORM: GlpiForm = { glpi_enabled: false, glpi_url: '', glpi_user_token: '', glpi_app_token: '' };

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function buildForm(settings: Settings): GlpiForm {
  return { glpi_enabled: settings.glpi_enabled, glpi_url: settings.glpi_url || '', glpi_user_token: '', glpi_app_token: '' };
}

/** Only what changed is sent; a typed token goes with the address on screen, which the server binds it to. */
export function buildGlpiUpdatePayload(form: GlpiForm, settings: Settings): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (form.glpi_enabled !== settings.glpi_enabled) payload.glpi_enabled = form.glpi_enabled;
  const glpiUrl = normalizeNullableString(form.glpi_url);
  const tokenTyped = !!form.glpi_user_token.trim() || !!form.glpi_app_token.trim();
  if (glpiUrl !== settings.glpi_url || tokenTyped) payload.glpi_url = glpiUrl;
  if (form.glpi_user_token.trim()) payload.glpi_user_token = form.glpi_user_token.trim();
  if (form.glpi_app_token.trim()) payload.glpi_app_token = form.glpi_app_token.trim();
  return payload;
}

function buildTestPayload(form: GlpiForm): Record<string, unknown> {
  return {
    glpi_url: normalizeNullableString(form.glpi_url),
    ...(form.glpi_user_token.trim() ? { glpi_user_token: form.glpi_user_token.trim() } : {}),
    ...(form.glpi_app_token.trim() ? { glpi_app_token: form.glpi_app_token.trim() } : {}),
  };
}

/** The GLPI connection, read by the assistant to import tickets as tasks. */
export default function GlpiIntegrationCard() {
  const { t } = useTranslation(['admin', 'common', 'errors']);
  const queryClient = useQueryClient();
  const dialogs = useKanapDialogs();

  const [form, setForm] = React.useState<GlpiForm>(EMPTY_FORM);
  const [notice, setNotice] = React.useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [sessionTest, setSessionTest] = React.useState<ConnectionTest | null>(null);
  const [saveCount, setSaveCount] = React.useState(0);

  const settingsQuery = useQuery<AiSettingsPayload>({
    queryKey: ['admin-ai-settings'],
    queryFn: () => aiAdminApi.getSettings(),
  });
  const settings = settingsQuery.data?.settings;

  React.useEffect(() => {
    if (settings) setForm(buildForm(settings));
  }, [settings]);

  const editForm = (patch: Partial<GlpiForm>) => {
    setNotice(null);
    setSessionTest(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const saveMutation = useMutation({
    mutationFn: async (data: GlpiForm) => {
      if (!settings) throw new Error('Settings are not loaded.');
      return aiAdminApi.updateSettings(buildGlpiUpdatePayload(data, settings));
    },
    onMutate: () => setNotice(null),
    onSuccess: async (data) => {
      setNotice({ tone: 'success', text: t('aiAdmin.messages.settingsSaved') });
      setForm(buildForm(data.settings));
      setSaveCount((count) => count + 1);
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
    },
    onError: (error: unknown) => {
      setNotice({ tone: 'error', text: getApiErrorMessage(error, t, t('aiAdmin.messages.saveFailed')) });
    },
  });

  // A test as the status line says it, run now or kept on the saved values: the response time,
  // or the cause from its code (a kept test has no message).
  const describeTest = (result: { ok: boolean; tested_at?: string; code?: string; message?: string; latency_ms?: number | null }): ConnectionTest => ({
    ok: result.ok,
    tested_at: result.tested_at || new Date().toISOString(),
    ...(result.ok
      ? (result.latency_ms != null ? { detail: t('integrations.latency', { ms: result.latency_ms }) } : {})
      : { cause: connectionTestCause(t, result.code, result.message, t('aiAdmin.glpi.messages.testFailed')) }),
  });

  const testMutation = useMutation({
    mutationFn: async (data: GlpiForm) => aiAdminApi.testGlpi(buildTestPayload(data)),
    onMutate: () => {
      setNotice(null);
      setSessionTest(null);
    },
    onSuccess: (result) => {
      setSessionTest(describeTest(result));
    },
    onError: (error: unknown) => {
      setSessionTest({
        ok: false,
        tested_at: new Date().toISOString(),
        cause: getApiErrorMessage(error, t, t('aiAdmin.glpi.messages.testFailed')),
      });
    },
  });

  const dirty = !!settings && Object.keys(buildGlpiUpdatePayload(form, settings)).length > 0;
  // An emptied address removes the saved connection (address and tokens) on save.
  const removing = !!settings?.glpi_url && !form.glpi_url.trim();
  // The saved tokens only go to the saved address: a new one empties them on save.
  const addressChanged = !!settings && !removing
    && isNewSecretAddress(glpiAddressRoot(form.glpi_url), glpiAddressRoot(settings.glpi_url));
  const userTokenMissing = addressChanged && !!settings?.has_glpi_user_token && !form.glpi_user_token.trim();
  // The user token is required; the application token is not.
  const testValueMissing = connectionValueMissing(form.glpi_url, {
    stored: !!settings?.has_glpi_user_token,
    typed: form.glpi_user_token,
    addressChanged,
  });

  const handleSave = async () => {
    if (removing) {
      const confirmed = await dialogs.confirm({
        title: t('integrations.removeConnection.title', { name: 'GLPI' }),
        message: t('integrations.removeConnection.glpi'),
        confirmLabel: t('common:buttons.remove'),
        intent: 'danger',
      });
      if (!confirmed) return;
    }
    saveMutation.mutate(form);
  };

  return (
    <ConnectionCard
      title={t('aiAdmin.glpi.title')}
      hint={`${t('aiAdmin.glpi.description')} ${t('aiAdmin.glpi.tooltips.plaidRequired')}`}
      configured={!!settings?.glpi_url}
      dirty={dirty}
      storedTest={settings?.glpi_last_test ? describeTest(settings.glpi_last_test) : null}
      sessionTest={sessionTest}
      testing={testMutation.isPending}
      saving={saveMutation.isPending}
      onTest={() => testMutation.mutate(form)}
      testDisabled={removing || testValueMissing}
      onSave={() => { void handleSave(); }}
      saveDisabled={userTokenMissing && form.glpi_enabled}
      loading={settingsQuery.isLoading}
      error={settingsQuery.isError
        ? getApiErrorMessage(settingsQuery.error, t, t('aiAdmin.messages.loadSettingsFailed'))
        : undefined}
      notice={notice || (settings && !settings.provider_secret_writable) ? (
        <>
          {notice ? (
            <ConnectionNotice tone={notice.tone}>{notice.text}</ConnectionNotice>
          ) : null}
          {settings && !settings.provider_secret_writable ? (
            <ConnectionNotice tone="error">{t('aiAdmin.provider.apiKey.storageUnavailable')}</ConnectionNotice>
          ) : null}
        </>
      ) : undefined}
    >
      {({ locked }) => (
        <>
          <ConnectionSwitchField
            label={t('aiAdmin.glpi.fields.enabled')}
            checked={form.glpi_enabled}
            onChange={(checked) => editForm({ glpi_enabled: checked })}
            locked={locked}
          />
          <SettingField label={t('aiAdmin.glpi.fields.url')} hint={t('aiAdmin.glpi.hints.url')}>
            {({ aria }) => (
              <TextField
                variant="standard"
                value={form.glpi_url}
                onChange={(event) => editForm({ glpi_url: event.target.value })}
                placeholder={t('aiAdmin.glpi.placeholders.url')}
                fullWidth
                InputProps={{ readOnly: locked }}
                inputProps={{ 'aria-label': t('aiAdmin.glpi.fields.url'), ...aria }}
                sx={{ maxWidth: 480 }}
              />
            )}
          </SettingField>
          <ConnectionSecretField
            key={`user-${saveCount}`}
            label={t('aiAdmin.glpi.fields.userToken')}
            hint={t('aiAdmin.glpi.hints.userToken')}
            stored={!!settings?.has_glpi_user_token && !removing}
            value={form.glpi_user_token}
            onChange={(value) => editForm({ glpi_user_token: value })}
            addressChanged={addressChanged && !!settings?.has_glpi_user_token}
            locked={locked}
            placeholder={t('aiAdmin.glpi.placeholders.enterUserToken')}
          />
          <ConnectionSecretField
            key={`app-${saveCount}`}
            label={t('aiAdmin.glpi.fields.appToken')}
            hint={t('aiAdmin.glpi.hints.appToken')}
            stored={!!settings?.has_glpi_app_token && !removing}
            value={form.glpi_app_token}
            onChange={(value) => editForm({ glpi_app_token: value })}
            addressChanged={addressChanged && !!settings?.has_glpi_app_token}
            optional
            locked={locked}
            placeholder={t('aiAdmin.glpi.placeholders.enterAppToken')}
          />
        </>
      )}
    </ConnectionCard>
  );
}
