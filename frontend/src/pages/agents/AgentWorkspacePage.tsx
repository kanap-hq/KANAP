import React from 'react';
import { Alert, Box, Button, Checkbox, Chip, CircularProgress, Collapse, FormControlLabel, MenuItem, Select, Stack, Switch, Tab, Tabs, TextField, Tooltip, Typography, useTheme } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import ScienceOutlinedIcon from '@mui/icons-material/ScienceOutlined';
import WarningAmberOutlinedIcon from '@mui/icons-material/WarningAmberOutlined';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PageHeader from '../../components/PageHeader';
import ChartCard from '../../components/reports/ChartCard';
import AgentControlBar from '../../components/agents/AgentControlBar';
import AgentStatusStrip from '../../components/agents/AgentStatusStrip';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyRow } from '../../components/design';
import { compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, drawerFieldValueSx, inlineControlSx, longFormSurfaceFieldSx, pageSelectSx } from '../../theme/formSx';
import {
  aiAgentControlApi,
  aiModelConfigsApi,
  type AiAgentControlAgentDefinition,
  type AiAgentControlAgentDefinitionInput,
  type AiAgentControlEvaluationDailyResult,
  type AiAgentControlQueueOverview,
  type AiAgentControlRefItem,
  type AiAgentControlTargetingPreview,
  type AiAgentKanapDataSources,
  type AiSharedContextProfile,
} from '../../ai/aiApi';
import { useAuth } from '../../auth/AuthContext';
import { useFeatures } from '../../config/FeaturesContext';
import useAutosave, { useAutosaveQueue, useAutosaveRegistry, type AutosaveQueue, type AutosaveRegistry } from '../../hooks/useAutosave';
import {
  buildTicketGroups,
  EmptyState,
  formatNumber,
  formatPercent,
  humanize,
  MetricBlock,
  providerBindingForDefinition,
  resolveAgentSummary,
  SaveIndicator,
  Section,
  ticketingProviderKeyForDefinition,
  type TicketWorkGroup,
} from '../../components/agents/agentControlPrimitives';
import {
  canPersistIdentity,
  collectEffectivePromptBounds,
  droppedInstructionLineCount,
  droppedSharedContextLineCount,
  insertAtCaret,
  MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS,
  MAX_PERSONA_PURPOSE_CHARS,
  mergeInstructionsForDisplay,
  measurePersonaIdentityLimits,
  personaIdentitySavePatch,
  truncatedSharedContextLineCount,
} from '../../components/agents/agentPersona';
import {
  actionLinkButtonSx,
  buildFilter,
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
  filtersFromScope,
  HelpdeskTargetingFilterBuilder,
  modeFromFilters,
  openStatusValues,
  statusFilterValues,
  TARGETING_CATALOG_OPTIONS_LIMIT,
  TARGETING_OPTIONS_STALE_TIME_MS,
  targetingPredicatesFromFilters,
  targetingPresetFilters,
  useDebouncedValue,
  type TargetingFilter,
  type TargetingPresetKey,
} from '../../components/agents/helpdeskTargeting';
import {
  MonitoringTargetingFilterBuilder,
  MonitoringTargetingPresetButtons,
  monitoringFiltersFromScope,
  monitoringTargetingModelFromFilters,
  type MonitoringTargetingFilter,
  type MonitoringTargetingPresetKey,
} from '../../components/agents/monitoringTargeting';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { AlertDossierBody, AlertOccurrenceList, dossierFromDiagnosisResult } from './AlertDossier';
import AgentsApprovalsPage from './AgentsApprovalsPage';
import AgentsActivityPage from './AgentsActivityPage';
import { SHARED_CONTEXT_PROFILES_QUERY_KEY, useAgentControlData } from './useAgentControlData';
import { useLocalStorageState } from '../../hooks/useLocalStorageState';

type WorkspaceTab = 'monitor' | 'approvals' | 'performance' | 'settings';
const TABS: WorkspaceTab[] = ['monitor', 'approvals', 'performance', 'settings'];
// Scroll anchor for the control bar's "Test on a ticket/alert" entry point.
const AGENT_TEST_SECTION_ID = 'agent-test';
const EFFECTIVE_PROMPT_OPEN_KEY = 'kanap.agentWorkspace.effectivePromptOpen';
const OPERATING_MORE_OPEN_KEY = 'kanap.agentWorkspace.operatingMoreOpen';

type EffectivePromptTaskKey = 'action_planner' | 'planner' | 'interpreter' | 'synthesis' | 'monitoring_diagnosis';
const HELPDESK_EFFECTIVE_PROMPT_TASKS: EffectivePromptTaskKey[] = ['action_planner', 'planner', 'interpreter', 'synthesis'];
const SRE_EFFECTIVE_PROMPT_TASKS: EffectivePromptTaskKey[] = ['monitoring_diagnosis'];

function numberField(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

// Activity-history retention (days). Mirror of the backend bounds in
// ai-agent-activity-retention.ts — the server clamps too, this only keeps the
// field from showing a value the save would silently change.
const DEFAULT_ACTIVITY_RETENTION_DAYS = 30;
const MIN_ACTIVITY_RETENTION_DAYS = 7;
const MAX_ACTIVITY_RETENTION_DAYS = 90;

// Check frequency (minutes). Mirror of the backend bounds in
// ai-agent-check-interval.ts — stored in trigger_policy_json.scheduled_poll,
// which every writer here spreads rather than replaces.
const DEFAULT_CHECK_INTERVAL_MINUTES = 5;
const MIN_CHECK_INTERVAL_MINUTES = 5;
const MAX_CHECK_INTERVAL_MINUTES = 1440;

function positiveNumber(value: string, fallback: number): number {
  return numberField(value) ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function policyObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function nestedPolicy(value: unknown, key: string): Record<string, unknown> {
  return policyObject(policyObject(value)[key]);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function numberString(value: unknown, fallback: number | null = null): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback == null ? '' : String(fallback);
}

function hoursString(seconds: unknown, fallbackHours: number): string {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? String(Math.max(1, Math.round(seconds / 3600)))
    : String(fallbackHours);
}

function capabilityEntryName(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (isRecord(entry) && typeof entry.name === 'string') return entry.name;
  return null;
}

function capabilityEntries(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.capabilities)) return value.capabilities;
  return [];
}

function capabilityNameSet(value: unknown): Set<string> {
  return new Set(capabilityEntries(value).map(capabilityEntryName).filter((name): name is string => !!name));
}

function capabilityEnabledState(definition: AiAgentControlAgentDefinition): Record<string, boolean> {
  const names = capabilityNameSet(definition.allowed_capabilities_json);
  return Object.fromEntries(HELPDESK_CAPABILITY_GROUPS.map((group) => [group.key, group.names.every((name) => names.has(name))]));
}

function allowedCapabilitiesWithGroup(definition: AiAgentControlAgentDefinition, groupKey: string, enabled: boolean): unknown[] {
  const group = HELPDESK_CAPABILITY_GROUPS.find((candidate) => candidate.key === groupKey);
  if (!group) return capabilityEntries(definition.allowed_capabilities_json);
  const groupNames = new Set<string>(group.names);
  const existing = capabilityEntries(definition.allowed_capabilities_json)
    .filter((entry) => {
      const name = capabilityEntryName(entry);
      return !name || !groupNames.has(name);
    });
  if (!enabled) return existing;
  const currentByName = new Map(capabilityEntries(definition.allowed_capabilities_json).map((entry) => [capabilityEntryName(entry), entry]));
  return [
    ...existing,
    ...group.names.map((name) => currentByName.get(name) ?? {
      name,
      version: '1.0.0',
      effect: name.includes('.approved') || name.includes('.add_approved') ? 'write' : name.includes('.get') ? 'read' : 'propose',
      max_autonomy_level: name.includes('.approved') || name.includes('.add_approved') ? 'A3' : name.includes('.get') ? 'A1' : 'A2',
      ...(name.includes('.approved') || name.includes('.add_approved') ? { approval: 'human' } : {}),
    }),
  ];
}

/**
 * Field label with an optional info affordance. Tooltips carry the explanation
 * (what the setting does, what happens at the limit) so the page is not padded
 * with permanent hint paragraphs; `hint` stays available for the rare case a
 * tooltip cannot carry it (live values, error states).
 */
function SettingsField({ label, hint, info, children }: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  info?: React.ReactNode;
  children: React.ReactNode;
}) {
  const labelNode = info
    ? (
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
        {label}
        <Tooltip title={info} placement="top">
          <InfoOutlinedIcon sx={{ fontSize: 13, color: 'kanap.text.tertiary' }} />
        </Tooltip>
      </Box>
    )
    : label;
  return <PropertyRow label={labelNode} helperText={hint}>{children}</PropertyRow>;
}

// Catalogues the panel keeps collapsed: a production ticketing system has dozens
// of groups and hundreds of technicians and categories, so they are counted, not listed.
type ReferenceCatalogueField = 'group' | 'technician' | 'category';
// About eight rows of a 13px list before the expanded catalogue starts scrolling.
const REFERENCE_LIST_MAX_HEIGHT = 178;

function useReferenceCatalogue(agentId: string, field: ReferenceCatalogueField, enabled: boolean, query: string) {
  return useQuery({
    // Same cache entries as the targeting filters.
    queryKey: ['ai-agent-targeting-options', agentId, field, query],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(agentId, field, {
      query: query || undefined,
      limit: TARGETING_CATALOG_OPTIONS_LIMIT,
    }),
    enabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
}

function referenceMatches(options: AiAgentControlRefItem[], needle: string): AiAgentControlRefItem[] {
  if (!needle) return options;
  const lowered = needle.toLocaleLowerCase();
  return options.filter((option) => option.label.toLocaleLowerCase().includes(lowered)
    || option.value.toLocaleLowerCase().includes(lowered));
}

// A name the admin can drop into the instructions. Neutral at rest; the interactive
// treatment shows up on hover only.
function ReferenceName({ label, badge, onInsert }: {
  label: string;
  badge?: string;
  onInsert: (name: string) => void;
}) {
  return (
    <Box component="li" sx={{ m: 0 }}>
      <Box
        component="button"
        type="button"
        onClick={() => onInsert(label)}
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 1,
          width: '100%',
          textAlign: 'left',
          p: 0,
          border: 0,
          background: 'none',
          font: 'inherit',
          fontSize: 13,
          lineHeight: 1.7,
          color: 'kanap.text.primary',
          cursor: 'pointer',
          '&:hover': { color: 'primary.main' },
        }}
      >
        <Box component="span">{label}</Box>
        {badge && (
          <Box component="span" sx={{ fontFamily: 'var(--kanap-font-mono, ui-monospace, monospace)', fontSize: 11, color: 'kanap.text.tertiary' }}>{badge}</Box>
        )}
      </Box>
    </Box>
  );
}

function ReferenceSectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary', mb: 0.5 }}>{children}</Typography>
  );
}

function ReferenceNote({ children }: { children: React.ReactNode }) {
  return (
    <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.5 }}>{children}</Typography>
  );
}

