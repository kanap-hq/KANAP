import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Popover,
  Select,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router-dom';
import PlayCircleOutlineIcon from '@mui/icons-material/PlayCircleOutline';
import PauseCircleOutlineIcon from '@mui/icons-material/PauseCircleOutline';
import CenterFocusStrongIcon from '@mui/icons-material/CenterFocusStrong';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import GridOnIcon from '@mui/icons-material/GridOn';
import PageHeader from '../../components/PageHeader';
import LightModeIsland from '../../components/LightModeIsland';
import api from '../../api';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';
import ConnectionMapGraph, { ClusterMembership, ConnectionMapLink, ConnectionMapNode, GraphControlsApi } from './components/ConnectionMapGraph';

import { useTranslation } from 'react-i18next';
import { classificationText } from '../../utils/applicationClassification';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { legTypeLabel } from '../../utils/interfaceLegType';
type ApiConnectionMapNode = {
  id: string;
  name: string;
  kind: 'server' | 'cluster' | 'entity';
  is_cluster?: boolean;
  environment: string | null;
  network_segment: string | null;
  hosting_category: 'on_prem' | 'cloud' | null;
  graph_tier?: string | null;
  member_server_ids?: string[];
};

type ApiConnectionMapLeg = {
  id: string;
  order_index: number;
  function_code: string | null;
  equipment_asset_id: string | null;
  equipment_entity_code: string | null;
  protocol_codes: string[];
  protocol_labels?: string[];
  port_override: string | null;
  notes: string | null;
};

type ApiConnectionMapConnection = {
  id: string;
  connection_reference: string;
  name: string;
  purpose: string | null;
  topology: 'server_to_server' | 'multi_server';
  lifecycle: string;
  criticality: string;
  data_class: string;
  contains_pii: boolean;
  protocol_codes: string[];
  protocol_labels: string[];
  // Connection-level per-protocol port overrides (code -> port). Absent codes
  // fall back to the protocol's typical port.
  protocol_port_overrides?: Record<string, string>;
  source_asset_id: string | null;
  source_entity_code: string | null;
  destination_asset_id: string | null;
  destination_entity_code: string | null;
  // Legacy aliases still emitted by some endpoints for backwards compat:
  source_server_id?: string | null;
  destination_server_id?: string | null;
  server_ids: string[];
  legs?: ApiConnectionMapLeg[];
};

type LinkedInterfaceBinding = {
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
  source_application_id?: string | null;
  target_application_id?: string | null;
  interface_lifecycle: string;
  interface_criticality: string;
  interface_data_class: string;
  interface_contains_pii: boolean;
};

type AppWithServerAssignments = {
  id: string;
  name: string;
  lifecycle: string;
  environments: string[];
};

type ServerFromApp = {
  id: string;
  name: string;
  environment: string;
  kind: string;
  provider: string;
  is_cluster: boolean;
};

type ConnectionMapResponse = {
  environment: string;
  lifecycles: string[];
  nodes: ApiConnectionMapNode[];
  connections: ApiConnectionMapConnection[];
  clusterMemberships?: ClusterMembership[];
};

type GraphData = { nodes: ConnectionMapNode[]; links: ConnectionMapLink[] };

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };
type DepthLimit = 'all' | 0 | 1 | 2 | 3 | 4 | 5;
const DEPTH_OPTIONS: DepthLimit[] = ['all', 0, 1, 2, 3, 4, 5];

type ServerMapSummary = {
  id: string;
  name: string;
  kind: string;
  environment: string;
  operating_system: string | null;
  network_segment: string | null;
  ip: string | null;
  location_reference: string | null;
  location_name: string | null;
  assigned_applications: Array<{ id: string; name: string; environment: string }>;
  is_cluster?: boolean;
};

/** `entityName` gives an entity node the entity's name in the reader's language (its id is `entity:<code>`). */
export function toGraphNodes(nodes: ApiConnectionMapNode[], entityName: (code: string) => string | undefined = () => undefined): ConnectionMapNode[] {
  return nodes.map((n) => {
    const isCluster = n.kind === 'cluster' || (n as any).is_cluster;
    return {
      id: n.id,
      name: (n.kind === 'entity' && n.id.startsWith('entity:') ? entityName(n.id.slice('entity:'.length)) : undefined) || n.name,
      kind: isCluster ? 'cluster' : n.kind,
      isCluster,
      environment: n.environment,
      networkSegment: n.network_segment,
      hostingCategory: n.hosting_category,
      graphTier: n.graph_tier || null,
    } as ConnectionMapNode;
  });
}

