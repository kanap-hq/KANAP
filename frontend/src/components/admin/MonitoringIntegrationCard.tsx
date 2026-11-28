import React from 'react';
import { Autocomplete, Link, TextField } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import { aiAdminApi, type AiMonitoringIntegration } from '../../ai/aiApi';
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
import { isNewSecretAddress } from '../../utils/secretAddress';

type PrtgForm = {
  enabled: boolean;
  base_url: string;
  api_token: string;
  server_timezone: string;
  request_timeout_seconds: string;
};

function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function listTimeZones(): string[] {
  const intl = Intl as unknown as { supportedValuesOf?: (key: 'timeZone') => string[] };
  try {
    const zones = intl.supportedValuesOf?.('timeZone');
    if (zones && zones.length > 0) return zones;
  } catch {
    // Older runtimes without Intl.supportedValuesOf: fall through to the browser zone.
  }
  return [getBrowserTimeZone()];
}

function buildForm(integration: AiMonitoringIntegration | null): PrtgForm {
  return {
    enabled: integration?.enabled ?? false,
    base_url: integration?.base_url || '',
    api_token: '',
    server_timezone: integration?.server_timezone || getBrowserTimeZone(),
    request_timeout_seconds: integration?.request_timeout_seconds != null ? String(integration.request_timeout_seconds) : '',
  };
}

function sameForm(a: PrtgForm, b: PrtgForm): boolean {
  return a.enabled === b.enabled
    && a.base_url.trim() === b.base_url.trim()
    && !a.api_token.trim()
    && a.server_timezone === b.server_timezone
    && a.request_timeout_seconds.trim() === b.request_timeout_seconds.trim();
}

