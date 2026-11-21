import React from 'react';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Alert, Box, Button, Link as MuiLink, Stack, Typography } from '@mui/material';
import HubOutlinedIcon from '@mui/icons-material/HubOutlined';
import { useTranslation } from 'react-i18next';
import api from '../../api';
import { useNotify } from '../../components/notify/NotifyProvider';
import { useAuth } from '../../auth/AuthContext';
import PortfolioDetailWorkspaceShell, {
  type PortfolioDetailWorkspaceTab,
} from '../portfolio/workspace/PortfolioDetailWorkspaceShell';
import KanapDialog from '../../components/design/KanapDialog';
import { useKanapDialogs } from '../../components/design';
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
import { CreationActions, CreationPreview, saveEditsSince, useCreationReturn, useCreationTitle, useDraftCreation } from '../../components/workspace/creation';
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

/** The value of a required field, to tell when it changed (its mark goes, `useMissingMarks`). */
function creationFieldValue(connection: ConnectionDetail | null, key: string): unknown {
  if (!connection) return null;
  if (key === 'protocols') return connection.protocol_codes || [];
  if (key === 'servers') return (connection.servers || []).map((server) => server?.id);
  if (key === 'source') return [connection.source_asset_id, connection.source_entity_code];
  if (key === 'destination') return [connection.destination_asset_id, connection.destination_entity_code];
  return null;
}

/**
 * What a connection needs before it is written (`POST /connections`), in screen order: both ends
 * (an asset or an entity each) of a server-to-server connection, or two servers of a multi-server
 * one, then a protocol.
 */
function missingOf(connection: ConnectionDetail | null): string[] {
  if (!connection) return [];
  const fields: string[] = [];
  if (connection.topology === 'multi_server') {
    if ((connection.servers || []).length < 2) fields.push('servers');
  } else {
    if (!connection.source_asset_id && !connection.source_entity_code) fields.push('source');
    if (!connection.destination_asset_id && !connection.destination_entity_code) fields.push('destination');
  }
  if ((connection.protocol_codes || []).length === 0) fields.push('protocols');
  return fields;
}

