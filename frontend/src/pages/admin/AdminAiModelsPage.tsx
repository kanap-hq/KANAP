import React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  IconButton,
  LinearProgress,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import EditIcon from '@mui/icons-material/Edit';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import PageHeader from '../../components/PageHeader';
import { EmptyState, Section } from '../../components/agents/agentControlPrimitives';
import { PropertyRow } from '../../components/design';
import KanapDialog from '../../components/design/KanapDialog';
import { useFeatures } from '../../config/FeaturesContext';
import { useLocale } from '../../i18n/useLocale';
import {
  AiModelConfig,
  AiModelConfigInput,
  AiProviderTestResult,
  aiAdminApi,
  aiModelConfigsApi,
} from '../../ai/aiApi';
import { drawerMenuItemSx, drawerSelectSx, drawerFieldValueSx } from '../../theme/formSx';

export const AI_MODEL_CONFIGS_QUERY_KEY = ['ai-model-configs'];

type DraftState = {
  name: string;
  provider: string;
  model: string;
  endpoint_url: string;
  api_key: string;
  supports_vision: boolean;
  price_input: string;
  price_output: string;
  timeout_seconds: string;
};

const EMPTY_DRAFT: DraftState = {
  name: '',
  provider: 'anthropic',
  model: '',
  endpoint_url: '',
  api_key: '',
  supports_vision: true,
  price_input: '',
  price_output: '',
  timeout_seconds: '',
};

