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
  Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import PageHeader from '../../components/PageHeader';
import DateEUField from '../../components/fields/DateEUField';
import { SettingsSection, SettingsControls, SettingsGroup } from '../../components/settings';
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
import { useCatalogTranslations } from '../../components/settings/CatalogTranslationsDialog';
import TranslateIcon from '@mui/icons-material/Translate';
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
  OperatingSystemOption,
  SubnetOption,
  updateItOpsSettings,
} from '../../services/itOpsSettings';
import { useTranslation } from 'react-i18next';
import ClassificationCatalogSettings from './components/ClassificationCatalogSettings';
import DomainTrustsDialog from './components/DomainTrustsDialog';

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

const sortOperatingSystems = (list: OperatingSystemOption[]) =>
  [...list].sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }));

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
    for (const key of ['admin_group', 'privilege_level', 'secrets_location', 'description']) {
      if (((left as any)[key] || undefined) !== ((right as any)[key] || undefined)) return false;
    }
  }
  return true;
};

const osListsEqual = (a: OperatingSystemOption[], b: OperatingSystemOption[]): boolean => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (left.code !== right.code || left.label !== right.label) return false;
    if (!!left.deprecated !== !!right.deprecated) return false;
    if ((left.standardSupportEnd || '') !== (right.standardSupportEnd || '')) return false;
    if ((left.extendedSupportEnd || '') !== (right.extendedSupportEnd || '')) return false;
    if (JSON.stringify((left as any).translations ?? null) !== JSON.stringify((right as any).translations ?? null)) return false;
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
  | 'incidentCategories';

type ListId = EnumListId | 'operatingSystems' | 'connectionTypes' | 'subnets' | 'domains';
type GroupId = 'locations' | 'serversConnections' | 'appsInterfaces' | 'incidents';

// ============================================================================
// Constants
// ============================================================================

const enumListIds: EnumListId[] = [
  'adminZones', 'applicationCategories', 'dataClasses', 'networkSegments', 'entities', 'serverKinds',
  'serverProviders', 'serverRoles', 'hostingTypes', 'lifecycleStates', 'interfaceProtocols',
  'interfaceDataCategories', 'interfaceTriggerTypes', 'interfacePatterns', 'interfaceFormats',
  'interfaceAuthModes', 'ipAddressTypes', 'accessMethods', 'incidentCategories',
];

const listGroupIds: GroupId[] = ['locations', 'serversConnections', 'appsInterfaces', 'incidents'];

// Titles, descriptions and usage hints live in it:pages.settings.lists.<id>.
type EnumSectionConfig = {
  id: EnumListId;
  group: GroupId;
  lockedCodes?: string[];
  kind?: 'enum' | 'hosting' | 'serverKind' | 'serverRole' | 'entity' | 'adminZone';
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

interface OperatingSystemsEditorProps {
  items: OperatingSystemOption[];
  onChange: (items: OperatingSystemOption[]) => void;
  hideAddButton?: boolean;
}

const listTitleKey = (id: ListId) => `pages.settings.lists.${id}.title`;
const listDescriptionKey = (id: ListId) => `pages.settings.lists.${id}.description`;
const listUsageKey = (id: ListId) => `pages.settings.lists.${id}.usage`;

function TranslateButton({ label, onClick }: { label: string; onClick: () => void }) {
  const { t } = useTranslation('common');
  return <IconButton size="small" aria-label={`${t('enumEditor.translate')} ${label}`} sx={{ color: 'kanap.text.secondary', mr: 0.5 }} onClick={onClick}><TranslateIcon sx={{ fontSize: 17 }} /></IconButton>;
}

function IssueText({ issue }: { issue?: string }) {
  const { t } = useTranslation('common');
  return issue ? <Typography sx={{ fontSize: 11, color: 'kanap.text.tertiary', mt: 0.25 }}>{t(`enumEditor.${issue}`)}</Typography> : null;
}

const OperatingSystemsEditor = React.memo(function OperatingSystemsEditor({
  items,
  onChange,
  hideAddButton,
}: OperatingSystemsEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'os'), [items]);
  const [localItems, setLocalItems] = React.useState(itemsWithIds);
  const pendingCommitRef = React.useRef(false);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 64 });

  // Sync down from parent - skip if we just committed to avoid loops
  React.useEffect(() => {
    if (pendingCommitRef.current) {
      pendingCommitRef.current = false;
      return;
    }
    setLocalItems(itemsWithIds);
  }, [itemsWithIds]);

  const commitToParent = React.useCallback(
    (next: OperatingSystemOption[]) => {
      pendingCommitRef.current = true;
      React.startTransition(() => onChange(next));
    },
    [onChange]
  );

  const handleUpdate = (localId: string, patch: Partial<OperatingSystemOption>) => {
    setLocalItems((prev) => {
      const next = prev.map((item) => ((item as any).localId === localId ? { ...item, ...patch } : item));
      commitToParent(next);
      return next;
    });
  };

  const handleRemove = (localId: string) => {
    setLocalItems((prev) => {
      const next = prev.filter((row) => (row as any).localId !== localId);
      commitToParent(next);
      return next;
    });
  };
  const { t } = useTranslation(['it', 'common']);
  const removal = useCatalogRemoval('operatingSystems');
  const translations = useCatalogTranslations();
  const issues = React.useMemo(() => catalogListIssues(localItems), [localItems]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{t(listTitleKey('operatingSystems'))}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t(listDescriptionKey('operatingSystems'))}
        </Typography>
      </Stack>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '30%' }}>{t('common:enumEditor.name')}</TableCell>
              <TableCell sx={{ width: '20%' }}>{t('pages.settings.columns.standardSupport')}</TableCell>
              <TableCell sx={{ width: '20%' }}>{t('pages.settings.columns.extendedSupport')}</TableCell>
              <TableCell sx={{ width: '15%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              <TableCell align="right" sx={{ width: '15%' }}>{t('common:labels.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={6} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.operatingSystems')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <TextField value={item.label} onChange={(e) => handleUpdate(item.localId, { label: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.osName')} inputProps={{ 'aria-label': t('common:enumEditor.name') }} />
                  <IssueText issue={issues.get(localItems.indexOf(item))} />
                </TableCell>
                <TableCell>
                  <DateEUField label={t('pages.settings.columns.standardSupport')} valueYmd={item.standardSupportEnd || ''} onChangeYmd={(next) => handleUpdate(item.localId, { standardSupportEnd: next })} />
                </TableCell>
                <TableCell>
                  <DateEUField label={t('pages.settings.columns.extendedSupport')} valueYmd={item.extendedSupportEnd || ''} onChangeYmd={(next) => handleUpdate(item.localId, { extendedSupportEnd: next })} />
                </TableCell>
                <TableCell>
                  <Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} />
                </TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
                  <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
                </TableCell>
              </TableRow>
            ))}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={6} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {removal.dialog}
      {translations.dialog}
    </Paper>
  );
});

