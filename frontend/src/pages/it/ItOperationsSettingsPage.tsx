import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  IconButton,
  FormControlLabel,
  Paper,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RequiredMark } from '../../components/design';
import { SettingsPage, SettingsSection, SettingsControls, SettingsGroup } from '../../components/settings';
import { EnumEditor, HostingTypeEditor, AssetKindEditor, ServerRoleEditor, EntityEditor } from '../../components/settings';
import type {
  HostingTypeItem,
  AssetKindItem,
  ServerRoleItem,
  EntityItem,
} from '../../components/settings';
import useItOpsSettings from '../../hooks/useItOpsSettings';
import { useVirtualRows } from '../../hooks/useVirtualRows';
import { useLocationOptions, type LocationOption } from '../../hooks/useLocationOptions';
import { useCatalogRemoval } from '../../components/settings/useCatalogRemoval';
import { useEditorRows } from '../../components/settings/useEditorRows';
import { useCatalogTranslations } from '../../components/settings/CatalogTranslationsDialog';
import TranslateIcon from '@mui/icons-material/Translate';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { catalogListIssues } from '../../components/settings/catalogValidation';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { connectionTypeCategoryLabel } from '../../utils/itOpsCatalogDefaults';
import { useCatalogLocale } from '../../hooks/useLocalizedTaskTypes';
import api from '../../api';
import {
  AdminZoneOption,
  ConnectionTypeOption,
  DomainOption,
  ItOpsEnumOption,
  ItOpsSettings,
  SubnetOption,
  updateItOpsSettings,
} from '../../services/itOpsSettings';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../auth/AuthContext';
import ForbiddenPage from '../ForbiddenPage';
import WorkspaceTabs from '../portfolio/workspace/WorkspaceTabs';
import ClassificationCatalogSettings from './components/ClassificationCatalogSettings';
import DomainTrustsDialog from './components/DomainTrustsDialog';
import { NetboxSyncPanel } from './NetboxSyncPage';

// ============================================================================
// Utility Functions
// ============================================================================

