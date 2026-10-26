import useApplicationClassificationCatalog from '../../hooks/useApplicationClassificationCatalog';
import React from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  ListItemText,
  MenuItem,
  Select,
  Autocomplete,
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
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import PageHeader from '../../components/PageHeader';
import ClusterMark from '../../components/workspace/ClusterMark';
import LightModeIsland from '../../components/LightModeIsland';
import api from '../../api';
import InterfaceMapGraph, { GraphControlsApi, MapGraphLink, MapGraphNode } from './components/InterfaceMapGraph';
import useItOpsEnumOptions from '../../hooks/useItOpsEnumOptions';

import { useTranslation } from 'react-i18next';
import { classificationText } from '../../utils/applicationClassification';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';
import { APPLICATION_ENVIRONMENTS, environmentLabel } from '../../utils/applicationEnvironments';
import { legTypeLabel, routeTypeLabel } from '../../utils/interfaceLegType';

type ApiMapNode = {
  id: string;
  name: string;
  lifecycle: string;
  criticality: string;
  external_facing: boolean;
  is_middleware: boolean;
  in_degree: number;
  out_degree: number;
  total_interfaces: number;
};

type ApiMapInterface = {
  id: string;
  interface_reference?: string | null;
  interface_id?: string | null;
  name: string;
  source_application_id: string;
  target_application_id: string;
  lifecycle: string;
  criticality: string;
  data_category: string;
  contains_pii: boolean;
  integration_route_type: string;
  bindings_count: number;
  has_middleware: boolean;
  middleware_application_ids: string[];
};

type ApiMapBinding = {
  id: string;
  interface_id: string;
  leg_id: string;
  leg_type: string;
  from_role: string;
  to_role: string;
  environment: string;
  source_application_id: string;
  target_application_id: string;
  integration_tool_application_id: string | null;
  status: string;
  source_endpoint: string | null;
  target_endpoint: string | null;
  trigger_details: string | null;
  env_job_name: string | null;
  authentication_mode: string | null;
  monitoring_url: string | null;
  env_notes: string | null;
};

type InterfaceConnectionLinkSummary = {
  id: string;
  binding_id: string;
  environment: string;
  leg_type: string;
  binding_status: string;
  connection: {
    id: string;
    connection_reference: string;
    name: string;
    topology: 'server_to_server' | 'multi_server';
    lifecycle: string;
    criticality: string;
    data_class: string;
    contains_pii: boolean;
    risk_mode: 'manual' | 'derived';
    protocol_codes?: string[];
    source_server_id?: string | null;
    destination_server_id?: string | null;
    source_entity_code?: string | null;
    destination_entity_code?: string | null;
    source_server_name?: string | null;
    destination_server_name?: string | null;
    source_is_cluster?: boolean;
    destination_is_cluster?: boolean;
    source_entity_label?: string | null;
    destination_entity_label?: string | null;
    server_ids?: string[];
  };
};

type InterfaceMapResponse = {
  environment: string;
  lifecycles: string[];
  nodes: ApiMapNode[];
  interfaces: ApiMapInterface[];
  bindings?: ApiMapBinding[];
};

type GraphData = {
  nodes: MapGraphNode[];
  links: MapGraphLink[];
};

type ApplicationMapSummary = {
  id: string;
  name: string;
  description: string | null;
  editor: string | null;
  criticality: string;
  /** A cluster comes with its members: they carry `inherited` and the clusters in `via_clusters`. */
  assigned_servers: Array<{ id: string; name: string; environment: string; is_cluster?: boolean; inherited?: boolean; via_clusters?: Array<{ id: string; name: string }> }>;
  business_owners: Array<{ user_id: string; name: string; email?: string | null }>;
  it_owners: Array<{ user_id: string; name: string; email?: string | null }>;
  support_contacts: Array<{ id?: string; contact_id: string; role?: string | null; contact?: { first_name?: string | null; last_name?: string | null; email?: string | null } }>;
};

const EMPTY_GRAPH: GraphData = { nodes: [], links: [] };
type DepthLimit = 'all' | 1 | 2 | 3 | 4 | 5;
const DEPTH_OPTIONS: DepthLimit[] = ['all', 1, 2, 3, 4, 5];

function toGraphNodes(nodes: ApiMapNode[]): MapGraphNode[] {
  return nodes.map((node) => ({
    id: node.id,
    name: node.name,
    lifecycle: node.lifecycle,
    criticality: node.criticality,
    externalFacing: node.external_facing,
    isMiddleware: node.is_middleware,
    totalInterfaces: node.total_interfaces,
    inDegree: node.in_degree,
    outDegree: node.out_degree,
  }));
}

