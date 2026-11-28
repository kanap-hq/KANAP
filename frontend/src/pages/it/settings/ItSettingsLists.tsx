import React from 'react';
import { Box, Stack, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  AssetKindEditor,
  EntityEditor,
  EnumEditor,
  HostingTypeEditor,
  ServerRoleEditor,
  SettingsControls,
  SettingsGroup,
  SettingsPage,
  SettingsSection,
  useSettingsAutosave,
} from '../../../components/settings';
import type { AssetKindItem, EntityItem, HostingTypeItem, ServerRoleItem } from '../../../components/settings';
import { catalogListIssues } from '../../../components/settings/catalogValidation';
import { useAuth } from '../../../auth/AuthContext';
import useItOpsSettings from '../../../hooks/useItOpsSettings';
import { useLocationOptions } from '../../../hooks/useLocationOptions';
import { autosaveErrorMessage, isTransientSaveFailure } from '../../../hooks/useAutosave';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { updateItOpsSettings, type AdminZoneOption, type ItOpsEnumOption, type ItOpsSettings } from '../../../services/itOpsSettings';
import ClassificationCatalogSettings from '../components/ClassificationCatalogSettings';
import { AdminZonesEditor } from './AdminZonesEditor';
import { ConnectionTypesEditor } from './ConnectionTypesEditor';
import { DomainsEditor } from './DomainsEditor';
import { SubnetsEditor } from './SubnetsEditor';
import { makeLocalId, stripLocalIds, withLocalIds } from './editorParts';
import {
  initialState,
  listRows,
  reducer,
  sameAsStored,
  sendableRows,
  type Action,
  type EnumListId,
  type ListId,
  type SettingsState,
} from './listsState';

type GroupId = 'locations' | 'serversConnections' | 'appsInterfaces' | 'incidents';

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

const listTitleKey = (id: ListId) => `pages.settings.lists.${id}.title`;
const listDescriptionKey = (id: ListId) => `pages.settings.lists.${id}.description`;
const listUsageKey = (id: ListId) => `pages.settings.lists.${id}.usage`;
/** Lists whose purpose the rows do not show: their description goes in a tooltip beside the title. */
const HINTED_LISTS: ReadonlySet<ListId> = new Set<ListId>([
  'adminZones', 'domains', 'entities', 'hostingTypes', 'lifecycleStates', 'serverKinds', 'serverRoles', 'technologyFamilies',
]);

/**
 * The page's own checks before a list is sent: every name given and valid (unique, not another
 * row's code, no comma where the CSV serializes the list with commas); a subnet needs its CIDR.
 */
function listReady(state: SettingsState, id: ListId, rows: any[]): boolean {
  if (id === 'subnets') return rows.every((row) => String(row.cidr || '').trim() !== '');
  const skipCodes = new Set((state.baseline?.lockedCodes?.[id] || []).map((code) => code.toLowerCase()));
  return catalogListIssues(rows, { forbidComma: id === 'accessMethods', skipCodes }).size === 0;
}

type ItSettingsListsProps = {
  title: string;
  /** The page's tab row. */
  tabs: React.ReactNode;
  /** The Lists tab is the one on screen; otherwise the lists stay mounted, hidden, under `netbox`. */
  listsShown: boolean;
  netbox: React.ReactNode;
};

/**
 * The lists of the IT landscape settings. One autosave for the page, one field per list: a change
 * sends the list alone (`PATCH`) once its rows pass the checks, a text after its delay or when the
 * field loses the focus. A refused save shows the stored rows again and the refusal under the list.
 */
