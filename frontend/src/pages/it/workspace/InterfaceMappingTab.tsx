import React, { forwardRef, useImperativeHandle } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  FormControlLabel,
  IconButton,
  InputAdornment,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  MenuItem,
  Paper,
  Popover,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { AgGridReact } from 'ag-grid-react';
import type { ColDef, ICellRendererParams, RowClickedEvent } from 'ag-grid-community';
import AccountTreeOutlinedIcon from '@mui/icons-material/AccountTreeOutlined';
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import SearchIcon from '@mui/icons-material/Search';
import ViewColumnIcon from '@mui/icons-material/ViewColumn';
import { useTranslation } from 'react-i18next';
import AgGridBox from '../../../components/AgGridBox';
import { KanapDialog, PropertyGroup, PropertyRow, StatusDot } from '../../../components/design';
import {
  interfacesApi,
  type CreateInterfaceMappingGroupInput,
  type CreateInterfaceMappingRuleInput,
  type InterfaceBinding,
  type InterfaceMappingGroup,
  type InterfaceMappingRule,
  type InterfaceMappingSet,
} from '../../../api/endpoints/interfaces';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import type { InterfaceDetail, InterfaceLeg } from '../components/interface-workspace/types';
import { getDotColor, LIFECYCLE_COLORS } from '../../../utils/statusColors';
import { drawerAutocompleteListboxSx, drawerFieldValueSx, drawerMenuItemSx, drawerSelectSx, longFormSurfaceFieldSx } from '../../../theme/formSx';

export type InterfaceMappingTabHandle = {
  save: () => Promise<boolean>;
  reset: () => Promise<void>;
  isDirty: () => boolean;
};

type Props = {
  canManage: boolean;
  interfaceId: string;
  data: InterfaceDetail | null;
  onDirtyChange?: (dirty: boolean) => void;
};

type GroupFilterKey = typeof ALL_GROUPS_KEY | typeof UNGROUPED_GROUP_KEY | string;

type GroupFormState = {
  id: string;
  title: string;
  description: string;
  order_index: string;
};

type BindingFormState = {
  id: string;
  path: string;
  data_type: string;
  extras: Record<string, unknown>;
};

type BindingCollectionKey = 'source_bindings' | 'target_bindings';

type RuleFormState = {
  id: string;
  title: string;
  rule_key: string;
  group_id: string;
  order_index: string;
  applies_to_leg_id: string;
  operation_kind_choice: string;
  operation_kind_other: string;
  lifecycle: string;
  environment_scope: string[];
  source_bindings: BindingFormState[];
  target_bindings: BindingFormState[];
  condition_text: string;
  business_rule_text: string;
  remarks: string;
};

type GroupEditorState = {
  open: boolean;
  mode: 'create' | 'edit';
  baseline: GroupFormState;
  form: GroupFormState;
  error: string | null;
};

type RuleEditorState = {
  open: boolean;
  mode: 'create' | 'edit';
  baseline: RuleFormState;
  form: RuleFormState;
  error: string | null;
};

type MappingRuleGridRow = {
  id: string;
  rule: InterfaceMappingRule;
  title: string;
  mapping_text: string;
  source_text: string;
  target_text: string;
  condition_text: string | null;
  lifecycle: string;
  lifecycle_label: string;
  environment_scope_label: string;
  operation_label: string;
  group_label: string;
  leg_label: string;
};

type MappingRuleColumnKey =
  | 'group_label'
  | 'mapping'
  | 'lifecycle_label'
  | 'environment_scope_label'
  | 'operation_label'
  | 'leg_label'
  | 'actions';

const ALL_GROUPS_KEY = '__all__';
const UNGROUPED_GROUP_KEY = '__ungrouped__';
const OTHER_OPERATION_KIND = '__other__';
const BINDING_KEYS = ['path', 'field', 'name', 'key', 'label', 'source', 'target'];
const BINDING_TYPE_KEYS = ['type', 'data_type', 'datatype'];
const DEFAULT_ITEM_GROUP_TITLE = 'Item';
const RESERVED_GROUP_TITLE_KEYS = new Set(['head', 'item']);

const OPERATION_KIND_OPTIONS = [
  { value: 'direct', label: 'Direct copy' },
  { value: 'transform', label: 'Transform' },
  { value: 'lookup', label: 'Lookup' },
  { value: 'split', label: 'Split' },
  { value: 'merge', label: 'Merge' },
  { value: 'filter', label: 'Filter' },
  { value: 'default', label: 'Default value' },
];

const MAPPING_LIFECYCLE_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'deprecated', label: 'Deprecated' },
  { value: 'retired', label: 'Retired' },
];

type EnvironmentOption = { value: string; label: string };

const ENVIRONMENT_OPTIONS: EnvironmentOption[] = [
  { value: 'prod', label: 'Prod' },
  { value: 'pre_prod', label: 'Pre-prod' },
  { value: 'qa', label: 'QA' },
  { value: 'test', label: 'Test' },
  { value: 'dev', label: 'Dev' },
  { value: 'sandbox', label: 'Sandbox' },
];

const BINDING_TYPE_OPTIONS = [
  'string',
  'number',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'time',
  'object',
  'array',
  'identifier',
  'code',
  'amount',
];

const MAPPING_RULE_COLUMN_OPTIONS: Array<{
  id: MappingRuleColumnKey;
  label: string;
  required?: boolean;
  defaultHidden?: boolean;
}> = [
  { id: 'group_label', label: 'Group' },
  { id: 'mapping', label: 'Mapping', required: true },
  { id: 'lifecycle_label', label: 'Lifecycle' },
  { id: 'environment_scope_label', label: 'Environments' },
  { id: 'operation_label', label: 'Operation' },
  { id: 'leg_label', label: 'Leg scope', defaultHidden: true },
  { id: 'actions', label: 'Actions', required: true },
];
const MAPPING_RULE_COLUMNS_STORAGE_KEY = 'kanap.interfaces.mappingRuleColumns.hidden';

const DEFAULT_HIDDEN_RULE_COLUMNS = MAPPING_RULE_COLUMN_OPTIONS
  .filter((column) => column.defaultHidden)
  .map((column) => column.id);

function normalizeHiddenRuleColumns(value: unknown): MappingRuleColumnKey[] {
  if (!Array.isArray(value)) return DEFAULT_HIDDEN_RULE_COLUMNS;
  const optionalColumnIds = new Set(
    MAPPING_RULE_COLUMN_OPTIONS
      .filter((column) => !column.required)
      .map((column) => column.id),
  );
  return value
    .map((item) => String(item))
    .filter((item): item is MappingRuleColumnKey => optionalColumnIds.has(item as MappingRuleColumnKey));
}

function loadHiddenRuleColumns(): MappingRuleColumnKey[] {
  if (typeof window === 'undefined') return DEFAULT_HIDDEN_RULE_COLUMNS;
  try {
    const stored = window.localStorage.getItem(MAPPING_RULE_COLUMNS_STORAGE_KEY);
    return stored ? normalizeHiddenRuleColumns(JSON.parse(stored)) : DEFAULT_HIDDEN_RULE_COLUMNS;
  } catch {
    return DEFAULT_HIDDEN_RULE_COLUMNS;
  }
}

const ruleDrawerPaperSx = {
  top: 48,
  height: 'calc(100dvh - 48px)',
  width: { xs: '100vw', sm: 720 },
  maxWidth: '100vw',
  bgcolor: 'kanap.bg.drawer',
  borderLeft: '1px solid',
  borderColor: 'kanap.border.default',
  boxShadow: 'none',
} as const;

const ruleEditorShellSx = {
  height: '100%',
  display: 'flex',
  flexDirection: 'column',
  bgcolor: 'kanap.bg.drawer',
  color: 'kanap.text.primary',
} as const;

const ruleEditorHeaderSx = {
  px: 2,
  py: 1.25,
  borderBottom: '1px solid',
  borderColor: 'kanap.border.soft',
  flex: '0 0 auto',
} as const;

const ruleEditorBodySx = {
  flex: '1 1 auto',
  overflowY: 'auto',
  py: 0.75,
} as const;

const ruleEditorFooterSx = {
  px: 2,
  py: 1,
  borderTop: '1px solid',
  borderColor: 'kanap.border.default',
  bgcolor: 'kanap.bg.drawer',
  flex: '0 0 auto',
} as const;

const bindingSurfaceSx = {
  border: '1px solid',
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  bgcolor: 'kanap.bg.composer',
  p: 1,
} as const;

const bindingRowGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr auto', sm: 'minmax(0, 1fr) minmax(96px, 128px) auto' },
  gap: 1,
  alignItems: 'start',
} as const;

const mappingFieldsGridSx = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: 1.25,
} as const;

const ruleMetadataGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
  columnGap: 2,
  rowGap: 0.25,
} as const;

const compactIconButtonSx = {
  width: 28,
  height: 28,
  color: 'kanap.text.secondary',
} as const;

const mappingGridActionButtonSx = {
  width: 24,
  height: 24,
  p: 0.25,
  color: 'kanap.text.secondary',
  '& .MuiSvgIcon-root': {
    fontSize: 15,
  },
} as const;

const mappingComposerFieldSx = {
  maxWidth: 'none',
  '& .MuiInputBase-root': {
    minHeight: 76,
    px: '10px',
    py: '8px',
  },
  '& .MuiInputBase-input': {
    fontSize: '13px !important',
    lineHeight: '1.45 !important',
  },
} as const;

const mappingConditionFieldSx = {
  ...mappingComposerFieldSx,
  '& .MuiInputBase-root': {
    minHeight: 56,
    px: '10px',
    py: '8px',
  },
} as const;

const mappingRulesHeaderSx = {
  display: 'flex',
  flexDirection: { xs: 'column', md: 'row' },
  alignItems: { xs: 'stretch', md: 'center' },
  justifyContent: 'space-between',
  gap: 1.25,
} as const;

const mappingRulesControlsSx = {
  display: 'flex',
  flexDirection: { xs: 'column', md: 'row' },
  alignItems: { xs: 'stretch', md: 'center' },
  justifyContent: 'space-between',
  gap: 1,
} as const;

const mappingRulesFilterSx = {
  display: 'flex',
  flexDirection: { xs: 'column', sm: 'row' },
  alignItems: { xs: 'stretch', sm: 'center' },
  gap: 1,
  minWidth: 0,
} as const;

const mappingRulesSearchSx = {
  width: { xs: '100%', sm: 260 },
  '& .MuiInputBase-root': { fontSize: 13 },
} as const;

