import React from 'react';
import { Link, MenuItem, Select, TextField } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import {
  netboxApi,
  type NetboxIntegrationSaveInput,
  type NetboxIntegrationView,
  type NetboxTestResult,
} from '../../api/endpoints/netbox';
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
import { drawerMenuItemSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { isNewSecretAddress } from '../../utils/secretAddress';

type NetboxForm = {
  enabled: boolean;
  base_url: string;
  api_token: string;
  request_timeout_seconds: string;
  insecure_tls: boolean;
  auto_sync: boolean;
  default_environment: string;
};

type CardNotice = { tone: 'success' | 'error'; text: string; next?: boolean };

/** Environment codes offered for newly created assets, in the order the rest of the app uses. */
const ENVIRONMENT_CODES: Array<{ value: string; labelKey: string }> = [
  { value: 'prod', labelKey: 'it:enums.environment.prod' },
  { value: 'pre_prod', labelKey: 'it:enums.environment.preProd' },
  { value: 'qa', labelKey: 'it:enums.environment.qa' },
  { value: 'test', labelKey: 'it:enums.environment.test' },
  { value: 'dev', labelKey: 'it:enums.environment.dev' },
  { value: 'sandbox', labelKey: 'it:enums.environment.sandbox' },
];

function buildForm(integration: NetboxIntegrationView | undefined): NetboxForm {
  return {
    enabled: integration?.enabled ?? false,
    base_url: integration?.base_url || '',
    api_token: '',
    request_timeout_seconds:
      integration?.request_timeout_seconds != null ? String(integration.request_timeout_seconds) : '',
    insecure_tls: integration?.insecure_tls ?? false,
    auto_sync: integration?.auto_sync ?? false,
    default_environment: integration?.default_environment || 'prod',
  };
}

/**
 * Only what the user actually changed is sent; the token only when it was typed, and then
 * with the address on screen, which the server binds it to.
 */
function buildSavePayload(
  form: NetboxForm,
  integration: NetboxIntegrationView | undefined,
): NetboxIntegrationSaveInput {
  const payload: NetboxIntegrationSaveInput = {};
  const baseline = buildForm(integration);

  if (form.enabled !== baseline.enabled) payload.enabled = form.enabled;
  if (form.base_url.trim() !== baseline.base_url || form.api_token.trim()) payload.base_url = form.base_url.trim();
  if (form.insecure_tls !== baseline.insecure_tls) payload.insecure_tls = form.insecure_tls;
  if (form.auto_sync !== baseline.auto_sync) payload.auto_sync = form.auto_sync;
  if (form.default_environment !== baseline.default_environment) {
    payload.default_environment = form.default_environment;
  }
  if (form.request_timeout_seconds.trim() !== baseline.request_timeout_seconds) {
    payload.request_timeout_seconds = form.request_timeout_seconds.trim()
      ? Number(form.request_timeout_seconds.trim())
      : null;
  }
  if (form.api_token.trim()) payload.api_token = form.api_token.trim();

  return payload;
}

/**
 * Connection card for the Netbox inventory. Saving and testing live here;
 * the day-to-day synchronisation work happens on the Netbox tab of IT settings.
 */
export default function NetboxIntegrationCard() {
  const { t } = useTranslation(['admin', 'it', 'common', 'errors']);
  const queryClient = useQueryClient();
  const dialogs = useKanapDialogs();

  const [form, setForm] = React.useState<NetboxForm>(() => buildForm(undefined));
  const [notice, setNotice] = React.useState<CardNotice | null>(null);
  const [sessionTest, setSessionTest] = React.useState<ConnectionTest | null>(null);
  const [saveCount, setSaveCount] = React.useState(0);

  const editForm = (patch: Partial<NetboxForm>) => {
    setNotice(null);
    setSessionTest(null);
    setForm((prev) => ({ ...prev, ...patch }));
  };

  const integrationQuery = useQuery({
    queryKey: ['netbox-integration'],
    queryFn: () => netboxApi.getIntegration(),
  });
  const integration = integrationQuery.data;

  React.useEffect(() => {
    if (integration) setForm(buildForm(integration));
  }, [integration]);

  const saveMutation = useMutation({
    mutationFn: async (data: NetboxForm) => netboxApi.saveIntegration(buildSavePayload(data, integration)),
    onMutate: () => setNotice(null),
    onSuccess: async (_saved, data) => {
      setNotice({
        tone: 'success',
        text: t('integrations.netbox.messages.saved'),
        next: data.enabled && !!data.base_url.trim()
          && ((integration?.credential?.present ?? false) || data.api_token.trim().length > 0),
      });
      setForm((prev) => ({ ...prev, api_token: '' }));
      setSaveCount((count) => count + 1);
      await queryClient.invalidateQueries({ queryKey: ['netbox-integration'] });
    },
    onError: (error: unknown) => {
      setNotice({ tone: 'error', text: getApiErrorMessage(error, t, t('integrations.netbox.messages.saveFailed')) });
    },
  });

  // A test as the status line says it, run now or kept on the saved values: the version, or the
  // cause from its code (a kept test has no message).
  const describeTest = (result: { ok: boolean; tested_at?: string; code?: string; message?: string; version?: string }): ConnectionTest => ({
    ok: result.ok,
    tested_at: result.tested_at || new Date().toISOString(),
    ...(result.ok
      ? (result.version ? { detail: t('integrations.netbox.messages.testDetail', { version: result.version }) } : {})
      : { cause: connectionTestCause(t, result.code, result.message, t('integrations.netbox.messages.testFailed')) }),
  });

  const testMutation = useMutation({
    mutationFn: async (data: NetboxForm) =>
      netboxApi.testIntegration({
        ...(data.base_url.trim() ? { base_url: data.base_url.trim() } : {}),
        ...(data.api_token.trim() ? { api_token: data.api_token.trim() } : {}),
        insecure_tls: data.insecure_tls,
        ...(data.request_timeout_seconds.trim()
          ? { request_timeout_seconds: Number(data.request_timeout_seconds.trim()) }
          : {}),
      }),
    onMutate: () => {
      setNotice(null);
      setSessionTest(null);
    },
    onSuccess: (result: NetboxTestResult) => {
      setSessionTest(describeTest({ ...result, version: result.netbox_version }));
    },
    onError: (error: unknown) => {
      setSessionTest({
        ok: false,
        tested_at: new Date().toISOString(),
        cause: getApiErrorMessage(error, t, t('integrations.netbox.messages.testFailed')),
      });
    },
  });

  const savedToken = integration?.credential?.present ?? false;
  // An emptied address removes the saved connection (address and token) on save.
  const removing = !!integration?.base_url && !form.base_url.trim();
  // The saved token only goes to the saved address: a new one empties it on save.
  const tokenEmptiedByAddress = savedToken && !removing && isNewSecretAddress(form.base_url, integration?.base_url);
  const tokenMissingForAddress = tokenEmptiedByAddress && !form.api_token.trim();
  const testValueMissing = connectionValueMissing(form.base_url, {
    stored: savedToken,
    typed: form.api_token,
    addressChanged: tokenEmptiedByAddress,
  });
  const secretWritable = integration?.secret_writable !== false;
  const dirty = !!integration && Object.keys(buildSavePayload(form, integration)).length > 0;
  const storedTest = integration?.last_test?.tested_at ? describeTest(integration.last_test) : null;

  const handleSave = async () => {
    if (removing) {
      const confirmed = await dialogs.confirm({
        title: t('integrations.removeConnection.title', { name: 'Netbox' }),
        message: t('integrations.removeConnection.netbox'),
        confirmLabel: t('common:buttons.remove'),
        intent: 'danger',
      });
      if (!confirmed) return;
    }
    saveMutation.mutate(form);
  };

  return (
    <ConnectionCard
      title={t('integrations.netbox.title')}
      hint={t('integrations.netbox.description')}
      configured={!!integration?.configured}
      dirty={dirty}
      storedTest={storedTest}
      sessionTest={sessionTest}
      testing={testMutation.isPending}
      saving={saveMutation.isPending}
      onTest={() => testMutation.mutate(form)}
      testDisabled={removing || testValueMissing}
      onSave={() => { void handleSave(); }}
      saveDisabled={tokenMissingForAddress && form.enabled}
      loading={integrationQuery.isLoading}
      error={integrationQuery.isError
        ? getApiErrorMessage(integrationQuery.error, t, t('integrations.netbox.messages.loadFailed'))
        : undefined}
      notice={notice || !secretWritable ? (
        <>
          {notice ? (
            <ConnectionNotice tone={notice.tone}>
              {notice.text}
              {notice.next ? (
                <>
                  {' '}
                  {t('integrations.netbox.messages.nextStep')}{' '}
                  <Link component={RouterLink} to="/it/settings?tab=netbox">{t('integrations.netbox.actions.goToSync')}</Link>
                </>
              ) : null}
            </ConnectionNotice>
          ) : null}
          {!secretWritable ? (
            <ConnectionNotice tone="error">{t('aiAdmin.provider.apiKey.storageUnavailable')}</ConnectionNotice>
          ) : null}
        </>
      ) : undefined}
    >
      {({ locked }) => (
        <>
          <ConnectionSwitchField
            label={t('integrations.netbox.fields.enabled')}
            checked={form.enabled}
            onChange={(checked) => editForm({ enabled: checked })}
            locked={locked}
          />
          <SettingField label={t('integrations.netbox.fields.baseUrl')} hint={t('integrations.netbox.hints.baseUrl')}>
            {({ aria }) => (
              <TextField
                variant="standard"
                value={form.base_url}
                onChange={(event) => editForm({ base_url: event.target.value })}
                placeholder={t('integrations.netbox.placeholders.baseUrl')}
                fullWidth
                InputProps={{ readOnly: locked }}
                inputProps={{ 'aria-label': t('integrations.netbox.fields.baseUrl'), ...aria }}
                sx={{ maxWidth: 480 }}
              />
            )}
          </SettingField>
          <ConnectionSecretField
            key={`token-${saveCount}`}
            label={t('integrations.netbox.fields.apiToken')}
            hint={t('integrations.netbox.hints.apiToken')}
            stored={savedToken && !removing}
            value={form.api_token}
            onChange={(value) => editForm({ api_token: value })}
            addressChanged={tokenEmptiedByAddress}
            locked={locked}
            placeholder={t('integrations.netbox.placeholders.enterApiToken')}
          />
          <SettingField label={t('integrations.netbox.fields.requestTimeout')} hint={t('integrations.netbox.hints.requestTimeout')}>
            {({ aria }) => (
              <TextField
                variant="standard"
                value={form.request_timeout_seconds}
                onChange={(event) => editForm({ request_timeout_seconds: event.target.value.replace(/[^0-9]/g, '') })}
                placeholder={t('integrations.netbox.placeholders.requestTimeout')}
                fullWidth
                InputProps={{ readOnly: locked }}
                inputProps={{ 'aria-label': t('integrations.netbox.fields.requestTimeout'), inputMode: 'numeric', ...aria }}
                sx={{ maxWidth: 480 }}
              />
            )}
          </SettingField>
          <SettingField label={t('integrations.netbox.fields.defaultEnvironment')} hint={t('integrations.netbox.hints.defaultEnvironment')}>
            {({ aria }) => (
              <Select
                variant="standard"
                value={form.default_environment}
                onChange={(event) => editForm({ default_environment: String(event.target.value) })}
                readOnly={locked}
                fullWidth
                SelectDisplayProps={{ 'aria-label': t('integrations.netbox.fields.defaultEnvironment'), ...aria } as React.HTMLAttributes<HTMLDivElement>}
                sx={{ maxWidth: 480 }}
              >
                {ENVIRONMENT_CODES.map((option) => (
                  <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                    {t(option.labelKey)}
                  </MenuItem>
                ))}
              </Select>
            )}
          </SettingField>
          <ConnectionSwitchField
            label={t('integrations.netbox.fields.insecureTls')}
            hint={t('integrations.netbox.hints.insecureTls')}
            checked={form.insecure_tls}
            onChange={(checked) => editForm({ insecure_tls: checked })}
            locked={locked}
          />
          <ConnectionSwitchField
            label={t('integrations.netbox.fields.autoSync')}
            hint={t('integrations.netbox.hints.autoSync')}
            checked={form.auto_sync}
            onChange={(checked) => editForm({ auto_sync: checked })}
            locked={locked}
          />
        </>
      )}
    </ConnectionCard>
  );
}
