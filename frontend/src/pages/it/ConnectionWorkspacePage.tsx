import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Autocomplete, Box, Button, Chip, MenuItem, Stack, Switch, TextField, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell, {
  type PortfolioDetailWorkspaceTab,
} from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import KanapDialog from '../../components/design/KanapDialog';
import { PropertyGroup, PropertyRow } from '../../components/design/PropertyRow';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import ConnectionMetadataBar from './workspace/ConnectionMetadataBar';
import ConnectionPropertiesDrawer from './workspace/ConnectionPropertiesDrawer';
import ConnectionOverviewTab, { type ConnectionProtocol } from './workspace/ConnectionOverviewTab';
import ConnectionPathTab from './workspace/ConnectionPathTab';
import ConnectionEndpointPicker, { type EndpointValue } from './workspace/ConnectionEndpointPicker';
import { useConnectionItemNav } from '../../hooks/useModuleItemNav';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { drawerSelectSx, drawerMenuItemSx, drawerFieldValueSx, longFormSurfaceFieldSx } from '../../theme/formSx';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import type { ConnectionPathHop } from './workspace/ConnectionPathSection';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';

type TabKey = 'overview' | 'path';
const TAB_KEYS: TabKey[] = ['overview', 'path'];

type LinkedInterfaceRow = {
  id: string;
  binding_id: string;
  interface_id: string;
  interface_reference?: string | null;
  interface_code?: string | null;
  interface_name: string;
  environment: string;
  leg_type: string;
  source_endpoint: string | null;
  target_endpoint: string | null;
  pattern: string;
  binding_status: string;
  interface_criticality?: string;
  interface_data_class?: string;
  interface_contains_pii?: boolean;
};

type AssetSummary = { id: string; name: string; asset_reference?: string | null };

type ConnectionTypeOption = { code: string; label: string };

type CreateConnectionForm = {
  name: string;
  description: string;
  topology: 'server_to_server' | 'multi_server';
  source: EndpointValue;
  destination: EndpointValue;
  servers: AssetSummary[];
  protocolCodes: string[];
  lifecycle: string;
  criticality: string;
  dataClass: string;
  containsPii: boolean;
};

type ConnectionDetail = {
  id: string;
  connection_reference: string;
  name: string;
  description: string | null;
  topology: 'server_to_server' | 'multi_server';
  source_asset_id: string | null;
  source_entity_code: string | null;
  destination_asset_id: string | null;
  destination_entity_code: string | null;
  source_server: AssetSummary | null;
  destination_server: AssetSummary | null;
  servers: AssetSummary[];
  protocol_codes: string[];
  protocols: ConnectionProtocol[];
  lifecycle: string;
  criticality: string;
  data_class: string;
  contains_pii: boolean;
  risk_mode: 'manual' | 'derived';
  effective_criticality: string;
  effective_data_class: string;
  effective_contains_pii: boolean;
  derived_interface_count: number;
  classification_incomplete?: boolean;
  legs?: ConnectionPathHop[];
  created_at: string;
  updated_at: string;
};


function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      component="h2"
      sx={(theme) => ({
        m: 0,
        mb: 1,
        fontSize: 14,
        fontWeight: 500,
        lineHeight: 1.4,
        color: theme.palette.kanap.text.primary,
      })}
    >
      {children}
    </Typography>
  );
}

function createInitialForm(): CreateConnectionForm {
  return {
    name: '',
    description: '',
    topology: 'server_to_server',
    source: { asset_id: null, entity_code: null },
    destination: { asset_id: null, entity_code: null },
    servers: [],
    protocolCodes: [],
    lifecycle: 'active',
    criticality: '',
    dataClass: '',
    containsPii: false,
  };
}

function hasEndpoint(value: EndpointValue): boolean {
  return !!value.asset_id || !!value.entity_code;
}

function getCreateValidationMessage(form: CreateConnectionForm): string | null {
  if (!form.name.trim()) return 'Name is required.';
  if (form.protocolCodes.length === 0) return 'Select at least one protocol.';
  if (form.topology === 'server_to_server') {
    if (!hasEndpoint(form.source)) return 'Select a source asset or entity.';
    if (!hasEndpoint(form.destination)) return 'Select a destination asset or entity.';
    return null;
  }
  if (form.servers.length < 2) return 'Select at least two servers.';
  return null;
}