function parsePriceInput(value: string): number | null | undefined {
  const trimmed = value.trim().replace(',', '.');
  if (trimmed === '') return null;
  const parsed = Number.parseFloat(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function draftFromConfig(config: AiModelConfig): DraftState {
  return {
    name: config.name,
    provider: config.provider,
    model: config.model,
    endpoint_url: config.endpoint_url ?? '',
    api_key: '',
    supports_vision: config.supports_vision,
    price_input: config.price_input_eur_per_mtok != null ? String(config.price_input_eur_per_mtok) : '',
    price_output: config.price_output_eur_per_mtok != null ? String(config.price_output_eur_per_mtok) : '',
    timeout_seconds: config.llm_timeout_ms != null ? String(Math.round(config.llm_timeout_ms / 1000)) : '',
  };
}

const headerCellSx = {
  fontSize: 12,
  fontWeight: 500,
  color: 'kanap.text.tertiary',
  textAlign: 'left' as const,
  padding: '8px 12px',
  borderBottom: '1px solid',
  borderColor: 'kanap.border.default',
  whiteSpace: 'nowrap' as const,
};

const cellSx = {
  fontSize: 13,
  color: 'kanap.text.primary',
  padding: '9px 12px',
  borderBottom: '1px solid',
  borderColor: 'kanap.border.soft',
  verticalAlign: 'middle' as const,
};

const API_KEY_MASK = '••••••••';

function LabelWithInfo({ label, info }: { label: string; info: string }) {
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
      {label}
      <Tooltip title={info} placement="top">
        <Box
          component="span"
          sx={{ display: 'inline-flex', color: 'kanap.text.tertiary', lineHeight: 0 }}
          aria-label={info}
        >
          <InfoOutlinedIcon sx={{ fontSize: 13 }} />
        </Box>
      </Tooltip>
    </Box>
  );
}

function DefaultStar({
  isDefault,
  label,
  onToggle,
}: {
  isDefault: boolean;
  label: string;
  onToggle?: () => void;
}) {
  const icon = isDefault ? (
    <StarIcon fontSize="small" sx={{ color: 'kanap.text.primary' }} />
  ) : (
    <StarBorderIcon fontSize="small" sx={{ color: 'kanap.text.secondary' }} />
  );

  if (!onToggle) {
    return (
      <Tooltip title={label}>
        <Box component="span" sx={{ display: 'inline-flex', p: 0.5 }} aria-label={label}>
          {icon}
        </Box>
      </Tooltip>
    );
  }

  return (
    <Tooltip title={label}>
      <IconButton size="small" aria-label={label} onClick={onToggle}>
        {icon}
      </IconButton>
    </Tooltip>
  );
}

export default function AdminAiModelsPage() {
  const { t } = useTranslation(['admin', 'common']);
  const locale = useLocale();
  const { config } = useFeatures();
  const queryClient = useQueryClient();

  const modelsQuery = useQuery({
    queryKey: AI_MODEL_CONFIGS_QUERY_KEY,
    queryFn: () => aiModelConfigsApi.list(),
  });
  const settingsQuery = useQuery({
    queryKey: ['ai-admin-settings'],
    queryFn: () => aiAdminApi.getSettings(),
    staleTime: 60_000,
  });
  const builtinUsageQuery = useQuery({
    queryKey: ['ai-builtin-usage'],
    queryFn: () => aiAdminApi.getBuiltinUsage(),
    enabled: config.features.builtinAiProvider,
    staleTime: 60_000,
  });

  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<DraftState>(EMPTY_DRAFT);
  const [hasStoredKey, setHasStoredKey] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [testResult, setTestResult] = React.useState<AiProviderTestResult | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: AI_MODEL_CONFIGS_QUERY_KEY });
  };
  const readError = (err: unknown, fallback: string): string => {
    const data = (err as { response?: { data?: { message?: string; used_by?: string[] } } })?.response?.data;
    if (data?.used_by?.length) {
      return t('aiModels.errors.stillAssigned', { consumers: data.used_by.join(', ') });
    }
    return data?.message ?? fallback;
  };

  const saveMutation = useMutation({
    mutationFn: (input: { id: string | null; payload: AiModelConfigInput }) =>
      input.id ? aiModelConfigsApi.update(input.id, input.payload) : aiModelConfigsApi.create(input.payload),
    onSuccess: () => { invalidate(); setDialogOpen(false); setError(null); },
    onError: (err) => setError(readError(err, t('aiModels.errors.saveFailed'))),
  });
  const archiveMutation = useMutation({
    mutationFn: (id: string) => aiModelConfigsApi.archive(id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (err) => setError(readError(err, t('aiModels.errors.archiveFailed'))),
  });
  const restoreMutation = useMutation({
    mutationFn: (id: string) => aiModelConfigsApi.restore(id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (err) => setError(readError(err, t('aiModels.errors.saveFailed'))),
  });
  const defaultMutation = useMutation({
    mutationFn: (input: { id: string; makeDefault: boolean }) =>
      input.makeDefault ? aiModelConfigsApi.setDefault(input.id) : aiModelConfigsApi.clearDefault(input.id),
    onSuccess: () => { invalidate(); setError(null); },
    onError: (err) => setError(readError(err, t('aiModels.errors.saveFailed'))),
  });
  const testMutation = useMutation({
    mutationFn: (id: string) => aiModelConfigsApi.test(id),
    onSuccess: (result) => setTestResult(result),
    onError: (err) => setError(readError(err, t('aiModels.errors.testFailed'))),
  });

  const providers = settingsQuery.data?.available_providers ?? [];
  const selectedProvider = providers.find((provider) => provider.id === draft.provider) ?? null;
  const models = modelsQuery.data?.model_configs ?? [];
  const secretWritable = modelsQuery.data?.secret_writable !== false;
  const builtinAvailable = config.features.builtinAiProvider;
  const builtinUsage = builtinUsageQuery.data;
  const tenantDefault = models.find((entry) => entry.is_default && entry.status === 'active') ?? null;
  const builtinIsDefault = builtinAvailable && !tenantDefault;

  const formatPrice = (value: number | null): string => {
    if (value == null) return '—';
    return `${value.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €`;
  };

  const openCreate = () => {
    setEditingId(null);
    setDraft(EMPTY_DRAFT);
    setHasStoredKey(false);
    setError(null);
    setTestResult(null);
    setDialogOpen(true);
  };
  const openEdit = (modelConfig: AiModelConfig) => {
    setEditingId(modelConfig.id);
    setDraft(draftFromConfig(modelConfig));
    setHasStoredKey(modelConfig.has_api_key);
    setError(null);
    setTestResult(null);
    setDialogOpen(true);
  };

  const handleProviderChange = (provider: string) => {
    setDraft((prev) => ({
      ...prev,
      provider,
      // A local model costs nothing — pre-fill so the cost engine treats it as free.
      ...(provider === 'ollama' && prev.price_input === '' && prev.price_output === ''
        ? { price_input: '0', price_output: '0' }
        : {}),
    }));
  };

  const priceInput = parsePriceInput(draft.price_input);
  const priceOutput = parsePriceInput(draft.price_output);
  const timeoutSeconds = draft.timeout_seconds.trim() === '' ? null : Number.parseInt(draft.timeout_seconds, 10);
  const timeoutInvalid = timeoutSeconds != null && (!Number.isInteger(timeoutSeconds) || timeoutSeconds <= 0);
  const showingStoredKey = Boolean(editingId && hasStoredKey && draft.api_key === '');
  const saveDisabled = draft.name.trim() === ''
    || draft.model.trim() === ''
    || priceInput === undefined
    || priceOutput === undefined
    || timeoutInvalid;

  const handleSave = () => {
    if (saveDisabled) return;
    const payload: AiModelConfigInput = {
      name: draft.name.trim(),
      provider: draft.provider,
      model: draft.model.trim(),
      endpoint_url: draft.endpoint_url.trim() || null,
      supports_vision: draft.supports_vision,
      price_input_eur_per_mtok: priceInput ?? null,
      price_output_eur_per_mtok: priceOutput ?? null,
      llm_timeout_ms: timeoutSeconds != null ? timeoutSeconds * 1000 : null,
    };
    if (draft.api_key.trim() !== '') {
      payload.api_key = draft.api_key.trim();
    }
    saveMutation.mutate({ id: editingId, payload });
  };

  const usedByLabels = (modelConfig: AiModelConfig): string[] => [
    ...(modelConfig.used_by.chat ? [t('aiModels.usedByChat')] : []),
    ...modelConfig.used_by.agents.map((agent) => agent.name),
  ];

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={t('aiModels.title')}
        actions={<Button variant="action-primary" onClick={openCreate}>{t('aiModels.new')}</Button>}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('aiModels.subtitle')}</Typography>
      <Stack spacing={2}>
        {error && <Alert severity="error" onClose={() => setError(null)}>{error}</Alert>}
        {!secretWritable && <Alert severity="warning">{t('aiModels.secretNotWritable')}</Alert>}
        <Section title={t('aiModels.sectionTitle')}>
          {modelsQuery.isLoading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
          ) : modelsQuery.isError ? (
            <Alert severity="error">{t('aiModels.errors.loadFailed')}</Alert>
          ) : (
            <Box sx={{ overflowX: 'auto' }}>
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse' }}>
                <Box component="thead">
                  <Box component="tr">
                    <Box component="th" sx={{ ...headerCellSx, width: 72, textAlign: 'center', px: 0.5 }}>
                      {t('aiModels.columns.default')}
                    </Box>
                    <Box component="th" sx={headerCellSx}>{t('aiModels.columns.name')}</Box>
                    <Box component="th" sx={headerCellSx}>{t('aiModels.columns.model')}</Box>
                    <Box component="th" sx={headerCellSx}>{t('aiModels.columns.capabilities')}</Box>
                    <Box component="th" sx={{ ...headerCellSx, textAlign: 'right' }}>{t('aiModels.columns.priceInput')}</Box>
                    <Box component="th" sx={{ ...headerCellSx, textAlign: 'right' }}>{t('aiModels.columns.priceOutput')}</Box>
                    <Box component="th" sx={headerCellSx}>{t('aiModels.columns.usage')}</Box>
                    <Box component="th" sx={{ ...headerCellSx, width: 96 }} aria-label={t('aiModels.columns.actions')} />
                  </Box>
                </Box>
                <Box component="tbody">
                  {builtinAvailable && (
                    <Box component="tr">
                      <Box component="td" sx={{ ...cellSx, textAlign: 'center', px: 0.5 }}>
                        <DefaultStar
                          isDefault={builtinIsDefault}
                          label={builtinIsDefault ? t('aiModels.defaultChip') : t('aiModels.makeDefault')}
                          onToggle={
                            builtinIsDefault || !tenantDefault
                              ? undefined
                              : () => defaultMutation.mutate({ id: tenantDefault.id, makeDefault: false })
                          }
                        />
                      </Box>
                      <Box component="td" sx={cellSx}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('aiModels.builtin.name')}</Typography>
                        <Typography variant="caption" color="text.secondary">{t('aiModels.builtin.caption')}</Typography>
                      </Box>
                      <Box component="td" sx={cellSx}>
                        <Typography variant="caption" color="text.secondary">{t('aiModels.builtin.model')}</Typography>
                      </Box>
                      <Box component="td" sx={cellSx}>{t('aiModels.visionYes')}</Box>
                      <Box component="td" sx={{ ...cellSx, textAlign: 'right' }}>{formatPrice(0)}</Box>
                      <Box component="td" sx={{ ...cellSx, textAlign: 'right' }}>{formatPrice(0)}</Box>
                      <Box component="td" sx={cellSx}>
                        {builtinUsage ? (
                          <Box sx={{ maxWidth: 190 }}>
                            <Typography variant="caption" color="text.secondary">
                              {t('aiModels.builtin.quota', { used: builtinUsage.count, limit: builtinUsage.limit })}
                            </Typography>
                            <LinearProgress
                              variant="determinate"
                              value={builtinUsage.limit > 0 ? Math.min(100, (builtinUsage.count / builtinUsage.limit) * 100) : 0}
                              sx={{ height: 4, borderRadius: 2, mt: 0.5 }}
                            />
                          </Box>
                        ) : (
                          <Typography variant="caption" color="text.secondary">{t('aiModels.builtin.fallback')}</Typography>
                        )}
                      </Box>
                      <Box component="td" sx={cellSx} />
                    </Box>
                  )}
                  {models.map((modelConfig) => {
                    const archived = modelConfig.status === 'archived';
                    const usedBy = usedByLabels(modelConfig);
                    return (
                      <Box component="tr" key={modelConfig.id} sx={{ opacity: archived ? 0.55 : 1, '&:hover': { backgroundColor: 'kanap.bg.hover' } }}>
                        <Box component="td" sx={{ ...cellSx, textAlign: 'center', px: 0.5 }}>
                          {!archived && (
                            <DefaultStar
                              isDefault={modelConfig.is_default}
                              label={modelConfig.is_default ? t('aiModels.clearDefault') : t('aiModels.makeDefault')}
                              onToggle={() => defaultMutation.mutate({ id: modelConfig.id, makeDefault: !modelConfig.is_default })}
                            />
                          )}
                        </Box>
                        <Box component="td" sx={cellSx}>
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="body2" sx={{ fontWeight: 500 }}>{modelConfig.name}</Typography>
                            {archived && (
                              <Typography variant="caption" color="text.secondary">{t('aiModels.archivedChip')}</Typography>
                            )}
                          </Stack>
                          {modelConfig.validation_errors.length > 0 && !archived && (
                            <Typography variant="caption" color="warning.main">{t('aiModels.incomplete')}</Typography>
                          )}
                        </Box>
                        <Box component="td" sx={cellSx}>
                          <Typography variant="body2">
                            {providers.find((provider) => provider.id === modelConfig.provider)?.label ?? modelConfig.provider}
                          </Typography>
                          <Typography variant="caption" sx={{ fontFamily: 'monospace', color: 'kanap.text.secondary', fontSize: 12 }}>
                            {modelConfig.model}
                          </Typography>
                        </Box>
                        <Box component="td" sx={cellSx}>
                          {modelConfig.supports_vision ? t('aiModels.visionYes') : t('aiModels.visionNo')}
                        </Box>
                        <Box component="td" sx={{ ...cellSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatPrice(modelConfig.price_input_eur_per_mtok)}
                        </Box>
                        <Box component="td" sx={{ ...cellSx, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                          {formatPrice(modelConfig.price_output_eur_per_mtok)}
                        </Box>
                        <Box component="td" sx={cellSx}>
                          <Typography variant="caption" color="text.secondary">
                            {t('aiModels.messagesThisMonth', { count: modelConfig.messages_this_month ?? 0 })}
                          </Typography>
                        </Box>
                        <Box component="td" sx={{ ...cellSx, whiteSpace: 'nowrap', textAlign: 'right' }}>
                          {!archived && (
                            <>
                              <Tooltip title={t('aiModels.edit')}>
                                <IconButton size="small" aria-label={t('aiModels.edit')} onClick={() => openEdit(modelConfig)}>
                                  <EditIcon fontSize="small" />
                                </IconButton>
                              </Tooltip>
                              <Tooltip title={usedBy.length > 0 ? t('aiModels.archiveBlocked') : t('aiModels.archive')}>
                                <span>
                                  <IconButton
                                    size="small"
                                    aria-label={t('aiModels.archive')}
                                    disabled={usedBy.length > 0}
                                    onClick={() => archiveMutation.mutate(modelConfig.id)}
                                  >
                                    <ArchiveIcon fontSize="small" />
                                  </IconButton>
                                </span>
                              </Tooltip>
                            </>
                          )}
                          {archived && (
                            <Tooltip title={t('aiModels.restore')}>
                              <IconButton size="small" aria-label={t('aiModels.restore')} onClick={() => restoreMutation.mutate(modelConfig.id)}>
                                <UnarchiveIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                  {!builtinAvailable && models.length === 0 && (
                    <Box component="tr">
                      <Box component="td" colSpan={8} sx={{ ...cellSx, borderBottom: 'none' }}>
                        <EmptyState>{t('aiModels.empty')}</EmptyState>
                      </Box>
                    </Box>
                  )}
                </Box>
              </Box>
            </Box>
          )}
        </Section>
      </Stack>

      {dialogOpen && (
        <KanapDialog
          open={dialogOpen}
          title={editingId ? t('aiModels.dialog.editTitle') : t('aiModels.dialog.createTitle')}
          onClose={() => setDialogOpen(false)}
          onSave={handleSave}
          saveLabel={editingId ? t('aiModels.dialog.save') : t('aiModels.dialog.create')}
          saveDisabled={saveDisabled}
          saveLoading={saveMutation.isPending}
        >
          <Stack spacing={1.5}>
            {testResult && (
              <Alert severity={testResult.ok ? 'success' : 'error'} onClose={() => setTestResult(null)}>
                {testResult.ok
                  ? t('aiModels.dialog.testOk', { latency: testResult.latency_ms ?? 0 })
                  : testResult.message}
              </Alert>
            )}
            <PropertyRow label={t('aiModels.dialog.name')}>
              <TextField
                size="small"
                variant="standard"
                value={draft.name}
                placeholder={t('aiModels.dialog.namePlaceholder')}
                sx={drawerFieldValueSx}
                onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
              />
            </PropertyRow>
            <PropertyRow label={t('aiModels.dialog.provider')}>
              <Select
                variant="standard"
                value={draft.provider}
                sx={drawerSelectSx}
                onChange={(event) => handleProviderChange(event.target.value)}
              >
                {providers.map((provider) => (
                  <MenuItem key={provider.id} value={provider.id} sx={drawerMenuItemSx}>{provider.label}</MenuItem>
                ))}
              </Select>
            </PropertyRow>
            <PropertyRow label={t('aiModels.dialog.model')}>
              <TextField
                size="small"
                variant="standard"
                value={draft.model}
                placeholder={t('aiModels.dialog.modelPlaceholder')}
                sx={drawerFieldValueSx}
                onChange={(event) => setDraft((prev) => ({ ...prev, model: event.target.value }))}
              />
            </PropertyRow>
            {(selectedProvider?.capabilities.allowsCustomEndpoint ?? true) && (
              <PropertyRow label={t('aiModels.dialog.endpoint')}>
                <TextField
                  size="small"
                  variant="standard"
                  value={draft.endpoint_url}
                  placeholder={t('aiModels.dialog.endpointPlaceholder')}
                  sx={drawerFieldValueSx}
                  onChange={(event) => setDraft((prev) => ({ ...prev, endpoint_url: event.target.value }))}
                />
              </PropertyRow>
            )}
            {(selectedProvider?.capabilities.requiresApiKey ?? true) && (
              <TextField
                size="small"
                fullWidth
                label={t('aiModels.dialog.apiKey')}
                type={showingStoredKey ? 'text' : 'password'}
                autoComplete="new-password"
                value={showingStoredKey ? API_KEY_MASK : draft.api_key}
                placeholder={showingStoredKey ? undefined : t('aiModels.dialog.apiKeyPlaceholder')}
                helperText={editingId && hasStoredKey ? t('aiModels.dialog.apiKeyKeepHint') : undefined}
                onFocus={(event) => {
                  if (showingStoredKey) event.target.select();
                }}
                onChange={(event) => {
                  const next = event.target.value;
                  setDraft((prev) => ({ ...prev, api_key: next === API_KEY_MASK ? '' : next }));
                }}
              />
            )}
            <PropertyRow
              label={(
                <LabelWithInfo
                  label={t('aiModels.dialog.capabilities')}
                  info={t('aiModels.dialog.visionHint')}
                />
              )}
            >
              <Stack direction="row" spacing={1} alignItems="center">
                <Switch
                  size="small"
                  checked={draft.supports_vision}
                  onChange={(event) => setDraft((prev) => ({ ...prev, supports_vision: event.target.checked }))}
                />
                <Typography variant="body2" sx={{ fontSize: 13 }}>{t('aiModels.dialog.visionLabel')}</Typography>
              </Stack>
            </PropertyRow>
            <Stack direction="row" spacing={2} alignItems="flex-start">
              <PropertyRow
                label={(
                  <LabelWithInfo
                    label={t('aiModels.dialog.priceInput')}
                    info={t('aiModels.dialog.pricingHint')}
                  />
                )}
                sx={{ flex: 1 }}
              >
                <TextField
                  size="small"
                  variant="standard"
                  value={draft.price_input}
                  placeholder={t('aiModels.dialog.priceInputPlaceholder')}
                  error={priceInput === undefined}
                  sx={drawerFieldValueSx}
                  onChange={(event) => setDraft((prev) => ({ ...prev, price_input: event.target.value }))}
                />
              </PropertyRow>
              <PropertyRow
                label={(
                  <LabelWithInfo
                    label={t('aiModels.dialog.priceOutput')}
                    info={t('aiModels.dialog.pricingHint')}
                  />
                )}
                sx={{ flex: 1 }}
              >
                <TextField
                  size="small"
                  variant="standard"
                  value={draft.price_output}
                  placeholder={t('aiModels.dialog.priceOutputPlaceholder')}
                  error={priceOutput === undefined}
                  sx={drawerFieldValueSx}
                  onChange={(event) => setDraft((prev) => ({ ...prev, price_output: event.target.value }))}
                />
              </PropertyRow>
            </Stack>
            <PropertyRow
              label={(
                <LabelWithInfo
                  label={t('aiModels.dialog.timeout')}
                  info={t('aiModels.dialog.timeoutHint')}
                />
              )}
            >
              <TextField
                size="small"
                variant="standard"
                value={draft.timeout_seconds}
                placeholder={t('aiModels.dialog.timeoutPlaceholder')}
                error={timeoutInvalid}
                sx={drawerFieldValueSx}
                onChange={(event) => setDraft((prev) => ({ ...prev, timeout_seconds: event.target.value }))}
              />
            </PropertyRow>
            {editingId && (
              <Box>
                <Button
                  size="small"
                  variant="action"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate(editingId)}
                >
                  {testMutation.isPending ? t('aiModels.dialog.testing') : t('aiModels.dialog.test')}
                </Button>
              </Box>
            )}
          </Stack>
        </KanapDialog>
      )}
    </Box>
  );
}