const mappingRulesSelectSx = {
  ...drawerSelectSx,
  width: 'auto',
  minWidth: { xs: '100%', sm: 250 },
  '& .MuiSelect-select': {
    ...drawerSelectSx['& .MuiSelect-select'],
    display: 'flex',
    alignItems: 'center',
  },
} as const;

const mappingRulesGridSx = {
  width: '100%',
  minWidth: 0,
  '& .ag-root-wrapper': {
    borderColor: 'kanap.border.default',
    borderRadius: '8px',
  },
  '& .ag-cell': {
    display: 'flex',
    alignItems: 'center',
  },
  '& .ag-cell.ag-cell-value': {
    minWidth: 0,
  },
} as const;

const mappingCellLineSx = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

class MappingValidationError extends Error {
  target: 'group' | 'rule';

  constructor(target: 'group' | 'rule', message: string) {
    super(message);
    this.target = target;
  }
}

function cloneValue<T>(value: T): T {
  if (value === undefined) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function normalizeGroupTitleKey(value: unknown) {
  return String(value ?? '').trim().toLowerCase();
}

function normalizeOptionalText(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function normalizeOptionalId(value: unknown): string | null {
  const text = String(value ?? '').trim();
  return text ? text : null;
}

function normalizeRuleLifecycle(value: unknown) {
  const normalized = String(value ?? '').trim().toLowerCase() || 'active';
  return MAPPING_LIFECYCLE_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : 'active';
}

function normalizeEnvironmentScope(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const allowed = new Set(ENVIRONMENT_OPTIONS.map((option) => option.value));
  const normalized: string[] = [];
  for (const item of value) {
    const next = String(item ?? '').trim().toLowerCase();
    if (!next || !allowed.has(next) || normalized.includes(next)) continue;
    normalized.push(next);
  }
  return normalized.length > 0 ? normalized : null;
}

function sortEnvironmentValues(values: string[]) {
  const order = new Map(ENVIRONMENT_OPTIONS.map((option, index) => [option.value, index]));
  return [...values].sort((a, b) => {
    const aOrder = order.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bOrder = order.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return a.localeCompare(b);
  });
}

function environmentOptionsFromBindings(bindings: InterfaceBinding[]): EnvironmentOption[] {
  const declared = new Set<string>();
  for (const binding of bindings) {
    const value = String(binding.environment || '').trim().toLowerCase();
    if (ENVIRONMENT_OPTIONS.some((option) => option.value === value)) {
      declared.add(value);
    }
  }
  return sortEnvironmentValues(Array.from(declared)).map((value) => (
    ENVIRONMENT_OPTIONS.find((option) => option.value === value) || { value, label: value }
  ));
}

function filterEnvironmentScope(value: unknown, options: EnvironmentOption[]) {
  const scope = normalizeEnvironmentScope(value);
  if (!scope) return [];
  const allowed = new Set(options.map((option) => option.value));
  return scope.filter((item) => allowed.has(item));
}

function formatLifecycle(value: string | null | undefined) {
  const normalized = normalizeRuleLifecycle(value);
  return MAPPING_LIFECYCLE_OPTIONS.find((option) => option.value === normalized)?.label || normalized;
}

function formatEnvironment(value: string | null | undefined) {
  return ENVIRONMENT_OPTIONS.find((option) => option.value === value)?.label || value || '';
}

function formatEnvironmentScope(value: string[] | null | undefined) {
  const scope = normalizeEnvironmentScope(value);
  if (!scope) return 'All environments';
  return scope.map((item) => formatEnvironment(item)).join(', ');
}

function formatRuleCount(count: number) {
  return `${count} ${count === 1 ? 'rule' : 'rules'}`;
}

function makeTempId(prefix: string) {
  return `tmp:${prefix}:${Math.random().toString(36).slice(2, 10)}`;
}

function isTempId(value: string | null | undefined) {
  return typeof value === 'string' && value.startsWith('tmp:');
}

function parsePositiveInteger(value: string, label: string, target: 'group' | 'rule') {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) {
    throw new MappingValidationError(target, `${label} is required.`);
  }
  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new MappingValidationError(target, `${label} must be 1 or greater.`);
  }
  return parsed;
}

function sortMappingSets(sets: InterfaceMappingSet[]) {
  return [...sets].sort((a, b) => {
    if (a.is_default !== b.is_default) return a.is_default ? -1 : 1;
    return (a.name || '').localeCompare(b.name || '');
  });
}

function groupTitlePriority(group: InterfaceMappingGroup | null | undefined) {
  const key = normalizeGroupTitleKey(group?.title);
  if (key === 'head') return 0;
  if (key === 'item') return 1;
  if (key) return 2;
  return 3;
}

function sortGroups(groups: InterfaceMappingGroup[]) {
  return [...groups].sort((a, b) => {
    const priorityCompare = groupTitlePriority(a) - groupTitlePriority(b);
    if (priorityCompare !== 0) return priorityCompare;
    const titleCompare = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
    if (titleCompare !== 0) return titleCompare;
    return (a.id || '').localeCompare(b.id || '');
  });
}

function isReservedGroup(group: InterfaceMappingGroup | null | undefined) {
  return RESERVED_GROUP_TITLE_KEYS.has(normalizeGroupTitleKey(group?.title));
}

function findGroupByTitle(groups: InterfaceMappingGroup[], title: string) {
  const target = normalizeGroupTitleKey(title);
  return groups.find((group) => normalizeGroupTitleKey(group.title) === target) || null;
}

function sortRules(rules: InterfaceMappingRule[], groups: InterfaceMappingGroup[]) {
  const groupById = new Map(groups.map((group) => [group.id, group]));
  return [...rules].sort((a, b) => {
    const aGroup = a.group_id ? groupById.get(a.group_id) : null;
    const bGroup = b.group_id ? groupById.get(b.group_id) : null;
    const priorityCompare = groupTitlePriority(aGroup) - groupTitlePriority(bGroup);
    if (priorityCompare !== 0) return priorityCompare;
    const groupTitleCompare = (aGroup?.title || '').localeCompare(bGroup?.title || '', undefined, { sensitivity: 'base' });
    if (groupTitleCompare !== 0) return groupTitleCompare;
    const titleCompare = (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });
    if (titleCompare !== 0) return titleCompare;
    return (a.id || '').localeCompare(b.id || '');
  });
}

function normalizeLoadedGroups(groups: InterfaceMappingGroup[]) {
  return sortGroups(groups).map((group, index) => ({
    ...group,
    order_index: Number(group.order_index || 0) > 0 ? Number(group.order_index) : index + 1,
  }));
}

function normalizeLoadedRules(rules: InterfaceMappingRule[], groups: InterfaceMappingGroup[]) {
  const sorted = sortRules(rules, groups);
  const counters = new Map<string, number>();
  return sorted.map((rule) => {
    const bucket = rule.group_id || UNGROUPED_GROUP_KEY;
    const current = Number(rule.order_index || 0);
    const baseRule = {
      ...rule,
      lifecycle: normalizeRuleLifecycle(rule.lifecycle),
      environment_scope: normalizeEnvironmentScope(rule.environment_scope),
    };
    if (current > 0) {
      counters.set(bucket, Math.max(counters.get(bucket) || 0, current));
      return { ...baseRule, order_index: current };
    }
    const next = (counters.get(bucket) || 0) + 1;
    counters.set(bucket, next);
    return { ...baseRule, order_index: next };
  });
}

function nextGroupOrderIndex(groups: InterfaceMappingGroup[]) {
  return groups.reduce((max, item) => Math.max(max, Number(item.order_index || 0)), 0) + 1;
}

function nextRuleOrderIndex(rules: InterfaceMappingRule[], groupId: string | null) {
  return rules
    .filter((item) => (item.group_id || null) === (groupId || null))
    .reduce((max, item) => Math.max(max, Number(item.order_index || 0)), 0) + 1;
}

function bindingTextFromItem(item: Record<string, unknown>) {
  let bindingText = '';
  let bindingType = '';

  for (const key of BINDING_KEYS) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) {
      bindingText = value.trim();
      break;
    }
  }

  for (const key of BINDING_TYPE_KEYS) {
    const value = item[key];
    if (typeof value === 'string' && value.trim()) {
      bindingType = value.trim();
      break;
    }
  }

  if (bindingText && bindingType) {
    return `${bindingText} (${bindingType})`;
  }
  if (bindingText) {
    return bindingText;
  }
  const entries = Object.entries(item).slice(0, 2);
  if (entries.length === 0) return '';
  return entries.map(([key, value]) => `${key}: ${String(value ?? '')}`).join(', ');
}

function createEmptyBindingRow(): BindingFormState {
  return {
    id: makeTempId('binding'),
    path: '',
    data_type: '',
    extras: {},
  };
}

function bindingFormFromEntity(item: unknown): BindingFormState {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return createEmptyBindingRow();
  }

  const record = item as Record<string, unknown>;
  let path = '';
  let dataType = '';
  const extras: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(record)) {
    if (!path && BINDING_KEYS.includes(key) && typeof value === 'string' && value.trim()) {
      path = value.trim();
      continue;
    }
    if (!dataType && BINDING_TYPE_KEYS.includes(key) && typeof value === 'string' && value.trim()) {
      dataType = value.trim();
      continue;
    }
    if (BINDING_KEYS.includes(key) || BINDING_TYPE_KEYS.includes(key)) {
      continue;
    }
    extras[key] = cloneValue(value);
  }

  return {
    id: makeTempId('binding'),
    path,
    data_type: dataType,
    extras,
  };
}

function bindingsFormFromEntity(bindings: Array<Record<string, unknown>> | null | undefined) {
  if (!Array.isArray(bindings) || bindings.length === 0) {
    return [createEmptyBindingRow()];
  }
  const rows = bindings.map((item) => bindingFormFromEntity(item));
  return rows.length > 0 ? rows : [createEmptyBindingRow()];
}

function bindingPayloadFromForm(row: BindingFormState): Record<string, unknown> | null {
  const path = String(row.path || '').trim();
  if (!path) {
    return null;
  }
  const dataType = String(row.data_type || '').trim();
  return {
    ...cloneValue(row.extras),
    path,
    ...(dataType ? { type: dataType } : {}),
  };
}

function bindingsPayloadFromForm(rows: BindingFormState[]) {
  return rows
    .map((row) => bindingPayloadFromForm(row))
    .filter((row): row is Record<string, unknown> => !!row);
}

