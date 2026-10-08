import React from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../auth/AuthContext';
import PageHeader from '../../components/PageHeader';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyRow } from '../../components/design';
import {
  EmptyState,
  formatNumber,
  formatPercent,
  humanize,
  LEGACY_GLPI_TICKETING_PROVIDER_KEY,
  LifecycleText,
  lifecycleStatusKey,
  MetricBlock,
  providerBindingForDefinition,
  ReasonDialog,
  Section,
  statusLabel,
} from '../../components/agents/agentControlPrimitives';
import {
  categoryFromFilters,
  createdHorizonHoursFromFilters,
  DEFAULT_APPROVAL_TTL_HOURS,
  DEFAULT_DAILY_COST,
  DEFAULT_DAILY_RUNS,
  DEFAULT_DAILY_TOKENS,
  DEFAULT_HORIZON_HOURS,
  DEFAULT_MAX_REQUESTS,
  DEFAULT_MAX_TICKETS,
  DEFAULT_PER_RUN_COST,
  DEFAULT_PER_RUN_TOKENS,
  DEFAULT_REVIEW_COOLDOWN_HOURS,
  entityFromFilters,
  modeFromFilters,
  openStatusValues,
  statusFilterValues,
  TARGETING_OPTIONS_STALE_TIME_MS,
  targetingPredicatesFromFilters,
  targetingPresetFilters,
  type TargetingFilter,
} from '../../components/agents/helpdeskTargeting';
import { aiAgentControlApi } from '../../ai/aiApi';
import { compactSelectMenuProps, drawerMenuItemSx, pageSelectSx } from '../../theme/formSx';
import { useLocale } from '../../i18n/useLocale';
import { helpdeskScopeFiltered } from '../../components/agents/agentRunState';
import { useAgentControlData } from './useAgentControlData';
import { useAiCapabilities } from '../../ai/useAiCapabilities';

// Dialog fields plus create-time defaults that are not collected in the UI
// (watchEnabled stays false; limit/cap fields ship the template values).
type NewAgentWizardForm = {
  name: string;
  description: string;
  agentType: 'helpdesk' | 'sre';
  // Helpdesk: ticketing provider key. SRE: monitoring provider key, or '' when
  // no monitoring connection is known — the agent is then created unbound
  // (fail closed), mirroring the backend seed's behavior.
  providerKey: string;
  watchEnabled: boolean;
  filters: TargetingFilter[];
  agentPriority: string;
  reviewCooldownHours: string;
  onConflict: string;
  maxTickets: string;
  maxRequests: string;
  horizonHours: string;
  approvalTtlHours: string;
  onStale: string;
  perRunTokens: string;
  perRunCost: string;
  dailyRuns: string;
  dailyTokens: string;
  dailyCost: string;
};

function defaultWizardForm(t: (key: string) => string, statusValues: string[] = []): NewAgentWizardForm {
  return {
    name: t('overview.newAgentDefaultName'),
    description: t('overview.newAgentDescription'),
    agentType: 'helpdesk',
    providerKey: LEGACY_GLPI_TICKETING_PROVIDER_KEY,
    watchEnabled: false,
    filters: targetingPresetFilters('new_tickets', DEFAULT_HORIZON_HOURS, statusValues),
    agentPriority: '100',
    reviewCooldownHours: String(DEFAULT_REVIEW_COOLDOWN_HOURS),
    onConflict: 'defer',
    maxTickets: String(DEFAULT_MAX_TICKETS),
    maxRequests: String(DEFAULT_MAX_REQUESTS),
    horizonHours: String(DEFAULT_HORIZON_HOURS),
    approvalTtlHours: String(DEFAULT_APPROVAL_TTL_HOURS),
    onStale: 're_review',
    perRunTokens: String(DEFAULT_PER_RUN_TOKENS),
    perRunCost: String(DEFAULT_PER_RUN_COST),
    dailyRuns: String(DEFAULT_DAILY_RUNS),
    dailyTokens: String(DEFAULT_DAILY_TOKENS),
    dailyCost: String(DEFAULT_DAILY_COST),
  };
}