// Read-only reference next to the instructions: the exact names the admin can use there.
// Only what the runtime actually lets the instructions drive: status transitions, the
// technician groups and the individual technicians when Assignment is on, and the
// categories, priorities and types when Classification is on.
// Short enum lists stay inline; the large catalogues collapse to a counted row, and one
// search field looks through all of them at once.
function InstructionsReferencePanel({ statuses, routingEnabled, classificationEnabled, priorities, types, agentId, onInsert }: {
  agentId: string;
  classificationEnabled: boolean;
  priorities: AiAgentControlRefItem[];
  types: AiAgentControlRefItem[];
  statuses: AiAgentControlRefItem[] | null;
  routingEnabled: boolean;
  onInsert: (name: string) => void;
}) {
  const { t } = useTranslation(['agents']);
  const searchId = React.useId();
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<ReferenceCatalogueField | null>(null);
  const settled = useDebouncedValue(query).trim();
  const searching = settled.length > 0;

  const groupsQuery = useReferenceCatalogue(agentId, 'group', routingEnabled, settled);
  const techniciansQuery = useReferenceCatalogue(agentId, 'technician', routingEnabled, settled);
  const categoriesQuery = useReferenceCatalogue(agentId, 'category', classificationEnabled, settled);

  const statusMatches = referenceMatches(statuses ?? [], settled);
  const priorityMatches = classificationEnabled ? referenceMatches(priorities, settled) : [];
  const typeMatches = classificationEnabled ? referenceMatches(types, settled) : [];

  const catalogues: {
    field: ReferenceCatalogueField;
    title: string;
    enabled: boolean;
    query: ReturnType<typeof useReferenceCatalogue>;
    emptyText: string;
    note?: string;
  }[] = [
    {
      field: 'group',
      title: t('settings.reference.groups'),
      enabled: routingEnabled,
      query: groupsQuery,
      emptyText: t('settings.reference.groupsEmpty'),
    },
    {
      field: 'technician',
      title: t('settings.reference.technicians'),
      enabled: routingEnabled,
      query: techniciansQuery,
      emptyText: t('settings.reference.techniciansEmpty'),
    },
    {
      field: 'category',
      title: t('settings.reference.categories'),
      enabled: classificationEnabled,
      query: categoriesQuery,
      emptyText: t('settings.reference.empty'),
      note: t('settings.reference.categoriesScope'),
    },
  ];

  // Real total when the ticketing system knows it, "50+" when the page is capped.
  const countLabel = (catalogue: typeof catalogues[number]): string => {
    const total = catalogue.query.data?.total;
    if (typeof total === 'number') return String(total);
    const length = catalogue.query.data?.options.length ?? 0;
    return length >= TARGETING_CATALOG_OPTIONS_LIMIT
      ? t('settings.reference.countCapped', { count: TARGETING_CATALOG_OPTIONS_LIMIT })
      : String(length);
  };

  const enumSections = [
    // `empty` is only set once the list is known to be loaded, so the panel does not
    // claim "nothing available" while the first fetch is still in flight.
    { key: 'statuses', title: t('settings.reference.statuses'), options: statusMatches, shown: true, empty: statuses !== null },
    { key: 'priorities', title: t('settings.reference.priorities'), options: priorityMatches, shown: classificationEnabled, empty: false },
    { key: 'types', title: t('settings.reference.types'), options: typeMatches, shown: classificationEnabled, empty: false },
  ].filter((section) => section.shown);

  const visibleCatalogues = catalogues.filter((catalogue) => catalogue.enabled);
  const somethingMatches = enumSections.some((section) => section.options.length > 0)
    || visibleCatalogues.some((catalogue) => (catalogue.query.data?.options.length ?? 0) > 0);
  const stillLoading = visibleCatalogues.some((catalogue) => catalogue.query.isFetching);
  const catalogueError = visibleCatalogues.some((catalogue) => catalogue.query.isError);

  const renderNames = (options: AiAgentControlRefItem[], withKeys: boolean, scroll: boolean) => (
    <Box
      component="ul"
      sx={{
        listStyle: 'none',
        m: 0,
        p: 0,
        ...(scroll ? { maxHeight: REFERENCE_LIST_MAX_HEIGHT, overflowY: 'auto' } : {}),
      }}
    >
      {options.map((option) => (
        <ReferenceName key={option.value} label={option.label} badge={withKeys ? option.value : undefined} onInsert={onInsert} />
      ))}
    </Box>
  );

  return (
    <Box
      sx={{
        mt: { xs: 0, md: 2.75 },
        p: '12px 14px',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'kanap.border.soft',
        bgcolor: 'kanap.bg.drawer',
      }}
    >
      <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>
        {t('settings.reference.title')}
      </Typography>
      <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25, mb: 1 }}>
        {t('settings.reference.insertHint')}
      </Typography>
      <TextField
        id={searchId}
        size="small"
        variant="standard"
        fullWidth
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder={t('settings.reference.search')}
        sx={drawerFieldValueSx}
        inputProps={{ 'aria-label': t('settings.reference.search') }}
      />

      {searching ? (
        <Box sx={{ mt: 1.5 }}>
          {enumSections.filter((section) => section.options.length > 0).map((section) => (
            <Box key={section.key} sx={{ mb: 1.5 }}>
              <ReferenceSectionLabel>{section.title}</ReferenceSectionLabel>
              {renderNames(section.options, true, false)}
            </Box>
          ))}
          {visibleCatalogues.filter((catalogue) => (catalogue.query.data?.options.length ?? 0) > 0).map((catalogue) => (
            <Box key={catalogue.field} sx={{ mb: 1.5 }}>
              <ReferenceSectionLabel>{catalogue.title}</ReferenceSectionLabel>
              {renderNames(catalogue.query.data?.options ?? [], false, true)}
              {(catalogue.query.data?.options.length ?? 0) >= TARGETING_CATALOG_OPTIONS_LIMIT && (
                <ReferenceNote>{t('settings.reference.categoriesMore')}</ReferenceNote>
              )}
            </Box>
          ))}
          {catalogueError && <ReferenceNote>{t('settings.reference.catalogueError')}</ReferenceNote>}
          {!somethingMatches && !stillLoading && !catalogueError && (
            <ReferenceNote>{t('settings.reference.noMatch')}</ReferenceNote>
          )}
        </Box>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          {enumSections.map((section) => (
            <Box key={section.key} sx={{ mb: 1.5 }}>
              <ReferenceSectionLabel>{section.title}</ReferenceSectionLabel>
              {section.options.length > 0 && renderNames(section.options, true, false)}
              {section.options.length === 0 && section.empty && (
                <ReferenceNote>{t('settings.reference.empty')}</ReferenceNote>
              )}
            </Box>
          ))}
          {!routingEnabled && <ReferenceNote>{t('settings.reference.groupsDisabled')}</ReferenceNote>}
          {!classificationEnabled && (
            <Box sx={{ mt: routingEnabled ? 0 : 0.75 }}>
              <ReferenceNote>{t('settings.reference.classificationDisabled')}</ReferenceNote>
            </Box>
          )}
          {visibleCatalogues.map((catalogue) => {
            const open = expanded === catalogue.field;
            const options = catalogue.query.data?.options ?? [];
            return (
              <Box key={catalogue.field}>
                <Box
                  component="button"
                  type="button"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : catalogue.field)}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 1,
                    width: '100%',
                    p: 0,
                    py: 0.5,
                    border: 0,
                    background: 'none',
                    font: 'inherit',
                    fontSize: 13,
                    color: 'kanap.text.primary',
                    cursor: 'pointer',
                    '&:hover': { color: 'primary.main' },
                  }}
                >
                  <Box component="span">
                    {catalogue.title}
                    <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>{` · ${countLabel(catalogue)}`}</Box>
                  </Box>
                  {open
                    ? <ExpandLessIcon sx={{ fontSize: 15, color: 'kanap.text.tertiary' }} />
                    : <ExpandMoreIcon sx={{ fontSize: 15, color: 'kanap.text.tertiary' }} />}
                </Box>
                {open && (
                  <Box sx={{ pb: 0.75 }}>
                    {catalogue.query.isError && <ReferenceNote>{t('settings.reference.catalogueError')}</ReferenceNote>}
                    {!catalogue.query.isError && options.length === 0 && !catalogue.query.isFetching && (
                      <ReferenceNote>{catalogue.emptyText}</ReferenceNote>
                    )}
                    {renderNames(options, false, true)}
                    {options.length >= TARGETING_CATALOG_OPTIONS_LIMIT && (
                      <ReferenceNote>{t('settings.reference.categoriesMore')}</ReferenceNote>
                    )}
                    {catalogue.note && <ReferenceNote>{catalogue.note}</ReferenceNote>}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
}

function AgentInlineTitle({
  canEdit,
  value,
  onSave,
}: {
  canEdit: boolean;
  value: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onSave(trimmed);
    setDraft(trimmed || value);
    setEditing(false);
  };
  if (!canEdit || !editing) {
    return (
      <Typography
        variant="h5"
        component="span"
        onClick={canEdit ? () => { setDraft(value); setEditing(true); } : undefined}
        sx={{
          cursor: canEdit ? 'text' : 'default',
          '&:hover': canEdit ? { opacity: 0.85 } : undefined,
        }}
      >
        {value}
      </Typography>
    );
  }
  return (
    <Box
      component="input"
      value={draft}
      aria-label={value}
      onChange={(event: React.ChangeEvent<HTMLInputElement>) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
        }
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      autoFocus
      sx={(theme) => ({
        font: 'inherit',
        fontSize: 'inherit',
        fontWeight: 500,
        color: 'inherit',
        bgcolor: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
        outline: 'none',
        p: 0,
        m: 0,
        width: '100%',
        minWidth: 160,
      })}
    />
  );
}

function AgentInlineDescription({
  canEdit,
  value,
  fallback,
  placeholder,
  onSave,
}: {
  canEdit: boolean;
  value: string;
  fallback: string;
  placeholder: string;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => {
    if (!editing) setDraft(value);
  }, [editing, value]);
  const commit = () => {
    const trimmed = draft.trim();
    if (trimmed !== value) onSave(trimmed);
    setEditing(false);
  };
  const display = value || (canEdit ? placeholder : fallback);
  if (!canEdit || !editing) {
    return (
      <Typography
        variant="body2"
        onClick={canEdit ? () => { setDraft(value); setEditing(true); } : undefined}
        sx={(theme) => ({
          mb: 2,
          color: value ? 'text.secondary' : theme.palette.kanap.text.tertiary,
          cursor: canEdit ? 'text' : 'default',
          '&:hover': canEdit ? { opacity: 0.85 } : undefined,
        })}
      >
        {display}
      </Typography>
    );
  }
  return (
    <Box
      component="textarea"
      value={draft}
      aria-label={placeholder}
      placeholder={placeholder}
      onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
      autoFocus
      rows={2}
      sx={(theme) => ({
        display: 'block',
        width: '100%',
        font: 'inherit',
        fontSize: 14,
        lineHeight: 1.43,
        color: theme.palette.kanap.text.secondary,
        bgcolor: 'transparent',
        border: 'none',
        borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
        outline: 'none',
        p: 0,
        mt: 0,
        mb: 2,
        mx: 0,
        resize: 'none',
      })}
    />
  );
}

/** Inline "today: x / cap" context under a daily safety limit. */
function CapUsage({ children }: { children: React.ReactNode }) {
  return (
    <Typography component="span" sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>{children}</Typography>
  );
}

/** One-line effect of the current filters. Sample size, run estimates and
 *  predicate-resolution chips stay off this surface — they are implementation
 *  detail, not something an operator uses to aim the agent. */
function TargetingPreviewSummary({
  loading,
  error,
  preview,
}: {
  loading: boolean;
  error: boolean;
  preview?: AiAgentControlTargetingPreview;
}) {
  const { t } = useTranslation(['agents']);
  if (!preview) {
    if (error) {
      return <Typography variant="body2" color="error.main">{t('settings.preview.unavailable')}</Typography>;
    }
    if (loading) {
      return <Typography variant="body2" color="text.secondary">{t('settings.preview.checking')}</Typography>;
    }
    return null;
  }
  const matches = preview.matchEstimate;
  const overlap = preview.overlapEstimate;
  const matchesText = matches === 0
    ? t('settings.preview.matchesNone')
    : t(preview.capped ? 'settings.preview.matchesCapped' : 'settings.preview.matches', { count: matches });
  return (
    <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
      {matchesText}
      {overlap > 0 && matches > 0 ? (
        <>
          {' '}
          <Box component="span" sx={{ color: 'warning.main' }}>
            {t('settings.preview.overlap', { count: overlap })}
          </Box>
        </>
      ) : null}
    </Typography>
  );
}

const agentPersonaFieldSx = [
  longFormSurfaceFieldSx,
  {
    maxWidth: 'none',
    '& .MuiInputBase-root': {
      minHeight: 84,
    },
  },
] as const;

// Feature on/off switches keep the switch shape (they reveal config below)
// but match the density of the compact capability checkboxes.
const featureSwitchRowSx = { m: 0, gap: 0.75, '& .MuiFormControlLabel-label': { fontSize: 13 } } as const;

const SCOPE_MODES = ['new_tickets_only', 'all_open', 'agent_involved'] as const;

type HelpdeskSettingsForm = {
  scopeMode: string;
  filters: TargetingFilter[];
  agentPriority: string;
  reviewCooldownHours: string;
  onConflict: string;
  entityId: string;
  categoryId: string;
  maxTickets: string;
  maxRequests: string;
  horizonHours: string;
  perRunTokens: string;
  perRunCost: string;
  dailyRuns: string;
  dailyTokens: string;
  dailyCost: string;
  approvalTtlHours: string;
  onStale: string;
  ticketActorRole: string;
  activityRetentionDays: string;
  checkIntervalMinutes: string;
};

const TICKET_ACTOR_ROLES = ['assignee', 'observer', 'none'] as const;

const HELPDESK_CAPABILITY_GROUPS = [
  { key: 'internal_note', names: ['ticketing.ticket.internal_note.prepare', 'ticketing.ticket.internal_note.add_approved'] },
  { key: 'public_reply', names: ['ticketing.ticket.public_reply.prepare', 'ticketing.ticket.public_reply.add_approved'] },
  { key: 'classification', names: ['ticketing.ticket.classification_context.get', 'ticketing.ticket.classification_update.prepare', 'ticketing.ticket.classification_update.approved'] },
  { key: 'status', names: ['ticketing.ticket.lifecycle_context.get', 'ticketing.ticket.status_update.prepare', 'ticketing.ticket.status_update.approved'] },
  { key: 'assignment', names: ['ticketing.ticket.routing_context.get', 'ticketing.ticket.assignment_update.prepare', 'ticketing.ticket.assignment_update.approved'] },
  { key: 'participant', names: ['ticketing.ticket.participant_context.get', 'ticketing.ticket.participant_update.prepare', 'ticketing.ticket.participant_update.approved'] },
] as const;

function settingsFormFromDefinition(definition: AiAgentControlAgentDefinition): HelpdeskSettingsForm {
  const scope = policyObject(definition.scope_policy_json);
  const rawMode = stringValue(scope.mode);
  const mode = (SCOPE_MODES as readonly string[]).includes(rawMode) ? rawMode : 'new_tickets_only';
  const ingestion = nestedPolicy(scope, 'new_tickets_only');
  const activeBlock = nestedPolicy(scope, mode);
  const targetingState = filtersFromScope(scope, mode);
  const queue = policyObject(definition.queue_policy_json);
  const onStale = policyObject(queue.on_stale_by_action_class);
  // Single approval window. Falls back to the longest entry of the legacy per-action-class map
  // so an existing agent's window is never shortened on migration, else the default.
  const directApprovalTtl = Number(queue.approval_ttl_seconds);
  const legacyApprovalTtls = Object.values(policyObject(queue.approval_ttl_seconds_by_action_class))
    .map(Number)
    .filter((seconds) => Number.isFinite(seconds) && seconds > 0);
  const approvalTtlSeconds = Number.isFinite(directApprovalTtl) && directApprovalTtl > 0
    ? directApprovalTtl
    : legacyApprovalTtls.length > 0
      ? Math.max(...legacyApprovalTtls)
      : DEFAULT_APPROVAL_TTL_HOURS * 3600;
  const guardrails = nestedPolicy(definition.queue_policy_json, 'economic_guardrails');
  const perRun = policyObject(guardrails.per_run);
  const daily = policyObject(guardrails.daily);
  const response = policyObject(definition.response_policy_json);
  return {
    scopeMode: modeFromFilters(targetingState.filters),
    filters: targetingState.filters,
    agentPriority: numberString(definition.agent_priority, 100),
    reviewCooldownHours: hoursString(queue.review_cooldown_seconds, DEFAULT_REVIEW_COOLDOWN_HOURS),
    onConflict: stringValue(queue.on_conflict) === 'supersede' ? 'supersede' : 'defer',
    entityId: targetingState.entityId || stringValue(activeBlock.entity_id ?? activeBlock.entityId ?? ingestion.entity_id),
    categoryId: targetingState.categoryId || stringValue(activeBlock.category_id ?? activeBlock.categoryId ?? ingestion.category_id),
    maxTickets: numberString(activeBlock.max_tickets_per_cycle ?? ingestion.max_tickets_per_cycle, DEFAULT_MAX_TICKETS),
    maxRequests: numberString(activeBlock.max_provider_requests_per_cycle ?? ingestion.max_provider_requests_per_cycle, DEFAULT_MAX_REQUESTS),
    horizonHours: targetingState.horizonHours || numberString(ingestion.hard_backfill_horizon_hours, DEFAULT_HORIZON_HOURS),
    perRunTokens: numberString(perRun.max_estimated_tokens, DEFAULT_PER_RUN_TOKENS),
    perRunCost: numberString(perRun.max_estimated_cost_eur, DEFAULT_PER_RUN_COST),
    dailyRuns: numberString(daily.max_agent_runs, DEFAULT_DAILY_RUNS),
    dailyTokens: numberString(daily.max_estimated_tokens, DEFAULT_DAILY_TOKENS),
    dailyCost: numberString(daily.max_estimated_cost_eur, DEFAULT_DAILY_COST),
    approvalTtlHours: hoursString(approvalTtlSeconds, DEFAULT_APPROVAL_TTL_HOURS),
    onStale: ['re_review', 'cancel', 'apply_anyway'].includes(stringValue(onStale.internal_note)) ? stringValue(onStale.internal_note) : 're_review',
    ticketActorRole: (TICKET_ACTOR_ROLES as readonly string[]).includes(stringValue(response.ticket_actor_role))
      ? stringValue(response.ticket_actor_role)
      : 'assignee',
    activityRetentionDays: numberString(queue.activity_retention_days, DEFAULT_ACTIVITY_RETENTION_DAYS),
    checkIntervalMinutes: numberString(
      policyObject(policyObject(definition.trigger_policy_json).scheduled_poll).interval_minutes,
      DEFAULT_CHECK_INTERVAL_MINUTES,
    ),
  };
}

function helpdeskDefinitionSettingsPayload(
  definition: AiAgentControlAgentDefinition,
  form: HelpdeskSettingsForm,
): AiAgentControlAgentDefinitionInput {
  const trigger = policyObject(definition.trigger_policy_json);
  const scope = policyObject(definition.scope_policy_json);
  const queue = policyObject(definition.queue_policy_json);
  const response = policyObject(definition.response_policy_json);
  const ingestion = nestedPolicy(scope, 'new_tickets_only');
  const predicates = targetingPredicatesFromFilters(form.filters);
  const mode = modeFromFilters(form.filters);
  const categoryId = categoryFromFilters(form.filters) || form.categoryId.trim();
  const entityId = entityFromFilters(form.filters) || form.entityId.trim();
  const horizonHours = createdHorizonHoursFromFilters(form.filters, form.horizonHours);
  const providerKey = ticketingProviderKeyForDefinition(definition);
  if (!providerKey) {
    throw new Error('This agent has no ticketing provider binding.');
  }
  // Watching is operated from the Monitor tab run-mode control; settings saves
  // carry the definition's current value through so they never flip it.
  const watching = policyObject(trigger.scheduled_poll).enabled === true;
  const enabledAt = watching
    ? stringValue(ingestion.enabled_at) || new Date().toISOString()
    : stringValue(ingestion.enabled_at) || null;
  // Shared per-mode selection block (entity/category filters + per-cycle caps).
  const blockConfig = {
    enabled: watching,
    enabled_at: enabledAt,
    entity_id: entityId || null,
    category_id: categoryId || null,
    max_tickets_per_cycle: positiveNumber(form.maxTickets, DEFAULT_MAX_TICKETS),
    max_provider_requests_per_cycle: positiveNumber(form.maxRequests, DEFAULT_MAX_REQUESTS),
  };
  return {
    agent_priority: positiveNumber(form.agentPriority, 100),
    allowed_capabilities_json: capabilityEntries(definition.allowed_capabilities_json),
    response_policy_json: {
      ...response,
      prepare_stale_closure: undefined,
      ticket_actor_role: form.ticketActorRole,
      automatic_public_reply: false,
      automatic_ticket_updates: false,
      require_human_approval_for_writes: true,
    },
    trigger_policy_json: {
      ...trigger,
      manual_safe_target: { enabled: true },
      scheduled_poll: {
        ...policyObject(trigger.scheduled_poll),
        enabled: watching,
        interval_minutes: clampNumber(
          positiveNumber(form.checkIntervalMinutes, DEFAULT_CHECK_INTERVAL_MINUTES),
          MIN_CHECK_INTERVAL_MINUTES,
          MAX_CHECK_INTERVAL_MINUTES,
        ),
      },
      saved_filter: policyObject(trigger.saved_filter).enabled == null ? { enabled: false } : trigger.saved_filter,
      provider_webhook: { enabled: false },
      ticket_update: { enabled: false },
      production_polling_enabled: watching,
      automatic_writes_enabled: false,
    },
    scope_policy_json: {
      ...scope,
      mode: watching ? mode : stringValue(scope.mode) || 'manual_safe_target',
      allowed_modes: ['manual_safe_target', 'new_tickets_only', 'all_open', 'agent_involved'],
      provider_kind: 'ticketing',
      provider_key: providerKey,
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
      stale_closure: undefined,
    },
    queue_policy_json: {
      ...queue,
      enabled: true,
      activity_retention_days: clampNumber(
        positiveNumber(form.activityRetentionDays, DEFAULT_ACTIVITY_RETENTION_DAYS),
        MIN_ACTIVITY_RETENTION_DAYS,
        MAX_ACTIVITY_RETENTION_DAYS,
      ),
      review_cooldown_seconds: positiveNumber(form.reviewCooldownHours, DEFAULT_REVIEW_COOLDOWN_HOURS) * 3600,
      on_conflict: form.onConflict === 'supersede' ? 'supersede' : 'defer',
      approval_ttl_seconds: positiveNumber(form.approvalTtlHours, DEFAULT_APPROVAL_TTL_HOURS) * 3600,
      approval_ttl_seconds_by_action_class: undefined,
      on_stale_by_action_class: {
        public_reply: form.onStale === 'cancel' ? 'cancel' : 're_review',
        internal_note: ['re_review', 'cancel', 'apply_anyway'].includes(form.onStale) ? form.onStale : 're_review',
        classification: ['re_review', 'cancel', 'apply_anyway'].includes(form.onStale) ? form.onStale : 're_review',
        status: ['re_review', 'cancel', 'apply_anyway'].includes(form.onStale) ? form.onStale : 're_review',
        assignment: ['re_review', 'cancel', 'apply_anyway'].includes(form.onStale) ? form.onStale : 're_review',
        participant: ['re_review', 'cancel', 'apply_anyway'].includes(form.onStale) ? form.onStale : 're_review',
      },
      economic_guardrails: {
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
      },
    },
  };
}

// ---------------------------------------------------------------------------
// SRE (monitoring) workspace flavor. Helpdesk agents render exactly as before —
// every SRE branch below is gated on definition.agent_type === 'sre'.
// ---------------------------------------------------------------------------

const KANAP_DATA_DOMAINS = ['applications', 'assets', 'interfaces', 'connections', 'locations'] as const;

// Mirror of the backend bounds in resolveMonitoringScopeIngestionConfig
// (ai-agent-work-queue.service.ts): alerts 1..20 default 5, requests 1..100
// default 10 — keep in sync or saved values silently snap to the server clamp.
const DEFAULT_SRE_MAX_ALERTS = 5;
const DEFAULT_SRE_MAX_REQUESTS = 10;
const SRE_MAX_ALERTS_CAP = 20;
const SRE_MAX_REQUESTS_CAP = 100;

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

type SreSettingsForm = {
  filters: MonitoringTargetingFilter[];
  maxAlerts: string;
  maxRequests: string;
  activityRetentionDays: string;
  checkIntervalMinutes: string;
};

function sreSettingsFormFromDefinition(definition: AiAgentControlAgentDefinition): SreSettingsForm {
  const scope = policyObject(definition.scope_policy_json);
  const ingestion = nestedPolicy(scope, 'ingestion');
  return {
    filters: monitoringFiltersFromScope(scope),
    maxAlerts: numberString(ingestion.max_alerts_per_cycle, DEFAULT_SRE_MAX_ALERTS),
    maxRequests: numberString(ingestion.max_provider_requests_per_cycle, DEFAULT_SRE_MAX_REQUESTS),
    activityRetentionDays: numberString(
      policyObject(definition.queue_policy_json).activity_retention_days,
      DEFAULT_ACTIVITY_RETENTION_DAYS,
    ),
    checkIntervalMinutes: numberString(
      policyObject(policyObject(definition.trigger_policy_json).scheduled_poll).interval_minutes,
      DEFAULT_CHECK_INTERVAL_MINUTES,
    ),
  };
}

function MonitorTab({ agentKey }: { agentKey: string }) {
  const { t } = useTranslation(['agents']);
  const data = useAgentControlData({ targetAgentKey: agentKey });
  const [targetKey, setTargetKey] = React.useState('');
  const definition = data.queueQuery.data?.definitions.find((item) => item.agent_key === agentKey) ?? null;
  const isSre = definition?.agent_type === 'sre';
  const monitoringBinding = providerBindingForDefinition(definition, 'monitoring');
  // The run-mode control, checks, tests and the emergency brake live in the
  // transverse control bar above the tabs. The facts that used to sit next to
  // them are the "Status" section right below.
  const grouped = React.useMemo(() => buildTicketGroups(data.queueQuery.data ?? null, data.actionPool, definition?.id ?? null, Date.now()), [data.actionPool, data.queueQuery.data, definition?.id]);
  const monitoringGroups = grouped.groups.filter((group) => group.providerKind === 'monitoring');

  const triageMutation = useMutation({
    mutationFn: () => {
      if (!data.ticketingProviderKey) {
        throw new Error(t('monitor.providerMissing'));
      }
      if (!definition?.id) {
        throw new Error(t('monitor.providerMissing'));
      }
      return aiAgentControlApi.runTicketingTriage({
        provider_key: data.ticketingProviderKey,
        target_key: targetKey.trim(),
        agent_definition_id: definition.id,
      });
    },
    onSuccess: async () => {
      data.setMessage(t('monitor.testStarted'));
      await data.invalidate();
    },
    onError: (err) => data.setError(getApiErrorMessage(err, t, t('monitor.testFailed'))),
  });

  // SRE "test on an alert": runs the full diagnosis synchronously, so on success
  // the outcome chips are already visible in the watched-alerts list below.
  const monitoringDiagnosisMutation = useMutation({
    mutationFn: () => {
      if (!definition || !monitoringBinding) {
        throw new Error(t('monitor.monitoringProviderMissing'));
      }
      return aiAgentControlApi.testAgentMonitoringDiagnosis(definition.id, { alert_id: targetKey.trim() });
    },
    onSuccess: async () => {
      data.setMessage(t('monitor.testCompleted'));
      await data.invalidate();
    },
    onError: (err) => data.setError(getApiErrorMessage(err, t, t('monitor.testFailed'))),
  });

  // The synchronous test run's diagnosis, rendered through the same dossier
  // surface as stored diagnoses (its outcome used to be invisible).
  const testDossier = React.useMemo(
    () => (monitoringDiagnosisMutation.data ? dossierFromDiagnosisResult(monitoringDiagnosisMutation.data) : null),
    [monitoringDiagnosisMutation.data],
  );

  return (
    <Stack spacing={2}>
      {data.error && <Alert severity="error" onClose={() => data.setError(null)}>{data.error}</Alert>}
      {data.message && <Alert severity="success" onClose={() => data.setMessage(null)}>{data.message}</Alert>}

      <Section title={t('monitor.status')}>
        <AgentStatusStrip agentKey={agentKey} />
      </Section>

      {isSre && (
        <Section title={t('monitor.alerts')}>
          <AlertOccurrenceList
            groups={monitoringGroups}
            cards={data.queueQuery.data?.monitoring_diagnoses ?? []}
            agentDefinitionId={definition?.id ?? null}
          />
        </Section>
      )}

      <Section id={AGENT_TEST_SECTION_ID} title={isSre ? t('monitor.testAlert') : t('monitor.testTicket')}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ p: 1.5 }} alignItems={{ xs: 'stretch', sm: 'center' }}>
          {isSre ? (
            <>
              <TextField
                variant="standard"
                size="small"
                value={targetKey}
                onChange={(event) => setTargetKey(event.target.value)}
                placeholder={t('monitor.alertIdPlaceholder')}
                sx={{ minWidth: 220 }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && targetKey.trim() && !monitoringDiagnosisMutation.isPending) monitoringDiagnosisMutation.mutate();
                }}
              />
              <Button size="small" variant="contained" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }} startIcon={monitoringDiagnosisMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <ScienceOutlinedIcon />} disabled={!monitoringBinding || !targetKey.trim() || monitoringDiagnosisMutation.isPending || !definition} onClick={() => monitoringDiagnosisMutation.mutate()}>
                {t('monitor.runTest')}
              </Button>
              {!monitoringBinding && (
                <Typography variant="caption" color="text.secondary">{t('monitor.monitoringProviderMissing')}</Typography>
              )}
            </>
          ) : (
            <>
              <TextField
                variant="standard"
                size="small"
                value={targetKey}
                onChange={(event) => setTargetKey(event.target.value)}
                placeholder={t('monitor.ticketNumberPlaceholder')}
                sx={{ minWidth: 220 }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && targetKey.trim() && !triageMutation.isPending) triageMutation.mutate();
                }}
              />
              <Button size="small" variant="contained" sx={{ whiteSpace: 'nowrap', flexShrink: 0 }} startIcon={triageMutation.isPending ? <CircularProgress size={16} color="inherit" /> : <ScienceOutlinedIcon />} disabled={!data.ticketingProviderKey || !targetKey.trim() || triageMutation.isPending || !definition} onClick={() => triageMutation.mutate()}>
                {t('monitor.runTest')}
              </Button>
            </>
          )}
        </Stack>
        {isSre && testDossier && (
          <Box sx={(theme) => ({ px: 1.5, pb: 1.5, pt: 1.25, borderTop: `1px solid ${theme.palette.kanap.border.soft}` })}>
            <AlertDossierBody diagnosis={testDossier} />
          </Box>
        )}
      </Section>

      <Box>
        <Typography variant="subtitle2" fontWeight={500} sx={{ mb: 1 }}>{t('monitor.recentActivity')}</Typography>
        <AgentsActivityPage agentKey={agentKey} compact />
      </Box>

    </Stack>
  );
}

