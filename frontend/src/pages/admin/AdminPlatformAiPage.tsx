import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import ForbiddenPage from '../ForbiddenPage';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { platformAiApi, PlatformAiConfigPayload } from '../../ai/platformAiApi';
import { AiProviderTestResult } from '../../ai/aiApi';
import { useLocale } from '../../i18n/useLocale';
import { KanapDialog, PropertyRow } from '../../components/design';
import { drawerMenuItemSx } from '../../theme/formSx';
import { INCLUDED_MODEL_LOCATIONS } from '../../ai/includedModel';
import { useRegionName } from '../../ai/useRegionName';

type ConfigForm = {
  provider: string;
  model: string;
  api_key: string;
  endpoint_url: string;
  rate_limit_tenant_per_minute: string;
  rate_limit_user_per_hour: string;
  disclosure_name: string;
  disclosure_location: string;
};

const EMPTY_CONFIG_FORM: ConfigForm = {
  provider: '',
  model: '',
  api_key: '',
  endpoint_url: '',
  rate_limit_tenant_per_minute: '30',
  rate_limit_user_per_hour: '60',
  disclosure_name: '',
  disclosure_location: '',
};

function buildConfigForm(data: PlatformAiConfigPayload['config']): ConfigForm {
  if (!data) {
    return EMPTY_CONFIG_FORM;
  }
  return {
    provider: data.provider,
    model: data.model,
    api_key: '',
    endpoint_url: data.endpoint_url || '',
    rate_limit_tenant_per_minute: String(data.rate_limit_tenant_per_minute),
    rate_limit_user_per_hour: String(data.rate_limit_user_per_hour),
    disclosure_name: data.disclosure_name ?? '',
    disclosure_location: data.disclosure_location ?? '',
  };
}

function endpointHost(endpointUrl: string | null | undefined): string {
  const raw = endpointUrl?.trim() ?? '';
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/**
 * True when the save switches the technical provider or the endpoint host (the server
 * keeps the stored endpoint when the field is left empty). Workspaces confirm the
 * provider again, so the name and location shown to them go with the same save.
 */
function technicalProviderChanges(form: ConfigForm, existing: PlatformAiConfigPayload['config']): boolean {
  if (!existing) return false;
  const provider = form.provider || existing.provider;
  const endpoint = form.endpoint_url.trim() || existing.endpoint_url;
  return provider !== existing.provider || endpointHost(endpoint) !== endpointHost(existing.endpoint_url);
}

/**
 * True when saving changes what workspaces confirmed (provider, endpoint host, name or
 * location shown) while they had something to confirm. A new model keeps it.
 */
function disclosureChangeAsksAgain(form: ConfigForm, existing: PlatformAiConfigPayload['config']): boolean {
  const previousName = existing?.disclosure_name?.trim() ?? '';
  const previousLocation = existing?.disclosure_location ?? '';
  if (!previousName || !previousLocation) return false;
  return technicalProviderChanges(form, existing)
    || form.disclosure_name.trim() !== previousName
    || form.disclosure_location !== previousLocation;
}

function buildConfigPayload(form: ConfigForm, existing: PlatformAiConfigPayload['config']): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (form.provider !== (existing?.provider || '')) {
    payload.provider = form.provider || null;
  }
  if (form.model !== (existing?.model || '')) {
    payload.model = form.model || null;
  }
  if (form.api_key.trim()) {
    payload.api_key = form.api_key.trim();
  }
  if (form.endpoint_url !== (existing?.endpoint_url || '')) {
    payload.endpoint_url = form.endpoint_url.trim() || null;
  }

  const tenantRate = Number(form.rate_limit_tenant_per_minute);
  if (tenantRate !== (existing?.rate_limit_tenant_per_minute ?? 30)) {
    payload.rate_limit_tenant_per_minute = tenantRate;
  }

  const userRate = Number(form.rate_limit_user_per_hour);
  if (userRate !== (existing?.rate_limit_user_per_hour ?? 60)) {
    payload.rate_limit_user_per_hour = userRate;
  }

  // A new provider or endpoint host sends the shown name and location again: the
  // operator confirms them with the change.
  const technicalChange = technicalProviderChanges(form, existing);
  if (technicalChange || form.disclosure_name.trim() !== (existing?.disclosure_name ?? '')) {
    payload.disclosure_name = form.disclosure_name.trim();
  }
  if (technicalChange || form.disclosure_location !== (existing?.disclosure_location ?? '')) {
    payload.disclosure_location = form.disclosure_location;
  }

  return payload;
}

