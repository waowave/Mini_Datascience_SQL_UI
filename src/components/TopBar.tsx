import { useState } from 'react';
import { BarChart3, PanelLeft, Baby, Sparkles } from 'lucide-react';
import { useStore } from '../store/useStore';
import { AIPanel } from './AIPanel';

export function TopBar() {
  const { grandmaMode, setGrandmaMode, toggleSidebar, sidebarOpen } = useStore();
  const [showAI, setShowAI] = useState(false);

  return (
    <>
      <header className="flex items-center gap-3 px-4 py-2 bg-slate-900 border-b border-slate-700 flex-shrink-0">
        {/* Logo */}
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-7 h-7 bg-blue-600 rounded-lg flex items-center justify-center">
            <BarChart3 size={15} className="text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-slate-100">DataSense</span>
            <span className="text-[10px] text-slate-500 ml-1">No-Code SQL</span>
          </div>
        </div>

        <div className="h-5 w-px bg-slate-700" />

        {/* Sidebar toggle */}
        <button
          className={`p-1.5 rounded-lg transition-colors ${
            sidebarOpen ? 'text-blue-400 bg-blue-500/10' : 'text-slate-500 hover:text-slate-300'
          }`}
          onClick={toggleSidebar}
          title="Боковая панель (Data Sources)"
        >
          <PanelLeft size={16} />
        </button>

        <div className="flex-1" />

        {/* AI Button */}
        <button
          onClick={() => setShowAI(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-xs font-semibold transition-all shadow-lg shadow-violet-900/40"
          title="AI Аналитик — генерация пайплайна"
        >
          <Sparkles size={13} />
          {grandmaMode ? 'ИИ Помощник' : 'AI Аналитик'}
        </button>

        <div className="h-5 w-px bg-slate-700" />

        {/* Grandma mode */}
        <div className="flex items-center gap-2">
          <Baby size={14} className={grandmaMode ? 'text-pink-400' : 'text-slate-600'} />
          <label className="relative inline-flex items-center cursor-pointer">
            <input
              type="checkbox"
              className="sr-only peer"
              checked={grandmaMode}
              onChange={(e) => setGrandmaMode(e.target.checked)}
            />
            <div
              className={`
                w-9 h-5 rounded-full transition-colors
                ${grandmaMode ? 'bg-pink-500' : 'bg-slate-600'}
                relative after:content-[''] after:absolute after:top-[2px] after:left-[2px]
                after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all
                peer-checked:after:translate-x-4
              `}
            />
          </label>
          <span className={`text-xs ${grandmaMode ? 'text-pink-400 font-semibold' : 'text-slate-500'}`}>
            {grandmaMode ? '👵 Простой режим' : 'SQL режим'}
          </span>
        </div>

        <div className="hidden md:flex items-center gap-1 px-2 py-0.5 bg-slate-800 rounded-full border border-slate-700 ml-1">
          <span className="text-[10px] text-slate-500">v1.0</span>
        </div>
      </header>

      {showAI && <AIPanel onClose={() => setShowAI(false)} />}
    </>
  );
}
