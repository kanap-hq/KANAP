import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
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
import { useNavigate } from 'react-router-dom';
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
import { getApiErrorMessage } from '../../../utils/apiErrorMessage';
const ENVIRONMENTS = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'] as const;
// Set to false to restore the previous per-environment tables while evaluating the matrix workflow.
const USE_RUNTIME_MATRIX_EXPERIMENT = true;

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

type ManageConnectionsState = {
  binding: BindingRow;
} | null;

function getRoleLabel(role: string, sourceName?: string | null, targetName?: string | null): string {
  const r = String(role || '').toLowerCase();
  if (r === 'source') return sourceName || 'Source';
  if (r === 'target') return targetName || 'Target';
  if (r === 'middleware') return 'Middleware';
  return role || '';
}

function formatEnvironment(value: string | null | undefined) {
  return String(value || '').replace(/_/g, '-').toUpperCase();
}

const DEFAULT_AUTH_OPTIONS = [
  { code: 'service_account', label: 'Service account' },
  { code: 'oauth2', label: 'OAuth2' },
  { code: 'api_key', label: 'API key' },
  { code: 'certificate', label: 'Certificate' },
  { code: 'none', label: 'None' },
];

function formatInstanceOption(
  instance: AppInstanceOption,
  role: string,
  sourceName?: string | null,
  targetName?: string | null,
) {
  const roleLabel = getRoleLabel(role, sourceName, targetName);
  const details = [instance.base_url, instance.region, instance.zone].filter(Boolean).join(' / ');
  return [roleLabel, formatEnvironment(instance.environment), details || instance.id.slice(0, 8)]
    .filter(Boolean)
    .join(' - ');
}