export default function AdminPlatformAiPage() {
  const { claims } = useAuth();
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const queryClient = useQueryClient();

  const [configForm, setConfigForm] = React.useState<ConfigForm>(EMPTY_CONFIG_FORM);
  const [freeMessageLimit, setFreeMessageLimit] = React.useState<number>(0);
  const [configError, setConfigError] = React.useState<string | null>(null);
  const [planError, setPlanError] = React.useState<string | null>(null);
  const [configSaved, setConfigSaved] = React.useState(false);
  const [planSaved, setPlanSaved] = React.useState(false);
  const [testResult, setTestResult] = React.useState<AiProviderTestResult | null>(null);
  const [confirmDisclosureChange, setConfirmDisclosureChange] = React.useState(false);
  const regionName = useRegionName();

  const configQuery = useQuery({
    queryKey: ['platform-ai-config'],
    queryFn: () => platformAiApi.getConfig(),
  });

  React.useEffect(() => {
    if (!configQuery.data) {
      return;
    }
    setConfigForm(buildConfigForm(configQuery.data.config));
    setFreeMessageLimit(configQuery.data.free_monthly_message_limit);
    setTestResult(null);
  }, [configQuery.data?.config?.updated_at, configQuery.data?.free_monthly_message_limit]);

  const saveConfigMutation = useMutation({
    mutationFn: async () => {
      if (!configQuery.data) {
        return false;
      }
      const payload = buildConfigPayload(configForm, configQuery.data.config);
      if (Object.keys(payload).length === 0) {
        return false;
      }
      await platformAiApi.updateConfig(payload);
      return true;
    },
    onMutate: () => {
      setConfigError(null);
      setConfigSaved(false);
    },
    onSuccess: async (changed) => {
      setConfirmDisclosureChange(false);
      if (!changed) {
        return;
      }
      setConfigSaved(true);
      setConfigForm((prev) => ({ ...prev, api_key: '' }));
      await queryClient.invalidateQueries({ queryKey: ['platform-ai-config'] });
      setTimeout(() => setConfigSaved(false), 3000);
    },
    onError: (error: unknown) => {
      setConfirmDisclosureChange(false);
      setConfigError(getApiErrorMessage(error, t, t('platformAi.messages.saveFailed')));
    },
  });

  const saveConfig = () => {
    if (configQuery.data && disclosureChangeAsksAgain(configForm, configQuery.data.config)) {
      setConfirmDisclosureChange(true);
      return;
    }
    saveConfigMutation.mutate();
  };

  const testConfigMutation = useMutation({
    mutationFn: async () => platformAiApi.testConfig({
      provider: configForm.provider || null,
      model: configForm.model || null,
      endpoint_url: configForm.endpoint_url.trim() || null,
      ...(configForm.api_key.trim() ? { api_key: configForm.api_key.trim() } : {}),
    }),
    onMutate: () => {
      setTestResult(null);
    },
    onSuccess: (result) => {
      setTestResult(result);
    },
    onError: (error: unknown) => {
      setTestResult({
        ok: false,
        provider: configForm.provider || null,
        model: configForm.model || null,
        latency_ms: null,
        message: getApiErrorMessage(error, t, t('platformAi.messages.testFailed')),
        validation_errors: [],
      });
    },
  });

  const savePlanLimitsMutation = useMutation({
    mutationFn: async () => {
      await platformAiApi.updateFreeMessageLimit(freeMessageLimit);
    },
    onMutate: () => {
      setPlanError(null);
      setPlanSaved(false);
    },
    onSuccess: async () => {
      setPlanSaved(true);
      await queryClient.invalidateQueries({ queryKey: ['platform-ai-config'] });
      setTimeout(() => setPlanSaved(false), 3000);
    },
    onError: (error: unknown) => {
      setPlanError(getApiErrorMessage(error, t, t('platformAi.messages.planSaveFailed')));
    },
  });

  if (!claims?.isPlatformAdmin) {
    return <ForbiddenPage />;
  }

  return (
    <>
      <PageHeader title={t('platformAi.title')} />
      <Stack spacing={2} maxWidth={1080}>
        {configQuery.isLoading ? (
          <Card>
            <CardContent>
              <Box display="flex" justifyContent="center" py={4}>
                <CircularProgress size={28} />
              </Box>
            </CardContent>
          </Card>
        ) : configQuery.isError ? (
          <Alert severity="error">
            {getApiErrorMessage(configQuery.error, t, t('platformAi.messages.loadFailed'))}
          </Alert>
        ) : configQuery.data ? (
          <>
            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">{t('platformAi.cards.provider')}</Typography>

                  {configSaved ? <Alert severity="success">{t('platformAi.messages.saved')}</Alert> : null}
                  {configError ? <Alert severity="error">{configError}</Alert> : null}
                  {testResult ? (
                    <Alert severity={testResult.ok ? 'success' : 'error'}>
                      {testResult.message}
                    </Alert>
                  ) : null}

                  <FormControl size="small" fullWidth>
                    <InputLabel>{t('platformAi.fields.provider')}</InputLabel>
                    <Select
                      value={configForm.provider}
                      label={t('platformAi.fields.provider')}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, provider: String(event.target.value) }))}
                    >
                      {configQuery.data.available_providers.map((provider) => (
                        <MenuItem key={provider.id} value={provider.id}>
                          {provider.label}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>

                  <TextField
                    size="small"
                    label={t('platformAi.fields.model')}
                    value={configForm.model}
                    onChange={(event) => setConfigForm((prev) => ({ ...prev, model: event.target.value }))}
                  />

                  <TextField
                    size="small"
                    label={t('platformAi.fields.apiKey')}
                    type="password"
                    value={configForm.api_key}
                    onChange={(event) => setConfigForm((prev) => ({ ...prev, api_key: event.target.value }))}
                    placeholder={configQuery.data.config?.has_api_key ? t('platformAi.placeholders.keepKey') : t('platformAi.placeholders.enterKey')}
                  />

                  <TextField
                    size="small"
                    label={t('platformAi.fields.endpointUrl')}
                    value={configForm.endpoint_url}
                    onChange={(event) => setConfigForm((prev) => ({ ...prev, endpoint_url: event.target.value }))}
                  />

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <TextField
                      size="small"
                      type="number"
                      label={t('platformAi.fields.tenantRateLimit')}
                      value={configForm.rate_limit_tenant_per_minute}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, rate_limit_tenant_per_minute: event.target.value }))}
                    />
                    <TextField
                      size="small"
                      type="number"
                      label={t('platformAi.fields.userRateLimit')}
                      value={configForm.rate_limit_user_per_hour}
                      onChange={(event) => setConfigForm((prev) => ({ ...prev, rate_limit_user_per_hour: event.target.value }))}
                    />
                  </Stack>

                  <Typography variant="subtitle2" color="text.secondary">{t('platformAi.disclosure.title')}</Typography>
                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                    <PropertyRow label={t('platformAi.fields.disclosureName')} sx={{ flex: 1 }}>
                      <TextField
                        variant="standard"
                        fullWidth
                        value={configForm.disclosure_name}
                        inputProps={{ maxLength: 80, 'aria-label': t('platformAi.fields.disclosureName') }}
                        placeholder={t('platformAi.disclosure.namePlaceholder')}
                        onChange={(event) => setConfigForm((prev) => ({ ...prev, disclosure_name: event.target.value }))}
                      />
                    </PropertyRow>
                    <PropertyRow label={t('platformAi.fields.disclosureLocation')} sx={{ flex: 1 }}>
                      <Select
                        variant="standard"
                        fullWidth
                        displayEmpty
                        value={configForm.disclosure_location}
                        SelectDisplayProps={{ 'aria-label': t('platformAi.fields.disclosureLocation') } as React.HTMLAttributes<HTMLDivElement>}
                        onChange={(event) => setConfigForm((prev) => ({ ...prev, disclosure_location: String(event.target.value) }))}
                      >
                        <MenuItem value="" sx={drawerMenuItemSx}>{t('platformAi.disclosure.locationNotSet')}</MenuItem>
                        {INCLUDED_MODEL_LOCATIONS.map((code) => (
                          <MenuItem key={code} value={code} sx={drawerMenuItemSx}>{regionName(code)}</MenuItem>
                        ))}
                        {configForm.disclosure_location && !(INCLUDED_MODEL_LOCATIONS as readonly string[]).includes(configForm.disclosure_location) ? (
                          <MenuItem value={configForm.disclosure_location} sx={drawerMenuItemSx}>{regionName(configForm.disclosure_location)}</MenuItem>
                        ) : null}
                      </Select>
                    </PropertyRow>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">{t('platformAi.disclosure.hint')}</Typography>

                  <Stack direction="row" spacing={2}>
                    <Button
                      variant="contained"
                      onClick={saveConfig}
                      disabled={saveConfigMutation.isPending}
                    >
                      {saveConfigMutation.isPending ? t('common:status.saving') : t('platformAi.actions.save')}
                    </Button>
                    <Button
                      variant="outlined"
                      onClick={() => testConfigMutation.mutate()}
                      disabled={testConfigMutation.isPending}
                    >
                      {testConfigMutation.isPending ? t('platformAi.actions.testing') : t('platformAi.actions.test')}
                    </Button>
                  </Stack>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">{t('platformAi.cards.planLimits')}</Typography>
                  {planSaved ? <Alert severity="success">{t('platformAi.messages.planSaved')}</Alert> : null}
                  {planError ? <Alert severity="error">{planError}</Alert> : null}

                  <TextField
                    size="small"
                    type="number"
                    label={t('platformAi.planLimits.monthlyLimit')}
                    helperText={t('platformAi.planLimits.hint')}
                    value={freeMessageLimit}
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      setFreeMessageLimit(Number.isFinite(next) ? next : 0);
                    }}
                    inputProps={{ min: 0 }}
                    sx={{ maxWidth: 320 }}
                  />

                  <Button
                    variant="contained"
                    onClick={() => savePlanLimitsMutation.mutate()}
                    disabled={savePlanLimitsMutation.isPending}
                    sx={{ alignSelf: 'flex-start' }}
                  >
                    {savePlanLimitsMutation.isPending ? t('common:status.saving') : t('platformAi.actions.savePlanLimits')}
                  </Button>
                </Stack>
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Typography variant="h6">{t('platformAi.cards.usage')}</Typography>
                  {configQuery.data.usage.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      {t('platformAi.usage.empty')}
                    </Typography>
                  ) : (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('platformAi.usage.tenant')}</TableCell>
                          <TableCell align="right">{t('platformAi.usage.used')}</TableCell>
                          <TableCell align="right">{t('platformAi.usage.limit')}</TableCell>
                          <TableCell align="right">{t('platformAi.usage.percent')}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {configQuery.data.usage.map((item) => {
                          const percent = item.limit && item.limit > 0
                            ? Math.min(100, Math.round((item.used / item.limit) * 100))
                            : 0;
                          return (
                            <TableRow key={item.tenant_id}>
                              <TableCell>
                                <Stack spacing={0.5}>
                                  <Typography variant="body2">{item.tenant_name}</Typography>
                                  <Typography variant="caption" color="text.secondary">
                                    {item.tenant_slug}
                                  </Typography>
                                </Stack>
                              </TableCell>
                              <TableCell align="right">{item.used.toLocaleString(locale)}</TableCell>
                              <TableCell align="right">{(item.limit ?? 0).toLocaleString(locale)}</TableCell>
                              <TableCell align="right" sx={{ minWidth: 180 }}>
                                <Stack spacing={1} alignItems="stretch">
                                  <Typography variant="body2">{percent}%</Typography>
                                  <LinearProgress
                                    variant="determinate"
                                    value={percent}
                                    color={percent >= 90 ? 'error' : percent >= 75 ? 'warning' : 'success'}
                                  />
                                </Stack>
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  )}
                </Stack>
              </CardContent>
            </Card>
          </>
        ) : null}
      </Stack>

      <KanapDialog
        open={confirmDisclosureChange}
        title={t('platformAi.disclosure.confirmTitle')}
        onClose={() => setConfirmDisclosureChange(false)}
        onSave={() => saveConfigMutation.mutate()}
        saveLabel={t('platformAi.disclosure.confirmSave')}
        saveLoading={saveConfigMutation.isPending}
      >
        <Stack spacing={1.5}>
          <Typography variant="body2">{t('platformAi.disclosure.confirmBody')}</Typography>
          <Typography variant="body2">
            {t('platformAi.disclosure.confirmShown', {
              name: configForm.disclosure_name.trim(),
              place: regionName(configForm.disclosure_location),
            })}
          </Typography>
        </Stack>
      </KanapDialog>
    </>
  );
}