const makeLocalId = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 9)}-${Date.now().toString(36)}`;

// Returns same reference if no changes needed to avoid triggering re-renders
const withLocalIds = <T extends { localId?: string }>(list: T[], prefix: string): (T & { localId: string })[] => {
  const allHaveIds = list.every((row) => row.localId);
  if (allHaveIds) return list as (T & { localId: string })[];
  return list.map((row) => (row.localId ? row : { ...(row as any), localId: makeLocalId(prefix) }));
};

const stripLocalIds = <T extends { localId?: string }>(list: T[]): Omit<T, 'localId'>[] =>
  list.map(({ localId, ...rest }) => rest as Omit<T, 'localId'>);

const sortEnum = (list: ItOpsEnumOption[]) =>
  [...list].sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }));

/** Administration zones stay in the order the user chose: the first zone is the most sensitive. Other lists are alphabetical. */
const orderOf = (id: EnumListId, list: ItOpsEnumOption[]) => (id === 'adminZones' ? [...list] : sortEnum(list));

const sortConnectionTypes = (list: ConnectionTypeOption[]) =>
  [...list].sort((a, b) => {
    const catA = (a.category || '').toLowerCase();
    const catB = (b.category || '').toLowerCase();
    if (catA !== catB) return catA.localeCompare(catB);
    return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' });
  });

const sortSubnets = (list: SubnetOption[]) =>
  [...list].sort((a, b) => {
    const locCmp = (a.location_id || '').localeCompare(b.location_id || '');
    if (locCmp !== 0) return locCmp;
    return (a.cidr || '').localeCompare(b.cidr || '');
  });

const sortDomains = (list: DomainOption[]) =>
  [...list].sort((a, b) => {
    if (a.system && !b.system) return -1;
    if (!a.system && b.system) return 1;
    return (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' });
  });

const listsEqual = (a: ItOpsEnumOption[], b: ItOpsEnumOption[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.code !== right.code || left.label !== right.label) return false;
    if (!!left.deprecated !== !!right.deprecated) return false;
    if ((left.category || undefined) !== (right.category || undefined)) return false;
    if (((left as any).graph_tier || undefined) !== ((right as any).graph_tier || undefined)) return false;
    if (((left as any).typicalPorts || undefined) !== ((right as any).typicalPorts || undefined)) return false;
    if (!!(left as any).is_physical !== !!(right as any).is_physical) return false;
    if (JSON.stringify((left as any).translations ?? null) !== JSON.stringify((right as any).translations ?? null)) return false;
    for (const key of ['admin_group', 'description']) {
      if (((left as any)[key] || undefined) !== ((right as any)[key] || undefined)) return false;
    }
  }
  return true;
};

// ============================================================================
// Type Definitions
// ============================================================================

type EnumListId =
  | 'adminZones'
  | 'applicationCategories'
  | 'dataClasses'
  | 'networkSegments'
  | 'entities'
  | 'serverKinds'
  | 'serverProviders'
  | 'serverRoles'
  | 'hostingTypes'
  | 'lifecycleStates'
  | 'interfaceProtocols'
  | 'interfaceDataCategories'
  | 'interfaceTriggerTypes'
  | 'interfacePatterns'
  | 'interfaceFormats'
  | 'interfaceAuthModes'
  | 'ipAddressTypes'
  | 'accessMethods'
  | 'incidentCategories'
  | 'technologyFamilies';

type ListId = EnumListId | 'connectionTypes' | 'subnets' | 'domains';
type GroupId = 'locations' | 'serversConnections' | 'appsInterfaces' | 'incidents';

// ============================================================================
// Constants
// ============================================================================

const enumListIds: EnumListId[] = [
  'adminZones', 'applicationCategories', 'dataClasses', 'networkSegments', 'entities', 'serverKinds',
  'serverProviders', 'serverRoles', 'hostingTypes', 'lifecycleStates', 'interfaceProtocols',
  'interfaceDataCategories', 'interfaceTriggerTypes', 'interfacePatterns', 'interfaceFormats',
  'interfaceAuthModes', 'ipAddressTypes', 'accessMethods', 'incidentCategories', 'technologyFamilies',
];

const listGroupIds: GroupId[] = ['locations', 'serversConnections', 'appsInterfaces', 'incidents'];

// Titles, descriptions and usage hints live in it:pages.settings.lists.<id>.
type EnumSectionConfig = {
  id: EnumListId;
  group: GroupId;
  lockedCodes?: string[];
  kind?: 'enum' | 'hosting' | 'serverKind' | 'serverRole' | 'entity' | 'adminZone';
};

/** Name-field example for each catalog. Administration zones, connections, domains and subnets have their own. */
const nameExampleKey: Partial<Record<EnumListId, string>> = {
  accessMethods: 'accessMethodName',
  applicationCategories: 'applicationCategoryName',
  entities: 'entityName',
  hostingTypes: 'hostingTypeName',
  incidentCategories: 'incidentCategoryName',
  interfaceAuthModes: 'interfaceAuthModeName',
  interfaceDataCategories: 'interfaceDataCategoryName',
  interfaceFormats: 'interfaceFormatName',
  interfacePatterns: 'interfacePatternName',
  interfaceProtocols: 'interfaceProtocolName',
  interfaceTriggerTypes: 'interfaceTriggerTypeName',
  ipAddressTypes: 'ipAddressTypeName',
  lifecycleStates: 'lifecycleStateName',
  networkSegments: 'networkSegmentName',
  serverKinds: 'assetKindName',
  serverProviders: 'serverProviderName',
  serverRoles: 'serverRoleName',
  technologyFamilies: 'technologyFamilyName',
};

const enumSections: EnumSectionConfig[] = [
  { id: 'adminZones', group: 'serversConnections', kind: 'adminZone' },
  { id: 'accessMethods', group: 'appsInterfaces' },
  { id: 'applicationCategories', group: 'appsInterfaces' },
  { id: 'networkSegments', group: 'serversConnections' },
  { id: 'entities', group: 'serversConnections', kind: 'entity' },
  { id: 'ipAddressTypes', group: 'serversConnections' },
  { id: 'serverKinds', group: 'serversConnections', kind: 'serverKind' },
  { id: 'serverRoles', group: 'serversConnections', kind: 'serverRole' },
  { id: 'technologyFamilies', group: 'serversConnections' },
  { id: 'hostingTypes', group: 'locations', kind: 'hosting' },
  { id: 'serverProviders', group: 'locations' },
  { id: 'lifecycleStates', group: 'appsInterfaces', lockedCodes: ['proposed', 'active', 'deprecated', 'retired'] },
  { id: 'interfaceProtocols', group: 'appsInterfaces' },
  { id: 'interfaceDataCategories', group: 'appsInterfaces' },
  { id: 'interfaceTriggerTypes', group: 'appsInterfaces' },
  { id: 'interfacePatterns', group: 'appsInterfaces' },
  { id: 'interfaceFormats', group: 'appsInterfaces' },
  { id: 'interfaceAuthModes', group: 'appsInterfaces' },
  { id: 'incidentCategories', group: 'incidents' },
];

// ============================================================================
// Specialized Editors
// ============================================================================

const listTitleKey = (id: ListId) => `pages.settings.lists.${id}.title`;
const listDescriptionKey = (id: ListId) => `pages.settings.lists.${id}.description`;
const listUsageKey = (id: ListId) => `pages.settings.lists.${id}.usage`;
/** Lists whose purpose the rows do not show: their description goes in a tooltip beside the title. */
const HINTED_LISTS: ReadonlySet<ListId> = new Set<ListId>([
  'adminZones', 'domains', 'entities', 'hostingTypes', 'lifecycleStates', 'serverKinds', 'serverRoles', 'technologyFamilies',
]);

function TranslateButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation('common');
  return <IconButton size="small" aria-label={`${t('enumEditor.translate')} ${label}`} sx={{ color: 'kanap.text.secondary', mr: 0.5 }} onClick={onClick}><TranslateIcon sx={{ fontSize: 17 }} /></IconButton>;
}

function IssueText({ issue }: { issue?: string }) {
  const { t } = useTranslation('common');
  if (!issue || issue === 'nameRequired') return null;
  return <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25 }}>{t(`enumEditor.${issue}`)}</Typography>;
}

interface ConnectionTypesEditorProps {
  items: ConnectionTypeOption[];
  onChange: (items: ConnectionTypeOption[]) => void;
  readOnly?: boolean;
}

const ConnectionTypesEditor = React.memo(function ConnectionTypesEditor({
  items,
  onChange,
  readOnly = false,
}: ConnectionTypesEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'ct'), [items]);
  const [localItems, changeRows] = useEditorRows(itemsWithIds, onChange);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 60 });

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<ConnectionTypeOption>) => {
      if (readOnly) return;
      changeRows((prev) => prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row)));
    },
    [changeRows, readOnly]
  );

  const handleRemove = React.useCallback(
    (localId: string) => {
      changeRows((prev) => prev.filter((row: any) => row.localId !== localId));
    },
    [changeRows]
  );

  const { t } = useTranslation(['it', 'common']);
  // A shipped category is shown in the user's language until it is retyped; typing replaces the stored text.
  const catalogLocale = useCatalogLocale();
  const removal = useCatalogRemoval('connectionTypes');
  const translations = useCatalogTranslations();
  const issues = React.useMemo(() => catalogListIssues(localItems), [localItems]);
  const columnCount = readOnly ? 4 : 5;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '22%' }}>{t('common:enumEditor.category')}</TableCell>
              <TableCell sx={{ width: '28%' }}>{t('common:enumEditor.name')}<RequiredMark /></TableCell>
              <TableCell sx={{ width: '25%' }}>{t('pages.settings.columns.typicalPorts')}</TableCell>
              <TableCell sx={{ width: '12%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              {!readOnly && <TableCell align="right" sx={{ width: '13%' }}>{t('common:labels.actions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.connectionTypes')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell><TextField value={connectionTypeCategoryLabel(item.category || '', catalogLocale)} onChange={(e) => handleUpdate(item.localId, { category: e.target.value })} size="small" fullWidth placeholder={t('common:enumEditor.category')} disabled={readOnly} /></TableCell>
                <TableCell sx={{ verticalAlign: 'top' }}><TextField value={item.label} onChange={(e) => handleUpdate(item.localId, { label: e.target.value })} size="small" fullWidth required placeholder={t('pages.settings.placeholders.connectionName')} disabled={readOnly} inputProps={{ 'aria-label': t('common:enumEditor.name') }} /><IssueText issue={issues.get(localItems.indexOf(item))} /></TableCell>
                <TableCell><TextField value={item.typicalPorts || ''} onChange={(e) => handleUpdate(item.localId, { typicalPorts: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.typicalPorts')} disabled={readOnly} /></TableCell>
                <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={readOnly} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
                {!readOnly && (
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
                    <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
                  </TableCell>
                )}
              </TableRow>
            ))}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {removal.dialog}
      {translations.dialog}
    </Paper>
  );
});

interface SubnetsEditorProps {
  items: SubnetOption[];
  networkZones: ItOpsEnumOption[];
  locations: LocationOption[];
  onChange: (items: SubnetOption[]) => void;
  readOnly?: boolean;
}

const SubnetsEditor = React.memo(function SubnetsEditor({
  items,
  networkZones,
  locations,
  onChange,
  readOnly = false,
}: SubnetsEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'subnet'), [items]);
  const [localItems, changeRows] = useEditorRows(itemsWithIds, onChange);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 60 });

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<SubnetOption>) => {
      if (readOnly) return;
      changeRows((prev) => prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row)));
    },
    [changeRows, readOnly]
  );

  const handleRemove = React.useCallback(
    (localId: string) => {
      changeRows((prev) => prev.filter((row: any) => row.localId !== localId));
    },
    [changeRows]
  );

  const { t } = useTranslation(['it', 'common']);
  const removal = useCatalogRemoval('subnets');
  const columnCount = readOnly ? 6 : 7;

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '18%' }}>{t('pages.settings.columns.location')}</TableCell>
              <TableCell sx={{ width: '18%' }}>{t('pages.settings.columns.cidr')}</TableCell>
              <TableCell sx={{ width: '10%' }}>{t('pages.settings.columns.vlan')}</TableCell>
              <TableCell sx={{ width: '16%' }}>{t('pages.settings.columns.networkZone')}</TableCell>
              <TableCell sx={{ width: '20%' }}>{t('pages.settings.columns.description')}</TableCell>
              <TableCell sx={{ width: '8%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              {!readOnly && <TableCell align="right" sx={{ width: '10%' }}>{t('common:labels.actions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.subnets')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell>
                  <TextField select value={item.location_id || ''} onChange={(e) => handleUpdate(item.localId, { location_id: e.target.value })} size="small" fullWidth disabled={readOnly} SelectProps={{ native: true }}>
                    <option value="">{t('pages.settings.placeholders.select')}</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.location_reference}{loc.name ? ` · ${loc.name}` : ''}
                      </option>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell><TextField value={item.cidr || ''} onChange={(e) => handleUpdate(item.localId, { cidr: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.cidr')} disabled={readOnly} /></TableCell>
                <TableCell>
                  <TextField value={item.vlan_number ?? ''} onChange={(e) => handleUpdate(item.localId, { vlan_number: e.target.value.trim() === '' ? undefined : parseInt(e.target.value, 10) || undefined })} size="small" fullWidth placeholder="1-4094" type="number" disabled={readOnly} inputProps={{ min: 1, max: 4094 }} sx={{ '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 }, '& input[type=number]': { MozAppearance: 'textfield' } }} />
                </TableCell>
                <TableCell>
                  <TextField select value={item.network_zone || ''} onChange={(e) => handleUpdate(item.localId, { network_zone: e.target.value })} size="small" fullWidth disabled={readOnly} SelectProps={{ native: true }}>
                    <option value="">{t('pages.settings.placeholders.select')}</option>
                    {networkZones.filter((zone) => !zone.deprecated || zone.code === item.network_zone).map((zone) => <option key={zone.code} value={zone.code}>{zone.label}</option>)}
                  </TextField>
                </TableCell>
                <TableCell><TextField value={item.description || ''} onChange={(e) => handleUpdate(item.localId, { description: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.columns.description')} disabled={readOnly} /></TableCell>
                <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={readOnly} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.cidr}` }} /></TableCell>
                {!readOnly && <TableCell align="right"><Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.cidr || '', key: item.location_id && item.cidr ? { location_id: item.location_id, cidr: item.cidr } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button></TableCell>}
              </TableRow>
            ))}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {removal.dialog}
    </Paper>
  );
});