/**
 * 14-day activity trend. Two charts on purpose: proposals/executions are counts
 * and cost is euros, and a single plot with two scales would misread — the
 * second chart stays small and shares the same day axis.
 */
function AgentTrendCharts({ days }: { days: AiAgentControlEvaluationDailyResult['days'] }) {
  const { t } = useTranslation(['agents']);
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const window = React.useMemo(() => days.slice(-14), [days]);

  const options = React.useMemo(() => {
    const proposed = dark ? '#60A5FA' : '#3B82F6';
    const executed = dark ? '#34D399' : '#10B981';
    return {
      theme: dark ? 'ag-default-dark' : 'ag-default',
      background: { fill: 'transparent' },
      data: window,
      series: [
        {
          type: 'bar' as const,
          xKey: 'day',
          yKey: 'proposals',
          yName: t('performance.proposed'),
          fill: proposed,
          stroke: proposed,
          cornerRadius: 4,
        },
        {
          type: 'bar' as const,
          xKey: 'day',
          yKey: 'executed',
          yName: t('performance.executed'),
          fill: executed,
          stroke: executed,
          cornerRadius: 4,
        },
      ],
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left', label: { formatter: (p: { value: number }) => formatNumber(p.value) } },
      ],
      legend: { enabled: true, position: 'bottom' },
      padding: { top: 8, right: 12, bottom: 4, left: 4 },
    };
  }, [dark, t, window]);

  const costOptions = React.useMemo(() => {
    const cost = theme.palette.kanap.orange;
    return {
      theme: dark ? 'ag-default-dark' : 'ag-default',
      background: { fill: 'transparent' },
      data: window,
      series: [
        {
          type: 'line' as const,
          xKey: 'day',
          yKey: 'costEur',
          yName: t('performance.costTrend'),
          stroke: cost,
          strokeWidth: 2,
          marker: { enabled: true, size: 6, fill: cost, stroke: cost },
        },
      ],
      axes: [
        { type: 'category', position: 'bottom' },
        { type: 'number', position: 'left', label: { formatter: (p: { value: number }) => `${p.value.toFixed(2)} EUR` } },
      ],
      legend: { enabled: false },
      padding: { top: 8, right: 12, bottom: 4, left: 4 },
    };
  }, [dark, t, theme, window]);

  if (window.length === 0) {
    return <EmptyState>{t('performance.noTrendData')}</EmptyState>;
  }
  return (
    <Stack spacing={2}>
      <ChartCard title={t('performance.trends')} options={options} height={260} />
      <ChartCard title={t('performance.costTrend')} options={costOptions} height={180} />
    </Stack>
  );
}

/**
 * Autonomy ladder. It lives on the Performance tab because turning a class
 * automatic is a decision taken FROM the agent's track record, not a
 * configuration knob — the evidence and the switch now sit side by side.
 */
