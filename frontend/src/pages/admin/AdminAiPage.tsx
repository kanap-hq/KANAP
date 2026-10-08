import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  LinearProgress,
  Link,
  MenuItem,
  Select,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink } from 'react-router-dom';
import PageHeader from '../../components/PageHeader';
import { useFeatures } from '../../config/FeaturesContext';
import { useLocale } from '../../i18n/useLocale';
import {
  aiAdminApi,
  aiKeysApi,
  aiModelConfigsApi,
  type AiSettingsPayload,
  type AiWebSearchTestResult,
} from '../../ai/aiApi';
import { PropertyRow } from '../../components/design';
import { drawerMenuItemSx, drawerSelectSx } from '../../theme/formSx';
import { AiApiKeyRecord } from '../../ai/aiTypes';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { useTheme } from '@mui/material/styles';
import { getDotColor } from '../../utils/statusColors';
import { StatusDot } from '../../components/design';
import {
  BUILTIN_PROVIDER_CHANGED,
  BUILTIN_PROVIDER_CONFIRMATION_REQUIRED,
  identityOf,
  includedModelError,
  type IncludedModelIdentity,
} from '../../ai/includedModel';
import { IncludedModelDialog, IncludedModelStatus, WithdrawIncludedModelDialog } from './IncludedModelConfirmation';

type AiSettingsForm = {
  chat_enabled: boolean;
  mcp_enabled: boolean;
  // '' means "no explicit assignment": tenant default model, then the KANAP included model.
  chat_model_config_id: string;
  mcp_key_max_lifetime_days: string | number;
  conversation_retention_days: string | number;
  web_search_enabled: boolean;
  glpi_enabled: boolean;
  glpi_url: string;
  glpi_user_token: string;
  glpi_app_token: string;
};

