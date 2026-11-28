import React from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  EnumEditor,
  graphTierColumn,
  hostingCategoryColumn,
  nameColumn,
  physicalColumn,
  retiredColumn,
  shownCatalogName,
  SettingsControls,
  SettingsGroup,
  SettingsPage,
  SettingsSection,
  useSettingsAutosave,
} from '../../../components/settings';
import type { EnumEditorColumn, EnumItem } from '../../../components/settings';
import { catalogEditorIssues, catalogListIssues } from '../../../components/settings/catalogValidation';
import { useCatalogLocale } from '../../../hooks/useLocalizedTaskTypes';
import { catalogDefaults } from '../../../utils/itOpsSettingsLocalization';
import type { CatalogLocale } from '../../../services/itOpsSettings';
import type { TFunction } from 'i18next';
import { useKanapDialogs } from '../../../components/design';
import { useNotify } from '../../../components/notify/NotifyProvider';
import { useAuth } from '../../../auth/AuthContext';
import useItOpsSettings from '../../../hooks/useItOpsSettings';
import { useLocationOptions } from '../../../hooks/useLocationOptions';
import { autosaveErrorMessage, isTransientSaveFailure } from '../../../hooks/useAutosave';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { resetItOpsSettingsToDefaults, updateItOpsSettings, type AdminZoneOption, type ItOpsSettings } from '../../../services/itOpsSettings';
import ClassificationCatalogSettings from '../components/ClassificationCatalogSettings';
import { AdminZonesEditor } from './AdminZonesEditor';
import { ConnectionTypesEditor } from './ConnectionTypesEditor';
import { DomainsEditor } from './DomainsEditor';
import { SubnetsEditor } from './SubnetsEditor';
import { focusAddedRow, makeLocalId, stripLocalIds, withLocalIds } from './editorParts';
import {
  enumListIds,
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

/** Every list of the page, each one a field of the page's autosave. */
const ALL_LISTS: ListId[] = [...enumListIds, 'connectionTypes', 'subnets', 'domains'];

/** The lists of the list editor: every list of values but the custom ones. */
const EDITOR_LISTS: ReadonlySet<ListId> = new Set(enumSections.filter((section) => section.kind !== 'adminZone').map((section) => section.id));

/**
 * The page's own checks before a list is sent: every name given and valid (unique, not another
 * row's code, no comma where the CSV serializes the list with commas); in the list editor, no two
 * values shown with the same name in the person's language either. A subnet needs its CIDR.
 */
function listReady(state: SettingsState, id: ListId, rows: any[], locale: CatalogLocale): boolean {
  if (id === 'subnets') return rows.every((row) => String(row.cidr || '').trim() !== '');
  const skipCodes = new Set((state.baseline?.lockedCodes?.[id] || []).map((code) => code.toLowerCase()));
  const options = { forbidComma: id === 'accessMethods', skipCodes };
  if (!EDITOR_LISTS.has(id)) return catalogListIssues(rows, options).size === 0;
  const defaults = catalogDefaults(id as EnumListId);
  return catalogEditorIssues(rows, (row) => shownCatalogName(row as EnumItem, locale, defaults), options).size === 0;
}

/** The columns of a list in the list editor: the name, the list's own columns, then "Stop offering". */
function editorColumns(kind: EnumSectionConfig['kind'], t: TFunction, placeholder?: string): EnumEditorColumn<any>[] | undefined {
  if (kind === 'hosting') return [nameColumn(t, '35%', placeholder), hostingCategoryColumn(t, '35%'), retiredColumn(t, '15%')];
  if (kind === 'serverKind') return [nameColumn(t, '45%', placeholder), physicalColumn(t, '15%'), retiredColumn(t, '20%')];
  if (kind === 'serverRole') return [nameColumn(t, '40%', placeholder), graphTierColumn(t, 'center', '25%'), retiredColumn(t, '15%')];
  if (kind === 'entity') return [nameColumn(t, '40%', placeholder), graphTierColumn(t, 'top', '25%'), retiredColumn(t, '15%')];
  return undefined;
}

/** The other fields of a new row of a list. */
function newRowOf(kind: EnumSectionConfig['kind']): Record<string, unknown> {
  if (kind === 'hosting') return { category: 'cloud' };
  if (kind === 'serverKind') return { is_physical: false };
  if (kind === 'serverRole') return { graph_tier: 'center' };
  if (kind === 'entity') return { graph_tier: 'top' };
  return {};
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
  const { t: tc } = useTranslation('common');
  const locale = useCatalogLocale();
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
    if (!listReady(latestStateRef.current, id, rows, locale) || sameAsStored(latestStateRef.current, id, rows)) return;
    try {
      const next = await updateItOpsSettings({ [id]: stripLocalIds(rows) } as Partial<ItOpsSettings>);
      queryClient.setQueryData(['it-ops-settings'], next);
      dispatch({ type: 'saved', id, sent: rows, saved: next });
    } catch (error) {
      if (!isTransientSaveFailure(error)) dispatch({ type: 'revertList', id });
      throw error;
    }
  }, [dispatch, locale, queryClient]);

  /** A list changed: it waits to be sent (a text) or goes at once (a choice), unless the checks refuse it. */
  const changeList = React.useCallback((id: ListId, items: any[], how: 'type' | 'choose' = 'type') => {
    if (readOnly) return;
    dispatch({ type: 'setList', id, items });
    const current = latestStateRef.current;
    const rows = sendableRows(current, id);
    const save = listReady(current, id, rows, locale) && !sameAsStored(current, id, rows) ? saveOf(id) : null;
    if (how === 'choose') autosave.choose(id, save);
    else autosave.type(id, save);
  }, [autosave, dispatch, locale, readOnly, saveOf]);

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

  // Restore the default lists: what waits is sent first, then every list takes the server's answer.
  const dialogs = useKanapDialogs();
  const notify = useNotify();
  const [restoring, setRestoring] = React.useState(false);
  const restore = async () => {
    const confirmed = await dialogs.confirm({
      title: t('pages.settings.restore.title'),
      message: t('pages.settings.restore.message'),
      confirmLabel: t('pages.settings.restore.confirm'),
    });
    if (!confirmed) return;
    setRestoring(true);
    try {
      await autosave.flush();
      const next = await resetItOpsSettingsToDefaults();
      queryClient.setQueryData(['it-ops-settings'], next);
      dispatch({ type: 'hydrate', payload: next });
      // Every list now shows what is stored: a refusal kept from before the restore no longer applies.
      for (const id of ALL_LISTS) autosave.choose(id, null);
      void queryClient.invalidateQueries({ queryKey: ['it-ops-catalog-labels'] });
      void queryClient.invalidateQueries({ queryKey: ['application-classification-catalog'] });
      notify({ message: t('pages.settings.restore.done'), tone: 'success' });
    } catch (error) {
      notify({ message: getApiErrorMessage(error, t, t('pages.settings.restore.failed')), tone: 'info' });
    } finally {
      setRestoring(false);
    }
  };

  /** A new row on top of the administration zones, whose order says how sensitive each zone is. */
  const addOnTop = (id: ListId, row: Record<string, unknown>) => changeList(id, [{ ...row, localId: makeLocalId(id) }, ...listRows(latestStateRef.current, id)]);
  // The editors of connection types, domains and subnets: a new row goes at the bottom, the cursor in it.
  const editorBoxes = React.useRef<Partial<Record<ListId, HTMLElement | null>>>({});
  const addAtBottom = (id: 'connectionTypes' | 'domains' | 'subnets', row: Record<string, unknown>) => {
    changeList(id, [...listRows(latestStateRef.current, id), { ...row, localId: makeLocalId(id) }]);
    focusAddedRow(editorBoxes.current[id] ?? null, t('common:enumEditor.name'));
  };

  return (
    <SettingsPage
      title={title}
      tabs={tabs}
      status={autosave.status}
      actions={listsShown && data ? <Button variant="action" onClick={() => void restore()} disabled={restoring}>{t('pages.settings.restore.action')}</Button> : undefined}
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
                        <SettingsControls onAdd={() => addAtBottom('connectionTypes', { category: '', label: '', code: '', typicalPorts: '', deprecated: false })} readOnly={readOnly} />
                        <Box ref={(el: HTMLElement | null) => { editorBoxes.current.connectionTypes = el; }} onBlur={autosave.commit}>
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
                        <SettingsControls onAdd={() => addAtBottom('subnets', { location_id: defaultLocationId, cidr: '', vlan_number: undefined, network_zone: 'lan', description: '', deprecated: false })} readOnly={readOnly} />
                        <Box ref={(el: HTMLElement | null) => { editorBoxes.current.subnets = el; }} onBlur={autosave.commit}>
                          <SubnetsEditor items={state.subnets} networkZones={state.enums.networkSegments || []} locations={locations || []} onChange={(next) => changeList('subnets', withLocalIds(next, 'subnet'))} readOnly={readOnly} />
                        </Box>
                        {refusal('subnets')}
                      </SettingsSection>
                    );
                  }
                  if (section.id === 'domains') {
                    return (
                      <SettingsSection key={section.id} title={section.title} description={t(listUsageKey('domains'))} hint={listHint('domains')}>
                        <SettingsControls onAdd={() => addAtBottom('domains', { code: '', label: '', dns_suffix: '', deprecated: false, system: false })} readOnly={readOnly} />
                        <Box ref={(el: HTMLElement | null) => { editorBoxes.current.domains = el; }} onBlur={autosave.commit}>
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

                  if (enumSection.kind === 'adminZone') {
                    return (
                      <SettingsSection key={id} title={enumSection.title} description={t(listUsageKey(id))} hint={listHint(id)}>
                        <SettingsControls onAdd={() => addOnTop(id, { code: '', label: '', deprecated: false })} readOnly={readOnly} />
                        <Box onBlur={autosave.commit}>
                          <AdminZonesEditor items={items as AdminZoneOption[]} onChange={(next) => changeList(id, withLocalIds(next, id))} readOnly={readOnly} />
                        </Box>
                        {refusal(id)}
                      </SettingsSection>
                    );
                  }

                  return (
                    <SettingsSection key={id} title={enumSection.title} description={t(listUsageKey(id))} hint={listHint(id)}>
                      <EnumEditor
                        items={items}
                        onChange={(next, how) => changeList(id, withLocalIds(next, id), how)}
                        onCommit={autosave.commit}
                        columns={editorColumns(enumSection.kind, tc, namePlaceholder)}
                        newRow={() => newRowOf(enumSection.kind)}
                        namePlaceholder={namePlaceholder}
                        defaults={catalogDefaults(id)}
                        forbidComma={id === 'accessMethods'}
                        {...editorGuards(id)}
                      />
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