function AgentAutonomySection({ definition }: { definition: AiAgentControlAgentDefinition }) {
  const { t } = useTranslation(['agents']);
  const data = useAgentControlData();
  const autonomyQuery = useQuery({
    queryKey: ['ai-agent-control-autonomy', definition.id],
    queryFn: () => aiAgentControlApi.getAgentAutonomy(definition.id),
  });
  const [autonomyTarget, setAutonomyTarget] = React.useState<{
    actionClass: string;
    decided: number;
    rate: string;
    days: number;
    eligible: boolean;
    riskTier: 'low' | 'high';
    acknowledgementRequired: boolean;
    reasons: string[];
  } | null>(null);
  const [overrideReason, setOverrideReason] = React.useState('');
  // The dialog asks for a written reason when the operator overrides the
  // recommendation OR when the class is high-risk (server-enforced either way).
  const reasonRequired = !!autonomyTarget && (!autonomyTarget.eligible || autonomyTarget.acknowledgementRequired);

  const closeDialog = () => {
    setAutonomyTarget(null);
    setOverrideReason('');
  };

  return (
    <>
      <Section title={t('settings.autonomy')} id="autonomy">
        <Stack spacing={1} sx={{ p: 1.5 }}>
          {autonomyQuery.isLoading ? <CircularProgress size={20} /> : (autonomyQuery.data?.items ?? []).map((item) => {
            const highRisk = item.riskTier === 'high';
            const enable = () => setAutonomyTarget({
              actionClass: item.actionClass,
              decided: item.progress.decided,
              rate: formatPercent(item.progress.acceptanceRate),
              days: item.progress.daysActive,
              eligible: item.eligible,
              riskTier: item.riskTier ?? 'high',
              acknowledgementRequired: item.acknowledgementRequired === true,
              reasons: item.reasons,
            });
            const disable = () => data.setAutonomyMutation.mutate({ id: definition.id, actionClass: item.actionClass, mode: 'ask_first' });
            return (
              <Stack
                key={item.actionClass}
                direction={{ xs: 'column', md: 'row' }}
                spacing={1}
                justifyContent="space-between"
                alignItems={{ xs: 'stretch', md: 'center' }}
                sx={(theme) => ({
                  border: '1px solid',
                  // High-risk rows are visually distinct at rest: the operator
                  // must never grant one thinking it is an internal note.
                  borderColor: highRisk ? theme.palette.warning.main : 'divider',
                  bgcolor: highRisk ? theme.palette.kanap.bg.drawer : undefined,
                  borderRadius: 1,
                  p: 1,
                })}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" spacing={0.75} alignItems="center">
                    {highRisk && <WarningAmberOutlinedIcon sx={{ fontSize: 15, color: 'warning.main' }} />}
                    <Typography variant="body2" fontWeight={500}>{t(`settings.actionClasses.${item.actionClass}`, { defaultValue: humanize(item.actionClass) })}</Typography>
                  </Stack>
                  {highRisk && (
                    <Typography variant="caption" sx={{ color: 'warning.main', display: 'block' }}>
                      {t(`settings.autonomyHighRiskNote.${item.actionClass}`, { defaultValue: t('settings.autonomyHighRisk') })}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.secondary">
                    {t('settings.autonomyProgress', {
                      decided: item.progress.decided,
                      required: item.progress.required,
                      rate: item.progress.acceptanceRate == null ? '—' : formatPercent(item.progress.acceptanceRate),
                      requiredRate: formatPercent(item.progress.requiredRate),
                      days: item.progress.daysActive,
                      requiredDays: item.progress.requiredDays,
                    })}
                  </Typography>
                  {!item.eligible && <Typography variant="caption" color="text.secondary" display="block">{item.reasons.map((reason) => t(`settings.autonomyReasons.${reason}`, { defaultValue: humanize(reason) })).join(' ')}</Typography>}
                </Box>
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" color={item.mode === 'automatic' ? 'success' : 'default'} label={item.mode === 'automatic' ? t('settings.automatic') : t('settings.askFirst')} />
                  {item.mode === 'automatic' ? (
                    <Button size="small" variant="outlined" onClick={disable} disabled={data.setAutonomyMutation.isPending}>{t('settings.turnOffAutomatic')}</Button>
                  ) : (
                    <Button size="small" variant="contained" onClick={enable} disabled={(!item.eligible && item.recommendationOverrideAvailable !== true) || data.setAutonomyMutation.isPending}>{item.eligible ? t('settings.turnOnAutomatic') : t('settings.overrideAutomatic')}</Button>
                  )}
                </Stack>
              </Stack>
            );
          })}
        </Stack>
      </Section>

      {autonomyTarget && (
        <KanapDialog
          open={!!autonomyTarget}
          title={t('settings.autonomyDialog.title', {
            actionClass: t(`settings.actionClasses.${autonomyTarget.actionClass}`, { defaultValue: humanize(autonomyTarget.actionClass) }),
          })}
          onClose={closeDialog}
          onSave={() => data.setAutonomyMutation.mutate(
            {
              id: definition.id,
              actionClass: autonomyTarget.actionClass,
              mode: 'automatic',
              confirm: true,
              overrideAcknowledged: reasonRequired,
              overrideReason: reasonRequired ? overrideReason : null,
            },
            { onSuccess: closeDialog },
          )}
          saveLabel={t('settings.autonomyDialog.confirm')}
          saveDisabled={reasonRequired && overrideReason.trim().length < 8}
          saveLoading={data.setAutonomyMutation.isPending}
        >
          <Stack spacing={1.5}>
            {autonomyTarget.acknowledgementRequired && (
              <Alert severity="warning">
                {t(`settings.autonomyDialog.highRisk.${autonomyTarget.actionClass}`, {
                  defaultValue: t('settings.autonomyDialog.highRiskGeneric'),
                })}
              </Alert>
            )}
            <Typography variant="body2">
              {t('settings.autonomyDialog.evidence', { decided: autonomyTarget.decided, rate: autonomyTarget.rate, days: autonomyTarget.days })}
            </Typography>
            {!autonomyTarget.eligible && (
              <>
                <Alert severity="warning">{t('settings.autonomyDialog.overrideFrame')}</Alert>
                <Typography variant="body2" color="text.secondary">
                  {autonomyTarget.reasons.map((reason) => t(`settings.autonomyReasons.${reason}`, { defaultValue: humanize(reason) })).join(' ')}
                </Typography>
              </>
            )}
            {reasonRequired && (
              <SettingsField
                label={t('settings.autonomyDialog.reason')}
                hint={autonomyTarget.acknowledgementRequired ? t('settings.autonomyDialog.reasonHighRiskHint') : undefined}
              >
                <TextField size="small" multiline minRows={2} value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} />
              </SettingsField>
            )}
            <Typography variant="body2" color="text.secondary">{t('settings.autonomyDialog.frame')}</Typography>
          </Stack>
        </KanapDialog>
      )}
    </>
  );
}

function PerformanceTab({ agentKey }: { agentKey: string }) {
  const { t } = useTranslation(['agents']);
  const data = useAgentControlData();
  const definition = data.queueQuery.data?.definitions.find((item) => item.agent_key === agentKey) ?? null;
  const summary = resolveAgentSummary(data.queueQuery.data, agentKey);
  const dailyQuery = useQuery({
    queryKey: ['ai-agent-control-helpdesk-evaluation-daily', definition?.id ?? null, 30],
    queryFn: () => aiAgentControlApi.getHelpdeskEvaluationDaily({ days: 30, agentDefinitionId: definition?.id }),
    enabled: !!definition,
  });
  const daily = dailyQuery.data?.days ?? [];
  return (
    <Stack spacing={2}>
      {data.error && <Alert severity="error" onClose={() => data.setError(null)}>{data.error}</Alert>}
      {data.message && <Alert severity="success" onClose={() => data.setMessage(null)}>{data.message}</Alert>}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: 'repeat(6, minmax(0, 1fr))' }, gap: 1 }}>
        <MetricBlock label={t('performance.acceptance')} value={formatPercent(summary?.evaluation.acceptanceRate)} />
        <MetricBlock label={t('performance.dismissed')} value={formatPercent(summary?.evaluation.dismissRate)} />
        <MetricBlock label={t('performance.latency')} value={summary?.evaluation.medianApprovalLatencySeconds == null ? t('common.notSet') : `${Math.round(summary.evaluation.medianApprovalLatencySeconds / 60)} min`} />
        <MetricBlock label={t('performance.kbHitRate')} value={formatPercent(summary?.evaluation.kbHitRate)} />
        <MetricBlock label={t('performance.costPerTicket')} value={summary?.evaluation.costPerTicketEur == null ? t('common.notSet') : `${summary.evaluation.costPerTicketEur.toFixed(4)} EUR`} />
        <MetricBlock label={t('performance.runsPerTicket')} value={formatNumber(summary?.evaluation.runsPerTicket, 2)} />
      </Box>
      <AgentTrendCharts days={daily} />
      {definition && <AgentAutonomySection definition={definition} />}
    </Stack>
  );
}

function personaText(definition: AiAgentControlAgentDefinition, key: string): string {
  const value = definition.persona_json?.[key];
  if (Array.isArray(value)) return value.join('\n');
  return typeof value === 'string' ? value : '';
}

function personaNestedText(definition: AiAgentControlAgentDefinition, objectKey: string, key: string): string {
  const value = definition.persona_json?.[objectKey];
  if (!isRecord(value)) return '';
  return stringValue(value[key]);
}

function personaEscalationGuidance(definition: AiAgentControlAgentDefinition): string {
  return personaText(definition, 'escalation_guidance') || personaText(definition, 'escalation_text');
}

function personaSharedContext(definition: AiAgentControlAgentDefinition): { enabled: boolean; profileId: string | null } {
  const value = definition.persona_json?.shared_context;
  const shared = isRecord(value) ? value : {};
  const profileId = stringValue(shared.profile_id).trim();
  return {
    enabled: shared.enabled === true,
    profileId: profileId || null,
  };
}

function sharedContextProfileLines(profile: AiSharedContextProfile | null | undefined): string[] {
  const content = profile?.content_json;
  if (isRecord(content) && Array.isArray(content.lines)) {
    return content.lines.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
  }
  return [];
}

function knowledgeFormFromDefinition(definition: AiAgentControlAgentDefinition): {
  enabled: boolean; allLibraries: boolean; libraryIds: string[]; webEnabled: boolean;
  kanapData: AiAgentKanapDataSources | null;
} {
  const scope = definition.scope_policy_json && typeof definition.scope_policy_json === 'object'
    ? definition.scope_policy_json as Record<string, unknown> : {};
  const ks = scope.knowledge_sources && typeof scope.knowledge_sources === 'object'
    ? scope.knowledge_sources as Record<string, unknown> : {};
  const k = ks.knowledge && typeof ks.knowledge === 'object' ? ks.knowledge as Record<string, unknown> : {};
  const web = ks.web && typeof ks.web === 'object' ? ks.web as Record<string, unknown> : {};
  // kanap_data mirrors the backend readKanapDataBlock semantics (enabled only when
  // explicitly true, a domain is on unless explicitly false). An ABSENT block stays
  // null so persistKnowledge never fabricates one — the backend treats absent as
  // disabled and older (helpdesk) agents must keep that default untouched.
  const kanapDataRaw = isRecord(ks.kanap_data) ? ks.kanap_data : null;
  const kanapDomainsRaw = kanapDataRaw && isRecord(kanapDataRaw.domains) ? kanapDataRaw.domains : {};
  return {
    enabled: k.enabled !== false,
    allLibraries: k.all_libraries !== false,
    libraryIds: Array.isArray(k.library_ids) ? k.library_ids.filter((id): id is string => typeof id === 'string') : [],
    webEnabled: web.enabled === true,
    kanapData: kanapDataRaw
      ? {
        enabled: kanapDataRaw.enabled === true,
        domains: {
          applications: kanapDomainsRaw.applications !== false,
          assets: kanapDomainsRaw.assets !== false,
          interfaces: kanapDomainsRaw.interfaces !== false,
          connections: kanapDomainsRaw.connections !== false,
          locations: kanapDomainsRaw.locations !== false,
        },
      }
      : null,
  };
}

// Single source for the knowledge_sources payload shape, shared by the
// dedicated knowledge autosave and the SRE scope autosave (which replaces the
// WHOLE scope_policy_json server-side and must therefore carry the freshest
// knowledge/kanap-data intent instead of a stored snapshot).
function knowledgeSourcesPayloadFromForm(current: ReturnType<typeof knowledgeFormFromDefinition>) {
  return {
    knowledge: {
      enabled: current.enabled,
      all_libraries: current.allLibraries,
      library_ids: current.allLibraries ? [] : current.libraryIds,
    },
    web: { enabled: current.webEnabled },
    // Round-trip the FULL block: the backend replaces knowledge_sources
    // wholesale on this patch, so omitting kanap_data would silently reset an
    // SRE agent's KANAP-data policy to disabled (backend default for the
    // absent block). Send exactly what was read (plus any user edits); an
    // absent block is never fabricated here.
    ...(current.kanapData ? { kanap_data: current.kanapData } : {}),
  };
}