function positiveNumber(value: string, fallback: number): number {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

// SRE "watching" source of truth (mirror of the workspace Monitor header's
// sreWatching): scheduled_poll.enabled on the definition's trigger policy —
// SRE agents have no helpdesk ingestion summary to read it from.
function sreScheduledPollEnabled(triggerPolicy: unknown): boolean {
  const trigger = triggerPolicy && typeof triggerPolicy === 'object' && !Array.isArray(triggerPolicy)
    ? triggerPolicy as Record<string, unknown> : {};
  const scheduledPoll = trigger.scheduled_poll && typeof trigger.scheduled_poll === 'object' && !Array.isArray(trigger.scheduled_poll)
    ? trigger.scheduled_poll as Record<string, unknown> : {};
  return scheduledPoll.enabled === true;
}

function economicGuardrailsFromForm(form: NewAgentWizardForm) {
  return {
    configured: true,
    per_run: {
      max_estimated_tokens: positiveNumber(form.perRunTokens, DEFAULT_PER_RUN_TOKENS),
      max_estimated_cost_eur: positiveNumber(form.perRunCost, DEFAULT_PER_RUN_COST),
    },
    daily: {
      max_agent_runs: positiveNumber(form.dailyRuns, DEFAULT_DAILY_RUNS),
      max_estimated_tokens: positiveNumber(form.dailyTokens, DEFAULT_DAILY_TOKENS),
      max_estimated_cost_eur: positiveNumber(form.dailyCost, DEFAULT_DAILY_COST),
    },
  };
}

function newSreAgentPolicies(form: NewAgentWizardForm) {
  return {
    agent_priority: positiveNumber(form.agentPriority, 100),
    provider_bindings_json: form.providerKey
      ? {
        monitoring: {
          provider_kind: 'monitoring',
          provider_key: form.providerKey,
        },
      }
      : {},
    trigger_policy_json: {
      scheduled_poll: { enabled: false },
      provider_webhook: { enabled: false },
      production_polling_enabled: false,
      automatic_writes_enabled: false,
    },
    scope_policy_json: {
      knowledge_sources: {
        knowledge: { enabled: true, all_libraries: true, library_ids: [] },
        web: { enabled: false },
        precedence: 'knowledge_first',
        kanap_data: {
          enabled: true,
          domains: {
            applications: true,
            assets: true,
            interfaces: true,
            connections: true,
            locations: true,
          },
        },
      },
      // Inert placeholder, same as the seed: an empty predicate list round-trips
      // unchanged through the scope-policy normalizers on the create path.
      targeting: { schema_version: 1, combinator: 'and', predicates: [] },
    },
    queue_policy_json: {
      enabled: true,
      dedup_mode: 'active_work_item',
      lease_ttl_seconds: 300,
      max_attempts: 3,
      cooldown_seconds: 60,
      review_cooldown_seconds: positiveNumber(form.reviewCooldownHours, DEFAULT_REVIEW_COOLDOWN_HOURS) * 3600,
      on_conflict: form.onConflict === 'supersede' ? 'supersede' : 'defer',
      approval_ttl_seconds: positiveNumber(form.approvalTtlHours, DEFAULT_APPROVAL_TTL_HOURS) * 3600,
      retry_backoff_seconds: [60, 300, 900],
      terminal_statuses: ['completed', 'dead_letter'],
      economic_guardrails: economicGuardrailsFromForm(form),
    },
    response_policy_json: {
      require_human_approval_for_writes: true,
    },
    evaluation_policy_json: {
      create_pending_evaluation: true,
      feedback_required_for_autonomy_promotion: true,
    },
  };
}

function newAgentPolicies(form: NewAgentWizardForm) {
  if (form.agentType === 'sre') {
    return newSreAgentPolicies(form);
  }
  const enabledAt = form.watchEnabled ? new Date().toISOString() : null;
  const mode = modeFromFilters(form.filters);
  const predicates = targetingPredicatesFromFilters(form.filters);
  const categoryId = categoryFromFilters(form.filters);
  const entityId = entityFromFilters(form.filters);
  const horizonHours = createdHorizonHoursFromFilters(form.filters, form.horizonHours);
  const blockConfig = {
    enabled: form.watchEnabled,
    enabled_at: enabledAt,
    entity_id: entityId || null,
    category_id: categoryId || null,
    max_tickets_per_cycle: positiveNumber(form.maxTickets, DEFAULT_MAX_TICKETS),
    max_provider_requests_per_cycle: positiveNumber(form.maxRequests, DEFAULT_MAX_REQUESTS),
  };
  const onStale = ['re_review', 'cancel', 'apply_anyway'].includes(form.onStale) ? form.onStale : 're_review';
  return {
    agent_priority: positiveNumber(form.agentPriority, 100),
    provider_bindings_json: {
      ticketing: {
        provider_kind: 'ticketing',
        provider_key: form.providerKey,
      },
    },
    trigger_policy_json: {
      manual_safe_target: { enabled: true },
      scheduled_poll: { enabled: form.watchEnabled },
      saved_filter: { enabled: false },
      provider_webhook: { enabled: false },
      ticket_update: { enabled: false },
      production_polling_enabled: form.watchEnabled,
      automatic_writes_enabled: false,
    },
    scope_policy_json: {
      mode,
      allowed_modes: ['manual_safe_target', 'new_tickets_only', 'all_open', 'agent_involved'],
      provider_kind: 'ticketing',
      provider_key: form.providerKey,
      target_kind: 'ticket',
      required_safe_target_effect: 'read',
      targeting: {
        schema_version: 1,
        combinator: 'and',
        predicates,
      },
      new_tickets_only: mode === 'new_tickets_only'
        ? { ...blockConfig, hard_backfill_horizon_hours: horizonHours }
        : { enabled: false },
      all_open: mode === 'all_open' ? blockConfig : { enabled: false },
      agent_involved: mode === 'agent_involved' ? blockConfig : { enabled: false },
      new_plus_agent_touched: { enabled: false },
      saved_filter: { enabled: false },
      all_matching: { enabled: false },
      freeform_live_object_ids: false,
    },
    queue_policy_json: {
      enabled: true,
      dedup_mode: 'active_work_item',
      lease_ttl_seconds: 300,
      max_attempts: 3,
      cooldown_seconds: 60,
      review_cooldown_seconds: positiveNumber(form.reviewCooldownHours, DEFAULT_REVIEW_COOLDOWN_HOURS) * 3600,
      on_conflict: form.onConflict === 'supersede' ? 'supersede' : 'defer',
      retry_backoff_seconds: [60, 300, 900],
      terminal_statuses: ['completed', 'dead_letter'],
      approval_ttl_seconds: positiveNumber(form.approvalTtlHours, DEFAULT_APPROVAL_TTL_HOURS) * 3600,
      on_stale_by_action_class: {
        public_reply: onStale,
        internal_note: onStale,
        classification: onStale,
        status: onStale,
        assignment: onStale,
        participant: onStale,
      },
      economic_guardrails: economicGuardrailsFromForm(form),
    },
    response_policy_json: {
      prepare_internal_note: true,
      prepare_public_reply: true,
      prepare_classification_update: true,
      prepare_status_update: true,
      prepare_assignment_update: true,
      prepare_participant_update: false,
      ticket_actor_role: 'assignee',
      automatic_public_reply: false,
      automatic_ticket_updates: false,
      require_human_approval_for_writes: true,
    },
    evaluation_policy_json: {
      create_pending_evaluation: true,
      feedback_required_for_autonomy_promotion: true,
    },
  };
}

export default function AgentsOverviewPage() {
  const { t } = useTranslation(['agents']);
  const locale = useLocale();
  const navigate = useNavigate();
  const { hasLevel } = useAuth();
  const data = useAgentControlData();
  const overview = data.queueQuery.data ?? null;
  const definitions = overview?.definitions ?? [];
  const helpdeskSummary = overview?.helpdesk?.summary ?? null;
  // Fleet header metrics are pooled across every helpdesk agent (backend aggregate),
  // not the built-in agent's summary used as a proxy.
  const fleetEvaluation = overview?.helpdesk?.fleet ?? null;
  const helpdeskSummaryByAgent = React.useMemo(() => {
    const map = new Map<string, typeof helpdeskSummary>();
    for (const summary of overview?.helpdesk?.summaries ?? []) {
      map.set(summary.agentDefinitionId, summary);
    }
    if (overview?.helpdesk?.summary) {
      map.set(overview.helpdesk.summary.agentDefinitionId, overview.helpdesk.summary);
    }
    return map;
  }, [overview?.helpdesk?.summaries, overview?.helpdesk?.summary]);
  const activePause = data.queueQuery.data?.emergency_pause ?? null;
  const includedModelWaiting = useAiCapabilities().data?.builtin_confirmation_needed === true;
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [wizardForm, setWizardForm] = React.useState<NewAgentWizardForm>(() => defaultWizardForm(t));
  const canAdmin = hasLevel('ai_agents', 'admin') || hasLevel('ai_settings', 'admin');
  const updateWizard = <K extends keyof NewAgentWizardForm>(field: K, value: NewAgentWizardForm[K]) => {
    setWizardForm((current) => ({ ...current, [field]: value }));
  };
  // Monitoring connections the dialog can bind to. There is no adapter-config
  // list endpoint, so this mirrors what the backend seed exposes indirectly:
  // the monitoring bindings already present on the fleet's SRE definitions
  // (the seed binds automatically when exactly one enabled monitoring adapter
  // config exists). Empty means "none known" — the agent is created unbound.
  // Manage integrations is the escape hatch when that harvested list is empty.
  const monitoringProviderKeys = React.useMemo(() => {
    const keys = new Set<string>();
    for (const definition of definitions) {
      const binding = providerBindingForDefinition(definition, 'monitoring');
      if (binding) keys.add(binding.providerKey);
    }
    return Array.from(keys);
  }, [definitions]);
  // Switching agent type swaps the provider slot and, when the user has not
  // customized them, the default name/description.
  const changeWizardType = React.useCallback((next: NewAgentWizardForm['agentType']) => {
    const defaultNames = {
      helpdesk: t('overview.newAgentDefaultName'),
      sre: t('overview.newAgentSreDefaultName'),
    };
    const defaultDescriptions = {
      helpdesk: t('overview.newAgentDescription'),
      sre: t('overview.newAgentSreDescription'),
    };
    setWizardForm((current) => ({
      ...current,
      agentType: next,
      providerKey: next === 'sre'
        ? (monitoringProviderKeys[0] ?? '')
        : LEGACY_GLPI_TICKETING_PROVIDER_KEY,
      name: current.name === defaultNames.helpdesk || current.name === defaultNames.sre
        ? defaultNames[next]
        : current.name,
      description: current.description === defaultDescriptions.helpdesk || current.description === defaultDescriptions.sre
        ? defaultDescriptions[next]
        : current.description,
    }));
  }, [monitoringProviderKeys, t]);
  const helpdeskTemplateDefinition = React.useMemo(
    () => definitions.find((definition) => definition.agent_type === 'helpdesk') ?? null,
    [definitions],
  );
  const targetingOptionsAgentId = helpdeskTemplateDefinition?.id ?? null;
  const targetingStatusOptionsQuery = useQuery({
    // Same key as the workspace's status query (AgentWorkspacePage / the targeting
    // builder), so this prefetch also warms the Settings tab the user lands on.
    queryKey: ['ai-agent-targeting-options', targetingOptionsAgentId, 'status', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(targetingOptionsAgentId || '', 'status', { limit: 50 }),
    // Prefetch on the overview so Create on first paint still has open-status values.
    enabled: canAdmin && !!targetingOptionsAgentId,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const presetStatusValues = React.useMemo(
    () => openStatusValues(targetingStatusOptionsQuery.data?.options ?? []),
    [targetingStatusOptionsQuery.data?.options],
  );
  const presetStatusValuesKey = presetStatusValues.join('|');
  React.useEffect(() => {
    if (!wizardOpen || presetStatusValues.length === 0) return;
    setWizardForm((current) => {
      let changed = false;
      const filters = current.filters.map((filter) => {
        if (filter.field !== 'status' || statusFilterValues(filter.value).length > 0) return filter;
        changed = true;
        return { ...filter, value: presetStatusValues };
      });
      return changed ? { ...current, filters } : current;
    });
  }, [presetStatusValuesKey, presetStatusValues, wizardOpen]);

  const [pauseDialogOpen, setPauseDialogOpen] = React.useState(false);
  const [agentToDelete, setAgentToDelete] = React.useState<{ id: string; name: string } | null>(null);
  const submitTenantPause = React.useCallback((reason: string) => {
    data.createPauseMutation.mutate(
      { scope: 'tenant', reason, expires_in_minutes: null },
      { onSuccess: () => setPauseDialogOpen(false) },
    );
  }, [data.createPauseMutation]);

  const openWizard = React.useCallback(() => {
    setWizardForm(defaultWizardForm(t, presetStatusValues));
    setWizardOpen(true);
  }, [presetStatusValues, t]);

  const createAgent = React.useCallback(async () => {
    if (!wizardForm.name.trim()) return;
    try {
      const result = await data.createAgentMutation.mutateAsync({
        name: wizardForm.name.trim(),
        agent_type: wizardForm.agentType,
        description: wizardForm.description.trim() || null,
        ...newAgentPolicies(wizardForm),
      });
      setWizardOpen(false);
      navigate(`/agents/${result.agent_definition.agent_key}?tab=settings`);
    } catch {
      // Mutation handler surfaces the API error.
    }
  }, [data.createAgentMutation, navigate, wizardForm]);

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={t('overview.title')}
        actions={canAdmin ? (
          <Button
            size="small"
            variant="contained"
            startIcon={<AddIcon />}
            disabled={data.createAgentMutation.isPending}
            onClick={openWizard}
          >
            {t('overview.newAgent')}
          </Button>
        ) : undefined}
      />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>{t('overview.subtitle')}</Typography>
      <Stack spacing={2}>
        {data.error && <Alert severity="error" onClose={() => data.setError(null)}>{data.error}</Alert>}
        {data.message && <Alert severity="success" onClose={() => data.setMessage(null)}>{data.message}</Alert>}
        {includedModelWaiting && (
          <Alert
            severity="warning"
            action={hasLevel('ai_settings', 'admin') ? (
              <Button size="small" color="inherit" component={RouterLink} to="/admin/ai">
                {t('overview.includedModelOpenSettings')}
              </Button>
            ) : null}
          >
            {t('overview.includedModelPaused')}
          </Alert>
        )}
        {activePause && (
          <Alert
            severity="warning"
            action={canAdmin ? (
              <Button
                size="small"
                color="inherit"
                startIcon={<PlayArrowIcon />}
                disabled={data.revokePauseMutation.isPending}
                onClick={() => data.revokePauseMutation.mutate(activePause.id)}
              >
                {t('pause.lift')}
              </Button>
            ) : null}
          >
            {t('pause.active', { reason: activePause.reason })}
          </Alert>
        )}

        <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
          <MetricBlock label={t('overview.pendingApprovals')} value={data.badgesQuery.data?.pendingApprovals ?? 0} />
          <MetricBlock label={t('overview.todayActions')} value={formatNumber(fleetEvaluation?.terminalByStatus.executed ?? 0)} />
          <MetricBlock label={t('overview.acceptance')} value={formatPercent(fleetEvaluation?.acceptanceRate)} />
          <MetricBlock label={t('overview.dismissed')} value={formatPercent(fleetEvaluation?.dismissRate)} />
          <MetricBlock
            label={t('overview.cost')}
            value={`${(overview?.cost?.today_eur ?? 0).toFixed(2)} / ${(overview?.cost?.last_7_days_eur ?? 0).toFixed(2)} EUR`}
          />
        </Stack>

        <Section
          title={t('overview.fleet')}
          actions={canAdmin ? (
            <Button
              size="small"
              color="error"
              variant="outlined"
              startIcon={<PauseCircleOutlineIcon />}
              disabled={!!activePause || data.createPauseMutation.isPending}
              onClick={() => setPauseDialogOpen(true)}
            >
              {t('pause.tenant')}
            </Button>
          ) : undefined}
        >
          {data.queueQuery.isLoading ? (
            <Box display="flex" justifyContent="center" py={4}><CircularProgress size={24} /></Box>
          ) : definitions.length === 0 ? (
            <EmptyState>{t('overview.empty')}</EmptyState>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5, p: 1.5, alignItems: 'start' }}>
              {definitions.map((definition) => {
                const agentHelpdeskSummary = helpdeskSummaryByAgent.get(definition.id) ?? null;
                // Helpdesk agents watch through the ingestion summary; SRE
                // agents watch through trigger_policy_json.scheduled_poll —
                // same source the workspace Monitor header reads, so the
                // fleet card can never say "Testing" while the workspace
                // says "Watching".
                const watching = definition.agent_type === 'sre'
                  ? sreScheduledPollEnabled(definition.trigger_policy_json)
                  : !!agentHelpdeskSummary?.ingestion.enabled;
                const pending = data.actionPool.filter((action) => {
                  const metadata = action.metadata_json ?? {};
                  // Count only actionable pending proposals — exclude expired/terminal ones the
                  // backend already drops from the badge and the approvals inbox (can_reject=false),
                  // so the card matches what the user can actually act on.
                  return metadata.agent_definition_id === definition.id
                    && action.status === 'pending'
                    && (action.execution_readiness?.can_reject ?? true);
                }).length;
                const failed = (overview?.work_items ?? []).filter((item) =>
                  item.agent_definition_id === definition.id && ['failed', 'dead_letter'].includes(item.status)
                ).length;
                const automaticCount = definition.automatic_action_classes?.length ?? 0;
                const label = lifecycleStatusKey(definition.status, watching, automaticCount, !!activePause || !!agentHelpdeskSummary?.ingestion.paused);
                return (
                  <Card key={definition.id} variant="outlined" sx={{ borderRadius: 1 }}>
                    <CardActionArea onClick={() => navigate(`/agents/${definition.agent_key}`)}>
                      <CardContent>
                        <Stack spacing={1.25}>
                          <Stack direction="row" justifyContent="space-between" spacing={1} alignItems="flex-start">
                            <Box sx={{ minWidth: 0 }}>
                              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>{definition.name}</Typography>
                              <Typography variant="body2" color="text.secondary">{definition.description ?? t('overview.noDescription')}</Typography>
                            </Box>
                            <Stack direction="row" spacing={0.5} alignItems="center" sx={{ flexShrink: 0 }}>
                              <LifecycleText lifecycleKey={label} />
                              {canAdmin && (
                                <Tooltip title={t('overview.deleteAgent')}>
                                  <IconButton
                                    size="small"
                                    sx={{ color: 'text.secondary' }}
                                    onClick={(event) => { event.stopPropagation(); event.preventDefault(); setAgentToDelete({ id: definition.id, name: definition.name }); }}
                                  >
                                    <DeleteOutlineIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Stack>
                          </Stack>
                          <Stack direction="row" spacing={0.75} flexWrap="wrap" useFlexGap>
                            <Chip size="small" label={t(`agentType.${definition.agent_type}`, { defaultValue: humanize(definition.agent_type) })} />
                            <Chip size="small" label={t(`environment.${definition.environment}`, { defaultValue: definition.environment })} />
                            <Chip size="small" color={pending > 0 ? 'warning' : 'default'} label={t('overview.pendingCount', { count: pending })} />
                            <Chip size="small" color={failed > 0 ? 'error' : 'default'} label={t('overview.failedCount', { count: failed })} />
                            <Chip
                              size="small"
                              color={automaticCount > 0 ? 'success' : 'default'}
                              label={automaticCount > 0 ? t('overview.automaticCount', { count: automaticCount }) : t('overview.askFirst')}
                            />
                          </Stack>
                          {agentHelpdeskSummary ? (
                            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1 }}>
                              <MetricBlock label={t('overview.lastCheck')} value={agentHelpdeskSummary.ingestion.lastPollStatus ? statusLabel(agentHelpdeskSummary.ingestion.lastPollStatus) : t('common.notSet')} />
                              <MetricBlock label={t('overview.scope')} value={helpdeskScopeFiltered(definition, agentHelpdeskSummary.ingestion) ? t('overview.filteredScope') : t('overview.allTickets')} />
                              <MetricBlock label={t('overview.runsToday')} value={agentHelpdeskSummary.guardrails.daily?.runs ?? 0} />
                              <MetricBlock label={t('overview.updated')} value={agentHelpdeskSummary.ingestion.lastPollAt ? new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(new Date(agentHelpdeskSummary.ingestion.lastPollAt)) : t('common.notSet')} />
                            </Box>
                          ) : null}
                        </Stack>
                      </CardContent>
                    </CardActionArea>
                  </Card>
                );
              })}
            </Box>
          )}
        </Section>
      </Stack>
      <KanapDialog
        open={wizardOpen}
        title={t('overview.wizard.title')}
        onClose={() => setWizardOpen(false)}
        onSave={() => { void createAgent(); }}
        saveLabel={t('overview.wizard.create')}
        saveDisabled={!wizardForm.name.trim() || data.createAgentMutation.isPending}
        saveLoading={data.createAgentMutation.isPending}
        cancelLabel={t('overview.wizard.cancel')}
      >
        <Stack spacing={1.5}>
          <PropertyRow label={t('overview.wizard.type')}>
            <Select
              variant="standard"
              value={wizardForm.agentType}
              onChange={(event) => changeWizardType(event.target.value as NewAgentWizardForm['agentType'])}
              sx={pageSelectSx}
              MenuProps={compactSelectMenuProps}
            >
              <MenuItem value="helpdesk" sx={drawerMenuItemSx}>{t('overview.wizard.helpdesk')}</MenuItem>
              <MenuItem value="sre" sx={drawerMenuItemSx}>{t('overview.wizard.sre')}</MenuItem>
            </Select>
          </PropertyRow>
          <PropertyRow label={t('overview.wizard.name')} required>
            <TextField
              size="small"
              variant="standard"
              value={wizardForm.name}
              sx={{ width: '100%' }}
              onChange={(event) => updateWizard('name', event.target.value)}
            />
          </PropertyRow>
          <PropertyRow label={t('overview.wizard.description')}>
            <TextField
              size="small"
              variant="standard"
              multiline
              minRows={2}
              value={wizardForm.description}
              sx={{ width: '100%', '& .MuiInputBase-root': { alignItems: 'flex-start' } }}
              onChange={(event) => updateWizard('description', event.target.value)}
            />
          </PropertyRow>
          {wizardForm.agentType === 'helpdesk' ? (
            <PropertyRow label={t('overview.wizard.connection')}>
              <Select
                variant="standard"
                value={wizardForm.providerKey}
                onChange={(event) => updateWizard('providerKey', event.target.value)}
                sx={pageSelectSx}
                MenuProps={compactSelectMenuProps}
              >
                <MenuItem value={LEGACY_GLPI_TICKETING_PROVIDER_KEY} sx={drawerMenuItemSx}>GLPI</MenuItem>
              </Select>
            </PropertyRow>
          ) : monitoringProviderKeys.length > 0 ? (
            <PropertyRow label={t('overview.wizard.monitoringConnection')}>
              <Select
                variant="standard"
                value={wizardForm.providerKey}
                onChange={(event) => updateWizard('providerKey', event.target.value)}
                sx={pageSelectSx}
                MenuProps={compactSelectMenuProps}
              >
                {monitoringProviderKeys.map((key) => (
                  <MenuItem key={key} value={key} sx={drawerMenuItemSx}>{key.toUpperCase()}</MenuItem>
                ))}
              </Select>
            </PropertyRow>
          ) : (
            <PropertyRow
              label={t('overview.wizard.monitoringConnection')}
              helperText={t('overview.wizard.monitoringConnectionHint')}
            >
              <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{t('common.notSet')}</Box>
            </PropertyRow>
          )}
          <Button type="button" size="small" variant="action" onClick={() => navigate('/admin/integrations')} sx={{ alignSelf: 'flex-start' }}>
            {t('overview.wizard.manageConnections')}
          </Button>
          <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary, lineHeight: 1.4 })}>
            {t(wizardForm.agentType === 'sre' ? 'overview.wizard.reviewBodySre' : 'overview.wizard.reviewBody')}
          </Typography>
        </Stack>
      </KanapDialog>

      <ReasonDialog
        open={pauseDialogOpen}
        title={t('pause.dialogTitleTenant')}
        description={t('pause.dialogDescriptionTenant')}
        label={t('pause.reasonLabel')}
        placeholder={t('pause.reasonPlaceholder')}
        busy={data.createPauseMutation.isPending}
        saveLabel={t('pause.tenant')}
        onClose={() => setPauseDialogOpen(false)}
        onSubmit={submitTenantPause}
      />

      {agentToDelete && (
        <KanapDialog
          open={!!agentToDelete}
          title={t('overview.deleteConfirmTitle', { name: agentToDelete.name })}
          onClose={() => setAgentToDelete(null)}
          onSave={() => data.deleteAgentMutation.mutate(agentToDelete.id, { onSuccess: () => setAgentToDelete(null) })}
          saveLabel={t('overview.deleteConfirm')}
          saveColor="error"
          saveLoading={data.deleteAgentMutation.isPending}
        >
          <Typography variant="body2" color="text.secondary">{t('overview.deleteConfirmBody')}</Typography>
        </KanapDialog>
      )}
    </Box>
  );
}