/** A number field without the browser's arrows: the count is typed. */
const countFieldSx = {
  '& input[type=number]': { appearance: 'textfield', MozAppearance: 'textfield' },
  '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 },
} as const;

/** A column header that says, on hover, where to find its value. */
function HintedHeader({ label, hint }: { label: string; hint: string }) {
  return (
    <Tooltip title={hint}>
      <span>{label}</span>
    </Tooltip>
  );
}

interface DomainsEditorProps {
  items: DomainOption[];
  onChange: (items: DomainOption[]) => void;
  readOnly?: boolean;
}

export const DomainsEditor = React.memo(function DomainsEditor({ items, onChange, readOnly = false }: DomainsEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'domain'), [items]);
  const [localItems, changeRows] = useEditorRows(itemsWithIds, onChange);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 52 });

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<DomainOption>) => {
      if (readOnly) return;
      changeRows((prev) => prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row)));
    },
    [changeRows, readOnly]
  );

  const handleRemove = React.useCallback(
    (localId: string) => {
      changeRows((prev) => prev.filter((row: any) => row.localId !== localId));
    },
    [changeRows]
  );

  // The DNS suffix follows the name until it is edited by hand; the code is generated by the server.
  const handleLabelChange = React.useCallback(
    (localId: string, newLabel: string, currentDnsSuffix: string, prevLabel: string) => {
      const updates: Partial<DomainOption> = { label: newLabel };
      const autoSuffixFromPrev = (prevLabel || '').toLowerCase().replace(/\s+/g, '');
      const autoSuffixFromNew = newLabel.toLowerCase().replace(/\s+/g, '');
      if (!currentDnsSuffix || currentDnsSuffix === autoSuffixFromPrev) updates.dns_suffix = autoSuffixFromNew;
      handleUpdate(localId, updates);
    },
    [handleUpdate]
  );
  const { t } = useTranslation(['it', 'common']);
  const removal = useCatalogRemoval('domains');
  const translations = useCatalogTranslations();
  const [trustsOf, setTrustsOf] = React.useState<(DomainOption & { localId: string }) | null>(null);
  const countValue = (value: string) => (value.trim() === '' ? undefined : Math.min(MAX_COUNT, Math.max(0, parseInt(value, 10) || 0)));
  const issues = React.useMemo(() => catalogListIssues(localItems, { skipCodes: new Set(localItems.filter((row: any) => row.system).map((row: any) => String(row.code).toLowerCase())) }), [localItems]);
  const columnCount = readOnly ? 7 : 8;
  const trustLabel = (item: DomainOption) => {
    const count = item.trusts?.length ?? 0;
    return count ? t('pages.settings.trusts.count', { count }) : t('pages.settings.trusts.none');
  };

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '16%' }}>{t('common:enumEditor.name')}<RequiredMark /></TableCell>
              <TableCell sx={{ width: '15%' }}>{t('pages.settings.columns.dnsSuffix')}</TableCell>
              <TableCell sx={{ width: '14%' }}><HintedHeader label={t('pages.settings.columns.forest')} hint={t('pages.settings.hints.forest')} /></TableCell>
              <TableCell sx={{ width: '11%', minWidth: 110 }}><HintedHeader label={t('pages.settings.columns.accountCount')} hint={t('pages.settings.hints.accountCount')} /></TableCell>
              <TableCell sx={{ width: '11%', minWidth: 110 }}><HintedHeader label={t('pages.settings.columns.computerCount')} hint={t('pages.settings.hints.computerCount')} /></TableCell>
              <TableCell sx={{ width: '10%' }}>{t('pages.settings.columns.trusts')}</TableCell>
              <TableCell sx={{ width: '8%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              {!readOnly && <TableCell align="right" sx={{ width: '15%' }}>{t('common:labels.actions')}</TableCell>}
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={columnCount}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.domains')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => {
              const isSystem = !!item.system;
              const locked = readOnly || isSystem;
              return (
                <TableRow key={item.localId}>
                  <TableCell sx={{ verticalAlign: 'top' }}><TextField value={item.label || ''} onChange={(e) => handleLabelChange(item.localId, e.target.value, item.dns_suffix || '', item.label || '')} size="small" fullWidth required placeholder={t('pages.settings.placeholders.domainName')} disabled={locked} InputProps={{ readOnly: locked }} inputProps={{ 'aria-label': t('common:enumEditor.name') }} /><IssueText issue={issues.get(localItems.indexOf(item))} /></TableCell>
                  <TableCell><TextField value={item.dns_suffix || ''} onChange={(e) => handleUpdate(item.localId, { dns_suffix: e.target.value.toLowerCase() })} size="small" fullWidth placeholder={t('pages.settings.placeholders.dnsSuffix')} disabled={locked} InputProps={{ readOnly: locked }} /></TableCell>
                  <TableCell>{!isSystem && <TextField value={item.forest || ''} onChange={(e) => handleUpdate(item.localId, { forest: e.target.value || undefined })} size="small" fullWidth placeholder={t('pages.settings.placeholders.forest')} disabled={readOnly} inputProps={{ maxLength: 200, 'aria-label': `${t('pages.settings.columns.forest')} ${item.label}` }} />}</TableCell>
                  <TableCell>{!isSystem && <TextField value={item.account_count ?? ''} onChange={(e) => handleUpdate(item.localId, { account_count: countValue(e.target.value) })} size="small" fullWidth type="number" placeholder={t('pages.settings.placeholders.accountCount')} disabled={readOnly} sx={countFieldSx} inputProps={{ min: 0, max: MAX_COUNT, 'aria-label': `${t('pages.settings.columns.accountCount')} ${item.label}` }} />}</TableCell>
                  <TableCell>{!isSystem && <TextField value={item.machine_count ?? ''} onChange={(e) => handleUpdate(item.localId, { machine_count: countValue(e.target.value) })} size="small" fullWidth type="number" placeholder={t('pages.settings.placeholders.machineCount')} disabled={readOnly} sx={countFieldSx} inputProps={{ min: 0, max: MAX_COUNT, 'aria-label': `${t('pages.settings.columns.computerCount')} ${item.label}` }} />}</TableCell>
                  <TableCell>{!isSystem && item.code && (readOnly
                    ? <Typography variant="body2">{trustLabel(item)}</Typography>
                    : <Button size="small" onClick={() => setTrustsOf(item)} aria-label={`${t('pages.settings.columns.trusts')} ${item.label}`}>{trustLabel(item)}</Button>)}</TableCell>
                  <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={locked} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
                  {!readOnly && (
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {isSystem ? (
                        <Typography variant="caption" color="text.secondary">{t('common:enumEditor.locked')}</Typography>
                      ) : (<>
                        {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
                        <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
                      </>)}
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={columnCount} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {removal.dialog}
      {translations.dialog}
      <DomainTrustsDialog domain={trustsOf} domains={localItems} onClose={() => setTrustsOf(null)} onSave={(trusts) => trustsOf && handleUpdate(trustsOf.localId, { trusts })} />
    </Paper>
  );
});

/** The server's limits (`it-ops-settings.service.ts`): a longer value would be refused. */
const ADMIN_ZONE_LIMITS = { admin_group: 200, description: 2000 } as const;
const MAX_COUNT = 100_000_000;

interface AdminZonesEditorProps {
  items: AdminZoneOption[];
  onChange: (items: AdminZoneOption[]) => void;
  readOnly?: boolean;
}

/** Move the row `activeId` to the place of `overId`. Same array when nothing moves. */
export function reorderById<T extends { localId?: string }>(items: T[], activeId: string, overId: string): T[] {
  if (activeId === overId) return items;
  const oldIndex = items.findIndex((row) => row.localId === activeId);
  const newIndex = items.findIndex((row) => row.localId === overId);
  if (oldIndex < 0 || newIndex < 0) return items;
  return arrayMove(items, oldIndex, newIndex);
}

function SortableAdminZoneRow({ id, children }: { id: string; children: React.ReactNode }) {
  const { t } = useTranslation(['it', 'common']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  return (
    <TableRow
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
    >
      <TableCell sx={{ width: '4%', verticalAlign: 'top', px: 0.5 }}>
        <Box
          component="span"
          aria-label={t('pages.settings.lists.adminZones.dragToReorder')}
          sx={{ display: 'inline-flex', cursor: 'grab', touchAction: 'none', color: 'kanap.text.secondary', mt: 0.75 }}
          {...attributes}
          {...listeners}
        >
          <DragIndicatorIcon sx={{ fontSize: 18 }} />
        </Box>
      </TableCell>
      {children}
    </TableRow>
  );
}

/** Administration zones: name, administrator group and description per zone. */
export const AdminZonesEditor = React.memo(function AdminZonesEditor({ items, onChange, readOnly = false }: AdminZonesEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'adminZones'), [items]);
  const [localItems, changeRows] = useEditorRows(itemsWithIds, onChange);

  const handleUpdate = React.useCallback((localId: string, patch: Partial<AdminZoneOption>) => {
    if (readOnly) return;
    changeRows((prev) => prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row)));
  }, [changeRows, readOnly]);

  const handleRemove = React.useCallback((localId: string) => {
    changeRows((prev) => prev.filter((row: any) => row.localId !== localId));
  }, [changeRows]);

  const { t } = useTranslation(['it', 'common']);
  const removal = useCatalogRemoval('adminZones');
  const translations = useCatalogTranslations();
  const issues = React.useMemo(() => catalogListIssues(localItems), [localItems]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    if (readOnly) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    changeRows((prev) => reorderById(prev, String(active.id), String(over.id)));
  }, [changeRows, readOnly]);
  const text = (item: any, key: 'admin_group' | 'description', placeholder: string) => (
    <TextField value={item[key] || ''} onChange={(e) => handleUpdate(item.localId, { [key]: e.target.value || undefined })} size="small" fullWidth placeholder={placeholder} disabled={readOnly} inputProps={{ maxLength: ADMIN_ZONE_LIMITS[key], 'aria-label': `${t(`pages.settings.columns.${key === 'admin_group' ? 'adminGroup' : 'description'}`)} ${item.label}` }} />
  );
  const columnCount = readOnly ? 5 : 6;
  const zoneRows = localItems.map((item: any) => {
    const cells = (
      <>
        <TableCell sx={{ verticalAlign: 'top' }}>
          <TextField value={item.label} onChange={(e) => handleUpdate(item.localId, { label: e.target.value })} size="small" fullWidth required placeholder={t('pages.settings.placeholders.adminZoneName')} disabled={readOnly} inputProps={{ maxLength: 200, 'aria-label': t('common:enumEditor.name') }} />
          <IssueText issue={issues.get(localItems.indexOf(item))} />
        </TableCell>
        <TableCell>{text(item, 'admin_group', t('pages.settings.placeholders.adminGroup'))}</TableCell>
        <TableCell>{text(item, 'description', t('pages.settings.placeholders.adminZoneDescription'))}</TableCell>
        <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={readOnly} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
        {!readOnly && (
          <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
            {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
            <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
          </TableCell>
        )}
      </>
    );
    return readOnly
      ? <TableRow key={item.localId}>{cells}</TableRow>
      : <SortableAdminZoneRow key={item.localId} id={item.localId}>{cells}</SortableAdminZoneRow>;
  });
  const zoneBody = (
    <>
      {localItems.length === 0 && (
        <TableRow>
          <TableCell colSpan={columnCount}>
            <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.adminZones')}</Typography>
          </TableCell>
        </TableRow>
      )}
      {zoneRows}
    </>
  );

  const zoneTable = (
    <Table size="small" sx={{ tableLayout: 'fixed' }}>
      <TableHead>
        <TableRow>
          {!readOnly && <TableCell sx={{ width: '4%' }} />}
          <TableCell sx={{ width: '22%' }}>{t('common:enumEditor.name')}<RequiredMark /></TableCell>
          <TableCell sx={{ width: '20%' }}>{t('pages.settings.columns.adminGroup')}</TableCell>
          <TableCell sx={{ width: '28%' }}>{t('pages.settings.columns.description')}</TableCell>
          <TableCell sx={{ width: '8%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
          {!readOnly && <TableCell align="right" sx={{ width: '18%' }}>{t('common:labels.actions')}</TableCell>}
        </TableRow>
      </TableHead>
      <TableBody>
        {readOnly ? zoneBody : (
          <SortableContext items={localItems.map((item: any) => item.localId)} strategy={verticalListSortingStrategy}>
            {zoneBody}
          </SortableContext>
        )}
      </TableBody>
    </Table>
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>{t('pages.settings.lists.adminZones.orderHint')}</Typography>
      <TableContainer>
        {readOnly ? zoneTable : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            {zoneTable}
          </DndContext>
        )}
      </TableContainer>
      {removal.dialog}
      {translations.dialog}
    </Paper>
  );
});

// ============================================================================
// State Management
// ============================================================================

const emptyEnums = enumListIds.reduce((acc, id) => ({ ...acc, [id]: [] }), {} as Record<EnumListId, ItOpsEnumOption[]>);

type SettingsState = {
  enums: Record<EnumListId, ItOpsEnumOption[]>;
  connectionTypes: ConnectionTypeOption[];
  subnets: SubnetOption[];
  domains: DomainOption[];
  baseline: ItOpsSettings | null;
  dirty: Partial<Record<ListId, boolean>>;
  pending: ListId | null;
  /** Per list, the rows the server refused (4xx): autosave waits for the next edit instead of resending them. */
  rejected: Partial<Record<ListId, string>>;
  successMessage: string;
  errorMessage: string | null;
};

export const initialState: SettingsState = {
  enums: emptyEnums,
  connectionTypes: [],
  subnets: [],
  domains: [],
  baseline: null,
  dirty: {},
  pending: null,
  rejected: {},
  successMessage: '',
  errorMessage: null,
};

type Action =
  | { type: 'hydrate'; payload: ItOpsSettings }
  | { type: 'setEnum'; id: EnumListId; items: ItOpsEnumOption[] }
  | { type: 'setConnectionTypes'; items: ConnectionTypeOption[] }
  | { type: 'setSubnets'; items: SubnetOption[] }
  | { type: 'setDomains'; items: DomainOption[] }
  | { type: 'resetEnum'; id: EnumListId }
  | { type: 'resetConnectionTypes' }
  | { type: 'resetSubnets' }
  | { type: 'resetDomains' }
  | { type: 'setPending'; id: ListId | null }
  | { type: 'rejected'; id: ListId; sent: any[] }
  | { type: 'saved'; id: ListId; sent: any[]; saved: ItOpsSettings }
  | { type: 'setSuccess'; message: string }
  | { type: 'setError'; message: string | null };

function hydrateFromSettings(settings: ItOpsSettings) {
  const enums = { ...emptyEnums };
  enumListIds.forEach((id) => {
    const list = ((settings as any)[id] as ItOpsEnumOption[] | undefined) || [];
    enums[id] = withLocalIds(orderOf(id, list), id);
  });
  return {
    enums,
    connectionTypes: withLocalIds(sortConnectionTypes(settings.connectionTypes || []), 'ct'),
    subnets: withLocalIds(sortSubnets(settings.subnets || []), 'subnet'),
    domains: withLocalIds(sortDomains(settings.domains || []), 'domain'),
    baseline: settings,
  };
}

export function reducer(state: SettingsState, action: Action): SettingsState {
  switch (action.type) {
    case 'hydrate': {
      const next = hydrateFromSettings(action.payload);
      return { ...state, ...next, dirty: {}, pending: null, rejected: {}, errorMessage: null };
    }
    case 'setEnum': {
      const enums = { ...state.enums, [action.id]: action.items };
      const baselineList = state.baseline ? (state.baseline as any)[action.id] || [] : [];
      const dirtyFlag = !listsEqual(stripLocalIds(action.items), baselineList);
      return { ...state, enums, dirty: { ...state.dirty, [action.id]: dirtyFlag } };
    }
    case 'setConnectionTypes': {
      const baselineList = state.baseline?.connectionTypes || [];
      const dirtyFlag = !listsEqual(stripLocalIds(action.items), baselineList as ItOpsEnumOption[]);
      return { ...state, connectionTypes: action.items, dirty: { ...state.dirty, connectionTypes: dirtyFlag } };
    }
    case 'setSubnets': {
      const baselineList = state.baseline?.subnets || [];
      const dirtyFlag = JSON.stringify(stripLocalIds(action.items)) !== JSON.stringify(baselineList);
      return { ...state, subnets: action.items, dirty: { ...state.dirty, subnets: dirtyFlag } };
    }
    case 'setDomains': {
      const baselineList = state.baseline?.domains || [];
      const dirtyFlag = JSON.stringify(stripLocalIds(action.items)) !== JSON.stringify(baselineList);
      return { ...state, domains: action.items, dirty: { ...state.dirty, domains: dirtyFlag } };
    }
    case 'resetEnum': {
      if (!state.baseline) return state;
      const baselineList = withLocalIds(orderOf(action.id, (state.baseline as any)[action.id] || []), action.id);
      return { ...state, enums: { ...state.enums, [action.id]: baselineList }, dirty: { ...state.dirty, [action.id]: false } };
    }
    case 'resetConnectionTypes': {
      if (!state.baseline) return state;
      const conn = withLocalIds(sortConnectionTypes(state.baseline.connectionTypes || []), 'ct');
      return { ...state, connectionTypes: conn, dirty: { ...state.dirty, connectionTypes: false } };
    }
    case 'resetSubnets': {
      if (!state.baseline) return state;
      const sn = withLocalIds(sortSubnets(state.baseline.subnets || []), 'subnet');
      return { ...state, subnets: sn, dirty: { ...state.dirty, subnets: false } };
    }
    case 'resetDomains': {
      if (!state.baseline) return state;
      const dom = withLocalIds(sortDomains(state.baseline.domains || []), 'domain');
      return { ...state, domains: dom, dirty: { ...state.dirty, domains: false } };
    }
    case 'saved': {
      // Reconcile only the list that was sent: rows are matched by code, new rows by position (order is preserved by
      // the server). A draft edited since the send keeps its edits and stays dirty; it just learns its generated codes.
      const savedList: any[] = ((action.saved as any)[action.id] as any[]) || [];
      const baseline = { ...(state.baseline || action.saved), [action.id]: savedList, lockedCodes: action.saved.lockedCodes, protectedCodes: action.saved.protectedCodes } as ItOpsSettings;
      const currentList: any[] = action.id === 'connectionTypes' ? state.connectionTypes : action.id === 'subnets' ? state.subnets : action.id === 'domains' ? state.domains : state.enums[action.id as EnumListId] || [];
      const untouched = JSON.stringify(stripLocalIds(currentList)) === JSON.stringify(action.sent);
      const matchSaved = (row: any, index: number) => (row.code ? savedList.find((candidate) => candidate.code === row.code) : undefined) ?? savedList[index];
      const nextList = untouched
        ? currentList.map((row: any, index: number) => ({ ...(matchSaved(row, index) ?? row), localId: row.localId }))
        : currentList.map((row: any, index: number) => (!row.code && action.sent[index] && !action.sent[index].code && savedList[index]?.code ? { ...row, code: savedList[index].code } : row));
      const listState = action.id === 'connectionTypes' ? { connectionTypes: nextList } : action.id === 'subnets' ? { subnets: nextList } : action.id === 'domains' ? { domains: nextList } : { enums: { ...state.enums, [action.id]: nextList } };
      const { [action.id]: _accepted, ...rejected } = state.rejected;
      return { ...state, ...listState, baseline, rejected, dirty: { ...state.dirty, [action.id]: !untouched }, pending: null, errorMessage: null };
    }
    case 'setPending':
      return { ...state, pending: action.id || null };
    case 'rejected':
      return { ...state, rejected: { ...state.rejected, [action.id]: JSON.stringify(action.sent) } };
    case 'setSuccess':
      return { ...state, successMessage: action.message, errorMessage: null };
    case 'setError':
      return { ...state, errorMessage: action.message || null };
    default:
      return state;
  }
}

function listRows(state: SettingsState, id: ListId): any[] {
  if (id === 'connectionTypes') return state.connectionTypes;
  if (id === 'subnets') return state.subnets;
  if (id === 'domains') return state.domains;
  return state.enums[id as EnumListId] || [];
}

/** What a person types in a row (selects and boxes keep their defaults). A new row with none of it is blank. */
const TYPED_FIELDS = ['label', 'cidr', 'typicalPorts', 'description', 'admin_group', 'dns_suffix', 'forest', 'vlan_number', 'account_count', 'machine_count'];

function isBlankRow(id: ListId, row: any): boolean {
  const fields = id === 'connectionTypes' ? [...TYPED_FIELDS, 'category'] : TYPED_FIELDS;
  return !row.code && fields.every((key) => row[key] === undefined || row[key] === null || String(row[key]).trim() === '');
}

function setListAction(id: ListId, items: any[]): Action {
  if (id === 'connectionTypes') return { type: 'setConnectionTypes', items };
  if (id === 'subnets') return { type: 'setSubnets', items };
  if (id === 'domains') return { type: 'setDomains', items };
  return { type: 'setEnum', id, items };
}

/** The list still holds exactly the rows the server refused: saving them again would be refused again. */
export function autosaveBlocked(state: SettingsState, id: ListId): boolean {
  const refused = state.rejected[id];
  return refused !== undefined && refused === JSON.stringify(stripLocalIds(listRows(state, id)));
}

// ============================================================================
// Main Component
// ============================================================================

type ItSettingsListsProps = {
  /** The page's tab row. */
  tabs: React.ReactNode;
  /** The Lists tab is the one on screen; otherwise the lists stay mounted, hidden, under `netbox`. */
  listsShown: boolean;
  netbox: React.ReactNode;
};

function ItSettingsLists({ tabs, listsShown, netbox }: ItSettingsListsProps) {
  const { t } = useTranslation(['it', 'common']);
  const listHint = (id: ListId) => (HINTED_LISTS.has(id) ? t(listDescriptionKey(id)) : undefined);
  const { hasLevel } = useAuth();
  const readOnly = !hasLevel('settings', 'admin');
  const queryClient = useQueryClient();
  const { data, isError } = useItOpsSettings();
  const [state, applyAction] = React.useReducer(reducer, initialState);
  // The editors hand their rows to the page inside a transition, which React may not have rendered yet when
  // the page is left. This copy takes each action as it is sent, so a save reads the rows as last typed.
  const latestStateRef = React.useRef(state);
  const dispatch = React.useCallback((action: Action) => {
    latestStateRef.current = reducer(latestStateRef.current, action);
    applyAction(action);
  }, []);

  const { data: locations } = useLocationOptions();

  // Hydrate from the query on first load, or when nothing is being edited: a refetch must never replace a draft.
  const hasDrafts = Object.values(state.dirty).some(Boolean) || state.pending !== null;
  React.useEffect(() => {
    if (!data) return;
    if (state.baseline === null || (!hasDrafts && data !== state.baseline)) dispatch({ type: 'hydrate', payload: data });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const mutation = useMutation({
    mutationFn: ({ id, rows }: { id: ListId; rows: any[] }) => updateItOpsSettings({ [id]: rows } as Partial<ItOpsSettings>),
    onSuccess: (next: ItOpsSettings, variables) => {
      queryClient.setQueryData(['it-ops-settings'], next);
      dispatch({ type: 'saved', id: variables.id, sent: variables.rows, saved: next });
      dispatch({ type: 'setSuccess', message: t('pages.settings.updateSuccess') });
    },
    onError: (error, variables) => {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status && status >= 400 && status < 500) dispatch({ type: 'rejected', id: variables.id, sent: variables.rows });
      dispatch({ type: 'setError', message: getApiErrorMessage(error, t, t('pages.settings.updateFailed')) });
    },
    onSettled: (_next, _error, variables) => {
      dispatch({ type: 'setPending', id: null });
      const sent = inFlightRef.current.get(variables.id);
      inFlightRef.current.delete(variables.id);
      // Once the page is left, rows typed while this save was in flight are sent when it returns.
      if (!leftRef.current || sent === undefined) return;
      const latest = latestStateRef.current;
      const changed = JSON.stringify(stripLocalIds(listRows(latest, variables.id))) !== sent;
      if (changed && savableLists(latest).includes(variables.id)) saveLists([variables.id]);
    },
  });

  const submitting = mutation.isPending;
  /** Per list, the rows of the save in flight, as sent. */
  const inFlightRef = React.useRef(new Map<ListId, string>());
  const leftRef = React.useRef(false);
  const send = (id: ListId, rows: any[]) => {
    dispatch({ type: 'setPending', id });
    inFlightRef.current.set(id, JSON.stringify(rows));
    mutation.mutate({ id, rows });
  };
  const errorMessage = state.errorMessage;

  const handleSaveEnum = (id: EnumListId) => {
    const current = latestStateRef.current.enums[id] || [];
    const ordered = withLocalIds(orderOf(id, current), id);
    dispatch({ type: 'setEnum', id, items: ordered });
    send(id, stripLocalIds(ordered));
  };

  const handleSaveConnections = () => {
    const sorted = withLocalIds(sortConnectionTypes(latestStateRef.current.connectionTypes), 'ct');
    dispatch({ type: 'setConnectionTypes', items: sorted });
    send('connectionTypes', stripLocalIds(sorted));
  };

  const handleSaveSubnets = () => {
    const sorted = withLocalIds(sortSubnets(latestStateRef.current.subnets), 'subnet');
    dispatch({ type: 'setSubnets', items: sorted });
    send('subnets', stripLocalIds(sorted));
  };

  const handleSaveDomains = () => {
    const sorted = withLocalIds(sortDomains(latestStateRef.current.domains), 'domain');
    dispatch({ type: 'setDomains', items: sorted });
    send('domains', stripLocalIds(sorted));
  };

  // Debounced autosave: each dirty list saves ~1.5s after the last edit, but
  // only once every row is complete — half-typed rows stay local until filled.
  // Codes are generated by the server; a list is sent once every name is present and the names are valid
  // (unique, not another row's code, no comma where the CSV serializes the list with commas).
  const listReadyToSave = (current: SettingsState, id: ListId): boolean => {
    if (id === 'subnets') return current.subnets.every((row) => String(row.cidr || '').trim() !== '');
    const rows = listRows(current, id);
    const skipCodes = new Set((current.baseline?.lockedCodes?.[id] || []).map((code) => code.toLowerCase()));
    return catalogListIssues(rows, { forbidComma: id === 'accessMethods', skipCodes }).size === 0;
  };

  const savableLists = (current: SettingsState) => (Object.keys(current.dirty) as ListId[]).filter(
    (id) => current.dirty[id] && listReadyToSave(current, id) && !autosaveBlocked(current, id),
  );

  const saveLists = (ids: ListId[]) => ids.forEach((id) => {
    if (id === 'connectionTypes') handleSaveConnections();
    else if (id === 'subnets') handleSaveSubnets();
    else if (id === 'domains') handleSaveDomains();
    else handleSaveEnum(id);
  });

  React.useEffect(() => {
    if (readOnly || submitting || savableLists(state).length === 0) return undefined;
    const timer = setTimeout(() => saveLists(savableLists(latestStateRef.current)), 1500);
    return () => clearTimeout(timer);
  });

  // The effect above clears its timer on every render and on leaving the page, so a value typed just before
  // leaving would be dropped: send it once when the page unmounts. A list whose save is in flight is sent when
  // that save returns, if its rows changed since (`onSettled`).
  const saveOnLeaveRef = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    saveOnLeaveRef.current = readOnly ? null : () => {
      leftRef.current = true;
      // A row added and left blank is dropped, so that it does not keep the rest of its list from being saved.
      (Object.keys(latestStateRef.current.dirty) as ListId[]).forEach((id) => {
        const rows = listRows(latestStateRef.current, id);
        const kept = rows.filter((row) => !isBlankRow(id, row));
        if (kept.length !== rows.length) dispatch(setListAction(id, kept));
      });
      saveLists(savableLists(latestStateRef.current).filter((id) => !inFlightRef.current.has(id)));
    };
  });

  React.useEffect(() => () => {
    saveOnLeaveRef.current?.();
  }, []);

  // Locked rows come from the server (lifecycle statuses, system domains); protected rows are defaults it re-adds.
  const editorGuards = (id: EnumListId) => ({
    usageList: id,
    lockedCodes: state.baseline?.lockedCodes?.[id] ?? enumSections.find((section) => section.id === id)?.lockedCodes,
    protectedCodes: state.baseline?.protectedCodes?.[id],
    readOnly,
  });

  const makeEmptyEnumRow = (id: EnumListId): ItOpsEnumOption => {
    if (id === 'hostingTypes') return { code: '', label: '', category: 'cloud', deprecated: false };
    if (id === 'serverKinds') return { code: '', label: '', is_physical: false, deprecated: false } as any;
    if (id === 'serverRoles') return { code: '', label: '', graph_tier: 'center', deprecated: false } as any;
    if (id === 'entities') return { code: '', label: '', graph_tier: 'top', deprecated: false } as any;
    return { code: '', label: '', deprecated: false };
  };

  return (
    <SettingsPage title={t('pages.settings.title')} tabs={tabs} readOnly={readOnly}>
    {/* Kept mounted while hidden: a list draft not yet saved survives a visit to the Netbox tab. */}
    <Box sx={{ display: listsShown ? 'flex' : 'none', flexDirection: 'column', gap: 2 }}>
      {isError && <Alert severity="error">{t('pages.settings.loadFailed')}</Alert>}
      {state.successMessage && <Alert severity="success">{state.successMessage}</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {data && <ClassificationCatalogSettings settings={data} readOnly={readOnly} />}
      <Stack spacing={3}>
        {listGroupIds.map((groupId, groupIndex) => {
          const groupEnumSections = enumSections.filter((section) => section.group === groupId);
          const extraSections = groupId === 'serversConnections'
            ? [{ id: 'connectionTypes' as const }, { id: 'domains' as const }, { id: 'subnets' as const }]
            : [];

          const groupSections = [...groupEnumSections, ...extraSections]
            .map((section) => ({ ...section, title: t(listTitleKey(section.id)) }))
            .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

          return (
            <SettingsGroup key={groupId} title={t(`pages.settings.groups.${groupId}.title`)} showDivider={groupIndex > 0}>
              {groupSections.map((section) => {
                if (section.id === 'connectionTypes') {
                  return (
                    <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('connectionTypes'))}>
                      <SettingsControls
                        onAdd={() => dispatch({ type: 'setConnectionTypes', items: [{ category: '', label: '', code: '', typicalPorts: '', deprecated: false, localId: makeLocalId('ct') }, ...latestStateRef.current.connectionTypes] })}
                        saving={state.pending === 'connectionTypes' && submitting}
                        dirty={!!state.dirty.connectionTypes}
                        readOnly={readOnly}
                      />
                      <ConnectionTypesEditor items={state.connectionTypes} onChange={(next) => dispatch({ type: 'setConnectionTypes', items: withLocalIds(next, 'ct') })} readOnly={readOnly} />
                    </SettingsSection>
                  );
                }
                if (section.id === 'subnets') {
                  const defaultLocationId = locations?.[0]?.id || '';
                  return (
                    <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('subnets'))}>
                      <SettingsControls
                        onAdd={() => dispatch({ type: 'setSubnets', items: [{ location_id: defaultLocationId, cidr: '', vlan_number: undefined, network_zone: 'lan', description: '', deprecated: false, localId: makeLocalId('subnet') }, ...latestStateRef.current.subnets] })}
                        saving={state.pending === 'subnets' && submitting}
                        dirty={!!state.dirty.subnets}
                        readOnly={readOnly}
                      />
                      <SubnetsEditor items={state.subnets} networkZones={state.enums.networkSegments || []} locations={locations || []} onChange={(next) => dispatch({ type: 'setSubnets', items: withLocalIds(next, 'subnet') })} readOnly={readOnly} />
                    </SettingsSection>
                  );
                }
                if (section.id === 'domains') {
                  return (
                    <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('domains'))} hint={listHint('domains')}>
                      <SettingsControls
                        onAdd={() => dispatch({ type: 'setDomains', items: [{ code: '', label: '', dns_suffix: '', deprecated: false, system: false, localId: makeLocalId('domain') }, ...latestStateRef.current.domains] })}
                        saving={state.pending === 'domains' && submitting}
                        dirty={!!state.dirty.domains}
                        readOnly={readOnly}
                      />
                      <DomainsEditor items={state.domains} onChange={(next) => dispatch({ type: 'setDomains', items: withLocalIds(next, 'domain') })} readOnly={readOnly} />
                    </SettingsSection>
                  );
                }

                const enumSection = section as EnumSectionConfig & { title: string };
                const items = state.enums[enumSection.id] || [];
                const dirty = !!state.dirty[enumSection.id];
                const saving = state.pending === enumSection.id && submitting;
                const exampleKey = nameExampleKey[enumSection.id];
                const namePlaceholder = exampleKey ? t(`pages.settings.placeholders.${exampleKey}`) : undefined;

                return (
                  <SettingsSection key={enumSection.id} title={enumSection.title} description={t(listUsageKey(enumSection.id))} hint={listHint(enumSection.id)}>
                    <SettingsControls
                      onAdd={() => dispatch({ type: 'setEnum', id: enumSection.id, items: [{ ...makeEmptyEnumRow(enumSection.id), localId: makeLocalId(enumSection.id) }, ...(latestStateRef.current.enums[enumSection.id] || [])] })}
                      saving={saving}
                      dirty={dirty}
                      readOnly={readOnly}
                    />
                    {enumSection.kind === 'hosting' ? (
                      <HostingTypeEditor items={items as HostingTypeItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(enumSection.id)} />
                    ) : enumSection.kind === 'serverKind' ? (
                      <AssetKindEditor items={items as AssetKindItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(enumSection.id)} />
                    ) : enumSection.kind === 'serverRole' ? (
                      <ServerRoleEditor items={items as ServerRoleItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(enumSection.id)} />
                    ) : enumSection.kind === 'adminZone' ? (
                      <AdminZonesEditor items={items as AdminZoneOption[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} readOnly={readOnly} />
                    ) : enumSection.kind === 'entity' ? (
                      <EntityEditor items={items as EntityItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(enumSection.id)} />
                    ) : (
                      <EnumEditor items={items} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton namePlaceholder={namePlaceholder} forbidComma={enumSection.id === 'accessMethods'} {...editorGuards(enumSection.id)} />
                    )}
                  </SettingsSection>
                );
              })}
            </SettingsGroup>
          );
        })}
      </Stack>
    </Box>
    {netbox}
    </SettingsPage>
  );
}