export default function ItSettingsLists({ title, tabs, listsShown, netbox }: ItSettingsListsProps) {
  const { t } = useTranslation(['it', 'common']);
  const listHint = (id: ListId) => (HINTED_LISTS.has(id) ? t(listDescriptionKey(id)) : undefined);
  const { hasLevel } = useAuth();
  const readOnly = !hasLevel('settings', 'admin');
  const queryClient = useQueryClient();
  const { data, isError } = useItOpsSettings();
  const autosave = useSettingsAutosave();
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
  const hasDrafts = Object.values(state.dirty).some(Boolean) || autosave.isBusy();
  React.useEffect(() => {
    if (!data) return;
    if (state.baseline === null || (!hasDrafts && data !== state.baseline)) dispatch({ type: 'hydrate', payload: data });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // The save of a list reads its rows when it runs: a save waiting behind another one of the same
  // list then sends the codes the first one brought back.
  const saveOf = React.useCallback((id: ListId) => async () => {
    const rows = sendableRows(latestStateRef.current, id);
    if (!listReady(latestStateRef.current, id, rows) || sameAsStored(latestStateRef.current, id, rows)) return;
    try {
      const next = await updateItOpsSettings({ [id]: stripLocalIds(rows) } as Partial<ItOpsSettings>);
      queryClient.setQueryData(['it-ops-settings'], next);
      dispatch({ type: 'saved', id, sent: rows, saved: next });
    } catch (error) {
      if (!isTransientSaveFailure(error)) dispatch({ type: 'revertList', id });
      throw error;
    }
  }, [dispatch, queryClient]);

  /** A list changed: it waits to be sent (a text) or goes at once (a choice), unless the checks refuse it. */
  const changeList = React.useCallback((id: ListId, items: any[], how: 'type' | 'choose' = 'type') => {
    if (readOnly) return;
    dispatch({ type: 'setList', id, items });
    const current = latestStateRef.current;
    const rows = sendableRows(current, id);
    const save = listReady(current, id, rows) && !sameAsStored(current, id, rows) ? saveOf(id) : null;
    if (how === 'choose') autosave.choose(id, save);
    else autosave.type(id, save);
  }, [autosave, dispatch, readOnly, saveOf]);

  const refusal = (id: ListId) => {
    const error = autosave.errorOf(id);
    if (!error) return null;
    return <Typography role="alert" sx={{ fontSize: 12, color: 'kanap.danger', mt: 1 }}>{getApiErrorMessage(error, t, t('pages.settings.updateFailed'))}</Typography>;
  };

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

  /** A new row on top of a list whose editor has its add button above it. */
  const addOnTop = (id: ListId, row: Record<string, unknown>) => changeList(id, [{ ...row, localId: makeLocalId(id) }, ...listRows(latestStateRef.current, id)]);

  return (
    <SettingsPage
      title={title}
      tabs={tabs}
      status={autosave.status}
      readOnly={readOnly}
      loading={listsShown && !data && !isError}
      error={listsShown && isError ? t('pages.settings.loadFailed') : undefined}
    >
      {/* Kept mounted while hidden: a list draft not yet saved survives a visit to the Netbox tab. */}
      <Box sx={{ display: listsShown ? 'flex' : 'none', flexDirection: 'column', gap: 2 }}>
        {!!autosave.error && <Typography role="alert" sx={{ fontSize: 12, color: 'kanap.danger' }}>{autosaveErrorMessage(autosave.error, t, t('pages.settings.updateFailed'))}</Typography>}
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
                        <SettingsControls onAdd={() => addOnTop('connectionTypes', { category: '', label: '', code: '', typicalPorts: '', deprecated: false })} readOnly={readOnly} />
                        <Box onBlur={autosave.commit}>
                          <ConnectionTypesEditor items={state.connectionTypes} onChange={(next) => changeList('connectionTypes', withLocalIds(next, 'ct'))} readOnly={readOnly} />
                        </Box>
                        {refusal('connectionTypes')}
                      </SettingsSection>
                    );
                  }
                  if (section.id === 'subnets') {
                    const defaultLocationId = locations?.[0]?.id || '';
                    return (
                      <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('subnets'))}>
                        <SettingsControls onAdd={() => addOnTop('subnets', { location_id: defaultLocationId, cidr: '', vlan_number: undefined, network_zone: 'lan', description: '', deprecated: false })} readOnly={readOnly} />
                        <Box onBlur={autosave.commit}>
                          <SubnetsEditor items={state.subnets} networkZones={state.enums.networkSegments || []} locations={locations || []} onChange={(next) => changeList('subnets', withLocalIds(next, 'subnet'))} readOnly={readOnly} />
                        </Box>
                        {refusal('subnets')}
                      </SettingsSection>
                    );
                  }
                  if (section.id === 'domains') {
                    return (
                      <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('domains'))} hint={listHint('domains')}>
                        <SettingsControls onAdd={() => addOnTop('domains', { code: '', label: '', dns_suffix: '', deprecated: false, system: false })} readOnly={readOnly} />
                        <Box onBlur={autosave.commit}>
                          <DomainsEditor items={state.domains} onChange={(next) => changeList('domains', withLocalIds(next, 'domain'))} readOnly={readOnly} />
                        </Box>
                        {refusal('domains')}
                      </SettingsSection>
                    );
                  }

                  const enumSection = section as EnumSectionConfig & { title: string };
                  const id = enumSection.id;
                  const items = state.enums[id] || [];
                  const exampleKey = nameExampleKey[id];
                  const namePlaceholder = exampleKey ? t(`pages.settings.placeholders.${exampleKey}`) : undefined;
                  const onChange = (next: any[]) => changeList(id, withLocalIds(next, id));

                  return (
                    <SettingsSection key={id} title={enumSection.title} description={t(listUsageKey(id))} hint={listHint(id)}>
                      <SettingsControls onAdd={() => addOnTop(id, makeEmptyEnumRow(id))} readOnly={readOnly} />
                      <Box onBlur={autosave.commit}>
                        {enumSection.kind === 'hosting' ? (
                          <HostingTypeEditor items={items as HostingTypeItem[]} onChange={onChange} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(id)} />
                        ) : enumSection.kind === 'serverKind' ? (
                          <AssetKindEditor items={items as AssetKindItem[]} onChange={onChange} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(id)} />
                        ) : enumSection.kind === 'serverRole' ? (
                          <ServerRoleEditor items={items as ServerRoleItem[]} onChange={onChange} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(id)} />
                        ) : enumSection.kind === 'adminZone' ? (
                          <AdminZonesEditor items={items as AdminZoneOption[]} onChange={onChange} readOnly={readOnly} />
                        ) : enumSection.kind === 'entity' ? (
                          <EntityEditor items={items as EntityItem[]} onChange={onChange} hideAddButton namePlaceholder={namePlaceholder} {...editorGuards(id)} />
                        ) : (
                          <EnumEditor items={items} onChange={onChange} hideAddButton namePlaceholder={namePlaceholder} forbidComma={id === 'accessMethods'} {...editorGuards(id)} />
                        )}
                      </Box>
                      {refusal(id)}
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