function buildLinks(
  connections: ApiConnectionMapConnection[],
  showMultiServer: boolean,
  showLayers: boolean,
  typicalPortsByCode: Map<string, string>,
): ConnectionMapLink[] {
  const computeTypicalPorts = (
    codes: string[] | undefined | null,
    override?: string | null,
    overridesByCode?: Record<string, string> | null,
  ): string | undefined => {
    const overrideVal = (override || '').trim();
    if (overrideVal) return overrideVal;
    const ports: string[] = [];
    (codes || []).forEach((code) => {
      const perCode = (overridesByCode?.[code] || '').trim();
      const port = perCode || typicalPortsByCode.get(code);
      if (port) ports.push(port);
    });
    if (ports.length === 0) return undefined;
    // Deduplicate individual port tokens for readability
    const tokens = ports
      .join(',')
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    const uniq = Array.from(new Set(tokens));
    return uniq.join(', ');
  };

  const links: ConnectionMapLink[] = [];
  connections.forEach((conn) => {
    if (conn.topology === 'multi_server' && !showMultiServer) return;

    const base = {
      connectionDbId: conn.id,
      connectionReference: conn.connection_reference,
      name: conn.name,
      purpose: conn.purpose,
      typicalPorts: computeTypicalPorts(conn.protocol_codes, null, conn.protocol_port_overrides),
      lifecycle: conn.lifecycle,
      criticality: conn.criticality,
      dataClass: conn.data_class,
      containsPii: !!conn.contains_pii,
      topology: conn.topology,
      protocolLabels: (conn.protocol_labels && conn.protocol_labels.length > 0
        ? conn.protocol_labels
        : conn.protocol_codes || []),
    } as const;

    const legs = Array.isArray(conn.legs) ? conn.legs : [];
    if (showLayers && legs.length > 0) {
      // New hop-chain model: source → hop[0].equipment → hop[1].equipment → ... → destination.
      // Build the full ordered list of points along the path, then create one link per segment.
      const sortedHops = [...legs].sort((a, b) => (a.order_index || 0) - (b.order_index || 0));
      const pathStart =
        conn.source_asset_id || (conn.source_entity_code ? `entity:${conn.source_entity_code}` : null);
      const pathEnd =
        conn.destination_asset_id || (conn.destination_entity_code ? `entity:${conn.destination_entity_code}` : null);

      // Sequence: [start, hop[0].equipment, hop[1].equipment, ..., end]
      const points: Array<{ id: string | null; hopRef?: ApiConnectionMapLeg }> = [];
      points.push({ id: pathStart });
      for (const hop of sortedHops) {
        const hopPointId =
          hop.equipment_asset_id ||
          (hop.equipment_entity_code ? `entity:${hop.equipment_entity_code}` : null);
        points.push({ id: hopPointId, hopRef: hop });
      }
      points.push({ id: pathEnd });

      for (let i = 0; i < points.length - 1; i += 1) {
        const from = points[i].id;
        const to = points[i + 1].id;
        if (!from || !to) continue;
        // The link's protocol/port label reflects what's flowing into the next point,
        // i.e., the protocol of the upstream hop (or the connection's default for the
        // very first segment).
        const upstream = points[i].hopRef;
        const segmentCodes = upstream?.protocol_codes && upstream.protocol_codes.length > 0
          ? upstream.protocol_codes
          : conn.protocol_codes;
        const segmentLabels = upstream?.protocol_labels && upstream.protocol_labels.length > 0
          ? upstream.protocol_labels
          : segmentCodes;
        const segmentPorts = computeTypicalPorts(
          segmentCodes,
          upstream?.port_override || null,
          conn.protocol_port_overrides,
        );
        const linkSuffix = upstream ? `hop-${upstream.id}` : 'origin';
        links.push({
          ...base,
          id: `${conn.id}-${linkSuffix}-${i}`,
          source: from,
          target: to,
          protocolLabels: segmentLabels && segmentLabels.length > 0 ? segmentLabels : base.protocolLabels,
          typicalPorts: segmentPorts || base.typicalPorts,
        });
      }
      return;
    }

    if (conn.topology === 'server_to_server') {
      const source =
        conn.source_asset_id || conn.source_server_id
        || (conn.source_entity_code ? `entity:${conn.source_entity_code}` : null);
      const target =
        conn.destination_asset_id || conn.destination_server_id
        || (conn.destination_entity_code ? `entity:${conn.destination_entity_code}` : null);
      if (source && target) {
        links.push({
          ...base,
          id: conn.id,
          source,
          target,
          typicalPorts: computeTypicalPorts(conn.protocol_codes, null, conn.protocol_port_overrides),
        });
      }
      return;
    }

    const servers = Array.from(new Set((conn.server_ids || []).filter(Boolean)));
    for (let i = 0; i < servers.length; i += 1) {
      for (let j = i + 1; j < servers.length; j += 1) {
        const source = servers[i];
        const target = servers[j];
        const linkId = `${conn.id}-${source}-${target}`;
        links.push({
          ...base,
          id: linkId,
          source,
          target,
          topology: 'multi_server',
          typicalPorts: computeTypicalPorts(conn.protocol_codes, null, conn.protocol_port_overrides),
        });
      }
    }
  });
  return links;
}

