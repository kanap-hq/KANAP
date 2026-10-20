import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControlLabel,
  Link,
  MenuItem,
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
  netboxApi,
  type NetboxIntegrationSaveInput,
  type NetboxIntegrationView,
  type NetboxTestResult,
} from '../../api/endpoints/netbox';
import { StatusDot } from '../design';
import { drawerMenuItemSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { getDotColor } from '../../utils/statusColors';

type NetboxForm = {
  enabled: boolean;
  base_url: string;
  api_token: string;
  request_timeout_seconds: string;
  insecure_tls: boolean;
  auto_sync: boolean;
  default_environment: string;
};

type NetboxCardStatus = 'connected' | 'disabled' | 'notConfigured';

/** Environment codes offered for newly created assets, in the order the rest of the app uses. */
const ENVIRONMENT_CODES: Array<{ value: string; labelKey: string }> = [
  { value: 'prod', labelKey: 'it:enums.environment.prod' },
  { value: 'pre_prod', labelKey: 'it:enums.environment.preProd' },
  { value: 'qa', labelKey: 'it:enums.environment.qa' },
  { value: 'test', labelKey: 'it:enums.environment.test' },
  { value: 'dev', labelKey: 'it:enums.environment.dev' },
  { value: 'sandbox', labelKey: 'it:enums.environment.sandbox' },
];

function deriveStatus(integration: NetboxIntegrationView | undefined): NetboxCardStatus {
  if (!integration || !integration.configured) return 'notConfigured';
  return integration.enabled ? 'connected' : 'disabled';
}

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

/** Only what the user actually changed is sent; the token only when it was typed. */
function buildSavePayload(
  form: NetboxForm,
  integration: NetboxIntegrationView | undefined,
): NetboxIntegrationSaveInput {
  const payload: NetboxIntegrationSaveInput = {};
  const baseline = buildForm(integration);

  if (form.enabled !== baseline.enabled) payload.enabled = form.enabled;
  if (form.base_url.trim() !== baseline.base_url) payload.base_url = form.base_url.trim();
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
  const { t } = useTranslation(['admin', 'it', 'common']);
  const theme = useTheme();
  const queryClient = useQueryClient();

  const [form, setForm] = React.useState<NetboxForm>(() => buildForm(undefined));
  const [saveSuccess, setSaveSuccess] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<NetboxTestResult | null>(null);

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
    onMutate: () => {
      setSaveSuccess(false);
      setSaveError(null);
    },
    onSuccess: async () => {
      setSaveSuccess(true);
      setForm((prev) => ({ ...prev, api_token: '' }));
      await queryClient.invalidateQueries({ queryKey: ['netbox-integration'] });
    },
    onError: (error: unknown) => {
      setSaveError(getApiErrorMessage(error, t, t('integrations.netbox.messages.saveFailed')));
    },
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
    onMutate: () => setTestResult(null),
    onSuccess: (result) => setTestResult(result),
    onError: (error: unknown) => {
      setTestResult({
        ok: false,
        message: getApiErrorMessage(error, t, t('integrations.netbox.messages.testFailed')),
      });
    },
  });

  const status = deriveStatus(integration);
  const statusColor = getDotColor(status === 'connected' ? 'success' : 'default', theme.palette.mode);
  const hasStoredToken = integration?.credential?.present ?? false;
  const secretWritable = integration?.secret_writable !== false;

  const tokenHelperText = [
    t('integrations.netbox.hints.apiToken'),
    hasStoredToken ? t('integrations.netbox.hints.apiTokenExisting') : '',
    secretWritable ? '' : t('aiAdmin.provider.apiKey.storageUnavailable'),
  ].filter(Boolean).join(' ');

  return (
    <Card>
      <CardContent>
        {integrationQuery.isLoading ? (
          <Box display="flex" justifyContent="center" py={4}>
            <CircularProgress size={28} />
          </Box>
        ) : integrationQuery.isError ? (
          <Alert severity="error">
            {getApiErrorMessage(integrationQuery.error, t, t('integrations.netbox.messages.loadFailed'))}
          </Alert>
        ) : (
          <Stack spacing={2.5}>
            <Stack spacing={0.75}>
              <Typography variant="h6">{t('integrations.netbox.title')}</Typography>
              <Stack direction="row" spacing={0.75} alignItems="center">
                <StatusDot color={statusColor} />
                <Typography sx={{ fontSize: 12, fontWeight: 500, color: statusColor }}>
                  {t(`integrations.netbox.status.${status}`)}
                </Typography>
              </Stack>
            </Stack>

            <Typography variant="body2" color="text.secondary">
              {t('integrations.netbox.description')}
            </Typography>

            <FormControlLabel
              control={(
                <Switch
                  checked={form.enabled}
                  onChange={(event) => setForm((prev) => ({ ...prev, enabled: event.target.checked }))}
                />
              )}
              label={t('integrations.netbox.fields.enabled')}
            />

            <TextField
              size="small"
              label={t('integrations.netbox.fields.baseUrl')}
              value={form.base_url}
              onChange={(event) => setForm((prev) => ({ ...prev, base_url: event.target.value }))}
              placeholder={t('integrations.netbox.placeholders.baseUrl')}
              helperText={t('integrations.netbox.hints.baseUrl')}
            />

            <TextField
              size="small"
              label={t('integrations.netbox.fields.apiToken')}
              type="password"
              autoComplete="new-password"
              value={form.api_token}
              onChange={(event) => setForm((prev) => ({ ...prev, api_token: event.target.value }))}
              placeholder={
                hasStoredToken
                  ? t('integrations.netbox.placeholders.apiTokenConfigured')
                  : t('integrations.netbox.placeholders.enterApiToken')
              }
              helperText={tokenHelperText}
            />

            <TextField
              size="small"
              label={t('integrations.netbox.fields.requestTimeout')}
              value={form.request_timeout_seconds}
              onChange={(event) => setForm((prev) => ({
                ...prev,
                request_timeout_seconds: event.target.value.replace(/[^0-9]/g, ''),
              }))}
              placeholder={t('integrations.netbox.placeholders.requestTimeout')}
              helperText={t('integrations.netbox.hints.requestTimeout')}
            />

            <Box>
              <FormControlLabel
                control={(
                  <Switch
                    checked={form.insecure_tls}
                    onChange={(event) => setForm((prev) => ({ ...prev, insecure_tls: event.target.checked }))}
                  />
                )}
                label={t('integrations.netbox.fields.insecureTls')}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {t('integrations.netbox.hints.insecureTls')}
              </Typography>
            </Box>

            <Box>
              <FormControlLabel
                control={(
                  <Switch
                    checked={form.auto_sync}
                    onChange={(event) => setForm((prev) => ({ ...prev, auto_sync: event.target.checked }))}
                  />
                )}
                label={t('integrations.netbox.fields.autoSync')}
              />
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                {t('integrations.netbox.hints.autoSync')}
              </Typography>
            </Box>

            <TextField
              select
              size="small"
              label={t('integrations.netbox.fields.defaultEnvironment')}
              value={form.default_environment}
              onChange={(event) => setForm((prev) => ({ ...prev, default_environment: event.target.value }))}
              helperText={t('integrations.netbox.hints.defaultEnvironment')}
              // Narrow the field box only: the helper text keeps the card width so it does not wrap.
              sx={{ '& .MuiInputBase-root': { maxWidth: 260 } }}
            >
              {ENVIRONMENT_CODES.map((option) => (
                <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                  {t(option.labelKey)}
                </MenuItem>
              ))}
            </TextField>

            {testResult ? (
              <Alert severity={testResult.ok ? 'success' : 'error'} onClose={() => setTestResult(null)}>
                {testResult.ok && testResult.netbox_version
                  ? t('integrations.netbox.messages.testSuccess', { version: testResult.netbox_version })
                  : testResult.message}
              </Alert>
            ) : null}

            {saveSuccess ? <Alert severity="success">{t('integrations.netbox.messages.saved')}</Alert> : null}
            {saveError ? <Alert severity="error">{saveError}</Alert> : null}

            {saveSuccess && form.enabled && hasStoredToken ? (
              <Alert severity="info">
                {t('integrations.netbox.messages.nextStep')}{' '}
                <Link component={RouterLink} to="/it/settings?tab=netbox">
                  {t('integrations.netbox.actions.goToSync')}
                </Link>
              </Alert>
            ) : null}

            <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
              <Button
                variant="contained"
                onClick={() => saveMutation.mutate(form)}
                disabled={saveMutation.isPending}
              >
                {saveMutation.isPending ? t('common:status.saving') : t('integrations.netbox.actions.save')}
              </Button>
              <Button
                variant="outlined"
                onClick={() => testMutation.mutate(form)}
                disabled={testMutation.isPending}
              >
                {testMutation.isPending
                  ? t('integrations.netbox.actions.testing')
                  : t('integrations.netbox.actions.test')}
              </Button>
            </Stack>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}
