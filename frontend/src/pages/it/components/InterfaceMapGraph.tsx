import React, { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import { Box, useTheme } from '@mui/material';

import { useTranslation } from 'react-i18next';
// --- Types ---

export type MapGraphNode = {
  id: string;
  name: string;
  lifecycle: string;
  criticality: string;
  externalFacing: boolean;
  isMiddleware: boolean;
  totalInterfaces: number;
  inDegree: number;
  outDegree: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
};

export type MapGraphLink = {
  id: string;
  interfaceDbId: string;
  interfaceReference?: string | null;
  interfaceId: string;
  source: string | MapGraphNode;
  target: string | MapGraphNode;
  lifecycle: string;
  criticality: string;
  containsPii: boolean;
  hasMiddleware: boolean;
  integrationRouteType: string;
  bindingsCount: number;
  // Layout properties
  parallelIndex?: number;
  parallelTotal?: number;
  parallelOffsetIndex?: number;
  parallelDirection?: number;
  pairSourceId?: string;
  pairTargetId?: string;
  labelT?: number;
};

export type GraphControlsApi = {
  zoomIn: () => void;
  zoomOut: () => void;
  snapToGrid: (gridSize?: number) => void;
  exportSvg: () => void;
  exportPng: () => void;
};

type Props = {
  nodes: MapGraphNode[];
  links: MapGraphLink[];
  selectedNodeId?: string | null;
  selectedLinkId?: string | null;
  frozen?: boolean;
  autoCenter?: boolean;
  onSelectNode?: (nodeId: string | null) => void;
  onSelectLink?: (linkId: string | null) => void;
  onClearSelection?: () => void;
  onRegisterZoomControls?: (api: { zoomIn: () => void; zoomOut: () => void }) => void;
  onRegisterGraphControls?: (api: GraphControlsApi) => void;
};

// --- Constants ---

const NODE_WIDTH = 160;
const NODE_HEIGHT = 50;
const MW_SIZE = 40;
const LINK_SPACING = 10; // Space between parallel lines
const LABEL_OFFSET = 0; // Distance from line to label (0 = embedded in line)

// --- Component ---

export default function InterfaceMapGraph({
  nodes,
  links,
  selectedNodeId,
  selectedLinkId,
  frozen = false,
  autoCenter = true,
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

  // Resize observer
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

  // Freeze / unfreeze simulation without rebuilding it
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

  // D3 Simulation + Zoom
  useEffect(() => {
    if (!svgRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const width = dimensions.width;
    const height = dimensions.height;

    // --- Data Preparation ---
    const nodesData: any[] = nodes.map(n => ({ ...n }));
    const linksData = links.map(l => ({ ...l }));
    nodesDataRef.current = nodesData;

    const nodeById = new Map<string, any>();
    nodesData.forEach((n) => {
      nodeById.set(n.id, n);
    });

    // --- Middleware sizing based on connectivity ---
    nodesData.forEach((n) => {
      if (n.isMiddleware) {
        const total = n.totalInterfaces || 0;
        const size = MW_SIZE + Math.min(40, total * 2); // cap growth
        n.mwSize = size;
      }
    });

    // --- Parallel Edge Processing ---
    // Group links by undirected source-target pair, and within each group
    // split into two "lanes": canonical (min-id -> max-id) and reverse.
    const linkGroups = new Map<string, any[]>();
    linksData.forEach(link => {
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

    // Assign offset indices per direction within each group
    linkGroups.forEach((group) => {
      const forward: any[] = [];
      const reverse: any[] = [];

      group.forEach((link) => {
        const sourceId = typeof link.source === 'object' ? (link.source as any).id : link.source;
        const isForward = sourceId === (link as any).pairSourceId;
        if (isForward) {
          forward.push(link);
        } else {
          reverse.push(link);
        }
      });

      const forwardCount = forward.length;
      const reverseCount = reverse.length;

      forward.forEach((link, index) => {
        (link as any).parallelOffsetIndex = index;
        (link as any).parallelDirection = 1;
        // Distribute labels along the lane: 0 < t < 1
        (link as any).labelT = forwardCount > 0 ? (index + 1) / (forwardCount + 1) : 0.5;
      });

      reverse.forEach((link, index) => {
        (link as any).parallelOffsetIndex = index;
        (link as any).parallelDirection = -1;
        (link as any).labelT = reverseCount > 0 ? (index + 1) / (reverseCount + 1) : 0.5;
      });
    });

    // --- Simulation Setup ---
    const simulation = d3.forceSimulation(nodesData)
      .force('link', d3.forceLink(linksData).id((d: any) => d.id).distance(200)) // Increased distance for parallel lines
      .force('charge', d3.forceManyBody().strength(-800))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collide', d3.forceCollide().radius((d: any) => (d.isMiddleware ? (d.mwSize || MW_SIZE) : NODE_WIDTH)));
    simulationRef.current = simulation;

    // --- SVG Structure ---
    const defs = svg.append('defs');

    // Arrowheads
    const createArrow = (id: string, color: string) => {
      defs.append('marker')
        .attr('id', id)
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 8) // Slightly offset to not touch the line end exactly
        .attr('refY', 0)
        .attr('markerWidth', 6)
        .attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', color);
    };

    createArrow('arrow-normal', '#64748B');
    createArrow('arrow-selected', '#0F172A');

    const g = svg.append('g');

    // --- Zoom Behavior ---
    const zoomed = (event: any) => {
      g.attr('transform', event.transform);
    };

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', zoomed);

    svg.call(zoom as any);
    zoomRef.current = zoom;

    if (onRegisterZoomControls) {
      onRegisterZoomControls({
        zoomIn: () => {
          svg.transition().duration(200).call(zoom.scaleBy as any, 1.2);
        },
        zoomOut: () => {
          svg.transition().duration(200).call(zoom.scaleBy as any, 0.8);
        },
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
            if (n.fx != null) n.fx = n.x;
            if (n.fy != null) n.fy = n.y;
          });
          updatePositionsRef.current?.();
        },
        exportSvg: () => {
          if (!svgRef.current) return;
          const svgEl = svgRef.current;
          const w = svgEl.clientWidth;
          const h = svgEl.clientHeight;

          const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
          clonedSvg.setAttribute('width', String(w));
          clonedSvg.setAttribute('height', String(h));
          clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          clonedSvg.setAttribute('viewBox', `0 0 ${w} ${h}`);
          clonedSvg.querySelectorAll('path.hit').forEach((el) => el.remove());

          const serializer = new XMLSerializer();
          const svgString = serializer.serializeToString(clonedSvg);
          const blob = new Blob([svgString], { type: 'image/svg+xml' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = 'interface-map.svg';
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

          const t = d3.zoomTransform(svgEl);
          let minX = Infinity;
          let maxX = -Infinity;
          let minY = Infinity;
          let maxY = -Infinity;

          nodesDataRef.current.forEach((n) => {
            const size = n.isMiddleware ? (n.mwSize || MW_SIZE) : NODE_WIDTH;
            const height = n.isMiddleware ? (n.mwSize || MW_SIZE) : NODE_HEIGHT;
            minX = Math.min(minX, n.x - size / 2);
            maxX = Math.max(maxX, n.x + size / 2);
            minY = Math.min(minY, n.y - height / 2);
            maxY = Math.max(maxY, n.y + height / 2);
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

          const deviceScale = Math.max(1, Math.ceil(window.devicePixelRatio || 1));
          const exportWidth = Math.round(worldWidth * t.k);
          const exportHeight = Math.round(worldHeight * t.k);

          const clonedSvg = svgEl.cloneNode(true) as SVGSVGElement;
          clonedSvg.setAttribute('width', String(exportWidth));
          clonedSvg.setAttribute('height', String(exportHeight));
          clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
          clonedSvg.setAttribute('viewBox', `${minX} ${minY} ${worldWidth} ${worldHeight}`);
          clonedSvg.style.width = `${exportWidth}px`;
          clonedSvg.style.height = `${exportHeight}px`;

          // Remove hit areas
          clonedSvg.querySelectorAll('path.hit').forEach((el) => el.remove());
          // Remove drop-shadow filters
          clonedSvg.querySelectorAll('[style*="drop-shadow"]').forEach((el) => {
            (el as HTMLElement).style.filter = 'none';
          });
          // Remove defs and markers
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

          // Add background rect so edges anti-alias against the intended color
          const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          bgRect.setAttribute('x', String(minX));
          bgRect.setAttribute('y', String(minY));
          bgRect.setAttribute('width', String(worldWidth));
          bgRect.setAttribute('height', String(worldHeight));
          bgRect.setAttribute('fill', '#F8FAFC');
          clonedSvg.insertBefore(bgRect, clonedSvg.firstChild);

          const serializer = new XMLSerializer();
          const svgString = serializer.serializeToString(clonedSvg);

          const canvasScale = deviceScale;
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
                link.download = 'interface-map.png';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
              } else {
                const pngUrl = canvas.toDataURL('image/png');
                const link = document.createElement('a');
                link.href = pngUrl;
                link.download = 'interface-map.png';
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

    // --- Links ---
    const linkGroup = g.append('g').attr('class', 'links');

    const link = linkGroup
      .selectAll('path.visual')
      .data(linksData)
      .enter().append('path')
      .attr('class', 'visual')
      .attr('stroke', '#64748B')
      .attr('stroke-width', 1.5)
      .attr('fill', 'none')
      .attr('marker-end', 'url(#arrow-normal)')
      .style('pointer-events', 'none');

    const linkHit = linkGroup
      .selectAll('path.hit')
      .data(linksData)
      .enter().append('path')
      .attr('class', 'hit')
      .attr('stroke', 'transparent')
      .attr('stroke-width', 10)
      .attr('fill', 'none')
      .style('pointer-events', 'stroke')
      .on('click', (event, d: any) => {
        event.stopPropagation();
        if (onSelectLink) onSelectLink(d.id);
      });

    // --- Link Labels ---
    const linkLabel = g.append('g')
      .attr('class', 'link-labels')
      .selectAll('text')
      .data(linksData)
      .enter().append('text')
      .text((d: any) => d.interfaceId)
      .attr('font-size', '10px')
      .attr('fill', '#0F172A')
      .attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'middle')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#F8FAFC')
      .attr('stroke-width', 3)
      .style('pointer-events', 'none');

    // --- Nodes ---
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll('g')
      .data(nodesData)
      .enter().append('g')
      .attr('data-node-id', (d: any) => d.id)
      .call(d3.drag<any, any>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended)
      )
      .on('click', (event, d) => {
        if (onSelectNode) onSelectNode(d.id);
        event.stopPropagation();
      });

    // App Nodes
    node.filter((d: any) => !d.isMiddleware)
      .append('rect')
      .attr('width', NODE_WIDTH)
      .attr('height', NODE_HEIGHT)
      .attr('x', -NODE_WIDTH / 2)
      .attr('y', -NODE_HEIGHT / 2)
      .attr('rx', 8)
      .attr('ry', 8)
      .attr('fill', '#FFFFFF')
      .attr('stroke', '#94A3B8')
      .attr('stroke-width', 1)
      .style('filter', 'drop-shadow(0px 2px 4px rgba(0,0,0,0.1))');

    // Middleware Nodes
    node.filter((d: any) => d.isMiddleware)
      .append('rect')
      .attr('width', (d: any) => d.mwSize || MW_SIZE)
      .attr('height', (d: any) => d.mwSize || MW_SIZE)
      .attr('x', (d: any) => -((d.mwSize || MW_SIZE) / 2))
      .attr('y', (d: any) => -((d.mwSize || MW_SIZE) / 2))
      .attr('transform', 'rotate(45)')
      .attr('fill', '#F0FDF4')
      .attr('stroke', '#16A34A')
      .attr('stroke-width', 2);

    // Labels
    node.append('text')
      .text((d: any) => d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', (d: any) => d.isMiddleware ? '0.3em' : '-0.2em')
      .attr('font-size', (d: any) => d.isMiddleware ? '10px' : '14px')
      .attr('font-weight', 'bold')
      .attr('fill', (d: any) => d.isMiddleware ? '#14532D' : '#0F172A');

    node.filter((d: any) => !d.isMiddleware)
      .append('text')
      .text((d: any) => t('it:pages.maps.interfaceCount', { count: d.totalInterfaces }))
      .attr('text-anchor', 'middle')
      .attr('dy', '1.2em')
      .attr('font-size', '12px')
      .attr('fill', '#64748B');

    const computeLinkGeometry = (d: any) => {
      const sourceNode = d.source;
      const targetNode = d.target;

      const sourceX = sourceNode.x;
      const sourceY = sourceNode.y;
      const targetX = targetNode.x;
      const targetY = targetNode.y;

      // Canonical pair direction (min-id -> max-id)
      const pairSourceId = d.pairSourceId || sourceNode.id;
      const pairTargetId = d.pairTargetId || targetNode.id;
      const pairSourceNode = nodeById.get(pairSourceId) || sourceNode;
      const pairTargetNode = nodeById.get(pairTargetId) || targetNode;

      const dx = pairTargetNode.x - pairSourceNode.x;
      const dy = pairTargetNode.y - pairSourceNode.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist === 0) {
        return {
          pathD: 'M0,0L0,0',
          midX: sourceX,
          midY: sourceY,
          nx: 0,
          ny: 0,
        };
      }

      // Normal vector (rotated 90 deg) based on canonical direction
      const nx = -dy / dist;
      const ny = dx / dist;

      // Calculate offset: stack links for each direction on
      // their own side of the center line.
      const dir = typeof d.parallelDirection === 'number' && d.parallelDirection !== 0 ? d.parallelDirection : 1;
      const index = d.parallelOffsetIndex || 0;
      const offset = dir * ((index + 0.5) * LINK_SPACING);

      // Shifted line segment (infinite line) based on the actual
      // source/target but using the canonical normal.
      const startX = sourceX + nx * offset;
      const startY = sourceY + ny * offset;
      const endX = targetX + nx * offset;
      const endY = targetY + ny * offset;

      // Intersect with Source Node
      const startPt = getBoxIntersection(startX, startY, endX, endY, sourceNode);
      // Intersect with Target Node
      const endPt = getBoxIntersection(endX, endY, startX, startY, targetNode);

      const midX = (startPt.x + endPt.x) / 2;
      const midY = (startPt.y + endPt.y) / 2;

      // Label position along the segment (0..1), lane-aware
      const t = typeof d.labelT === 'number' && d.labelT > 0 && d.labelT < 1 ? d.labelT : 0.5;
      const baseLabelX = startPt.x + (endPt.x - startPt.x) * t;
      const baseLabelY = startPt.y + (endPt.y - startPt.y) * t;
      const labelX = baseLabelX + nx * LABEL_OFFSET;
      const labelY = baseLabelY + ny * LABEL_OFFSET;

      // Text angle parallel to the link segment
      const angleRad = Math.atan2(endPt.y - startPt.y, endPt.x - startPt.x);
      let angleDeg = (angleRad * 180) / Math.PI;
      if (angleDeg > 90 || angleDeg < -90) {
        angleDeg += 180;
      }

      return {
        pathD: `M${startPt.x},${startPt.y} L${endPt.x},${endPt.y}`,
        midX,
        midY,
        nx,
        ny,
        labelX,
        labelY,
        angleDeg,
      };
    };

    const updatePositions = () => {
      // Pre-compute geometry for links
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
    };
    updatePositionsRef.current = updatePositions;

    // --- Simulation Tick ---
    simulation.on('tick', updatePositions);

    // --- Helper: Ray-Box Intersection ---
    function getBoxIntersection(p1x: number, p1y: number, p2x: number, p2y: number, node: any) {
      const mwSize = node.mwSize || MW_SIZE;
      const w = node.isMiddleware ? mwSize * 1.414 : NODE_WIDTH;
      const h = node.isMiddleware ? mwSize * 1.414 : NODE_HEIGHT;
      const cx = node.x;
      const cy = node.y;

      const dx = p2x - p1x;
      const dy = p2y - p1y;

      const halfW = w / 2;
      const halfH = h / 2;

      // Check X slabs
      if (Math.abs(dx) < 1e-6) {
        if (p1x < cx - halfW || p1x > cx + halfW) return { x: p1x, y: p1y };
      }

      // Check Y slabs
      if (Math.abs(dy) < 1e-6) {
        if (p1y < cy - halfH || p1y > cy + halfH) return { x: p1x, y: p1y };
      }

      const sides = [
        { x: cx - halfW, type: 'v' }, // Left
        { x: cx + halfW, type: 'v' }, // Right
        { y: cy - halfH, type: 'h' }, // Top
        { y: cy + halfH, type: 'h' }, // Bottom
      ];

      let bestT = Infinity;

      for (const side of sides) {
        let t = Infinity;
        if (side.type === 'v') {
          if (Math.abs(dx) > 1e-6) {
            t = (side.x! - p1x) / dx;
          }
        } else {
          if (Math.abs(dy) > 1e-6) {
            t = (side.y! - p1y) / dy;
          }
        }

        if (t > 1e-6 && t < bestT) {
          const ix = p1x + t * dx;
          const iy = p1y + t * dy;
          if (
            ix >= cx - halfW - 1 && ix <= cx + halfW + 1 &&
            iy >= cy - halfH - 1 && iy <= cy + halfH + 1
          ) {
            bestT = t;
          }
        }
      }

      if (bestT === Infinity) return { x: p1x, y: p1y };

      return {
        x: p1x + bestT * dx,
        y: p1y + bestT * dy
      };
    }

    // --- Drag Handlers ---
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
  }, [nodes, links, dimensions, t]);

  // Selection Effect + optional auto-center
  useEffect(() => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current;
    const svg = d3.select(svgEl);

    svg.selectAll('.nodes rect')
      .attr('stroke', (d: any) => {
        const isSelected = d.id === selectedNodeId;
        if (d.isMiddleware) return isSelected ? '#14532D' : '#16A34A';
        return isSelected ? theme.palette.primary.main : '#94A3B8';
      })
      .attr('stroke-width', (d: any) => d.id === selectedNodeId ? 3 : (d.isMiddleware ? 2 : 1));

    svg.selectAll('.links path.visual')
      .attr('stroke', (d: any) => {
        const isNodeSelected = selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId);
        const isLinkSelected = selectedLinkId && d.id === selectedLinkId;
        return (isNodeSelected || isLinkSelected) ? '#0F172A' : '#64748B';
      })
      .attr('stroke-width', (d: any) => {
        const isNodeSelected = selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId);
        const isLinkSelected = selectedLinkId && d.id === selectedLinkId;
        return (isNodeSelected || isLinkSelected) ? 2 : 1.5;
      })
      .attr('marker-end', (d: any) => {
        const isNodeSelected = selectedNodeId && (d.source.id === selectedNodeId || d.target.id === selectedNodeId);
        const isLinkSelected = selectedLinkId && d.id === selectedLinkId;
        return (isNodeSelected || isLinkSelected) ? 'url(#arrow-selected)' : 'url(#arrow-normal)';
      });

    if (!autoCenter) return;

    const zoom = zoomRef.current;
    if (!zoom) return;

    let focusX: number | null = null;
    let focusY: number | null = null;

    if (selectedNodeId) {
      // Use simulation coordinates from the bound datum rather than DOM geometry
      let nodeDatum: any | null = null;
      svg.selectAll<SVGGElement, any>('.nodes g')
        .each((d) => {
          if (d && d.id === selectedNodeId) {
            nodeDatum = d;
          }
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
        borderRadius: 2
      }}
      onClick={handleBgClick}
    >
      <svg
        ref={svgRef}
        width="100%"
        height="100%"
        style={{ display: 'block' }}
      />
    </Box>
  );
}