export default function ConnectionMapPage() {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const businessLabel = (code?: string | null) => classificationCatalog?.businessCriticalityLevels.find((item) => item.code === code)?.label || code || classificationText('Not set');
  const { t } = useTranslation(['it', 'common']);
  const navigate = useNavigate();
  const { byField, labelFor, settings, entityName } = useItOpsEnumOptions();
  const [searchParams, setSearchParams] = useSearchParams();
  const [lifecycles, setLifecycles] = React.useState<string[]>(() => {
    const raw = searchParams.get('lifecycles');
    if (!raw) return ['active'];
    const parts = raw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    return parts.length > 0 ? parts : ['active'];
  });
  const [focusConnectionId, setFocusConnectionId] = React.useState<string | null>(() => searchParams.get('focusConnectionId'));
  const [showMultiServer, setShowMultiServer] = React.useState<boolean>(true);
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = React.useState<string | null>(null);
  const [isFrozen, setIsFrozen] = React.useState<boolean>(false);
  const [autoCenterEnabled, setAutoCenterEnabled] = React.useState<boolean>(true);
  const [showLayers, setShowLayers] = React.useState<boolean>(true);
  const [roleTierEnabled, setRoleTierEnabled] = React.useState<boolean>(true);
  const zoomApiRef = React.useRef<{ zoomIn: () => void; zoomOut: () => void } | null>(null);
  const graphControlsRef = React.useRef<GraphControlsApi | null>(null);
  const [linkedInterfaces, setLinkedInterfaces] = React.useState<LinkedInterfaceBinding[]>([]);
  const [linkedInterfacesLoading, setLinkedInterfacesLoading] = React.useState<boolean>(false);
  const [linkedInterfacesError, setLinkedInterfacesError] = React.useState<string | null>(null);
  const [serverSummaries, setServerSummaries] = React.useState<Record<string, { data?: ServerMapSummary; loading: boolean; error?: string | null }>>({});
  const [rootNodeIds, setRootNodeIds] = React.useState<string[]>(() => {
    const raw = searchParams.get('rootIds');
    if (!raw) return [];
    return raw.split(',').map((v) => v.trim()).filter(Boolean);
  });
  const [depthLimit, setDepthLimit] = React.useState<DepthLimit>(() => {
    const raw = searchParams.get('depth');
    if (!raw) return 'all';
    if (raw === 'all') return 'all';
    const num = Number(raw);
    return num === 0 || [1, 2, 3, 4, 5].includes(num) ? (num as DepthLimit) : 'all';
  });

  // App-based server selection state
  const [selectedAppIds, setSelectedAppIds] = React.useState<string[]>([]);
  const [selectedAppEnvs, setSelectedAppEnvs] = React.useState<string[]>([]);
  const [appDerivedServerIds, setAppDerivedServerIds] = React.useState<string[]>([]);
  const [appServersLoading, setAppServersLoading] = React.useState(false);
  const prevAppDerivedServerIdsRef = React.useRef<string[]>([]);

  // Servers popover state (for overflow chips)
  const [serversPopoverAnchor, setServersPopoverAnchor] = React.useState<HTMLElement | null>(null);

  const lifecycleOptions = React.useMemo(() => {
    const list = byField.lifecycleStatus || [];
    if (list.length === 0) return [{ label: t('pages.maps.active'), value: 'active' }];
    return list.map((item) => ({
      value: item.code,
      label: item.deprecated ? `${item.label} (${t('common:enumEditor.retiredSuffix')})` : item.label,
      deprecated: !!item.deprecated,
    }));
  }, [byField.lifecycleStatus, t]);

  // Query applications with server assignments
  const { data: appsWithAssignments, isLoading: appsLoading } = useQuery<AppWithServerAssignments[]>({
    queryKey: ['applications', 'with-server-assignments'],
    queryFn: async () => {
      const res = await api.get<{ items: AppWithServerAssignments[] }>('/applications/with-server-assignments');
      return res.data.items || [];
    },
  });

  // Compute available environments based on selected applications
  const availableAppEnvs = React.useMemo(() => {
    if (selectedAppIds.length === 0 || !appsWithAssignments) return [];
    const envSet = new Set<string>();
    appsWithAssignments
      .filter((app) => selectedAppIds.includes(app.id))
      .forEach((app) => app.environments.forEach((env) => envSet.add(env)));
    const envOrder = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'];
    return Array.from(envSet).sort((a, b) => envOrder.indexOf(a) - envOrder.indexOf(b));
  }, [selectedAppIds, appsWithAssignments]);

  // Clear environment selection when it becomes invalid
  React.useEffect(() => {
    if (selectedAppEnvs.length === 0) return;
    const valid = selectedAppEnvs.filter((env) => availableAppEnvs.includes(env));
    if (valid.length !== selectedAppEnvs.length) {
      setSelectedAppEnvs(valid);
    }
  }, [availableAppEnvs, selectedAppEnvs]);

  // Fetch servers when apps/environments are selected
  React.useEffect(() => {
    if (selectedAppIds.length === 0 || selectedAppEnvs.length === 0) {
      setAppDerivedServerIds([]);
      return;
    }

    let cancelled = false;
    const fetchServers = async () => {
      setAppServersLoading(true);
      try {
        const res = await api.post<{ items: ServerFromApp[] }>(
          '/app-server-assignments/servers-by-apps',
          { applicationIds: selectedAppIds, environments: selectedAppEnvs },
        );
        if (!cancelled) {
          const serverIds = (res.data.items || []).map((s) => s.id);
          setAppDerivedServerIds(serverIds);
        }
      } catch (err) {
        console.error('Failed to fetch servers for apps:', err);
        if (!cancelled) setAppDerivedServerIds([]);
      } finally {
        if (!cancelled) setAppServersLoading(false);
      }
    };

    void fetchServers();
    return () => {
      cancelled = true;
    };
  }, [selectedAppIds, selectedAppEnvs]);

  // Sync app-derived servers with rootNodeIds (add new, remove old)
  React.useEffect(() => {
    const prevDerived = prevAppDerivedServerIdsRef.current;
    const nextDerived = appDerivedServerIds;

    // Find servers to remove (were derived before, but not anymore)
    const toRemove = new Set(prevDerived.filter((id) => !nextDerived.includes(id)));
    // Find servers to add (newly derived)
    const toAdd = nextDerived.filter((id) => !prevDerived.includes(id));

    if (toRemove.size > 0 || toAdd.length > 0) {
      setRootNodeIds((prev) => {
        // Remove servers that are no longer derived
        const filtered = prev.filter((id) => !toRemove.has(id));
        // Add newly derived servers
        const merged = new Set([...filtered, ...toAdd]);
        return Array.from(merged);
      });
    }

    // Update ref for next comparison
    prevAppDerivedServerIdsRef.current = nextDerived;

    // Set depth to 1 when selecting from apps (if currently 'all' and we have derived servers)
    if (nextDerived.length > 0 && depthLimit === 'all') {
      setDepthLimit(0);
    }
  }, [appDerivedServerIds, depthLimit]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ConnectionMapResponse>({
    queryKey: ['connection-map', lifecycles.slice().sort().join(','), showMultiServer],
    queryFn: async () => {
      const response = await api.get<ConnectionMapResponse>('/connections/map', {
        params: {
          lifecycles: lifecycles.join(','),
        },
      });
      return response.data;
    },
    placeholderData: (previousData) => previousData,
  });

  const graphData = React.useMemo<GraphData>(() => {
    if (!data) return EMPTY_GRAPH;
    const allNodes = toGraphNodes(data.nodes || []).map((node) => (
      node.kind === 'entity' ? { ...node, name: entityName(node.id.replace(/^entity:/, ''), node.name) } : node
    ));
    const typicalPortsByCode = new Map<string, string>();
    (settings?.connectionTypes || []).forEach((ct) => {
      if (ct.code) typicalPortsByCode.set(ct.code, (ct as any).typicalPorts || (ct as any).typical_ports || '');
    });
    const links = buildLinks(data.connections || [], showMultiServer, showLayers, typicalPortsByCode);
    if (links.length === 0) return { nodes: [], links };
    const nodeIds = new Set<string>();
    links.forEach((l) => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (sid) nodeIds.add(String(sid));
      if (tid) nodeIds.add(String(tid));
    });
    const nodes = allNodes.filter((n) => nodeIds.has(n.id));
    return { nodes, links };
  }, [data, showMultiServer, showLayers, settings?.connectionTypes, entityName]);

  // Memoize clusterMemberships to avoid triggering graph re-render on every parent render
  const clusterMembershipsRaw = React.useMemo(() => {
    return (data?.clusterMemberships || []).map((m) => ({
      cluster_id: m.cluster_id,
      server_id: m.server_id,
    }));
  }, [data?.clusterMemberships]);

  const nodeOptions = React.useMemo(() => {
    const order: Record<string, number> = { entity: 0, cluster: 1, server: 2 };
    const labelForKind = (k: string) => t(`it:pages.connectionMap.nodeGroups.${k === 'entity' || k === 'cluster' ? k : 'server'}`);
    return graphData.nodes
      .map((n) => ({
        id: n.id,
        name: n.name,
        kind: n.kind,
        label: n.name,
        group: labelForKind(n.kind),
      }))
      .sort((a, b) => {
        const oa = order[a.kind] ?? 99;
        const ob = order[b.kind] ?? 99;
        if (oa !== ob) return oa - ob;
        return a.name.localeCompare(b.name);
      });
  }, [graphData.nodes, t]);

  React.useEffect(() => {
    if (rootNodeIds.length === 0) return;
    const valid = rootNodeIds.filter((id) => graphData.nodes.some((n) => n.id === id));
    if (valid.length !== rootNodeIds.length) {
      setRootNodeIds(valid);
      if (valid.length === 0) setDepthLimit('all');
    }
  }, [graphData.nodes, rootNodeIds]);

  React.useEffect(() => {
    if (rootNodeIds.length === 0 && depthLimit !== 'all') {
      setDepthLimit('all');
    }
  }, [rootNodeIds, depthLimit]);

  const isPrimaryNode = React.useCallback((node: ConnectionMapNode) => {
    return node.kind === 'server' || node.kind === 'cluster' || node.kind === 'entity';
  }, []);

  const filteredGraph = React.useMemo<GraphData>(() => {
    if (rootNodeIds.length === 0 || depthLimit === 'all') {
      return graphData;
    }

    const nodeMap = new Map<string, ConnectionMapNode>();
    graphData.nodes.forEach((n) => nodeMap.set(n.id, n));

    // When depth=0, also show parent clusters of the selected member servers so the cluster
    // node and its implicit link render (even though clusters can't be directly selected via apps).
    const rootSet = new Set(rootNodeIds);
    if (depthLimit === 0 && clusterMembershipsRaw.length > 0) {
      clusterMembershipsRaw.forEach((m) => {
        if (rootSet.has(m.server_id)) {
          rootSet.add(m.cluster_id);
        }
      });
    }

    // Also for depth=0, include adjacent entity nodes (they can't be selected via apps but are key endpoints).
    if (depthLimit === 0) {
      graphData.links.forEach((l) => {
        const sid = typeof l.source === 'object' ? l.source.id : l.source;
        const tid = typeof l.target === 'object' ? l.target.id : l.target;
        const sourceNode = nodeMap.get(sid);
        const targetNode = nodeMap.get(tid);
        if (sourceNode && targetNode) {
          if (rootSet.has(sid) && targetNode.kind === 'entity') rootSet.add(tid);
          if (rootSet.has(tid) && sourceNode.kind === 'entity') rootSet.add(sid);
        }
      });
    }

    const adjacency = new Map<string, Set<string>>();
    graphData.links.forEach((l) => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      if (!nodeMap.has(sid) || !nodeMap.has(tid)) return;
      if (!adjacency.has(sid)) adjacency.set(sid, new Set());
      if (!adjacency.has(tid)) adjacency.set(tid, new Set());
      adjacency.get(sid)!.add(tid);
      adjacency.get(tid)!.add(sid);
    });

    const queue: Array<{ id: string; depth: number }> = [];
    const visited = new Map<string, number>();
    rootSet.forEach((id) => {
      if (!nodeMap.has(id)) return;
      visited.set(id, 0);
      queue.push({ id, depth: 0 });
    });

    while (queue.length > 0) {
      const { id, depth } = queue.shift()!;
      const neighbors = adjacency.get(id);
      if (!neighbors) continue;
      neighbors.forEach((nbrId) => {
        const nbrNode = nodeMap.get(nbrId);
        if (!nbrNode) return;
        const nextDepth = depth + (isPrimaryNode(nbrNode) ? 1 : 0);
        if (nextDepth > depthLimit) return;
        const prevDepth = visited.get(nbrId);
        if (prevDepth === undefined || nextDepth < prevDepth) {
          visited.set(nbrId, nextDepth);
          queue.push({ id: nbrId, depth: nextDepth });
        }
      });
    }

    const includedIds = new Set<string>(visited.keys());
    const nodes = graphData.nodes.filter((n) => includedIds.has(n.id));
    const links = graphData.links.filter((l) => {
      const sid = typeof l.source === 'object' ? l.source.id : l.source;
      const tid = typeof l.target === 'object' ? l.target.id : l.target;
      return includedIds.has(sid) && includedIds.has(tid);
    });
    return { nodes, links };
  }, [graphData, rootNodeIds, depthLimit, isPrimaryNode]);

  // Filter cluster memberships to only include those where both cluster and member are in the filtered graph
  const clusterMemberships = React.useMemo(() => {
    const nodeIds = new Set(filteredGraph.nodes.map((n) => n.id));
    return clusterMembershipsRaw.filter(
      (m) => nodeIds.has(m.cluster_id) && nodeIds.has(m.server_id),
    );
  }, [filteredGraph.nodes, clusterMembershipsRaw]);

  React.useEffect(() => {
    if (selectedNodeId && !filteredGraph.nodes.some((n) => n.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filteredGraph.nodes, selectedNodeId]);

  React.useEffect(() => {
    if (selectedLinkId && !filteredGraph.links.some((l) => l.id === selectedLinkId)) {
      setSelectedLinkId(null);
    }
  }, [filteredGraph.links, selectedLinkId]);

  const selectedNode = React.useMemo(
    () => (selectedNodeId ? filteredGraph.nodes.find((n) => n.id === selectedNodeId) || null : null),
    [filteredGraph.nodes, selectedNodeId],
  );

  const selectedLink = React.useMemo(
    () => (selectedLinkId ? filteredGraph.links.find((l) => l.id === selectedLinkId) || null : null),
    [filteredGraph.links, selectedLinkId],
  );

  // Fetch server/cluster summary on selection
  React.useEffect(() => {
    if (!selectedNode || (selectedNode.kind !== 'server' && selectedNode.kind !== 'cluster')) return;
    const nodeId = selectedNode.id;
    setServerSummaries((prev) => {
      const existing = prev[nodeId];
      if (existing && existing.data && !existing.error) return prev;
      return { ...prev, [nodeId]: { ...existing, loading: true, error: null } };
    });
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<ServerMapSummary>(`/assets/${nodeId}/map-summary`);
        if (!cancelled) {
          setServerSummaries((prev) => ({ ...prev, [nodeId]: { data: res.data, loading: false, error: null } }));
        }
      } catch (e: any) {
        if (!cancelled) {
          setServerSummaries((prev) => ({
            ...prev,
            [nodeId]: { data: prev[nodeId]?.data, loading: false, error: getApiErrorMessage(e, t, t('messages.loadAssetFailed')) },
          }));
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedNode]);

  React.useEffect(() => {
    if (!focusConnectionId) return;
    if (!graphData.links || graphData.links.length === 0) return;
    const match = graphData.links.find((l) => l.connectionDbId === focusConnectionId);
    if (match) {
      setSelectedLinkId(match.id);
      setSelectedNodeId(null);
      setFocusConnectionId(null);
    }
  }, [graphData.links, focusConnectionId]);

  React.useEffect(() => {
    let cancelled = false;
    if (!selectedLink || !selectedLink.connectionDbId) {
      setLinkedInterfaces([]);
      setLinkedInterfacesError(null);
      setLinkedInterfacesLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLinkedInterfacesLoading(true);
    setLinkedInterfacesError(null);
    const load = async () => {
      try {
        const res = await api.get<{ items: LinkedInterfaceBinding[] }>(
          `/connections/${selectedLink.connectionDbId}/interface-links`,
        );
        if (!cancelled) {
          setLinkedInterfaces(res.data.items || []);
        }
      } catch (e: any) {
        if (!cancelled) {
          setLinkedInterfaces([]);
          setLinkedInterfacesError(
            getApiErrorMessage(e, t, t('messages.loadLinkedInterfacesFailed')),
          );
        }
      } finally {
        if (!cancelled) {
          setLinkedInterfacesLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedLink]);

  const lifecycleSelectValue = lifecycles.length > 0 ? lifecycles : ['active'];

  const headerActions = (
    <Stack spacing={1} direction="column" sx={{ width: '100%' }}>
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }} flexWrap="wrap">
        <FormControl size="small" sx={{ minWidth: 220 }}>
          <InputLabel id="connection-map-lifecycle-label">{t('common.lifecycle')}</InputLabel>
          <Select
            labelId="connection-map-lifecycle-label"
            multiple
            label={t('common.lifecycle')}
            value={lifecycleSelectValue}
            renderValue={(selected) => (selected as string[])
              .map((value) => lifecycleOptions.find((opt) => opt.value === value)?.label || labelFor('lifecycleStatus', value) || value)
              .join(', ')}
            onChange={(e) => {
              const value = typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]);
              const normalized = value.length > 0 ? value : ['active'];
              setLifecycles(normalized);
              const next = new URLSearchParams(searchParams);
              next.set('lifecycles', normalized.join(','));
              setSearchParams(next, { replace: true });
            }}
          >
            {lifecycleOptions.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                <Checkbox size="small" checked={lifecycleSelectValue.includes(option.value)} />
                <ListItemText primary={option.label} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Autocomplete
          multiple
          size="small"
          sx={{ minWidth: 260 }}
          options={appsWithAssignments || []}
          loading={appsLoading}
          getOptionLabel={(opt) => opt.name}
          value={(appsWithAssignments || []).filter((a) => selectedAppIds.includes(a.id))}
          onChange={(_, val) => {
            const nextIds = val.map((v) => v.id);
            setSelectedAppIds(nextIds);
            if (nextIds.length === 0) {
              setSelectedAppEnvs([]);
            }
          }}
          renderOption={(props, option) => (
            <li {...props} key={option.id}>
              <div>
                <div style={{ fontWeight: 500 }}>{option.name}</div>
                <div style={{ fontSize: '0.75rem', opacity: 0.7 }}>
                  {option.lifecycle} · {option.environments.map((e) => e.toUpperCase()).join(', ')}
                </div>
              </div>
            </li>
          )}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('pages.maps.applications')}
              placeholder={t('pages.maps.selectApplications')}
              InputLabelProps={{ shrink: true }}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {appsLoading && <CircularProgress size={16} />}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
        <FormControl size="small" sx={{ minWidth: 140 }} disabled={selectedAppIds.length === 0}>
          <InputLabel id="app-env-label" shrink>{t('pages.connectionMap.appEnv')}</InputLabel>
          <Select
            notched
            displayEmpty
            labelId="app-env-label"
            multiple
            label={t('pages.connectionMap.appEnv')}
            value={selectedAppEnvs}
            onChange={(e) => {
              const val = typeof e.target.value === 'string'
                ? e.target.value.split(',')
                : (e.target.value as string[]);
              setSelectedAppEnvs(val);
            }}
            renderValue={(selected) => {
              const arr = selected as string[];
              if (arr.length === 0) {
                return <span style={{ opacity: 0.5 }}>{t('pages.connectionMap.selectEnv')}</span>;
              }
              return arr.map((s) => s.toUpperCase()).join(', ');
            }}
          >
            {availableAppEnvs.map((env) => (
              <MenuItem key={env} value={env}>
                <Checkbox size="small" checked={selectedAppEnvs.includes(env)} />
                <ListItemText primary={env.toUpperCase()} />
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {appServersLoading && (
          <Stack direction="row" spacing={0.5} alignItems="center">
            <CircularProgress size={14} />
            <Typography variant="caption" color="text.disabled">{t('pages.connectionMap.loadingServers')}</Typography>
          </Stack>
        )}
        <Autocomplete
          multiple
          size="small"
          sx={{ minWidth: 260 }}
          options={nodeOptions}
          groupBy={(opt) => opt.group}
          getOptionLabel={(opt) => opt.label}
          renderGroup={(params) => (
            <li key={params.key}>
              <ListItemText
                primaryTypographyProps={{ variant: 'caption', color: 'text.secondary' }}
                sx={{ px: 2, pt: 1 }}
                primary={params.group}
              />
              {params.children}
            </li>
          )}
          value={nodeOptions.filter((opt) => rootNodeIds.includes(opt.id))}
          onChange={(_, val) => {
            const nextIds = val.map((v) => v.id);
            setRootNodeIds(nextIds);
            if (nextIds.length > 0 && depthLimit === 'all') setDepthLimit(0);
          }}
        renderTags={(value, getTagProps) => {
          const maxVisible = 1;
          const overflow = value.length - maxVisible;
          return (
            <>
                {value.slice(0, maxVisible).map((opt, index) => (
                  <Chip
                    {...getTagProps({ index })}
                    key={opt.id}
                    label={opt.label}
                    size="small"
                  />
                ))}
                {overflow > 0 && (
                  <Chip
                    label={`+${overflow} more`}
                    size="small"
                    onClick={(e) => setServersPopoverAnchor(e.currentTarget)}
                    sx={{ cursor: 'pointer' }}
                  />
                )}
              </>
            );
          }}
          renderInput={(params) => (
            <TextField
              {...params}
              label={t('pages.connectionMap.servers')}
              placeholder={t('pages.connectionMap.selectServers')}
              InputLabelProps={{ shrink: true }}
            />
          )}
        />
        <Popover
          open={Boolean(serversPopoverAnchor)}
          anchorEl={serversPopoverAnchor}
          onClose={() => setServersPopoverAnchor(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
          transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        >
          <Box sx={{ p: 1, maxHeight: 300, overflow: 'auto', minWidth: 200 }}>
            <Typography variant="caption" color="text.secondary" sx={{ px: 1 }}>
              {t('pages.connectionMap.selectedServers', { count: rootNodeIds.length })}
            </Typography>
            <List dense>
              {nodeOptions
                .filter((opt) => rootNodeIds.includes(opt.id))
                .map((opt) => (
                  <ListItem
                    key={opt.id}
                    secondaryAction={
                      <IconButton
                        edge="end"
                        size="small"
                        onClick={() => {
                          setRootNodeIds((prev) => prev.filter((id) => id !== opt.id));
                        }}
                      >
                        <Typography variant="caption" color="text.secondary">✕</Typography>
                      </IconButton>
                    }
                    sx={{ py: 0.5 }}
                  >
                    <ListItemText
                      primary={opt.label}
                      primaryTypographyProps={{ variant: 'body2' }}
                    />
                  </ListItem>
                ))}
            </List>
          </Box>
        </Popover>
        <TextField
          select
          size="small"
          label={t('pages.maps.depth')}
          sx={{ minWidth: 120 }}
          value={depthLimit}
          onChange={(e) => {
            const v = e.target.value === 'all' ? 'all' : (Number(e.target.value) as DepthLimit);
            setDepthLimit(v);
          }}
        >
          {DEPTH_OPTIONS.map((depth) => (
            <MenuItem key={depth} value={depth}>
              {depth === 'all' ? t('pages.maps.all') : depth}
            </MenuItem>
          ))}
        </TextField>
      </Stack>

      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'flex-start', md: 'center' }} flexWrap="wrap">
        <FormControlLabel
          control={(
            <Switch
              color="primary"
              checked={showMultiServer}
              onChange={(e) => {
                setShowMultiServer(e.target.checked);
                setSelectedLinkId(null);
              }}
            />
          )}
          label={t('pages.connectionMap.showMultiServer')}
        />
        <FormControlLabel
          control={(
            <Switch
              color="primary"
              checked={showLayers}
              onChange={(e) => {
                setShowLayers(e.target.checked);
                setSelectedLinkId(null);
              }}
            />
          )}
          label={t('pages.connectionMap.showLayers')}
        />
        <FormControlLabel
          control={(
            <Switch
              color="primary"
              checked={roleTierEnabled}
              onChange={(e) => setRoleTierEnabled(e.target.checked)}
            />
          )}
          label={t('pages.connectionMap.roleBased')}
        />
        {isFetching && <Typography variant="caption" color="text.disabled">{t('pages.maps.updating')}</Typography>}
      </Stack>
    </Stack>
  );

  const renderLifecycleChip = (value?: string) => labelFor('lifecycleStatus', value) || (value || '-');
  const renderCriticality = businessLabel;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <PageHeader title={t('pages.connectionMap.title')} actions={headerActions} />
      {isLoading && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack spacing={2} alignItems="center">
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary">
              {t('pages.connectionMap.building')}
            </Typography>
          </Stack>
        </Box>
      )}
      {!isLoading && isError && (
        <Alert
          severity="error"
          action={<Button color="inherit" size="small" onClick={() => refetch()}>{t('common:buttons.retry')}</Button>}
          sx={{ mb: 2 }}
        >
          {error instanceof Error ? error.message : t('pages.connectionMap.loadFailed')}
        </Alert>
      )}
      {!isLoading && !isError && filteredGraph.nodes.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('pages.connectionMap.empty')}
        </Alert>
      )}
      {!isLoading && !isError && filteredGraph.nodes.length > 0 && (
        <LightModeIsland
          sx={{
            height: 'calc(100vh - 220px)',
            minHeight: 400,
            borderRadius: 2,
            border: (theme) => `1px solid ${theme.palette.divider}`,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              left: 12,
              top: 12,
              zIndex: 2,
              bgcolor: 'rgba(248,250,252,0.9)',
              borderRadius: 2,
              boxShadow: 1,
              p: 0.5,
            }}
          >
            <Stack spacing={0.5}>
              <Tooltip title={isFrozen ? t('pages.maps.unfreeze') : t('pages.maps.freeze')}>
                <IconButton
                  size="small"
                  onClick={() => setIsFrozen((prev) => !prev)}
                  color={isFrozen ? 'primary' : 'default'}
                >
                  {isFrozen ? <PlayCircleOutlineIcon fontSize="small" /> : <PauseCircleOutlineIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
              <Tooltip title={autoCenterEnabled ? t('pages.maps.autoCenterOff') : t('pages.maps.autoCenterOn')}>
                <IconButton
                  size="small"
                  onClick={() => setAutoCenterEnabled((prev) => !prev)}
                  color={autoCenterEnabled ? 'primary' : 'default'}
                >
                  <CenterFocusStrongIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('pages.maps.zoomIn')}>
                <IconButton size="small" onClick={() => zoomApiRef.current?.zoomIn()}>
                  <ZoomInIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('pages.maps.zoomOut')}>
                <IconButton size="small" onClick={() => zoomApiRef.current?.zoomOut()}>
                  <ZoomOutIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Box sx={{ borderTop: '1px solid', borderColor: 'divider', my: 0.5 }} />
              <Tooltip title={t('pages.maps.snapToGrid')}>
                <IconButton size="small" onClick={() => graphControlsRef.current?.snapToGrid()}>
                  <GridOnIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('pages.maps.exportSvg')}>
                <IconButton size="small" onClick={() => graphControlsRef.current?.exportSvg()}>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, fontSize: '0.65rem', height: 20, display: 'flex', alignItems: 'center' }}
                  >
                    SVG
                  </Typography>
                </IconButton>
              </Tooltip>
              <Tooltip title={t('pages.maps.exportPng')}>
                <IconButton size="small" onClick={() => graphControlsRef.current?.exportPng()}>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 600, fontSize: '0.65rem', height: 20, display: 'flex', alignItems: 'center' }}
                  >
                    PNG
                  </Typography>
                </IconButton>
              </Tooltip>
            </Stack>
          </Box>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <ConnectionMapGraph
              nodes={filteredGraph.nodes}
              links={filteredGraph.links}
              clusterMemberships={clusterMemberships}
              selectedNodeId={selectedNodeId}
              selectedLinkId={selectedLinkId}
              frozen={isFrozen}
              autoCenter={autoCenterEnabled}
              roleTierEnabled={roleTierEnabled}
              onSelectNode={(id) => {
                setSelectedNodeId(id);
                setSelectedLinkId(null);
              }}
              onSelectLink={(id) => {
                setSelectedLinkId(id);
                setSelectedNodeId(null);
              }}
              onClearSelection={() => {
                setSelectedNodeId(null);
                setSelectedLinkId(null);
              }}
              onRegisterZoomControls={(api) => {
                zoomApiRef.current = api;
              }}
              onRegisterGraphControls={(api) => {
                graphControlsRef.current = api;
              }}
            />
          </Box>

          {(selectedNode || selectedLink) && (
            <Box
              sx={{
                width: 360,
                borderLeft: (theme) => `1px solid ${theme.palette.divider}`,
                bgcolor: 'background.paper',
                p: 2,
                display: 'flex',
                flexDirection: 'column',
                gap: 1.25,
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle1">
                  {selectedNode ? t('pages.connectionMap.nodeDetails') : t('pages.connectionMap.connectionDetails')}
                </Typography>
                <Button
                  size="small"
                  onClick={() => {
                    setSelectedNodeId(null);
                    setSelectedLinkId(null);
                  }}
                >
                  {t('common:buttons.close')}
                </Button>
              </Stack>

              {selectedNode && (
                <Stack spacing={1.25}>
                  <Typography variant="h6">{selectedNode.name}</Typography>
                  {(() => {
                    const summary = serverSummaries[selectedNode.id];
                    const kindLabel =
                      labelFor('serverKind', summary?.data?.kind) ||
                      (selectedNode.kind === 'cluster' ? t('pages.connectionMap.cluster') : selectedNode.kind === 'server' ? t('workspace.connection.server') : selectedNode.kind);
                    if (selectedNode.kind !== 'server' && selectedNode.kind !== 'cluster') {
                      return (
                        <Stack spacing={0.5}>
                          <Typography variant="body2">{t('pages.connectionMap.typeValue', { value: selectedNode.kind })}</Typography>
                          {selectedNode.environment && (
                            <Typography variant="body2">{t('pages.connectionMap.environmentValue', { value: selectedNode.environment.toUpperCase() })}</Typography>
                          )}
                        </Stack>
                      );
                    }
                    return (
                      <Stack spacing={0.75}>
                        {summary?.loading && (
                          <Typography variant="body2" color="text.secondary">{t('pages.maps.loadingDetails')}</Typography>
                        )}
                        {summary?.error && (
                          <Typography variant="body2" color="error">{summary.error}</Typography>
                        )}
                        <Typography variant="body2"><strong>{t('pages.connectionMap.serverType')}</strong> {kindLabel || '—'}</Typography>
                        <Typography variant="body2">
                          <strong>{t('pages.connectionMap.serverLocation')}</strong>{' '}
                          {summary?.data?.location_reference && summary?.data?.location_name
                            ? `${summary.data.location_reference} · ${summary.data.location_name}`
                            : summary?.data?.location_reference || summary?.data?.location_name || '—'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>{t('pages.connectionMap.operatingSystem')}</strong>{' '}
                          {summary?.data?.operating_system || '—'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>{t('pages.connectionMap.networkSegment')}</strong>{' '}
                          {summary?.data?.network_segment
                            ? labelFor('networkSegment', summary.data.network_segment) || summary.data.network_segment
                            : '—'}
                        </Typography>
                        <Typography variant="body2">
                          <strong>{t('pages.connectionMap.ipAddress')}</strong> {summary?.data?.ip || '—'}
                        </Typography>
                        <Box sx={{ mt: 0.75 }}>
                          <Typography variant="body2"><strong>{t('pages.connectionMap.assignedApplications')}</strong></Typography>
                          {summary?.data?.assigned_applications?.length ? (
                            <Stack spacing={0.6} sx={{ mt: 0.5 }}>
                              {(() => {
                                const envOrder = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'];
                                const grouped = summary.data.assigned_applications.reduce<Record<string, typeof summary.data.assigned_applications>>(
                                  (acc, app) => {
                                    const list = acc[app.environment] || [];
                                    list.push(app);
                                    acc[app.environment] = list;
                                    return acc;
                                  },
                                  {},
                                );
                                return Object.keys(grouped)
                                  .sort((a, b) => envOrder.indexOf(a) - envOrder.indexOf(b))
                                  .map((env) => (
                                    <Box key={env}>
                                      <Typography variant="caption" color="text.secondary">
                                        {env.toUpperCase()}
                                      </Typography>
                                      <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                                        {grouped[env]
                                          .slice()
                                          .sort((a, b) => a.name.localeCompare(b.name))
                                          .map((app) => (
                                            <Button
                                              key={`${app.id}-${app.environment}`}
                                              variant="text"
                                              size="small"
                                              onClick={() => navigate(`/it/applications/${app.id}/overview`)}
                                              sx={{ justifyContent: 'flex-start', textAlign: 'left', px: 0 }}
                                            >
                                              {app.name}
                                            </Button>
                                          ))}
                                      </Stack>
                                    </Box>
                                  ));
                              })()}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {t('pages.connectionMap.noApplications')}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ mt: 1 }}>
                          <Button
                            variant="contained"
                            size="small"
                            onClick={() => {
                              // The members of a cluster are managed on the Dependencies tab.
                              navigate(`/it/assets/${selectedNode.id}/${selectedNode.kind === 'cluster' ? 'dependencies' : 'overview'}`);
                            }}
                          >
                            {selectedNode.kind === 'cluster' ? t('pages.connectionMap.viewCluster') : t('pages.connectionMap.editServer')}
                          </Button>
                        </Box>
                      </Stack>
                    );
                  })()}
                </Stack>
              )}

              {selectedLink && (
                <Stack spacing={1.25}>
                  <Stack spacing={0.25}>
                    <Typography variant="h6">{selectedLink.name || selectedLink.connectionReference}</Typography>
                    {selectedLink.connectionReference && selectedLink.name && (
                      <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "'JetBrains Mono Variable', monospace" }}>
                        {selectedLink.connectionReference}
                      </Typography>
                    )}
                  </Stack>

                  <Stack spacing={0.5}>
                    <Typography variant="body2"><strong>{t('pages.connectionMap.purpose')}</strong> {selectedLink.purpose || '—'}</Typography>
                    <Typography variant="body2"><strong>{t('pages.maps.protocolsLabel')}</strong> {selectedLink.protocolLabels.join(', ') || '—'}</Typography>
                    <Typography variant="body2"><strong>{t('pages.connectionMap.typicalPorts')}</strong> {selectedLink.typicalPorts || '—'}</Typography>
                    <Typography variant="body2"><strong>{t('pages.maps.criticalityLabel')}</strong> {renderCriticality(selectedLink.criticality)}</Typography>
                  </Stack>

                  <Typography variant="body2"><strong>{t('pages.connectionMap.topology')}</strong> {selectedLink.topology === 'multi_server' ? t('enums.topology.multiServer') : t('enums.topology.serverToServer')}</Typography>

                  <Box sx={{ mt: 0.5 }}>
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => {
                        const connectionId = selectedLink.connectionDbId || data?.connections.find((c) => c.connection_reference === selectedLink.connectionReference)?.id;
                        const routeId = selectedLink.connectionReference || connectionId;
                        if (routeId) navigate(`/it/connections/${routeId}/overview`);
                      }}
                    >
                      {t('pages.connectionMap.editConnection')}
                    </Button>
                  </Box>

                  <Box sx={{ mt: 0.5 }}>
                    <Typography variant="subtitle2">{t('pages.connections.columns.linkedInterfaces')}</Typography>
                    {linkedInterfacesLoading && (
                      <Typography variant="body2" color="text.secondary">
                        {t('workspace.connection.interfaces.loadingLinked')}
                      </Typography>
                    )}
                    {linkedInterfacesError && (
                      <Typography variant="body2" color="error">
                        {linkedInterfacesError}
                      </Typography>
                    )}
                    {!linkedInterfacesLoading && !linkedInterfacesError && linkedInterfaces.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {t('pages.connectionMap.noLinked')}
                      </Typography>
                    )}
                    {!linkedInterfacesLoading && linkedInterfaces.length > 0 && (
                      <Stack spacing={0.75} sx={{ mt: 0.5 }}>
                        {linkedInterfaces.map((link) => (
                          <Box
                            key={link.id}
                            sx={{
                              borderRadius: 1,
                              border: (theme) => `1px solid ${theme.palette.divider}`,
                              p: 0.75,
                            }}
                          >
                            <Stack spacing={0.35}>
                              <Typography variant="body2" fontWeight={600}>
                                {link.interface_name} ({link.interface_reference || link.interface_code})
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {t('pages.connectionMap.interfaceLeg', { leg: legTypeLabel(t, link.leg_type), env: link.environment.toUpperCase() })}
                              </Typography>
                              <Typography variant="body2">{t('pages.connectionMap.patternValue', { value: link.pattern || '—' })}</Typography>
                              <Typography variant="body2">{t('pages.maps.sourceEndpoint', { value: link.source_endpoint || '—' })}</Typography>
                              <Typography variant="body2">{t('pages.maps.targetEndpoint', { value: link.target_endpoint || '—' })}</Typography>
                            </Stack>
                            <Stack spacing={0.25} sx={{ mt: 0.5 }}>
                            </Stack>
                            <Stack direction="row" spacing={0.5} sx={{ mt: 0.75 }}>
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => {
                                  navigate(`/it/interfaces/${link.interface_reference || link.interface_id}/overview`);
                                }}
                              >
                                {t('pages.connectionMap.openInterface')}
                              </Button>
                              <Button
                                size="small"
                                variant="outlined"
                                onClick={() => {
                                  const roots = [link.source_application_id, link.target_application_id]
                                    .filter(Boolean) as string[];
                                  const params = new URLSearchParams({
                                    environment: link.environment,
                                    lifecycles: link.interface_lifecycle || 'active',
                                    focusInterfaceId: link.interface_id,
                                    depth: '1',
                                  });
                                  if (roots.length > 0) params.set('rootIds', roots.join(','));
                                  navigate(`/it/interface-map?${params.toString()}`);
                                }}
                              >
                                {t('pages.connectionMap.viewInInterfaceMap')}
                              </Button>
                            </Stack>
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Box>
                </Stack>
              )}
            </Box>
          )}
        </LightModeIsland>
      )}
    </Box>
  );
}