interface ConnectionTypesEditorProps {
  items: ConnectionTypeOption[];
  onChange: (items: ConnectionTypeOption[]) => void;
}

const ConnectionTypesEditor = React.memo(function ConnectionTypesEditor({
  items,
  onChange,
}: ConnectionTypesEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'ct'), [items]);
  const [localItems, setLocalItems] = React.useState(itemsWithIds);
  const pendingCommitRef = React.useRef(false);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 60 });

  // Sync down from parent - skip if we just committed to avoid loops
  React.useEffect(() => {
    if (pendingCommitRef.current) {
      pendingCommitRef.current = false;
      return;
    }
    setLocalItems(itemsWithIds);
  }, [itemsWithIds]);

  const commitToParent = React.useCallback(
    (next: ConnectionTypeOption[]) => {
      pendingCommitRef.current = true;
      React.startTransition(() => onChange(next));
    },
    [onChange]
  );

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<ConnectionTypeOption>) => {
      setLocalItems((prev) => {
        const next = prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row));
        commitToParent(next);
        return next;
      });
    },
    [commitToParent]
  );

  const handleRemove = React.useCallback(
    (localId: string) => {
      setLocalItems((prev) => {
        const next = prev.filter((row: any) => row.localId !== localId);
        commitToParent(next);
        return next;
      });
    },
    [commitToParent]
  );

  const { t } = useTranslation(['it', 'common']);
  // A shipped category is shown in the user's language until it is retyped; typing replaces the stored text.
  const catalogLocale = useCatalogLocale();
  const removal = useCatalogRemoval('connectionTypes');
  const translations = useCatalogTranslations();
  const issues = React.useMemo(() => catalogListIssues(localItems), [localItems]);

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{t(listTitleKey('connectionTypes'))}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t(listDescriptionKey('connectionTypes'))}
        </Typography>
      </Stack>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '22%' }}>{t('common:enumEditor.category')}</TableCell>
              <TableCell sx={{ width: '28%' }}>{t('common:enumEditor.name')}</TableCell>
              <TableCell sx={{ width: '25%' }}>{t('pages.settings.columns.typicalPorts')}</TableCell>
              <TableCell sx={{ width: '12%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              <TableCell align="right" sx={{ width: '13%' }}>{t('common:labels.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={6} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={6}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.connectionTypes')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell><TextField value={connectionTypeCategoryLabel(item.category || '', catalogLocale)} onChange={(e) => handleUpdate(item.localId, { category: e.target.value })} size="small" fullWidth placeholder={t('common:enumEditor.category')} /></TableCell>
                <TableCell sx={{ verticalAlign: 'top' }}><TextField value={item.label} onChange={(e) => handleUpdate(item.localId, { label: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.connectionName')} inputProps={{ 'aria-label': t('common:enumEditor.name') }} /><IssueText issue={issues.get(localItems.indexOf(item))} /></TableCell>
                <TableCell><TextField value={item.typicalPorts || ''} onChange={(e) => handleUpdate(item.localId, { typicalPorts: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.typicalPorts')} /></TableCell>
                <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
                  <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
                </TableCell>
              </TableRow>
            ))}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={6} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
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
}

const SubnetsEditor = React.memo(function SubnetsEditor({
  items,
  networkZones,
  locations,
  onChange,
}: SubnetsEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'subnet'), [items]);
  const [localItems, setLocalItems] = React.useState(itemsWithIds);
  const pendingCommitRef = React.useRef(false);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 60 });

  // Sync down from parent - skip if we just committed to avoid loops
  React.useEffect(() => {
    if (pendingCommitRef.current) {
      pendingCommitRef.current = false;
      return;
    }
    setLocalItems(itemsWithIds);
  }, [itemsWithIds]);

  const commitToParent = React.useCallback(
    (next: SubnetOption[]) => {
      pendingCommitRef.current = true;
      React.startTransition(() => onChange(next));
    },
    [onChange]
  );

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<SubnetOption>) => {
      setLocalItems((prev) => {
        const next = prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row));
        commitToParent(next);
        return next;
      });
    },
    [commitToParent]
  );

  const handleRemove = React.useCallback(
    (localId: string) => {
      setLocalItems((prev) => {
        const next = prev.filter((row: any) => row.localId !== localId);
        commitToParent(next);
        return next;
      });
    },
    [commitToParent]
  );

  const { t } = useTranslation(['it', 'common']);
  const removal = useCatalogRemoval('subnets');

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{t(listTitleKey('subnets'))}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t(listDescriptionKey('subnets'))}
        </Typography>
      </Stack>
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
              <TableCell align="right" sx={{ width: '10%' }}>{t('common:labels.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={7} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.subnets')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell>
                  <TextField select value={item.location_id || ''} onChange={(e) => handleUpdate(item.localId, { location_id: e.target.value })} size="small" fullWidth SelectProps={{ native: true }}>
                    <option value="">{t('pages.settings.placeholders.select')}</option>
                    {locations.map((loc) => (
                      <option key={loc.id} value={loc.id}>
                        {loc.location_reference}{loc.name ? ` · ${loc.name}` : ''}
                      </option>
                    ))}
                  </TextField>
                </TableCell>
                <TableCell><TextField value={item.cidr || ''} onChange={(e) => handleUpdate(item.localId, { cidr: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.cidr')} /></TableCell>
                <TableCell>
                  <TextField value={item.vlan_number ?? ''} onChange={(e) => handleUpdate(item.localId, { vlan_number: e.target.value.trim() === '' ? undefined : parseInt(e.target.value, 10) || undefined })} size="small" fullWidth placeholder="1-4094" type="number" inputProps={{ min: 1, max: 4094 }} sx={{ '& input::-webkit-outer-spin-button, & input::-webkit-inner-spin-button': { WebkitAppearance: 'none', margin: 0 }, '& input[type=number]': { MozAppearance: 'textfield' } }} />
                </TableCell>
                <TableCell>
                  <TextField select value={item.network_zone || ''} onChange={(e) => handleUpdate(item.localId, { network_zone: e.target.value })} size="small" fullWidth SelectProps={{ native: true }}>
                    <option value="">{t('pages.settings.placeholders.select')}</option>
                    {networkZones.filter((zone) => !zone.deprecated || zone.code === item.network_zone).map((zone) => <option key={zone.code} value={zone.code}>{zone.label}</option>)}
                  </TextField>
                </TableCell>
                <TableCell><TextField value={item.description || ''} onChange={(e) => handleUpdate(item.localId, { description: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.columns.description')} /></TableCell>
                <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.cidr}` }} /></TableCell>
                <TableCell align="right"><Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.cidr || '', key: item.location_id && item.cidr ? { location_id: item.location_id, cidr: item.cidr } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button></TableCell>
              </TableRow>
            ))}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={7} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
      {removal.dialog}
    </Paper>
  );
});

interface DomainsEditorProps {
  items: DomainOption[];
  onChange: (items: DomainOption[]) => void;
}

const DomainsEditor = React.memo(function DomainsEditor({ items, onChange }: DomainsEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'domain'), [items]);
  const [localItems, setLocalItems] = React.useState(itemsWithIds);
  const pendingCommitRef = React.useRef(false);
  const { containerRef, onScroll, useVirtual, visibleItems, paddingTop, paddingBottom, maxHeight } =
    useVirtualRows({ items: localItems, rowHeight: 52 });

  // Sync down from parent - skip if we just committed to avoid loops
  React.useEffect(() => {
    if (pendingCommitRef.current) {
      pendingCommitRef.current = false;
      return;
    }
    setLocalItems(itemsWithIds);
  }, [itemsWithIds]);

  const commitToParent = React.useCallback(
    (next: DomainOption[]) => {
      pendingCommitRef.current = true;
      React.startTransition(() => onChange(next));
    },
    [onChange]
  );

  const handleUpdate = React.useCallback(
    (localId: string, patch: Partial<DomainOption>) => {
      setLocalItems((prev) => {
        const next = prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row));
        commitToParent(next);
        return next;
      });
    },
    [commitToParent]
  );

  const handleRemove = React.useCallback(
    (localId: string) => {
      setLocalItems((prev) => {
        const next = prev.filter((row: any) => row.localId !== localId);
        commitToParent(next);
        return next;
      });
    },
    [commitToParent]
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

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{t(listTitleKey('domains'))}</Typography>
        <Typography variant="body2" color="text.secondary">
          {t(listDescriptionKey('domains'))}
        </Typography>
      </Stack>
      <TableContainer ref={containerRef as any} onScroll={onScroll} sx={{ maxHeight }}>
        <Table size="small" stickyHeader={useVirtual}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '18%' }}>{t('common:enumEditor.name')}</TableCell>
              <TableCell sx={{ width: '17%' }}>{t('pages.settings.columns.dnsSuffix')}</TableCell>
              <TableCell sx={{ width: '15%' }}>{t('pages.settings.columns.forest')}</TableCell>
              <TableCell sx={{ width: '9%' }}>{t('pages.settings.columns.accounts')}</TableCell>
              <TableCell sx={{ width: '9%' }}>{t('pages.settings.columns.machines')}</TableCell>
              <TableCell sx={{ width: '10%' }}>{t('pages.settings.columns.trusts')}</TableCell>
              <TableCell sx={{ width: '8%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              <TableCell align="right" sx={{ width: '14%' }}>{t('common:labels.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {useVirtual && paddingTop > 0 && (
              <TableRow><TableCell colSpan={8} sx={{ p: 0, height: paddingTop, border: 0 }} /></TableRow>
            )}
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={8}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.domains')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {visibleItems.map((item: any) => {
              const isSystem = !!item.system;
              return (
                <TableRow key={item.localId}>
                  <TableCell sx={{ verticalAlign: 'top' }}><TextField value={item.label || ''} onChange={(e) => handleLabelChange(item.localId, e.target.value, item.dns_suffix || '', item.label || '')} size="small" fullWidth placeholder={t('pages.settings.placeholders.domainName')} disabled={isSystem} InputProps={{ readOnly: isSystem }} inputProps={{ 'aria-label': t('common:enumEditor.name') }} /><IssueText issue={issues.get(localItems.indexOf(item))} /></TableCell>
                  <TableCell><TextField value={item.dns_suffix || ''} onChange={(e) => handleUpdate(item.localId, { dns_suffix: e.target.value.toLowerCase() })} size="small" fullWidth placeholder={t('pages.settings.placeholders.dnsSuffix')} disabled={isSystem} InputProps={{ readOnly: isSystem }} /></TableCell>
                  <TableCell>{!isSystem && <TextField value={item.forest || ''} onChange={(e) => handleUpdate(item.localId, { forest: e.target.value || undefined })} size="small" fullWidth placeholder={t('pages.settings.placeholders.forest')} inputProps={{ maxLength: 200, 'aria-label': `${t('pages.settings.columns.forest')} ${item.label}` }} />}</TableCell>
                  <TableCell>{!isSystem && <TextField value={item.account_count ?? ''} onChange={(e) => handleUpdate(item.localId, { account_count: countValue(e.target.value) })} size="small" fullWidth type="number" placeholder={t('pages.settings.placeholders.accountCount')} inputProps={{ min: 0, max: MAX_COUNT, 'aria-label': `${t('pages.settings.columns.accounts')} ${item.label}` }} />}</TableCell>
                  <TableCell>{!isSystem && <TextField value={item.machine_count ?? ''} onChange={(e) => handleUpdate(item.localId, { machine_count: countValue(e.target.value) })} size="small" fullWidth type="number" placeholder={t('pages.settings.placeholders.machineCount')} inputProps={{ min: 0, max: MAX_COUNT, 'aria-label': `${t('pages.settings.columns.machines')} ${item.label}` }} />}</TableCell>
                  <TableCell>{!isSystem && item.code && <Button size="small" onClick={() => setTrustsOf(item)} aria-label={`${t('pages.settings.columns.trusts')} ${item.label}`}>{(item.trusts ?? []).length ? t('pages.settings.trusts.count', { count: item.trusts.length }) : t('pages.settings.trusts.none')}</Button>}</TableCell>
                  <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} disabled={isSystem} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    {isSystem ? (
                      <Typography variant="caption" color="text.secondary">{t('common:enumEditor.locked')}</Typography>
                    ) : (<>
                      {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
                      <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
                    </>)}
                  </TableCell>
                </TableRow>
              );
            })}
            {useVirtual && paddingBottom > 0 && (
              <TableRow><TableCell colSpan={8} sx={{ p: 0, height: paddingBottom, border: 0 }} /></TableRow>
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
const ADMIN_ZONE_LIMITS = { admin_group: 200, privilege_level: 100, secrets_location: 200, description: 2000 } as const;
const MAX_COUNT = 100_000_000;

interface AdminZonesEditorProps {
  items: AdminZoneOption[];
  onChange: (items: AdminZoneOption[]) => void;
}

/** Administration zones: name, administrator group, privilege level, secrets location and description per zone. */
export const AdminZonesEditor = React.memo(function AdminZonesEditor({ items, onChange }: AdminZonesEditorProps) {
  const itemsWithIds = React.useMemo(() => withLocalIds(items, 'adminZones'), [items]);
  const [localItems, setLocalItems] = React.useState(itemsWithIds);
  const pendingCommitRef = React.useRef(false);

  // Sync down from parent - skip if we just committed to avoid loops
  React.useEffect(() => {
    if (pendingCommitRef.current) {
      pendingCommitRef.current = false;
      return;
    }
    setLocalItems(itemsWithIds);
  }, [itemsWithIds]);

  const commitToParent = React.useCallback((next: AdminZoneOption[]) => {
    pendingCommitRef.current = true;
    React.startTransition(() => onChange(next));
  }, [onChange]);

  const handleUpdate = React.useCallback((localId: string, patch: Partial<AdminZoneOption>) => {
    setLocalItems((prev) => {
      const next = prev.map((row: any) => (row.localId === localId ? { ...row, ...patch } : row));
      commitToParent(next);
      return next;
    });
  }, [commitToParent]);

  const handleRemove = React.useCallback((localId: string) => {
    setLocalItems((prev) => {
      const next = prev.filter((row: any) => row.localId !== localId);
      commitToParent(next);
      return next;
    });
  }, [commitToParent]);

  const { t } = useTranslation(['it', 'common']);
  const removal = useCatalogRemoval('adminZones');
  const translations = useCatalogTranslations();
  const issues = React.useMemo(() => catalogListIssues(localItems), [localItems]);
  const text = (item: any, key: 'admin_group' | 'privilege_level' | 'secrets_location' | 'description', placeholder: string) => (
    <TextField value={item[key] || ''} onChange={(e) => handleUpdate(item.localId, { [key]: e.target.value || undefined })} size="small" fullWidth placeholder={placeholder} inputProps={{ maxLength: ADMIN_ZONE_LIMITS[key], 'aria-label': `${t(`pages.settings.columns.${key === 'admin_group' ? 'adminGroup' : key === 'privilege_level' ? 'privilegeLevel' : key === 'secrets_location' ? 'secretsLocation' : 'description'}`)} ${item.label}` }} />
  );

  return (
    <Paper variant="outlined" sx={{ p: 2 }}>
      <Stack spacing={0.5} sx={{ mb: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>{t(listTitleKey('adminZones'))}</Typography>
        <Typography variant="body2" color="text.secondary">{t(listDescriptionKey('adminZones'))}</Typography>
      </Stack>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ width: '18%' }}>{t('common:enumEditor.name')}</TableCell>
              <TableCell sx={{ width: '17%' }}>{t('pages.settings.columns.adminGroup')}</TableCell>
              <TableCell sx={{ width: '12%' }}>{t('pages.settings.columns.privilegeLevel')}</TableCell>
              <TableCell sx={{ width: '17%' }}>{t('pages.settings.columns.secretsLocation')}</TableCell>
              <TableCell sx={{ width: '18%' }}>{t('pages.settings.columns.description')}</TableCell>
              <TableCell sx={{ width: '6%' }}>{t('common:enumEditor.noLongerOffered')}</TableCell>
              <TableCell align="right" sx={{ width: '12%' }}>{t('common:labels.actions')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {localItems.length === 0 && (
              <TableRow>
                <TableCell colSpan={7}>
                  <Typography variant="body2" color="text.secondary">{t('pages.settings.empty.adminZones')}</Typography>
                </TableCell>
              </TableRow>
            )}
            {localItems.map((item: any) => (
              <TableRow key={item.localId}>
                <TableCell sx={{ verticalAlign: 'top' }}>
                  <TextField value={item.label} onChange={(e) => handleUpdate(item.localId, { label: e.target.value })} size="small" fullWidth placeholder={t('pages.settings.placeholders.adminZoneName')} inputProps={{ maxLength: 200, 'aria-label': t('common:enumEditor.name') }} />
                  <IssueText issue={issues.get(localItems.indexOf(item))} />
                </TableCell>
                <TableCell>{text(item, 'admin_group', t('pages.settings.placeholders.adminGroup'))}</TableCell>
                <TableCell>{text(item, 'privilege_level', t('pages.settings.placeholders.privilegeLevel'))}</TableCell>
                <TableCell>{text(item, 'secrets_location', t('pages.settings.placeholders.secretsLocation'))}</TableCell>
                <TableCell>{text(item, 'description', t('pages.settings.placeholders.adminZoneDescription'))}</TableCell>
                <TableCell><Checkbox size="small" checked={!!item.deprecated} onChange={(e) => handleUpdate(item.localId, { deprecated: e.target.checked })} inputProps={{ 'aria-label': `${t('common:enumEditor.noLongerOffered')} ${item.label}` }} /></TableCell>
                <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                  {item.code && <TranslateButton label={item.label} onClick={() => translations.openTranslations({ item, onSave: (next) => handleUpdate(item.localId, { translations: next } as any) })} />}
                  <Button size="small" color="error" onClick={() => void removal.requestRemoval({ name: item.label || item.code, key: item.code ? { code: item.code } : null, onRemove: () => handleRemove(item.localId), onRetire: () => handleUpdate(item.localId, { deprecated: true }) })}>{t('common:enumEditor.remove')}</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
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
  operatingSystems: OperatingSystemOption[];
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
  operatingSystems: [],
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
  | { type: 'setOperatingSystems'; items: OperatingSystemOption[] }
  | { type: 'setConnectionTypes'; items: ConnectionTypeOption[] }
  | { type: 'setSubnets'; items: SubnetOption[] }
  | { type: 'setDomains'; items: DomainOption[] }
  | { type: 'resetEnum'; id: EnumListId }
  | { type: 'resetOperatingSystems' }
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
    enums[id] = withLocalIds(sortEnum(list), id);
  });
  return {
    enums,
    operatingSystems: withLocalIds(sortOperatingSystems(settings.operatingSystems || []), 'os'),
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
    case 'setOperatingSystems': {
      const baselineList = state.baseline?.operatingSystems || [];
      const dirtyFlag = !osListsEqual(stripLocalIds(action.items), baselineList);
      return { ...state, operatingSystems: action.items, dirty: { ...state.dirty, operatingSystems: dirtyFlag } };
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
      const baselineList = withLocalIds(sortEnum((state.baseline as any)[action.id] || []), action.id);
      return { ...state, enums: { ...state.enums, [action.id]: baselineList }, dirty: { ...state.dirty, [action.id]: false } };
    }
    case 'resetOperatingSystems': {
      if (!state.baseline) return state;
      const os = withLocalIds(sortOperatingSystems(state.baseline.operatingSystems || []), 'os');
      return { ...state, operatingSystems: os, dirty: { ...state.dirty, operatingSystems: false } };
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
      const currentList: any[] = action.id === 'operatingSystems' ? state.operatingSystems : action.id === 'connectionTypes' ? state.connectionTypes : action.id === 'subnets' ? state.subnets : action.id === 'domains' ? state.domains : state.enums[action.id as EnumListId] || [];
      const untouched = JSON.stringify(stripLocalIds(currentList)) === JSON.stringify(action.sent);
      const matchSaved = (row: any, index: number) => (row.code ? savedList.find((candidate) => candidate.code === row.code) : undefined) ?? savedList[index];
      const nextList = untouched
        ? currentList.map((row: any, index: number) => ({ ...(matchSaved(row, index) ?? row), localId: row.localId }))
        : currentList.map((row: any, index: number) => (!row.code && action.sent[index] && !action.sent[index].code && savedList[index]?.code ? { ...row, code: savedList[index].code } : row));
      const listState = action.id === 'operatingSystems' ? { operatingSystems: nextList } : action.id === 'connectionTypes' ? { connectionTypes: nextList } : action.id === 'subnets' ? { subnets: nextList } : action.id === 'domains' ? { domains: nextList } : { enums: { ...state.enums, [action.id]: nextList } };
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
  if (id === 'operatingSystems') return state.operatingSystems;
  if (id === 'connectionTypes') return state.connectionTypes;
  if (id === 'subnets') return state.subnets;
  if (id === 'domains') return state.domains;
  return state.enums[id as EnumListId] || [];
}

/** The list still holds exactly the rows the server refused: saving them again would be refused again. */
export function autosaveBlocked(state: SettingsState, id: ListId): boolean {
  const refused = state.rejected[id];
  return refused !== undefined && refused === JSON.stringify(stripLocalIds(listRows(state, id)));
}

// ============================================================================
// Main Component
// ============================================================================

export default function ItOperationsSettingsPage() {
  const { t } = useTranslation(['it', 'common']);
  const queryClient = useQueryClient();
  const { data, isError } = useItOpsSettings();
  const [state, dispatch] = React.useReducer(reducer, initialState);

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
    onSettled: () => dispatch({ type: 'setPending', id: null }),
  });

  const submitting = mutation.isPending;
  const errorMessage = state.errorMessage;

  const handleSaveEnum = (id: EnumListId) => {
    const current = state.enums[id] || [];
    const sorted = withLocalIds(sortEnum(current), id);
    dispatch({ type: 'setEnum', id, items: sorted });
    dispatch({ type: 'setPending', id });
    mutation.mutate({ id, rows: stripLocalIds(sorted) });
  };

  const handleSaveOperatingSystems = () => {
    const sorted = withLocalIds(sortOperatingSystems(state.operatingSystems), 'os');
    dispatch({ type: 'setOperatingSystems', items: sorted });
    dispatch({ type: 'setPending', id: 'operatingSystems' });
    mutation.mutate({ id: 'operatingSystems', rows: stripLocalIds(sorted) });
  };

  const handleSaveConnections = () => {
    const sorted = withLocalIds(sortConnectionTypes(state.connectionTypes), 'ct');
    dispatch({ type: 'setConnectionTypes', items: sorted });
    dispatch({ type: 'setPending', id: 'connectionTypes' });
    mutation.mutate({ id: 'connectionTypes', rows: stripLocalIds(sorted) });
  };

  const handleSaveSubnets = () => {
    const sorted = withLocalIds(sortSubnets(state.subnets), 'subnet');
    dispatch({ type: 'setSubnets', items: sorted });
    dispatch({ type: 'setPending', id: 'subnets' });
    mutation.mutate({ id: 'subnets', rows: stripLocalIds(sorted) });
  };

  const handleSaveDomains = () => {
    const sorted = withLocalIds(sortDomains(state.domains), 'domain');
    dispatch({ type: 'setDomains', items: sorted });
    dispatch({ type: 'setPending', id: 'domains' });
    mutation.mutate({ id: 'domains', rows: stripLocalIds(sorted) });
  };

  // Debounced autosave: each dirty list saves ~1.5s after the last edit, but
  // only once every row is complete — half-typed rows stay local until filled.
  // Codes are generated by the server; a list is sent once every name is present and the names are valid
  // (unique, not another row's code, no comma where the CSV serializes the list with commas).
  const listReadyToSave = (id: ListId): boolean => {
    if (id === 'subnets') return state.subnets.every((row) => String(row.cidr || '').trim() !== '');
    const rows: any[] = id === 'operatingSystems' ? state.operatingSystems : id === 'connectionTypes' ? state.connectionTypes : id === 'domains' ? state.domains : state.enums[id as EnumListId] || [];
    const skipCodes = new Set((state.baseline?.lockedCodes?.[id] || []).map((code) => code.toLowerCase()));
    return catalogListIssues(rows, { forbidComma: id === 'accessMethods', skipCodes }).size === 0;
  };

  React.useEffect(() => {
    if (submitting) return undefined;
    const dirtyIds = (Object.keys(state.dirty) as ListId[]).filter(
      (id) => state.dirty[id] && listReadyToSave(id) && !autosaveBlocked(state, id),
    );
    if (dirtyIds.length === 0) return undefined;
    const timer = setTimeout(() => {
      dirtyIds.forEach((id) => {
        if (id === 'operatingSystems') handleSaveOperatingSystems();
        else if (id === 'connectionTypes') handleSaveConnections();
        else if (id === 'subnets') handleSaveSubnets();
        else if (id === 'domains') handleSaveDomains();
        else handleSaveEnum(id);
      });
    }, 1500);
    return () => clearTimeout(timer);
  });

  // Locked rows come from the server (lifecycle statuses, system domains); protected rows are defaults it re-adds.
  const editorGuards = (id: EnumListId) => ({
    usageList: id,
    lockedCodes: state.baseline?.lockedCodes?.[id] ?? enumSections.find((section) => section.id === id)?.lockedCodes,
    protectedCodes: state.baseline?.protectedCodes?.[id],
  });

  const makeEmptyEnumRow = (id: EnumListId): ItOpsEnumOption => {
    if (id === 'hostingTypes') return { code: '', label: '', category: 'cloud', deprecated: false };
    if (id === 'serverKinds') return { code: '', label: '', is_physical: false, deprecated: false } as any;
    if (id === 'serverRoles') return { code: '', label: '', graph_tier: 'center', deprecated: false } as any;
    if (id === 'entities') return { code: '', label: '', graph_tier: 'top', deprecated: false } as any;
    return { code: '', label: '', deprecated: false };
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Box sx={{ pt: 1, pb: 1 }}>
        <PageHeader title={t('pages.settings.title')} />
      </Box>
      <Typography variant="body1" color="text.secondary">
        {t('pages.settings.description')}
      </Typography>
      {isError && <Alert severity="error">{t('pages.settings.loadFailed')}</Alert>}
      {state.successMessage && <Alert severity="success">{state.successMessage}</Alert>}
      {errorMessage && <Alert severity="error">{errorMessage}</Alert>}
      {data && <ClassificationCatalogSettings settings={data} />}
      <Stack spacing={3}>
        {listGroupIds.map((groupId, groupIndex) => {
          const groupEnumSections = enumSections.filter((section) => section.group === groupId);
          const extraSections = groupId === 'serversConnections'
            ? [{ id: 'connectionTypes' as const }, { id: 'domains' as const }, { id: 'operatingSystems' as const }, { id: 'subnets' as const }]
            : [];

          const groupSections = [...groupEnumSections, ...extraSections]
            .map((section) => ({ ...section, title: t(listTitleKey(section.id)) }))
            .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));

          return (
            <SettingsGroup key={groupId} title={t(`pages.settings.groups.${groupId}.title`)} subtitle={t(`pages.settings.groups.${groupId}.subtitle`)} showDivider={groupIndex > 0}>
              {groupSections.map((section) => {
                if (section.id === 'operatingSystems') {
                  return (
                    <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('operatingSystems'))}>
                      <SettingsControls
                        onAdd={() => dispatch({ type: 'setOperatingSystems', items: [{ code: '', label: '', standardSupportEnd: '', extendedSupportEnd: '', deprecated: false, localId: makeLocalId('os') }, ...state.operatingSystems] })}
                        saving={state.pending === 'operatingSystems' && submitting}
                        dirty={!!state.dirty.operatingSystems}
                      />
                      <OperatingSystemsEditor items={state.operatingSystems} onChange={(next) => dispatch({ type: 'setOperatingSystems', items: withLocalIds(next, 'os') })} hideAddButton />
                    </SettingsSection>
                  );
                }
                if (section.id === 'connectionTypes') {
                  return (
                    <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('connectionTypes'))}>
                      <SettingsControls
                        onAdd={() => dispatch({ type: 'setConnectionTypes', items: [{ category: '', label: '', code: '', typicalPorts: '', deprecated: false, localId: makeLocalId('ct') }, ...state.connectionTypes] })}
                        saving={state.pending === 'connectionTypes' && submitting}
                        dirty={!!state.dirty.connectionTypes}
                      />
                      <ConnectionTypesEditor items={state.connectionTypes} onChange={(next) => dispatch({ type: 'setConnectionTypes', items: withLocalIds(next, 'ct') })} />
                    </SettingsSection>
                  );
                }
                if (section.id === 'subnets') {
                  const defaultLocationId = locations?.[0]?.id || '';
                  return (
                    <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('subnets'))}>
                      <SettingsControls
                        onAdd={() => dispatch({ type: 'setSubnets', items: [{ location_id: defaultLocationId, cidr: '', vlan_number: undefined, network_zone: 'lan', description: '', deprecated: false, localId: makeLocalId('subnet') }, ...state.subnets] })}
                        saving={state.pending === 'subnets' && submitting}
                        dirty={!!state.dirty.subnets}
                      />
                      <SubnetsEditor items={state.subnets} networkZones={state.enums.networkSegments || []} locations={locations || []} onChange={(next) => dispatch({ type: 'setSubnets', items: withLocalIds(next, 'subnet') })} />
                    </SettingsSection>
                  );
                }
                if (section.id === 'domains') {
                  return (
                    <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('domains'))}>
                      <SettingsControls
                        onAdd={() => dispatch({ type: 'setDomains', items: [{ code: '', label: '', dns_suffix: '', deprecated: false, system: false, localId: makeLocalId('domain') }, ...state.domains] })}
                        saving={state.pending === 'domains' && submitting}
                        dirty={!!state.dirty.domains}
                      />
                      <DomainsEditor items={state.domains} onChange={(next) => dispatch({ type: 'setDomains', items: withLocalIds(next, 'domain') })} />
                    </SettingsSection>
                  );
                }

                const enumSection = section as EnumSectionConfig & { title: string };
                const items = state.enums[enumSection.id] || [];
                const dirty = !!state.dirty[enumSection.id];
                const saving = state.pending === enumSection.id && submitting;

                return (
                  <SettingsSection key={enumSection.id} title={enumSection.title} description={t(listUsageKey(enumSection.id))}>
                    <SettingsControls
                      onAdd={() => dispatch({ type: 'setEnum', id: enumSection.id, items: [{ ...makeEmptyEnumRow(enumSection.id), localId: makeLocalId(enumSection.id) }, ...items] })}
                      saving={saving}
                      dirty={dirty}
                    />
                    {enumSection.kind === 'hosting' ? (
                      <HostingTypeEditor items={items as HostingTypeItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton {...editorGuards(enumSection.id)} />
                    ) : enumSection.kind === 'serverKind' ? (
                      <AssetKindEditor items={items as AssetKindItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton {...editorGuards(enumSection.id)} />
                    ) : enumSection.kind === 'serverRole' ? (
                      <ServerRoleEditor items={items as ServerRoleItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton {...editorGuards(enumSection.id)} />
                    ) : enumSection.kind === 'adminZone' ? (
                      <AdminZonesEditor items={items as AdminZoneOption[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} />
                    ) : enumSection.kind === 'entity' ? (
                      <EntityEditor items={items as EntityItem[]} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton {...editorGuards(enumSection.id)} />
                    ) : (
                      <EnumEditor title={enumSection.title} description={t(listDescriptionKey(enumSection.id))} items={items} onChange={(next) => dispatch({ type: 'setEnum', id: enumSection.id, items: withLocalIds(next, enumSection.id) })} hideAddButton forbidComma={enumSection.id === 'accessMethods'} {...editorGuards(enumSection.id)} />
                    )}
                  </SettingsSection>
                );
              })}
            </SettingsGroup>
          );
        })}
      </Stack>
    </Box>
  );
}
