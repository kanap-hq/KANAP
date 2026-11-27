import React from 'react';
import {
  Autocomplete,
  Box,
  Button,
  Checkbox,
  IconButton,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import { useQuery } from '@tanstack/react-query';
import { useTheme } from '@mui/material/styles';
import { useTranslation } from 'react-i18next';
import { aiAgentControlApi, type AiAgentControlRefItem } from '../../ai/aiApi';
import { compactSelectMenuProps, drawerMenuItemSx, drawerSelectSx, drawerFieldValueSx, pageSelectSx } from '../../theme/formSx';
import { getDotColor } from '../../utils/statusColors';
import { StatusDot } from '../design';

export const DEFAULT_MAX_TICKETS = 5;
export const DEFAULT_MAX_REQUESTS = 10;
export const DEFAULT_HORIZON_HOURS = 24;
export const DEFAULT_PER_RUN_TOKENS = 40000;
export const DEFAULT_PER_RUN_COST = 1;
export const DEFAULT_DAILY_RUNS = 25;
export const DEFAULT_DAILY_TOKENS = 500000;
export const DEFAULT_DAILY_COST = 10;
export const DEFAULT_REVIEW_COOLDOWN_HOURS = 24;
export const DEFAULT_PUBLIC_REPLY_TTL_HOURS = 8;
export const DEFAULT_APPROVAL_TTL_HOURS = 24;
export const DEFAULT_STALE_CLOSURE_TTL_DAYS = 7;

const DEFAULT_STALE_HOURS = 72;
// Targeting options are provider reference catalogs (statuses, priorities, types,
// categories, entities) that change on the order of months, not minutes. A short
// window made every mount of a builder — and of the agents overview, which
// prefetches the open statuses — pay another provider round-trip.
export const TARGETING_OPTIONS_STALE_TIME_MS = 5 * 60_000;
export const TARGETING_LOOKUP_DEBOUNCE_MS = 300;
// Backend caps targeting-option pages at 50 (TARGETING_OPTIONS_MAX_LIMIT).
export const TARGETING_CATALOG_OPTIONS_LIMIT = 50;
const AVAILABLE_TARGETING_FIELDS: TargetingFilterField[] = [
  'status',
  'priority',
  'type',
  'category',
  'entity',
  'created_at',
  'inactivity_age',
];

export const actionLinkButtonSx = {
  minWidth: 0,
  px: 0,
  py: 0.25,
  color: 'kanap.teal',
  fontSize: 12,
  fontWeight: 400,
  textTransform: 'none',
  '&:hover': {
    backgroundColor: 'transparent',
    textDecoration: 'underline',
  },
} as const;

export type TargetingPresetKey = 'new_tickets' | 'all_open' | 'handled';
export type TargetingFilterField = 'status' | 'priority' | 'type' | 'category' | 'entity' | 'created_at' | 'updated_at' | 'inactivity_age' | 'touched_by';
export type TargetingFilterUnit = 'hours' | 'days';
export type TargetingPredicateOperator = 'eq' | 'in' | 'gte' | 'lte' | 'not';

export type TargetingPredicate = {
  field: string;
  operator: TargetingPredicateOperator;
  value: unknown;
};

export type TargetingFilter = {
  id: string;
  field: TargetingFilterField;
  value: string | string[];
  label?: string;
  amount: string;
  unit: TargetingFilterUnit;
};

function targetingFilterId(field: string): string {
  return `${field}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function buildFilter(
  field: TargetingFilterField,
  value: string | string[] = '',
  amount = '24',
  unit: TargetingFilterUnit = 'hours',
  label?: string,
): TargetingFilter {
  return { id: targetingFilterId(field), field, value, label, amount, unit };
}

export function relativeAmountFromHours(hours: number): { amount: string; unit: TargetingFilterUnit } {
  if (hours >= 24 && hours % 24 === 0) {
    return { amount: String(hours / 24), unit: 'days' };
  }
  return { amount: String(Math.max(1, Math.round(hours))), unit: 'hours' };
}

function numberField(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveNumber(value: string, fallback: number): number {
  return numberField(value) ?? fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function policyObject(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function secondsFromFilter(filter: TargetingFilter): number | null {
  const amount = numberField(filter.amount);
  if (!amount) return null;
  return Math.floor(amount * (filter.unit === 'days' ? 86400 : 3600));
}

function relativeHoursFromFilter(filter: TargetingFilter): number | null {
  const seconds = secondsFromFilter(filter);
  return seconds == null ? null : Math.max(1, Math.round(seconds / 3600));
}

export function statusFilterValues(value: unknown): string[] {
  const rawValues = Array.isArray(value) ? value : [value];
  return Array.from(new Set(rawValues.map((entry) => String(entry ?? '').trim()).filter(Boolean)));
}

export function targetingPresetFilters(
  preset: TargetingPresetKey,
  horizonHours = DEFAULT_HORIZON_HOURS,
  statusValues: string[] = [],
): TargetingFilter[] {
  const status = buildFilter('status', statusValues);
  if (preset === 'new_tickets') {
    const relative = relativeAmountFromHours(horizonHours);
    return [buildFilter('created_at', '', relative.amount, relative.unit), status];
  }
  if (preset === 'handled') {
    return [buildFilter('touched_by', 'self'), status];
  }
  return [status];
}

export function modeFromFilters(filters: TargetingFilter[]): string {
  if (filters.some((filter) => filter.field === 'touched_by')) {
    return 'agent_involved';
  }
  if (filters.some((filter) => filter.field === 'created_at')) {
    return 'new_tickets_only';
  }
  return 'all_open';
}

export function categoryFromFilters(filters: TargetingFilter[]): string {
  const filter = filters.find((candidate) => candidate.field === 'category');
  return typeof filter?.value === 'string' ? filter.value.trim() : '';
}

export function entityFromFilters(filters: TargetingFilter[]): string {
  const filter = filters.find((candidate) => candidate.field === 'entity');
  return typeof filter?.value === 'string' ? filter.value.trim() : '';
}

export function createdHorizonHoursFromFilters(filters: TargetingFilter[], fallback: string): number {
  const created = filters.find((filter) => filter.field === 'created_at');
  return created ? relativeHoursFromFilter(created) ?? positiveNumber(fallback, DEFAULT_HORIZON_HOURS) : positiveNumber(fallback, DEFAULT_HORIZON_HOURS);
}

export function targetingPredicatesFromFilters(filters: TargetingFilter[]): TargetingPredicate[] {
  const predicates: TargetingPredicate[] = [];
  for (const filter of filters) {
    if (filter.field === 'status') {
      const values = statusFilterValues(filter.value);
      if (values.length > 0) predicates.push({ field: 'status', operator: 'in', value: values });
      continue;
    }
    if (filter.field === 'priority') {
      const value = typeof filter.value === 'string' ? filter.value.trim() : '';
      if (value) predicates.push({ field: 'priority', operator: 'gte', value });
      continue;
    }
    if (filter.field === 'category') {
      const value = typeof filter.value === 'string' ? filter.value.trim() : '';
      if (value) predicates.push({ field: 'category', operator: 'eq', value });
      continue;
    }
    if (filter.field === 'entity') {
      const value = typeof filter.value === 'string' ? filter.value.trim() : '';
      if (value) predicates.push({ field: 'entity', operator: 'eq', value });
      continue;
    }
    if (filter.field === 'type') {
      const value = typeof filter.value === 'string' ? filter.value.trim() : '';
      if (value) predicates.push({ field: 'type', operator: 'eq', value });
      continue;
    }
    if (filter.field === 'created_at') {
      const relativeHours = relativeHoursFromFilter(filter);
      if (relativeHours != null) predicates.push({ field: 'created_at', operator: 'gte', value: { relative_hours: relativeHours } });
      continue;
    }
    if (filter.field === 'updated_at') {
      const relativeHours = relativeHoursFromFilter(filter);
      if (relativeHours != null) predicates.push({ field: 'updated_at', operator: 'lte', value: { relative_hours: relativeHours } });
      continue;
    }
    if (filter.field === 'inactivity_age') {
      const seconds = secondsFromFilter(filter);
      if (seconds != null) predicates.push({ field: 'inactivity_age', operator: 'gte', value: { seconds } });
      continue;
    }
    if (filter.field === 'touched_by') {
      predicates.push({ field: 'touched_by', operator: 'eq', value: 'self' });
    }
  }
  const seen = new Set<string>();
  return predicates.filter((predicate) => {
    const key = JSON.stringify(predicate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function filtersFromScope(scope: Record<string, unknown>, mode: string): {
  filters: TargetingFilter[];
  entityId: string;
  categoryId: string;
  horizonHours: string;
} {
  const filters: TargetingFilter[] = [];
  let entityId = '';
  let categoryId = '';
  let horizonHours = DEFAULT_HORIZON_HOURS;
  const targeting = policyObject(scope.targeting);
  const predicates = Array.isArray(targeting.predicates) ? targeting.predicates.filter(isRecord) : [];
  for (const predicate of predicates) {
    const field = typeof predicate.field === 'string' ? predicate.field : '';
    const operator = typeof predicate.operator === 'string' ? predicate.operator : '';
    if (field === 'status' && (operator === 'in' || operator === 'eq')) {
      const values = statusFilterValues(predicate.value);
      if (values.length > 0) filters.push(buildFilter('status', values));
      continue;
    }
    if (field === 'priority' && (operator === 'gte' || operator === 'eq')) {
      filters.push(buildFilter('priority', typeof predicate.value === 'string' ? predicate.value : 'high'));
      continue;
    }
    if (field === 'type' && operator === 'eq') {
      const type = typeof predicate.value === 'string' ? predicate.value : '';
      if (type) filters.push(buildFilter('type', type));
      continue;
    }
    if (field === 'category' && operator === 'eq') {
      categoryId = typeof predicate.value === 'string' ? predicate.value : '';
      if (categoryId) filters.push(buildFilter('category', categoryId));
      continue;
    }
    if (field === 'entity' && operator === 'eq') {
      entityId = typeof predicate.value === 'string' ? predicate.value : '';
      if (entityId) filters.push(buildFilter('entity', entityId));
      continue;
    }
    if (field === 'created_at' && operator === 'gte') {
      const value = policyObject(predicate.value);
      const hours = typeof value.relative_hours === 'number' ? value.relative_hours : DEFAULT_HORIZON_HOURS;
      const relative = relativeAmountFromHours(hours);
      horizonHours = hours;
      filters.push(buildFilter('created_at', '', relative.amount, relative.unit));
      continue;
    }
    if (field === 'updated_at' && operator === 'lte') {
      const value = policyObject(predicate.value);
      const hours = typeof value.relative_hours === 'number' ? value.relative_hours : 24;
      const relative = relativeAmountFromHours(hours);
      filters.push(buildFilter('updated_at', '', relative.amount, relative.unit));
      continue;
    }
    if (field === 'inactivity_age' && operator === 'gte') {
      const seconds = typeof policyObject(predicate.value).seconds === 'number'
        ? policyObject(predicate.value).seconds as number
        : typeof predicate.value === 'number' ? predicate.value : DEFAULT_STALE_HOURS * 3600;
      const relative = relativeAmountFromHours(Math.max(1, Math.round(seconds / 3600)));
      filters.push(buildFilter('inactivity_age', '', relative.amount, relative.unit));
      continue;
    }
    if (field === 'touched_by' && operator === 'eq' && predicate.value === 'self') {
      filters.push(buildFilter('touched_by', 'self'));
    }
  }
  if (filters.length === 0) {
    if (mode === 'all_open') {
      filters.push(...targetingPresetFilters('all_open'));
    } else if (mode === 'agent_involved') {
      filters.push(...targetingPresetFilters('handled'));
    } else {
      const ingestion = policyObject(scope.new_tickets_only);
      horizonHours = typeof ingestion.hard_backfill_horizon_hours === 'number'
        ? ingestion.hard_backfill_horizon_hours
        : DEFAULT_HORIZON_HOURS;
      filters.push(...targetingPresetFilters('new_tickets', horizonHours));
    }
  }
  return {
    filters,
    entityId,
    categoryId,
    horizonHours: String(horizonHours),
  };
}

export function optionMetadataString(option: AiAgentControlRefItem, key: string): string {
  const value = option.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

export function optionMetadataNumber(option: AiAgentControlRefItem, key: string): number | null {
  const value = option.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function optionLabel(options: AiAgentControlRefItem[], value: string): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

export function statusOptionSemanticColor(option: AiAgentControlRefItem): string {
  const key = optionMetadataString(option, 'key').toLowerCase();
  const code = optionMetadataNumber(option, 'code');
  if (key.includes('pending') || code === 4) return 'warning';
  if (key.includes('processing') || key.includes('assigned') || code === 2 || code === 3) return 'info';
  if (key.includes('solved') || key.includes('resolved') || code === 5) return 'success';
  return 'default';
}

function statusOptionIsOpen(option: AiAgentControlRefItem): boolean {
  const key = optionMetadataString(option, 'key').toLowerCase();
  const label = option.label.toLowerCase();
  const code = optionMetadataNumber(option, 'code') ?? Number(option.value);
  if (Number.isFinite(code) && code >= 5) return false;
  return !(key.includes('solved') || key.includes('closed') || key.includes('resolved') || label.includes('solved') || label.includes('closed') || label.includes('resolved'));
}

export function openStatusValues(options: AiAgentControlRefItem[]): string[] {
  return options.filter(statusOptionIsOpen).map((option) => option.value);
}

export function prioritySemanticColor(option: AiAgentControlRefItem): string {
  const level = optionMetadataNumber(option, 'level') ?? optionMetadataNumber(option, 'code');
  if (level != null && level >= 5) return 'error';
  if (level != null && level >= 4) return 'warning';
  return 'default';
}

function DotOptionLabel({ color, label }: { color: string; label: React.ReactNode }) {
  const theme = useTheme();
  const dotColor = getDotColor(color, theme.palette.mode);
  return (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <StatusDot size={7} color={dotColor} />
      <Typography variant="body2" sx={{ color: dotColor, minWidth: 0 }}>{label}</Typography>
    </Stack>
  );
}

function defaultFilterForField(
  field: TargetingFilterField,
  options: { statuses?: AiAgentControlRefItem[]; priorities?: AiAgentControlRefItem[]; types?: AiAgentControlRefItem[] } = {},
): TargetingFilter {
  if (field === 'status') return buildFilter('status', openStatusValues(options.statuses ?? []));
  if (field === 'priority') {
    const priority = options.priorities?.find((option) => (optionMetadataNumber(option, 'level') ?? 0) >= 4) ?? options.priorities?.[0];
    return buildFilter('priority', priority?.value ?? '');
  }
  if (field === 'type') return buildFilter('type', options.types?.[0]?.value ?? '');
  if (field === 'created_at') return buildFilter('created_at', '', '3', 'days');
  if (field === 'updated_at') return buildFilter('updated_at', '', '1', 'days');
  if (field === 'inactivity_age') return buildFilter('inactivity_age', '', '3', 'days');
  if (field === 'touched_by') return buildFilter('touched_by', 'self');
  return buildFilter(field, '');
}

export function useDebouncedValue<T>(value: T, delay = TARGETING_LOOKUP_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function ReferenceCatalogAutocomplete({
  agentId,
  field,
  value,
  label,
  catalogsEnabled = true,
  onChange,
}: {
  agentId: string;
  field: 'category' | 'entity';
  value: string;
  label?: string;
  catalogsEnabled?: boolean;
  onChange: (next: { value: string; label?: string }) => void;
}) {
  const { t } = useTranslation(['agents']);
  const [inputValue, setInputValue] = React.useState(label || value);
  React.useEffect(() => {
    setInputValue(label || value);
  }, [label, value]);
  // Debounced lookup: each keystroke previously fired its own provider round-trip
  // (a full GLPI session per request), which stacked slow catalog searches into
  // timeouts on large instances. Only settled text hits the backend.
  const debouncedInput = useDebouncedValue(inputValue);
  const lookupQuery = debouncedInput.trim() || value.trim();
  const optionsQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', agentId, field, lookupQuery],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(agentId, field, { query: lookupQuery || undefined, limit: TARGETING_CATALOG_OPTIONS_LIMIT }),
    enabled: !!agentId && catalogsEnabled !== false,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const options = optionsQuery.data?.options ?? [];
  const selected = value
    ? options.find((option) => option.value === value) ?? { value, label: label || value }
    : null;
  return (
    <Box sx={{ minWidth: 0 }}>
      <Autocomplete<AiAgentControlRefItem, false, false, false>
        size="small"
        options={options}
        value={selected}
        inputValue={inputValue}
        loading={optionsQuery.isFetching}
        filterOptions={(items) => items}
        getOptionLabel={(option) => option.label}
        isOptionEqualToValue={(option, candidate) => option.value === candidate.value}
        noOptionsText={t('settings.targetingBuilder.noOptions')}
        onInputChange={(_event, next) => setInputValue(next)}
        onChange={(_event, option) => {
          onChange(option ? { value: option.value, label: option.label } : { value: '', label: '' });
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            variant="standard"
            placeholder={t(`settings.targetingFields.${field}`)}
            sx={drawerFieldValueSx}
          />
        )}
      />
      {value ? (
        <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', lineHeight: 1.3 }}>
          {field === 'category'
            ? t('settings.targetingBuilder.includesSubcategories')
            : t('settings.targetingBuilder.includesSubentities')}
        </Typography>
      ) : null}
    </Box>
  );
}

export function HelpdeskTargetingFilterBuilder({
  agentId,
  filters,
  onChange,
  catalogsEnabled = true,
}: {
  agentId: string | null | undefined;
  filters: TargetingFilter[];
  onChange: (filters: TargetingFilter[]) => void;
  /** False when the space has no ticket connection: the lists stay empty and nothing is requested. */
  catalogsEnabled?: boolean;
}) {
  const { t } = useTranslation(['agents']);
  const queryEnabled = !!agentId && catalogsEnabled;
  const statusOptionsQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', agentId, 'status', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(agentId || '', 'status', { limit: 50 }),
    enabled: queryEnabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const priorityOptionsQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', agentId, 'priority', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(agentId || '', 'priority', { limit: 50 }),
    enabled: queryEnabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const typeOptionsQuery = useQuery({
    queryKey: ['ai-agent-targeting-options', agentId, 'type', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(agentId || '', 'type', { limit: 50 }),
    enabled: queryEnabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  // Warm the category/entity browse lists as soon as the builder mounts: on large
  // GLPI instances the first fetch can take several seconds, so paying it here
  // makes the dropdown feel instant by the time the user opens it. Keys match the
  // ReferenceCatalogAutocomplete empty-query keys so the cache is shared.
  useQuery({
    queryKey: ['ai-agent-targeting-options', agentId, 'category', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(agentId || '', 'category', { limit: TARGETING_CATALOG_OPTIONS_LIMIT }),
    enabled: queryEnabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  useQuery({
    queryKey: ['ai-agent-targeting-options', agentId, 'entity', ''],
    queryFn: () => aiAgentControlApi.getAgentTargetingOptions(agentId || '', 'entity', { limit: TARGETING_CATALOG_OPTIONS_LIMIT }),
    enabled: queryEnabled,
    staleTime: TARGETING_OPTIONS_STALE_TIME_MS,
  });
  const statusOptions = statusOptionsQuery.data?.options ?? [];
  const priorityOptions = priorityOptionsQuery.data?.options ?? [];
  const typeOptions = typeOptionsQuery.data?.options ?? [];
  const optionSets = React.useMemo(() => ({
    statuses: statusOptions,
    priorities: priorityOptions,
    types: typeOptions,
  }), [priorityOptions, statusOptions, typeOptions]);
  const updateFilter = (id: string, patch: Partial<TargetingFilter>) => {
    onChange(filters.map((filter) => (filter.id === id ? { ...filter, ...patch } : filter)));
  };
  const replaceField = (id: string, field: TargetingFilterField) => {
    onChange(filters.map((filter) => (filter.id === id ? defaultFilterForField(field, optionSets) : filter)));
  };
  const removeFilter = (id: string) => onChange(filters.filter((filter) => filter.id !== id));
  const addFilter = () => onChange([...filters, defaultFilterForField('status', optionSets)]);

  return (
    <Stack spacing={1}>
      {filters.map((filter) => (
        <Box
          key={filter.id}
          sx={(theme) => ({
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', sm: '220px minmax(0, 1fr) auto' },
            gap: 1,
            alignItems: 'center',
            borderBottom: `1px solid ${theme.palette.kanap.border.soft}`,
            pb: 1,
          })}
        >
          <Select
            variant="standard"
            value={filter.field}
            onChange={(event) => replaceField(filter.id, event.target.value as TargetingFilterField)}
            sx={pageSelectSx}
            MenuProps={compactSelectMenuProps}
          >
            {AVAILABLE_TARGETING_FIELDS.map((field) => (
              <MenuItem key={field} value={field} sx={drawerMenuItemSx}>
                {t(`settings.targetingFields.${field}`)}
              </MenuItem>
            ))}
            {(filter.field === 'updated_at' || filter.field === 'touched_by') && (
              <MenuItem value={filter.field} sx={drawerMenuItemSx}>
                {t(`settings.targetingFields.${filter.field}`)}
              </MenuItem>
            )}
          </Select>

          {filter.field === 'status' && (
            <Select
              multiple
              variant="standard"
              value={Array.isArray(filter.value) ? filter.value : []}
              renderValue={(selected) => (selected as string[]).map((value) => optionLabel(statusOptions, value)).join(', ')}
              onChange={(event) => {
                const value = event.target.value;
                updateFilter(filter.id, { value: typeof value === 'string' ? value.split(',') : value as string[] });
              }}
              sx={pageSelectSx}
              MenuProps={compactSelectMenuProps}
            >
              {statusOptions.map((status) => (
                <MenuItem key={status.value} value={status.value} sx={drawerMenuItemSx}>
                  <Checkbox size="small" checked={Array.isArray(filter.value) && filter.value.includes(status.value)} />
                  <ListItemText primary={<DotOptionLabel color={statusOptionSemanticColor(status)} label={status.label} />} />
                </MenuItem>
              ))}
            </Select>
          )}

          {filter.field === 'priority' && (
            <Select
              variant="standard"
              value={typeof filter.value === 'string' ? filter.value : ''}
              onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
              sx={pageSelectSx}
              MenuProps={compactSelectMenuProps}
            >
              {priorityOptions.map((priority) => (
                <MenuItem key={priority.value} value={priority.value} sx={drawerMenuItemSx}>
                  <DotOptionLabel color={prioritySemanticColor(priority)} label={priority.label} />
                </MenuItem>
              ))}
            </Select>
          )}

          {filter.field === 'type' && (
            <Select
              variant="standard"
              value={typeof filter.value === 'string' ? filter.value : ''}
              onChange={(event) => updateFilter(filter.id, { value: event.target.value })}
              sx={pageSelectSx}
              MenuProps={compactSelectMenuProps}
            >
              {typeOptions.map((type) => (
                <MenuItem key={type.value} value={type.value} sx={drawerMenuItemSx}>
                  {type.label}
                </MenuItem>
              ))}
            </Select>
          )}

          {filter.field === 'category' && agentId && (
            <ReferenceCatalogAutocomplete
              agentId={agentId}
              field="category"
              value={typeof filter.value === 'string' ? filter.value : ''}
              label={filter.label}
              catalogsEnabled={catalogsEnabled}
              onChange={(next) => updateFilter(filter.id, next)}
            />
          )}

          {filter.field === 'category' && !agentId && (
            <Typography variant="body2" color="text.secondary">{t('settings.targetingBuilder.noOptions')}</Typography>
          )}

          {filter.field === 'entity' && agentId && (
            <Stack spacing={0.25}>
              <ReferenceCatalogAutocomplete
                agentId={agentId}
                field="entity"
                value={typeof filter.value === 'string' ? filter.value : ''}
                label={filter.label}
                catalogsEnabled={catalogsEnabled}
                onChange={(next) => updateFilter(filter.id, next)}
              />
              <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary })}>
                {t('settings.targetingBuilder.entityHint')}
              </Typography>
            </Stack>
          )}

          {filter.field === 'entity' && !agentId && (
            <Typography variant="body2" color="text.secondary">{t('settings.targetingBuilder.noOptions')}</Typography>
          )}

          {(filter.field === 'created_at' || filter.field === 'updated_at' || filter.field === 'inactivity_age') && (
            <Stack spacing={0.25}>
              <Stack direction="row" spacing={1} alignItems="center">
                <TextField
                  size="small"
                  variant="standard"
                  type="number"
                  value={filter.amount}
                  InputProps={{ inputProps: { min: 1 } }}
                  sx={[drawerFieldValueSx, { maxWidth: 92 }]}
                  onChange={(event) => updateFilter(filter.id, { amount: event.target.value })}
                />
                <Select
                  variant="standard"
                  value={filter.unit}
                  onChange={(event) => updateFilter(filter.id, { unit: event.target.value as TargetingFilterUnit })}
                  sx={[drawerSelectSx, { maxWidth: 120 }]}
                  MenuProps={compactSelectMenuProps}
                >
                  <MenuItem value="hours" sx={drawerMenuItemSx}>{t('settings.targetingBuilder.hours')}</MenuItem>
                  <MenuItem value="days" sx={drawerMenuItemSx}>{t('settings.targetingBuilder.days')}</MenuItem>
                </Select>
              </Stack>
              {filter.field === 'inactivity_age' && (
                <Typography sx={(theme) => ({ fontSize: 12, color: theme.palette.kanap.text.tertiary })}>
                  {t('settings.targetingBuilder.inactivityCloses')}
                </Typography>
              )}
            </Stack>
          )}

          {filter.field === 'touched_by' && (
            <Typography variant="body2" color="text.secondary">{t('settings.targetingBuilder.thisAgent')}</Typography>
          )}

          <Tooltip title={t('settings.targetingBuilder.remove')}>
            <IconButton size="small" onClick={() => removeFilter(filter.id)} aria-label={t('settings.targetingBuilder.remove')}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      ))}
      <Button size="small" variant="text" startIcon={<AddIcon />} onClick={addFilter} sx={[actionLinkButtonSx, { alignSelf: 'flex-start' }]}>
        {t('settings.targetingBuilder.add')}
      </Button>
    </Stack>
  );
}
