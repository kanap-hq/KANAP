import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Box, useTheme } from '@mui/material';

import { useTranslation } from 'react-i18next';
export type ConnectionMapNode = {
  id: string;
  name: string;
  kind: 'server' | 'cluster' | 'entity';
  isCluster?: boolean;
  environment: string | null;
  networkSegment: string | null;
  hostingCategory: 'on_prem' | 'cloud' | null;
  graphTier?: string | null;
  implicitMember?: boolean;
  hiddenMembers?: number;
  hiddenMembersLabel?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

export type ConnectionMapLink = {
  id: string;
  connectionDbId?: string;
  connectionReference: string;
  name: string;
  purpose?: string | null;
  typicalPorts?: string;
  source: string | ConnectionMapNode;
  target: string | ConnectionMapNode;
  lifecycle: string;
  criticality: string;
  dataClass: string;
  containsPii: boolean;
  topology: 'server_to_server' | 'multi_server';
  protocolLabels: string[];
  parallelIndex?: number;
  parallelTotal?: number;
  parallelOffsetIndex?: number;
  parallelDirection?: number;
  pairSourceId?: string;
  pairTargetId?: string;
  labelT?: number;
};

export type ClusterMembership = {
  cluster_id: string;
  server_id: string;
};

export type GraphControlsApi = {
  zoomIn: () => void;
  zoomOut: () => void;
  snapToGrid: (gridSize?: number) => void;
  exportSvg: () => void;
  exportPng: () => void;
};

type Props = {
  nodes: ConnectionMapNode[];
  links: ConnectionMapLink[];
  clusterMemberships?: ClusterMembership[];
  selectedNodeId?: string | null;
  selectedLinkId?: string | null;
  frozen?: boolean;
  autoCenter?: boolean;
  roleTierEnabled?: boolean;
  onSelectNode?: (nodeId: string | null) => void;
  onSelectLink?: (linkId: string | null) => void;
  onClearSelection?: () => void;
  onRegisterZoomControls?: (api: { zoomIn: () => void; zoomOut: () => void }) => void;
  onRegisterGraphControls?: (api: GraphControlsApi) => void;
};

const SERVER_WIDTH = 150;
const SERVER_HEIGHT = 48;
const ENTITY_WIDTH = 130;
const ENTITY_HEIGHT = 40;
const LINK_SPACING = 10;
const TIER_Y_FRACTIONS: Record<string, number> = {
  top: 0.1,
  upper: 0.3,
  center: 0.5,
  lower: 0.7,
  bottom: 0.9,
};

const getNodeBox = (node: any) => {
  if (node.kind === 'entity') {
    return { w: ENTITY_WIDTH, h: ENTITY_HEIGHT };
  }
  return { w: SERVER_WIDTH, h: SERVER_HEIGHT };
};

// Custom force to group cluster members around their cluster node
function forceClusterGroup(
  clusterMemberships: ClusterMembership[],
  nodeById: Map<string, any>,
  strength = 0.8, // Moderate attraction - keeps groups together without fighting collision
) {
  // Build mapping: serverId -> clusterId
  const serverToCluster = new Map<string, string>();
  const clusterToServers = new Map<string, string[]>();

  for (const m of clusterMemberships) {
    serverToCluster.set(m.server_id, m.cluster_id);
    const members = clusterToServers.get(m.cluster_id) || [];
    members.push(m.server_id);
    clusterToServers.set(m.cluster_id, members);
  }

  return function force(alpha: number) {
    // For each member server, apply force toward its cluster
    for (const [serverId, clusterId] of serverToCluster) {
      const serverNode = nodeById.get(serverId);
      const clusterNode = nodeById.get(clusterId);
      if (!serverNode || !clusterNode) continue;

      // Calculate force toward cluster (but offset below it)
      const members = clusterToServers.get(clusterId) || [];
      const memberIndex = members.indexOf(serverId);
      const memberCount = members.length;

      // Target position: below cluster, spread horizontally
      const spacing = SERVER_WIDTH + 20;
      const totalWidth = (memberCount - 1) * spacing;
      const offsetX = memberIndex * spacing - totalWidth / 2;
      const offsetY = SERVER_HEIGHT + 40; // Below the cluster

      const targetX = clusterNode.x + offsetX;
      const targetY = clusterNode.y + offsetY;

      // Apply strong force toward target position
      serverNode.vx += (targetX - serverNode.x) * strength * alpha;
      serverNode.vy += (targetY - serverNode.y) * strength * alpha;
    }

    // For each cluster, apply force to stay above member centroid
    for (const [clusterId, members] of clusterToServers) {
      const clusterNode = nodeById.get(clusterId);
      if (!clusterNode || members.length === 0) continue;

      // Calculate centroid of members
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      for (const serverId of members) {
        const serverNode = nodeById.get(serverId);
        if (serverNode) {
          sumX += serverNode.x;
          sumY += serverNode.y;
          count += 1;
        }
      }
      if (count === 0) continue;

      const centroidX = sumX / count;
      const centroidY = sumY / count;

      // Cluster should be above the centroid
      const targetX = centroidX;
      const targetY = centroidY - SERVER_HEIGHT - 40;

      clusterNode.vx += (targetX - clusterNode.x) * strength * 0.8 * alpha;
      clusterNode.vy += (targetY - clusterNode.y) * strength * 0.8 * alpha;
    }
  };
}

export default function ConnectionMapGraph({
  nodes,
  links,
  clusterMemberships = [],
  selectedNodeId,
  selectedLinkId,
  frozen = false,
  autoCenter = true,
  roleTierEnabled = true,
  onSelectNode,
  onSelectLink,
  onClearSelection,
  onRegisterZoomControls,
  onRegisterGraphControls,
}: Props) {
  const { t } = useTranslation(['it', 'common']);
  const svgRef = useRef<SVGSVGElement>(null);
  const theme = useTheme();
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const simulationRef = useRef<d3.Simulation<any, any> | null>(null);
  const frozenRef = useRef<boolean>(frozen);
  const alphaRef = useRef<number>(0.3);
  const nodesDataRef = useRef<any[]>([]);
  const updatePositionsRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const updateDimensions = () => {
      if (svgRef.current?.parentElement) {
        const { clientWidth, clientHeight } = svgRef.current.parentElement;
        setDimensions({ width: clientWidth, height: clientHeight || 600 });
      }
    };
    window.addEventListener('resize', updateDimensions);
    updateDimensions();
    return () => window.removeEventListener('resize', updateDimensions);
  }, []);

  useEffect(() => {
    frozenRef.current = frozen;
    const sim = simulationRef.current;
    if (!sim) return;
    if (frozen) {
      alphaRef.current = sim.alpha();
      sim.stop();
    } else {
      const nextAlpha = Math.max(alphaRef.current || 0.001, 0.001);
      sim.alpha(nextAlpha).restart();
    }
  }, [frozen]);

  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = dimensions.width;
    const height = dimensions.height;

    const nodesData: any[] = nodes.map((n) => ({ ...n }));
    const linksData = links.map((l) => ({ ...l }));
    nodesDataRef.current = nodesData;

    const nodeById = new Map<string, any>();
    nodesData.forEach((n) => nodeById.set(n.id, n));

    // Parallel edge grouping (same logic as InterfaceMapGraph)
    const linkGroups = new Map<string, any[]>();
    linksData.forEach((link) => {
      const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
      const targetId = typeof link.target === 'object' ? (link.target as any).id : link.target;
      const aId = sourceId < targetId ? sourceId : targetId;
      const bId = sourceId < targetId ? targetId : sourceId;
      const key = `${aId}-${bId}`;
      (link as any).pairSourceId = aId;
      (link as any).pairTargetId = bId;
      if (!linkGroups.has(key)) linkGroups.set(key, []);
      linkGroups.get(key)!.push(link);
    });

    linkGroups.forEach((group) => {
      const forward: any[] = [];
      const reverse: any[] = [];
      group.forEach((link) => {
        const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const isForward = sourceId === (link as any).pairSourceId;
        if (isForward) forward.push(link);
        else reverse.push(link);
      });
      const forwardCount = forward.length;
      const reverseCount = reverse.length;
      forward.forEach((link, idx) => {
        (link as any).parallelOffsetIndex = idx;
        (link as any).parallelDirection = 1;
        (link as any).labelT = forwardCount > 0 ? (idx + 1) / (forwardCount + 1) : 0.5;
      });
      reverse.forEach((link, idx) => {
        (link as any).parallelOffsetIndex = idx;
        (link as any).parallelDirection = -1;
        (link as any).labelT = reverseCount > 0 ? (idx + 1) / (reverseCount + 1) : 0.5;
      });
    });

    const simulation = d3
      .forceSimulation(nodesData)
      .force('link', d3.forceLink(linksData).id((d: any) => d.id).distance(160))
      .force('charge', d3.forceManyBody().strength(-520))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius((d: any) => Math.max(getNodeBox(d).w, getNodeBox(d).h) / 2 + 11));

    // Add cluster grouping force if there are memberships
    if (clusterMemberships.length > 0) {
      simulation.force('clusterGroup', forceClusterGroup(clusterMemberships, nodeById));
    }

    if (roleTierEnabled) {
      simulation.force('roleTier', (alpha: number) => {
        for (const node of nodesData) {
          const tier = node.graphTier || 'center';
          const targetY = height * (TIER_Y_FRACTIONS[tier] ?? 0.5);
          node.vy += (targetY - node.y) * 0.4 * alpha;
        }
      });
    }

    simulationRef.current = simulation;

    const defs = svg.append('defs');
    const createArrow = (id: string, color: string, opts?: { start?: boolean }) => {
      const isStart = !!opts?.start;
      defs
        .append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', isStart ? 2 : 8)
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', isStart ? 'auto-start-reverse' : 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', color);
    };
    createArrow('conn-arrow', '#64748B');
    createArrow('conn-arrow-selected', '#0F172A');
    createArrow('conn-arrow-start', '#64748B', { start: true });
    createArrow('conn-arrow-start-selected', '#0F172A', { start: true });

    const g = svg.append('g');

    const zoomed = (event: any) => {
      g.attr('transform', event.transform);
    };

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', zoomed);

    svg.call(zoom as any);
    zoomRef.current = zoom;

    if (onRegisterZoomControls) {
      onRegisterZoomControls({
        zoomIn: () => svg.transition().duration(200).call(zoom.scaleBy as any, 1.2),
        zoomOut: () => svg.transition().duration(200).call(zoom.scaleBy as any, 0.8),
      });
    }

    if (onRegisterGraphControls) {
      onRegisterGraphControls({
        zoomIn: () => svg.transition().duration(200).call(zoom.scaleBy as any, 1.2),
        zoomOut: () => svg.transition().duration(200).call(zoom.scaleBy as any, 0.8),
        snapToGrid: (gridSize = 50) => {
          nodesDataRef.current.forEach((n) => {
            n.x = Math.round(n.x / gridSize) * gridSize;
            n.y = Math.round(n.y / gridSize) * gridSize;
            // Also update fx/fy if node is pinned
            if (n.fx != null) n.fx = n.x;
            if (n.fy != null) n.fy = n.y;
          });
          updatePositionsRef.current?.();
        },
        exportSvg: () => {
          if (!svgRef.current) return;
          const svgEl = svgRef.current;
          const width = svgEl.clientWidth;
          const height = svgEl.clientHeight;

          // Clone and clean up for export
          const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
          clonedSvg.setAttribute('width', String(width));
          clonedSvg.setAttribute('height', String(height));
          // Remove hit areas (invisible click targets not needed in export)
          clonedSvg.querySelectorAll('path.hit').forEach((el) => el.remove());

          const serializer = new XMLSerializer();
          const svgString = serializer.serializeToString(clonedSvg);
          const blob = new Blob([svgString], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'connection-map.svg';
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
        },
        exportPng: () => {
          if (!svgRef.current) return;
          const svgEl = svgRef.current;
          const gEl = svgEl.querySelector('g');
          if (!gEl) return;

          // Use world-space bbox (pre-zoom) derived from node positions to avoid fractional zoom transforms
          const t = d3.zoomTransform(svgEl);
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;

          nodesDataRef.current.forEach((n) => {
            const { w, h } = getNodeBox(n);
            minX = Math.min(minX, n.x - w / 2);
            maxX = Math.max(maxX, n.x + w / 2);
            minY = Math.min(minY, n.y - h / 2);
            maxY = Math.max(maxY, n.y + h / 2);
          });

          if (!isFinite(minX) || !isFinite(maxX) || !isFinite(minY) || !isFinite(maxY)) {
            minX = 0;
            minY = 0;
            maxX = svgEl.clientWidth || 800;
            maxY = svgEl.clientHeight || 600;
          }

          const padding = 40;
          minX = Math.floor(minX - padding);
          minY = Math.floor(minY - padding);
          maxX = Math.ceil(maxX + padding);
          maxY = Math.ceil(maxY + padding);

          const worldWidth = Math.max(maxX - minX, 1);
          const worldHeight = Math.max(maxY - minY, 1);

          // Match on-screen scale; apply DPI later on canvas
          const exportWidth = Math.round(worldWidth * t.k);
          const exportHeight = Math.round(worldHeight * t.k);

          // Clone the SVG and set explicit dimensions focused on the current viewport
          const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
          clonedSvg.setAttribute('width', String(exportWidth));
          clonedSvg.setAttribute('height', String(exportHeight));
          clonedSvg.style.width = `${exportWidth}px`;
          clonedSvg.style.height = `${exportHeight}px`;
          clonedSvg.setAttribute('viewBox', `${minX} ${minY} ${worldWidth} ${worldHeight}`);
          clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

          // Remove hit areas (invisible click targets) that render incorrectly in canvas
          clonedSvg.querySelectorAll('path.hit').forEach((el) => el.remove());

          // Remove drop-shadow filters to avoid canvas halo artifacts
          clonedSvg.querySelectorAll('[style*="drop-shadow"]').forEach((el) => {
            (el as HTMLElement).style.filter = 'none';
          });


          // Remove markers/defs to prevent canvas marker glitches
          clonedSvg.querySelectorAll('path[marker-end]').forEach((el) => {
            el.removeAttribute('marker-end');
            el.removeAttribute('marker-start');
          });
          clonedSvg.querySelectorAll('defs').forEach((el) => el.remove());

          // Reposition content so viewBox starts at (0,0)
          const mainG = clonedSvg.querySelector('g');
          if (mainG) {
            mainG.setAttribute('transform', 'translate(0,0) scale(1)');
          }

          // Add background rect so edges are anti-aliased against the intended color, not transparent black
          const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bgRect.setAttribute('x', String(minX));
          bgRect.setAttribute('y', String(minY));
          bgRect.setAttribute('width', String(worldWidth));
          bgRect.setAttribute('height', String(worldHeight));
          bgRect.setAttribute('fill', '#F8FAFC');
          clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

          const serializer = new XMLSerializer();
          const svgString = serializer.serializeToString(clonedSvg);

          const canvasScale = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
          const canvasWidth = exportWidth * canvasScale;
          const canvasHeight = exportHeight * canvasScale;
          const canvas = document.createElement('canvas');
          canvas.width = canvasWidth;
          canvas.height = canvasHeight;
          const ctx = canvas.getContext('2d');

          if (!ctx) return;
          (ctx as any).imageSmoothingEnabled = false;
          (ctx as any).imageSmoothingQuality = 'high';

          const img = new Image();
          img.crossOrigin = 'anonymous';

          const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
          const dataUrl = URL.createObjectURL(svgBlob);

          img.onload = () => {
            ctx!.save();
            ctx!.scale(canvasScale, canvasScale);
            ctx!.fillStyle = '#F8FAFC';
            ctx!.fillRect(0, 0, exportWidth, exportHeight);
            ctx!.drawImage(img, 0, 0);
            ctx!.restore();

            canvas.toBlob((blob) => {
              if (blob) {
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = 'connection-map.png';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              } else {
                const pngUrl = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = pngUrl;
                link.download = 'connection-map.png';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
              }
            }, 'image/png');
            URL.revokeObjectURL(dataUrl);
          };

          img.onerror = (err) => {
            console.error('PNG export - image load failed:', err);
            URL.revokeObjectURL(dataUrl);
          };

          img.src = dataUrl;
        },
      });
    }

    // Cluster membership indicator lines (rendered behind connections)
    const membershipGroup = g.append('g').attr('class', 'cluster-memberships');
    const membershipLines = membershipGroup
      .selectAll('line')
      .data(clusterMemberships)
      .enter()
      .append('line')
      .attr('stroke', '#0EA5E9')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4 4')
      .attr('opacity', 0.4)
      .style('pointer-events', 'none');

    const linkGroup = g.append('g').attr('class', 'links');
    const link = linkGroup
      .selectAll('path.visual')
      .data(linksData)
      .enter()
      .append('path')
      .attr('class', 'visual')
      .attr('stroke', '#64748B')
      .attr('stroke-width', 1.5)
      .attr('fill', 'none')
      .attr('marker-end', 'url(#conn-arrow)')
      .attr('marker-start', (d: any) => (d.topology === 'multi_server' ? 'url(#conn-arrow-start)' : null))
      .style('pointer-events', 'none');

    const linkHit = linkGroup
      .selectAll('path.hit')
      .data(linksData)
      .enter()
      .append('path')
      .attr('class', 'hit')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 10)
      .attr('fill', 'none')
      .style('pointer-events', 'stroke')
      .on('click', (event, d: any) => {
        event.stopPropagation();
        if (onSelectLink) onSelectLink(d.id);
      });

    const linkLabel = g
      .append('g')
      .attr('class', 'link-labels')
      .selectAll('text')
      .data(linksData)
      .enter()
      .append('text')
      .text((d: any) => d.typicalPorts || d.connectionReference || d.name || '')
      .attr('font-size', '10px')
      .attr('fill', '#0F172A')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#F8FAFC')
      .attr('stroke-width', 3)
      .style('pointer-events', 'none');

    const node = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodesData)
      .enter()
      .append('g')
      .attr('data-node-id', (d: any) => d.id)
      .call(
        d3
          .drag<any, any>()
          .on('start', dragstarted)
          .on('drag', dragged)
          .on('end', dragended),
      )
      .on('click', (event, d) => {
        if (onSelectNode) onSelectNode(d.id);
        event.stopPropagation();
      });

    const hostingFill = (d: any) => {
      if (d.kind === 'entity') return '#FFF7ED';
      if (d.kind === 'cluster') return d.hostingCategory === 'cloud' ? '#E0F2FE' : '#ECFEFF';
      if (d.hostingCategory === 'cloud') return '#EFF6FF';
      if (d.hostingCategory === 'on_prem') return '#ECFDF3';
      return '#FFFFFF';
    };

    const hostingStroke = (d: any) => {
      if (d.kind === 'entity') return '#FB923C';
      if (d.kind === 'cluster') return '#0EA5E9';
      if (d.hostingCategory === 'cloud') return '#3B82F6';
      if (d.hostingCategory === 'on_prem') return '#16A34A';
      return '#94A3B8';
    };

    const serverNodes = node.filter((d: any) => d.kind === 'server');
    const clusterNodes = node.filter((d: any) => d.kind === 'cluster');

    serverNodes
      .append('rect')
      .attr('class', 'node-shape')
      .attr('width', SERVER_WIDTH)
      .attr('height', SERVER_HEIGHT)
      .attr('x', -SERVER_WIDTH / 2)
      .attr('y', -SERVER_HEIGHT / 2)
      .attr('rx', 10)
      .attr('ry', 10)
      .attr('fill', hostingFill as any)
      .attr('stroke', hostingStroke as any)
      .attr('stroke-width', 1.5)
      .style('filter', 'drop-shadow(0px 2px 4px rgba(0,0,0,0.08))');

    clusterNodes
      .append('rect')
      .attr('class', 'node-shape')
      .attr('width', SERVER_WIDTH)
      .attr('height', SERVER_HEIGHT)
      .attr('x', -SERVER_WIDTH / 2)
      .attr('y', -SERVER_HEIGHT / 2)
      .attr('rx', 14)
      .attr('ry', 14)
      .attr('fill', hostingFill as any)
      .attr('stroke', hostingStroke as any)
      .attr('stroke-width', 2.2)
      .attr('stroke-dasharray', '6 3')
      .style('filter', 'drop-shadow(0px 2px 4px rgba(0,0,0,0.12))');

    node
      .filter((d: any) => d.kind === 'entity')
      .append('rect')
      .attr('class', 'node-shape')
      .attr('width', ENTITY_WIDTH)
      .attr('height', ENTITY_HEIGHT)
      .attr('x', -ENTITY_WIDTH / 2)
      .attr('y', -ENTITY_HEIGHT / 2)
      .attr('rx', ENTITY_HEIGHT / 2)
      .attr('ry', ENTITY_HEIGHT / 2)
      .attr('fill', hostingFill as any)
      .attr('stroke', hostingStroke as any)
      .attr('stroke-width', 1.5);

    node
      .append('text')
      .text((d: any) => d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', '-0.2em')
      .attr('font-size', '13px')
      .attr('font-weight', 600)
      .attr('fill', '#0F172A');

    node
      .append('text')
      .text((d: any) => (d.environment ? d.environment.toUpperCase() : ''))
      .attr('text-anchor', 'middle')
      .attr('dy', '1.0em')
      .attr('font-size', '11px')
      .attr('fill', '#475569');

    const computeLinkGeometry = (d: any) => {
      const sourceNode = d.source;
      const targetNode = d.target;
      const sourceX = sourceNode.x;
      const sourceY = sourceNode.y;
      const targetX = targetNode.x;
      const targetY = targetNode.y;

      const pairSourceId = d.pairSourceId || sourceNode.id;
      const pairTargetId = d.pairTargetId || targetNode.id;
      const pairSourceNode = nodeById.get(pairSourceId) || sourceNode;
      const pairTargetNode = nodeById.get(pairTargetId) || targetNode;

      const dx = pairTargetNode.x - pairSourceNode.x;
      const dy = pairTargetNode.y - pairSourceNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist === 0) {
        return { pathD: 'M0,0L0,0', labelX: sourceX, labelY: sourceY, angleDeg: 0 };
      }

      const nx = -dy / dist;
      const ny = dx / dist;
      const dir = typeof d.parallelDirection === 'number' && d.parallelDirection !== 0 ? d.parallelDirection : 1;
      const index = d.parallelOffsetIndex || 0;
      const offset = dir * ((index + 0.5) * LINK_SPACING);

      const startX = sourceX + nx * offset;
      const startY = sourceY + ny * offset;
      const endX = targetX + nx * offset;
      const endY = targetY + ny * offset;

      const startPt = getBoxIntersection(startX, startY, endX, endY, sourceNode);
      const endPt = getBoxIntersection(endX, endY, startX, startY, targetNode);

      const t = typeof d.labelT === 'number' && d.labelT > 0 && d.labelT < 1 ? d.labelT : 0.5;
      const baseLabelX = startPt.x + (endPt.x - startPt.x) * t;
      const baseLabelY = startPt.y + (endPt.y - startPt.y) * t;
      const labelX = baseLabelX + nx * 0;
      const labelY = baseLabelY + ny * 0;
      let angleDeg = (Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x) * 180) / Math.PI;
      if (angleDeg > 90 || angleDeg < -90) angleDeg += 180;

      return {
        pathD: `M${startPt.x},${startPt.y} L${endPt.x},${endPt.y}`,
        labelX,
        labelY,
        angleDeg,
      };
    };

    const getBoxIntersection = (p1x: number, p1y: number, p2x: number, p2y: number, node: any) => {
      const { w, h } = getNodeBox(node);
      const cx = node.x;
      const cy = node.y;
      const dx = p2x - p1x;
      const dy = p2y - p1y;
      const halfW = w / 2;
      const halfH = h / 2;

      if (Math.abs(dx) < 1e-6) {
        if (p1x < cx - halfW || p1x > cx + halfW) return { x: p1x, y: p1y };
      }
      if (Math.abs(dy) < 1e-6) {
        if (p1y < cy - halfH || p1y > cy + halfH) return { x: p1x, y: p1y };
      }

      const sides = [
        { x: cx - halfW, type: 'v' },
        { x: cx + halfW, type: 'v' },
        { y: cy - halfH, type: 'h' },
        { y: cy + halfH, type: 'h' },
      ];

      let bestT = Infinity;
      for (const side of sides) {
        let t = Infinity;
        if (side.type === 'v' && Math.abs(dx) > 1e-6) {
          t = (side.x! - p1x) / dx;
        }
        if (side.type === 'h' && Math.abs(dy) > 1e-6) {
          t = (side.y! - p1y) / dy;
        }
        if (t > 1e-6 && t < bestT) {
          const ix = p1x + t * dx;
          const iy = p1y + t * dy;
          if (ix >= cx - halfW - 1 && ix <= cx + halfW + 1 && iy >= cy - halfH - 1 && iy <= cy + halfH + 1) {
            bestT = t;
          }
        }
      }

      if (bestT === Infinity) return { x: p1x, y: p1y };
      return { x: p1x + bestT * dx, y: p1y + bestT * dy };
    };

    const updatePositions = () => {
      linksData.forEach((d: any) => {
        (d as any).__geom = computeLinkGeometry(d);
      });
      const pathAccessor = (d: any) => (d as any).__geom.pathD;
      link.attr('d', pathAccessor as any);
      linkHit.attr('d', pathAccessor as any);
      linkLabel.attr('transform', (d: any) => {
        const geom = (d as any).__geom;
        if (!geom) return null;
        const { labelX, labelY, angleDeg } = geom;
        return `translate(${labelX},${labelY}) rotate(${angleDeg})`;
      });
      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);

      // Update cluster membership indicator lines
      membershipLines
        .attr('x1', (d: ClusterMembership) => nodeById.get(d.cluster_id)?.x ?? 0)
        .attr('y1', (d: ClusterMembership) => nodeById.get(d.cluster_id)?.y ?? 0)
        .attr('x2', (d: ClusterMembership) => nodeById.get(d.server_id)?.x ?? 0)
        .attr('y2', (d: ClusterMembership) => nodeById.get(d.server_id)?.y ?? 0);
    };
    updatePositionsRef.current = updatePositions;

    simulation.on('tick', updatePositions);

    function dragstarted(event: any, d: any) {
      if (!event.active && !frozenRef.current) simulation.alphaTarget(0.15).restart();
      d.fx = d.x;
      d.fy = d.y;
    }
    function dragged(event: any, d: any) {
      d.fx = event.x;
      d.fy = event.y;
      if (frozenRef.current) {
        d.x = event.x;
        d.y = event.y;
        updatePositions();
      }
    }
    function dragended(event: any, d: any) {
      if (!event.active && !frozenRef.current) simulation.alphaTarget(0);
      d.fx = null;
      d.fy = null;
    }
  }, [nodes, links, dimensions, clusterMemberships, roleTierEnabled]);

  useEffect(() => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current;
    const svg = d3.select(svgEl);

    svg
      .selectAll('.nodes .node-shape')
      .attr('stroke', (d: any) => {
        const selected = d.id === selectedNodeId;
        const defaultStroke =
          d.kind === 'entity'
            ? '#FB923C'
            : d.kind === 'cluster'
              ? '#0EA5E9'
              : d.hostingCategory === 'cloud'
                ? '#3B82F6'
                : d.hostingCategory === 'on_prem'
                  ? '#16A34A'
                  : '#94A3B8';
        return selected ? theme.palette.primary.main : defaultStroke;
      })
      .attr('stroke-width', (d: any) => (d.id === selectedNodeId ? 3 : d.kind === 'cluster' ? 2.2 : 1.5));

    svg
      .selectAll('.links path.visual')
      .attr('stroke', (d: any) => {
        const isNodeSelected = selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId);
        const isLinkSelected = selectedLinkId && d.id === selectedLinkId;
        return isNodeSelected || isLinkSelected ? '#0F172A' : '#64748B';
      })
      .attr('stroke-width', (d: any) => {
        const isNodeSelected = selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId);
        const isLinkSelected = selectedLinkId && d.id === selectedLinkId;
        return isNodeSelected || isLinkSelected ? 2.2 : 1.5;
      })
      .attr('marker-end', (d: any) => {
        const isNodeSelected = selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId);
        const isLinkSelected = selectedLinkId && d.id === selectedLinkId;
        const marker = isNodeSelected || isLinkSelected ? 'url(#conn-arrow-selected)' : 'url(#conn-arrow)';
        return marker;
      })
      .attr('marker-start', (d: any) => {
        if (d.topology !== 'multi_server') return null;
        const isNodeSelected = selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId);
        const isLinkSelected = selectedLinkId && d.id === selectedLinkId;
        return isNodeSelected || isLinkSelected ? 'url(#conn-arrow-start-selected)' : 'url(#conn-arrow-start)';
      });

    if (!autoCenter) return;
    const zoom = zoomRef.current;
    if (!zoom) return;

    let focusX: number | null = null;
    let focusY: number | null = null;
    if (selectedNodeId) {
      let nodeDatum: any | null = null;
      svg.selectAll<SVGGElement, any>('.nodes g').each((d) => {
        if (d && d.id === selectedNodeId) nodeDatum = d;
      });
      if (nodeDatum && typeof nodeDatum.x === 'number' && typeof nodeDatum.y === 'number') {
        focusX = nodeDatum.x;
        focusY = nodeDatum.y;
      }
    } else if (selectedLinkId) {
      const labelEls = svgEl.querySelectorAll('.link-labels text');
      for (let i = 0; i < labelEls.length; i += 1) {
        const el = labelEls[i] as SVGGraphicsElement;
        const datum: any = (el as any).__data__;
        if (datum && datum.id === selectedLinkId && datum.__geom) {
          focusX = datum.__geom.labelX;
          focusY = datum.__geom.labelY;
          break;
        }
      }
    }

    if (focusX == null || focusY == null) return;
    svg.transition().duration(300).call((zoom as any).translateTo, focusX, focusY);
  }, [selectedNodeId, selectedLinkId, autoCenter, theme]);

  const handleBgClick = () => {
    if (onClearSelection) {
      onClearSelection();
      return;
    }
    if (onSelectNode) onSelectNode(null);
    if (onSelectLink) onSelectLink(null);
  };

  return (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        bgcolor: '#F8FAFC',
        overflow: 'hidden',
        border: '1px solid #E2E8F0',
        borderRadius: 2,
      }}
      onClick={handleBgClick}
    >
      <svg ref={svgRef} width="100%" height="100%" style={{ display: 'block' }} />
    </Box>
  );
}
