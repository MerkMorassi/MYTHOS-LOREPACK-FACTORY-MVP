import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import * as d3 from 'd3';
import { CanonicalAgent } from '../agents.ts';
import { IndexedDbLorepackStore } from '../indexeddb-store.ts';
import { LorepackFactory } from '../lorepack-factory.ts';
import { VectorRecord, TripletEdge } from '../types.ts';
import { 
  Share2, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Search, 
  Activity, 
  RefreshCw,
  Info,
  Maximize2,
  Crosshair,
  Play,
  Pause,
  ArrowRight,
  Layers,
  Download,
  Check
} from 'lucide-react';

interface NetworkGraphViewProps {
  agents: readonly CanonicalAgent[];
  activeAgentId?: string;
  store: IndexedDbLorepackStore | null;
  factory: LorepackFactory | null;
}

export interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'entity' | 'chunk' | 'source';
  group?: number;
  val?: number;
  text?: string;
  source?: string;
  degree?: number;
  clusterId?: number;
  clusterColor?: string;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id?: string;
  source: string | SimNode;
  target: string | SimNode;
  label?: string;
  type?: 'relation' | 'contains' | 'source';
}

const CLUSTER_PALETTE = [
  '#38bdf8', // Sky
  '#a855f7', // Purple
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#6366f1', // Indigo
  '#14b8a6', // Teal
  '#f43f5e', // Rose
  '#84cc16', // Lime
  '#06b6d4', // Cyan
];