export default function ConnectionWorkspacePage() {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const CRITICALITIES = [{ code: '', label: 'Not set' }, ...(classificationCatalog?.businessCriticalityLevels || [])];
  const { t } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { settings, byField } = useItOpsEnumOptions();
  const routeId = String(params.id || '');
  const isCreate = routeId === 'new';
  const isConnectionReferenceRoute = /^CONN-\d+(?:-.+)?$/i.test(routeId);
  const rawTab = (params.tab as TabKey) || 'overview';
  const validTab: TabKey = TAB_KEYS.includes(rawTab) ? rawTab : 'overview';

  const canManage = hasLevel('infrastructure', 'member');
  const canDelete = hasLevel('infrastructure', 'member');

  const [data, setData] = React.useState<ConnectionDetail | null>(null);
  const [legs, setLegs] = React.useState<ConnectionPathHop[]>([]);
  const [linkedInterfaces, setLinkedInterfaces] = React.useState<LinkedInterfaceRow[]>([]);
  const [linkedInterfacesLoading, setLinkedInterfacesLoading] = React.useState(false);
  const [linkedInterfacesError, setLinkedInterfacesError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(!isCreate);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [pendingTopology, setPendingTopology] = React.useState<'server_to_server' | 'multi_server' | null>(null);

  const [createForm, setCreateForm] = React.useState<CreateConnectionForm>(() => createInitialForm());
  const [createMultiSearch, setCreateMultiSearch] = React.useState('');
  const [createMultiOptions, setCreateMultiOptions] = React.useState<AssetSummary[]>([]);
  const [createMultiLoading, setCreateMultiLoading] = React.useState(false);
  const [createSubmitting, setCreateSubmitting] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  const lifecycleOptions = byField.lifecycleStatus || [];
  const dataClassOptions = byField.dataClass || [];
  const connectionTypes: ConnectionTypeOption[] = React.useMemo(
    () => (settings?.connectionTypes || []).map((ct: any) => ({
      code: ct.code,
      label: ct.label || ct.code,
    })),
    [settings?.connectionTypes],
  );

  React.useEffect(() => {
    setCreateForm((prev) => {
      const nextProtocols = prev.protocolCodes.filter((code) => (
        connectionTypes.length === 0 || connectionTypes.some((ct) => ct.code === code)
      ));
      if (nextProtocols.length === 0 && connectionTypes.length > 0) {
        const preferred = connectionTypes.find((ct) => ct.code === 'https') || connectionTypes[0];
        nextProtocols.push(preferred.code);
      }

      const lifecycleIsValid = lifecycleOptions.some((option) => option.code === prev.lifecycle);
      const dataClassIsValid = dataClassOptions.some((option) => option.code === prev.dataClass);
      const nextLifecycle = lifecycleIsValid
        ? prev.lifecycle
        : lifecycleOptions.find((option) => option.code === 'active')?.code || lifecycleOptions[0]?.code || prev.lifecycle;
      const nextDataClass = prev.dataClass;

      if (
        nextProtocols.join('|') === prev.protocolCodes.join('|') &&
        nextLifecycle === prev.lifecycle &&
        nextDataClass === prev.dataClass
      ) {
        return prev;
      }
      return {
        ...prev,
        protocolCodes: nextProtocols,
        lifecycle: nextLifecycle,
        dataClass: nextDataClass,
      };
    });
  }, [connectionTypes, dataClassOptions, lifecycleOptions]);

  React.useEffect(() => {
    if (!isCreate || createForm.topology !== 'multi_server') return;
    let cancelled = false;
    const handle = setTimeout(async () => {
      setCreateMultiLoading(true);
      try {
        const res = await api.get<{ items: AssetSummary[] }>('/assets', {
          params: { q: createMultiSearch || undefined, limit: 50, sort: 'name:ASC' },
        });
        if (!cancelled) setCreateMultiOptions(res.data.items || []);
      } catch {
        if (!cancelled) setCreateMultiOptions([]);
      } finally {
        if (!cancelled) setCreateMultiLoading(false);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [createForm.topology, createMultiSearch, isCreate]);

  const patchCreateForm = React.useCallback((patch: Partial<CreateConnectionForm>) => {
    setCreateForm((prev) => ({ ...prev, ...patch }));
    setCreateError(null);
  }, []);
  const connectionId = React.useMemo(() => {
    if (isCreate) return '';
    if (data?.id) return data.id;
    return isConnectionReferenceRoute ? '' : routeId;
  }, [data?.id, isConnectionReferenceRoute, isCreate, routeId]);
  const workspaceRouteId = data?.connection_reference || (isCreate ? 'new' : routeId);
  const { addToRecent } = useRecentlyViewed();
  React.useEffect(() => {
    if (!isCreate && data?.id && data?.name) addToRecent('connection', data.id, data.name, data.connection_reference || undefined);
  }, [addToRecent, data?.id, data?.name, data?.connection_reference, isCreate]);
  const routeMatchesLoadedConnection = React.useMemo(() => {
    if (isCreate || !data) return false;
    if (routeId === data.id) return true;
    const routeKey = routeId.toUpperCase();
    const reference = data.connection_reference?.toUpperCase();
    return !!reference && (routeKey === reference || routeKey.startsWith(`${reference}-`));
  }, [data, isCreate, routeId]);

  const load = React.useCallback(async () => {
    if (isCreate || !routeId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await api.get<ConnectionDetail>(`/connections/${routeId}`, { params: { include: 'legs' } });
      setData(res.data);
      setLegs(res.data.legs || []);
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.loadConnectionFailed') || 'Failed to load connection'));
    } finally {
      setLoading(false);
    }
  }, [isCreate, routeId, t]);

  React.useEffect(() => { void load(); }, [load]);

  React.useEffect(() => {
    if (isCreate || !data?.connection_reference) return;
    if (!routeMatchesLoadedConnection) return;
    if (routeId.toUpperCase() === data.connection_reference.toUpperCase()) return;
    const qs = searchParams.toString();
    window.history.replaceState(null, '', `/it/connections/${data.connection_reference}/${validTab}${qs ? `?${qs}` : ''}`);
  }, [data?.connection_reference, isCreate, navigate, routeId, routeMatchesLoadedConnection, searchParams, validTab]);

  const reloadLinkedInterfaces = React.useCallback(async () => {
    if (!connectionId) return;
    setLinkedInterfacesLoading(true);
    setLinkedInterfacesError(null);
    try {
      const res = await api.get<{ items: LinkedInterfaceRow[] }>(`/connections/${connectionId}/interface-links`);
      setLinkedInterfaces(res.data.items || []);
    } catch (e: any) {
      setLinkedInterfacesError(
        getApiErrorMessage(e, t, t('messages.loadLinkedInterfacesFailed') || 'Failed to load linked interfaces'),
      );
      setLinkedInterfaces([]);
    } finally {
      setLinkedInterfacesLoading(false);
    }
  }, [connectionId, t]);

  React.useEffect(() => {
    if (!connectionId) return;
    void reloadLinkedInterfaces();
  }, [connectionId, reloadLinkedInterfaces]);

  const handleLinkedInterfacesChanged = React.useCallback(async () => {
    await reloadLinkedInterfaces();
    // Reload connection too, since effective_criticality/data_class/contains_pii may change
    // when bindings are linked/unlinked under derived risk mode.
    await load();
  }, [reloadLinkedInterfaces, load]);

  const patchConnection = React.useCallback(
    async (patch: Partial<ConnectionDetail> | Record<string, any>) => {
      if (!connectionId) return;
      setSaving(true);
      setData((prev) => (prev ? { ...prev, ...(patch as any) } as ConnectionDetail : prev));
      try {
        const res = await api.patch<ConnectionDetail>(`/connections/${connectionId}`, patch);
        setData((prev) => (prev ? { ...prev, ...res.data } : res.data));
        setError(null);
      } catch (e: any) {
        setError(getApiErrorMessage(e, t, t('messages.saveConnectionFailed') || 'Failed to save connection'));
        await load();
      } finally {
        setSaving(false);
      }
    },
    [connectionId, load, t],
  );

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sort = searchParams.get('sort');
    const q = searchParams.get('q');
    const filters = searchParams.get('filters');
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    if (filters) sp.set('filters', filters);
    return sp;
  }, [searchParams]);

  const handleClose = React.useCallback(() => {
    const qs = listContextParams.toString();
    navigate(`/it/connections${qs ? `?${qs}` : ''}`);
  }, [listContextParams, navigate]);

  const handleTabChange = React.useCallback(
    (nextTab: string) => {
      if (nextTab === validTab) return;
      const qs = searchParams.toString();
      const targetId = workspaceRouteId;
      navigate(`/it/connections/${targetId}/${nextTab}${qs ? `?${qs}` : ''}`);
    },
    [navigate, searchParams, validTab, workspaceRouteId],
  );

  const handleTitleSave = React.useCallback(
    (next: string) => {
      const trimmed = next.trim();
      if (!trimmed) return;
      if (isCreate) {
        patchCreateForm({ name: trimmed });
        return;
      }
      if (!data || trimmed === data.name) return;
      void patchConnection({ name: trimmed });
    },
    [data, isCreate, patchConnection, patchCreateForm],
  );

  const handleTopologyChange = React.useCallback(
    (next: 'server_to_server' | 'multi_server') => {
      if (!data || next === data.topology) return;
      const hasContent =
        legs.length > 0 ||
        !!data.source_asset_id || !!data.source_entity_code ||
        !!data.destination_asset_id || !!data.destination_entity_code ||
        (data.servers || []).length > 0;
      if (hasContent) {
        setPendingTopology(next);
        return;
      }
      void patchConnection({ topology: next });
    },
    [data, legs.length, patchConnection],
  );

  const handleConfirmTopology = React.useCallback(() => {
    if (!pendingTopology) return;
    const next = pendingTopology;
    setPendingTopology(null);
    if (next === 'multi_server') {
      void patchConnection({
        topology: next,
        source_asset_id: null, source_entity_code: null,
        destination_asset_id: null, destination_entity_code: null,
        servers: (data?.servers ?? []).map((s) => s.id),
      });
    } else {
      void patchConnection({ topology: next });
    }
  }, [data, patchConnection, pendingTopology]);

  const handleEndpointChange = React.useCallback(
    (side: 'source' | 'destination', next: { asset_id: string | null; entity_code: string | null }) => {
      if (side === 'source') {
        void patchConnection({
          source_asset_id: next.asset_id,
          source_entity_code: next.entity_code,
        });
      } else {
        void patchConnection({
          destination_asset_id: next.asset_id,
          destination_entity_code: next.entity_code,
        });
      }
    },
    [patchConnection],
  );

  const handleMultiServerChange = React.useCallback(
    (nextIds: string[]) => {
      void patchConnection({ servers: nextIds });
    },
    [patchConnection],
  );

  const handleProtocolsChange = React.useCallback(
    (next: string[]) => {
      if (next.length === 0) return;
      void patchConnection({ protocol_codes: next });
    },
    [patchConnection],
  );

  const handleProtocolsRichChange = React.useCallback(
    (next: ConnectionProtocol[]) => {
      if (next.length === 0) return;
      void patchConnection({ protocols: next, protocol_codes: next.map((p) => p.code) });
    },
    [patchConnection],
  );

  const handleLifecycleChange = React.useCallback(
    (next: string) => {
      if (!data || next === data.lifecycle) return;
      void patchConnection({ lifecycle: next });
    },
    [data, patchConnection],
  );

  const handleCriticalityChange = React.useCallback(
    (next: string) => {
      if (!data || next === data.criticality) return;
      void patchConnection({ criticality: next || null } as any);
    },
    [data, patchConnection],
  );

  const handleDataClassChange = React.useCallback(
    (next: string) => {
      if (!data || next === data.data_class) return;
      void patchConnection({ data_class: next || null } as any);
    },
    [data, patchConnection],
  );

  const handleContainsPiiChange = React.useCallback(
    (next: boolean) => {
      if (!data || next === data.contains_pii) return;
      void patchConnection({ contains_pii: next });
    },
    [data, patchConnection],
  );

  const handleRiskModeChange = React.useCallback(
    (next: 'manual' | 'derived') => {
      if (!data || next === data.risk_mode) return;
      void patchConnection({ risk_mode: next });
    },
    [data, patchConnection],
  );

  const handleCreate = async () => {
    if (!canManage) return;
    const validationMessage = getCreateValidationMessage(createForm);
    if (validationMessage) {
      setCreateError(validationMessage);
      return;
    }
    setCreateSubmitting(true);
    setCreateError(null);
    try {
      const res = await api.post('/connections', {
        name: createForm.name.trim(),
        description: createForm.description.trim() || null,
        topology: createForm.topology,
        lifecycle: createForm.lifecycle,
        protocol_codes: createForm.protocolCodes,
        criticality: createForm.criticality || null,
        data_class: createForm.dataClass || null,
        contains_pii: createForm.containsPii,
        risk_mode: 'manual',
        ...(createForm.topology === 'server_to_server'
          ? {
              source_asset_id: createForm.source.asset_id,
              source_entity_code: createForm.source.entity_code,
              destination_asset_id: createForm.destination.asset_id,
              destination_entity_code: createForm.destination.entity_code,
            }
          : {
              servers: createForm.servers.map((server) => server.id),
            }),
      });
      const saved = res.data as ConnectionDetail;
      const targetTab = validTab === 'path' ? 'path' : 'overview';
      navigate(`/it/connections/${saved.connection_reference || saved.id}/${targetTab}`, { replace: true });
    } catch (e: any) {
      setCreateError(getApiErrorMessage(e, t, t('messages.saveConnectionFailed') || 'Failed to create connection'));
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!connectionId || !canDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/connections/${connectionId}`);
      handleClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.deleteConnectionFailed') || 'Failed to delete connection'));
    } finally {
      setDeleting(false);
      setDeleteDialogOpen(false);
    }
  };

  const navSort = searchParams.get('sort') || '';
  const navQ = searchParams.get('q') || '';
  const navFilters = searchParams.get('filters') || '';
  const navState = useConnectionItemNav({
    id: connectionId,
    sort: navSort,
    q: navQ,
    filters: navFilters,
  });
  const { total, index, hasPrev, hasNext, prevId, nextId } = isCreate || !connectionId
    ? { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null as string | null, nextId: null as string | null }
    : navState;

  const goToConnection = React.useCallback(
    (targetId: string | null) => {
      if (!targetId) return;
      const qs = searchParams.toString();
      navigate(`/it/connections/${targetId}/${validTab}${qs ? `?${qs}` : ''}`);
    },
    [navigate, searchParams, validTab],
  );

  const workspaceTabs: PortfolioDetailWorkspaceTab[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'path', label: 'Path', badge: legs.length || undefined },
  ];

  const title = isCreate ? createForm.name : data?.name || '';

  const assetMap = React.useMemo(() => {
    const map: Record<string, AssetSummary> = {};
    if (!data) return map;
    if (data.source_server) map[data.source_server.id] = data.source_server;
    if (data.destination_server) map[data.destination_server.id] = data.destination_server;
    (data.servers || []).forEach((s) => { if (s) map[s.id] = s; });
    return map;
  }, [data]);

  const endpointsLabel = (() => {
    if (!data) return 'Endpoints missing';
    if (data.topology === 'server_to_server') {
      const fmt = (assetId: string | null, entityCode: string | null, asset: AssetSummary | null) => {
        if (assetId && asset) return asset.asset_reference || asset.name;
        if (assetId) return 'Server';
        if (entityCode) return `entity:${entityCode}`;
        return '?';
      };
      const src = fmt(data.source_asset_id, data.source_entity_code, data.source_server);
      const dst = fmt(data.destination_asset_id, data.destination_entity_code, data.destination_server);
      return `${src} → ${dst}`;
    }
    const count = (data.servers || []).length;
    return count > 0 ? `${count} servers` : 'No servers';
  })();

  const selectedCreateProtocols = React.useMemo(
    () => createForm.protocolCodes.map((code) => (
      connectionTypes.find((ct) => ct.code === code) || { code, label: code }
    )),
    [connectionTypes, createForm.protocolCodes],
  );

  const createDrawerProperties = isCreate ? (
    <>
      <PropertyGroup>
        <PropertyRow label="Lifecycle">
          <TextField
            select
            value={createForm.lifecycle || ''}
            onChange={(e) => patchCreateForm({ lifecycle: e.target.value })}
            variant="standard"
            sx={drawerSelectSx}
            disabled={!canManage || createSubmitting}
          >
            {lifecycleOptions.length === 0 && createForm.lifecycle && (
              <MenuItem value={createForm.lifecycle} sx={drawerMenuItemSx}>
                {createForm.lifecycle}
              </MenuItem>
            )}
            {lifecycleOptions.map((opt) => (
              <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>
                {opt.deprecated ? `${opt.label} (deprecated)` : opt.label}
              </MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label="Topology">
          <TextField
            select
            value={createForm.topology}
            onChange={(e) => patchCreateForm({ topology: e.target.value as 'server_to_server' | 'multi_server' })}
            variant="standard"
            sx={drawerSelectSx}
            disabled={!canManage || createSubmitting}
          >
            <MenuItem value="server_to_server" sx={drawerMenuItemSx}>Server to server</MenuItem>
            <MenuItem value="multi_server" sx={drawerMenuItemSx}>Multi-server</MenuItem>
          </TextField>
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label="Risk mode">
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>Manual</Typography>
        </PropertyRow>
        <PropertyRow label="Criticality">
          <TextField
            select
            value={createForm.criticality}
            onChange={(e) => patchCreateForm({ criticality: e.target.value })}
            variant="standard"
            sx={drawerSelectSx}
            disabled={!canManage || createSubmitting}
          >
            {CRITICALITIES.map((opt) => (
              <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>{opt.label}</MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label="Data class">
          <TextField
            select
            value={createForm.dataClass || ''}
            onChange={(e) => patchCreateForm({ dataClass: e.target.value })}
            variant="standard"
            sx={drawerSelectSx}
            disabled={!canManage || createSubmitting}
          >
            {dataClassOptions.length === 0 && createForm.dataClass && (
              <MenuItem value={createForm.dataClass} sx={drawerMenuItemSx}>
                {createForm.dataClass}
              </MenuItem>
            )}
            {dataClassOptions.map((opt) => (
              <MenuItem key={opt.code} value={opt.code} sx={drawerMenuItemSx}>{opt.label}</MenuItem>
            ))}
          </TextField>
        </PropertyRow>
        <PropertyRow label="Contains PII">
          <Switch
            size="small"
            checked={createForm.containsPii}
            onChange={(e) => patchCreateForm({ containsPii: e.target.checked })}
            disabled={!canManage || createSubmitting}
          />
        </PropertyRow>
      </PropertyGroup>

      <PropertyGroup>
        <PropertyRow label="Created">
          <Typography sx={{ fontSize: 13, color: 'kanap.text.tertiary' }}>After creation</Typography>
        </PropertyRow>
      </PropertyGroup>
    </>
  ) : null;

  const drawerProperties = isCreate ? createDrawerProperties : data ? (
    <ConnectionPropertiesDrawer
      lifecycle={data.lifecycle}
      topology={data.topology}
      topologyDisabled={legs.length > 0}
      riskMode={data.risk_mode}
      criticality={data.criticality}
      dataClass={data.data_class}
      containsPii={data.contains_pii}
      effectiveCriticality={data.effective_criticality}
      effectiveDataClass={data.effective_data_class}
      effectiveContainsPii={data.effective_contains_pii}
      derivedInterfaceCount={data.derived_interface_count || 0}
      classificationIncomplete={!!data.classification_incomplete}
      derivedAvailable={linkedInterfaces.length > 0}
      createdAt={data.created_at}
      updatedAt={data.updated_at}
      disabled={!canManage || saving}
      onLifecycleChange={handleLifecycleChange}
      onTopologyChange={handleTopologyChange}
      onRiskModeChange={handleRiskModeChange}
      onCriticalityChange={handleCriticalityChange}
      onDataClassChange={handleDataClassChange}
      onContainsPiiChange={handleContainsPiiChange}
    />
  ) : null;

  const metadata = !isCreate && data ? (
    <ConnectionMetadataBar
      lifecycle={data.lifecycle}
      topology={data.topology}
      topologyDisabled={legs.length > 0}
      criticality={data.criticality}
      effectiveCriticality={data.effective_criticality}
      riskMode={data.risk_mode}
      derivedInterfaceCount={data.derived_interface_count || 0}
      classificationIncomplete={!!data.classification_incomplete}
      protocolCodes={data.protocol_codes}
      protocolLabels={data.protocol_codes}
      endpointsLabel={endpointsLabel}
      disabled={!canManage || saving}
      onLifecycleChange={handleLifecycleChange}
      onTopologyChange={handleTopologyChange}
      onCriticalityChange={handleCriticalityChange}
      onProtocolCodesChange={handleProtocolsChange}
    />
  ) : undefined;

  const actions = (
    <>
      {isCreate && (
        <Button
          variant="contained"
          onClick={() => void handleCreate()}
          disabled={createSubmitting || !canManage}
          size="small"
        >
          Create
        </Button>
      )}
      {!isCreate && data && (
        <>
          <Button
            variant="action"
            startIcon={<HubOutlinedIcon sx={{ fontSize: '14px !important' }} />}
            size="small"
            onClick={() => navigate(`/it/connection-map?focusConnectionId=${data.id}`)}
          >
            View in map
          </Button>
          <SendLinkButton
            itemType={'connection' as any}
            itemId={data.id}
            itemRef={data.connection_reference || null}
            itemName={data.name || 'Untitled connection'}
          />
        </>
      )}
      {!isCreate && canDelete && (
        <Button
          variant="action-danger"
          startIcon={<DeleteIcon sx={{ fontSize: '14px !important' }} />}
          size="small"
          onClick={() => setDeleteDialogOpen(true)}
          disabled={deleting}
        >
          Delete
        </Button>
      )}
    </>
  );

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {error && <Alert severity="error" sx={{ mx: 2, mt: 1 }} onClose={() => setError(null)}>{error}</Alert>}
      <PortfolioDetailWorkspaceShell
        activeTab={validTab}
        tabs={workspaceTabs}
        onTabChange={handleTabChange}
        drawerStorageKey="kanap.connections.drawerOpen"
        backLabel={t('pages.connections.title')}
        onBack={handleClose}
        itemReference={!isCreate ? data?.connection_reference || null : null}
        onCopyReference={
          !isCreate && data?.connection_reference
            ? () => { void navigator.clipboard?.writeText(data.connection_reference); }
            : undefined
        }
        title={title}
        titleFallback={isCreate ? 'New connection' : 'Untitled connection'}
        canEditTitle={canManage}
        onTitleSave={handleTitleSave}
        isCreate={isCreate}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => goToConnection(prevId),
          onNext: () => goToConnection(nextId),
          previousLabel: 'Previous connection',
          nextLabel: 'Next connection',
        } : undefined}
        metadata={metadata}
        actions={actions}
        properties={drawerProperties}
      >
        {isCreate && validTab === 'path' ? (
          <Box sx={{ maxWidth: 760 }}>
            <SectionHeader>Path</SectionHeader>
            <Alert severity="info" sx={{ fontSize: 13 }}>
              Create the connection first to add network path hops.
            </Alert>
            {createError && <Alert severity="error" sx={{ mt: 1.5, fontSize: 13 }}>{createError}</Alert>}
          </Box>
        ) : isCreate ? (
          <Box sx={{ maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <Box>
              <SectionHeader>Create connection</SectionHeader>
              <Stack spacing={1.25}>
                <PropertyRow label="Name" required valueSx={{ maxWidth: 560 }}>
                  <TextField
                    value={createForm.name}
                    onChange={(e) => patchCreateForm({ name: e.target.value })}
                    placeholder="e.g., App tier to DB tier"
                    required
                    size="small"
                    variant="standard"
                    sx={drawerFieldValueSx}
                    disabled={!canManage || createSubmitting}
                  />
                </PropertyRow>
                <PropertyRow label="Topology" required valueSx={{ maxWidth: 360 }}>
                  <TextField
                    select
                    value={createForm.topology}
                    onChange={(e) => patchCreateForm({ topology: e.target.value as 'server_to_server' | 'multi_server' })}
                    size="small"
                    variant="standard"
                    sx={drawerSelectSx}
                    disabled={!canManage || createSubmitting}
                  >
                    <MenuItem value="server_to_server" sx={drawerMenuItemSx}>Server to server</MenuItem>
                    <MenuItem value="multi_server" sx={drawerMenuItemSx}>Multi-server</MenuItem>
                  </TextField>
                </PropertyRow>
              </Stack>
            </Box>

            <Box>
              <SectionHeader>Endpoints</SectionHeader>
              {createForm.topology === 'server_to_server' ? (
                <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, minmax(0, 1fr))' }, gap: 2.5 }}>
                  <ConnectionEndpointPicker
                    label="Source"
                    value={createForm.source}
                    disabled={!canManage || createSubmitting}
                    onChange={(next) => patchCreateForm({ source: next })}
                  />
                  <ConnectionEndpointPicker
                    label="Destination"
                    value={createForm.destination}
                    disabled={!canManage || createSubmitting}
                    onChange={(next) => patchCreateForm({ destination: next })}
                  />
                </Box>
              ) : (
                <Box sx={{ maxWidth: 640 }}>
                  <PropertyRow
                    label="Servers"
                    required
                    helperText={createForm.servers.length < 2 ? 'Select at least two servers.' : undefined}
                    valueSx={{ maxWidth: 640 }}
                  >
                    <Autocomplete
                      size="small"
                      multiple
                      disabled={!canManage || createSubmitting}
                      options={createMultiOptions}
                      loading={createMultiLoading}
                      getOptionLabel={(opt) => `${opt.asset_reference ? `${opt.asset_reference} · ` : ''}${opt.name}`}
                      isOptionEqualToValue={(opt, val) => opt.id === val.id}
                      value={createForm.servers}
                      onChange={(_, val) => patchCreateForm({ servers: val })}
                      onInputChange={(_, val, reason) => {
                        if (reason !== 'reset') setCreateMultiSearch(val);
                      }}
                      renderTags={(value, getTagProps) =>
                        value.map((opt, index) => (
                          <Chip
                            {...getTagProps({ index })}
                            key={opt.id}
                            label={`${opt.asset_reference ? `${opt.asset_reference} · ` : ''}${opt.name}`}
                            size="small"
                          />
                        ))
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          variant="standard"
                          placeholder="Add a server"
                          sx={drawerFieldValueSx}
                        />
                      )}
                    />
                  </PropertyRow>
                </Box>
              )}
            </Box>

            <Box>
              <SectionHeader>Protocols</SectionHeader>
              <PropertyRow label="Protocols" required valueSx={{ maxWidth: 640 }}>
                <Autocomplete
                  size="small"
                  multiple
                  disabled={!canManage || createSubmitting}
                  options={connectionTypes}
                  getOptionLabel={(opt) => opt.label}
                  isOptionEqualToValue={(opt, val) => opt.code === val.code}
                  value={selectedCreateProtocols}
                  onChange={(_, val) => patchCreateForm({ protocolCodes: val.map((v) => v.code) })}
                  renderTags={(value, getTagProps) =>
                    value.map((opt, index) => (
                      <Chip {...getTagProps({ index })} key={opt.code} label={opt.label} size="small" />
                    ))
                  }
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      variant="standard"
                      placeholder="Add a protocol"
                      sx={drawerFieldValueSx}
                    />
                  )}
                />
              </PropertyRow>
            </Box>

            <Box>
              <SectionHeader>Description</SectionHeader>
              <TextField
                value={createForm.description}
                onChange={(e) => patchCreateForm({ description: e.target.value })}
                placeholder="What this connection does, why it exists, special considerations..."
                variant="standard"
                multiline
                minRows={4}
                maxRows={12}
                sx={longFormSurfaceFieldSx}
                disabled={!canManage || createSubmitting}
              />
            </Box>

            {createError && <Alert severity="error" sx={{ maxWidth: 640 }}>{createError}</Alert>}
          </Box>
        ) : !data ? null : validTab === 'path' ? (
          <ConnectionPathTab
            connectionId={data.id}
            hops={legs}
            canManage={canManage}
            defaultProtocolCodes={data.protocol_codes || []}
            protocols={
              data.protocols ?? (data.protocol_codes || []).map((code) => ({ code, port_override: null }))
            }
            assetMap={Object.fromEntries(
              Object.entries(assetMap).map(([id, a]) => [id, { name: a.name, reference: a.asset_reference || null }]),
            )}
            sourceLabel={(() => {
              if (data.source_asset_id && data.source_server) return data.source_server.asset_reference ? `${data.source_server.asset_reference} · ${data.source_server.name}` : data.source_server.name;
              if (data.source_entity_code) return `entity:${data.source_entity_code}`;
              if (data.topology === 'multi_server') return `${(data.servers || []).length} servers (multi-server)`;
              return 'Source missing';
            })()}
            destinationLabel={(() => {
              if (data.destination_asset_id && data.destination_server) return data.destination_server.asset_reference ? `${data.destination_server.asset_reference} · ${data.destination_server.name}` : data.destination_server.name;
              if (data.destination_entity_code) return `entity:${data.destination_entity_code}`;
              if (data.topology === 'multi_server') return `${(data.servers || []).length} servers (multi-server)`;
              return 'Destination missing';
            })()}
            onChange={setLegs}
          />
        ) : (
          <ConnectionOverviewTab
            connectionId={data.id}
            topology={data.topology}
            initialDescription={data.description || ''}
            canManage={canManage}
            source={{ asset_id: data.source_asset_id, entity_code: data.source_entity_code }}
            destination={{ asset_id: data.destination_asset_id, entity_code: data.destination_entity_code }}
            multiServerIds={(data.servers || []).map((s) => s.id)}
            assetMap={assetMap}
            protocols={
              data.protocols ?? (data.protocol_codes || []).map((code) => ({ code, port_override: null }))
            }
            riskMode={data.risk_mode}
            linkedInterfaces={linkedInterfaces}
            linkedInterfacesLoading={linkedInterfacesLoading}
            linkedInterfacesError={linkedInterfacesError}
            derivedInterfaceCount={data.derived_interface_count || 0}
            onDescriptionSaved={(next) => setData((prev) => prev ? { ...prev, description: next } : prev)}
            onEndpointChange={handleEndpointChange}
            onMultiServerChange={handleMultiServerChange}
            onProtocolsChange={handleProtocolsRichChange}
            onLinkedInterfacesChanged={handleLinkedInterfacesChanged}
          />
        )}
      </PortfolioDetailWorkspaceShell>

      <KanapDialog
        open={deleteDialogOpen}
        title="Delete connection?"
        onClose={() => !deleting && setDeleteDialogOpen(false)}
        onSave={handleDelete}
        saveLabel="Delete"
        saveDisabled={deleting}
        saveLoading={deleting}
      >
        <Stack spacing={1}>
          <Box sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            {linkedInterfaces.length > 0
              ? `This will permanently delete this connection and unlink it from ${linkedInterfaces.length} interface ${linkedInterfaces.length === 1 ? 'binding' : 'bindings'}. The interfaces themselves are not deleted.`
              : 'This will permanently delete this connection.'}
          </Box>
        </Stack>
      </KanapDialog>

      <KanapDialog
        open={!!pendingTopology}
        title="Change topology?"
        onClose={() => setPendingTopology(null)}
        onSave={handleConfirmTopology}
        saveLabel="Continue"
        saveDisabled={saving}
        saveLoading={saving}
      >
        <Stack spacing={1}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            {pendingTopology === 'multi_server'
              ? 'Switching to multi-server will clear the source and destination endpoints.'
              : 'Switching to server-to-server will clear the multi-server list.'}
          </Typography>
          {legs.length > 0 && (
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              Existing layers ({legs.length}) are kept; review their endpoints after the change.
            </Typography>
          )}
        </Stack>
      </KanapDialog>
    </Box>
  );
}
