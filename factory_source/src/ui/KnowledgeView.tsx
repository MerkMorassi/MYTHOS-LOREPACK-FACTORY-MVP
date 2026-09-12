
import React, { useState, useEffect, useRef } from 'react';
import { vectorDb, VectorRecord } from '../services/vectorDbService';
import { Agent } from '../services/agentService';
import { UploadIcon } from './icons/UploadIcon';
import { TrashIcon } from './icons/TrashIcon';
import { DatabaseIcon, LoadingSpinner, PlusIcon } from './icons.tsx';
import { factoryService as lorepackService } from '../services/lorepack';
import { GraphNode, GraphEdge, TripletEdge } from '../types.ts';

interface KnowledgeViewProps {
    agents: Agent[];
    onUpdateAgent: (id: string, updates: Partial<Agent>) => void;
    onCallAgent?: (agent: Agent) => void;
}

type StudioTab = 'overview' | 'vectors' | 'graph' | 'forge';

export const KnowledgeView: React.FC<KnowledgeViewProps> = ({ agents }) => {
    const [selectedAgentId, setSelectedAgentId] = useState<string>(agents.length > 0 ? agents[0].id : '');
    const selectedAgent = agents.find(a => a.id === selectedAgentId) || agents[0];
    const [activeTab, setActiveTab] = useState<StudioTab>('overview');

    // Stats / Data
    const [vectorCount, setVectorCount] = useState<number>(0);
    const [graphEdgeCount, setGraphEdgeCount] = useState<number>(0);
    const [graphNodeCount, setGraphNodeCount] = useState<number>(0); // Legacy graph nodes
    
    const [vectors, setVectors] = useState<VectorRecord[]>([]);
    const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]); // Legacy
    const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]); // Legacy
    const [tripletEdges, setTripletEdges] = useState<TripletEdge[]>([]);

    const [sources, setSources] = useState<string[]>([]);
    const [fileQueue, setFileQueue] = useState<File[]>([]);
    
    // NEW: Pagination State
    const [currentPage, setCurrentPage] = useState(1);


    // Operation State
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState(0);
    const [statusMessage, setStatusMessage] = useState('');
    
    // Forge State
    const [newNodeLabel, setNewNodeLabel] = useState('');
    const [newNodeDesc, setNewNodeDesc] = useState('');
    const [newEdgeSource, setNewEdgeSource] = useState('');
    const [newEdgeTarget, setNewEdgeTarget] = useState('');
    const [newEdgeLabel, setNewEdgeLabel] = useState('');

    const fileInputRef = useRef<HTMLInputElement>(null);
    const importFileInputRef = useRef<HTMLInputElement>(null);
    const abortControllerRef = useRef<AbortController | null>(null);

    useEffect(() => {
        if (selectedAgentId) {
            setCurrentPage(1); // Reset page on agent change
            refreshData(selectedAgentId);
        }
    }, [selectedAgentId]);

    const refreshData = async (agentId: string) => {
        if (!agentId) return;
        try {
            const stats = await lorepackService.getStats(agentId);
            const v = await vectorDb.getVectorsByAgent(agentId);
            const n = await vectorDb.getGraphNodesByAgent(agentId);
            const e = await vectorDb.getTripletEdgesByAgent(agentId);

            setVectors(v);
            setGraphNodes(n);
            setTripletEdges(e);
            
            setVectorCount(stats.totalNodes);
            setGraphEdgeCount(stats.totalEdges);
            setGraphNodeCount(n.length);

            const uniqueSources = Array.from(new Set(v.map(item => item.source)));
            setSources(uniqueSources);
        } catch (e) {
            console.error("Failed to load LorePack data", e);
        }
    };

    const stageFiles = (files: FileList | null) => {
      const list = Array.from(files || []);
      if (!list.length) return;
      setFileQueue(prev => [...prev, ...list]);
    };

    const runIngest = async () => {
        if (!selectedAgentId || fileQueue.length === 0) {
            alert("Agent ID required and files must be staged.");
            return;
        }

        abortControllerRef.current = new AbortController();
        setIsProcessing(true);
        setProgress(0);
        setStatusMessage('Initializing Ingestion...');

        try {
            const tasks = [];
            for (const f of fileQueue) {
                const text = await f.text();
                const chunks = lorepackService.chunk(text);
                for (const c of chunks) tasks.push({ text: c, source: f.name });
            }
            
            await lorepackService.ingestBatches(tasks, {
                agentId: selectedAgentId,
                signal: abortControllerRef.current.signal,
                onProgress: ({ processed, total }) => {
                    setProgress(Math.round((processed / total) * 100));
                    setStatusMessage(`Ingesting ${processed}/${total} chunks...`);
                }
            });
            
            setStatusMessage('Ingestion complete!');
            setFileQueue([]);
            await refreshData(selectedAgentId);
        } catch (error: any) {
            console.error(error);
            setStatusMessage(`Error: ${error.message}`);
        } finally {
            setTimeout(() => setIsProcessing(false), 2000);
        }
    };
    
    const runImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];

        setIsProcessing(true);
        setProgress(0);
        setStatusMessage(`Importing ${file.name}...`);
        
        // Fetch initial counts to provide a baseline for the dynamic update.
        const initialStats = await lorepackService.getStats(selectedAgentId);

        try {
            const summary = await lorepackService.importLorepack(file, selectedAgentId, ({ processed, vectors, edges }) => {
                setStatusMessage(`Processed ${processed} items...`);
                // Dynamically update the stat cards in real-time during the import.
                setVectorCount(initialStats.totalNodes + vectors);
                setGraphEdgeCount(initialStats.totalEdges + edges);
            });
            setStatusMessage(`Import complete! Ingested ${summary.importedVectors} nodes & ${summary.importedEdges} edges.`);
            
            // Perform a final, full refresh to ensure all data (for all tabs) is consistent.
            await refreshData(selectedAgentId);
            setFileQueue([]); // Clear the file staging queue after successful import.
        } catch (error: any) {
            console.error(error);
            setStatusMessage(`Error: ${error.message}`);
            // In case of error, roll back the stats to their pre-import state.
            setVectorCount(initialStats.totalNodes);
            setGraphEdgeCount(initialStats.totalEdges);
        } finally {
            setTimeout(() => setIsProcessing(false), 3000);
            if (e.target) e.target.value = '';
        }
    };

    const handleExport = async () => {
        if (!selectedAgentId) return alert("Agent ID required.");
        
        setIsProcessing(true);
        setStatusMessage('Exporting LorePack...');
        setProgress(0);
        try {
            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                async start(controller) {
                    let count = 0;
                    for await (const batch of lorepackService.yieldExportBatches(selectedAgentId, 500)) {
                        const lines = batch.map(obj => JSON.stringify(obj)).join('\n') + '\n';
                        controller.enqueue(encoder.encode(lines));
                        count += batch.length;
                        setStatusMessage(`Exported ${count} items...`);
                    }
                    controller.close();
                }
            });
            const gz = stream.pipeThrough(new CompressionStream('gzip'));
            const blob = await new Response(gz).blob();
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `LOREPACK_${selectedAgent.name.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.jsonl.gz`;
            a.click();
            URL.revokeObjectURL(a.href);
            setStatusMessage('Export complete.');
        } catch (e: any) {
             setStatusMessage(`Error: ${e.message}`);
        } finally {
            setTimeout(() => setIsProcessing(false), 2000);
        }
    };
    
    const buildGraph = async () => {
        if (!selectedAgentId) return alert("Agent ID required.");
        setIsProcessing(true);
        setStatusMessage('Building graph...');
        setProgress(0);
        try {
            await lorepackService.buildGraphLite(selectedAgentId, (curr, total, created) => {
                setProgress(Math.round((curr / total) * 100));
                setStatusMessage(`Analyzed ${curr}/${total} nodes | ${created} edges found`);
            });
            setStatusMessage('Graph build complete.');
            await refreshData(selectedAgentId);
        } catch (e: any) {
            setStatusMessage(`Error: ${e.message}`);
        } finally {
            setTimeout(() => setIsProcessing(false), 2000);
        }
    };

    const handleAddNode = async () => {
        if (!newNodeLabel.trim() || !selectedAgentId) return;
        const node: GraphNode = {
            id: crypto.randomUUID(),
            label: newNodeLabel,
            description: newNodeDesc,
            agentId: selectedAgentId,
            name: newNodeLabel
        };
        await vectorDb.addGraphNodes([node]);
        setNewNodeLabel('');
        setNewNodeDesc('');
        await refreshData(selectedAgentId);
    };

    const handleAddEdge = async () => {
        if (!newEdgeSource || !newEdgeTarget || !newEdgeLabel.trim() || !selectedAgentId) return;
        const edge: GraphEdge = {
            source: newEdgeSource,
            target: newEdgeTarget,
            label: newEdgeLabel,
            agentId: selectedAgentId
        };
        await vectorDb.addGraphEdges([edge]);
        setNewEdgeSource('');
        setNewEdgeTarget('');
        setNewEdgeLabel('');
        await refreshData(selectedAgentId);
    };

    const handlePurge = async () => {
        if(!selectedAgentId) return alert("Select an agent first.");
        if(confirm(`DANGER: Vaporize entire memory vault and graph for ${selectedAgent.name}? This cannot be undone.`)) { 
            await vectorDb.clearVectors(selectedAgentId); 
            await vectorDb.deleteGraphForAgent(selectedAgentId); 
            await refreshData(selectedAgentId);
        }
    };
    
    const fileQueueSize = fileQueue.reduce((acc, f) => acc + f.size, 0);

    return (
        <div className="flex flex-col h-full bg-primary overflow-hidden">
            {/* STUDIO HEADER */}
            <div className="flex-shrink-0 p-6 border-b border-accent bg-neutral-900/90 backdrop-blur-md z-10">
                <div className="flex justify-between items-center mb-6">
                    <div>
                        <h1 className="text-3xl font-black text-white uppercase tracking-tighter flex items-center gap-3">
                            <DatabaseIcon className="w-8 h-8 text-blue-500" />
                            LorePack Factory
                        </h1>
                        <p className="text-neutral-500 text-xs font-mono mt-1">
                           SOVEREIGN KERNEL & GRAPH MAGRAG • {selectedAgent?.name?.toUpperCase() || "NO AGENT"}
                        </p>
                    </div>
                    
                    <div className="flex items-center gap-4">
                        <select 
                            value={selectedAgentId} 
                            onChange={(e) => setSelectedAgentId(e.target.value)}
                            className="bg-black text-white font-bold border border-accent rounded-lg px-4 py-2 outline-none text-sm hover:border-blue-500 transition-colors"
                        >
                            {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <button onClick={handleExport} className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors border border-neutral-700">
                            Export (GZIP)
                        </button>
                         <button onClick={() => importFileInputRef.current?.click()} className="bg-neutral-800 hover:bg-neutral-700 text-white px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-wider transition-colors border border-neutral-700">
                            Import (GZIP)
                        </button>
                        <input type="file" ref={importFileInputRef} accept=".gz,.jsonl,.json" className="hidden" onChange={runImport} />
                    </div>
                </div>

                {/* TABS */}
                <div className="flex gap-1 bg-black/40 p-1 rounded-xl border border-neutral-800 w-fit">
                    {[
                        { id: 'overview', label: 'Factory' },
                        { id: 'vectors', label: 'Sacred Archive' },
                        { id: 'graph', label: 'Neural Graph' },
                        { id: 'forge', label: 'Graph Forge' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setActiveTab(tab.id as StudioTab)}
                            className={`px-6 py-2 rounded-lg text-xs font-black uppercase tracking-widest transition-all ${
                                activeTab === tab.id 
                                    ? 'bg-blue-600 text-white shadow-lg' 
                                    : 'text-neutral-500 hover:text-white hover:bg-neutral-800'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* CONTENT AREA */}
            <div className="flex-grow overflow-y-auto p-8 custom-scrollbar bg-[url('https://transparenttextures.com/patterns/cubes.png')] bg-fixed">
                
                {activeTab === 'overview' && (
                    <div className="space-y-8 max-w-5xl mx-auto">
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                           <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col justify-center text-center group transition-all col-span-1">
                                <span className="text-4xl font-black text-white mb-2">{vectorCount}</span>
                                <span className="text-[10px] text-blue-400 font-bold uppercase tracking-widest">Vector Nodes</span>
                            </div>
                             <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col justify-center text-center group transition-all col-span-1">
                                <span className="text-4xl font-black text-white mb-2">{graphEdgeCount}</span>
                                <span className="text-[10px] text-purple-400 font-bold uppercase tracking-widest">Triplet Edges</span>
                            </div>
                            <div className="bg-neutral-900 border border-neutral-800 p-6 rounded-2xl flex flex-col justify-center text-center group transition-all col-span-2">
                                <span className="text-4xl font-black text-white mb-2">{fileQueue.length} <span className="text-lg">files</span> / {(fileQueueSize / (1024*1024)).toFixed(2)} <span className="text-lg">MB</span></span>
                                <span className="text-[10px] text-amber-400 font-bold uppercase tracking-widest">Files Staged</span>
                            </div>
                        </div>
                        
                        <div className="bg-neutral-900/80 border border-neutral-800 rounded-2xl p-8 backdrop-blur-md">
                            <h2 className="text-sm font-black text-white uppercase tracking-widest mb-6 border-b border-neutral-800 pb-4">Factory Pipeline</h2>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div 
                                    onClick={() => !isProcessing && fileInputRef.current?.click()}
                                    className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer group ${isProcessing ? 'border-neutral-700 opacity-50' : 'bg-black/20 border-neutral-700 hover:border-blue-500 hover:bg-neutral-800'}`}
                                >
                                    <input type="file" ref={fileInputRef} multiple className="hidden" onChange={(e) => stageFiles(e.target.files)} />
                                    <UploadIcon className="w-8 h-8 text-neutral-500 group-hover:text-blue-400 mb-4 transition-colors" />
                                    <span className="font-bold text-neutral-300 group-hover:text-white uppercase text-xs tracking-widest">1. Stage Files</span>
                                    <p className="text-[10px] text-neutral-500 mt-2 uppercase font-bold">TXT, MD, JSON, JSONL</p>
                                </div>

                                 <button
                                    onClick={runIngest} disabled={isProcessing || fileQueue.length === 0}
                                    className="border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer group bg-black/20 border-neutral-700 hover:border-blue-500 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    <DatabaseIcon className="w-8 h-8 text-neutral-500 group-hover:text-blue-400 mb-4 transition-colors" />
                                    <span className="font-bold text-neutral-300 group-hover:text-white uppercase text-xs tracking-widest">2. Ingest Lore</span>
                                     <p className="text-[10px] text-neutral-500 mt-2 uppercase font-bold">Chunks & Embeds</p>
                                </button>
                            </div>

                            <div className="mt-6">
                                <button onClick={buildGraph} disabled={isProcessing || vectorCount === 0} className="w-full border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center transition-all cursor-pointer group bg-black/20 border-neutral-700 hover:border-purple-500 hover:bg-neutral-800 disabled:opacity-50 disabled:cursor-not-allowed">
                                    <DatabaseIcon className="w-8 h-8 text-neutral-500 group-hover:text-purple-400 mb-4 transition-colors" />
                                    <span className="font-bold text-neutral-300 group-hover:text-white uppercase text-xs tracking-widest">3. Build Graph Lite (MAGRAG)</span>
                                    <p className="text-[10px] text-neutral-500 mt-2 uppercase font-bold">Extracts Semantic Triplets (S-R-O)</p>
                                </button>
                            </div>
                        </div>

                        {isProcessing && (
                             <div className="fixed bottom-10 right-10 z-50 bg-neutral-900 border border-accent rounded-xl p-4 w-96 shadow-2xl">
                                <div className="flex items-center gap-3">
                                    <LoadingSpinner className="w-6 h-6 text-blue-500" />
                                    <p className="text-blue-400 font-bold uppercase text-xs animate-pulse tracking-widest">{statusMessage}</p>
                                </div>
                                <div className="w-full h-1.5 bg-neutral-800 rounded-full overflow-hidden mt-3">
                                    <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${progress}%` }}></div>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end mt-8">
                            <button onClick={handlePurge} className="flex items-center gap-2 text-xs font-bold text-red-500 hover:text-red-400 uppercase tracking-widest px-4 py-2 hover:bg-red-900/20 rounded-lg transition-colors border border-red-900/30">
                                <TrashIcon className="w-4 h-4" /> Purge Agent Memory
                            </button>
                        </div>
                    </div>
                )}
                
                {activeTab === 'vectors' && (() => {
                    const ITEMS_PER_PAGE = 20;
                    const totalPages = Math.ceil(vectors.length / ITEMS_PER_PAGE);
                    const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
                    const paginatedVectors = vectors.slice(startIndex, startIndex + ITEMS_PER_PAGE);

                    return (
                        <div className="max-w-6xl mx-auto space-y-6">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-sm font-black text-neutral-400 uppercase tracking-widest">Source Registry</h3>
                                <span className="text-xs text-neutral-500 font-mono">{sources.length} Sources</span>
                            </div>
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                                {sources.map(s => (
                                    <div key={s} className="bg-neutral-900 border border-neutral-800 px-3 py-2 rounded text-xs text-neutral-300 truncate flex justify-between items-center group">
                                        <span className="truncate flex-grow" title={s}>{s}</span>
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-2">
                                <h3 className="text-sm font-black text-neutral-400 uppercase tracking-widest mb-4">Vector Stream ({vectors.length})</h3>
                                {paginatedVectors.map(v => (
                                    <div key={v.id as string} className="bg-neutral-900/80 border border-neutral-800 p-4 rounded-lg hover:border-blue-500/30 transition-colors">
                                        <div className="flex justify-between mb-2">
                                            <span className="text-[10px] text-blue-400 font-bold uppercase tracking-wider">{v.source}</span>
                                            <span className="text-[10px] text-neutral-600 font-mono">{String(v.id).substring(0,8)}</span>
                                        </div>
                                        <p className="text-xs text-neutral-300 font-mono line-clamp-2">{v.text}</p>
                                    </div>
                                ))}
                                {vectors.length === 0 && (
                                     <div className="text-center py-12 text-neutral-600">
                                        <p>No vectors found for this agent.</p>
                                     </div>
                                )}
                                {totalPages > 1 && (
                                    <div className="flex justify-between items-center mt-6 pt-4 border-t border-neutral-800">
                                        <button
                                            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                            disabled={currentPage === 1}
                                            className="px-4 py-2 text-xs font-bold text-neutral-300 bg-neutral-800 rounded-lg hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            &larr; Previous
                                        </button>
                                        <span className="text-xs font-mono text-neutral-500">
                                            Page {currentPage} of {totalPages}
                                        </span>
                                        <button
                                            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                            disabled={currentPage === totalPages}
                                            className="px-4 py-2 text-xs font-bold text-neutral-300 bg-neutral-800 rounded-lg hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            Next &rarr;
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })()}

                {activeTab === 'graph' && (
                     <div className="h-full flex flex-col">
                        <div className="flex-shrink-0 flex justify-between items-center mb-4 px-4">
                            <h3 className="text-sm font-black text-neutral-400 uppercase tracking-widest">Neural Graph Topology</h3>
                            <div className="text-xs text-neutral-500 space-x-4">
                                <span>{vectorCount} Nodes</span>
                                <span>{graphEdgeCount} Connections</span>
                            </div>
                        </div>
                        <div className="flex-grow bg-black/60 rounded-2xl border border-neutral-800 overflow-y-auto p-4 custom-scrollbar">
                           {tripletEdges.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-neutral-600 font-bold uppercase tracking-widest text-sm">
                                    Graph Empty - Use 'Build Graph Lite'
                                </div>
                            ) : (
                                <div className="space-y-2">
                                {tripletEdges.slice(0, 200).map(edge => (
                                    <div key={edge.id} className="font-mono text-xs flex items-center gap-2 p-2 bg-neutral-900/50 rounded hover:bg-neutral-800">
                                        <span className="text-blue-400 bg-blue-900/20 px-2 py-1 rounded">{edge.s}</span>
                                        <span className="text-neutral-500">──</span>
                                        <span className="text-purple-400 font-bold">{edge.r}</span>
                                        <span className="text-neutral-500">──&gt;</span>
                                        <span className="text-green-400 bg-green-900/20 px-2 py-1 rounded">{edge.o}</span>
                                    </div>
                                ))}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                
                {activeTab === 'forge' && (
                    <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div className="bg-neutral-900/90 border border-neutral-800 p-6 rounded-2xl shadow-xl">
                            <h3 className="text-sm font-black text-green-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                <PlusIcon className="w-4 h-4" /> Create Node (Legacy)
                            </h3>
                            <div className="space-y-4">
                                <input type="text" value={newNodeLabel} onChange={e => setNewNodeLabel(e.target.value)} placeholder="Label / Entity Name" className="w-full bg-black border border-neutral-700 rounded-lg p-3 text-sm text-white focus:border-green-500 outline-none" />
                                <textarea value={newNodeDesc} onChange={e => setNewNodeDesc(e.target.value)} placeholder="Description / Context..." className="w-full bg-black border border-neutral-700 rounded-lg p-3 text-sm text-white focus:border-green-500 outline-none h-24 resize-none" />
                                <button onClick={handleAddNode} disabled={!newNodeLabel} className="w-full py-3 bg-green-700 hover:bg-green-600 text-white font-bold rounded-lg uppercase text-xs tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">Forge Node</button>
                            </div>
                        </div>

                        <div className="bg-neutral-900/90 border border-neutral-800 p-6 rounded-2xl shadow-xl">
                            <h3 className="text-sm font-black text-blue-400 uppercase tracking-widest mb-6 flex items-center gap-2">
                                <DatabaseIcon className="w-4 h-4" /> Link Nodes (Legacy)
                            </h3>
                            <div className="space-y-4">
                                <select value={newEdgeSource} onChange={e => setNewEdgeSource(e.target.value)} className="w-full bg-black border border-neutral-700 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none">
                                    <option value="">Select Source Node...</option>
                                    {graphNodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                                </select>
                                <select value={newEdgeTarget} onChange={e => setNewEdgeTarget(e.target.value)} className="w-full bg-black border border-neutral-700 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none">
                                    <option value="">Select Target Node...</option>
                                    {graphNodes.map(n => <option key={n.id} value={n.id}>{n.label}</option>)}
                                </select>
                                <input type="text" value={newEdgeLabel} onChange={e => setNewEdgeLabel(e.target.value)} placeholder="Relationship Label (e.g. 'owns', 'knows')" className="w-full bg-black border border-neutral-700 rounded-lg p-3 text-sm text-white focus:border-blue-500 outline-none" />
                                <button onClick={handleAddEdge} disabled={!newEdgeSource || !newEdgeTarget || !newEdgeLabel} className="w-full py-3 bg-blue-700 hover:bg-blue-600 text-white font-bold rounded-lg uppercase text-xs tracking-widest disabled:opacity-50 disabled:cursor-not-allowed">Forge Link</button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