/** The PRTG connection, read by the monitoring agents. */
export default function MonitoringIntegrationCard() {
  const { t } = useTranslation(['admin', 'common', 'errors']);
  const queryClient = useQueryClient();
  const dialogs = useKanapDialogs();

  const [form, setForm] = React.useState<PrtgForm>(() => buildForm(null));
  const [notice, setNotice] = React.useState<{ tone: 'success' | 'error'; text: string; next?: boolean } | null>(null);
  const [sessionTest, setSessionTest] = React.useState<ConnectionTest | null>(null);
  const [saveCount, setSaveCount] = React.useState(0);

  const integrationsQuery = useQuery({
    queryKey: ['admin-monitoring-integrations'],
    queryFn: () => aiAdminApi.listMonitoringIntegrations(),
  });

  const prtg = React.useMemo(
    () => integrationsQuery.data?.integrations.find((item) => item.provider_key === 'prtg') ?? null,
    [integrationsQuery.data],
  );

  React.useEffect(() => {
    if (integrationsQuery.data) setForm(buildForm(prtg));
  }, [integrationsQuery.data, prtg]);

  const editForm = (patch: Partial<PrtgForm>) => {
    setNotice(null);
    setSessionTest(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const timeZoneOptions = React.useMemo(() => {
    const zones = listTimeZones();
    if (form.server_timezone && !zones.includes(form.server_timezone)) {
      return [...zones, form.server_timezone].sort();
    }
    return zones;
  }, [form.server_timezone]);

  const savedKey = prtg?.credential.present ?? false;
  // An emptied address removes the saved connection (address and key) on save.
  const removing = !!prtg?.base_url && !form.base_url.trim();
  // The saved key only goes to the saved address: a new one empties it on save.
  const addressChanged = !!prtg && !removing && isNewSecretAddress(form.base_url, prtg.base_url);
  const keyEmptiedByAddress = addressChanged && savedKey;
  const keyMissingForAddress = keyEmptiedByAddress && !form.api_token.trim();
  const testValueMissing = connectionValueMissing(form.base_url, { stored: savedKey, typed: form.api_token, addressChanged });
  const dirty = !integrationsQuery.isLoading && !sameForm(form, buildForm(prtg));

  const saveMutation = useMutation({
    mutationFn: async (data: PrtgForm) =>
      aiAdminApi.updatePrtgIntegration({
        base_url: data.base_url.trim(),
        enabled: data.enabled,
        ...(data.server_timezone ? { server_timezone: data.server_timezone } : {}),
        // Always sent: an emptied field clears back to the built-in default.
        request_timeout_seconds: data.request_timeout_seconds.trim() ? Number(data.request_timeout_seconds.trim()) : null,
        ...(data.api_token.trim() ? { api_token: data.api_token.trim() } : {}),
      }),
    onMutate: () => setNotice(null),
    onSuccess: async (_saved, data) => {
      const keyKept = data.api_token.trim().length > 0 || (savedKey && !keyEmptiedByAddress);
      setNotice({
        tone: 'success',
        text: t('aiAdmin.messages.settingsSaved'),
        next: data.enabled && !!data.base_url.trim() && keyKept,
      });
      setForm((prev) => ({ ...prev, api_token: '' }));
      setSaveCount((count) => count + 1);
      await queryClient.invalidateQueries({ queryKey: ['admin-monitoring-integrations'] });
    },
    onError: (error: unknown) => {
      setNotice({ tone: 'error', text: getApiErrorMessage(error, t, t('aiAdmin.messages.saveFailed')) });
    },
  });

  // A test as the status line says it, run now or kept on the saved values: the version and the
  // sensors seen, or the cause from its code (a kept test has no message).
  const describeTest = (result: { ok: boolean; tested_at?: string; code?: string; message?: string; version?: string; sensor_count?: number }): ConnectionTest => ({
    ok: result.ok,
    tested_at: result.tested_at || new Date().toISOString(),
    ...(result.ok
      ? (result.version && result.sensor_count != null
        ? { detail: t('aiAdmin.prtg.messages.testDetail', { version: result.version, count: result.sensor_count }) }
        : {})
      : { cause: connectionTestCause(t, result.code, result.message, t('aiAdmin.prtg.messages.testFailed')) }),
  });

  const testMutation = useMutation({
    mutationFn: async (data: PrtgForm) =>
      aiAdminApi.testPrtgIntegration({
        ...(data.base_url.trim() ? { base_url: data.base_url.trim() } : {}),
        ...(data.api_token.trim() ? { api_token: data.api_token.trim() } : {}),
      }),
    onMutate: () => {
      setNotice(null);
      setSessionTest(null);
    },
    onSuccess: (result) => {
      setSessionTest(describeTest({ ...result, version: result.prtg_version }));
    },
    onError: (error: unknown) => {
      setSessionTest({
        ok: false,
        tested_at: new Date().toISOString(),
        cause: getApiErrorMessage(error, t, t('aiAdmin.prtg.messages.testFailed')),
      });
    },
  });

  const handleSave = async () => {
    if (removing) {
      const confirmed = await dialogs.confirm({
        title: t('integrations.removeConnection.title', { name: 'PRTG' }),
        message: t('integrations.removeConnection.prtg'),
        confirmLabel: t('common:buttons.remove'),
        intent: 'danger',
      });
      if (!confirmed) return;
    }
    saveMutation.mutate(form);
  };

  return (
    <ConnectionCard
      title={t('aiAdmin.prtg.title')}
      hint={t('aiAdmin.prtg.description')}
      configured={!!prtg?.base_url}
      dirty={dirty}
      storedTest={prtg?.last_test ? describeTest(prtg.last_test) : null}
      sessionTest={sessionTest}
      testing={testMutation.isPending}
      saving={saveMutation.isPending}
      onTest={() => testMutation.mutate(form)}
      testDisabled={removing || testValueMissing}
      onSave={() => { void handleSave(); }}
      saveDisabled={keyMissingForAddress && form.enabled}
      loading={integrationsQuery.isLoading}
      error={integrationsQuery.isError
        ? getApiErrorMessage(integrationsQuery.error, t, t('aiAdmin.prtg.messages.loadFailed'))
        : undefined}
      notice={notice ? (
        <ConnectionNotice tone={notice.tone}>
          {notice.text}
          {notice.next ? (
            <>
              {' '}
              {t('aiAdmin.prtg.messages.nextStep')}{' '}
              <Link component={RouterLink} to="/agents">{t('aiAdmin.prtg.actions.goToAgents')}</Link>
            </>
          ) : null}
        </ConnectionNotice>
      ) : undefined}
    >
      {({ locked }) => (
        <>
          <ConnectionSwitchField
            label={t('aiAdmin.prtg.fields.enabled')}
            checked={form.enabled}
            onChange={(checked) => editForm({ enabled: checked })}
            locked={locked}
          />
          <SettingField label={t('aiAdmin.prtg.fields.baseUrl')} hint={t('aiAdmin.prtg.hints.baseUrl')}>
            {({ aria }) => (
              <TextField
                variant="standard"
                value={form.base_url}
                onChange={(event) => editForm({ base_url: event.target.value })}
                placeholder={t('aiAdmin.prtg.placeholders.url')}
                fullWidth
                InputProps={{ readOnly: locked }}
                inputProps={{ 'aria-label': t('aiAdmin.prtg.fields.baseUrl'), ...aria }}
                sx={{ maxWidth: 480 }}
              />
            )}
          </SettingField>
          <ConnectionSecretField
            key={`key-${saveCount}`}
            label={t('aiAdmin.prtg.fields.apiKey')}
            hint={t('aiAdmin.prtg.hints.apiKey')}
            stored={savedKey && !removing}
            value={form.api_token}
            onChange={(value) => editForm({ api_token: value })}
            addressChanged={keyEmptiedByAddress}
            locked={locked}
            placeholder={t('aiAdmin.prtg.placeholders.enterApiKey')}
          />
          <SettingField label={t('aiAdmin.prtg.fields.timezone')} hint={t('aiAdmin.prtg.hints.timezone')}>
            {({ aria }) => (
              <Autocomplete<string, false, true, false>
                options={timeZoneOptions}
                value={form.server_timezone}
                onChange={(_event, value) => {
                  if (value) editForm({ server_timezone: value });
                }}
                disableClearable
                autoHighlight
                readOnly={locked}
                sx={{ maxWidth: 480 }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    variant="standard"
                    inputProps={{ ...params.inputProps, 'aria-label': t('aiAdmin.prtg.fields.timezone'), ...aria }}
                  />
                )}
              />
            )}
          </SettingField>
          <SettingField label={t('aiAdmin.prtg.fields.requestTimeout')} hint={t('aiAdmin.prtg.hints.requestTimeout')}>
            {({ aria }) => (
              <TextField
                variant="standard"
                value={form.request_timeout_seconds}
                onChange={(event) => editForm({ request_timeout_seconds: event.target.value.replace(/[^0-9]/g, '') })}
                placeholder={t('aiAdmin.prtg.placeholders.requestTimeout')}
                fullWidth
                InputProps={{ readOnly: locked }}
                inputProps={{ 'aria-label': t('aiAdmin.prtg.fields.requestTimeout'), inputMode: 'numeric', ...aria }}
                sx={{ maxWidth: 480 }}
              />
            )}
          </SettingField>
        </>
      )}
    </ConnectionCard>
  );
}
