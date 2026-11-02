import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import DeleteIcon from '@mui/icons-material/Delete';
import CloseIcon from '@mui/icons-material/Close';
import api from '../../../api';
import { KanapDialog, PropertyRow, StatusDot } from '../../../components/design';
import useItOpsEnumOptions from '../../../hooks/useItOpsEnumOptions';
import useApplicationClassificationCatalog from '../../../hooks/useApplicationClassificationCatalog';
import {
  drawerAutocompleteListboxSx,
  drawerFieldValueSx,
  drawerMenuItemSx,
  drawerSelectSx,
} from '../../../theme/formSx';
import { getDotColor, LIFECYCLE_COLORS } from '../../../utils/statusColors';

import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
import { environmentLabel } from '../../../utils/applicationEnvironments';
import { interfaceRouteIntro, legTypeLabel } from '../../../utils/interfaceLegType';
const ENVIRONMENTS = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'] as const;

type InterfaceLeg = {
  id: string;
  interface_id: string;
  leg_type: 'extract' | 'transform' | 'load' | 'direct';
  from_role: string;
  to_role: string;
  trigger_type: string;
  integration_pattern: string;
  data_format: string;
  job_name: string | null;
  order_index: number;
};

type BindingRow = {
  id: string;
  interface_id: string;
  interface_leg_id: string;
  leg_type: string;
  order_index: number;
  environment: string;
  source_instance_id: string;
  target_instance_id: string;
  status: string;
  source_endpoint: string | null;
  target_endpoint: string | null;
  trigger_details: string | null;
  env_job_name: string | null;
  authentication_mode: string | null;
  monitoring_url: string | null;
  env_notes: string | null;
  integration_tool_application_id: string | null;
  created_at: string;
  updated_at: string;
  source_application_id: string;
  target_application_id: string;
};

type AppInstanceOption = {
  id: string;
  application_id: string;
  environment: string;
  lifecycle?: string | null;
  status?: string | null;
  base_url?: string | null;
  region?: string | null;
  zone?: string | null;
};

type IntegrationToolOption = {
  id: string;
  label: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  connection_reference: string;
  topology?: string | null;
  lifecycle?: string | null;
  criticality?: string | null;
};

type BindingConnection = {
  id: string;
  interface_binding_id: string;
  connection_id: string;
  notes: string | null;
  connection: {
    id: string;
    connection_reference: string;
    name: string;
    topology: 'server_to_server' | 'multi_server';
    lifecycle: string;
    criticality: string;
    data_class: string;
    contains_pii: boolean;
  };
};

type Props = {
  interfaceId: string;
  canManage: boolean;
  interfaceName?: string | null;
  sourceApplicationId: string;
  targetApplicationId: string;
  sourceApplicationName?: string | null;
  targetApplicationName?: string | null;
  middlewareApplicationIds: string[];
  legs: InterfaceLeg[];
  integrationRouteType: 'direct' | 'via_middleware';
};

type BindingDialogState = {
  mode: 'create' | 'edit';
  environment: string;
  leg: InterfaceLeg;
  bindingId?: string;
  source_instance_id: string | null;
  target_instance_id: string | null;
  status: string;
  source_endpoint: string;
  target_endpoint: string;
  trigger_details: string;
  env_job_name: string;
  authentication_mode: string | null;
  monitoring_url: string;
  env_notes: string;
  integration_tool_application_id: string | null;
};

type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type BindingAutosavePatch = Partial<
  Pick<
    BindingRow,
    | 'source_instance_id'
    | 'target_instance_id'
    | 'status'
    | 'source_endpoint'
    | 'target_endpoint'
    | 'trigger_details'
    | 'env_job_name'
    | 'authentication_mode'
    | 'monitoring_url'
    | 'env_notes'
    | 'integration_tool_application_id'
  >
>;

function getRoleLabel(t: TFunction, role: string, sourceName?: string | null, targetName?: string | null): string {
  const r = String(role || '').toLowerCase();
  if (r === 'source') return sourceName || t('it:workspace.interface.flow.source');
  if (r === 'target') return targetName || t('it:workspace.interface.flow.target');
  if (r === 'middleware') return t('it:workspace.interface.flow.middleware');
  return role || '';
}

const DEFAULT_AUTH_OPTIONS = [
  { code: 'service_account', labelKey: 'serviceAccount' },
  { code: 'oauth2', labelKey: 'oauth2' },
  { code: 'api_key', labelKey: 'apiKey' },
  { code: 'certificate', labelKey: 'certificate' },
  { code: 'none', labelKey: 'none' },
];

function formatInstanceOption(
  t: TFunction,
  instance: AppInstanceOption,
  role: string,
  sourceName?: string | null,
  targetName?: string | null,
) {
  const roleLabel = getRoleLabel(t, role, sourceName, targetName);
  const details = [instance.base_url, instance.region, instance.zone].filter(Boolean).join(' / ');
  return [roleLabel, environmentLabel(t, instance.environment), details || instance.id.slice(0, 8)]
    .filter(Boolean)
    .join(' - ');
}

function formatConnectionOption(option: ConnectionOption | null | undefined) {
  if (!option) return '';
  return [option.connection_reference, option.name].filter(Boolean).join(' · ');
}

function topologyLabel(t: TFunction, value: string | null | undefined): string {
  if (value === 'server_to_server') return t('it:enums.topology.serverToServer');
  if (value === 'multi_server') return t('it:enums.topology.multiServer');
  return value || '';
}

function connectionOptionFromLink(link: BindingConnection): ConnectionOption {
  return {
    id: link.connection.id,
    name: link.connection.name,
    connection_reference: link.connection.connection_reference,
    topology: link.connection.topology,
    lifecycle: link.connection.lifecycle,
    criticality: link.connection.criticality,
  };
}

const panelFormGridSx = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  rowGap: 0.5,
} as const;

