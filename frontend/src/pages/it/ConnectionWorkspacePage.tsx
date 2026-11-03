import React from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useNotify } from '../../components/notify/NotifyProvider';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell, {
  type PortfolioDetailWorkspaceTab,
} from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import KanapDialog from '../../components/design/KanapDialog';
import SendLinkButton from '../../components/workspace/SendLinkButton';
import ConnectionMetadataBar from './workspace/ConnectionMetadataBar';
import ConnectionPropertiesDrawer from './workspace/ConnectionPropertiesDrawer';
import ConnectionOverviewTab, { type ConnectionProtocol } from './workspace/ConnectionOverviewTab';
import ConnectionPathTab from './workspace/ConnectionPathTab';
import useClusterConnectionQuestion from './components/useClusterConnectionQuestion';
import { useConnectionItemNav } from '../../hooks/useModuleItemNav';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import type { ConnectionPathHop } from './workspace/ConnectionPathSection';
import type { ServerOption } from '../../components/fields/serverOptionRender';
import { useRecentlyViewed } from '../workspace/hooks/useRecentlyViewed';
import { carryListFilters } from '../../lib/listContext';
import DeleteIconButton from '../../components/workspace/DeleteIconButton';
import { connectionDeleteMessage } from './connectionDeleteMessage';
import { RECORD_HISTORY_TAB_KEY } from '../../components/history/recordHistoryTabKey';
import { WorkspaceTabBoundary, retryableLazy } from '../../components/workspace/WorkspaceTabBoundary';
import { CreationActions, CreationPreview, useCreationReturn, useNewRecordCreate, useRecordCreation } from '../../components/workspace/creation';
import useIncompleteLeave from '../../components/workspace/creation/useIncompleteLeave';
import { missingFieldsList } from '../../components/workspace/creation/missingFieldsList';
import { useLeaveGuard } from '../../hooks/leaveGuard';

type TabKey = 'overview' | 'path' | typeof RECORD_HISTORY_TAB_KEY;
const TAB_KEYS: TabKey[] = ['overview', 'path', RECORD_HISTORY_TAB_KEY];

// The History tab loads with its tab; a failed chunk shows a retry button in its place.
const historyTab = retryableLazy(() => import('../../components/history/RecordHistoryTab'));
const HistoryTab = historyTab.Component;

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

type AbsorbedAsset = { asset_id: string; name: string; cluster_id: string; cluster_name: string };

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
  source_server: ServerOption | null;
  destination_server: ServerOption | null;
  servers: ServerOption[];
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


/** What a connection needs before its creation ends (`connection-creation.ts` on the server), in screen order. */
function missingOf(connection: ConnectionDetail | null): string[] {
  if (!connection) return [];
  const fields: string[] = [];
  if ((connection.protocol_codes || []).length === 0) fields.push('protocols');
  if (connection.topology === 'multi_server') {
    if ((connection.servers || []).length < 2) fields.push('servers');
  } else {
    if (!connection.source_asset_id && !connection.source_entity_code) fields.push('source');
    if (!connection.destination_asset_id && !connection.destination_entity_code) fields.push('destination');
  }
  return fields;
}

/** The connection a new page shows dimmed under its title: the one the title will create. */
const DRAFT_CONNECTION: ConnectionDetail = {
  id: '',
  connection_reference: '',
  name: '',
  description: null,
  topology: 'server_to_server',
  source_asset_id: null,
  source_entity_code: null,
  destination_asset_id: null,
  destination_entity_code: null,
  source_server: null,
  destination_server: null,
  servers: [],
  protocol_codes: [],
  protocols: [],
  lifecycle: 'active',
  criticality: '',
  data_class: '',
  contains_pii: false,
  risk_mode: 'manual',
  effective_criticality: '',
  effective_data_class: '',
  effective_contains_pii: false,
  derived_interface_count: 0,
  created_at: '',
  updated_at: '',
};

const ignoreDraft = () => undefined;