const LISTS_TAB = 'lists';
const NETBOX_TAB = 'netbox';
const SETTINGS_PATH = '/it/settings';

/** The tab named by the address: `/it/settings/<tab>`, or the former `?tab=` of the page. */
function requestedTab(pathname: string, search: string): string | null {
  const segment = /^\/it\/settings\/([^/]+)/.exec(pathname)?.[1];
  return segment ?? new URLSearchParams(search).get('tab');
}

/**
 * IT settings: the reusable lists, and the Netbox synchronisation. Each tab is shown only to
 * someone who may open it; the tab is in the path (`/it/settings/lists`, `/it/settings/netbox`).
 * An address without a tab, with a tab the person cannot open or with the former `?tab=` is
 * replaced by the tab on screen, its other parameters kept (Netbox keeps its record filter there).
 */
export default function ItOperationsSettingsPage() {
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const canLists = hasLevel('settings', 'reader');
  const canNetbox = hasLevel('infrastructure', 'admin');
  const tabs = [
    ...(canLists ? [{ key: LISTS_TAB, label: t('pages.settings.tabs.lists') }] : []),
    ...(canNetbox ? [{ key: NETBOX_TAB, label: t('pages.settings.tabs.netbox') }] : []),
  ];
  const requested = requestedTab(location.pathname, location.search);
  const active = tabs.some((tab) => tab.key === requested) ? requested! : (tabs[0]?.key ?? '');

  // The help button reads the address: it always names the tab on screen.
  React.useEffect(() => {
    if (!active) return;
    const params = new URLSearchParams(location.search);
    const legacy = params.has('tab');
    params.delete('tab');
    if (location.pathname === `${SETTINGS_PATH}/${active}` && !legacy) return;
    const search = params.toString();
    navigate({ pathname: `${SETTINGS_PATH}/${active}`, search: search ? `?${search}` : '' }, { replace: true });
  }, [active, location.pathname, location.search, navigate]);

  const changeTab = (next: string) => {
    navigate({ pathname: `${SETTINGS_PATH}/${next}`, search: location.search }, { replace: true });
  };

  if (!active) return <ForbiddenPage />;

  const tabRow = <WorkspaceTabs tabs={tabs} activeTab={active} onTabChange={changeTab} ariaLabel={t('pages.settings.title')} />;
  const netbox = active === NETBOX_TAB ? <NetboxSyncPanel /> : null;
  if (!canLists) return <SettingsPage title={t('pages.settings.title')} tabs={tabRow}>{netbox}</SettingsPage>;
  return <ItSettingsLists tabs={tabRow} listsShown={active === LISTS_TAB} netbox={netbox} />;
}
