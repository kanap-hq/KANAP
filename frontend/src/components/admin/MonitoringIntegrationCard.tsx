import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Link,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import {
  aiAdminApi,
  type AiMonitoringIntegration,
  type AiPrtgTestResult,
} from '../../ai/aiApi';
import InfoHint from '../workspace/InfoHint';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';
import { isNewSecretAddress } from '../../utils/secretAddress';

type PrtgForm = {
  enabled: boolean;
  base_url: string;
  api_token: string;
  server_timezone: string;
  request_timeout_seconds: string;
};

type PrtgStatus = 'connected' | 'disabled' | 'notConfigured';

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
    // Older runtimes without Intl.supportedValuesOf — fall through to the browser zone.
  }
  return [getBrowserTimeZone()];
}

function derivePrtgStatus(integration: AiMonitoringIntegration | null): PrtgStatus {
  if (!integration || !integration.credential.present || !integration.base_url) {
    return 'notConfigured';
  }
  return integration.enabled ? 'connected' : 'disabled';
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

export default function MonitoringIntegrationCard() {
  const { t } = useTranslation(['admin', 'common']);
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [form, setForm] = React.useState<PrtgForm>(() => buildForm(null));
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<AiPrtgTestResult | null>(null);

  const integrationsQuery = useQuery({
    queryKey: ['admin-monitoring-integrations'],
    queryFn: () => aiAdminApi.listMonitoringIntegrations(),
  });

  const prtg = React.useMemo(
    () => integrationsQuery.data?.integrations.find((item) => item.provider_key === 'prtg') ?? null,
    [integrationsQuery.data],
  );

  React.useEffect(() => {
    if (integrationsQuery.data) {
      setForm(buildForm(prtg));
    }
  }, [integrationsQuery.data, prtg]);

  const timeZoneOptions = React.useMemo(() => {
    const zones = listTimeZones();
    if (form.server_timezone && !zones.includes(form.server_timezone)) {
      return [...zones, form.server_timezone].sort();
    }
    return zones;
  }, [form.server_timezone]);

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
    onMutate: () => {
      setSaveSuccess(false);
      setSaveError(null);
    },
    onSuccess: async () => {
      setSaveSuccess(true);
      setForm((prev) => ({ ...prev, api_token: '' }));
      await queryClient.invalidateQueries({ queryKey: ['admin-monitoring-integrations'] });
    },
    onError: (error: any) => {
      setSaveError(getApiErrorMessage(error, t, t('aiAdmin.messages.saveFailed')));
    },
  });

  const testMutation = useMutation({
    mutationFn: async (data: PrtgForm) =>
      aiAdminApi.testPrtgIntegration({
        ...(data.base_url.trim() ? { base_url: data.base_url.trim() } : {}),
        ...(data.api_token.trim() ? { api_token: data.api_token.trim() } : {}),
      }),
    onMutate: () => {
      setTestResult(null);
    },
    onSuccess: (result) => {
      setTestResult(result);
    },
    onError: (error: any) => {
      setTestResult({
        ok: false,
        message: getApiErrorMessage(error, t, t('aiAdmin.prtg.messages.testFailed')),
      });
    },
  });

  const status = derivePrtgStatus(prtg);
  const statusColor = getDotColor(status === 'connected' ? 'success' : 'default', theme.palette.mode);
  const savedKey = prtg?.credential.present ?? false;
  // The saved key only goes to the saved address: a new one empties it on save.
  const addressChanged = !!prtg && isNewSecretAddress(form.base_url, prtg.base_url);
  const keyEmptiedByAddress = addressChanged && savedKey;
  const hasStoredKey = savedKey && !keyEmptiedByAddress;
  const keyMissingForAddress = addressChanged && savedKey && !form.api_token.trim();

  return (
    <Card>
      <CardContent>
        {integrationsQuery.isLoading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress size={28} />
          </Box>
        ) : integrationsQuery.isError ? (
          <Alert severity="error">
            {getApiErrorMessage(integrationsQuery.error, t, t('aiAdmin.prtg.messages.loadFailed'))}
          </Alert>
        ) : (
          <Stack spacing={2.5}>
            <Stack spacing={0.75}>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Typography variant="h6">{t('aiAdmin.prtg.title')}</Typography>
                <InfoHint text={t('aiAdmin.prtg.description')} />
              </Stack>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <Box
                  sx={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: statusColor,
                    flexShrink: 0,
                  }}
                />
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: statusColor }}>
                  {t(`aiAdmin.prtg.status.${status}`)}
                </Typography>
              </Stack>
            </Stack>

            <FormControlLabel
              control={(
                <Switch
                  checked={form.enabled}
                  onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
              )}
              label={t('aiAdmin.prtg.fields.enabled')}
            />

            <TextField
              size="small"
              label={t('aiAdmin.prtg.fields.baseUrl')}
              value={form.base_url}
              onChange={(event) => setForm((prev) => ({ ...prev, base_url: event.target.value }))}
              placeholder={t('aiAdmin.prtg.placeholders.url')}
            />

            <TextField
              size="small"
              label={t('aiAdmin.prtg.fields.apiKey')}
              type="password"
              autoComplete="new-password"
              required={keyEmptiedByAddress}
              value={form.api_token}
              onChange={(event) => setForm((prev) => ({ ...prev, api_token: event.target.value }))}
              placeholder={
                hasStoredKey
                  ? t('aiAdmin.prtg.placeholders.apiKeySaved')
                  : t('aiAdmin.prtg.placeholders.enterApiKey')
              }
              helperText={keyEmptiedByAddress ? t('integrations.secretAddressChanged') : t('aiAdmin.prtg.hints.apiKey')}
            />

            <Autocomplete<string, false, true, false>
              size="small"
              options={timeZoneOptions}
              value={form.server_timezone}
              onChange={(_event, value) => {
                if (value) setForm((prev) => ({ ...prev, server_timezone: value }));
              }}
              disableClearable
              autoHighlight
              renderInput={(params) => (
                <TextField
                  {...params}
                  size="small"
                  label={t('aiAdmin.prtg.fields.timezone')}
                />
              )}
            />

            <TextField
              size="small"
              label={t('aiAdmin.prtg.fields.requestTimeout')}
              value={form.request_timeout_seconds}
              onChange={(event) => setForm((prev) => ({ ...prev, request_timeout_seconds: event.target.value.replace(/[^0-9]/g, '') }))}
              placeholder={t('aiAdmin.prtg.placeholders.requestTimeout')}
              helperText={t('aiAdmin.prtg.hints.requestTimeout')}
            />

            {testResult ? (
              <Alert
                severity={testResult.ok ? 'success' : 'error'}
                onClose={() => setTestResult(null)}
              >
                {testResult.ok && testResult.prtg_version && testResult.sensor_count != null
                  ? t('aiAdmin.prtg.messages.testSuccess', {
                    version: testResult.prtg_version,
                    count: testResult.sensor_count,
                  })
                  : testResult.message}
              </Alert>
            ) : null}

            {saveSuccess ? <Alert severity="success">{t('aiAdmin.messages.settingsSaved')}</Alert> : null}
            {saveError ? <Alert severity="error">{saveError}</Alert> : null}

            {saveSuccess && form.enabled && hasStoredKey ? (
              <Alert severity="info">
                {t('aiAdmin.prtg.messages.nextStep')}{' '}
                <Link component={RouterLink} to="/agents">
                  {t('aiAdmin.prtg.actions.goToAgents')}
                </Link>
              </Alert>
            ) : null}

            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending || (keyEmptiedByAddress && !form.api_token.trim() && form.enabled)}
              >
                {saveMutation.isPending ? t('common:status.saving') : t('aiAdmin.actions.saveSettings')}
              </Button>
              <Button
                variant="outlined"
                onClick={() => testMutation.mutate(form)}
                disabled={testMutation.isPending || keyMissingForAddress}
              >
                {testMutation.isPending ? t('aiAdmin.actions.testing') : t('aiAdmin.actions.testConnection')}
              </Button>
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