function buildBusinessGraph(data: InterfaceMapResponse): GraphData {
  // Filter out middleware nodes for business view
  const nodes = toGraphNodes(data.nodes).filter(n => !n.isMiddleware);
  const validNodeIds = new Set(nodes.map(n => n.id));

  // Filter links to ensure both source and target exist in the filtered node set
  const links = data.interfaces
    .map((intf) => ({
      id: intf.id,
      interfaceDbId: intf.id,
      interfaceReference: intf.interface_reference || null,
      interfaceId: intf.interface_reference || intf.interface_id || intf.id,
      source: intf.source_application_id,
      target: intf.target_application_id,
      lifecycle: intf.lifecycle,
      criticality: intf.criticality,
      containsPii: !!intf.contains_pii,
      hasMiddleware: !!intf.has_middleware,
      integrationRouteType: intf.integration_route_type,
      bindingsCount: intf.bindings_count,
    }))
    .filter(l => validNodeIds.has(l.source) && validNodeIds.has(l.target));

  return { nodes, links };
}

function buildTechnicalGraph(data: InterfaceMapResponse): GraphData {
  const nodes = toGraphNodes(data.nodes);
  const links: MapGraphLink[] = [];
  for (const intf of data.interfaces) {
    const base: Omit<MapGraphLink, 'id' | 'source' | 'target' | 'parallelIndex' | 'parallelTotal'> = {
      interfaceDbId: intf.id,
      interfaceReference: intf.interface_reference || null,
      interfaceId: intf.interface_reference || intf.interface_id || intf.id,
      lifecycle: intf.lifecycle,
      criticality: intf.criticality,
      containsPii: !!intf.contains_pii,
      hasMiddleware: !!intf.has_middleware,
      integrationRouteType: intf.integration_route_type,
      bindingsCount: intf.bindings_count,
    };
    const middlewareChain = Array.from(new Set(intf.middleware_application_ids || []));
    if (middlewareChain.length === 0) {
      links.push({ ...base, id: `${intf.id}-direct`, source: intf.source_application_id, target: intf.target_application_id });
      continue;
    }
    let currentSource = intf.source_application_id;
    middlewareChain.forEach((mid, idx) => {
      links.push({ ...base, id: `${intf.id}-mid-${idx}`, source: currentSource, target: mid });
      currentSource = mid;
    });
    links.push({ ...base, id: `${intf.id}-sink`, source: currentSource, target: intf.target_application_id });
  }
  return { nodes, links };
}