function SettingsTab({ definition, autosaveRegistry, saveQueue }: {
  definition: AiAgentControlAgentDefinition;
  autosaveRegistry: AutosaveRegistry;
  // Shared with the header's inline title/description saves: the backend
  // update is a whole-entity read-modify-write, so every PATCH to this agent
  // must go through one queue or concurrent saves clobber each other.
  saveQueue: AutosaveQueue;
}) {
  const { t } = useTranslation(['agents']);
  const data = useAgentControlData();
  const queryClient = useQueryClient();
  // Freshest known definition, used by every debounced save thunk: the backend
  // replaces the policy JSON columns wholesale, so a thunk that spreads a stale
  // snapshot silently reverts whatever another section just saved. The PATCH
  // response updates this ref synchronously (the cache round-trip through React
  // is one render too late), and a render still carrying the pre-save prop must
  // not undo it — hence the config_version comparison.
  const definitionRef = React.useRef(definition);
  if (definition.id !== definitionRef.current.id || definition.config_version >= definitionRef.current.config_version) {
    definitionRef.current = definition;
  }
  // Autosave persists each change, then patches the cached agent definition in place
  // instead of invalidating the whole workspace query set. This keeps the definition
  // (and the config-version-keyed effective-prompt preview) fresh without refetching
  // the queue/settings queries that drive the page, so a save no longer redraws it.
  const applySavedDefinition = React.useCallback((saved: AiAgentControlAgentDefinition) => {
    definitionRef.current = saved;
    let patched = false;
    queryClient.setQueryData<AiAgentControlQueueOverview>(['ai-agent-control-queue'], (old) => {
      if (!old?.definitions?.some((item) => item.id === saved.id)) return old;
      patched = true;
      return { ...old, definitions: old.definitions.map((item) => (item.id === saved.id ? saved : item)) };
    });
    // No cache entry to patch (evicted, or the definition is not in the list any
    // more): refetch instead of silently leaving the page on a stale definition.
    if (!patched) void queryClient.invalidateQueries({ queryKey: ['ai-agent-control-queue'] });
  }, [queryClient]);
  // Today's real usage, shown inline next to each daily cap so the caps read as
  // a budget in use. The control bar keeps the compact runs/tokens/cost facts;
  // this is the detailed, per-field view of the same source.
  const dailyUsage = resolveAgentSummary(data.queueQuery.data, definition.agent_key)?.guardrails.daily ?? null;
  const isHelpdesk = definition.agent_type === 'helpdesk';
  const isSre = definition.agent_type === 'sre';
  const monitoringBinding = providerBindingForDefinition(definition, 'monitoring');
  const [pendingPreset, setPendingPreset] = React.useState<TargetingPresetKey | null>(null);
  const sharedContext = personaSharedContext(definition);
  const storedInstructions = personaText(definition, 'instructions');
  const storedEscalationGuidance = personaEscalationGuidance(definition);
  const storedOutputStyleTone = personaNestedText(definition, 'output_style', 'tone') || personaText(definition, 'tone');
  const [agentForm, setAgentForm] = React.useState({
    mission: personaText(definition, 'mission'),
    outputStyleTone: storedOutputStyleTone,
    outputStyleLanguage: personaNestedText(definition, 'output_style', 'language') || 'auto',
    instructions: storedInstructions,
    instructionsDraft: mergeInstructionsForDisplay({
      instructions: storedInstructions,
      escalationGuidance: storedEscalationGuidance,
      outputStyleTone: storedOutputStyleTone,
    }),
    instructionsTouched: false,
    escalationGuidance: storedEscalationGuidance,
    sharedContextEnabled: sharedContext.enabled,
    sharedContextProfileId: sharedContext.profileId,
  });
  const [sharedContextDialogOpen, setSharedContextDialogOpen] = React.useState(false);
  const [sharedContextDraftName, setSharedContextDraftName] = React.useState('');
  const [sharedContextDraftLines, setSharedContextDraftLines] = React.useState('');
  const effectivePromptTasks = isSre ? SRE_EFFECTIVE_PROMPT_TASKS : HELPDESK_EFFECTIVE_PROMPT_TASKS;
  const [effectivePromptTask, setEffectivePromptTask] = React.useState<EffectivePromptTaskKey>(effectivePromptTasks[0]);
  // The effective prompt is a diagnostic, not a daily control: collapsed by
  // default, and the choice is remembered (charter: UI state in localStorage).
  const [effectivePromptOpen, setEffectivePromptOpen] = useLocalStorageState(EFFECTIVE_PROMPT_OPEN_KEY, false);
  const [operatingMoreOpen, setOperatingMoreOpen] = useLocalStorageState(OPERATING_MORE_OPEN_KEY, false);
  const [form, setForm] = React.useState<HelpdeskSettingsForm>(() => settingsFormFromDefinition(definition));
  const [sreForm, setSreForm] = React.useState<SreSettingsForm>(() => sreSettingsFormFromDefinition(definition));
  const [pendingMonitoringPreset, setPendingMonitoringPreset] = React.useState<{
    preset: MonitoringTargetingPresetKey;
    filters: MonitoringTargetingFilter[];
  } | null>(null);
  const [knowledgeForm, setKnowledgeForm] = React.useState(() => knowledgeFormFromDefinition(definition));
  const [capabilityForm, setCapabilityForm] = React.useState<Record<string, boolean>>(() => capabilityEnabledState(definition));
  // What the instructions can name: statuses and (when Assignment is on) technician groups
  // and technicians.
  // Read-only reference for the admin; same cache entries as the targeting filters.
  const routingGroupsEnabled = !isSre && capabilityForm.assignment === true;
  const classificationEnabled = !isSre && capabilityForm.classification === true;
  const referencePrioritiesQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', definition.id, 'priority', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(definition.id, 'priority', { limit: 50 }),
    enabled: classificationEnabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const referenceTypesQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', definition.id, 'type', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(definition.id, 'type', { limit: 50 }),
    enabled: classificationEnabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const referenceStatusesQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', definition.id, 'status', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(definition.id, 'status', { limit: 50 }),
    enabled: !isSre,
    staleTime: 5 * 60 * 1000,
  });
  const webSearchAvailable = useFeatures().config.features.aiWebSearch;
  const librariesQuery = useQuery({
    queryKey: ['knowledge-libraries'],
    queryFn: () => aiAgentControlApi.listKnowledgeLibraries(),
    enabled: knowledgeForm.enabled,
    staleTime: 60_000,
  });
  const sharedContextProfilesQuery = useQuery({
    queryKey: SHARED_CONTEXT_PROFILES_QUERY_KEY,
    queryFn: () => aiAgentControlApi.listSharedContextProfiles(),
    staleTime: 60_000,
  });
  const modelConfigsQuery = useQuery({
    queryKey: ['ai-model-configs', 'assignable'],
    queryFn: () => aiModelConfigsApi.listAssignable(),
    staleTime: 60_000,
  });
  const activeModelConfigs = (modelConfigsQuery.data?.model_configs ?? []).filter((entry) => entry.status === 'active');
  const effectivePromptQuery = useQuery({
    queryKey: ['ai-agent-effective-prompt', definition.id, definition.config_version],
    queryFn: () => aiAgentControlApi.getEffectivePrompt(definition.id),
    staleTime: 30_000,
    // Keep showing the previous compiled prompt while the next version loads, so the
    // preview updates seamlessly after a save instead of flashing a loading state.
    placeholderData: (previousData) => previousData,
  });
  const previewScopeJson = React.useMemo(() => {
    if (!isHelpdesk) return '';
    try {
      return JSON.stringify(helpdeskDefinitionSettingsPayload(definition, form).scope_policy_json ?? {});
    } catch {
      // The payload builder throws when the agent has no ticketing binding yet.
      // The preview is simply unavailable then — it must never crash the render
      // that an autosave-scheduling edit just triggered.
      return '';
    }
  }, [definition, form, isHelpdesk]);
  const targetingPreviewQuery = useQuery({
    queryKey: ['ai-agent-targeting-preview', definition.id, previewScopeJson],
    queryFn: () => aiAgentControlApi.previewAgentTargeting(definition.id, {
      scope_policy_json: JSON.parse(previewScopeJson || '{}') as Record<string, unknown>,
    }),
    enabled: isHelpdesk && !!previewScopeJson,
    staleTime: 30_000,
    placeholderData: (previousData) => previousData,
  });
  const targetingStatusOptionsQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', definition.id, 'status', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(definition.id, 'status', { limit: 50 }),
    enabled: isHelpdesk,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const presetStatusValues = React.useMemo(
    () => openStatusValues(targetingStatusOptionsQuery.data?.options ?? []),
    [targetingStatusOptionsQuery.data?.options],
  );
  const presetStatusValuesKey = presetStatusValues.join('|');

  // Autosave: one controller per section, surfacing a subtle "Saving…/Saved"
  // indicator in each section header. No Save buttons — KANAP autosaves in-place
  // edits of existing entities (design charter, anti-pattern #15).
  // The alert is global, but it names the section that failed: five controllers
  // share it, and "Could not save the agent." alone leaves the user hunting.
  const reportSaveError = React.useCallback((err: unknown, section: string) => {
    const reason = getApiErrorMessage(err, t, '');
    const failure = t('messages.sectionSaveFailed', { section });
    data.setError(reason ? `${reason} ${failure}` : failure);
  }, [data, t]);
  // One controller drives both the Targeting and the Operating settings sections;
  // remember which one the user last edited so the alert points at the right one.
  const settingsSectionRef = React.useRef<'targeting' | 'operating'>('operating');
  const onIdentitySaveError = React.useCallback(
    (err: unknown) => {
      // A limit block is not an API failure: show its own plain-language
      // message instead of the generic "section failed to save" wording.
      if (err instanceof Error && (err as Error & { personaLimit?: boolean }).personaLimit) {
        data.setError(err.message);
        return;
      }
      reportSaveError(err, t('settings.objective'));
    },
    [data, reportSaveError, t],
  );
  const onSettingsSaveError = React.useCallback(
    (err: unknown) => reportSaveError(err, t(settingsSectionRef.current === 'targeting' ? 'settings.targeting' : 'settings.operatingSettings')),
    [reportSaveError, t],
  );
  const onKnowledgeSaveError = React.useCallback(
    (err: unknown) => reportSaveError(err, t('settings.knowledgeSources')),
    [reportSaveError, t],
  );
  const onCapabilitiesSaveError = React.useCallback(
    (err: unknown) => reportSaveError(err, t('settings.capabilities')),
    [reportSaveError, t],
  );
  // Every write to this agent goes through one queue: the backend replaces the
  // policy JSON columns wholesale, so overlapping PATCHes lose updates.
  const setModelMutation = useMutation({
    mutationFn: (modelConfigId: string | null) => saveQueue.run(async () => {
      const res = await aiAgentControlApi.updateAgent(definitionRef.current.id, { llm_model_config_id: modelConfigId });
      applySavedDefinition(res.agent_definition);
    }),
    onError: onSettingsSaveError,
  });
  const autosaveOptions = { queue: saveQueue, registry: autosaveRegistry };
  const identityAutosave = useAutosave({ ...autosaveOptions, onError: onIdentitySaveError });
  const settingsAutosave = useAutosave({ ...autosaveOptions, onError: onSettingsSaveError });
  const sreAutosave = useAutosave({ ...autosaveOptions, onError: onSettingsSaveError });
  const knowledgeAutosave = useAutosave({ ...autosaveOptions, onError: onKnowledgeSaveError });
  const capabilitiesAutosave = useAutosave({ ...autosaveOptions, onError: onCapabilitiesSaveError });

  // Refs mirror the latest form state so debounced flush thunks read current
  // values at execution time, not stale schedule-time values.
  const agentFormRef = React.useRef(agentForm);
  agentFormRef.current = agentForm;
  // The instructions textarea, so the reference panel can insert at the caret.
  const instructionsInputRef = React.useRef<HTMLTextAreaElement | null>(null);
  const formRef = React.useRef(form);
  formRef.current = form;
  const sreFormRef = React.useRef(sreForm);
  sreFormRef.current = sreForm;
  const knowledgeFormRef = React.useRef(knowledgeForm);
  knowledgeFormRef.current = knowledgeForm;
  const capabilityFormRef = React.useRef(capabilityForm);
  capabilityFormRef.current = capabilityForm;



  React.useEffect(() => {
    if (presetStatusValues.length === 0) return;
    setForm((current) => {
      let changed = false;
      const filters = current.filters.map((filter) => {
        if (filter.field !== 'status' || statusFilterValues(filter.value).length > 0) return filter;
        changed = true;
        return { ...filter, value: presetStatusValues };
      });
      return changed ? { ...current, filters } : current;
    });
  }, [presetStatusValuesKey]);

  const persistIdentity = React.useCallback(async () => {
    const current = agentFormRef.current;
    if (!canPersistIdentity({
      mission: current.mission,
      instructionsDraft: current.instructionsDraft,
      instructionsTouched: current.instructionsTouched,
    })) {
      // Throw, never silently return: a swallowed flush would show "Saved"
      // while dropping every pending change in this autosave group. The
      // error state clears on the next schedule, i.e. as soon as the user
      // edits the text back under the limit.
      const blocked: Error & { personaLimit?: boolean } = new Error(t('settings.personaBlockedSave'));
      blocked.personaLimit = true;
      throw blocked;
    }
    const res = await aiAgentControlApi.updateAgent(definitionRef.current.id, {
      persona_json: personaIdentitySavePatch({
        mission: current.mission,
        instructionsStored: current.instructions,
        instructionsDraft: current.instructionsDraft,
        instructionsTouched: current.instructionsTouched,
        escalationGuidance: current.escalationGuidance,
        outputStyleTone: current.outputStyleTone,
        outputStyleLanguage: current.outputStyleLanguage,
        sharedContextEnabled: current.sharedContextEnabled,
        sharedContextProfileId: current.sharedContextProfileId,
      }),
    });
    applySavedDefinition(res.agent_definition);
  }, [applySavedDefinition, t]);

  const createSharedContextProfileMutation = useMutation({
    mutationFn: (payload: { name: string; lines: string[] }) => aiAgentControlApi.createSharedContextProfile({
      name: payload.name,
      lines: payload.lines,
    }),
    onSuccess: async (result) => {
      await sharedContextProfilesQuery.refetch();
      const profileId = result.profile.id;
      setAgentForm((current) => {
        const next = {
          ...current,
          sharedContextEnabled: true,
          sharedContextProfileId: profileId,
        };
        agentFormRef.current = next;
        return next;
      });
      setSharedContextDialogOpen(false);
      setSharedContextDraftName('');
      setSharedContextDraftLines('');
      identityAutosave.schedule(persistIdentity);
    },
    onError: onIdentitySaveError,
  });

  const persistSettings = React.useCallback(async () => {
    const current = formRef.current;
    // Read the LATEST saved definition (same rule as persistSreSettings): watching
    // is owned by the Monitor run-mode control and must round-trip unchanged.
    const definitionNow = definitionRef.current;
    const definitionPayload = helpdeskDefinitionSettingsPayload(definitionNow, current);
    const res = await aiAgentControlApi.updateAgent(definitionNow.id, definitionPayload);
    applySavedDefinition(res.agent_definition);
  }, [applySavedDefinition]);

  // SRE watch/targeting/pace autosave. The scope patch spreads the stored
  // scope_policy_json so sibling keys survive the round-trip — read from
  // definitionRef (the LATEST saved definition), never the render-time
  // snapshot this debounced thunk closed over: the backend replaces
  // scope_policy_json wholesale, so a stale snapshot would silently revert
  // whatever another section's autosave (knowledge/kanap-data) persisted in
  // the meantime. knowledge_sources itself is additionally composed fresh
  // from the knowledge form — the local authority — so the two autosaves
  // agree even when their requests overlap in flight.
  const persistSreSettings = React.useCallback(async () => {
    const current = sreFormRef.current;
    const definitionNow = definitionRef.current;
    const trigger = policyObject(definitionNow.trigger_policy_json);
    const scope = policyObject(definitionNow.scope_policy_json);
    const ingestion = nestedPolicy(scope, 'ingestion');
    // Watching belongs to the Monitor run-mode control; carry the stored value
    // through unchanged so a targeting/pace save never flips it.
    const watchingNow = policyObject(trigger.scheduled_poll).enabled === true;
    const enabledAt = watchingNow
      ? stringValue(ingestion.enabled_at) || new Date().toISOString()
      : stringValue(ingestion.enabled_at) || null;
    const res = await aiAgentControlApi.updateAgent(definitionNow.id, {
      trigger_policy_json: {
        ...trigger,
        scheduled_poll: {
          ...policyObject(trigger.scheduled_poll),
          enabled: watchingNow,
          interval_minutes: clampNumber(
            positiveNumber(current.checkIntervalMinutes, DEFAULT_CHECK_INTERVAL_MINUTES),
            MIN_CHECK_INTERVAL_MINUTES,
            MAX_CHECK_INTERVAL_MINUTES,
          ),
        },
        production_polling_enabled: watchingNow,
        automatic_writes_enabled: false,
      },
      // Spread the stored queue policy: the backend replaces the column
      // wholesale, so only the retention key may change here.
      queue_policy_json: {
        ...policyObject(definitionNow.queue_policy_json),
        activity_retention_days: clampNumber(
          positiveNumber(current.activityRetentionDays, DEFAULT_ACTIVITY_RETENTION_DAYS),
          MIN_ACTIVITY_RETENTION_DAYS,
          MAX_ACTIVITY_RETENTION_DAYS,
        ),
      },
      scope_policy_json: {
        ...scope,
        knowledge_sources: {
          ...policyObject(scope.knowledge_sources),
          ...knowledgeSourcesPayloadFromForm(knowledgeFormRef.current),
        },
        targeting: monitoringTargetingModelFromFilters(current.filters),
        ingestion: {
          ...ingestion,
          enabled_at: enabledAt,
          max_alerts_per_cycle: clampNumber(positiveNumber(current.maxAlerts, DEFAULT_SRE_MAX_ALERTS), 1, SRE_MAX_ALERTS_CAP),
          max_provider_requests_per_cycle: clampNumber(positiveNumber(current.maxRequests, DEFAULT_SRE_MAX_REQUESTS), 1, SRE_MAX_REQUESTS_CAP),
        },
      },
    });
    applySavedDefinition(res.agent_definition);
  }, [applySavedDefinition]);

  // Both thunks below read definitionRef.current, never the render-time
  // snapshot they closed over: a save scheduled before a sibling section's
  // PATCH landed would otherwise rebuild its payload from a pre-save
  // definition and revert it.
  const persistKnowledge = React.useCallback(async () => {
    const res = await aiAgentControlApi.updateAgent(definitionRef.current.id, {
      knowledge_sources: knowledgeSourcesPayloadFromForm(knowledgeFormRef.current),
    });
    applySavedDefinition(res.agent_definition);
  }, [applySavedDefinition]);

  const persistCapabilities = React.useCallback(async () => {
    const definitionNow = definitionRef.current;
    let allowed: unknown[] = capabilityEntries(definitionNow.allowed_capabilities_json);
    for (const [groupKey, enabled] of Object.entries(capabilityFormRef.current)) {
      allowed = allowedCapabilitiesWithGroup({ ...definitionNow, allowed_capabilities_json: allowed }, groupKey, enabled);
    }
    const res = await aiAgentControlApi.updateAgent(definitionNow.id, {
      allowed_capabilities_json: allowed,
    });
    applySavedDefinition(res.agent_definition);
    await queryClient.invalidateQueries({ queryKey: ['ai-agent-control-autonomy', definitionNow.id] });
  }, [applySavedDefinition, queryClient]);

  const applyAgentForm = (patch: Partial<typeof agentForm>) => {
    const next = { ...agentFormRef.current, ...patch };
    agentFormRef.current = next;
    setAgentForm(next);
    if (canPersistIdentity({
      mission: next.mission,
      instructionsDraft: next.instructionsDraft,
      instructionsTouched: next.instructionsTouched,
    })) {
      identityAutosave.schedule(persistIdentity);
    }
  };
  const updateAgent = <K extends keyof typeof agentForm>(field: K, value: typeof agentForm[K]) => {
    applyAgentForm({ [field]: value } as Partial<typeof agentForm>);
  };
  const updateAgentPatch = (patch: Partial<typeof agentForm>) => {
    applyAgentForm(patch);
  };
  // Clicking a name in the reference panel types it into the instructions at the
  // caret, through the same setter as the keyboard, so autosave and the character
  // limit behave exactly as they do when the admin types.
  const insertIntoInstructions = (name: string) => {
    const input = instructionsInputRef.current;
    const current = agentFormRef.current.instructionsDraft ?? '';
    const start = input ? input.selectionStart ?? current.length : current.length;
    const end = input ? input.selectionEnd ?? start : current.length;
    const next = insertAtCaret(current, start, end, name);
    applyAgentForm({ instructionsDraft: next.text, instructionsTouched: true });
    window.requestAnimationFrame(() => {
      const node = instructionsInputRef.current;
      if (!node) return;
      node.focus();
      node.setSelectionRange(next.caret, next.caret);
    });
  };
  const update = <K extends keyof HelpdeskSettingsForm>(field: K, value: HelpdeskSettingsForm[K]) => {
    settingsSectionRef.current = 'operating';
    setForm((current) => ({ ...current, [field]: value }));
    settingsAutosave.schedule(persistSettings);
  };
  const updateFilters = (filters: TargetingFilter[]) => {
    settingsSectionRef.current = 'targeting';
    setForm((current) => ({
      ...current,
      filters,
      scopeMode: modeFromFilters(filters),
      categoryId: categoryFromFilters(filters),
      entityId: entityFromFilters(filters),
      horizonHours: String(createdHorizonHoursFromFilters(filters, current.horizonHours)),
    }));
    settingsAutosave.schedule(persistSettings);
  };
  const applyTargetingPreset = (preset: TargetingPresetKey) => {
    updateFilters(targetingPresetFilters(preset, positiveNumber(form.horizonHours, DEFAULT_HORIZON_HOURS), presetStatusValues));
  };
  const requestTargetingPreset = (preset: TargetingPresetKey) => {
    if (form.filters.length > 0) {
      setPendingPreset(preset);
      return;
    }
    applyTargetingPreset(preset);
  };
  const updateSre = (patch: Partial<SreSettingsForm>) => {
    settingsSectionRef.current = 'filters' in patch ? 'targeting' : 'operating';
    setSreForm((current) => ({ ...current, ...patch }));
    sreAutosave.schedule(persistSreSettings);
  };
  const requestMonitoringPreset = (preset: MonitoringTargetingPresetKey, filters: MonitoringTargetingFilter[]) => {
    if (sreForm.filters.length > 0) {
      setPendingMonitoringPreset({ preset, filters });
      return;
    }
    updateSre({ filters });
  };
  const updateKnowledge = (patch: Partial<typeof knowledgeForm>) => {
    setKnowledgeForm((current) => ({ ...current, ...patch }));
    knowledgeAutosave.schedule(persistKnowledge);
  };
  // Displayed KANAP-data state: an absent block reads as the backend default
  // (disabled, all domains on). The block is only materialized (and therefore
  // persisted) once the user actually touches a toggle.
  const kanapDataView: AiAgentKanapDataSources = knowledgeForm.kanapData ?? {
    enabled: false,
    domains: { applications: true, assets: true, interfaces: true, connections: true, locations: true },
  };
  const updateKanapData = (patch: Partial<AiAgentKanapDataSources>) => {
    updateKnowledge({ kanapData: { ...kanapDataView, ...patch } });
  };
  const updateKanapDataDomain = (domain: typeof KANAP_DATA_DOMAINS[number], enabled: boolean) => {
    updateKnowledge({ kanapData: { ...kanapDataView, domains: { ...kanapDataView.domains, [domain]: enabled } } });
  };
  const updateCapability = (groupKey: string, enabled: boolean) => {
    setCapabilityForm((current) => ({ ...current, [groupKey]: enabled }));
    capabilitiesAutosave.schedule(persistCapabilities);
  };
  const sharedContextProfiles = (sharedContextProfilesQuery.data?.items ?? []).filter((profile) => profile.status === 'active');
  const selectedSharedContextProfile = sharedContextProfiles.find((profile) => profile.id === agentForm.sharedContextProfileId) ?? null;
  const selectedSharedContextLines = sharedContextProfileLines(selectedSharedContextProfile);
  const effectivePromptText = effectivePromptQuery.data?.tasks?.[effectivePromptTask]?.system_prompt ?? '';
  const personaLimits = measurePersonaIdentityLimits({
    mission: agentForm.mission,
    instructionsDraft: agentForm.instructionsDraft,
  });
  const promptBounds = collectEffectivePromptBounds(effectivePromptQuery.data);
  const droppedSharedContextLines = droppedSharedContextLineCount(promptBounds);
  const droppedInstructionLines = droppedInstructionLineCount(promptBounds);
  const truncatedSharedContextLines = truncatedSharedContextLineCount(promptBounds);
  // Cost transparency: guidance ships with every LLM step of a run, so a large
  // persona + profile spends real per-run budget. ~4 chars/token is close
  // enough for a heads-up; shown only once it starts to matter.
  const sharedContextChars = agentForm.sharedContextEnabled
    ? selectedSharedContextLines.reduce((total, line) => total + line.length, 0)
    : 0;
  const guidanceTokens = Math.ceil((personaLimits.purposeChars + personaLimits.instructionsChars + sharedContextChars) / 4);
  const perRunTokenCap = isHelpdesk ? positiveNumber(form.perRunTokens, DEFAULT_PER_RUN_TOKENS) : null;
  const guidanceCostVisible = perRunTokenCap != null && guidanceTokens > perRunTokenCap * 0.25;
  const handleCreateSharedContextProfile = () => {
    const name = sharedContextDraftName.trim();
    const lines = sharedContextDraftLines.split('\n').map((line) => line.trim()).filter(Boolean);
    if (!name || lines.length === 0) return;
    createSharedContextProfileMutation.mutate({ name, lines });
  };
  const createdWithinFilter = form.filters.find((filter) => filter.field === 'created_at') ?? null;

  return (
    <Stack spacing={2}>
      {data.error && <Alert severity="error" onClose={() => data.setError(null)}>{data.error}</Alert>}
      {data.message && <Alert severity="success" onClose={() => data.setMessage(null)}>{data.message}</Alert>}
      {isSre && !monitoringBinding && <Alert severity="warning">{t('settings.monitoringNotConnected')}</Alert>}
      {isHelpdesk && (
        <Section title={t('settings.targeting')} actions={<SaveIndicator status={settingsAutosave.status} />}>
        <Stack spacing={1.5} sx={{ p: 1.5 }}>
          <Stack spacing={0.5}>
            <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap">
              {(['new_tickets', 'all_open', 'handled'] as TargetingPresetKey[]).map((preset) => (
                <Button key={preset} size="small" variant="text" onClick={() => requestTargetingPreset(preset)} disabled={presetStatusValues.length === 0} sx={actionLinkButtonSx}>
                  {t(`settings.targetingPresets.${preset}`)}
                </Button>
              ))}
            </Stack>
            {createdWithinFilter ? (
              <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary })}>
                {t(createdWithinFilter.unit === 'days' ? 'settings.targetingBuilder.newTicketsDays' : 'settings.targetingBuilder.newTicketsHours', {
                  count: Number(createdWithinFilter.amount) || 1,
                })}
              </Typography>
            ) : null}
          </Stack>
          <SettingsField label={t('settings.targetingBuilder.filters')} hint={t('settings.targetingBuilder.hint')}>
            <HelpdeskTargetingFilterBuilder agentId={definition.id} filters={form.filters} onChange={updateFilters} />
          </SettingsField>
          <TargetingPreviewSummary
            loading={targetingPreviewQuery.isFetching}
            error={targetingPreviewQuery.isError}
            preview={targetingPreviewQuery.data?.preview}
          />
        </Stack>
        </Section>
      )}
      {isSre && (
        <Section title={t('settings.targeting')} actions={<SaveIndicator status={sreAutosave.status} />}>
          <Stack spacing={1.5} sx={{ p: 1.5 }}>
            <MonitoringTargetingPresetButtons onApply={requestMonitoringPreset} />
            <SettingsField label={t('settings.targetingBuilder.filters')} hint={t('settings.monitoringBuilder.hint')}>
              <MonitoringTargetingFilterBuilder agentId={definition.id} filters={sreForm.filters} onChange={(filters) => updateSre({ filters })} />
            </SettingsField>
          </Stack>
        </Section>
      )}

      {/* What the agent is allowed to do comes first: it frames everything
          the objective below can ask for. */}
      {isHelpdesk && (
        <Section
          title={t('settings.capabilities')}
          info={t('settings.capabilitiesInfo')}
          actions={<SaveIndicator status={capabilitiesAutosave.status} />}
        >
          <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))' }, columnGap: 2, rowGap: 0.25 }}>
            {HELPDESK_CAPABILITY_GROUPS.map((group) => {
              const enabled = capabilityForm[group.key] === true;
              return (
                <FormControlLabel
                  key={group.key}
                  sx={{ m: 0, gap: 0.75, '& .MuiFormControlLabel-label': { fontSize: 13, color: enabled ? 'kanap.text.primary' : 'kanap.text.tertiary' } }}
                  control={(
                    <Checkbox
                      size="small"
                      checked={enabled}
                      onChange={(event) => updateCapability(group.key, event.target.checked)}
                      sx={{ p: 0.5, '& .MuiSvgIcon-root': { fontSize: 17 } }}
                    />
                  )}
                  label={t(`settings.capabilityGroups.${group.key}`, { defaultValue: humanize(group.key) })}
                />
              );
            })}
          </Box>
        </Section>
      )}

      <Section
        title={t('settings.objective')}
        actions={<SaveIndicator status={identityAutosave.status} />}
      >
        <Stack spacing={1.5} sx={{ p: 1.5 }}>
          <Box
            sx={{
              display: 'grid',
              // Left column sized to the fields (PropertyRow caps them at 480px) so the
              // reference panel sits next to the instructions, not at the far right.
              gridTemplateColumns: { xs: '1fr', md: 'minmax(0, 520px) minmax(260px, 360px)' },
              justifyContent: 'start',
              columnGap: 3,
              rowGap: 1.5,
              alignItems: 'start',
            }}
          >
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1,
            }}
          >
            <SettingsField
              label={t('settings.purpose')}
              info={t('settings.purposeInfo')}
              hint={personaLimits.purposeOverLimit
                ? <Box component="span" sx={{ color: 'error.main' }}>{t('settings.purposeOverLimit', { max: MAX_PERSONA_PURPOSE_CHARS })}</Box>
                : personaLimits.purposeNearLimit
                  ? <span>{t('settings.charCounter', { used: personaLimits.purposeChars, max: MAX_PERSONA_PURPOSE_CHARS })}</span>
                  : undefined}
            >
              {/* Wrapping display of a single logical line: Enter is swallowed
                  so what the user sees matches what the backend stores. */}
              <TextField
                size="small"
                variant="standard"
                fullWidth
                multiline
                minRows={2}
                maxRows={4}
                value={agentForm.mission}
                placeholder={t('settings.purposePlaceholder')}
                sx={[drawerFieldValueSx, personaLimits.purposeOverLimit ? { '& .MuiInputBase-input': { color: 'error.main' } } : null]}
                onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault(); }}
                onChange={(event) => updateAgent('mission', event.target.value.replace(/\n/g, ' '))}
              />
            </SettingsField>
            <SettingsField
              label={t('settings.instructions')}
              info={t('settings.instructionsInfo')}
              hint={personaLimits.instructionsOverLimit
                ? <Box component="span" sx={{ color: 'error.main' }}>{t('settings.instructionsOverLimit', { max: MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS.toLocaleString() })}</Box>
                : personaLimits.instructionsNearLimit
                  ? <span>{t('settings.charCounter', { used: personaLimits.instructionsChars.toLocaleString(), max: MAX_PERSONA_INSTRUCTIONS_TOTAL_CHARS.toLocaleString() })}</span>
                  : undefined}
            >
              <TextField
                size="small"
                variant="standard"
                multiline
                minRows={5}
                maxRows={24}
                value={agentForm.instructionsDraft}
                placeholder={t('settings.instructionsPlaceholder')}
                sx={agentPersonaFieldSx}
                inputRef={instructionsInputRef}
                onChange={(event) => applyAgentForm({
                  instructionsDraft: event.target.value,
                  instructionsTouched: true,
                })}
              />
            </SettingsField>
            <SettingsField label={t('settings.replyLanguage')} info={t('settings.replyLanguageInfo')}>
              <Select
                variant="standard"
                value={agentForm.outputStyleLanguage}
                sx={pageSelectSx}
                onChange={(event) => updateAgent('outputStyleLanguage', event.target.value)}
                MenuProps={compactSelectMenuProps}
              >
                {['auto', 'fr', 'en', 'de', 'es'].map((value) => (
                  <MenuItem key={value} value={value} sx={drawerMenuItemSx}>{t(`settings.outputStyleLanguageOptions.${value}`)}</MenuItem>
                ))}
              </Select>
            </SettingsField>
          </Box>
          {!isSre && (
            <InstructionsReferencePanel
              statuses={referenceStatusesQuery.data?.options ?? null}
              routingEnabled={routingGroupsEnabled}
              classificationEnabled={classificationEnabled}
              priorities={referencePrioritiesQuery.data?.options ?? []}
              types={referenceTypesQuery.data?.options ?? []}
              agentId={definition.id}
              onInsert={insertIntoInstructions}
            />
          )}
          </Box>

          {/* Shared context: off ⇒ only the switch. The profile picker, the
              create link and the preview appear once it is actually used. */}
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
            <Stack direction="row" spacing={0.5} alignItems="center">
              <FormControlLabel
                sx={featureSwitchRowSx}
                control={(
                  <Switch
                    size="small"
                    checked={agentForm.sharedContextEnabled}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      updateAgentPatch({
                        sharedContextEnabled: checked,
                        sharedContextProfileId: checked && !agentForm.sharedContextProfileId && sharedContextProfiles[0]
                          ? sharedContextProfiles[0].id
                          : agentForm.sharedContextProfileId,
                      });
                    }}
                  />
                )}
                label={t('settings.sharedContextEnabled')}
              />
              <Tooltip title={t('settings.sharedContextHint')} placement="top">
                <InfoOutlinedIcon sx={{ fontSize: 13, color: 'kanap.text.tertiary' }} />
              </Tooltip>
            </Stack>
            <Collapse in={agentForm.sharedContextEnabled} unmountOnExit>
              <Stack spacing={1} sx={{ pt: 0.5, maxWidth: 520 }}>
                <Select
                  variant="standard"
                  value={agentForm.sharedContextProfileId ?? ''}
                  displayEmpty
                  disabled={sharedContextProfiles.length === 0}
                  sx={pageSelectSx}
                  onChange={(event) => updateAgent('sharedContextProfileId', event.target.value || null)}
                  MenuProps={compactSelectMenuProps}
                >
                  <MenuItem value="" sx={drawerMenuItemSx}>{t('settings.sharedContextNoProfile')}</MenuItem>
                  {sharedContextProfiles.map((profile) => (
                    <MenuItem key={profile.id} value={profile.id} sx={drawerMenuItemSx}>{profile.name}</MenuItem>
                  ))}
                </Select>
                <Box sx={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <Button size="small" variant="text" sx={actionLinkButtonSx} onClick={() => setSharedContextDialogOpen(true)}>
                    {`+ ${t('settings.sharedContextCreate')}`}
                  </Button>
                </Box>
                <Box
                  sx={(theme) => ({
                    minHeight: 60,
                    maxHeight: 150,
                    overflow: 'auto',
                    border: `1px solid ${theme.palette.kanap.border.default}`,
                    borderRadius: 1,
                    bgcolor: theme.palette.kanap.bg.composer,
                    px: 1,
                    py: 0.75,
                    fontSize: 13,
                    color: theme.palette.kanap.text.primary,
                    whiteSpace: 'pre-wrap',
                  })}
                >
                  {selectedSharedContextLines.length > 0
                    ? selectedSharedContextLines.join('\n')
                    : t('settings.sharedContextEmptyPreview')}
                </Box>
              </Stack>
            </Collapse>
          </Box>

          {(droppedSharedContextLines > 0 || droppedInstructionLines > 0 || truncatedSharedContextLines > 0 || guidanceCostVisible) && (
            <Stack spacing={0.25}>
              {droppedSharedContextLines > 0 && (
                <Typography sx={{ fontSize: 12, color: 'warning.main', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <WarningAmberOutlinedIcon sx={{ fontSize: 14 }} />
                  {t('settings.sharedContextClamped', { count: droppedSharedContextLines })}
                </Typography>
              )}
              {truncatedSharedContextLines > 0 && (
                <Typography sx={{ fontSize: 12, color: 'warning.main', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <WarningAmberOutlinedIcon sx={{ fontSize: 14 }} />
                  {t('settings.sharedContextTruncated', { count: truncatedSharedContextLines })}
                </Typography>
              )}
              {droppedInstructionLines > 0 && (
                <Typography sx={{ fontSize: 12, color: 'warning.main', display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <WarningAmberOutlinedIcon sx={{ fontSize: 14 }} />
                  {t('settings.instructionsClamped', { count: droppedInstructionLines })}
                </Typography>
              )}
              {guidanceCostVisible && (
                <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.secondary })}>
                  {t('settings.promptCostHint', { tokens: guidanceTokens.toLocaleString(), cap: (perRunTokenCap ?? 0).toLocaleString() })}
                </Typography>
              )}
            </Stack>
          )}

          {/* Effective prompt: a read-only diagnostic, collapsed by default so
              it stops dominating the block. The choice is remembered per user. */}
          <Box sx={{ borderTop: '1px solid', borderColor: 'divider', pt: 1 }}>
            <Button
              size="small"
              variant="text"
              sx={actionLinkButtonSx}
              endIcon={effectivePromptOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              onClick={() => setEffectivePromptOpen((open) => !open)}
            >
              {effectivePromptOpen ? t('settings.effectivePromptHide') : t('settings.effectivePromptShow')}
            </Button>
            <Collapse in={effectivePromptOpen} unmountOnExit>
              <Stack spacing={1} sx={{ pt: 1 }}>
                {(droppedSharedContextLines > 0 || droppedInstructionLines > 0 || truncatedSharedContextLines > 0) && (
                  <Stack spacing={0.25}>
                    {droppedSharedContextLines > 0 && (
                      <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
                        {t('settings.sharedContextClamped', { count: droppedSharedContextLines })}
                      </Typography>
                    )}
                    {truncatedSharedContextLines > 0 && (
                      <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
                        {t('settings.sharedContextTruncated', { count: truncatedSharedContextLines })}
                      </Typography>
                    )}
                    {droppedInstructionLines > 0 && (
                      <Typography sx={{ fontSize: 12, color: 'warning.main' }}>
                        {t('settings.instructionsClamped', { count: droppedInstructionLines })}
                      </Typography>
                    )}
                  </Stack>
                )}
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ xs: 'flex-start', sm: 'center' }}>
                  <Typography variant="caption" color="text.secondary">{t('settings.effectivePromptHint')}</Typography>
                  <Select
                    variant="standard"
                    value={effectivePromptTask}
                    onChange={(event) => setEffectivePromptTask(event.target.value as EffectivePromptTaskKey)}
                    sx={[drawerSelectSx, inlineControlSx, { minWidth: 150, width: 'auto', flexShrink: 0 }]}
                    MenuProps={compactSelectMenuProps}
                  >
                    {effectivePromptTasks.map((task) => (
                      <MenuItem key={task} value={task} sx={drawerMenuItemSx}>{t(`settings.effectivePromptTasks.${task}`)}</MenuItem>
                    ))}
                  </Select>
                </Stack>
                <Box
                  component="pre"
                  sx={(theme) => ({
                    m: 0,
                    maxHeight: 420,
                    overflow: 'auto',
                    border: `1px solid ${theme.palette.kanap.border.default}`,
                    borderRadius: 1,
                    bgcolor: theme.palette.kanap.bg.composer,
                    color: theme.palette.kanap.text.primary,
                    fontFamily: '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
                    fontSize: 12,
                    lineHeight: 1.55,
                    p: 1,
                    whiteSpace: 'pre-wrap',
                  })}
                >
                  {effectivePromptQuery.isLoading
                    ? t('settings.effectivePromptLoading')
                    : effectivePromptText || t('settings.effectivePromptEmpty')}
                </Box>
              </Stack>
            </Collapse>
          </Box>
        </Stack>
      </Section>

      <Section title={t('settings.knowledgeSources')} actions={<SaveIndicator status={knowledgeAutosave.status} />}>
        <Stack spacing={1.5} sx={{ p: 1.5 }}>
          <FormControlLabel
            sx={featureSwitchRowSx}
            control={<Switch size="small" checked={knowledgeForm.enabled} onChange={(event) => updateKnowledge({ enabled: event.target.checked })} />}
            label={t('settings.knowledgeEnabled')}
          />
          <Typography variant="caption" color="text.secondary">{t('settings.knowledgeHint')}</Typography>
          {knowledgeForm.enabled && (
            <>
              <FormControlLabel
                sx={featureSwitchRowSx}
                control={<Switch size="small" checked={knowledgeForm.allLibraries} onChange={(event) => updateKnowledge({ allLibraries: event.target.checked })} />}
                label={t('settings.allLibraries')}
              />
              {!knowledgeForm.allLibraries && (
                <SettingsField label={t('settings.specificLibraries')} hint={t('settings.librariesHint')}>
                  <Select
                    multiple
                    variant="standard"
                    sx={pageSelectSx}
                    value={knowledgeForm.libraryIds}
                    displayEmpty
                    renderValue={(selected) => {
                      const ids = selected as string[];
                      if (ids.length === 0) {
                        return <Typography component="span" variant="body2" color="text.secondary">{t('settings.librariesPlaceholder')}</Typography>;
                      }
                      return ids
                        .map((id) => (librariesQuery.data ?? []).find((lib) => lib.id === id)?.name ?? id)
                        .join(', ');
                    }}
                    onChange={(event) => {
                      const value = event.target.value;
                      updateKnowledge({ libraryIds: typeof value === 'string' ? value.split(',') : (value as unknown as string[]) });
                    }}
                    MenuProps={compactSelectMenuProps}
                  >
                    {(librariesQuery.data ?? []).map((lib) => <MenuItem key={lib.id} value={lib.id} sx={drawerMenuItemSx}>{lib.name}</MenuItem>)}
                  </Select>
                </SettingsField>
              )}
            </>
          )}
          <FormControlLabel
            sx={featureSwitchRowSx}
            control={(
              <Switch
                size="small"
                checked={knowledgeForm.webEnabled && webSearchAvailable}
                disabled={!webSearchAvailable}
                onChange={(event) => updateKnowledge({ webEnabled: event.target.checked })}
              />
            )}
            label={t('settings.webEnabled')}
          />
          <Typography variant="caption" color="text.secondary">
            {webSearchAvailable ? t('settings.webHint') : t('settings.webUnavailableHint')}
          </Typography>
          {isSre && (
            <>
              <FormControlLabel
                sx={featureSwitchRowSx}
                control={<Switch size="small" checked={kanapDataView.enabled} onChange={(event) => updateKanapData({ enabled: event.target.checked })} />}
                label={t('settings.kanapDataEnabled')}
              />
              <Typography variant="caption" color="text.secondary">{t('settings.kanapDataHint')}</Typography>
              {kanapDataView.enabled && (
                <Box sx={{ display: 'flex', flexWrap: 'wrap', columnGap: 2, rowGap: 0.25, pl: 1.5 }}>
                  {KANAP_DATA_DOMAINS.map((domain) => (
                    <FormControlLabel
                      key={domain}
                      sx={featureSwitchRowSx}
                      control={(
                        <Checkbox
                          size="small"
                          checked={kanapDataView.domains[domain]}
                          onChange={(event) => updateKanapDataDomain(domain, event.target.checked)}
                          sx={{ p: 0.5, '& .MuiSvgIcon-root': { fontSize: 17 } }}
                        />
                      )}
                      label={t(`settings.kanapDataDomains.${domain}`)}
                    />
                  ))}
                </Box>
              )}
            </>
          )}
        </Stack>
      </Section>

      {isHelpdesk && <Section title={t('settings.operatingSettings')} actions={<SaveIndicator status={settingsAutosave.status} />}>
        <Stack spacing={1.5} sx={{ p: 1.5 }}>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))', md: 'repeat(4, minmax(0, 1fr))' }, gap: 1.5 }}>
            <SettingsField label={t('settings.checkInterval')} info={t('settings.checkIntervalInfo')}>
              <TextField size="small" value={form.checkIntervalMinutes} onChange={(event) => update('checkIntervalMinutes', event.target.value)} />
            </SettingsField>
            <SettingsField label={t('settings.maxTickets')} info={t('settings.maxTicketsInfo')}>
              <TextField size="small" value={form.maxTickets} onChange={(event) => update('maxTickets', event.target.value)} />
            </SettingsField>
            <SettingsField
              label={t('settings.dailyRuns')}
              info={t('settings.dailyRunsInfo')}
              hint={dailyUsage ? <CapUsage>{t('settings.usageToday', { value: formatNumber(dailyUsage.runs ?? 0) })}</CapUsage> : undefined}
            >
              <TextField size="small" value={form.dailyRuns} onChange={(event) => update('dailyRuns', event.target.value)} />
            </SettingsField>
            <SettingsField
              label={t('settings.dailyCost')}
              info={t('settings.dailyCostInfo')}
              hint={dailyUsage ? <CapUsage>{t('settings.usageToday', { value: `${(dailyUsage.estimatedCostEur ?? 0).toFixed(4)} EUR` })}</CapUsage> : undefined}
            >
              <TextField size="small" value={form.dailyCost} onChange={(event) => update('dailyCost', event.target.value)} />
            </SettingsField>
          </Box>
          <Box>
            <Button
              size="small"
              variant="text"
              sx={actionLinkButtonSx}
              aria-label={operatingMoreOpen ? t('settings.hideMoreOptions') : t('settings.moreOptions')}
              endIcon={operatingMoreOpen ? <ExpandLessIcon /> : <ExpandMoreIcon />}
              onClick={() => setOperatingMoreOpen((open) => !open)}
            >
              {operatingMoreOpen ? t('settings.hideMoreOptions') : t('settings.moreOptions')}
            </Button>
            <Collapse in={operatingMoreOpen} unmountOnExit>
              <Stack spacing={1.5} sx={{ pt: 1.5 }}>
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                  <SettingsField label={t('settings.model')} info={t('settings.modelInfo')}>
                    <Select
                      variant="standard"
                      value={definition.llm_model_config_id ?? ''}
                      displayEmpty
                      disabled={setModelMutation.isPending}
                      onChange={(event) => setModelMutation.mutate(event.target.value ? String(event.target.value) : null)}
                      sx={pageSelectSx}
                      MenuProps={compactSelectMenuProps}
                    >
                      <MenuItem value="" sx={drawerMenuItemSx}>{t('settings.modelTenantDefault')}</MenuItem>
                      {activeModelConfigs.map((modelConfig) => (
                        <MenuItem key={modelConfig.id} value={modelConfig.id} sx={drawerMenuItemSx}>{modelConfig.name}</MenuItem>
                      ))}
                    </Select>
                    {modelConfigsQuery.isError && (
                      <Typography variant="caption" color="error.main">{t('settings.modelListError')}</Typography>
                    )}
                  </SettingsField>
                  <SettingsField label={t('settings.maxRequests')} info={t('settings.maxRequestsInfo')}>
                    <TextField size="small" value={form.maxRequests} onChange={(event) => update('maxRequests', event.target.value)} />
                  </SettingsField>
                  <SettingsField label={t('settings.reviewCooldown')} info={t('settings.reviewCooldownInfo')}>
                    <TextField size="small" value={form.reviewCooldownHours} onChange={(event) => update('reviewCooldownHours', event.target.value)} />
                  </SettingsField>
                  <SettingsField label={t('settings.agentPriority')} info={t('settings.agentPriorityInfo')}>
                    <TextField size="small" value={form.agentPriority} onChange={(event) => update('agentPriority', event.target.value)} />
                  </SettingsField>
                  <SettingsField label={t('settings.onConflict')} info={t('settings.onConflictInfo')}>
                    <Select variant="standard" value={form.onConflict} onChange={(event) => update('onConflict', event.target.value)} sx={pageSelectSx}
                      MenuProps={compactSelectMenuProps}
                    >
                      <MenuItem value="defer" sx={drawerMenuItemSx}>{t('settings.conflictPolicies.defer')}</MenuItem>
                      <MenuItem value="supersede" sx={drawerMenuItemSx}>{t('settings.conflictPolicies.supersede')}</MenuItem>
                    </Select>
                  </SettingsField>
                  <SettingsField label={t('settings.approvalTtl')} info={t('settings.approvalTtlHint')}>
                    <TextField size="small" value={form.approvalTtlHours} onChange={(event) => update('approvalTtlHours', event.target.value)} />
                  </SettingsField>
                  <SettingsField label={t('settings.onStale')} info={t('settings.onStaleInfo')}>
                    <Select variant="standard" value={form.onStale} onChange={(event) => update('onStale', event.target.value)} sx={pageSelectSx}
                      MenuProps={compactSelectMenuProps}
                    >
                      <MenuItem value="re_review" sx={drawerMenuItemSx}>{t('settings.stalePolicies.re_review')}</MenuItem>
                      <MenuItem value="cancel" sx={drawerMenuItemSx}>{t('settings.stalePolicies.cancel')}</MenuItem>
                      <MenuItem value="apply_anyway" sx={drawerMenuItemSx}>{t('settings.stalePolicies.apply_anyway')}</MenuItem>
                    </Select>
                  </SettingsField>
                  <SettingsField label={t('settings.ticketActorRole')} info={t('settings.ticketActorRoleInfo')}>
                    <Select variant="standard" value={form.ticketActorRole} onChange={(event) => update('ticketActorRole', event.target.value)} sx={pageSelectSx}
                      MenuProps={compactSelectMenuProps}
                    >
                      {TICKET_ACTOR_ROLES.map((role) => (
                        <MenuItem key={role} value={role} sx={drawerMenuItemSx}>{t(`settings.ticketActorRoles.${role}`)}</MenuItem>
                      ))}
                    </Select>
                  </SettingsField>
                  <SettingsField label={t('settings.activityRetention')} info={t('settings.activityRetentionHint')}>
                    <TextField size="small" value={form.activityRetentionDays} onChange={(event) => update('activityRetentionDays', event.target.value)} />
                  </SettingsField>
                </Box>
                <Box>
                  <Stack direction="row" spacing={0.5} alignItems="center" sx={{ mb: 0.5 }}>
                    <Typography variant="body2" fontWeight={500}>{t('settings.safetyLimits')}</Typography>
                    <Tooltip title={t('settings.safetyLimitsInfo')} placement="top">
                      <InfoOutlinedIcon sx={{ fontSize: 13, color: 'kanap.text.tertiary' }} />
                    </Tooltip>
                  </Stack>
                  <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(3, minmax(0, 1fr))' }, gap: 1.5 }}>
                    <SettingsField label={t('settings.perRunTokens')} info={t('settings.perRunTokensInfo')}>
                      <TextField size="small" value={form.perRunTokens} onChange={(event) => update('perRunTokens', event.target.value)} />
                    </SettingsField>
                    <SettingsField label={t('settings.perRunCost')} info={t('settings.perRunCostInfo')}>
                      <TextField size="small" value={form.perRunCost} onChange={(event) => update('perRunCost', event.target.value)} />
                    </SettingsField>
                    <SettingsField
                      label={t('settings.dailyTokens')}
                      info={t('settings.dailyTokensInfo')}
                      hint={dailyUsage ? <CapUsage>{t('settings.usageToday', { value: formatNumber(dailyUsage.estimatedTokens ?? 0) })}</CapUsage> : undefined}
                    >
                      <TextField size="small" value={form.dailyTokens} onChange={(event) => update('dailyTokens', event.target.value)} />
                    </SettingsField>
                  </Box>
                </Box>
              </Stack>
            </Collapse>
          </Box>
        </Stack>
      </Section>}
      {isSre && (
        <Section title={t('settings.operatingSettings')} actions={<SaveIndicator status={sreAutosave.status} />}>
          <Box sx={{ p: 1.5, display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' }, gap: 1.5 }}>
            <SettingsField label={t('settings.model')} info={t('settings.modelInfo')}>
              <Select
                variant="standard"
                value={definition.llm_model_config_id ?? ''}
                displayEmpty
                disabled={setModelMutation.isPending}
                onChange={(event) => setModelMutation.mutate(event.target.value ? String(event.target.value) : null)}
                sx={pageSelectSx}
                MenuProps={compactSelectMenuProps}
              >
                <MenuItem value="" sx={drawerMenuItemSx}>{t('settings.modelTenantDefault')}</MenuItem>
                {activeModelConfigs.map((modelConfig) => (
                  <MenuItem key={modelConfig.id} value={modelConfig.id} sx={drawerMenuItemSx}>{modelConfig.name}</MenuItem>
                ))}
              </Select>
              {modelConfigsQuery.isError && (
                <Typography variant="caption" color="error.main">{t('settings.modelListError')}</Typography>
              )}
            </SettingsField>
            <SettingsField label={t('settings.checkInterval')} info={t('settings.checkIntervalAlertsInfo')}>
              <TextField size="small" value={sreForm.checkIntervalMinutes} onChange={(event) => updateSre({ checkIntervalMinutes: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.maxAlerts')} info={t('settings.maxAlertsInfo')}>
              <TextField size="small" value={sreForm.maxAlerts} onChange={(event) => updateSre({ maxAlerts: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.maxMonitoringRequests')} info={t('settings.maxMonitoringRequestsInfo')}>
              <TextField size="small" value={sreForm.maxRequests} onChange={(event) => updateSre({ maxRequests: event.target.value })} />
            </SettingsField>
            <SettingsField label={t('settings.activityRetention')} info={t('settings.activityRetentionHint')}>
              <TextField size="small" value={sreForm.activityRetentionDays} onChange={(event) => updateSre({ activityRetentionDays: event.target.value })} />
            </SettingsField>
          </Box>
        </Section>
      )}

      {pendingPreset && (
        <KanapDialog
          open={!!pendingPreset}
          title={t('settings.targetingBuilder.replaceTitle')}
          onClose={() => setPendingPreset(null)}
          onSave={() => {
            applyTargetingPreset(pendingPreset);
            setPendingPreset(null);
          }}
          saveLabel={t('settings.targetingBuilder.replace')}
        >
          <Typography variant="body2" color="text.secondary">
            {t('settings.targetingBuilder.replaceDescription', {
              preset: t(`settings.targetingPresets.${pendingPreset}`),
            })}
          </Typography>
        </KanapDialog>
      )}

      {pendingMonitoringPreset && (
        <KanapDialog
          open={!!pendingMonitoringPreset}
          title={t('settings.targetingBuilder.replaceTitle')}
          onClose={() => setPendingMonitoringPreset(null)}
          onSave={() => {
            updateSre({ filters: pendingMonitoringPreset.filters });
            setPendingMonitoringPreset(null);
          }}
          saveLabel={t('settings.targetingBuilder.replace')}
        >
          <Typography variant="body2" color="text.secondary">
            {t('settings.targetingBuilder.replaceDescription', {
              preset: t(`settings.monitoringPresets.${pendingMonitoringPreset.preset}`),
            })}
          </Typography>
        </KanapDialog>
      )}

      {sharedContextDialogOpen && (
        <KanapDialog
          open={sharedContextDialogOpen}
          title={t('settings.sharedContextDialog.title')}
          onClose={() => setSharedContextDialogOpen(false)}
          onSave={handleCreateSharedContextProfile}
          saveLabel={t('settings.sharedContextDialog.create')}
          saveDisabled={sharedContextDraftName.trim().length === 0 || sharedContextDraftLines.split('\n').map((line) => line.trim()).filter(Boolean).length === 0}
          saveLoading={createSharedContextProfileMutation.isPending}
        >
          <Stack spacing={1.5}>
            <SettingsField label={t('settings.sharedContextDialog.name')}>
              <TextField
                size="small"
                variant="standard"
                value={sharedContextDraftName}
                placeholder={t('settings.sharedContextDialog.namePlaceholder')}
                sx={drawerFieldValueSx}
                onChange={(event) => setSharedContextDraftName(event.target.value)}
              />
            </SettingsField>
            <SettingsField label={t('settings.sharedContextDialog.lines')} hint={t('settings.sharedContextDialog.linesHint')}>
              <TextField
                size="small"
                variant="standard"
                multiline
                minRows={6}
                value={sharedContextDraftLines}
                placeholder={t('settings.sharedContextDialog.linesPlaceholder')}
                sx={agentPersonaFieldSx}
                onChange={(event) => setSharedContextDraftLines(event.target.value)}
              />
            </SettingsField>
          </Stack>
        </KanapDialog>
      )}

    </Stack>
  );
}

export default function AgentWorkspacePage() {
  const { t } = useTranslation(['agents']);
  const { agentKey } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { hasLevel } = useAuth();
  const queryClient = useQueryClient();
  const data = useAgentControlData();
  const activeTab = (searchParams.get('tab') as WorkspaceTab | null) && TABS.includes(searchParams.get('tab') as WorkspaceTab)
    ? searchParams.get('tab') as WorkspaceTab
    : 'monitor';
  const definition = data.queueQuery.data?.definitions.find((item) => item.agent_key === agentKey) ?? null;
  const canAdmin = hasLevel('ai_agents', 'admin') || hasLevel('ai_settings', 'admin');
  const tabs = TABS.filter((tab) => tab !== 'settings' || canAdmin);
  // Switching tab unmounts the Settings form. Its autosave controllers register
  // here so a debounced or in-flight save is drained BEFORE the switch — and if
  // it fails, the switch is aborted so the error alert (and the edit) stay on
  // screen instead of vanishing with the tab.
  const autosaveRegistry = useAutosaveRegistry();
  // One queue per agent for EVERY definition PATCH — header inline edits here,
  // Settings-tab autosaves below — because the backend replaces the row
  // wholesale on each update.
  const agentSaveQueue = useAutosaveQueue();
  const [headerError, setHeaderError] = React.useState<string | null>(null);
  const [flushingTab, setFlushingTab] = React.useState(false);
  const [pendingAnchor, setPendingAnchor] = React.useState<string | null>(null);

  const goToTab = React.useCallback((next: string, anchor?: string) => {
    const params = new URLSearchParams(searchParams);
    params.set('tab', next);
    const commit = () => {
      setSearchParams(params);
      if (anchor) setPendingAnchor(anchor);
    };
    if (!autosaveRegistry.isBusy()) {
      commit();
      return;
    }
    setFlushingTab(true);
    void autosaveRegistry.flushAll().then((saved) => {
      setFlushingTab(false);
      if (saved) commit();
    });
  }, [autosaveRegistry, searchParams, setSearchParams]);

  const setTab = (_: React.SyntheticEvent, next: string) => goToTab(next);
  // The control bar's "Test on a ticket/alert" is an entry point, not a second
  // implementation: it lands on the Monitor tab's test section.
  const openTestSection = React.useCallback(() => goToTab('monitor', AGENT_TEST_SECTION_ID), [goToTab]);

  React.useEffect(() => {
    if (!pendingAnchor) return;
    document.getElementById(pendingAnchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPendingAnchor(null);
  }, [pendingAnchor, activeTab]);

  const persistHeaderField = React.useCallback(async (payload: { name?: string; description?: string | null }) => {
    if (!definition) return;
    try {
      // Same queue as the Settings tab's autosaves: the backend update is a
      // whole-entity read-modify-write, so a header PATCH racing a persona
      // PATCH would clobber whichever landed first.
      await agentSaveQueue.run(async () => {
        const res = await aiAgentControlApi.updateAgent(definition.id, payload);
        let patched = false;
        queryClient.setQueryData<AiAgentControlQueueOverview>(['ai-agent-control-queue'], (old) => {
          if (!old?.definitions?.some((item) => item.id === res.agent_definition.id)) return old;
          patched = true;
          return {
            ...old,
            definitions: old.definitions.map((item) => (item.id === res.agent_definition.id ? res.agent_definition : item)),
          };
        });
        if (!patched) void queryClient.invalidateQueries({ queryKey: ['ai-agent-control-queue'] });
      });
      setHeaderError(null);
    } catch (err) {
      setHeaderError(getApiErrorMessage(err, t, t('messages.sectionSaveFailed', { section: t('workspace.tabs.settings') })));
    }
  }, [agentSaveQueue, definition, queryClient, t]);

  if (data.queueQuery.isLoading && !definition) {
    return <Box display="flex" justifyContent="center" py={5}><CircularProgress size={24} /></Box>;
  }

  if (!definition) {
    return (
      <Box sx={{ p: 2 }}>
        <PageHeader
          title={t('workspace.notFound')}
          actions={<Button variant="action" onClick={() => navigate('/agents')}>{t('workspace.back')}</Button>}
        />
        <Alert severity="warning">{t('workspace.notFoundBody')}</Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2 }}>
      <PageHeader
        title={definition.name}
        titleContent={(
          <AgentInlineTitle
            canEdit={canAdmin}
            value={definition.name}
            onSave={(name) => { void persistHeaderField({ name }); }}
          />
        )}
        breadcrumbTitle={definition.name}
        actions={<Button variant="action" onClick={() => navigate('/agents')}>{t('workspace.back')}</Button>}
      />
      <AgentInlineDescription
        canEdit={canAdmin}
        value={definition.description ?? ''}
        fallback={definition.agent_key}
        placeholder={t('workspace.descriptionPlaceholder')}
        onSave={(description) => { void persistHeaderField({ description: description || null }); }}
      />
      {headerError && (
        <Alert severity="error" onClose={() => setHeaderError(null)} sx={{ mb: 1 }}>{headerError}</Alert>
      )}
      {/* Transverse control bar: one place for the run mode, checks, tests and
          the emergency brake — visible on every tab. Actions only; the agent's
          read-only facts live in the Monitor tab's "Status" section. */}
      <AgentControlBar agentKey={definition.agent_key} onTest={openTestSection} />
      <Stack spacing={2}>
        <Tabs value={tabs.includes(activeTab) ? activeTab : 'monitor'} onChange={setTab} variant="scrollable" scrollButtons="auto">
          {tabs.map((tab) => <Tab key={tab} value={tab} label={t(`workspace.tabs.${tab}`)} disabled={flushingTab} />)}
        </Tabs>
        {activeTab === 'monitor' && <MonitorTab agentKey={definition.agent_key} />}
        {activeTab === 'approvals' && <AgentsApprovalsPage agentKey={definition.agent_key} />}
        {activeTab === 'performance' && <PerformanceTab agentKey={definition.agent_key} />}
        {activeTab === 'settings' && canAdmin && <SettingsTab definition={definition} autosaveRegistry={autosaveRegistry} saveQueue={agentSaveQueue} />}
      </Stack>
    </Box>
  );
}