export default function InterfaceBindingsMatrix({
  interfaceId,
  canManage,
  interfaceName,
  sourceApplicationId,
  targetApplicationId,
  sourceApplicationName,
  targetApplicationName,
  middlewareApplicationIds,
  legs,
  integrationRouteType,
}: Props) {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const { t } = useTranslation(['it', 'common']);
  const theme = useTheme();
  const { byField, labelFor } = useItOpsEnumOptions();
  const lifecycleOptions = React.useMemo(() => {
    const list = byField.lifecycleStatus || [];
    if (list.length === 0) return [{ label: t('common:statuses.active'), value: 'active' }];
    return list.map((item) => ({
      value: item.code,
      label: item.deprecated ? t('it:common.deprecatedOption', { label: item.label }) : item.label,
    }));
  }, [byField.lifecycleStatus, t]);
  const [bindings, setBindings] = React.useState<BindingRow[]>([]);
  const [instancesByAppId, setInstancesByAppId] = React.useState<Record<string, AppInstanceOption[]>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [linksByBindingId, setLinksByBindingId] = React.useState<Record<string, BindingConnection[]>>({});
  const [linksLoadingBindingId, setLinksLoadingBindingId] = React.useState<string | null>(null);
  const [bindingConnectionSearch, setBindingConnectionSearch] = React.useState('');
  const [bindingConnectionOptions, setBindingConnectionOptions] = React.useState<ConnectionOption[]>([]);
  const [bindingConnectionLoading, setBindingConnectionLoading] = React.useState(false);
  const [selectedBindingConnection, setSelectedBindingConnection] = React.useState<ConnectionOption | null>(null);
  const [bindingConnectionDirty, setBindingConnectionDirty] = React.useState(false);
  const [bindingPanelOpen, setBindingPanelOpen] = React.useState(false);
  const [dialogState, setDialogState] = React.useState<BindingDialogState | null>(null);
  const [bindingSaving, setBindingSaving] = React.useState(false);
  const [autosaveStatus, setAutosaveStatus] = React.useState<AutosaveStatus>('idle');
  const [manualEnvs, setManualEnvs] = React.useState<string[]>([]);
  const [envDialogOpen, setEnvDialogOpen] = React.useState(false);
  const [envDraft, setEnvDraft] = React.useState<string>('');
  const [pendingDeleteBinding, setPendingDeleteBinding] = React.useState<BindingRow | null>(null);
  const [pendingDeleteEnvironment, setPendingDeleteEnvironment] = React.useState<string | null>(null);
  const autosaveRequestRef = React.useRef(0);

  const appIds = React.useMemo(() => {
    const ids = new Set<string>();
    if (sourceApplicationId) ids.add(sourceApplicationId);
    if (targetApplicationId) ids.add(targetApplicationId);
    for (const mid of middlewareApplicationIds || []) {
      if (mid) ids.add(mid);
    }
    return Array.from(ids);
  }, [sourceApplicationId, targetApplicationId, middlewareApplicationIds]);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [bindingsRes, ...instanceRes] = await Promise.all([
        api.get<{ items: BindingRow[] }>(`/interfaces/${interfaceId}/bindings`),
        ...appIds.map((appId) => api.get<AppInstanceOption[]>(`/applications/${appId}/instances`).then((r) => r.data as any)),
      ]);
      setBindings((bindingsRes.data?.items || []) as BindingRow[]);
      const nextInstances: Record<string, AppInstanceOption[]> = {};
      appIds.forEach((appId, idx) => {
        const list = instanceRes[idx] || [];
        nextInstances[appId] = list;
      });
      setInstancesByAppId(nextInstances);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadBindingsFailed')));
    } finally {
      setLoading(false);
    }
  }, [interfaceId, appIds]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const fetchLinksForBinding = React.useCallback(async (bindingId: string) => {
    const res = await api.get<{ items: BindingConnection[] }>(`/interface-bindings/${bindingId}/connection-links`);
    const items = res.data.items || [];
    setLinksByBindingId((prev) => ({ ...prev, [bindingId]: items }));
    return items;
  }, []);

  const loadLinksForBinding = React.useCallback(
    async (bindingId: string) => {
      setLinksLoadingBindingId(bindingId);
      try {
        await fetchLinksForBinding(bindingId);
      } catch {
        // The matrix leaves the connection summary empty when the links fail to load.
      } finally {
        setLinksLoadingBindingId((prev) => (prev === bindingId ? null : prev));
      }
    },
    [fetchLinksForBinding],
  );

  const usedEnvs = React.useMemo(() => {
    const set = new Set<string>();
    for (const env of manualEnvs) {
      if (env) set.add(env);
    }
    for (const b of bindings) {
      if (b.environment) set.add(b.environment);
    }
    return set;
  }, [bindings, manualEnvs]);

  const candidateEnvs = React.useMemo(() => {
    const envsByAppId: Record<string, Set<string>> = {};
    for (const [appId, list] of Object.entries(instancesByAppId)) {
      const envSet = new Set<string>();
      for (const inst of list) {
        if (inst.environment) envSet.add(inst.environment);
      }
      envsByAppId[appId] = envSet;
    }

    const sourceEnvs = envsByAppId[sourceApplicationId] || new Set<string>();
    const targetEnvs = envsByAppId[targetApplicationId] || new Set<string>();

    const result = new Set<string>();

    if (!sourceApplicationId || !targetApplicationId) {
      return [] as string[];
    }

    if (integrationRouteType === 'direct') {
      for (const env of sourceEnvs) {
        if (targetEnvs.has(env)) result.add(env);
      }
    } else {
      const middlewareEnvUnion = new Set<string>();
      for (const mid of middlewareApplicationIds || []) {
        const envs = envsByAppId[mid];
        if (!envs) continue;
        for (const env of envs) {
          middlewareEnvUnion.add(env);
        }
      }
      for (const env of sourceEnvs) {
        if (targetEnvs.has(env) && middlewareEnvUnion.has(env)) {
          result.add(env);
        }
      }
    }

    const ordered: string[] = ENVIRONMENTS.filter((e) => result.has(e));
    for (const e of Array.from(result)) {
      if (!ENVIRONMENTS.includes(e as any)) ordered.push(e);
    }
    return ordered;
  }, [instancesByAppId, integrationRouteType, middlewareApplicationIds, sourceApplicationId, targetApplicationId]);

  const selectableEnvs = React.useMemo(
    () => candidateEnvs.filter((env) => !usedEnvs.has(env)),
    [candidateEnvs, usedEnvs],
  );

  const allEnvs = React.useMemo(() => {
    const envList: string[] = ENVIRONMENTS.filter((e) => usedEnvs.has(e));
    for (const e of Array.from(usedEnvs)) {
      if (!ENVIRONMENTS.includes(e as any)) envList.push(e);
    }
    return envList;
  }, [usedEnvs]);

  const instancesById = React.useMemo(() => {
    const map: Record<string, AppInstanceOption> = {};
    for (const list of Object.values(instancesByAppId)) {
      for (const inst of list) {
        map[inst.id] = inst;
      }
    }
    return map;
  }, [instancesByAppId]);

  const bindingsByLegEnv = React.useMemo(() => {
    const map: Record<string, Record<string, BindingRow>> = {};
    for (const b of bindings) {
      if (!map[b.interface_leg_id]) map[b.interface_leg_id] = {};
      map[b.interface_leg_id][b.environment] = b;
    }
    return map;
  }, [bindings]);

  React.useEffect(() => {
    if (!dialogState) return;
    let cancelled = false;
    const loadConnectionOptions = async () => {
      setBindingConnectionLoading(true);
      try {
        const res = await api.get<{ items: any[] }>('/connections', {
          params: { q: bindingConnectionSearch || undefined, limit: 20 },
        });
        if (!cancelled) {
          const items: ConnectionOption[] = (res.data?.items || []).map((item: any) => ({
            id: item.id,
            name: item.name,
            connection_reference: item.connection_reference,
            topology: item.topology,
            lifecycle: item.lifecycle,
            criticality: item.criticality,
          }));
          setBindingConnectionOptions(
            selectedBindingConnection && !items.some((item) => item.id === selectedBindingConnection.id)
              ? [selectedBindingConnection, ...items]
              : items,
          );
        }
      } catch {
        if (!cancelled) {
          setBindingConnectionOptions(selectedBindingConnection ? [selectedBindingConnection] : []);
        }
      } finally {
        if (!cancelled) setBindingConnectionLoading(false);
      }
    };
    void loadConnectionOptions();
    return () => {
      cancelled = true;
    };
  }, [bindingConnectionSearch, dialogState?.bindingId, dialogState?.mode, selectedBindingConnection]);

  React.useEffect(() => {
    if (!dialogState?.bindingId || bindingConnectionDirty) return;
    const links = linksByBindingId[dialogState.bindingId];
    if (links === undefined) return;
    const nextConnection = links[0] ? connectionOptionFromLink(links[0]) : null;
    setSelectedBindingConnection(nextConnection);
  }, [bindingConnectionDirty, dialogState?.bindingId, linksByBindingId]);

  const instanceOptionsFor = React.useCallback(
    (role: string, environment: string): AppInstanceOption[] => {
      const roleLower = String(role || '').toLowerCase();
      const apps: string[] = [];
      if (roleLower === 'source') apps.push(sourceApplicationId);
      else if (roleLower === 'target') apps.push(targetApplicationId);
      else if (roleLower === 'middleware') apps.push(...middlewareApplicationIds);
      if (apps.length === 0) return [];
      const opts: AppInstanceOption[] = [];
      for (const appId of apps) {
        const list = instancesByAppId[appId] || [];
        for (const inst of list) {
          if (inst.environment === environment) opts.push(inst);
        }
      }
      return opts;
    },
    [instancesByAppId, middlewareApplicationIds, sourceApplicationId, targetApplicationId],
  );

  const integrationToolOptionsFor = React.useCallback((environment: string): IntegrationToolOption[] => {
    if (integrationRouteType !== 'via_middleware') return [];
    const options: IntegrationToolOption[] = [];
    const seen = new Set<string>();
    for (const appId of middlewareApplicationIds || []) {
      if (!appId || seen.has(appId)) continue;
      const instance = (instancesByAppId[appId] || []).find((item) => item.environment === environment);
      if (!instance) continue;
      seen.add(appId);
      options.push({
        id: appId,
        label: formatInstanceOption(t, instance, 'middleware', sourceApplicationName, targetApplicationName),
      });
    }
    return options;
  }, [
    instancesByAppId,
    integrationRouteType,
    middlewareApplicationIds,
    sourceApplicationName,
    t,
    targetApplicationName,
  ]);

  const defaultIntegrationToolId = React.useMemo(() => {
    const ids = middlewareApplicationIds || [];
    if (!ids || ids.length === 0) return null;
    return ids[0] || null;
  }, [middlewareApplicationIds]);

  const openCreate = (env: string, leg: InterfaceLeg) => {
    if (!canManage) return;
    const sourceOptions = instanceOptionsFor(leg.from_role, env);
    const targetOptions = instanceOptionsFor(leg.to_role, env);
    const integrationToolOptions = integrationToolOptionsFor(env);
    setSelectedBindingConnection(null);
    setBindingConnectionDirty(false);
    setBindingConnectionSearch('');
    autosaveRequestRef.current += 1;
    setAutosaveStatus('idle');
    setDialogState({
      mode: 'create',
      environment: env,
      leg,
      source_instance_id: sourceOptions[0]?.id || null,
      target_instance_id: targetOptions[0]?.id || null,
      status: 'active',
      source_endpoint: '',
      target_endpoint: '',
      trigger_details: '',
      env_job_name: '',
      authentication_mode: null,
      monitoring_url: '',
      env_notes: '',
      integration_tool_application_id: integrationRouteType === 'via_middleware'
        ? (integrationToolOptions[0]?.id || defaultIntegrationToolId)
        : null,
    });
    setBindingPanelOpen(true);
    setError(null);
  };

  const openEdit = (env: string, leg: InterfaceLeg, binding: BindingRow) => {
    const loadedLinks = linksByBindingId[binding.id];
    const loadedConnection = loadedLinks?.[0] ? connectionOptionFromLink(loadedLinks[0]) : null;
    setSelectedBindingConnection(loadedConnection);
    setBindingConnectionDirty(false);
    setBindingConnectionSearch('');
    autosaveRequestRef.current += 1;
    setAutosaveStatus('idle');
    if (loadedLinks === undefined) {
      void loadLinksForBinding(binding.id);
    }
    setDialogState({
      mode: 'edit',
      environment: env,
      leg,
      bindingId: binding.id,
      source_instance_id: binding.source_instance_id,
      target_instance_id: binding.target_instance_id,
      status: binding.status || 'proposed',
      source_endpoint: binding.source_endpoint || '',
      target_endpoint: binding.target_endpoint || '',
      trigger_details: binding.trigger_details || '',
      env_job_name: binding.env_job_name || '',
      authentication_mode: binding.authentication_mode || null,
      monitoring_url: binding.monitoring_url || '',
      env_notes: binding.env_notes || '',
      integration_tool_application_id: binding.integration_tool_application_id || null,
    });
    setBindingPanelOpen(true);
    setError(null);
  };

  const closeDialog = () => {
    setBindingPanelOpen(false);
    setDialogState(null);
    setSelectedBindingConnection(null);
    setBindingConnectionDirty(false);
    setBindingConnectionSearch('');
    setBindingConnectionOptions([]);
    autosaveRequestRef.current += 1;
    setAutosaveStatus('idle');
  };

  const autosaveBindingPatch = React.useCallback(async (bindingId: string, patch: BindingAutosavePatch) => {
    if (!canManage) return;
    const requestId = autosaveRequestRef.current + 1;
    autosaveRequestRef.current = requestId;
    setAutosaveStatus('saving');
    setError(null);
    try {
      await api.patch(`/interface-bindings/${bindingId}`, patch);
      setBindings((prev) => prev.map((binding) => (
        binding.id === bindingId
          ? { ...binding, ...patch, updated_at: new Date().toISOString() }
          : binding
      )));
      if (autosaveRequestRef.current === requestId) {
        setAutosaveStatus('saved');
      }
    } catch (e: any) {
      if (autosaveRequestRef.current === requestId) {
        setAutosaveStatus('error');
      }
      setError(getApiErrorMessage(e, t, t('messages.saveBindingFailed')));
    }
  }, [canManage, t]);

  const saveBindingConnectionSelection = async (
    bindingId: string,
    selectedConnectionOption: ConnectionOption | null,
  ) => {
    if (!canManage) return;
    const currentLinks = linksByBindingId[bindingId] ?? await fetchLinksForBinding(bindingId);
    const primaryLink = currentLinks[0] || null;
    const selectedConnectionId = selectedConnectionOption?.id || null;
    if ((primaryLink?.connection_id || null) === selectedConnectionId) return;

    if (primaryLink) {
      await api.delete(`/interface-bindings/${bindingId}/connection-links/${primaryLink.id}`);
    }
    if (selectedConnectionId) {
      await api.post(`/interface-bindings/${bindingId}/connection-links`, {
        connection_id: selectedConnectionId,
      });
    }
    await fetchLinksForBinding(bindingId);
  };

  const syncBindingConnection = async (bindingId: string) => {
    if (!bindingConnectionDirty) return;
    await saveBindingConnectionSelection(bindingId, selectedBindingConnection);
  };

  const autosaveBindingConnection = async (
    bindingId: string,
    selectedConnectionOption: ConnectionOption | null,
  ) => {
    if (!canManage) return;
    const requestId = autosaveRequestRef.current + 1;
    autosaveRequestRef.current = requestId;
    setAutosaveStatus('saving');
    setError(null);
    try {
      await saveBindingConnectionSelection(bindingId, selectedConnectionOption);
      setBindingConnectionDirty(false);
      if (autosaveRequestRef.current === requestId) {
        setAutosaveStatus('saved');
      }
    } catch (e: any) {
      if (autosaveRequestRef.current === requestId) {
        setAutosaveStatus('error');
      }
      setError(getApiErrorMessage(e, t, t('messages.saveBindingFailed')));
    }
  };

  const handleSaveDialog = async () => {
    if (!canManage || !dialogState) return;
    if (!dialogState.source_instance_id || !dialogState.target_instance_id) {
      setError(t('it:workspace.interface.bindings.selectInstances'));
      return;
    }
    const payload: any = {
      source_instance_id: dialogState.source_instance_id,
      target_instance_id: dialogState.target_instance_id,
      source_endpoint: dialogState.source_endpoint || null,
      target_endpoint: dialogState.target_endpoint || null,
      trigger_details: dialogState.trigger_details || null,
      env_job_name: dialogState.env_job_name || null,
      authentication_mode: dialogState.authentication_mode || null,
      monitoring_url: dialogState.monitoring_url || null,
      env_notes: dialogState.env_notes || null,
      status: dialogState.status || 'proposed',
      integration_tool_application_id: dialogState.integration_tool_application_id || null,
    };
    setBindingSaving(true);
    try {
      let savedBindingId = dialogState.bindingId || null;
      if (dialogState.mode === 'create') {
        const res = await api.post<BindingRow>(`/interfaces/${interfaceId}/bindings`, {
          interface_leg_id: dialogState.leg.id,
          ...payload,
        });
        savedBindingId = res.data.id;
      } else if (dialogState.bindingId) {
        await api.patch(`/interface-bindings/${dialogState.bindingId}`, payload);
      }
      if (savedBindingId) {
        await syncBindingConnection(savedBindingId);
      }
      closeDialog();
      await load();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.saveBindingFailed')));
    } finally {
      setBindingSaving(false);
    }
  };

  const handleDeleteBinding = async (binding: BindingRow) => {
    if (!canManage) return;
    setPendingDeleteBinding(binding);
  };

  const confirmDeleteBinding = async () => {
    if (!canManage || !pendingDeleteBinding) return;
    const deletedBindingId = pendingDeleteBinding.id;
    const deletedEnvironment = pendingDeleteBinding.environment;
    const hasRemainingBindingInEnv = bindings.some(
      (binding) => binding.environment === deletedEnvironment && binding.id !== deletedBindingId,
    );
    setError(null);
    try {
      await api.delete(`/interface-bindings/${deletedBindingId}`);
      if (deletedEnvironment && !hasRemainingBindingInEnv) {
        setManualEnvs((prev) => (prev.includes(deletedEnvironment) ? prev : [...prev, deletedEnvironment]));
      }
      setPendingDeleteBinding(null);
      if (dialogState?.bindingId === deletedBindingId) {
        closeDialog();
      }
      await load();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.deleteBindingFailed')));
    }
  };

  const confirmDeleteEnvironment = async () => {
    if (!canManage || !pendingDeleteEnvironment) return;
    const env = pendingDeleteEnvironment;
    const envBindings = bindings.filter((b) => b.environment === env);
    setError(null);
    try {
      await Promise.all(
        envBindings.map((b) => api.delete(`/interface-bindings/${b.id}`)),
      );
      setManualEnvs((prev) => prev.filter((e) => e !== env));
      setPendingDeleteEnvironment(null);
      await load();
    } catch (e: any) {
      setError(
        getApiErrorMessage(e, t, t('messages.deleteEnvBindingsFailed')),
      );
    }
  };

  const authOptions = React.useMemo(() => {
    const current = dialogState?.authentication_mode || '';
    const source: Array<{ code: string; label: string; deprecated?: boolean }> = (byField.interfaceAuthMode || []).length > 0
      ? byField.interfaceAuthMode
      : DEFAULT_AUTH_OPTIONS.map((item) => ({ code: item.code, label: t(`it:workspace.interface.bindings.auth.${item.labelKey}`) }));
    const options = source
      .filter((item) => !item.deprecated || item.code === current)
      .map((item) => ({
        code: item.code,
        label: item.deprecated ? t('it:common.deprecatedOption', { label: item.label }) : item.label,
      }));
    if (current && !options.some((item) => item.code === current)) {
      options.push({ code: current, label: labelFor('interfaceAuthMode', current) || current });
    }
    return options;
  }, [byField.interfaceAuthMode, dialogState?.authentication_mode, labelFor, t]);

  const dialogSourceInstanceOptions = React.useMemo(() => (
    dialogState ? instanceOptionsFor(dialogState.leg.from_role, dialogState.environment) : []
  ), [dialogState?.environment, dialogState?.leg.from_role, instanceOptionsFor]);

  const dialogTargetInstanceOptions = React.useMemo(() => (
    dialogState ? instanceOptionsFor(dialogState.leg.to_role, dialogState.environment) : []
  ), [dialogState?.environment, dialogState?.leg.to_role, instanceOptionsFor]);

  const dialogIntegrationToolOptions = React.useMemo(() => (
    dialogState ? integrationToolOptionsFor(dialogState.environment) : []
  ), [dialogState?.environment, integrationToolOptionsFor]);

  const showSourceInstanceSelect = dialogState?.mode === 'create' && dialogSourceInstanceOptions.length > 1;
  const showTargetInstanceSelect = dialogState?.mode === 'create' && dialogTargetInstanceOptions.length > 1;
  const showIntegrationToolSelect = (
    dialogState?.mode === 'create'
    && integrationRouteType === 'via_middleware'
    && dialogIntegrationToolOptions.length > 1
  );
  const missingBindingInstanceRoles = React.useMemo(() => {
    if (!dialogState || dialogState.mode !== 'create') return [];
    const missing: string[] = [];
    if (dialogSourceInstanceOptions.length === 0) {
      missing.push(getRoleLabel(t, dialogState.leg.from_role, sourceApplicationName, targetApplicationName));
    }
    if (dialogTargetInstanceOptions.length === 0) {
      missing.push(getRoleLabel(t, dialogState.leg.to_role, sourceApplicationName, targetApplicationName));
    }
    return missing;
  }, [
    dialogSourceInstanceOptions.length,
    dialogState?.environment,
    dialogState?.leg.from_role,
    dialogState?.leg.to_role,
    dialogState?.mode,
    dialogTargetInstanceOptions.length,
    sourceApplicationName,
    t,
    targetApplicationName,
  ]);
  const bindingSaveDisabled = bindingSaving || !dialogState?.source_instance_id || !dialogState?.target_instance_id;
  const autosaveEditEnabled = Boolean(
    canManage
    && bindingPanelOpen
    && dialogState?.mode === 'edit'
    && dialogState.bindingId,
  );

  const updateDialogField = <K extends keyof BindingDialogState,>(field: K, value: BindingDialogState[K]) => {
    setDialogState((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const commitBindingField = (
    field: keyof BindingAutosavePatch,
    value: BindingAutosavePatch[keyof BindingAutosavePatch],
  ) => {
    if (!canManage || !autosaveEditEnabled || !dialogState?.bindingId) return;
    void autosaveBindingPatch(dialogState.bindingId, { [field]: value } as BindingAutosavePatch);
  };

  const formatInstance = React.useCallback((id: string | null | undefined): string => {
    if (!id) return '—';
    const inst = instancesById[id];
    if (!inst) return id;
    let appLabel = t('it:workspace.interface.flow.middleware');
    if (inst.application_id === sourceApplicationId) appLabel = sourceApplicationName || t('it:workspace.interface.flow.source');
    else if (inst.application_id === targetApplicationId) appLabel = targetApplicationName || t('it:workspace.interface.flow.target');
    const envLabel = environmentLabel(t, inst.environment);
    return `${appLabel} · ${envLabel}`;
  }, [
    instancesById,
    sourceApplicationId,
    sourceApplicationName,
    t,
    targetApplicationId,
    targetApplicationName,
  ]);

  const openBindingCell = (env: string, leg: InterfaceLeg, binding: BindingRow | undefined) => {
    if (binding) {
      openEdit(env, leg, binding);
      if (linksByBindingId[binding.id] === undefined) {
        void loadLinksForBinding(binding.id);
      }
      return;
    }
    if (canManage) openCreate(env, leg);
  };

  const renderStatusDot = (label: string, muiColor: string = 'default') => (
    <Stack direction="row" spacing={0.75} alignItems="center" sx={{ minWidth: 0 }}>
      <StatusDot color={getDotColor(muiColor, theme.palette.mode)} />
      <Typography
        component="span"
        sx={(theme) => ({
          minWidth: 0,
          fontSize: 12,
          lineHeight: 1.3,
          fontWeight: 500,
          color: getDotColor(muiColor, theme.palette.mode),
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        })}
      >
        {label}
      </Typography>
    </Stack>
  );

  const renderTechnicalTemplate = (leg: InterfaceLeg) => (
    <Stack spacing={0.25}>
      <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.secondary' }}>
        {t('it:workspace.interface.bindings.triggerLine', { value: labelFor('interfaceTriggerType', leg.trigger_type) || leg.trigger_type || '—' })}
      </Typography>
      <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.secondary' }}>
        {t('it:workspace.interface.bindings.patternLine', { value: labelFor('interfacePattern', leg.integration_pattern) || leg.integration_pattern || '—' })}
      </Typography>
      <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.secondary' }}>
        {t('it:workspace.interface.bindings.formatLine', { value: labelFor('interfaceFormat', leg.data_format) || leg.data_format || '—' })}
      </Typography>
      <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.secondary' }}>
        {t('it:workspace.interface.bindings.jobNameLine', { value: leg.job_name || '—' })}
      </Typography>
    </Stack>
  );

  const connectionOptionDetail = (option: ConnectionOption) => [
    topologyLabel(t, option.topology),
    option.lifecycle ? labelFor('lifecycleStatus', option.lifecycle) : '',
    option.criticality
      ? classificationCatalog?.businessCriticalityLevels.find((item) => item.code === option.criticality)?.label || option.criticality
      : '',
  ].filter(Boolean).join(' · ');

  const renderBindingFormContent = () => {
    if (!dialogState) return null;
    const gridSx = panelFormGridSx;
    const selectFieldSx = drawerSelectSx;
    const textFieldSx = drawerFieldValueSx;
    const linkedConnections = dialogState.bindingId ? linksByBindingId[dialogState.bindingId] : undefined;
    const additionalLinkedConnections = linkedConnections?.slice(1) || [];

    return (
      <Stack spacing={1.25}>
        {error && <Alert severity="error">{error}</Alert>}
        {missingBindingInstanceRoles.length > 0 && (
          <Alert severity="warning">
            {t('it:workspace.interface.bindings.missingInstance', { count: missingBindingInstanceRoles.length, roles: missingBindingInstanceRoles.join(' / '), env: environmentLabel(t, dialogState.environment) })}
          </Alert>
        )}
        <Box sx={gridSx}>
          {showSourceInstanceSelect && (
            <PropertyRow label={t('it:workspace.interface.bindings.sourceInstance')} required>
              <Select
                value={dialogState.source_instance_id || ''}
                onChange={(event) => updateDialogField('source_instance_id', event.target.value || null)}
                variant="standard"
                sx={selectFieldSx}
              >
                {dialogSourceInstanceOptions.map((inst) => (
                  <MenuItem key={inst.id} value={inst.id} sx={drawerMenuItemSx}>
                    {formatInstanceOption(t, inst, dialogState.leg.from_role, sourceApplicationName, targetApplicationName)}
                  </MenuItem>
                ))}
              </Select>
            </PropertyRow>
          )}
          {showTargetInstanceSelect && (
            <PropertyRow label={t('it:workspace.interface.bindings.targetInstance')} required>
              <Select
                value={dialogState.target_instance_id || ''}
                onChange={(event) => updateDialogField('target_instance_id', event.target.value || null)}
                variant="standard"
                sx={selectFieldSx}
              >
                {dialogTargetInstanceOptions.map((inst) => (
                  <MenuItem key={inst.id} value={inst.id} sx={drawerMenuItemSx}>
                    {formatInstanceOption(t, inst, dialogState.leg.to_role, sourceApplicationName, targetApplicationName)}
                  </MenuItem>
                ))}
              </Select>
            </PropertyRow>
          )}
          {showIntegrationToolSelect && (
            <PropertyRow label={t('it:workspace.interface.bindings.integrationTool')} required>
              <Select
                value={dialogState.integration_tool_application_id || ''}
                onChange={(event) => updateDialogField('integration_tool_application_id', event.target.value || null)}
                variant="standard"
                sx={selectFieldSx}
              >
                {dialogIntegrationToolOptions.map((option) => (
                  <MenuItem key={option.id} value={option.id} sx={drawerMenuItemSx}>
                    {option.label}
                  </MenuItem>
                ))}
              </Select>
            </PropertyRow>
          )}
          <PropertyRow label={t('it:workspace.interface.bindings.status')}>
            <Select
              value={dialogState.status}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateDialogField('status', nextValue);
                commitBindingField('status', nextValue || 'proposed');
              }}
              variant="standard"
              disabled={!canManage}
              sx={selectFieldSx}
            >
              {lifecycleOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.bindings.authMode')}>
            <Select
              value={dialogState.authentication_mode || ''}
              onChange={(event) => {
                const nextValue = event.target.value || null;
                updateDialogField('authentication_mode', nextValue);
                commitBindingField('authentication_mode', nextValue);
              }}
              variant="standard"
              displayEmpty
              disabled={!canManage}
              renderValue={(value) => {
                const code = String(value || '');
                if (!code) return t('it:workspace.interface.bindings.notSpecified');
                return authOptions.find((option) => option.code === code)?.label || code;
              }}
              sx={selectFieldSx}
            >
              <MenuItem value="" sx={drawerMenuItemSx}>{t('it:workspace.interface.bindings.notSpecified')}</MenuItem>
              {authOptions.map((opt) => (
                <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.bindings.infraConnection')}>
            <Autocomplete
              options={bindingConnectionOptions}
              loading={bindingConnectionLoading || (Boolean(dialogState.bindingId) && linksLoadingBindingId === dialogState.bindingId)}
              disabled={!canManage}
              value={selectedBindingConnection}
              onInputChange={(_, value, reason) => {
                if (reason === 'input' || reason === 'clear') {
                  setBindingConnectionSearch(value);
                }
              }}
              onChange={(_, value) => {
                setSelectedBindingConnection(value);
                setBindingConnectionDirty(true);
                setBindingConnectionSearch('');
                if (autosaveEditEnabled && dialogState.bindingId) {
                  void autosaveBindingConnection(dialogState.bindingId, value);
                }
              }}
              getOptionLabel={formatConnectionOption}
              isOptionEqualToValue={(option, value) => option.id === value.id}
              clearOnBlur={false}
              noOptionsText={bindingConnectionSearch ? t('it:workspace.interface.bindings.noConnectionsFound') : t('it:workspace.interface.bindings.noConnections')}
              ListboxProps={{ sx: drawerAutocompleteListboxSx }}
              renderOption={(props, option) => {
                const detail = connectionOptionDetail(option);
                return (
                  <Box component="li" {...props} key={option.id}>
                    <Box sx={{ minWidth: 0 }}>
                      <Typography className="kanap-autocomplete-option-primary">
                        {formatConnectionOption(option)}
                      </Typography>
                      {detail && (
                        <Typography className="kanap-autocomplete-option-secondary">
                          {detail}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                );
              }}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  placeholder={t('it:workspace.interface.bindings.searchConnections')}
                  InputProps={{
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {bindingConnectionLoading ? <CircularProgress size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  }}
                  sx={textFieldSx}
                />
              )}
            />
            {additionalLinkedConnections.length > 0 && (
              <Typography sx={{ mt: 0.5, fontSize: 12, color: 'kanap.text.tertiary' }}>
                {t('it:workspace.interface.bindings.additionalConnections', { count: additionalLinkedConnections.length })}
              </Typography>
            )}
          </PropertyRow>
        </Box>

        <Box sx={gridSx}>
          <PropertyRow label={t('it:workspace.interface.bindings.sourceEndpoint')}>
            <TextField
              value={dialogState.source_endpoint}
              onChange={(event) => updateDialogField('source_endpoint', event.target.value)}
              onBlur={(event) => commitBindingField('source_endpoint', event.target.value || null)}
              variant="standard"
              disabled={!canManage}
              fullWidth
              sx={textFieldSx}
              placeholder={t('it:workspace.interface.bindings.endpointPlaceholder')}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.bindings.targetEndpoint')}>
            <TextField
              value={dialogState.target_endpoint}
              onChange={(event) => updateDialogField('target_endpoint', event.target.value)}
              onBlur={(event) => commitBindingField('target_endpoint', event.target.value || null)}
              variant="standard"
              disabled={!canManage}
              fullWidth
              sx={textFieldSx}
              placeholder={t('it:workspace.interface.bindings.endpointPlaceholder')}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.bindings.triggerDetails')}>
            <TextField
              value={dialogState.trigger_details}
              onChange={(event) => updateDialogField('trigger_details', event.target.value)}
              onBlur={(event) => commitBindingField('trigger_details', event.target.value || null)}
              variant="standard"
              disabled={!canManage}
              fullWidth
              multiline
              minRows={3}
              sx={textFieldSx}
              placeholder={t('it:workspace.interface.bindings.triggerDetailsPlaceholder')}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.bindings.jobNameOverride')}>
            <TextField
              value={dialogState.env_job_name}
              onChange={(event) => updateDialogField('env_job_name', event.target.value)}
              onBlur={(event) => commitBindingField('env_job_name', event.target.value || null)}
              variant="standard"
              disabled={!canManage}
              fullWidth
              sx={textFieldSx}
              placeholder={dialogState.leg.job_name ? t('it:workspace.interface.bindings.usesJobName', { name: dialogState.leg.job_name }) : t('it:workspace.interface.bindings.usesFlowJobName')}
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.bindings.monitoringUrl')}>
            <TextField
              value={dialogState.monitoring_url}
              onChange={(event) => updateDialogField('monitoring_url', event.target.value)}
              onBlur={(event) => commitBindingField('monitoring_url', event.target.value || null)}
              variant="standard"
              disabled={!canManage}
              fullWidth
              sx={textFieldSx}
              placeholder="https://..."
            />
          </PropertyRow>
          <PropertyRow label={t('it:workspace.interface.bindings.notes')}>
            <TextField
              value={dialogState.env_notes}
              onChange={(event) => updateDialogField('env_notes', event.target.value)}
              onBlur={(event) => commitBindingField('env_notes', event.target.value || null)}
              variant="standard"
              disabled={!canManage}
              fullWidth
              multiline
              minRows={3}
              sx={textFieldSx}
              placeholder={t('it:workspace.interface.bindings.notesPlaceholder')}
            />
          </PropertyRow>
        </Box>
      </Stack>
    );
  };

  const renderEnvironmentSummary = () => (
    <Stack direction="row" spacing={1} useFlexGap flexWrap="wrap" sx={{ mb: 1.5 }}>
      {allEnvs.map((env) => {
        const configuredCount = legs.filter((leg) => Boolean(bindingsByLegEnv[leg.id]?.[env])).length;
        const totalCount = legs.length;
        const muiColor = configuredCount === 0 ? 'default' : configuredCount === totalCount ? 'success' : 'warning';
        return (
          <Box
            key={env}
            sx={(theme) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minHeight: 28,
              px: 1,
              borderRadius: '6px',
              border: `1px solid ${theme.palette.kanap.border.default}`,
              bgcolor: theme.palette.kanap.bg.primary,
            })}
          >
            {renderStatusDot(environmentLabel(t, env), muiColor)}
            <Typography sx={{ fontSize: 12, color: 'kanap.text.secondary' }}>
              {`${configuredCount}/${totalCount || 0}`}
            </Typography>
          </Box>
        );
      })}
    </Stack>
  );

  const renderBindingMatrixCell = (env: string, leg: InterfaceLeg) => {
    const binding = bindingsByLegEnv[leg.id]?.[env];
    const links = binding ? linksByBindingId[binding.id] : undefined;
    const isSelected = Boolean(bindingPanelOpen && dialogState?.environment === env && dialogState?.leg.id === leg.id);
    const hasMissingInfra = Boolean(binding && binding.status === 'active' && links && links.length === 0);
    const statusLabel = binding
      ? hasMissingInfra
        ? t('it:workspace.interface.bindings.missingConnection')
        : labelFor('lifecycleStatus', binding.status) || binding.status || t('it:workspace.interface.bindings.configured')
      : t('it:workspace.interface.bindings.empty');
    const statusColor = binding
      ? hasMissingInfra
        ? 'warning'
        : LIFECYCLE_COLORS[binding.status] || 'default'
      : 'default';
    const endpointLines: string[] = binding
      ? [
        binding.source_endpoint ? t('it:workspace.interface.bindings.sourceLine', { value: binding.source_endpoint }) : null,
        binding.target_endpoint ? t('it:workspace.interface.bindings.targetLine', { value: binding.target_endpoint }) : null,
      ].filter((line): line is string => Boolean(line))
      : [];
    const connectionSummary = !binding
      ? null
      : links === undefined
        ? null
        : links.length > 0
          ? `${links[0].connection.connection_reference} · ${links[0].connection.name}${links.length > 1 ? ` +${links.length - 1}` : ''}`
          : t('it:workspace.interface.bindings.noInfraConnection');
    const emptyDetails = binding && endpointLines.length === 0 && !connectionSummary;
    const actionable = Boolean(binding) || canManage;

    return (
      <TableCell key={`${env}-${leg.id}`} sx={{ width: 220, minWidth: 220, verticalAlign: 'top' }}>
        <Box
          role={actionable ? 'button' : undefined}
          tabIndex={actionable ? 0 : undefined}
          onClick={actionable ? () => openBindingCell(env, leg, binding) : undefined}
          onKeyDown={actionable ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openBindingCell(env, leg, binding);
            }
          } : undefined}
          sx={(theme) => ({
            minHeight: 72,
            borderRadius: '6px',
            px: 1,
            py: 0.875,
            cursor: actionable ? 'pointer' : 'default',
            border: `1px solid ${isSelected ? theme.palette.kanap.teal : theme.palette.kanap.border.default}`,
            bgcolor: isSelected ? theme.palette.kanap.bg.composer : theme.palette.kanap.bg.primary,
            transition: 'background-color 120ms ease, border-color 120ms ease',
            '&:hover': {
              bgcolor: actionable ? theme.palette.kanap.bg.composer : undefined,
            },
            '&:focus-visible': {
              outline: `2px solid ${theme.palette.kanap.teal}`,
              outlineOffset: 2,
            },
          })}
        >
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
            {renderStatusDot(statusLabel, statusColor)}
            {binding && canManage && (
              <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flex: '0 0 auto' }}>
                <Tooltip title={t('it:workspace.interface.bindings.editBinding')}>
                  <EditIcon
                    aria-hidden="true"
                    sx={{ fontSize: 15, color: 'kanap.text.tertiary' }}
                  />
                </Tooltip>
                <Tooltip title={t('it:workspace.interface.bindings.deleteBinding')}>
                  <IconButton
                    aria-label={t('it:workspace.interface.bindings.deleteBinding')}
                    size="small"
                    onClick={(event) => {
                      event.stopPropagation();
                      void handleDeleteBinding(binding);
                    }}
                    onKeyDown={(event) => {
                      event.stopPropagation();
                    }}
                    sx={(theme) => ({
                      p: 0.25,
                      color: theme.palette.kanap.text.tertiary,
                      '&:hover': {
                        color: theme.palette.error.main,
                        bgcolor: 'transparent',
                      },
                    })}
                  >
                    <DeleteIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
            )}
          </Stack>
          {!binding && canManage && (
            <Typography
              sx={{
                mt: 0.625,
                fontSize: 12,
                lineHeight: 1.35,
                color: 'kanap.text.secondary',
              }}
            >
              {t('it:workspace.interface.bindings.clickToAdd')}
            </Typography>
          )}
          {endpointLines.map((line) => (
            <Typography
              key={line}
              sx={{
                mt: 0.625,
                fontSize: 12,
                lineHeight: 1.35,
                color: 'kanap.text.primary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={line}
            >
              {line}
            </Typography>
          ))}
          {connectionSummary && (
            <Typography
              sx={{
                mt: 0.25,
                fontSize: 12,
                lineHeight: 1.35,
                color: 'kanap.text.tertiary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
              title={connectionSummary}
            >
              {connectionSummary}
            </Typography>
          )}
          {emptyDetails && canManage && (
            <Typography
              sx={{
                mt: 0.625,
                fontSize: 12,
                lineHeight: 1.35,
                color: 'kanap.text.tertiary',
              }}
            >
              {t('it:workspace.interface.bindings.clickToEdit')}
            </Typography>
          )}
        </Box>
      </TableCell>
    );
  };

  const renderRuntimeMatrix = () => (
    <Box
      sx={(theme) => ({
        overflowX: 'auto',
        border: `1px solid ${theme.palette.kanap.border.default}`,
        borderRadius: '8px',
        bgcolor: theme.palette.kanap.bg.primary,
      })}
    >
      <Table size="small" sx={{ minWidth: Math.max(520, 260 + allEnvs.length * 220) }}>
        <TableHead>
          <TableRow>
            <TableCell sx={{ width: 260, minWidth: 260 }}>{t('it:workspace.interface.bindings.legAndTemplate')}</TableCell>
            {allEnvs.map((env) => (
              <TableCell key={env} sx={{ width: 220, minWidth: 220 }}>
                <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
                  <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary' }}>
                    {environmentLabel(t, env)}
                  </Typography>
                  {canManage && (
                    <Tooltip title={t('it:workspace.interface.bindings.deleteEnvironment')}>
                      <IconButton
                        size="small"
                        aria-label={t('it:workspace.interface.bindings.deleteEnvironment')}
                        onClick={() => {
                          const envBindings = bindings.filter((binding) => binding.environment === env);
                          if (envBindings.length > 0) {
                            setPendingDeleteEnvironment(env);
                          } else {
                            setManualEnvs((prev) => prev.filter((item) => item !== env));
                          }
                        }}
                        sx={{ p: 0.25 }}
                      >
                        <DeleteIcon sx={{ fontSize: 15 }} />
                      </IconButton>
                    </Tooltip>
                  )}
                </Stack>
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {legs.length === 0 && (
            <TableRow>
              <TableCell colSpan={Math.max(1, allEnvs.length + 1)}>
                <Typography variant="body2" color="text.secondary">
                  {t('it:workspace.interface.bindings.noLegs')}
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {legs.map((leg) => (
            <TableRow key={leg.id}>
              <TableCell sx={{ verticalAlign: 'top' }}>
                <Stack spacing={0.75}>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.35, fontWeight: 500, color: 'kanap.text.primary' }}>
                    {legTypeLabel(t, leg.leg_type)}
                  </Typography>
                  <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.tertiary' }}>
                    {`${getRoleLabel(t, leg.from_role, sourceApplicationName, targetApplicationName)} → ${getRoleLabel(t, leg.to_role, sourceApplicationName, targetApplicationName)}`}
                  </Typography>
                  {renderTechnicalTemplate(leg)}
                </Stack>
              </TableCell>
              {allEnvs.map((env) => renderBindingMatrixCell(env, leg))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );

  const renderBindingSidePanel = () => {
    if (!bindingPanelOpen || !dialogState) return null;
    const autosaveStatusText = dialogState.mode === 'edit'
      ? autosaveStatus === 'saving'
        ? t('common:status.saving')
        : autosaveStatus === 'saved'
          ? t('common:status.saved')
          : autosaveStatus === 'error'
            ? t('it:workspace.interface.bindings.autosaveFailed')
            : null
      : null;
    return (
      <Box
        component="form"
        onSubmit={(event) => {
          event.preventDefault();
          if (dialogState.mode === 'create' && !bindingSaveDisabled) {
            void handleSaveDialog();
          }
        }}
        sx={(theme) => ({
          minWidth: 0,
          border: `1px solid ${theme.palette.kanap.border.default}`,
          borderRadius: '8px',
          bgcolor: theme.palette.kanap.bg.drawer,
          alignSelf: 'start',
        })}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          sx={(theme) => ({
            px: 1.5,
            py: 1.25,
            borderBottom: `1px solid ${theme.palette.kanap.border.default}`,
          })}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 14, lineHeight: 1.35, fontWeight: 500, color: 'kanap.text.primary' }}>
              {dialogState.mode !== 'edit'
                ? t('it:workspace.interface.bindings.addBinding')
                : canManage
                  ? t('it:workspace.interface.bindings.editBinding')
                  : t('it:workspace.interface.bindings.bindingIn', { env: environmentLabel(t, dialogState.environment) })}
            </Typography>
            <Typography
              sx={{
                fontSize: 12,
                lineHeight: 1.35,
                color: 'kanap.text.secondary',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {`${environmentLabel(t, dialogState.environment)} · ${legTypeLabel(t, dialogState.leg.leg_type)}`}
            </Typography>
            {autosaveStatusText && (
              <Typography
                sx={{
                  mt: 0.25,
                  fontSize: 12,
                  lineHeight: 1.35,
                  color: autosaveStatus === 'error' ? 'error.main' : 'kanap.text.tertiary',
                }}
              >
                {autosaveStatusText}
              </Typography>
            )}
          </Box>
          <IconButton aria-label={t('it:workspace.interface.bindings.closePanel')} size="small" onClick={closeDialog}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
        <Box sx={{ px: 1.5, py: 1.25 }}>
          {renderBindingFormContent()}
        </Box>
        {dialogState.mode === 'create' && (
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            justifyContent="flex-end"
            sx={(theme) => ({
              px: 1.5,
              py: 1.25,
              borderTop: `1px solid ${theme.palette.kanap.border.default}`,
            })}
          >
            <Button size="small" onClick={closeDialog}>
              {t('common:buttons.cancel')}
            </Button>
            <Button
              size="small"
              type="submit"
              variant="contained"
              disabled={bindingSaveDisabled}
            >
              {bindingSaving ? t('common:status.saving') : t('it:workspace.interface.bindings.addBinding')}
            </Button>
          </Stack>
        )}
      </Box>
    );
  };

  return (
    <Box>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', md: 'center' }}
        sx={{ mb: 2 }}
        spacing={1}
      >
        <Stack>
          <Typography variant="h6">{t('it:workspace.interface.bindings.title')}</Typography>
          <Typography variant="body2" color="text.secondary">
            {t('it:workspace.interface.bindings.intro')}
          </Typography>
          {interfaceRouteIntro(t, integrationRouteType) && (
            <Typography variant="body2" color="text.secondary">
              {interfaceRouteIntro(t, integrationRouteType)}
            </Typography>
          )}
        </Stack>
        {canManage && (
          <Stack direction="row" spacing={1}>
            <Button
              variant="action"
              startIcon={<AddIcon sx={{ fontSize: '14px !important' }} />}
              onClick={() => {
                const first = selectableEnvs[0] || '';
                setEnvDraft(first);
                setEnvDialogOpen(true);
              }}
              disabled={selectableEnvs.length === 0}
            >
              {t('it:workspace.interface.bindings.addEnvironment')}
            </Button>
          </Stack>
        )}
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {loading && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('it:workspace.interface.bindings.loadingBindings')}
        </Typography>
      )}
      {allEnvs.length === 0 && !loading && (
        <Alert severity="info">
          {t('it:workspace.interface.bindings.noEnvironments')}
        </Alert>
      )}
      {allEnvs.length > 0 && (
        <>
          {renderEnvironmentSummary()}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                lg: bindingPanelOpen ? 'minmax(0, 1fr) minmax(340px, 380px)' : 'minmax(0, 1fr)',
              },
              gap: 1.5,
              alignItems: 'start',
            }}
          >
            {renderRuntimeMatrix()}
            {renderBindingSidePanel()}
          </Box>
        </>
      )}

      <KanapDialog
        open={envDialogOpen}
        title={t('it:workspace.interface.bindings.addEnvironment')}
        onClose={() => setEnvDialogOpen(false)}
        onSave={() => {
          const env = envDraft.trim();
          if (!env || usedEnvs.has(env)) {
            setEnvDialogOpen(false);
            return;
          }
          setManualEnvs((prev) => (prev.includes(env) ? prev : [...prev, env]));
          setEnvDialogOpen(false);
        }}
        saveLabel={t('common:buttons.add')}
        saveDisabled={!envDraft}
      >
        <PropertyRow label={t('it:common.environment')} required>
          <Select
            // Once added, the environment leaves the options while the dialog closes: keep the value among them.
            value={selectableEnvs.includes(envDraft) ? envDraft : ''}
            onChange={(event) => setEnvDraft(event.target.value)}
            variant="standard"
            sx={drawerSelectSx}
          >
            {selectableEnvs.map((env) => (
              <MenuItem key={env} value={env} sx={drawerMenuItemSx}>
                {environmentLabel(t, env)}
              </MenuItem>
            ))}
          </Select>
        </PropertyRow>
      </KanapDialog>

      <KanapDialog
        open={!!pendingDeleteBinding}
        title={t('it:workspace.interface.bindings.deleteBinding')}
        onClose={() => setPendingDeleteBinding(null)}
        saveLabel={t('common:buttons.delete')}
        onSave={() => { void confirmDeleteBinding(); }}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {t('it:workspace.interface.bindings.deleteBindingMessage')}
        </Typography>
      </KanapDialog>

      <KanapDialog
        open={!!pendingDeleteEnvironment}
        title={t('it:workspace.interface.bindings.deleteEnvironment')}
        onClose={() => setPendingDeleteEnvironment(null)}
        saveLabel={t('common:buttons.delete')}
        onSave={() => { void confirmDeleteEnvironment(); }}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {pendingDeleteEnvironment
            ? t('it:workspace.interface.bindings.deleteEnvironmentMessage', { count: bindings.filter((binding) => binding.environment === pendingDeleteEnvironment).length, env: environmentLabel(t, pendingDeleteEnvironment) })
            : t('it:workspace.interface.bindings.deleteEnvironmentFallback')}
        </Typography>
      </KanapDialog>
    </Box>
  );
}