function formatConnectionOption(option: ConnectionOption | null | undefined) {
  if (!option) return '';
  return [option.connection_reference, option.name].filter(Boolean).join(' · ');
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

const dialogGridSx = {
  display: 'grid',
  gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
  columnGap: 2,
  rowGap: 0.5,
} as const;

const dialogFullWidthSx = {
  gridColumn: { xs: 'auto', sm: '1 / -1' },
} as const;

const panelFormGridSx = {
  display: 'grid',
  gridTemplateColumns: '1fr',
  rowGap: 0.5,
} as const;

export default function InterfaceBindingsMatrix({
  interfaceId,
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
    if (list.length === 0) return [{ label: 'Active', value: 'active' }];
    return list.map((item) => ({
      value: item.code,
      label: item.deprecated ? `${item.label} (deprecated)` : item.label,
    }));
  }, [byField.lifecycleStatus]);
  const navigate = useNavigate();
  const [bindings, setBindings] = React.useState<BindingRow[]>([]);
  const [instancesByAppId, setInstancesByAppId] = React.useState<Record<string, AppInstanceOption[]>>({});
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [linksByBindingId, setLinksByBindingId] = React.useState<Record<string, BindingConnection[]>>({});
  const [linksLoadingBindingId, setLinksLoadingBindingId] = React.useState<string | null>(null);
  const [linksError, setLinksError] = React.useState<string | null>(null);
  const [manageConnections, setManageConnections] = React.useState<ManageConnectionsState>(null);
  const [connectionSearch, setConnectionSearch] = React.useState('');
  const [connectionOptions, setConnectionOptions] = React.useState<ConnectionOption[]>([]);
  const [connectionLoading, setConnectionLoading] = React.useState(false);
  const [selectedConnection, setSelectedConnection] = React.useState<ConnectionOption | null>(null);
  const [bindingConnectionSearch, setBindingConnectionSearch] = React.useState('');
  const [bindingConnectionOptions, setBindingConnectionOptions] = React.useState<ConnectionOption[]>([]);
  const [bindingConnectionLoading, setBindingConnectionLoading] = React.useState(false);
  const [selectedBindingConnection, setSelectedBindingConnection] = React.useState<ConnectionOption | null>(null);
  const [bindingConnectionDirty, setBindingConnectionDirty] = React.useState(false);
  const [linkSaving, setLinkSaving] = React.useState(false);
  const [unlinkingLinkId, setUnlinkingLinkId] = React.useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = React.useState(false);
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
      setLinksError(null);
      try {
        await fetchLinksForBinding(bindingId);
      } catch (e: any) {
        setLinksError(getApiErrorMessage(e, t, t('messages.loadConnectionsFailed')));
      } finally {
        setLinksLoadingBindingId((prev) => (prev === bindingId ? null : prev));
      }
    },
    [fetchLinksForBinding, t],
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
    if (!manageConnections) return;
    let cancelled = false;
    const load = async () => {
      setConnectionLoading(true);
      try {
        const res = await api.get<{ items: any[] }>('/connections', {
          params: { q: connectionSearch || undefined, limit: 20 },
        });
        if (!cancelled) {
          const items =
            (res.data?.items || []).map((item: any) => ({
              id: item.id,
              name: item.name,
              connection_reference: item.connection_reference,
            })) || [];
          setConnectionOptions(items);
        }
      } catch {
        if (!cancelled) setConnectionOptions([]);
      } finally {
        if (!cancelled) setConnectionLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [connectionSearch, manageConnections]);

  React.useEffect(() => {
    const bindingId = manageConnections?.binding.id;
    if (bindingId && linksByBindingId[bindingId] === undefined) {
      void loadLinksForBinding(bindingId);
    }
  }, [manageConnections, linksByBindingId, loadLinksForBinding]);

  // Legacy table mode prefetches links; the matrix loads them only when a cell/panel is opened.
  React.useEffect(() => {
    if (USE_RUNTIME_MATRIX_EXPERIMENT) return;
    const ids = bindings.map((b) => b.id);
    ids.forEach((id) => {
      if (linksByBindingId[id] === undefined) {
        void loadLinksForBinding(id);
      }
    });
  }, [bindings, linksByBindingId, loadLinksForBinding]);

  React.useEffect(() => {
    if (!manageConnections) {
      setSelectedConnection(null);
      setConnectionSearch('');
      setConnectionOptions([]);
      setLinksError(null);
    }
  }, [manageConnections]);

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
        label: formatInstanceOption(instance, 'middleware', sourceApplicationName, targetApplicationName),
      });
    }
    return options;
  }, [
    instancesByAppId,
    integrationRouteType,
    middlewareApplicationIds,
    sourceApplicationName,
    targetApplicationName,
  ]);

  const defaultIntegrationToolId = React.useMemo(() => {
    const ids = middlewareApplicationIds || [];
    if (!ids || ids.length === 0) return null;
    return ids[0] || null;
  }, [middlewareApplicationIds]);

  const openCreate = (env: string, leg: InterfaceLeg) => {
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
    if (USE_RUNTIME_MATRIX_EXPERIMENT) {
      setBindingPanelOpen(true);
    } else {
      setDialogOpen(true);
    }
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
    if (USE_RUNTIME_MATRIX_EXPERIMENT) {
      setBindingPanelOpen(true);
    } else {
      setDialogOpen(true);
    }
    setError(null);
  };

  const closeDialog = () => {
    setDialogOpen(false);
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
  }, [t]);

  const saveBindingConnectionSelection = async (
    bindingId: string,
    selectedConnectionOption: ConnectionOption | null,
  ) => {
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
    if (!dialogState) return;
    if (!dialogState.source_instance_id || !dialogState.target_instance_id) {
      setError('Select source and target instances');
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
    setPendingDeleteBinding(binding);
  };

  const confirmDeleteBinding = async () => {
    if (!pendingDeleteBinding) return;
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
    if (!pendingDeleteEnvironment) return;
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

  const handleLinkConnection = React.useCallback(async () => {
    if (!manageConnections || !selectedConnection) return;
    setLinkSaving(true);
    setLinksError(null);
    try {
      await api.post(`/interface-bindings/${manageConnections.binding.id}/connection-links`, {
        connection_id: selectedConnection.id,
      });
      await loadLinksForBinding(manageConnections.binding.id);
      setSelectedConnection(null);
    } catch (e: any) {
      setLinksError(getApiErrorMessage(e, t, t('messages.linkConnectionFailed')));
    } finally {
      setLinkSaving(false);
    }
  }, [manageConnections, selectedConnection, loadLinksForBinding]);

  const handleUnlinkConnection = React.useCallback(
    async (linkId: string, bindingId: string) => {
      setUnlinkingLinkId(linkId);
      setLinksError(null);
      try {
        await api.delete(`/interface-bindings/${bindingId}/connection-links/${linkId}`);
        await loadLinksForBinding(bindingId);
      } catch (e: any) {
        setLinksError(getApiErrorMessage(e, t, t('messages.unlinkConnectionFailed')));
      } finally {
        setUnlinkingLinkId((prev) => (prev === linkId ? null : prev));
      }
    },
    [loadLinksForBinding],
  );

  const authOptions = React.useMemo(() => {
    const current = dialogState?.authentication_mode || '';
    const source: Array<{ code: string; label: string; deprecated?: boolean }> = (byField.interfaceAuthMode || []).length > 0
      ? byField.interfaceAuthMode
      : DEFAULT_AUTH_OPTIONS;
    const options = source
      .filter((item) => !item.deprecated || item.code === current)
      .map((item) => ({
        code: item.code,
        label: item.deprecated ? `${item.label} (deprecated)` : item.label,
      }));
    if (current && !options.some((item) => item.code === current)) {
      options.push({ code: current, label: labelFor('interfaceAuthMode', current) || current });
    }
    return options;
  }, [byField.interfaceAuthMode, dialogState?.authentication_mode, labelFor]);

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
      missing.push(getRoleLabel(dialogState.leg.from_role, sourceApplicationName, targetApplicationName));
    }
    if (dialogTargetInstanceOptions.length === 0) {
      missing.push(getRoleLabel(dialogState.leg.to_role, sourceApplicationName, targetApplicationName));
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
    targetApplicationName,
  ]);
  const bindingSaveDisabled = bindingSaving || !dialogState?.source_instance_id || !dialogState?.target_instance_id;
  const autosaveEditEnabled = Boolean(
    USE_RUNTIME_MATRIX_EXPERIMENT
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
    if (!autosaveEditEnabled || !dialogState?.bindingId) return;
    void autosaveBindingPatch(dialogState.bindingId, { [field]: value } as BindingAutosavePatch);
  };

  const formatInstance = React.useCallback((id: string | null | undefined): string => {
    if (!id) return '—';
    const inst = instancesById[id];
    if (!inst) return id;
    let appLabel = 'Middleware';
    if (inst.application_id === sourceApplicationId) appLabel = sourceApplicationName || 'Source';
    else if (inst.application_id === targetApplicationId) appLabel = targetApplicationName || 'Target';
    const envLabel = formatEnvironment(inst.environment);
    return `${appLabel} · ${envLabel}`;
  }, [
    instancesById,
    sourceApplicationId,
    sourceApplicationName,
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
    openCreate(env, leg);
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
        Trigger: {labelFor('interfaceTriggerType', leg.trigger_type) || leg.trigger_type || '—'}
      </Typography>
      <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.secondary' }}>
        Pattern: {labelFor('interfacePattern', leg.integration_pattern) || leg.integration_pattern || '—'}
      </Typography>
      <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.secondary' }}>
        Format: {labelFor('interfaceFormat', leg.data_format) || leg.data_format || '—'}
      </Typography>
      <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.secondary' }}>
        Job name: {leg.job_name || '—'}
      </Typography>
    </Stack>
  );

  const renderBindingFormContent = (surface: 'dialog' | 'panel') => {
    if (!dialogState) return null;
    const gridSx = surface === 'panel' ? panelFormGridSx : dialogGridSx;
    const fullWidthSx = surface === 'panel' ? undefined : dialogFullWidthSx;
    const selectFieldSx = drawerSelectSx;
    const textFieldSx = drawerFieldValueSx;
    const linkedConnections = dialogState.bindingId ? linksByBindingId[dialogState.bindingId] : undefined;
    const additionalLinkedConnections = linkedConnections?.slice(1) || [];

    return (
      <Stack spacing={1.25}>
        {error && <Alert severity="error">{error}</Alert>}
        {missingBindingInstanceRoles.length > 0 && (
          <Alert severity="warning">
            {`No ${missingBindingInstanceRoles.join(' or ')} instance is available for ${formatEnvironment(dialogState.environment)}. Create the missing deployment before adding this binding.`}
          </Alert>
        )}
        <Box sx={gridSx}>
          {showSourceInstanceSelect && (
            <PropertyRow label="Source instance" required>
              <Select
                value={dialogState.source_instance_id || ''}
                onChange={(event) => updateDialogField('source_instance_id', event.target.value || null)}
                variant="standard"
                sx={selectFieldSx}
              >
                {dialogSourceInstanceOptions.map((inst) => (
                  <MenuItem key={inst.id} value={inst.id} sx={drawerMenuItemSx}>
                    {formatInstanceOption(inst, dialogState.leg.from_role, sourceApplicationName, targetApplicationName)}
                  </MenuItem>
                ))}
              </Select>
            </PropertyRow>
          )}
          {showTargetInstanceSelect && (
            <PropertyRow label="Target instance" required>
              <Select
                value={dialogState.target_instance_id || ''}
                onChange={(event) => updateDialogField('target_instance_id', event.target.value || null)}
                variant="standard"
                sx={selectFieldSx}
              >
                {dialogTargetInstanceOptions.map((inst) => (
                  <MenuItem key={inst.id} value={inst.id} sx={drawerMenuItemSx}>
                    {formatInstanceOption(inst, dialogState.leg.to_role, sourceApplicationName, targetApplicationName)}
                  </MenuItem>
                ))}
              </Select>
            </PropertyRow>
          )}
          {showIntegrationToolSelect && (
            <PropertyRow label="Integration tool" required sx={fullWidthSx}>
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
          <PropertyRow label="Status">
            <Select
              value={dialogState.status}
              onChange={(event) => {
                const nextValue = event.target.value;
                updateDialogField('status', nextValue);
                commitBindingField('status', nextValue || 'proposed');
              }}
              variant="standard"
              sx={selectFieldSx}
            >
              {lifecycleOptions.map((opt) => (
                <MenuItem key={opt.value} value={opt.value} sx={drawerMenuItemSx}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
          <PropertyRow label="Authentication mode">
            <Select
              value={dialogState.authentication_mode || ''}
              onChange={(event) => {
                const nextValue = event.target.value || null;
                updateDialogField('authentication_mode', nextValue);
                commitBindingField('authentication_mode', nextValue);
              }}
              variant="standard"
              displayEmpty
              renderValue={(value) => {
                const code = String(value || '');
                if (!code) return 'Not specified';
                return authOptions.find((option) => option.code === code)?.label || code;
              }}
              sx={selectFieldSx}
            >
              <MenuItem value="" sx={drawerMenuItemSx}>Not specified</MenuItem>
              {authOptions.map((opt) => (
                <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                  {opt.label}
                </MenuItem>
              ))}
            </Select>
          </PropertyRow>
          <PropertyRow label="Infra connection" sx={fullWidthSx}>
            <Autocomplete
              options={bindingConnectionOptions}
              loading={bindingConnectionLoading || (Boolean(dialogState.bindingId) && linksLoadingBindingId === dialogState.bindingId)}
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
              noOptionsText={bindingConnectionSearch ? 'No connections found' : 'No connections'}
              ListboxProps={{ sx: drawerAutocompleteListboxSx }}
              renderOption={(props, option) => (
                <Box component="li" {...props} key={option.id}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography className="kanap-autocomplete-option-primary">
                      {formatConnectionOption(option)}
                    </Typography>
                    {(option.topology || option.lifecycle || option.criticality) && (
                      <Typography className="kanap-autocomplete-option-secondary">
                        {[option.topology, option.lifecycle, option.criticality].filter(Boolean).join(' · ')}
                      </Typography>
                    )}
                  </Box>
                </Box>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  variant="standard"
                  placeholder="Search connections"
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
                {`${additionalLinkedConnections.length} additional linked connection${additionalLinkedConnections.length > 1 ? 's' : ''} kept unchanged.`}
              </Typography>
            )}
          </PropertyRow>
        </Box>

        <Box sx={gridSx}>
          <PropertyRow label="Source endpoint" sx={fullWidthSx}>
            <TextField
              value={dialogState.source_endpoint}
              onChange={(event) => updateDialogField('source_endpoint', event.target.value)}
              onBlur={(event) => commitBindingField('source_endpoint', event.target.value || null)}
              variant="standard"
              fullWidth
              sx={textFieldSx}
              placeholder="File path, URL, queue name"
            />
          </PropertyRow>
          <PropertyRow label="Target endpoint" sx={fullWidthSx}>
            <TextField
              value={dialogState.target_endpoint}
              onChange={(event) => updateDialogField('target_endpoint', event.target.value)}
              onBlur={(event) => commitBindingField('target_endpoint', event.target.value || null)}
              variant="standard"
              fullWidth
              sx={textFieldSx}
              placeholder="File path, URL, queue name"
            />
          </PropertyRow>
          <PropertyRow label="Trigger details" sx={fullWidthSx}>
            <TextField
              value={dialogState.trigger_details}
              onChange={(event) => updateDialogField('trigger_details', event.target.value)}
              onBlur={(event) => commitBindingField('trigger_details', event.target.value || null)}
              variant="standard"
              fullWidth
              multiline
              minRows={surface === 'panel' ? 3 : 2}
              sx={textFieldSx}
              placeholder="Cron expression, event description, batch window"
            />
          </PropertyRow>
          <PropertyRow label="Job name override">
            <TextField
              value={dialogState.env_job_name}
              onChange={(event) => updateDialogField('env_job_name', event.target.value)}
              onBlur={(event) => commitBindingField('env_job_name', event.target.value || null)}
              variant="standard"
              fullWidth
              sx={textFieldSx}
              placeholder={dialogState.leg.job_name ? `Uses ${dialogState.leg.job_name}` : 'Uses Flow job name'}
            />
          </PropertyRow>
          <PropertyRow label="Monitoring URL">
            <TextField
              value={dialogState.monitoring_url}
              onChange={(event) => updateDialogField('monitoring_url', event.target.value)}
              onBlur={(event) => commitBindingField('monitoring_url', event.target.value || null)}
              variant="standard"
              fullWidth
              sx={textFieldSx}
              placeholder="https://..."
            />
          </PropertyRow>
          <PropertyRow label="Notes" sx={fullWidthSx}>
            <TextField
              value={dialogState.env_notes}
              onChange={(event) => updateDialogField('env_notes', event.target.value)}
              onBlur={(event) => commitBindingField('env_notes', event.target.value || null)}
              variant="standard"
              fullWidth
              multiline
              minRows={3}
              sx={textFieldSx}
              placeholder="Environment-specific notes"
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
            {renderStatusDot(formatEnvironment(env), muiColor)}
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
        ? 'Missing connection'
        : labelFor('lifecycleStatus', binding.status) || binding.status || 'Configured'
      : 'Empty';
    const statusColor = binding
      ? hasMissingInfra
        ? 'warning'
        : LIFECYCLE_COLORS[binding.status] || 'default'
      : 'default';
    const endpointLines: string[] = binding
      ? [
        binding.source_endpoint ? `Source: ${binding.source_endpoint}` : null,
        binding.target_endpoint ? `Target: ${binding.target_endpoint}` : null,
      ].filter((line): line is string => Boolean(line))
      : [];
    const connectionSummary = !binding
      ? null
      : links === undefined
        ? null
        : links.length > 0
          ? `${links[0].connection.connection_reference} · ${links[0].connection.name}${links.length > 1 ? ` +${links.length - 1}` : ''}`
          : 'No infra connection linked';
    const emptyDetails = binding && endpointLines.length === 0 && !connectionSummary;

    return (
      <TableCell key={`${env}-${leg.id}`} sx={{ width: 220, minWidth: 220, verticalAlign: 'top' }}>
        <Box
          role="button"
          tabIndex={0}
          onClick={() => openBindingCell(env, leg, binding)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openBindingCell(env, leg, binding);
            }
          }}
          sx={(theme) => ({
            minHeight: 72,
            borderRadius: '6px',
            px: 1,
            py: 0.875,
            cursor: 'pointer',
            border: `1px solid ${isSelected ? theme.palette.kanap.teal : theme.palette.kanap.border.default}`,
            bgcolor: isSelected ? theme.palette.kanap.bg.composer : theme.palette.kanap.bg.primary,
            transition: 'background-color 120ms ease, border-color 120ms ease',
            '&:hover': {
              bgcolor: theme.palette.kanap.bg.composer,
            },
            '&:focus-visible': {
              outline: `2px solid ${theme.palette.kanap.teal}`,
              outlineOffset: 2,
            },
          })}
        >
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between" sx={{ minWidth: 0 }}>
            {renderStatusDot(statusLabel, statusColor)}
            {binding && (
              <Stack direction="row" spacing={0.25} alignItems="center" sx={{ flex: '0 0 auto' }}>
                <Tooltip title="Edit binding">
                  <EditIcon
                    aria-hidden="true"
                    sx={{ fontSize: 15, color: 'kanap.text.tertiary' }}
                  />
                </Tooltip>
                <Tooltip title="Delete binding">
                  <IconButton
                    aria-label="Delete binding"
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
          {!binding && (
            <Typography
              sx={{
                mt: 0.625,
                fontSize: 12,
                lineHeight: 1.35,
                color: 'kanap.text.secondary',
              }}
            >
              Click to add
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
          {emptyDetails && (
            <Typography
              sx={{
                mt: 0.625,
                fontSize: 12,
                lineHeight: 1.35,
                color: 'kanap.text.tertiary',
              }}
            >
              Click to edit
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
            <TableCell sx={{ width: 260, minWidth: 260 }}>Leg and technical template</TableCell>
            {allEnvs.map((env) => (
              <TableCell key={env} sx={{ width: 220, minWidth: 220 }}>
                <Stack direction="row" spacing={0.5} alignItems="center" justifyContent="space-between">
                  <Typography sx={{ fontSize: 11, fontWeight: 500, color: 'kanap.text.secondary' }}>
                    {formatEnvironment(env)}
                  </Typography>
                  <Tooltip title="Delete environment">
                    <IconButton
                      size="small"
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
                  No legs defined for this interface yet.
                </Typography>
              </TableCell>
            </TableRow>
          )}
          {legs.map((leg) => (
            <TableRow key={leg.id}>
              <TableCell sx={{ verticalAlign: 'top' }}>
                <Stack spacing={0.75}>
                  <Typography sx={{ fontSize: 13, lineHeight: 1.35, fontWeight: 500, color: 'kanap.text.primary' }}>
                    {String(leg.leg_type || '').toUpperCase()}
                  </Typography>
                  <Typography sx={{ fontSize: 12, lineHeight: 1.35, color: 'kanap.text.tertiary' }}>
                    {`${getRoleLabel(leg.from_role, sourceApplicationName, targetApplicationName)} → ${getRoleLabel(leg.to_role, sourceApplicationName, targetApplicationName)}`}
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
        ? 'Saving…'
        : autosaveStatus === 'saved'
          ? 'Saved'
          : autosaveStatus === 'error'
            ? 'Autosave failed'
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
              {dialogState.mode === 'edit' ? 'Edit binding' : 'Add binding'}
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
              {`${formatEnvironment(dialogState.environment)} · ${String(dialogState.leg.leg_type || '').toUpperCase()}`}
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
          <IconButton aria-label="Close binding panel" size="small" onClick={closeDialog}>
            <CloseIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Stack>
        <Box sx={{ px: 1.5, py: 1.25 }}>
          {renderBindingFormContent('panel')}
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
              Cancel
            </Button>
            <Button
              size="small"
              type="submit"
              variant="contained"
              disabled={bindingSaveDisabled}
            >
              {bindingSaving ? 'Saving…' : 'Add binding'}
            </Button>
          </Stack>
        )}
      </Box>
    );
  };

  const renderLegRow = (env: string, leg: InterfaceLeg, binding: BindingRow | undefined) => {
    const hasBinding = !!binding;
    const links = binding ? linksByBindingId[binding.id] : undefined;
    return (
      <TableRow key={`env-${env}-${leg.id}`}>
        <TableCell sx={{ fontWeight: 500 }}>
          {String(leg.leg_type || '').toUpperCase()}
        </TableCell>
        <TableCell>
          <Stack spacing={0.25}>
            <Typography variant="body2">
              Trigger:{' '}
              {labelFor('interfaceTriggerType', leg.trigger_type) || leg.trigger_type}
            </Typography>
            <Typography variant="body2">
              Pattern:{' '}
              {labelFor('interfacePattern', leg.integration_pattern) || leg.integration_pattern}
            </Typography>
            <Typography variant="body2">
              Format:{' '}
              {labelFor('interfaceFormat', leg.data_format) || leg.data_format}
            </Typography>
            <Typography variant="body2">
              Job name: {leg.job_name || '—'}
            </Typography>
          </Stack>
        </TableCell>
        <TableCell>
          {hasBinding ? (
            <Stack spacing={0.5}>
              <Typography variant="body2">
                Source instance:{' '}
                <strong>{formatInstance(binding.source_instance_id)}</strong>
              </Typography>
              <Typography variant="body2">
                Target instance:{' '}
                <strong>{formatInstance(binding.target_instance_id)}</strong>
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Status:{' '}
                {labelFor('lifecycleStatus', binding.status) || binding.status || '—'}
                {binding.authentication_mode
                  ? ` · Auth: ${
                    labelFor('interfaceAuthMode', binding.authentication_mode) || binding.authentication_mode
                  }`
                  : ''}
              </Typography>
              {binding.source_endpoint && (
                <Typography variant="body2" color="text.secondary">
                  Source endpoint: {binding.source_endpoint}
                </Typography>
              )}
              {binding.target_endpoint && (
                <Typography variant="body2" color="text.secondary">
                  Target endpoint: {binding.target_endpoint}
                </Typography>
              )}
              {binding.monitoring_url && (
                <Typography variant="body2" color="text.secondary">
                  Monitoring: {binding.monitoring_url}
                </Typography>
              )}
              {binding.env_notes && (
                <Typography variant="body2" color="text.secondary">
                  Notes: {binding.env_notes}
                </Typography>
              )}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              No binding defined for this leg in {env.toUpperCase()}.
            </Typography>
          )}
          {binding && (
            <Box sx={{ mt: 0.5 }}>
            </Box>
          )}
        </TableCell>
        <TableCell sx={{ minWidth: 200 }}>
          {binding && (
            <Box sx={{ mt: 0.5 }}>
              {linksLoadingBindingId === binding.id && (
                <Typography variant="caption" color="text.secondary">
                  Loading infra connections…
                </Typography>
              )}
              {linksError && (
                <Typography variant="caption" color="error">
                  {linksError}
                </Typography>
              )}
              {links && links.length > 0 && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap">
                  {links.map((link) => (
                    <Typography key={link.id} variant="body2" color="text.secondary" sx={{ mr: 0.5, mb: 0.5 }}>
                      <Typography component="span" sx={{ fontFamily: "'JetBrains Mono Variable', monospace", fontSize: '0.75rem', mr: 0.5 }}>
                        {link.connection.connection_reference}
                      </Typography>
                      · {link.connection.name}
                    </Typography>
                  ))}
                </Stack>
              )}
              {links && links.length === 0 && (
                <Typography variant="caption" color="text.secondary">
                  No infra connections linked
                </Typography>
              )}
              {links && links.length === 0 && binding.status === 'active' && (
                <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }}>
                  Active binding without infra connection
                </Typography>
              )}
            </Box>
          )}
          {!binding && (
            <Typography variant="caption" color="text.secondary">
              —
            </Typography>
          )}
          {hasBinding && (
            <Tooltip title="Manage infra connections">
              <span>
                <Button
                  size="small"
                  onClick={() => {
                    setManageConnections({ binding: binding! });
                    if (linksByBindingId[binding!.id] === undefined) {
                      void loadLinksForBinding(binding!.id);
                    }
                  }}
                  sx={{ mt: 1 }}
                >
                  Manage Connection
                </Button>
              </span>
            </Tooltip>
          )}
        </TableCell>
        <TableCell align="right">
          <Stack direction="row" spacing={1} justifyContent="flex-end" alignItems="center">
            <Tooltip title={hasBinding ? 'Edit binding' : 'Add binding'}>
              <span>
                <IconButton
                  size="small"
                  onClick={() => {
                    if (hasBinding && binding) openEdit(env, leg, binding);
                    else openCreate(env, leg);
                  }}
                >
                  {hasBinding ? <EditIcon fontSize="small" /> : <AddIcon fontSize="small" />}
                </IconButton>
              </span>
            </Tooltip>
            {hasBinding && (
              <Tooltip title="Delete binding">
                <span>
                  <IconButton size="small" onClick={() => void handleDeleteBinding(binding!)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        </TableCell>
      </TableRow>
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
          <Typography variant="h6">Environments & bindings</Typography>
          <Typography variant="body2" color="text.secondary">
            For each environment, configure which instances are connected for each leg of the interface.
          </Typography>
          {integrationRouteType === 'via_middleware' && (
            <Typography variant="body2" color="text.secondary">
              Route type: via middleware — legs: EXTRACT, TRANSFORM, LOAD.
            </Typography>
          )}
          {integrationRouteType === 'direct' && (
            <Typography variant="body2" color="text.secondary">
              Route type: direct — single DIRECT leg between source and target.
            </Typography>
          )}
        </Stack>
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
            Add environment
          </Button>
        </Stack>
      </Stack>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {loading && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Loading bindings…
        </Typography>
      )}
      {allEnvs.length === 0 && !loading && (
        <Alert severity="info">
          No environments defined yet. Click &quot;Add environment&quot; to start documenting bindings. You will need
          application instances for each environment in the Applications workspace to create bindings.
        </Alert>
      )}
      {allEnvs.length > 0 && (
        USE_RUNTIME_MATRIX_EXPERIMENT ? (
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
        ) : (
          <>
            {allEnvs.map((env) => (
              <Box key={env} sx={{ mb: 3 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="subtitle1">
                    Environment: {env.toUpperCase()}
                  </Typography>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => {
                      const envBindings = bindings.filter((b) => b.environment === env);
                      if (envBindings.length > 0) {
                        setPendingDeleteEnvironment(env);
                      } else {
                        setManualEnvs((prev) => prev.filter((e) => e !== env));
                      }
                    }}
                  >
                    Delete environment
                  </Button>
                </Stack>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Leg</TableCell>
                      <TableCell>Technical template</TableCell>
                      <TableCell>{`Binding in ${env.toUpperCase()}`}</TableCell>
                      <TableCell>Connections</TableCell>
                      <TableCell align="right">Actions</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {legs.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5}>
                          <Typography variant="body2" color="text.secondary">
                            No legs defined for this interface yet.
                          </Typography>
                        </TableCell>
                      </TableRow>
                    )}
                    {legs.map((leg) => {
                      const byEnv = bindingsByLegEnv[leg.id] || {};
                      const binding = byEnv[env];
                      return renderLegRow(env, leg, binding);
                    })}
                  </TableBody>
                </Table>
              </Box>
            ))}
          </>
        )
      )}

      <Dialog open={!!manageConnections} onClose={() => setManageConnections(null)} maxWidth="md" fullWidth>
        <DialogTitle>Manage infra connections</DialogTitle>
        <DialogContent dividers>
          {linksError && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {linksError}
            </Alert>
          )}
          {manageConnections && (
            <Stack spacing={2}>
              <Typography variant="subtitle2" color="text.secondary">
                Env: {manageConnections.binding.environment.toUpperCase()} · Leg: {manageConnections.binding.leg_type.toUpperCase()}
              </Typography>
              {linksLoadingBindingId === manageConnections.binding.id && (
                <Typography variant="body2" color="text.secondary">
                  Loading infra connections…
                </Typography>
              )}
              {linksByBindingId[manageConnections.binding.id] && (
                <Stack spacing={1}>
                  {linksByBindingId[manageConnections.binding.id].length === 0 && (
                    <Typography variant="body2" color="text.secondary">
                      No infra connections linked yet.
                    </Typography>
                  )}
                  {linksByBindingId[manageConnections.binding.id].map((link) => (
                    <Box
                      key={link.id}
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        border: '1px solid',
                        borderColor: 'divider',
                        borderRadius: 1,
                        p: 1,
                      }}
                    >
                      <Box sx={{ pr: 1, flex: 1 }}>
                        <Typography variant="body2" fontWeight={600}>
                          <Typography component="span" sx={{ fontFamily: "'JetBrains Mono Variable', monospace", fontSize: '0.75rem', color: 'text.secondary', mr: 0.5 }}>
                            {link.connection.connection_reference}
                          </Typography>
                          · {link.connection.name}
                        </Typography>
                        <Stack direction="row" spacing={1} flexWrap="wrap" sx={{ mt: 0.5 }}>
                          <Typography variant="body2" color="text.secondary">
                            {link.connection.topology === 'multi_server' ? 'Multi-server' : 'Server to server'}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {`Lifecycle: ${link.connection.lifecycle}`}
                          </Typography>
                          <Typography variant="body2" color="text.secondary">
                            {`Criticality: ${classificationCatalog?.businessCriticalityLevels.find((item) => item.code === link.connection.criticality)?.label || link.connection.criticality || 'Not set'}`}
                          </Typography>
                          <Typography variant="body2" color={link.connection.contains_pii ? 'warning.main' : 'text.secondary'}>
                            {link.connection.contains_pii ? 'Contains PII' : 'No PII'}
                          </Typography>
                        </Stack>
                        {link.notes && (
                          <Typography variant="caption" color="text.secondary">
                            Notes: {link.notes}
                          </Typography>
                        )}
                      </Box>
                      <Stack direction="row" spacing={1}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => navigate(`/it/connections/${link.connection.connection_reference || link.connection.id}/overview`)}
                        >
                          Open connection
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => void handleUnlinkConnection(link.id, manageConnections.binding.id)}
                          disabled={unlinkingLinkId === link.id}
                        >
                          {unlinkingLinkId === link.id ? 'Unlinking…' : 'Unlink'}
                        </Button>
                      </Stack>
                    </Box>
                  ))}
                </Stack>
              )}

              <Box>
                <Typography variant="subtitle2" gutterBottom>
                  Link existing connection
                </Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  alignItems={{ xs: 'stretch', sm: 'center' }}
                >
                  <Autocomplete
                    options={connectionOptions}
                    loading={connectionLoading}
                    value={selectedConnection}
                    inputValue={connectionSearch}
                    onInputChange={(_, v) => setConnectionSearch(v)}
                    onChange={(_, val) => setSelectedConnection(val)}
                    getOptionLabel={(opt) => (opt?.name ? `${opt.connection_reference} · ${opt.name}` : opt?.connection_reference || '')}
                    isOptionEqualToValue={(opt, val) => opt.id === val.id}
                    renderInput={(params) => (
                      <TextField
                        {...params}
                        label="Search connections"
                        placeholder="Name or ID"
                        InputLabelProps={{ shrink: true }}
                        InputProps={{
                          ...params.InputProps,
                          endAdornment: (
                            <>
                              {connectionLoading ? <CircularProgress size={16} /> : null}
                              {params.InputProps.endAdornment}
                            </>
                          ),
                        }}
                      />
                    )}
                    sx={{ minWidth: 280, flex: 1 }}
                  />
                  <Button
                    variant="contained"
                    onClick={() => void handleLinkConnection()}
                    disabled={!selectedConnection || linkSaving}
                  >
                    {linkSaving ? 'Linking…' : 'Link'}
                  </Button>
                </Stack>
              </Box>

              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
                <Button
                  variant="outlined"
                  onClick={() => {
                    const b = manageConnections.binding;
                    const params = new URLSearchParams({
                      interfaceId,
                      bindingId: b.id,
                      environment: b.environment,
                      legType: b.leg_type,
                    });
                    setManageConnections(null);
                    navigate(`/it/connections/new/overview?${params.toString()}`);
                  }}
                >
                  Create connection…
                </Button>
              </Stack>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="action" onClick={() => setManageConnections(null)}>Close</Button>
        </DialogActions>
      </Dialog>

      <KanapDialog
        open={dialogOpen}
        title={dialogState?.mode === 'edit' ? 'Edit binding' : 'Add binding'}
        onClose={closeDialog}
        onSave={handleSaveDialog}
        saveLabel={dialogState?.mode === 'create' ? 'Add binding' : 'Save'}
        saveDisabled={bindingSaveDisabled}
        saveLoading={bindingSaving}
        sx={{ maxWidth: 680 }}
      >
        {renderBindingFormContent('dialog')}
      </KanapDialog>
      <KanapDialog
        open={envDialogOpen}
        title="Add environment"
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
        saveLabel="Add"
        saveDisabled={!envDraft}
      >
        <PropertyRow label="Environment" required>
          <Select
            value={envDraft}
            onChange={(event) => setEnvDraft(event.target.value)}
            variant="standard"
            sx={drawerSelectSx}
          >
            {selectableEnvs.map((env) => (
              <MenuItem key={env} value={env} sx={drawerMenuItemSx}>
                {formatEnvironment(env)}
              </MenuItem>
            ))}
          </Select>
        </PropertyRow>
      </KanapDialog>

      <KanapDialog
        open={!!pendingDeleteBinding}
        title="Delete binding"
        onClose={() => setPendingDeleteBinding(null)}
        saveLabel="Delete"
        onSave={() => { void confirmDeleteBinding(); }}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          Delete this environment binding. Linked infra connections for this binding will also be removed.
        </Typography>
      </KanapDialog>

      <KanapDialog
        open={!!pendingDeleteEnvironment}
        title="Delete environment"
        onClose={() => setPendingDeleteEnvironment(null)}
        saveLabel="Delete"
        onSave={() => { void confirmDeleteEnvironment(); }}
      >
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>
          {pendingDeleteEnvironment
            ? `Delete all ${bindings.filter((binding) => binding.environment === pendingDeleteEnvironment).length} bindings for ${pendingDeleteEnvironment.toUpperCase()}.`
            : 'Delete this environment.'}
        </Typography>
      </KanapDialog>
    </Box>
  );
}