/** A new connection's draft: server to server, nothing given yet. */
const EMPTY_CONNECTION: ConnectionDetail = {
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

const protocolsOf = (connection: ConnectionDetail) =>
  connection.protocols ?? (connection.protocol_codes || []).map((code) => ({ code, port_override: null }));

/** The draft as `POST /connections` takes it: the name, the topology, its ends or servers, the protocols. */
function createPayload(draft: ConnectionDetail, name: string) {
  const ends = draft.topology === 'multi_server'
    ? { servers: (draft.servers || []).map((server) => server.id) }
    : {
      source_asset_id: draft.source_asset_id,
      source_entity_code: draft.source_entity_code,
      destination_asset_id: draft.destination_asset_id,
      destination_entity_code: draft.destination_entity_code,
    };
  return { name, topology: draft.topology, ...ends, protocols: protocolsOf(draft) };
}

/** The draft's fields `POST /connections` writes: what changes in them while it is written is saved after. */
const DRAFT_FIELDS = [
  'name', 'topology', 'source_asset_id', 'source_entity_code', 'destination_asset_id', 'destination_entity_code',
  'servers', 'protocols', 'protocol_codes',
] as const;

/** Edits of the draft as `PATCH /connections/:id` takes them: servers by id, protocols with their ports. */
function patchOfEdits(edits: Partial<ConnectionDetail>, now: ConnectionDetail): Record<string, unknown> {
  const { servers, protocols, protocol_codes: codes, ...rest } = edits;
  const body: Record<string, unknown> = { ...rest };
  if (servers) body.servers = servers.map((server) => server.id);
  if (protocols || codes) body.protocols = protocolsOf(now);
  return body;
}

/**
 * The field a refusal of `POST /connections` is about: the same asset on both sides (destination),
 * fewer than two servers once cluster members are absorbed, an end or the protocols. Null for any
 * other refusal, said above the page.
 */
function refusedField(error: unknown): string | null {
  const answer = (error as { response?: { data?: { code?: unknown; message?: unknown } } })?.response?.data;
  if (answer?.code === 'connection_same_endpoint') return 'destination';
  if (answer?.code === 'connection_min_servers') return 'servers';
  const message = String(answer?.message ?? '');
  const side = /^(source|destination):/.exec(message);
  if (side) return side[1];
  if (/protocol/i.test(message)) return 'protocols';
  return null;
}

export default function ConnectionWorkspacePage() {
  const { t } = useTranslation(['it', 'common']);
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
  // The HTTP status of the last failed read (0 without a response), null once a read starts.
  const [loadFailure, setLoadFailure] = React.useState<number | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [pendingTopology, setPendingTopology] = React.useState<'server_to_server' | 'multi_server' | null>(null);
  // A new connection's draft: nothing is written before its name, ends and protocol are given.
  const [draft, setDraft] = React.useState<ConnectionDetail>(EMPTY_CONNECTION);
  const draftRef = React.useRef(draft);
  // The draft holds more than its title: leaving it asks first.
  const [createDirty, setCreateDirty] = React.useState(false);
  // The server refused the draft: said on that field until the draft changes.
  const [refusal, setRefusal] = React.useState<{ field: string; message: string } | null>(null);

  const descriptionFlushRef = React.useRef<(() => Promise<void>) | null>(null);
  const protocolsFlushRef = React.useRef<(() => void) | null>(null);
  // The id the draft was written under: a field given after the write (a port that waited for its
  // delay, a late answer to the cluster question) is saved on the connection, not in the draft.
  const writtenIdRef = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (isCreate) writtenIdRef.current = null;
  }, [isCreate]);
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
    setLoadFailure(null);
    try {
      const res = await api.get<ConnectionDetail>(`/connections/${routeId}`, { params: { include: 'legs' } });
      setData(res.data);
      setLegs(res.data.legs || []);
    } catch (e: any) {
      const status = e?.response?.status;
      setLoadFailure(typeof status === 'number' ? status : 0);
      setError(getApiErrorMessage(e, t, t('messages.loadConnectionFailed')));
    } finally {
      setLoading(false);
    }
  }, [isCreate, routeId, t]);

  const loadRef = React.useRef(load);
  loadRef.current = load;
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
      const local = localPatch ?? patch;
      // One way for every field: the draft of a new connection, the connection itself otherwise.
      if (isCreate && !writtenIdRef.current) {
        draftRef.current = { ...draftRef.current, ...(local as Partial<ConnectionDetail>) };
        setDraft(draftRef.current);
        setCreateDirty(true);
        setRefusal(null);
        return;
      }
      const id = isCreate ? writtenIdRef.current : connectionId;
      if (!id) return;
      setSaving(true);
      setData((prev) => (prev ? { ...prev, ...(local as any) } as ConnectionDetail : prev));
      try {
        const res = await api.patch<ConnectionDetail & { absorbed?: AbsorbedAsset[] }>(`/connections/${id}`, patch);
        const { absorbed: absorbedItems, ...saved } = res.data;
        setData((prev) => (prev ? { ...prev, ...saved } : saved as ConnectionDetail));
        notifyAbsorbed(absorbedItems);
        setError(null);
      } catch (e: any) {
        const message = getApiErrorMessage(e, t, t('messages.saveConnectionFailed'));
        // The reload clears the page error: say why the write was refused once it is done.
        await loadRef.current();
        setError(message);
      } finally {
        setSaving(false);
      }
    },
    [connectionId, isCreate, notifyAbsorbed, t],
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
  // Where the creation started: a new connection left, cancelled or created goes back there.
  const creationReturn = useCreationReturn(listPath);
  const dataRef = React.useRef(data);
  dataRef.current = data;
  const title = useCreationTitle({
    requiredMessage: t('messages.nameRequired'),
    onCancel: () => { void handleClose(); },
    onCommit: () => creation.attempt(),
  });
  // The draft is written once it has its name, its ends (or two servers) and a protocol, by one
  // POST that carries it all; the page moves to the connection, every tab open, with Done and Cancel.
  const creation = useDraftCreation({
    isCreate,
    family: 'connections',
    apiBase: '/connections',
    recordId: data?.id ?? null,
    listPath,
    returnTo: creationReturn,
    recordLabel: t('workspace.connection.creation.record'),
    queryKeyPrefixes: ['connections'],
    onError: setError,
    ready: () => !!title.current().trim() && missingOf(draftRef.current).length === 0,
    missing: () => missingOf(isCreate ? draftRef.current : dataRef.current),
    valueOf: (key) => creationFieldValue(isCreate ? draftRef.current : dataRef.current, key),
    post: async () => {
      setError(null);
      setRefusal(null);
      // A port still waiting for its delay goes into the draft before it is sent.
      protocolsFlushRef.current?.();
      const sent = draftRef.current;
      const name = title.current().trim();
      try {
        const res = await api.post<ConnectionDetail & { creation_token: string; absorbed?: AbsorbedAsset[] }>('/connections', createPayload(sent, name));
        const { creation_token: token, absorbed, ...saved } = res.data;
        writtenIdRef.current = saved.id;
        notifyAbsorbed(absorbed);
        // The page keeps the connection in hand while it loads under its reference.
        setData({ ...sent, ...saved, name });
        setLegs([]);
        // What the person gave while the connection was written (a second protocol, another end)
        // is saved on it before the page moves to it.
        try {
          await saveEditsSince<ConnectionDetail, (typeof DRAFT_FIELDS)[number]>({
            sent: { ...sent, name },
            now: () => ({ ...draftRef.current, name: title.current().trim() || name }),
            fields: DRAFT_FIELDS,
            save: async (edits) => {
              const patched = await api.patch<ConnectionDetail & { absorbed?: AbsorbedAsset[] }>(
                `/connections/${saved.id}`,
                patchOfEdits(edits, draftRef.current),
              );
              const { absorbed: absorbedNow, ...connection } = patched.data;
              notifyAbsorbed(absorbedNow);
              setData(connection);
            },
          });
        } catch (e) {
          setError(getApiErrorMessage(e, t, t('messages.saveConnectionFailed')));
        }
        setCreateDirty(false);
        draftRef.current = EMPTY_CONNECTION;
        setDraft(EMPTY_CONNECTION);
        const qs = searchParams.toString();
        const reference = saved.connection_reference || null;
        return { id: saved.id, token, reference, path: `/it/connections/${reference || saved.id}/overview${qs ? `?${qs}` : ''}` };
      } catch (e) {
        const message = getApiErrorMessage(e, t, t('messages.saveConnectionFailed'));
        const field = refusedField(e);
        if (field) setRefusal({ field, message });
        else setError(message);
        return null;
      }
    },
  });
  // Each change of the draft may complete it; a refused draft is sent again once it changes.
  React.useEffect(() => { creation.attempt(); }, [creation.attempt, draft]);

  // Nothing is written before the draft is complete: leaving a draft that holds more than its title asks first.
  const dialogs = useKanapDialogs();
  const confirmDiscard = React.useCallback(() => dialogs.confirm({
    title: t('workspace.connection.discardDialog.title'),
    message: t('workspace.connection.discardDialog.message'),
    confirmLabel: t('common:buttons.discard'),
    intent: 'danger',
  }), [dialogs, t]);
  useLeaveGuard(() => isCreate && createDirty, confirmDiscard);

  const handleClose = React.useCallback(async () => {
    if (isCreate) {
      // The draft is being written: the page moves to the connection, where Cancel deletes it.
      if (creation.writing) return;
      if (createDirty && !(await confirmDiscard())) return;
      navigate(creationReturn);
      return;
    }
    navigate(listPath);
  }, [confirmDiscard, createDirty, creation.writing, creationReturn, isCreate, listPath, navigate]);

  const handleTabChange = React.useCallback(
    (nextTab: string) => {
      if (nextTab === validTab) return;
      const qs = searchParams.toString();
      const targetId = workspaceRouteId;
      navigate(`/it/connections/${targetId}/${nextTab}${qs ? `?${qs}` : ''}`);
    },
    [navigate, searchParams, validTab, workspaceRouteId],
  );

  const handleTitleSave = (next: string) => {
    const trimmed = next.trim();
    if (!trimmed || !data || trimmed === data.name) return;
    void patchConnection({ name: trimmed });
  };

  // On the draft as on the connection: a change that would drop its ends or servers asks first.
  const handleTopologyChange = React.useCallback(
    (next: 'server_to_server' | 'multi_server') => {
      const shownNow = isCreate ? draftRef.current : data;
      if (!shownNow || next === shownNow.topology) return;
      const hasContent =
        legs.length > 0 ||
        !!shownNow.source_asset_id || !!shownNow.source_entity_code ||
        !!shownNow.destination_asset_id || !!shownNow.destination_entity_code ||
        (shownNow.servers || []).length > 0;
      if (hasContent) {
        setPendingTopology(next);
        return;
      }
      void patchConnection({ topology: next });
    },
    [data, isCreate, legs.length, patchConnection],
  );

  const handleConfirmTopology = React.useCallback(() => {
    if (!pendingTopology) return;
    const next = pendingTopology;
    setPendingTopology(null);
    const servers = (isCreate ? draftRef.current : data)?.servers ?? [];
    if (next === 'multi_server') {
      const ends = {
        topology: next,
        source_asset_id: null, source_entity_code: null,
        destination_asset_id: null, destination_entity_code: null,
      };
      void patchConnection(
        { ...ends, servers: servers.map((s) => s.id) },
        { ...ends, source_server: null, destination_server: null, servers },
      );
    } else {
      void patchConnection({ topology: next }, { topology: next, servers: [] });
    }
  }, [data, isCreate, patchConnection, pendingTopology]);

  // The question "the cluster or this server" comes before the choice enters the draft or the connection.
  const handleEndpointChange = React.useCallback(
    async (
      side: 'source' | 'destination',
      next: { asset_id: string | null; entity_code: string | null },
      asset?: ServerOption,
    ) => {
      let endpoint = { asset_id: next.asset_id, entity_code: next.entity_code };
      let server: ServerOption | null = null;
      if (asset) {
        const shownNow = isCreate ? draftRef.current : data;
        const opposite = side === 'source' ? shownNow?.destination_asset_id : shownNow?.source_asset_id;
        const target = await choose(asset, opposite ? [opposite] : []);
        if (!target) return;
        endpoint = { asset_id: target.id, entity_code: null };
        server = target;
      }
      const patch = { [`${side}_asset_id`]: endpoint.asset_id, [`${side}_entity_code`]: endpoint.entity_code };
      void patchConnection(patch, { ...patch, [`${side}_server`]: server });
    },
    [choose, data, isCreate, patchConnection],
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
      const current = (isCreate ? draftRef.current : data)?.servers ?? [];
      const resolved = await resolveServerList(next, current);
      void patchConnection({ servers: resolved.map((server) => server.id) }, { servers: resolved });
    },
    [data, isCreate, patchConnection, resolveServerList],
  );

  const handleProtocolsChange = React.useCallback(
    (next: string[]) => {
      if (next.length === 0) return;
      const ports = new Map(protocolsOf((isCreate ? draftRef.current : data) ?? EMPTY_CONNECTION).map((p) => [p.code, p.port_override]));
      void patchConnection(
        { protocol_codes: next },
        { protocol_codes: next, protocols: next.map((code) => ({ code, port_override: ports.get(code) ?? null })) },
      );
    },
    [data, isCreate, patchConnection],
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

  // Create on the draft, Done on the connection it created: what is still being typed is saved, the
  // missing fields are marked and the first one on screen gets the focus (`useDraftCreation`);
  // otherwise the draft is written, or the connection closed, kept.
  const createAction = async () => {
    if (!isCreate) await descriptionFlushRef.current?.();
    protocolsFlushRef.current?.();
    setError(null);
    creation.create(title.require);
  };

  // Cancel on a connection being created: what is still being typed is saved first, so the
  // confirmation counts it, then the connection is deleted (`useRecordCreation`).
  const cancelAction = async () => {
    if (isCreate) {
      await handleClose();
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
    (targetId: string | null) => {
      if (!targetId) return;
      const qs = searchParams.toString();
      navigate(`/it/connections/${targetId}/${validTab}${qs ? `?${qs}` : ''}`);
    },
    [navigate, searchParams, validTab],
  );

  const workspaceTabs: PortfolioDetailWorkspaceTab[] = [
    { key: 'overview', label: t('workspace.connection.tabs.overview') },
    { key: 'path', label: t('workspace.connection.tabs.path'), badge: legs.length || undefined, disabled: isCreate },
    { key: RECORD_HISTORY_TAB_KEY, label: t('workspace.connection.tabs.history'), disabled: isCreate },
  ];

  // A new page shows its draft; a created one, the connection.
  const shown = isCreate ? draft : data;
  const assetMap = React.useMemo(() => {
    const map: Record<string, ServerOption> = {};
    if (!shown) return map;
    if (shown.source_server) map[shown.source_server.id] = shown.source_server;
    if (shown.destination_server) map[shown.destination_server.id] = shown.destination_server;
    (shown.servers || []).forEach((s) => { if (s) map[s.id] = s; });
    return map;
  }, [shown]);

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
      creating={isCreate}
      disabled={!canManage || saving}
      onLifecycleChange={handleLifecycleChange}
      onTopologyChange={handleTopologyChange}
      onCriticalityChange={handleCriticalityChange}
      onProtocolCodesChange={handleProtocolsChange}
    />
  ) : undefined;
  const metadata = metadataBar;

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
          done={!isCreate}
          busy={creation.cancelling}
          writing={creation.writing}
          onCreate={() => { void createAction(); }}
          onCancel={() => { void cancelAction(); }}
        />
      )}
    </>
  );

  const overview = (connection: ConnectionDetail) => (
    <ConnectionOverviewTab
      connectionId={connection.id}
      creating={isCreate}
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
      missingFields={creation.marked}
      refusals={refusal ? { [refusal.field]: refusal.message } : undefined}
      descriptionFlushRef={connection.id ? descriptionFlushRef : undefined}
      protocolsFlushRef={protocolsFlushRef}
      onDescriptionSaved={(next, savedId) => setData((prev) => (prev && prev.id === savedId ? { ...prev, description: next } : prev))}
      onEndpointChange={handleEndpointChange}
      onMultiServerChange={handleMultiServerChange}
      onProtocolsChange={handleProtocolsRichChange}
      onLinkedInterfacesChanged={handleLinkedInterfacesChanged}
    />
  );

  // A connection that could not be read is a screen of its own: the empty record stays hidden.
  // Only a 404 is "not found" (the English refusal stays hidden); any other failure says what
  // went wrong and offers to read the connection again.
  if (!isCreate && !data && loadFailure !== null) {
    const notFound = loadFailure === 404;
    return (
      <Box sx={{ p: 2 }}>
        {notFound ? (
          <Alert severity="error">{t('workspace.connection.notFound')}</Alert>
        ) : (
          <Alert
            severity="error"
            action={<Button color="inherit" size="small" onClick={() => { void load(); }}>{t('common:buttons.retry')}</Button>}
          >
            {error || t('messages.loadConnectionFailed')}
          </Alert>
        )}
        <MuiLink
          component={RouterLink}
          to={listPath}
          sx={{ display: 'inline-block', mt: 2, fontSize: 13, fontWeight: 400, color: 'kanap.teal' }}
        >
          {t('workspace.connection.backToList')}
        </MuiLink>
      </Box>
    );
  }

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
        {...(isCreate
          ? { ...title.shellProps, canEditTitle: canManage }
          : { title: data?.name || '', canEditTitle: canManage, onTitleSave: handleTitleSave })}
        titleFallback={isCreate ? t('workspace.connection.newTitle') : t('workspace.connection.untitled')}
        titleRequiredMessage={t('messages.nameRequired')}
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
          overview(draft)
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