export default function InterfaceMapPage() {
  const { data: classificationCatalog } = useApplicationClassificationCatalog();
  const businessLabel = (code?: string | null) => classificationCatalog?.businessCriticalityLevels.find((item) => item.code === code)?.label || code || classificationText('Not set');
  const { t } = useTranslation(['it', 'common']);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [environment, setEnvironment] = React.useState<string>(() => searchParams.get('environment') || 'prod');
  const [lifecycles, setLifecycles] = React.useState<string[]>(() => {
    const raw = searchParams.get('lifecycles');
    if (!raw) return ['active'];
    const parts = raw
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
    return parts.length > 0 ? parts : ['active'];
  });
  const [focusInterfaceId, setFocusInterfaceId] = React.useState<string | null>(() => searchParams.get('focusInterfaceId'));
  const [viewMode, setViewMode] = React.useState<'business' | 'technical'>('business');
  const [selectedNodeId, setSelectedNodeId] = React.useState<string | null>(null);
  const [selectedLinkId, setSelectedLinkId] = React.useState<string | null>(null);
  const [isFrozen, setIsFrozen] = React.useState<boolean>(false);
  const [autoCenterEnabled, setAutoCenterEnabled] = React.useState<boolean>(true);
  const zoomApiRef = React.useRef<{ zoomIn: () => void; zoomOut: () => void } | null>(null);
  const graphControlsRef = React.useRef<GraphControlsApi | null>(null);
  const { byField, labelFor, settings, entityName } = useItOpsEnumOptions();
  const protocolLabelMap = React.useMemo(
    () => new Map((settings?.connectionTypes || []).map((ct: any) => [String(ct.code || ''), ct.label || ct.code])),
    [settings?.connectionTypes],
  );
  const [linkedConnections, setLinkedConnections] = React.useState<InterfaceConnectionLinkSummary[]>([]);
  const [linkedConnectionsLoading, setLinkedConnectionsLoading] = React.useState<boolean>(false);
  const [linkedConnectionsError, setLinkedConnectionsError] = React.useState<string | null>(null);
  const [appSummaries, setAppSummaries] = React.useState<Record<string, { data?: ApplicationMapSummary; loading: boolean; error?: string | null }>>({});
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
    return [1, 2, 3, 4, 5].includes(num) ? (num as DepthLimit) : 'all';
  });
  const lifecycleOptions = React.useMemo(() => {
    const list = byField.lifecycleStatus || [];
    if (list.length === 0) return [{ label: t('pages.maps.active'), value: 'active' }];
    return list.map((item) => ({
      value: item.code,
      label: item.deprecated ? `${item.label} (${t('common:enumEditor.retiredSuffix')})` : item.label,
    }));
  }, [byField.lifecycleStatus, t]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<InterfaceMapResponse>({
    queryKey: ['interface-map', environment, lifecycles.slice().sort().join(',')],
    queryFn: async () => {
      const response = await api.get<InterfaceMapResponse>('/interfaces/map', {
        params: {
          environment,
          lifecycles: lifecycles.join(','),
          includeBindings: true,
        },
      });
      return response.data;
    },
    placeholderData: (previousData) => previousData,
  });

  const graphData = React.useMemo<GraphData>(() => {
    if (!data) return EMPTY_GRAPH;
    return viewMode === 'business' ? buildBusinessGraph(data) : buildTechnicalGraph(data);
  }, [data, viewMode]);

  const nodeOptions = React.useMemo(() => {
    const applicationsLabel = t('pages.maps.applications');
    const infraLabel = t('pages.interfaceMap.infraServices');
    const order: Record<string, number> = { [applicationsLabel]: 0, [infraLabel]: 1 };
    return graphData.nodes
      .map((n) => {
        const typeLabel = n.isMiddleware ? infraLabel : applicationsLabel;
        return {
          id: n.id,
          name: n.name,
          typeLabel,
          label: n.name,
          group: typeLabel,
        };
      })
      .sort((a, b) => {
        const oa = order[a.typeLabel] ?? 99;
        const ob = order[b.typeLabel] ?? 99;
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

  const isPrimaryNode = React.useCallback((node: MapGraphNode) => !node.isMiddleware, []);

  const filteredGraph = React.useMemo<GraphData>(() => {
    if (rootNodeIds.length === 0 || depthLimit === 'all') {
      return graphData;
    }

    const nodeMap = new Map<string, MapGraphNode>();
    graphData.nodes.forEach((n) => nodeMap.set(n.id, n));

    const adjacency = new Map<string, Set<string>>();
    graphData.links.forEach((l) => {
      const sid = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tid = typeof l.target === 'object' ? (l.target as any).id : l.target;
      if (!nodeMap.has(sid) || !nodeMap.has(tid)) return;
      if (!adjacency.has(sid)) adjacency.set(sid, new Set());
      if (!adjacency.has(tid)) adjacency.set(tid, new Set());
      adjacency.get(sid)!.add(tid);
      adjacency.get(tid)!.add(sid);
    });

    const queue: Array<{ id: string; depth: number }> = [];
    const visited = new Map<string, number>();
    rootNodeIds.forEach((id) => {
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
      const sid = typeof l.source === 'object' ? (l.source as any).id : l.source;
      const tid = typeof l.target === 'object' ? (l.target as any).id : l.target;
      return includedIds.has(sid) && includedIds.has(tid);
    });
    return { nodes, links };
  }, [graphData, rootNodeIds, depthLimit, isPrimaryNode]);

  const nodeById = React.useMemo(() => {
    const map = new Map<string, { id: string; name: string }>();
    if (data?.nodes) {
      data.nodes.forEach((n) => {
        map.set(n.id, { id: n.id, name: n.name });
      });
    } else {
      graphData.nodes.forEach((n) => {
        map.set(n.id, { id: n.id, name: n.name });
      });
    }
    return map;
  }, [data?.nodes, graphData.nodes]);

  React.useEffect(() => {
    if (!selectedNodeId) return;
    if (!filteredGraph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [filteredGraph.nodes, selectedNodeId]);

  React.useEffect(() => {
    if (!selectedLinkId) return;
    if (!filteredGraph.links.some((link) => link.id === selectedLinkId)) {
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

  // Fetch application summary on selection (applications & middleware nodes share type)
  React.useEffect(() => {
    if (!selectedNode) return;
    const nodeId = selectedNode.id;
    setAppSummaries((prev) => {
      const existing = prev[nodeId];
      if (existing && existing.data && !existing.error) return prev;
      return { ...prev, [nodeId]: { ...existing, loading: true, error: null } };
    });
    let cancelled = false;
    const load = async () => {
      try {
        const res = await api.get<ApplicationMapSummary>(`/applications/${nodeId}/map-summary`);
        if (!cancelled) {
          setAppSummaries((prev) => ({ ...prev, [nodeId]: { data: res.data, loading: false, error: null } }));
        }
      } catch (e: any) {
        if (!cancelled) {
          setAppSummaries((prev) => ({
            ...prev,
            [nodeId]: { data: prev[nodeId]?.data, loading: false, error: getApiErrorMessage(e, t, t('messages.loadApplicationFailed')) },
          }));
        }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selectedNode]);

  React.useEffect(() => {
    if (!focusInterfaceId) return;
    if (!graphData.links || graphData.links.length === 0) return;
    const match = graphData.links.find((l) => l.interfaceDbId === focusInterfaceId);
    if (match) {
      setSelectedLinkId(match.id);
      setSelectedNodeId(null);
      setFocusInterfaceId(null);
    }
  }, [graphData.links, focusInterfaceId]);

  const selectedLinkBindings = React.useMemo(() => {
    if (!data?.bindings || !selectedLink) return [];
    return data.bindings.filter((b) => b.interface_id === selectedLink.interfaceDbId);
  }, [data?.bindings, selectedLink]);

  const viewDescription = viewMode === 'business'
    ? t('pages.interfaceMap.businessView')
    : t('pages.interfaceMap.technicalView');

  React.useEffect(() => {
    let cancelled = false;
    if (!selectedLink) {
      setLinkedConnections([]);
      setLinkedConnectionsError(null);
      setLinkedConnectionsLoading(false);
      return () => {
        cancelled = true;
      };
    }
    setLinkedConnectionsLoading(true);
    setLinkedConnectionsError(null);
    const load = async () => {
      try {
        const res = await api.get<{ items: InterfaceConnectionLinkSummary[] }>(
          `/interfaces/${selectedLink.interfaceDbId}/connection-links`,
          {
            params: { environment },
          },
        );
        if (!cancelled) {
          setLinkedConnections(res.data.items || []);
        }
      } catch (e: any) {
        if (!cancelled) {
          setLinkedConnections([]);
          setLinkedConnectionsError(
            getApiErrorMessage(e, t, t('messages.loadConnectionsFailed')),
          );
        }
      } finally {
        if (!cancelled) {
          setLinkedConnectionsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedLink, environment]);

  const lifecycleSelectValue = lifecycles.length > 0 ? lifecycles : ['active'];

  const headerActions = (
    <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ xs: 'stretch', md: 'center' }}>
      <TextField
        select
        size="small"
        label={t('common.environment')}
        value={environment}
        onChange={(e) => {
          const nextEnv = e.target.value;
          setEnvironment(nextEnv);
          setSelectedNodeId(null);
          const next = new URLSearchParams(searchParams);
          next.set('environment', nextEnv);
          next.set('lifecycles', (lifecycles.length > 0 ? lifecycles : ['active']).join(','));
          setSearchParams(next, { replace: true });
        }}
        sx={{ minWidth: 160 }}
      >
        {APPLICATION_ENVIRONMENTS.map((option) => (
          <MenuItem key={option.value} value={option.value}>
            {environmentLabel(t, option.value)}
          </MenuItem>
        ))}
      </TextField>
      <FormControl size="small" sx={{ minWidth: 220 }}>
        <InputLabel id="interface-map-lifecycle-label">{t('common.lifecycle')}</InputLabel>
        <Select
          labelId="interface-map-lifecycle-label"
          multiple
          label={t('common.lifecycle')}
          value={lifecycleSelectValue}
          renderValue={(selected) => (selected as string[])
            .map((value) => {
              const option = lifecycleOptions.find((opt) => opt.value === value);
              return option?.label || labelFor('lifecycleStatus', value) || value;
            })
            .join(', ')}
          onChange={(e) => {
            const value = typeof e.target.value === 'string' ? e.target.value.split(',') : (e.target.value as string[]);
            const normalized = value.length > 0 ? value : ['active'];
            setLifecycles(normalized);
            const next = new URLSearchParams(searchParams);
            next.set('environment', environment);
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
        sx={{ minWidth: 240 }}
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
          if (nextIds.length > 0 && depthLimit === 'all') setDepthLimit(1);
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={t('pages.maps.applications')}
            placeholder={t('pages.maps.selectApplications')}
            InputLabelProps={{ shrink: true }}
          />
        )}
      />
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
      <FormControlLabel
        control={(
          <Switch
            color="primary"
            checked={viewMode === 'technical'}
            onChange={(e) => {
              setViewMode(e.target.checked ? 'technical' : 'business');
              setSelectedNodeId(null);
            }}
          />
        )}
        label={t('pages.interfaceMap.showMiddleware')}
      />
      {isFetching && (
        <Typography variant="caption" color="text.disabled">{t('pages.maps.updating')}</Typography>
      )}
    </Stack>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <PageHeader title={t('pages.interfaceMap.title')} actions={headerActions} />
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {viewDescription}
      </Typography>
      {isLoading && (
        <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Stack spacing={2} alignItems="center">
            <CircularProgress size={32} />
            <Typography variant="body2" color="text.secondary">
              {t('pages.interfaceMap.building', { env: environmentLabel(t, environment) })}
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
          {error instanceof Error ? error.message : t('pages.interfaceMap.loadFailed')}
        </Alert>
      )}
      {!isLoading && !isError && filteredGraph.nodes.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          {t('pages.interfaceMap.empty')}
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
	                <IconButton
	                  size="small"
	                  onClick={() => zoomApiRef.current?.zoomIn()}
	                >
	                  <ZoomInIcon fontSize="small" />
	                </IconButton>
	              </Tooltip>
	              <Tooltip title={t('pages.maps.zoomOut')}>
	                <IconButton
	                  size="small"
	                  onClick={() => zoomApiRef.current?.zoomOut()}
	                >
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
	                  <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', height: 20, display: 'flex', alignItems: 'center' }}>
	                    SVG
	                  </Typography>
	                </IconButton>
	              </Tooltip>
	              <Tooltip title={t('pages.maps.exportPng')}>
	                <IconButton size="small" onClick={() => graphControlsRef.current?.exportPng()}>
	                  <Typography variant="caption" sx={{ fontWeight: 600, fontSize: '0.65rem', height: 20, display: 'flex', alignItems: 'center' }}>
	                    PNG
	                  </Typography>
	                </IconButton>
	              </Tooltip>
	            </Stack>
	          </Box>

	          <Box sx={{ flex: 1, minWidth: 0 }}>
	            <InterfaceMapGraph
	              nodes={filteredGraph.nodes}
	              links={filteredGraph.links}
	              selectedNodeId={selectedNodeId}
	              selectedLinkId={selectedLinkId}
	              frozen={isFrozen}
	              autoCenter={autoCenterEnabled}
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
                gap: 1.5,
              }}
            >
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Typography variant="subtitle1">
                  {selectedNode ? t('pages.interfaceMap.applicationDetails') : t('pages.interfaceMap.interfaceDetails')}
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
                    const summary = appSummaries[selectedNode.id];
                    const criticalityLabel = businessLabel(summary?.data?.criticality ?? selectedNode.criticality);
                    return (
                      <Stack spacing={0.75}>
                        {summary?.loading && (
                          <Typography variant="body2" color="text.secondary">{t('pages.maps.loadingDetails')}</Typography>
                        )}
                        {summary?.error && (
                          <Typography variant="body2" color="error">{summary.error}</Typography>
                        )}
                        <Typography variant="body2"><strong>{t('pages.interfaceMap.description')}</strong> {summary?.data?.description || '—'}</Typography>
                        <Typography variant="body2"><strong>{t('pages.interfaceMap.publisher')}</strong> {summary?.data?.editor || '—'}</Typography>
                        <Typography variant="body2"><strong>{t('pages.maps.criticalityLabel')}</strong> {criticalityLabel}</Typography>

                        <Box sx={{ mt: 0.75 }}>
                          <Typography variant="body2"><strong>{t('pages.interfaceMap.servers')}</strong></Typography>
                          {summary?.data?.assigned_servers?.length ? (
                            <Stack spacing={0.35} sx={{ mt: 0.5 }}>
                              {(() => {
                                const envOrder = ['prod', 'pre_prod', 'qa', 'test', 'dev', 'sandbox'];
                                const grouped = summary.data.assigned_servers.reduce<Record<string, typeof summary.data.assigned_servers>>(
                                  (acc, server) => {
                                    const list = acc[server.environment] || [];
                                    list.push(server);
                                    acc[server.environment] = list;
                                    return acc;
                                  },
                                  {},
                                );
                                return Object.keys(grouped)
                                  .sort((a, b) => envOrder.indexOf(a) - envOrder.indexOf(b))
                                  .map((env) => (
                                    <Box key={env}>
                                      <Typography variant="caption" color="text.secondary">{environmentLabel(t, env)}</Typography>
                                      <Stack spacing={0.25} sx={{ mt: 0.25 }}>
                                        {(() => {
                                          // The clusters first, each followed by the members that inherit it, then the other servers.
                                          // A server comes once per role: shown once, with the clusters of all its rows.
                                          const byId = new Map<string, (typeof grouped)[string][number]>();
                                          for (const srv of grouped[env]) {
                                            const seen = byId.get(srv.id);
                                            byId.set(srv.id, seen
                                              ? { ...seen, via_clusters: [...(seen.via_clusters ?? []), ...(srv.via_clusters ?? []).filter((via) => !(seen.via_clusters ?? []).some((known) => known.id === via.id))] }
                                              : srv);
                                          }
                                          const list = Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name));
                                          const clusters = list.filter((srv) => srv.is_cluster);
                                          const clusterIds = new Set(clusters.map((srv) => srv.id));
                                          const throughCluster = (srv: (typeof list)[number]) => (srv.via_clusters ?? []).some((via) => clusterIds.has(via.id));
                                          const serverButton = (srv: (typeof list)[number]) => (
                                            <Button
                                              variant="text"
                                              size="small"
                                              onClick={() => navigate(`/it/assets/${srv.id}/overview`)}
                                              sx={{ justifyContent: 'flex-start', textAlign: 'left', px: 0, minWidth: 0 }}
                                            >
                                              {srv.name}
                                            </Button>
                                          );
                                          return [
                                            ...clusters.flatMap((cluster) => [
                                              <Box key={`${cluster.id}-${cluster.environment}`} sx={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                                                {serverButton(cluster)}
                                                <ClusterMark />
                                              </Box>,
                                              ...list
                                                .filter((srv) => !srv.is_cluster && (srv.via_clusters ?? []).some((via) => via.id === cluster.id))
                                                .map((member) => (
                                                  <Box key={`${cluster.id}-${member.id}`} sx={{ display: 'flex', alignItems: 'center', gap: '4px', minWidth: 0, pl: '12px' }}>
                                                    <SubdirectoryArrowRightIcon aria-hidden sx={(muiTheme) => ({ fontSize: 13, color: muiTheme.palette.kanap.text.tertiary })} />
                                                    {serverButton(member)}
                                                  </Box>
                                                )),
                                            ]),
                                            ...list
                                              .filter((srv) => !srv.is_cluster && !throughCluster(srv))
                                              .map((srv) => <Box key={`${srv.id}-${srv.environment}`}>{serverButton(srv)}</Box>),
                                          ];
                                        })()}
                                      </Stack>
                                    </Box>
                                  ));
                              })()}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                              {t('pages.interfaceMap.noServers')}
                            </Typography>
                          )}
                        </Box>

                        <Box sx={{ mt: 0.75 }}>
                          <Typography variant="body2"><strong>{t('pages.interfaceMap.businessOwners')}</strong></Typography>
                          {summary?.data?.business_owners?.length ? (
                            <Stack spacing={0.25} sx={{ mt: 0.35 }}>
                              {summary.data.business_owners.map((o) => (
                                <Typography key={o.user_id} variant="body2">
                                  {o.name}
                                </Typography>
                              ))}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">{t('pages.interfaceMap.noneListed')}</Typography>
                          )}
                        </Box>

                        <Box sx={{ mt: 0.25 }}>
                          <Typography variant="body2"><strong>{t('pages.interfaceMap.itOwners')}</strong></Typography>
                          {summary?.data?.it_owners?.length ? (
                            <Stack spacing={0.25} sx={{ mt: 0.35 }}>
                              {summary.data.it_owners.map((o) => (
                                <Typography key={o.user_id} variant="body2">
                                  {o.name}
                                </Typography>
                              ))}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">{t('pages.interfaceMap.noneListed')}</Typography>
                          )}
                        </Box>

                        <Box sx={{ mt: 0.25 }}>
                          <Typography variant="body2"><strong>{t('pages.interfaceMap.support')}</strong></Typography>
                          {summary?.data?.support_contacts?.length ? (
                            <Stack spacing={0.25} sx={{ mt: 0.35 }}>
                              {summary.data.support_contacts.map((c, idx) => {
                                const name = [c.contact?.first_name, c.contact?.last_name].filter(Boolean).join(' ').trim()
                                  || c.contact?.email
                                  || c.contact_id;
                                return (
                                  <Button
                                    key={`${c.contact_id}-${idx}`}
                                    variant="text"
                                    size="small"
                                    onClick={() => navigate(`/it/applications/${selectedNode.id}/technical`)}
                                    sx={{ justifyContent: 'flex-start', textAlign: 'left', px: 0 }}
                                  >
                                    {name}{c.role ? ` (${c.role})` : ''}
                                  </Button>
                                );
                              })}
                            </Stack>
                          ) : (
                            <Typography variant="body2" color="text.secondary">{t('pages.interfaceMap.noSupport')}</Typography>
                          )}
                        </Box>

                        <Box sx={{ mt: 1 }}>
                          <Button
                            variant="contained"
                            size="small"
                            onClick={() => navigate(`/it/applications/${selectedNode.id}/overview`)}
                          >
                            {t('pages.interfaceMap.openApplication')}
                          </Button>
                        </Box>
                      </Stack>
                    );
                  })()}
                </Stack>
              )}

              {selectedLink && (
                <Stack spacing={1}>
                  <Typography variant="h6">{selectedLink.interfaceId}</Typography>
                  <Stack spacing={0.5}>
                    <Typography variant="body2">{t('pages.interfaceMap.criticalityValue', { value: businessLabel(selectedLink.criticality) })}</Typography>
                    <Typography variant="body2">{t('pages.interfaceMap.route', { value: routeTypeLabel(t, selectedLink.integrationRouteType) || '-' })}</Typography>
                    <Typography variant="body2">{t('pages.interfaceMap.bindings', { count: selectedLink.bindingsCount })}</Typography>
                    <Typography variant="body2">{t('pages.interfaceMap.viaMiddleware', { value: selectedLink.hasMiddleware ? t('enums.yesNo.yes') : t('enums.yesNo.no') })}</Typography>
                  </Stack>
                  {selectedLinkBindings.length > 0 && (
                    <Stack spacing={0.5} sx={{ mt: 1 }}>
                      <Typography variant="subtitle2">
	                        {t('pages.interfaceMap.endpointsEnv', { env: environmentLabel(t, environment) })}
	                      </Typography>
                      {selectedLinkBindings.map((binding) => {
                        const sourceApp = nodeById.get(binding.source_application_id)?.name || binding.source_application_id;
                        const targetApp = nodeById.get(binding.target_application_id)?.name || binding.target_application_id;
                        const jobName = binding.env_job_name || '';
                        return (
                          <Box key={binding.id} sx={{ mb: 0.5 }}>
                            <Typography variant="body2" color="text.secondary">
                              {`${sourceApp} → ${targetApp} (${legTypeLabel(t, binding.leg_type)})`}
                            </Typography>
                            {jobName && (
                              <Typography variant="body2">
                                {t('pages.interfaceMap.job', { value: jobName })}
                              </Typography>
                            )}
                            {binding.source_endpoint && (
                              <Typography variant="body2">
                                {t('pages.maps.sourceEndpoint', { value: binding.source_endpoint })}
                              </Typography>
                            )}
                            {binding.target_endpoint && (
                              <Typography variant="body2">
                                {t('pages.maps.targetEndpoint', { value: binding.target_endpoint })}
                              </Typography>
                            )}
                          </Box>
                        );
                      })}
	                    </Stack>
	                  )}
                  <Stack spacing={0.5} sx={{ mt: 1 }}>
                    <Typography variant="subtitle2">
                      {t('pages.interfaceMap.infraConnections', { env: environmentLabel(t, environment) })}
                    </Typography>
                    {linkedConnectionsLoading && (
                      <Typography variant="body2" color="text.secondary">
                        {t('pages.interfaceMap.loadingInfra')}
                      </Typography>
                    )}
                    {linkedConnectionsError && (
                      <Typography variant="body2" color="error">
                        {linkedConnectionsError}
                      </Typography>
                    )}
                    {!linkedConnectionsLoading && !linkedConnectionsError && linkedConnections.length === 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {t('pages.interfaceMap.noInfra', { env: environmentLabel(t, environment) })}
                      </Typography>
                    )}
                    {!linkedConnectionsLoading && linkedConnections.length > 0 && (
                      <Stack spacing={0.75}>
                        {linkedConnections.map((link) => (
                          <Box
                            key={link.id}
                            sx={{
                              borderRadius: 1,
                              border: (theme) => `1px solid ${theme.palette.divider}`,
                              p: 0.75,
                            }}
                          >
                              <Stack direction="row" justifyContent="space-between" alignItems="center" spacing={1}>
                              {(() => {
                                const protocolLabels = (link.connection.protocol_codes || []).map((code) => protocolLabelMap.get(code) || code);
                                const formatEndpoint = (
                                  serverName?: string | null,
                                  entityLabel?: string | null,
                                  serverId?: string | null,
                                  entityCode?: string | null,
                                  isCluster?: boolean | null,
                                ) => {
                                  const label = serverName || (entityCode ? entityName(entityCode, entityLabel) : entityLabel) || serverId;
                                  if (!label) return '-';
                                  return isCluster ? t('pages.interfaceMap.clusterEndpoint', { name: label }) : label;
                                };
                                const source = formatEndpoint(
                                  link.connection.source_server_name,
                                  link.connection.source_entity_label,
                                  link.connection.source_server_id,
                                  link.connection.source_entity_code,
                                  link.connection.source_is_cluster,
                                );
                                const destination = formatEndpoint(
                                  link.connection.destination_server_name,
                                  link.connection.destination_entity_label,
                                  link.connection.destination_server_id,
                                  link.connection.destination_entity_code,
                                  link.connection.destination_is_cluster,
                                );
                                return (
                                  <Stack spacing={0.35}>
                                    <Typography variant="body2" fontWeight={600}>
                                      <Typography component="span" sx={{ fontFamily: "'JetBrains Mono Variable', monospace", fontSize: '0.75rem', color: 'text.secondary', mr: 0.5 }}>
                                        {link.connection.connection_reference}
                                      </Typography>
                                      · {link.connection.name}
                                    </Typography>
                                    <Typography variant="body2">{t('pages.interfaceMap.sourceValue', { value: source })}</Typography>
                                    <Typography variant="body2">{t('pages.interfaceMap.destinationValue', { value: destination })}</Typography>
                                    <Typography variant="body2">
                                      {t('pages.interfaceMap.protocolsValue', { value: protocolLabels.length > 0 ? protocolLabels.join(', ') : '—' })}
                                    </Typography>
                                    <Typography variant="caption" color="text.secondary">
                                      {t('pages.interfaceMap.bindingValue', { env: environmentLabel(t, link.environment), leg: legTypeLabel(t, link.leg_type) })}
                                    </Typography>
                                  </Stack>
                                );
                              })()}
                              <Stack spacing={0.5}>
                                <Button
                                  size="small"
                                  variant="text"
                                  onClick={() => {
                                    navigate(`/it/connections/${link.connection.connection_reference || link.connection.id}/overview`);
                                  }}
                                >
                                  {t('common:buttons.edit')}
                                </Button>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => {
                                    const serverIds = new Set<string>();
                                    (link.connection.server_ids || []).forEach((sid) => sid && serverIds.add(sid));
                                    if (link.connection.source_server_id) serverIds.add(link.connection.source_server_id);
                                    if (link.connection.destination_server_id) serverIds.add(link.connection.destination_server_id);
                                    const params = new URLSearchParams({
                                      environment,
                                      lifecycles: link.connection.lifecycle || 'active',
                                      focusConnectionId: link.connection.id,
                                      depth: '1',
                                    });
                                    if (serverIds.size > 0) {
                                      params.set('rootIds', Array.from(serverIds).join(','));
                                    }
                                    navigate(`/it/connection-map?${params.toString()}`);
                                  }}
                                >
                                  {t('pages.interfaceMap.viewInConnectionMap')}
                                </Button>
                              </Stack>
                            </Stack>
                          </Box>
                        ))}
                      </Stack>
                    )}
                  </Stack>
	                  <Box sx={{ mt: 1 }}>
	                    <Button
	                      variant="contained"
	                      size="small"
                      onClick={() => {
                        navigate(`/it/interfaces/${selectedLink.interfaceReference || selectedLink.interfaceDbId}/overview`);
                      }}
                    >
                      {t('pages.interfaceMap.openInterface')}
                    </Button>
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
