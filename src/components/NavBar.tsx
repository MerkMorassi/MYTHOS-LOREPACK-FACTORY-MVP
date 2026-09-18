import React from 'react';
import {
  Terminal,
  Cpu,
  Layers,
  Database,
  Archive,
  CheckCircle2,
  LayoutGrid,
  Share2,
} from 'lucide-react';

export type AppSectionTab =
  | 'monolithic'
  | 'workspace'
  | 'ingest'
  | 'explorer'
  | 'transport'
  | 'test-matrix'
  | 'graph-view'
  | 'all';

interface NavBarProps {
  activeTab: AppSectionTab;
  onSelectTab: (tab: AppSectionTab) => void;
  stats: { totalNodes: number; totalEdges: number };
  activeAgentId: string;
}

export const NavBar: React.FC<NavBarProps> = ({
  activeTab,
  onSelectTab,
  stats,
  activeAgentId,
}) => {
  const tabs: {
    id: AppSectionTab;
    label: string;
    shortLabel: string;
    icon: React.ReactNode;
    badge?: string | number;
    highlight?: boolean;
    tag?: string;
  }[] = [
    {
      id: 'monolithic',
      label: 'Monolithic Style',
      shortLabel: 'Monolithic',
      icon: <Terminal className="w-3.5 h-3.5 text-[#ff3300]" />,
      highlight: true,
      tag: 'CLASSIC',
    },
    {
      id: 'workspace',
      label: 'Workspace & Agents',
      shortLabel: 'Workspace',
      icon: <Cpu className="w-3.5 h-3.5 text-neutral-400" />,
      badge: activeAgentId,
    },
    {
      id: 'ingest',
      label: 'Ingestion & Graph',
      shortLabel: 'Ingest',
      icon: <Layers className="w-3.5 h-3.5 text-neutral-400" />,
    },
    {
      id: 'graph-view',
      label: 'Semantic Network Graph',
      shortLabel: 'D3 Graph',
      icon: <Share2 className="w-3.5 h-3.5 text-purple-400" />,
      tag: 'D3',
    },
    {
      id: 'explorer',
      label: 'Memory Store Explorer',
      shortLabel: 'Explorer',
      icon: <Database className="w-3.5 h-3.5 text-neutral-400" />,
      badge: stats.totalNodes > 0 ? `${stats.totalNodes} rec` : undefined,
    },
    {
      id: 'transport',
      label: 'Vault & Keys',
      shortLabel: 'Vault',
      icon: <Archive className="w-3.5 h-3.5 text-neutral-400" />,
    },
    {
      id: 'test-matrix',
      label: 'Core Test Matrix',
      shortLabel: 'Test Matrix',
      icon: <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />,
      tag: '10 TESTS',
    },
    {
      id: 'all',
      label: 'All Sections',
      shortLabel: 'All',
      icon: <LayoutGrid className="w-3.5 h-3.5 text-neutral-400" />,
    },
  ];

  return (
    <nav
      id="mainNavBar"
      aria-label="Application Sections Navigation"
      className="bg-neutral-900 border-b border-neutral-800 px-4 sm:px-6 sticky top-[57px] md:top-[65px] z-40 backdrop-blur-md overflow-x-auto select-none"
    >
      <div className="flex items-center space-x-1 sm:space-x-2 py-2 min-w-max">
        <span className="text-[10px] text-neutral-500 uppercase tracking-widest font-semibold mr-2 hidden md:inline-block">
          NAVIGATE:
        </span>
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              id={`navTab-${tab.id}`}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium transition-all duration-150 border cursor-pointer ${
                isActive
                  ? tab.id === 'monolithic'
                    ? 'bg-[#141414] border-[#ff3300] text-white shadow-sm shadow-[#ff3300]/20'
                    : 'bg-neutral-800 border-neutral-600 text-white shadow-sm'
                  : tab.id === 'monolithic'
                  ? 'bg-neutral-950/80 border-[#333] text-[#ffaa00] hover:border-[#ff3300] hover:text-white'
                  : 'bg-neutral-950/40 border-transparent text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/60 hover:border-neutral-800'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className="sm:hidden">{tab.shortLabel}</span>

              {tab.tag && (
                <span
                  className={`text-[9px] px-1 py-0.2 uppercase tracking-wider font-bold rounded-none ${
                    tab.id === 'monolithic'
                      ? 'bg-[#ff3300]/20 text-[#ff3300] border border-[#ff3300]/40'
                      : 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                  }`}
                >
                  {tab.tag}
                </span>
              )}

              {tab.badge && (
                <span className="text-[10px] px-1.5 py-0.2 bg-neutral-800 text-neutral-300 border border-neutral-700 font-mono">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};