const EMPTY_FORM: AiSettingsForm = {
  chat_enabled: false,
  mcp_enabled: false,
  chat_model_config_id: '',
  mcp_key_max_lifetime_days: '',
  conversation_retention_days: '',
  web_search_enabled: false,
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

function formatNumber(value: number | null | undefined, locale: string): string {
  return new Intl.NumberFormat(locale).format(value ?? 0);
}

function getValidationErrors(error: any): string[] {
  const payload = error?.response?.data;
  if (Array.isArray(payload?.errors)) return payload.errors.map(String);
  if (Array.isArray(payload?.validation_errors)) return payload.validation_errors.map(String);
  if (Array.isArray(payload?.message)) return payload.message.map(String);
  return [];
}

function buildSettingsForm(settings: AiSettingsPayload['settings']): AiSettingsForm {
  return {
    chat_enabled: settings.chat_enabled,
    mcp_enabled: settings.mcp_enabled,
    chat_model_config_id: settings.chat_model_config_id ?? '',
    mcp_key_max_lifetime_days: settings.mcp_key_max_lifetime_days ?? '',
    conversation_retention_days: settings.conversation_retention_days ?? '',
    web_search_enabled: settings.web_search_enabled,
    glpi_enabled: settings.glpi_enabled,
    glpi_url: settings.glpi_url || '',
    glpi_user_token: '',
    glpi_app_token: '',
  };
}

function buildSettingsUpdatePayload(
  form: AiSettingsForm,
  settings: AiSettingsPayload['settings'],
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};

  if (form.chat_enabled !== settings.chat_enabled) payload.chat_enabled = form.chat_enabled;
  if (form.mcp_enabled !== settings.mcp_enabled) payload.mcp_enabled = form.mcp_enabled;

  const chatModelConfigId = form.chat_model_config_id || null;
  if (chatModelConfigId !== (settings.chat_model_config_id ?? null)) {
    payload.chat_model_config_id = chatModelConfigId;
  }

  const maxLifetime = form.mcp_key_max_lifetime_days === '' ? null : Number(form.mcp_key_max_lifetime_days);
  if (maxLifetime !== settings.mcp_key_max_lifetime_days) {
    payload.mcp_key_max_lifetime_days = maxLifetime;
  }

  const retention = form.conversation_retention_days === '' ? null : Number(form.conversation_retention_days);
  if (retention !== settings.conversation_retention_days) {
    payload.conversation_retention_days = retention;
  }

  if (form.web_search_enabled !== settings.web_search_enabled) {
    payload.web_search_enabled = form.web_search_enabled;
  }

  if (form.glpi_enabled !== settings.glpi_enabled) {
    payload.glpi_enabled = form.glpi_enabled;
  }

  const glpiUrl = normalizeNullableString(form.glpi_url);
  if (glpiUrl !== settings.glpi_url) {
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

function getBuiltinUsageRatio(usage?: { count: number; limit: number } | null): number {
  if (!usage || usage.limit <= 0) {
    return 0;
  }
  return Math.min(1, usage.count / usage.limit);
}

function ValidationErrorList({ errors }: { errors: string[] }) {
  return (
    <Stack component="ul" spacing={0.5} sx={{ pl: 2, m: 0 }}>
      {errors.map((error) => (
        <Typography key={error} component="li" variant="body2">
          {error}
        </Typography>
      ))}
    </Stack>
  );
}

export default function AdminAiPage() {
  const { config } = useFeatures();
  const queryClient = useQueryClient();
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { mode } = useTheme().palette;

  const [form, setForm] = useState<AiSettingsForm>(EMPTY_FORM);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [webSearchTestResult, setWebSearchTestResult] = useState<AiWebSearchTestResult | null>(null);
  const [createKeyDialog, setCreateKeyDialog] = useState(false);
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [keyActionError, setKeyActionError] = useState<string | null>(null);
  // Confirmation of the KANAP included model: alone, or with the settings save that turns the assistant on.
  const [includedDialog, setIncludedDialog] = useState<{
    identity: IncludedModelIdentity;
    payload: Record<string, unknown>;
    activating: boolean;
  } | null>(null);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [includedError, setIncludedError] = useState<string | null>(null);
  // A confirmation or a withdrawal saved alone touches no form field: the settings it
  // returns (by updated_at) reload without resetting changes not saved yet.
  const keepFormForUpdate = React.useRef<string | null>(null);

  const settingsQuery = useQuery<AiSettingsPayload>({
    queryKey: ['admin-ai-settings'],
    queryFn: () => aiAdminApi.getSettings(),
    enabled: config.features.aiSettings,
  });

  const modelConfigsQuery = useQuery({
    queryKey: ['ai-model-configs'],
    queryFn: () => aiModelConfigsApi.list(),
    enabled: config.features.aiSettings,
  });

  const builtinUsageQuery = useQuery({
    queryKey: ['admin-ai-builtin-usage'],
    queryFn: () => aiAdminApi.getBuiltinUsage(),
    enabled: config.features.aiSettings && config.features.builtinAiProvider,
  });

  const keysQuery = useQuery<AiApiKeyRecord[]>({
    queryKey: ['admin-ai-keys'],
    queryFn: () => aiKeysApi.adminList(),
    enabled: config.features.aiSettings,
  });

  React.useEffect(() => {
    if (settingsQuery.data) {
      if (keepFormForUpdate.current && keepFormForUpdate.current === settingsQuery.data.settings.updated_at) {
        keepFormForUpdate.current = null;
        return;
      }
      setForm(buildSettingsForm(settingsQuery.data.settings));
    }
  }, [settingsQuery.data?.settings.updated_at]);

  const saveMutation = useMutation({
    mutationFn: async (data: AiSettingsForm) => {
      if (!settingsQuery.data) return false;
      const payload = buildSettingsUpdatePayload(data, settingsQuery.data.settings);
      if (Object.keys(payload).length === 0) return false;
      await aiAdminApi.updateSettings(payload);
      return true;
    },
    onMutate: () => {
      setSaveSuccess(false);
      setSaveError(null);
    },
    onSuccess: async (updated) => {
      if (!updated) return;
      setSaveSuccess(true);
      setSaveError(null);
      setForm((prev) => ({ ...prev, glpi_user_token: '', glpi_app_token: '' }));
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-builtin-usage'] });
      await queryClient.invalidateQueries({ queryKey: ['ai-model-configs'] });
      setTimeout(() => setSaveSuccess(false), 3000);
    },
    onError: (error: any, data) => {
      const included = includedModelError(error);
      if (included?.code === BUILTIN_PROVIDER_CONFIRMATION_REQUIRED && included.identity && settingsQuery.data) {
        // Nothing was saved: the same changes go again with the confirmation.
        setIncludedError(null);
        setIncludedDialog({
          identity: included.identity,
          payload: buildSettingsUpdatePayload(data, settingsQuery.data.settings),
          activating: true,
        });
        return;
      }
      const validationErrors = getValidationErrors(error);
      const message = getApiErrorMessage(error, t, t('aiAdmin.messages.saveFailed'));
      setSaveError(validationErrors.length > 0 ? `${message} ${validationErrors.join(' ')}` : message);
    },
  });

  const includedMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => aiAdminApi.updateSettings(payload),
    onMutate: () => {
      setIncludedError(null);
    },
    onSuccess: async (result, payload) => {
      const activating = Object.prototype.hasOwnProperty.call(payload, 'chat_enabled');
      setIncludedDialog(null);
      setWithdrawOpen(false);
      if (activating) {
        setSaveSuccess(true);
        setForm((prev) => ({ ...prev, glpi_user_token: '', glpi_app_token: '' }));
        setTimeout(() => setSaveSuccess(false), 3000);
      } else {
        keepFormForUpdate.current = result?.settings?.updated_at ?? null;
      }
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-settings'] });
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-builtin-usage'] });
      await queryClient.invalidateQueries({ queryKey: ['ai-capabilities'] });
    },
    onError: async (error: any) => {
      const included = includedModelError(error);
      if (included?.code === BUILTIN_PROVIDER_CHANGED && includedDialog) {
        // The platform changed the provider or its location meanwhile: show the new one.
        const refreshed = await settingsQuery.refetch();
        const identity = included.identity ?? identityOf(refreshed.data?.settings.builtin_provider);
        if (identity) {
          setIncludedDialog({ ...includedDialog, identity });
          setIncludedError(t('aiAdmin.includedModel.changed'));
          return;
        }
      }
      setIncludedError(getApiErrorMessage(error, t, t('aiAdmin.messages.saveFailed')));
    },
  });

  const testWebSearchMutation = useMutation({
    mutationFn: async () => aiAdminApi.testWebSearch(),
    onMutate: () => {
      setWebSearchTestResult(null);
    },
    onSuccess: (result) => {
      setWebSearchTestResult(result);
    },
    onError: (error: any) => {
      setWebSearchTestResult({
        ok: false,
        message: getApiErrorMessage(error, t, t('aiAdmin.messages.webSearchTestFailed')),
        latency_ms: null,
      });
    },
  });

  const createKeyMutation = useMutation({
    mutationFn: (label: string) => aiKeysApi.create({ label }),
    onMutate: () => {
      setKeyActionError(null);
    },
    onSuccess: async (data) => {
      setCreatedKey(data.key);
      setNewKeyLabel('');
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-keys'] });
    },
    onError: (error: any) => {
      setKeyActionError(getApiErrorMessage(error, t, t('aiAdmin.messages.createMcpKeyFailed')));
    },
  });

  const revokeKeyMutation = useMutation({
    mutationFn: (id: string) => aiKeysApi.adminRevoke(id),
    onMutate: () => {
      setKeyActionError(null);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-ai-keys'] });
    },
    onError: (error: any) => {
      setKeyActionError(getApiErrorMessage(error, t, t('aiAdmin.messages.revokeMcpKeyFailed')));
    },
  });

  const currentSettings = settingsQuery.data?.settings;
  const builtinUsageRatio = getBuiltinUsageRatio(builtinUsageQuery.data);
  const builtinUsageColor = builtinUsageRatio >= 0.9 ? 'error' : builtinUsageRatio >= 0.75 ? 'warning' : 'success';
  const activeModelConfigs = (modelConfigsQuery.data?.model_configs ?? []).filter((entry) => entry.status === 'active');
  const defaultModelName = activeModelConfigs.find((entry) => entry.is_default)?.name ?? null;
  // With no explicit assignment, chat falls back to the tenant default model,
  // then to the KANAP included model — the quota card only matters on that path.
  const chatUsesBuiltin = config.features.builtinAiProvider && form.chat_model_config_id === '' && !defaultModelName;
  const includedModel = currentSettings?.builtin_provider?.in_use ? currentSettings.builtin_provider : null;
  // The assistant waits for the included model's confirmation: the status line says so,
  // with no validation list and no "provider incomplete" chip on top.
  const awaitingIncludedConfirmation = !!includedModel?.used_by_assistant && !includedModel.accepted;

  return (
    <>
      <PageHeader title={t('aiAdmin.title')} />
      <Stack spacing={2} maxWidth={980}>
        {!config.features.aiSettings ? (
          <Alert severity="warning">{t('aiAdmin.messages.disabled')}</Alert>
        ) : (
          <>
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
                      <AutoAwesomeIcon sx={{ color: 'text.secondary' }} />
                      <Typography variant="h6">{t('aiAdmin.provider.title')}</Typography>
                      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ ml: 'auto' }}>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <StatusDot color={getDotColor(settingsQuery.data.settings.chat_enabled ? 'success' : 'default', mode)} />
                          <Typography variant="body2" sx={{ color: getDotColor(settingsQuery.data.settings.chat_enabled ? 'success' : 'default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{settingsQuery.data.settings.chat_enabled ? t('aiAdmin.provider.chips.chatEnabled') : t('aiAdmin.provider.chips.chatDisabled')}</Typography>
                        </Box>
                        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                          <StatusDot color={getDotColor(settingsQuery.data.settings.mcp_enabled ? 'success' : 'default', mode)} />
                          <Typography variant="body2" sx={{ color: getDotColor(settingsQuery.data.settings.mcp_enabled ? 'success' : 'default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{settingsQuery.data.settings.mcp_enabled ? t('aiAdmin.provider.chips.mcpEnabled') : t('aiAdmin.provider.chips.mcpDisabled')}</Typography>
                        </Box>
                        {awaitingIncludedConfirmation ? null : (
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                            <StatusDot color={getDotColor(settingsQuery.data.settings.chat_ready ? 'success' : 'default', mode)} />
                            <Typography variant="body2" sx={{ color: getDotColor(settingsQuery.data.settings.chat_ready ? 'success' : 'default', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{settingsQuery.data.settings.chat_ready ? t('aiAdmin.provider.chips.providerReady') : t('aiAdmin.provider.chips.providerIncomplete')}</Typography>
                          </Box>
                        )}
                      </Stack>
                    </Stack>

                    {currentSettings?.provider_validation_errors.length && !awaitingIncludedConfirmation ? (
                      <Alert severity="warning" variant="outlined">
                        <Stack spacing={0.75}>
                          <Typography variant="body2" fontWeight={600}>
                            {t('aiAdmin.provider.validationErrorsTitle')}
                          </Typography>
                          <ValidationErrorList errors={currentSettings.provider_validation_errors} />
                        </Stack>
                      </Alert>
                    ) : null}

                    <PropertyRow label={t('aiAdmin.provider.modelSelector.label')}>
                      <Select
                        variant="standard"
                        value={form.chat_model_config_id}
                        displayEmpty
                        sx={[drawerSelectSx, { maxWidth: 420 }]}
                        onChange={(event) => {
                          setForm((prev) => ({ ...prev, chat_model_config_id: String(event.target.value) }));
                        }}
                      >
                        <MenuItem value="" sx={drawerMenuItemSx}>
                          {defaultModelName
                            ? t('aiAdmin.provider.modelSelector.tenantDefault', { name: defaultModelName })
                            : config.features.builtinAiProvider
                              ? t('aiAdmin.provider.modelSelector.builtin')
                              : t('aiAdmin.provider.modelSelector.noDefault')}
                        </MenuItem>
                        {activeModelConfigs.map((modelConfig) => (
                          <MenuItem key={modelConfig.id} value={modelConfig.id} sx={drawerMenuItemSx}>
                            {modelConfig.name}
                          </MenuItem>
                        ))}
                      </Select>
                      <Typography variant="caption" color="text.secondary">
                        {t('aiAdmin.provider.modelSelector.hintPrefix')}{' '}
                        <Link component={RouterLink} to="/admin/ai-models">{t('aiAdmin.provider.modelSelector.hintLink')}</Link>
                      </Typography>
                    </PropertyRow>

                    {includedModel ? (
                      <IncludedModelStatus
                        provider={includedModel}
                        disabled={includedMutation.isPending}
                        onConfirm={() => {
                          const identity = identityOf(includedModel);
                          if (!identity) return;
                          setIncludedError(null);
                          setIncludedDialog({ identity, payload: {}, activating: false });
                        }}
                        onWithdraw={() => {
                          setIncludedError(null);
                          setWithdrawOpen(true);
                        }}
                      />
                    ) : null}

                    {chatUsesBuiltin ? (
                      <Card variant="outlined">
                        <CardContent>
                          <Stack spacing={1.5}>
                            <Typography variant="subtitle2">
                              {t('aiAdmin.provider.builtinUsage.title')}
                            </Typography>
                            <Typography variant="body2" color="text.secondary">
                              {t('aiAdmin.provider.builtinUsage.description')}
                            </Typography>
                            {builtinUsageQuery.isLoading ? (
                              <Box display="flex" justifyContent="center" py={2}>
                                <CircularProgress size={24} />
                              </Box>
                            ) : builtinUsageQuery.isError ? (
                              <Alert severity="error">
                                {getApiErrorMessage(builtinUsageQuery.error, t, t('aiAdmin.provider.builtinUsage.loadFailed'))}
                              </Alert>
                            ) : builtinUsageQuery.data ? (
                              <>
                                <Typography variant="body2">
                                  {t('aiAdmin.provider.builtinUsage.summary', {
                                    count: builtinUsageQuery.data.count,
                                    limit: builtinUsageQuery.data.limit,
                                  })}
                                </Typography>
                                <LinearProgress
                                  variant="determinate"
                                  value={Math.round(builtinUsageRatio * 100)}
                                  color={builtinUsageColor}
                                />
                                <Typography variant="caption" color="text.secondary">
                                  {t('aiAdmin.provider.builtinUsage.reset', {
                                    date: new Date(builtinUsageQuery.data.reset_date).toLocaleDateString(locale),
                                  })}
                                </Typography>
                                <Typography variant="caption" color="text.secondary">
                                  {t('aiAdmin.provider.builtinUsage.cta')}
                                </Typography>
                              </>
                            ) : null}
                          </Stack>
                        </CardContent>
                      </Card>
                    ) : null}

                    <Divider />

                    <Typography variant="subtitle2" color="text.secondary">{t('aiAdmin.sections.features')}</Typography>

                    <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
                      <FormControlLabel
                        control={
                          <Switch
                            checked={form.chat_enabled}
                            onChange={(event) => setForm((prev) => ({ ...prev, chat_enabled: event.target.checked }))}
                          />
                        }
                        label={t('aiAdmin.features.enableChat')}
                      />
                      <FormControlLabel
                        control={
                          <Switch
                            checked={form.mcp_enabled}
                            onChange={(event) => setForm((prev) => ({ ...prev, mcp_enabled: event.target.checked }))}
                          />
                        }
                        label={t('aiAdmin.features.enableMcp')}
                      />
                      <Tooltip title={settingsQuery.data?.instance_features.ai_web_search ? '' : t('aiAdmin.features.braveSearchNotConfigured')}>
                        <span>
                          <FormControlLabel
                            control={
                              <Switch
                                checked={form.web_search_enabled}
                                disabled={!settingsQuery.data?.instance_features.ai_web_search}
                                onChange={(event) => {
                                  const checked = event.target.checked;
                                  setForm((prev) => ({
                                    ...prev,
                                    web_search_enabled: checked,
                                  }));
                                  if (checked) {
                                    setWebSearchTestResult(null);
                                    testWebSearchMutation.mutate();
                                  }
                                }}
                              />
                            }
                            label={t('aiAdmin.features.webSearch')}
                          />
                        </span>
                      </Tooltip>
                    </Stack>

                    {webSearchTestResult ? (
                      <Alert
                        severity={webSearchTestResult.ok ? 'success' : 'error'}
                        onClose={() => setWebSearchTestResult(null)}
                      >
                        {webSearchTestResult.message}
                        {webSearchTestResult.latency_ms != null ? ` (${webSearchTestResult.latency_ms}ms)` : ''}
                      </Alert>
                    ) : testWebSearchMutation.isPending ? (
                      <Alert severity="info">{t('aiAdmin.messages.testingWebSearch')}</Alert>
                    ) : null}

                    <Divider />

                    <Typography variant="subtitle2" color="text.secondary">{t('aiAdmin.sections.retention')}</Typography>

                    <TextField
                      size="small"
                      label={t('aiAdmin.fields.conversationRetentionDays')}
                      type="number"
                      value={form.conversation_retention_days}
                      onChange={(event) => setForm((prev) => ({ ...prev, conversation_retention_days: event.target.value }))}
                      sx={{ width: 240 }}
                    />

                    {saveSuccess ? <Alert severity="success">{t('aiAdmin.messages.settingsSaved')}</Alert> : null}
                    {saveError ? <Alert severity="error">{saveError}</Alert> : null}

                    <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
                      <Button
                        variant="contained"
                        onClick={() => saveMutation.mutate(form)}
                        disabled={saveMutation.isPending}
                      >
                        {saveMutation.isPending ? t('common:status.saving') : t('aiAdmin.actions.saveSettings')}
                      </Button>
                    </Stack>
                  </Stack>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Typography variant="h6">{t('aiAdmin.keys.title')}</Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => {
                        setCreateKeyDialog(true);
                        setCreatedKey(null);
                        setKeyActionError(null);
                      }}
                    >
                      {t('aiAdmin.actions.createKey')}
                    </Button>
                  </Stack>

                  <TextField
                    size="small"
                    label={t('aiAdmin.fields.keyMaxLifetimeDays')}
                    type="number"
                    value={form.mcp_key_max_lifetime_days}
                    onChange={(event) => setForm((prev) => ({ ...prev, mcp_key_max_lifetime_days: event.target.value }))}
                    helperText={t('aiAdmin.fields.keyMaxLifetimeHelper')}
                    sx={{ width: 240 }}
                  />

                  {keyActionError ? <Alert severity="error">{keyActionError}</Alert> : null}

                  {keysQuery.isLoading ? (
                    <Box display="flex" justifyContent="center" py={3}>
                      <CircularProgress size={28} />
                    </Box>
                  ) : keysQuery.isError ? (
                    <Alert severity="error">
                      {getApiErrorMessage(keysQuery.error, t, t('aiAdmin.messages.loadKeysFailed'))}
                    </Alert>
                  ) : keysQuery.data && keysQuery.data.length > 0 ? (
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t('aiAdmin.keys.columns.label')}</TableCell>
                          <TableCell>{t('aiAdmin.keys.columns.prefix')}</TableCell>
                          <TableCell>{t('aiAdmin.keys.columns.created')}</TableCell>
                          <TableCell>{t('aiAdmin.keys.columns.expires')}</TableCell>
                          <TableCell>{t('aiAdmin.keys.columns.lastUsed')}</TableCell>
                          <TableCell>{t('aiAdmin.keys.columns.status')}</TableCell>
                          <TableCell />
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {keysQuery.data.map((key) => (
                          <TableRow key={key.id}>
                            <TableCell>{key.label}</TableCell>
                            <TableCell><code>{key.key_prefix}</code></TableCell>
                            <TableCell>{new Date(key.created_at).toLocaleDateString(locale)}</TableCell>
                            <TableCell>{key.expires_at ? new Date(key.expires_at).toLocaleDateString(locale) : t('aiAdmin.shared.never')}</TableCell>
                            <TableCell>{key.last_used_at ? new Date(key.last_used_at).toLocaleString(locale) : t('aiAdmin.shared.never')}</TableCell>
                            <TableCell>
                              {key.revoked_at ? (
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                  <StatusDot color={getDotColor('error', mode)} />
                                  <Typography variant="body2" sx={{ color: getDotColor('error', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('aiAdmin.keys.statuses.revoked')}</Typography>
                                </Box>
                              ) : (
                                <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
                                  <StatusDot color={getDotColor('success', mode)} />
                                  <Typography variant="body2" sx={{ color: getDotColor('success', mode), fontWeight: 500, fontSize: '0.8125rem' }}>{t('aiAdmin.keys.statuses.active')}</Typography>
                                </Box>
                              )}
                            </TableCell>
                            <TableCell>
                              {!key.revoked_at ? (
                                <IconButton
                                  size="small"
                                  onClick={() => revokeKeyMutation.mutate(key.id)}
                                  disabled={revokeKeyMutation.isPending}
                                >
                                  <DeleteOutlineIcon fontSize="small" />
                                </IconButton>
                              ) : null}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t('aiAdmin.keys.empty')}
                    </Typography>
                  )}
                </Stack>
              </CardContent>
            </Card>

          </>
        )}
      </Stack>

      <IncludedModelDialog
        open={!!includedDialog}
        identity={includedDialog?.identity ?? null}
        activating={includedDialog?.activating ?? false}
        loading={includedMutation.isPending}
        error={includedError}
        onCancel={() => setIncludedDialog(null)}
        onConfirm={() => {
          if (!includedDialog) return;
          includedMutation.mutate({ ...includedDialog.payload, accept_builtin_provider_key: includedDialog.identity.key });
        }}
      />

      <WithdrawIncludedModelDialog
        open={withdrawOpen}
        loading={includedMutation.isPending}
        error={includedError}
        onCancel={() => setWithdrawOpen(false)}
        onConfirm={() => includedMutation.mutate({ accept_builtin_provider_key: null })}
      />

      <Dialog
        open={createKeyDialog}
        onClose={() => {
          setCreateKeyDialog(false);
          setCreatedKey(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{createdKey ? t('aiAdmin.dialogs.keyCreatedTitle') : t('aiAdmin.dialogs.createKeyTitle')}</DialogTitle>
        <DialogContent>
          {createdKey ? (
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert severity="warning">{t('aiAdmin.dialogs.copyKeyWarning')}</Alert>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  fullWidth
                  size="small"
                  value={createdKey}
                  InputProps={{ readOnly: true, sx: { fontFamily: 'monospace', fontSize: '0.85rem' } }}
                />
                <IconButton onClick={() => navigator.clipboard.writeText(createdKey)}>
                  <ContentCopyIcon />
                </IconButton>
              </Stack>
            </Stack>
          ) : (
            <Stack spacing={2} sx={{ mt: 1 }}>
              {keyActionError ? <Alert severity="error">{keyActionError}</Alert> : null}
              <TextField
                autoFocus
                fullWidth
                size="small"
                label={t('aiAdmin.fields.label')}
                value={newKeyLabel}
                onChange={(event) => setNewKeyLabel(event.target.value)}
                placeholder={t('aiAdmin.fields.labelPlaceholder')}
              />
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          {createdKey ? (
            <Button onClick={() => { setCreateKeyDialog(false); setCreatedKey(null); }}>{t('aiAdmin.actions.done')}</Button>
          ) : (
            <>
              <Button onClick={() => setCreateKeyDialog(false)}>{t('common:buttons.cancel')}</Button>
              <Button
                variant="contained"
                onClick={() => createKeyMutation.mutate(newKeyLabel)}
                disabled={!newKeyLabel.trim() || createKeyMutation.isPending}
              >
                {createKeyMutation.isPending ? t('aiAdmin.actions.creating') : t('common:buttons.create')}
              </Button>
            </>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
}