export const NetworkGraphView: React.FC<NetworkGraphViewProps> = ({ 
  agents, 
  activeAgentId: initialAgentId,
  store,
}) => {
  const [selectedAgentId, setSelectedAgentId] = useState<string>(
    initialAgentId || (agents.length > 0 ? agents[0].id : 'AGENT_LIFECYCLE')
  );
  
  const [vectors, setVectors] = useState<VectorRecord[]>([]);
  const [tripletEdges, setTripletEdges] = useState<TripletEdge[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [graphMode, setGraphMode] = useState<'triplets' | 'mesh'>('triplets');
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [selectedNode, setSelectedNode] = useState<SimNode | null>(null);
  const [selectedLink, setSelectedLink] = useState<SimLink | null>(null);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [hoveredLink, setHoveredLink] = useState<SimLink | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);
  const [isPhysicsRunning, setIsPhysicsRunning] = useState<boolean>(true);
  const [autoCluster, setAutoCluster] = useState<boolean>(false);
  const [springMode, setSpringMode] = useState<'elastic' | 'pin'>('elastic');
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [exportNotification, setExportNotification] = useState<string | null>(null);
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null);
  const [clusterSummary, setClusterSummary] = useState<{
    id: number;
    color: string;
    count: number;
    sampleLabel: string;
    nodeIds: string[];
  }[]>([]);
  
  const springModeRef = useRef<'elastic' | 'pin'>('elastic');
  springModeRef.current = springMode;
  const activeSpringRef = useRef<{
    sourceX: number;
    sourceY: number;
    targetX: number;
    targetY: number;
    tension: number;
    node: SimNode;
  } | null>(null);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);

  // Matching node count for active search query
  const matchingNodeCount = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return 0;
    return nodesRef.current.filter((n) =>
      (n.label && n.label.toLowerCase().includes(q)) ||
      (n.text && n.text.toLowerCase().includes(q)) ||
      (n.source && n.source.toLowerCase().includes(q)) ||
      (n.id && n.id.toLowerCase().includes(q))
    ).length;
  }, [searchTerm, vectors, tripletEdges]);

  // Sync selected agent if external activeAgentId prop changes
  useEffect(() => {
    if (initialAgentId && initialAgentId !== selectedAgentId) {
      setSelectedAgentId(initialAgentId);
    }
  }, [initialAgentId]);

  const loadGraphData = useCallback(async (agentId: string) => {
    if (!store) return;
    setLoading(true);
    try {
      const v = await store.getVectorsByAgent(agentId);
      const e = await store.getTripletEdgesByAgent(agentId);
      setVectors(v);
      setTripletEdges(e);
      setSelectedNode(null);
      setSelectedLink(null);
    } catch (err) {
      console.error("Failed to load network graph data:", err);
    } finally {
      setLoading(false);
    }
  }, [store]);

  useEffect(() => {
    if (selectedAgentId && store) {
      loadGraphData(selectedAgentId);
    }
  }, [selectedAgentId, store, loadGraphData]);

  // Main D3 force simulation setup
  useEffect(() => {
    if (loading || !svgRef.current || !wrapperRef.current) return;

    const width = wrapperRef.current.clientWidth || 900;
    const height = wrapperRef.current.clientHeight || 650;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Build raw nodes and links based on selected graph mode
    const nodeMap = new Map<string, SimNode>();
    const links: SimLink[] = [];
    const vectorById = new Map<string, VectorRecord>();
    vectors.forEach((v) => vectorById.set(v.id, v));

    if (graphMode === 'triplets' && tripletEdges.length > 0) {
      for (const edge of tripletEdges) {
        const sId = (edge.s || 'UNKNOWN').trim();
        const oId = (edge.o || 'UNKNOWN').trim();
        const srcVector = edge.sourceId ? vectorById.get(edge.sourceId) : undefined;
        const matchingDoc = srcVector?.source;
        const matchingText = srcVector?.text;

        if (!nodeMap.has(sId)) {
          nodeMap.set(sId, {
            id: sId,
            label: sId,
            type: 'entity',
            group: 1,
            val: 1,
            degree: 1,
            text: matchingText || `Semantic Subject Entity: "${sId}"\nPredicate: ${edge.r}\nTarget: ${oId}`,
            source: matchingDoc,
          });
        } else {
          const n = nodeMap.get(sId)!;
          n.val = (n.val || 1) + 1;
          n.degree = (n.degree || 0) + 1;
          if ((!n.text || n.text.startsWith('Semantic Subject Entity')) && matchingText) {
            n.text = matchingText;
            n.source = matchingDoc;
          }
        }

        if (!nodeMap.has(oId)) {
          nodeMap.set(oId, {
            id: oId,
            label: oId,
            type: 'entity',
            group: 2,
            val: 1,
            degree: 1,
            text: matchingText || `Semantic Object Entity: "${oId}"\nSubject: ${sId}\nPredicate: ${edge.r}`,
            source: matchingDoc,
          });
        } else {
          const n = nodeMap.get(oId)!;
          n.val = (n.val || 1) + 1;
          n.degree = (n.degree || 0) + 1;
          if ((!n.text || n.text.startsWith('Semantic Object Entity')) && matchingText) {
            n.text = matchingText;
            n.source = matchingDoc;
          }
        }

        links.push({
          id: edge.id,
          source: sId,
          target: oId,
          label: edge.r || 'relates_to',
          type: 'relation'
        });
      }
    } else {
      // Mesh mode: include vectors and source groups + triplet edges
      for (const vec of vectors.slice(0, 150)) {
        const vId = vec.id;
        const shortText = vec.text.slice(0, 32) + '...';
        nodeMap.set(vId, {
          id: vId,
          label: shortText,
          type: 'chunk',
          group: 3,
          val: 1,
          degree: 1,
          text: vec.text,
          source: vec.source
        });

        if (vec.source) {
          const srcId = `src:${vec.source}`;
          if (!nodeMap.has(srcId)) {
            nodeMap.set(srcId, {
              id: srcId,
              label: vec.source,
              type: 'source',
              group: 4,
              val: 2,
              degree: 1,
              text: `Origin Lorepack Source Document: ${vec.source}\nDirect ingestion source file committed to the agent vault with linked vector chunks.`,
              source: vec.source
            });
          } else {
            const n = nodeMap.get(srcId)!;
            n.degree = (n.degree || 0) + 1;
          }
          links.push({
            source: vId,
            target: srcId,
            type: 'source'
          });
        }
      }

      for (const edge of tripletEdges.slice(0, 80)) {
        const sId = (edge.s || 'UNKNOWN').trim();
        const oId = (edge.o || 'UNKNOWN').trim();
        const srcVector = edge.sourceId ? vectorById.get(edge.sourceId) : undefined;
        if (!nodeMap.has(sId)) {
          nodeMap.set(sId, {
            id: sId,
            label: sId,
            type: 'entity',
            group: 1,
            val: 1,
            degree: 1,
            text: srcVector?.text || `Semantic Entity: "${sId}"`,
            source: srcVector?.source
          });
        }
        if (!nodeMap.has(oId)) {
          nodeMap.set(oId, {
            id: oId,
            label: oId,
            type: 'entity',
            group: 2,
            val: 1,
            degree: 1,
            text: srcVector?.text || `Semantic Target Entity: "${oId}"`,
            source: srcVector?.source
          });
        }
        links.push({
          id: edge.id,
          source: sId,
          target: oId,
          label: edge.r || 'relates_to',
          type: 'relation'
        });
      }
    }

    const nodes = Array.from(nodeMap.values());

    // Retain previous coordinates to ensure smooth animated transition during cluster toggling
    const prevPositions = new Map<string, { x?: number; y?: number; vx?: number; vy?: number }>();
    nodesRef.current.forEach((n) => {
      if (n.x != null && n.y != null) {
        prevPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
      }
    });

    nodes.forEach((n) => {
      const prev = prevPositions.get(n.id);
      if (prev && prev.x != null && prev.y != null) {
        n.x = prev.x;
        n.y = prev.y;
        n.vx = prev.vx;
        n.vy = prev.vy;
      }
    });

    nodesRef.current = nodes;
    linksRef.current = links;

    if (nodes.length === 0) {
      svg.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#737373')
        .attr('font-family', 'monospace')
        .attr('font-size', '13px')
        .text('No semantic nodes or edges found for this agent. Ingest lore or build graph first.');
      return;
    }

    // --- COMMUNITY CLUSTERING (GROUP BY SHARED SEMANTIC EDGES) ---
    const adjacency = new Map<string, Set<string>>();
    nodes.forEach((n) => adjacency.set(n.id, new Set()));
    links.forEach((l) => {
      const sId = typeof l.source === 'object' ? (l.source as any).id : String(l.source);
      const tId = typeof l.target === 'object' ? (l.target as any).id : String(l.target);
      if (adjacency.has(sId) && adjacency.has(tId)) {
        adjacency.get(sId)!.add(tId);
        adjacency.get(tId)!.add(sId);
      }
    });

    const visited = new Set<string>();
    const rawClusters: { id: number; nodeIds: string[] }[] = [];
    let cid = 0;

    nodes.forEach((n) => {
      if (!visited.has(n.id)) {
        const queue = [n.id];
        const comp: string[] = [];
        visited.add(n.id);
        while (queue.length > 0) {
          const curr = queue.shift()!;
          comp.push(curr);
          const neighbors = adjacency.get(curr);
          if (neighbors) {
            neighbors.forEach((nbr) => {
              if (!visited.has(nbr)) {
                visited.add(nbr);
                queue.push(nbr);
              }
            });
          }
        }
        rawClusters.push({ id: cid++, nodeIds: comp });
      }
    });

    // Sort clusters by size descending
    rawClusters.sort((a, b) => b.nodeIds.length - a.nodeIds.length);
    rawClusters.forEach((c, index) => {
      c.id = index;
    });

    // Map each node to its semantic cluster ID and palette color
    const clusterColorMap = new Map<string, { id: number; color: string }>();
    rawClusters.forEach((c) => {
      const color = CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length];
      c.nodeIds.forEach((nid) => {
        clusterColorMap.set(nid, { id: c.id, color });
      });
    });

    nodes.forEach((n) => {
      const cInfo = clusterColorMap.get(n.id);
      if (cInfo) {
        n.clusterId = cInfo.id;
        n.clusterColor = cInfo.color;
      }
    });

    // Precompute radial target anchor positions for Auto-Cluster distribution
    const clusterCenters = new Map<number, { x: number; y: number }>();
    const numClusters = rawClusters.length;
    const radialRadius = Math.min(width, height) * 0.32;
    rawClusters.forEach((c, idx) => {
      if (numClusters <= 1) {
        clusterCenters.set(c.id, { x: width / 2, y: height / 2 });
      } else {
        const angle = (idx / numClusters) * 2 * Math.PI - Math.PI / 2;
        clusterCenters.set(c.id, {
          x: width / 2 + radialRadius * Math.cos(angle),
          y: height / 2 + radialRadius * Math.sin(angle)
        });
      }
    });

    // Populate cluster summaries for the inspector sidebar
    const summaries = rawClusters.map((c) => {
      const sample = nodes.find((n) => n.id === c.nodeIds[0]);
      return {
        id: c.id,
        color: CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length],
        count: c.nodeIds.length,
        sampleLabel: sample ? sample.label : `Cluster #${c.id + 1}`,
        nodeIds: c.nodeIds,
      };
    });
    setClusterSummary(summaries);

    // Definitions (Glow Filters, Gradients, Arrowhead Markers)
    const defs = svg.append('defs');

    // Directional Arrow Markers
    defs.append('marker')
      .attr('id', 'arrow-default')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 24)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#525252');

    defs.append('marker')
      .attr('id', 'arrow-highlight')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 26)
      .attr('refY', 0)
      .attr('markerWidth', 7)
      .attr('markerHeight', 7)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#38bdf8');

    // Canvas background grid pattern
    const pattern = defs.append('pattern')
      .attr('id', 'grid-pattern')
      .attr('width', 40)
      .attr('height', 40)
      .attr('patternUnits', 'userSpaceOnUse');

    pattern.append('path')
      .attr('d', 'M 40 0 L 0 0 0 40')
      .attr('fill', 'none')
      .attr('stroke', '#171717')
      .attr('stroke-width', '0.5');

    // Main Zoomable Group
    const g = svg.append('g').attr('class', 'graph-viewport');

    // Background rect to capture zoom and clear selections
    g.append('rect')
      .attr('x', -width * 4)
      .attr('y', -height * 4)
      .attr('width', width * 8)
      .attr('height', height * 8)
      .attr('fill', 'url(#grid-pattern)')
      .on('click', () => {
        setSelectedNode(null);
        setSelectedLink(null);
      });

    // Zoom Behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.05, 8])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    svg.call(zoom.transform, transformRef.current);

    // Force Simulation
    const linkForce = d3.forceLink<SimNode, SimLink>(links)
      .id((d) => d.id)
      .distance((d) => {
        if (autoCluster) {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          if (s.clusterId !== undefined && s.clusterId === t.clusterId) {
            return 60; // Tightly bound within semantic cluster
          }
          return 180; // Inter-cluster repulsion
        }
        return d.type === 'relation' ? 120 : 80;
      })
      .strength((d) => {
        if (autoCluster) {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          if (s.clusterId !== undefined && s.clusterId === t.clusterId) {
            return 0.85;
          }
          return 0.15;
        }
        return 0.5;
      });

    const simulation = d3.forceSimulation<SimNode, SimLink>(nodes)
      .force('link', linkForce)
      .force('charge', d3.forceManyBody().strength(autoCluster ? -190 : -280))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide<SimNode>().radius((d) => {
        const base = d.type === 'entity' ? Math.min(10 + (d.val || 1) * 2.5, 26) : 14;
        return base + (autoCluster ? 8 : 12);
      }))
      .force('x', d3.forceX(width / 2).strength(autoCluster ? 0.02 : 0.04))
      .force('y', d3.forceY(height / 2).strength(autoCluster ? 0.02 : 0.04));

    if (autoCluster) {
      simulation
        .force(
          'clusterX',
          d3.forceX<SimNode>((d) => clusterCenters.get(d.clusterId ?? 0)?.x ?? width / 2).strength(0.38)
        )
        .force(
          'clusterY',
          d3.forceY<SimNode>((d) => clusterCenters.get(d.clusterId ?? 0)?.y ?? height / 2).strength(0.38)
        );
    }

    simulationRef.current = simulation;
    setIsPhysicsRunning(true);

    // Layers inside viewport
    const hullsGroup = g.append('g').attr('class', 'hulls-layer');
    const clusterLabelsGroup = g.append('g').attr('class', 'cluster-labels-layer');
    const springTetherGroup = g.append('g').attr('class', 'spring-tether-layer');
    const linksGroup = g.append('g').attr('class', 'links-layer');
    const linkLabelsGroup = g.append('g').attr('class', 'link-labels-layer');
    const nodesGroup = g.append('g').attr('class', 'nodes-layer');

    // Draw Links
    const link = linksGroup
      .selectAll<SVGLineElement, SimLink>('line')
      .data(links)
      .enter()
      .append('line')
      .attr('class', 'graph-link')
      .attr('stroke', '#404040')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d) => (d.type === 'relation' ? 1.5 : 1))
      .attr('marker-end', (d) => (d.type === 'relation' ? 'url(#arrow-default)' : null))
      .style('cursor', 'pointer')
      .on('mouseenter', (event, d) => {
        setHoveredLink(d);
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltipPos({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12 });
        }
      })
      .on('mousemove', (event) => {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          setTooltipPos({ x: event.clientX - rect.left + 12, y: event.clientY - rect.top + 12 });
        }
      })
      .on('mouseleave', () => {
        setHoveredLink(null);
        setTooltipPos(null);
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedLink(d);
        setSelectedNode(null);
      });

    // Draw Link Labels (Predicate badges)
    const linkLabel = linkLabelsGroup
      .selectAll<SVGGElement, SimLink>('g')
      .data(links.filter((d) => !!d.label))
      .enter()
      .append('g')
      .attr('class', 'graph-link-label')
      .style('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedLink(d);
        setSelectedNode(null);
      });

    // Label background pill
    linkLabel.append('rect')
      .attr('rx', 3)
      .attr('ry', 3)
      .attr('fill', '#0a0a0a')
      .attr('stroke', '#262626')
      .attr('stroke-width', 0.8)
      .attr('opacity', 0.85);

    // Label text
    const linkLabelText = linkLabel.append('text')
      .attr('font-family', 'monospace')
      .attr('font-size', '9px')
      .attr('fill', '#a3a3a3')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.3em')
      .text((d) => d.label || '');

    // Size background rects based on text measurement
    linkLabelText.each(function() {
      const bbox = (this as SVGTextElement).getBBox();
      const parent = d3.select((this as SVGTextElement).parentNode as SVGGElement);
      parent.select('rect')
        .attr('x', bbox.x - 4)
        .attr('y', bbox.y - 2)
        .attr('width', bbox.width + 8)
        .attr('height', bbox.height + 4);
    });

    // Spring-based drag behavior with elastic visual feedback and dynamic tension
    const drag = d3.drag<SVGGElement, SimNode>()
      .subject((event, d) => ({ x: d.x ?? 0, y: d.y ?? 0 }))
      .on('start', function (event, d) {
        setHoveredNode(null);
        setTooltipPos(null);
        d3.select(this).style('cursor', 'grabbing');
        if (!event.active) simulation.alphaTarget(0.35).restart();

        // Visual spring initiation on dragged node
        d3.select(this).select('.node-circle')
          .transition().duration(120)
          .attr('transform', 'scale(1.25)');

        d3.select(this).select('.node-glow')
          .transition().duration(120)
          .attr('opacity', 0.85);

        d.fx = d.x ?? event.x;
        d.fy = d.y ?? event.y;

        activeSpringRef.current = {
          sourceX: d.x ?? event.x,
          sourceY: d.y ?? event.y,
          targetX: event.x,
          targetY: event.y,
          tension: 0,
          node: d,
        };
      })
      .on('drag', function (event, d) {
        // Elastic spring interpolation for organic physical glide towards cursor
        const stiffness = 0.7;
        const currentFx = d.fx ?? d.x ?? event.x;
        const currentFy = d.fy ?? d.y ?? event.y;

        const newFx = currentFx + (event.x - currentFx) * stiffness;
        const newFy = currentFy + (event.y - currentFy) * stiffness;
        d.fx = newFx;
        d.fy = newFy;
        d.x = newFx;
        d.y = newFy;

        const currentTension = Math.hypot(event.x - (d.x ?? event.x), event.y - (d.y ?? event.y));

        activeSpringRef.current = {
          sourceX: d.x ?? event.x,
          sourceY: d.y ?? event.y,
          targetX: event.x,
          targetY: event.y,
          tension: currentTension,
          node: d,
        };

        // Reheat simulation smoothly so neighbor springs react
        simulation.alpha(0.35);
        if (!isPhysicsRunning) {
          simulation.tick();
        }
      })
      .on('end', function (event, d) {
        d3.select(this).style('cursor', 'grab');

        // Restore node appearance smoothly
        d3.select(this).select('.node-circle')
          .transition().duration(200)
          .attr('transform', 'scale(1)');

        d3.select(this).select('.node-glow')
          .transition().duration(200)
          .attr('opacity', autoCluster ? 0.3 : 0);

        activeSpringRef.current = null;
        springTetherGroup.selectAll('*').remove();

        if (springModeRef.current === 'elastic') {
          // Elastic spring recoil & natural settling into network
          d.fx = null;
          d.fy = null;
          simulation.alphaTarget(0).alpha(0.55).restart();
        } else {
          // Fixed pin mode: lock at dragged destination
          d.fx = event.x;
          d.fy = event.y;
          if (!event.active) simulation.alphaTarget(0);
        }
      });

    // Draw Nodes
    const node = nodesGroup
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .enter()
      .append('g')
      .attr('class', 'graph-node')
      .style('cursor', 'grab')
      .call(drag)
      .on('mouseenter', (event, d) => {
        setHoveredNode(d);
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          const tooltipW = 380;
          const tooltipH = 260;
          const rawX = event.clientX - rect.left;
          const rawY = event.clientY - rect.top;
          const x = rawX + tooltipW + 20 > rect.width ? Math.max(12, rawX - tooltipW - 12) : rawX + 16;
          const y = rawY + tooltipH + 20 > rect.height ? Math.max(12, rawY - tooltipH - 12) : rawY + 16;
          setTooltipPos({ x, y });
        }
      })
      .on('mousemove', (event) => {
        const rect = wrapperRef.current?.getBoundingClientRect();
        if (rect) {
          const tooltipW = 380;
          const tooltipH = 260;
          const rawX = event.clientX - rect.left;
          const rawY = event.clientY - rect.top;
          const x = rawX + tooltipW + 20 > rect.width ? Math.max(12, rawX - tooltipW - 12) : rawX + 16;
          const y = rawY + tooltipH + 20 > rect.height ? Math.max(12, rawY - tooltipH - 12) : rawY + 16;
          setTooltipPos({ x, y });
        }
      })
      .on('mouseleave', () => {
        setHoveredNode(null);
        setTooltipPos(null);
      })
      .on('dblclick', (event, d) => {
        event.stopPropagation();
        // Double-click unpins the node back into simulation physics
        d.fx = null;
        d.fy = null;
        simulation.alpha(0.3).restart();
      })
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
        setSelectedLink(null);
      });

    // Outer glow ring
    node.append('circle')
      .attr('class', 'node-glow')
      .attr('r', (d) => {
        const r = d.type === 'entity' ? Math.min(8 + (d.val || 1) * 2, 22) : 10;
        return r + 4;
      })
      .attr('fill', 'none')
      .attr('stroke', (d) => {
        if (autoCluster && d.clusterColor) return d.clusterColor;
        if (d.type === 'entity') return '#0284c7';
        if (d.type === 'chunk') return '#059669';
        return '#d97706';
      })
      .attr('stroke-width', 1.5)
      .attr('opacity', 0);

    // Primary circle
    node.append('circle')
      .attr('class', 'node-circle')
      .attr('r', (d) => (d.type === 'entity' ? Math.min(8 + (d.val || 1) * 2, 22) : 10))
      .attr('fill', (d) => {
        if (autoCluster && d.clusterColor) return d.clusterColor;
        if (d.type === 'entity') return '#0ea5e9'; // Cyan/Blue
        if (d.type === 'chunk') return '#10b981';  // Emerald
        return '#f59e0b'; // Amber for sources
      })
      .attr('stroke', '#171717')
      .attr('stroke-width', 2);

    // Node label text
    node.append('text')
      .attr('class', 'node-label')
      .attr('dx', (d) => {
        const r = d.type === 'entity' ? Math.min(8 + (d.val || 1) * 2, 22) : 10;
        return r + 5;
      })
      .attr('dy', '.35em')
      .attr('font-family', 'monospace')
      .attr('font-size', '10px')
      .attr('fill', '#e5e5e5')
      .attr('font-weight', '500')
      .attr('paint-order', 'stroke')
      .attr('stroke', '#0a0a0a')
      .attr('stroke-width', 3)
      .attr('stroke-linejoin', 'round')
      .text((d) => {
        const lbl = d.label;
        return lbl.length > 22 ? lbl.slice(0, 20) + '...' : lbl;
      });

    // Simulation tick handler
    simulation.on('tick', () => {
      if (autoCluster) {
        // Draw cluster boundary hulls around multi-node semantic communities
        const hullItems: { clusterId: number; color: string; path: string }[] = [];
        const clusterLabelData: { id: number; color: string; label: string; x: number; y: number }[] = [];

        rawClusters.forEach((c) => {
          if (c.nodeIds.length >= 2) {
            const cNodes = nodes.filter((n) => n.clusterId === c.id && n.x != null && n.y != null);
            if (cNodes.length >= 2) {
              const points: [number, number][] = [];
              const pad = 26;
              cNodes.forEach((n) => {
                points.push([n.x! - pad, n.y! - pad]);
                points.push([n.x! + pad, n.y! - pad]);
                points.push([n.x! + pad, n.y! + pad]);
                points.push([n.x! - pad, n.y! + pad]);
              });
              const hull = d3.polygonHull(points);
              const color = CLUSTER_PALETTE[c.id % CLUSTER_PALETTE.length];
              if (hull) {
                hullItems.push({
                  clusterId: c.id,
                  color,
                  path: `M${hull.map((p) => p.join(',')).join('L')}Z`,
                });
              }

              // Compute centroid and top position for cluster label badge
              const meanX = d3.mean(cNodes, (n) => n.x!) || 0;
              const minY = d3.min(cNodes, (n) => n.y!) || 0;
              const sample = nodes.find((n) => n.id === c.nodeIds[0]);
              const sampleTxt = sample ? (sample.label.length > 18 ? sample.label.slice(0, 16) + '...' : sample.label) : '';
              clusterLabelData.push({
                id: c.id,
                color,
                label: `Cluster #${c.id + 1} (${c.nodeIds.length}) - ${sampleTxt}`,
                x: meanX,
                y: minY - 26,
              });
            }
          }
        });

        const hullPaths = hullsGroup
          .selectAll<SVGPathElement, { clusterId: number; color: string; path: string }>('path')
          .data(hullItems, (d) => d.clusterId);

        hullPaths.exit().remove();

        hullPaths
          .enter()
          .append('path')
          .attr('class', 'cluster-hull')
          .attr('fill', (d) => d.color)
          .attr('fill-opacity', 0.08)
          .attr('stroke', (d) => d.color)
          .attr('stroke-width', 1.8)
          .attr('stroke-dasharray', '5 4')
          .attr('stroke-opacity', 0.5)
          .style('pointer-events', 'none')
          .merge(hullPaths)
          .attr('d', (d) => d.path);

        // Render cluster header title pills
        const badgeGroups = clusterLabelsGroup
          .selectAll<SVGGElement, any>('g.cluster-pill')
          .data(clusterLabelData, (d) => d.id);

        badgeGroups.exit().remove();

        const enterBadges = badgeGroups.enter().append('g').attr('class', 'cluster-pill');
        enterBadges.append('rect')
          .attr('rx', 4)
          .attr('ry', 4)
          .attr('fill', '#0a0a0a')
          .attr('fill-opacity', 0.92)
          .attr('stroke-width', 1);

        enterBadges.append('text')
          .attr('font-family', 'monospace')
          .attr('font-size', '9px')
          .attr('font-weight', 'bold')
          .attr('text-anchor', 'middle')
          .attr('dy', '0.35em');

        const mergedBadges = enterBadges.merge(badgeGroups);
        mergedBadges.attr('transform', (d) => `translate(${d.x}, ${d.y})`);
        mergedBadges.select('rect')
          .attr('stroke', (d) => d.color)
          .attr('x', (d) => -((d.label.length * 6) / 2 + 8))
          .attr('y', -9)
          .attr('width', (d) => d.label.length * 6 + 16)
          .attr('height', 18);
        mergedBadges.select('text')
          .attr('fill', (d) => d.color)
          .text((d) => d.label);
      } else {
        hullsGroup.selectAll('path').remove();
        clusterLabelsGroup.selectAll('*').remove();
      }

      // Render interactive spring tether when node is dragged
      const activeSpring = activeSpringRef.current;
      if (activeSpring) {
        const { sourceX, sourceY, targetX, targetY, tension, node: draggedNode } = activeSpring;
        const tetherData = [{ sourceX, sourceY, targetX, targetY, tension }];
        const tensionColor =
          tension > 120 ? '#f43f5e' : tension > 60 ? '#f59e0b' : '#38bdf8';

        const tetherLine = springTetherGroup
          .selectAll<SVGLineElement, any>('line.spring-tether')
          .data(tetherData);

        tetherLine.exit().remove();

        tetherLine.enter()
          .append('line')
          .attr('class', 'spring-tether')
          .attr('stroke-dasharray', '4 3')
          .style('pointer-events', 'none')
          .merge(tetherLine)
          .attr('x1', sourceX)
          .attr('y1', sourceY)
          .attr('x2', targetX)
          .attr('y2', targetY)
          .attr('stroke', tensionColor)
          .attr('stroke-width', 2.5)
          .attr('stroke-opacity', 0.85);

        const tetherAnchor = springTetherGroup
          .selectAll<SVGCircleElement, any>('circle.spring-target')
          .data(tetherData);

        tetherAnchor.exit().remove();

        tetherAnchor.enter()
          .append('circle')
          .attr('class', 'spring-target')
          .attr('fill', 'none')
          .style('pointer-events', 'none')
          .merge(tetherAnchor)
          .attr('cx', targetX)
          .attr('cy', targetY)
          .attr('r', 7)
          .attr('stroke', tensionColor)
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '3 2');

        // Dynamic spring link tension coloring
        link
          .attr('stroke', (l) => {
            const sId = typeof l.source === 'object' ? (l.source as SimNode).id : l.source;
            const tId = typeof l.target === 'object' ? (l.target as SimNode).id : l.target;
            if (sId === draggedNode.id || tId === draggedNode.id) {
              return tensionColor;
            }
            return autoCluster ? '#333333' : '#404040';
          })
          .attr('stroke-width', (l) => {
            const sId = typeof l.source === 'object' ? (l.source as SimNode).id : l.source;
            const tId = typeof l.target === 'object' ? (l.target as SimNode).id : l.target;
            if (sId === draggedNode.id || tId === draggedNode.id) {
              return 3;
            }
            return l.type === 'relation' ? 1.5 : 1;
          })
          .attr('stroke-opacity', (l) => {
            const sId = typeof l.source === 'object' ? (l.source as SimNode).id : l.source;
            const tId = typeof l.target === 'object' ? (l.target as SimNode).id : l.target;
            if (sId === draggedNode.id || tId === draggedNode.id) {
              return 1.0;
            }
            return 0.4;
          });
      } else {
        springTetherGroup.selectAll('*').remove();
      }

      link
        .attr('x1', (d) => (d.source as SimNode).x || 0)
        .attr('y1', (d) => (d.source as SimNode).y || 0)
        .attr('x2', (d) => (d.target as SimNode).x || 0)
        .attr('y2', (d) => (d.target as SimNode).y || 0);

      linkLabel.attr('transform', (d) => {
        const s = d.source as SimNode;
        const t = d.target as SimNode;
        const x = ((s.x || 0) + (t.x || 0)) / 2;
        const y = ((s.y || 0) + (t.y || 0)) / 2;
        return `translate(${x}, ${y})`;
      });

      node.attr('transform', (d) => `translate(${d.x || 0}, ${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [loading, vectors, tripletEdges, graphMode, autoCluster]);

  // Reactive interactive highlights for Hover, Selection, and Search
  useEffect(() => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const linkLines = svg.selectAll<SVGLineElement, SimLink>('.graph-link');
    const linkLabels = svg.selectAll<SVGGElement, SimLink>('.graph-link-label');
    const nodeGroups = svg.selectAll<SVGGElement, SimNode>('.graph-node');
    const nodeCircles = nodeGroups.select<SVGCircleElement>('.node-circle');
    const nodeGlows = nodeGroups.select<SVGCircleElement>('.node-glow');
    const nodeTexts = nodeGroups.select<SVGTextElement>('.node-label');

    const activeNode = hoveredNode || selectedNode;
    const query = searchTerm.trim().toLowerCase();
    const isSearching = query.length > 0;
    const isClusterFiltered = selectedClusterId !== null;

    if (!activeNode && !isSearching && !isClusterFiltered) {
      // Default idle state
      linkLines
        .attr('stroke', '#404040')
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', (d) => (d.type === 'relation' ? 1.5 : 1))
        .attr('marker-end', (d) => (d.type === 'relation' ? 'url(#arrow-default)' : null));

      linkLabels.attr('opacity', 0.85);

      nodeCircles
        .attr('stroke', (d) => (autoCluster && d.clusterColor ? d.clusterColor : '#171717'))
        .attr('stroke-width', 2)
        .attr('opacity', 1);

      nodeGlows.attr('opacity', (d) => (autoCluster ? 0.3 : 0));
      nodeTexts.attr('fill', '#e5e5e5').attr('opacity', 1).attr('font-weight', '500');
      return;
    }

    const activeId = activeNode ? activeNode.id : null;

    // Helper to test if a node matches search query across label, text, source, and ID
    const isSearchMatch = (d: SimNode): boolean => {
      if (!isSearching) return false;
      if (d.label && d.label.toLowerCase().includes(query)) return true;
      if (d.text && d.text.toLowerCase().includes(query)) return true;
      if (d.source && d.source.toLowerCase().includes(query)) return true;
      if (d.id && d.id.toLowerCase().includes(query)) return true;
      return false;
    };

    // Helper to test if a node is connected to activeNode
    const connectedNodeIds = new Set<string>();
    if (activeId) {
      connectedNodeIds.add(activeId);
      linksRef.current.forEach((l) => {
        const sId = typeof l.source === 'object' ? (l.source as any).id : l.source;
        const tId = typeof l.target === 'object' ? (l.target as any).id : l.target;
        if (sId === activeId) connectedNodeIds.add(tId);
        if (tId === activeId) connectedNodeIds.add(sId);
      });
    }

    // Helper to get node object from link endpoint
    const getNodeFromEndpoint = (endpoint: string | SimNode): SimNode | undefined => {
      if (typeof endpoint === 'object') return endpoint as SimNode;
      return nodesRef.current.find((n) => n.id === endpoint);
    };

    // Update Links
    linkLines
      .attr('stroke', (d) => {
        const sId = typeof d.source === 'object' ? (d.source as any).id : d.source;
        const tId = typeof d.target === 'object' ? (d.target as any).id : d.target;
        const sNode = getNodeFromEndpoint(d.source);
        const tNode = getNodeFromEndpoint(d.target);

        if (activeId && (sId === activeId || tId === activeId)) {
          return '#38bdf8'; // Bright sky blue highlight
        }

        if (isSearching) {
          const sMatches = sNode ? isSearchMatch(sNode) : false;
          const tMatches = tNode ? isSearchMatch(tNode) : false;
          if (sMatches && tMatches) return '#f59e0b'; // Amber link between both matching nodes
          if (sMatches || tMatches) return '#b45309'; // Subtle amber link to one matching node
          return '#171717'; // Faded non-matching link
        }

        if (isClusterFiltered) {
          const sCluster = sNode?.clusterId;
          const tCluster = tNode?.clusterId;
          if (sCluster === selectedClusterId && tCluster === selectedClusterId) {
            return CLUSTER_PALETTE[selectedClusterId % CLUSTER_PALETTE.length];
          }
        }

        return '#262626';
      })
      .attr('stroke-opacity', (d) => {
        const sId = typeof d.source === 'object' ? (d.source as any).id : d.source;
        const tId = typeof d.target === 'object' ? (d.target as any).id : d.target;
        const sNode = getNodeFromEndpoint(d.source);
        const tNode = getNodeFromEndpoint(d.target);

        if (activeId) {
          return sId === activeId || tId === activeId ? 1.0 : 0.08;
        }

        if (isSearching) {
          const sMatches = sNode ? isSearchMatch(sNode) : false;
          const tMatches = tNode ? isSearchMatch(tNode) : false;
          if (sMatches && tMatches) return 0.95;
          if (sMatches || tMatches) return 0.45;
          return 0.04; // Fade out non-matching link
        }

        if (isClusterFiltered) {
          const sCluster = sNode?.clusterId;
          const tCluster = tNode?.clusterId;
          return sCluster === selectedClusterId && tCluster === selectedClusterId ? 0.9 : 0.08;
        }

        return 0.4;
      })
      .attr('stroke-width', (d) => {
        const sId = typeof d.source === 'object' ? (d.source as any).id : d.source;
        const tId = typeof d.target === 'object' ? (d.target as any).id : d.target;
        const sNode = getNodeFromEndpoint(d.source);
        const tNode = getNodeFromEndpoint(d.target);

        if (activeId && (sId === activeId || tId === activeId)) {
          return 2.5;
        }

        if (isSearching) {
          const sMatches = sNode ? isSearchMatch(sNode) : false;
          const tMatches = tNode ? isSearchMatch(tNode) : false;
          if (sMatches && tMatches) return 2.4;
          if (sMatches || tMatches) return 1.5;
          return 0.5;
        }

        if (isClusterFiltered) {
          const sCluster = sNode?.clusterId;
          const tCluster = tNode?.clusterId;
          if (sCluster === selectedClusterId && tCluster === selectedClusterId) return 2.2;
        }

        return 0.8;
      })
      .attr('marker-end', (d) => {
        const sId = typeof d.source === 'object' ? (d.source as any).id : d.source;
        const tId = typeof d.target === 'object' ? (d.target as any).id : d.target;
        if (activeId && (sId === activeId || tId === activeId)) {
          return 'url(#arrow-highlight)';
        }
        return d.type === 'relation' ? 'url(#arrow-default)' : null;
      });

    // Update Link Labels
    linkLabels.attr('opacity', (d) => {
      const sId = typeof d.source === 'object' ? (d.source as any).id : d.source;
      const tId = typeof d.target === 'object' ? (d.target as any).id : d.target;
      const sNode = getNodeFromEndpoint(d.source);
      const tNode = getNodeFromEndpoint(d.target);

      if (activeId) {
        return sId === activeId || tId === activeId ? 1.0 : 0.05;
      }

      if (isSearching) {
        const sMatches = sNode ? isSearchMatch(sNode) : false;
        const tMatches = tNode ? isSearchMatch(tNode) : false;
        return sMatches || tMatches ? 0.9 : 0.04; // Fade out non-matching labels
      }

      if (isClusterFiltered) {
        const sCluster = sNode?.clusterId;
        const tCluster = tNode?.clusterId;
        return sCluster === selectedClusterId && tCluster === selectedClusterId ? 0.95 : 0.05;
      }

      return 0.85;
    });

    // Update Nodes
    nodeCircles
      .attr('stroke', (d) => {
        if (isSearching && isSearchMatch(d)) {
          return '#f59e0b'; // Amber match highlight
        }
        if (d.id === activeId) {
          return '#ffffff';
        }
        if (isClusterFiltered && d.clusterId === selectedClusterId) {
          return '#ffffff';
        }
        if (connectedNodeIds.has(d.id)) {
          return '#38bdf8';
        }
        return autoCluster && d.clusterColor ? d.clusterColor : '#171717';
      })
      .attr('stroke-width', (d) => {
        if (isSearching && isSearchMatch(d)) return 3.5;
        if (d.id === activeId) return 3;
        if (isClusterFiltered && d.clusterId === selectedClusterId) return 2.5;
        if (connectedNodeIds.has(d.id)) return 2;
        return 1.5;
      })
      .attr('opacity', (d) => {
        if (isSearching) {
          const matches = isSearchMatch(d);
          if (activeId) {
            return matches || connectedNodeIds.has(d.id) ? 1.0 : 0.12;
          }
          return matches ? 1.0 : 0.12; // Fade out non-matching elements
        }

        if (activeId) {
          return connectedNodeIds.has(d.id) ? 1.0 : 0.15;
        }

        if (isClusterFiltered) {
          return d.clusterId === selectedClusterId ? 1.0 : 0.15;
        }

        return 1;
      });

    nodeGlows
      .attr('stroke', (d) => {
        if (isSearching && isSearchMatch(d)) return '#f59e0b';
        if (d.id === activeId) return '#ffffff';
        if (isClusterFiltered && d.clusterId === selectedClusterId && d.clusterColor) return d.clusterColor;
        if (connectedNodeIds.has(d.id)) return '#38bdf8';
        return autoCluster && d.clusterColor ? d.clusterColor : '#0284c7';
      })
      .attr('opacity', (d) => {
        if (isSearching) {
          return isSearchMatch(d) ? 0.9 : 0; // Fade out non-matching glows
        }
        if (d.id === activeId) return 0.8;
        if (isClusterFiltered && d.clusterId === selectedClusterId) return 0.6;
        if (connectedNodeIds.has(d.id)) return 0.4;
        return autoCluster ? 0.3 : 0;
      });

    nodeTexts
      .attr('opacity', (d) => {
        if (isSearching) {
          return isSearchMatch(d) ? 1.0 : 0.12; // Fade out non-matching labels
        }
        if (activeId) {
          return connectedNodeIds.has(d.id) ? 1.0 : 0.15;
        }
        if (isClusterFiltered) {
          return d.clusterId === selectedClusterId ? 1.0 : 0.15;
        }
        return 0.9;
      })
      .attr('fill', (d) => {
        if (isSearching && isSearchMatch(d)) return '#fbbf24'; // Vivid gold fill
        if (d.id === activeId) return '#38bdf8';
        if (isClusterFiltered && d.clusterId === selectedClusterId && d.clusterColor) return d.clusterColor;
        return '#e5e5e5';
      })
      .attr('font-weight', (d) => {
        if (isSearching && isSearchMatch(d)) return '700';
        if (d.id === activeId) return '700';
        return '500';
      });
  }, [hoveredNode, selectedNode, searchTerm, selectedClusterId, autoCluster]);

  // Interactive controls
  const handleZoomIn = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 1.3);
    }
  };

  const handleZoomOut = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(300).call(zoomRef.current.scaleBy, 0.7);
    }
  };

  const handleResetZoom = () => {
    if (svgRef.current && zoomRef.current) {
      d3.select(svgRef.current).transition().duration(400).call(zoomRef.current.transform, d3.zoomIdentity);
    }
  };

  const handleFitToScreen = () => {
    if (!svgRef.current || !wrapperRef.current || !zoomRef.current) return;
    const nodes = nodesRef.current;
    if (nodes.length === 0) return;

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    nodes.forEach((n) => {
      if (n.x != null && n.y != null) {
        if (n.x < minX) minX = n.x;
        if (n.x > maxX) maxX = n.x;
        if (n.y < minY) minY = n.y;
        if (n.y > maxY) maxY = n.y;
      }
    });

    if (!isFinite(minX)) return;

    const width = wrapperRef.current.clientWidth || 900;
    const height = wrapperRef.current.clientHeight || 650;
    const dx = maxX - minX || 100;
    const dy = maxY - minY || 100;
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const scale = Math.max(0.15, Math.min(2.0, 0.82 / Math.max(dx / width, dy / height)));
    const translate = [width / 2 - scale * cx, height / 2 - scale * cy];

    const transform = d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale);
    d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, transform);
  };

  const handleFocusNode = (node: SimNode) => {
    if (!svgRef.current || !wrapperRef.current || !zoomRef.current) return;
    if (node.x == null || node.y == null) return;
    const width = wrapperRef.current.clientWidth || 900;
    const height = wrapperRef.current.clientHeight || 650;
    const scale = 1.4;
    const transform = d3.zoomIdentity
      .translate(width / 2 - scale * node.x, height / 2 - scale * node.y)
      .scale(scale);
    d3.select(svgRef.current).transition().duration(500).call(zoomRef.current.transform, transform);
  };

  const handleTogglePhysics = () => {
    if (!simulationRef.current) return;
    if (isPhysicsRunning) {
      simulationRef.current.stop();
      setIsPhysicsRunning(false);
    } else {
      simulationRef.current.alpha(0.3).restart();
      setIsPhysicsRunning(true);
    }
  };

  const handleRestartSimulation = () => {
    if (simulationRef.current) {
      nodesRef.current.forEach((n) => {
        n.fx = null;
        n.fy = null;
      });
      simulationRef.current.alpha(1).restart();
      setIsPhysicsRunning(true);
    }
  };

  // Export current graph visualization as a high-resolution PNG image
  const handleExportPng = useCallback(async () => {
    if (!svgRef.current || !wrapperRef.current) return;
    if (nodesRef.current.length === 0) return;

    try {
      setIsExporting(true);

      const svgElement = svgRef.current;
      const rect = wrapperRef.current.getBoundingClientRect();
      const width = Math.round(rect.width || 1200);
      const height = Math.round(rect.height || 800);

      // 2.5x retina multiplier for crisp external documentation
      const scale = 2.5;
      const bannerHeight = 36;
      const totalCanvasWidth = Math.round(width * scale);
      const totalCanvasHeight = Math.round((height + bannerHeight) * scale);

      // Clone SVG element to preserve active transformations and styles
      const clonedSvg = svgElement.cloneNode(true) as SVGSVGElement;
      clonedSvg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      clonedSvg.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
      clonedSvg.setAttribute('width', String(width));
      clonedSvg.setAttribute('height', String(height));
      clonedSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);

      // Ensure monospace font and vector crispness in exported SVG
      const styleElement = document.createElementNS('http://www.w3.org/2000/svg', 'style');
      styleElement.textContent = `
        text { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; }
        .node-label { font-weight: 500; }
        .graph-link { stroke-linecap: round; }
      `;
      const defsElement =
        clonedSvg.querySelector('defs') ||
        clonedSvg.insertBefore(document.createElementNS('http://www.w3.org/2000/svg', 'defs'), clonedSvg.firstChild);
      defsElement.appendChild(styleElement);

      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clonedSvg);
      const svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      const URLObj = window.URL || window.webkitURL || window;
      const blobUrl = URLObj.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = totalCanvasWidth;
          canvas.height = totalCanvasHeight;
          const ctx = canvas.getContext('2d');

          if (!ctx) {
            URLObj.revokeObjectURL(blobUrl);
            setIsExporting(false);
            return;
          }

          // Scale for crisp high resolution
          ctx.scale(scale, scale);

          // Solid deep-dark obsidian background
          ctx.fillStyle = '#0a0a0a';
          ctx.fillRect(0, 0, width, height + bannerHeight);

          // Subtle background grid
          ctx.strokeStyle = '#141414';
          ctx.lineWidth = 0.5;
          for (let x = 0; x <= width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, bannerHeight);
            ctx.lineTo(x, height + bannerHeight);
            ctx.stroke();
          }
          for (let y = bannerHeight; y <= height + bannerHeight; y += 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
          }

          // Top Documentation Header Strip
          ctx.fillStyle = '#121212';
          ctx.fillRect(0, 0, width, bannerHeight);
          ctx.strokeStyle = '#262626';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(0, bannerHeight);
          ctx.lineTo(width, bannerHeight);
          ctx.stroke();

          // Header Left: App & Graph Title
          ctx.fillStyle = '#a855f7';
          ctx.beginPath();
          ctx.arc(20, bannerHeight / 2, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = '#f5f5f5';
          ctx.font = 'bold 11px ui-monospace, monospace';
          ctx.fillText('ZOE FILMS • LOREPACK GRAPH ARCHITECTURE', 32, bannerHeight / 2 + 4);

          // Header Center: Metadata details
          ctx.fillStyle = '#737373';
          ctx.font = '10px ui-monospace, monospace';
          const metaText = `AGENT: ${selectedAgentId}  |  MODE: ${graphMode.toUpperCase()}  |  NODES: ${nodesRef.current.length}  |  EDGES: ${linksRef.current.length}${autoCluster ? '  |  AUTO-CLUSTER: ON' : ''}`;
          ctx.fillText(metaText, Math.max(330, width / 2 - 180), bannerHeight / 2 + 4);

          // Header Right: Timestamp & HD indicator
          const dateStr = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC  [HD 2.5x]';
          ctx.fillStyle = '#525252';
          ctx.font = '9px ui-monospace, monospace';
          ctx.fillText(dateStr, width - 200, bannerHeight / 2 + 3);

          // Draw the SVG graphic below banner
          ctx.drawImage(img, 0, bannerHeight, width, height);

          // Convert canvas to PNG blob
          canvas.toBlob(
            (pngBlob) => {
              URLObj.revokeObjectURL(blobUrl);
              if (!pngBlob) {
                setIsExporting(false);
                return;
              }

              const downloadUrl = URLObj.createObjectURL(pngBlob);
              const downloadAnchor = document.createElement('a');
              downloadAnchor.href = downloadUrl;
              downloadAnchor.download = `lorepack-graph-${selectedAgentId || 'agent'}-${graphMode}-${Date.now()}.png`;
              document.body.appendChild(downloadAnchor);
              downloadAnchor.click();
              document.body.removeChild(downloadAnchor);
              URLObj.revokeObjectURL(downloadUrl);

              setIsExporting(false);
              setExportNotification(`High-resolution PNG (${totalCanvasWidth}x${totalCanvasHeight}) exported successfully!`);
              setTimeout(() => setExportNotification(null), 3800);
            },
            'image/png',
            1.0
          );
        } catch (canvasErr) {
          console.error('Canvas export error:', canvasErr);
          URLObj.revokeObjectURL(blobUrl);
          setIsExporting(false);
        }
      };

      img.onerror = (imgErr) => {
        console.error('Failed to load serialized SVG for PNG export:', imgErr);
        URLObj.revokeObjectURL(blobUrl);
        setIsExporting(false);
      };

      img.src = blobUrl;
    } catch (err) {
      console.error('High-resolution PNG export failed:', err);
      setIsExporting(false);
    }
  }, [selectedAgentId, graphMode, autoCluster]);

  return (
    <main className="flex-1 flex flex-col w-full bg-neutral-950 text-neutral-100 min-h-[calc(100vh-130px)]">
      {/* Top Header Bar */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-purple-400" />
            <h1 className="text-base font-bold font-mono tracking-wide">Semantic Network Graph (2D D3 Force)</h1>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Interactive physics simulation displaying entity relationships, directional semantic triplets, and vector node meshes.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Agent Selector */}
          <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-800 px-3 py-1.5 rounded">
            <span className="text-[10px] text-neutral-400 font-mono">AGENT:</span>
            <select
              value={selectedAgentId}
              onChange={(e) => setSelectedAgentId(e.target.value)}
              className="bg-transparent text-xs font-mono text-white focus:outline-none cursor-pointer"
            >
              {agents.map((ag) => (
                <option key={ag.id} value={ag.id} className="bg-neutral-900 text-white">
                  {ag.name} ({ag.handle})
                </option>
              ))}
            </select>
          </div>

          {/* Graph Mode Toggle */}
          <div className="flex items-center bg-neutral-950 border border-neutral-800 p-0.5 rounded">
            <button
              type="button"
              onClick={() => setGraphMode('triplets')}
              className={`px-3 py-1 text-xs font-mono transition-colors cursor-pointer ${
                graphMode === 'triplets'
                  ? 'bg-purple-600 text-white font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Entity Triplets ({tripletEdges.length})
            </button>
            <button
              type="button"
              onClick={() => setGraphMode('mesh')}
              className={`px-3 py-1 text-xs font-mono transition-colors cursor-pointer ${
                graphMode === 'mesh'
                  ? 'bg-purple-600 text-white font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Vector Mesh ({vectors.length})
            </button>
          </div>

          {/* Auto-Cluster Toggle */}
          <button
            type="button"
            onClick={() => setAutoCluster(!autoCluster)}
            className={`flex items-center gap-2 px-3 py-1.5 text-xs font-mono border rounded transition-all cursor-pointer ${
              autoCluster
                ? 'bg-purple-950/80 border-purple-500 text-purple-200 font-bold shadow-md shadow-purple-950/50'
                : 'bg-neutral-950 border-neutral-800 text-neutral-400 hover:text-white hover:border-neutral-700'
            }`}
            title="Toggle Auto-Cluster mode: group related nodes based on shared semantic edges"
          >
            <Layers className={`w-3.5 h-3.5 ${autoCluster ? 'text-purple-400' : 'text-neutral-500'}`} />
            <span>Auto-Cluster</span>
            <span
              className={`text-[9px] px-1.5 py-0.5 rounded font-bold uppercase tracking-wider ${
                autoCluster ? 'bg-purple-600 text-white' : 'bg-neutral-800 text-neutral-500'
              }`}
            >
              {autoCluster ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Export High-Resolution PNG Button */}
          <button
            type="button"
            onClick={handleExportPng}
            disabled={isExporting || nodesRef.current.length === 0}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono border rounded transition-colors cursor-pointer ${
              isExporting
                ? 'bg-amber-950/70 border-amber-600 text-amber-300'
                : 'bg-neutral-950 hover:bg-neutral-800 border-neutral-700 text-neutral-200 hover:text-white'
            }`}
            title="Export high-resolution PNG image (2.5x HD) for external documentation"
          >
            <Download className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isExporting ? 'Exporting...' : 'Export PNG'}</span>
            <span className="text-[9px] bg-emerald-950 text-emerald-400 px-1 py-0.5 rounded border border-emerald-800/80 font-bold">
              HD
            </span>
          </button>

          <button
            type="button"
            onClick={() => loadGraphData(selectedAgentId)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono border border-neutral-700 transition-colors cursor-pointer"
            title="Refresh Data"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Main Content & Graph Stage */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        {/* Canvas / SVG Area */}
        <div ref={wrapperRef} className="flex-1 relative bg-neutral-950 flex items-center justify-center overflow-hidden min-h-[550px]">
          {loading ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/80 z-20 gap-3">
              <div className="w-6 h-6 border-2 border-purple-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs font-mono text-neutral-400">Loading semantic graph topology...</p>
            </div>
          ) : null}

          {/* Floating Control Toolbar */}
          <div className="absolute top-4 left-4 z-10 flex flex-col gap-1.5 bg-neutral-900/90 border border-neutral-800 p-1.5 backdrop-blur shadow-lg rounded">
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1.5 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors rounded cursor-pointer"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1.5 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors rounded cursor-pointer"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleFitToScreen}
              className="p-1.5 hover:bg-neutral-800 text-neutral-300 hover:text-sky-400 transition-colors rounded cursor-pointer"
              title="Fit Graph to Viewport"
            >
              <Maximize2 className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="p-1.5 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors rounded cursor-pointer"
              title="Reset 1:1 Scale"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <div className="w-full h-px bg-neutral-800 my-0.5" />
            <button
              type="button"
              onClick={() => setAutoCluster(!autoCluster)}
              className={`p-1.5 transition-colors rounded cursor-pointer ${
                autoCluster
                  ? 'text-purple-300 bg-purple-950/80 border border-purple-500/50'
                  : 'text-neutral-400 hover:bg-neutral-800 hover:text-white'
              }`}
              title={autoCluster ? 'Disable Auto-Cluster' : 'Enable Auto-Cluster (Group by shared edges)'}
            >
              <Layers className="w-4 h-4" />
            </button>
            <div className="w-full h-px bg-neutral-800 my-0.5" />
            <button
              type="button"
              onClick={handleTogglePhysics}
              className={`p-1.5 hover:bg-neutral-800 transition-colors rounded cursor-pointer ${
                isPhysicsRunning ? 'text-emerald-400' : 'text-neutral-500'
              }`}
              title={isPhysicsRunning ? 'Freeze Physics' : 'Resume Physics'}
            >
              {isPhysicsRunning ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={handleRestartSimulation}
              className="p-1.5 hover:bg-neutral-800 text-neutral-300 hover:text-emerald-400 transition-colors rounded cursor-pointer"
              title="Reheat Simulation (Alpha 1.0)"
            >
              <Activity className="w-4 h-4 text-emerald-400" />
            </button>
            <div className="w-full h-px bg-neutral-800 my-0.5" />
            <button
              type="button"
              onClick={handleExportPng}
              disabled={isExporting || nodesRef.current.length === 0}
              className={`p-1.5 hover:bg-neutral-800 text-neutral-300 hover:text-emerald-400 transition-colors rounded cursor-pointer ${
                isExporting ? 'text-amber-400 animate-pulse' : ''
              }`}
              title="Export High-Resolution PNG for external documentation (2.5x HD)"
            >
              <Download className="w-4 h-4 text-emerald-400" />
            </button>
          </div>

          {/* Floating Search Filter with Matching Query Counter */}
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-neutral-900/95 border border-neutral-800 px-3 py-2 backdrop-blur-md shadow-2xl rounded">
            <Search className={`w-3.5 h-3.5 ${searchTerm ? 'text-amber-400' : 'text-neutral-400'}`} />
            <input
              type="text"
              placeholder="Search nodes (query highlights & fades)..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setSearchTerm('');
              }}
              className="bg-transparent text-xs font-mono text-white placeholder-neutral-500 focus:outline-none w-56 sm:w-64"
            />
            {searchTerm.trim() && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold shrink-0 border ${
                  matchingNodeCount > 0
                    ? 'bg-amber-950/80 text-amber-400 border-amber-800/80'
                    : 'bg-rose-950/80 text-rose-400 border-rose-800/80'
                }`}
              >
                {matchingNodeCount} {matchingNodeCount === 1 ? 'match' : 'matches'}
              </span>
            )}
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="text-[10px] text-neutral-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-neutral-800 transition-colors cursor-pointer"
                title="Clear search (Esc)"
              >
                Clear
              </button>
            )}
          </div>

          {/* Export PNG Notification Toast */}
          {exportNotification && (
            <div className="absolute top-16 right-4 z-20 flex items-center gap-2 bg-emerald-950/95 border border-emerald-600 text-emerald-200 px-3.5 py-2 rounded shadow-2xl text-xs font-mono backdrop-blur-md">
              <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{exportNotification}</span>
            </div>
          )}

          {/* SVG Canvas */}
          <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

          {/* Interactive Hover Tooltip */}
          {tooltipPos && (hoveredNode || hoveredLink) && (
            <div
              className="absolute z-30 pointer-events-none bg-neutral-900/98 border border-neutral-700/80 p-3 rounded-lg shadow-2xl font-mono text-xs w-80 sm:w-96 max-w-md backdrop-blur-md transition-all duration-75"
              style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}
            >
              {hoveredNode && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2 border-b border-neutral-800 pb-1.5">
                    <div className="flex items-center gap-1.5 truncate">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{
                          backgroundColor:
                            autoCluster && hoveredNode.clusterColor
                              ? hoveredNode.clusterColor
                              : hoveredNode.type === 'entity'
                              ? '#38bdf8'
                              : hoveredNode.type === 'chunk'
                              ? '#10b981'
                              : '#f59e0b'
                        }}
                      />
                      <span className="text-[10px] uppercase font-bold text-sky-400 tracking-wider">
                        {hoveredNode.type.toUpperCase()} NODE
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {autoCluster && hoveredNode.clusterId !== undefined && (
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded font-bold"
                          style={{
                            backgroundColor: `${hoveredNode.clusterColor || '#a855f7'}25`,
                            color: hoveredNode.clusterColor || '#a855f7'
                          }}
                        >
                          Cluster #{hoveredNode.clusterId + 1}
                        </span>
                      )}
                      {hoveredNode.degree !== undefined && (
                        <span className="text-[9px] text-neutral-400 bg-neutral-950 px-1.5 py-0.5 rounded border border-neutral-800">
                          {hoveredNode.degree} {hoveredNode.degree === 1 ? 'edge' : 'edges'}
                        </span>
                      )}
                    </div>
                  </div>

                  <div>
                    <span className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold">Node Label / ID:</span>
                    <p className="text-white font-bold text-xs break-all mt-0.5">{hoveredNode.label}</p>
                  </div>

                  {/* Full Node Text Content */}
                  <div className="mt-0.5">
                    <div className="flex items-center justify-between text-[9px] text-neutral-400 uppercase tracking-wider font-bold mb-1">
                      <span className="text-emerald-400 flex items-center gap-1">
                        <span>Full Node Text Content</span>
                      </span>
                      {hoveredNode.text && (
                        <span className="text-neutral-500 font-normal">{hoveredNode.text.length} chars</span>
                      )}
                    </div>
                    <div className="bg-neutral-950/95 border border-neutral-800/90 p-2.5 rounded text-[11px] font-mono text-neutral-200 max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap break-words select-text">
                      {hoveredNode.text || hoveredNode.label}
                    </div>
                  </div>

                  {hoveredNode.source && (
                    <div className="flex items-center justify-between pt-1 border-t border-neutral-800 text-[10px]">
                      <span className="text-neutral-500 uppercase">Source Document:</span>
                      <span className="text-amber-400 font-bold truncate max-w-[180px]">{hoveredNode.source}</span>
                    </div>
                  )}

                  <div className="text-[9px] text-neutral-500 italic flex items-center justify-between pt-0.5">
                    <span>💡 Click to inspect</span>
                    <span>Drag to reposition</span>
                  </div>
                </div>
              )}
              {hoveredLink && (
                <div className="flex flex-col gap-1.5">
                  <span className="text-[10px] uppercase font-bold text-purple-400 border-b border-neutral-800 pb-1 tracking-wider">
                    SEMANTIC RELATION
                  </span>
                  <div className="text-[11px] text-neutral-300 mt-0.5 bg-neutral-950 p-2 rounded border border-neutral-800">
                    <span className="text-sky-300 font-bold">
                      {typeof hoveredLink.source === 'object' ? (hoveredLink.source as any).label : hoveredLink.source}
                    </span>
                    <span className="text-neutral-500 mx-1">
                      --[{hoveredLink.label || 'relates_to'}]--&gt;
                    </span>
                    <span className="text-emerald-300 font-bold">
                      {typeof hoveredLink.target === 'object' ? (hoveredLink.target as any).label : hoveredLink.target}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Legend Overlay */}
          <div className="absolute bottom-4 left-4 z-10 bg-neutral-900/90 border border-neutral-800 px-3.5 py-2 text-[10px] font-mono text-neutral-400 flex items-center gap-4 backdrop-blur rounded">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block shadow-sm shadow-sky-500/50"></span>
              <span>Entity Node</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block shadow-sm shadow-emerald-500/50"></span>
              <span>Vector Chunk</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block shadow-sm shadow-amber-500/50"></span>
              <span>Source Doc</span>
            </div>
            {autoCluster && (
              <div className="flex items-center gap-1.5 border-l border-neutral-800 pl-3">
                <span className="w-2.5 h-2.5 rounded-full border border-dashed border-purple-400 bg-purple-500/30 inline-block"></span>
                <span className="text-purple-300 font-bold">Clusters ({clusterSummary.length})</span>
              </div>
            )}
          </div>
        </div>

        {/* Inspector Sidebar */}
        <div className="w-full lg:w-80 bg-neutral-900 border-t lg:border-t-0 lg:border-l border-neutral-800 p-4 flex flex-col gap-4 overflow-y-auto max-h-[340px] lg:max-h-none">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-neutral-300">Graph Inspector</h2>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-neutral-950 border border-neutral-800 text-purple-400">
              {graphMode.toUpperCase()}
            </span>
          </div>

          {/* Stats Box */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-neutral-950 border border-neutral-800 p-2.5 rounded">
              <p className="text-[10px] text-neutral-500 font-mono uppercase">Triplet Edges</p>
              <p className="text-base font-bold font-mono text-white mt-0.5">{tripletEdges.length}</p>
            </div>
            <div className="bg-neutral-950 border border-neutral-800 p-2.5 rounded">
              <p className="text-[10px] text-neutral-500 font-mono uppercase">Vector Nodes</p>
              <p className="text-base font-bold font-mono text-white mt-0.5">{vectors.length}</p>
            </div>
          </div>

          {/* Auto-Cluster Communities Panel */}
          {autoCluster && clusterSummary.length > 0 && (
            <div className="bg-neutral-950 border border-neutral-800 p-3 rounded flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-[10px] font-mono font-bold text-purple-300 uppercase tracking-wider">
                    Semantic Clusters ({clusterSummary.length})
                  </span>
                </div>
                {selectedClusterId !== null && (
                  <button
                    type="button"
                    onClick={() => setSelectedClusterId(null)}
                    className="text-[10px] font-mono text-neutral-500 hover:text-white"
                  >
                    Clear Filter
                  </button>
                )}
              </div>
              <p className="text-[10px] text-neutral-400 font-mono">
                Nodes grouped by shared semantic edges into discrete clusters:
              </p>
              <div className="space-y-1.5 max-h-44 overflow-y-auto pr-0.5">
                {clusterSummary.map((c) => {
                  const isSelected = selectedClusterId === c.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        const newClusterId = isSelected ? null : c.id;
                        setSelectedClusterId(newClusterId);
                        if (newClusterId !== null) {
                          const firstNode = nodesRef.current.find((n) => n.clusterId === c.id);
                          if (firstNode) handleFocusNode(firstNode);
                        }
                      }}
                      className={`w-full p-2 rounded text-left text-[11px] font-mono flex items-center justify-between border transition-all cursor-pointer ${
                        isSelected
                          ? 'border-white bg-neutral-800 shadow-sm'
                          : 'border-neutral-800 bg-neutral-900/80 hover:border-neutral-700'
                      }`}
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ backgroundColor: c.color }}
                        />
                        <span className="text-white font-bold truncate">
                          Cluster #{c.id + 1}
                        </span>
                        <span className="text-neutral-400 text-[10px] truncate max-w-[80px]">
                          ({c.sampleLabel})
                        </span>
                      </div>
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded font-bold shrink-0"
                        style={{ backgroundColor: `${c.color}20`, color: c.color }}
                      >
                        {c.count} {c.count === 1 ? 'node' : 'nodes'}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Selection Details */}
          {selectedNode ? (
            <div className="bg-neutral-950 border border-neutral-800 p-3.5 rounded flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-sky-400 uppercase tracking-wider font-bold">Node Selected</span>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleFocusNode(selectedNode)}
                    className="p-1 text-neutral-400 hover:text-sky-300 transition-colors"
                    title="Center and Focus in Viewport"
                  >
                    <Crosshair className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedNode(null)}
                    className="text-[10px] text-neutral-500 hover:text-white"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div>
                <p className="text-[10px] text-neutral-400 font-mono uppercase">Label / Entity:</p>
                <p className="text-sm font-bold font-mono text-white break-all mt-0.5">{selectedNode.label}</p>
              </div>

              <div className="flex items-center justify-between text-xs font-mono">
                <div>
                  <span className="text-neutral-500">TYPE: </span>
                  <span className="text-emerald-400 font-bold uppercase">{selectedNode.type}</span>
                </div>
                {selectedNode.degree !== undefined && (
                  <div>
                    <span className="text-neutral-500">DEGREE: </span>
                    <span className="text-white font-bold">{selectedNode.degree}</span>
                  </div>
                )}
              </div>

              {autoCluster && selectedNode.clusterId !== undefined && (
                <div className="flex items-center justify-between text-xs font-mono bg-neutral-900/80 p-1.5 rounded border border-neutral-800">
                  <span className="text-neutral-400 text-[10px] uppercase">Semantic Cluster:</span>
                  <span
                    className="px-2 py-0.5 rounded font-bold text-[10px]"
                    style={{
                      backgroundColor: `${selectedNode.clusterColor || '#a855f7'}20`,
                      color: selectedNode.clusterColor || '#a855f7',
                      border: `1px solid ${selectedNode.clusterColor || '#a855f7'}40`
                    }}
                  >
                    Cluster #{selectedNode.clusterId + 1}
                  </span>
                </div>
              )}

              {selectedNode.text && (
                <div>
                  <p className="text-[10px] text-neutral-400 font-mono uppercase">Source Chunk Text:</p>
                  <p className="text-xs font-mono text-neutral-300 mt-1 bg-neutral-900 p-2.5 border border-neutral-800 rounded max-h-32 overflow-y-auto leading-relaxed">
                    {selectedNode.text}
                  </p>
                </div>
              )}

              {selectedNode.source && (
                <div>
                  <p className="text-[10px] text-neutral-400 font-mono uppercase">Source Document:</p>
                  <p className="text-xs font-mono text-amber-400 mt-0.5">{selectedNode.source}</p>
                </div>
              )}

              {/* Connected Semantic Triplet Edges for Selected Node */}
              {(() => {
                const nodeTriplets = tripletEdges.filter(
                  (te) => te.s === selectedNode.id || te.o === selectedNode.id || te.sourceId === selectedNode.id
                );
                return (
                  <div className="mt-2 pt-2 border-t border-neutral-800">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] font-mono text-sky-400 font-bold uppercase tracking-wider flex items-center gap-1">
                        <Share2 className="w-3 h-3 text-sky-400" />
                        <span>Connected Triplets ({nodeTriplets.length})</span>
                      </span>
                    </div>
                    {nodeTriplets.length > 0 ? (
                      <div className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                        {nodeTriplets.map((te) => (
                          <div
                            key={te.id}
                            onClick={() => {
                              setSelectedLink({
                                id: te.id,
                                source: te.s,
                                target: te.o,
                                label: te.r,
                                type: 'relation'
                              });
                            }}
                            className="p-2 rounded bg-neutral-900 border border-neutral-800 hover:border-sky-500 cursor-pointer text-[10px] font-mono flex items-center justify-between transition-colors"
                            title="Click to inspect this relationship"
                          >
                            <span className="text-sky-300 font-bold truncate max-w-[85px]">{te.s}</span>
                            <span className="text-neutral-500 text-[9px] px-1 truncate max-w-[60px]">
                              --{te.r}--&gt;
                            </span>
                            <span className="text-emerald-300 font-bold truncate max-w-[85px]">{te.o}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-[10px] font-mono text-neutral-500">
                        No direct entity triplet edges linked to this node.
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
          ) : selectedLink ? (
            <div className="bg-neutral-950 border border-neutral-800 p-3.5 rounded flex flex-col gap-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-purple-400 uppercase tracking-wider font-bold">Relationship Selected</span>
                <button
                  type="button"
                  onClick={() => setSelectedLink(null)}
                  className="text-[10px] text-neutral-500 hover:text-white"
                >
                  Clear
                </button>
              </div>
              <div>
                <p className="text-[10px] text-neutral-400 font-mono uppercase">Subject (Source Entity):</p>
                <p className="text-xs font-bold font-mono text-white mt-0.5 break-all">
                  {typeof selectedLink.source === 'object' ? (selectedLink.source as any).label : selectedLink.source}
                </p>
              </div>
              <div>
                <p className="text-[10px] text-neutral-400 font-mono uppercase">Predicate (Relation):</p>
                <p className="text-xs font-bold font-mono text-cyan-400 mt-0.5">{selectedLink.label || 'relates_to'}</p>
              </div>
              <div>
                <p className="text-[10px] text-neutral-400 font-mono uppercase">Object (Target Entity):</p>
                <p className="text-xs font-bold font-mono text-white mt-0.5 break-all">
                  {typeof selectedLink.target === 'object' ? (selectedLink.target as any).label : selectedLink.target}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-neutral-950 border border-neutral-800 p-4 rounded text-center flex flex-col items-center justify-center gap-2">
              <Info className="w-5 h-5 text-neutral-500" />
              <p className="text-xs font-mono text-neutral-400">Click any node or relationship link in the graph to inspect its semantic attributes.</p>
            </div>
          )}

          {/* Quick Tips */}
          <div className="mt-auto bg-neutral-950 border border-neutral-800 p-3 rounded text-[11px] text-neutral-400 font-mono leading-relaxed">
            <p className="font-bold text-neutral-300 mb-1 flex items-center gap-1">
              <ArrowRight className="w-3 h-3 text-sky-400" />
              <span>Interactive Navigation:</span>
            </p>
            <ul className="list-disc list-inside space-y-1 text-[10px]">
              <li>Drag any node to reposition it anywhere in the graph layout.</li>
              <li>Hover over any node to view its complete node text content.</li>
              <li>Double-click a dragged node to unpin it back into physics.</li>
              <li>Hover to isolate 1-hop connected neighbors & edges.</li>
              <li>Use Fit button to auto-frame all nodes in the viewport.</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
};