export default function ConnectionWorkspacePage() {
  const { t, i18n } = useTranslation(['it', 'common']);
  const { hasLevel } = useAuth();
  const navigate = useNavigate();
  const params = useParams();
  const [searchParams] = useSearchParams();
  const { labelFor } = useItOpsEnumOptions();
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

  // A refusal of the name typed on a new connection.
  const [titleError, setTitleError] = React.useState<string | null>(null);
  const creatingRef = React.useRef(false);
  const newCreate = useNewRecordCreate({ setTitleError, requiredMessage: t('messages.nameRequired') });
  const descriptionFlushRef = React.useRef<(() => Promise<void>) | null>(null);
  const notify = useNotify();
  const notifyAbsorbed = React.useCallback((items: AbsorbedAsset[] | undefined) => {
    if (!items?.length) return;
    notify({
      tone: 'info',
      message: t('workspace.connection.absorbed', {
        count: items.length,
        names: Array.from(new Set(items.map((item) => item.name))).join(', '),
        clusters: Array.from(new Set(items.map((item) => item.cluster_name))).join(', '),
      }),
    });
  }, [notify, t]);
  const { choose, questionDialog } = useClusterConnectionQuestion();

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
      setError(getApiErrorMessage(e, t, t('messages.loadConnectionFailed')));
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
        getApiErrorMessage(e, t, t('messages.loadLinkedInterfacesFailed')),
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
    async (
      patch: Partial<ConnectionDetail> | Record<string, any>,
      localPatch?: Partial<ConnectionDetail> | Record<string, any>,
    ) => {
      if (!connectionId) return;
      const local = localPatch ?? patch;
      setSaving(true);
      setData((prev) => (prev ? { ...prev, ...(local as any) } as ConnectionDetail : prev));
      try {
        const res = await api.patch<ConnectionDetail & { absorbed?: AbsorbedAsset[] }>(`/connections/${connectionId}`, patch);
        const { absorbed: absorbedItems, ...saved } = res.data;
        setData((prev) => (prev ? { ...prev, ...saved } : saved as ConnectionDetail));
        notifyAbsorbed(absorbedItems);
        setError(null);
      } catch (e: any) {
        const message = getApiErrorMessage(e, t, t('messages.saveConnectionFailed'));
        // The reload clears the page error: say why the write was refused once it is done.
        await load();
        setError(message);
      } finally {
        setSaving(false);
      }
    },
    [connectionId, load, notifyAbsorbed, t],
  );

  const listContextParams = React.useMemo(() => {
    const sp = new URLSearchParams();
    const sort = searchParams.get('sort');
    const q = searchParams.get('q');
    if (sort) sp.set('sort', sort);
    if (q) sp.set('q', q);
    carryListFilters(sp, searchParams);
    return sp;
  }, [searchParams]);

  const listPath = React.useMemo(() => {
    const qs = listContextParams.toString();
    return `/it/connections${qs ? `?${qs}` : ''}`;
  }, [listContextParams]);
  // Where the creation started: a new connection left empty, cancelled or created goes back there.
  const creationReturn = useCreationReturn(listPath);
  const creation = useRecordCreation({
    family: 'connections',
    apiBase: '/connections',
    recordId: isCreate ? null : data?.id ?? null,
    listPath,
    recordLabel: t('workspace.connection.creation.record'),
    queryKeyPrefixes: ['connections'],
    onError: setError,
  });

  // The fields a connection being created still lacks, named in the reader's language.
  const fieldLabel = React.useCallback((key: string): string => {
    if (key === 'protocols') return t('workspace.connection.overview.protocols');
    if (key === 'source') return t('workspace.connection.layers.source');
    if (key === 'destination') return t('workspace.connection.layers.destination');
    if (key === 'servers') return t('pages.connections.columns.servers');
    return key;
  }, [t]);
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const focusField = React.useCallback((key: string) => {
    if (validTab !== 'overview') navigate(`/it/connections/${workspaceRouteId}/overview${searchParams.toString() ? `?${searchParams.toString()}` : ''}`);
    let tries = 0;
    const attempt = () => {
      const input = document.querySelector<HTMLElement>(`[data-creation-field="${key}"] input, [data-creation-field="${key}"] [role="combobox"]`);
      if (input) {
        input.focus();
        return;
      }
      tries += 1;
      if (tries < 20) window.setTimeout(attempt, 25);
    };
    window.setTimeout(attempt, 0);
  }, [navigate, searchParams, validTab, workspaceRouteId]);
  const incompleteLeave = useIncompleteLeave({
    keys: 'it:workspace.connection.creation',
    beingCreated: creation.beingCreated,
    missing: () => missingOf(dataRef.current).map((key) => ({ key, label: fieldLabel(key) })),
    focus: focusField,
    onDelete: () => creation.cancelCreation({ leave: false }),
  });
  // Leaving a connection being created that still lacks a field asks first: complete it, or delete it.
  const leaveAsks = React.useCallback(
    () => creation.beingCreated && missingOf(dataRef.current).length > 0,
    [creation.beingCreated],
  );
  const leaveConnection = React.useCallback(
    () => (leaveAsks() ? incompleteLeave.confirm() : Promise.resolve(true)),
    [incompleteLeave, leaveAsks],
  );
  useLeaveGuard(leaveAsks, leaveConnection);

  const handleClose = React.useCallback(async () => {
    if (isCreate) {
      navigate(creationReturn);
      return;
    }
    if (!(await leaveConnection())) return;
    navigate(listPath);
  }, [creationReturn, isCreate, leaveConnection, listPath, navigate]);

  const handleTabChange = React.useCallback(
    (nextTab: string) => {
      if (nextTab === validTab) return;
      const qs = searchParams.toString();
      const targetId = workspaceRouteId;
      navigate(`/it/connections/${targetId}/${nextTab}${qs ? `?${qs}` : ''}`);
    },
    [navigate, searchParams, validTab, workspaceRouteId],
  );

  // A plain function: the create it calls is declared further down, with this render's creation.
  const handleTitleSave = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed) return;
    if (isCreate) {
      newCreate.titleSent();
      void createConnection(trimmed);
      return;
    }
    if (!data || trimmed === data.name) return;
    void patchConnection({ name: trimmed });
  };

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
    async (
      side: 'source' | 'destination',
      next: { asset_id: string | null; entity_code: string | null },
      asset?: ServerOption,
    ) => {
      let endpoint = { asset_id: next.asset_id, entity_code: next.entity_code };
      if (asset) {
        const opposite = side === 'source' ? data?.destination_asset_id : data?.source_asset_id;
        const target = await choose(asset, opposite ? [opposite] : []);
        if (!target) return;
        endpoint = { asset_id: target.id, entity_code: null };
      }
      if (side === 'source') {
        void patchConnection({
          source_asset_id: endpoint.asset_id,
          source_entity_code: endpoint.entity_code,
        });
      } else {
        void patchConnection({
          destination_asset_id: endpoint.asset_id,
          destination_entity_code: endpoint.entity_code,
        });
      }
    },
    [choose, data?.destination_asset_id, data?.source_asset_id, patchConnection],
  );

  // A cluster absorbs the member it covers: the added id becomes the cluster's, once, before the write.
  const resolveServerList = React.useCallback(
    async (next: ServerOption[], current: ServerOption[]) => {
      const currentIds = new Set(current.map((server) => server.id));
      let resolved = [...next];
      for (const added of next.filter((server) => !currentIds.has(server.id))) {
        const others = resolved.filter((server) => server.id !== added.id).map((server) => server.id);
        const target = await choose(added, others);
        if (!target) {
          resolved = resolved.filter((server) => server.id !== added.id);
          continue;
        }
        if (target.id !== added.id) {
          resolved = resolved.filter((server) => server.id !== added.id);
          if (!resolved.some((server) => server.id === target.id)) resolved.push(target);
        }
      }
      return resolved;
    },
    [choose],
  );

  const handleMultiServerChange = React.useCallback(
    async (next: ServerOption[]) => {
      const current = data?.servers ?? [];
      const resolved = await resolveServerList(next, current);
      void patchConnection({ servers: resolved.map((server) => server.id) }, { servers: resolved });
    },
    [data?.servers, patchConnection, resolveServerList],
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

  // The name committed in the header creates the connection at once (server to server, no protocol
  // nor end yet); the page moves to it, every tab open, with Create and Cancel (or closes it, kept,
  // when Create was clicked meanwhile).
  const createConnection = async (name: string) => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setTitleError(null);
    setError(null);
    try {
      const res = await api.post<ConnectionDetail & { creation_token: string }>('/connections/creation', { name });
      const { creation_token: token, ...created } = res.data;
      if (newCreate.titleSettled()) {
        navigate(creationReturn, { replace: true });
        return;
      }
      creation.startCreation({ recordId: created.id, token, returnTo: creationReturn });
      // The page keeps its header while the full connection loads.
      setData({ ...DRAFT_CONNECTION, ...created });
      setLegs([]);
      navigate(`/it/connections/${created.connection_reference || created.id}/overview`, { replace: true });
    } catch (e) {
      newCreate.titleSettled();
      setTitleError(getApiErrorMessage(e, t, t('messages.saveConnectionFailed')));
    } finally {
      creatingRef.current = false;
    }
  };

  // Create: on the new page, the title is the only field; on a connection being created, what is
  // still being typed is saved, then the server checks what the connection needs. Missing fields are
  // named once and the first one gets the focus; otherwise the connection is kept and closed.
  const [completing, setCompleting] = React.useState(false);
  const createAction = async () => {
    if (isCreate) {
      newCreate.create(titleError);
      return;
    }
    const token = creation.token;
    if (!data?.id || !token || completing) return;
    await descriptionFlushRef.current?.();
    setCompleting(true);
    setError(null);
    try {
      await api.post(`/connections/${data.id}/creation/complete`, { token });
      creation.finishCreation();
    } catch (e) {
      const answer = (e as { response?: { data?: { code?: unknown; params?: { fields?: unknown } } } })?.response?.data;
      const fields = answer?.code === 'CREATION_INCOMPLETE' && Array.isArray(answer.params?.fields) ? answer.params.fields.map(String) : null;
      if (fields && fields.length > 0) {
        setError(t('workspace.connection.creation.missing', { fields: missingFieldsList(fields.map(fieldLabel), i18n.resolvedLanguage || i18n.language) }));
        focusField(fields[0]);
      } else {
        setError(getApiErrorMessage(e, t, t('workspace.connection.creation.completeFailed')));
      }
    } finally {
      setCompleting(false);
    }
  };

  // Cancel on a connection being created: what is still being typed is saved first, so the
  // confirmation counts it, then the connection is deleted (`useRecordCreation`).
  const cancelAction = async () => {
    if (isCreate) {
      navigate(creationReturn);
      return;
    }
    await descriptionFlushRef.current?.();
    await creation.cancelCreation();
  };

  const handleDelete = async () => {
    if (!connectionId || !canDelete) return;
    setDeleting(true);
    try {
      await api.delete(`/connections/${connectionId}`);
      handleClose();
    } catch (e: any) {
      setError(getApiErrorMessage(e, t, t('messages.deleteConnectionFailed')));
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
    async (targetId: string | null) => {
      if (!targetId) return;
      if (!(await leaveConnection())) return;
      const qs = searchParams.toString();
      navigate(`/it/connections/${targetId}/${validTab}${qs ? `?${qs}` : ''}`);
    },
    [leaveConnection, navigate, searchParams, validTab],
  );

  const workspaceTabs: PortfolioDetailWorkspaceTab[] = [
    { key: 'overview', label: t('workspace.connection.tabs.overview') },
    { key: 'path', label: t('workspace.connection.tabs.path'), badge: legs.length || undefined, disabled: isCreate },
    { key: RECORD_HISTORY_TAB_KEY, label: t('workspace.connection.tabs.history'), disabled: isCreate },
  ];

  const assetMap = React.useMemo(() => {
    const map: Record<string, ServerOption> = {};
    if (!data) return map;
    if (data.source_server) map[data.source_server.id] = data.source_server;
    if (data.destination_server) map[data.destination_server.id] = data.destination_server;
    (data.servers || []).forEach((s) => { if (s) map[s.id] = s; });
    return map;
  }, [data]);

  const endpointsLabel = (() => {
    if (!data || isCreate) return t('workspace.connection.endpointsMissing');
    if (data.topology === 'server_to_server') {
      const fmt = (assetId: string | null, entityCode: string | null, asset: ServerOption | null) => {
        if (assetId && asset) return asset.asset_reference || asset.name;
        if (assetId) return t('workspace.connection.server');
        if (entityCode) return labelFor('entity', entityCode);
        return '?';
      };
      const src = fmt(data.source_asset_id, data.source_entity_code, data.source_server);
      const dst = fmt(data.destination_asset_id, data.destination_entity_code, data.destination_server);
      return `${src} → ${dst}`;
    }
    const count = (data.servers || []).length;
    return count > 0 ? t('workspace.connection.serverCount', { count }) : t('workspace.connection.noServers');
  })();

  // A new page shows the connection its title will create, dimmed; a created one, itself.
  const shown = isCreate ? DRAFT_CONNECTION : data;
  const protocolsOf = (connection: ConnectionDetail) =>
    connection.protocols ?? (connection.protocol_codes || []).map((code) => ({ code, port_override: null }));

  const drawerProperties = shown ? (
    <ConnectionPropertiesDrawer
      lifecycle={shown.lifecycle}
      topology={shown.topology}
      topologyDisabled={legs.length > 0}
      riskMode={shown.risk_mode}
      criticality={shown.criticality}
      dataClass={shown.data_class}
      containsPii={shown.contains_pii}
      effectiveCriticality={shown.effective_criticality}
      effectiveDataClass={shown.effective_data_class}
      effectiveContainsPii={shown.effective_contains_pii}
      derivedInterfaceCount={shown.derived_interface_count || 0}
      classificationIncomplete={!!shown.classification_incomplete}
      derivedAvailable={linkedInterfaces.length > 0}
      createdAt={shown.created_at}
      updatedAt={shown.updated_at}
      disabled={isCreate || !canManage || saving}
      onLifecycleChange={handleLifecycleChange}
      onTopologyChange={handleTopologyChange}
      onRiskModeChange={handleRiskModeChange}
      onCriticalityChange={handleCriticalityChange}
      onDataClassChange={handleDataClassChange}
      onContainsPiiChange={handleContainsPiiChange}
    />
  ) : null;

  const metadataBar = shown ? (
    <ConnectionMetadataBar
      lifecycle={shown.lifecycle}
      topology={shown.topology}
      topologyDisabled={legs.length > 0}
      criticality={shown.criticality}
      effectiveCriticality={shown.effective_criticality}
      riskMode={shown.risk_mode}
      derivedInterfaceCount={shown.derived_interface_count || 0}
      classificationIncomplete={!!shown.classification_incomplete}
      protocolCodes={shown.protocol_codes}
      protocolLabels={shown.protocol_codes}
      endpointsLabel={endpointsLabel}
      disabled={isCreate || !canManage || saving}
      onLifecycleChange={handleLifecycleChange}
      onTopologyChange={handleTopologyChange}
      onCriticalityChange={handleCriticalityChange}
      onProtocolCodesChange={handleProtocolsChange}
    />
  ) : undefined;
  const metadata = isCreate ? (
    <CreationPreview sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 'inherit' }}>{metadataBar}</CreationPreview>
  ) : metadataBar;

  const actions = (
    <>
      {!isCreate && data && (
        <>
          <Button
            variant="action"
            startIcon={<HubOutlinedIcon sx={{ fontSize: '14px !important' }} />}
            size="small"
            onClick={() => navigate(`/it/connection-map?focusConnectionId=${data.id}`)}
          >
            {t('workspace.connection.viewInMap')}
          </Button>
          <SendLinkButton
            itemType={'connection' as any}
            itemId={data.id}
            itemRef={data.connection_reference || null}
            itemName={data.name || t('workspace.connection.untitled')}
          />
        </>
      )}
      {!isCreate && !creation.beingCreated && canDelete && (
        <DeleteIconButton onClick={() => setDeleteDialogOpen(true)} disabled={deleting} />
      )}
      {(isCreate || creation.beingCreated) && (
        <CreationActions
          busy={creation.cancelling || completing}
          onCreate={() => { void createAction(); }}
          onCancel={() => { void cancelAction(); }}
        />
      )}
    </>
  );

  const overview = (connection: ConnectionDetail) => (
    <ConnectionOverviewTab
      connectionId={connection.id}
      topology={connection.topology}
      initialDescription={connection.description || ''}
      canManage={canManage}
      source={{ asset_id: connection.source_asset_id, entity_code: connection.source_entity_code }}
      destination={{ asset_id: connection.destination_asset_id, entity_code: connection.destination_entity_code }}
      multiServerIds={(connection.servers || []).map((server) => server.id)}
      assetMap={assetMap}
      protocols={protocolsOf(connection)}
      riskMode={connection.risk_mode}
      linkedInterfaces={linkedInterfaces}
      linkedInterfacesLoading={linkedInterfacesLoading}
      linkedInterfacesError={linkedInterfacesError}
      derivedInterfaceCount={connection.derived_interface_count || 0}
      descriptionFlushRef={connection.id ? descriptionFlushRef : undefined}
      onDescriptionSaved={(next) => setData((prev) => prev ? { ...prev, description: next } : prev)}
      onEndpointChange={connection.id ? handleEndpointChange : ignoreDraft}
      onMultiServerChange={connection.id ? handleMultiServerChange : ignoreDraft}
      onProtocolsChange={connection.id ? handleProtocolsRichChange : ignoreDraft}
      onLinkedInterfacesChanged={connection.id ? handleLinkedInterfacesChanged : ignoreDraft}
    />
  );

  return (
    <Box sx={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      <PortfolioDetailWorkspaceShell
        notices={error ? (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : undefined}
        activeTab={isCreate ? 'overview' : validTab}
        tabs={workspaceTabs}
        onTabChange={handleTabChange}
        drawerStorageKey="kanap.connections.drawerOpen"
        backLabel={t('pages.connections.title')}
        onBack={() => { void handleClose(); }}
        itemReference={!isCreate ? data?.connection_reference || null : null}
        onCopyReference={
          !isCreate && data?.connection_reference
            ? () => { void navigator.clipboard?.writeText(data.connection_reference); }
            : undefined
        }
        title={isCreate ? '' : data?.name || ''}
        titleFallback={isCreate ? t('workspace.connection.newTitle') : t('workspace.connection.untitled')}
        canEditTitle={canManage}
        onTitleSave={handleTitleSave}
        onTitleDraftChange={isCreate ? () => setTitleError(null) : undefined}
        titleRequiredMessage={t('messages.nameRequired')}
        titleError={isCreate ? titleError : undefined}
        titleAutoEdit={isCreate}
        titleOnCancel={isCreate ? () => { void handleClose(); } : undefined}
        titleFocusRequest={newCreate.focusRequest}
        isCreate={isCreate}
        forceDrawerOpen={isCreate}
        nav={!isCreate && total > 0 ? {
          currentIndex: index + 1,
          totalCount: total,
          hasPrev,
          hasNext,
          onPrev: () => { void goToConnection(prevId); },
          onNext: () => { void goToConnection(nextId); },
          previousLabel: t('workspace.connection.previous'),
          nextLabel: t('workspace.connection.next'),
        } : undefined}
        metadata={metadata}
        actions={actions}
        properties={isCreate ? <CreationPreview>{drawerProperties}</CreationPreview> : drawerProperties}
      >
        {isCreate ? (
          <CreationPreview>{overview(DRAFT_CONNECTION)}</CreationPreview>
        ) : !data ? null : validTab === 'path' ? (
          <ConnectionPathTab
            connectionId={data.id}
            hops={legs}
            canManage={canManage}
            defaultProtocolCodes={data.protocol_codes || []}
            protocols={protocolsOf(data)}
            sourceIsCluster={!!data.source_server?.is_cluster}
            destinationIsCluster={!!data.destination_server?.is_cluster}
            sourceLabel={(() => {
              if (data.source_asset_id && data.source_server) return data.source_server.asset_reference ? `${data.source_server.asset_reference} · ${data.source_server.name}` : data.source_server.name;
              if (data.source_entity_code) return labelFor('entity', data.source_entity_code);
              if (data.topology === 'multi_server') return t('workspace.connection.multiServerCount', { count: (data.servers || []).length });
              return t('workspace.connection.sourceMissing');
            })()}
            destinationLabel={(() => {
              if (data.destination_asset_id && data.destination_server) return data.destination_server.asset_reference ? `${data.destination_server.asset_reference} · ${data.destination_server.name}` : data.destination_server.name;
              if (data.destination_entity_code) return labelFor('entity', data.destination_entity_code);
              if (data.topology === 'multi_server') return t('workspace.connection.multiServerCount', { count: (data.servers || []).length });
              return t('workspace.connection.destinationMissing');
            })()}
            onChange={setLegs}
          />
        ) : validTab === RECORD_HISTORY_TAB_KEY ? (
          <WorkspaceTabBoundary resetKey={validTab} onRetry={historyTab.retry}>
            <React.Suspense fallback={null}>
              <HistoryTab table="connections" recordId={data.id} />
            </React.Suspense>
          </WorkspaceTabBoundary>
        ) : overview(data)}
      </PortfolioDetailWorkspaceShell>

      {questionDialog}
      {incompleteLeave.dialog}

      <KanapDialog
        open={deleteDialogOpen}
        title={data?.name ? t('common:delete.recordTitle', { name: data.name }) : t('workspace.connection.deleteDialog.title')}
        onClose={() => !deleting && setDeleteDialogOpen(false)}
        onSave={handleDelete}
        saveLabel={t('common:buttons.delete')}
        saveDisabled={deleting}
        saveLoading={deleting}
      >
        <Stack spacing={1}>
          <Box sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            {connectionDeleteMessage(t, legs.length, linkedInterfaces.length)}
          </Box>
        </Stack>
      </KanapDialog>

      <KanapDialog
        open={!!pendingTopology}
        title={t('workspace.connection.topologyDialog.title')}
        onClose={() => setPendingTopology(null)}
        onSave={handleConfirmTopology}
        saveLabel={t('common:buttons.continue')}
        saveDisabled={saving}
        saveLoading={saving}
      >
        <Stack spacing={1}>
          <Typography sx={{ fontSize: 13, color: 'kanap.text.primary' }}>
            {pendingTopology === 'multi_server'
              ? t('workspace.connection.topologyDialog.toMultiServer')
              : t('workspace.connection.topologyDialog.toServerToServer')}
          </Typography>
          {legs.length > 0 && (
            <Typography sx={{ fontSize: 12, color: 'kanap.text.tertiary' }}>
              {t('workspace.connection.topologyDialog.layersKept', { count: legs.length })}
            </Typography>
          )}
        </Stack>
      </KanapDialog>
    </Box>
  );
}