function bindingsSummary(bindings: Array<Record<string, unknown>> | null | undefined) {
  const lines = Array.isArray(bindings)
    ? bindings
      .map((item) => bindingTextFromItem(item))
      .filter(Boolean)
    : [];
  if (lines.length === 0) return 'Not set';
  if (lines.length === 1) return lines[0];
  return `${lines[0]} (+${lines.length - 1})`;
}

function resolveOperationKindChoice(value: string | null | undefined) {
  const normalized = String(value || '').trim() || 'direct';
  const isCommon = OPERATION_KIND_OPTIONS.some((option) => option.value === normalized);
  return {
    choice: isCommon ? normalized : OTHER_OPERATION_KIND,
    other: isCommon ? '' : normalized,
  };
}

function formatOperationKind(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  const option = OPERATION_KIND_OPTIONS.find((item) => item.value === normalized);
  return option?.label || normalized || 'Direct copy';
}

function groupFormFromEntity(group: InterfaceMappingGroup): GroupFormState {
  return {
    id: group.id,
    title: group.title || '',
    description: group.description || '',
    order_index: String(group.order_index || 1),
  };
}

function ruleFormFromEntity(rule: InterfaceMappingRule): RuleFormState {
  const operation = resolveOperationKindChoice(rule.operation_kind);
  return {
    id: rule.id,
    title: rule.title || '',
    rule_key: rule.rule_key || '',
    group_id: rule.group_id || '',
    order_index: String(rule.order_index || 1),
    applies_to_leg_id: rule.applies_to_leg_id || '',
    operation_kind_choice: operation.choice,
    operation_kind_other: operation.other,
    lifecycle: normalizeRuleLifecycle(rule.lifecycle),
    environment_scope: normalizeEnvironmentScope(rule.environment_scope) || [],
    source_bindings: bindingsFormFromEntity(rule.source_bindings),
    target_bindings: bindingsFormFromEntity(rule.target_bindings),
    condition_text: rule.condition_text || '',
    business_rule_text: rule.business_rule_text || '',
    remarks: rule.remarks || '',
  };
}

function createClosedGroupEditor(): GroupEditorState {
  const emptyForm: GroupFormState = { id: '', title: '', description: '', order_index: '1' };
  return {
    open: false,
    mode: 'create',
    baseline: emptyForm,
    form: emptyForm,
    error: null,
  };
}

function createClosedRuleEditor(): RuleEditorState {
  const emptyForm: RuleFormState = {
    id: '',
    title: '',
    rule_key: '',
    group_id: '',
    order_index: '1',
    applies_to_leg_id: '',
    operation_kind_choice: 'direct',
    operation_kind_other: '',
    lifecycle: 'active',
    environment_scope: [],
    source_bindings: [createEmptyBindingRow()],
    target_bindings: [createEmptyBindingRow()],
    condition_text: '',
    business_rule_text: '',
    remarks: '',
  };
  return {
    open: false,
    mode: 'create',
    baseline: emptyForm,
    form: emptyForm,
    error: null,
  };
}

function groupPayloadFromEntity(group: InterfaceMappingGroup): CreateInterfaceMappingGroupInput {
  return {
    title: String(group.title || '').trim(),
    description: normalizeOptionalText(group.description),
    order_index: Number(group.order_index || 1),
  };
}

function rulePayloadFromEntity(
  rule: InterfaceMappingRule,
  resolveGroupId: (groupId: string | null | undefined) => string | null,
): CreateInterfaceMappingRuleInput {
  return {
    group_id: resolveGroupId(rule.group_id),
    rule_key: normalizeOptionalText(rule.rule_key),
    title: String(rule.title || '').trim(),
    order_index: Number(rule.order_index || 1),
    applies_to_leg_id: normalizeOptionalId(rule.applies_to_leg_id),
    operation_kind: normalizeOptionalText(rule.operation_kind) || 'direct',
    lifecycle: normalizeRuleLifecycle(rule.lifecycle),
    environment_scope: normalizeEnvironmentScope(rule.environment_scope),
    source_bindings: cloneValue(Array.isArray(rule.source_bindings) ? rule.source_bindings : []),
    target_bindings: cloneValue(Array.isArray(rule.target_bindings) ? rule.target_bindings : []),
    condition_text: normalizeOptionalText(rule.condition_text),
    business_rule_text: normalizeOptionalText(rule.business_rule_text),
    middleware_rule_text: normalizeOptionalText(rule.middleware_rule_text),
    remarks: normalizeOptionalText(rule.remarks),
    example_input: normalizeOptionalText(rule.example_input),
    example_output: normalizeOptionalText(rule.example_output),
    implementation_status: normalizeOptionalText(rule.implementation_status),
    test_status: normalizeOptionalText(rule.test_status),
  };
}

function serializeGroups(groups: InterfaceMappingGroup[]) {
  return JSON.stringify(
    sortGroups(groups).map((group) => ({
      id: group.id,
      title: String(group.title || '').trim(),
      description: normalizeOptionalText(group.description),
      order_index: Number(group.order_index || 1),
    })),
  );
}

function serializeRules(rules: InterfaceMappingRule[], groups: InterfaceMappingGroup[]) {
  return JSON.stringify(
    sortRules(rules, groups).map((rule) => ({
      id: rule.id,
      payload: rulePayloadFromEntity(rule, (groupId) => groupId || null),
    })),
  );
}

