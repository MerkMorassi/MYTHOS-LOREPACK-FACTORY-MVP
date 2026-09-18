import React, { useState, useEffect, useRef } from 'react';
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
  Layers, 
  Activity, 
  RefreshCw,
  Info
} from 'lucide-react';

interface NetworkGraphViewProps {
  agents: readonly CanonicalAgent[];
  activeAgentId?: string;
  store: IndexedDbLorepackStore | null;
  factory: LorepackFactory | null;
}

interface SimNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: 'entity' | 'chunk' | 'source';
  group?: number;
  val?: number;
  text?: string;
  source?: string;
  x?: number;
  y?: number;
}

interface SimLink extends d3.SimulationLinkDatum<SimNode> {
  id?: string;
  source: string | SimNode;
  target: string | SimNode;
  label?: string;
  type?: 'relation' | 'contains' | 'source';
}

export const NetworkGraphView: React.FC<NetworkGraphViewProps> = ({ 
  agents, 
  activeAgentId: initialAgentId,
  store,
  factory
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
  
  const svgRef = useRef<SVGSVGElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const simulationRef = useRef<d3.Simulation<SimNode, SimLink> | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity);

  useEffect(() => {
    if (selectedAgentId && store) {
      loadGraphData(selectedAgentId);
    }
  }, [selectedAgentId, store]);

  const loadGraphData = async (agentId: string) => {
    if (!store) return;
    setLoading(true);
    try {
      const v = await store.getVectorsByAgent(agentId);
      const e = await store.getTripletEdgesByAgent(agentId);
      setVectors(v);
      setTripletEdges(e);
    } catch (err) {
      console.error("Failed to load network graph data:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (loading || !svgRef.current || !wrapperRef.current) return;

    const width = wrapperRef.current.clientWidth || 900;
    const height = wrapperRef.current.clientHeight || 650;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Build nodes and links based on mode
    const nodeMap = new Map<string, SimNode>();
    const links: SimLink[] = [];

    if (graphMode === 'triplets' && tripletEdges.length > 0) {
      for (const edge of tripletEdges) {
        const sId = (edge.s || 'UNKNOWN').trim();
        const oId = (edge.o || 'UNKNOWN').trim();

        if (!nodeMap.has(sId)) {
          nodeMap.set(sId, { id: sId, label: sId, type: 'entity', group: 1, val: 1 });
        } else {
          const n = nodeMap.get(sId)!;
          n.val = (n.val || 1) + 1;
        }

        if (!nodeMap.has(oId)) {
          nodeMap.set(oId, { id: oId, label: oId, type: 'entity', group: 2, val: 1 });
        } else {
          const n = nodeMap.get(oId)!;
          n.val = (n.val || 1) + 1;
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
      // Mesh mode: include vectors and source groups
      for (const vec of vectors.slice(0, 150)) {
        const vId = vec.id;
        const shortText = vec.text.slice(0, 30) + '...';
        nodeMap.set(vId, {
          id: vId,
          label: shortText,
          type: 'chunk',
          group: 3,
          text: vec.text,
          source: vec.source
        });

        if (vec.source) {
          const srcId = `src:${vec.source}`;
          if (!nodeMap.has(srcId)) {
            nodeMap.set(srcId, { id: srcId, label: vec.source, type: 'source', group: 4 });
          }
          links.push({
            source: vId,
            target: srcId,
            type: 'source'
          });
        }
      }

      // Also add triplet edges if any
      for (const edge of tripletEdges.slice(0, 80)) {
        const sId = (edge.s || 'UNKNOWN').trim();
        const oId = (edge.o || 'UNKNOWN').trim();
        if (!nodeMap.has(sId)) nodeMap.set(sId, { id: sId, label: sId, type: 'entity', group: 1 });
        if (!nodeMap.has(oId)) nodeMap.set(oId, { id: oId, label: oId, type: 'entity', group: 2 });
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

    if (nodes.length === 0) {
      svg.append('text')
        .attr('x', width / 2)
        .attr('y', height / 2)
        .attr('text-anchor', 'middle')
        .attr('fill', '#737373')
        .attr('font-family', 'monospace')
        .attr('font-size', '14px')
        .text('No semantic nodes or edges found. Ingest lore or build graph first.');
      return;
    }

    // Container group for zoom/pan
    const g = svg.append('g').attr('class', 'graph-container');

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        transformRef.current = event.transform;
        g.attr('transform', event.transform);
      });

    zoomRef.current = zoom;
    svg.call(zoom);
    svg.call(zoom.transform, transformRef.current);

    // Simulation
    const simulation = d3.forceSimulation<SimNode, SimLink>(nodes)
      .force('link', d3.forceLink<SimNode, SimLink>(links).id(d => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    simulationRef.current = simulation;

    // Arrow marker definition
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 22)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#525252');

    // Draw links
    const link = g.append('g')
      .attr('class', 'links')
      .selectAll('line')
      .data(links)
      .enter()
      .append('line')
      .attr('stroke', '#404040')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => d.type === 'relation' ? 1.5 : 1)
      .attr('marker-end', d => d.type === 'relation' ? 'url(#arrow)' : null)
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedLink(d);
        setSelectedNode(null);
      });

    // Link labels for relations
    const linkLabels = g.append('g')
      .attr('class', 'link-labels')
      .selectAll('text')
      .data(links.filter(d => !!d.label))
      .enter()
      .append('text')
      .attr('font-family', 'monospace')
      .attr('font-size', '9px')
      .attr('fill', '#a3a3a3')
      .attr('text-anchor', 'middle')
      .text(d => d.label || '');

    // Draw node groups
    const node = g.append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, SimNode>('g')
      .data(nodes)
      .enter()
      .append('g')
      .call(d3.drag<SVGGElement, SimNode>()
        .on('start', (event, d) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      )
      .on('click', (event, d) => {
        event.stopPropagation();
        setSelectedNode(d);
        setSelectedLink(null);
      });

    // Node circles
    node.append('circle')
      .attr('r', d => d.type === 'entity' ? Math.min(8 + (d.val || 1) * 2, 22) : 10)
      .attr('fill', d => {
        if (d.type === 'entity') return '#0ea5e9'; // Cyan/Blue
        if (d.type === 'chunk') return '#10b981';  // Emerald
        return '#f59e0b'; // Amber for sources
      })
      .attr('stroke', d => {
        if (searchTerm && d.label.toLowerCase().includes(searchTerm.toLowerCase())) {
          return '#ff3300';
        }
        return '#262626';
      })
      .attr('stroke-width', d => searchTerm && d.label.toLowerCase().includes(searchTerm.toLowerCase()) ? 3 : 1.5);

    // Node labels
    node.append('text')
      .attr('dx', 14)
      .attr('dy', '.35em')
      .attr('font-family', 'monospace')
      .attr('font-size', '11px')
      .attr('fill', '#e5e5e5')
      .text(d => {
        const lbl = d.label;
        return lbl.length > 24 ? lbl.slice(0, 22) + '...' : lbl;
      });

    // Simulation tick
    simulation.on('tick', () => {
      link
        .attr('x1', d => (d.source as SimNode).x || 0)
        .attr('y1', d => (d.source as SimNode).y || 0)
        .attr('x2', d => (d.target as SimNode).x || 0)
        .attr('y2', d => (d.target as SimNode).y || 0);

      linkLabels
        .attr('x', d => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          return ((s.x || 0) + (t.x || 0)) / 2;
        })
        .attr('y', d => {
          const s = d.source as SimNode;
          const t = d.target as SimNode;
          return ((s.y || 0) + (t.y || 0)) / 2;
        });

      node.attr('transform', d => `translate(${d.x || 0}, ${d.y || 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [loading, vectors, tripletEdges, graphMode, searchTerm]);

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

  const handleRestartSimulation = () => {
    if (simulationRef.current) {
      simulationRef.current.alpha(1).restart();
    }
  };

  return (
    <main className="flex-1 flex flex-col w-full bg-neutral-950 text-neutral-100 min-h-[calc(100vh-130px)]">
      {/* Top Header Bar */}
      <div className="bg-neutral-900 border-b border-neutral-800 px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Share2 className="w-5 h-5 text-purple-400" />
            <h1 className="text-base font-bold font-mono tracking-wide">Semantic Network Graph (D3 Force)</h1>
          </div>
          <p className="text-xs text-neutral-400 mt-1">
            Interactive physics simulation displaying entity relationships, semantic triplets, and vector node meshes.
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
              className={`px-3 py-1 text-xs font-mono transition-colors ${
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
              className={`px-3 py-1 text-xs font-mono transition-colors ${
                graphMode === 'mesh'
                  ? 'bg-purple-600 text-white font-bold'
                  : 'text-neutral-400 hover:text-white'
              }`}
            >
              Vector Mesh ({vectors.length})
            </button>
          </div>

          <button
            type="button"
            onClick={() => loadGraphData(selectedAgentId)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-xs font-mono border border-neutral-700 transition-colors"
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
              <p className="text-xs font-mono text-neutral-400">Loading network graph data...</p>
            </div>
          ) : null}

          {/* Floating Control Toolbar */}
          <div className="absolute top-4 left-4 z-10 flex flex-col gap-2 bg-neutral-900/90 border border-neutral-800 p-1.5 backdrop-blur shadow-lg">
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-2 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors"
              title="Zoom In"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-2 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors"
              title="Zoom Out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="p-2 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors"
              title="Reset View"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={handleRestartSimulation}
              className="p-2 hover:bg-neutral-800 text-neutral-300 hover:text-white transition-colors"
              title="Restart Physics Simulation"
            >
              <Activity className="w-4 h-4 text-emerald-400" />
            </button>
          </div>

          {/* Floating Search Filter */}
          <div className="absolute top-4 right-4 z-10 flex items-center gap-2 bg-neutral-900/90 border border-neutral-800 px-3 py-2 backdrop-blur shadow-lg">
            <Search className="w-3.5 h-3.5 text-neutral-400" />
            <input
              type="text"
              placeholder="Filter node label..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-transparent text-xs font-mono text-white placeholder-neutral-500 focus:outline-none w-44"
            />
          </div>

          {/* SVG Canvas */}
          <svg ref={svgRef} className="w-full h-full cursor-grab active:cursor-grabbing" />

          {/* Legend Overlay */}
          <div className="absolute bottom-4 left-4 z-10 bg-neutral-900/90 border border-neutral-800 px-3 py-2 text-[10px] font-mono text-neutral-400 flex items-center gap-4 backdrop-blur">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-sky-500 inline-block"></span>
              <span>Entity Node</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block"></span>
              <span>Vector Chunk</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block"></span>
              <span>Source Doc</span>
            </div>
          </div>
        </div>

        {/* Inspector Sidebar */}
        <div className="w-full lg:w-80 bg-neutral-900 border-t lg:border-t-0 lg:border-l border-neutral-800 p-4 flex flex-col gap-4 overflow-y-auto max-h-[300px] lg:max-h-none">
          <div className="flex items-center justify-between border-b border-neutral-800 pb-3">
            <h2 className="text-xs font-bold font-mono uppercase tracking-wider text-neutral-300">Graph Inspector</h2>
            <span className="text-[10px] font-mono px-2 py-0.5 bg-neutral-950 border border-neutral-800 text-purple-400">
              {graphMode.toUpperCase()}
            </span>
          </div>

          {/* Stats Box */}
          <div className="grid grid-cols-2 gap-2">
            <div className="bg-neutral-950 border border-neutral-800 p-2.5">
              <p className="text-[10px] text-neutral-500 font-mono">TRIPLET EDGES</p>
              <p className="text-base font-bold font-mono text-white mt-0.5">{tripletEdges.length}</p>
            </div>
            <div className="bg-neutral-950 border border-neutral-800 p-2.5">
              <p className="text-[10px] text-neutral-500 font-mono">VECTOR NODES</p>
              <p className="text-base font-bold font-mono text-white mt-0.5">{vectors.length}</p>
            </div>
          </div>

          {/* Selection Details */}
          {selectedNode ? (
            <div className="bg-neutral-950 border border-neutral-800 p-3 flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono text-purple-400 uppercase tracking-wider font-bold">Node Selected</span>
                <button
                  type="button"
                  onClick={() => setSelectedNode(null)}
                  className="text-[10px] text-neutral-500 hover:text-white"
                >
                  Clear
                </button>
              </div>
              <div>
                <p className="text-xs text-neutral-400 font-mono">ID / Label:</p>
                <p className="text-sm font-bold font-mono text-white break-all mt-0.5">{selectedNode.label}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-400 font-mono">Type:</p>
                <p className="text-xs font-mono text-emerald-400 mt-0.5">{selectedNode.type.toUpperCase()}</p>
              </div>
              {selectedNode.text && (
                <div>
                  <p className="text-xs text-neutral-400 font-mono">Source Chunk Text:</p>
                  <p className="text-xs font-mono text-neutral-300 mt-1 bg-neutral-900 p-2 border border-neutral-800 max-h-32 overflow-y-auto leading-relaxed">
                    {selectedNode.text}
                  </p>
                </div>
              )}
              {selectedNode.source && (
                <div>
                  <p className="text-xs text-neutral-400 font-mono">Source Document:</p>
                  <p className="text-xs font-mono text-amber-400 mt-0.5">{selectedNode.source}</p>
                </div>
              )}
            </div>
          ) : selectedLink ? (
            <div className="bg-neutral-950 border border-neutral-800 p-3 flex flex-col gap-2">
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
                <p className="text-xs text-neutral-400 font-mono">Subject (Source):</p>
                <p className="text-xs font-bold font-mono text-white mt-0.5">
                  {typeof selectedLink.source === 'object' ? selectedLink.source.label : selectedLink.source}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-400 font-mono">Relationship (Predicate):</p>
                <p className="text-xs font-bold font-mono text-cyan-400 mt-0.5">{selectedLink.label || 'relates_to'}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-400 font-mono">Object (Target):</p>
                <p className="text-xs font-bold font-mono text-white mt-0.5">
                  {typeof selectedLink.target === 'object' ? selectedLink.target.label : selectedLink.target}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-neutral-950 border border-neutral-800 p-4 text-center flex flex-col items-center justify-center gap-2">
              <Info className="w-5 h-5 text-neutral-500" />
              <p className="text-xs font-mono text-neutral-400">Click any node or relationship link in the graph to inspect its semantic attributes.</p>
            </div>
          )}

          {/* Quick Tips */}
          <div className="mt-auto bg-neutral-950 border border-neutral-800 p-3 text-[11px] text-neutral-400 font-mono leading-relaxed">
            <p className="font-bold text-neutral-300 mb-1">Graph Navigation Tips:</p>
            <ul className="list-disc list-inside space-y-1 text-[10px]">
              <li>Drag nodes to rearrange physics layout.</li>
              <li>Scroll to zoom in / out.</li>
              <li>Click & drag canvas to pan view.</li>
            </ul>
          </div>
        </div>
      </div>
    </main>
  );
};
