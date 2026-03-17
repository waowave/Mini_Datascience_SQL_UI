import { useEffect } from 'react';
import { TopBar } from './components/TopBar';
import { TabBar } from './components/TabBar';
import { SourcePanel } from './components/SourcePanel';
import { PipelineSidebar } from './components/PipelineSidebar';
import { DataGrid } from './components/DataGrid';
import { SQLPanel } from './components/SQLPanel';
import { HumanPanel } from './components/HumanPanel';
import { useStore } from './store/useStore';

export default function App() {
  const { sidebarOpen, sqlPanelOpen, executeActive } = useStore();

  // Auto-run on first mount to show demo data
  useEffect(() => {
    executeActive();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-950 text-slate-100 overflow-hidden">
      <TopBar />
      <TabBar />

      <div className="flex flex-1 overflow-hidden min-h-0">
        {/* Left: source catalog */}
        {sidebarOpen && (
          <div className="w-52 flex-shrink-0 overflow-hidden flex flex-col border-r border-slate-700/60">
            <SourcePanel />
          </div>
        )}

        {/* Center: data + SQL */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">
          <div className={`flex-1 overflow-hidden min-h-0 ${sqlPanelOpen ? 'flex flex-col' : ''}`}>
            <div className={`overflow-hidden ${sqlPanelOpen ? 'h-1/2' : 'h-full'}`}>
              <DataGrid />
            </div>
            {sqlPanelOpen && (
              <div className="h-1/2 overflow-hidden border-t border-slate-700/60">
                <SQLPanel />
              </div>
            )}
          </div>
        </div>

        {/* Right: pipeline + explain */}
        <div className="w-64 flex-shrink-0 flex flex-col overflow-hidden border-l border-slate-700/60">
          <div className="flex-1 overflow-hidden min-h-0">
            <PipelineSidebar />
          </div>
          <div className="h-32 flex-shrink-0 border-t border-slate-700/60">
            <HumanPanel />
          </div>
        </div>
      </div>
    </div>
  );
}