export default forwardRef<InterfaceMappingTabHandle, Props>(function InterfaceMappingTab({
  canManage,
  interfaceId,
  data,
  onDirtyChange,
}, ref) {
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const [loading, setLoading] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [mappingSet, setMappingSet] = React.useState<InterfaceMappingSet | null>(null);
  const [environmentOptions, setEnvironmentOptions] = React.useState<EnvironmentOption[]>([]);
  const [baselineGroups, setBaselineGroups] = React.useState<InterfaceMappingGroup[]>([]);
  const [draftGroups, setDraftGroups] = React.useState<InterfaceMappingGroup[]>([]);
  const [baselineRules, setBaselineRules] = React.useState<InterfaceMappingRule[]>([]);
  const [draftRules, setDraftRules] = React.useState<InterfaceMappingRule[]>([]);
  const [selectedGroupId, setSelectedGroupId] = React.useState<GroupFilterKey>(ALL_GROUPS_KEY);
  const [ruleSearch, setRuleSearch] = React.useState('');
  const [columnChooserAnchor, setColumnChooserAnchor] = React.useState<HTMLElement | null>(null);
  const [hiddenRuleColumns, setHiddenRuleColumns] = React.useState<MappingRuleColumnKey[]>(loadHiddenRuleColumns);
  const [groupManagerOpen, setGroupManagerOpen] = React.useState(false);
  const [groupEditor, setGroupEditor] = React.useState<GroupEditorState>(() => createClosedGroupEditor());
  const [ruleEditor, setRuleEditor] = React.useState<RuleEditorState>(() => createClosedRuleEditor());
  const [pendingDeleteGroup, setPendingDeleteGroup] = React.useState<InterfaceMappingGroup | null>(null);
  const [pendingDeleteRule, setPendingDeleteRule] = React.useState<InterfaceMappingRule | null>(null);

  const legs = React.useMemo(() => (data?.legs || []) as InterfaceLeg[], [data?.legs]);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(MAPPING_RULE_COLUMNS_STORAGE_KEY, JSON.stringify(hiddenRuleColumns));
    } catch {
      // Column preferences are optional.
    }
  }, [hiddenRuleColumns]);

  const getRoleLabel = React.useCallback((role: string) => {
    const normalized = String(role || '').toLowerCase();
    if (normalized === 'source') return data?.source_application_name || 'Source';
    if (normalized === 'target') return data?.target_application_name || 'Target';
    if (normalized === 'middleware') return 'Middleware';
    return role || '';
  }, [data?.source_application_name, data?.target_application_name]);

  const legLabel = React.useCallback((leg: InterfaceLeg) => (
    `${String(leg.leg_type || '').toUpperCase()} • ${getRoleLabel(leg.from_role)} -> ${getRoleLabel(leg.to_role)}`
  ), [getRoleLabel]);

  const load = React.useCallback(async () => {
    if (!interfaceId) return;
    setLoading(true);
    setError(null);
    try {
      const [setsResponse, bindingsResponse] = await Promise.all([
        interfacesApi.listMappingSets(interfaceId),
        interfacesApi.getBindings(interfaceId),
      ]);
      const nextEnvironmentOptions = environmentOptionsFromBindings(bindingsResponse.items || []);
      const nextSets = sortMappingSets(setsResponse.items || []);
      const defaultSet = nextSets.find((item) => item.is_default) || nextSets[0] || null;
      setEnvironmentOptions(nextEnvironmentOptions);

      if (!defaultSet) {
        setMappingSet(null);
        setBaselineGroups([]);
        setDraftGroups([]);
        setBaselineRules([]);
        setDraftRules([]);
        setGroupEditor(createClosedGroupEditor());
        setRuleEditor(createClosedRuleEditor());
        setSelectedGroupId(ALL_GROUPS_KEY);
        return;
      }

      const [groupsResponse, rulesResponse] = await Promise.all([
        interfacesApi.listMappingGroups(defaultSet.id),
        interfacesApi.listMappingRules(defaultSet.id),
      ]);

      const nextGroups = normalizeLoadedGroups(cloneValue(groupsResponse.items || []));
      const nextRules = normalizeLoadedRules(cloneValue(rulesResponse.items || []), nextGroups);

      setMappingSet(defaultSet);
      setBaselineGroups(nextGroups);
      setDraftGroups(cloneValue(nextGroups));
      setBaselineRules(nextRules);
      setDraftRules(cloneValue(nextRules));
      setGroupManagerOpen(false);
      setGroupEditor(createClosedGroupEditor());
      setRuleEditor(createClosedRuleEditor());
      setSelectedGroupId((current) => {
        if (current === ALL_GROUPS_KEY || current === UNGROUPED_GROUP_KEY) return current;
        return nextGroups.some((group) => group.id === current) ? current : ALL_GROUPS_KEY;
      });
    } catch (loadError: any) {
      setError(getApiErrorMessage(loadError, t, 'Failed to load interface mappings.'));
      setMappingSet(null);
      setEnvironmentOptions([]);
      setBaselineGroups([]);
      setDraftGroups([]);
      setBaselineRules([]);
      setDraftRules([]);
    } finally {
      setLoading(false);
    }
  }, [interfaceId, t]);

  React.useEffect(() => {
    void load();
  }, [load]);

  React.useEffect(() => {
    if (selectedGroupId === ALL_GROUPS_KEY || selectedGroupId === UNGROUPED_GROUP_KEY) return;
    if (!draftGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(ALL_GROUPS_KEY);
    }
  }, [draftGroups, selectedGroupId]);

  const groupEditorDirty = React.useMemo(() => (
    groupEditor.open && JSON.stringify(groupEditor.form) !== JSON.stringify(groupEditor.baseline)
  ), [groupEditor]);

  const ruleEditorDirty = React.useMemo(() => (
    ruleEditor.open && JSON.stringify(ruleEditor.form) !== JSON.stringify(ruleEditor.baseline)
  ), [ruleEditor]);

  const draftDirty = React.useMemo(() => (
    serializeGroups(draftGroups) !== serializeGroups(baselineGroups)
    || serializeRules(draftRules, draftGroups) !== serializeRules(baselineRules, baselineGroups)
  ), [baselineGroups, baselineRules, draftGroups, draftRules]);

  const dirty = draftDirty || groupEditorDirty || ruleEditorDirty;

  React.useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);

  const setValidationError = React.useCallback((validationError: MappingValidationError) => {
    if (validationError.target === 'group') {
      setGroupEditor((current) => ({ ...current, error: validationError.message }));
    } else {
      setRuleEditor((current) => ({ ...current, error: validationError.message }));
    }
  }, []);

  const normalizeGroupFromForm = React.useCallback((form: GroupFormState, existing?: InterfaceMappingGroup | null) => {
    if (!mappingSet) {
      throw new MappingValidationError('group', 'Default mapping set is not available for this interface.');
    }
    const title = String(form.title || '').trim();
    if (!title) {
      throw new MappingValidationError('group', 'Group title is required.');
    }
    const now = new Date().toISOString();
    return {
      id: existing?.id || form.id || makeTempId('group'),
      tenant_id: existing?.tenant_id || mappingSet.tenant_id,
      interface_id: existing?.interface_id || interfaceId,
      mapping_set_id: existing?.mapping_set_id || mappingSet.id,
      title,
      description: normalizeOptionalText(form.description),
      order_index: parsePositiveInteger(form.order_index, 'Group order', 'group'),
      created_at: existing?.created_at || now,
      updated_at: now,
    } satisfies InterfaceMappingGroup;
  }, [interfaceId, mappingSet]);

  const normalizeRuleFromForm = React.useCallback((
    form: RuleFormState,
    groups: InterfaceMappingGroup[],
    existing?: InterfaceMappingRule | null,
  ) => {
    if (!mappingSet) {
      throw new MappingValidationError('rule', 'Default mapping set is not available for this interface.');
    }
    const title = String(form.title || '').trim();
    if (!title) {
      throw new MappingValidationError('rule', 'Rule title is required.');
    }

    const groupId = normalizeOptionalId(form.group_id);
    if (groupId && !groups.some((group) => group.id === groupId)) {
      throw new MappingValidationError('rule', 'Select a valid group for this rule.');
    }

    const operationKind = form.operation_kind_choice === OTHER_OPERATION_KIND
      ? normalizeOptionalText(form.operation_kind_other)
      : normalizeOptionalText(form.operation_kind_choice);
    if (!operationKind) {
      throw new MappingValidationError('rule', 'Select an operation.');
    }

    const now = new Date().toISOString();
    return {
      id: existing?.id || form.id || makeTempId('rule'),
      tenant_id: existing?.tenant_id || mappingSet.tenant_id,
      interface_id: existing?.interface_id || interfaceId,
      mapping_set_id: existing?.mapping_set_id || mappingSet.id,
      group_id: groupId,
      rule_key: normalizeOptionalText(form.rule_key),
      title,
      order_index: existing?.order_index || parsePositiveInteger(form.order_index, 'Rule order', 'rule'),
      applies_to_leg_id: normalizeOptionalId(form.applies_to_leg_id),
      operation_kind: operationKind,
      lifecycle: normalizeRuleLifecycle(form.lifecycle),
      environment_scope: filterEnvironmentScope(form.environment_scope, environmentOptions),
      source_bindings: bindingsPayloadFromForm(form.source_bindings),
      target_bindings: bindingsPayloadFromForm(form.target_bindings),
      condition_text: normalizeOptionalText(form.condition_text),
      business_rule_text: normalizeOptionalText(form.business_rule_text),
      middleware_rule_text: null,
      remarks: normalizeOptionalText(form.remarks),
      example_input: existing?.example_input ?? null,
      example_output: existing?.example_output ?? null,
      implementation_status: existing?.implementation_status ?? null,
      test_status: existing?.test_status ?? null,
      created_at: existing?.created_at || now,
      updated_at: now,
    } satisfies InterfaceMappingRule;
  }, [environmentOptions, interfaceId, mappingSet]);

  const buildCommittedSnapshot = React.useCallback(() => {
    let nextGroups = draftGroups;
    if (groupEditorDirty && groupEditor.open) {
      const existingGroup = draftGroups.find((group) => group.id === groupEditor.form.id) || null;
      const normalizedGroup = normalizeGroupFromForm(groupEditor.form, existingGroup);
      nextGroups = sortGroups([
        ...draftGroups.filter((group) => group.id !== normalizedGroup.id),
        normalizedGroup,
      ]);
    }

    let nextRules = draftRules;
    if (ruleEditorDirty && ruleEditor.open) {
      const existingRule = draftRules.find((rule) => rule.id === ruleEditor.form.id) || null;
      const normalizedRule = normalizeRuleFromForm(ruleEditor.form, nextGroups, existingRule);
      nextRules = sortRules([
        ...draftRules.filter((rule) => rule.id !== normalizedRule.id),
        normalizedRule,
      ], nextGroups);
    }

    return { groups: nextGroups, rules: nextRules };
  }, [
    draftGroups,
    draftRules,
    groupEditor,
    groupEditorDirty,
    normalizeGroupFromForm,
    normalizeRuleFromForm,
    ruleEditor,
    ruleEditorDirty,
  ]);

  const commitGroupEditor = React.useCallback(() => {
    try {
      const existingGroup = draftGroups.find((group) => group.id === groupEditor.form.id) || null;
      const normalizedGroup = normalizeGroupFromForm(groupEditor.form, existingGroup);
      const nextGroups = sortGroups([
        ...draftGroups.filter((group) => group.id !== normalizedGroup.id),
        normalizedGroup,
      ]);
      setDraftGroups(nextGroups);
      setSelectedGroupId(normalizedGroup.id);
      setGroupEditor(createClosedGroupEditor());
      return true;
    } catch (validationError: any) {
      if (validationError instanceof MappingValidationError) {
        setValidationError(validationError);
        return false;
      }
      throw validationError;
    }
  }, [draftGroups, groupEditor.form, normalizeGroupFromForm, setValidationError]);

  const persistSnapshot = React.useCallback(async (
    snapshot: { groups: InterfaceMappingGroup[]; rules: InterfaceMappingRule[] },
  ) => {
    if (!mappingSet) return { ok: true, message: null as string | null };
    if (!canManage) {
      const message = 'You do not have permission to edit mappings.';
      setError(message);
      return { ok: false, message };
    }

    setSaving(true);
    setError(null);
    let wroteToServer = false;

    try {
      const baselineGroupMap = new Map(baselineGroups.map((group) => [group.id, group]));
      const baselineRuleMap = new Map(baselineRules.map((rule) => [rule.id, rule]));
      const nextExistingGroupIds = new Set(snapshot.groups.filter((group) => !isTempId(group.id)).map((group) => group.id));
      const nextExistingRuleIds = new Set(snapshot.rules.filter((rule) => !isTempId(rule.id)).map((rule) => rule.id));

      const deletedRules = baselineRules.filter((rule) => !nextExistingRuleIds.has(rule.id));
      for (const rule of deletedRules) {
        await interfacesApi.deleteMappingRule(rule.id);
        wroteToServer = true;
      }

      const createdGroupIdMap = new Map<string, string>();
      const createdGroups = snapshot.groups.filter((group) => isTempId(group.id));
      for (const group of createdGroups) {
        const savedGroup = await interfacesApi.createMappingGroup(mappingSet.id, groupPayloadFromEntity(group));
        createdGroupIdMap.set(group.id, savedGroup.id);
        wroteToServer = true;
      }

      const updatedGroups = snapshot.groups.filter((group) => (
        !isTempId(group.id)
        && baselineGroupMap.has(group.id)
        && JSON.stringify(groupPayloadFromEntity(group)) !== JSON.stringify(groupPayloadFromEntity(baselineGroupMap.get(group.id)!))
      ));
      for (const group of updatedGroups) {
        await interfacesApi.updateMappingGroup(group.id, groupPayloadFromEntity(group));
        wroteToServer = true;
      }

      const deletedGroups = baselineGroups.filter((group) => !nextExistingGroupIds.has(group.id));
      for (const group of deletedGroups) {
        await interfacesApi.deleteMappingGroup(group.id);
        wroteToServer = true;
      }

      const resolveGroupId = (groupId: string | null | undefined) => {
        if (!groupId) return null;
        if (!isTempId(groupId)) return groupId;
        return createdGroupIdMap.get(groupId) || null;
      };

      const createdRules = snapshot.rules.filter((rule) => isTempId(rule.id));
      for (const rule of createdRules) {
        await interfacesApi.createMappingRule(mappingSet.id, rulePayloadFromEntity(rule, resolveGroupId));
        wroteToServer = true;
      }

      const updatedRules = snapshot.rules.filter((rule) => {
        if (isTempId(rule.id) || !baselineRuleMap.has(rule.id)) return false;
        const baselineRule = baselineRuleMap.get(rule.id)!;
        return JSON.stringify(rulePayloadFromEntity(rule, resolveGroupId))
          !== JSON.stringify(rulePayloadFromEntity(baselineRule, (groupId) => groupId || null));
      });
      for (const rule of updatedRules) {
        await interfacesApi.updateMappingRule(rule.id, rulePayloadFromEntity(rule, resolveGroupId));
        wroteToServer = true;
      }

      setGroupManagerOpen(false);
      setGroupEditor(createClosedGroupEditor());
      setRuleEditor(createClosedRuleEditor());
      await load();
      return { ok: true, message: null as string | null };
    } catch (saveError: any) {
      const message = getApiErrorMessage(saveError, t, 'Failed to save interface mappings.');
      setError(message);
      if (wroteToServer) {
        setGroupManagerOpen(false);
        setGroupEditor(createClosedGroupEditor());
        setRuleEditor(createClosedRuleEditor());
        await load();
      }
      return { ok: false, message };
    } finally {
      setSaving(false);
    }
  }, [
    baselineGroups,
    baselineRules,
    canManage,
    load,
    mappingSet,
    t,
  ]);

  const save = React.useCallback(async () => {
    let snapshot: { groups: InterfaceMappingGroup[]; rules: InterfaceMappingRule[] };
    try {
      snapshot = buildCommittedSnapshot();
    } catch (validationError: any) {
      if (validationError instanceof MappingValidationError) {
        setValidationError(validationError);
        return false;
      }
      throw validationError;
    }

    const result = await persistSnapshot(snapshot);
    return result.ok;
  }, [buildCommittedSnapshot, persistSnapshot, setValidationError]);

  const replaceRuleBindingRows = React.useCallback((
    form: RuleFormState,
    key: BindingCollectionKey,
    rows: BindingFormState[],
  ): RuleFormState => {
    if (key === 'source_bindings') {
      return { ...form, source_bindings: rows };
    }
    return { ...form, target_bindings: rows };
  }, []);

  const addRuleBindingRow = React.useCallback((key: BindingCollectionKey) => {
    setRuleEditor((current) => ({
      ...current,
      error: null,
      form: replaceRuleBindingRows(current.form, key, [
        ...current.form[key],
        createEmptyBindingRow(),
      ]),
    }));
  }, [replaceRuleBindingRows]);

  const updateRuleBindingRow = React.useCallback((
    key: BindingCollectionKey,
    rowId: string,
    patch: Partial<BindingFormState>,
  ) => {
    setRuleEditor((current) => ({
      ...current,
      error: null,
      form: replaceRuleBindingRows(
        current.form,
        key,
        current.form[key].map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
      ),
    }));
  }, [replaceRuleBindingRows]);

  const removeRuleBindingRow = React.useCallback((key: BindingCollectionKey, rowId: string) => {
    setRuleEditor((current) => {
      const nextRows = current.form[key].filter((row) => row.id !== rowId);
      return {
        ...current,
        error: null,
        form: replaceRuleBindingRows(
          current.form,
          key,
          nextRows.length > 0 ? nextRows : [createEmptyBindingRow()],
        ),
      };
    });
  }, [replaceRuleBindingRows]);

  const saveRuleEditor = React.useCallback(async () => {
    let snapshot: { groups: InterfaceMappingGroup[]; rules: InterfaceMappingRule[] };
    try {
      const existingRule = draftRules.find((rule) => rule.id === ruleEditor.form.id) || null;
      const normalizedRule = normalizeRuleFromForm(ruleEditor.form, draftGroups, existingRule);
      snapshot = {
        groups: draftGroups,
        rules: sortRules([
          ...draftRules.filter((rule) => rule.id !== normalizedRule.id),
          normalizedRule,
        ], draftGroups),
      };
    } catch (validationError: any) {
      if (validationError instanceof MappingValidationError) {
        setValidationError(validationError);
        return false;
      }
      throw validationError;
    }

    const result = await persistSnapshot(snapshot);
    if (!result.ok && result.message) {
      setRuleEditor((current) => (
        current.open ? { ...current, error: result.message } : current
      ));
    }
    return result.ok;
  }, [
    draftGroups,
    draftRules,
    normalizeRuleFromForm,
    persistSnapshot,
    ruleEditor.form,
    setValidationError,
  ]);

  const reset = React.useCallback(async () => {
    setError(null);
    setGroupManagerOpen(false);
    setGroupEditor(createClosedGroupEditor());
    setRuleEditor(createClosedRuleEditor());
    await load();
  }, [load]);

  useImperativeHandle(ref, () => ({
    save,
    reset,
    isDirty: () => dirty,
  }), [dirty, reset, save]);

  const ruleCounts = React.useMemo(() => {
    const counts = new Map<string, number>();
    let ungrouped = 0;
    for (const rule of draftRules) {
      if (rule.group_id) {
        counts.set(rule.group_id, (counts.get(rule.group_id) || 0) + 1);
      } else {
        ungrouped += 1;
      }
    }
    return { counts, ungrouped };
  }, [draftRules]);

  const visibleRules = React.useMemo(() => {
    const sorted = sortRules(draftRules, draftGroups);
    if (selectedGroupId === ALL_GROUPS_KEY) return sorted;
    if (selectedGroupId === UNGROUPED_GROUP_KEY) {
      return sorted.filter((rule) => !rule.group_id);
    }
    return sorted.filter((rule) => rule.group_id === selectedGroupId);
  }, [draftGroups, draftRules, selectedGroupId]);

  const selectedGroup = React.useMemo(() => (
    selectedGroupId === ALL_GROUPS_KEY || selectedGroupId === UNGROUPED_GROUP_KEY
      ? null
      : draftGroups.find((group) => group.id === selectedGroupId) || null
  ), [draftGroups, selectedGroupId]);

  const defaultItemGroup = React.useMemo(
    () => findGroupByTitle(draftGroups, DEFAULT_ITEM_GROUP_TITLE),
    [draftGroups],
  );

  const mappingRuleRows = React.useMemo<MappingRuleGridRow[]>(() => (
    visibleRules.map((rule) => {
      const ruleGroup = rule.group_id
        ? draftGroups.find((group) => group.id === rule.group_id) || null
        : null;
      const ruleLeg = rule.applies_to_leg_id
        ? legs.find((leg) => leg.id === rule.applies_to_leg_id) || null
        : null;

      return {
        id: rule.id,
        rule,
        title: rule.title || 'Untitled mapping',
        mapping_text: `${bindingsSummary(rule.source_bindings)} ${bindingsSummary(rule.target_bindings)}`,
        source_text: bindingsSummary(rule.source_bindings),
        target_text: bindingsSummary(rule.target_bindings),
        condition_text: normalizeOptionalText(rule.condition_text),
        lifecycle: normalizeRuleLifecycle(rule.lifecycle),
        lifecycle_label: formatLifecycle(rule.lifecycle),
        environment_scope_label: formatEnvironmentScope(rule.environment_scope),
        operation_label: formatOperationKind(rule.operation_kind),
        group_label: ruleGroup?.title || 'Ungrouped',
        leg_label: ruleLeg ? legLabel(ruleLeg) : 'All legs',
      };
    })
  ), [draftGroups, legLabel, legs, visibleRules]);

  const mappingRulesSummary = React.useMemo(() => {
    if (selectedGroupId === ALL_GROUPS_KEY) {
      return formatRuleCount(draftRules.length);
    }
    if (selectedGroupId === UNGROUPED_GROUP_KEY) {
      return `${formatRuleCount(visibleRules.length)} in ungrouped`;
    }
    return `${formatRuleCount(visibleRules.length)} in ${selectedGroup?.title || 'selected group'}`;
  }, [draftRules.length, selectedGroup?.title, selectedGroupId, visibleRules.length]);

  const mappingRulesGridHeight = React.useMemo(() => {
    const rowCount = Math.max(mappingRuleRows.length, 1);
    return Math.min(620, Math.max(190, 38 + rowCount * 64 + 2));
  }, [mappingRuleRows.length]);

  const openCreateGroup = React.useCallback(() => {
    const form: GroupFormState = {
      id: makeTempId('group'),
      title: '',
      description: '',
      order_index: String(nextGroupOrderIndex(draftGroups)),
    };
    setGroupEditor({
      open: true,
      mode: 'create',
      baseline: form,
      form,
      error: null,
    });
  }, [draftGroups]);

  const openEditGroup = React.useCallback((group: InterfaceMappingGroup) => {
    if (isReservedGroup(group)) {
      return;
    }
    const form = groupFormFromEntity(group);
    setGroupEditor({
      open: true,
      mode: 'edit',
      baseline: form,
      form,
      error: null,
    });
  }, []);

  const openCreateRule = React.useCallback(() => {
    const preferredGroupId = selectedGroupId !== ALL_GROUPS_KEY && selectedGroupId !== UNGROUPED_GROUP_KEY
      ? selectedGroupId
      : defaultItemGroup?.id || '';
    const form: RuleFormState = {
      id: makeTempId('rule'),
      title: '',
      rule_key: '',
      group_id: preferredGroupId,
      order_index: String(nextRuleOrderIndex(draftRules, preferredGroupId || null)),
      applies_to_leg_id: '',
      operation_kind_choice: 'direct',
      operation_kind_other: '',
      lifecycle: 'active',
      environment_scope: [],
      source_bindings: [createEmptyBindingRow()],
      target_bindings: [createEmptyBindingRow()],
      condition_text: '',
      business_rule_text: '',
      remarks: '',
    };
    setRuleEditor({
      open: true,
      mode: 'create',
      baseline: form,
      form,
      error: null,
    });
  }, [defaultItemGroup?.id, draftRules, selectedGroupId]);

  const openEditRule = React.useCallback((rule: InterfaceMappingRule) => {
    const form = {
      ...ruleFormFromEntity(rule),
      environment_scope: filterEnvironmentScope(rule.environment_scope, environmentOptions),
    };
    setRuleEditor({
      open: true,
      mode: 'edit',
      baseline: form,
      form,
      error: null,
    });
  }, [environmentOptions]);

  const copyRule = React.useCallback((rule: InterfaceMappingRule) => {
    const now = new Date().toISOString();
    const copiedRule: InterfaceMappingRule = {
      ...cloneValue(rule),
      id: makeTempId('rule'),
      title: `${rule.title || 'Mapping'} (copy)`,
      rule_key: null,
      lifecycle: normalizeRuleLifecycle(rule.lifecycle),
      environment_scope: filterEnvironmentScope(rule.environment_scope, environmentOptions),
      created_at: now,
      updated_at: now,
    };
    setDraftRules((current) => sortRules([...current, copiedRule], draftGroups));
  }, [draftGroups, environmentOptions]);

  const deleteGroup = React.useCallback((group: InterfaceMappingGroup) => {
    if (isReservedGroup(group)) {
      return;
    }
    setPendingDeleteGroup(group);
  }, []);

  const confirmDeleteGroup = React.useCallback(() => {
    const group = pendingDeleteGroup;
    if (!group) return;
    const nextGroups = draftGroups.filter((item) => item.id !== group.id);
    const nextRules = sortRules(
      draftRules.map((rule) => (
        rule.group_id === group.id ? { ...rule, group_id: null, updated_at: new Date().toISOString() } : rule
      )),
      nextGroups,
    );

    setDraftGroups(nextGroups);
    setDraftRules(nextRules);
    if (selectedGroupId === group.id) {
      setSelectedGroupId(ALL_GROUPS_KEY);
    }
    if (groupEditor.open && groupEditor.form.id === group.id) {
      setGroupEditor(createClosedGroupEditor());
    }
    if (ruleEditor.open && ruleEditor.form.group_id === group.id) {
      setRuleEditor((current) => ({
        ...current,
        form: { ...current.form, group_id: '' },
      }));
    }
    setPendingDeleteGroup(null);
  }, [draftGroups, draftRules, groupEditor.form.id, groupEditor.open, pendingDeleteGroup, ruleEditor.form.group_id, ruleEditor.open, selectedGroupId]);

  const deleteRule = React.useCallback((rule: InterfaceMappingRule) => {
    setPendingDeleteRule(rule);
  }, []);

  const confirmDeleteRule = React.useCallback(() => {
    const rule = pendingDeleteRule;
    if (!rule) return;
    setDraftRules((current) => current.filter((item) => item.id !== rule.id));
    if (ruleEditor.open && ruleEditor.form.id === rule.id) {
      setRuleEditor(createClosedRuleEditor());
    }
    setPendingDeleteRule(null);
  }, [pendingDeleteRule, ruleEditor.form.id, ruleEditor.open]);

  const groupActionsDisabled = !canManage || loading || saving || groupEditor.open || ruleEditor.open;
  const ruleActionsDisabled = !canManage || loading || saving || groupEditor.open || ruleEditor.open;
  const columnChooserOpen = Boolean(columnChooserAnchor);

  const isRuleColumnVisible = React.useCallback((columnId: MappingRuleColumnKey) => (
    !hiddenRuleColumns.includes(columnId)
  ), [hiddenRuleColumns]);

  const toggleRuleColumn = React.useCallback((columnId: MappingRuleColumnKey, visible: boolean) => {
    const column = MAPPING_RULE_COLUMN_OPTIONS.find((item) => item.id === columnId);
    if (column?.required) return;
    setHiddenRuleColumns((current) => {
      if (visible) {
        return current.filter((item) => item !== columnId);
      }
      return current.includes(columnId) ? current : [...current, columnId];
    });
  }, []);

  const resetRuleColumns = React.useCallback(() => {
    setHiddenRuleColumns(DEFAULT_HIDDEN_RULE_COLUMNS);
  }, []);

  const mappingRuleColumns = React.useMemo<ColDef<MappingRuleGridRow>[]>(() => {
    const columns: ColDef<MappingRuleGridRow>[] = [
      {
        field: 'group_label',
        headerName: 'Group',
        width: 122,
        minWidth: 105,
        hide: !isRuleColumnVisible('group_label'),
      },
      {
        colId: 'mapping',
        headerName: 'Mapping',
        width: 240,
        minWidth: 180,
        maxWidth: 420,
        hide: !isRuleColumnVisible('mapping'),
        valueGetter: (params) => [
          params.data?.title,
          params.data?.source_text,
          params.data?.target_text,
          params.data?.condition_text,
        ].filter(Boolean).join(' '),
        cellRenderer: (params: ICellRendererParams<MappingRuleGridRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <Box sx={{ minWidth: 0, width: '100%' }}>
              <Typography
                title={row.title}
                sx={{
                  ...mappingCellLineSx,
                  fontSize: 13,
                  fontWeight: 500,
                  lineHeight: 1.35,
                  color: 'kanap.text.primary',
                }}
              >
                {row.title}
              </Typography>
              <Typography
                title={row.source_text}
                sx={{
                  ...mappingCellLineSx,
                  mt: 0.15,
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: 'kanap.text.secondary',
                }}
              >
                Source: {row.source_text}
              </Typography>
              <Typography
                title={row.target_text}
                sx={{
                  ...mappingCellLineSx,
                  mt: 0.15,
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: 'kanap.text.secondary',
                }}
              >
                Destination: {row.target_text}
              </Typography>
            </Box>
          );
        },
      },
      {
        field: 'lifecycle_label',
        headerName: 'Lifecycle',
        width: 130,
        // Client-side grid: the checkbox set filter only drives server-side lists.
        filter: 'agTextColumnFilter',
        hide: !isRuleColumnVisible('lifecycle_label'),
        cellRenderer: (params: ICellRendererParams<MappingRuleGridRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
              <StatusDot size={7} color={getDotColor(LIFECYCLE_COLORS[row.lifecycle] || 'default', theme.palette.mode)} />
              <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }} noWrap>
                {row.lifecycle_label}
              </Typography>
            </Stack>
          );
        },
      },
      {
        field: 'environment_scope_label',
        headerName: 'Environments',
        width: 148,
        minWidth: 128,
        hide: !isRuleColumnVisible('environment_scope_label'),
        cellStyle: { color: 'var(--kanap-text-secondary)' },
      },
      {
        field: 'operation_label',
        headerName: 'Operation',
        width: 135,
        minWidth: 115,
        hide: !isRuleColumnVisible('operation_label'),
      },
      {
        field: 'leg_label',
        headerName: 'Leg scope',
        width: 230,
        minWidth: 190,
        hide: !isRuleColumnVisible('leg_label'),
        cellStyle: { color: 'var(--kanap-text-secondary)' },
      },
      {
        colId: 'actions',
        headerName: 'Actions',
        width: 88,
        maxWidth: 96,
        sortable: false,
        filter: false,
        resizable: false,
        hide: !isRuleColumnVisible('actions'),
        cellRenderer: (params: ICellRendererParams<MappingRuleGridRow>) => {
          const row = params.data;
          if (!row) return null;
          return (
            <Stack direction="row" spacing={0.15} justifyContent="flex-end" sx={{ width: '100%' }}>
              <IconButton
                size="small"
                aria-label={`Copy ${row.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  copyRule(row.rule);
                }}
                disabled={ruleActionsDisabled}
                sx={mappingGridActionButtonSx}
              >
                <ContentCopyIcon />
              </IconButton>
              <IconButton
                size="small"
                aria-label={`Edit ${row.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openEditRule(row.rule);
                }}
                disabled={ruleActionsDisabled}
                sx={mappingGridActionButtonSx}
              >
                <EditIcon />
              </IconButton>
              <IconButton
                size="small"
                aria-label={`Delete ${row.title}`}
                onClick={(event) => {
                  event.stopPropagation();
                  deleteRule(row.rule);
                }}
                disabled={ruleActionsDisabled}
                sx={mappingGridActionButtonSx}
              >
                <DeleteIcon />
              </IconButton>
            </Stack>
          );
        },
      },
    ];
    return columns;
  }, [copyRule, deleteRule, isRuleColumnVisible, openEditRule, ruleActionsDisabled, theme.palette.mode]);

  const mappingRuleDefaultColDef = React.useMemo<ColDef<MappingRuleGridRow>>(() => ({
    sortable: true,
    resizable: true,
    filter: true,
    suppressMenu: false,
  }), []);

  return (
    <Stack spacing={2.5} sx={{ pt: 1 }}>
      {!!error && <Alert severity="error">{error}</Alert>}

      {!mappingSet && !loading ? (
        <Alert severity="warning">
          No default mapping set is available for this interface yet.
        </Alert>
      ) : null}

      {mappingSet ? (
        <Stack spacing={1.5}>
          <Stack spacing={1.25}>
            <Box sx={mappingRulesHeaderSx}>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="subtitle2">Mapping rules</Typography>
                <Typography sx={{ mt: 0.25, fontSize: 12, color: 'kanap.text.tertiary' }}>
                  {mappingRulesSummary}
                </Typography>
              </Box>
              <Stack direction="row" spacing={0.75} alignItems="center" justifyContent="flex-end" useFlexGap flexWrap="wrap">
                {dirty && (
                  <>
                    <Button
                      size="small"
                      variant="action"
                      onClick={() => { void reset(); }}
                      disabled={saving}
                    >
                      Reset
                    </Button>
                    <Button
                      size="small"
                      variant="contained"
                      onClick={() => { void save(); }}
                      disabled={saving || !canManage}
                    >
                      Save changes
                    </Button>
                  </>
                )}
                <Button
                  variant="action"
                  startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />}
                  onClick={openCreateRule}
                  disabled={ruleActionsDisabled || !mappingSet}
                >
                  Add rule
                </Button>
              </Stack>
            </Box>

            <Box sx={mappingRulesControlsSx}>
              <Box sx={mappingRulesFilterSx}>
                <TextField
                  size="small"
                  placeholder="Search rules"
                  value={ruleSearch}
                  onChange={(event) => setRuleSearch(event.target.value)}
                  sx={mappingRulesSearchSx}
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start" sx={{ mr: 0.25 }}>
                        <SearchIcon sx={{ fontSize: 16, color: 'kanap.text.tertiary' }} />
                      </InputAdornment>
                    ),
                    endAdornment: ruleSearch ? (
                      <IconButton
                        size="small"
                        aria-label="Clear rule search"
                        onClick={() => setRuleSearch('')}
                        sx={{ width: 22, height: 22, color: 'kanap.text.tertiary' }}
                      >
                        <CloseIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    ) : undefined,
                  }}
                />
                <Select
                  value={selectedGroupId}
                  onChange={(event) => setSelectedGroupId(String(event.target.value) as GroupFilterKey)}
                  variant="standard"
                  sx={mappingRulesSelectSx}
                  renderValue={(value) => {
                    if (value === ALL_GROUPS_KEY) return 'All rules';
                    if (value === UNGROUPED_GROUP_KEY) return `Ungrouped (${ruleCounts.ungrouped})`;
                    const group = draftGroups.find((item) => item.id === value);
                    return group ? `${group.title} (${ruleCounts.counts.get(group.id) || 0})` : 'All rules';
                  }}
                >
                  <MenuItem value={ALL_GROUPS_KEY}>All rules</MenuItem>
                  <MenuItem value={UNGROUPED_GROUP_KEY}>Ungrouped ({ruleCounts.ungrouped})</MenuItem>
                  {sortGroups(draftGroups).map((group) => (
                    <MenuItem key={group.id} value={group.id}>
                      {group.title} ({ruleCounts.counts.get(group.id) || 0})
                    </MenuItem>
                  ))}
                </Select>
                <Button
                  variant="action"
                  startIcon={<ViewColumnIcon sx={{ fontSize: '14px !important' }} />}
                  onClick={(event) => setColumnChooserAnchor(event.currentTarget)}
                >
                  Columns
                </Button>
                <Button
                  variant="action"
                  startIcon={<AccountTreeOutlinedIcon sx={{ fontSize: '14px !important' }} />}
                  onClick={() => setGroupManagerOpen(true)}
                  disabled={groupActionsDisabled}
                >
                  Manage groups
                </Button>
              </Box>
            </Box>
          </Stack>

          <Box component={AgGridBox} sx={[mappingRulesGridSx, { height: mappingRulesGridHeight }]}>
            <AgGridReact<MappingRuleGridRow>
              rowData={mappingRuleRows}
              columnDefs={mappingRuleColumns}
              defaultColDef={mappingRuleDefaultColDef}
              autoSizeStrategy={{ type: 'fitCellContents', colIds: ['mapping'], skipHeader: true }}
              quickFilterText={ruleSearch}
              headerHeight={38}
              rowHeight={64}
              suppressCellFocus
              suppressRowClickSelection
              onFirstDataRendered={(event) => event.api.autoSizeColumns(['mapping'], true)}
              onRowDataUpdated={(event) => event.api.autoSizeColumns(['mapping'], true)}
              getRowId={(params) => params.data.id}
              onRowClicked={(event: RowClickedEvent<MappingRuleGridRow>) => {
                if (event.data) {
                  openEditRule(event.data.rule);
                }
              }}
              overlayNoRowsTemplate="<span>No mapping rules in this view yet.</span>"
            />
          </Box>
        </Stack>
      ) : null}

      <Popover
        open={columnChooserOpen}
        anchorEl={columnChooserAnchor}
        onClose={() => setColumnChooserAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      >
        <Box sx={{ p: 1.5, minWidth: 240, maxWidth: 320, bgcolor: 'kanap.bg.drawer' }}>
          <Typography sx={{ mb: 1, fontSize: 13, fontWeight: 500, color: 'kanap.text.primary' }}>
            Choose columns
          </Typography>
          <Stack spacing={0.25} sx={{ maxHeight: 300, overflowY: 'auto' }}>
            {MAPPING_RULE_COLUMN_OPTIONS.map((column) => {
              const visible = isRuleColumnVisible(column.id);
              return (
                <FormControlLabel
                  key={column.id}
                  control={(
                    <Checkbox
                      size="small"
                      checked={visible}
                      disabled={!!column.required}
                      onChange={(event) => toggleRuleColumn(column.id, event.target.checked)}
                    />
                  )}
                  label={(
                    <Typography sx={{ fontSize: 13, color: column.required ? 'kanap.text.tertiary' : 'kanap.text.primary' }}>
                      {column.label}
                      {column.required ? (
                        <Box component="span" sx={{ ml: 0.75, color: 'kanap.text.tertiary' }}>
                          required
                        </Box>
                      ) : null}
                    </Typography>
                  )}
                  sx={{
                    m: 0,
                    '& .MuiFormControlLabel-label': {
                      flex: 1,
                    },
                  }}
                />
              );
            })}
          </Stack>
          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={{ mt: 1.25 }}>
            <Button size="small" onClick={resetRuleColumns}>
              Reset
            </Button>
            <Button size="small" variant="contained" onClick={() => setColumnChooserAnchor(null)}>
              Done
            </Button>
          </Stack>
        </Box>
      </Popover>

      <Dialog
        open={groupManagerOpen}
        onClose={() => setGroupManagerOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Manage mapping groups</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5} sx={{ pt: 1 }}>
            <Stack direction="row" justifyContent="flex-end" alignItems="center">
              <Button
                size="small"
                startIcon={<AddIcon />}
                onClick={openCreateGroup}
                disabled={groupActionsDisabled}
              >
                Add group
              </Button>
            </Stack>
            <Paper variant="outlined">
              <List dense disablePadding>
                <ListItem disablePadding>
                  <ListItemButton
                    selected={selectedGroupId === UNGROUPED_GROUP_KEY}
                    onClick={() => {
                      setSelectedGroupId(UNGROUPED_GROUP_KEY);
                      setGroupManagerOpen(false);
                    }}
                  >
                    <ListItemText
                      primary="Ungrouped"
                      secondary={`${ruleCounts.ungrouped} rules`}
                    />
                  </ListItemButton>
                </ListItem>
                {sortGroups(draftGroups).map((group) => (
                  <ListItem
                    key={group.id}
                    disablePadding
                    secondaryAction={isReservedGroup(group) ? (
                      <Typography variant="body2" color="text.secondary">Default</Typography>
                    ) : canManage ? (
                      <Stack direction="row" spacing={0.5}>
                        <IconButton
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            openEditGroup(group);
                          }}
                          disabled={groupActionsDisabled}
                        >
                          <EditIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            deleteGroup(group);
                          }}
                          disabled={groupActionsDisabled}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ) : undefined}
                  >
                    <ListItemButton
                      selected={selectedGroupId === group.id}
                      onClick={() => {
                        setSelectedGroupId(group.id);
                        setGroupManagerOpen(false);
                      }}
                    >
                      <ListItemText
                        primary={group.title}
                        secondary={group.description || `${ruleCounts.counts.get(group.id) || 0} rules`}
                      />
                    </ListItemButton>
                  </ListItem>
                ))}
              </List>
            </Paper>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupManagerOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={groupEditor.open}
        onClose={() => setGroupEditor(createClosedGroupEditor())}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {groupEditor.mode === 'create' ? 'Create mapping group' : 'Edit mapping group'}
        </DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {groupEditor.error ? <Alert severity="error">{groupEditor.error}</Alert> : null}
            <PropertyRow label="Group title" required>
              <TextField
                value={groupEditor.form.title}
                onChange={(event) => setGroupEditor((current) => ({
                  ...current,
                  error: null,
                  form: { ...current.form, title: event.target.value },
                }))}
                placeholder="Business document"
                variant="standard"
                sx={drawerFieldValueSx}
                fullWidth
              />
            </PropertyRow>
            <PropertyRow label="Description">
              <TextField
                value={groupEditor.form.description}
                onChange={(event) => setGroupEditor((current) => ({
                  ...current,
                  error: null,
                  form: { ...current.form, description: event.target.value },
                }))}
                placeholder="Optional context"
                variant="standard"
                multiline
                minRows={3}
                sx={drawerFieldValueSx}
                fullWidth
              />
            </PropertyRow>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setGroupEditor(createClosedGroupEditor())}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={commitGroupEditor}
            disabled={!canManage}
          >
            Apply
          </Button>
        </DialogActions>
      </Dialog>

      <Drawer
        anchor="right"
        open={ruleEditor.open}
        onClose={() => setRuleEditor(createClosedRuleEditor())}
        PaperProps={{ sx: ruleDrawerPaperSx }}
      >
        <Box sx={ruleEditorShellSx}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={ruleEditorHeaderSx}>
            <Box sx={{ minWidth: 0 }}>
              <Typography sx={{ fontSize: 16, fontWeight: 500, lineHeight: 1.3, color: 'kanap.text.primary' }}>
                {ruleEditor.mode === 'create' ? 'Create mapping rule' : 'Edit mapping rule'}
              </Typography>
            </Box>
            <IconButton
              aria-label="Close mapping rule editor"
              onClick={() => setRuleEditor(createClosedRuleEditor())}
              sx={compactIconButtonSx}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Stack>

          <Box sx={ruleEditorBodySx}>
            {ruleEditor.error ? (
              <Box sx={{ px: 2.25, pb: 1 }}>
                <Alert severity="error">{ruleEditor.error}</Alert>
              </Box>
            ) : null}

            <PropertyGroup>
              <PropertyRow label="Rule title" required>
                <TextField
                  value={ruleEditor.form.title}
                  onChange={(event) => setRuleEditor((current) => ({
                    ...current,
                    error: null,
                    form: { ...current.form, title: event.target.value },
                  }))}
                  placeholder="Customer identifier"
                  variant="standard"
                  sx={drawerFieldValueSx}
                  disabled={!canManage || saving}
                  fullWidth
                />
              </PropertyRow>
              <Box sx={ruleMetadataGridSx}>
                <PropertyRow
                  label={(
                    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                      Rule key
                      <Tooltip title="Optional stable technical identifier if another system or export process needs a fixed key.">
                        <InfoOutlinedIcon sx={{ fontSize: 14, color: 'kanap.text.tertiary' }} />
                      </Tooltip>
                    </Box>
                  )}
                >
                  <TextField
                    value={ruleEditor.form.rule_key}
                    onChange={(event) => setRuleEditor((current) => ({
                      ...current,
                      error: null,
                      form: { ...current.form, rule_key: event.target.value },
                    }))}
                    placeholder="customer_id"
                    variant="standard"
                    sx={drawerFieldValueSx}
                    disabled={!canManage || saving}
                    fullWidth
                  />
                </PropertyRow>
                <PropertyRow label="Group">
                  <Select
                    value={ruleEditor.form.group_id}
                    onChange={(event) => setRuleEditor((current) => ({
                      ...current,
                      error: null,
                      form: { ...current.form, group_id: String(event.target.value) },
                    }))}
                    displayEmpty
                    renderValue={(selected) => {
                      const selectedGroupId = String(selected || '');
                      if (!selectedGroupId) return 'Ungrouped';
                      const selectedGroup = draftGroups.find((group) => group.id === selectedGroupId);
                      return selectedGroup?.title || 'Ungrouped';
                    }}
                    variant="standard"
                    sx={drawerSelectSx}
                    disabled={!canManage || saving}
                    fullWidth
                  >
                    <MenuItem value="" sx={drawerMenuItemSx}>Ungrouped</MenuItem>
                    {sortGroups(draftGroups).map((group) => (
                      <MenuItem key={group.id} value={group.id} sx={drawerMenuItemSx}>
                        {group.title}
                      </MenuItem>
                    ))}
                  </Select>
                </PropertyRow>
                <PropertyRow label="Lifecycle">
                  <Select
                    value={ruleEditor.form.lifecycle}
                    onChange={(event) => setRuleEditor((current) => ({
                      ...current,
                      error: null,
                      form: { ...current.form, lifecycle: String(event.target.value) },
                    }))}
                    variant="standard"
                    sx={drawerSelectSx}
                    disabled={!canManage || saving}
                    fullWidth
                  >
                    {MAPPING_LIFECYCLE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </PropertyRow>
                <PropertyRow label="Operation">
                  <Select
                    value={ruleEditor.form.operation_kind_choice}
                    onChange={(event) => setRuleEditor((current) => ({
                      ...current,
                      error: null,
                      form: { ...current.form, operation_kind_choice: String(event.target.value) },
                    }))}
                    variant="standard"
                    sx={drawerSelectSx}
                    disabled={!canManage || saving}
                    fullWidth
                  >
                    {OPERATION_KIND_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                        {option.label}
                      </MenuItem>
                    ))}
                    <MenuItem value={OTHER_OPERATION_KIND} sx={drawerMenuItemSx}>Other</MenuItem>
                  </Select>
                </PropertyRow>
                <PropertyRow label="Applies to leg">
                  <Select
                    value={ruleEditor.form.applies_to_leg_id}
                    onChange={(event) => setRuleEditor((current) => ({
                      ...current,
                      error: null,
                      form: { ...current.form, applies_to_leg_id: String(event.target.value) },
                    }))}
                    displayEmpty
                    renderValue={(selected) => {
                      const selectedLegId = String(selected || '');
                      if (!selectedLegId) return 'All legs';
                      const selectedLeg = legs.find((leg) => leg.id === selectedLegId);
                      return selectedLeg ? legLabel(selectedLeg) : 'All legs';
                    }}
                    variant="standard"
                    sx={drawerSelectSx}
                    disabled={!canManage || saving}
                    fullWidth
                  >
                    <MenuItem value="" sx={drawerMenuItemSx}>All legs</MenuItem>
                    {legs.map((leg) => (
                      <MenuItem key={leg.id} value={leg.id} sx={drawerMenuItemSx}>
                        {legLabel(leg)}
                      </MenuItem>
                    ))}
                  </Select>
                </PropertyRow>
                <PropertyRow label="Environments">
                  <Select
                    multiple
                    displayEmpty
                    value={filterEnvironmentScope(ruleEditor.form.environment_scope, environmentOptions)}
                    onChange={(event) => {
                      const value = event.target.value;
                      const nextValue = Array.isArray(value) ? value.map(String) : String(value).split(',');
                      setRuleEditor((current) => ({
                        ...current,
                        error: null,
                        form: { ...current.form, environment_scope: nextValue },
                      }));
                    }}
                    renderValue={(selected) => {
                      const values = selected as string[];
                      if (environmentOptions.length === 0) {
                        return <Box component="span" sx={{ color: 'kanap.text.tertiary' }}>No environments declared</Box>;
                      }
                      if (values.length === 0) {
                        return 'All declared environments';
                      }
                      return values.map((value) => formatEnvironment(value)).join(', ');
                    }}
                    variant="standard"
                    sx={drawerSelectSx}
                    disabled={!canManage || saving || environmentOptions.length === 0}
                    fullWidth
                  >
                    {environmentOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value} sx={drawerMenuItemSx}>
                        <Checkbox
                          size="small"
                          checked={ruleEditor.form.environment_scope.includes(option.value)}
                          sx={{ p: 0, mr: 1 }}
                        />
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </PropertyRow>
                {ruleEditor.form.operation_kind_choice === OTHER_OPERATION_KIND ? (
                  <PropertyRow label="Other operation">
                    <TextField
                      value={ruleEditor.form.operation_kind_other}
                      onChange={(event) => setRuleEditor((current) => ({
                        ...current,
                        error: null,
                        form: { ...current.form, operation_kind_other: event.target.value },
                      }))}
                      placeholder="Custom operation"
                      variant="standard"
                      sx={drawerFieldValueSx}
                      disabled={!canManage || saving}
                      fullWidth
                    />
                  </PropertyRow>
                ) : null}
              </Box>
            </PropertyGroup>

            <PropertyGroup>
              <Box sx={mappingFieldsGridSx}>
                <Stack spacing={1.25}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>
                    Source fields
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    onClick={() => addRuleBindingRow('source_bindings')}
                    disabled={!canManage || saving}
                  >
                    Add source
                  </Button>
                </Stack>
                <Box sx={bindingSurfaceSx}>
                  <Stack spacing={1}>
                    {ruleEditor.form.source_bindings.map((binding, index) => (
                      <Box key={binding.id} sx={bindingRowGridSx}>
                        <TextField
                          value={binding.path}
                          onChange={(event) => updateRuleBindingRow('source_bindings', binding.id, { path: event.target.value })}
                          placeholder={index === 0 ? 'origin.customerId' : 'Source path'}
                          variant="standard"
                          inputProps={{ 'aria-label': `Source ${index + 1}` }}
                          sx={[drawerFieldValueSx, { gridColumn: { xs: '1 / -1', sm: 'auto' } }]}
                          disabled={!canManage || saving}
                          fullWidth
                        />
                        <Autocomplete
                          freeSolo
                          options={BINDING_TYPE_OPTIONS}
                          value={binding.data_type}
                          onChange={(_, value) => updateRuleBindingRow('source_bindings', binding.id, { data_type: value || '' })}
                          onInputChange={(_, value) => updateRuleBindingRow('source_bindings', binding.id, { data_type: value || '' })}
                          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                          sx={{ minWidth: 0, gridColumn: { xs: '1 / 2', sm: 'auto' } }}
                          disabled={!canManage || saving}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              placeholder="Type"
                              variant="standard"
                              sx={drawerFieldValueSx}
                            />
                          )}
                        />
                        <IconButton
                          aria-label={`Remove source ${index + 1}`}
                          onClick={() => removeRuleBindingRow('source_bindings', binding.id)}
                          disabled={!canManage || saving}
                          sx={compactIconButtonSx}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Stack>

              <Stack spacing={1.25}>
                <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
                  <Typography sx={{ fontSize: 12, fontWeight: 500, color: 'kanap.text.tertiary' }}>
                    Target fields
                  </Typography>
                  <Button
                    size="small"
                    variant="text"
                    startIcon={<AddIcon />}
                    onClick={() => addRuleBindingRow('target_bindings')}
                    disabled={!canManage || saving}
                  >
                    Add target
                  </Button>
                </Stack>
                <Box sx={bindingSurfaceSx}>
                  <Stack spacing={1}>
                    {ruleEditor.form.target_bindings.map((binding, index) => (
                      <Box key={binding.id} sx={bindingRowGridSx}>
                        <TextField
                          value={binding.path}
                          onChange={(event) => updateRuleBindingRow('target_bindings', binding.id, { path: event.target.value })}
                          placeholder={index === 0 ? 'destination.customerId' : 'Target path'}
                          variant="standard"
                          inputProps={{ 'aria-label': `Target ${index + 1}` }}
                          sx={[drawerFieldValueSx, { gridColumn: { xs: '1 / -1', sm: 'auto' } }]}
                          disabled={!canManage || saving}
                          fullWidth
                        />
                        <Autocomplete
                          freeSolo
                          options={BINDING_TYPE_OPTIONS}
                          value={binding.data_type}
                          onChange={(_, value) => updateRuleBindingRow('target_bindings', binding.id, { data_type: value || '' })}
                          onInputChange={(_, value) => updateRuleBindingRow('target_bindings', binding.id, { data_type: value || '' })}
                          ListboxProps={{ sx: drawerAutocompleteListboxSx }}
                          sx={{ minWidth: 0, gridColumn: { xs: '1 / 2', sm: 'auto' } }}
                          disabled={!canManage || saving}
                          renderInput={(params) => (
                            <TextField
                              {...params}
                              placeholder="Type"
                              variant="standard"
                              sx={drawerFieldValueSx}
                            />
                          )}
                        />
                        <IconButton
                          aria-label={`Remove target ${index + 1}`}
                          onClick={() => removeRuleBindingRow('target_bindings', binding.id)}
                          disabled={!canManage || saving}
                          sx={compactIconButtonSx}
                        >
                          <DeleteIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    ))}
                  </Stack>
                </Box>
              </Stack>
              </Box>
            </PropertyGroup>

            <PropertyGroup>
              <PropertyRow label="Condition" valueSx={{ minHeight: 0 }}>
                <TextField
                  value={ruleEditor.form.condition_text}
                  onChange={(event) => setRuleEditor((current) => ({
                    ...current,
                    error: null,
                    form: { ...current.form, condition_text: event.target.value },
                  }))}
                  placeholder="order.amount > 0"
                  variant="standard"
                  multiline
                  minRows={2}
                  sx={[longFormSurfaceFieldSx, mappingConditionFieldSx]}
                  disabled={!canManage || saving}
                  fullWidth
                />
              </PropertyRow>
              <PropertyRow label="Business rule" valueSx={{ minHeight: 0 }}>
                <TextField
                  value={ruleEditor.form.business_rule_text}
                  onChange={(event) => setRuleEditor((current) => ({
                    ...current,
                    error: null,
                    form: { ...current.form, business_rule_text: event.target.value },
                  }))}
                  placeholder="Business validation or transformation rule"
                  variant="standard"
                  multiline
                  minRows={2}
                  sx={[longFormSurfaceFieldSx, mappingComposerFieldSx]}
                  disabled={!canManage || saving}
                  fullWidth
                />
              </PropertyRow>
              <PropertyRow label="Remarks" valueSx={{ minHeight: 0 }}>
                <TextField
                  value={ruleEditor.form.remarks}
                  onChange={(event) => setRuleEditor((current) => ({
                    ...current,
                    error: null,
                    form: { ...current.form, remarks: event.target.value },
                  }))}
                  placeholder="Additional notes"
                  variant="standard"
                  multiline
                  minRows={2}
                  sx={[longFormSurfaceFieldSx, mappingComposerFieldSx]}
                  disabled={!canManage || saving}
                  fullWidth
                />
              </PropertyRow>
            </PropertyGroup>
          </Box>

          <Stack direction="row" spacing={1} justifyContent="flex-end" sx={ruleEditorFooterSx}>
            <Button onClick={() => setRuleEditor(createClosedRuleEditor())}>
              Cancel
            </Button>
            <Button
              variant="contained"
              onClick={() => { void saveRuleEditor(); }}
              disabled={!canManage || saving}
            >
              Save rule
            </Button>
          </Stack>
        </Box>
      </Drawer>

      <KanapDialog
        open={!!pendingDeleteGroup}
        title="Delete mapping group"
        onClose={() => setPendingDeleteGroup(null)}
        saveLabel="Delete"
        onSave={confirmDeleteGroup}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          Rules assigned to this group will move to ungrouped.
        </Typography>
      </KanapDialog>

      <KanapDialog
        open={!!pendingDeleteRule}
        title="Delete mapping rule"
        onClose={() => setPendingDeleteRule(null)}
        saveLabel="Delete"
        onSave={confirmDeleteRule}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {pendingDeleteRule ? `Delete "${pendingDeleteRule.title}" from this mapping set.` : 'Delete this mapping rule.'}
        </Typography>
      </KanapDialog>
    </Stack>
  );
});
